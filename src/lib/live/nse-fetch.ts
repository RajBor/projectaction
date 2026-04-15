/**
 * Shared NSE India fetch logic.
 *
 * Used by both the admin scrape-exchange route (full publish flow)
 * and the non-admin nse-quote route (automatic hourly refresh).
 * The NSE API is public and free but requires a session cookie
 * from the homepage.
 */

import type { Company } from '@/lib/data/companies'

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
  evCr: number | null
  evEbitda: number | null
  fetchedAt: string
  source: 'nse-direct'
}

/**
 * Hardcoded NSE-symbol corrections for tickers whose live symbol on
 * nseindia.com differs from their app-internal ticker. These are
 * fallbacks — an admin-set value in user_companies.nse ALWAYS wins
 * over this map (see nseSymbol() below). Add entries here only for
 * seeds that ship with the repo, not per-instance overrides.
 */
export const NSE_SYMBOL: Record<string, string> = {
  WAAREEENS: 'WAAREEENER',
  PREMIENRG: 'PREMIERENE',
  // BORORENEW — intentionally NOT mapped. Borosil Renewables' live NSE
  // symbol IS `BORORENEW` (verified via /api/quote-equity). The previous
  // `BORORENEW → BFRENEWABL` alias pointed at a delisted/renamed ticker
  // and caused every live fetch to return empty (the "✗ no quote" badge
  // in the admin comparison table).
  WEBELSOLAR: 'WESOLENRGY',
  STERLINWIL: 'SWSOLAR',
  HITACHIEN: 'POWERINDIA',
  GENUSPAPER: 'GENUSPOWER',
  GETANDEL: 'GEVERNOVA',
  STRTECH: 'STLTECH',
  HPL: 'HPLELECTRIC',
}

/**
 * Resolve the live NSE symbol for a ticker.
 *
 * Precedence (highest wins):
 *   1. Explicit `nse` argument — the merged `user_companies` value
 *      from /api/data/nse-quote. This is what the admin "Edit NSE
 *      Symbol" UI writes to. Wins everything so corrections take
 *      effect on the next hourly refresh with no redeploy.
 *   2. Static NSE_SYMBOL map — repo-shipped corrections for seed rows.
 *   3. The ticker itself — last-resort fallback.
 *
 * Previously the static map won over the explicit arg, which made it
 * impossible for an admin to correct a symbol once it shipped in the
 * map (e.g. if NSE renamed a company after a release). That's why this
 * check was flipped.
 */
export function nseSymbol(ticker: string, nse: string | null): string {
  const trimmed = typeof nse === 'string' ? nse.trim().toUpperCase() : ''
  if (trimmed && trimmed !== ticker) return trimmed
  // `??` only short-circuits on null/undefined, so an empty `trimmed`
  // still needs the explicit `|| ticker` to avoid returning "".
  return NSE_SYMBOL[ticker] ?? (trimmed || ticker)
}

// ── NSE session cookie management ────────────────────────────

let nseCookies = ''
let cookieExpiry = 0

export async function ensureNseCookies(): Promise<void> {
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
    nseCookies = cookies.map((c: string) => c.split(';')[0]).join('; ')
    cookieExpiry = Date.now() + 4 * 60 * 1000
  } catch {
    nseCookies = ''
  }
}

export interface NseQuote {
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

export async function fetchNseQuote(symbol: string): Promise<NseQuote | null> {
  await ensureNseCookies()
  const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}`
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
}

/** Build an ExchangeRow from a raw NSE quote + a baseline Company. */
export function buildExchangeRow(
  co: Company,
  quote: NseQuote,
  symbol: string
): ExchangeRow {
  const lastPrice = quote.priceInfo?.lastPrice ?? null
  const changePct = quote.priceInfo?.pChange ?? null
  const shares = quote.securityInfo?.issuedSize ?? null
  const mktcapCr =
    lastPrice != null && shares != null
      ? Math.round((lastPrice * shares) / 1e7)
      : null
  const pe =
    quote.metadata?.pdSymbolPe != null
      ? Math.round(quote.metadata.pdSymbolPe * 10) / 10
      : null
  const evRatio = co.mktcap > 0 ? co.ev / co.mktcap : 1
  const evCr = mktcapCr != null ? Math.round(mktcapCr * evRatio) : null
  const evEbitda =
    evCr != null && co.ebitda > 0
      ? Math.round((evCr / co.ebitda) * 10) / 10
      : null

  return {
    ticker: co.ticker,
    nse: symbol,
    name: quote.info?.companyName ?? co.name,
    lastPrice,
    changePct,
    mktcapCr,
    pe,
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
}
