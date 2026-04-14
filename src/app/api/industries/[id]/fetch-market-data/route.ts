import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * POST /api/industries/:id/fetch-market-data
 *
 * Admin-only. For every atlas company in the given industry with
 * status MAIN / SME / SUBSIDIARY and a plausible NSE ticker, fetch live
 * data from the NSE public API (lastPrice, pChange, mktcap, P/E) and
 * persist into industry_chain_companies.market_data JSONB.
 *
 * Screener.in is hit as a best-effort fallback for additional fundamentals
 * when the NSE quote is too thin (no mktcap or no P/E).
 *
 * The scraper is polite: ~1 request per second per exchange to stay
 * under rate limits.
 *
 * Returns per-company status so the admin UI can surface which tickers
 * failed (typos, delisted, renamed etc.).
 */

interface NseQuote {
  info?: { symbol?: string; companyName?: string }
  metadata?: { pdSymbolPe?: number }
  securityInfo?: { issuedSize?: number; faceValue?: number }
  priceInfo?: {
    lastPrice?: number
    pChange?: number
    weekHighLow?: { min?: number; max?: number }
  }
  industryInfo?: { basicIndustry?: string }
}

interface MarketDataRecord {
  lastPrice: number | null
  changePct: number | null
  mktcapCr: number | null
  pe: number | null
  weekHigh: number | null
  weekLow: number | null
  industry: string | null
  source: 'nse-direct' | 'screener' | 'mixed'
  fetchedAt: string
}

// ── NSE session-cookie helper (shared pattern from scrape-exchange route) ──
let nseCookies = ''
let cookieExpiry = 0

async function ensureNseCookies(): Promise<void> {
  if (nseCookies && Date.now() < cookieExpiry) return
  try {
    const res = await fetch('https://www.nseindia.com/', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      redirect: 'manual',
    })
    const cookies = res.headers.getSetCookie?.() || []
    nseCookies = cookies.map((c) => c.split(';')[0]).join('; ')
    cookieExpiry = Date.now() + 4 * 60 * 1000
  } catch {
    nseCookies = ''
  }
}

async function fetchNseQuote(symbol: string): Promise<NseQuote | null> {
  await ensureNseCookies()
  const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}`
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        ...(nseCookies ? { Cookie: nseCookies } : {}),
      },
    })
    if (!res.ok) return null
    return (await res.json()) as NseQuote
  } catch {
    return null
  }
}

// ── Screener.in fallback — scrape the meta fundamentals section ───
async function fetchScreener(symbol: string): Promise<Partial<MarketDataRecord> | null> {
  try {
    const res = await fetch(`https://www.screener.in/company/${symbol}/consolidated/`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    })
    if (!res.ok) return null
    const html = await res.text()

    const pick = (label: string) => {
      // Screener markup: <li><span class="name">Label</span><span class="value">₹ 1,234 Cr</span>
      const re = new RegExp(
        `<span class="name">\\s*${label}[\\s\\S]*?<span class="number">([\\s\\S]*?)<`,
        'i'
      )
      const m = html.match(re)
      if (!m) return null
      return m[1].replace(/[,\s]/g, '').replace(/[^\d.-]/g, '')
    }

    const mktcapRaw = pick('Market Cap')
    const peRaw = pick('Stock P\\/E')
    const priceRaw = pick('Current Price')
    const highRaw = pick('High \\/ Low')

    const mktcapCr = mktcapRaw ? parseFloat(mktcapRaw) : null
    const pe = peRaw ? parseFloat(peRaw) : null
    const lastPrice = priceRaw ? parseFloat(priceRaw) : null
    const weekHigh = highRaw ? parseFloat(highRaw) : null

    return { mktcapCr, pe, lastPrice, weekHigh, source: 'screener' }
  } catch {
    return null
  }
}

