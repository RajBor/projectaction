'use client'

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface SectorData {
  name: string
  value: number
  color: string
}

interface SectorDonutProps {
  data: SectorData[]
}

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean
  payload?: { name: string; value: number; payload: { color: string } }[]
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
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: payload[0].payload.color,
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--txt)' }}>{payload[0].name}</span>
          <span
            style={{
              fontSize: 12,
              color: payload[0].payload.color,
              fontFamily: 'JetBrains Mono, monospace',
              fontWeight: 600,
            }}
          >
            {payload[0].value}%
          </span>
        </div>
      </div>
    )
  }
  return null
}

const renderCustomLabel = ({
  cx,
  cy,
  midAngle,
  innerRadius,
  outerRadius,
  percent,
}: {
  cx: number
  cy: number
  midAngle: number
  innerRadius: number
  outerRadius: number
  percent: number
}) => {
  if (percent < 0.08) return null
  const RADIAN = Math.PI / 180
  const radius = innerRadius + (outerRadius - innerRadius) * 0.5
  const x = cx + radius * Math.cos(-midAngle * RADIAN)
  const y = cy + radius * Math.sin(-midAngle * RADIAN)
  return (
    <text
      x={x}
      y={y}
      fill="rgba(255,255,255,0.85)"
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={11}
      fontFamily="JetBrains Mono, monospace"
    >
      {`${(percent * 100).toFixed(0)}%`}
    </text>
  )
}

export function SectorDonut({ data }: SectorDonutProps) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={58}
          outerRadius={88}
          paddingAngle={3}
          dataKey="value"
          labelLine={false}
          label={renderCustomLabel}
        >
          {data.map((entry, index) => (
            <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: 11, color: 'var(--txt3)', paddingTop: 4 }}
          iconType="circle"
          iconSize={8}
          formatter={(value) => (
            <span style={{ color: 'var(--txt2)', fontSize: 11 }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}
