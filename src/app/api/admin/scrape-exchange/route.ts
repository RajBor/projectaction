import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { COMPANIES } from '@/lib/data/companies'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * POST /api/admin/scrape-exchange — "DealNector API"
 *
 * Admin-only. Fetches equity data DIRECTLY from the NSE India public
 * JSON API (nseindia.com/api/quote-equity) — zero dependency on
 * RapidAPI or Screener.in. Free, no API key required.
 *
 * For each company we get:
 *   - lastPrice, pChange (from priceInfo)
 *   - pdSymbolPe (trailing P/E from metadata)
 *   - issuedSize (total shares from securityInfo)
 *   - faceValue
 *   - weekHighLow
 *   - industry info
 *
 * And derive:
 *   - marketCapCr = lastPrice × issuedSize / 1e7
 *   - EV = marketCapCr × (baseline_ev / baseline_mktcap) — same unit-safe scaling
 *   - EV/EBITDA = EV / baseline_ebitda
 *
 * Body: { tickers?: string[] }
 * Returns: { ok, data: Record<ticker, ExchangeRow>, errors }
 *
 * Rate-limited to ~1 req/sec because NSE throttles aggressively.
 * A session cookie is needed for the NSE API; we fetch the homepage
 * first to get it.
 */

export interface ExchangeRow {
  ticker: string
  nse: string
  name: string
  /** Last traded price in ₹/share (NSE priceInfo.lastPrice). */
  lastPrice: number | null
  /**
   * Day % change vs previous close. Stored as a 0..100 percentage
   * (e.g. 2.5 means +2.5%), matching NSE's `priceInfo.pChange` which
   * is already a percentage. Do NOT multiply by 100 downstream.
   */
  changePct: number | null
  /**
   * Market cap in ₹Cr. Derived from lastPrice × issuedSize / 1e7.
   * NSE's `securityInfo.issuedSize` is in RAW shares (e.g. 9,500,000,000
   * for Reliance), not crore-shares. Dividing by 1e7 converts
   * ₹ total to ₹Cr. Rounded to whole ₹Cr for storage.
   */
  mktcapCr: number | null
  /** Trailing P/E from NSE `metadata.pdSymbolPe`. */
  pe: number | null
  /** Raw share count (NSE `securityInfo.issuedSize`). */
  sharesOutstanding: number | null
  faceValue: number | null
  weekHigh: number | null
  weekLow: number | null
  industry: string | null
  /** Derived from baseline scaling (unit-safe) */
  evCr: number | null
  evEbitda: number | null
  /**
   * Period descriptor. NSE quote data is LIVE / spot — price is today's
   * last trade, PE is trailing, 52w high/low is the rolling window.
   * Surfaced for consistency with Screener's richer period labels.
   */
  period: string
  fetchedAt: string
  source: 'nse-direct'
}

// ── NSE symbol mapping ───────────────────────────────────────

const NSE_SYMBOL: Record<string, string> = {
  WAAREEENS: 'WAAREEENER',
  PREMIENRG: 'PREMIERENE',
  BORORENEW: 'BFRENEWABL',
  WEBELSOLAR: 'WESOLENRGY',
  STERLINWIL: 'SWSOLAR',
  HITACHIEN: 'POWERINDIA',
  GENUSPAPER: 'GENUSPOWER',
  GETANDEL: 'GEVERNOVA',
  STRTECH: 'STLTECH',
  HPL: 'HPLELECTRIC',
}

function nseSymbol(ticker: string, nse: string | null): string {
  return NSE_SYMBOL[ticker] ?? nse ?? ticker
}

// ── NSE fetch with session ───────────────────────────────────

/** NSE requires a valid session cookie. We get it by hitting the
 *  homepage first and capturing the Set-Cookie header. */
let nseCookies = ''
let cookieExpiry = 0

async function ensureNseCookies(): Promise<void> {
  if (nseCookies && Date.now() < cookieExpiry) return
  try {
    const res = await fetch('https://www.nseindia.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      redirect: 'manual',
    })
    const cookies = res.headers.getSetCookie?.() || []
    nseCookies = cookies.map((c) => c.split(';')[0]).join('; ')
    cookieExpiry = Date.now() + 4 * 60 * 1000 // 4-min TTL
  } catch {
    // fallback: try without cookies
    nseCookies = ''
  }
}

interface NseQuote {
  info?: {
    symbol?: string
    companyName?: string
  }
  metadata?: {
    pdSymbolPe?: number
  }
  securityInfo?: {
    issuedSize?: number
    faceValue?: number
  }
  priceInfo?: {
    lastPrice?: number
    pChange?: number
    weekHighLow?: {
      min?: number
      max?: number
    }
  }
  industryInfo?: {
    basicIndustry?: string
  }
}

async function fetchNseQuote(symbol: string): Promise<NseQuote | null> {
  await ensureNseCookies()
  const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
      ...(nseCookies ? { Cookie: nseCookies } : {}),
    },
  })
  if (!res.ok) return null
  return (await res.json()) as NseQuote
}

