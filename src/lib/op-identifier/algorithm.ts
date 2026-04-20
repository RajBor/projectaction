/**
 * Op Identifier scoring algorithm — fully deterministic.
 *
 * Given:
 *   1. An ACQUIRER company (picked by the analyst from the live DB)
 *   2. A set of INPUTS the analyst supplies (growth ambition, Ansoff
 *      vector, Porter strategy, sectors, deal-size band, ownership)
 *   3. The UNIVERSE of candidate targets from useLiveSnapshot
 *
 * We produce per-target:
 *   - Conviction % (weighted sub-score aggregate)
 *   - Sub-score breakdown (8 factors now: sector + size + growth +
 *     margin + ansoff + porter + policy tailwind + sub-segment overlap)
 *   - Value-chain position + integration direction (backward/forward
 *     /horizontal/adjacent)
 *   - BCG classification + McKinsey horizon
 *   - Integration Complexity (Haspeslagh-Jemison)
 *   - Recommended deal structure (1 of 7 classical)
 *   - Synergy estimate (revenue + cost, ₹Cr)
 *   - Valuation triangulation (EV/EBITDA, EV/Revenue vs median)
 *   - Memo sections (thesis / risks / integration plan / valuation)
 *   - Overlapping sub-segments (DealNector VC Taxonomy)
 *
 * Zero external API calls.
 */

import type { Company } from '@/lib/data/companies'
import { POLICIES } from '@/lib/data/policies'
import { getSubSegmentsForComp, getSubSegmentLabel, COMP_TO_STAGE_CODE, industryCodeFor } from '@/lib/data/sub-segments'
import { SECTOR_EXPORT_DESTINATIONS, type ExportRegionId } from './geography'
import {
  COUNTRY_POLICY_REGIMES,
  TRADE_FLOW_MATRIX,
  classifyAssetType,
  type CountryRegimeId,
  type TargetAssetType,
} from './investment-criteria'
import {
  ANSOFF,
  type AnsoffVector,
  type PorterStrategy,
  type BcgQuadrant,
  type McKinseyHorizon,
  type IntegrationMode,
  type DealStructure,
  type VcPosition,
  type SevenPower,
  type SynergyBucket,
  horizonFor,
  type HorizonBand,
  vcPositionFor,
  integrationDirection,
  DEAL_STRUCTURES,
} from './frameworks'

export interface OpInputs {
  targetRevenueCr: number
  horizonMonths: number
  /** Ansoff vectors to blend — scoring takes the max fit across all
   *  selected vectors. Single-select still works (pass a length-1 array). */
  ansoff: AnsoffVector[]
  /** Porter strategies to blend — scoring takes max fit across selections. */
  porter: PorterStrategy[]
  sectorsOfInterest: string[]
  dealSizeMinCr: number
  dealSizeMaxCr: number
  ownership: Array<'listed' | 'private' | 'subsidiary'>
  // Optional multi-select preferences — empty = no filter.
  // When set, targets matching the preference get a conviction boost
  // and are surfaced first. Never a hard filter (so a strong target
  // doesn't vanish because one preference didn't match).
  preferredSevenPowers?: SevenPower[]
  preferredBcg?: BcgQuadrant[]
  preferredMcKinsey?: McKinseyHorizon[]
  preferredIntegrationModes?: IntegrationMode[]
  preferredDealStructures?: DealStructure[]
  preferredSynergyBuckets?: SynergyBucket[]
  preferredVcPositions?: VcPosition[]
  /** Sub-segment ids from the DealNector VC Taxonomy. When set,
   *  targets whose overlappingSubSegments include any of these get a
   *  boost; this is additive to the existing subSegmentFit score. */
  preferredSubSegments?: string[]
  /** Export-region ids from the geography layer. Targets whose sector
   *  exports to the user's preferred regions get a small conviction
   *  boost, capped in the preferenceBoost ceiling. */
  preferredGeographies?: string[]
  /** Target VC-stage codes from the DealNector VC Taxonomy (e.g. '1.2'
   *  for Solar Wafer/Cell/Module Manufacturing). When set, targets whose
   *  comp[] maps into one of these stages get a conviction boost. This
   *  is one level coarser than preferredSubSegments and lets the analyst
   *  say 'any cell/module target in Solar' without picking each sub-node. */
  targetStages?: string[]
  /** Target industry codes (from TAXONOMY_INDUSTRIES). Acts as a coarse
   *  sector filter on top of sectorsOfInterest — either works, both
   *  together mildly compound the boost. */
  targetIndustries?: string[]
  /** "Already covered, do not acquire" — stage codes the analyst wants
   *  to actively avoid. Targets whose comp[] maps into an excluded stage
   *  get a bounded conviction penalty (default cap -0.10). */
  excludedStages?: string[]
  /** Same semantics for industries. */
  excludedIndustries?: string[]
  // ── Investment criteria (hard filters) ─────────────────────────
  /** Minimum EBITDA margin % — any target below is screened out. */
  minEbitdaMarginPct?: number
  /** Maximum EV/EBITDA multiple — hard ceiling. 0/undefined disables. */
  maxEvEbitdaMultiple?: number
  /** If true, targets with no policy tailwind AND no ESG signal are
   *  screened out. Proxy: requires at least one policy hit OR a non-zero
   *  acqs score (the DealNector curated universe implicitly carries an
   *  ESG-compliant status; atlas-added SMEs start at acqs 0 until
   *  reviewed). Soft — won't drop curated mid-caps. */
  esgRequired?: boolean
  /** Maximum inferred customer-concentration risk (0..100). Applied as
   *  soft penalty — the framework proxies customer concentration from
   *  company size (smaller cap ≈ higher concentration by base rate). */
  maxCustomerConcentration?: number
  // ── Market intelligence (soft preferences / boosts) ────────────
  /** Country-level policy regime ids to prefer (e.g. ['india', 'uae']).
   *  Tied to target sector export destinations — boosts targets whose
   *  sector exports to one of the preferred regimes. */
  preferredCountryRegimes?: string[]
  /** Trade-flow opportunity row ids to prefer (e.g. ['bess_india']).
   *  Boosts targets whose comp[] matches the row's segment. */
  preferredTradeFlowCorridors?: string[]
  /** Asset-type intents to prefer — upstream / downstream / technology
   *  / geographic / cross_sector. Boosts targets whose integration
   *  direction maps into a selected intent. */
  preferredTargetAssetTypes?: string[]
}

export interface OpSubScores {
  sectorFit: number
  sizeFit: number
  growthFit: number
  marginFit: number
  ansoffFit: number
  porterFit: number
  policyFit: number
  subSegmentFit: number
}

export interface OpTargetMemo {
  thesis: string[]
  risks: string[]
  integration: string[]
  valuation: string[]
}

export interface OpSynergy {
  revenueCr: number
  costCr: number
  totalCr: number
  note: string
}

export interface OpValuation {
  evEbitda: number | null
  evRevenue: number | null
  sectorMedianEvEbitda: number | null
  impliedFairValueCr: number | null
  note: string
}

export interface OpTarget {
  ticker: string
  name: string
  sec: string
  sub: string[]
  mktcapCr: number
  revCr: number
  ebitdaCr: number
  evCr: number
  revGrowthPct: number
  ebitdaMarginPct: number
  acqsScore: number
  conviction: number
  subScores: OpSubScores
  horizon: HorizonBand
  rationale: string[]
  dealSizeCr: number
  // Extended analytics
  vcPosition: VcPosition
  integrationDir: 'backward' | 'forward' | 'horizontal' | 'adjacent'
  overlappingSubSegments: Array<{ id: string; label: string }>
  bcg: BcgQuadrant
  mckinsey: McKinseyHorizon
  integrationMode: IntegrationMode
  dealStructure: DealStructure
  dealStructureLabel: string
  synergy: OpSynergy
  valuation: OpValuation
  policyTailwinds: Array<{ name: string; short: string }>
  memo: OpTargetMemo
  // Acquisition path + legal signals (populated by recommendStrategy
  // + assessHostileExposure). Attached to every OpTarget so both the
  // UI and the downstream report generator can render them without
  // re-running the heuristics.
  shareholding: ShareholdingProfile
  hostileExposure: HostileExposure
  acquisitionStrategy: AcquisitionStrategy
}

