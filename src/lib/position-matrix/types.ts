/**
 * Position Matrix — type definitions.
 *
 * A GE-McKinsey 9-box that plots acquisition targets on
 * industry-attractiveness (Y) × competitive-position (X).
 */

export type IndustryInputKey =
  | 'industry_cagr_3y'
  | 'tam_usd_bn'
  | 'tam_expansion_rate'
  | 'regulatory_tailwind'
  | 'competitive_intensity'
  | 'cyclicality'

export type PositionInputKey =
  | 'market_share_rank'
  | 'revenue_growth_vs_peer'
  | 'ebitda_margin_vs_peer'
  | 'roic'
  | 'moat_score'
  | 'management_quality'
  | 'customer_concentration'

export type MatrixInputKey = IndustryInputKey | PositionInputKey

export type InputProvenance =
  | 'derived'   // auto-computed from existing company / peer / chain data
  | 'chain'     // parsed from CHAIN[] market narrative
  | 'manual'    // user-entered
  | 'default'   // sector/segment guidance default (user must opt in)
  | 'missing'   // no value — excluded from weighting

export interface MatrixInputCell {
  value: number | null
  provenance: InputProvenance
  note?: string            // short human-readable explanation of the source
}

export type MatrixInputs = Record<MatrixInputKey, MatrixInputCell>

/** Minimal shape required to score a target. Both OpTarget and Company coerce. */
export interface MatrixTargetInput {
  ticker: string
  name: string
  sec: string
  comp: string[]
  mktcapCr: number
  revCr: number
  ebitdaCr: number
  evCr: number
  ev_ebitda: number | null
  revGrowthPct: number | null
  ebitdaMarginPct: number | null
  roce?: number | null
  acqsScore?: number | null           // DealNector 0..10 acquisition attractiveness
  policyTailwindCount?: number        // count of applicable policies
  /**
   * Optional cohort tag. When the matrix receives a pre-segmented pool
   * (e.g. op-identifier's goal-achievers vs. beyond-goal picks), a
   * filter UI shows up that lets the analyst toggle between the cohorts.
   */
  group?: 'core' | 'opportunistic'
  /** Optional seed overrides — any keys present are used as-is. */
  overrides?: Partial<Record<MatrixInputKey, MatrixInputCell>>
}

export type QuadrantCode =
  | 'rising_star'
  | 'emerging_challenger'
  | 'question_mark'
  | 'undervalued_leader'
  | 'hold_watch'
  | 'restructure'
  | 'cash_cow'
  | 'harvest'
  | 'divest'

export interface QuadrantMeta {
  code: QuadrantCode
  label: string
  shortLabel: string       // small-caps axis label
  thesis: string           // one-line action
  color: string            // CSS color
  tintBg: string           // cell fill
}

export type Tier = 'low' | 'medium' | 'high' | 'weak' | 'strong'

export interface ScoredTarget {
  input: MatrixTargetInput
  inputs: MatrixInputs                // the resolved inputs (with provenance)
  industryScore: number | null        // 0..100 or null if no signals
  positionScore: number | null
  industryTier: 'low' | 'medium' | 'high' | null
  positionTier: 'weak' | 'medium' | 'strong' | null
  quadrant: QuadrantMeta | null
  thesis: string
  /** Which inputs contributed, with normalized scores and effective weights. */
  breakdown: {
    industry: Array<{ key: IndustryInputKey; raw: number; normalized: number; weight: number; contribution: number; provenance: InputProvenance; note?: string }>
    position: Array<{ key: PositionInputKey; raw: number; normalized: number; weight: number; contribution: number; provenance: InputProvenance; note?: string }>
  }
  /** true if valuation override promoted this to Undervalued Leader. */
  valuationOverrideApplied: boolean
}

export interface MatrixConfig {
  industryWeights: Record<IndustryInputKey, number>
  positionWeights: Record<PositionInputKey, number>
  industryThresholds: [number, number]   // [low<->medium, medium<->high]
  positionThresholds: [number, number]
  peerBenchmarkMultiple: number          // reference EV/EBITDA
  valuationDiscount: number              // fraction, e.g. 0.85
}

export interface MatrixPreset {
  id: string
  label: string
  description: string
  config: MatrixConfig
}

export interface MatrixSummary {
  nTargets: number
  nPlotted: number
  totalEvCr: number
  medianEvEbitda: number | null
  byQuadrant: Record<QuadrantCode, number>
  risingStars: ScoredTarget[]
  undervaluedLeaders: ScoredTarget[]
}
