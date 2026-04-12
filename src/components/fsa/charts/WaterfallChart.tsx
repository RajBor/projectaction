/**
 * SVG Waterfall Chart — revenue-to-net-income bridge.
 * Print-safe, no canvas.
 */
'use client'

interface WaterfallStep {
  label: string
  value: number
  type: 'start' | 'add' | 'subtract' | 'total'
}

interface WaterfallChartProps {
  steps: WaterfallStep[]
  width?: number
  height?: number
  title?: string
  fmt?: (v: number) => string
}

export function WaterfallChart({
  steps,
  width = 520,
  height = 220,
  title,
  fmt = (v) => v.toLocaleString('en-IN'),
}: WaterfallChartProps) {
  if (!steps.length) return null
  const pad = { top: title ? 32 : 12, right: 10, bottom: 44, left: 56 }
  const cw = width - pad.left - pad.right
  const ch = height - pad.top - pad.bottom

  // Compute running totals
  let running = 0
  const computed = steps.map((s) => {
    const prev = running
    if (s.type === 'start' || s.type === 'total') {
      running = s.value
      return { ...s, base: 0, barH: s.value }
    }
    running += s.value
    return { ...s, base: prev, barH: s.value }
  })

  const allVals = computed.map((c) => [c.base, c.base + c.barH]).flat()
  const maxVal = Math.max(...allVals, 1)
  const minVal = Math.min(...allVals, 0)
  const range = maxVal - minVal || 1

  const barW = Math.min(36, (cw / steps.length) * 0.6)
  const gap = cw / steps.length
  const scaleY = (v: number) => pad.top + ch - ((v - minVal) / range) * ch

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: "'Inter',sans-serif" }}>
      {title && (
        <text x={pad.left} y={18} fontSize={11} fontWeight={600} fill="#0A2340">
          {title}
        </text>
      )}
      {/* Zero line */}
      <line x1={pad.left} y1={scaleY(0)} x2={pad.left + cw} y2={scaleY(0)} stroke="#0A2340" strokeWidth={0.5} strokeDasharray="3,3" />
      {/* Bars */}
      {computed.map((c, i) => {
        const x = pad.left + i * gap + (gap - barW) / 2
        const isPositive = c.barH >= 0
        const color =
          c.type === 'start' || c.type === 'total'
            ? '#0A2340'
            : isPositive
              ? '#2E6B3A'
              : '#A9232B'
        const top = isPositive ? scaleY(c.base + c.barH) : scaleY(c.base)
        const h = Math.abs(scaleY(c.base) - scaleY(c.base + c.barH))
        return (
          <g key={i}>
            <rect x={x} y={top} width={barW} height={Math.max(h, 1)} fill={color} rx={1} opacity={0.85} />
            {/* Connector line to next bar */}
            {i < computed.length - 1 && c.type !== 'total' && (
              <line
                x1={x + barW}
                y1={scaleY(c.base + c.barH)}
                x2={pad.left + (i + 1) * gap + (gap - barW) / 2}
                y2={scaleY(c.base + c.barH)}
                stroke="#C9C2AE"
                strokeWidth={0.5}
                strokeDasharray="2,2"
              />
            )}
            {/* Value label */}
            <text
              x={x + barW / 2}
              y={isPositive ? top - 4 : top + h + 10}
              fontSize={7.5}
              fill={color}
              textAnchor="middle"
              fontWeight={600}
              fontFamily="'JetBrains Mono',monospace"
            >
              {c.type === 'subtract' ? '-' : ''}{fmt(Math.abs(c.value))}
            </text>
            {/* X label */}
            <text x={x + barW / 2} y={pad.top + ch + 12} fontSize={7} fill="#6B7A92" textAnchor="middle" transform={`rotate(-20, ${x + barW / 2}, ${pad.top + ch + 12})`}>
              {c.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Build waterfall steps from income statement data.
 */
export function buildIncomeWaterfall(d: {
  revenue: number
  cogs: number
  grossProfit: number
  opex: number
  ebit: number
  interest: number
  tax: number
  netIncome: number
}): WaterfallStep[] {
  return [
    { label: 'Revenue', value: d.revenue, type: 'start' },
    { label: 'COGS', value: -d.cogs, type: 'subtract' },
    { label: 'Gross Profit', value: d.grossProfit, type: 'total' },
    { label: 'OpEx', value: -(d.grossProfit - d.ebit), type: 'subtract' },
    { label: 'EBIT', value: d.ebit, type: 'total' },
    { label: 'Interest', value: -d.interest, type: 'subtract' },
    { label: 'Tax', value: -d.tax, type: 'subtract' },
    { label: 'Net Income', value: d.netIncome, type: 'total' },
  ]
}

export function waterfallInference(revenue: number, netIncome: number, ebitMargin: number): string {
  const netMargin = revenue > 0 ? (netIncome / revenue * 100) : 0
  return `The income waterfall shows a net margin of ${netMargin.toFixed(1)}% after all deductions from revenue. ${ebitMargin > 15 ? 'Strong operating profitability at the EBIT level suggests solid pricing power and cost control.' : ebitMargin > 8 ? 'Operating margins are adequate but leave limited buffer for cost escalation.' : 'Thin operating margins indicate vulnerability to input cost increases or pricing pressure.'} The gap between EBIT and net income reveals the financing and tax burden on operating earnings.`
}