// ── Route handler ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let requestedTickers: string[] | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (Array.isArray(body.tickers) && body.tickers.length > 0) {
      requestedTickers = body.tickers
    }
  } catch {
    // empty = all
  }

  // Build the candidate pool from BOTH the hardcoded COMPANIES seed AND
  // the admin-added rows in user_companies. Previously we filtered only
  // the static array, which meant SME / discovery / atlas-added tickers
  // could never be refreshed from NSE — they'd sit with stale baseline
  // numbers forever. Now every company known to the platform (main +
  // SME + atlas additions) is eligible, keyed by ticker for dedupe.
  type CoSlim = { ticker: string; nse: string | null; name: string; mktcap: number; ev: number; ebitda: number }
  const pool = new Map<string, CoSlim>()
  for (const c of COMPANIES) {
    if (c.nse || requestedTickers?.includes(c.ticker)) {
      pool.set(c.ticker, {
        ticker: c.ticker,
        nse: c.nse || null,
        name: c.name,
        mktcap: c.mktcap,
        ev: c.ev,
        ebitda: c.ebitda,
      })
    }
  }
  try {
    await ensureSchema()
    const dbRows = await sql`
      SELECT ticker, nse, name, mktcap, ev, ebitda FROM user_companies
    `
    for (const r of dbRows as Array<{ ticker: string; nse: string | null; name: string; mktcap: unknown; ev: unknown; ebitda: unknown }>) {
      // DB row wins over static seed so admin-overridden names/tickers
      // surface. NSE symbol falls back to the ticker when the column is
      // empty — NSE SME listings use their ticker as the live symbol.
      pool.set(r.ticker, {
        ticker: r.ticker,
        nse: r.nse || r.ticker,
        name: r.name,
        mktcap: Number(r.mktcap) || 0,
        ev: Number(r.ev) || 0,
        ebitda: Number(r.ebitda) || 0,
      })
    }
  } catch (err) {
    console.warn('[scrape-exchange] user_companies read skipped:', err instanceof Error ? err.message : err)
  }

  const targets: CoSlim[] = requestedTickers
    ? Array.from(pool.values()).filter((c) => requestedTickers!.includes(c.ticker))
    : Array.from(pool.values()).filter((c) => c.nse)

  const data: Record<string, ExchangeRow> = {}
  const errors: string[] = []

  for (let i = 0; i < targets.length; i++) {
    const co = targets[i]
    const symbol = nseSymbol(co.ticker, co.nse)
    try {
      const quote = await fetchNseQuote(symbol)
      if (!quote || !quote.priceInfo?.lastPrice) {
        errors.push(`${co.ticker} (${symbol}): no data`)
        continue
      }

      const lastPrice = quote.priceInfo.lastPrice
      // pChange is NSE's daily % change (e.g. 2.5 means +2.5%). Passed
      // through verbatim — no scaling. Guard against string form in
      // case the API schema drifts.
      const pChangeRaw = quote.priceInfo.pChange
      const changePct = typeof pChangeRaw === 'number' && Number.isFinite(pChangeRaw)
        ? pChangeRaw
        : null
      // issuedSize is raw shares (not crore-shares). Sanity-check that
      // it's in a plausible range for an Indian listed equity
      // (1M–100B shares) before using it — if NSE ever flips to
      // reporting in "Cr shares" we'd get market caps 1e7× too small
      // and silently publish garbage. We flag rather than crash.
      const sharesRaw = quote.securityInfo?.issuedSize
      const shares = typeof sharesRaw === 'number' && Number.isFinite(sharesRaw) && sharesRaw > 1e6 && sharesRaw < 1e12
        ? sharesRaw
        : null
      const mktcapCr = lastPrice && shares
        ? Math.round((lastPrice * shares) / 1e7)
        : null
      const pe = quote.metadata?.pdSymbolPe ?? null

      // Unit-safe EV derivation from baseline ratio
      const evRatio = co.mktcap > 0 ? co.ev / co.mktcap : 1
      const evCr = mktcapCr != null ? Math.round(mktcapCr * evRatio) : null
      const evEbitda = evCr != null && co.ebitda > 0
        ? Math.round((evCr / co.ebitda) * 10) / 10
        : null

      data[co.ticker] = {
        ticker: co.ticker,
        nse: symbol,
        name: quote.info?.companyName ?? co.name,
        lastPrice,
        changePct,
        mktcapCr,
        pe: pe != null ? Math.round(pe * 10) / 10 : null,
        sharesOutstanding: shares,
        faceValue: quote.securityInfo?.faceValue ?? null,
        weekHigh: quote.priceInfo?.weekHighLow?.max ?? null,
        weekLow: quote.priceInfo?.weekHighLow?.min ?? null,
        industry: quote.industryInfo?.basicIndustry ?? null,
        evCr,
        evEbitda,
        period: 'Live spot (price) · trailing 12m (P/E) · 52w (H/L)',
        fetchedAt: new Date().toISOString(),
        source: 'nse-direct',
      }
    } catch (err) {
      errors.push(
        `${co.ticker}: ${err instanceof Error ? err.message : 'fetch failed'}`
      )
    }
    // NSE rate limit: ~1 req/sec
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 1100))
    }
  }

  return NextResponse.json({
    ok: true,
    data,
    count: Object.keys(data).length,
    total: targets.length,
    errors: errors.length > 0 ? errors : undefined,
  })
}
