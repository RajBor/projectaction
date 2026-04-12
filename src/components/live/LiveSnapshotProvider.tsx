'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { COMPANIES, type Company } from '@/lib/data/companies'
import {
  commodities,
  rapidapiNews,
  stockQuote,
  tickerToApiName,
  type CommodityRow,
  type RapidApiNewsItem,
  type StockApiResponse,
  type StockProfile,
} from '@/lib/stocks/api'
import {
  adaptStockProfile,
  type TickerLive,
} from '@/lib/stocks/profile-adapter'
import { deriveLiveMetrics, type DerivedMetrics } from '@/lib/valuation/live-metrics'
import {
  normalizeCommodities,
  computeSegmentImpacts,
  type NormalizedCommodity,
  type SegmentImpactSummary,
} from '@/lib/commodities'

/**
 * Live snapshot context.
 *
 * Holds the freshest RapidAPI data we've been able to pull:
 *   - commodities + segment impacts (cheap, 1 call)
 *   - news (1 call)
 *   - per-ticker profile overrides (one call per Company, capped
 *     concurrency so we don't hammer the RapidAPI quota)
 *
 * Pages subscribe via `useLiveSnapshot()` and can trigger a full
 * refresh via `refresh()`. Every page that displays a Company row
 * should call `mergeCompany(co)` so live overrides flow through
 * automatically.
 */

interface SnapshotState {
  commodities: NormalizedCommodity[]
  segmentImpacts: SegmentImpactSummary[]
  /** Date string (DD MMM YYYY) showing when commodity prices were fetched.
   *  Only set by admin via refreshCommodities(). */
  commodityAsOfDate: string | null
  news: RapidApiNewsItem[]
  tickers: Record<string, TickerLive>
  lastRefreshed: Date | null
  loading: boolean
  refreshingCompanies: boolean
  companyProgress: { done: number; total: number }
  error: string | null
  quotaExhausted: boolean
}

interface LiveSnapshotShape extends SnapshotState {
  mergeCompany: (co: Company) => Company
  deriveCompany: (co: Company) => DerivedMetrics
  /** Refresh company profiles + news only. Any logged-in user can call. */
  refresh: () => Promise<void>
  /** Refresh commodity prices. ADMIN-ONLY — only called from the admin
   *  Data Sources tab. Updates commodityAsOfDate. */
  refreshCommodities: () => Promise<void>
  setTicker: (t: TickerLive) => void
}

const LiveSnapshotContext = createContext<LiveSnapshotShape | null>(null)

const INITIAL: SnapshotState = {
  commodities: [],
  segmentImpacts: [],
  news: [],
  tickers: {},
  lastRefreshed: null,
  loading: false,
  refreshingCompanies: false,
  companyProgress: { done: 0, total: 0 },
  error: null,
  quotaExhausted: false,
  commodityAsOfDate: null,
}

const COMPANY_BATCH_SIZE = 6
const STORAGE_KEY = 'sg4_live_tickers'
const STORAGE_COMMODITY = 'sg4_commodity_cache'
const STORAGE_COMMODITY_DATE = 'sg4_commodity_date'
const ALLOW_STALE_HOURS = 24

function loadTickerCache(): Record<string, TickerLive> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, TickerLive>
    if (!parsed || typeof parsed !== 'object') return {}
    // Drop entries older than ALLOW_STALE_HOURS so we don't persist
    // stale data forever after a long weekend.
    const cutoff = Date.now() - ALLOW_STALE_HOURS * 3600 * 1000
    const out: Record<string, TickerLive> = {}
    for (const [k, v] of Object.entries(parsed)) {
      const t = Date.parse(v?.updatedAt || '')
      if (Number.isFinite(t) && t >= cutoff) out[k] = v
    }
    return out
  } catch {
    return {}
  }
}

function saveTickerCache(map: Record<string, TickerLive>) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* quota full — ignore */
  }
}

/** Load cached commodity data from localStorage so page load
 *  does NOT hit RapidAPI. Only an admin-triggered refresh updates this. */
