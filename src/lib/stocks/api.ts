/**
 * Client-side helpers for the RapidAPI "Indian Stock Exchange" proxy.
 *
 * Every function calls our own `/api/stocks` route so the RapidAPI key
 * never reaches the browser. Shapes below mirror the upstream response
 * as loosely-typed — the API returns deeply nested unknown-ish data.
 */

export interface StockApiResponse<T = unknown> {
  ok: boolean
  data?: T
  cached?: boolean
  error?: string
  status?: number
  detail?: string
}

export interface CallOptions {
  /** Bypass both the server-side cache and Next.js fetch cache. */
  fresh?: boolean
  /** AbortController signal so callers can cancel in-flight requests. */
  signal?: AbortSignal
}

/** Low-level fetcher — wraps the server proxy. */
async function callProxy<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
  opts: CallOptions = {}
): Promise<StockApiResponse<T>> {
  const qs = new URLSearchParams({ path })
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v))
  })
  if (opts.fresh) qs.set('fresh', '1')
  try {
    const res = await fetch(`/api/stocks?${qs}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: opts.signal,
    })
    const json = await res.json().catch(() => ({ ok: false, error: 'Bad JSON' }))
    return json as StockApiResponse<T>
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'Cancelled' }
    }
    return {
      ok: false,
      error: 'Network error',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

// ─── Endpoint helpers ────────────────────────────────────────────────

/**
 * Full stock profile — current price, 52w H/L, peer list, financials,
 * shareholder pattern, etc. Indian Stock Exchange API expects a
 * (partial) company name rather than the NSE ticker.
 *
 * Example: `stockQuote('infosys')`
 */
export function stockQuote(name: string, opts: CallOptions = {}) {
  return callProxy<StockProfile>('stock', { name }, opts)
}

/**
 * Historical price / valuation series.
 *
 *   period: '1m' | '6m' | '1yr' | '3yr' | '5yr' | '10yr' | 'max'
 *   filter: 'price' | 'pe' | 'sm' | 'evebitda' | 'ptb' | 'mcs'
 */
export function historicalData(
  stock_name: string,
  period: HistoricalPeriod = '1yr',
  filter: HistoricalFilter = 'price',
  opts: CallOptions = {}
) {
  return callProxy<HistoricalSeries>(
    'historical_data',
    { stock_name, period, filter },
    opts
  )
}

/** Corporate actions — dividends, splits, bonuses, rights issues. */
export function corporateActions(stock_name: string, opts: CallOptions = {}) {
  return callProxy<CorporateAction[]>('corporate_actions', { stock_name }, opts)
}

/** NSE trending gainers / losers. */
export function trending() {
  return callProxy('trending')
}

/** 52-week high / low snapshot across the market. */
export function fetch52WeekHighLow() {
  return callProxy('fetch_52_week_high_low_data')
}

/** Search by industry / sector keyword. */
export function industrySearch(query: string) {
  return callProxy('industry_search', { query })
}

// ─── Loose types (upstream data is messy — treat as guides, not guarantees) ─

export type HistoricalPeriod = '1m' | '6m' | '1yr' | '3yr' | '5yr' | '10yr' | 'max'
export type HistoricalFilter = 'price' | 'pe' | 'sm' | 'evebitda' | 'ptb' | 'mcs'

export interface StockProfile {
  companyName?: string
  industry?: string
  companyProfile?: {
    companyName?: string
    companyDescription?: string
    mgIndustry?: string
    exchangeCodeNSE?: string
    exchangeCodeBSE?: string
    [key: string]: unknown
  }
  currentPrice?: {
    BSE?: string
    NSE?: string
  }
  percentChange?: string
  yearHigh?: string
  yearLow?: string
  stockTechnicalData?: Array<{ days: string; bsePrice?: string; nsePrice?: string }>
  keyMetrics?: Record<string, unknown>
  peerCompanyList?: Array<Record<string, unknown>>
  financials?: Array<Record<string, unknown>>
  recosBar?: Record<string, unknown>
  riskMeter?: Record<string, unknown>
  shareholding?: Record<string, unknown>
  [key: string]: unknown
}

export interface HistoricalSeriesPoint {
  date?: string
  price?: number | string
  value?: number | string
  [key: string]: unknown
}

export interface HistoricalSeries {
  datasets?: Array<{
    metric?: string
    label?: string
    values?: Array<[string, number] | HistoricalSeriesPoint>
  }>
  [key: string]: unknown
}

export interface CorporateAction {
  announcement_date?: string
  ex_date?: string
  purpose?: string
  details?: string
  [key: string]: unknown
}

// ─── Name mapping — Company → API query string ───────────────────────

/**
 * The API takes a (partial) company name, not an NSE ticker. For most
 * of our value-chain companies a simple lowercased first-word of the
 * company name works, but a few need explicit overrides (ambiguous
 * names, acronyms, etc.).
 *
 * If no override exists, returns the first word of the name, lowercased.
 */
const NAME_OVERRIDES: Record<string, string> = {
  POLYCAB: 'polycab',
  WAAREEENS: 'waaree energies',
  WAAREERTL: 'waaree renewable',
  PREMIENRG: 'premier energies',
  BORORENEW: 'borosil renewables',
  WEBELSOLAR: 'websol energy',
  STERLINWIL: 'sterling wilson',
  SIEMENS: 'siemens india',
  ABB: 'abb india',
  BHEL: 'bhel',
  CGPOWER: 'cg power',
  VOLTAMP: 'voltamp transformers',
  INDOTECH: 'indo tech transformers',
  SHILCTECH: 'shilchar technologies',
  HITACHIEN: 'hitachi energy',
  GENUSPAPER: 'genus power',
  ADANIENSOL: 'adani energy solutions',
  AMARARAJA: 'amara raja',
  EXIDEIND: 'exide industries',
  HAVELLS: 'havells',
  TECHNOE: 'techno electric',
  TDPOWERSYS: 'tdpower',
  POWERGRID: 'power grid',
  NTPC: 'ntpc',
  JSWENERGY: 'jsw energy',
  ADANIGREEN: 'adani green',
  TORNTPOWER: 'torrent power',
  APARINDS: 'apar industries',
  KEC: 'kec international',
  KEI: 'kei industries',
  FNXCABLE: 'finolex cables',
  TARIL: 'transformers rectifiers',
  STRTECH: 'sterlite technologies',
  SKIPPER: 'skipper',
  HBLPOWER: 'hbl power',
  CESC: 'cesc',
  PRAJIND: 'praj industries',
  POWERMECH: 'power mech',
  INSOLATION: 'insolation energy',
  KPIGREEN: 'kpi green',
  SWELECTES: 'swelect',
  HPL: 'hpl electric',
  UNIVCABLES: 'universal cables',
  INOXGREEN: 'inox green',
}

export function tickerToApiName(ticker: string, fullName: string): string {
  const override = NAME_OVERRIDES[ticker.toUpperCase()]
  if (override) return override
  // Fallback — take the first word of the company name, lowercased
  return fullName.split(/\s+/)[0]?.toLowerCase() || ticker.toLowerCase()
}

// ─── Historical data parser ──────────────────────────────────────────
// The RapidAPI historical_data endpoint has a wobbly response shape. It
// can return any of:
//   1. { datasets: [{ values: [[date, num], ...] }] }
//   2. { datasets: [{ values: [{date, price}, ...] }] }
//   3. Just an array at the top level
// This parser normalises to a clean sorted array of { date, price }.

export interface HistoricalPoint {
  date: string
  price: number
}

function coerceNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,₹\s%]/g, '')
    const n = parseFloat(cleaned)
    if (Number.isFinite(n)) return n
  }
  return null
}

function coerceDate(v: unknown): string | null {
  if (typeof v !== 'string') return null
  // Accept ISO (2024-11-01) or 2024-11-01T00:00:00
  const match = v.match(/^(\d{4}-\d{2}-\d{2})/)
  return match ? match[1] : v
}

export function parseHistoricalSeries(raw: unknown): HistoricalPoint[] {
  if (!raw) return []
  const out: HistoricalPoint[] = []

  const pushPair = (dateVal: unknown, priceVal: unknown) => {
    const d = coerceDate(dateVal)
    const p = coerceNum(priceVal)
    if (d && p !== null) out.push({ date: d, price: p })
  }

  const walkValues = (values: unknown) => {
    if (!Array.isArray(values)) return
    for (const row of values) {
      if (Array.isArray(row) && row.length >= 2) {
        pushPair(row[0], row[1])
      } else if (row && typeof row === 'object') {
        const r = row as Record<string, unknown>
        const dateVal = r.date ?? r.Date ?? r.d ?? r.day ?? r.timestamp
        const priceVal =
          r.price ?? r.value ?? r.close ?? r.Price ?? r.Close ?? r.nsePrice ?? r.bsePrice
        pushPair(dateVal, priceVal)
      }
    }
  }

  if (Array.isArray(raw)) {
    walkValues(raw)
  } else if (typeof raw === 'object') {
    const r = raw as Record<string, unknown>
    if (Array.isArray(r.datasets)) {
      // Prefer the first dataset that has values
      for (const ds of r.datasets as Array<Record<string, unknown>>) {
        if (ds && Array.isArray(ds.values) && ds.values.length) {
          walkValues(ds.values)
          if (out.length) break
        }
      }
    } else if (Array.isArray(r.values)) {
      walkValues(r.values)
    } else if (Array.isArray(r.data)) {
      walkValues(r.data)
    }
  }

  // Dedupe + sort ascending by date
  const seen = new Set<string>()
  const dedup: HistoricalPoint[] = []
  for (const pt of out) {
    if (!seen.has(pt.date)) {
      seen.add(pt.date)
      dedup.push(pt)
    }
  }
  dedup.sort((a, b) => a.date.localeCompare(b.date))
  return dedup
}
