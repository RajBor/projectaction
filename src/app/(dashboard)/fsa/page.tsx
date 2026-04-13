'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { COMPANIES } from '@/lib/data/companies'
import { PRIVATE_COMPANIES } from '@/lib/data/private-companies'
import type { Company } from '@/lib/data/companies'
import { Badge } from '@/components/ui/Badge'
import { useWorkingPopup } from '@/components/working/WorkingPopup'
import { wkDCFOutput, wkWACC, wkTerminalValue, wkSynergyNPV } from '@/lib/working'
import { runFullFinancialAnalysis, type FSAInputs, type FSAResult } from '@/lib/fsa'
import {
  fromCompany,
  fromStockProfile,
  fromScreenerRow,
  estimateMissingInputs,
  mergeInputs,
  type InputsGap,
} from '@/lib/fsa/data-source'
import { screenerCode } from '@/lib/live/screener-fetch'
import {
  parseAnnualReportFinancials,
  enrichWithPriorYearBalances,
  type AnnualPeriod,
  type RawFinancialEntry,
} from '@/lib/fsa/annual-report'
import {
  addDoc,
  clearDocs,
  downloadDoc,
  listDocs,
  removeDoc,
  UPLOAD_LIMITS,
  type DocRecord,
} from '@/lib/fsa/uploads'
import { stockQuote, tickerToApiName, type StockProfile } from '@/lib/stocks/api'
import { FSAIntelligencePanel } from '@/components/fsa/FSAIntelligencePanel'

// ── DCF Calculator types + math (merged from /dcf page) ─────

interface DCFInputs {
  rev: number; ebm: number; gr: number; wacc: number; tgr: number
  yrs: number; debt: number; rs: number; cs: number; ic: number
}
interface DCFResults {
  evBase: number; evSyn: number; equity: number; eqSyn: number
  synPV: number; termPV: number; pv: number; ebitda: number
  eveb: number; evebSyn: number; bidLow: number; bidHigh: number; walkAway: number
}
function computeDCF(inp: DCFInputs): DCFResults {
  const { rev, ebm, gr, wacc, tgr, yrs, debt, rs, cs, ic } = inp
  let pv = 0, curRev = rev
  for (let i = 1; i <= yrs; i++) { curRev *= 1 + gr / 100; pv += (curRev * (ebm / 100) * 0.6) / Math.pow(1 + wacc / 100, i) }
  const termPV = ((curRev * (ebm / 100) * 0.6 * (1 + tgr / 100)) / ((wacc - tgr) / 100)) / Math.pow(1 + wacc / 100, yrs)
  const evBase = pv + termPV, synPV = (rs * 0.3 + cs) * 7 - ic, evSyn = evBase + synPV
  const equity = evBase - debt, eqSyn = evSyn - debt, ebitda = rev * (ebm / 100)
  return { evBase, evSyn, equity, eqSyn, synPV, termPV, pv, ebitda, eveb: ebitda > 0 ? evBase / ebitda : 0, evebSyn: ebitda > 0 ? evSyn / ebitda : 0, bidLow: evBase * 0.9, bidHigh: evSyn * 0.95, walkAway: evSyn * 1.1 }
}

type TabId = 'is' | 'bs' | 'cf' | 'mkt'

const INPUT_FIELDS_IS: Array<{ id: keyof FSAInputs; label: string }> = [
  { id: 'revenue', label: 'Revenue ₹Cr' },
  { id: 'cogs', label: 'COGS ₹Cr' },
  { id: 'grossProfit', label: 'Gross Profit ₹Cr' },
  { id: 'ebitda', label: 'EBITDA ₹Cr' },
  { id: 'da', label: 'D&A ₹Cr' },
  { id: 'ebit', label: 'EBIT ₹Cr' },
  { id: 'interestExpense', label: 'Interest Expense ₹Cr' },
  { id: 'ebt', label: 'EBT (Pretax) ₹Cr' },
  { id: 'taxExpense', label: 'Tax Expense ₹Cr' },
  { id: 'netIncome', label: 'Net Income ₹Cr' },
  { id: 'operatingExpenses', label: 'Operating Expenses ₹Cr' },
  { id: 'leasePayments', label: 'Lease Payments ₹Cr' },
]

const INPUT_FIELDS_BS: Array<{ id: keyof FSAInputs; label: string }> = [
  { id: 'cash', label: 'Cash ₹Cr' },
  { id: 'receivablesEnd', label: 'Receivables (end) ₹Cr' },
  { id: 'receivablesBegin', label: 'Receivables (begin) ₹Cr' },
  { id: 'inventoryEnd', label: 'Inventory (end) ₹Cr' },
  { id: 'inventoryBegin', label: 'Inventory (begin) ₹Cr' },
  { id: 'payablesEnd', label: 'Payables (end) ₹Cr' },
  { id: 'payablesBegin', label: 'Payables (begin) ₹Cr' },
  { id: 'currentAssets', label: 'Current Assets ₹Cr' },
  { id: 'currentLiabilities', label: 'Current Liabilities ₹Cr' },
  { id: 'totalAssetsEnd', label: 'Total Assets (end) ₹Cr' },
  { id: 'totalAssetsBegin', label: 'Total Assets (begin) ₹Cr' },
  { id: 'totalEquityEnd', label: 'Total Equity (end) ₹Cr' },
  { id: 'totalEquityBegin', label: 'Total Equity (begin) ₹Cr' },
  { id: 'totalDebt', label: 'Total Debt ₹Cr' },
  { id: 'grossPPE', label: 'Gross PP&E ₹Cr' },
  { id: 'accumulatedDepreciation', label: 'Accumulated Depr ₹Cr' },
  { id: 'investedCapitalBegin', label: 'Invested Capital (begin)' },
  { id: 'investedCapitalEnd', label: 'Invested Capital (end)' },
]

const INPUT_FIELDS_CF: Array<{ id: keyof FSAInputs; label: string }> = [
  { id: 'cfo', label: 'CFO ₹Cr' },
  { id: 'cfi', label: 'CFI ₹Cr' },
  { id: 'cff', label: 'CFF ₹Cr' },
  { id: 'capex', label: 'CapEx ₹Cr' },
  { id: 'taxRate', label: 'Tax Rate (as fraction 0.25)' },
]

const INPUT_FIELDS_MKT: Array<{ id: keyof FSAInputs; label: string }> = [
  { id: 'pricePerShare', label: 'Price per Share ₹' },
  { id: 'sharesOutstanding', label: 'Shares Outstanding (Cr)' },
  { id: 'eps', label: 'EPS ₹' },
  { id: 'bvps', label: 'Book Value per Share ₹' },
  { id: 'epsGrowthRate', label: 'EPS Growth Rate %' },
]

function fmtNumber(n: number | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-IN', { maximumFractionDigits: digits })
}

function fmtPct(n: number | undefined | null, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toFixed(digits) + '%'
}

