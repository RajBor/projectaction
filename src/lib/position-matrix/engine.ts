import type {
  IndustryInputKey,
  MatrixConfig,
  MatrixInputKey,
  MatrixInputs,
  MatrixSummary,
  MatrixTargetInput,
  PositionInputKey,
  QuadrantCode,
  ScoredTarget,
} from './types'
import {
  DEFAULT_CONFIG,
  INDUSTRY_KEYS,
  POSITION_KEYS,
  QUADRANTS,
  pickQuadrant,
} from './config'

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v))

// ── Normalization (all map raw input → 0..100) ──────────────────────

export function normalize(key: MatrixInputKey, raw: number): number {
  switch (key) {
    case 'industry_cagr_3y':          return clamp(raw * 4)
    case 'tam_usd_bn':                return clamp(Math.log10(Math.max(raw, 0.1)) * 33 + 33)
    case 'tam_expansion_rate':        return clamp(raw * 5)
    case 'regulatory_tailwind':       return clamp((raw + 100) / 2)
    case 'competitive_intensity':     return clamp(100 - raw)
    case 'cyclicality':               return clamp(100 - raw)
    case 'market_share_rank':         return clamp(100 - (raw - 1) * 20)
    case 'revenue_growth_vs_peer':    return clamp(raw * 5 + 50)
    case 'ebitda_margin_vs_peer':     return clamp(raw * 5 + 50)
    case 'roic':                      return clamp(raw * 3.33)
    case 'moat_score':                return clamp(raw)
    case 'management_quality':        return clamp(raw)
    case 'customer_concentration':    return clamp(100 - raw)
  }
}

// ── Weighted aggregation with dynamic reweighting ───────────────────

function weightedScore<K extends MatrixInputKey>(
  keys: K[],
  weights: Record<K, number>,
  inputs: MatrixInputs,
): { score: number | null; rows: Array<{ key: K; raw: number; normalized: number; weight: number; contribution: number; provenance: MatrixInputs[K]['provenance']; note?: string }> } {
  const present = keys.filter(k => inputs[k].value !== null && inputs[k].provenance !== 'missing')
  if (present.length === 0) return { score: null, rows: [] }

  const totalWeight = present.reduce((s, k) => s + weights[k], 0)
  if (totalWeight <= 0) return { score: null, rows: [] }

  let sum = 0
  const rows: Array<{ key: K; raw: number; normalized: number; weight: number; contribution: number; provenance: MatrixInputs[K]['provenance']; note?: string }> = []
  for (const k of present) {
    const raw = inputs[k].value as number
    const n = normalize(k, raw)
    const effWeight = weights[k] / totalWeight
    const contribution = n * effWeight
    sum += contribution
    rows.push({
      key: k,
      raw,
      normalized: Math.round(n * 10) / 10,
      weight: Math.round(effWeight * 1000) / 1000,
      contribution: Math.round(contribution * 10) / 10,
      provenance: inputs[k].provenance,
      note: inputs[k].note,
    })
  }
  return { score: Math.round(sum * 10) / 10, rows }
}

// ── Tier classification ─────────────────────────────────────────────

function tierIndustry(s: number | null, thresholds: [number, number]): 'low' | 'medium' | 'high' | null {
  if (s === null) return null
  if (s < thresholds[0]) return 'low'
  if (s < thresholds[1]) return 'medium'
  return 'high'
}
function tierPosition(s: number | null, thresholds: [number, number]): 'weak' | 'medium' | 'strong' | null {
  if (s === null) return null
  if (s < thresholds[0]) return 'weak'
  if (s < thresholds[1]) return 'medium'
  return 'strong'
}

// ── Main scoring entry point ────────────────────────────────────────

