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
  type CommodityRow,
  type StockApiResponse,
} from '@/lib/stocks/api'
import type { TickerLive } from '@/lib/stocks/profile-adapter'
import { deriveLiveMetrics, type DerivedMetrics } from '@/lib/valuation/live-metrics'
import {
  normalizeCommodities,
  computeSegmentImpacts,
  type NormalizedCommodity,
  type SegmentImpactSummary,
} from '@/lib/commodities'
import type { ExchangeRow } from '@/lib/live/nse-fetch'
import type { ScreenerRow } from '@/lib/live/screener-fetch'
import {
  cascadeMerge,
  fieldCoverage,
  isScreenerSlot,
  currentIstHourMinute,
} from '@/lib/live/auto-refresh'

/**
 * Live snapshot context — 3-tier cascading auto-refresh.
 *
 * Tier 1: NSE Direct — every hour, automatic, no admin needed
 * Tier 2: Screener.in — 3×/day at 9am, 12:01pm, 4pm IST, only for gaps
 * Tier 3: RapidAPI — admin-only manual, last resort
 *
 * Commodity refresh: admin-only via refreshCommodities()
 */

interface SnapshotState {
  // Tier 1: NSE Direct
  nseData: Record<string, ExchangeRow>
  nseLastRefreshed: Date | null
  nseRefreshing: boolean
  // Tier 2: Screener
  screenerAutoData: Record<string, ScreenerRow>
  screenerLastRefreshed: Date | null
  screenerRefreshing: boolean
  // Tier 3: RapidAPI (manual admin)
  tickers: Record<string, TickerLive>
  // Commodities (admin-only)
  commodities: NormalizedCommodity[]
  segmentImpacts: SegmentImpactSummary[]
  commodityAsOfDate: string | null
  // DB-added companies (admin discoveries via /api/data/user-companies)
  dbCompanies: Company[]
  // Per-company gaps
  missingFields: Record<string, string[]>
  // General
  lastRefreshed: Date | null
  loading: boolean
  error: string | null
  quotaExhausted: boolean
}

interface LiveSnapshotShape extends SnapshotState {
  mergeCompany: (co: Company) => Company
  deriveCompany: (co: Company) => DerivedMetrics
  /** Admin-only: refresh commodity prices from MCX/NCDEX. */
  refreshCommodities: () => Promise<void>
  /** Admin-only: manual RapidAPI refresh for Tier 3 gaps. */
  refreshRapidApi: () => Promise<void>
  /** All companies: static COMPANIES[] merged with DB-added companies. */
  allCompanies: Company[]
  /** Reload DB-added companies from the server. */
  reloadDbCompanies: () => Promise<void>
  setTicker: (t: TickerLive) => void
}

const LiveSnapshotContext = createContext<LiveSnapshotShape | null>(null)

// ── localStorage helpers ─────────────────────────────────────

const KEY_NSE = 'sg4_nse_auto'
const KEY_NSE_TIME = 'sg4_nse_auto_time'
const KEY_SCREENER_AUTO = 'sg4_screener_auto'
const KEY_SCREENER_AUTO_TIME = 'sg4_screener_auto_time'
const KEY_TICKERS = 'sg4_live_tickers'
const KEY_COMMODITY = 'sg4_commodity_cache'
const KEY_COMMODITY_DATE = 'sg4_commodity_date'

function loadJson<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch { return null }
}

function saveJson(key: string, data: unknown) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(key, JSON.stringify(data)) }
  catch { /* ignore */ }
}

function saveStr(key: string, val: string) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(key, val) }
  catch { /* ignore */ }
}

function loadStr(key: string): string | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage.getItem(key) }
  catch { return null }
}

// ── Provider ─────────────────────────────────────────────────