function inferNseSymbol(ticker: string | null, exchange: string | null): string | null {
  if (!ticker || ticker === '—' || ticker === '-') return null
  // Skip foreign / non-NSE tickers (e.g. "TYO: 4043", "ETR: WCH")
  if (/:/.test(ticker)) return null
  if (/\s/.test(ticker)) return null
  // Skip non-alnum tickers
  if (!/^[A-Z0-9&-]+$/.test(ticker)) return null
  // BSE SME / NSE Emerge tickers may still be queryable on NSE; try them
  if (exchange && /BSE SME/i.test(exchange)) return null // BSE-only
  return ticker
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  const { id: industryId } = await params

  let maxCompanies = 0 // 0 = no cap
  try {
    const body = await req.json().catch(() => ({}))
    if (typeof body.maxCompanies === 'number') maxCompanies = Math.max(0, body.maxCompanies)
  } catch {
    /* optional */
  }

  try {
    await ensureSchema()

    const rows = await sql`
      SELECT id, name, status, exchange, ticker
      FROM industry_chain_companies
      WHERE industry_id = ${industryId}
        AND status IN ('MAIN','SME','SUBSIDIARY')
      ORDER BY status ASC, name ASC
    `
    const targets = rows
      .map((r) => ({ ...r, sym: inferNseSymbol(r.ticker, r.exchange) }))
      .filter((r) => r.sym)

    const capped = maxCompanies > 0 ? targets.slice(0, maxCompanies) : targets

    const results: { ticker: string; name: string; ok: boolean; note?: string }[] = []
    let fetched = 0

    for (let i = 0; i < capped.length; i++) {
      const co = capped[i]
      const sym = co.sym as string
      try {
        const q = await fetchNseQuote(sym)
        let rec: MarketDataRecord | null = null
        if (q?.priceInfo?.lastPrice) {
          const last = q.priceInfo.lastPrice
          const shares = q.securityInfo?.issuedSize ?? null
          const mktcap = last && shares ? Math.round((last * shares) / 1e7) : null
          rec = {
            lastPrice: last,
            changePct: q.priceInfo.pChange ?? null,
            mktcapCr: mktcap,
            pe: q.metadata?.pdSymbolPe ?? null,
            weekHigh: q.priceInfo.weekHighLow?.max ?? null,
            weekLow: q.priceInfo.weekHighLow?.min ?? null,
            industry: q.industryInfo?.basicIndustry ?? null,
            source: 'nse-direct',
            fetchedAt: new Date().toISOString(),
          }
        }
        // Screener fallback: if NSE gave no mktcap or no PE, top up
        if (!rec || !rec.mktcapCr || !rec.pe) {
          const scr = await fetchScreener(sym)
          if (scr) {
            if (!rec) {
              rec = {
                lastPrice: scr.lastPrice ?? null,
                changePct: null,
                mktcapCr: scr.mktcapCr ?? null,
                pe: scr.pe ?? null,
                weekHigh: scr.weekHigh ?? null,
                weekLow: null,
                industry: null,
                source: 'screener',
                fetchedAt: new Date().toISOString(),
              }
            } else {
              if (!rec.mktcapCr && scr.mktcapCr) rec.mktcapCr = scr.mktcapCr
              if (!rec.pe && scr.pe) rec.pe = scr.pe
              rec.source = 'mixed'
            }
          }
        }

        if (rec) {
          await sql`
            UPDATE industry_chain_companies
            SET market_data = ${JSON.stringify(rec)}::jsonb,
                market_data_fetched_at = NOW()
            WHERE id = ${co.id}
          `
          results.push({ ticker: sym, name: co.name, ok: true })
          fetched++
        } else {
          results.push({ ticker: sym, name: co.name, ok: false, note: 'no data' })
        }
      } catch (err) {
        results.push({
          ticker: sym,
          name: co.name,
          ok: false,
          note: err instanceof Error ? err.message : 'fetch error',
        })
      }
      // Rate limit: NSE ~1 req/s; pause between every call
      if (i < capped.length - 1) {
        await new Promise((r) => setTimeout(r, 1100))
      }
    }

    return NextResponse.json({
      ok: true,
      industryId,
      total: targets.length,
      fetched,
      capped: capped.length,
      results,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

/** GET /api/industries/:id/fetch-market-data — returns current status */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }
  const { id: industryId } = await params
  try {
    await ensureSchema()
    const stats = await sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'MAIN')::int AS main_listed,
        COUNT(*) FILTER (WHERE status = 'SME')::int AS sme_listed,
        COUNT(*) FILTER (WHERE status = 'PRIVATE')::int AS private_co,
        COUNT(*) FILTER (WHERE status = 'SUBSIDIARY')::int AS subsidiary,
        COUNT(*) FILTER (WHERE status = 'GOVT/PSU')::int AS govt,
        COUNT(*) FILTER (WHERE market_data IS NOT NULL)::int AS with_market_data,
        MAX(market_data_fetched_at) AS last_fetched_at
      FROM industry_chain_companies
      WHERE industry_id = ${industryId}
    `
    return NextResponse.json({ ok: true, industryId, stats: stats[0] })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
