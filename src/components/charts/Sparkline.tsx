'use client'

import { useId } from 'react'
import type { HistoricalPoint } from '@/lib/stocks/api'

interface SparklineProps {
  data: HistoricalPoint[]
  width?: number
  height?: number
  showAxis?: boolean
  colorOverride?: string
}

/**
 * Compact SVG sparkline for price history. Draws a filled area under
 * a line; color flips green/red based on first → last direction.
 * Fits the Bloomberg-density aesthetic of the rest of the app.
 */
export function Sparkline({
  data,
  width = 520,
  height = 110,
  showAxis = true,
  colorOverride,
}: SparklineProps) {
  const gradId = useId()

  if (!data || data.length < 2) {
    return (
      <div
        style={{
          width: '100%',
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--txt3)',
          fontSize: 11,
          fontStyle: 'italic',
        }}
      >
        No historical data
      </div>
    )
  }

  const prices = data.map((d) => d.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const range = max - min || 1
  const padY = 6

  const first = prices[0]
  const last = prices[prices.length - 1]
  const pct = ((last - first) / first) * 100
  const up = last >= first
  const color = colorOverride || (up ? 'var(--green)' : 'var(--red)')

  const toXY = (v: number, i: number): [number, number] => {
    const x = (i / (data.length - 1)) * (width - 2) + 1
    const y =
      height - padY - ((v - min) / range) * (height - padY * 2)
    return [x, y]
  }

  const pts = prices.map(toXY)
  const linePath = pts.map(([x, y]) => `${x},${y}`).join(' ')
  const areaPath = `M1,${height} L${linePath
    .split(' ')
    .map((p) => `L${p}`)
    .join(' ')
    .slice(1)} L${width - 1},${height} Z`

  // Placement for the last-price dot + label
  const [lastX, lastY] = pts[pts.length - 1]

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <svg
        viewBox={`0 0 ${width} ${height + (showAxis ? 18 : 0)}`}
        preserveAspectRatio="none"
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        <defs>
          <linearGradient id={`spark-grad-${gradId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.28} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>

        {/* Min/max guide lines */}
        <line
          x1={0}
          y1={padY}
          x2={width}
          y2={padY}
          stroke="var(--br)"
          strokeWidth={0.5}
          strokeDasharray="2 3"
        />
        <line
          x1={0}
          y1={height - padY}
          x2={width}
          y2={height - padY}
          stroke="var(--br)"
          strokeWidth={0.5}
          strokeDasharray="2 3"
        />

        {/* Filled area */}
        <path d={areaPath} fill={`url(#spark-grad-${gradId})`} />

        {/* Price line */}
        <polyline
          points={linePath}
          fill="none"
          stroke={color}
          strokeWidth={1.6}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Last point marker */}
        <circle cx={lastX} cy={lastY} r={3} fill={color} />
        <circle cx={lastX} cy={lastY} r={6} fill={color} fillOpacity={0.2} />

        {showAxis && (
          <>
            <text
              x={4}
              y={padY + 8}
              fontSize={9}
              fill="var(--txt3)"
              fontFamily="JetBrains Mono, monospace"
            >
              {max.toFixed(0)}
            </text>
            <text
              x={4}
              y={height - padY - 2}
              fontSize={9}
              fill="var(--txt3)"
              fontFamily="JetBrains Mono, monospace"
            >
              {min.toFixed(0)}
            </text>
            <text
              x={width - 4}
              y={height + 12}
              fontSize={9}
              textAnchor="end"
              fill="var(--txt3)"
              fontFamily="JetBrains Mono, monospace"
            >
              {data[data.length - 1].date}
            </text>
            <text
              x={4}
              y={height + 12}
              fontSize={9}
              fill="var(--txt3)"
              fontFamily="JetBrains Mono, monospace"
            >
              {data[0].date}
            </text>
          </>
        )}
      </svg>

      {/* Summary pill — first→last return */}
      <div
        style={{
          position: 'absolute',
          top: 4,
          right: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 11,
          fontWeight: 600,
          color,
          background: up ? 'var(--greendim)' : 'var(--reddim)',
          border: `1px solid ${color}`,
          padding: '2px 8px',
          borderRadius: 3,
        }}
      >
        {up ? '▲' : '▼'} {Math.abs(pct).toFixed(2)}%
      </div>
    </div>
  )
}
