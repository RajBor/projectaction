/**
 * SVG Bar Chart — print-safe, no canvas.
 * Renders multi-year financial data as vertical bars with labels.
 */
'use client'

interface BarChartProps {
  data: Array<{ label: string; value: number; color?: string }>
  width?: number
  height?: number
  title?: string
  unit?: string
  /** Format function for value labels */
  fmt?: (v: number) => string
}

export function BarChart({
  data,
  width = 500,
  height = 200,
  title,
  unit = '',
  fmt = (v) => v.toLocaleString('en-IN'),
}: BarChartProps) {
  if (!data.length) return null
  const pad = { top: title ? 30 : 10, right: 10, bottom: 40, left: 60 }
  const cw = width - pad.left - pad.right
  const ch = height - pad.top - pad.bottom
  const max = Math.max(...data.map((d) => Math.abs(d.value)), 1)
  const barW = Math.min(40, (cw / data.length) * 0.6)
  const gap = cw / data.length

  // SVG renders responsively — width="100%" + viewBox lets it scale
  // to its container, so charts stay inside page margins regardless
  // of the grid cell width. The numeric `width` drives only the
  // internal coordinate system.
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      style={{
        fontFamily: "'Inter',sans-serif",
        width: '100%',
        height: 'auto',
        maxWidth: width,
        display: 'block',
      }}>
      {title && (
        <text x={pad.left} y={18} fontSize={11} fontWeight={600} fill="#0A2340">
          {title}
        </text>
      )}
      {/* Y-axis gridlines */}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = pad.top + ch - f * ch
        const val = max * f
        return (
          <g key={f}>
            <line x1={pad.left} y1={y} x2={pad.left + cw} y2={y} stroke="#E1DDD0" strokeWidth={0.5} />
            <text x={pad.left - 6} y={y + 3} fontSize={8} fill="#6B7A92" textAnchor="end" fontFamily="'JetBrains Mono',monospace">
              {fmt(val)}{unit}
            </text>
          </g>
        )
      })}
      {/* Bars */}
      {data.map((d, i) => {
        const x = pad.left + i * gap + (gap - barW) / 2
        const barH = (Math.abs(d.value) / max) * ch
        const y = pad.top + ch - barH
        const color = d.color || '#D4A43B'
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={barH} fill={color} rx={2} />
            <text x={x + barW / 2} y={y - 4} fontSize={8} fill="#0A2340" textAnchor="middle" fontWeight={600} fontFamily="'JetBrains Mono',monospace">
              {fmt(d.value)}{unit}
            </text>
            <text x={x + barW / 2} y={pad.top + ch + 14} fontSize={8} fill="#6B7A92" textAnchor="middle">
              {d.label}
            </text>
          </g>
        )
      })}
      {/* Baseline */}
      <line x1={pad.left} y1={pad.top + ch} x2={pad.left + cw} y2={pad.top + ch} stroke="#0A2340" strokeWidth={1} />
    </svg>
  )
}

/**
 * Generate inference text for a bar chart.
 */
export function barChartInference(data: Array<{ label: string; value: number }>, metric: string): string {
  if (data.length < 2) return `Insufficient data points to assess ${metric} trend.`
  const first = data[data.length - 1].value
  const last = data[0].value
  const years = data.length - 1
  const cagr = first > 0 ? (Math.pow(last / first, 1 / years) - 1) * 100 : 0
  const direction = last > first ? 'grown' : 'declined'
  const abs = Math.abs(cagr).toFixed(1)
  return `${metric} has ${direction} at a ${abs}% CAGR over ${years} years, from ${data[data.length - 1].label} to ${data[0].label}. ${cagr > 15 ? 'This above-average growth rate suggests strong demand drivers and successful capacity expansion.' : cagr > 5 ? 'This steady growth is in line with industry averages.' : cagr > 0 ? 'Growth is modest — pricing power and market share gains should be investigated.' : 'The declining trend warrants investigation into competitive dynamics, pricing pressure, or market headwinds.'}`
}
