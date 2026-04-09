'use client'

import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import type { Company } from '@/lib/data/dashboard'

interface CompaniesTableProps {
  companies: Company[]
}

export function CompaniesTable({ companies }: CompaniesTableProps) {
  const companyColumns: ColumnsType<Company> = [
    {
      title: 'Company',
      dataIndex: 'name',
      key: 'name',
      render: (name: string, row) => (
        <div>
          <div style={{ fontSize: 13, color: 'var(--txt)', fontWeight: 500 }}>{name}</div>
          <div
            style={{
              fontSize: 10,
              color: 'var(--txt3)',
              fontFamily: 'JetBrains Mono, monospace',
              marginTop: 2,
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
      render: (sector: string) => (
        <span style={{ fontSize: 12, color: 'var(--txt2)' }}>{sector}</span>
      ),
    },
    {
      title: 'Price',
      dataIndex: 'price',
      key: 'price',
      align: 'right',
      render: (price: number, row) => (
        <div>
          <div
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 12,
              color: 'var(--txt)',
            }}
          >
            {row.ticker === 'PRIVATE' ? 'Private' : `₹${price.toFixed(2)}`}
          </div>
          {row.ticker !== 'PRIVATE' && (
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                color: row.changePct >= 0 ? 'var(--green)' : 'var(--red)',
              }}
            >
              {row.changePct >= 0 ? '+' : ''}{row.changePct.toFixed(2)}%
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Mkt Cap',
      dataIndex: 'marketCap',
      key: 'marketCap',
      align: 'right',
      render: (v: string) => (
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 12,
            color: 'var(--txt2)',
          }}
        >
          {v}
        </span>
      ),
    },
    {
      title: 'Score',
      dataIndex: 'score',
      key: 'score',
      align: 'center',
      render: (score: number) => <ScoreBadge score={score} size={26} />,
    },
  ]

  return (
    <Table
      dataSource={companies}
      columns={companyColumns}
      rowKey="id"
      pagination={false}
      size="small"
      style={{ background: 'transparent' }}
    />
  )
}