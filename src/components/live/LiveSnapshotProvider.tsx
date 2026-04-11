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
  news: RapidApiNewsItem[]
  tickers: Record<string, TickerLive>
  lastRefreshed: Date | null
  /** True whenever any refresh pass is in flight. */
  loading: boolean
  /** True while the per-ticker batch refresh is still running. */
  refreshingCompanies: boolean
  /** "X / Y companies" progress. */
  companyProgress: { done: number; total: number }
  error: string | null
}

interface LiveSnapshotShape extends SnapshotState {
  /** Merge the live per-ticker overrides onto a base Company row. */
  mergeCompany: (co: Company) => Company
  /** Force a full refresh of the commodities + news + per-ticker data. */
  refresh: () => Promise<void>
  /** Manually store one ticker's live profile. */
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
}

/** Max concurrent RapidAPI stock fetches. Keeps us inside quota. */
const COMPANY_BATCH_SIZE = 6

/** localStorage key for the persisted override map so we keep the
 *  freshest snapshot across reloads. Updated on every successful
 *  refresh. TTL is enforced by the timestamp embedded in each record
 *  (see `ALLOW_STALE_HOURS`). */
const STORAGE_KEY = 'sg4_live_tickers'
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

export function LiveSnapshotProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SnapshotState>(() => ({
    ...INITIAL,
    tickers: loadTickerCache(),
    lastRefreshed: null,
  }))
  const abortRef = useRef<AbortController | null>(null)

  /**
   * Refresh commodities + news + every tracked company profile in a
   * single pass. Commodities + news run in parallel with each other;
   * the per-company refresh runs in batches of `COMPANY_BATCH_SIZE`
   * to stay under the RapidAPI rate limit.
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
    }))

    // ── Commodities + News — fire in parallel ──
    const commPromise = commodities({ signal: ctrl.signal, fresh: true }) as Promise<
      StockApiResponse<CommodityRow[] | { commodities?: CommodityRow[] }>
    >
    const newsPromise = rapidapiNews({ signal: ctrl.signal, fresh: true }) as Promise<
      StockApiResponse<RapidApiNewsItem[] | { news?: RapidApiNewsItem[] }>
    >

    // ── Per-company profiles — batched concurrency ──
    const tickerUpdates: Record<string, TickerLive> = {}
    let done = 0
    const failures: string[] = []

    const refreshOne = async (co: Company) => {
      if (ctrl.signal.aborted) return
      try {
        const apiName = tickerToApiName(co.ticker, co.name)
        const res = await stockQuote(apiName, { signal: ctrl.signal, fresh: true })
        if (ctrl.signal.aborted) return
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
          // Throttle state updates to every 3 companies so the
          // progress bar ticks smoothly but we don't thrash React.
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
      while (queue.length > 0 && !ctrl.signal.aborted) {
        const batch = queue.splice(0, COMPANY_BATCH_SIZE)
        await Promise.all(batch.map(refreshOne))
      }
    }

    // Run commodities, news, and companies concurrently.
    const [commRes, newsRes] = await Promise.all([
      commPromise,
      newsPromise,
      runBatches(),
    ]).then((results) => [results[0], results[1]] as const)

    if (ctrl.signal.aborted) return

    // ── Build merged state ──
    const normCommodities = normalizeCommodities(commRes.ok ? commRes.data : [])
    const segImpacts = computeSegmentImpacts(normCommodities)

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

    setState((prev) => {
      const mergedTickers = { ...prev.tickers, ...tickerUpdates }
      // Persist across reloads
      saveTickerCache(mergedTickers)
      const tickerErr =
        Object.keys(tickerUpdates).length === 0 && failures.length > 0
          ? `No company profiles updated · ${failures[0]}`
          : null
      const commErr = !commRes.ok ? commRes.error ?? 'Commodities fetch failed' : null
      return {
        ...prev,
        commodities: normCommodities,
        segmentImpacts: segImpacts,
        news: newsItems,
        tickers: mergedTickers,
        lastRefreshed: new Date(),
        loading: false,
        refreshingCompanies: false,
        companyProgress: { done: COMPANIES.length, total: COMPANIES.length },
        error: tickerErr || commErr,
      }
    })
  }, [])

  // Fire an initial refresh on mount — but only pull commodities + news
  // quickly, and hydrate ticker data from localStorage. The full per-company
  // refresh is expensive, so it only fires when the user clicks Refresh.
  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    setState((prev) => ({ ...prev, loading: true, error: null }))
    Promise.all([
      commodities({ signal: ctrl.signal }) as Promise<
        StockApiResponse<CommodityRow[] | { commodities?: CommodityRow[] }>
      >,
      rapidapiNews({ signal: ctrl.signal }) as Promise<
        StockApiResponse<RapidApiNewsItem[] | { news?: RapidApiNewsItem[] }>
      >,
    ])
      .then(([commRes, newsRes]) => {
        if (cancelled) return
        const normCommodities = normalizeCommodities(commRes.ok ? commRes.data : [])
        const segImpacts = computeSegmentImpacts(normCommodities)
        let newsItems: RapidApiNewsItem[] = []
        if (newsRes.ok && newsRes.data) {
          if (Array.isArray(newsRes.data)) newsItems = newsRes.data
          else if (
            typeof newsRes.data === 'object' &&
            Array.isArray((newsRes.data as { news?: unknown[] }).news)
          ) {
            newsItems = (newsRes.data as { news: RapidApiNewsItem[] }).news
          }
        }
        setState((prev) => ({
          ...prev,
          commodities: normCommodities,
          segmentImpacts: segImpacts,
          news: newsItems,
          lastRefreshed: new Date(),
          loading: false,
          error:
            !commRes.ok && !newsRes.ok
              ? commRes.error || newsRes.error || 'Live fetch failed'
              : null,
        }))
      })
      .catch(() => {
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            loading: false,
            error: 'Network error loading live data',
          }))
        }
      })
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

  const mergeCompany = useCallback(
    (co: Company): Company => {
      const live = state.tickers[co.ticker]
      if (!live) return co
      return {
        ...co,
        mktcap: live.marketCapCr ?? co.mktcap,
        ev: live.evCr ?? co.ev,
        ev_eb: live.evEbitda ?? co.ev_eb,
        pe: live.pe ?? co.pe,
      }
    },
    [state.tickers]
  )

  const value = useMemo<LiveSnapshotShape>(
    () => ({
      ...state,
      mergeCompany,
      refresh,
      setTicker,
    }),
    [state, mergeCompany, refresh, setTicker]
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
