/**
 * Portfolio data layer — types + localStorage-backed CRUD.
 *
 * A Portfolio is a named group of holdings (listed or private) with
 * entry timestamps and optional weights / quantities. Every holding
 * carries its entry snapshot (name, EV, market cap, acquisition score)
 * so the portfolio can be valued even if the underlying company data
 * later disappears or changes.
 *
 * Persistence:
 *   sg4_portfolios → Portfolio[]           (array of portfolio envelopes)
 *
 * Portfolios live in localStorage only — the server never sees them.
 * A portfolio is uniquely identified by a short nanoid-like id.
 */

import type { Company } from '@/lib/data/companies'
import type { PrivateCompany } from '@/lib/data/private-companies'

export type HoldingKind = 'listed' | 'private'

export interface PortfolioHolding {
  /** Unique key — ticker for listed, slugified name for private. */
  key: string
  kind: HoldingKind
  name: string
  /** BSE/NSE ticker for listed; empty string for private. */
  ticker: string
  sec: string
  /** Value-chain segment ids this holding sits in. */
  comp: string[]
  /** Added to portfolio at this ISO timestamp. */
  addedAt: string
  /** Optional weight (0..1). When all holdings have weight 0 the
   *  portfolio is treated as equal-weighted. */
  weight: number
  /** Optional share quantity for real holdings — null means unit
   *  exposure and the trend uses weight-adjusted EV. */
  quantity: number | null
  /** Entry price per share (for listed holdings) or entry EV for
   *  private holdings, stored in ₹Cr. Used to compute the baseline
   *  when the trend chart hasn't been hydrated yet. */
  entryValueCr: number
  /** Snapshot of key metrics AT THE TIME of addition. */
  snapshot: {
    mktcap: number
    ev: number
    ev_eb: number
    pe: number
    revg: number
    ebm: number
    acqs: number
    acqf: string
  }
  notes?: string
}

export interface Portfolio {
  id: string
  name: string
  description: string
  createdAt: string
  updatedAt: string
  /** Holdings in insertion order. */
  holdings: PortfolioHolding[]
  /** Portfolio-level notes. */
  notes: string
}

const STORAGE_KEY = 'sg4_portfolios'

// ── Safe localStorage helpers ────────────────────────────────

export function loadPortfolios(): Portfolio[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as Portfolio[]
    return []
  } catch {
    return []
  }
}

export function savePortfolios(list: Portfolio[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* quota full / disabled — swallow */
  }
}

function genId(): string {
  // Short, collision-resistant-enough for localStorage keys.
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let out = 'p_'
  for (let i = 0; i < 10; i++) {
    out += chars[Math.floor(Math.random() * chars.length)]
  }
  return out
}

// ── Mutation helpers ─────────────────────────────────────────

export function createPortfolio(
  name: string,
  description = '',
  notes = ''
): Portfolio {
  const now = new Date().toISOString()
  const p: Portfolio = {
    id: genId(),
    name: name.trim() || 'Untitled Portfolio',
    description: description.trim(),
    createdAt: now,
    updatedAt: now,
    holdings: [],
    notes: notes.trim(),
  }
  const list = loadPortfolios()
  list.push(p)
  savePortfolios(list)
  return p
}

export function renamePortfolio(id: string, name: string): void {
  const list = loadPortfolios()
  const p = list.find((x) => x.id === id)
  if (!p) return
  p.name = name.trim() || p.name
  p.updatedAt = new Date().toISOString()
  savePortfolios(list)
}

export function deletePortfolio(id: string): void {
  const list = loadPortfolios().filter((x) => x.id !== id)
  savePortfolios(list)
}

export function updatePortfolioNotes(id: string, notes: string): void {
  const list = loadPortfolios()
  const p = list.find((x) => x.id === id)
  if (!p) return
  p.notes = notes
  p.updatedAt = new Date().toISOString()
  savePortfolios(list)
}

/** Convert a live Company row into a holding snapshot. */
export function holdingFromCompany(co: Company, weight = 0): PortfolioHolding {
  return {
    key: co.ticker,
    kind: 'listed',
    name: co.name,
    ticker: co.ticker,
    sec: co.sec,
    comp: [...(co.comp || [])],
    addedAt: new Date().toISOString(),
    weight,
    quantity: null,
    entryValueCr: co.mktcap || co.ev || 0,
    snapshot: {
      mktcap: co.mktcap,
      ev: co.ev,
      ev_eb: co.ev_eb,
      pe: co.pe,
      revg: co.revg,
      ebm: co.ebm,
      acqs: co.acqs,
      acqf: co.acqf,
    },
    notes: '',
  }
}

/** Convert a live PrivateCompany row into a holding snapshot. */
export function holdingFromPrivate(co: PrivateCompany, weight = 0): PortfolioHolding {
  const slug =
    co.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || 'private'
  return {
    key: `PRIV_${slug}`,
    kind: 'private',
    name: co.name,
    ticker: '',
    sec: co.sec,
    comp: [...(co.comp || [])],
    addedAt: new Date().toISOString(),
    weight,
    quantity: null,
    entryValueCr: co.ev_est || 0,
    snapshot: {
      mktcap: co.ev_est || 0,
      ev: co.ev_est || 0,
      ev_eb: 0,
      pe: 0,
      revg: co.revg_est || 0,
      ebm: co.ebm_est || 0,
      acqs: co.acqs,
      acqf: co.acqf,
    },
    notes: co.rea || '',
  }
}

export function addHolding(portfolioId: string, holding: PortfolioHolding): Portfolio | null {
  const list = loadPortfolios()
  const p = list.find((x) => x.id === portfolioId)
  if (!p) return null
  if (p.holdings.some((h) => h.key === holding.key)) {
    // Refresh snapshot + bump addedAt instead of duplicating
    const idx = p.holdings.findIndex((h) => h.key === holding.key)
    p.holdings[idx] = { ...p.holdings[idx], snapshot: holding.snapshot }
  } else {
    p.holdings.push(holding)
  }
  p.updatedAt = new Date().toISOString()
  savePortfolios(list)
  return p
}

export function removeHolding(portfolioId: string, holdingKey: string): void {
  const list = loadPortfolios()
  const p = list.find((x) => x.id === portfolioId)
  if (!p) return
  p.holdings = p.holdings.filter((h) => h.key !== holdingKey)
  p.updatedAt = new Date().toISOString()
  savePortfolios(list)
}

export function updateHolding(
  portfolioId: string,
  holdingKey: string,
  patch: Partial<PortfolioHolding>
): void {
  const list = loadPortfolios()
  const p = list.find((x) => x.id === portfolioId)
  if (!p) return
  const idx = p.holdings.findIndex((h) => h.key === holdingKey)
  if (idx === -1) return
  p.holdings[idx] = { ...p.holdings[idx], ...patch, key: p.holdings[idx].key }
  p.updatedAt = new Date().toISOString()
  savePortfolios(list)
}

/** Normalise weights so they sum to 1.0 when any have been set. */
export function normalizedWeights(p: Portfolio): Record<string, number> {
  const out: Record<string, number> = {}
  const totalExplicit = p.holdings.reduce((sum, h) => sum + (h.weight || 0), 0)
  if (totalExplicit > 0) {
    for (const h of p.holdings) {
      out[h.key] = (h.weight || 0) / totalExplicit
    }
  } else {
    const n = p.holdings.length || 1
    for (const h of p.holdings) out[h.key] = 1 / n
  }
  return out
}
