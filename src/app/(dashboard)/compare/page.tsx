'use client'

import { useMemo, useState } from 'react'
import { COMPANIES } from '@/lib/data/companies'
import { useWorkingPopup, type WorkingDef } from '@/components/working/WorkingPopup'
import {
  wkCompareMetric,
  wkEBITDA,
  wkEBITDAMargin,
  wkMktCap,
  wkEVEBITDA,
  wkPE,
  wkDebtEquity,
  wkRevGrowth,
  wkAcqScore,
  wkAcqFlag,
} from '@/lib/working'

type Company = any

type MetricDef = {
  label: string
  get: (c: Company) => string | number
  best: '' | 'max' | 'min_num' | 'max_num'
  /** Compare-metric key used by wkCompareMetric (null = no row-label popup) */
  cmp?: string | null
  /** Per-cell popup for a company (null = no cell popup) */
  cell?: ((c: Company) => WorkingDef | null) | null
}

const METRICS: MetricDef[] = [
  { label: 'Company', get: (c) => c.name, best: '', cmp: null, cell: null },
  { label: 'Ticker', get: (c) => c.ticker, best: '', cmp: null, cell: null },
  { label: 'Sector', get: (c) => c.sec, best: '', cmp: null, cell: null },
  { label: 'Revenue ₹Cr', get: (c) => c.rev, best: 'max', cmp: null, cell: null },
  { label: 'EBITDA ₹Cr', get: (c) => c.ebitda, best: 'max', cmp: null, cell: (c) => wkEBITDA(c) },
  { label: 'EBITDA%', get: (c) => `${c.ebm}%`, best: 'max_num', cmp: 'EBITDA%', cell: (c) => wkEBITDAMargin(c) },
  { label: 'Market Cap ₹Cr', get: (c) => (c.mktcap > 0 ? c.mktcap : 'Private'), best: '', cmp: null, cell: (c) => (c.mktcap > 0 ? wkMktCap(c) : null) },
  { label: 'EV ₹Cr', get: (c) => (c.ev > 0 ? c.ev : 'N/A'), best: 'min_num', cmp: null, cell: (c) => (c.ev > 0 ? wkMktCap(c) : null) },
  { label: 'EV/EBITDA', get: (c) => (c.ev_eb > 0 ? `${c.ev_eb}×` : '—'), best: 'min_num', cmp: 'EV/EBITDA', cell: (c) => (c.ev_eb > 0 ? wkEVEBITDA(c) : null) },
  { label: 'P/E Ratio', get: (c) => c.pe || '—', best: 'min_num', cmp: 'P/E Ratio', cell: (c) => (c.pe ? wkPE(c) : null) },
  { label: 'D/E Ratio', get: (c) => c.dbt_eq, best: 'min_num', cmp: 'D/E Ratio', cell: (c) => wkDebtEquity(c) },
  { label: 'Revenue Growth%', get: (c) => `${c.revg}%`, best: 'max_num', cmp: 'Revenue Growth%', cell: (c) => wkRevGrowth(c) },
  { label: 'Acq Score', get: (c) => c.acqs, best: 'max', cmp: 'Acq Score', cell: (c) => wkAcqScore(c) },
  { label: 'Flag', get: (c) => c.acqf, best: '', cmp: null, cell: (c) => wkAcqFlag(c.acqf, c.rea) },
]

