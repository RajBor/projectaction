import { isAdminOrSubadmin, extractRole } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { COMPANIES } from '@/lib/data/companies'

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
  lastPrice: number | null
  changePct: number | null
  mktcapCr: number | null
  pe: number | null
  sharesOutstanding: number | null
  faceValue: number | null
  weekHigh: number | null
  weekLow: number | null
  industry: string | null
  /** Derived from baseline scaling (unit-safe) */
  evCr: number | null
  evEbitda: number | null
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

  const targets = requestedTickers
    ? COMPANIES.filter((c) => requestedTickers!.includes(c.ticker))
    : COMPANIES.filter((c) => c.nse)

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
      const changePct = quote.priceInfo.pChange ?? null
      const shares = quote.securityInfo?.issuedSize ?? null
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
