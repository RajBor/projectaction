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
import { COMPANIES } from '@/lib/data/companies'
import type { Company } from '@/lib/data/companies'
import {
  fetchNews,
  decorateNews,
  dedupe,
  sortByDate,
  DOMAIN_QUERIES,
  type NewsItem,
} from '@/lib/news/api'
import {
  aggregateImpactByCompany,
  type CompanyNewsAggregate,
  type NewsImpact,
} from '@/lib/news/impact'
import {
  computeAdjustedMetrics,
  type CompanyAdjustedMetrics,
} from '@/lib/news/adjustments'
import { useNewsAck } from './NewsAckProvider'

/**
 * Central news data store. Fetches the union of all domain queries ONCE
 * on mount, dedupes, decorates with impact metadata, and shares a
 * per-company aggregate + pre/post adjusted metrics with every page.
 *
 * Every page that previously called `fetchNews()` can now call
 * `useNewsData()` and skip the network round trip.
 */

interface NewsDataContextShape {
  items: Array<{ item: NewsItem; impact: NewsImpact }>
  loading: boolean
  error: string | null
  lastRefresh: Date | null
  cached: boolean
  aggregates: Record<string, CompanyNewsAggregate>
  /** Convenience — per-company pre/post metrics snapshot. */
  getAdjusted: (co: Company) => CompanyAdjustedMetrics
  /** Force refresh with fresh=1. */
  refresh: (fresh?: boolean) => Promise<void>
}

const NewsDataContext = createContext<NewsDataContextShape | null>(null)

// Broad domain queries — kept in a stable order so the dedupe chain
// is deterministic.
const DOMAIN_QUERY_LIST = [
  DOMAIN_QUERIES.solar_value_chain,
  DOMAIN_QUERIES.td_infrastructure,
  DOMAIN_QUERIES.ma_investment,
  DOMAIN_QUERIES.financial_results,
  DOMAIN_QUERIES.policy_regulation,
]

export function NewsDataProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<Array<{ item: NewsItem; impact: NewsImpact }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [cached, setCached] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const {
    isAcknowledged,
    getManualOverride,
    isParamDisabled,
    acknowledged: ackMap,
  } = useNewsAck()

  const aggregates = useMemo(
    () =>
      aggregateImpactByCompany(items, {
        isAcknowledged,
        getManualOverride,
        isParamDisabled,
      }),
    // ackMap is included so the memo invalidates when manual overrides,
    // disabled params, or acknowledgments change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, isAcknowledged, getManualOverride, isParamDisabled, ackMap]
  )

  const getAdjusted = useCallback(
    (co: Company) => computeAdjustedMetrics(co, aggregates[co.ticker]),
    [aggregates]
  )

  const refresh = useCallback(async (fresh = false) => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    setError(null)
    const results = await Promise.all(
      DOMAIN_QUERY_LIST.map((q) =>
        fetchNews({ q, limit: 30, fresh, signal: ctrl.signal })
      )
    )
    if (ctrl.signal.aborted) return

    const all: NewsItem[] = []
    const errs: string[] = []
    let anyCached = false
    for (const res of results) {
      if (res.ok && res.data) {
        all.push(...res.data)
        if (res.cached) anyCached = true
      } else if (res.error) {
        errs.push(res.error)
      }
    }

    if (all.length === 0 && errs.length) {
      setError(errs[0])
      setLoading(false)
      return
    }

    const decorated = sortByDate(dedupe(decorateNews(all, COMPANIES)))
    setItems(decorated)
    setCached(anyCached)
    setLastRefresh(new Date())
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh(false)
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [refresh])

  const value = useMemo<NewsDataContextShape>(
    () => ({
      items,
      loading,
      error,
      lastRefresh,
      cached,
      aggregates,
      getAdjusted,
      refresh,
    }),
    [items, loading, error, lastRefresh, cached, aggregates, getAdjusted, refresh]
  )

  return <NewsDataContext.Provider value={value}>{children}</NewsDataContext.Provider>
}

export function useNewsData(): NewsDataContextShape {
  const ctx = useContext(NewsDataContext)
  if (!ctx) {
    throw new Error('useNewsData must be used inside <NewsDataProvider>')
  }
  return ctx
}
