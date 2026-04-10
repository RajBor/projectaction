'use client'

import { useMemo, useRef, useState } from 'react'
import { COMPANIES } from '@/lib/data/companies'
import type { Company } from '@/lib/data/companies'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { Badge } from '@/components/ui/Badge'
import { SectionTitle } from '@/components/ui/SectionTitle'

function evEbColor(v: number): string {
  if (v <= 0) return 'var(--txt3)'
  if (v <= 20) return 'var(--green)'
  if (v <= 35) return 'var(--gold2)'
  return 'var(--red)'
}

function getAcqVariant(score: number): 'green' | 'gold' | 'cyan' {
  if (score >= 8) return 'green'
  if (score >= 6) return 'gold'
  return 'cyan'
}

export default function StocksPage() {
  const listed = useMemo(
    () => COMPANIES.filter((c) => c.mktcap > 0).sort((a, b) => b.acqs - a.acqs),
    []
  )

  const [selected, setSelected] = useState<Company | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const hScroll = (dir: -1 | 1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * 240, behavior: 'smooth' })
  }

  return (
    <div>
      {/* Page Header (phdr) */}
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
          SolarGrid Pro <span style={{ margin: '0 6px' }}>›</span> Live Market Data
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
          Live <em style={{ color: 'var(--gold2)', fontStyle: 'normal' }}>Stock Terminal</em>
        </h1>
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Badge variant="orange">Live data integration pending</Badge>
          <Badge variant="gray">Stooq + Yahoo · 3 CORS proxies · Auto-refresh 5min</Badge>
          <Badge variant="gold">Click any company to load details</Badge>
        </div>
      </div>

      {/* Info alert */}
      <div
        style={{
          background: 'var(--cyandim)',
          border: '1px solid rgba(0,180,216,0.3)',
          borderRadius: 6,
          padding: '10px 14px',
          fontSize: 12,
          color: 'var(--txt2)',
          marginBottom: 16,
        }}
      >
        Data sourced from Yahoo Finance (NSE suffix .NS / BSE suffix .BO) via CORS proxy. Prices are delayed 15 minutes.
      </div>

      {/* Select Company */}
      <div style={{ marginBottom: 16 }}>
        <SectionTitle title="Select Company" subtitle="Horizontal Scroll" />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 20,
        }}
      >
        <button
          onClick={() => hScroll(-1)}
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            color: 'var(--txt2)',
            width: 28,
            height: 32,
            borderRadius: 4,
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 16,
          }}
        >
          ‹
        </button>
        <div
          ref={scrollRef}
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            padding: '4px 0',
            flex: 1,
            scrollbarWidth: 'thin',
          }}
        >
          {listed.map((co) => {
            const active = selected?.ticker === co.ticker
            return (
              <button
                key={co.ticker}
                onClick={() => setSelected(co)}
                style={{
                  background: active ? 'var(--golddim)' : 'var(--s2)',
                  border: `1px solid ${active ? 'var(--gold2)' : 'var(--br)'}`,
                  color: active ? 'var(--gold2)' : 'var(--txt2)',
                  whiteSpace: 'nowrap',
                  fontSize: 13,
                  padding: '7px 14px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {co.name.split(' ')[0]}
              </button>
            )
          })}
        </div>
        <button
          onClick={() => hScroll(1)}
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            color: 'var(--txt2)',
            width: 28,
            height: 32,
            borderRadius: 4,
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 16,
          }}
        >
          ›
        </button>
      </div>

      {/* Stock Detail */}
      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 20,
          marginBottom: 20,
        }}
      >
        {selected ? (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'Space Grotesk, sans-serif',
                    fontSize: 18,
                    fontWeight: 700,
                    color: 'var(--txt)',
                  }}
                >
                  {selected.name}{' '}
                  <span
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 12,
                      color: 'var(--txt3)',
                      fontWeight: 400,
                    }}
                  >
                    {selected.ticker} · NSE
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginTop: 6,
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 28,
                      fontWeight: 700,
                      color: 'var(--gold2)',
                    }}
                  >
                    ₹—
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
                    Live price unavailable
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Badge variant={getAcqVariant(selected.acqs)}>{selected.acqf || '—'}</Badge>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 10,
                marginBottom: 14,
              }}
            >
              {[
                { lbl: '52W High', val: '₹—' },
                { lbl: '52W Low', val: '₹—' },
                {
                  lbl: 'Market Cap',
                  val: selected.mktcap > 0 ? '₹' + selected.mktcap.toLocaleString() + 'Cr' : '—',
                },
                { lbl: 'Revenue FY24', val: '₹' + selected.rev.toLocaleString() + 'Cr' },
                { lbl: 'EBITDA Margin', val: selected.ebm + '%' },
                {
                  lbl: 'EV/EBITDA (SG)',
                  val: selected.ev_eb > 0 ? selected.ev_eb + '×' : '—',
                },
                { lbl: 'D/E Ratio', val: String(selected.dbt_eq) },
              ].map((s) => (
                <div
                  key={s.lbl}
                  style={{
                    background: 'var(--s1)',
                    border: '1px solid var(--br)',
                    borderRadius: 6,
                    padding: '10px 12px',
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: 'var(--txt3)',
                      letterSpacing: '1px',
                      textTransform: 'uppercase',
                      marginBottom: 4,
                    }}
                  >
                    {s.lbl}
                  </div>
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 14,
                      fontWeight: 600,
                      color: 'var(--txt)',
                    }}
                  >
                    {s.val}
                  </div>
                </div>
              ))}
              <div
                style={{
                  background: 'var(--s1)',
                  border: '1px solid var(--br)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--txt3)',
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                  }}
                >
                  Acq Score
                </div>
                <ScoreBadge score={selected.acqs} size={28} />
              </div>
            </div>

            <div
              style={{
                background: 'var(--s1)',
                border: '1px solid var(--br)',
                borderRadius: 6,
                padding: '12px 14px',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--txt3)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                Strategic Assessment
              </div>
              <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.6, margin: 0 }}>
                {selected.rea || 'No strategic notes available for this company.'}
              </p>
            </div>

            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--txt3)' }}>
              Price data via Yahoo Finance (NSE) through CORS proxy · 15 min delayed · For reference only, not investment advice
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 15, color: 'var(--txt3)' }}>
              Select a company above to load live price chart and data
            </div>
          </div>
        )}
      </div>

      {/* Live Price Board */}
      <div style={{ marginBottom: 16 }}>
        <SectionTitle
          title="Live Price Board"
          subtitle="All Tracked Companies"
        />
      </div>

      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
            }}
          >
            <thead>
              <tr
                style={{
                  background: 'var(--s1)',
                  borderBottom: '1px solid var(--br)',
                }}
              >
                {[
                  'Company',
                  'Last Price (₹)',
                  'Change %',
                  '52W High',
                  '52W Low',
                  'Our EV/EBITDA',
                  'Acq Score',
                  'Actions',
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '12px 14px',
                      textAlign: 'left',
                      fontSize: 10,
                      color: 'var(--txt3)',
                      fontWeight: 600,
                      letterSpacing: '1px',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listed.map((co) => (
                <tr
                  key={co.ticker}
                  style={{
                    borderBottom: '1px solid var(--br)',
                    background: co.acqs >= 8 ? 'rgba(247,183,49,0.03)' : 'transparent',
                  }}
                >
                  <td style={{ padding: '12px 14px', minWidth: 180 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--txt)',
                      }}
                    >
                      {co.acqs >= 8 ? '★ ' : ''}
                      {co.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--txt3)',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      {co.ticker}
                    </div>
                  </td>
                  <td style={{ padding: '12px 14px', minWidth: 110 }}>
                    <span style={{ color: 'var(--txt3)', fontSize: 12 }}>—</span>
                    <div style={{ fontSize: 9, color: 'var(--txt3)' }}>unavailable</div>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{ color: 'var(--txt3)' }}>—</span>
                  </td>
                  <td
                    style={{
                      padding: '12px 14px',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: 'var(--txt3)',
                    }}
                  >
                    —
                  </td>
                  <td
                    style={{
                      padding: '12px 14px',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: 'var(--txt3)',
                    }}
                  >
                    —
                  </td>
                  <td
                    style={{
                      padding: '12px 14px',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: evEbColor(co.ev_eb),
                      fontWeight: 600,
                    }}
                  >
                    {co.ev_eb > 0 ? co.ev_eb + '×' : '—'}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <ScoreBadge score={co.acqs} size={26} />
                  </td>
                  <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                    <button
                      onClick={() => setSelected(co)}
                      style={{
                        background: 'var(--s3)',
                        border: '1px solid var(--br2)',
                        color: 'var(--txt2)',
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 3,
                        cursor: 'pointer',
                        marginRight: 4,
                      }}
                    >
                      Details
                    </button>
                    <button
                      style={{
                        background: 'var(--s3)',
                        border: '1px solid var(--br2)',
                        color: 'var(--txt2)',
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      +WL
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          fontSize: 11,
          color: 'var(--txt3)',
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span style={{ color: 'var(--orange)' }}>Live data integration pending</span>
        <span>{listed.length} companies tracked</span>
      </div>
    </div>
  )
}