export default function ComparePage() {
  const companies = COMPANIES as Company[]
  const [compareList, setCompareList] = useState<string[]>([])
  const [selValue, setSelValue] = useState('')

  const selected = useMemo(
    () => compareList.map((t) => companies.find((c) => c.ticker === t)).filter(Boolean) as Company[],
    [compareList, companies]
  )

  function addFromSel() {
    if (!selValue) return
    if (compareList.includes(selValue)) return
    if (compareList.length >= 4) return
    setCompareList([...compareList, selValue])
    setSelValue('')
  }

  function removeTicker(ticker: string) {
    setCompareList(compareList.filter((t) => t !== ticker))
  }

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
          SolarGrid Pro <span style={{ opacity: 0.5 }}>›</span> Analytics
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
          Company <em style={{ color: 'var(--gold2)', fontStyle: 'normal' }}>Comparison</em>
        </h1>
        <div style={{ marginTop: 6 }}>
          <span
            style={{
              display: 'inline-block',
              background: 'rgba(85,104,128,0.2)',
              color: 'var(--txt2)',
              border: '1px solid rgba(85,104,128,0.3)',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 11,
            }}
          >
            Side-by-side · Up to 4 companies · Auto-highlights best metric
          </span>
        </div>
      </div>

      {/* Panel */}
      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        {/* Controls */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginBottom: 16,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <span style={{ fontSize: 13, color: 'var(--txt3)', fontWeight: 600 }}>
            Add Company:
          </span>
          <select
            value={selValue}
            onChange={(e) => setSelValue(e.target.value)}
            style={{
              background: 'var(--s3)',
              color: 'var(--txt)',
              border: '1px solid var(--br)',
              padding: '7px 10px',
              borderRadius: 5,
              fontSize: 13,
              minWidth: 260,
            }}
          >
            <option value="">— Select company —</option>
            {companies.map((c) => (
              <option key={c.ticker} value={c.ticker}>
                {c.name} ({c.ticker})
              </option>
            ))}
          </select>
          <button
            onClick={addFromSel}
            style={{
              background: 'var(--green)',
              color: '#000',
              border: 'none',
              padding: '8px 14px',
              borderRadius: 5,
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            + Add
          </button>
          <button
            onClick={() => setCompareList([])}
            style={{
              background: 'var(--s3)',
              color: 'var(--txt)',
              border: '1px solid var(--br2)',
              padding: '8px 14px',
              borderRadius: 5,
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Clear All
          </button>
        </div>

        {selected.length < 2 && (
          <div
            style={{
              padding: 24,
              background: 'var(--s3)',
              border: '1px solid var(--br)',
              borderRadius: 6,
            }}
          >
            <p style={{ margin: 0, color: 'var(--txt2)', fontSize: 13 }}>
              Select 2–4 companies to compare. You can also use the "+Cmp" buttons in the
              Valuation Matrix.
            </p>
          </div>
        )}

        {selected.length >= 2 && <CompareTable cos={selected} />}

        {selected.length >= 1 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {selected.map((c) => (
              <button
                key={c.ticker}
                onClick={() => removeTicker(c.ticker)}
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  border: 'none',
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                ✕ Remove {c.ticker}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function CompareTable({ cos }: { cos: any[] }) {
  const { showWorking } = useWorkingPopup()
  const gridCols = `150px ${cos.map(() => '1fr').join(' ')}`

  function highlight(metric: MetricDef, val: any): boolean {
    const { best } = metric
    if (best === 'max' && typeof val === 'number') {
      const nums = cos.map((c) => metric.get(c) as number)
      return val === Math.max(...nums)
    }
    if (best === 'min_num') {
      const raw = parseFloat(String(val))
      if (isNaN(raw)) return false
      const nums = cos
        .map((c) => parseFloat(String(metric.get(c))))
        .filter((n) => !isNaN(n) && n > 0)
      if (!nums.length) return false
      return raw === Math.min(...nums)
    }
    if (best === 'max_num') {
      const raw = parseFloat(String(val))
      if (isNaN(raw)) return false
      const nums = cos.map((c) => parseFloat(String(metric.get(c))) || 0)
      return raw === Math.max(...nums)
    }
    return false
  }

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--br)', borderRadius: 6 }}>
      <div style={{ minWidth: 600 }}>
        {METRICS.map((m, i) => (
          <div
            key={m.label}
            style={{
              display: 'grid',
              gridTemplateColumns: gridCols,
              borderBottom: i < METRICS.length - 1 ? '1px solid var(--br)' : 'none',
              background: i % 2 === 0 ? 'var(--s2)' : 'var(--s3)',
            }}
          >
            {(() => {
              const cmpDef = m.cmp ? wkCompareMetric(m.cmp) : null
              const clickable = !!cmpDef
              return (
                <div
                  onClick={clickable ? () => showWorking(cmpDef as WorkingDef) : undefined}
                  title={clickable ? 'Click to see how this metric is calculated' : undefined}
                  style={{
                    padding: '10px 12px',
                    fontSize: 12,
                    color: 'var(--txt3)',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.4px',
                    borderRight: '1px solid var(--br)',
                    cursor: clickable ? 'pointer' : 'default',
                    borderBottom: clickable ? '1px dotted var(--txt3)' : undefined,
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={
                    clickable
                      ? (e) => (e.currentTarget.style.background = 'rgba(212,175,55,0.08)')
                      : undefined
                  }
                  onMouseLeave={
                    clickable
                      ? (e) => (e.currentTarget.style.background = 'transparent')
                      : undefined
                  }
                >
                  {m.label}
                </div>
              )
            })()}
            {cos.map((co) => {
              const val = m.get(co)
              const isBest = highlight(m, val)
              const cellDef = m.cell ? m.cell(co) : null
              const clickable = !!cellDef
              return (
                <div
                  key={co.ticker + m.label}
                  onClick={clickable ? () => showWorking(cellDef as WorkingDef) : undefined}
                  title={clickable ? 'Click to see calculation' : undefined}
                  style={{
                    padding: '10px 12px',
                    fontSize: 13,
                    color: isBest ? 'var(--green)' : 'var(--txt)',
                    fontWeight: isBest ? 700 : 500,
                    background: isBest ? 'rgba(16,185,129,0.08)' : 'transparent',
                    cursor: clickable ? 'pointer' : 'default',
                    borderBottom: clickable ? '1px dotted var(--br2)' : undefined,
                    transition: 'background 0.15s',
                    fontFamily:
                      typeof val === 'number' ||
                      ['EV/EBITDA', 'EBITDA%', 'P/E Ratio', 'D/E Ratio', 'Revenue Growth%'].includes(
                        m.label
                      )
                        ? 'JetBrains Mono, monospace'
                        : undefined,
                  }}
                  onMouseEnter={
                    clickable
                      ? (e) => {
                          e.currentTarget.style.background = isBest
                            ? 'rgba(16,185,129,0.18)'
                            : 'rgba(212,175,55,0.08)'
                        }
                      : undefined
                  }
                  onMouseLeave={
                    clickable
                      ? (e) => {
                          e.currentTarget.style.background = isBest
                            ? 'rgba(16,185,129,0.08)'
                            : 'transparent'
                        }
                      : undefined
                  }
                >
                  {typeof val === 'number' ? val.toLocaleString('en-IN') : String(val)}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