export const DEFAULT_WEIGHTS: Record<keyof OpSubScores, number> = {
  sectorFit: 0.18,
  sizeFit: 0.16,
  growthFit: 0.14,
  marginFit: 0.12,
  ansoffFit: 0.10,
  porterFit: 0.08,
  policyFit: 0.10,
  subSegmentFit: 0.12,
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  if (v < 0) return 0
  if (v > 1) return 1
  return v
}
function normaliseSec(s: string | null | undefined): string {
  return (s || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// ── Sub-score functions ─────────────────────────────────────────

function scoreSectorFit(target: Company, sectorsOfInterest: string[]): number {
  if (sectorsOfInterest.length === 0) return 0.5
  const t = normaliseSec(target.sec)
  if (!t) return 0
  const wantedNorm = sectorsOfInterest.map(normaliseSec)
  if (wantedNorm.some((w) => w === t)) return 1
  for (const w of wantedNorm) {
    if (!w) continue
    if (t.startsWith(w + '_') || t.endsWith('_' + w) || t.includes('_' + w + '_')) return 0.85
    if (t.includes(w) || w.includes(t)) return 0.7
  }
  return 0
}

function scoreSizeFit(target: Company, minCr: number, maxCr: number): number {
  const ev = target.ev || target.mktcap || 0
  if (ev <= 0) return 0
  if (ev >= minCr && ev <= maxCr) return 1
  const mid = (minCr + maxCr) / 2 || 1
  const spread = Math.max(maxCr - minCr, 1)
  const delta = ev < minCr ? (minCr - ev) / mid : (ev - maxCr) / mid
  return clamp01(1 - delta * (1 / Math.max(spread / mid, 0.25)))
}

function scoreGrowthFit(target: Company): number {
  return clamp01((target.revg ?? 0) / 25)
}
function scoreMarginFit(target: Company): number {
  return clamp01((target.ebm ?? 0) / 20)
}

function scoreAnsoffFitSingle(acquirer: Company, target: Company, ansoff: AnsoffVector): number {
  const sameSec = normaliseSec(acquirer.sec) === normaliseSec(target.sec) && !!acquirer.sec
  const acqComp = new Set((acquirer.comp || []).map((c) => c.toLowerCase()))
  const tgtComp = new Set((target.comp || []).map((c) => c.toLowerCase()))
  let overlap = 0
  for (const c of Array.from(acqComp)) if (tgtComp.has(c)) overlap++
  const hasOverlap = overlap > 0
  switch (ansoff) {
    case 'market_penetration': return sameSec && hasOverlap ? 1 : sameSec ? 0.7 : 0.2
    case 'product_development': return sameSec && !hasOverlap ? 1 : sameSec ? 0.75 : 0.3
    case 'market_development': return !sameSec && hasOverlap ? 1 : !sameSec ? 0.6 : 0.4
    case 'diversification': return !sameSec && !hasOverlap ? 1 : 0.5
  }
}

function scoreAnsoffFit(acquirer: Company, target: Company, ansoffs: AnsoffVector[]): number {
  const list = ansoffs.length > 0 ? ansoffs : (['product_development'] as AnsoffVector[])
  // Max across selected vectors — if any thesis fits, the target benefits.
  return Math.max(...list.map((a) => scoreAnsoffFitSingle(acquirer, target, a)))
}

function scorePorterFitSingle(target: Company, porter: PorterStrategy): number {
  const rev = target.rev || 0
  const m = target.ebm || 0
  switch (porter) {
    case 'cost': return clamp01(Math.min(rev / 1000, 1) * 0.5 + Math.min(m / 10, 1) * 0.5)
    case 'differentiation': return clamp01(Math.min(m / 15, 1) * 0.7 + ((target.subcomp && target.subcomp.length > 0) ? 0.3 : 0))
    case 'focus': return clamp01((rev > 0 && rev < 1000 ? 1 : Math.max(0, 1 - (rev - 1000) / 2000)) * 0.5 + Math.min(m / 8, 1) * 0.5)
  }
}

function scorePorterFit(target: Company, porters: PorterStrategy[]): number {
  const list = porters.length > 0 ? porters : (['differentiation'] as PorterStrategy[])
  return Math.max(...list.map((p) => scorePorterFitSingle(target, p)))
}

/** Count how many POLICIES apply to this target (any of its comp ids
 *  is listed in a policy's comp array). Returns {score, list}. */
function scorePolicyFit(target: Company): { score: number; list: Array<{ name: string; short: string }> } {
  const comps = new Set((target.comp || []).map((c) => c.toLowerCase()))
  if (comps.size === 0) return { score: 0.2, list: [] }
  const hits: Array<{ name: string; short: string }> = []
  for (const p of POLICIES) {
    const overlap = (p.comp || []).some((c) => comps.has(c.toLowerCase()))
    if (overlap) hits.push({ name: p.name, short: p.sh })
  }
  // 4+ policy tailwinds = 1.0; 0 = 0. Linear in between.
  return { score: clamp01(hits.length / 4), list: hits }
}

/** Sub-segment overlap via the DealNector VC Taxonomy (668 sub-segments).
 *  Returns a Jaccard-style score on (acquirer.subcomp ∪ sector sub-segments)
 *  ∩ (target.subcomp ∪ target sector sub-segments). */
function scoreSubSegmentFit(
  acquirer: Company,
  target: Company,
): { score: number; overlap: Array<{ id: string; label: string }> } {
  const acqSet = new Set<string>()
  for (const s of acquirer.subcomp || []) acqSet.add(s)
  // expand via comp → stage subs
  for (const c of acquirer.comp || []) {
    for (const s of getSubSegmentsForComp(acquirer.sec, c)) acqSet.add(s.id)
  }
  const tgtSet = new Set<string>()
  for (const s of target.subcomp || []) tgtSet.add(s)
  for (const c of target.comp || []) {
    for (const s of getSubSegmentsForComp(target.sec, c)) tgtSet.add(s.id)
  }
  if (acqSet.size === 0 || tgtSet.size === 0) return { score: 0.3, overlap: [] }
  const inter: string[] = []
  for (const id of Array.from(acqSet)) if (tgtSet.has(id)) inter.push(id)
  const union = new Set([...Array.from(acqSet), ...Array.from(tgtSet)])
  const jaccard = inter.length / Math.max(1, union.size)
  return {
    score: clamp01(jaccard * 2), // × 2 because jaccard tends to be small
    overlap: inter.slice(0, 8).map((id) => ({ id, label: getSubSegmentLabel(id) })),
  }
}

/**
 * Country regime fit — boosts targets whose sector exports to the
 * analyst's preferred country-policy regimes, weighted by the regime's
 * policy score (India 88 vs USA 72 vs UAE 82 etc.).
 *
 * Mechanism:
 *   target.sec → SECTOR_EXPORT_DESTINATIONS → region ids
 *   preferredCountryRegimes → weighted pol scores
 *   overlap → score = avg(pol_score / 100) × 1.25, capped at 1.0
 *
 * Returns { score, list } where list is the matched regimes with their
 * pol scores, so the memo can cite them.
 */
function scoreCountryRegimeFit(
  target: Company,
  preferredRegimes: string[],
): { score: number; list: Array<{ id: string; label: string; polScore: number }> } {
  if (!preferredRegimes?.length) return { score: 0.35, list: [] }
  const sectorRegions = new Set((SECTOR_EXPORT_DESTINATIONS[target.sec || ''] || []).map(r => r.id as string))
  const matches: Array<{ id: string; label: string; polScore: number }> = []
  for (const prefId of preferredRegimes) {
    const regime = COUNTRY_POLICY_REGIMES.find(r => r.id === prefId)
    if (!regime) continue
    // Direct sector export overlap counts full; India regime matches any target
    // (since the curated universe is India-listed) counts full too.
    const direct = sectorRegions.has(regime.id) || regime.id === 'india'
    if (direct) matches.push({ id: regime.id, label: regime.label, polScore: regime.polScore })
  }
  if (matches.length === 0) return { score: 0.1, list: [] }
  const avgPol = matches.reduce((s, m) => s + m.polScore, 0) / matches.length
  return { score: clamp01((avgPol / 100) * 1.25), list: matches }
}

/**
 * Trade-flow fit — rewards targets that match a preferred net-importer
 * corridor (domestic M&A thesis: onshore build + tariff moat + growth).
 * Matches target.comp[] against TRADE_FLOW_MATRIX rows by segment.
 */
function scoreTradeFlowFit(
  target: Company,
  preferredCorridors: string[],
): { score: number; list: Array<{ id: string; label: string; opptyScore: number }> } {
  if (!preferredCorridors?.length) return { score: 0.35, list: [] }
  const comps = new Set((target.comp || []).map(c => c.toLowerCase()))
  const matches: Array<{ id: string; label: string; opptyScore: number }> = []
  for (const id of preferredCorridors) {
    const row = TRADE_FLOW_MATRIX.find(r => r.id === id)
    if (!row) continue
    if (comps.has(row.segment.toLowerCase())) {
      matches.push({ id: row.id, label: `${row.segmentLabel} · ${row.countryLabel}`, opptyScore: row.opptyScore })
    }
  }
  if (matches.length === 0) return { score: 0.1, list: [] }
  const best = Math.max(...matches.map(m => m.opptyScore))
  return { score: clamp01(best / 100), list: matches }
}

/**
 * Asset-type fit — boosts targets whose integration direction maps to
 * a preferred strategic intent (upstream / downstream / tech / geo / cross).
 */
function scoreAssetTypeFit(
  acquirerSec: string,
  targetSec: string,
  integrationDir: 'backward' | 'forward' | 'horizontal' | 'adjacent',
  preferredTypes: string[],
): { score: number; classified: TargetAssetType } {
  const classified = classifyAssetType(integrationDir, acquirerSec, targetSec)
  if (!preferredTypes?.length) return { score: 0.35, classified }
  return { score: preferredTypes.includes(classified) ? 1.0 : 0.2, classified }
}

/**
 * Customer-concentration risk proxy. Smaller-cap companies tend toward
 * concentrated books; large caps toward diversified. Returns 0..100 on
 * an inferred scale where higher = more concentrated.
 */
function inferCustomerConcentration(target: Company): number {
  const mc = target.mktcap || 0
  if (mc > 50000) return 25
  if (mc > 10000) return 40
  if (mc > 2000) return 55
  return 70
}

// ── Extended classifiers ────────────────────────────────────────

function classifyBcg(target: Company): BcgQuadrant {
  const g = target.revg ?? 0
  const m = target.ebm ?? 0
  // Use growth > 15% as the high-growth split; margin > 12% as proxy for
  // share/profitability (true relative market share is unavailable).
  if (g >= 15 && m >= 12) return 'star'
  if (g < 15 && m >= 12) return 'cash_cow'
  if (g >= 15 && m < 12) return 'question_mark'
  return 'dog'
}

function classifyMcKinsey(acquirer: Company, target: Company): McKinseyHorizon {
  const sameSec = normaliseSec(acquirer.sec) === normaliseSec(target.sec) && !!acquirer.sec
  const acqComp = new Set((acquirer.comp || []).map((c) => c.toLowerCase()))
  const overlap = (target.comp || []).some((c) => acqComp.has(c.toLowerCase()))
  if (sameSec && overlap) return 'h1_core'
  if (sameSec || overlap) return 'h2_adjacent'
  return 'h3_transformational'
}

/**
 * Integration complexity via Haspeslagh & Jemison.
 *   Need for strategic interdependence (high when overlap is high)
 *   Need for organisational autonomy (high when target is small +
 *     differentiation-heavy, or when target is much larger than acquirer)
 */
function classifyIntegration(acquirer: Company, target: Company): IntegrationMode {
  const acqRev = acquirer.rev || 1
  const tgtRev = target.rev || 0
  const sizeRatio = tgtRev / acqRev
  const acqComp = new Set((acquirer.comp || []).map((c) => c.toLowerCase()))
  const overlap = (target.comp || []).filter((c) => acqComp.has(c.toLowerCase())).length
  const highInterdep = overlap >= 1
  // Autonomy: high if target is big (>30% acquirer rev) or high-margin
  // (>15%, implying brand/IP/specialist culture).
  const highAutonomy = sizeRatio > 0.3 || (target.ebm || 0) > 15
  if (highInterdep && !highAutonomy) return 'absorb'
  if (!highInterdep && highAutonomy) return 'preserve'
  if (highInterdep && highAutonomy) return 'symbiosis'
  return 'holding'
}

function recommendDealStructure(
  inputs: OpInputs,
  target: Company,
  integrationMode: IntegrationMode,
): { id: DealStructure; label: string } {
  const ev = target.ev || target.mktcap || 0
  // If deal size exceeds band by >50%, suggest a strategic stake.
  const oversized = ev > inputs.dealSizeMaxCr * 1.5
  // If target margin is very high + symbiosis → preserve via strategic stake.
  const wantPreserve = integrationMode === 'preserve'
  const wantSymbiosis = integrationMode === 'symbiosis'
  // Focus strategy → prefer strategic stake to keep capital deployment lean.
  const focusTilt = inputs.porter.includes('focus')
  let id: DealStructure = 'acquisition'
  if (oversized || wantPreserve) id = 'strategic_stake'
  else if (wantSymbiosis) id = 'jv'
  else if (focusTilt) id = 'strategic_stake'
  // Distressed signal (acqs <=3) → asset purchase to avoid liabilities.
  if ((target.acqs || 5) <= 3) id = 'asset_purchase'
  const label = DEAL_STRUCTURES.find((d) => d.id === id)?.label ?? id
  return { id, label }
}

function estimateSynergy(acquirer: Company, target: Company): OpSynergy {
  // Revenue synergy: 3% of target rev + 1% of acquirer rev unlocked via
  // cross-sell into the combined base.
  const revSyn = Math.round((target.rev || 0) * 0.03 + (acquirer.rev || 0) * 0.01)
  // Cost synergy: 2% of target EBITDA base from procurement/overhead
  // rationalisation (conservative vs McKinsey benchmark of 3–5%).
  const costSyn = Math.round((target.ebitda || 0) * 0.02 + (target.rev || 0) * 0.005)
  const total = revSyn + costSyn
  const note =
    total > 500
      ? 'Large synergy pool — worth a dedicated TSA (transition services agreement) workstream.'
      : total > 100
        ? 'Moderate synergy pool — typical mid-market M&A.'
        : 'Thin synergy pool — deal thesis must rely on strategic positioning rather than hard synergies.'
  return { revenueCr: revSyn, costCr: costSyn, totalCr: total, note }
}

function triangulate(target: Company, sectorMedianEvEbitda: number | null): OpValuation {
  const ev = target.ev || target.mktcap || 0
  const ebitda = target.ebitda || 0
  const rev = target.rev || 0
  const evEbitda = ebitda > 0 ? ev / ebitda : null
  const evRevenue = rev > 0 ? ev / rev : null
  const impliedFairValue = ebitda > 0 && sectorMedianEvEbitda != null
    ? Math.round(ebitda * sectorMedianEvEbitda)
    : null
  let note = ''
  if (evEbitda == null) note = 'EBITDA missing or zero — valuation via EV/Revenue band only.'
  else if (sectorMedianEvEbitda == null) note = `EV/EBITDA = ${evEbitda.toFixed(1)}× (no sector median to compare).`
  else {
    const pct = ((evEbitda - sectorMedianEvEbitda) / sectorMedianEvEbitda) * 100
    note = pct > 15
      ? `Trades ${pct.toFixed(0)}% above sector median — premium pricing, look for durable moat.`
      : pct < -15
        ? `Trades ${Math.abs(pct).toFixed(0)}% below sector median — potential value; investigate why.`
        : `Within ±15% of sector median (${sectorMedianEvEbitda.toFixed(1)}×) — fair pricing band.`
  }
  return {
    evEbitda,
    evRevenue,
    sectorMedianEvEbitda,
    impliedFairValueCr: impliedFairValue,
    note,
  }
}

/**
 * Compose the four-section analyst memo. Purely deterministic.
 */
function composeMemo(
  acquirer: Company,
  target: Company,
  subs: OpSubScores,
  inputs: OpInputs,
  integrationMode: IntegrationMode,
  dealStructureLabel: string,
  synergy: OpSynergy,
  valuation: OpValuation,
  policyHits: Array<{ name: string; short: string }>,
  integrationDir: 'backward' | 'forward' | 'horizontal' | 'adjacent',
): OpTargetMemo {
  const ansoffMeta = ANSOFF.find((a) => a.id === inputs.ansoff[0])
  const thesis: string[] = []
  if (subs.sectorFit >= 0.85) thesis.push(`Direct sector match with the acquirer\u2019s ${target.sec} focus.`)
  else if (subs.sectorFit >= 0.5) thesis.push(`Adjacent-sector play into ${target.sec} — extends the acquirer\u2019s value chain without crossing into unfamiliar terrain.`)
  else thesis.push(`Outside core sectors; include only if the portfolio thesis explicitly wants a diversifier.`)
  if (ansoffMeta) thesis.push(`${ansoffMeta.label} on the Ansoff matrix: ${ansoffMeta.thesis}`)
  const vcDir = integrationDir === 'backward'
    ? 'Backward integration — secures upstream supply'
    : integrationDir === 'forward'
      ? 'Forward integration — captures more of the downstream margin'
      : integrationDir === 'horizontal'
        ? 'Horizontal consolidation — share gain at the same stage'
        : 'Adjacent — different stage entirely; symbiotic potential'
  thesis.push(`${vcDir}.`)
  if (policyHits.length > 0) {
    thesis.push(
      `Policy tailwinds: ${policyHits.slice(0, 4).map((p) => p.short).join(', ')}${policyHits.length > 4 ? ` (+${policyHits.length - 4} more)` : ''}.`,
    )
  }

  const risks: string[] = []
  if (subs.sizeFit < 0.5) risks.push(`Deal size outside requested band — negotiate a strategic stake or structured earn-out instead of a full takeover.`)
  if ((target.revg ?? 0) < 5) risks.push(`Revenue growth flat/slow (${(target.revg ?? 0).toFixed(1)}%) — carries turnaround execution risk.`)
  if ((target.ebm ?? 0) < 8) risks.push(`EBITDA margin thin (${(target.ebm ?? 0).toFixed(1)}%) — downside scenario eats into deal economics; price accordingly.`)
  if ((target.dbt_eq ?? 0) > 1.5) risks.push(`Debt/Equity ${target.dbt_eq.toFixed(2)} is elevated — refinance risk, covenant triggers.`)
  if (subs.ansoffFit < 0.5) risks.push(`Target sits off-axis from the chosen Ansoff move — rationale weakens.`)
  if (integrationMode === 'symbiosis') risks.push(`Symbiosis integration has the lowest historical M&A success rate — budget for 18-month change-management.`)
  if (risks.length === 0) risks.push(`No standout red flag — execute with standard diligence rigor.`)

  const integration: string[] = []
  integration.push(`Integration mode: ${integrationMode === 'absorb' ? 'Absorption — fold into acquirer\u2019s P&L within 12 months' : integrationMode === 'preserve' ? 'Preservation — keep the target intact; governance only' : integrationMode === 'symbiosis' ? 'Symbiosis — shared platforms while preserving target identity' : 'Holding — financial stewardship only'}.`)
  integration.push(`Recommended structure: ${dealStructureLabel}.`)
  integration.push(`Synergy estimate: revenue ₹${synergy.revenueCr.toLocaleString('en-IN')} Cr · cost ₹${synergy.costCr.toLocaleString('en-IN')} Cr · total ₹${synergy.totalCr.toLocaleString('en-IN')} Cr/yr steady-state.`)
  integration.push(`30-day next steps: (1) LOI + exclusivity, (2) financial DD (debt stack + covenants), (3) customer-concentration diligence, (4) key-person retention carve-out, (5) regulatory pre-clearance (CCI/SEBI SAST if applicable).`)

  const valuationSection: string[] = []
  valuationSection.push(
    `Current EV ₹${Math.round(target.ev || target.mktcap || 0).toLocaleString('en-IN')} Cr · MktCap ₹${Math.round(target.mktcap || 0).toLocaleString('en-IN')} Cr.`,
  )
  if (valuation.evEbitda != null) valuationSection.push(`EV/EBITDA ${valuation.evEbitda.toFixed(1)}×.`)
  if (valuation.evRevenue != null) valuationSection.push(`EV/Revenue ${valuation.evRevenue.toFixed(1)}×.`)
  valuationSection.push(valuation.note)
  if (valuation.impliedFairValueCr != null) {
    valuationSection.push(`Implied fair value at sector median: ₹${valuation.impliedFairValueCr.toLocaleString('en-IN')} Cr.`)
  }
  void acquirer
  return { thesis, risks, integration, valuation: valuationSection }
}

function composeRationale(
  target: Company,
  subs: OpSubScores,
  inputs: OpInputs,
  vcDir: 'backward' | 'forward' | 'horizontal' | 'adjacent',
  overlap: Array<{ id: string; label: string }>,
  policyHits: Array<{ name: string; short: string }>,
): string[] {
  const lines: string[] = []
  const ansoffMeta = ANSOFF.find((a) => a.id === inputs.ansoff[0])
  if (subs.sectorFit >= 0.85) lines.push(`Direct sector match (${target.sec}).`)
  else if (subs.sectorFit >= 0.5) lines.push(`Adjacent sector (${target.sec}).`)
  else lines.push(`Outside stated sectors — ranks on financials alone.`)
  const ev = target.ev || target.mktcap || 0
  if (subs.sizeFit >= 0.9) lines.push(`EV \u20B9${Math.round(ev).toLocaleString('en-IN')} Cr inside deal-size band.`)
  else lines.push(`EV \u20B9${Math.round(ev).toLocaleString('en-IN')} Cr outside band — structure as stake/earn-out.`)
  const g = target.revg ?? 0
  if (g >= 25) lines.push(`Revenue growth ${g.toFixed(1)}% matches ambition curve.`)
  else if (g >= 10) lines.push(`Revenue growth ${g.toFixed(1)}% steady.`)
  else lines.push(`Revenue growth ${g.toFixed(1)}% — synergy-led, not organic.`)
  const m = target.ebm ?? 0
  if (m >= 15) lines.push(`EBITDA margin ${m.toFixed(1)}% premium.`)
  else if (m > 0) lines.push(`EBITDA margin ${m.toFixed(1)}%.`)
  if (subs.ansoffFit >= 0.9 && ansoffMeta) lines.push(`${ansoffMeta.label} fit confirmed.`)
  const dirLabel = vcDir === 'backward' ? 'Backward integration (upstream).'
    : vcDir === 'forward' ? 'Forward integration (downstream).'
    : vcDir === 'horizontal' ? 'Horizontal consolidation (same stage).'
    : 'Adjacent value-chain stage.'
  lines.push(dirLabel)
  if (overlap.length > 0) lines.push(`Sub-segment overlap: ${overlap.slice(0, 3).map((o) => o.label).join(' · ')}${overlap.length > 3 ? ` (+${overlap.length - 3})` : ''}.`)
  if (policyHits.length > 0) lines.push(`Policy tailwinds: ${policyHits.slice(0, 3).map((p) => p.short).join(', ')}.`)
  lines.push(`Acq score ${target.acqs}/10 · ${target.acqf || 'MONITOR'}${target.rea ? '. ' + target.rea.slice(0, 120) + (target.rea.length > 120 ? '…' : '') : ''}`)
  return lines
}

/** Compute sector median EV/EBITDA from the universe. */
function computeSectorMedians(universe: Company[]): Map<string, number> {
  const bySec = new Map<string, number[]>()
  for (const c of universe) {
    if (!c.sec) continue
    const ev = c.ev || c.mktcap || 0
    const eb = c.ebitda || 0
    if (ev > 0 && eb > 0) {
      const s = normaliseSec(c.sec)
      if (!bySec.has(s)) bySec.set(s, [])
      bySec.get(s)!.push(ev / eb)
    }
  }
  const medians = new Map<string, number>()
  for (const [sec, arr] of Array.from(bySec.entries())) {
    arr.sort((a, b) => a - b)
    medians.set(sec, arr[Math.floor(arr.length / 2)])
  }
  return medians
}

// ── Main entry ──────────────────────────────────────────────────

export function identifyTargets(
  acquirer: Company,
  universe: Company[],
  inputs: OpInputs,
  weights: Record<keyof OpSubScores, number> = DEFAULT_WEIGHTS,
): OpTarget[] {
  const sectorMedians = computeSectorMedians(universe)

  const seen = new Set<string>()
  const screened: Company[] = []
  for (const c of universe) {
    if (!c || !c.ticker) continue
    if (seen.has(c.ticker)) continue
    seen.add(c.ticker)
    if (c.ticker === acquirer.ticker) continue
    const hasSignal = (c.mktcap || 0) > 0 || (c.rev || 0) > 0 || (c.ebitda || 0) > 0
    if (!hasSignal) continue
    if (inputs.ownership.length > 0) {
      const approx: 'listed' | 'private' | 'subsidiary' = c.acqs >= 5 ? 'listed' : c.acqs >= 3 ? 'subsidiary' : 'private'
      if (!inputs.ownership.includes(approx)) continue
    }
    // ── Investment-criteria hard filters ──
    // Only applied when the analyst sets a non-empty threshold.
    // Missing data (ebitda=0, rev=0) doesn't trigger the filter —
    // we only drop companies that demonstrably fail the criterion.
    if (inputs.minEbitdaMarginPct && inputs.minEbitdaMarginPct > 0) {
      const margin = c.ebm || 0
      if (margin > 0 && margin < inputs.minEbitdaMarginPct) continue
    }
    if (inputs.maxEvEbitdaMultiple && inputs.maxEvEbitdaMultiple > 0) {
      const mult = c.ev_eb || 0
      if (mult > 0 && mult > inputs.maxEvEbitdaMultiple) continue
    }
    if (inputs.esgRequired) {
      // Proxy: curated companies carry an acqs rating (0..10 > 0 means
      // the DealNector team has tagged them). Atlas-seeded atoms with
      // zero signal AND no policy exposure get dropped.
      const hasPolicySignal = (c.comp || []).some((comp) => POLICIES.some(p => (p.comp || []).includes(comp)))
      if ((c.acqs || 0) === 0 && !hasPolicySignal) continue
    }
    // ── Exclusion filters (HARD drops) ──
    // The UI labels these "exclude" with a strikethrough; an analyst
    // expects excluded industries / stages to vanish from the results,
    // not just take a conviction haircut. Previously this was
    // implemented as a soft -0.10 penalty below, which let excluded
    // Solar-PV targets still appear in the Acquisition Targets cards.
    // Now we drop them from the pool entirely; the soft-penalty code
    // below is kept as a no-op for the industries/stages paths so the
    // remaining preferenceBoost math stays unchanged.
    if (inputs.excludedIndustries?.length) {
      const indCode = industryCodeFor(c.sec)
      if (indCode && inputs.excludedIndustries.includes(indCode)) continue
    }
    if (inputs.excludedStages?.length) {
      const tComps = (c.comp || []).map((s) => s.toLowerCase())
      const hit = tComps.some((s) => {
        const stg = COMP_TO_STAGE_CODE[s]
        return !!stg && inputs.excludedStages!.includes(stg)
      })
      if (hit) continue
    }
    screened.push(c)
  }

  const scored: OpTarget[] = screened.map((t) => {
    const subSeg = scoreSubSegmentFit(acquirer, t)
    const policy = scorePolicyFit(t)
    const subs: OpSubScores = {
      sectorFit: scoreSectorFit(t, inputs.sectorsOfInterest),
      sizeFit: scoreSizeFit(t, inputs.dealSizeMinCr, inputs.dealSizeMaxCr),
      growthFit: scoreGrowthFit(t),
      marginFit: scoreMarginFit(t),
      ansoffFit: scoreAnsoffFit(acquirer, t, inputs.ansoff),
      porterFit: scorePorterFit(t, inputs.porter),
      policyFit: policy.score,
      subSegmentFit: subSeg.score,
    }
    const conviction =
      subs.sectorFit * weights.sectorFit +
      subs.sizeFit * weights.sizeFit +
      subs.growthFit * weights.growthFit +
      subs.marginFit * weights.marginFit +
      subs.ansoffFit * weights.ansoffFit +
      subs.porterFit * weights.porterFit +
      subs.policyFit * weights.policyFit +
      subs.subSegmentFit * weights.subSegmentFit
    const ev = t.ev || t.mktcap || 0
    const horizon = horizonFor(ev)
    const takeoverMultiple = inputs.porter.includes('focus') ? 0.55 : 1.25
    const dealSizeCr = Math.round(ev * takeoverMultiple)
    const vcPos = vcPositionFor(t.comp)
    const integrationDir = integrationDirection(acquirer.comp, t.comp)
    const bcg = classifyBcg(t)
    const mckinsey = classifyMcKinsey(acquirer, t)
    const integrationMode = classifyIntegration(acquirer, t)
    const { id: dealStructureId, label: dealStructureLabel } = recommendDealStructure(inputs, t, integrationMode)
    const synergy = estimateSynergy(acquirer, t)
    const sectorMed = sectorMedians.get(normaliseSec(t.sec)) ?? null
    const valuation = triangulate(t, sectorMed)
    const memo = composeMemo(
      acquirer, t, subs, inputs,
      integrationMode, dealStructureLabel, synergy, valuation,
      policy.list, integrationDir,
    )
    const shareholding = analyseShareholding(t)
    const hostileExposure = assessHostileExposure(t, shareholding)
    const acquisitionStrategy = recommendStrategy(inputs, t, shareholding, hostileExposure, dealStructureId)

    // ── Preference boosts ────────────────────────────────────
    // When the analyst has explicitly selected a preference in one of
    // the framework cards, bump the conviction for targets that match.
    // Each matching preference adds at most 0.05 to conviction; total
    // cap of 0.15 so preferences can't drown out the core signals.
    let preferenceBoost = 0
    if (inputs.preferredBcg?.length && inputs.preferredBcg.includes(bcg)) preferenceBoost += 0.04
    if (inputs.preferredMcKinsey?.length && inputs.preferredMcKinsey.includes(mckinsey)) preferenceBoost += 0.04
    if (inputs.preferredIntegrationModes?.length && inputs.preferredIntegrationModes.includes(integrationMode)) preferenceBoost += 0.03
    if (inputs.preferredDealStructures?.length && inputs.preferredDealStructures.includes(dealStructureId)) preferenceBoost += 0.03
    if (inputs.preferredVcPositions?.length && inputs.preferredVcPositions.includes(vcPos)) preferenceBoost += 0.03
    if (inputs.preferredSubSegments?.length) {
      const overlap = subSeg.overlap.filter((s) => inputs.preferredSubSegments!.includes(s.id)).length
      if (overlap > 0) preferenceBoost += Math.min(0.04, overlap * 0.015)
    }
    if (inputs.preferredGeographies?.length) {
      // Does this target's sector export to any of the user's preferred regions?
      // Direct matches (sector-typical) count full; opportunistic user picks
      // still nudge conviction but less. Together capped at 0.05.
      const sectorRegions = SECTOR_EXPORT_DESTINATIONS[t.sec || ''] || []
      const sectorRegionIds = new Set(sectorRegions.map((r) => r.id))
      let geoBoost = 0
      for (const prefId of inputs.preferredGeographies) {
        if (sectorRegionIds.has(prefId as ExportRegionId)) geoBoost += 0.02
        else geoBoost += 0.005 // opportunistic — user picked a non-sector-typical corridor
      }
      preferenceBoost += Math.min(0.05, geoBoost)
    }
    // Target VC-stage boost — reward targets whose comp[] maps into one of
    // the user's target stages. Each stage hit adds a small increment up
    // to a 0.04 ceiling. Stage-level targeting is one level above
    // sub-segment targeting: if the user picks a stage without drilling
    // into specific sub-segments, any target touching that stage benefits.
    if (inputs.targetStages?.length) {
      const tComps = (t.comp || []).map((c) => c.toLowerCase())
      const hits = tComps.filter((c) => {
        const stg = COMP_TO_STAGE_CODE[c]
        return stg && inputs.targetStages!.includes(stg)
      }).length
      if (hits > 0) preferenceBoost += Math.min(0.04, hits * 0.02)
    }
    // Target industry boost — lightweight, since sectorsOfInterest already
    // does most of the industry-level work. This just nudges targets whose
    // mapped industry code is in the user's target industries set.
    if (inputs.targetIndustries?.length) {
      const indCode = industryCodeFor(t.sec)
      if (indCode && inputs.targetIndustries.includes(indCode)) preferenceBoost += 0.02
    }
    // ── Market-intelligence boosts ─────────────────────────────────
    // Country regime — average policy score across matched regimes,
    // weighted into a small boost. Caps at +0.04 on its own.
    if (inputs.preferredCountryRegimes?.length) {
      const regimeFit = scoreCountryRegimeFit(t, inputs.preferredCountryRegimes)
      if (regimeFit.list.length > 0) {
        preferenceBoost += Math.min(0.04, regimeFit.score * 0.05)
      }
    }
    // Trade-flow corridor — strong signal when the analyst explicitly
    // targets a net-importer corridor and the target's comp[] aligns.
    if (inputs.preferredTradeFlowCorridors?.length) {
      const flowFit = scoreTradeFlowFit(t, inputs.preferredTradeFlowCorridors)
      if (flowFit.list.length > 0) {
        preferenceBoost += Math.min(0.05, flowFit.score * 0.06)
      }
    }
    // Asset-type fit — crisp match on strategic intent.
    if (inputs.preferredTargetAssetTypes?.length) {
      const assetFit = scoreAssetTypeFit(acquirer.sec || '', t.sec || '', integrationDir, inputs.preferredTargetAssetTypes)
      if (assetFit.score > 0.5) preferenceBoost += 0.03
    }
    // Customer-concentration soft penalty — if the analyst set a max,
    // subtract a small amount when the proxy blows past it.
    if (inputs.maxCustomerConcentration && inputs.maxCustomerConcentration > 0) {
      const inferred = inferCustomerConcentration(t)
      if (inferred > inputs.maxCustomerConcentration) {
        preferenceBoost -= 0.02
      }
    }
    preferenceBoost = Math.min(0.15, Math.max(-0.15, preferenceBoost))

    // Exclusion handling — moved to the pre-screen loop above as a
    // HARD filter (drops the target from the pool entirely), so nothing
    // to do here. The UI labels these "excluded" with a strike-through,
    // so a soft penalty was the wrong shape — analysts expected the
    // cards to disappear, not just rank lower.

    return {
      ticker: t.ticker,
      name: t.name,
      sec: t.sec || '',
      sub: t.comp || [],
      mktcapCr: t.mktcap || 0,
      revCr: t.rev || 0,
      ebitdaCr: t.ebitda || 0,
      evCr: ev,
      revGrowthPct: t.revg || 0,
      ebitdaMarginPct: t.ebm || 0,
      acqsScore: t.acqs || 5,
      conviction: clamp01(conviction + preferenceBoost),
      subScores: subs,
      horizon,
      rationale: composeRationale(t, subs, inputs, integrationDir, subSeg.overlap, policy.list),
      dealSizeCr,
      vcPosition: vcPos,
      integrationDir,
      overlappingSubSegments: subSeg.overlap,
      bcg,
      mckinsey,
      integrationMode,
      dealStructure: dealStructureId,
      dealStructureLabel,
      synergy,
      valuation,
      policyTailwinds: policy.list,
      memo,
      shareholding,
      hostileExposure,
      acquisitionStrategy,
    }
  })

  scored.sort((a, b) => b.conviction - a.conviction)
  return scored
}

// ════════════════════════════════════════════════════════════════
// Shareholding · hostile exposure · legal path · lender map ·
// balance-sheet projection · placement narrative.
// All deterministic, no external calls.
// ════════════════════════════════════════════════════════════════

export interface ShareholdingProfile {
  /** Estimated promoter stake (%). Proxied from acqs + ownership
   *  heuristics when the company record doesn't carry an explicit
   *  shareholding column. */
  promoterPct: number
  publicFloatPct: number
  /** "Tight" = promoter >= 60%, "Balanced" 40-60%, "Dispersed" < 40%. */
  band: 'tight' | 'balanced' | 'dispersed'
  notes: string[]
}

export interface HostileExposure {
  /** True when the target is vulnerable to a hostile tender offer. */
  exposed: boolean
  severity: 'low' | 'medium' | 'high'
  triggers: string[]
  /** SEBI SAST 5% creeping acquisition threshold + 25% open-offer
   *  trigger + 75% mandatory-delisting band. */
  sastNotes: string[]
}

export interface AcquisitionStrategy {
  path: 'negotiated' | 'open_offer' | 'creeping' | 'asset_purchase' | 'scheme' | 'hostile'
  label: string
  steps: string[]
  legal: string[]
}

export interface LenderMatch {
  id: 'bank_syndicate' | 'nbfc' | 'pe_co_invest' | 'sovereign' | 'seller_finance' | 'bond_market' | 'mezzanine'
  label: string
  fitPct: number
  thesis: string
}

export interface BalanceSheetProjection {
  preDebtToEquity: number
  postDebtToEquity: number
  interestCoverageX: number | null
  cashGapCr: number
  verdict: string
}

export interface PlacementNarrative {
  preRevRankApprox: string
  postRevRankApprox: string
  preMktCapBand: string
  postMktCapBand: string
  narrative: string[]
}

export function analyseShareholding(target: Company): ShareholdingProfile {
  // Proxy promoter stake from debt/equity + acqs score. Listed mid-caps
  // with D/E > 1 tend to have tighter promoter hold (founder leverage);
  // state-owned / PSU (acqs 3-4 AVOID bucket) typically > 55% govt.
  // This is a proxy until an explicit promoter_pct column lands.
  const acqs = target.acqs || 5
  const dbtEq = target.dbt_eq || 0
  let promoterPct = 50
  if (acqs <= 3) promoterPct = 62 // PSU / govt-controlled
  else if (dbtEq > 1.2) promoterPct = 58 // founder-leveraged
  else if (target.mktcap >= 50_000) promoterPct = 48 // large cap, dispersed
  else if (target.mktcap >= 10_000) promoterPct = 52
  else promoterPct = 55 // small cap — usually tight
  const publicFloat = 100 - promoterPct
  const band: 'tight' | 'balanced' | 'dispersed' =
    promoterPct >= 60 ? 'tight' : promoterPct >= 40 ? 'balanced' : 'dispersed'
  const notes: string[] = []
  notes.push(`Proxy promoter holding ${promoterPct}% (inferred from acqs/${acqs}, D/E ${dbtEq.toFixed(2)}, mktcap band).`)
  notes.push(`Public float approx ${publicFloat}% — ${band === 'tight' ? 'negotiated deal is the only realistic path' : band === 'balanced' ? 'open-offer + promoter block together crosses 50%' : 'vulnerable to market accumulation'}.`)
  return { promoterPct, publicFloatPct: publicFloat, band, notes }
}

export function assessHostileExposure(
  target: Company,
  shareholding: ShareholdingProfile,
): HostileExposure {
  const triggers: string[] = []
  const sastNotes: string[] = [
    'SEBI SAST: a 5% creeping-acquisition window per year is allowed without disclosure beyond 2%.',
    '25% aggregate triggers a mandatory open offer for another 26%.',
    '75% crosses the mandatory-delisting threshold.',
  ]
  // Exposure signals
  if (shareholding.promoterPct < 40) triggers.push(`Promoter stake below 40% — bidder can accumulate ${50 - shareholding.promoterPct}pp from the open market.`)
  if (shareholding.promoterPct >= 40 && shareholding.promoterPct < 50) triggers.push(`Promoter stake 40-50% — bidder can match via SAST open offer without needing promoter consent.`)
  if ((target.mktcap || 0) > 0 && (target.mktcap || 0) < 5000) triggers.push('Small mktcap + high public float — low capital required for market accumulation.')
  if ((target.revg || 0) < 0) triggers.push('Revenue contracting — disaffected shareholders more likely to tender.')
  if ((target.acqs || 5) >= 8) triggers.push('High strategic attractiveness (acqs >= 8) — multiple bidders may compete.')
  const exposed = shareholding.promoterPct < 45 || shareholding.publicFloatPct > 55
  const severity: 'low' | 'medium' | 'high' =
    shareholding.promoterPct < 30 ? 'high' : shareholding.promoterPct < 45 ? 'medium' : 'low'
  return { exposed, severity, triggers, sastNotes }
}

export function recommendStrategy(
  inputs: OpInputs,
  target: Company,
  shareholding: ShareholdingProfile,
  hostile: HostileExposure,
  dealStructure: DealStructure,
): AcquisitionStrategy {
  const isAssetPurchase = dealStructure === 'asset_purchase'
  const isJv = dealStructure === 'jv'
  const isStrategic = dealStructure === 'strategic_stake'
  let path: AcquisitionStrategy['path']
  let label: string
  if (isAssetPurchase) {
    path = 'asset_purchase'; label = 'Asset Purchase (slump sale or itemised)'
  } else if (isJv) {
    path = 'scheme'; label = 'Joint Venture via NCLT Scheme'
  } else if (shareholding.band === 'tight') {
    path = 'negotiated'; label = 'Negotiated Block Acquisition'
  } else if (shareholding.band === 'balanced' && isStrategic) {
    path = 'open_offer'; label = 'SEBI SAST Open Offer + Negotiated Block'
  } else if (shareholding.band === 'dispersed' && hostile.severity === 'high') {
    // Dispersed float + high exposure → bidder can launch unilaterally.
    path = 'hostile'; label = 'Hostile Tender Offer (contested)'
  } else if (shareholding.band === 'dispersed' && hostile.severity !== 'low') {
    path = 'creeping'; label = 'Creeping Acquisition + Market Accumulation'
  } else {
    path = 'negotiated'; label = 'Negotiated Block + Tag-Along Rights'
  }
  const steps: string[] = []
  const legal: string[] = []
  switch (path) {
    case 'negotiated':
      steps.push('Initial outreach to promoter family office / PE holder → NDA + term sheet.')
      steps.push('Share-purchase agreement with customary reps, MAC clause, 10-15% escrow.')
      steps.push('Concurrent SEBI/CCI/FDI filings depending on size and sector.')
      legal.push('SEBI SAST Regulation 3 — if aggregate > 25%, trigger mandatory open offer for another 26%.')
      legal.push('Companies Act Section 230 route not required; direct share transfer via depository.')
      break
    case 'open_offer':
      steps.push('Announce SPA signing with promoter + simultaneous public-announcement (PA) of open offer.')
      steps.push('Deposit 25% of offer consideration in escrow within 2 working days of PA.')
      steps.push('Draft letter of offer → SEBI within 5 working days; 21-day comment window.')
      steps.push('Tendering period opens on day 12 post LOD; runs for 10 working days.')
      legal.push('SEBI SAST Regulations 3 & 4 — combined SPA + creeping crossing 25% mandates 26% open offer.')
      legal.push('Offer price: highest of negotiated SPA / 60-day VWAP / 52-week high for listed targets.')
      legal.push('If open offer fails to reach 90%, exit from delisting route; remain listed with new promoter.')
      break
    case 'creeping':
      steps.push('Accumulate up to 5% per year via on-market purchases (no PA required).')
      steps.push('Once crossing 25%, mandatory open offer for another 26% (same SAST rules).')
      steps.push('Build board-level influence via proxy solicitation + AGM resolutions.')
      legal.push('SEBI SAST Regulation 3(2) — creeping 5%/year window only available between 25-75% range.')
      legal.push('Disclosure triggers: every 2% incremental under Reg 29(2) within 2 working days.')
      break
    case 'asset_purchase':
      steps.push('Identify carve-out perimeter (plants / IP / brand) — avoid carrying target\u2019s liabilities.')
      steps.push('Slump-sale structured as going-concern transfer to a new SPV for tax efficiency.')
      steps.push('Board + shareholder resolution under Section 180(1)(a) Companies Act.')
      legal.push('Income-tax Act Section 50B — slump sale taxed at capital gains rates at target-entity level.')
      legal.push('Employee transfer via Section 25F ID Act if > 100 workers.')
      legal.push('Unlike share purchase, acquirer does NOT inherit target litigation / contingent liabilities.')
      break
    case 'scheme':
      steps.push('Draft scheme of arrangement (Section 230-232 Companies Act) — demerger or JV-formation.')
      steps.push('NCLT application; creditor + shareholder meetings (majority in number, 75% in value).')
      steps.push('Stamp duty implications vary state-by-state; structured carve-out can reduce burden.')
      legal.push('Companies Act Sections 230-232 — NCLT-driven, 6-9 month timeline; no SEBI open offer if effected via scheme.')
      legal.push('JV control pact governs board composition, reserved matters, exit ROFR.')
      break
    case 'hostile':
      steps.push('Strategic accumulation up to 5%/year creeping cap.')
      steps.push('Launch hostile open offer above market VWAP to force tendering.')
      steps.push('Court challenges likely — budget for 12-18 month legal calendar.')
      legal.push('Under SEBI SAST, a bidder can launch open offer unilaterally — no target-board consent required.')
      legal.push('Defensive measures typical: promoter buyback, poison-pill shareholder agreements (uncommon in India), white-knight sought by target.')
      break
  }
  // Append structure-specific footnote regardless of path
  if (inputs.porter.includes('focus')) steps.push('Focus strategy: limit first tranche to 26-51% stake; earn-out for remaining.')
  return { path, label, steps, legal }
}

/**
 * Lender matcher — deterministic rules. Returns an ordered list of
 * funding sources ranked by fit. Driven by deal size, structure, and
 * acquirer leverage.
 */
export function matchLenders(
  acquirer: Company,
  totalFundCr: number,
  dealStructures: DealStructure[],
): LenderMatch[] {
  const acqDE = acquirer.dbt_eq || 0
  const hasAssetPurchase = dealStructures.includes('asset_purchase')
  const hasJv = dealStructures.includes('jv')
  const out: LenderMatch[] = []
  // Bank syndicate — large strategic deals, secured against target cashflows
  out.push({
    id: 'bank_syndicate',
    label: 'Bank Syndicate (SBI / HDFC / Axis / ICICI lead)',
    fitPct: totalFundCr > 2000 ? 90 : 70,
    thesis: totalFundCr > 2000
      ? 'Club loan structure — Rs 2,000+ Cr typical syndication threshold. Priced at 8.5-10.5% depending on sector.'
      : 'Term loan from lead bank + bilateral with 2-3 relationship banks. Secured against target receivables + inventory.',
  })
  // NBFC — mid-market, flexibility on covenants
  out.push({
    id: 'nbfc',
    label: 'NBFC (Bajaj Finance / Piramal / Edelweiss Alt.)',
    fitPct: totalFundCr >= 500 && totalFundCr <= 3000 ? 85 : 55,
    thesis: 'Faster turnaround than banks, 200-400 bps costlier. Useful for LoI-to-close bridge (90-120 days).',
  })
  // PE co-invest — large equity tickets, strategic stake deals
  out.push({
    id: 'pe_co_invest',
    label: 'PE Co-Invest (KKR / Blackstone / Brookfield / TPG)',
    fitPct: totalFundCr > 3000 ? 92 : dealStructures.includes('strategic_stake') ? 80 : 60,
    thesis: totalFundCr > 3000
      ? 'Large-cheque equity — PE sponsor takes 20-49% alongside acquirer, exit at IPO or strategic sale in 5-7 years.'
      : 'Co-invest at the subsidiary / carve-out level; board seat + drag-along.',
  })
  // Sovereign — clean-energy, India focus
  out.push({
    id: 'sovereign',
    label: 'Sovereign / DFI (GIC / ADIA / IFC / ADB)',
    fitPct: (acquirer.sec?.toLowerCase() || '').match(/solar|wind|energy|infra/) ? 82 : 45,
    thesis: 'Patient capital, 10-15 year holds. Terms favour green/energy-transition themes.',
  })
  // Seller financing — only where promoter wants earn-out
  out.push({
    id: 'seller_finance',
    label: 'Seller Financing (earn-out / vendor loan)',
    fitPct: dealStructures.includes('strategic_stake') || dealStructures.includes('acquisition') ? 65 : 40,
    thesis: 'Deferred consideration tied to EBITDA milestones. Reduces upfront cash, aligns promoter incentives.',
  })
  // Bond market — large acquisitions, investment-grade acquirers
  out.push({
    id: 'bond_market',
    label: 'Bond Market (NCD private placement)',
    fitPct: totalFundCr > 5000 && acqDE < 1 ? 85 : 40,
    thesis: totalFundCr > 5000 && acqDE < 1
      ? 'Investment-grade acquirer with D/E < 1.0 can tap NCD market at 25-50 bps below bank rates.'
      : 'Acquirer\u2019s current leverage too high for IG rating — bond route deferred.',
  })
  // Mezzanine — bridge financing, higher coupon
  out.push({
    id: 'mezzanine',
    label: 'Mezzanine / Structured Debt',
    fitPct: acqDE > 1 || hasAssetPurchase ? 75 : 45,
    thesis: 'Convertible / warrant-attached debt — 14-18% coupon. Useful when senior debt is at capacity.',
  })
  void hasJv
  return out.sort((a, b) => b.fitPct - a.fitPct)
}

export function projectBalanceSheet(
  acquirer: Company,
  totalFundCr: number,
  selectedTargetRev: number,
  selectedTargetEbitda: number,
): BalanceSheetProjection {
  const acqRev = acquirer.rev || 0
  const acqEbitda = acquirer.ebitda || 0
  const acqDE = acquirer.dbt_eq || 0
  // Simplifying assumptions:
  //   - Book equity approximated from mktcap / p/b (or mktcap directly when p/b missing).
  //   - Acquirer finances 70% via debt, 30% equity / internal accruals.
  const pb = acquirer.pb || 3
  const bookEquity = (acquirer.mktcap || 0) / Math.max(pb, 0.5)
  const currentDebt = bookEquity * acqDE
  const debtRaised = totalFundCr * 0.7
  const newEquityDilution = totalFundCr * 0.3
  const postDebt = currentDebt + debtRaised
  const postEquity = bookEquity + newEquityDilution
  const preDE = acqDE
  const postDE = postEquity > 0 ? postDebt / postEquity : 0
  // Post-deal EBITDA = acquirer + 100% of target EBITDA (assume full consolidation).
  const postEbitda = acqEbitda + selectedTargetEbitda
  // Interest assumption: 9.5% on new debt.
  const interest = debtRaised * 0.095
  const interestCoverage = interest > 0 ? postEbitda / interest : null
  // Cash gap: fund requirement - (debt + equity raised).
  const cashGap = totalFundCr - (debtRaised + newEquityDilution)
  const verdict =
    postDE > 1.5
      ? 'Leverage stretched post-close. Prioritise strategic stake + seller financing over full acquisition, OR raise 40%+ equity tranche.'
      : postDE > 1
        ? 'Moderate post-close leverage. Monitor interest coverage; prepay in first 24 months if cash permits.'
        : 'Comfortable balance sheet post-close. Room for a second wave of tactical add-ons.'
  void acqRev
  void selectedTargetRev
  return {
    preDebtToEquity: preDE,
    postDebtToEquity: postDE,
    interestCoverageX: interestCoverage,
    cashGapCr: Math.max(0, Math.round(cashGap)),
    verdict,
  }
}

function mktCapBand(mc: number): string {
  if (mc < 1000) return 'Micro-cap (< ₹1,000 Cr)'
  if (mc < 10_000) return 'Small-cap (₹1,000-10,000 Cr)'
  if (mc < 50_000) return 'Mid-cap (₹10,000-50,000 Cr)'
  if (mc < 2_00_000) return 'Large-cap (₹50,000 Cr - ₹2 L Cr)'
  return 'Mega-cap (> ₹2 L Cr)'
}

export function narratePlacement(
  acquirer: Company,
  preRev: number,
  postRev: number,
  preMktCap: number,
  postMktCapEstimate: number,
): PlacementNarrative {
  const preBand = mktCapBand(preMktCap)
  const postBand = mktCapBand(postMktCapEstimate)
  const jumped = preBand !== postBand
  const narrative: string[] = []
  narrative.push(
    `Current: ${acquirer.name} sits in the ${preBand} band with ₹${Math.round(preRev).toLocaleString('en-IN')} Cr TTM revenue.`,
  )
  narrative.push(
    `Post-deal: revenue rises to ₹${Math.round(postRev).toLocaleString('en-IN')} Cr. Market-cap is projected at ₹${Math.round(postMktCapEstimate).toLocaleString('en-IN')} Cr (applying current EV/EBITDA multiple to combined profit pool).`,
  )
  if (jumped) {
    narrative.push(`The combined entity crosses into the ${postBand} band — category rerating is a realistic upside catalyst.`)
  } else {
    narrative.push(`Category band unchanged — the play is about depth (share, moat) rather than size.`)
  }
  narrative.push(
    `Sector placement: ${acquirer.sec || 'unclassified'}. With the additions, the combined unit becomes a vertically-integrated player with reach across more of the value chain.`,
  )
  return {
    preRevRankApprox: `Approx ₹${Math.round(preRev).toLocaleString('en-IN')} Cr`,
    postRevRankApprox: `Approx ₹${Math.round(postRev).toLocaleString('en-IN')} Cr`,
    preMktCapBand: preBand,
    postMktCapBand: postBand,
    narrative,
  }
}

/**
 * Framework-driven target count. Given the goal gap and the revenue
 * profile of the top ranked targets, compute how many deals the
 * analyst would need to close to bridge the gap. Used for the
 * "Target N of M" badge on each acquisition card.
 */
export function recommendTargetCount(
  acquirerRevCr: number,
  goalRevCr: number,
  ranked: OpTarget[],
  ownershipPct: number,
): { recommended: number; note: string } {
  const gap = Math.max(0, goalRevCr - acquirerRevCr)
  if (gap <= 0 || ranked.length === 0) {
    return { recommended: 0, note: 'Goal already met without inorganic growth.' }
  }
  // Average revenue of top-10 × ownership — the realistic per-deal
  // revenue uplift we can expect from the programme.
  const top = ranked.slice(0, 10)
  const avgRev = top.reduce((s, t) => s + t.revCr, 0) / top.length
  const perDeal = Math.max(1, avgRev * ownershipPct)
  // Include a 50% synergy capture on top of the target revenue.
  const perDealWithSyn = perDeal * 1.05 // conservative 5% uplift from half-capture
  const recommended = Math.max(1, Math.ceil(gap / perDealWithSyn))
  const note = `Bridging \u20B9${Math.round(gap).toLocaleString('en-IN')} Cr gap via ~\u20B9${Math.round(perDeal).toLocaleString('en-IN')} Cr revenue per target at ${(ownershipPct * 100).toFixed(0)}% ownership.`
  return { recommended, note }
}

// ── Plan roll-up ────────────────────────────────────────────────

export interface PlanInput {
  acquirerCurrentRevCr: number
  targetRevenueCr: number
  selected: OpTarget[]
  ownershipPct?: number
}

export interface PlanOutput {
  totalFundRequiredCr: number
  totalSynergyCr: number
  projectedRevCr: number
  gapToGoalCr: number
  isGoalAchievable: boolean
  cumulativeByMonth: Array<{ month: number; fund: number; rev: number }>
}

export function buildPlan(input: PlanInput): PlanOutput {
  const ownership = input.ownershipPct ?? 1.0
  const byMonth: Array<{ month: number; fund: number; rev: number }> = []
  let runFund = 0
  let runRev = input.acquirerCurrentRevCr
  let totalSynergy = 0
  const ordered = [...input.selected].sort((a, b) => a.horizon.months[1] - b.horizon.months[1])
  for (const t of ordered) {
    runFund += Math.round(t.dealSizeCr * ownership)
    runRev += Math.round(t.revCr * ownership)
    totalSynergy += t.synergy.totalCr
    byMonth.push({ month: t.horizon.months[1], fund: runFund, rev: runRev })
  }
  // Add 50% of the synergy pool to projected revenue (conservative
  // half-capture assumption — the rest hits cost base).
  const projWithSynergy = runRev + Math.round(totalSynergy * 0.5)
  const gap = input.targetRevenueCr - projWithSynergy
  return {
    totalFundRequiredCr: runFund,
    totalSynergyCr: totalSynergy,
    projectedRevCr: projWithSynergy,
    gapToGoalCr: gap,
    isGoalAchievable: gap <= 0,
    cumulativeByMonth: byMonth,
  }
}
