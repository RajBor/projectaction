/**
 * SVG Line Chart — multi-series time series visualization.
 * Print-safe, no canvas. Supports multiple lines for peer comparison.
 */
'use client'

export interface LineSeries {
  label: string
  data: Array<{ x: string; y: number }>
  color: string
  dashed?: boolean
}

interface LineChartProps {
  series: LineSeries[]
  width?: number
  height?: number
  title?: string
  unit?: string
  fmt?: (v: number) => string
}

export function LineChart({
  series,
  width = 600,
  height = 200,
  title,
  unit = '',
  fmt = (v) => v.toFixed(1),
}: LineChartProps) {
  if (!series.length || series.every(s => s.data.length === 0)) return null

  const pad = { top: title ? 32 : 12, right: 80, bottom: 36, left: 55 }
  const cw = width - pad.left - pad.right
  const ch = height - pad.top - pad.bottom

  // Collect all x-labels (union of all series) and all y-values
  const allX = Array.from(new Set(series.flatMap(s => s.data.map(d => d.x))))
  // Sort chronologically — assumes labels like "Mar 2020", "FY24", etc.
  allX.sort((a, b) => {
    const ya = parseInt(a.match(/\d{4}/)?.[0] || '0')
    const yb = parseInt(b.match(/\d{4}/)?.[0] || '0')
    return ya - yb
  })

  const allY = series.flatMap(s => s.data.map(d => d.y)).filter(v => isFinite(v))
  const minY = Math.min(...allY, 0)
  const maxY = Math.max(...allY, 1)
  const rangeY = maxY - minY || 1

  const xScale = (i: number) => pad.left + (i / Math.max(allX.length - 1, 1)) * cw
  const yScale = (v: number) => pad.top + ch - ((v - minY) / rangeY) * ch

  // Grid lines
  const gridSteps = 4
  const gridLines = Array.from({ length: gridSteps + 1 }, (_, i) => {
    const v = minY + (rangeY * i) / gridSteps
    return { y: yScale(v), label: fmt(v) }
  })

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: "'Inter',sans-serif" }}>
      {title && (
        <text x={pad.left} y={18} fontSize={11} fontWeight={600} fill="#d1dce8">
          {title}
        </text>
      )}

      {/* Grid lines */}
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={pad.left} y1={g.y} x2={pad.left + cw} y2={g.y} stroke="rgba(99,130,191,0.12)" strokeWidth={0.5} />
          <text x={pad.left - 6} y={g.y + 3} fontSize={8} fill="#7a90a8" textAnchor="end" fontFamily="'JetBrains Mono',monospace">
            {g.label}{unit}
          </text>
        </g>
      ))}

      {/* X-axis labels */}
      {allX.map((label, i) => (
        <text key={label} x={xScale(i)} y={pad.top + ch + 14} fontSize={8} fill="#7a90a8" textAnchor="middle">
          {label.length > 8 ? label.slice(0, 8) : label}
        </text>
      ))}

      {/* Zero line if range crosses zero */}
      {minY < 0 && maxY > 0 && (
        <line x1={pad.left} y1={yScale(0)} x2={pad.left + cw} y2={yScale(0)} stroke="rgba(99,130,191,0.3)" strokeWidth={0.5} strokeDasharray="4,3" />
      )}

      {/* Lines */}
      {series.map((s) => {
        if (s.data.length < 2) return null
        const points = s.data
          .map(d => ({ xi: allX.indexOf(d.x), y: d.y }))
          .filter(p => p.xi >= 0)
          .sort((a, b) => a.xi - b.xi)

        const pathD = points
          .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.xi).toFixed(1)},${yScale(p.y).toFixed(1)}`)
          .join(' ')

        return (
          <g key={s.label}>
            <path
              d={pathD}
              fill="none"
              stroke={s.color}
              strokeWidth={s.dashed ? 1 : 2}
              strokeDasharray={s.dashed ? '5,3' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {/* Dots on data points */}
            {points.map((p, i) => (
              <circle key={i} cx={xScale(p.xi)} cy={yScale(p.y)} r={s.dashed ? 2 : 3} fill={s.color} stroke="rgba(11,15,23,0.5)" strokeWidth={1} />
            ))}
          </g>
        )
      })}

      {/* Legend */}
      <g transform={`translate(${pad.left + cw + 8}, ${pad.top})`}>
        {series.map((s, i) => (
          <g key={s.label} transform={`translate(0, ${i * 16})`}>
            <line x1={0} y1={6} x2={14} y2={6} stroke={s.color} strokeWidth={s.dashed ? 1 : 2} strokeDasharray={s.dashed ? '4,2' : undefined} />
            <text x={18} y={9} fontSize={8} fill="#7a90a8">{s.label.length > 10 ? s.label.slice(0, 10) : s.label}</text>
          </g>
        ))}
      </g>

      {/* Axes */}
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + ch} stroke="rgba(99,130,191,0.2)" strokeWidth={1} />
      <line x1={pad.left} y1={pad.top + ch} x2={pad.left + cw} y2={pad.top + ch} stroke="rgba(99,130,191,0.2)" strokeWidth={1} />
    </svg>
  )
}

/** Print-mode LineChart (lighter colors for white background PDF) */
export function LineChartPrint({
  series,
  width = 500,
  height = 180,
  title,
  unit = '',
  fmt = (v) => v.toFixed(1),
}: LineChartProps) {
  if (!series.length || series.every(s => s.data.length === 0)) return null

  const pad = { top: title ? 30 : 10, right: 80, bottom: 34, left: 55 }
  const cw = width - pad.left - pad.right
  const ch = height - pad.top - pad.bottom

  const allX = Array.from(new Set(series.flatMap(s => s.data.map(d => d.x))))
  allX.sort((a, b) => {
    const ya = parseInt(a.match(/\d{4}/)?.[0] || '0')
    const yb = parseInt(b.match(/\d{4}/)?.[0] || '0')
    return ya - yb
  })

  const allY = series.flatMap(s => s.data.map(d => d.y)).filter(v => isFinite(v))
  const minY = Math.min(...allY, 0)
  const maxY = Math.max(...allY, 1)
  const rangeY = maxY - minY || 1

  const xScale = (i: number) => pad.left + (i / Math.max(allX.length - 1, 1)) * cw
  const yScale = (v: number) => pad.top + ch - ((v - minY) / rangeY) * ch

  const gridSteps = 4
  const gridLines = Array.from({ length: gridSteps + 1 }, (_, i) => {
    const v = minY + (rangeY * i) / gridSteps
    return { y: yScale(v), label: fmt(v) }
  })

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: "'Inter',sans-serif" }}>
      {title && (
        <text x={pad.left} y={18} fontSize={10} fontWeight={600} fill="#0A2340">{title}</text>
      )}
      {gridLines.map((g, i) => (
        <g key={i}>
          <line x1={pad.left} y1={g.y} x2={pad.left + cw} y2={g.y} stroke="#E1DDD0" strokeWidth={0.5} />
          <text x={pad.left - 6} y={g.y + 3} fontSize={7.5} fill="#6B7A92" textAnchor="end" fontFamily="'JetBrains Mono',monospace">{g.label}{unit}</text>
        </g>
      ))}
      {allX.map((label, i) => (
        <text key={label} x={xScale(i)} y={pad.top + ch + 12} fontSize={7.5} fill="#6B7A92" textAnchor="middle">{label.length > 8 ? label.slice(0, 8) : label}</text>
      ))}
      {series.map((s) => {
        if (s.data.length < 2) return null
        const points = s.data.map(d => ({ xi: allX.indexOf(d.x), y: d.y })).filter(p => p.xi >= 0).sort((a, b) => a.xi - b.xi)
        const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.xi).toFixed(1)},${yScale(p.y).toFixed(1)}`).join(' ')
        return (
          <g key={s.label}>
            <path d={pathD} fill="none" stroke={s.color} strokeWidth={s.dashed ? 1 : 1.5} strokeDasharray={s.dashed ? '4,3' : undefined} strokeLinecap="round" />
            {points.map((p, i) => <circle key={i} cx={xScale(p.xi)} cy={yScale(p.y)} r={2.5} fill={s.color} stroke="#fff" strokeWidth={0.5} />)}
          </g>
        )
      })}
      <g transform={`translate(${pad.left + cw + 6}, ${pad.top})`}>
        {series.map((s, i) => (
          <g key={s.label} transform={`translate(0, ${i * 14})`}>
            <line x1={0} y1={5} x2={12} y2={5} stroke={s.color} strokeWidth={s.dashed ? 1 : 1.5} strokeDasharray={s.dashed ? '3,2' : undefined} />
            <text x={16} y={8} fontSize={7} fill="#6B7A92">{s.label.length > 10 ? s.label.slice(0, 10) : s.label}</text>
          </g>
        ))}
      </g>
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + ch} stroke="#C9C2AE" strokeWidth={0.5} />
      <line x1={pad.left} y1={pad.top + ch} x2={pad.left + cw} y2={pad.top + ch} stroke="#C9C2AE" strokeWidth={0.5} />
    </svg>
  )
}
