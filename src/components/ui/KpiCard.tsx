'use client'

import { motion } from 'framer-motion'

interface KpiCardProps {
  label: string
  value: string
  sub: string
  color: 'gold' | 'cyan' | 'green' | 'red' | 'orange' | 'purple'
  trend?: number
  delay?: number
}

const colorMap = {
  gold: { main: 'var(--gold2)', dim: 'var(--golddim)', border: 'rgba(247,183,49,0.2)' },
  cyan: { main: 'var(--cyan)', dim: 'var(--cyandim)', border: 'rgba(0,180,216,0.2)' },
  green: { main: 'var(--green)', dim: 'var(--greendim)', border: 'rgba(16,185,129,0.2)' },
  red: { main: 'var(--red)', dim: 'var(--reddim)', border: 'rgba(239,68,68,0.2)' },
  orange: { main: 'var(--orange)', dim: 'var(--orangedim)', border: 'rgba(245,158,11,0.2)' },
  purple: {
    main: 'var(--purple)',
    dim: 'var(--purpledim)',
    border: 'rgba(139,92,246,0.2)',
  },
}

export function KpiCard({ label, value, sub, color, trend, delay = 0 }: KpiCardProps) {
  const colors = colorMap[color]

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      whileHover={{ scale: 1.02, y: -2 }}
      style={{
        background: 'var(--s2)',
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        padding: '18px 20px',
        position: 'relative',
        overflow: 'hidden',
        cursor: 'default',
        flex: 1,
        minWidth: 0,
      }}
    >
      {/* Glow accent top line */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(to right, ${colors.main}, transparent)`,
        }}
      />

      {/* Background glow */}
      <div
        style={{
          position: 'absolute',
          top: -20,
          right: -20,
          width: 80,
          height: 80,
          borderRadius: '50%',
          background: colors.dim,
          filter: 'blur(20px)',
          pointerEvents: 'none',
        }}
      />

      <div style={{ position: 'relative' }}>
        {/* Label */}
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          {label}
        </div>

        {/* Value */}
        <div
          style={{
            fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
            fontSize: 26,
            fontWeight: 700,
            color: colors.main,
            lineHeight: 1,
            marginBottom: 8,
          }}
        >
          {value}
        </div>

        {/* Sub + Trend */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: 'var(--txt3)' }}>{sub}</span>
          {trend !== undefined && (
            <span
              style={{
                fontSize: 11,
                fontFamily: 'JetBrains Mono, monospace',
                color: trend >= 0 ? 'var(--green)' : 'var(--red)',
                display: 'flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              {trend >= 0 ? '▲' : '▼'} {Math.abs(trend)}%
            </span>
          )}
        </div>
      </div>
    </motion.div>
  )
}
