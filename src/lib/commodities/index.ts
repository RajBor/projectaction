/**
 * Commodity → value-chain impact bridge.
 *
 * The RapidAPI Indian Stock Exchange feed ships a commodities snapshot
 * with last-traded prices and intraday % change. We normalize it into a
 * clean `NormalizedCommodity` shape and then map each commodity to the
 * DealNector value-chain segments whose economics are most sensitive to
 * its price movement. The mapping is curated — one commodity can impact
 * several segments with a signed direction (e.g. a polysilicon price
 * rise compresses module makers' margins, so the direction is negative
 * for solar_modules, positive for polysilicon producers).
 *
 * The bridge also produces a human-readable commentary describing the
 * current demand-supply gap and industry news implication per segment
 * so the Value Chain page can tell the user "here is why this number
 * matters to you today".
 */

import type { CommodityRow } from '@/lib/stocks/api'

export interface NormalizedCommodity {
  /** Display name shown to users. */
  name: string
  /** Canonical key used by the impact map. */
  key: CommodityKey
  /** Last traded price as a finite number, or null if unavailable. */
  lastPrice: number | null
  /** % change vs previous close, or null. */
  changePct: number | null
  /** Absolute change where present. */
  change: number | null
  /** Unit (e.g. 'USD/bbl', '₹/kg'). Best-effort — may be ''. */
  unit: string
  /** Raw upstream symbol string we matched on. */
  rawSymbol: string
}

/**
 * Canonical commodity keys. Only commodities we've modelled an
 * industry impact for are covered here; everything else is returned
 * as a NormalizedCommodity with key === 'other' so the UI can still
 * list them but the impact bridge ignores them.
 */
export type CommodityKey =
  | 'crude'
  | 'natural_gas'
  | 'copper'
  | 'aluminium'
  | 'silver'
  | 'gold'
  | 'steel'
  | 'coal'
  | 'polysilicon'
  | 'zinc'
  | 'nickel'
  | 'lead'
  | 'other'

interface CommodityMeta {
  /** Human-readable display name. */
  name: string
  /** Upstream symbol / name tokens to match on (case-insensitive). */
  match: string[]
  /** Default unit displayed when upstream omits one. */
  unit: string
}

const COMMODITY_META: Record<Exclude<CommodityKey, 'other'>, CommodityMeta> = {
  crude: { name: 'Crude Oil', match: ['crude', 'crudeoil', 'wti', 'brent'], unit: 'USD/bbl' },
  natural_gas: {
    name: 'Natural Gas',
    match: ['natural gas', 'naturalgas', 'naturalgas_mini', 'natgas'],
    unit: 'USD/mmbtu',
  },
  copper: { name: 'Copper', match: ['copper', 'coppermcx'], unit: '₹/kg' },
  aluminium: { name: 'Aluminium', match: ['aluminium', 'aluminum'], unit: '₹/kg' },
  silver: { name: 'Silver', match: ['silver', 'silvermic', 'silverm'], unit: '₹/kg' },
  gold: { name: 'Gold', match: ['gold', 'goldm', 'goldmini'], unit: '₹/10g' },
  steel: { name: 'Steel (HRC)', match: ['steel', 'steelrebar', 'hrc'], unit: '₹/tonne' },
  coal: { name: 'Thermal Coal', match: ['coal', 'thermalcoal'], unit: 'USD/tonne' },
  polysilicon: { name: 'Polysilicon', match: ['polysilicon', 'silicon', 'polymcx'], unit: 'USD/kg' },
  zinc: { name: 'Zinc', match: ['zinc', 'zincmini'], unit: '₹/kg' },
  nickel: { name: 'Nickel', match: ['nickel', 'nickelmini'], unit: '₹/kg' },
  lead: { name: 'Lead', match: ['lead', 'leadmini'], unit: '₹/kg' },
}

// ── Normalisation ──────────────────────────────────────────

function toNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,₹$%\s]/g, '').trim()
    if (!cleaned || cleaned === '-') return null
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function keyFromSymbol(raw: string): CommodityKey {
  const needle = raw.toLowerCase().replace(/\s+/g, '')
  for (const [k, meta] of Object.entries(COMMODITY_META) as Array<
    [Exclude<CommodityKey, 'other'>, CommodityMeta]
  >) {
    for (const token of meta.match) {
      if (needle.includes(token.replace(/\s+/g, ''))) return k
    }
  }
  return 'other'
}

/**
 * Normalize a raw upstream commodities response into a clean,
 * deduplicated array. Handles both array-shaped and object-shaped
 * upstream responses, and tolerates missing fields.
 */
export function normalizeCommodities(
  raw: unknown
): NormalizedCommodity[] {
  if (!raw) return []
  let rows: CommodityRow[] = []
  if (Array.isArray(raw)) {
    rows = raw as CommodityRow[]
  } else if (typeof raw === 'object' && raw !== null) {
    const obj = raw as Record<string, unknown>
    if (Array.isArray(obj.commodities)) rows = obj.commodities as CommodityRow[]
    else if (Array.isArray(obj.data)) rows = obj.data as CommodityRow[]
    else if (Array.isArray(obj.stocks)) rows = obj.stocks as CommodityRow[]
    else {
      // Some responses are a dict keyed by commodity name. Flatten.
      rows = Object.values(obj).filter(
        (v): v is CommodityRow => !!v && typeof v === 'object'
      )
    }
  }

  const byKey = new Map<string, NormalizedCommodity>()

  for (const r of rows) {
    const rawSym =
      (typeof r.symbol === 'string' && r.symbol) ||
      (typeof r.name === 'string' && r.name) ||
      ''
    if (!rawSym) continue
    const key = keyFromSymbol(rawSym)
    // Skip things we can't classify AND can't price, to avoid clutter
    const lastPrice =
      toNumber(r.last_price) ?? toNumber(r.ltp) ?? toNumber(r.price) ?? null
    const changePct =
      toNumber(r.pct_change) ??
      toNumber(r.percent_change) ??
      toNumber(r.percentChange) ??
      null
    const change = toNumber(r.change)
    const unit =
      (typeof r.unit === 'string' && r.unit) ||
      (key !== 'other' ? COMMODITY_META[key].unit : '') ||
      ''
    const displayName =
      key !== 'other'
        ? COMMODITY_META[key].name
        : rawSym
            .replace(/mcx|mini|fut/gi, '')
            .replace(/_/g, ' ')
            .replace(/\s+/g, ' ')
            .trim() || rawSym

    const existing = byKey.get(key)
    // When duplicates come in (e.g. GOLDM + GOLD), prefer the one with
    // the longest non-null fields.
    if (!existing) {
      byKey.set(key, {
        name: displayName,
        key,
        lastPrice,
        changePct,
        change,
        unit,
        rawSymbol: rawSym,
      })
    } else if (lastPrice != null && existing.lastPrice == null) {
      byKey.set(key, {
        ...existing,
        lastPrice,
        changePct: changePct ?? existing.changePct,
        change: change ?? existing.change,
      })
    }
  }

  // Put mapped commodities first (non-other), sorted by name; push
  // 'other' rows to the end.
  const mapped = Array.from(byKey.values())
  mapped.sort((a, b) => {
    if (a.key === 'other' && b.key !== 'other') return 1
    if (b.key === 'other' && a.key !== 'other') return -1
    return a.name.localeCompare(b.name)
  })
  return mapped
}

// ── Value-chain impact map ─────────────────────────────────

export interface SegmentImpact {
  /** Value-chain segment id from src/lib/data/chain.ts. */
  segmentId: string
  /** +1 = commodity price rise is good for the segment,
   *  −1 = commodity price rise is bad for the segment. */
  direction: 1 | -1
  /** Magnitude from 0..1. How strongly prices flow through to margins. */
  sensitivity: number
  /** Plain-English rationale shown in the commentary. */
  rationale: string
}

