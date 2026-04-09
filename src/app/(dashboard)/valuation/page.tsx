import { getValuationMatrix } from '@/lib/data/valuation'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionTitle } from '@/components/ui/SectionTitle'
import { Badge, getRecommendationVariant } from '@/components/ui/Badge'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { ValuationRow } from '@/lib/data/valuation'

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

  const evEbitdaValues = matrix.map((r) => r.evEbitda)
  const peValues = matrix.map((r) => r.peRatio)
  const roicValues = matrix.map((r) => r.roic)
  const deValues = matrix.map((r) => r.debtEquity)
  const pbValues = matrix.map((r) => r.pbRatio)

  const columns: ColumnsType<ValuationRow> = [
    {
      title: 'Company',
      key: 'company',
      render: (_, row) => (
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
            {row.company}
          </div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--txt3)',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {row.ticker}
          </div>
        </div>
      ),
    },
    {
      title: 'Sector',
      dataIndex: 'sector',
      key: 'sector',
      render: (v: string) => <span style={{ fontSize: 12, color: 'var(--txt2)' }}>{v}</span>,
    },
    {
      title: 'EV',
      dataIndex: 'ev',
      key: 'ev',
      align: 'right',
      render: (v: string) => (
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: 'var(--gold2)',
          }}
        >
          {v}
        </span>
      ),
    },
    {
      title: 'EV/EBITDA',
      dataIndex: 'evEbitda',
      key: 'evEbitda',
      align: 'right',
      render: (v: number) => (
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: colorizeValue(v, evEbitdaValues, false),
            fontWeight: 500,
          }}
        >
          {v}x
        </span>
      ),
    },
    {
      title: 'P/E',
      dataIndex: 'peRatio',
      key: 'peRatio',
      align: 'right',
      render: (v: number) => (
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: colorizeValue(v, peValues, false),
          }}
        >
          {v}x
        </span>
      ),
    },
    {
      title: 'P/B',
      dataIndex: 'pbRatio',
      key: 'pbRatio',
      align: 'right',
      render: (v: number) => (
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: colorizeValue(v, pbValues, false),
          }}
        >
          {v}x
        </span>
      ),
    },
    {
      title: 'ROIC',
      dataIndex: 'roic',
      key: 'roic',
      align: 'right',
      render: (v: number) => (
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: colorizeValue(v, roicValues, true),
            fontWeight: 500,
          }}
        >
          {v}%
        </span>
      ),
    },
    {
      title: 'D/E',
      dataIndex: 'debtEquity',
      key: 'debtEquity',
      align: 'right',
      render: (v: number) => (
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: colorizeValue(v, deValues, false),
          }}
        >
          {v}x
        </span>
      ),
    },
    {
      title: 'Score',
      dataIndex: 'score',
      key: 'score',
      align: 'center',
      render: (v: number) => <ScoreBadge score={v} size={26} />,
    },
    {
      title: 'View',
      dataIndex: 'recommendation',
      key: 'recommendation',
      align: 'center',
      render: (v: string) => (
        <Badge variant={getRecommendationVariant(v)}>{v}</Badge>
      ),
    },
  ]

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
        <Table
          dataSource={matrix}
          columns={columns}
          rowKey="ticker"
          pagination={false}
          size="small"
          style={{ background: 'transparent' }}
          scroll={{ x: 900 }}
        />
      </div>
    </div>
  )
}
