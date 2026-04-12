/**
 * SVG DuPont Decomposition Tree — 5-factor visual.
 * Print-safe. Shows ROE broken into tax burden, interest burden,
 * EBIT margin, asset turnover, and equity multiplier.
 */
'use client'

export interface DuPontData {
  roe: number | null
  taxBurden: number | null     // NI / EBT
  interestBurden: number | null // EBT / EBIT
  ebitMargin: number | null    // EBIT / Revenue
  assetTurnover: number | null // Revenue / Avg Assets
  equityMultiplier: number | null // Avg Assets / Avg Equity
  // Source values
  ni?: number
  ebt?: number
  ebit?: number
  revenue?: number
  avgAssets?: number
  avgEquity?: number
}

interface DuPontTreeProps {
  data: DuPontData
  width?: number
  height?: number
  /** For print report — uses report colors */
  printMode?: boolean
}

export function DuPontTree({ data, width = 520, height = 200, printMode }: DuPontTreeProps) {
  const ink = printMode ? '#0A2340' : '#d1dce8'
  const muted = printMode ? '#6B7A92' : '#7a90a8'
  const accent = printMode ? '#D4A43B' : '#4a90d9'
  const green = printMode ? '#2E6B3A' : '#22c55e'
  const bg = printMode ? '#F8F5EA' : 'rgba(74,144,217,0.08)'
  const border = printMode ? '#E1DDD0' : 'rgba(99,130,191,0.22)'

  const fmt = (v: number | null, suffix = '') => v === null ? '—' : `${v.toFixed(2)}${suffix}`
  const fmtPct = (v: number | null) => v === null ? '—' : `${(v * 100).toFixed(1)}%`

  const factors = [
    { label: 'Tax Burden', value: data.taxBurden, formula: 'NI / EBT', color: '#2dd4bf' },
    { label: 'Interest Burden', value: data.interestBurden, formula: 'EBT / EBIT', color: '#f59e0b' },
    { label: 'EBIT Margin', value: data.ebitMargin, formula: 'EBIT / Rev', color: green },
    { label: 'Asset T/O', value: data.assetTurnover, formula: 'Rev / Avg TA', color: accent },
    { label: 'Equity Mult.', value: data.equityMultiplier, formula: 'Avg TA / Avg Eq', color: '#a78bfa' },
  ]

  const boxW = 88
  const boxH = 60
  const gap = (width - 5 * boxW) / 6
  const topY = 10
  const boxY = 80

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: "'Inter',sans-serif" }}>
      {/* ROE header */}
      <rect x={width / 2 - 60} y={topY} width={120} height={32} rx={4} fill={bg} stroke={accent} strokeWidth={1.5} />
      <text x={width / 2} y={topY + 13} fontSize={8} fill={muted} textAnchor="middle" fontWeight={600} letterSpacing={0.5}>
        ROE
      </text>
      <text x={width / 2} y={topY + 27} fontSize={14} fill={accent} textAnchor="middle" fontWeight={700} fontFamily="'JetBrains Mono',monospace">
        {data.roe !== null ? `${data.roe.toFixed(1)}%` : '—'}
      </text>
      {/* Connector lines */}
      <line x1={width / 2} y1={topY + 32} x2={width / 2} y2={topY + 48} stroke={border} strokeWidth={1} />
      <line x1={gap + boxW / 2} y1={topY + 48} x2={width - gap - boxW / 2} y2={topY + 48} stroke={border} strokeWidth={1} />
      {/* Factor boxes */}
      {factors.map((f, i) => {
        const x = gap + i * (boxW + gap)
        return (
          <g key={i}>
            <line x1={x + boxW / 2} y1={topY + 48} x2={x + boxW / 2} y2={boxY} stroke={border} strokeWidth={1} />
            <rect x={x} y={boxY} width={boxW} height={boxH} rx={4} fill={bg} stroke={border} strokeWidth={1} />
            <text x={x + boxW / 2} y={boxY + 12} fontSize={7.5} fill={muted} textAnchor="middle" fontWeight={600} letterSpacing={0.3}>
              {f.label}
            </text>
            <text x={x + boxW / 2} y={boxY + 30} fontSize={14} fill={f.color} textAnchor="middle" fontWeight={700} fontFamily="'JetBrains Mono',monospace">
              {f.label === 'EBIT Margin' ? fmtPct(f.value) : fmt(f.value, f.label === 'Asset T/O' || f.label === 'Equity Mult.' ? '×' : '')}
            </text>
            <text x={x + boxW / 2} y={boxY + 44} fontSize={7} fill={muted} textAnchor="middle">
              {f.formula}
            </text>
            {/* Multiplication sign between boxes */}
            {i < 4 && (
              <text x={x + boxW + gap / 2} y={boxY + boxH / 2 + 2} fontSize={12} fill={muted} textAnchor="middle">
                ×
              </text>
            )}
          </g>
        )
      })}
      {/* Bottom interpretation */}
      <text x={width / 2} y={height - 10} fontSize={8} fill={muted} textAnchor="middle" fontStyle="italic">
        {getDominantDriver(data)}
      </text>
    </svg>
  )
}

function getDominantDriver(d: DuPontData): string {
  if (!d.ebitMargin || !d.assetTurnover || !d.equityMultiplier) return 'Insufficient data for driver analysis'
  const margin = d.ebitMargin * 100
  const turnover = d.assetTurnover * 50 // normalise
  const leverage = d.equityMultiplier * 30 // normalise
  if (margin >= turnover && margin >= leverage) return 'ROE is primarily margin-driven — reflects pricing power and cost efficiency'
  if (turnover >= margin && turnover >= leverage) return 'ROE is primarily turnover-driven — reflects asset-light or high-velocity business model'
  return 'ROE is primarily leverage-driven — carries refinancing and interest rate risk'
}

export function dupontInference(d: DuPontData): string {
  if (!d.roe) return 'Insufficient data for DuPont analysis.'
  const driver = getDominantDriver(d)
  const taxEff = d.taxBurden !== null ? (d.taxBurden > 0.8 ? 'tax-efficient' : d.taxBurden > 0.7 ? 'near-statutory tax burden' : 'high tax burden') : 'unknown tax efficiency'
  const intBurden = d.interestBurden !== null ? (d.interestBurden > 0.85 ? 'minimal interest drag' : d.interestBurden > 0.7 ? 'moderate interest costs' : 'significant interest drag on earnings') : 'unknown'
  return `ROE of ${d.roe.toFixed(1)}% decomposes into five factors. The company has ${taxEff} and ${intBurden}. ${driver}. ${d.equityMultiplier && d.equityMultiplier > 3 ? 'The equity multiplier above 3× indicates aggressive financial leverage that amplifies both returns and risk.' : 'Leverage is within conservative bounds.'}`
}
