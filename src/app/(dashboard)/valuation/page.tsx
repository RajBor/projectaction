'use client'

import { useMemo, useState } from 'react'
import { COMPANIES } from '@/lib/data/companies'
import type { Company } from '@/lib/data/companies'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { Badge } from '@/components/ui/Badge'
import { SectionTitle } from '@/components/ui/SectionTitle'
import { useWorkingPopup } from '@/components/working/WorkingPopup'
import {
  wkMktCap,
  wkEBITDA,
  wkEBITDAMargin,
  wkPE,
  wkDebtEquity,
  wkRevGrowth,
  wkAcqFlag,
  wkAcqScoreWithNews,
  wkEVEBITDAWithNews,
} from '@/lib/working'
import type { NewsItem } from '@/lib/news/api'
import type { NewsImpact } from '@/lib/news/impact'
import { NewsCard } from '@/components/news/NewsCard'
import { useNewsAck, newsItemKey } from '@/components/news/NewsAckProvider'
import { useNewsData } from '@/components/news/NewsDataProvider'
import type { CompanyAdjustedMetrics } from '@/lib/news/adjustments'
import {
  PARAM_DEFS,
  PARAM_ORDER,
  getBaseValue,
  formatParamValue,
  clampAdjustedValue,
  type ValuationParam,
} from '@/lib/news/params'
import { ExpressInterestButton } from '@/components/ExpressInterestButton'
import { CommodityPanel } from '@/components/live/CommodityPanel'
import { DataRefreshButton } from '@/components/live/DataRefreshButton'
import { QuotaBanner } from '@/components/live/QuotaBanner'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'
import {
  wkEVAudit,
  wkEVEBITDAAudit,
  wkAcqScoreAudit,
} from '@/lib/working'

type SortKey =
  | 'acqs'
  | 'sec'
  | 'mktcap'
  | 'rev'
  | 'ebitda'
  | 'ebm'
  | 'ev'
  | 'ev_eb'
  | 'pe'
  | 'dbt_eq'
  | 'revg'
  | null

function evEbColor(v: number): string {
  if (v <= 0) return 'var(--txt3)'
  if (v <= 15) return 'var(--green)'
  if (v <= 25) return 'var(--gold2)'
  if (v <= 40) return 'var(--orange)'
  return 'var(--red)'
}
function ebmColor(v: number): string {
  if (v >= 15) return 'var(--green)'
  if (v >= 10) return 'var(--gold2)'
  return 'var(--orange)'
}
function peColor(v: number): string {
  if (!v) return 'var(--txt3)'
  if (v <= 25) return 'var(--green)'
  if (v <= 45) return 'var(--gold2)'
  return 'var(--orange)'
}
function deColor(v: number): string {
  if (v <= 0.3) return 'var(--green)'
  if (v <= 0.7) return 'var(--gold2)'
  return 'var(--red)'
}
function revgColor(v: number): string {
  if (v >= 25) return 'var(--green)'
  if (v >= 12) return 'var(--gold2)'
  return 'var(--orange)'
}
function flagVariant(acqs: number): 'green' | 'gold' | 'cyan' | 'red' {
  if (acqs >= 8) return 'green'
  if (acqs >= 6) return 'gold'
  if (acqs >= 4) return 'cyan'
  return 'red'
}

