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
  // Provenance tag — widened from the literal 'nse-direct' so the
  // admin manual sweep (which can fall back to Screener for SME
  // tickers where NSE main-board endpoints 404) can push its rows
  // into LiveSnapshotProvider.state.nseData via patchNseBatch
  // without a cast. Keeps one interface instead of two divergent
  // ones that need reconciling at every call site.
  source: 'nse-direct' | 'screener-sme'
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
  // WEBELSOLAR — was mapped to WESOLENRGY (stale since Screener/NSE
  // restructured in 2025). Verified live via NSE autocomplete: the
  // current symbol for Websol Energy System Limited is WEBELSOLAR
  // (the ticker itself). The dynamic name-resolver now handles drift
  // automatically so we don't need to keep manually curating this
  // when companies rename.
  STERLINWIL: 'SWSOLAR',
  HITACHIEN: 'POWERINDIA',
  GENUSPAPER: 'GENUSPOWER',
  // GETANDEL — updated from GEVERNOVA to GVT&D. NSE's autocomplete
  // returns symbol=GVT&D for "GE Vernova T&D India Limited" as of
  // the mid-2025 rebrand. The old GEVERNOVA page was taken down.
  GETANDEL: 'GVT&D',
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

/**
 * Name-based ticker resolver using NSE's own autocomplete API.
 *
 * Indian listed companies periodically change their NSE symbols (GE
 * Vernova rebranded from GEVERNOVA → GVT&D in 2025, Sterling Wilson
 * was SWSOLAR before STERLINWIL, Websol moved from WESOLENRGY back
 * to WEBELSOLAR, etc). Our hand-curated NSE_SYMBOL map catches the
 * obvious cases but silently goes stale whenever NSE pushes a new
 * rename and an admin hasn't noticed yet — that's the "many company
 * data is not coming from NSE" symptom you flagged.
 *
 * This resolver queries NSE's own `/api/search/autocomplete?q=<name>`
 * and returns the current active symbol for the closest name match.
 * Called during a sweep ONLY when the primary symbol lookup failed,
 * so the happy path stays fast (no extra RTT per ticker); the slow
 * path self-heals instead of silently 404-ing.
 *
 * Returns null on network failure or when no strong name match is
 * found (we'd rather fall through to the baseline row than guess).
 */
export interface NseSearchHit {
  symbol: string
  symbolInfo: string
  activeSeries: string
}

export async function resolveNseSymbolByName(
  name: string,
  cookie?: string
): Promise<NseSearchHit | null> {
  const trimmed = (name || '').trim()
  if (!trimmed || trimmed.length < 3) return null

  // Some Indian company names carry "Limited" / "Ltd" / "Pvt Ltd"
  // suffixes that NSE's search matches case-insensitively. Strip
  // them so queries like "Waaree Energies Limited" don't over-index
  // on the boilerplate portion.
  const query = trimmed
    .replace(/\b(Ltd\.?|Limited|Pvt\.?|Private)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!query) return null

  const baseUrl = 'https://www.nseindia.com'
  const headers: Record<string, string> = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'application/json',
    Referer: baseUrl + '/',
  }
  // Reuse the caller's cookie jar when provided. The scrape-exchange
  // route already primes NSE cookies at sweep start — passing them
  // here avoids re-hitting the homepage per ticker.
  if (cookie) headers.Cookie = cookie

  try {
    const ac = new AbortController()
    const t = setTimeout(() => ac.abort(), 5000)
    try {
      const res = await fetch(
        `${baseUrl}/api/search/autocomplete?q=${encodeURIComponent(query)}`,
        { headers, signal: ac.signal }
      )
      if (!res.ok) return null
      const json = (await res.json().catch(() => null)) as {
        symbols?: Array<{
          symbol?: string
          symbol_info?: string
          activeSeries?: string | string[]
          type?: string
        }>
      } | null

      const hits = json?.symbols || []
      // Prefer an active equity listing (activeSeries contains "EQ"
      // or "T0"). Skip derivatives / indexes / mutual funds.
      for (const hit of hits) {
        if (!hit.symbol || !hit.symbol_info) continue
        const series = Array.isArray(hit.activeSeries)
          ? hit.activeSeries.join(',')
          : hit.activeSeries || ''
        if (!series || !/EQ|T0/i.test(series)) continue
        return {
          symbol: String(hit.symbol).trim().toUpperCase(),
          symbolInfo: String(hit.symbol_info).trim(),
          activeSeries: series,
        }
      }
      return null
    } finally {
      clearTimeout(t)
    }
  } catch {
    return null
  }
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
