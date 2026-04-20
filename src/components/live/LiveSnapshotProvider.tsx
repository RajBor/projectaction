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
  // Atlas-only companies (from industry_chain_companies) that aren't
  // yet in static COMPANIES[] or user_companies. Loaded via
  // /api/data/atlas-tickers. Carries zero baselines — designed to be
  // filled by live NSE / Screener refreshes and eventually promoted
  // into user_companies via a push. Without this, the admin-visible
  // universe was stuck at ~114 when the atlas had ~180 more tickers.
  atlasCompanies: Company[]
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
  /**
   * Patch a single NSE row into the live snapshot. Used by the admin
   * "Edit NSE Symbol" flow so that once a broken symbol is corrected,
   * the admin table reflects the newly-fetched row immediately without
   * waiting for the next hourly tick and without re-fetching the
   * entire 85-company batch.
   */
  patchNseRow: (ticker: string, row: ExchangeRow) => void
  /**
   * Merge many NSE rows into state.nseData in a single state update —
   * used by the admin manual sweep so coverage counters (NSE: N/M)
   * reflect the sweep's progress in real time instead of staying
   * stuck on the last hourly cron's count.
   */
  patchNseBatch: (rows: Record<string, ExchangeRow>) => void
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
      atlasCompanies: [],
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
    // Fetch both payloads in parallel. We also re-fetch atlas-tickers
    // because the admin can add new atlas rows (Industries tab) at any
    // time, and a data-push event is how we learn about it client-side.
    try {
      const [dbRes, atlasRes] = await Promise.all([
        fetch('/api/data/user-companies').then((r) => r.json()).catch(() => null),
        fetch('/api/data/atlas-tickers').then((r) => r.json()).catch(() => null),
      ])
      setState((prev) => ({
        ...prev,
        dbCompanies: dbRes?.ok && Array.isArray(dbRes.companies) ? dbRes.companies : prev.dbCompanies,
        atlasCompanies: atlasRes?.ok && Array.isArray(atlasRes.companies) ? atlasRes.companies : prev.atlasCompanies,
      }))
    } catch { /* ignore on mount */ }
  }, [])

  useEffect(() => {
    reloadDbCompanies()
  }, [reloadDbCompanies])

  // ── Cross-page / cross-tab refresh on admin push ──────────
  //
  // When the admin publishes data from the admin page, we fire a
  // `sg4:data-pushed` window event. Every page that consumes
  // allCompanies re-reads user_companies when the event fires, so
  // the new row shows up on Dashboard / M&A Radar / Valuation /
  // Watchlist / Compare without a page reload.
  //
  // We also listen to the `storage` event for the
  // `sg4_data_pushed_at` key so cross-tab pushes propagate too
  // (admin pushes in Tab A, analyst's Tab B refreshes).
  useEffect(() => {
    const handler = () => { reloadDbCompanies() }
    const storageHandler = (e: StorageEvent) => {
      if (e.key === 'sg4_data_pushed_at') reloadDbCompanies()
    }
    window.addEventListener('sg4:data-pushed', handler)
    window.addEventListener('storage', storageHandler)
    return () => {
      window.removeEventListener('sg4:data-pushed', handler)
      window.removeEventListener('storage', storageHandler)
    }
  }, [reloadDbCompanies])

  // ── All companies: three-tier union (DB > static > atlas) ──
  //
  // Precedence matches `@/lib/live/company-pool` on the server:
  //   1. user_companies (admin-curated, freshest)
  //   2. static COMPANIES[] (hand-researched baselines)
  //   3. industry_chain_companies (atlas seed — zero baselines, filled
  //      by live scrapers over time)
  //
  // Previously only (1) + (2) were merged, which capped the dashboard
  // / valuation / M&A radar at ~114 tickers even though the atlas held
  // another ~180 listed SME / subsidiary rows. Atlas rows are appended
  // last and deduped against everything above so a ticker never
  // appears twice.
  //
  // The DB row carries `_baselineUpdatedAt` + `_baselineSource` so
  // admin UI can show "refreshed from Screener 2m ago" badges. Atlas
  // rows carry `_atlasIndustry` / `_atlasStage` for provenance.

  const allCompanies = useMemo<Company[]>(() => {
    const dbByTicker = new Map<string, Company>()
    for (const c of state.dbCompanies) dbByTicker.set(c.ticker, c)
    // Static companies: override from DB where present, else keep static.
    // When a DB row exists but its mktcap / ev has drifted > 5× or < 0.2×
    // from the curated static baseline, fall back to the static row for
    // those absolute fields (merge in the DB-side P&L and structural
    // fields though — they're independently calibrated from Screener
    // and not subject to the ticker-mismatch failure mode).
    //
    // Why this exists: the cascadeMerge clamp added in [auto-refresh.ts]
    // protects future writes from NSE / Screener. But rows corrupted
    // BEFORE the clamp landed are already persisted in user_companies
    // and would otherwise keep overriding the static baseline.
    // Example: LEGRAND (Legrand India, unlisted) — NSE resolved the
    // ticker to a shadow listing, mktcap got written as ₹15 Cr,
    // and the op-identifier estimated deal size at ₹19 Cr even after
    // the intake clamp was added. This merge-side clamp heals those
    // rows in-place without needing a DB migration.
    const sanityRatio = (live: number, baseline: number): boolean => {
      if (!Number.isFinite(live) || live <= 0) return false
      if (!Number.isFinite(baseline) || baseline <= 0) return true
      const r = live / baseline
      return r >= 0.2 && r <= 5
    }
    const merged: Company[] = COMPANIES.map((stat) => {
      const db = dbByTicker.get(stat.ticker)
      if (!db) return stat
      const mktcapOk = sanityRatio(db.mktcap, stat.mktcap)
      const evOk = sanityRatio(db.ev, stat.ev)
      if (mktcapOk && evOk) return db
      // Heal the drifted absolute fields; keep DB-side signals that are
      // independent of the mktcap-scale bug (ratios, P&L fields, ROCE).
      return {
        ...db,
        mktcap: mktcapOk ? db.mktcap : stat.mktcap,
        ev: evOk ? db.ev : stat.ev,
        ev_eb: evOk ? db.ev_eb : stat.ev_eb,
      }
    })
    // Append DB-only companies (discovered via admin that aren't in the
    // static seed list) preserving insertion order.
    const staticTickers = new Set(COMPANIES.map((c) => c.ticker))
    for (const c of state.dbCompanies) {
      if (!staticTickers.has(c.ticker)) merged.push(c)
    }
    // Append atlas-only companies (present in industry_chain_companies
    // but not yet in the DB or static seed). Dedup against everything
    // above — the server already filters these out, but we belt-and-
    // brace in case the client gets stale caches during a push.
    const seen = new Set<string>(merged.map((c) => c.ticker))
    for (const c of state.atlasCompanies) {
      if (seen.has(c.ticker)) continue
      merged.push(c)
      seen.add(c.ticker)
    }
    return merged
  }, [state.dbCompanies, state.atlasCompanies])

  // Ref mirror of allCompanies so the refresh callbacks (which are
  // memoised once and scheduled via setInterval) can always see the
  // latest universe without re-subscribing every time dbCompanies
  // changes. Without this, admin-added rows appear in the UI but are
  // silently skipped by the next auto-refresh tick.
  const allCompaniesRef = useRef<Company[]>(allCompanies)
  useEffect(() => { allCompaniesRef.current = allCompanies }, [allCompanies])

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
    // Find companies with gaps after Tier 1. Use the live allCompanies
    // universe (static seed ∪ user_companies) so admin-discovered SME /
    // added tickers are also gap-filled — without this the status bar's
    // "Screener: X/Y" can never reach parity with the true total.
    const universe = allCompaniesRef.current
    const gapTickers: string[] = []
    for (const co of universe) {
      const coverage = fieldCoverage(co, state.nseData[co.ticker], null)
      if (!coverage.tier1Filled || coverage.missing.length > 0) {
        gapTickers.push(co.ticker)
      }
    }
    // Also fetch screener for ALL companies where we don't have screener data for rev/ebitda
    for (const co of universe) {
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
    // Admin-only Tier-3 refresh. Iterates the full live universe
    // (static seed ∪ user_companies) so admin-added rows get RapidAPI
    // cached alongside seed tickers; otherwise the "RapidAPI: N cached"
    // status bar stays pinned at 85 even after adding more companies.
    setState((prev) => ({ ...prev, loading: true, error: null }))
    const { stockQuote, tickerToApiName } = await import('@/lib/stocks/api')
    const { adaptStockProfile } = await import('@/lib/stocks/profile-adapter')
    const universe = allCompaniesRef.current
    const updates: Record<string, TickerLive> = {}
    for (let i = 0; i < universe.length; i += 6) {
      const batch = universe.slice(i, i + 6)
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
    // Compute gaps across the full live universe (static ∪ user_companies)
    // so the admin "⚠ N companies have missing fields" counter reflects
    // every company the platform knows about, not just the seed list.
    const result: Record<string, string[]> = {}
    for (const co of allCompanies) {
      const cov = fieldCoverage(co, state.nseData[co.ticker], state.screenerAutoData[co.ticker])
      if (cov.missing.length > 0) {
        result[co.ticker] = cov.missing
      }
    }
    return result
  }, [allCompanies, state.nseData, state.screenerAutoData])

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

  const patchNseRow = useCallback((ticker: string, row: ExchangeRow) => {
    setState((prev) => {
      const nextNseData = { ...prev.nseData, [ticker]: row }
      saveJson(KEY_NSE, nextNseData)
      const now = new Date()
      saveStr(KEY_NSE_TIME, now.toISOString())
      return { ...prev, nseData: nextNseData, nseLastRefreshed: now }
    })
  }, [])

  /**
   * Bulk patch many NSE rows in one state update. Used by the admin
   * page's manual "Refresh DealNector API" sweep so the coverage
   * counters ("NSE: 61/521") update progressively as each batch of
   * 25 lands, instead of staying frozen at whatever the last hourly
   * cron produced.
   *
   * Previously the manual sweep wrote to the admin's local
   * exchangeData state + localStorage only; LiveSnapshotProvider's
   * state.nseData was untouched. Result: admin sees fresh rows in
   * the main comparison table but the status bar at the top kept
   * reporting the stale hourly count ("NSE: 61/521 · 10:36 pm")
   * even though the actual DB now had 500+ rows of fresh NSE data.
   *
   * Also persists `nseLastRefreshed` so the timestamp next to the
   * counter reflects the most recent batch, not the last auto cron.
   */
  const patchNseBatch = useCallback((rows: Record<string, ExchangeRow>) => {
    if (!rows || Object.keys(rows).length === 0) return
    setState((prev) => {
      const nextNseData = { ...prev.nseData, ...rows }
      saveJson(KEY_NSE, nextNseData)
      const now = new Date()
      saveStr(KEY_NSE_TIME, now.toISOString())
      return { ...prev, nseData: nextNseData, nseLastRefreshed: now }
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
      patchNseRow,
      patchNseBatch,
    }),
    [state, missingFields, mergeCompany, deriveCompany, refreshCommodities, refreshRapidApi, allCompanies, reloadDbCompanies, setTicker, patchNseRow, patchNseBatch]
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