/**
 * Map of commodity → list of segments it materially impacts.
 * Curated for India solar + T&D coverage. Covers the core raw
 * material cost levers plus the output-price levers.
 */
export const COMMODITY_SEGMENT_IMPACT: Record<
  Exclude<CommodityKey, 'other'>,
  SegmentImpact[]
> = {
  polysilicon: [
    {
      segmentId: 'polysilicon',
      direction: 1,
      sensitivity: 1.0,
      rationale: 'Higher polysilicon prices lift producer margins.',
    },
    {
      segmentId: 'wafers',
      direction: -1,
      sensitivity: 0.85,
      rationale: 'Wafer makers absorb polysilicon price pass-through.',
    },
    {
      segmentId: 'solar_cells',
      direction: -1,
      sensitivity: 0.65,
      rationale: 'Cell BOM is ~60% driven by wafer cost.',
    },
    {
      segmentId: 'solar_modules',
      direction: -1,
      sensitivity: 0.55,
      rationale: 'Module gross margin compresses when poly rises.',
    },
  ],
  copper: [
    {
      segmentId: 'hv_cables',
      direction: -1,
      sensitivity: 0.9,
      rationale: 'Copper is 55–70% of HV/EHV cable BOM.',
    },
    {
      segmentId: 'transformers',
      direction: -1,
      sensitivity: 0.45,
      rationale: 'Windings + core drive ~25% of transformer input cost.',
    },
    {
      segmentId: 'inverters',
      direction: -1,
      sensitivity: 0.25,
      rationale: 'Copper content in inverter magnetics adds ~8–12% to BOM.',
    },
  ],
  aluminium: [
    {
      segmentId: 'acsr_conductors',
      direction: -1,
      sensitivity: 0.95,
      rationale: 'Aluminium is ~70% of ACSR conductor cost.',
    },
    {
      segmentId: 'htls',
      direction: -1,
      sensitivity: 0.85,
      rationale: 'HTLS conductors are aluminium-alloy dominant.',
    },
    {
      segmentId: 'mounting',
      direction: -1,
      sensitivity: 0.6,
      rationale: 'Solar mounting structures increasingly use aluminium.',
    },
  ],
  silver: [
    {
      segmentId: 'solar_cells',
      direction: -1,
      sensitivity: 0.35,
      rationale: 'Silver paste on cell front contacts tracks LBMA prices.',
    },
  ],
  steel: [
    {
      segmentId: 'mounting',
      direction: -1,
      sensitivity: 0.85,
      rationale: 'Galvanised steel is the dominant mounting input.',
    },
    {
      segmentId: 'transformers',
      direction: -1,
      sensitivity: 0.35,
      rationale: 'CRGO + laminations price tracks HRC with a 3–6m lag.',
    },
    {
      segmentId: 'transmission_towers',
      direction: -1,
      sensitivity: 0.9,
      rationale: 'Transmission lattice towers are fabricated steel.',
    },
  ],
  coal: [
    {
      segmentId: 'polysilicon',
      direction: -1,
      sensitivity: 0.4,
      rationale: 'Polysilicon production is power-intensive; coal prices lift utility bills.',
    },
  ],
  crude: [
    {
      segmentId: 'epc_services',
      direction: -1,
      sensitivity: 0.15,
      rationale: 'EPC logistics + diesel-powered site work is crude-linked.',
    },
  ],
  natural_gas: [],
  gold: [],
  zinc: [
    {
      segmentId: 'mounting',
      direction: -1,
      sensitivity: 0.45,
      rationale: 'Galvanising zinc feed-through to steel mounting structures.',
    },
  ],
  nickel: [],
  lead: [],
}

// ── Impact computation ─────────────────────────────────────

