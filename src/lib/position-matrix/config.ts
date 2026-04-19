import type {
  IndustryInputKey,
  MatrixConfig,
  MatrixPreset,
  PositionInputKey,
  QuadrantCode,
  QuadrantMeta,
  MatrixInputKey,
} from './types'

export const INDUSTRY_KEYS: IndustryInputKey[] = [
  'industry_cagr_3y',
  'tam_usd_bn',
  'tam_expansion_rate',
  'regulatory_tailwind',
  'competitive_intensity',
  'cyclicality',
]

export const POSITION_KEYS: PositionInputKey[] = [
  'market_share_rank',
  'revenue_growth_vs_peer',
  'ebitda_margin_vs_peer',
  'roic',
  'moat_score',
  'management_quality',
  'customer_concentration',
]

export const INPUT_LABELS: Record<MatrixInputKey, { label: string; unit: string; hint: string }> = {
  industry_cagr_3y: { label: 'Industry CAGR (3Y)', unit: '%', hint: 'Segment revenue CAGR over the last 3 years' },
  tam_usd_bn: { label: 'Global TAM', unit: '$bn', hint: 'Total addressable market, global' },
  tam_expansion_rate: { label: 'TAM expansion rate', unit: '%', hint: 'Forward CAGR of the global TAM' },
  regulatory_tailwind: { label: 'Regulatory tailwind', unit: 'score', hint: '-100 (headwind) … +100 (tailwind)' },
  competitive_intensity: { label: 'Competitive intensity', unit: 'score', hint: '0 (monopoly) … 100 (hypercompetitive) — inverted in scoring' },
  cyclicality: { label: 'Cyclicality', unit: 'score', hint: '0 (stable) … 100 (highly cyclical) — inverted in scoring' },
  market_share_rank: { label: 'Market share rank', unit: '#', hint: '1 = leader (rank in domestic segment)' },
  revenue_growth_vs_peer: { label: 'Revenue growth vs peer', unit: 'pp', hint: 'Percentage-point delta vs peer-set average' },
  ebitda_margin_vs_peer: { label: 'EBITDA margin vs peer', unit: 'pp', hint: 'Percentage-point delta vs peer-set average' },
  roic: { label: 'ROIC', unit: '%', hint: 'Return on invested capital' },
  moat_score: { label: 'Moat score', unit: '0-100', hint: 'Strength of competitive moat' },
  management_quality: { label: 'Management quality', unit: '0-100', hint: 'Depth, track record, capital allocation' },
  customer_concentration: { label: 'Customer concentration', unit: '0-100', hint: '0 (diversified) … 100 (concentrated) — inverted' },
}

export const DEFAULT_INDUSTRY_WEIGHTS: Record<IndustryInputKey, number> = {
  industry_cagr_3y: 0.30,
  tam_usd_bn: 0.15,
  tam_expansion_rate: 0.20,
  regulatory_tailwind: 0.10,
  competitive_intensity: 0.15,
  cyclicality: 0.10,
}

export const DEFAULT_POSITION_WEIGHTS: Record<PositionInputKey, number> = {
  market_share_rank: 0.20,
  revenue_growth_vs_peer: 0.15,
  ebitda_margin_vs_peer: 0.15,
  roic: 0.15,
  moat_score: 0.15,
  management_quality: 0.10,
  customer_concentration: 0.10,
}

export const DEFAULT_CONFIG: MatrixConfig = {
  industryWeights: DEFAULT_INDUSTRY_WEIGHTS,
  positionWeights: DEFAULT_POSITION_WEIGHTS,
  industryThresholds: [33, 66],
  positionThresholds: [33, 66],
  peerBenchmarkMultiple: 12.0,
  valuationDiscount: 0.85,
}

