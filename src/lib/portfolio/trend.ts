/**
 * Portfolio trend computation + event overlay.
 *
 * Given a Portfolio, this module synthesizes a daily time-series of
 * portfolio values by walking every holding, pulling its historical
 * price data from RapidAPI (when available), and blending by weight.
 *
 * Historical price hydration is best-effort — if RapidAPI returns
 * nothing or errors for a holding, we fall back to its entry snapshot
 * as a flat line. The function returns both the raw series and a
 * "normalised to 100 at start" series for chart display.
 *
 * Events are news items that overlap the time window and have a
 * high materiality rating. Each event is anchored to a specific date
 * so the chart can drop a marker / tooltip at the right x position.
 */

import { historicalData, type HistoricalSeries } from '@/lib/stocks/api'
import type { NewsItem } from '@/lib/news/api'
import type { NewsImpact } from '@/lib/news/impact'
import type { Portfolio, PortfolioHolding } from './store'
import { normalizedWeights } from './store'

export interface TrendPoint {
  date: string // YYYY-MM-DD
  portfolioValueCr: number
  normalized: number // indexed to 100 at first point
  /** Contributions per holding key → absolute value in ₹Cr on this day. */
  byHolding: Record<string, number>
}

export interface TrendEvent {
  date: string
  headline: string
  source: string
  sentiment: NewsImpact['sentiment']
  materiality: NewsImpact['materiality']
  multipleDeltaPct: number
  affectedTickers: string[]
  link?: string
}

export interface PortfolioTrend {
  portfolioId: string
  /** Daily series, oldest first. */
  points: TrendPoint[]
  /** Start / end dates of the window (ISO). */
  startDate: string
  endDate: string
  /** Total return (%) from first point to last. */
  totalReturnPct: number
  /** Peak-to-trough draw-down (%). Always <= 0. */
  maxDrawdownPct: number
  /** Which holdings successfully hydrated from upstream. */
  hydratedHoldings: string[]
  /** Which holdings fell back to flat line. */
  fallbackHoldings: string[]
  /** News events overlapping the window (sorted by date asc). */
  events: TrendEvent[]
}

// ── Small helpers ─────────────────────────────────────────────

function parsePoint(raw: unknown): { date: string; value: number } | null {
  if (Array.isArray(raw) && raw.length >= 2) {
    const [d, v] = raw
    if (typeof d === 'string' && typeof v === 'number' && Number.isFinite(v)) {
      return { date: d.slice(0, 10), value: v }
    }
    if (typeof d === 'string') {
      const n = typeof v === 'string' ? parseFloat(v) : NaN
      if (Number.isFinite(n)) return { date: d.slice(0, 10), value: n }
    }
  }
  if (raw && typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    const date = typeof o.date === 'string' ? o.date : null
    const price =
      typeof o.price === 'number'
        ? o.price
        : typeof o.price === 'string'
          ? parseFloat(o.price)
          : typeof o.value === 'number'
            ? o.value
            : typeof o.value === 'string'
              ? parseFloat(o.value)
              : NaN
    if (date && Number.isFinite(price)) {
      return { date: date.slice(0, 10), value: price }
    }
  }
  return null
}

function normalizeSeries(series: HistoricalSeries | null | undefined): Array<{ date: string; value: number }> {
  if (!series || !series.datasets || !Array.isArray(series.datasets)) return []
  // Prefer a dataset named "price", else use the first one with values.
  const preferred =
    series.datasets.find((d) => (d.metric || d.label || '').toLowerCase().includes('price')) ??
    series.datasets.find((d) => Array.isArray(d.values) && d.values.length > 0)
  if (!preferred || !preferred.values) return []
  const out: Array<{ date: string; value: number }> = []
  for (const v of preferred.values) {
    const p = parsePoint(v)
    if (p) out.push(p)
  }
  out.sort((a, b) => a.date.localeCompare(b.date))
  return out
}