export interface SegmentImpactSummary {
  segmentId: string
  /** Weighted net impact in % points (signed). Positive = tailwind. */
  netImpactPct: number
  /** Top 3 commodity drivers contributing to the number. */
  drivers: Array<{
    commodityKey: Exclude<CommodityKey, 'other'>
    commodityName: string
    changePct: number
    contributionPct: number
    direction: 1 | -1
    rationale: string
  }>
  /** Human-readable demand-supply commentary. */
  commentary: string
}

/**
 * Compute per-segment net impact from the commodities snapshot.
 * The net impact is the Σ (signed commodity Δ% × sensitivity × direction)
 * across every contributing commodity. A simple, transparent heuristic
 * suitable for an at-a-glance "cost pressure / tailwind" readout.
 */
export function computeSegmentImpacts(
  commodityList: NormalizedCommodity[]
): SegmentImpactSummary[] {
  const bySegment = new Map<string, SegmentImpactSummary>()
  const byKey = new Map<CommodityKey, NormalizedCommodity>()
  for (const c of commodityList) byKey.set(c.key, c)

  for (const [commodityKeyRaw, impacts] of Object.entries(
    COMMODITY_SEGMENT_IMPACT
  ) as Array<[Exclude<CommodityKey, 'other'>, SegmentImpact[]]>) {
    const commodity = byKey.get(commodityKeyRaw)
    if (!commodity || commodity.changePct == null) continue

    for (const impact of impacts) {
      const contribution =
        commodity.changePct * impact.sensitivity * impact.direction
      const existing = bySegment.get(impact.segmentId) ?? {
        segmentId: impact.segmentId,
        netImpactPct: 0,
        drivers: [],
        commentary: '',
      }
      existing.netImpactPct += contribution
      existing.drivers.push({
        commodityKey: commodityKeyRaw,
        commodityName: commodity.name,
        changePct: commodity.changePct,
        contributionPct: contribution,
        direction: impact.direction,
        rationale: impact.rationale,
      })
      bySegment.set(impact.segmentId, existing)
    }
  }

  // Sort drivers inside each summary by |contribution| desc and build commentary.
  const allEntries = Array.from(bySegment.values())
  for (const entry of allEntries) {
    entry.drivers.sort(
      (a, b) => Math.abs(b.contributionPct) - Math.abs(a.contributionPct)
    )
    entry.drivers = entry.drivers.slice(0, 3)
    entry.netImpactPct = Math.round(entry.netImpactPct * 100) / 100
    entry.commentary = buildCommentary(entry)
  }

  return Array.from(bySegment.values()).sort(
    (a, b) => Math.abs(b.netImpactPct) - Math.abs(a.netImpactPct)
  )
}

function buildCommentary(s: SegmentImpactSummary): string {
  if (s.drivers.length === 0) {
    return 'No commodity pressure detected for this segment today.'
  }
  const direction =
    s.netImpactPct > 0.05
      ? 'net tailwind'
      : s.netImpactPct < -0.05
        ? 'net cost pressure'
        : 'broadly neutral'
  const topDriver = s.drivers[0]
  const sign = topDriver.changePct >= 0 ? '+' : ''
  return `${direction.charAt(0).toUpperCase() + direction.slice(1)}: ${topDriver.commodityName} ${sign}${topDriver.changePct.toFixed(2)}% today — ${topDriver.rationale}`
}

// ── Formatting helpers ─────────────────────────────────────

export function fmtCommodityPrice(c: NormalizedCommodity): string {
  if (c.lastPrice == null) return '—'
  if (c.lastPrice >= 10000) return c.lastPrice.toLocaleString('en-IN')
  if (c.lastPrice >= 100) return c.lastPrice.toFixed(1)
  return c.lastPrice.toFixed(2)
}

export function fmtCommodityChange(c: NormalizedCommodity): string {
  if (c.changePct == null) return '—'
  const sign = c.changePct > 0 ? '+' : ''
  return `${sign}${c.changePct.toFixed(2)}%`
}