function loadCommodityCache(): {
  commodities: NormalizedCommodity[]
  segmentImpacts: SegmentImpactSummary[]
  asOfDate: string | null
} {
  if (typeof window === 'undefined') return { commodities: [], segmentImpacts: [], asOfDate: null }
  try {
    const raw = window.localStorage.getItem(STORAGE_COMMODITY)
    const date = window.localStorage.getItem(STORAGE_COMMODITY_DATE) || null
    if (!raw) return { commodities: [], segmentImpacts: [], asOfDate: date }
    const commodities = JSON.parse(raw) as NormalizedCommodity[]
    const segmentImpacts = computeSegmentImpacts(commodities)
    return { commodities, segmentImpacts, asOfDate: date }
  } catch {
    return { commodities: [], segmentImpacts: [], asOfDate: null }
  }
}

function saveCommodityCache(commodities: NormalizedCommodity[], asOfDate: string) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_COMMODITY, JSON.stringify(commodities))
    window.localStorage.setItem(STORAGE_COMMODITY_DATE, asOfDate)
  } catch { /* ignore */ }
}

export function LiveSnapshotProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SnapshotState>(() => {
    const tickers = loadTickerCache()
    const { commodities: cachedCommodities, segmentImpacts, asOfDate } = loadCommodityCache()
    return {
      ...INITIAL,
      tickers,
      commodities: cachedCommodities,
      segmentImpacts,
      commodityAsOfDate: asOfDate,
    }
  })
  const abortRef = useRef<AbortController | null>(null)

  /**
   * Refresh company profiles + news only. Does NOT touch commodity
   * data — that is admin-only via refreshCommodities().
   * Any logged-in user can trigger this.
   */
  const refresh = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setState((prev) => ({
      ...prev,
      loading: true,
      refreshingCompanies: true,
      companyProgress: { done: 0, total: COMPANIES.length },
      error: null,
      quotaExhausted: false,
    }))

    // ── News only — no commodities (admin-only) ──
    const newsPromise = rapidapiNews({ signal: ctrl.signal, fresh: true }) as Promise<
      StockApiResponse<RapidApiNewsItem[] | { news?: RapidApiNewsItem[] }>
    >

    // ── Per-company profiles — batched concurrency ──
    const tickerUpdates: Record<string, TickerLive> = {}
    let done = 0
    const failures: string[] = []
    // When true, we short-circuit the remaining batches: the upstream
    // has confirmed the plan quota is exhausted, so every subsequent
    // call would just burn latency and return the same 429.
    let quotaTripped = false

    const refreshOne = async (co: Company) => {
      if (ctrl.signal.aborted || quotaTripped) return
      try {
        const apiName = tickerToApiName(co.ticker, co.name)
        const res = await stockQuote(apiName, { signal: ctrl.signal, fresh: true })
        if (ctrl.signal.aborted) return
        if (res.quotaExhausted) {
          quotaTripped = true
          failures.push(`${co.ticker}: ${res.error}`)
          return
        }
        if (res.ok && res.data) {
          const live = adaptStockProfile(co.ticker, res.data as StockProfile)
          tickerUpdates[co.ticker] = live
        } else if (res.error) {
          failures.push(`${co.ticker}: ${res.error}`)
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          failures.push(
            `${co.ticker}: ${err instanceof Error ? err.message : 'fetch failed'}`
          )
        }
      } finally {
        if (!ctrl.signal.aborted) {
          done++
          if (done % 3 === 0 || done === COMPANIES.length) {
            setState((prev) => ({
              ...prev,
              companyProgress: { done, total: COMPANIES.length },
            }))
          }
        }
      }
    }

    const runBatches = async () => {
      const queue = [...COMPANIES]
      while (queue.length > 0 && !ctrl.signal.aborted && !quotaTripped) {
        const batch = queue.splice(0, COMPANY_BATCH_SIZE)
        await Promise.all(batch.map(refreshOne))
      }
    }

    // Run news + companies concurrently. No commodities here.
    const [newsRes] = await Promise.all([
      newsPromise,
      runBatches(),
    ]).then((results) => [results[0]] as const)

    if (ctrl.signal.aborted) return

    let newsItems: RapidApiNewsItem[] = []
    if (newsRes.ok && newsRes.data) {
      if (Array.isArray(newsRes.data)) {
        newsItems = newsRes.data
      } else if (
        typeof newsRes.data === 'object' &&
        Array.isArray((newsRes.data as { news?: unknown[] }).news)
      ) {
        newsItems = (newsRes.data as { news: RapidApiNewsItem[] }).news
      }
    }

    const quotaSeen = quotaTripped || !!newsRes.quotaExhausted

    setState((prev) => {
      const mergedTickers = { ...prev.tickers, ...tickerUpdates }
      saveTickerCache(mergedTickers)
      const tickerErr =
        Object.keys(tickerUpdates).length === 0 && failures.length > 0
          ? `No company profiles updated · ${failures[0]}`
          : null
      return {
        ...prev,
        // Commodities are NOT updated here — admin only
        news: newsItems,
        tickers: mergedTickers,
        lastRefreshed: new Date(),
        loading: false,
        refreshingCompanies: false,
        companyProgress: { done: COMPANIES.length, total: COMPANIES.length },
        error: tickerErr,
        quotaExhausted: quotaSeen,
      }
    })
  }, [])

  /**
   * Refresh commodity prices. ADMIN-ONLY — only called from the admin
   * Data Sources tab. Sets commodityAsOfDate and persists to localStorage.
   */
  const refreshCommodities = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }))
    try {
      const res = await commodities({ fresh: true }) as
        StockApiResponse<CommodityRow[] | { commodities?: CommodityRow[] }>
      if (!res.ok) {
        setState((prev) => ({
          ...prev,
          loading: false,
          error: res.error ?? 'Commodity fetch failed',
          quotaExhausted: !!res.quotaExhausted,
        }))
        return
      }
      const normCommodities = normalizeCommodities(res.data)
      const segImpacts = computeSegmentImpacts(normCommodities)
      const asOf = new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
      saveCommodityCache(normCommodities, asOf)
      setState((prev) => ({
        ...prev,
        commodities: normCommodities,
        segmentImpacts: segImpacts,
        commodityAsOfDate: asOf,
        loading: false,
      }))
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Network error',
      }))
    }
  }, [])

  // On mount: hydrate ticker + commodity data from localStorage ONLY.
  // No RapidAPI calls on page load. News is fetched (lightweight, no
  // quota impact) so the news hub has data. Commodities are admin-only.
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    // Fetch only news on mount — lightweight, no quota risk
    rapidapiNews({ signal: ctrl.signal })
      .then((newsRes) => {
        if (cancelled) return
        const r = newsRes as StockApiResponse<RapidApiNewsItem[] | { news?: RapidApiNewsItem[] }>
        let newsItems: RapidApiNewsItem[] = []
        if (r.ok && r.data) {
          if (Array.isArray(r.data)) newsItems = r.data
          else if (
            typeof r.data === 'object' &&
            Array.isArray((r.data as { news?: unknown[] }).news)
          ) {
            newsItems = (r.data as { news: RapidApiNewsItem[] }).news
          }
        }
        setState((prev) => ({ ...prev, news: newsItems }))
      })
      .catch(() => { /* ignore */ })
    return () => {
      cancelled = true
      ctrl.abort()
    }
  }, [])

  const setTicker = useCallback((t: TickerLive) => {
    setState((prev) => {
      const next = { ...prev.tickers, [t.ticker]: t }
      saveTickerCache(next)
      return { ...prev, tickers: next }
    })
  }, [])

  // Use the unit-safe live-metrics derivation so every downstream
  // consumer (tables, popups, valuation methods, reports) agrees on
  // one formula. This is the ONLY place COMPANIES[] + TickerLive get
  // blended — the old "overlay each API field" path was producing
  // broken EV numbers when the upstream netDebt field came in a
  // different unit per company.
  const deriveCompany = useCallback(
    (co: Company): DerivedMetrics => {
      const live = state.tickers[co.ticker]
      return deriveLiveMetrics(co, live)
    },
    [state.tickers]
  )

  const mergeCompany = useCallback(
    (co: Company): Company => deriveCompany(co).company,
    [deriveCompany]
  )

  const value = useMemo<LiveSnapshotShape>(
    () => ({
      ...state,
      mergeCompany,
      deriveCompany,
      refresh,
      refreshCommodities,
      setTicker,
    }),
    [state, mergeCompany, deriveCompany, refresh, refreshCommodities, setTicker]
  )

  return (
    <LiveSnapshotContext.Provider value={value}>{children}</LiveSnapshotContext.Provider>
  )
}

export function useLiveSnapshot(): LiveSnapshotShape {
  const ctx = useContext(LiveSnapshotContext)
  if (!ctx) {
    throw new Error('useLiveSnapshot must be used inside <LiveSnapshotProvider>')
  }
  return ctx
}
