/**
 * Valuation parameters that news can impact.
 *
 * Each parameter has a list of regex clusters that identify it in
 * headline + description text. The `computeParamDegrees()` helper
 * returns a per-parameter auto-degree in 0..100 based on how strongly
 * the text matches the cluster + the overall sentiment magnitude.
 *
 * The degree is always an unsigned magnitude. The *direction* in which
 * the degree applies to the baseline comes from the news sentiment
 * combined with the parameter's polarity (+1 = positive news raises the
 * value, −1 = positive news lowers the value, e.g. WACC, concentration
 * risk).
 *
 * Users can override the auto degree with a signed manual value
 * (−100..+100). Manual values bypass polarity inference entirely —
 * the sign IS the direction.
 */

export type ValuationParam =
  | 'revenue_growth'
  | 'ebitda_margin'
  | 'management'
  | 'barriers_to_entry'
  | 'concentration_risk'
  | 'wacc'
  | 'ev_ebitda_multiple'

export interface ValuationParamDef {
  id: ValuationParam
  label: string
  short: string
  unit: '%' | '×' | '/10'
  /** +1 = positive news raises value; −1 = positive news lowers value */
  polarity: 1 | -1
  /** Regex clusters that identify this parameter in headlines */
  patterns: RegExp[]
  /** Category-specific multiplier bumps (e.g. regulatory news doubles
   *  barriers_to_entry degree). */
  categoryBoost?: Record<string, number>
}

export const PARAM_DEFS: Record<ValuationParam, ValuationParamDef> = {
  revenue_growth: {
    id: 'revenue_growth',
    label: 'Revenue Growth',
    short: 'Rev Gr',
    unit: '%',
    polarity: 1,
    patterns: [
      /\b(revenue|sales|turnover|top[- ]line|order book|order win|contract win|booking|backlog)\b/i,
      /\b(guidance|outlook|demand|capacity addition|ramp[- ]up|expansion|new plant|new factory)\b/i,
    ],
    categoryBoost: { financial: 1.3, operational: 1.2 },
  },
  ebitda_margin: {
    id: 'ebitda_margin',
    label: 'EBITDA Margin',
    short: 'EBITDA %',
    unit: '%',
    polarity: 1,
    patterns: [
      /\b(margin|profitability|cost|input price|raw material|polysilicon|commodity|pricing pressure)\b/i,
      /\b(gross margin|operating margin|ebitda margin|cost overrun|efficiency)\b/i,
    ],
    categoryBoost: { financial: 1.3, operational: 1.1 },
  },
  management: {
    id: 'management',
    label: 'Management Score',
    short: 'Mgmt',
    unit: '/10',
    polarity: 1,
    patterns: [
      /\b(ceo|cfo|managing director|chairman|md|executive|leadership|board|promoter|founder)\b/i,
      /\b(resignation|resigned|appointed|steps? down|takeover|governance|fraud|insider|scandal)\b/i,
    ],
    categoryBoost: { strategic: 1.4 },
  },
  barriers_to_entry: {
    id: 'barriers_to_entry',
    label: 'Barriers to Entry',
    short: 'Moat',
    unit: '/10',
    polarity: 1,
    patterns: [
      /\b(almm|pli|bcd|basic customs duty|anti[- ]dumping|tariff|protection|certification|bis)\b/i,
      /\b(license|approval|empanelment|pre[- ]qualification|market share|dominant|leader)\b/i,
    ],
    categoryBoost: { regulatory: 1.5, strategic: 1.2 },
  },
  concentration_risk: {
    id: 'concentration_risk',
    label: 'Concentration Risk',
    short: 'Conc Risk',
    unit: '/10',
    polarity: -1,
    patterns: [
      /\b(single customer|concentration|key client|anchor customer|off[- ]taker|discom default)\b/i,
      /\b(diversif|multiple markets|export|geographic mix|client base)\b/i,
    ],
  },
  wacc: {
    id: 'wacc',
    label: 'WACC',
    short: 'WACC',
    unit: '%',
    polarity: -1,
    patterns: [
      /\b(debt|leverage|borrowing|credit rating|downgrade|upgrade|bond|refinanc|interest rate|repo)\b/i,
      /\b(default|npa|bankrupt|nclt|insolvency|working capital|liquidity)\b/i,
    ],
    categoryBoost: { financial: 1.4 },
  },
  ev_ebitda_multiple: {
    id: 'ev_ebitda_multiple',
    label: 'EV/EBITDA Multiple',
    short: 'EV/EBITDA',
    unit: '×',
    polarity: 1,
    patterns: [
      /\b(valuation|multiple|re[- ]rat|de[- ]rat|ev\/ebitda|p\/e|price target|stock rallies|stock falls|listing)\b/i,
    ],
  },
}

