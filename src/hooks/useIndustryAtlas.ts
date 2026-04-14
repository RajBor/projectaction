'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ChainNode } from '@/lib/data/chain'
import type { Company } from '@/lib/data/companies'
import type { PrivateCompany } from '@/lib/data/private-companies'
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

function convertNode(row: AtlasChainRow): ChainNode {
  return {
    id: row.id,
    name: row.name,
    cat: row.cat,
    sec: row.industry_id,
    flag: (row.flag as ChainNode['flag']) || 'medium',
    mkt: { ig: '—', icagr: '—', gg: '—', gcagr: '—', gc: '—', ist: '—' },
    fin: { gm: '—', eb: '—', capex: '—', moat: '—' },
    str: { fwd: '—', bwd: '—', org: '—', inorg: '—' },
  }
}

/** Rough acquisition score heuristic based on listing status. */
function scoreFromStatus(status: string): { acqs: number; acqf: string } {
  const s = status.toUpperCase()
  if (s === 'MAIN') return { acqs: 7, acqf: 'CONSIDER' }
  if (s === 'SME') return { acqs: 6, acqf: 'MONITOR' }
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
  const { acqs, acqf } = scoreFromStatus(row.status)
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
  const { acqs, acqf } = scoreFromStatus(row.status)
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
    const out: Company[] = []
    for (const id of targetIds) {
      const b = bundles[id]
      if (!b) continue
      for (const c of b.companies) {
        const s = c.status.toUpperCase()
        // Listed-side: MAIN or SME or GOVT/PSU that has a ticker
        if ((s === 'MAIN' || s === 'SME' || s === 'GOVT/PSU') && c.ticker) {
          out.push(convertListedCompany(c, id))
        }
      }
    }
    return out
  }, [targetIds, bundles])

  const atlasPrivate = useMemo<PrivateCompany[]>(() => {
    const out: PrivateCompany[] = []
    for (const id of targetIds) {
      const b = bundles[id]
      if (!b) continue
      for (const c of b.companies) {
        const s = c.status.toUpperCase()
        // Private-side: anything without a ticker, plus SUBSIDIARY
        if (s === 'PRIVATE' || s === 'SUBSIDIARY' || !c.ticker) {
          if (s === 'GOVT/PSU' && c.ticker) continue
          out.push(convertPrivateCompany(c, id))
        }
      }
    }
    return out
  }, [targetIds, bundles])

  return { atlasChain, atlasListed, atlasPrivate, loading }
}
