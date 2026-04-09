import { getValuationMatrix } from '@/lib/data/valuation'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionTitle } from '@/components/ui/SectionTitle'
import { Badge, getRecommendationVariant } from '@/components/ui/Badge'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { ValuationTable } from '@/components/ui/ValuationTable'

function colorizeValue(
  value: number,
  allValues: number[],
  higherIsBetter: boolean
): string {
  const sorted = [...allValues].sort((a, b) => a - b)
  const min = sorted[0]
  const max = sorted[sorted.length - 1]
  const range = max - min
  if (range === 0) return 'var(--txt)'

  const normalized = (value - min) / range // 0 to 1

  if (higherIsBetter) {
    if (normalized >= 0.75) return 'var(--green)'
    if (normalized <= 0.25) return 'var(--red)'
    return 'var(--txt2)'
  } else {
    if (normalized <= 0.25) return 'var(--green)'
    if (normalized >= 0.75) return 'var(--red)'
    return 'var(--txt2)'
  }
}

export default async function ValuationPage() {
  const matrix = await getValuationMatrix()

  const avgEvEbitda = (matrix.reduce((s, r) => s + r.evEbitda, 0) / matrix.length).toFixed(1)
  const avgRoic = (matrix.reduce((s, r) => s + r.roic, 0) / matrix.length).toFixed(1)
  const strongBuys = matrix.filter((r) => r.recommendation === 'Strong Buy').length
  const buys = matrix.filter((r) => r.recommendation === 'Buy').length

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          Analysis
        </div>
        <h1
          style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
          }}
        >
          Valuation Matrix
        </h1>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24 }}>
        <KpiCard
          label="Avg EV/EBITDA"
          value={`${avgEvEbitda}x`}
          sub="Sector median: 24x"
          color="cyan"
          delay={0}
        />
        <KpiCard
          label="Avg ROIC"
          value={`${avgRoic}%`}
          sub="vs WACC 9.2%"
          color="green"
          trend={2.1}
          delay={0.07}
        />
        <KpiCard
          label="Strong Buys"
          value={String(strongBuys)}
          sub={`+ ${buys} Buy rated`}
          color="gold"
          delay={0.14}
        />
        <KpiCard
          label="Coverage"
          value={String(matrix.length)}
          sub="Companies covered"
          color="purple"
          delay={0.21}
        />
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 16,
          padding: '10px 16px',
          background: 'var(--s1)',
          borderRadius: 6,
          border: '1px solid var(--br)',
        }}
      >
        <span style={{ fontSize: 11, color: 'var(--txt3)' }}>Color coding:</span>
        <span style={{ fontSize: 11, color: 'var(--green)' }}>● Best in peer</span>
        <span style={{ fontSize: 11, color: 'var(--txt2)' }}>● Median</span>
        <span style={{ fontSize: 11, color: 'var(--red)' }}>● Weakest in peer</span>
        <span style={{ fontSize: 11, color: 'var(--txt4)', marginLeft: 'auto' }}>
          Lower EV/EBITDA, P/E, P/B, D/E = better · Higher ROIC = better
        </span>
      </div>

      {/* Table */}
      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '20px 20px 16px' }}>
          <SectionTitle title="Comparable Analysis" subtitle="Peer Group Metrics" />
        </div>
        <ValuationTable matrix={matrix} />
      </div>
    </div>
  )
}