export const PRESETS: MatrixPreset[] = [
  {
    id: 'default',
    label: 'Balanced',
    description: 'Balanced weighting across growth, scale, margin, and moat.',
    config: DEFAULT_CONFIG,
  },
  {
    id: 'tech_bolt_on',
    label: 'Tech bolt-on',
    description: 'Overweights CAGR, TAM expansion, and management — accepts richer multiples.',
    config: {
      industryWeights: {
        industry_cagr_3y: 0.40,
        tam_usd_bn: 0.10,
        tam_expansion_rate: 0.25,
        regulatory_tailwind: 0.05,
        competitive_intensity: 0.15,
        cyclicality: 0.05,
      },
      positionWeights: {
        market_share_rank: 0.10,
        revenue_growth_vs_peer: 0.20,
        ebitda_margin_vs_peer: 0.10,
        roic: 0.10,
        moat_score: 0.20,
        management_quality: 0.20,
        customer_concentration: 0.10,
      },
      industryThresholds: [33, 66],
      positionThresholds: [33, 66],
      peerBenchmarkMultiple: 18.0,
      valuationDiscount: 0.85,
    },
  },
  {
    id: 'infra_carve_out',
    label: 'Infra carve-out',
    description: 'Regulatory-driven, cyclicality-sensitive, ROIC-first — demands cheaper entry.',
    config: {
      industryWeights: {
        industry_cagr_3y: 0.15,
        tam_usd_bn: 0.15,
        tam_expansion_rate: 0.10,
        regulatory_tailwind: 0.25,
        competitive_intensity: 0.15,
        cyclicality: 0.20,
      },
      positionWeights: {
        market_share_rank: 0.20,
        revenue_growth_vs_peer: 0.10,
        ebitda_margin_vs_peer: 0.15,
        roic: 0.20,
        moat_score: 0.15,
        management_quality: 0.10,
        customer_concentration: 0.10,
      },
      industryThresholds: [33, 66],
      positionThresholds: [33, 66],
      peerBenchmarkMultiple: 9.0,
      valuationDiscount: 0.85,
    },
  },
  {
    id: 'industrial_consolidation',
    label: 'Industrial roll-up',
    description: 'Market-share and margin first — consolidator lens, discounted multiple.',
    config: {
      industryWeights: DEFAULT_INDUSTRY_WEIGHTS,
      positionWeights: {
        market_share_rank: 0.25,
        revenue_growth_vs_peer: 0.10,
        ebitda_margin_vs_peer: 0.20,
        roic: 0.15,
        moat_score: 0.10,
        management_quality: 0.10,
        customer_concentration: 0.10,
      },
      industryThresholds: [33, 66],
      positionThresholds: [33, 66],
      peerBenchmarkMultiple: 10.0,
      valuationDiscount: 0.85,
    },
  },
]

// ── Quadrant taxonomy ────────────────────────────────────────────────

export const QUADRANTS: Record<QuadrantCode, QuadrantMeta> = {
  rising_star: {
    code: 'rising_star', label: 'Rising Star', shortLabel: 'RISING STAR',
    thesis: 'Acquire at premium. Defend with growth capital.',
    color: '#4fb389', tintBg: 'rgba(79,179,137,0.08)',
  },
  emerging_challenger: {
    code: 'emerging_challenger', label: 'Emerging Challenger', shortLabel: 'EMERGING',
    thesis: 'Selective bet. Validate trajectory before committing.',
    color: '#6b9bc4', tintBg: 'rgba(107,155,196,0.08)',
  },
  question_mark: {
    code: 'question_mark', label: 'Question Mark', shortLabel: 'QUESTION',
    thesis: 'Hot segment, weak position. Cheap option only.',
    color: '#9b7fb8', tintBg: 'rgba(155,127,184,0.08)',
  },
  undervalued_leader: {
    code: 'undervalued_leader', label: 'Undervalued Leader', shortLabel: 'UNDERVALUED',
    thesis: 'Value buy. Mispriced vs. peer multiple.',
    color: '#d4a574', tintBg: 'rgba(212,165,116,0.10)',
  },
  hold_watch: {
    code: 'hold_watch', label: 'Hold / Watch', shortLabel: 'HOLD',
    thesis: 'Keep under observation. No active case.',
    color: '#7a8599', tintBg: 'rgba(122,133,153,0.06)',
  },
  restructure: {
    code: 'restructure', label: 'Restructure', shortLabel: 'RESTRUCTURE',
    thesis: 'Turnaround only. Discount for execution risk.',
    color: '#c7815c', tintBg: 'rgba(199,129,92,0.08)',
  },
  cash_cow: {
    code: 'cash_cow', label: 'Cash Cow', shortLabel: 'CASH COW',
    thesis: 'Stable yield. Optimise payout, not growth.',
    color: '#5e8fa8', tintBg: 'rgba(94,143,168,0.08)',
  },
  harvest: {
    code: 'harvest', label: 'Harvest', shortLabel: 'HARVEST',
    thesis: 'Milk for FCF. Time-box the exposure.',
    color: '#606b7d', tintBg: 'rgba(96,107,125,0.06)',
  },
  divest: {
    code: 'divest', label: 'Divest / Avoid', shortLabel: 'DIVEST',
    thesis: 'Pass. Value-trap risk.',
    color: '#b16566', tintBg: 'rgba(177,101,102,0.08)',
  },
}

/** Map (industry tier, position tier) → quadrant code. */
export function pickQuadrant(
  industry: 'low' | 'medium' | 'high',
  position: 'weak' | 'medium' | 'strong'
): QuadrantCode {
  if (industry === 'high' && position === 'strong') return 'rising_star'
  if (industry === 'high' && position === 'medium') return 'emerging_challenger'
  if (industry === 'high' && position === 'weak') return 'question_mark'
  if (industry === 'medium' && position === 'strong') return 'undervalued_leader'
  if (industry === 'medium' && position === 'medium') return 'hold_watch'
  if (industry === 'medium' && position === 'weak') return 'restructure'
  if (industry === 'low' && position === 'strong') return 'cash_cow'
  if (industry === 'low' && position === 'medium') return 'harvest'
  return 'divest'
}
