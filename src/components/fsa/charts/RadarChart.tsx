/**
 * SVG Radar / Spider Chart — ratio profile vs peer.
 * Print-safe, no canvas. Shows 5-6 dimensions.
 */
'use client'

export interface RadarDimension {
  label: string
  /** Subject value as 0-1 (normalised to good=1, bad=0) */
  subject: number
  /** Peer median as 0-1 */
  peer: number
}

interface RadarChartProps {
  dimensions: RadarDimension[]
  width?: number
  height?: number
  title?: string
}

export function RadarChart({
  dimensions,
  width = 300,
  height = 280,
  title,
}: RadarChartProps) {
  if (dimensions.length < 3) return null
  const cx = width / 2
  const cy = (height + (title ? 20 : 0)) / 2
  const r = Math.min(cx, cy) - 50
  const n = dimensions.length
  const angleStep = (2 * Math.PI) / n
  const startAngle = -Math.PI / 2 // start from top

  const point = (i: number, scale: number) => {
    const angle = startAngle + i * angleStep
    return {
      x: cx + r * scale * Math.cos(angle),
      y: cy + r * scale * Math.sin(angle),
    }
  }

  const subjectPoints = dimensions.map((_, i) => point(i, dimensions[i].subject))
  const peerPoints = dimensions.map((_, i) => point(i, dimensions[i].peer))
  const subjectPath = subjectPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z'
  const peerPath = peerPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + 'Z'

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ fontFamily: "'Inter',sans-serif" }}>
      {title && (
        <text x={cx} y={16} fontSize={11} fontWeight={600} fill="#0A2340" textAnchor="middle">
          {title}
        </text>
      )}
      {/* Grid rings */}
      {[0.25, 0.5, 0.75, 1].map((s) => (
        <polygon
          key={s}
          points={Array.from({ length: n }, (_, i) => {
            const p = point(i, s)
            return `${p.x},${p.y}`
          }).join(' ')}
          fill="none"
          stroke="#E1DDD0"
          strokeWidth={0.5}
        />
      ))}
      {/* Axis lines */}
      {dimensions.map((_, i) => {
        const p = point(i, 1)
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#E1DDD0" strokeWidth={0.5} />
      })}
      {/* Peer area */}
      <path d={peerPath} fill="rgba(107,122,146,0.08)" stroke="#6B7A92" strokeWidth={1} strokeDasharray="4,3" />
      {/* Subject area */}
      <path d={subjectPath} fill="rgba(212,164,59,0.15)" stroke="#D4A43B" strokeWidth={1.5} />
      {/* Subject dots */}
      {subjectPoints.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={3} fill="#D4A43B" stroke="#fff" strokeWidth={1} />
      ))}
      {/* Labels */}
      {dimensions.map((d, i) => {
        const lp = point(i, 1.2)
        const anchor = lp.x < cx - 10 ? 'end' : lp.x > cx + 10 ? 'start' : 'middle'
        return (
          <text key={i} x={lp.x} y={lp.y + 3} fontSize={8} fill="#0A2340" textAnchor={anchor} fontWeight={500}>
            {d.label}
          </text>
        )
      })}
      {/* Legend */}
      <g transform={`translate(${width - 100}, ${height - 24})`}>
        <rect x={0} y={0} width={8} height={8} fill="rgba(212,164,59,0.3)" stroke="#D4A43B" strokeWidth={1} />
        <text x={12} y={7} fontSize={8} fill="#0A2340">Subject</text>
        <rect x={50} y={0} width={8} height={8} fill="rgba(107,122,146,0.15)" stroke="#6B7A92" strokeWidth={1} strokeDasharray="2,1" />
        <text x={62} y={7} fontSize={8} fill="#6B7A92">Peer</text>
      </g>
    </svg>
  )
}

/**
 * Normalise a ratio value to 0-1 for radar display.
 * higherIsBetter: true = higher value closer to 1
 */
export function normaliseRatio(value: number, min: number, max: number, higherIsBetter = true): number {
  if (max === min) return 0.5
  const norm = (value - min) / (max - min)
  const clamped = Math.max(0, Math.min(1, norm))
  return higherIsBetter ? clamped : 1 - clamped
}

export function radarInference(dimensions: RadarDimension[]): string {
  const strengths = dimensions.filter(d => d.subject > d.peer + 0.1).map(d => d.label)
  const weaknesses = dimensions.filter(d => d.subject < d.peer - 0.1).map(d => d.label)
  let text = ''
  if (strengths.length) text += `The company outperforms peers in ${strengths.join(', ')}. `
  if (weaknesses.length) text += `Areas below peer median: ${weaknesses.join(', ')}. `
  if (!strengths.length && !weaknesses.length) text += 'Performance is broadly in line with peers across all dimensions. '
  text += 'The radar profile shape reveals the strategic positioning — a margin-led profile differs fundamentally from an efficiency-led one in terms of risk and sustainability.'
  return text
}
