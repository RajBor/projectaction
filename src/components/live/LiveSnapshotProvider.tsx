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
import type { Company } from '@/lib/data/companies'
import {
  commodities,
  rapidapiNews,
  type CommodityRow,
  type RapidApiNewsItem,
  type StockApiResponse,
} from '@/lib/stocks/api'
import {
  normalizeCommodities,
  computeSegmentImpacts,
  type NormalizedCommodity,
  type SegmentImpactSummary,
} from '@/lib/commodities'

/**
 * Live snapshot context.
 *
 * Holds the freshest RapidAPI data we've been able to pull for the
 * Indian markets: commodities, per-ticker profile overrides, news
 * items. Pages subscribe via `useLiveSnapshot()` and can trigger a
 * hard refresh via `refresh()`, or read the last-refreshed timestamp
 * to power a refresh button.
 *
 * The context is mounted globally inside `Providers` so every page
 * sees the same data without re-hitting the API. Pages that care
 * about one slice (e.g. just commodities) destructure only what
 * they need.
 */

interface TickerLive {
  ticker: string
  lastPrice?: number
  changePct?: number
  marketCapCr?: number
  evEbitda?: number
  pe?: number
  updatedAt: string
}

interface SnapshotState {
  commodities: NormalizedCommodity[]
  segmentImpacts: SegmentImpactSummary[]
  news: RapidApiNewsItem[]
  tickers: Record<string, TickerLive>
  lastRefreshed: Date | null
  loading: boolean
  error: string | null
}

interface LiveSnapshotShape extends SnapshotState {
  /** Merge the live per-ticker overrides onto a base Company row. */
  mergeCompany: (co: Company) => Company
  /** Force a full refresh of the commodities + news + snapshot data. */
  refresh: () => Promise<void>
  /** Store a single ticker's live profile (called from stock drill-downs). */
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
  error: null,
}

export function LiveSnapshotProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SnapshotState>(INITIAL)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setState((prev) => ({ ...prev, loading: true, error: null }))

    try {
      const [commRes, newsRes] = (await Promise.all([
        commodities({ signal: ctrl.signal, fresh: true }),
        rapidapiNews({ signal: ctrl.signal, fresh: true }),
      ])) as [
        StockApiResponse<CommodityRow[] | { commodities?: CommodityRow[] }>,
        StockApiResponse<RapidApiNewsItem[] | { news?: RapidApiNewsItem[] }>,
      ]
      if (ctrl.signal.aborted) return

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
    } catch (err) {
      if (ctrl.signal.aborted) return
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Network error',
      }))
    }
  }, [])

  // Fire an initial refresh on mount so data lands without a click.
  useEffect(() => {
    refresh()
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [refresh])

  const setTicker = useCallback((t: TickerLive) => {
    setState((prev) => ({
      ...prev,
      tickers: { ...prev.tickers, [t.ticker]: t },
    }))
  }, [])

  const mergeCompany = useCallback(
    (co: Company): Company => {
      const live = state.tickers[co.ticker]
      if (!live) return co
      return {
        ...co,
        mktcap: live.marketCapCr ?? co.mktcap,
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
