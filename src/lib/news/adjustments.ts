/**
 * Central helper that converts a per-company news aggregate into a
 * structured pre/post metrics record. Every page that displays EV/EBITDA,
 * acquisition score, revenue growth, or EBITDA margin can use this so
 * the pre/post presentation is consistent across the app.
 *
 * Only acknowledged items contribute to `post`. Nothing is double-counted
 * because the aggregator already dedupes by (ticker, itemKey).
 */

import type { Company } from '@/lib/data/companies'
import type { CompanyNewsAggregate } from './impact'
import { clampAdjustedValue, type ValuationParam } from './params'

export interface CompanyMetricsSnapshot {
  acqs: number
  ev_eb: number
  revg: number
  ebm: number
  ev: number
}

export interface CompanyAdjustedMetrics {
  /** Baseline values from the Company object (no news applied). */
  pre: CompanyMetricsSnapshot
  /** Post-acknowledgement values (news impact applied). */
  post: CompanyMetricsSnapshot
  /** % change from pre to post, per field. Zero when no acks. */
  deltaPct: CompanyMetricsSnapshot
  /** True when at least one acknowledged item contributes. */
  hasAdjustment: boolean
  /** Number of acknowledged items contributing. */
  acknowledgedCount: number
}

/**
 * Strategic 7-driver weights for composing a news-derived composite
 * acquisition-score delta from individual parameter deltas.
 *
 * Total of listed weights is 0.75 — the remaining 0.25 covers drivers
 * we don't model yet (tech obsolescence, market share size). The
 * composite delta is normalised inside the function.
 */
const ACQ_SCORE_WEIGHTS: Partial<Record<ValuationParam, number>> = {
  revenue_growth: 0.25,
  management: 0.15,
  barriers_to_entry: 0.15,
  ebitda_margin: 0.1,
  concentration_risk: 0.1,
}

/** Damping factor — news moves the composite less than individual params. */
const ACQ_SCORE_DAMPING = 0.5

export function computeAdjustedMetrics(
  co: Company,
  agg: CompanyNewsAggregate | undefined
): CompanyAdjustedMetrics {
  const pre: CompanyMetricsSnapshot = {
    acqs: co.acqs,
    ev_eb: co.ev_eb,
    revg: co.revg,
    ebm: co.ebm,
    ev: co.ev,
  }
  const emptyDelta: CompanyMetricsSnapshot = {
    acqs: 0,
    ev_eb: 0,
    revg: 0,
    ebm: 0,
    ev: 0,
  }

  if (!agg || agg.acknowledgedCount === 0) {
    return {
      pre,
      post: { ...pre },
      deltaPct: emptyDelta,
      hasAdjustment: false,
      acknowledgedCount: 0,
    }
  }

  const factorOf = (p: ValuationParam): number =>
    agg.paramAdjustments[p]?.adjustmentFactor ?? 0

  // Direct per-parameter application on the baseline values
  const revg =
    co.revg !== 0
      ? clampAdjustedValue('revenue_growth', co.revg * (1 + factorOf('revenue_growth')))
      : co.revg
  const ebm =
    co.ebm !== 0
      ? clampAdjustedValue('ebitda_margin', co.ebm * (1 + factorOf('ebitda_margin')))
      : co.ebm
  const ev_eb =
    co.ev_eb !== 0
      ? clampAdjustedValue(
          'ev_ebitda_multiple',
          co.ev_eb * (1 + factorOf('ev_ebitda_multiple'))
        )
      : co.ev_eb

  // Composite Strategic Analysis acquisition-score delta:
  //   weighted average of affecting parameter factors, normalised by
  //   the sum of weights that actually had news signal attached,
  //   damped by 50%.
  let weightedSum = 0
  let totalWeight = 0
  for (const [param, weight] of Object.entries(ACQ_SCORE_WEIGHTS) as Array<
    [ValuationParam, number]
  >) {
    const f = factorOf(param)
    if (f !== 0) {
      weightedSum += f * weight
      totalWeight += weight
    }
  }
  const acqsFactor =
    totalWeight > 0 ? (weightedSum / totalWeight) * ACQ_SCORE_DAMPING : 0
  const acqs = Math.max(0, Math.min(10, co.acqs * (1 + acqsFactor)))

  // Enterprise Value — derived from EV/EBITDA × EBITDA.
  // Post-EBITDA uses the adjusted margin if we have a revenue figure,
  // otherwise we just apply the multiple delta to the existing EV.
  let ev = co.ev
  if (co.rev > 0 && ebm > 0 && ev_eb > 0) {
    const postEbitda = (co.rev * ebm) / 100
    ev = ev_eb * postEbitda
  } else if (co.ev > 0) {
    ev = co.ev * (1 + factorOf('ev_ebitda_multiple'))
  }

  const post: CompanyMetricsSnapshot = { acqs, ev_eb, revg, ebm, ev }

  const pct = (after: number, before: number): number => {
    if (!before) return 0
    return ((after - before) / before) * 100
  }
  const deltaPct: CompanyMetricsSnapshot = {
    acqs: round2(pct(post.acqs, pre.acqs)),
    ev_eb: round2(pct(post.ev_eb, pre.ev_eb)),
    revg: round2(pct(post.revg, pre.revg)),
    ebm: round2(pct(post.ebm, pre.ebm)),
    ev: round2(pct(post.ev, pre.ev)),
  }

  return {
    pre,
    post,
    deltaPct,
    hasAdjustment: true,
    acknowledgedCount: agg.acknowledgedCount,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Compact string like "14.7× → 15.1× (+2.7%)" for popups and footers. */
export function formatPrePost(
  pre: number,
  post: number,
  unit: '%' | '×' | '/10',
  digits = 1
): string {
  const fmt = (v: number): string => {
    if (unit === '×') return v.toFixed(2) + '×'
    if (unit === '/10') return v.toFixed(1) + '/10'
    return v.toFixed(digits) + '%'
  }
  if (pre === post || !pre) return fmt(pre)
  const delta = ((post - pre) / pre) * 100
  const sign = delta > 0 ? '+' : ''
  return `${fmt(pre)} → ${fmt(post)} (${sign}${delta.toFixed(2)}%)`
}
