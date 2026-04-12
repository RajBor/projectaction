'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import {
  loadPortfolios,
  normalizedWeights,
  type Portfolio,
  type PortfolioHolding,
} from '@/lib/portfolio/store'
import {
  buildPortfolioTrend,
  fmtCr,
  fmtPct,
  type PortfolioTrend,
  type TrendEvent,
} from '@/lib/portfolio/trend'
import { useNewsData } from '@/components/news/NewsDataProvider'

/**
 * DealNector Portfolio Report — McKinsey-style PDF for a user's
 * saved portfolio. Mirrors the per-company valuation report in
 * typography and page structure so print output is consistent.
 */
export default function PortfolioReportPage() {
  const params = useParams<{ id: string }>()
  const searchParams = useSearchParams()
  const id = String(params?.id || '')
  const autoPrint = searchParams.get('print') === '1'

  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [trend, setTrend] = useState<PortfolioTrend | null>(null)
  const [loading, setLoading] = useState(true)
  const { items: newsItems } = useNewsData()

  useEffect(() => {
    const list = loadPortfolios()
    const found = list.find((p) => p.id === id) || null
    setPortfolio(found)
  }, [id])

  useEffect(() => {
    if (!portfolio) {
      setLoading(false)
      return
    }
    if (portfolio.holdings.length === 0) {
      setLoading(false)
      setTrend(null)
      return
    }
    let cancelled = false
    setLoading(true)
    buildPortfolioTrend(portfolio, { period: '1yr', newsFeed: newsItems })
      .then((t) => {
        if (!cancelled) setTrend(t)
      })
      .catch(() => {
        if (!cancelled) setTrend(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portfolio?.id, portfolio?.holdings.length, newsItems.length])

  // Auto-print once everything is ready
  useEffect(() => {
    if (!autoPrint || loading || !portfolio) return
    const t = setTimeout(() => {
      try {
        window.print()
      } catch {
        /* ignore */
      }
    }, 700)
    return () => clearTimeout(t)
  }, [autoPrint, loading, portfolio])

  if (!portfolio) {
    return (
      <div style={{ padding: 40, fontFamily: 'Source Serif 4, serif', fontSize: 16 }}>
        Portfolio <code>{id}</code> not found. Please check the URL.
      </div>
    )
  }

  return (
    <>
      <PrintToolbar />
      <CoverPage portfolio={portfolio} trend={trend} />
      <OverviewPage portfolio={portfolio} trend={trend} loading={loading} />
      <HoldingsPage portfolio={portfolio} trend={trend} />
      <TrendPage portfolio={portfolio} trend={trend} />
      <EventsPage portfolio={portfolio} trend={trend} />
      <AppendixPage portfolio={portfolio} />
    </>
  )
}

// ── Toolbar (screen only) ────────────────────────────────

function PrintToolbar() {
  return (
    <div className="dn-toolbar dn-screen-only">
      <div className="left">
        Deal<em>Nector</em> · Portfolio Report
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ghost" onClick={() => history.back()}>
          ← Back
        </button>
        <button onClick={() => window.print()}>Download PDF</button>
      </div>
    </div>
  )
}

// ── Navy header with portfolio name ──────────────────────

function PageHeader({ portfolio, section, pageNum }: { portfolio: Portfolio; section: string; pageNum: string }) {
  return (
    <>
      <div className="dn-navy-bar">
        <div className="left">
          Deal<em>Nector</em> · {portfolio.name} · {section}
        </div>
        <div className="right">Portfolio · {portfolio.holdings.length} holdings</div>
      </div>
      <div className="dn-page-number">{pageNum}</div>
    </>
  )
}

function PageFooter() {
  const date = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  return (
    <div className="dn-page-footer">
      <span>DealNector Institutional Intelligence Terminal</span>
      <span>Confidential · Prepared {date}</span>
    </div>
  )
}

// ── Cover Page ───────────────────────────────────────────

function CoverPage({ portfolio, trend }: { portfolio: Portfolio; trend: PortfolioTrend | null }) {
  const date = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
  const totalEntry = portfolio.holdings.reduce((s, h) => s + (h.entryValueCr || 0), 0)
  const currentValue = trend?.points.length
    ? trend.points[trend.points.length - 1].portfolioValueCr
    : totalEntry
  const listedCount = portfolio.holdings.filter((h) => h.kind === 'listed').length
  const privateCount = portfolio.holdings.filter((h) => h.kind === 'private').length

  return (
    <section className="dn-page dn-cover">
      <div className="top">
        <svg className="logo" viewBox="0 0 320 64" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="pgoldCover" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#D4A43B" />
              <stop offset="100%" stopColor="#F4C842" />
            </linearGradient>
            <linearGradient id="pinkCover" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#0A2340" />
              <stop offset="100%" stopColor="#132B52" />
            </linearGradient>
          </defs>
          <g transform="translate(4 8)">
            <path
              d="M24 0 L48 14 L48 34 L24 48 L0 34 L0 14 Z"
              fill="url(#pinkCover)"
              stroke="#D4A43B"
              strokeWidth="1.2"
            />
            <text
              x="24"
              y="32"
              textAnchor="middle"
              fontFamily="Source Serif 4,Georgia,serif"
              fontWeight="700"
              fontSize="24"
              fill="url(#pgoldCover)"
            >
              D
            </text>
          </g>
          <text
            x="60"
            y="38"
            fontFamily="Source Serif 4,Georgia,serif"
            fontWeight="700"
            fontSize="28"
            letterSpacing="-0.5"
            fill="#0A2340"
          >
            Deal<tspan fontStyle="italic" fill="#D4A43B">Nector</tspan>
          </text>
          <line x1="60" y1="46" x2="304" y2="46" stroke="#D4A43B" strokeWidth="0.75" />
          <text x="60" y="58" fontFamily="Inter,sans-serif" fontSize="8.5" letterSpacing="2.4" fill="#5A6B82" fontWeight="600">
            INSTITUTIONAL · INTELLIGENCE · TERMINAL
          </text>
        </svg>
        <div className="stamp">
          <div className="confidential">Strictly Confidential</div>
          <div>{date}</div>
          <div>Institutional Use Only</div>
        </div>
      </div>
      <div className="middle">
        <div className="eyebrow">Portfolio Report</div>
        <div className="title">
          {portfolio.name}
        </div>
        <div className="subtitle">
          {portfolio.description ||
            'A curated target portfolio assembled from listed + private companies across the DealNector coverage universe.'}{' '}
          Period-over-period performance, event overlays, and holding-level economics — triaged
          for institutional due diligence.
        </div>
        <div className="meta">
          <div className="cell">
            <div className="k">Holdings</div>
            <div className="v">{portfolio.holdings.length}</div>
          </div>
          <div className="cell">
            <div className="k">Listed / Private</div>
            <div className="v">
              {listedCount} / {privateCount}
            </div>
          </div>
          <div className="cell">
            <div className="k">Entry Value</div>
            <div className="v">{fmtCr(totalEntry)}</div>
          </div>
          <div className="cell">
            <div className="k">Current Value</div>
            <div className="v">{fmtCr(currentValue)}</div>
          </div>
        </div>
      </div>
      <div className="bottom">
        {trend ? (
          <>
            <strong>Total Return:</strong>{' '}
            <span style={{ color: trend.totalReturnPct >= 0 ? '#2E6B3A' : '#A9232B' }}>
              {fmtPct(trend.totalReturnPct)}
            </span>{' '}
            · <strong>Max Drawdown:</strong>{' '}
            <span style={{ color: '#A9232B' }}>{fmtPct(trend.maxDrawdownPct)}</span> ·{' '}
            <strong>Data points:</strong> {trend.points.length} ·{' '}
            <strong>Events tracked:</strong> {trend.events.length} material news signals
            <br />
          </>
        ) : (
          <>
            <strong>Trend data unavailable.</strong> Report reflects entry snapshot only.
            <br />
          </>
        )}
        This report is generated by DealNector from user-defined portfolio holdings, with
        price data hydrated from NSE/BSE and event overlays derived from live news. Figures
        in ₹Cr. News-driven signals are heuristic, not investment advice.
      </div>
    </section>
  )
}

// ── Overview Page ────────────────────────────────────────

function OverviewPage({
  portfolio,
  trend,
  loading,
}: {
  portfolio: Portfolio
  trend: PortfolioTrend | null
  loading: boolean
}) {
  const weights = normalizedWeights(portfolio)
  const bySector: Record<string, number> = {}
  const byKind: Record<string, number> = { listed: 0, private: 0 }
  for (const h of portfolio.holdings) {
    bySector[h.sec] = (bySector[h.sec] || 0) + (weights[h.key] || 0)
    byKind[h.kind] = (byKind[h.kind] || 0) + (weights[h.key] || 0)
  }
  return (
    <section className="dn-page">
      <PageHeader portfolio={portfolio} section="Overview" pageNum="01" />
      <span className="dn-eyebrow">Portfolio Overview</span>
      <h2 className="dn-h1" style={{ marginBottom: 12 }}>
        Investment Thesis & Composition
      </h2>
      <hr className="dn-gold-rule" />

      <div className="dn-exec-grid">
        <div className="dn-exec-left">
          <div className="dn-narrative">
            <p>
              <strong>{portfolio.name}</strong> currently holds{' '}
              <strong>{portfolio.holdings.length}</strong>{' '}
              {portfolio.holdings.length === 1 ? 'position' : 'positions'} across the
              DealNector coverage universe, comprising {byKind.listed > 0 ? `${Math.round(byKind.listed * 100)}% listed` : ''}
              {byKind.listed > 0 && byKind.private > 0 ? ' and ' : ''}
              {byKind.private > 0 ? `${Math.round(byKind.private * 100)}% private` : ''}
              {' '}exposure by weight.
            </p>
            {portfolio.description && (
              <p>
                <strong>Thesis.</strong> {portfolio.description}
              </p>
            )}
            {trend && trend.points.length > 0 ? (
              <p>
                Over the last {trend.points.length} price points (
                {trend.startDate} to {trend.endDate}) the portfolio has delivered a total
                return of{' '}
                <strong className={trend.totalReturnPct >= 0 ? 'dn-pos' : 'dn-neg'}>
                  {fmtPct(trend.totalReturnPct)}
                </strong>
                , with a peak-to-trough drawdown of{' '}
                <strong className="dn-neg">{fmtPct(trend.maxDrawdownPct)}</strong>. A total of{' '}
                {trend.events.length} material news events have been overlaid on the trend
                chart and are detailed in the Events section.
              </p>
            ) : (
              <p className="dn-mutedtxt" style={{ fontStyle: 'italic' }}>
                {loading ? 'Trend data still hydrating…' : 'No trend data available — showing entry snapshots only.'}
              </p>
            )}
            {portfolio.notes && (
              <div className="callout">{portfolio.notes}</div>
            )}
          </div>
        </div>
        <div className="dn-exec-right">
          <div className="dn-kpi-tile">
            <div className="label">Holdings</div>
            <div className="value">{portfolio.holdings.length}</div>
            <div className="sub">{byKind.listed > 0 ? `${Math.round(byKind.listed * 100)}% listed` : '100% private'}</div>
          </div>
          <div className="dn-kpi-tile pos">
            <div className="label">Entry Value</div>
            <div className="value">
              {fmtCr(portfolio.holdings.reduce((s, h) => s + (h.entryValueCr || 0), 0))}
            </div>
            <div className="sub">weight-normalised</div>
          </div>
          <div
            className={`dn-kpi-tile ${trend ? (trend.totalReturnPct >= 0 ? 'pos' : 'neg') : ''}`}
          >
            <div className="label">Total Return</div>
            <div className="value">{trend ? fmtPct(trend.totalReturnPct) : '—'}</div>
            <div className="sub">{trend ? `${trend.points.length} pts` : 'no data'}</div>
          </div>
          <div className="dn-kpi-tile neg">
            <div className="label">Max Drawdown</div>
            <div className="value">{trend ? fmtPct(trend.maxDrawdownPct) : '—'}</div>
            <div className="sub">peak-to-trough</div>
          </div>
          <div className="dn-kpi-tile">
            <div className="label">Events Tracked</div>
            <div className="value">{trend?.events.length ?? 0}</div>
            <div className="sub">material news overlays</div>
          </div>
        </div>
      </div>

      <h3 className="dn-h3" style={{ marginTop: 16, marginBottom: 6 }}>
        Exposure Mix
      </h3>
      <hr className="dn-rule" />
      <table className="dn-table compact">
        <thead>
          <tr>
            <th>Dimension</th>
            <th className="num">Weight</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(bySector)
            .sort((a, b) => b[1] - a[1])
            .map(([k, v]) => (
              <tr key={`sec-${k}`}>
                <td className="label">Sector · {k.toUpperCase()}</td>
                <td className="num mono">{(v * 100).toFixed(1)}%</td>
                <td>Value-chain exposure within {k === 'solar' ? 'solar value chain' : 'T&D infrastructure'}</td>
              </tr>
            ))}
          {Object.entries(byKind)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => (
              <tr key={`kind-${k}`}>
                <td className="label">Kind · {k}</td>
                <td className="num mono">{(v * 100).toFixed(1)}%</td>
                <td>{k === 'listed' ? 'Publicly traded equities' : 'Pre-IPO / private targets (EV estimate)'}</td>
              </tr>
            ))}
        </tbody>
      </table>
      <PageFooter />
    </section>
  )
}

// ── Holdings Page ────────────────────────────────────────

function HoldingsPage({ portfolio, trend }: { portfolio: Portfolio; trend: PortfolioTrend | null }) {
  const weights = normalizedWeights(portfolio)
  const latestValues: Record<string, number> = {}
  if (trend && trend.points.length > 0) {
    const last = trend.points[trend.points.length - 1]
    Object.assign(latestValues, last.byHolding)
  }
  const rows = portfolio.holdings.map((h) => {
    const cur = latestValues[h.key] ?? h.entryValueCr
    const entry = h.entryValueCr * (weights[h.key] || 0)
    const retPct = entry > 0 ? ((cur - entry) / entry) * 100 : 0
    return { h, cur, entry, retPct, weight: (weights[h.key] || 0) * 100 }
  })

  return (
    <section className="dn-page">
      <PageHeader portfolio={portfolio} section="Holdings" pageNum="02" />
      <span className="dn-eyebrow">Holdings · Line Item Economics</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        Position-Level Detail
      </h2>
      <hr className="dn-rule" />
      <table className="dn-table compact">
        <thead>
          <tr>
            <th>Company</th>
            <th>Kind</th>
            <th>Sector</th>
            <th className="num">Weight</th>
            <th className="num">Entry ₹Cr</th>
            <th className="num">Current ₹Cr</th>
            <th className="num">Return</th>
            <th className="num">Acq Score</th>
            <th>Flag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ h, cur, entry, retPct, weight }) => (
            <tr key={h.key}>
              <td className="label">
                {h.name}
                {h.ticker && (
                  <div style={{ fontSize: 8, color: 'var(--muted)' }}>{h.ticker}</div>
                )}
              </td>
              <td>{h.kind}</td>
              <td>{h.sec.toUpperCase()}</td>
              <td className="num mono">{weight.toFixed(1)}%</td>
              <td className="num mono">{fmtCr(entry)}</td>
              <td className="num mono">{fmtCr(cur)}</td>
              <td className={`num mono ${retPct >= 0 ? 'dn-pos' : 'dn-neg'}`}>
                {fmtPct(retPct)}
              </td>
              <td className="num mono">{h.snapshot.acqs.toFixed(1)}/10</td>
              <td>{h.snapshot.acqf}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="dn-narrative" style={{ marginTop: 12 }}>
        <p className="dn-mutedtxt" style={{ fontSize: 9 }}>
          Weight-normalised allocations shown. Current value for listed holdings is hydrated
          from NSE/BSE historical prices (best-effort); private holdings use the entry EV
          estimate. Returns are computed against each holding's entry value.
        </p>
      </div>
      <PageFooter />
    </section>
  )
}

