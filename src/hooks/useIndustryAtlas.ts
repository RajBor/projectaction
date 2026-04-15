'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ChainNode } from '@/lib/data/chain'
import { COMPANIES, type Company } from '@/lib/data/companies'
import { PRIVATE_COMPANIES, type PrivateCompany } from '@/lib/data/private-companies'
import { useIndustryFilter } from '@/hooks/useIndustryFilter'

/**
 * Hook that merges atlas-seeded industry data (DB) with the hardcoded
 * CHAIN / COMPANIES / PRIVATE_COMPANIES arrays.
 *
 * Core industries ('solar' and 'td') already have full-fidelity data in
 * the static arrays, so we SKIP them here to avoid duplicating nodes.
 *
 * For every other selected industry we fetch:
 *   GET /api/industries/:id/chain      → list of stage rows
 *   GET /api/industries/:id/companies  → list of company rows (+ market_data JSONB)
 *
 * And convert each row into ChainNode / Company / PrivateCompany shapes
 * so existing pages can consume them with no downstream changes.
 */

const CACHE_KEY_PREFIX = 'sg4_atlas_cache_v1__'

interface AtlasChainRow {
  id: string
  industry_id: string
  name: string
  cat: string
  flag: string
}

interface AtlasMarketData {
  lastPrice?: number | null
  mktcapCr?: number | null
  pe?: number | null
  weekHigh?: number | null
}

interface AtlasCompanyRow {
  id: number
  stage_id: string
  name: string
  status: string // MAIN | SME | SUBSIDIARY | GOVT/PSU | PRIVATE
  exchange: string | null
  ticker: string | null
  role: string | null
  market_data: AtlasMarketData | null
}

/**
 * Derive a flag for an atlas-seeded chain node. Uses the DB-provided flag
 * when it's anything other than the 'medium' default; otherwise inspects
 * the node NAME for high-complexity-manufacturing keywords (blade, nacelle,
 * wafer, cell, etc.) to mark it as 'critical' so Dashboard's Critical
 * Priority Components section surfaces them.
 */
function deriveFlag(name: string, dbFlag: string | null | undefined): ChainNode['flag'] {
  const f = (dbFlag || '').toLowerCase()
  if (f === 'critical' || f === 'high') return f as ChainNode['flag']
  const n = name.toLowerCase()
  // Core high-complexity / high-moat manufacturing → critical
  if (/blade|nacelle|gearbox|rotor|tower|wafer|cell|polysilicon|ingot|semiconductor|electrolyser|electrolyzer|catalyst|battery cell|cathode|anode|lithium/.test(n)) {
    return 'critical'
  }
  // Assembly, integration, core components → high
  if (/manufactur|assembl|raw material|composite|key component|drive ?train|generator/.test(n)) {
    return 'high'
  }
  return 'medium'
}

function convertNode(row: AtlasChainRow): ChainNode {
  return {
    id: row.id,
    name: row.name,
    cat: row.cat,
    sec: row.industry_id,
    flag: deriveFlag(row.name, row.flag),
    mkt: { ig: '—', icagr: '—', gg: '—', gcagr: '—', gc: '—', ist: '—' },
    fin: { gm: '—', eb: '—', capex: '—', moat: '—' },
    str: { fwd: '—', bwd: '—', org: '—', inorg: '—' },
  }
}

/**
 * Acquisition score heuristic for atlas-seeded companies. Scales by
 * market cap so large-cap MAIN listings (Suzlon, Inox Wind, etc.) land
 * in the Strong Buy / Consider buckets on the Dashboard rather than
 * getting flat acqs=7 regardless of size.
 */
