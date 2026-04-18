/**
 * Op Identifier scoring algorithm — fully deterministic.
 *
 * Given:
 *   1. An ACQUIRER company (picked by the analyst from the live DB)
 *   2. A set of INPUTS the analyst supplies (growth ambition, chosen
 *      Ansoff vector, Porter strategy, sectors of interest, deal-size
 *      band, ownership filter)
 *   3. The UNIVERSE of candidate targets from useLiveSnapshot
 *
 * We produce:
 *   - A ranked list of targets with conviction %
 *   - Sub-scores (sectorFit, sizeFit, growthFit, marginFit, ansoffFit,
 *     porterFit) so the UI can break down WHY a target ranked where it
 *     did
 *   - A composed rationale string per target (plain English, built from
 *     the sub-scores — no LLM)
 *   - Horizon bucketing (0-12 / 12-24 / 24-36 months) driven by EV band
 *
 * Zero external API calls. Runs entirely client-side on the merged
 * allCompanies + atlasListed universe.
 */

import type { Company } from '@/lib/data/companies'
import {
  ANSOFF,
  type AnsoffVector,
  type PorterStrategy,
  horizonFor,
  type HorizonBand,
} from './frameworks'

export interface OpInputs {
  /** Analyst's 3-year revenue goal for the acquirer (₹Cr). */
  targetRevenueCr: number
  /** How many months the analyst gives themselves to hit the goal. */
  horizonMonths: number
  /** Which Ansoff cell the analyst has chosen to pursue. */
  ansoff: AnsoffVector
  /** Porter generic strategy the acquirer is leaning into. */
  porter: PorterStrategy
  /** Industries of interest — matched against target.sec. */
  sectorsOfInterest: string[]
  /** Deal-size band the analyst will entertain (₹Cr EV). */
  dealSizeMinCr: number
  dealSizeMaxCr: number
  /** Ownership filter. Empty = any. */
  ownership: Array<'listed' | 'private' | 'subsidiary'>
}

export interface OpSubScores {
  sectorFit: number
  sizeFit: number
  growthFit: number
  marginFit: number
  ansoffFit: number
  porterFit: number
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
  /** Natural-language rationale — built from the sub-scores. */
  rationale: string[]
  /** Estimated deal size (what acquirer would pay, ₹Cr). */
  dealSizeCr: number
}

/**
 * Sub-score weights. Sum = 1.0. Exposed for a future "Tune" drawer so
 * the analyst can dial up/down what matters. Defaults favour sector +
 * size alignment because those are the two most deterministic gates.
 */
export const DEFAULT_WEIGHTS: Record<keyof OpSubScores, number> = {
  sectorFit: 0.25,
  sizeFit: 0.20,
  growthFit: 0.20,
  marginFit: 0.15,
  ansoffFit: 0.10,
  porterFit: 0.10,
}

/** Clamp a value to [0, 1]. */
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

/**
 * Sector-fit: 1.0 when the target's sec exactly matches one of the
 * acquirer's sectors-of-interest. Partial credit for a label-word
 * overlap (e.g. acquirer wants "solar" → target.sec = "solar_pv_and_
 * renewable_energy" still matches with 0.7). Zero when no overlap.
 */