// ── Trend Page — ASCII bar-chart approximation in HTML ───

function TrendPage({ portfolio, trend }: { portfolio: Portfolio; trend: PortfolioTrend | null }) {
  const chartRows = useMemo(() => {
    if (!trend || trend.points.length === 0) return []
    const pts = trend.points
    // Sample up to 36 rows (monthly points) for the print chart
    const step = Math.max(1, Math.floor(pts.length / 36))
    const sampled = pts.filter((_, i) => i % step === 0)
    const values = sampled.map((p) => p.portfolioValueCr)
    const lo = Math.min(...values)
    const hi = Math.max(...values)
    const range = hi - lo || 1
    return sampled.map((p) => ({
      date: p.date,
      value: p.portfolioValueCr,
      barPct: ((p.portfolioValueCr - lo) / range) * 100,
      normalized: p.normalized,
    }))
  }, [trend])

  return (
    <section className="dn-page">
      <PageHeader portfolio={portfolio} section="Trend" pageNum="03" />
      <span className="dn-eyebrow">Portfolio Value Trend</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        Value Trajectory with Event Overlays
      </h2>
      <hr className="dn-rule" />

      {chartRows.length === 0 ? (
        <p className="dn-mutedtxt" style={{ fontStyle: 'italic' }}>
          No trend data available for this portfolio. Add at least one listed holding to
          enable price hydration.
        </p>
      ) : (
        <div className="dn-football">
          {chartRows.map((r, i) => {
            const ev = trend?.events.find((e) => e.date === r.date)
            return (
              <div className="bar-row" key={i}>
                <div className="label dn-mono">{r.date}</div>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ left: '0%', width: `${Math.max(2, r.barPct)}%` }}
                  />
                  {ev && (
                    <div
                      className="bar-mid"
                      style={{
                        left: `${Math.max(2, r.barPct)}%`,
                        background:
                          ev.sentiment === 'positive'
                            ? '#2E6B3A'
                            : ev.sentiment === 'negative'
                              ? '#A9232B'
                              : '#0A2340',
                      }}
                    />
                  )}
                </div>
                <div className="value">{fmtCr(r.value)}</div>
              </div>
            )
          })}
        </div>
      )}

      <div className="dn-narrative" style={{ marginTop: 12 }}>
        <p>
          Each row shows one sampled date from the trend series. The fill bar is scaled
          against the min-max range of portfolio value within the window. Where an event
          marker appears on a row, that date carries a high-materiality news signal
          affecting one or more holdings — see the Events section for full detail.
        </p>
        {trend && (
          <p className="callout">
            <strong>Window.</strong> {trend.startDate} → {trend.endDate} ·{' '}
            <strong>Total Return:</strong>{' '}
            <span className={trend.totalReturnPct >= 0 ? 'dn-pos' : 'dn-neg'}>
              {fmtPct(trend.totalReturnPct)}
            </span>{' '}
            · <strong>Max Drawdown:</strong>{' '}
            <span className="dn-neg">{fmtPct(trend.maxDrawdownPct)}</span>
          </p>
        )}
      </div>
      <PageFooter />
    </section>
  )
}

