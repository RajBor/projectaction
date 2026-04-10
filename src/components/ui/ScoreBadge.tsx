'use client'

interface ScoreBadgeProps {
  score: number
  size?: number
}

function getScoreColor(score: number): string {
  if (score >= 9) return '#10B981'
  if (score >= 7) return '#F7B731'
  if (score >= 5) return '#F59E0B'
  return '#EF4444'
}

export function ScoreBadge({ score, size = 28 }: ScoreBadgeProps) {
  const color = getScoreColor(score)

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: `${color}18`,
        border: `1.5px solid ${color}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 700,
        color,
        fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
        flexShrink: 0,
      }}
    >
      {score}
    </div>
  )
}