function exportCSV(rows: Company[]) {
  const headers = [
    'Name',
    'Ticker',
    'Sector',
    'MktCap',
    'Revenue',
    'EBITDA',
    'EBITDA%',
    'EV',
    'EV/EBITDA',
    'P/E',
    'D/E',
    'RevGrowth',
    'AcqScore',
    'Flag',
  ]
  const body = rows
    .map((c) =>
      [
        c.name,
        c.ticker,
        c.sec,
        c.mktcap,
        c.rev,
        c.ebitda,
        c.ebm,
        c.ev,
        c.ev_eb,
        c.pe,
        c.dbt_eq,
        c.revg,
        c.acqs,
        c.acqf,
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
  a.download = 'valuation-matrix.csv'
  a.click()
  URL.revokeObjectURL(url)
}

export default function ValuationPage() {
  const { showWorking } = useWorkingPopup()
  const [fSec, setFSec] = useState<'all' | 'solar' | 'td'>('all')
  const [fScore, setFScore] = useState<number>(0)
  const [fMaxEV, setFMaxEV] = useState<number>(999999)
  const [fSearch, setFSearch] = useState<string>('')
  const [sortCol, setSortCol] = useState<SortKey>(null)
  const [sortDir, setSortDir] = useState<1 | -1>(-1)

  // ── News intelligence (centralised via NewsDataProvider) ──
  const {
    aggregates: newsAgg,
    getAdjusted,
    loading: newsLoading,
    error: newsError,
    lastRefresh: newsLastRefresh,
    refresh: loadNews,
  } = useNewsData()

  const [newsPanelCo, setNewsPanelCo] = useState<Company | null>(null)

  const {
    isAcknowledged,
    acknowledge: ackAll,
    unacknowledge: unackOne,
    count: ackCount,
    clearAll: clearAllAcks,
  } = useNewsAck()

  // Overlay live per-ticker snapshot onto every Company row before
  // filtering / sorting so that fresh market data (market cap, EV,
  // EV/EBITDA, P/E, recomputed acq score) flows through the entire
  // page automatically. We also cache the full derivation so every
  // popup click can show the complete audit trail.
  const { mergeCompany, deriveCompany, tickers: liveTickers } = useLiveSnapshot()
  const liveCompanies = useMemo(
    () => COMPANIES.map((co) => mergeCompany(co)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mergeCompany, liveTickers]
  )

  const filtered = useMemo(() => {
    let data = liveCompanies.filter(
      (co) =>
        (fSec === 'all' || co.sec === fSec) &&
        co.acqs >= fScore &&
        (co.ev <= fMaxEV || co.ev === 0) &&
        (fSearch === '' ||
          co.name.toLowerCase().includes(fSearch.toLowerCase()) ||
          co.ticker.toLowerCase().includes(fSearch.toLowerCase()))
    )
    if (sortCol) {
      data = [...data].sort((a, b) => {
        const av = (a[sortCol as keyof Company] as number) || 0
        const bv = (b[sortCol as keyof Company] as number) || 0
        return sortDir * ((bv as number) - (av as number))
      })
    }
    return data
  }, [liveCompanies, fSec, fScore, fMaxEV, fSearch, sortCol, sortDir])

  const toggleSort = (col: SortKey) => {
    if (sortCol === col) setSortDir((d) => (d === 1 ? -1 : 1))
    else {
      setSortCol(col)
      setSortDir(-1)
    }
  }

  const clearFilters = () => {
    setFSec('all')
    setFScore(0)
    setFMaxEV(999999)
    setFSearch('')
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--s2)',
    border: '1px solid var(--br)',
    color: 'var(--txt)',
    padding: '6px 10px',
    borderRadius: 4,
    fontSize: 12,
  }
  const thStyle: React.CSSProperties = {
    padding: '10px 12px',
    textAlign: 'left',
    fontSize: 10,
    color: 'var(--txt3)',
    fontWeight: 600,
    letterSpacing: '1px',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
  }
  const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    fontSize: 12,
    color: 'var(--txt)',
    fontFamily: 'JetBrains Mono, monospace',
    whiteSpace: 'nowrap',
  }
  const clickableTd: React.CSSProperties = {
    ...tdStyle,
    cursor: 'pointer',
    borderBottom: '1px dotted var(--gold2)',
  }
  const hoverBg = (e: React.MouseEvent<HTMLTableCellElement>) => {
    ;(e.currentTarget as HTMLTableCellElement).style.background = 'var(--s3)'
  }
  const unhoverBg = (e: React.MouseEvent<HTMLTableCellElement>) => {
    ;(e.currentTarget as HTMLTableCellElement).style.background = ''
  }

  return (
    <div>
      {/* Page Header */}
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
          <span className="dn-wordmark">Deal<em>Nector</em></span> <span style={{ margin: '0 6px' }}>›</span> Analytics
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
          Valuation <em style={{ color: 'var(--gold2)', fontStyle: 'normal' }}>Matrix</em>
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
          <Badge variant="gray">
            {COMPANIES.length} Companies · Sort + Filter · Export CSV
          </Badge>
          <DataRefreshButton />
          <button
            style={{
              background: 'var(--green)',
              border: '1px solid var(--green)',
              color: '#fff',
              fontSize: 12,
              padding: '4px 14px',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            + Add Listed Company
          </button>
          <button
            style={{
              background: 'var(--s2)',
              border: '1px solid var(--br)',
              color: 'var(--txt2)',
              fontSize: 12,
              padding: '4px 12px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Add Private
          </button>
        </div>
      </div>

      {/* Filters Row */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 16,
          alignItems: 'center',
          padding: 14,
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
        }}
      >
        <span style={{ fontSize: 13, color: 'var(--txt3)', fontWeight: 600 }}>Sector:</span>
        <select
          value={fSec}
          onChange={(e) => setFSec(e.target.value as 'all' | 'solar' | 'td')}
          style={{ ...selectStyle, width: 120 }}
        >
          <option value="all">All</option>
          <option value="solar">Solar</option>
          <option value="td">T&D</option>
        </select>
        <span style={{ fontSize: 13, color: 'var(--txt3)', fontWeight: 600 }}>Min Score:</span>
        <select
          value={fScore}
          onChange={(e) => setFScore(parseInt(e.target.value))}
          style={{ ...selectStyle, width: 100 }}
        >
          <option value="0">All</option>
          <option value="7">7+</option>
          <option value="8">8+</option>
          <option value="9">9+</option>
        </select>
        <span style={{ fontSize: 13, color: 'var(--txt3)', fontWeight: 600 }}>Max EV:</span>
        <select
          value={fMaxEV}
          onChange={(e) => setFMaxEV(parseInt(e.target.value))}
          style={{ ...selectStyle, width: 140 }}
        >
          <option value="999999">All</option>
          <option value="5000">≤ ₹5,000Cr</option>
          <option value="10000">≤ ₹10,000Cr</option>
          <option value="25000">≤ ₹25,000Cr</option>
          <option value="50000">≤ ₹50,000Cr</option>
        </select>
        <input
          value={fSearch}
          onChange={(e) => setFSearch(e.target.value)}
          placeholder="Search company..."
          style={{ ...selectStyle, width: 200 }}
        />
        <button
          onClick={() => exportCSV(filtered)}
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
          Export CSV
        </button>
        <button
          onClick={clearFilters}
          style={{
            background: 'var(--s3)',
            border: '1px solid var(--br2)',
            color: 'var(--txt2)',
            fontSize: 12,
            padding: '6px 12px',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          × Clear Filters
        </button>
      </div>

      {/* Quota banner — shown only when the upstream plan is out of
          requests, so users know why the tables look stale. */}
      <QuotaBanner />

      {/* Live commodity snapshot — sits above the matrix so users
          see raw-material pressure before reading the table. */}
      <CommodityPanel />

      {/* Result Count */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--txt3)',
          marginBottom: 8,
        }}
      >
        {filtered.length} companies shown · Click column headers to sort · ★ = top acquisition target
      </div>

      {/* Table */}
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
            }}
          >
            <thead>
              <tr style={{ background: 'var(--s1)', borderBottom: '1px solid var(--br)' }}>
                <th style={thStyle} onClick={() => toggleSort('acqs')}>
                  Score
                </th>
                <th style={{ ...thStyle, cursor: 'default' }}>Company</th>
                <th style={thStyle} onClick={() => toggleSort('sec')}>
                  Sector
                </th>
                <th style={thStyle} onClick={() => toggleSort('mktcap')}>
                  Mkt Cap
                </th>
                <th style={thStyle} onClick={() => toggleSort('rev')}>
                  Revenue
                </th>
                <th style={thStyle} onClick={() => toggleSort('ebitda')}>
                  EBITDA
                </th>
                <th style={thStyle} onClick={() => toggleSort('ebm')}>
                  EBITDA%
                </th>
                <th style={thStyle} onClick={() => toggleSort('ev')}>
                  EV (₹Cr)
                </th>
                <th style={thStyle} onClick={() => toggleSort('ev_eb')}>
                  EV/EBITDA
                </th>
                <th
                  style={{ ...thStyle, cursor: 'default' }}
                  title="News-adjusted EV/EBITDA (post-acknowledgement). Shows baseline if no acknowledged news for this company."
                >
                  Post-Ack EV/EB
                </th>
                <th style={thStyle} onClick={() => toggleSort('pe')}>
                  P/E
                </th>
                <th style={thStyle} onClick={() => toggleSort('dbt_eq')}>
                  D/E
                </th>
                <th style={thStyle} onClick={() => toggleSort('revg')}>
                  Rev Gr%
                </th>
                <th style={{ ...thStyle, cursor: 'default' }}>Flag</th>
                <th
                  style={{ ...thStyle, cursor: 'default' }}
                  title="News-implied EV/EBITDA drift — click to see underlying news"
                >
                  Δ News
                </th>
                <th style={{ ...thStyle, cursor: 'default' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((co) => {
                const adjusted = getAdjusted(co)
                const hasNewsAdj = adjusted.hasAdjustment
                const postAcqs = adjusted.post.acqs
                const postEvEb = adjusted.post.ev_eb
                const scoreChanged =
                  hasNewsAdj && Math.round(postAcqs * 10) !== Math.round(co.acqs * 10)
                const evEbChanged =
                  hasNewsAdj && Math.abs(postEvEb - co.ev_eb) > 0.005
                return (
                <tr
                  key={co.ticker}
                  style={{
                    borderBottom: '1px solid var(--br)',
                    background: co.acqs >= 8 ? 'rgba(247,183,49,0.04)' : 'transparent',
                  }}
                >
                  <td
                    style={{ ...clickableTd }}
                    title="Click for full driver-by-driver acquisition score audit (post-refresh)"
                    onClick={() => {
                      const baseline =
                        COMPANIES.find((b) => b.ticker === co.ticker) ?? co
                      showWorking(wkAcqScoreAudit(deriveCompany(baseline)))
                    }}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <ScoreBadge score={co.acqs} size={26} />
                      {scoreChanged && (
                        <div
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            fontSize: 9,
                            fontFamily: 'JetBrains Mono, monospace',
                            lineHeight: 1.1,
                          }}
                        >
                          <span style={{ color: 'var(--txt3)' }}>→</span>
                          <span
                            style={{
                              color:
                                postAcqs >= co.acqs ? 'var(--green)' : 'var(--red)',
                              fontWeight: 700,
                            }}
                          >
                            {postAcqs.toFixed(1)}
                          </span>
                        </div>
                      )}
                    </div>
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'Inter, sans-serif', minWidth: 160 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
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
                  <td style={tdStyle}>
                    <Badge variant={co.sec === 'solar' ? 'gold' : 'cyan'}>{co.sec}</Badge>
                  </td>
                  <td
                    style={{ ...clickableTd }}
                    title="Click for full calculation audit (baseline → live)"
                    onClick={() => {
                      const baseline =
                        COMPANIES.find((b) => b.ticker === co.ticker) ?? co
                      showWorking(wkEVAudit(deriveCompany(baseline)))
                    }}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    {co.mktcap > 0 ? '₹' + co.mktcap.toLocaleString('en-IN') : 'Private'}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--gold2)' }}>
                    ₹{co.rev.toLocaleString('en-IN')}
                  </td>
                  <td
                    style={{ ...clickableTd, color: 'var(--green)' }}
                    title="How is EBITDA calculated?"
                    onClick={() => showWorking(wkEBITDA(co))}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    ₹{co.ebitda.toLocaleString('en-IN')}
                  </td>
                  <td
                    style={{ ...clickableTd, color: ebmColor(co.ebm) }}
                    title="How is the EBITDA margin calculated?"
                    onClick={() => showWorking(wkEBITDAMargin(co))}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    {co.ebm}%
                  </td>
                  <td
                    style={{ ...clickableTd }}
                    title="Click for full Enterprise Value audit (baseline → live)"
                    onClick={() => {
                      const baseline =
                        COMPANIES.find((b) => b.ticker === co.ticker) ?? co
                      showWorking(wkEVAudit(deriveCompany(baseline)))
                    }}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    {co.ev > 0 ? '₹' + co.ev.toLocaleString('en-IN') : '—'}
                  </td>
                  <td
                    style={{
                      ...clickableTd,
                      color: evEbColor(co.ev_eb),
                      fontWeight: 600,
                    }}
                    title="Click for full EV/EBITDA calculation audit with live data"
                    onClick={() => {
                      const baseline =
                        COMPANIES.find((b) => b.ticker === co.ticker) ?? co
                      showWorking(wkEVEBITDAAudit(deriveCompany(baseline)))
                    }}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    {co.ev_eb > 0 ? co.ev_eb + '×' : '—'}
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      fontWeight: evEbChanged ? 700 : 500,
                      color: evEbChanged
                        ? postEvEb >= co.ev_eb
                          ? 'var(--green)'
                          : 'var(--red)'
                        : 'var(--txt3)',
                      cursor: newsAgg[co.ticker] ? 'pointer' : 'default',
                      fontStyle: evEbChanged ? 'normal' : 'italic',
                    }}
                    onClick={() => newsAgg[co.ticker] && setNewsPanelCo(co)}
                    title={
                      evEbChanged
                        ? `News-adjusted EV/EBITDA · ${adjusted.acknowledgedCount} acknowledged items`
                        : co.ev_eb > 0
                          ? 'Same as pre-ack baseline (no news acknowledged yet)'
                          : '—'
                    }
                  >
                    {co.ev_eb > 0 ? postEvEb.toFixed(2) + '×' : '—'}
                    {evEbChanged && (
                      <span
                        style={{
                          marginLeft: 4,
                          fontSize: 9,
                          color:
                            postEvEb >= co.ev_eb ? 'var(--green)' : 'var(--red)',
                          fontWeight: 600,
                        }}
                      >
                        ({adjusted.deltaPct.ev_eb >= 0 ? '+' : ''}
                        {adjusted.deltaPct.ev_eb.toFixed(1)}%)
                      </span>
                    )}
                  </td>
                  <td
                    style={{ ...clickableTd, color: peColor(co.pe) }}
                    title="How is P/E derived?"
                    onClick={() => showWorking(wkPE(co))}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    {co.pe || '—'}
                  </td>
                  <td
                    style={{ ...clickableTd, color: deColor(co.dbt_eq) }}
                    title="How is the debt/equity derived?"
                    onClick={() => showWorking(wkDebtEquity(co))}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    {co.dbt_eq}
                  </td>
                  <td
                    style={{ ...clickableTd, color: revgColor(co.revg) }}
                    title="How is revenue growth derived?"
                    onClick={() => showWorking(wkRevGrowth(co))}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    {co.revg}%
                  </td>
                  <td
                    style={{ ...clickableTd }}
                    title="Why this flag?"
                    onClick={() => showWorking(wkAcqFlag(co.acqf, co.rea))}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    <Badge variant={flagVariant(co.acqs)}>{co.acqf}</Badge>
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      cursor: newsAgg[co.ticker] ? 'pointer' : 'default',
                    }}
                    onClick={() => newsAgg[co.ticker] && setNewsPanelCo(co)}
                    title={
                      newsAgg[co.ticker]
                        ? `${newsAgg[co.ticker].count} news items · ${newsAgg[co.ticker].acknowledgedCount} acknowledged · click for details`
                        : newsLoading
                          ? 'Loading news…'
                          : 'No recent news found'
                    }
                  >
                    {newsAgg[co.ticker] ? (
                      (() => {
                        const agg = newsAgg[co.ticker]
                        const applied = agg.acknowledgedCount > 0
                        const shownDelta = applied
                          ? agg.appliedMultipleDeltaPct
                          : agg.signalMultipleDeltaPct
                        const deltaColor = applied
                          ? shownDelta >= 0
                            ? 'var(--green)'
                            : 'var(--red)'
                          : 'var(--txt3)'
                        return (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                            }}
                          >
                            <span
                              style={{
                                color: deltaColor,
                                fontWeight: applied ? 700 : 500,
                                fontStyle: applied ? 'normal' : 'italic',
                                opacity: applied ? 1 : 0.75,
                              }}
                            >
                              {shownDelta >= 0 ? '+' : ''}
                              {shownDelta.toFixed(2)}%
                            </span>
                            <span
                              style={{
                                fontSize: 9,
                                color: applied ? 'var(--gold2)' : 'var(--txt3)',
                                fontWeight: applied ? 600 : 400,
                              }}
                            >
                              {applied
                                ? `(${agg.acknowledgedCount}/${agg.count} ✓)`
                                : `(${agg.count} preview)`}
                            </span>
                          </span>
                        )
                      })()
                    ) : (
                      <span style={{ color: 'var(--txt3)' }}>—</span>
                    )}
                  </td>
                  <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                    <button
                      style={{
                        background: 'var(--s3)',
                        border: '1px solid var(--br2)',
                        color: 'var(--txt2)',
                        fontSize: 11,
                        padding: '3px 7px',
                        borderRadius: 3,
                        cursor: 'pointer',
                        marginRight: 3,
                      }}
                    >
                      +WL
                    </button>
                    <button
                      style={{
                        background: 'var(--s3)',
                        border: '1px solid var(--br2)',
                        color: 'var(--txt2)',
                        fontSize: 11,
                        padding: '3px 7px',
                        borderRadius: 3,
                        cursor: 'pointer',
                        marginRight: 3,
                      }}
                    >
                      +Deal
                    </button>
                    <button
                      style={{
                        background: 'var(--s3)',
                        border: '1px solid var(--br2)',
                        color: 'var(--txt2)',
                        fontSize: 11,
                        padding: '3px 7px',
                        borderRadius: 3,
                        cursor: 'pointer',
                        marginRight: 3,
                      }}
                    >
                      +Cmp
                    </button>
                    <a
                      href={`/report/${co.ticker}?print=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open full institutional valuation PDF report in a new tab"
                      style={{
                        background: 'var(--golddim)',
                        border: '1px solid var(--gold2)',
                        color: 'var(--gold2)',
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.3px',
                        textTransform: 'uppercase',
                        padding: '3px 8px',
                        borderRadius: 3,
                        cursor: 'pointer',
                        textDecoration: 'none',
                        marginRight: 4,
                      }}
                    >
                      PDF
                    </a>
                    <span style={{ display: 'inline-block' }}>
                      <ExpressInterestButton
                        ticker={co.ticker}
                        companyName={co.name}
                        dealType="listed"
                        sector={co.sec}
                        rationale={co.rea}
                        sourcePage="valuation"
                      />
                    </span>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Benchmark cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          marginTop: 20,
        }}
      >
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', marginBottom: 8 }}>
            Valuation Benchmarks
          </div>
          <p style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.7, margin: 0 }}>
            EV/EBITDA: <span style={{ color: 'var(--green)' }}>≤15×</span> ideal ·{' '}
            <span style={{ color: 'var(--gold2)' }}>15–25×</span> fair ·{' '}
            <span style={{ color: 'var(--red)' }}>35×+</span> expensive
            <br />
            P/E: <span style={{ color: 'var(--green)' }}>≤25×</span> ·{' '}
            <span style={{ color: 'var(--gold2)' }}>25–45×</span> ·{' '}
            <span style={{ color: 'var(--red)' }}>60×+</span>
            <br />
            D/E: <span style={{ color: 'var(--green)' }}>≤0.3</span> ·{' '}
            <span style={{ color: 'var(--gold2)' }}>0.3–0.7</span> ·{' '}
            <span style={{ color: 'var(--red)' }}>1×+</span>
          </p>
        </div>
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', marginBottom: 8 }}>
            Deal Structures
          </div>
          <p style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.7, margin: 0 }}>
            Staged 20%→51%→100%
            <br />
            Earnout on PLI/ALMM milestones
            <br />
            JV with tech transfer clause
            <br />
            Asset vs share acquisition
            <br />
            Convertible note for startups
          </p>
        </div>
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', marginBottom: 8 }}>
            Key Diligence Items
          </div>
          <p style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.7, margin: 0 }}>
            ALMM/PLI eligibility status
            <br />
            Capacity utilisation %<br />
            Order book quality + HHI
            <br />
            Working capital DSO/DIO
            <br />
            Related-party transactions
          </p>
        </div>
      </div>

      {/* ── News Impact drawer ── */}
      {newsPanelCo && (
        <div
          onClick={() => setNewsPanelCo(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(3px)',
            zIndex: 9000,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(560px, 100vw)',
              height: '100%',
              background: 'var(--s1)',
              borderLeft: '1px solid var(--br2)',
              boxShadow: '-12px 0 40px rgba(0,0,0,0.4)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '14px 16px',
                borderBottom: '1px solid var(--br)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: 9,
                    color: 'var(--txt3)',
                    letterSpacing: '1.2px',
                    textTransform: 'uppercase',
                    marginBottom: 2,
                  }}
                >
                  News Impact · {newsPanelCo.ticker}
                </div>
                <div
                  style={{
                    fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                    fontSize: 16,
                    fontWeight: 600,
                    color: 'var(--txt)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  {newsPanelCo.name}
                </div>
              </div>
              <button
                onClick={() => setNewsPanelCo(null)}
                aria-label="Close"
                style={{
                  background: 'var(--s3)',
                  border: '1px solid var(--br)',
                  color: 'var(--txt2)',
                  fontSize: 14,
                  padding: '4px 10px',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>
            {newsAgg[newsPanelCo.ticker] ? (
              (() => {
                const agg = newsAgg[newsPanelCo.ticker]
                const adjusted = getAdjusted(newsPanelCo)
                const applied = agg.acknowledgedCount > 0
                return (
                  <>
                    <PrePostSummaryTile co={newsPanelCo} adjusted={adjusted} />
                    <div
                      style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid var(--br)',
                        background: 'var(--s2)',
                      }}
                    >
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(3, 1fr)',
                          gap: 10,
                        }}
                      >
                        <div>
                          <div
                            style={{
                              fontSize: 9,
                              color: 'var(--txt3)',
                              letterSpacing: '1px',
                              textTransform: 'uppercase',
                              marginBottom: 2,
                            }}
                          >
                            Items
                          </div>
                          <div
                            style={{
                              fontFamily:
                                'Source Serif 4, Source Serif Pro, Georgia, serif',
                              fontSize: 20,
                              fontWeight: 700,
                              color: 'var(--txt)',
                            }}
                          >
                            {agg.count}
                            <span
                              style={{
                                fontSize: 11,
                                color: 'var(--gold2)',
                                marginLeft: 6,
                                fontWeight: 600,
                              }}
                            >
                              {agg.acknowledgedCount > 0
                                ? `(${agg.acknowledgedCount} ✓)`
                                : '(0 ✓)'}
                            </span>
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: 9,
                              color: 'var(--txt3)',
                              letterSpacing: '1px',
                              textTransform: 'uppercase',
                              marginBottom: 2,
                            }}
                          >
                            Preview Signal
                          </div>
                          <div
                            style={{
                              fontFamily:
                                'Source Serif 4, Source Serif Pro, Georgia, serif',
                              fontSize: 18,
                              fontWeight: 700,
                              color: 'var(--txt3)',
                              fontStyle: 'italic',
                            }}
                          >
                            {agg.signalMultipleDeltaPct >= 0 ? '+' : ''}
                            {agg.signalMultipleDeltaPct.toFixed(2)}%
                          </div>
                        </div>
                        <div>
                          <div
                            style={{
                              fontSize: 9,
                              color: 'var(--gold2)',
                              letterSpacing: '1px',
                              textTransform: 'uppercase',
                              marginBottom: 2,
                              fontWeight: 700,
                            }}
                          >
                            Applied Δ
                          </div>
                          <div
                            style={{
                              fontFamily:
                                'Source Serif 4, Source Serif Pro, Georgia, serif',
                              fontSize: 20,
                              fontWeight: 700,
                              color: applied
                                ? agg.appliedMultipleDeltaPct >= 0
                                  ? 'var(--green)'
                                  : 'var(--red)'
                                : 'var(--txt3)',
                            }}
                          >
                            {applied
                              ? `${agg.appliedMultipleDeltaPct >= 0 ? '+' : ''}${agg.appliedMultipleDeltaPct.toFixed(2)}%`
                              : '—'}
                          </div>
                        </div>
                      </div>
                      {/* Per-parameter adjusted values table */}
                      <ParamAdjustmentTable
                        co={newsPanelCo}
                        paramAdjustments={agg.paramAdjustments}
                        applied={applied}
                      />
                      {!applied && (
                        <div
                          style={{
                            marginTop: 8,
                            padding: '8px 10px',
                            background: 'var(--s1)',
                            border: '1px solid var(--br)',
                            borderRadius: 4,
                            fontSize: 10,
                            color: 'var(--txt3)',
                            fontStyle: 'italic',
                            lineHeight: 1.4,
                          }}
                        >
                          ℹ News impact is optional. Click{' '}
                          <strong style={{ color: 'var(--gold2)' }}>
                            + Acknowledge
                          </strong>{' '}
                          on any item below (or use the bulk action) to apply
                          it to the parameters above.
                        </div>
                      )}

                      {/* Bulk acknowledge / clear */}
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          marginTop: 10,
                          flexWrap: 'wrap',
                        }}
                      >
                        <button
                          onClick={() => {
                            agg.items.forEach(({ item }) => {
                              const key = newsItemKey(item)
                              if (!isAcknowledged(key)) {
                                ackAll(key)
                              }
                            })
                          }}
                          disabled={agg.acknowledgedCount === agg.items.length}
                          style={{
                            background:
                              agg.acknowledgedCount === agg.items.length
                                ? 'var(--s3)'
                                : 'var(--gold2)',
                            color:
                              agg.acknowledgedCount === agg.items.length
                                ? 'var(--txt3)'
                                : '#000',
                            border: '1px solid var(--gold2)',
                            fontSize: 10,
                            fontWeight: 700,
                            letterSpacing: '0.4px',
                            textTransform: 'uppercase',
                            padding: '5px 11px',
                            borderRadius: 3,
                            cursor:
                              agg.acknowledgedCount === agg.items.length
                                ? 'not-allowed'
                                : 'pointer',
                          }}
                        >
                          ✓ Acknowledge all visible
                        </button>
                        {agg.acknowledgedCount > 0 && (
                          <button
                            onClick={() => {
                              agg.items.forEach(({ item }) => {
                                const key = newsItemKey(item)
                                if (isAcknowledged(key)) {
                                  unackOne(key)
                                }
                              })
                            }}
                            style={{
                              background: 'transparent',
                              color: 'var(--red)',
                              border: '1px solid var(--red)',
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: '0.4px',
                              textTransform: 'uppercase',
                              padding: '5px 11px',
                              borderRadius: 3,
                              cursor: 'pointer',
                            }}
                          >
                            Unack all
                          </button>
                        )}
                      </div>
                    </div>
                    <div
                      style={{
                        flex: 1,
                        overflowY: 'auto',
                        padding: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      {agg.items.map(
                        ({
                          item,
                          impact,
                        }: {
                          item: NewsItem
                          impact: NewsImpact
                        }) => (
                          <NewsCard
                            key={item.link || item.guid || item.title}
                            item={item}
                            impact={impact}
                            compact
                            showAcknowledge
                          />
                        )
                      )}
                    </div>
                  </>
                )
              })()
            ) : (
              <div style={{ padding: 24, color: 'var(--txt3)', fontSize: 12 }}>
                No recent news items matched this company.
              </div>
            )}
          </div>
        </div>
      )}

      {/* News status footer */}
      <div
        style={{
          marginTop: 12,
          fontSize: 10,
          color: 'var(--txt3)',
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        {newsLoading ? (
          <span>Loading news intelligence…</span>
        ) : newsError ? (
          <span style={{ color: 'var(--red)' }}>News: {newsError}</span>
        ) : (
          <>
            <span style={{ color: 'var(--green)' }}>
              ● News intelligence loaded (preview only)
            </span>
            <span>
              {Object.keys(newsAgg).length} companies with coverage ·{' '}
              <span
                style={{
                  color: ackCount > 0 ? 'var(--gold2)' : 'var(--txt3)',
                  fontWeight: ackCount > 0 ? 700 : 500,
                }}
              >
                {ackCount} item{ackCount === 1 ? '' : 's'} acknowledged
              </span>
            </span>
            {newsLastRefresh && (
              <span>
                Last:{' '}
                {newsLastRefresh.toLocaleTimeString('en-IN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
            <button
              onClick={() => loadNews(true)}
              disabled={newsLoading}
              style={{
                background: 'var(--golddim)',
                border: '1px solid var(--gold2)',
                color: 'var(--gold2)',
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '0.4px',
                textTransform: 'uppercase',
                padding: '3px 9px',
                borderRadius: 3,
                cursor: 'pointer',
              }}
            >
              ↻ Refresh news
            </button>
            {ackCount > 0 && (
              <button
                onClick={() => {
                  if (
                    confirm(
                      `Clear all ${ackCount} news acknowledgment${ackCount === 1 ? '' : 's'}? This removes news impact from every valuation estimate.`
                    )
                  ) {
                    clearAllAcks()
                  }
                }}
                style={{
                  background: 'transparent',
                  border: '1px solid var(--red)',
                  color: 'var(--red)',
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: '0.4px',
                  textTransform: 'uppercase',
                  padding: '3px 9px',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                Clear all acks
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Pre/Post summary tile at the top of the news drawer ────────────

function PrePostSummaryTile({
  co,
  adjusted,
}: {
  co: Company
  adjusted: CompanyAdjustedMetrics
}) {
  const hasAdj = adjusted.hasAdjustment
  const rows: Array<{
    label: string
    pre: string
    post: string
    delta: number
    changed: boolean
  }> = [
    {
      label: 'Acq Score',
      pre: adjusted.pre.acqs.toFixed(1) + '/10',
      post: adjusted.post.acqs.toFixed(1) + '/10',
      delta: adjusted.deltaPct.acqs,
      changed:
        Math.round(adjusted.pre.acqs * 10) !==
        Math.round(adjusted.post.acqs * 10),
    },
    {
      label: 'EV/EBITDA',
      pre: co.ev_eb > 0 ? adjusted.pre.ev_eb.toFixed(2) + '×' : '—',
      post: co.ev_eb > 0 ? adjusted.post.ev_eb.toFixed(2) + '×' : '—',
      delta: adjusted.deltaPct.ev_eb,
      changed: Math.abs(adjusted.post.ev_eb - adjusted.pre.ev_eb) > 0.005,
    },
    {
      label: 'Rev Growth',
      pre: co.revg > 0 ? adjusted.pre.revg.toFixed(1) + '%' : '—',
      post: co.revg > 0 ? adjusted.post.revg.toFixed(1) + '%' : '—',
      delta: adjusted.deltaPct.revg,
      changed: Math.abs(adjusted.post.revg - adjusted.pre.revg) > 0.05,
    },
    {
      label: 'EBITDA Margin',
      pre: co.ebm > 0 ? adjusted.pre.ebm.toFixed(1) + '%' : '—',
      post: co.ebm > 0 ? adjusted.post.ebm.toFixed(1) + '%' : '—',
      delta: adjusted.deltaPct.ebm,
      changed: Math.abs(adjusted.post.ebm - adjusted.pre.ebm) > 0.05,
    },
  ]
  return (
    <div
      style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--br)',
        background: hasAdj ? 'var(--golddim)' : 'var(--s2)',
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: 'var(--txt3)',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          fontWeight: 700,
          marginBottom: 8,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Pre / Post News Snapshot</span>
        <span style={{ color: hasAdj ? 'var(--gold2)' : 'var(--txt3)' }}>
          {hasAdj
            ? `${adjusted.acknowledgedCount} acked · applied`
            : 'nothing acked'}
        </span>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
        }}
      >
        {rows.map((r) => {
          const deltaColor =
            r.delta > 0
              ? 'var(--green)'
              : r.delta < 0
                ? 'var(--red)'
                : 'var(--txt3)'
          return (
            <div
              key={r.label}
              style={{
                background: 'var(--s1)',
                border: `1px solid ${r.changed ? deltaColor : 'var(--br)'}`,
                borderRadius: 4,
                padding: '8px 9px',
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: 'var(--txt3)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.6px',
                  marginBottom: 4,
                }}
              >
                {r.label}
              </div>
              <div
                style={{
                  fontSize: 11,
                  fontFamily: 'JetBrains Mono, monospace',
                  color: 'var(--txt3)',
                }}
              >
                Pre: <span style={{ color: 'var(--txt2)' }}>{r.pre}</span>
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontFamily: 'JetBrains Mono, monospace',
                  fontWeight: 700,
                  color: r.changed ? deltaColor : 'var(--txt)',
                  marginTop: 2,
                }}
              >
                Post: {r.post}
              </div>
              {r.changed && (
                <div
                  style={{
                    fontSize: 9,
                    fontFamily: 'JetBrains Mono, monospace',
                    color: deltaColor,
                    fontWeight: 700,
                    marginTop: 2,
                  }}
                >
                  {r.delta > 0 ? '+' : ''}
                  {r.delta.toFixed(2)}%
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Per-parameter adjusted values table ───────────────────────────

function ParamAdjustmentTable({
  co,
  paramAdjustments,
  applied,
}: {
  co: Company
  paramAdjustments: Record<string, { adjustmentFactor: number; count: number; manualCount: number } | undefined>
  applied: boolean
}) {
  const rows: Array<{
    param: ValuationParam
    base: number
    factor: number
    adjusted: number
    count: number
    manualCount: number
  }> = []

  for (const param of PARAM_ORDER) {
    const adj = paramAdjustments[param]
    if (!adj || adj.adjustmentFactor === 0) continue
    const base = getBaseValue(param, co)
    if (base == null) continue
    const adjusted = clampAdjustedValue(param, base * (1 + adj.adjustmentFactor))
    rows.push({
      param,
      base,
      factor: adj.adjustmentFactor,
      adjusted,
      count: adj.count,
      manualCount: adj.manualCount,
    })
  }

  return (
    <div
      style={{
        marginTop: 10,
        padding: 0,
        background: applied ? 'var(--golddim)' : 'var(--s1)',
        border: `1px solid ${applied ? 'var(--gold2)' : 'var(--br)'}`,
        borderRadius: 4,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '7px 11px',
          background: 'var(--s2)',
          borderBottom: '1px solid var(--br)',
          fontSize: 9,
          color: 'var(--txt3)',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          fontWeight: 700,
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>Valuation Parameters — News-Adjusted</span>
        <span style={{ color: applied ? 'var(--gold2)' : 'var(--txt3)' }}>
          {applied ? '● ACTIVE' : '○ PREVIEW ONLY'}
        </span>
      </div>
      {rows.length === 0 ? (
        <div
          style={{
            padding: '10px 12px',
            fontSize: 10,
            color: 'var(--txt3)',
            fontStyle: 'italic',
          }}
        >
          {applied
            ? 'No parameters affected by acknowledged items yet.'
            : 'Acknowledge at least one item below to compute parameter adjustments.'}
        </div>
      ) : (
        <table
          style={{
            width: '100%',
            borderCollapse: 'collapse',
            fontSize: 10,
          }}
        >
          <thead>
            <tr
              style={{
                background: 'var(--s1)',
                borderBottom: '1px solid var(--br)',
              }}
            >
              <th
                style={{
                  padding: '6px 10px',
                  textAlign: 'left',
                  fontSize: 9,
                  color: 'var(--txt3)',
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}
              >
                Parameter
              </th>
              <th
                style={{
                  padding: '6px 10px',
                  textAlign: 'right',
                  fontSize: 9,
                  color: 'var(--txt3)',
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}
              >
                Baseline
              </th>
              <th
                style={{
                  padding: '6px 10px',
                  textAlign: 'right',
                  fontSize: 9,
                  color: 'var(--txt3)',
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}
              >
                Δ
              </th>
              <th
                style={{
                  padding: '6px 10px',
                  textAlign: 'right',
                  fontSize: 9,
                  color: 'var(--txt3)',
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                  fontWeight: 700,
                }}
              >
                Adjusted
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const pct = r.factor * 100
              const color =
                r.factor > 0
                  ? 'var(--green)'
                  : r.factor < 0
                    ? 'var(--red)'
                    : 'var(--txt3)'
              return (
                <tr
                  key={r.param}
                  style={{ borderBottom: '1px solid var(--br)' }}
                >
                  <td
                    style={{
                      padding: '6px 10px',
                      color: 'var(--txt)',
                      fontWeight: 500,
                    }}
                  >
                    {PARAM_DEFS[r.param].label}
                    <span
                      style={{
                        fontSize: 8,
                        color: 'var(--txt3)',
                        marginLeft: 5,
                      }}
                    >
                      {r.count} item{r.count === 1 ? '' : 's'}
                      {r.manualCount > 0 && (
                        <span style={{ color: 'var(--gold2)', fontWeight: 600 }}>
                          {' '}
                          · {r.manualCount} manual
                        </span>
                      )}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: '6px 10px',
                      textAlign: 'right',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: 'var(--txt2)',
                    }}
                  >
                    {formatParamValue(r.param, r.base)}
                  </td>
                  <td
                    style={{
                      padding: '6px 10px',
                      textAlign: 'right',
                      fontFamily: 'JetBrains Mono, monospace',
                      color,
                      fontWeight: 700,
                    }}
                  >
                    {pct > 0 ? '+' : ''}
                    {pct.toFixed(1)}%
                  </td>
                  <td
                    style={{
                      padding: '6px 10px',
                      textAlign: 'right',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: applied ? color : 'var(--txt3)',
                      fontWeight: 700,
                    }}
                  >
                    {applied
                      ? formatParamValue(r.param, r.adjusted)
                      : formatParamValue(r.param, r.base)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </div>
  )
}