/** Pull historical price data for a listed holding with a 5s timeout. */
async function fetchSeriesForHolding(
  holding: PortfolioHolding,
  period: '1yr' | '3yr' | '5yr',
  signal?: AbortSignal
): Promise<Array<{ date: string; value: number }>> {
  if (holding.kind !== 'listed' || !holding.ticker) return []
  try {
    const ctrl = new AbortController()
    const tm = setTimeout(() => ctrl.abort(), 5500)
    const composedSignal = signal ?? ctrl.signal
    const res = await historicalData(holding.ticker, period, 'price', {
      signal: composedSignal,
    })
    clearTimeout(tm)
    if (!res.ok || !res.data) return []
    return normalizeSeries(res.data)
  } catch {
    return []
  }
}

/** Generate a flat-line fallback series over the window using entry value. */
function fallbackSeries(
  holding: PortfolioHolding,
  startDate: string,
  endDate: string,
  stepDays = 7
): Array<{ date: string; value: number }> {
  const start = new Date(startDate)
  const end = new Date(endDate)
  const out: Array<{ date: string; value: number }> = []
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + stepDays)) {
    out.push({ date: d.toISOString().slice(0, 10), value: holding.entryValueCr })
  }
  return out
}

/**
 * Clean blend: accept { series, priceAnchor, entryCr } per holding
 * and produce a daily portfolio value in ₹Cr.
 *
 * For each date, each holding's latest known price-per-share is
 * looked up; its contribution is (weight × entryCr × currentPrice /
 * priceAnchor). Total is summed across holdings.
 */
function blendSeriesV2(
  perHolding: Record<string, { series: Array<{ date: string; value: number }>; priceAnchor: number; entryCr: number }>,
  weights: Record<string, number>
): TrendPoint[] {
  const dates = new Set<string>()
  for (const h of Object.values(perHolding)) {
    for (const p of h.series) dates.add(p.date)
  }
  const sorted = Array.from(dates).sort()
  if (sorted.length === 0) return []

  // Cursors per holding so we only walk each series once
  const cursors: Record<string, number> = {}
  const latestPrice: Record<string, number> = {}
  for (const [key, h] of Object.entries(perHolding)) {
    cursors[key] = 0
    latestPrice[key] = h.priceAnchor
  }

  const out: TrendPoint[] = []
  let firstValue: number | null = null

  for (const date of sorted) {
    for (const [key, h] of Object.entries(perHolding)) {
      while (cursors[key] < h.series.length && h.series[cursors[key]].date <= date) {
        latestPrice[key] = h.series[cursors[key]].value
        cursors[key]++
      }
    }

    const byHolding: Record<string, number> = {}
    let total = 0
    for (const [key, w] of Object.entries(weights)) {
      const h = perHolding[key]
      if (!h) continue
      const ratio = h.priceAnchor > 0 ? latestPrice[key] / h.priceAnchor : 1
      const value = w * h.entryCr * ratio
      byHolding[key] = value
      total += value
    }

    if (firstValue == null) firstValue = total
    out.push({
      date,
      portfolioValueCr: total,
      normalized: firstValue && firstValue !== 0 ? (total / firstValue) * 100 : 100,
      byHolding,
    })
  }

  return out
}

// ── News events ──────────────────────────────────────────────

/**
 * Extract high-materiality events from the shared news feed that
 * affect any portfolio holding, within the window [start, end].
 */
export function extractPortfolioEvents(
  portfolio: Portfolio,
  allNews: Array<{ item: NewsItem; impact: NewsImpact }>,
  startDate: string,
  endDate: string
): TrendEvent[] {
  const tickersInPortfolio = new Set(
    portfolio.holdings.filter((h) => h.kind === 'listed').map((h) => h.ticker)
  )
  const out: TrendEvent[] = []
  for (const { item, impact } of allNews) {
    if (!item.pubDate) continue
    const d = item.pubDate.slice(0, 10)
    if (d < startDate || d > endDate) continue
    // Keep items that touch any portfolio holding OR are high-materiality
    // policy events that would affect the sector generally.
    const hits = impact.affectedCompanies.filter((t) => tickersInPortfolio.has(t))
    const isRelevant = hits.length > 0 || (impact.materiality === 'high' && impact.isPolicy)
    if (!isRelevant) continue
    // Keep only medium / high materiality to avoid noise.
    if (impact.materiality === 'low') continue
    out.push({
      date: d,
      headline: item.title,
      source: item.source || '',
      sentiment: impact.sentiment,
      materiality: impact.materiality,
      multipleDeltaPct: impact.multipleDeltaPct,
      affectedTickers: hits.length > 0 ? hits : impact.affectedCompanies,
      link: item.link,
    })
  }
  // Cap to the 40 most material events.
  out.sort((a, b) => {
    if (a.materiality !== b.materiality) return a.materiality === 'high' ? -1 : 1
    return a.date.localeCompare(b.date)
  })
  return out.slice(0, 40).sort((a, b) => a.date.localeCompare(b.date))
}