// ── Events Page ──────────────────────────────────────────

function EventsPage({ portfolio, trend }: { portfolio: Portfolio; trend: PortfolioTrend | null }) {
  const events = trend?.events ?? []
  const positive = events.filter((e) => e.sentiment === 'positive')
  const negative = events.filter((e) => e.sentiment === 'negative')
  const neutral = events.filter((e) => e.sentiment === 'neutral')

  return (
    <section className="dn-page">
      <PageHeader portfolio={portfolio} section="Events" pageNum="04" />
      <span className="dn-eyebrow">Material News Events</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        Signals Impacting Portfolio Movement
      </h2>
      <hr className="dn-rule" />

      {events.length === 0 ? (
        <p className="dn-mutedtxt" style={{ fontStyle: 'italic' }}>
          No material news events detected within the trend window for any portfolio
          holding. As the news feed updates this section will populate automatically.
        </p>
      ) : (
        <>
          <div className="dn-kpi-row">
            <Tile label="Total Events" value={String(events.length)} />
            <Tile label="Positive" value={String(positive.length)} tone="pos" />
            <Tile label="Negative" value={String(negative.length)} tone="neg" />
            <Tile label="Neutral" value={String(neutral.length)} />
            <Tile
              label="High Materiality"
              value={String(events.filter((e) => e.materiality === 'high').length)}
            />
          </div>

          <div className="dn-two-col">
            <div>
              <h3 className="dn-h3">▲ Positive Signals</h3>
              <hr className="dn-rule" />
              <EventList events={positive.slice(0, 8)} />
            </div>
            <div>
              <h3 className="dn-h3">▼ Negative Signals</h3>
              <hr className="dn-rule" />
              <EventList events={negative.slice(0, 8)} />
            </div>
          </div>
        </>
      )}
      <PageFooter />
    </section>
  )
}

