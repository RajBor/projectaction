'use client'

import { useState } from 'react'

const CATEGORIES = [
  'Solar Value Chain',
  'T&D Infrastructure',
  'M&A & Investment',
  'Policy & Regulation',
  'Market Trends',
  'Financial Results',
  'Supply Chain Disruptions',
] as const

type Category = (typeof CATEGORIES)[number]

export default function NewsHubPage() {
  const [active, setActive] = useState<Category | null>(null)

  return (
    <div>
      {/* phdr */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          SolarGrid Pro <span style={{ opacity: 0.5 }}>›</span> Intelligence
        </div>
        <h1
          style={{
            fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
          }}
        >
          News <em style={{ color: 'var(--gold2)', fontStyle: 'normal' }}>Hub</em>
        </h1>
        <div style={{ marginTop: 6 }}>
          <span
            style={{
              display: 'inline-block',
              background: 'rgba(16,185,129,0.12)',
              color: 'var(--green)',
              border: '1px solid rgba(16,185,129,0.3)',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 11,
            }}
          >
            AI-powered · Live web search · 60-day window · Requires API Key
          </span>
        </div>
      </div>

      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        {/* Category buttons */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 16,
          }}
        >
          {CATEGORIES.map((cat) => {
            const isActive = active === cat
            return (
              <button
                key={cat}
                onClick={() => setActive(cat)}
                style={{
                  background: isActive ? 'var(--gold2)' : 'var(--s3)',
                  color: isActive ? '#000' : 'var(--txt)',
                  border: `1px solid ${isActive ? 'var(--gold2)' : 'var(--br)'}`,
                  padding: '7px 14px',
                  borderRadius: 5,
                  fontSize: 12,
                  fontWeight: isActive ? 700 : 500,
                  cursor: 'pointer',
                }}
              >
                {cat}
              </button>
            )
          })}
        </div>

        {/* Output */}
        <div>
          {active === null ? (
            <div
              style={{
                background: 'var(--s3)',
                border: '1px solid var(--br)',
                borderRadius: 7,
                textAlign: 'center',
                padding: 32,
              }}
            >
              <div style={{ fontSize: 15, color: 'var(--txt3)' }}>
                Select a category above to fetch live AI-powered news
              </div>
              <div style={{ fontSize: 13, color: 'var(--txt3)', marginTop: 6 }}>
                Requires Anthropic API key in the header
              </div>
            </div>
          ) : (
            <div
              style={{
                background: 'rgba(245,158,11,0.08)',
                border: '1px solid rgba(245,158,11,0.3)',
                borderRadius: 7,
                padding: 18,
                color: 'var(--txt2)',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--orange)',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  marginBottom: 6,
                }}
              >
                ⚠ API Key Required
              </div>
              <div>
                Connect API key in Settings to enable AI news. Selected category:{' '}
                <strong style={{ color: 'var(--txt)' }}>{active}</strong>
              </div>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--txt3)' }}>
                Once connected, this panel will fetch the latest "{active}" stories from the
                Indian renewable energy sector via Claude with live web search.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
