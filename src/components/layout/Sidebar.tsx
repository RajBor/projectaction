'use client'

import { useEffect, useState } from 'react'
import { useIndustryFilter } from '@/hooks/useIndustryFilter'

const INDUSTRY_OPTIONS = [
  { id: 'solar', label: 'Solar Value Chain', icon: '☀', desc: 'Modules, cells, wafers, BoS, inverters' },
  { id: 'td', label: 'T&D Infrastructure', icon: '⚡', desc: 'Transformers, cables, meters, BESS' },
]

const indices = [
  { label: 'NIFTY 50', value: '22,326', up: true },
  { label: 'NIFTY ENERGY', value: '40,182', up: false },
  { label: 'BSE POWER', value: '6,842', up: true },
  { label: 'NIFTY METAL', value: '9,418', up: true },
  { label: 'INR/USD', value: '83.42', up: false },
]

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const { selectedIndustries, toggleIndustry } = useIndustryFilter()

  return (
    <div
      style={{
        width: 260,
        height: '100%',
        background: 'var(--s1)',
        borderRight: '1px solid var(--br)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '8px 0 32px rgba(0,0,0,0.4)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--br)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--txt)',
            letterSpacing: '-0.01em',
          }}
        >
          Workspace
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--txt3)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--gold2)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--txt3)')}
          >
            ×
          </button>
        )}
      </div>

      {/* Industry selector — checkboxes */}
      <div style={{ padding: '16px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--txt3)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            Industry
          </span>
          <span style={{ fontSize: 9, color: 'var(--txt4)' }}>
            {selectedIndustries.length} selected
          </span>
        </div>
        {INDUSTRY_OPTIONS.map(opt => {
          const checked = selectedIndustries.includes(opt.id)
          return (
            <div
              key={opt.id}
              onClick={() => toggleIndustry(opt.id)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '8px 10px', marginBottom: 4,
                background: checked ? 'rgba(212,164,59,0.08)' : 'var(--s2)',
                border: `1px solid ${checked ? 'rgba(212,164,59,0.3)' : 'var(--br)'}`,
                borderRadius: 6, cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{
                width: 16, height: 16, borderRadius: 3, flexShrink: 0, marginTop: 1,
                border: `1.5px solid ${checked ? 'var(--gold2)' : 'var(--br2)'}`,
                background: checked ? 'var(--gold2)' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, color: '#000', fontWeight: 700,
              }}>
                {checked ? '✓' : ''}
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: checked ? 'var(--gold2)' : 'var(--txt2)' }}>
                  {opt.icon} {opt.label}
                </div>
                <div style={{ fontSize: 10, color: 'var(--txt4)', marginTop: 1, lineHeight: 1.3 }}>{opt.desc}</div>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ height: 1, background: 'var(--br)', margin: '4px 16px' }} />

      {/* Market Pulse */}
      <div style={{ padding: '14px 16px 12px', overflowY: 'auto', flex: 1 }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          Market Pulse
        </div>
        {indices.map(({ label, value, up }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '7px 0',
              borderBottom: '1px solid var(--br)',
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--txt3)' }}>{label}</span>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'JetBrains Mono, monospace',
                color: up ? 'var(--green)' : 'var(--red)',
                fontWeight: 500,
              }}
            >
              {up ? '▲ ' : '▼ '}
              {value}
            </span>
          </div>
        ))}
      </div>

      {/* Footer — Coverage */}
      <div style={{ padding: '12px 16px 18px', borderTop: '1px solid var(--br)' }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          Coverage
        </div>
        <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.6 }}>
          India Solar &amp; T&amp;D
          <br />
          86 Listed · 28 Private
          <br />
          23 Value Chain Nodes
        </div>
      </div>
    </div>
  )
}
