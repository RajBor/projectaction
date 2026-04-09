'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface PipelineData {
  quarter: string
  screening: number
  diligence: number
  loi: number
  closed: number
}

interface PipelineBarProps {
  data: PipelineData[]
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
}) => {
  if (active && payload && payload.length) {
    return (
      <div
        style={{
          background: 'var(--s3)',
          border: '1px solid var(--br)',
          borderRadius: 6,
          padding: '10px 14px',
        }}
      >
        <div
          style={{
            fontSize: 11,
            color: 'var(--txt3)',
            marginBottom: 6,
            fontWeight: 600,
          }}
        >
          {label}
        </div>
        {payload.map((entry) => (
          <div
            key={entry.name}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 16,
              fontSize: 12,
              marginBottom: 2,
            }}
          >
            <span style={{ color: entry.color, textTransform: 'capitalize' }}>
              {entry.name}
            </span>
            <span
              style={{
                color: 'var(--txt)',
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: 600,
              }}
            >
              {entry.value}
            </span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

export function PipelineBar({ data }: PipelineBarProps) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" strokeOpacity={0.5} vertical={false} />
        <XAxis
          dataKey="quarter"
          tick={{ fill: 'var(--txt3)', fontSize: 10 }}
          axisLine={{ stroke: 'var(--br)' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: 'var(--txt3)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: 'var(--txt3)', paddingTop: 8 }}
          iconType="circle"
          iconSize={8}
        />
        <Bar dataKey="screening" name="Screening" fill="#556880" radius={[3, 3, 0, 0]} />
        <Bar dataKey="diligence" name="Diligence" fill="#00B4D8" radius={[3, 3, 0, 0]} />
        <Bar dataKey="loi" name="LOI" fill="#F7B731" radius={[3, 3, 0, 0]} />
        <Bar dataKey="closed" name="Closed" fill="#10B981" radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
