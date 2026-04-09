'use client'

import { useState } from 'react'

const sectors = [
  {
    name: 'Solar IPP',
    color: '#F7B731',
    count: 8,
    companies: ['Adani Green', 'ReNew Power', 'Avaada Energy', 'Azure Power'],
  },
  {
    name: 'Solar Mfg',
    color: '#00B4D8',
    count: 5,
    companies: ['Waaree', 'Premier Energies', 'Vikram Solar', 'Borosil Renewables'],
  },
  {
    name: 'Wind',
    color: '#10B981',
    count: 4,
    companies: ['Inox Wind', 'Suzlon', 'GE Power', 'Siemens Gamesa India'],
  },
  {
    name: 'T&D',
    color: '#8B5CF6',
    count: 6,
    companies: ['Sterlite Power', 'Kalpataru', 'KEC International', 'Adani Transmission'],
  },
  {
    name: 'Storage',
    color: '#F59E0B',
    count: 3,
    companies: ['Amara Raja', 'Exide Industries', 'Greenfuel Energy'],
  },
]

const dealStages = [
  { stage: 'Screening', count: 3, color: '#9AAFC8' },
  { stage: 'Diligence', count: 2, color: '#00B4D8' },
  { stage: 'Negotiation', count: 1, color: '#F59E0B' },
  { stage: 'LOI', count: 1, color: '#F7B731' },
  { stage: 'Closed', count: 1, color: '#10B981' },
]

function SectorRow({
  name,
  color,
  count,
  companies,
}: {
  name: string
  color: string
  count: number
  companies: string[]
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '7px 12px',
          cursor: 'pointer',
          borderRadius: 4,
          transition: 'background 0.15s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--s3)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: color,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 12, color: 'var(--txt2)' }}>{name}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              fontSize: 10,
              background: 'var(--s4)',
              color: 'var(--txt3)',
              padding: '1px 6px',
              borderRadius: 3,
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            {count}
          </span>
          <span style={{ fontSize: 10, color: 'var(--txt4)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ paddingLeft: 28, paddingBottom: 4 }}>
          {companies.map((c) => (
            <div
              key={c}
              style={{
                fontSize: 11,
                color: 'var(--txt3)',
                padding: '4px 8px',
                borderRadius: 3,
                cursor: 'pointer',
                transition: 'color 0.15s',
              }}
              onMouseEnter={(e) =>
                ((e.currentTarget as HTMLElement).style.color = 'var(--txt)')
              }
              onMouseLeave={(e) =>
                ((e.currentTarget as HTMLElement).style.color = 'var(--txt3)')
              }
            >
              {c}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Sidebar() {
  return (
    <div
      style={{
        width: 220,
        flexShrink: 0,
        background: 'var(--s1)',
        borderRight: '1px solid var(--br)',
        height: '100%',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Deal Pipeline */}
      <div style={{ padding: '16px 12px 8px' }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 10,
            paddingLeft: 4,
          }}
        >
          Deal Pipeline
        </div>
        {dealStages.map(({ stage, count, color }) => (
          <div
            key={stage}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 8px',
              marginBottom: 2,
              borderRadius: 4,
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--s2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{ width: 6, height: 6, borderRadius: '50%', background: color }}
              />
              <span style={{ fontSize: 12, color: 'var(--txt2)' }}>{stage}</span>
            </div>
            <span
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                color,
                fontWeight: 500,
              }}
            >
              {count}
            </span>
          </div>
        ))}
      </div>

      <div style={{ height: 1, background: 'var(--br)', margin: '4px 12px' }} />

      {/* Sectors */}
      <div style={{ padding: '12px 0 8px', flex: 1, overflow: 'auto' }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 8,
            paddingLeft: 16,
          }}
        >
          Sectors
        </div>
        {sectors.map((s) => (
          <SectorRow key={s.name} {...s} />
        ))}
      </div>

      <div style={{ height: 1, background: 'var(--br)', margin: '4px 12px' }} />

      {/* Market Status */}
      <div style={{ padding: '10px 16px 16px' }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          Market
        </div>
        {[
          { label: 'NIFTY 50', value: '22,326', up: true },
          { label: 'NIFTY ENERGY', value: '40,182', up: false },
          { label: 'BSE POWER', value: '6,842', up: true },
        ].map(({ label, value, up }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginBottom: 4,
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--txt3)' }}>{label}</span>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'JetBrains Mono, monospace',
                color: up ? 'var(--green)' : 'var(--red)',
              }}
            >
              {value}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
