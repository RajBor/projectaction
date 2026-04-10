'use client'

import { useEffect, useState } from 'react'

const INDUSTRIES = [
  { id: 'solar_td', label: 'Solar & T&D', desc: 'India RE value chain — current focus' },
  { id: 'wind', label: 'Wind & Hydro', desc: 'Onshore + offshore wind, small hydro' },
  { id: 'storage', label: 'Battery Storage', desc: 'Li-ion, BESS, grid-scale storage' },
  { id: 'hydrogen', label: 'Green Hydrogen', desc: 'Electrolysers, ammonia, fuel cells' },
  { id: 'ev', label: 'EV Infrastructure', desc: 'Charging, batteries, components' },
  { id: 'all_re', label: 'All Renewables', desc: 'Cross-sector view of full universe' },
]

const indices = [
  { label: 'NIFTY 50', value: '22,326', up: true },
  { label: 'NIFTY ENERGY', value: '40,182', up: false },
  { label: 'BSE POWER', value: '6,842', up: true },
  { label: 'NIFTY METAL', value: '9,418', up: true },
  { label: 'INR/USD', value: '83.42', up: false },
]

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const [industry, setIndustry] = useState<string>('solar_td')

  useEffect(() => {
    const stored = localStorage.getItem('sg4_industry')
    if (stored) setIndustry(stored)
  }, [])

  const changeIndustry = (id: string) => {
    setIndustry(id)
    localStorage.setItem('sg4_industry', id)
    window.dispatchEvent(new CustomEvent('sg4:industry-change', { detail: { id } }))
  }

  const current = INDUSTRIES.find((i) => i.id === industry) || INDUSTRIES[0]

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

      {/* Industry selector */}
      <div style={{ padding: '16px 16px 12px' }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 10,
          }}
        >
          Industry
        </div>
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 6,
            padding: '10px 12px',
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 13,
              color: 'var(--gold2)',
              fontWeight: 600,
              fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
            }}
          >
            {current.label}
          </div>
          <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>{current.desc}</div>
        </div>
        <select
          value={industry}
          onChange={(e) => changeIndustry(e.target.value)}
          style={{
            width: '100%',
            background: 'var(--s3)',
            border: '1px solid var(--br)',
            color: 'var(--txt)',
            padding: '8px 10px',
            borderRadius: 6,
            fontSize: 12,
            fontFamily: 'inherit',
            outline: 'none',
            cursor: 'pointer',
          }}
        >
          {INDUSTRIES.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
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