// ── Main computation ─────────────────────────────────────────

export interface BuildTrendOptions {
  period?: '1yr' | '3yr' | '5yr'
  signal?: AbortSignal
  newsFeed?: Array<{ item: NewsItem; impact: NewsImpact }>
}

export async function buildPortfolioTrend(
  portfolio: Portfolio,
  opts: BuildTrendOptions = {}
): Promise<PortfolioTrend> {
  const period = opts.period ?? '1yr'
  const hydrated: string[] = []
  const fallback: string[] = []

  // Fetch in parallel
  const perHolding: Record<
    string,
    { series: Array<{ date: string; value: number }>; priceAnchor: number; entryCr: number }
  > = {}

  await Promise.all(
    portfolio.holdings.map(async (h) => {
      if (h.kind === 'listed' && h.ticker) {
        const series = await fetchSeriesForHolding(h, period, opts.signal)
        if (series.length >= 2) {
          hydrated.push(h.key)
          perHolding[h.key] = {
            series,
            priceAnchor: series[0].value || 1,
            entryCr: h.entryValueCr || h.snapshot.mktcap || 0,
          }
          return
        }
      }
      // Fallback flat line
      fallback.push(h.key)
      const endDate = new Date().toISOString().slice(0, 10)
      const startDate = shiftDate(endDate, period === '5yr' ? -5 : period === '3yr' ? -3 : -1)
      perHolding[h.key] = {
        series: fallbackSeries(h, startDate, endDate, 14),
        priceAnchor: h.entryValueCr || 1,
        entryCr: h.entryValueCr || h.snapshot.mktcap || 0,
      }
    })
  )

  const weights = normalizedWeights(portfolio)
  const points = blendSeriesV2(perHolding, weights)

  const startDate = points[0]?.date ?? new Date().toISOString().slice(0, 10)
  const endDate = points[points.length - 1]?.date ?? startDate

  // Return + max drawdown
  let totalReturnPct = 0
  let maxDrawdownPct = 0
  if (points.length >= 2) {
    const first = points[0].portfolioValueCr
    const last = points[points.length - 1].portfolioValueCr
    if (first > 0) totalReturnPct = ((last - first) / first) * 100

    let peak = first
    for (const p of points) {
      if (p.portfolioValueCr > peak) peak = p.portfolioValueCr
      if (peak > 0) {
        const dd = ((p.portfolioValueCr - peak) / peak) * 100
        if (dd < maxDrawdownPct) maxDrawdownPct = dd
      }
    }
  }

  const events = opts.newsFeed
    ? extractPortfolioEvents(portfolio, opts.newsFeed, startDate, endDate)
    : []

  return {
    portfolioId: portfolio.id,
    points,
    startDate,
    endDate,
    totalReturnPct,
    maxDrawdownPct,
    hydratedHoldings: hydrated,
    fallbackHoldings: fallback,
    events,
  }
}

function shiftDate(iso: string, years: number): string {
  const d = new Date(iso)
  d.setUTCFullYear(d.getUTCFullYear() + years)
  return d.toISOString().slice(0, 10)
}

// ── Formatting helpers ───────────────────────────────────────

/** Re-export the shared Indian formatter so existing imports keep working. */
export { formatInrCr as fmtCr } from '@/lib/format'

export function fmtPct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}