export default function FSAPage() {
  const [selected, setSelected] = useState<string>('')
  const [inputs, setInputs] = useState<Partial<FSAInputs>>({})
  const [provenance, setProvenance] = useState<
    Partial<Record<keyof FSAInputs, 'db' | 'api' | 'derived'>>
  >({})
  const [gaps, setGaps] = useState<InputsGap[]>([])
  const [completeness, setCompleteness] = useState(0)
  const [tab, setTab] = useState<TabId>('is')
  const [result, setResult] = useState<FSAResult | null>(null)
  const [apiLoading, setApiLoading] = useState(false)
  const [apiError, setApiError] = useState<string | null>(null)
  const [docs, setDocs] = useState<DocRecord[]>([])
  const [toast, setToast] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showFsaPanel, setShowFsaPanel] = useState(false)
  const { showWorking } = useWorkingPopup()

  // ── DCF Calculator state (merged from /dcf page) ──
  const [dcfInputs, setDcfInputs] = useState<DCFInputs>({
    rev: 0, ebm: 12, gr: 20, wacc: 12, tgr: 4, yrs: 7, debt: 80, rs: 0, cs: 0, ic: 0,
  })
  const [dcfCompareList, setDcfCompareList] = useState<Array<{ name: string; inputs: DCFInputs; results: DCFResults }>>([])
  const dcfResults = useMemo(() => computeDCF(dcfInputs), [dcfInputs])

  // Annual-report periods parsed from the RapidAPI /stock response
  const [arPeriods, setArPeriods] = useState<AnnualPeriod[]>([])
  const [arSelectedIdx, setArSelectedIdx] = useState<number>(0)
  const [historicalCagr, setHistoricalCagr] = useState<number | null>(null)

  // Sorted company list — listed first by score, then private
  const listedOptions = useMemo(
    () => [...COMPANIES].sort((a, b) => b.acqs - a.acqs),
    []
  )
  const privateOptions = useMemo(
    () => [...PRIVATE_COMPANIES].sort((a, b) => b.acqs - a.acqs),
    []
  )

  const selectedCompany: Company | null = useMemo(() => {
    if (!selected || selected.startsWith('P:')) return null
    return COMPANIES.find((c) => c.ticker === selected) || null
  }, [selected])

  // When company changes: pull local DB values, refresh docs, try API
  useEffect(() => {
    if (!selected) {
      setInputs({})
      setProvenance({})
      setGaps([])
      setCompleteness(0)
      setResult(null)
      setDocs([])
      setApiError(null)
      setArPeriods([])
      setArSelectedIdx(0)
      return
    }
    const co = selectedCompany
    if (co) {
      const dbResult = fromCompany(co)
      setInputs(dbResult.inputs)
      setProvenance(dbResult.provenance)
      setGaps(dbResult.gaps)
      setCompleteness(dbResult.completeness)
      setDocs(listDocs(co.ticker).docs)
      setArPeriods([])
      setArSelectedIdx(0)

      // Fetch data: Screener first (free) → RapidAPI fallback → Estimate remaining gaps
      setApiLoading(true)
      setApiError(null)

      const fetchAllData = async () => {
        let current = dbResult as import('@/lib/fsa/data-source').DataSourceResult

        // ── Tier 2: Screener.in ──
        try {
          const screenerResp = await fetch('/api/data/screener-fill', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tickers: [co.ticker], multiYear: true }),
          })
          if (screenerResp.ok) {
            const data = await screenerResp.json()
            const row = data?.data?.[co.ticker]
            if (row && row.salesCr) {
              current = fromScreenerRow(row, current)
            }
          }
        } catch { /* continue to RapidAPI */ }

        // ── Tier 3: RapidAPI ──
        try {
          const apiName = tickerToApiName(co.ticker, co.name)
          const res = await stockQuote(apiName)
          if (res.ok) {
            const profile = (res.data as StockProfile) || null
            current = fromStockProfile(profile, current)

            // Parse multi-year annual-report data
            if (profile && Array.isArray(profile.financials)) {
              const parsed = enrichWithPriorYearBalances(
                parseAnnualReportFinancials(profile.financials as RawFinancialEntry[])
              )
              setArPeriods(parsed)
              setArSelectedIdx(0)
              // Compute historical revenue CAGR from annual periods
              if (parsed.length >= 2) {
                const newest = parsed[0]?.inputs?.revenue
                const oldest = parsed[parsed.length - 1]?.inputs?.revenue
                if (newest && oldest && oldest > 0) {
                  const years = parsed.length - 1
                  const cagr = (Math.pow(newest / oldest, 1 / years) - 1) * 100
                  if (isFinite(cagr) && cagr > 0) setHistoricalCagr(Math.round(cagr * 10) / 10)
                }
              }
            }
          } else {
            setApiError(res.error || 'Live API fetch failed')
          }
        } catch (err) {
          setApiError(err instanceof Error ? err.message : String(err))
        }

        // ── Estimate remaining gaps from available data ──
        const estimated = estimateMissingInputs(current.inputs, current.provenance)
        const finalResult = {
          inputs: estimated.inputs,
          provenance: estimated.provenance,
          gaps: current.gaps.filter(g => {
            const val = estimated.inputs[g.field]
            return val == null || (typeof val === 'number' && (!Number.isFinite(val) || val === 0))
          }),
          completeness: 0,
        }
        // Recount completeness
        let filled = 0
        const critFields: Array<keyof import('@/lib/fsa/types').FSAInputs> = ['revenue','cogs','grossProfit','ebitda','ebit','da','interestExpense','ebt','taxExpense','netIncome','cash','receivablesEnd','inventoryEnd','currentAssets','currentLiabilities','totalAssetsEnd','totalEquityEnd','totalDebt','cfo','capex','pricePerShare','sharesOutstanding','eps']
        for (const f of critFields) {
          const val = estimated.inputs[f]
          if (val != null && typeof val === 'number' && Number.isFinite(val) && val !== 0) filled++
        }
        finalResult.completeness = filled / critFields.length

        setInputs(finalResult.inputs)
        setProvenance(finalResult.provenance)
        setGaps(finalResult.gaps)
        setCompleteness(finalResult.completeness)
        setApiLoading(false)
      }

      fetchAllData()

      // Auto-populate DCF inputs from company data
      // Growth rate: use historical CAGR if available, else trailing revg
      const debt = co.dbt_eq ? Math.round((co.mktcap * co.dbt_eq) / (1 + co.dbt_eq)) : 80
      const growthRate = historicalCagr ?? co.revg ?? 20
      setDcfInputs({
        rev: co.rev || 0, ebm: co.ebm || 12, gr: growthRate,
        wacc: co.sec === 'solar' ? 11.5 : 12, tgr: 4, yrs: 7, debt,
        rs: Math.round((co.rev || 0) * 0.05), cs: Math.round((co.rev || 0) * 0.03), ic: Math.round((co.rev || 0) * 0.04),
      })
    } else if (selected.startsWith('P:')) {
      // Private company — only db fallback
      const key = selected.slice(2)
      const pc = PRIVATE_COMPANIES.find((p) => p.name === key)
      if (pc) {
        setInputs({
          revenue: pc.rev_est,
          ebitda: pc.rev_est * (pc.ebm_est || 12) / 100,
          taxRate: 0.25,
          epsGrowthRate: pc.revg_est,
        })
        setProvenance({
          revenue: 'db',
          ebitda: 'derived',
          taxRate: 'derived',
          epsGrowthRate: 'db',
        })
      }
      setApiError('Private company — live API unavailable, upload statements or enter manually')
      setDocs(listDocs(key).docs)
    }
  }, [selected, selectedCompany])

  // Update DCF growth rate when historical CAGR becomes available (async)
  useEffect(() => {
    if (historicalCagr && historicalCagr > 0 && dcfInputs.rev > 0) {
      setDcfInputs(prev => ({ ...prev, gr: historicalCagr }))
    }
  }, [historicalCagr]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live field edit — merges into existing state
  const setField = (field: keyof FSAInputs, raw: string) => {
    const trimmed = raw.trim()
    setInputs((prev) => {
      const next = { ...prev }
      if (trimmed === '') {
        delete next[field]
      } else {
        const n = parseFloat(trimmed)
        if (Number.isFinite(n)) {
          ;(next as Record<string, unknown>)[field] = n
        }
      }
      return next
    })
    setProvenance((prev) => ({ ...prev, [field]: 'api' })) // user edit wins
  }

  const runAnalysis = () => {
    if (!inputs.revenue || inputs.revenue === 0) {
      setToast('Revenue is required to run the analysis')
      setTimeout(() => setToast(null), 2500)
      return
    }
    const name =
      selectedCompany?.name ||
      (selected.startsWith('P:') ? selected.slice(2) : 'Company')
    const r = runFullFinancialAnalysis(name, inputs as FSAInputs)
    setResult(r)
  }

  const clearAll = () => {
    setInputs({})
    setProvenance({})
    setResult(null)
    setGaps([])
    setCompleteness(0)
  }

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const loadFromAnnualReport = () => {
    const period = arPeriods[arSelectedIdx]
    if (!period) {
      showToast('No annual report period available')
      return
    }
    // Overlay period values on top of existing inputs — API takes
    // precedence over DB / derived values, but user edits stay.
    setInputs((prev) => {
      const next = { ...prev }
      for (const [k, v] of Object.entries(period.inputs)) {
        if (v != null && Number.isFinite(v)) {
          ;(next as Record<string, unknown>)[k] = v
        }
      }
      return next
    })
    setProvenance((prev) => {
      const next = { ...prev }
      for (const k of Object.keys(period.inputs)) {
        ;(next as Record<string, 'api'>)[k] = 'api'
      }
      return next
    })
    // Refresh completeness + gaps against the merged state
    const filledCount = Object.keys({ ...inputs, ...period.inputs }).length
    setCompleteness(Math.min(1, filledCount / 23))
    showToast(
      `Loaded ${period.label} · ${period.lineItemCount} line items from annual report`
    )
  }

  const onUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    const tickerKey = selected.startsWith('P:')
      ? selected.slice(2)
      : selectedCompany?.ticker
    if (!tickerKey) {
      showToast('Select a company before uploading documents')
      return
    }
    for (const f of Array.from(files)) {
      const res = await addDoc(tickerKey, f)
      if (!res.ok) {
        showToast(res.error || 'Upload failed')
        return
      }
    }
    setDocs(listDocs(tickerKey).docs)
    showToast(`Uploaded ${files.length} file${files.length === 1 ? '' : 's'}`)
  }

  const onRemoveDoc = (docId: string) => {
    const tickerKey = selected.startsWith('P:')
      ? selected.slice(2)
      : selectedCompany?.ticker
    if (!tickerKey) return
    removeDoc(tickerKey, docId)
    setDocs(listDocs(tickerKey).docs)
  }

  const onClearDocs = () => {
    const tickerKey = selected.startsWith('P:')
      ? selected.slice(2)
      : selectedCompany?.ticker
    if (!tickerKey) return
    if (!confirm('Delete all uploaded documents for this company? This cannot be undone.')) return
    clearDocs(tickerKey)
    setDocs([])
  }

  return (
    <div>
      <div className="phdr">
        <div className="phdr-breadcrumb">
          <span className="dn-wordmark">Deal<em>Nector</em></span> › Strategic Financial Analysis
        </div>
        <div className="phdr-title">
          📊 Strategic Financial <em>Analysis Engine</em>
        </div>
        <div className="phdr-meta">
          <Badge variant="gold">15 Modules · 60+ Algorithms</Badge>
          <Badge variant="gray">Strategic Financial Analysis Framework</Badge>
          <Badge variant="green">Activity · Liquidity · Solvency · Profitability · DuPont</Badge>
        </div>
      </div>

      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: 'var(--cyandim)',
            border: '1px solid var(--cyan2)',
            color: 'var(--cyan2)',
            padding: '10px 16px',
            borderRadius: 6,
            fontSize: 13,
            zIndex: 9000,
          }}
        >
          {toast}
        </div>
      )}

      <div className="panel">
        {/* Company picker + completeness */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 14,
          }}
        >
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            style={{
              flex: 1,
              minWidth: 220,
              background: 'var(--s3)',
              border: '1px solid var(--br)',
              color: 'var(--txt)',
              padding: '8px 12px',
              borderRadius: 4,
              fontSize: 13,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          >
            <option value="">— Select company to begin —</option>
            <optgroup label="Listed Companies">
              {listedOptions.map((c) => (
                <option key={c.ticker} value={c.ticker}>
                  {c.name} ({c.ticker})
                </option>
              ))}
            </optgroup>
            <optgroup label="Private Companies">
              {privateOptions.map((c) => (
                <option key={'P:' + c.name} value={'P:' + c.name}>
                  {c.name} [{c.stage}]
                </option>
              ))}
            </optgroup>
          </select>
          <button
            onClick={runAnalysis}
            disabled={!inputs.revenue}
            style={{
              background: inputs.revenue ? 'var(--green)' : 'var(--s3)',
              color: inputs.revenue ? '#000' : 'var(--txt3)',
              border: '1px solid ' + (inputs.revenue ? 'var(--green)' : 'var(--br)'),
              padding: '8px 16px',
              borderRadius: 4,
              cursor: inputs.revenue ? 'pointer' : 'not-allowed',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
              fontFamily: 'inherit',
            }}
          >
            ▶ Run Analysis
          </button>
          <button
            onClick={clearAll}
            style={{
              background: 'var(--s3)',
              color: 'var(--txt2)',
              border: '1px solid var(--br)',
              padding: '8px 14px',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              fontFamily: 'inherit',
            }}
          >
            ✕ Clear
          </button>
          {selected && !selected.startsWith('P:') && (
            <button
              onClick={() => setShowFsaPanel(true)}
              style={{
                background: 'rgba(74,144,217,0.1)',
                color: 'var(--cyan)',
                border: '1px solid rgba(74,144,217,0.3)',
                padding: '8px 14px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.3px',
                textTransform: 'uppercase',
                fontFamily: 'inherit',
              }}
            >
              📊 Intelligence Panel
            </button>
          )}
        </div>

        {/* Data source status strip */}
        {selected && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap',
              padding: '10px 14px',
              background: 'var(--s1)',
              border: '1px solid var(--br)',
              borderRadius: 4,
              marginBottom: 14,
              fontSize: 11,
            }}
          >
            <span style={{ color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '0.8px', fontWeight: 700 }}>
              Data sources
            </span>
            <span style={{ color: completeness > 0.6 ? 'var(--green)' : completeness > 0.3 ? 'var(--gold2)' : 'var(--orange)', fontFamily: 'JetBrains Mono, monospace' }}>
              {(completeness * 100).toFixed(0)}% auto-filled
            </span>
            {apiLoading && <span style={{ color: 'var(--cyan2)', fontStyle: 'italic' }}>loading live API…</span>}
            {apiError && <span style={{ color: 'var(--orange)' }} title={apiError}>API: {apiError.slice(0, 60)}</span>}
            {!apiError && !apiLoading && Object.values(provenance).includes('api') && (
              <span style={{ color: 'var(--green)' }}>✓ NSE/BSE live feed merged</span>
            )}
            <span style={{ marginLeft: 'auto', color: 'var(--txt3)' }}>
              {gaps.length} missing critical field{gaps.length === 1 ? '' : 's'}
            </span>
          </div>
        )}

        {/* Missing-fields hint + upload zone */}
        {selected && gaps.length > 0 && (
          <div
            style={{
              padding: '12px 14px',
              background: 'var(--orangedim, rgba(245,158,11,0.08))',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 4,
              marginBottom: 14,
              fontSize: 12,
              color: 'var(--txt2)',
              lineHeight: 1.6,
            }}
          >
            <div style={{ fontWeight: 700, color: 'var(--orange)', marginBottom: 6 }}>
              ⚠ {gaps.length} fields need data
            </div>
            <div>
              Either type values in the tabs below, or upload the company's latest annual report /
              financials document and reference the figures from there. Missing fields:{' '}
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--txt3)' }}>
                {gaps.slice(0, 8).map((g) => g.label).join(' · ')}
                {gaps.length > 8 && ` · +${gaps.length - 8} more`}
              </span>
            </div>
          </div>
        )}

        {/* Annual Report periods (from NSE/BSE /stock.financials) */}
        {selected && arPeriods.length > 0 && (
          <div
            style={{
              padding: '12px 14px',
              background: 'linear-gradient(135deg, var(--golddim), transparent)',
              border: '1px solid var(--gold2)',
              borderRadius: 4,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10,
                marginBottom: 10,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>
                  📑 Annual Report — {arPeriods.length} periods found
                </div>
                <div style={{ fontSize: 10, color: 'var(--txt3)' }}>
                  Parsed from audited filings via the NSE/BSE financials feed. Pick a period and
                  click Load to populate every field at once.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={arSelectedIdx}
                  onChange={(e) => setArSelectedIdx(parseInt(e.target.value, 10))}
                  style={{
                    background: 'var(--s3)',
                    border: '1px solid var(--br)',
                    color: 'var(--txt)',
                    padding: '6px 10px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontFamily: 'inherit',
                    outline: 'none',
                    cursor: 'pointer',
                    minWidth: 180,
                  }}
                >
                  {arPeriods.map((p, i) => (
                    <option key={i} value={i}>
                      {p.label} ({p.lineItemCount} items · end {p.endDate})
                    </option>
                  ))}
                </select>
                <button
                  onClick={loadFromAnnualReport}
                  style={{
                    background: 'var(--gold2)',
                    border: '1px solid var(--gold2)',
                    color: '#000',
                    padding: '6px 14px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.3px',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  ↓ Load into form
                </button>
              </div>
            </div>
            {/* Preview chips for the selected period */}
            {(() => {
              const p = arPeriods[arSelectedIdx]
              if (!p) return null
              const chip = (lbl: string, val: number | undefined) => {
                if (val == null) return null
                return (
                  <span
                    key={lbl}
                    style={{
                      display: 'inline-flex',
                      gap: 4,
                      alignItems: 'baseline',
                      background: 'var(--s1)',
                      border: '1px solid var(--br)',
                      borderRadius: 3,
                      padding: '3px 8px',
                      fontSize: 10,
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    <span style={{ color: 'var(--txt3)' }}>{lbl}</span>
                    <span style={{ color: 'var(--txt)', fontWeight: 600 }}>
                      ₹{fmtNumber(val, 0)}
                    </span>
                  </span>
                )
              }
              return (
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  {chip('Revenue', p.inputs.revenue)}
                  {chip('EBIT', p.inputs.ebit)}
                  {chip('Net Inc', p.inputs.netIncome)}
                  {chip('Total Assets', p.inputs.totalAssetsEnd)}
                  {chip('Equity', p.inputs.totalEquityEnd)}
                  {chip('Debt', p.inputs.totalDebt)}
                  {chip('CFO', p.inputs.cfo)}
                  {chip('CapEx', p.inputs.capex)}
                </div>
              )
            })()}
          </div>
        )}

        {/* Upload zone */}
        {selected && (
          <div
            style={{
              padding: '12px 14px',
              background: 'var(--s1)',
              border: '1px dashed var(--br2)',
              borderRadius: 4,
              marginBottom: 14,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 10,
                marginBottom: docs.length > 0 ? 10 : 0,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', marginBottom: 2 }}>
                  📎 Upload financial statements
                </div>
                <div style={{ fontSize: 10, color: 'var(--txt3)' }}>
                  PDF, XLSX, XLS, CSV · Max {(UPLOAD_LIMITS.maxFileBytes / 1024 / 1024).toFixed(0)} MB per file ·
                  stored on this device only · cloud tier coming soon
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    background: 'var(--golddim)',
                    border: '1px solid var(--gold2)',
                    color: 'var(--gold2)',
                    padding: '6px 12px',
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  + Add Document
                </button>
                {docs.length > 0 && (
                  <button
                    onClick={onClearDocs}
                    style={{
                      background: 'transparent',
                      border: '1px solid var(--red)',
                      color: 'var(--red)',
                      padding: '6px 12px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    Clear all
                  </button>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf,.xlsx,.xls,.csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                onChange={(e) => {
                  onUpload(e.target.files)
                  if (e.target) e.target.value = ''
                }}
                style={{ display: 'none' }}
              />
            </div>
            {docs.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {docs.map((d) => (
                  <div
                    key={d.id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'var(--s3)',
                      border: '1px solid var(--br)',
                      borderRadius: 4,
                      padding: '4px 10px',
                      fontSize: 11,
                      color: 'var(--txt2)',
                    }}
                  >
                    <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                      {d.kind.toUpperCase()}
                    </span>
                    <span>·</span>
                    <span style={{ color: 'var(--txt)', fontWeight: 500, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.name}>
                      {d.name}
                    </span>
                    <span style={{ color: 'var(--txt3)', fontFamily: 'JetBrains Mono, monospace' }}>
                      {(d.sizeBytes / 1024).toFixed(0)}kb
                    </span>
                    <button
                      onClick={() => downloadDoc(d)}
                      title="Download"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--txt3)',
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: 0,
                      }}
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => onRemoveDoc(d.id)}
                      title="Remove"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--red)',
                        cursor: 'pointer',
                        fontSize: 12,
                        padding: 0,
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Input tabs */}
        {selected && (
          <div
            style={{
              background: 'var(--s1)',
              border: '1px solid var(--br)',
              borderRadius: 4,
              marginBottom: 14,
              overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', borderBottom: '1px solid var(--br)' }}>
              {(
                [
                  ['is', 'Income Statement'],
                  ['bs', 'Balance Sheet'],
                  ['cf', 'Cash Flow'],
                  ['mkt', 'Market Data'],
                ] as Array<[TabId, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  style={{
                    flex: 1,
                    background: tab === id ? 'var(--s2)' : 'transparent',
                    border: 'none',
                    borderRight: '1px solid var(--br)',
                    borderBottom: tab === id ? '2px solid var(--gold2)' : '2px solid transparent',
                    color: tab === id ? 'var(--gold2)' : 'var(--txt2)',
                    padding: '9px 10px',
                    fontSize: 11,
                    fontWeight: tab === id ? 700 : 500,
                    letterSpacing: '0.3px',
                    cursor: 'pointer',
                    textTransform: 'uppercase',
                    fontFamily: 'inherit',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ padding: 14 }}>
              <InputGrid
                fields={
                  tab === 'is'
                    ? INPUT_FIELDS_IS
                    : tab === 'bs'
                      ? INPUT_FIELDS_BS
                      : tab === 'cf'
                        ? INPUT_FIELDS_CF
                        : INPUT_FIELDS_MKT
                }
                inputs={inputs}
                provenance={provenance}
                onChange={setField}
              />
            </div>
          </div>
        )}

        {/* Output */}
        {result && <FSAOutput r={result} />}
      </div>

      {/* ════════════════════════════════════════════════════════════
         DCF & VALUATION SECTION (merged from /dcf page)
         ════════════════════════════════════════════════════════════ */}
      {selected && dcfInputs.rev > 0 && (
        <div style={{ marginTop: 24, borderTop: '3px solid var(--gold2)', paddingTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--txt)', fontFamily: "'Source Serif 4', Georgia, serif" }}>
              DCF &amp; Valuation <em style={{ color: 'var(--gold2)' }}>Calculator</em>
            </span>
            <Badge variant="gold">Customisable</Badge>
            <span style={{ fontSize: 10, color: 'var(--txt3)', marginLeft: 'auto' }}>
              Assumptions saved to report automatically
            </span>
          </div>

          {/* DCF Input Fields — 2-column grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, marginBottom: 16 }}>
            {([
              { key: 'rev', label: 'Revenue ₹Cr', step: 10 },
              { key: 'ebm', label: 'EBITDA Margin %', step: 0.5 },
              { key: 'gr', label: 'Revenue Growth %', step: 0.5 },
              { key: 'wacc', label: 'WACC %', step: 0.25 },
              { key: 'tgr', label: 'Terminal Growth %', step: 0.25 },
              { key: 'yrs', label: 'Forecast Years', step: 1 },
              { key: 'debt', label: 'Net Debt ₹Cr', step: 10 },
              { key: 'rs', label: 'Rev Synergy ₹Cr', step: 5 },
              { key: 'cs', label: 'Cost Synergy ₹Cr', step: 5 },
              { key: 'ic', label: 'Integration Cost ₹Cr', step: 5 },
            ] as Array<{ key: keyof DCFInputs; label: string; step: number }>).map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 10, color: 'var(--txt3)', display: 'block', marginBottom: 2 }}>{f.label}</label>
                <input
                  type="number"
                  value={dcfInputs[f.key]}
                  step={f.step}
                  onChange={e => {
                    const v = parseFloat(e.target.value) || 0
                    setDcfInputs(prev => ({ ...prev, [f.key]: v }))
                  }}
                  onBlur={() => {
                    // Save to localStorage for report to pick up
                    localStorage.setItem(`dcf_inputs_${selectedCompany?.ticker || selected}`, JSON.stringify(dcfInputs))
                  }}
                  style={{
                    width: '100%', background: 'var(--s3)', border: '1px solid var(--br)',
                    color: 'var(--txt)', padding: '6px 8px', borderRadius: 4, fontSize: 13,
                    fontFamily: "'JetBrains Mono', monospace", outline: 'none',
                  }}
                />
              </div>
            ))}
          </div>

          {/* DCF Results */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10, marginBottom: 16 }}>
            {[
              { label: 'Enterprise Value (Base)', value: `₹${Math.round(dcfResults.evBase).toLocaleString('en-IN')} Cr`, color: 'var(--gold2)', click: () => showWorking(wkDCFOutput({ name: selectedCompany?.name || 'Target', rev: dcfInputs.rev, ebm: dcfInputs.ebm, gr: dcfInputs.gr, wacc: dcfInputs.wacc, tgr: dcfInputs.tgr, yrs: dcfInputs.yrs, debt: dcfInputs.debt, rs: dcfInputs.rs, cs: dcfInputs.cs, ic: dcfInputs.ic, evBase: dcfResults.evBase, evSyn: dcfResults.evSyn, termPV: dcfResults.termPV, pv: dcfResults.pv, synPV: dcfResults.synPV })) },
              { label: 'Equity Value (Base)', value: `₹${Math.round(dcfResults.equity).toLocaleString('en-IN')} Cr`, color: 'var(--green)', click: null },
              { label: 'EV with Synergies', value: `₹${Math.round(dcfResults.evSyn).toLocaleString('en-IN')} Cr`, color: 'var(--cyan)', click: () => showWorking(wkSynergyNPV(dcfInputs.rs, dcfInputs.cs, dcfInputs.ic)) },
              { label: 'Equity with Synergies', value: `₹${Math.round(dcfResults.eqSyn).toLocaleString('en-IN')} Cr`, color: 'var(--green)', click: null },
              { label: 'Implied EV/EBITDA', value: `${dcfResults.eveb.toFixed(1)}×`, color: 'var(--txt)', click: null },
              { label: 'Terminal Value PV', value: `₹${Math.round(dcfResults.termPV).toLocaleString('en-IN')} Cr`, color: 'var(--txt2)', click: () => showWorking(wkTerminalValue(dcfInputs.tgr, dcfInputs.wacc, dcfInputs.yrs)) },
              { label: 'Bid Range (Low)', value: `₹${Math.round(dcfResults.bidLow).toLocaleString('en-IN')} Cr`, color: 'var(--gold2)', click: null },
              { label: 'Bid Range (High)', value: `₹${Math.round(dcfResults.bidHigh).toLocaleString('en-IN')} Cr`, color: 'var(--gold2)', click: null },
              { label: 'Walk-Away Price', value: `₹${Math.round(dcfResults.walkAway).toLocaleString('en-IN')} Cr`, color: 'var(--red)', click: null },
            ].map(kpi => (
              <div
                key={kpi.label}
                onClick={kpi.click || undefined}
                title={kpi.click ? 'Click for detailed calculation' : undefined}
                style={{
                  background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6,
                  padding: '10px 12px', cursor: kpi.click ? 'pointer' : 'default',
                }}
              >
                <div style={{ fontSize: 9, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{kpi.label}</div>
                <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color: kpi.color }}>{kpi.value}</div>
              </div>
            ))}
          </div>

          {/* Valuation Comparison — Add current to compare list */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <button
              onClick={() => {
                const n = selectedCompany?.name || selected || 'Target'
                if (dcfCompareList.find(x => x.name === n) || dcfCompareList.length >= 5) return
                setDcfCompareList([...dcfCompareList, { name: n, inputs: { ...dcfInputs }, results: { ...dcfResults } }])
              }}
              style={{
                background: 'var(--golddim)', border: '1px solid var(--gold2)', color: 'var(--gold2)',
                padding: '6px 14px', borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer',
              }}
            >
              + Add to Comparison
            </button>
            {dcfCompareList.length > 0 && (
              <button onClick={() => setDcfCompareList([])} style={{
                background: 'var(--s3)', border: '1px solid var(--br)', color: 'var(--txt3)',
                padding: '6px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
              }}>
                Clear All
              </button>
            )}
            <span style={{ fontSize: 10, color: 'var(--txt3)' }}>{dcfCompareList.length}/5 in comparison</span>
          </div>

          {/* Valuation Comparison Table */}
          {dcfCompareList.length >= 1 && (
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--br2)' }}>
                    <th style={{ textAlign: 'left', padding: '8px 10px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Metric</th>
                    {dcfCompareList.map(c => (
                      <th key={c.name} style={{ textAlign: 'right', padding: '8px 10px', color: 'var(--gold2)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                        {c.name.slice(0, 15)}
                        <button onClick={() => setDcfCompareList(dcfCompareList.filter(x => x.name !== c.name))} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 10, marginLeft: 4 }}>✕</button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {([
                    { label: 'Revenue ₹Cr', get: (c: { inputs: DCFInputs }) => c.inputs.rev },
                    { label: 'EBITDA Margin %', get: (c: { inputs: DCFInputs }) => c.inputs.ebm },
                    { label: 'Revenue Growth %', get: (c: { inputs: DCFInputs }) => c.inputs.gr },
                    { label: 'WACC %', get: (c: { inputs: DCFInputs }) => c.inputs.wacc },
                    { label: 'Terminal Growth %', get: (c: { inputs: DCFInputs }) => c.inputs.tgr },
                    { label: 'EV (Base) ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.evBase), bold: true },
                    { label: 'Equity Value ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.equity), bold: true },
                    { label: 'EV with Synergies ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.evSyn) },
                    { label: 'Equity + Synergies ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.eqSyn) },
                    { label: 'Implied EV/EBITDA', get: (c: { results: DCFResults }) => c.results.eveb.toFixed(1) + '×' },
                    { label: 'Synergy NPV ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.synPV) },
                    { label: 'Bid Range Low ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.bidLow) },
                    { label: 'Bid Range High ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.bidHigh) },
                    { label: 'Walk-Away ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.walkAway) },
                  ] as Array<{ label: string; get: (c: { inputs: DCFInputs; results: DCFResults }) => number | string; bold?: boolean }>).map(m => (
                    <tr key={m.label} style={{ borderBottom: '1px solid var(--br)' }}>
                      <td style={{ padding: '6px 10px', color: 'var(--txt2)', fontWeight: m.bold ? 700 : 400 }}>{m.label}</td>
                      {dcfCompareList.map(c => {
                        const val = m.get(c)
                        return (
                          <td
                            key={c.name}
                            onClick={() => {
                              if (m.label.includes('EV (Base)') || m.label.includes('Equity Value')) {
                                showWorking(wkDCFOutput({ name: c.name, ...c.inputs, evBase: c.results.evBase, evSyn: c.results.evSyn, termPV: c.results.termPV, pv: c.results.pv, synPV: c.results.synPV }))
                              }
                            }}
                            title={m.label.includes('EV') || m.label.includes('Equity') ? 'Click for detailed calculation' : undefined}
                            style={{
                              padding: '6px 10px', textAlign: 'right',
                              fontFamily: "'JetBrains Mono', monospace", fontWeight: m.bold ? 700 : 500,
                              color: m.bold ? 'var(--gold2)' : 'var(--txt)',
                              cursor: m.label.includes('EV') || m.label.includes('Equity') ? 'pointer' : 'default',
                            }}
                          >
                            {typeof val === 'number' ? val.toLocaleString('en-IN') : val}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontSize: 10, color: 'var(--txt4)', padding: '6px 10px', background: 'var(--s2)', borderRadius: 4, border: '1px solid var(--br)' }}>
            DCF assumptions are saved automatically and used in the PDF report. Click any valuation number for detailed calculation working. Add multiple companies to compare valuations side by side.
          </div>
        </div>
      )}

      {/* FSA Intelligence Panel */}
      {showFsaPanel && selected && !selected.startsWith('P:') && (() => {
        const co = COMPANIES.find(c => c.ticker === selected)
        if (!co) return null
        return (
          <FSAIntelligencePanel
            company={co}
            peers={COMPANIES.filter(c => c.ticker !== co.ticker && (c.comp || []).some(s => (co.comp || []).includes(s))).slice(0, 5)}
            onClose={() => setShowFsaPanel(false)}
          />
        )
      })()}
    </div>
  )
}

// ── Input grid component ──

function InputGrid({
  fields,
  inputs,
  provenance,
  onChange,
}: {
  fields: Array<{ id: keyof FSAInputs; label: string }>
  inputs: Partial<FSAInputs>
  provenance: Partial<Record<keyof FSAInputs, 'db' | 'api' | 'derived'>>
  onChange: (field: keyof FSAInputs, raw: string) => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
        gap: 8,
      }}
    >
      {fields.map(({ id, label }) => {
        const raw = inputs[id]
        const value =
          typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : ''
        const src = provenance[id]
        const srcBadge =
          src === 'api'
            ? 'LIVE'
            : src === 'db'
              ? 'DB'
              : src === 'derived'
                ? 'EST'
                : null
        const srcColor =
          src === 'api'
            ? 'var(--green)'
            : src === 'db'
              ? 'var(--cyan2)'
              : src === 'derived'
                ? 'var(--gold2)'
                : 'var(--txt3)'
        return (
          <div key={id}>
            <div
              style={{
                fontSize: 9,
                color: 'var(--txt3)',
                letterSpacing: '0.6px',
                textTransform: 'uppercase',
                marginBottom: 3,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>{label}</span>
              {srcBadge && (
                <span
                  style={{
                    fontSize: 8,
                    color: srcColor,
                    border: `1px solid ${srcColor}`,
                    padding: '0 4px',
                    borderRadius: 2,
                    fontWeight: 700,
                  }}
                >
                  {srcBadge}
                </span>
              )}
            </div>
            <input
              type="number"
              value={value}
              placeholder="—"
              onChange={(e) => onChange(id, e.target.value)}
              style={{
                width: '100%',
                background: 'var(--s3)',
                border: '1px solid var(--br)',
                color: 'var(--txt)',
                padding: '6px 9px',
                borderRadius: 3,
                fontSize: 12,
                fontFamily: 'JetBrains Mono, monospace',
                outline: 'none',
              }}
            />
          </div>
        )
      })}
    </div>
  )
}

// ── Output renderer ──

function FSAOutput({ r }: { r: FSAResult }) {
  const s = r.summary
  const scoreColor =
    s.score >= 80
      ? 'var(--green)'
      : s.score >= 60
        ? 'var(--gold2)'
        : s.score >= 40
          ? 'var(--orange)'
          : 'var(--red)'

  const rat = (
    o: { value: number; unit?: string; pct?: number } | null | undefined,
    d = 2
  ): string => {
    if (!o || !Number.isFinite(o.value)) return '—'
    const v = fmtNumber(o.value, d)
    return o.unit && o.unit !== '%' ? `${v} ${o.unit}` : v
  }
  const pct = (o: { value: number } | null | undefined, d = 1): string =>
    fmtPct(o?.value, d)

  const Row = ({
    label,
    value,
    interp,
  }: {
    label: string
    value: string
    interp?: string | null
  }) => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        padding: '5px 0',
        borderBottom: '1px solid var(--br)',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--txt3)' }}>{label}</span>
      <span style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--txt)' }}>{value}</div>
        {interp && (
          <div
            style={{
              fontSize: 10,
              color: 'var(--txt3)',
              maxWidth: 220,
              lineHeight: 1.3,
              marginTop: 2,
            }}
          >
            {interp}
          </div>
        )}
      </span>
    </div>
  )

  const act = r.ratios.activity
  const liq = r.ratios.liquidity
  const solv = r.ratios.solvency
  const prof = r.ratios.profitability
  const dp = r.dupont
  const cf = r.cashflow
  const val = r.valuation

  return (
    <div>
      {/* Score banner */}
      <div
        style={{
          background: 'linear-gradient(135deg, var(--s2), var(--s3))',
          border: `1px solid ${scoreColor}`,
          borderRadius: 6,
          padding: '14px 16px',
          marginBottom: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            background: `${scoreColor}20`,
            border: `2px solid ${scoreColor}`,
            borderRadius: 6,
            width: 54,
            height: 54,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Source Serif 4, Georgia, serif',
            fontSize: 22,
            fontWeight: 800,
            color: scoreColor,
          }}
        >
          {s.score}
        </div>
        <div>
          <div
            style={{
              fontFamily: 'Source Serif 4, Georgia, serif',
              fontSize: 17,
              fontWeight: 700,
              color: 'var(--txt)',
            }}
          >
            {r.company} — {s.scoreBreakdown.grade}
          </div>
          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
            FSA score {s.score}/100 · Profitability {s.scoreBreakdown.breakdown.profitability}/25 ·
            Solvency {s.scoreBreakdown.breakdown.solvency}/20 · Liquidity{' '}
            {s.scoreBreakdown.breakdown.liquidity}/15 · Efficiency{' '}
            {s.scoreBreakdown.breakdown.efficiency}/20 · CF Quality{' '}
            {s.scoreBreakdown.breakdown.cashFlowQuality}/20
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {s.ebitdaMargin != null && (
            <KpiTile label="EBITDA Margin" value={s.ebitdaMargin.toFixed(1) + '%'} color="var(--gold2)" />
          )}
          {s.roe != null && (
            <KpiTile label="ROE (DuPont)" value={s.roe.toFixed(1) + '%'} color="var(--green)" />
          )}
          {s.debtToEBITDA != null && (
            <KpiTile label="Debt/EBITDA" value={s.debtToEBITDA.toFixed(1) + '×'} color="var(--cyan2)" />
          )}
        </div>
      </div>

      {/* Ratio tables */}
      <div className="g2" style={{ gap: 10, marginBottom: 10 }}>
        <div className="card">
          <div className="card-title">⚙ Activity Ratios</div>
          <Row label="Inventory Turnover" value={rat(act.inventoryTurnover)} />
          <Row label="Days Inventory (DOH)" value={rat(act.daysInventoryOnHand, 0)} />
          <Row label="Receivables Turnover" value={rat(act.receivablesTurnover)} />
          <Row label="Days Sales Outstanding" value={rat(act.daysSalesOutstanding, 0)} />
          <Row label="Payables Turnover" value={rat(act.payablesTurnover)} />
          <Row label="Days Payables" value={rat(act.daysPayables, 0)} />
          <Row
            label="Cash Conversion Cycle"
            value={rat(act.cashConversionCycle, 0)}
            interp={act.cashConversionCycle?.interpretation}
          />
          <Row label="Fixed Asset Turnover" value={rat(act.fixedAssetTurnover)} />
          <Row label="Total Asset Turnover" value={rat(act.totalAssetTurnover)} />
        </div>

        <div className="card">
          <div className="card-title">💧 Liquidity Ratios</div>
          <Row
            label="Current Ratio"
            value={rat(liq.currentRatio)}
            interp={liq.currentRatio?.interpretation}
          />
          <Row
            label="Quick Ratio"
            value={rat(liq.quickRatio)}
            interp={liq.quickRatio?.interpretation}
          />
          <Row label="Cash Ratio" value={rat(liq.cashRatio)} />
          <Row
            label="Defensive Interval"
            value={rat(liq.defensiveIntervalRatio, 0)}
            interp={liq.defensiveIntervalRatio?.interpretation}
          />
          <Row label="Cash Conversion Cycle" value={rat(liq.cashConversionCycle, 0)} />
        </div>

        <div className="card">
          <div className="card-title">🏦 Solvency Ratios</div>
          <Row
            label="Debt-to-Assets"
            value={solv.debtToAssets ? solv.debtToAssets.pct!.toFixed(1) + '%' : '—'}
            interp={solv.debtToAssets?.interpretation}
          />
          <Row
            label="Debt-to-Capital"
            value={solv.debtToCapital ? solv.debtToCapital.pct!.toFixed(1) + '%' : '—'}
          />
          <Row
            label="Debt-to-Equity"
            value={rat(solv.debtToEquity)}
            interp={solv.debtToEquity?.interpretation}
          />
          <Row label="Financial Leverage" value={rat(solv.financialLeverage)} />
          <Row
            label="Debt / EBITDA"
            value={rat(solv.debtToEBITDA)}
            interp={solv.debtToEBITDA?.interpretation}
          />
          <Row
            label="Interest Coverage"
            value={rat(solv.interestCoverage)}
            interp={solv.interestCoverage?.interpretation}
          />
          <Row label="Fixed Charge Coverage" value={rat(solv.fixedChargeCoverage)} />
          <Row
            label="Net Debt"
            value={
              Number.isFinite(solv.netDebt)
                ? '₹' + fmtNumber(solv.netDebt, 0) + 'Cr'
                : '—'
            }
          />
        </div>

        <div className="card">
          <div className="card-title">📈 Profitability Ratios</div>
          <Row
            label="Gross Margin"
            value={pct(prof.grossMargin)}
            interp={prof.grossMargin?.interpretation}
          />
          <Row label="Operating Margin" value={pct(prof.operatingMargin)} />
          <Row label="EBITDA Margin" value={pct(prof.ebitdaMargin)} />
          <Row label="Pretax Margin" value={pct(prof.pretaxMargin)} />
          <Row
            label="Net Profit Margin"
            value={pct(prof.netProfitMargin)}
            interp={prof.netProfitMargin?.interpretation}
          />
          <Row label="ROA" value={pct(prof.roa)} />
          <Row label="Operating ROA" value={pct(prof.operatingROA)} />
          <Row label="ROE" value={pct(prof.roe)} interp={prof.roe?.interpretation} />
          <Row label="ROIC" value={pct(prof.roic)} interp={prof.roic?.note} />
        </div>
      </div>

      {/* DuPont */}
      <div className="card" style={{ marginBottom: 10 }}>
        <div className="card-title">
          🔬 DuPont 5-Way ROE Decomposition
          <span style={{ fontSize: 10, color: 'var(--txt3)', fontWeight: 400, marginLeft: 6 }}>
            ROE = Tax Burden × Interest Burden × EBIT Margin × Asset Turnover × Leverage
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            flexWrap: 'wrap',
            marginBottom: 10,
          }}
        >
          {Object.entries(dp.components).map(([k, c], i, arr) => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div
                style={{
                  background: 'var(--s2)',
                  border: '1px solid var(--br)',
                  borderRadius: 4,
                  padding: '8px 11px',
                  textAlign: 'center',
                  minWidth: 90,
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    fontFamily: 'JetBrains Mono, monospace',
                    color: 'var(--gold2)',
                  }}
                >
                  {typeof c.value === 'number'
                    ? c.value > 1
                      ? c.value.toFixed(2)
                      : (c.value * 100).toFixed(2) + '%'
                    : c.value}
                </div>
                <div style={{ fontSize: 9, color: 'var(--txt3)', marginTop: 2 }}>{c.label}</div>
              </div>
              {i < arr.length - 1 && <span style={{ fontSize: 14, color: 'var(--txt3)' }}>×</span>}
            </div>
          ))}
          <span style={{ fontSize: 14, color: 'var(--txt3)' }}>=</span>
          <div
            style={{
              background: 'var(--golddim)',
              border: '1px solid var(--gold2)',
              borderRadius: 4,
              padding: '8px 13px',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontSize: 17,
                fontWeight: 800,
                fontFamily: 'JetBrains Mono, monospace',
                color: 'var(--gold2)',
              }}
            >
              {dp.roe.toFixed(2)}%
            </div>
            <div style={{ fontSize: 9, color: 'var(--gold2)' }}>ROE</div>
          </div>
        </div>
        {dp.narrative.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {dp.narrative.map((n, i) => (
              <div key={i} style={{ fontSize: 11, color: 'var(--txt2)' }}>
                {n}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cash Flow & Valuation */}
      <div className="g2" style={{ gap: 10, marginBottom: 10 }}>
        <div className="card">
          <div className="card-title">💰 Cash Flow Quality</div>
          <Row
            label="CFO / Net Income"
            value={rat(cf.cfoToNetIncome)}
            interp={cf.cfoToNetIncome?.interpretation}
          />
          <Row
            label="FCFF"
            value={
              cf.fcff_fromCFO
                ? '₹' + fmtNumber(cf.fcff_fromCFO.value, 0) + 'Cr'
                : '—'
            }
          />
          <Row
            label="FCFE"
            value={cf.fcfe ? '₹' + fmtNumber(cf.fcfe.value, 0) + 'Cr' : '—'}
          />
          <Row
            label="CFO Coverage of Debt"
            value={pct(cf.cashFlowCoverage)}
            interp={cf.cashFlowCoverage?.interpretation}
          />
          <Row
            label="CapEx Coverage"
            value={rat(cf.capexCoverage)}
            interp={cf.capexCoverage?.interpretation}
          />
        </div>
        <div className="card">
          <div className="card-title">📊 Valuation Ratios</div>
          <Row
            label="P/E Ratio"
            value={rat(val.peRatio)}
            interp={val.peRatio?.interpretation}
          />
          <Row label="P/B Ratio" value={rat(val.pbRatio)} />
          <Row label="P/S Ratio" value={rat(val.psRatio)} />
          <Row
            label="PEG Ratio"
            value={rat(val.pegRatio)}
            interp={val.pegRatio?.interpretation}
          />
          <Row
            label="EV/EBITDA"
            value={rat(val.evToEBITDA)}
            interp={val.evToEBITDA?.interpretation}
          />
          <Row label="EV/EBIT" value={rat(val.evToEBIT)} />
          <Row label="EV/Revenue" value={rat(val.evToRevenue)} />
          <Row
            label="Enterprise Value"
            value={
              Number.isFinite(val.enterpriseValue)
                ? '₹' + fmtNumber(val.enterpriseValue, 0) + 'Cr'
                : '—'
            }
          />
        </div>
      </div>

      {/* Narrative */}
      <div className="card">
        <div className="card-title">📝 Strategic Analysis Narrative</div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--txt2)',
            lineHeight: 1.7,
            whiteSpace: 'pre-line',
          }}
        >
          {r.narrative}
        </div>
      </div>
    </div>
  )
}

function KpiTile({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color,
          fontFamily: 'JetBrains Mono, monospace',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 9, color: 'var(--txt3)' }}>{label}</div>
    </div>
  )
}
