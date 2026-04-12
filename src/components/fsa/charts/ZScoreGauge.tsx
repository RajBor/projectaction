/**
 * SVG Altman Z-Score Gauge — gradient bar with marker.
 * Print-safe. Shows distress/grey/safe zones.
 */
'use client'

export interface ZScoreData {
  zScore: number | null
  components: {
    wcTa: number | null      // Working Capital / Total Assets
    reTa: number | null      // Retained Earnings / Total Assets
    ebitTa: number | null    // EBIT / Total Assets
    meTl: number | null      // Market Equity / Total Liabilities
    sTa: number | null       // Sales / Total Assets
  }
}

interface ZScoreGaugeProps {
  data: ZScoreData
  width?: number
  height?: number
  printMode?: boolean
}

export function ZScoreGauge({ data, width = 500, height = 100, printMode }: ZScoreGaugeProps) {
  const { zScore } = data
  if (zScore === null) return null

  const barX = 40
  const barW = width - 80
  const barY = 30
  const barH = 22

  // Map Z-Score to position (0 to 4+ range)
  const maxZ = 4.5
  const pct = Math.max(0, Math.min(100, (zScore / maxZ) * 100))
  const markerX = barX + (pct / 100) * barW

  const zone = zScore > 2.99 ? 'Safe' : zScore > 1.81 ? 'Grey' : 'Distress'
  const zoneColor = zScore > 2.99 ? '#2E6B3A' : zScore > 1.81 ? '#D4A43B' : '#A9232B'

  const ink = printMode ? '#0A2340' : '#d1dce8'
  const muted = printMode ? '#6B7A92' : '#7a90a8'

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: "'Inter',sans-serif" }}>
      {/* Title */}
      <text x={barX} y={16} fontSize={10} fill={ink} fontWeight={600}>
        Altman Z-Score
      </text>
      <text x={width - 40} y={16} fontSize={12} fill={zoneColor} fontWeight={700} textAnchor="end" fontFamily="'JetBrains Mono',monospace">
        {zScore.toFixed(2)} — {zone}
      </text>

      {/* Gradient bar */}
      <defs>
        <linearGradient id="zgrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#A9232B" />
          <stop offset="40%" stopColor="#D4A43B" />
          <stop offset="67%" stopColor="#D4A43B" />
          <stop offset="100%" stopColor="#2E6B3A" />
        </linearGradient>
      </defs>
      <rect x={barX} y={barY} width={barW} height={barH} rx={4} fill="url(#zgrad)" opacity={0.3} />
      <rect x={barX} y={barY} width={barW} height={barH} rx={4} fill="none" stroke={printMode ? '#C9C2AE' : 'rgba(99,130,191,0.22)'} strokeWidth={0.5} />

      {/* Zone dividers */}
      {[1.81, 2.99].map((z) => {
        const x = barX + (z / maxZ) * barW
        return (
          <g key={z}>
            <line x1={x} y1={barY} x2={x} y2={barY + barH} stroke={muted} strokeWidth={0.5} strokeDasharray="2,2" />
            <text x={x} y={barY + barH + 12} fontSize={7} fill={muted} textAnchor="middle">
              {z}
            </text>
          </g>
        )
      })}

      {/* Marker */}
      <rect x={markerX - 1.5} y={barY - 6} width={3} height={barH + 12} rx={1} fill={zoneColor} />
      <circle cx={markerX} cy={barY - 8} r={4} fill={zoneColor} />

      {/* Zone labels */}
      <text x={barX + (1.81 / maxZ) * barW / 2} y={barY + barH + 22} fontSize={7} fill="#A9232B" textAnchor="middle" fontWeight={600}>
        DISTRESS
      </text>
      <text x={barX + ((1.81 + 2.99) / 2 / maxZ) * barW} y={barY + barH + 22} fontSize={7} fill="#D4A43B" textAnchor="middle" fontWeight={600}>
        GREY
      </text>
      <text x={barX + ((2.99 + maxZ) / 2 / maxZ) * barW} y={barY + barH + 22} fontSize={7} fill="#2E6B3A" textAnchor="middle" fontWeight={600}>
        SAFE
      </text>

      {/* Scale labels */}
      <text x={barX} y={barY + barH + 12} fontSize={7} fill={muted} textAnchor="middle">0</text>
      <text x={barX + barW} y={barY + barH + 12} fontSize={7} fill={muted} textAnchor="middle">4.5</text>
    </svg>
  )
}

export function zScoreInference(data: ZScoreData): string {
  const { zScore, components } = data
  if (zScore === null) return 'Insufficient data to compute Altman Z-Score.'
  const zone = zScore > 2.99 ? 'safe zone' : zScore > 1.81 ? 'grey zone' : 'distress zone'
  const risk = zScore > 2.99 ? 'low default risk' : zScore > 1.81 ? 'elevated monitoring required' : 'significant default risk'

  // Find strongest and weakest components
  const comps = [
    { name: 'Working Capital/TA', value: components.wcTa, weight: 1.2 },
    { name: 'Retained Earnings/TA', value: components.reTa, weight: 1.4 },
    { name: 'EBIT/TA', value: components.ebitTa, weight: 3.3 },
    { name: 'Market Equity/TL', value: components.meTl, weight: 0.6 },
    { name: 'Sales/TA', value: components.sTa, weight: 1.0 },
  ].filter(c => c.value !== null)

  const strongest = comps.reduce((a, b) => ((a.value || 0) * a.weight > (b.value || 0) * b.weight ? a : b))
  const weakest = comps.reduce((a, b) => ((a.value || 0) * a.weight < (b.value || 0) * b.weight ? a : b))

  return `Z-Score of ${zScore.toFixed(2)} places the company in the ${zone}, indicating ${risk}. The strongest contributor is ${strongest.name} (weight ${strongest.weight}×), while ${weakest.name} is the weakest. ${zScore < 1.81 ? 'Immediate attention to liquidity and profitability is recommended.' : zScore < 2.99 ? 'The company should focus on strengthening operating profitability (EBIT/TA carries the highest weight at 3.3×).' : 'The company has a comfortable buffer above the distress threshold.'}`
}