function scoreFromStatus(status: string, mktcapCr: number): { acqs: number; acqf: string } {
  const s = status.toUpperCase()
  if (s === 'MAIN') {
    if (mktcapCr >= 50000) return { acqs: 9, acqf: 'STRONG BUY' }
    if (mktcapCr >= 10000) return { acqs: 8, acqf: 'STRONG BUY' }
    if (mktcapCr >= 2000) return { acqs: 7, acqf: 'CONSIDER' }
    return { acqs: 6, acqf: 'CONSIDER' }
  }
  if (s === 'SME') {
    if (mktcapCr >= 1000) return { acqs: 7, acqf: 'CONSIDER' }
    return { acqs: 6, acqf: 'MONITOR' }
  }
  if (s === 'SUBSIDIARY') return { acqs: 5, acqf: 'MONITOR' }
  if (s === 'GOVT/PSU') return { acqs: 3, acqf: 'AVOID' }
  return { acqs: 5, acqf: 'MONITOR' }
}

/**
 * Coerce a market-data value to a finite number. JSONB roundtrips can
 * return strings for numeric fields (especially when the scraper couldn't
 * parse), and downstream UI code calls .toFixed() which blows up on
 * non-numbers. Falls back to 0 on anything non-numeric.
 */
function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function convertListedCompany(
  row: AtlasCompanyRow,
  industryId: string
): Company {
  const md = row.market_data || {}
  const mktcap = num(md.mktcapCr)
  const pe = num(md.pe)
  const { acqs, acqf } = scoreFromStatus(row.status, mktcap)
  return {
    name: row.name,
    ticker: row.ticker || row.name,
    nse: row.ticker || null,
    sec: industryId,
    comp: [row.stage_id],
    mktcap,
    rev: 0,
    ebitda: 0,
    pat: 0,
    ev: mktcap, // best approximation in absence of debt/cash
    ev_eb: 0,
    pe,
    pb: 0,
    dbt_eq: 0,
    revg: 0,
    ebm: 0,
    acqs,
    acqf,
    rea: row.role || `${row.status} · ${row.exchange || ''}`.trim(),
  }
}

function convertPrivateCompany(
  row: AtlasCompanyRow,
  industryId: string
): PrivateCompany {
  const mktcap = num(row.market_data?.mktcapCr)
  const { acqs, acqf } = scoreFromStatus(row.status, mktcap)
  return {
    name: row.name,
    stage: row.status === 'SUBSIDIARY' ? 'Subsidiary' : 'Private',
    founded: 0,
    hq: '—',
    sec: industryId,
    comp: [row.stage_id],
    cap: '—',
    rev_est: 0,
    ev_est: 0,
    ebm_est: 0,
    revg_est: 0,
    tech: row.role || '—',
    pli: '—',
    almm: '—',
    ipo: '—',
    acqs,
    acqf,
    rea: row.role || `${row.status} · ${row.exchange || ''}`.trim(),
  }
}

interface AtlasBundle {
  nodes: AtlasChainRow[]
  companies: AtlasCompanyRow[]
}

function loadCached(id: string): AtlasBundle | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + id)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.companies)) {
      return parsed as AtlasBundle
    }
  } catch { /* ignore */ }
  return null
}

function storeCached(id: string, bundle: AtlasBundle) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + id, JSON.stringify(bundle))
  } catch { /* ignore (quota) */ }
}

export interface IndustryAtlasShape {
  /** Extra chain nodes for atlas industries not covered by hardcoded CHAIN */
  atlasChain: ChainNode[]
  /** Extra listed companies (MAIN/SME/GOVT-PSU with ticker) */
  atlasListed: Company[]
  /** Extra private / subsidiary companies */
  atlasPrivate: PrivateCompany[]
  /** True while at least one industry is being fetched */
  loading: boolean
}

