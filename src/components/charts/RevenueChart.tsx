'use client'

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface DataPoint {
  month: string
  revenue: number
  ebitda: number
  capex: number
}

interface RevenueChartProps {
  data: DataPoint[]
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
        <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 6 }}>{label}</div>
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
            <span style={{ color: entry.color }}>{entry.name}</span>
            <span
              style={{ color: 'var(--txt)', fontFamily: 'JetBrains Mono, monospace' }}
            >
              ₹{entry.value}Cr
            </span>
          </div>
        ))}
      </div>
    )
  }
  return null
}

export function RevenueChart({ data }: RevenueChartProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <defs>
          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#F7B731" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#F7B731" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorEbitda" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#00B4D8" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#00B4D8" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorCapex" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--br)" strokeOpacity={0.5} />
        <XAxis
          dataKey="month"
          tick={{ fill: 'var(--txt3)', fontSize: 11 }}
          axisLine={{ stroke: 'var(--br)' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: 'var(--txt3)', fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          tickFormatter={(v) => `${v}`}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: 'var(--txt3)', paddingTop: 8 }}
          iconType="circle"
          iconSize={8}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          name="Revenue"
          stroke="#F7B731"
          strokeWidth={2}
          fill="url(#colorRevenue)"
        />
        <Area
          type="monotone"
          dataKey="ebitda"
          name="EBITDA"
          stroke="#00B4D8"
          strokeWidth={2}
          fill="url(#colorEbitda)"
        />
        <Area
          type="monotone"
          dataKey="capex"
          name="Capex"
          stroke="#8B5CF6"
          strokeWidth={1.5}
          strokeDasharray="4 4"
          fill="url(#colorCapex)"
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