function scoreSectorFit(target: Company, sectorsOfInterest: string[]): number {
  if (sectorsOfInterest.length === 0) return 0.5 // neutral when unconstrained
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

/**
 * Size-fit: 1.0 when the target's EV lies squarely in the analyst's
 * deal-size band. Decays linearly outside, so an EV 20% above max still
 * scores ~0.8 instead of falling off a cliff — otherwise a single SME
 * rule would knock out obvious wins.
 */
function scoreSizeFit(target: Company, minCr: number, maxCr: number): number {
  const ev = target.ev || target.mktcap || 0
  if (ev <= 0) return 0
  if (ev >= minCr && ev <= maxCr) return 1
  const mid = (minCr + maxCr) / 2 || 1
  const spread = Math.max(maxCr - minCr, 1)
  const delta = ev < minCr ? (minCr - ev) / mid : (ev - maxCr) / mid
  return clamp01(1 - delta * (1 / Math.max(spread / mid, 0.25)))
}

/**
 * Growth-fit: 1.0 at 25% YoY revenue growth, scales linearly. Above
 * 50% is clipped to 1.0 (those are often one-off comparables). Negative
 * growth floors at 0.
 */
function scoreGrowthFit(target: Company): number {
  const g = target.revg ?? 0
  return clamp01(g / 25)
}

/**
 * Margin-fit: 1.0 at 20% EBITDA margin, scales linearly to 0 at 0% and
 * 1.0 above 20%.
 */
function scoreMarginFit(target: Company): number {
  const m = target.ebm ?? 0
  return clamp01(m / 20)
}

/**
 * Ansoff-fit: compares acquirer's sec + comp with target's sec + comp.
 *
 *   market_penetration   — same sec + same comp overlap → 1.0
 *   product_development  — same sec + different comp → 1.0
 *   market_development   — different sec + comp overlap → 1.0
 *   diversification      — different sec + different comp → 1.0
 */
function scoreAnsoffFit(
  acquirer: Company,
  target: Company,
  ansoff: AnsoffVector,
): number {
  const sameSec = normaliseSec(acquirer.sec) === normaliseSec(target.sec) && !!acquirer.sec
  const acqComp = new Set((acquirer.comp || []).map((c) => c.toLowerCase()))
  const tgtComp = new Set((target.comp || []).map((c) => c.toLowerCase()))
  let overlap = 0
  for (const c of Array.from(acqComp)) if (tgtComp.has(c)) overlap++
  const hasOverlap = overlap > 0
  switch (ansoff) {
    case 'market_penetration':
      return sameSec && hasOverlap ? 1 : sameSec ? 0.7 : 0.2
    case 'product_development':
      return sameSec && !hasOverlap ? 1 : sameSec ? 0.75 : 0.3
    case 'market_development':
      return !sameSec && hasOverlap ? 1 : !sameSec ? 0.6 : 0.4
    case 'diversification':
      return !sameSec && !hasOverlap ? 1 : 0.5
  }
}

/**
 * Porter-fit: target profile match.
 *
 *   cost            → target revenue ≥ 1,000 Cr AND margin ≥ 10%
 *   differentiation → target margin > sector median proxy (15% here)
 *                     OR specialised sub-segment tag
 *   focus           → target revenue < 1,000 Cr AND margin ≥ 8%
 */
function scorePorterFit(target: Company, porter: PorterStrategy): number {
  const rev = target.rev || 0
  const m = target.ebm || 0
  switch (porter) {
    case 'cost':
      return clamp01(Math.min(rev / 1000, 1) * 0.5 + Math.min(m / 10, 1) * 0.5)
    case 'differentiation':
      return clamp01(Math.min(m / 15, 1) * 0.7 + (target.subcomp && target.subcomp.length > 0 ? 0.3 : 0))
    case 'focus':
      return clamp01((rev > 0 && rev < 1000 ? 1 : Math.max(0, 1 - (rev - 1000) / 2000)) * 0.5 + Math.min(m / 8, 1) * 0.5)
  }
}

/**
 * Build a per-target natural-language rationale from the numeric
 * sub-scores. Deliberately deterministic — every bullet maps to a
 * specific sub-score + its inputs so the analyst can always trace why
 * the algorithm ranked as it did.
 */
function composeRationale(
  target: Company,
  acquirer: Company,
  subs: OpSubScores,
  inputs: OpInputs,
): string[] {
  const lines: string[] = []
  const ansoffMeta = ANSOFF.find((a) => a.id === inputs.ansoff)
  if (subs.sectorFit >= 0.85) {
    lines.push(
      `Direct sector match (${target.sec || 'n/a'}) with the acquirer\u2019s focus set \u2014 lowest cross-industry integration risk.`,
    )
  } else if (subs.sectorFit >= 0.5) {
    lines.push(
      `Adjacent sector alignment (${target.sec || 'n/a'}) \u2014 acquirer\u2019s value chain extends naturally into this space.`,
    )
  } else {
    lines.push(
      `Outside acquirer\u2019s stated sectors of interest, ranks on financial fundamentals alone. Include only if diversification is sought.`,
    )
  }
  const ev = target.ev || target.mktcap || 0
  if (subs.sizeFit >= 0.9) {
    lines.push(
      `EV of \u20B9${Math.round(ev).toLocaleString('en-IN')} Cr sits inside the requested \u20B9${inputs.dealSizeMinCr.toLocaleString('en-IN')}\u2013${inputs.dealSizeMaxCr.toLocaleString('en-IN')} Cr band.`,
    )
  } else if (subs.sizeFit >= 0.5) {
    lines.push(
      `EV of \u20B9${Math.round(ev).toLocaleString('en-IN')} Cr is ${ev < inputs.dealSizeMinCr ? 'below' : 'above'} the requested band \u2014 negotiable with a stake instead of full acquisition.`,
    )
  } else {
    lines.push(
      `EV of \u20B9${Math.round(ev).toLocaleString('en-IN')} Cr is well outside the deal-size band; included only for completeness.`,
    )
  }
  const g = target.revg ?? 0
  if (g >= 25) lines.push(`Revenue growth ${g.toFixed(1)}% YoY tracks with the acquirer\u2019s ambition curve.`)
  else if (g >= 10) lines.push(`Revenue growth ${g.toFixed(1)}% YoY \u2014 steady compounder, not a breakout story.`)
  else if (g > 0) lines.push(`Revenue growth ${g.toFixed(1)}% YoY is modest; acquisition logic leans on synergy, not organic.`)
  else lines.push(`Revenue growth flat/negative \u2014 turnaround play; requires active post-close interventions.`)

  const m = target.ebm ?? 0
  if (m >= 15) lines.push(`EBITDA margin ${m.toFixed(1)}% implies defensible pricing power.`)
  else if (m >= 8) lines.push(`EBITDA margin ${m.toFixed(1)}% is sector-average \u2014 no premium, no stress.`)
  else if (m > 0) lines.push(`EBITDA margin ${m.toFixed(1)}% is thin; price accordingly or plan for cost-out.`)

  if (subs.ansoffFit >= 0.9 && ansoffMeta) {
    lines.push(
      `${ansoffMeta.label} fit: ${ansoffMeta.thesis}`,
    )
  } else if (subs.ansoffFit < 0.5 && ansoffMeta) {
    lines.push(
      `Weak ${ansoffMeta.label} fit \u2014 target sits off-axis from the Ansoff move the acquirer has picked.`,
    )
  }

  const porterLabel =
    inputs.porter === 'cost' ? 'Cost Leadership' : inputs.porter === 'differentiation' ? 'Differentiation' : 'Focus'
  if (subs.porterFit >= 0.8) lines.push(`Profile matches a ${porterLabel} strategy \u2014 financials reinforce that posture.`)
  else if (subs.porterFit >= 0.5) lines.push(`Partial ${porterLabel} fit \u2014 works with adjustments to the deal thesis.`)

  // Always mention acqs for context (admin-curated baseline score)
  lines.push(
    `DealNector acquisition score: ${target.acqs}/10 \u2014 ${target.acqf || 'MONITOR'}${target.rea ? '. ' + target.rea.slice(0, 140) + (target.rea.length > 140 ? '\u2026' : '') : ''}`,
  )

  void acquirer
  return lines
}

/**
 * Main entry point. Pre-screens the universe, scores survivors, ranks
 * by conviction, buckets by horizon, composes per-target rationale.
 */
export function identifyTargets(
  acquirer: Company,
  universe: Company[],
  inputs: OpInputs,
  weights: Record<keyof OpSubScores, number> = DEFAULT_WEIGHTS,
): OpTarget[] {
  // ── Pre-screen ─────────────────────────────────────────────
  const seen = new Set<string>()
  const screened: Company[] = []
  for (const c of universe) {
    if (!c || !c.ticker) continue
    if (seen.has(c.ticker)) continue
    seen.add(c.ticker)
    if (c.ticker === acquirer.ticker) continue
    // Must have SOME financial signal to score.
    const hasSignal = (c.mktcap || 0) > 0 || (c.rev || 0) > 0 || (c.ebitda || 0) > 0
    if (!hasSignal) continue
    // Ownership filter (if provided) — static COMPANIES doesn't carry
    // an explicit `own` field, so we approximate: acqs < 5 tends to be
    // private/subsidiary, acqs >= 5 tends to be listed. This is the
    // best signal available without an upstream owner column.
    if (inputs.ownership.length > 0) {
      const approx: 'listed' | 'private' | 'subsidiary' =
        c.acqs >= 5 ? 'listed' : c.acqs >= 3 ? 'subsidiary' : 'private'
      if (!inputs.ownership.includes(approx)) continue
    }
    screened.push(c)
  }

  // ── Score ─────────────────────────────────────────────────
  const scored: OpTarget[] = screened.map((t) => {
    const subs: OpSubScores = {
      sectorFit: scoreSectorFit(t, inputs.sectorsOfInterest),
      sizeFit: scoreSizeFit(t, inputs.dealSizeMinCr, inputs.dealSizeMaxCr),
      growthFit: scoreGrowthFit(t),
      marginFit: scoreMarginFit(t),
      ansoffFit: scoreAnsoffFit(acquirer, t, inputs.ansoff),
      porterFit: scorePorterFit(t, inputs.porter),
    }
    const conviction =
      subs.sectorFit * weights.sectorFit +
      subs.sizeFit * weights.sizeFit +
      subs.growthFit * weights.growthFit +
      subs.marginFit * weights.marginFit +
      subs.ansoffFit * weights.ansoffFit +
      subs.porterFit * weights.porterFit
    const ev = t.ev || t.mktcap || 0
    const horizon = horizonFor(ev)
    // Deal size estimate: for listed targets assume a full-takeover
    // premium of ~25% over current EV. Adjust downward for Focus
    // strategy where a strategic stake (51%) is often enough.
    const takeoverMultiple = inputs.porter === 'focus' ? 0.55 : 1.25
    const dealSizeCr = Math.round(ev * takeoverMultiple)
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
      rationale: composeRationale(t, acquirer, subs, inputs),
      dealSizeCr,
    }
  })

  // ── Rank ──────────────────────────────────────────────────
  scored.sort((a, b) => b.conviction - a.conviction)

  return scored
}

/**
 * Plan roll-up. Given a ranked target list and an ordered horizon
 * roster (analyst chose which targets to actually pursue), emit:
 *   - cumulative fund requirement
 *   - cumulative revenue uplift from each closed target
 *   - a verdict on whether the acquirer's 3-year target is reachable
 */
export interface PlanInput {
  acquirerCurrentRevCr: number
  targetRevenueCr: number
  selected: OpTarget[]
  /** Ownership share the acquirer will take per target (0.51 default). */
  ownershipPct?: number
}

export interface PlanOutput {
  totalFundRequiredCr: number
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
  // Close in ascending month of horizon.upper-bound.
  const ordered = [...input.selected].sort((a, b) => a.horizon.months[1] - b.horizon.months[1])
  for (const t of ordered) {
    runFund += Math.round(t.dealSizeCr * ownership)
    runRev += Math.round(t.revCr * ownership)
    byMonth.push({ month: t.horizon.months[1], fund: runFund, rev: runRev })
  }
  const gap = input.targetRevenueCr - runRev
  return {
    totalFundRequiredCr: runFund,
    projectedRevCr: runRev,
    gapToGoalCr: gap,
    isGoalAchievable: gap <= 0,
    cumulativeByMonth: byMonth,
  }
}