function EventList({ events }: { events: TrendEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="dn-mutedtxt" style={{ fontSize: 9, fontStyle: 'italic', padding: 6 }}>
        None in window.
      </div>
    )
  }
  return (
    <div className="dn-news-list">
      {events.map((ev, i) => (
        <div
          className={`dn-news-card ${ev.sentiment === 'positive' ? 'pos' : ev.sentiment === 'negative' ? 'neg' : ''}`}
          key={`${ev.date}-${i}`}
        >
          <span className="pill">
            {ev.sentiment === 'positive' ? 'POS' : ev.sentiment === 'negative' ? 'NEG' : '•'}
          </span>
          <div className="body">
            <div className="headline">{ev.headline}</div>
            <div className="meta">
              {ev.date} · {ev.source || 'Source'} · {ev.materiality} materiality ·{' '}
              {ev.affectedTickers.length > 0 ? ev.affectedTickers.join(', ') : 'policy / sector'}
            </div>
          </div>
          <div className="delta">
            {ev.multipleDeltaPct >= 0 ? '+' : ''}
            {ev.multipleDeltaPct.toFixed(2)}%
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Appendix ────────────────────────────────────────────

function AppendixPage({ portfolio }: { portfolio: Portfolio }) {
  return (
    <section className="dn-page">
      <PageHeader portfolio={portfolio} section="Appendix" pageNum="05" />
      <span className="dn-eyebrow">Appendix — Methodology & Sources</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        How the Portfolio is Valued
      </h2>
      <hr className="dn-rule" />
      <div className="dn-narrative">
        <p>
          <strong>Listed holdings</strong> are priced via NSE/BSE
          historical-data endpoint using the '1yr' price series. Each holding's current
          contribution to portfolio value is computed as{' '}
          <span className="dn-mono">weight × entryCr × (currentPrice / priceAnchor)</span>.
          When the API cannot return data for a ticker, a flat-line fallback at the entry
          value is used so the chart still renders.
        </p>
        <p>
          <strong>Private holdings</strong> are carried at their EV estimate as captured
          at the time of addition. They contribute a constant value until the user updates
          the entry manually.
        </p>
        <p>
          <strong>Events</strong> are material news items from the DealNector news hub whose
          affected tickers overlap with the portfolio's listed holdings, or which are
          high-materiality policy signals affecting the sector. Each event is anchored to
          its publication date and drawn as a vertical marker on the trend chart.
        </p>
        <p>
          <strong>Total return</strong> is the first-to-last change in blended portfolio
          value. <strong>Max drawdown</strong> is the deepest peak-to-trough observed
          across the window. Both are heuristic and should not be interpreted as realised
          returns — the portfolio is a tracking construct, not a traded position.
        </p>
        <p className="callout">
          <strong>Disclaimer.</strong> This report is generated by DealNector's automated
          analysis pipeline. All values are heuristic and provided for institutional
          due-diligence triage. Verification against fundamental filings is required prior
          to any capital commitment.
        </p>
        <p className="dn-mutedtxt" style={{ fontSize: 9 }}>
          Report generated {new Date().toLocaleString('en-IN')} · DealNector Institutional
          Intelligence Terminal · Portfolio ID: {portfolio.id}
        </p>
      </div>
      <PageFooter />
    </section>
  )
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  const color = tone === 'pos' ? '#2E6B3A' : tone === 'neg' ? '#A9232B' : '#0A2340'
  return (
    <div className="dn-kpi-tile-flat" style={{ borderTopColor: color }}>
      <div className="label">{label}</div>
      <div className="value" style={{ color }}>
        {value}
      </div>
      <div className="sub">{label === 'Total Events' ? 'in window' : 'signals'}</div>
    </div>
  )
}
