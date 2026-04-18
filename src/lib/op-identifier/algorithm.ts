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
import { getSubSegmentsForComp, getSubSegmentLabel } from '@/lib/data/sub-segments'
import {
  ANSOFF,
  type AnsoffVector,
  type PorterStrategy,
  type BcgQuadrant,
  type McKinseyHorizon,
  type IntegrationMode,
  type DealStructure,
  type VcPosition,
  horizonFor,
  type HorizonBand,
  vcPositionFor,
  integrationDirection,
  DEAL_STRUCTURES,
} from './frameworks'

export interface OpInputs {
  targetRevenueCr: number
  horizonMonths: number
  ansoff: AnsoffVector
  porter: PorterStrategy
  sectorsOfInterest: string[]
  dealSizeMinCr: number
  dealSizeMaxCr: number
  ownership: Array<'listed' | 'private' | 'subsidiary'>
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

function scoreAnsoffFit(acquirer: Company, target: Company, ansoff: AnsoffVector): number {
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

function scorePorterFit(target: Company, porter: PorterStrategy): number {
  const rev = target.rev || 0
  const m = target.ebm || 0
  switch (porter) {
    case 'cost': return clamp01(Math.min(rev / 1000, 1) * 0.5 + Math.min(m / 10, 1) * 0.5)
    case 'differentiation': return clamp01(Math.min(m / 15, 1) * 0.7 + ((target.subcomp && target.subcomp.length > 0) ? 0.3 : 0))
    case 'focus': return clamp01((rev > 0 && rev < 1000 ? 1 : Math.max(0, 1 - (rev - 1000) / 2000)) * 0.5 + Math.min(m / 8, 1) * 0.5)
  }
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
  const focusTilt = inputs.porter === 'focus'
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
  const ansoffMeta = ANSOFF.find((a) => a.id === inputs.ansoff)
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
  const ansoffMeta = ANSOFF.find((a) => a.id === inputs.ansoff)
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
    const takeoverMultiple = inputs.porter === 'focus' ? 0.55 : 1.25
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
      conviction: clamp01(conviction),
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
    }
  })

  scored.sort((a, b) => b.conviction - a.conviction)
  return scored
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
