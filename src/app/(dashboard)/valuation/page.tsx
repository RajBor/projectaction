'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { COMPANIES } from '@/lib/data/companies'
import type { Company } from '@/lib/data/companies'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { Badge } from '@/components/ui/Badge'
import { SectionTitle } from '@/components/ui/SectionTitle'
import { useWorkingPopup } from '@/components/working/WorkingPopup'
import {
  wkAcqScore,
  wkMktCap,
  wkEBITDA,
  wkEBITDAMargin,
  wkEVEBITDA,
  wkPE,
  wkDebtEquity,
  wkRevGrowth,
  wkAcqFlag,
} from '@/lib/working'
import {
  fetchNews,
  decorateNews,
  dedupe,
  sortByDate,
  DOMAIN_QUERIES,
  type NewsItem,
} from '@/lib/news/api'
import { aggregateImpactByCompany, type NewsImpact } from '@/lib/news/impact'
import { NewsCard } from '@/components/news/NewsCard'
import { useNewsAck, newsItemKey } from '@/components/news/NewsAckProvider'
import {
  PARAM_DEFS,
  PARAM_ORDER,
  getBaseValue,
  formatParamValue,
  clampAdjustedValue,
  type ValuationParam,
} from '@/lib/news/params'

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

  // ── News intelligence ──
  // Raw decorated items are stored once per fetch. The per-company
  // aggregate is recomputed whenever acknowledgments change so the
  // displayed "applied" delta updates live without a network round trip.
  const [newsItems, setNewsItems] = useState<Array<{ item: NewsItem; impact: NewsImpact }>>([])
  const [newsLoading, setNewsLoading] = useState(false)
  const [newsError, setNewsError] = useState<string | null>(null)
  const [newsLastRefresh, setNewsLastRefresh] = useState<Date | null>(null)
  const [newsPanelCo, setNewsPanelCo] = useState<Company | null>(null)
  const newsAbortRef = useRef<AbortController | null>(null)

  const {
    isAcknowledged,
    acknowledge: ackAll,
    unacknowledge: unackOne,
    count: ackCount,
    clearAll: clearAllAcks,
    getManualOverride,
    acknowledged: ackMap,
  } = useNewsAck()

  const newsAgg = useMemo(
    () =>
      aggregateImpactByCompany(newsItems, {
        isAcknowledged,
        getManualOverride,
      }),
    // ackMap is included so the memo invalidates when manual overrides
    // change — getManualOverride's identity is stable but it reads
    // from `acknowledged` state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [newsItems, isAcknowledged, getManualOverride, ackMap]
  )

  const loadNews = async (fresh = false) => {
    if (newsAbortRef.current) newsAbortRef.current.abort()
    const ctrl = new AbortController()
    newsAbortRef.current = ctrl
    setNewsLoading(true)
    setNewsError(null)
    // Pull the domain queries most relevant to valuation
    const queries = [
      DOMAIN_QUERIES.solar_value_chain,
      DOMAIN_QUERIES.td_infrastructure,
      DOMAIN_QUERIES.ma_investment,
      DOMAIN_QUERIES.financial_results,
    ]
    const results = await Promise.all(
      queries.map((q) => fetchNews({ q, limit: 30, fresh, signal: ctrl.signal }))
    )
    if (ctrl.signal.aborted) return
    const all: NewsItem[] = []
    const errors: string[] = []
    for (const res of results) {
      if (res.ok && res.data) {
        all.push(...res.data)
      } else if (res.error) {
        errors.push(res.error)
      }
    }
    if (all.length === 0 && errors.length) {
      setNewsError(errors[0])
      setNewsLoading(false)
      return
    }
    const decorated = sortByDate(dedupe(decorateNews(all, COMPANIES)))
    setNewsItems(decorated)
    setNewsLastRefresh(new Date())
    setNewsLoading(false)
  }

  useEffect(() => {
    loadNews(false)
    return () => {
      if (newsAbortRef.current) newsAbortRef.current.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = useMemo(() => {
    let data = COMPANIES.filter(
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
  }, [fSec, fScore, fMaxEV, fSearch, sortCol, sortDir])

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
          SolarGrid Pro <span style={{ margin: '0 6px' }}>›</span> Analytics
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
              {filtered.map((co) => (
                <tr
                  key={co.ticker}
                  style={{
                    borderBottom: '1px solid var(--br)',
                    background: co.acqs >= 8 ? 'rgba(247,183,49,0.04)' : 'transparent',
                  }}
                >
                  <td
                    style={{ ...clickableTd }}
                    title="How is the acquisition score calculated?"
                    onClick={() => showWorking(wkAcqScore(co))}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    <ScoreBadge score={co.acqs} size={26} />
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
                    title="How is market cap calculated?"
                    onClick={() => showWorking(wkMktCap(co))}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    {co.mktcap > 0 ? '₹' + co.mktcap.toLocaleString() : 'Private'}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--gold2)' }}>
                    ₹{co.rev.toLocaleString()}
                  </td>
                  <td
                    style={{ ...clickableTd, color: 'var(--green)' }}
                    title="How is EBITDA calculated?"
                    onClick={() => showWorking(wkEBITDA(co))}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    ₹{co.ebitda.toLocaleString()}
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
                  <td style={tdStyle}>{co.ev > 0 ? '₹' + co.ev.toLocaleString() : '—'}</td>
                  <td
                    style={{
                      ...clickableTd,
                      color: evEbColor(co.ev_eb),
                      fontWeight: 600,
                    }}
                    title="How is EV/EBITDA calculated?"
                    onClick={() => showWorking(wkEVEBITDA(co))}
                    onMouseEnter={hoverBg}
                    onMouseLeave={unhoverBg}
                  >
                    {co.ev_eb > 0 ? co.ev_eb + '×' : '—'}
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
                      }}
                    >
                      +Cmp
                    </button>
                  </td>
                </tr>
              ))}
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
                const applied = agg.acknowledgedCount > 0
                const adjustedEvEb =
                  newsPanelCo.ev_eb > 0
                    ? newsPanelCo.ev_eb * (1 + agg.appliedMultipleDeltaPct / 100)
                    : 0
                return (
                  <>
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
