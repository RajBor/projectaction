'use client'

import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { Badge, getRecommendationVariant } from '@/components/ui/Badge'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import type { ValuationRow } from '@/lib/data/valuation'

interface ValuationTableProps {
  matrix: ValuationRow[]
}

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

export function ValuationTable({ matrix }: ValuationTableProps) {
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
    <Table
      dataSource={matrix}
      columns={columns}
      rowKey="ticker"
      pagination={false}
      size="small"
      style={{ background: 'transparent' }}
      scroll={{ x: 900 }}
    />
  )
}