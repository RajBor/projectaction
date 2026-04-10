'use client'

import { useMemo, useState } from 'react'
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
    </div>
  )
}
