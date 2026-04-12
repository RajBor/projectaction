'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import {
  loadPortfolios,
  createPortfolio,
  deletePortfolio,
  renamePortfolio,
  removeHolding,
  updateHolding,
  type Portfolio,
  type PortfolioHolding,
} from '@/lib/portfolio/store'
import {
  buildPortfolioTrend,
  fmtCr,
  fmtPct,
  type PortfolioTrend,
} from '@/lib/portfolio/trend'
import { useNewsData } from '@/components/news/NewsDataProvider'

/**
 * PortfolioManager — full portfolio UI mounted at the top of the
 * Watchlist page. Handles:
 *  - Create / select / delete portfolios
 *  - Holdings table with weight editing and removal
 *  - Trend chart (Recharts Area) with news event markers
 *  - Portfolio-level stats (current value, return, max drawdown)
 *  - Link to generate the portfolio PDF report
 */

export function PortfolioManager() {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [trend, setTrend] = useState<PortfolioTrend | null>(null)
  const [trendLoading, setTrendLoading] = useState(false)
  const [period, setPeriod] = useState<'1yr' | '3yr' | '5yr'>('1yr')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createDesc, setCreateDesc] = useState('')
  const [renameDraft, setRenameDraft] = useState<string>('')
  const [activeEvent, setActiveEvent] = useState<string | null>(null)

  const { items: newsItems } = useNewsData()

  // Hydrate from localStorage on mount
  useEffect(() => {
    const list = loadPortfolios()
    setPortfolios(list)
    if (list.length > 0) setSelectedId(list[0].id)
  }, [])

  // Reload on window focus so value-chain additions appear immediately
  useEffect(() => {
    const onFocus = () => {
      const list = loadPortfolios()
      setPortfolios(list)
      if (list.length > 0 && !list.some((p) => p.id === selectedId)) {
        setSelectedId(list[0].id)
      }
    }
    window.addEventListener('focus', onFocus)
    window.addEventListener('storage', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('storage', onFocus)
    }
  }, [selectedId])

  const selected = useMemo(
    () => portfolios.find((p) => p.id === selectedId) || null,
    [portfolios, selectedId]
  )

  useEffect(() => {
    if (selected) setRenameDraft(selected.name)
  }, [selected?.id, selected?.name])

  // Build trend whenever selected portfolio, period, or holdings change
  useEffect(() => {
    if (!selected || selected.holdings.length === 0) {
      setTrend(null)
      return
    }
    let cancelled = false
    setTrendLoading(true)
    buildPortfolioTrend(selected, { period, newsFeed: newsItems })
      .then((t) => {
        if (!cancelled) setTrend(t)
      })
      .catch(() => {
        if (!cancelled) setTrend(null)
      })
      .finally(() => {
        if (!cancelled) setTrendLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.holdings.length, period, newsItems.length])

  const refresh = () => {
    const list = loadPortfolios()
    setPortfolios(list)
    if (list.length > 0 && !list.some((p) => p.id === selectedId)) {
      setSelectedId(list[0].id)
    } else if (list.length === 0) {
      setSelectedId('')
    }
  }

  const handleCreate = () => {
    const p = createPortfolio(createName || 'New Portfolio', createDesc)
    setCreateName('')
    setCreateDesc('')
    setShowCreateForm(false)
    refresh()
    setSelectedId(p.id)
  }

  const handleDelete = (id: string) => {
    if (!confirm('Delete this portfolio? This cannot be undone.')) return
    deletePortfolio(id)
    refresh()
  }

  const handleRename = () => {
    if (!selected || !renameDraft.trim()) return
    renamePortfolio(selected.id, renameDraft.trim())
    refresh()
  }

  const handleHoldingWeight = (holdingKey: string, weight: number) => {
    if (!selected) return
    updateHolding(selected.id, holdingKey, { weight })
    refresh()
  }

  const handleHoldingRemove = (holdingKey: string) => {
    if (!selected) return
    removeHolding(selected.id, holdingKey)
    refresh()
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div
      style={{
        background: 'var(--s2)',
        border: '1px solid var(--br)',
        borderRadius: 8,
        padding: 18,
        marginBottom: 20,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '1.6px',
              textTransform: 'uppercase',
              color: 'var(--gold2)',
            }}
          >
            Target Portfolios
          </div>
          <div
            style={{
              fontFamily: 'Source Serif 4, Georgia, serif',
              fontSize: 22,
              fontWeight: 600,
              color: 'var(--txt)',
              letterSpacing: '-0.012em',
            }}
          >
            Portfolio <em style={{ fontStyle: 'italic', color: 'var(--gold2)' }}>Tracker</em>
          </div>
          <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>
            Track a group of listed + private M&A targets over time with news-driven event
            overlays. Generate a PDF deep dive from any portfolio.
          </div>
        </div>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          style={{
            background: 'var(--gold2)',
            color: '#000',
            border: 'none',
            padding: '8px 16px',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.4px',
            textTransform: 'uppercase',
            cursor: 'pointer',
            borderRadius: 4,
            fontFamily: 'inherit',
          }}
        >
          + New Portfolio
        </button>
      </div>

      {showCreateForm && (
        <div
          style={{
            background: 'var(--s3)',
            border: '1px solid var(--br2)',
            borderRadius: 6,
            padding: 14,
            marginBottom: 14,
            display: 'grid',
            gridTemplateColumns: '1fr 1fr auto',
            gap: 10,
            alignItems: 'end',
          }}
        >
          <div>
            <div style={hintLabel}>Name</div>
            <input
              placeholder="e.g. Solar Module Majors"
              value={createName}
              onChange={(e) => setCreateName(e.target.value)}
              style={textInput}
            />
          </div>
          <div>
            <div style={hintLabel}>Description</div>
            <input
              placeholder="Investment thesis"
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              style={textInput}
            />
          </div>
          <button
            onClick={handleCreate}
            style={{
              background: 'var(--green)',
              color: '#fff',
              border: 'none',
              padding: '9px 16px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.4px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              borderRadius: 4,
              fontFamily: 'inherit',
            }}
          >
            ✓ Create
          </button>
        </div>
      )}

      {portfolios.length === 0 ? (
        <div
          style={{
            background: 'var(--s3)',
            padding: 28,
            textAlign: 'center',
            borderRadius: 6,
            color: 'var(--txt3)',
            fontSize: 13,
            border: '1px dashed var(--br2)',
          }}
        >
          No portfolios yet. Click <strong>+ New Portfolio</strong> above, or open the Value
          Chain tab and add companies with the <strong>+ WL</strong> button — they'll land
          here automatically.
        </div>
      ) : (
        <>
          {/* Portfolio tabs */}
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginBottom: 14,
              flexWrap: 'wrap',
              borderBottom: '1px solid var(--br)',
              paddingBottom: 8,
            }}
          >
            {portfolios.map((p) => {
              const active = p.id === selectedId
              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  style={{
                    background: active ? 'var(--golddim)' : 'transparent',
                    color: active ? 'var(--gold2)' : 'var(--txt2)',
                    border: `1px solid ${active ? 'var(--gold2)' : 'var(--br2)'}`,
                    padding: '6px 12px',
                    fontSize: 11,
                    fontWeight: active ? 700 : 500,
                    cursor: 'pointer',
                    borderRadius: 3,
                    fontFamily: 'inherit',
                  }}
                >
                  {p.name}{' '}
                  <span style={{ fontSize: 9, color: 'var(--txt3)', marginLeft: 4 }}>
                    ({p.holdings.length})
                  </span>
                </button>
              )
            })}
          </div>

          {selected && (
            <PortfolioView
              portfolio={selected}
              trend={trend}
              trendLoading={trendLoading}
              period={period}
              setPeriod={setPeriod}
              renameDraft={renameDraft}
              setRenameDraft={setRenameDraft}
              onRename={handleRename}
              onDelete={() => handleDelete(selected.id)}
              onHoldingWeight={handleHoldingWeight}
              onHoldingRemove={handleHoldingRemove}
              activeEvent={activeEvent}
              setActiveEvent={setActiveEvent}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── Inner view for a single selected portfolio ───────────────

function PortfolioView({
  portfolio,
  trend,
  trendLoading,
  period,
  setPeriod,
  renameDraft,
  setRenameDraft,
  onRename,
  onDelete,
  onHoldingWeight,
  onHoldingRemove,
  activeEvent,
  setActiveEvent,
}: {
  portfolio: Portfolio
  trend: PortfolioTrend | null
  trendLoading: boolean
  period: '1yr' | '3yr' | '5yr'
  setPeriod: (p: '1yr' | '3yr' | '5yr') => void
  renameDraft: string
  setRenameDraft: (v: string) => void
  onRename: () => void
  onDelete: () => void
  onHoldingWeight: (key: string, weight: number) => void
  onHoldingRemove: (key: string) => void
  activeEvent: string | null
  setActiveEvent: (v: string | null) => void
}) {
  const totalEntry = portfolio.holdings.reduce((s, h) => s + (h.entryValueCr || 0), 0)
  const currentValue =
    trend && trend.points.length > 0 ? trend.points[trend.points.length - 1].portfolioValueCr : 0

  // Chart data — map trend points + overlay events
  const chartData = useMemo(() => {
    if (!trend) return []
    return trend.points.map((pt) => {
      const eventOnDay = trend.events.find((e) => e.date === pt.date)
      return {
        date: pt.date,
        value: Math.round(pt.portfolioValueCr),
        normalized: Math.round(pt.normalized * 100) / 100,
        event: eventOnDay ? eventOnDay.headline : null,
        eventSentiment: eventOnDay?.sentiment ?? null,
        eventMateriality: eventOnDay?.materiality ?? null,
      }
    })
  }, [trend])

  return (
    <>
      {/* Header with rename + actions */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          marginBottom: 14,
          flexWrap: 'wrap',
        }}
      >
        <input
          value={renameDraft}
          onChange={(e) => setRenameDraft(e.target.value)}
          onBlur={onRename}
          style={{
            background: 'transparent',
            border: 'none',
            borderBottom: '1px solid var(--br)',
            fontFamily: 'Source Serif 4, Georgia, serif',
            fontSize: 20,
            fontWeight: 600,
            color: 'var(--txt)',
            letterSpacing: '-0.01em',
            padding: '3px 0',
            outline: 'none',
            minWidth: 280,
          }}
        />
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 4, background: 'var(--s3)', padding: 3, borderRadius: 4 }}>
          {(['1yr', '3yr', '5yr'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              style={{
                background: period === p ? 'var(--gold2)' : 'transparent',
                color: period === p ? '#000' : 'var(--txt2)',
                border: 'none',
                padding: '4px 10px',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                cursor: 'pointer',
                borderRadius: 3,
                fontFamily: 'inherit',
              }}
            >
              {p}
            </button>
          ))}
        </div>
        <a
          href={`/report/portfolio/${portfolio.id}?print=1`}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            background: 'var(--golddim)',
            border: '1px solid var(--gold2)',
            color: 'var(--gold2)',
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.4px',
            textTransform: 'uppercase',
            padding: '6px 12px',
            borderRadius: 4,
            cursor: 'pointer',
            textDecoration: 'none',
          }}
        >
          ◈ PDF Report
        </a>
        <button
          onClick={onDelete}
          title="Delete portfolio"
          style={{
            background: 'transparent',
            color: 'var(--red)',
            border: '1px solid var(--red)',
            padding: '6px 10px',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.5px',
            textTransform: 'uppercase',
            cursor: 'pointer',
            borderRadius: 4,
            fontFamily: 'inherit',
          }}
        >
          Delete
        </button>
      </div>

      {/* KPI strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 8,
          marginBottom: 14,
        }}
      >
        <Kpi label="Holdings" value={String(portfolio.holdings.length)} sub="positions" />
        <Kpi label="Entry Value" value={fmtCr(totalEntry)} sub="initial exposure" />
        <Kpi
          label="Current Value"
          value={fmtCr(currentValue || totalEntry)}
          sub={trendLoading ? 'loading…' : trend ? 'hydrated' : 'snapshot'}
          accent
        />
        <Kpi
          label="Total Return"
          value={trend ? fmtPct(trend.totalReturnPct) : '—'}
          sub={trend ? `${trend.points.length} pts` : 'no data'}
          tone={trend && trend.totalReturnPct >= 0 ? 'pos' : trend ? 'neg' : undefined}
        />
        <Kpi
          label="Max Drawdown"
          value={trend ? fmtPct(trend.maxDrawdownPct) : '—'}
          sub="peak-to-trough"
          tone={trend ? 'neg' : undefined}
        />
      </div>

      {/* Trend chart */}
      {portfolio.holdings.length === 0 ? (
        <div
          style={{
            background: 'var(--s3)',
            padding: 36,
            textAlign: 'center',
            color: 'var(--txt3)',
            fontSize: 13,
            borderRadius: 6,
            border: '1px dashed var(--br2)',
          }}
        >
          No holdings yet. Add companies from Value Chain / Valuation / M&A Radar with the{' '}
          <strong>+ WL</strong> button.
        </div>
      ) : (
        <div
          style={{
            background: 'var(--s1)',
            border: '1px solid var(--br)',
            borderRadius: 6,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '1.2px',
              textTransform: 'uppercase',
              color: 'var(--txt3)',
              marginBottom: 10,
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>Portfolio Value Trend</span>
            <span style={{ color: 'var(--txt2)', fontSize: 9 }}>
              {trend?.hydratedHoldings.length || 0} live · {trend?.fallbackHoldings.length || 0} flat-line
              fallback
            </span>
          </div>
          <div style={{ width: '100%', height: 260 }}>
            {trendLoading ? (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--txt3)',
                  fontSize: 11,
                  fontStyle: 'italic',
                }}
              >
                Loading historical prices…
              </div>
            ) : chartData.length === 0 ? (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: 'var(--txt3)',
                  fontSize: 11,
                  fontStyle: 'italic',
                }}
              >
                No trend data available.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="portfGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F7B731" stopOpacity={0.45} />
                      <stop offset="95%" stopColor="#F7B731" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="rgba(255,255,255,0.05)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: '#9AAFC8' }}
                    tickFormatter={(v: string) => v.slice(2, 7)}
                  />
                  <YAxis
                    tick={{ fontSize: 9, fill: '#9AAFC8' }}
                    tickFormatter={(v: number) => fmtCr(v)}
                    width={60}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#111827',
                      border: '1px solid #2A3A55',
                      fontSize: 11,
                    }}
                    labelStyle={{ color: '#E8EDF5', fontWeight: 600 }}
                    formatter={(v: number) => [fmtCr(v), 'Value']}
                  />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#F7B731"
                    strokeWidth={2}
                    fill="url(#portfGrad)"
                  />
                  {trend?.events.map((ev, i) => (
                    <ReferenceLine
                      key={`${ev.date}-${i}`}
                      x={ev.date}
                      stroke={
                        ev.sentiment === 'positive'
                          ? '#10B981'
                          : ev.sentiment === 'negative'
                            ? '#EF4444'
                            : '#9AAFC8'
                      }
                      strokeDasharray="3 3"
                      strokeOpacity={ev.materiality === 'high' ? 0.9 : 0.5}
                      label={undefined}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      )}

      {/* Event timeline */}
      {trend && trend.events.length > 0 && (
        <div
          style={{
            background: 'var(--s1)',
            border: '1px solid var(--br)',
            borderRadius: 6,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '1.2px',
              textTransform: 'uppercase',
              color: 'var(--txt3)',
              marginBottom: 10,
            }}
          >
            Event Timeline ({trend.events.length} material news signals affecting this portfolio)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {trend.events.map((ev, i) => (
              <div
                key={`${ev.date}-${i}`}
                onClick={() => setActiveEvent(activeEvent === `${ev.date}-${i}` ? null : `${ev.date}-${i}`)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '80px 60px 1fr 70px',
                  gap: 10,
                  padding: '7px 10px',
                  background:
                    activeEvent === `${ev.date}-${i}` ? 'var(--s3)' : 'transparent',
                  border: `1px solid ${
                    ev.sentiment === 'positive'
                      ? 'rgba(16,185,129,0.3)'
                      : ev.sentiment === 'negative'
                        ? 'rgba(239,68,68,0.3)'
                        : 'var(--br)'
                  }`,
                  borderLeft: `3px solid ${
                    ev.sentiment === 'positive'
                      ? 'var(--green)'
                      : ev.sentiment === 'negative'
                        ? 'var(--red)'
                        : 'var(--txt3)'
                  }`,
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    color: 'var(--txt3)',
                    fontSize: 10,
                  }}
                >
                  {ev.date}
                </span>
                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 700,
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    color:
                      ev.sentiment === 'positive'
                        ? 'var(--green)'
                        : ev.sentiment === 'negative'
                          ? 'var(--red)'
                          : 'var(--txt3)',
                    alignSelf: 'center',
                  }}
                >
                  {ev.materiality} · {ev.sentiment}
                </span>
                <span
                  style={{
                    color: 'var(--txt)',
                    fontSize: 11,
                    alignSelf: 'center',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={ev.headline}
                >
                  {ev.headline}
                </span>
                <span
                  style={{
                    fontFamily: 'JetBrains Mono, monospace',
                    fontSize: 10,
                    fontWeight: 700,
                    textAlign: 'right',
                    alignSelf: 'center',
                    color:
                      ev.multipleDeltaPct >= 0 ? 'var(--green)' : 'var(--red)',
                  }}
                >
                  {ev.multipleDeltaPct >= 0 ? '+' : ''}
                  {ev.multipleDeltaPct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Holdings table */}
      <div
        style={{
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '1.2px',
            textTransform: 'uppercase',
            color: 'var(--txt3)',
            padding: '10px 12px',
            borderBottom: '1px solid var(--br)',
          }}
        >
          Holdings
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead>
            <tr style={{ background: 'var(--s2)' }}>
              {['Company', 'Kind', 'Sector', 'Entry ₹Cr', 'Weight', 'Added', ''].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 12px',
                    textAlign: h === 'Entry ₹Cr' || h === 'Weight' ? 'right' : 'left',
                    fontSize: 9,
                    color: 'var(--txt3)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {portfolio.holdings.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  style={{
                    padding: 24,
                    textAlign: 'center',
                    color: 'var(--txt3)',
                    fontStyle: 'italic',
                  }}
                >
                  No holdings in this portfolio yet.
                </td>
              </tr>
            ) : (
              portfolio.holdings.map((h) => (
                <HoldingRow
                  key={h.key}
                  h={h}
                  onWeightChange={(w) => onHoldingWeight(h.key, w)}
                  onRemove={() => onHoldingRemove(h.key)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function HoldingRow({
  h,
  onWeightChange,
  onRemove,
}: {
  h: PortfolioHolding
  onWeightChange: (w: number) => void
  onRemove: () => void
}) {
  const [draft, setDraft] = useState<string>(h.weight ? String(h.weight) : '')
  useEffect(() => {
    setDraft(h.weight ? String(h.weight) : '')
  }, [h.weight])
  return (
    <tr style={{ borderBottom: '1px solid var(--br)' }}>
      <td style={{ padding: '8px 12px', color: 'var(--txt)' }}>
        <div style={{ fontWeight: 600 }}>{h.name}</div>
        {h.ticker && (
          <div style={{ fontSize: 9, color: 'var(--txt3)' }}>{h.ticker}</div>
        )}
      </td>
      <td style={{ padding: '8px 12px' }}>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.8px',
            textTransform: 'uppercase',
            color: h.kind === 'private' ? 'var(--purple)' : 'var(--cyan2)',
            border: `1px solid ${
              h.kind === 'private' ? 'var(--purple)' : 'var(--cyan2)'
            }`,
            padding: '2px 6px',
            borderRadius: 2,
          }}
        >
          {h.kind}
        </span>
      </td>
      <td style={{ padding: '8px 12px', color: 'var(--txt2)', textTransform: 'uppercase', fontSize: 10 }}>
        {h.sec}
      </td>
      <td
        style={{
          padding: '8px 12px',
          color: 'var(--gold2)',
          textAlign: 'right',
          fontFamily: 'JetBrains Mono, monospace',
        }}
      >
        ₹{h.entryValueCr.toLocaleString('en-IN')}
      </td>
      <td style={{ padding: '6px 12px', textAlign: 'right' }}>
        <input
          type="number"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const n = parseFloat(draft)
            onWeightChange(Number.isFinite(n) ? n : 0)
          }}
          placeholder="equal"
          style={{
            background: 'var(--s3)',
            border: '1px solid var(--br)',
            color: 'var(--txt)',
            padding: '4px 6px',
            fontSize: 10,
            fontFamily: 'JetBrains Mono, monospace',
            width: 60,
            textAlign: 'right',
            borderRadius: 3,
            outline: 'none',
          }}
        />
      </td>
      <td style={{ padding: '8px 12px', color: 'var(--txt3)', fontSize: 10 }}>
        {h.addedAt.slice(0, 10)}
      </td>
      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
        <button
          onClick={onRemove}
          title="Remove from portfolio"
          style={{
            background: 'transparent',
            border: '1px solid var(--br2)',
            color: 'var(--red)',
            padding: '3px 8px',
            fontSize: 10,
            fontWeight: 600,
            cursor: 'pointer',
            borderRadius: 3,
            fontFamily: 'inherit',
          }}
        >
          × Remove
        </button>
      </td>
    </tr>
  )
}

function Kpi({
  label,
  value,
  sub,
  accent,
  tone,
}: {
  label: string
  value: string
  sub?: string
  accent?: boolean
  tone?: 'pos' | 'neg'
}) {
  const color = tone === 'pos' ? 'var(--green)' : tone === 'neg' ? 'var(--red)' : 'var(--txt)'
  return (
    <div
      style={{
        background: accent ? 'var(--golddim)' : 'var(--s3)',
        border: `1px solid ${accent ? 'var(--gold2)' : 'var(--br)'}`,
        padding: '9px 12px',
        borderRadius: 5,
      }}
    >
      <div
        style={{
          fontSize: 8,
          letterSpacing: '1.2px',
          textTransform: 'uppercase',
          color: 'var(--txt3)',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'Source Serif 4, Georgia, serif',
          fontSize: 18,
          fontWeight: 600,
          color,
          lineHeight: 1.1,
          marginTop: 2,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 9, color: 'var(--txt3)', marginTop: 2 }}>{sub}</div>
      )}
    </div>
  )
}

const hintLabel: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: '1px',
  textTransform: 'uppercase',
  color: 'var(--txt3)',
  fontWeight: 700,
  marginBottom: 4,
}

const textInput: React.CSSProperties = {
  width: '100%',
  background: 'var(--s1)',
  border: '1px solid var(--br2)',
  color: 'var(--txt)',
  padding: '8px 10px',
  fontSize: 11,
  borderRadius: 4,
  outline: 'none',
  fontFamily: 'inherit',
}