export const PARAM_ORDER: ValuationParam[] = [
  'revenue_growth',
  'ebitda_margin',
  'management',
  'barriers_to_entry',
  'concentration_risk',
  'wacc',
  'ev_ebitda_multiple',
]

/**
 * Compute unsigned auto-degree (0..100) per affected parameter based
 * on keyword match strength × sentiment magnitude × category boost.
 * Returns only parameters that actually matched.
 */
export function computeParamDegrees(
  text: string,
  sentimentScore: number,
  category: string
): Partial<Record<ValuationParam, number>> {
  const out: Partial<Record<ValuationParam, number>> = {}
  const sentMag = Math.min(1, Math.abs(sentimentScore) / 5) // 0..1
  if (sentMag === 0) return out

  for (const def of Object.values(PARAM_DEFS)) {
    let matches = 0
    for (const re of def.patterns) {
      if (re.test(text)) matches++
    }
    if (matches === 0) continue
    const matchStrength = matches / def.patterns.length // 0..1
    let degree = matchStrength * sentMag * 70 // max 70% base
    const boost = def.categoryBoost?.[category] || 1
    degree *= boost
    degree = Math.min(100, Math.max(0, Math.round(degree)))
    if (degree > 0) out[def.id] = degree
  }
  return out
}

/**
 * Look up a numeric baseline for a parameter from a Company record.
 * Returns null when we don't have a meaningful baseline (e.g. revg=0).
 */
export function getBaseValue(
  param: ValuationParam,
  co: { acqs: number; revg: number; ebm: number; ev_eb: number; dbt_eq: number }
): number | null {
  switch (param) {
    case 'revenue_growth':
      return co.revg > 0 ? co.revg : null
    case 'ebitda_margin':
      return co.ebm > 0 ? co.ebm : null
    case 'management':
      // Use acqs as a management quality proxy
      return co.acqs > 0 ? co.acqs : null
    case 'barriers_to_entry':
      // Synthetic 7/10 baseline for Indian solar + T&D coverage universe
      return 7
    case 'concentration_risk':
      // Synthetic 5/10 baseline (lower is better)
      return 5
    case 'wacc':
      // Synthetic 12% baseline (matches our DCF default)
      return 12
    case 'ev_ebitda_multiple':
      return co.ev_eb > 0 ? co.ev_eb : null
  }
}

/** Pretty format a parameter value with its unit. */
export function formatParamValue(param: ValuationParam, value: number): string {
  const def = PARAM_DEFS[param]
  if (def.unit === '%') return value.toFixed(1) + '%'
  if (def.unit === '×') return value.toFixed(2) + '×'
  return value.toFixed(1) + '/10'
}

/**
 * Resolve the effective signed adjustment factor for a parameter given
 * the auto degree, optional manual override, and news sentiment.
 *
 * Returns a factor suitable for `baseValue * (1 + factor)`.
 * Manual overrides are signed percentages (−100..+100) — they bypass
 * sentiment/polarity inference entirely.
 */
export function effectiveAdjustmentFactor(
  param: ValuationParam,
  autoDegree: number,
  manualPct: number | null | undefined,
  sentiment: 'positive' | 'negative' | 'neutral'
): number {
  if (manualPct != null) {
    return Math.max(-1, Math.min(1, manualPct / 100))
  }
  if (sentiment === 'neutral' || autoDegree === 0) return 0
  const dir = sentiment === 'positive' ? 1 : -1
  const def = PARAM_DEFS[param]
  return Math.max(-1, Math.min(1, (dir * def.polarity * autoDegree) / 100))
}

/**
 * Return the signed preview (as %) of what the auto degree *would*
 * do to a parameter, given news sentiment. Used to display "+12%"
 * or "−8%" next to each row in the NewsCard parameter panel.
 */
export function autoSignedPct(
  param: ValuationParam,
  autoDegree: number,
  sentiment: 'positive' | 'negative' | 'neutral'
): number {
  if (sentiment === 'neutral' || autoDegree === 0) return 0
  const dir = sentiment === 'positive' ? 1 : -1
  const polarity = PARAM_DEFS[param].polarity
  return dir * polarity * autoDegree
}

/** Clamp an adjusted value into sensible bounds per unit type. */
export function clampAdjustedValue(param: ValuationParam, value: number): number {
  const def = PARAM_DEFS[param]
  if (def.unit === '/10') return Math.max(0, Math.min(10, value))
  if (def.unit === '×') return Math.max(0, value)
  if (def.unit === '%') {
    // Percent values — clamp to non-negative except WACC which has a
    // sensible floor around 4%
    if (param === 'wacc') return Math.max(4, Math.min(50, value))
    return Math.max(-50, Math.min(200, value))
  }
  return value
}
