import { getDashboardKpis, getRevenueChartData, getSectorBreakdown, getTopCompanies, getPipelineTrend } from '@/lib/data/dashboard'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionTitle } from '@/components/ui/SectionTitle'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { Badge } from '@/components/ui/Badge'
import { RevenueChart } from '@/components/charts/RevenueChart'
import { SectorDonut } from '@/components/charts/SectorDonut'
import { PipelineBar } from '@/components/charts/PipelineBar'
import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { Company } from '@/lib/data/dashboard'

export default async function DashboardPage() {
  const [kpis, revenueData, sectorData, companies, pipelineData] = await Promise.all([
    getDashboardKpis(),
    getRevenueChartData(),
    getSectorBreakdown(),
    getTopCompanies(),
    getPipelineTrend(),
  ])

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
    <div>
      {/* Page header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, color: 'var(--txt3)', letterSpacing: '1.5px', textTransform: 'uppercase', marginBottom: 4 }}>
          Overview
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
          Investment Dashboard
        </h1>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
        {kpis.map((kpi, i) => (
          <KpiCard
            key={kpi.label}
            label={kpi.label}
            value={kpi.value}
            sub={kpi.sub}
            color={kpi.color}
            trend={kpi.trend}
            delay={i * 0.07}
          />
        ))}
      </div>

      {/* Charts Row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, marginBottom: 20 }}>
        {/* Revenue Chart */}
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: '20px 20px 16px',
          }}
        >
          <SectionTitle title="Portfolio Revenue Trend" subtitle="FY25 Monthly" />
          <RevenueChart data={revenueData} />
        </div>

        {/* Sector Donut */}
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: '20px 20px 16px',
          }}
        >
          <SectionTitle title="Sector Mix" subtitle="AUM Allocation" />
          <SectorDonut data={sectorData} />
        </div>
      </div>

      {/* Pipeline Bar */}
      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: '20px 20px 16px',
          marginBottom: 20,
        }}
      >
        <SectionTitle title="Deal Pipeline Trend" subtitle="Quarterly View" />
        <PipelineBar data={pipelineData} />
      </div>

      {/* Top Companies Table */}
      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: '20px 0 0',
          overflow: 'hidden',
        }}
      >
        <div style={{ padding: '0 20px 16px' }}>
          <SectionTitle title="Tracked Companies" subtitle="Top Positions" />
        </div>
        <Table
          dataSource={companies}
          columns={companyColumns}
          rowKey="id"
          pagination={false}
          size="small"
          style={{ background: 'transparent' }}
        />
      </div>
    </div>
  )
}