export function useIndustryAtlas(): IndustryAtlasShape {
  const { selectedIndustries, availableIndustries } = useIndustryFilter()

  // Industries whose data we need to merge in: every selected one that is
  // NOT one of the two hardcoded cores ('solar', 'td').
  const targetIds = useMemo(() => {
    return selectedIndustries.filter(
      (id) =>
        id !== 'solar' &&
        id !== 'td' &&
        availableIndustries.some((a) => a.id === id)
    )
  }, [selectedIndustries, availableIndustries])

  // Bundle cache keyed by industry id
  const [bundles, setBundles] = useState<Record<string, AtlasBundle>>(() => {
    if (typeof window === 'undefined') return {}
    const initial: Record<string, AtlasBundle> = {}
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)
        if (k && k.startsWith(CACHE_KEY_PREFIX)) {
          const id = k.slice(CACHE_KEY_PREFIX.length)
          const c = loadCached(id)
          if (c) initial[id] = c
        }
      }
    } catch { /* ignore */ }
    return initial
  })
  const [loading, setLoading] = useState(false)

  // Internal fetch helper — pulls atlas chain + companies for one industry
  // and writes the result into the bundle cache (both React state and
  // localStorage). Used both by the missing-bundle effect (initial load)
  // and by the live-refresh listeners below (admin-triggered events).
  const fetchBundle = useCallback(async (id: string) => {
    try {
      const [chainRes, coRes] = await Promise.all([
        fetch(`/api/industries/${encodeURIComponent(id)}/chain`, { credentials: 'same-origin', cache: 'no-store' }),
        fetch(`/api/industries/${encodeURIComponent(id)}/companies`, { credentials: 'same-origin', cache: 'no-store' }),
      ])
      const chainJson = await chainRes.json().catch(() => ({}))
      const coJson = await coRes.json().catch(() => ({}))
      const nodes = Array.isArray(chainJson?.nodes) ? (chainJson.nodes as AtlasChainRow[]) : []
      const companies = Array.isArray(coJson?.companies) ? (coJson.companies as AtlasCompanyRow[]) : []
      const bundle: AtlasBundle = { nodes, companies }
      setBundles((prev) => ({ ...prev, [id]: bundle }))
      storeCached(id, bundle)
    } catch {
      // Swallow — keep whatever bundle we already had so the UI doesn't
      // suddenly empty out on a transient network blip.
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const missing = targetIds.filter((id) => !bundles[id])
    if (missing.length === 0) return
    setLoading(true)

    Promise.all(
      missing.map(async (id) => {
        try {
          const [chainRes, coRes] = await Promise.all([
            fetch(`/api/industries/${encodeURIComponent(id)}/chain`, { credentials: 'same-origin' }),
            fetch(`/api/industries/${encodeURIComponent(id)}/companies`, { credentials: 'same-origin' }),
          ])
          const chainJson = await chainRes.json().catch(() => ({}))
          const coJson = await coRes.json().catch(() => ({}))
          const nodes = Array.isArray(chainJson?.nodes) ? (chainJson.nodes as AtlasChainRow[]) : []
          const companies = Array.isArray(coJson?.companies) ? (coJson.companies as AtlasCompanyRow[]) : []
          return { id, bundle: { nodes, companies } satisfies AtlasBundle }
        } catch {
          return { id, bundle: { nodes: [], companies: [] } satisfies AtlasBundle }
        }
      })
    ).then((results) => {
      if (cancelled) return
      setBundles((prev) => {
        const next = { ...prev }
        for (const { id, bundle } of results) {
          next[id] = bundle
          storeCached(id, bundle)
        }
        return next
      })
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [targetIds, bundles])

  // ── Live refresh ─────────────────────────────────────────────
  //
  // Without this listener the atlas cache would only update when the
  // user navigates away and back. When admin actions modify atlas data
  // (seed-atlas / industry CSV upload / SME Discovery → Add to Platform
  // for an atlas industry), we re-fetch every currently-selected atlas
  // industry so Value Chain, Dashboard, and the Industry sidebar reflect
  // the change instantly — same UX as the user_companies live-refresh
  // wired into LiveSnapshotProvider.
  //
  // We listen to three signals:
  //   1. `sg4:industry-data-change` — most specific; admin handlers fire
  //      this with `detail.industries: string[]` after writing rows to
  //      industry_chain_companies / industry_chain_stages. We refetch
  //      only the affected ids.
  //   2. `sg4:industries-registry-change` — fires on add/delete of an
  //      industry; refetch ALL selected atlas industries to be safe.
  //   3. `sg4:data-pushed` — admin pushed data to user_companies; rare
  //      but the SME may also have an atlas chain row, so refetch.
  //   4. `storage` event keyed `sg4_industry_data_pushed_at` — same as
  //      above but cross-tab (admin pushes in Tab A, analyst's Tab B
  //      sees it).
  useEffect(() => {
    const refreshAll = () => {
      for (const id of targetIds) fetchBundle(id)
    }
    const onIndustryData = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const ids: string[] | undefined = Array.isArray(detail?.industries)
        ? detail.industries
        : undefined
      if (ids && ids.length > 0) {
        for (const id of ids) {
          if (targetIds.includes(id)) fetchBundle(id)
        }
      } else {
        refreshAll()
      }
    }
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'sg4_industry_data_pushed_at') refreshAll()
    }
    window.addEventListener('sg4:industry-data-change', onIndustryData)
    window.addEventListener('sg4:industries-registry-change', refreshAll)
    window.addEventListener('sg4:data-pushed', refreshAll)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('sg4:industry-data-change', onIndustryData)
      window.removeEventListener('sg4:industries-registry-change', refreshAll)
      window.removeEventListener('sg4:data-pushed', refreshAll)
      window.removeEventListener('storage', onStorage)
    }
  }, [targetIds, fetchBundle])

  const atlasChain = useMemo<ChainNode[]>(() => {
    const out: ChainNode[] = []
    for (const id of targetIds) {
      const b = bundles[id]
      if (!b) continue
      for (const n of b.nodes) out.push(convertNode(n))
    }
    return out
  }, [targetIds, bundles])

  const atlasListed = useMemo<Company[]>(() => {
    // Dedupe by ticker — a single listed company (e.g. SUZLON) can appear in
    // multiple value-chain stages inside the atlas, and may also already
    // exist in the hardcoded COMPANIES array. We merge comp[] stages into
    // the first occurrence and skip duplicates so React keys stay unique.
    const byTicker = new Map<string, Company>()
    const hardcodedTickers = new Set(COMPANIES.map((c) => c.ticker))
    for (const id of targetIds) {
      const b = bundles[id]
      if (!b) continue
      for (const c of b.companies) {
        const s = c.status.toUpperCase()
        if ((s === 'MAIN' || s === 'SME' || s === 'GOVT/PSU') && c.ticker) {
          // If ticker already in hardcoded COMPANIES, let that one win and
          // skip the atlas duplicate entirely.
          if (hardcodedTickers.has(c.ticker)) continue
          const existing = byTicker.get(c.ticker)
          if (existing) {
            // Merge stage into existing comp[] (dedup within the array).
            const merged = Array.from(new Set([...(existing.comp || []), c.stage_id]))
            byTicker.set(c.ticker, { ...existing, comp: merged })
          } else {
            byTicker.set(c.ticker, convertListedCompany(c, id))
          }
        }
      }
    }
    return Array.from(byTicker.values())
  }, [targetIds, bundles])

  const atlasPrivate = useMemo<PrivateCompany[]>(() => {
    // Dedupe by name (private companies have no ticker). Same merging logic
    // as atlasListed: stages get aggregated into a single comp[] array.
    const byName = new Map<string, PrivateCompany>()
    const hardcodedNames = new Set(PRIVATE_COMPANIES.map((p) => p.name.toLowerCase()))
    for (const id of targetIds) {
      const b = bundles[id]
      if (!b) continue
      for (const c of b.companies) {
        const s = c.status.toUpperCase()
        if (s === 'PRIVATE' || s === 'SUBSIDIARY' || !c.ticker) {
          if (s === 'GOVT/PSU' && c.ticker) continue
          const key = c.name.toLowerCase()
          if (hardcodedNames.has(key)) continue
          const existing = byName.get(key)
          if (existing) {
            const merged = Array.from(new Set([...(existing.comp || []), c.stage_id]))
            byName.set(key, { ...existing, comp: merged })
          } else {
            byName.set(key, convertPrivateCompany(c, id))
          }
        }
      }
    }
    return Array.from(byName.values())
  }, [targetIds, bundles])

  return { atlasChain, atlasListed, atlasPrivate, loading }
}
