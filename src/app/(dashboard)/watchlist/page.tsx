'use client'

import { useEffect, useMemo, useState } from 'react'
import { KpiCard } from '@/components/ui/KpiCard'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { Badge } from '@/components/ui/Badge'

type WLStatus =
  | 'Monitoring'
  | 'Active Diligence'
  | 'In Negotiation'
  | 'LOI Signed'
  | 'Paused'
  | 'Rejected'

const STATUSES: WLStatus[] = [
  'Monitoring',
  'Active Diligence',
  'In Negotiation',
  'LOI Signed',
  'Paused',
  'Rejected',
]

interface WLItem {
  ticker: string
  name: string
  sec?: string
  acqs: number
  acqf?: string
  rev?: number
  ev?: number
  ev_eb?: number
  ebm?: number
  notes?: string
  targetEV?: string | number
  addedDate?: string
  status?: WLStatus
}

const WL_KEY = 'sg4_wl'

function loadWL(): WLItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(WL_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed as WLItem[]
    return []
  } catch {
    return []
  }
}

function saveWL(items: WLItem[]) {
  try {
    localStorage.setItem(WL_KEY, JSON.stringify(items))
  } catch {}
}

function flagVariant(score: number): 'green' | 'gold' | 'cyan' {
  if (score >= 8) return 'green'
  if (score >= 6) return 'gold'
  return 'cyan'
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WLItem[]>([])
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    setItems(loadWL())
    setLoaded(true)
  }, [])

  const updateItem = (ticker: string, patch: Partial<WLItem>) => {
    setItems((prev) => {
      const next = prev.map((it) => (it.ticker === ticker ? { ...it, ...patch } : it))
      saveWL(next)
      return next
    })
  }

  const removeItem = (ticker: string) => {
    setItems((prev) => {
      const next = prev.filter((it) => it.ticker !== ticker)
      saveWL(next)
      return next
    })
  }

  const exportCSV = () => {
    if (!items.length) return
    const headers = [
      'Name',
      'Ticker',
      'AddedDate',
      'Score',
      'Revenue',
      'EV',
      'EV/EBITDA',
      'EBITDA%',
      'Status',
      'Notes',
    ]
    const body = items
      .map((i) =>
        [
          i.name,
          i.ticker,
          i.addedDate || '',
          i.acqs,
          i.rev ?? '',
          i.ev ?? '',
          i.ev_eb ?? '',
          i.ebm ?? '',
          i.status ?? 'Monitoring',
          i.notes ?? '',
        ]
          .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      )
      .join('\n')
    const csv = headers.join(',') + '\n' + body
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'watchlist.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const avgScore = useMemo(
    () => (items.length ? (items.reduce((s, i) => s + (i.acqs || 0), 0) / items.length).toFixed(1) : '0.0'),
    [items]
  )
  const starred = useMemo(() => items.filter((i) => i.acqs >= 8).length, [items])
  const totalEV = useMemo(
    () => items.reduce((s, i) => s + (i.ev || 0), 0),
    [items]
  )

  const thStyle: React.CSSProperties = {
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: 10,
    color: 'var(--txt3)',
    fontWeight: 600,
    letterSpacing: '1px',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  }
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: 12,
    color: 'var(--txt)',
    fontFamily: 'JetBrains Mono, monospace',
    whiteSpace: 'nowrap',
  }

  return (
    <div>
      {/* Header */}
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
          SolarGrid Pro <span style={{ margin: '0 6px' }}>›</span> Portfolio
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
          My <em style={{ color: 'var(--gold2)', fontStyle: 'normal' }}>Watchlist</em>
        </h1>
        <div style={{ marginTop: 10 }}>
          <Badge variant="gray">
            {items.length} companies saved · Persists across sessions
          </Badge>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        <KpiCard
          label="Companies Tracked"
          value={String(items.length)}
          sub="Active coverage"
          color="cyan"
          delay={0}
        />
        <KpiCard
          label="Starred"
          value={String(starred)}
          sub="Score ≥ 8"
          color="gold"
          delay={0.07}
        />
        <KpiCard
          label="Avg Score"
          value={avgScore}
          sub="Portfolio quality"
          color="green"
          delay={0.14}
        />
        <KpiCard
          label="Total EV"
          value={totalEV > 0 ? '₹' + totalEV.toLocaleString() + 'Cr' : '—'}
          sub="Aggregate enterprise value"
          color="purple"
          delay={0.21}
        />
      </div>

      {/* Action Bar */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          marginBottom: 16,
          alignItems: 'center',
        }}
      >
        <button
          style={{
            background: 'var(--green)',
            border: '1px solid var(--green)',
            color: '#fff',
            fontSize: 12,
            padding: '6px 14px',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          + Add Company
        </button>
        {items.length > 0 && (
          <button
            onClick={exportCSV}
            style={{
              background: 'var(--s2)',
              border: '1px solid var(--br)',
              color: 'var(--txt2)',
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Export CSV
          </button>
        )}
      </div>

      {/* Empty State */}
      {loaded && items.length === 0 && (
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            textAlign: 'center',
            padding: 48,
          }}
        >
          <div style={{ fontSize: 15, color: 'var(--txt3)' }}>
            No companies in watchlist yet.
          </div>
          <div style={{ fontSize: 13, color: 'var(--txt3)', marginTop: 6 }}>
            Add companies from M&A Radar, Valuation Matrix, or Value Chain tabs.
          </div>
        </div>
      )}

      {/* Table */}
      {items.length > 0 && (
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--s1)', borderBottom: '1px solid var(--br)' }}>
                  <th style={thStyle}>Score</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Ticker</th>
                  <th style={thStyle}>Added</th>
                  <th style={thStyle}>Revenue</th>
                  <th style={thStyle}>EV</th>
                  <th style={thStyle}>EV/EBITDA</th>
                  <th style={thStyle}>EBITDA%</th>
                  <th style={thStyle}>Notes</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((co) => (
                  <tr
                    key={co.ticker}
                    style={{
                      borderBottom: '1px solid var(--br)',
                      background: co.acqs >= 9 ? 'rgba(247,183,49,0.05)' : 'transparent',
                    }}
                  >
                    <td style={tdStyle}>
                      <ScoreBadge score={co.acqs} size={26} />
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        fontFamily: 'Inter, sans-serif',
                        minWidth: 160,
                      }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
                        {co.acqs >= 8 ? '★ ' : ''}
                        {co.name}
                      </div>
                      {co.acqf && (
                        <div style={{ marginTop: 3 }}>
                          <Badge variant={flagVariant(co.acqs)}>{co.acqf}</Badge>
                        </div>
                      )}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--txt3)' }}>{co.ticker}</td>
                    <td style={{ ...tdStyle, color: 'var(--txt3)' }}>{co.addedDate || '—'}</td>
                    <td style={{ ...tdStyle, color: 'var(--gold2)' }}>
                      {co.rev ? '₹' + co.rev.toLocaleString() + 'Cr' : '—'}
                    </td>
                    <td style={{ ...tdStyle, color: 'var(--gold2)' }}>
                      {co.ev && co.ev > 0 ? '₹' + co.ev.toLocaleString() + 'Cr' : 'N/A'}
                    </td>
                    <td style={tdStyle}>{co.ev_eb && co.ev_eb > 0 ? co.ev_eb + '×' : '—'}</td>
                    <td style={{ ...tdStyle, color: 'var(--green)' }}>
                      {co.ebm != null ? co.ebm + '%' : '—'}
                    </td>
                    <td
                      style={{
                        ...tdStyle,
                        fontFamily: 'Inter, sans-serif',
                        maxWidth: 220,
                        whiteSpace: 'normal',
                        color: 'var(--txt2)',
                      }}
                    >
                      {co.notes || (
                        <span style={{ color: 'var(--txt4)' }}>No notes</span>
                      )}
                    </td>
                    <td style={tdStyle}>
                      <select
                        value={co.status || 'Monitoring'}
                        onChange={(e) =>
                          updateItem(co.ticker, { status: e.target.value as WLStatus })
                        }
                        style={{
                          background: 'var(--s3)',
                          border: '1px solid var(--br)',
                          color: 'var(--txt)',
                          fontSize: 11,
                          padding: '4px 8px',
                          borderRadius: 3,
                        }}
                      >
                        {STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => {
                          const n = prompt('Notes', co.notes || '')
                          if (n != null) updateItem(co.ticker, { notes: n })
                        }}
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
                        Edit
                      </button>
                      <button
                        onClick={() => removeItem(co.ticker)}
                        style={{
                          background: 'var(--reddim)',
                          border: '1px solid var(--red)',
                          color: 'var(--red)',
                          fontSize: 11,
                          padding: '3px 8px',
                          borderRadius: 3,
                          cursor: 'pointer',
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