export function LiveSnapshotProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SnapshotState>(() => {
    const tickers = loadJson<Record<string, TickerLive>>(KEY_TICKERS) ?? {}
    const nseData = loadJson<Record<string, ExchangeRow>>(KEY_NSE) ?? {}
    const screenerAutoData = loadJson<Record<string, ScreenerRow>>(KEY_SCREENER_AUTO) ?? {}
    const commCache = loadJson<NormalizedCommodity[]>(KEY_COMMODITY) ?? []
    const commodityAsOfDate = loadStr(KEY_COMMODITY_DATE)
    return {
      nseData,
      nseLastRefreshed: loadStr(KEY_NSE_TIME) ? new Date(loadStr(KEY_NSE_TIME)!) : null,
      nseRefreshing: false,
      screenerAutoData,
      screenerLastRefreshed: loadStr(KEY_SCREENER_AUTO_TIME)
        ? new Date(loadStr(KEY_SCREENER_AUTO_TIME)!) : null,
      screenerRefreshing: false,
      tickers,
      commodities: commCache,
      segmentImpacts: computeSegmentImpacts(commCache),
      commodityAsOfDate,
      dbCompanies: [],
      missingFields: {},
      lastRefreshed: null,
      loading: false,
      error: null,
      quotaExhausted: false,
    }
  })
  const abortRef = useRef<AbortController | null>(null)

  // ── Load DB-added companies on mount ───────────────────────

  const reloadDbCompanies = useCallback(async () => {
    try {
      const res = await fetch('/api/data/user-companies')
      const json = await res.json()
      if (json.ok && Array.isArray(json.companies)) {
        setState((prev) => ({ ...prev, dbCompanies: json.companies }))
      }
    } catch { /* ignore on mount */ }
  }, [])

  useEffect(() => {
    reloadDbCompanies()
  }, [reloadDbCompanies])

  // ── All companies: static + DB-added, deduped by ticker ────

  const allCompanies = useMemo<Company[]>(() => {
    const staticTickers = new Set(COMPANIES.map((c) => c.ticker))
    const fromDb = state.dbCompanies.filter((c) => !staticTickers.has(c.ticker))
    return [...COMPANIES, ...fromDb]
  }, [state.dbCompanies])

  // ── Tier 1: NSE auto-refresh ───────────────────────────────

  const autoRefreshNse = useCallback(async () => {
    setState((prev) => ({ ...prev, nseRefreshing: true }))
    try {
      const res = await fetch('/api/data/nse-quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (json.ok && json.data) {
        const now = new Date()
        saveJson(KEY_NSE, json.data)
        saveStr(KEY_NSE_TIME, now.toISOString())
        setState((prev) => ({
          ...prev,
          nseData: json.data,
          nseLastRefreshed: now,
          nseRefreshing: false,
          lastRefreshed: now,
        }))
      } else {
        setState((prev) => ({ ...prev, nseRefreshing: false }))
      }
    } catch {
      setState((prev) => ({ ...prev, nseRefreshing: false }))
    }
  }, [])

  // ── Tier 2: Screener gap-fill ──────────────────────────────

  const autoRefreshScreener = useCallback(async () => {
    // Find companies with gaps after Tier 1
    const gapTickers: string[] = []
    for (const co of COMPANIES) {
      const coverage = fieldCoverage(co, state.nseData[co.ticker], null)
      if (!coverage.tier1Filled || coverage.missing.length > 0) {
        gapTickers.push(co.ticker)
      }
    }
    // Also fetch screener for ALL companies where we don't have screener data for rev/ebitda
    for (const co of COMPANIES) {
      if (!state.screenerAutoData[co.ticker] && !gapTickers.includes(co.ticker)) {
        gapTickers.push(co.ticker)
      }
    }
    if (gapTickers.length === 0) return

    setState((prev) => ({ ...prev, screenerRefreshing: true }))
    try {
      // Batch into groups of 20 (API limit)
      const merged: Record<string, ScreenerRow> = {}
      for (let i = 0; i < gapTickers.length; i += 20) {
        const batch = gapTickers.slice(i, i + 20)
        const res = await fetch('/api/data/screener-fill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers: batch }),
        })
        const json = await res.json()
        if (json.ok && json.data) {
          Object.assign(merged, json.data)
        }
      }
      const now = new Date()
      setState((prev) => {
        const combined = { ...prev.screenerAutoData, ...merged }
        saveJson(KEY_SCREENER_AUTO, combined)
        saveStr(KEY_SCREENER_AUTO_TIME, now.toISOString())
        return {
          ...prev,
          screenerAutoData: combined,
          screenerLastRefreshed: now,
          screenerRefreshing: false,
        }
      })
    } catch {
      setState((prev) => ({ ...prev, screenerRefreshing: false }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.nseData, state.screenerAutoData])

  // ── Tier 3: Admin-only RapidAPI refresh ────────────────────

  const refreshRapidApi = useCallback(async () => {
    // This stays as the existing company profile batch refresh
    // Only admin should trigger this from the Data Sources tab
    setState((prev) => ({ ...prev, loading: true, error: null }))
    const { stockQuote, tickerToApiName } = await import('@/lib/stocks/api')
    const { adaptStockProfile } = await import('@/lib/stocks/profile-adapter')
    const updates: Record<string, TickerLive> = {}
    for (let i = 0; i < COMPANIES.length; i += 6) {
      const batch = COMPANIES.slice(i, i + 6)
      await Promise.all(
        batch.map(async (co) => {
          try {
            const name = tickerToApiName(co.ticker, co.name)
            const res = await stockQuote(name, { fresh: true })
            if (res.ok && res.data) {
              updates[co.ticker] = adaptStockProfile(co.ticker, res.data as import('@/lib/stocks/api').StockProfile)
            }
          } catch { /* ignore */ }
        })
      )
    }
    setState((prev) => {
      const merged = { ...prev.tickers, ...updates }
      saveJson(KEY_TICKERS, merged)
      return {
        ...prev,
        tickers: merged,
        loading: false,
        lastRefreshed: new Date(),
      }
    })
  }, [])

  // ── Admin-only: commodity refresh ──────────────────────────

  const refreshCommodities = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true }))
    try {
      const res = await commodities({ fresh: true }) as
        StockApiResponse<CommodityRow[] | { commodities?: CommodityRow[] }>
      if (!res.ok) {
        setState((prev) => ({
          ...prev, loading: false,
          error: res.error ?? 'Commodity fetch failed',
          quotaExhausted: !!res.quotaExhausted,
        }))
        return
      }
      const norm = normalizeCommodities(res.data)
      const impacts = computeSegmentImpacts(norm)
      const asOf = new Date().toLocaleDateString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
      })
      saveJson(KEY_COMMODITY, norm)
      saveStr(KEY_COMMODITY_DATE, asOf)
      setState((prev) => ({
        ...prev,
        commodities: norm,
        segmentImpacts: impacts,
        commodityAsOfDate: asOf,
        loading: false,
      }))
    } catch (err) {
      setState((prev) => ({
        ...prev, loading: false,
        error: err instanceof Error ? err.message : 'Network error',
      }))
    }
  }, [])

  // ── Auto-refresh scheduling ────────────────────────────────

  useEffect(() => {
    // Tier 1: NSE — fire immediately if stale (>1 hour), then every hour
    const nseStale = !state.nseLastRefreshed ||
      (Date.now() - state.nseLastRefreshed.getTime()) > 60 * 60 * 1000
    if (nseStale) autoRefreshNse()

    const nseInterval = setInterval(autoRefreshNse, 60 * 60 * 1000)

    // Tier 2: Screener — check every 60s if we're in a slot
    let lastScreenerSlotKey = ''
    const screenerCheck = setInterval(() => {
      const { hour, minute } = currentIstHourMinute()
      const slotKey = `${hour}:${minute}`
      if (isScreenerSlot(hour, minute) && slotKey !== lastScreenerSlotKey) {
        lastScreenerSlotKey = slotKey
        autoRefreshScreener()
      }
    }, 60 * 1000)

    return () => {
      clearInterval(nseInterval)
      clearInterval(screenerCheck)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Compute missing fields ─────────────────────────────────

  const missingFields = useMemo(() => {
    const result: Record<string, string[]> = {}
    for (const co of COMPANIES) {
      const cov = fieldCoverage(co, state.nseData[co.ticker], state.screenerAutoData[co.ticker])
      if (cov.missing.length > 0) {
        result[co.ticker] = cov.missing
      }
    }
    return result
  }, [state.nseData, state.screenerAutoData])

  // ── Cascade merge for every company ────────────────────────

  const deriveCompany = useCallback(
    (co: Company): DerivedMetrics => {
      // Step 1: NSE + Screener cascade
      const merged = cascadeMerge(co, state.nseData[co.ticker], state.screenerAutoData[co.ticker])
      // Step 2: RapidAPI overlay (Tier 3, if admin has refreshed)
      const live = state.tickers[co.ticker]
      return deriveLiveMetrics(merged, live)
    },
    [state.tickers, state.nseData, state.screenerAutoData]
  )

  const mergeCompany = useCallback(
    (co: Company): Company => deriveCompany(co).company,
    [deriveCompany]
  )

  const setTicker = useCallback((t: TickerLive) => {
    setState((prev) => {
      const next = { ...prev.tickers, [t.ticker]: t }
      saveJson(KEY_TICKERS, next)
      return { ...prev, tickers: next }
    })
  }, [])

  const value = useMemo<LiveSnapshotShape>(
    () => ({
      ...state,
      missingFields,
      mergeCompany,
      deriveCompany,
      refreshCommodities,
      refreshRapidApi,
      allCompanies,
      reloadDbCompanies,
      setTicker,
    }),
    [state, missingFields, mergeCompany, deriveCompany, refreshCommodities, refreshRapidApi, allCompanies, reloadDbCompanies, setTicker]
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