export function scoreTarget(
  t: MatrixTargetInput,
  inputs: MatrixInputs,
  config: MatrixConfig = DEFAULT_CONFIG,
): ScoredTarget {
  const industry = weightedScore(INDUSTRY_KEYS, config.industryWeights, inputs)
  const position = weightedScore(POSITION_KEYS, config.positionWeights, inputs)

  const iTier = tierIndustry(industry.score, config.industryThresholds)
  const pTier = tierPosition(position.score, config.positionThresholds)

  let quadrantCode: QuadrantCode | null = null
  let valuationOverrideApplied = false
  if (iTier !== null && pTier !== null) {
    quadrantCode = pickQuadrant(iTier, pTier)
    // Valuation override: strong position + discounted multiple → Undervalued Leader
    const peerRef = config.peerBenchmarkMultiple * config.valuationDiscount
    const ev_eb = t.ev_ebitda
    if (
      pTier === 'strong' &&
      ev_eb !== null &&
      ev_eb > 0 &&
      ev_eb < peerRef &&
      quadrantCode !== 'rising_star' &&  // don't demote a Rising Star
      quadrantCode !== 'undervalued_leader'
    ) {
      quadrantCode = 'undervalued_leader'
      valuationOverrideApplied = true
    }
  }

  const quadrant = quadrantCode ? QUADRANTS[quadrantCode] : null
  const thesis = quadrant?.thesis ?? 'Insufficient data to classify. Fill more inputs.'

  return {
    input: t,
    inputs,
    industryScore: industry.score,
    positionScore: position.score,
    industryTier: iTier,
    positionTier: pTier,
    quadrant,
    thesis,
    breakdown: {
      industry: industry.rows as ScoredTarget['breakdown']['industry'],
      position: position.rows as ScoredTarget['breakdown']['position'],
    },
    valuationOverrideApplied,
  }
}

export function summarize(scored: ScoredTarget[]): MatrixSummary {
  const byQuadrant: Record<QuadrantCode, number> = {
    rising_star: 0, emerging_challenger: 0, question_mark: 0,
    undervalued_leader: 0, hold_watch: 0, restructure: 0,
    cash_cow: 0, harvest: 0, divest: 0,
  }
  let totalEv = 0
  const multiples: number[] = []
  for (const s of scored) {
    totalEv += s.input.evCr || 0
    if (s.input.ev_ebitda && s.input.ev_ebitda > 0) multiples.push(s.input.ev_ebitda)
    if (s.quadrant) byQuadrant[s.quadrant.code] += 1
  }
  multiples.sort((a, b) => a - b)
  const median = multiples.length ? (multiples.length % 2 === 0
    ? (multiples[multiples.length / 2 - 1] + multiples[multiples.length / 2]) / 2
    : multiples[(multiples.length - 1) / 2]) : null

  const plotted = scored.filter(s => s.quadrant !== null)
  const risingStars = scored.filter(s => s.quadrant?.code === 'rising_star')
  const undervaluedLeaders = scored.filter(s => s.quadrant?.code === 'undervalued_leader')

  return {
    nTargets: scored.length,
    nPlotted: plotted.length,
    totalEvCr: Math.round(totalEv),
    medianEvEbitda: median === null ? null : Math.round(median * 10) / 10,
    byQuadrant,
    risingStars,
    undervaluedLeaders,
  }
}

// ── Validation helpers (used by config builders) ────────────────────

export function validateWeights<K extends string>(weights: Record<K, number>, keys: K[]): void {
  const sum = keys.reduce((s, k) => s + (weights[k] ?? 0), 0)
  if (Math.abs(sum - 1) > 0.001) {
    throw new Error(`Weights must sum to 1.0, got ${sum.toFixed(3)}`)
  }
}

export function validateConfig(c: MatrixConfig): void {
  validateWeights(c.industryWeights, INDUSTRY_KEYS)
  validateWeights(c.positionWeights, POSITION_KEYS)
  const [a, b] = c.industryThresholds
  if (!(0 < a && a < b && b < 100)) throw new Error('industryThresholds must satisfy 0 < low < high < 100')
  const [c1, c2] = c.positionThresholds
  if (!(0 < c1 && c1 < c2 && c2 < 100)) throw new Error('positionThresholds must satisfy 0 < low < high < 100')
}
