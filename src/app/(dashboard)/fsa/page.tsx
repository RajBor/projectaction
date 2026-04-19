'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { PRIVATE_COMPANIES } from '@/lib/data/private-companies'
import type { Company } from '@/lib/data/companies'
import { useIndustryFilter } from '@/hooks/useIndustryFilter'
import { useIndustryAtlas } from '@/hooks/useIndustryAtlas'
import { Badge } from '@/components/ui/Badge'
import { SearchableSelect } from '@/components/ui/SearchableSelect'
import { getSubSegmentLabel } from '@/lib/data/sub-segments'
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
import { useNewsData } from '@/components/news/NewsDataProvider'
import { useNewsAck, newsItemKey } from '@/components/news/NewsAckProvider'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'
import { aggregateImpactByCompany, type CompanyNewsAggregate } from '@/lib/news/impact'
import { computeAdjustedMetrics, type CompanyAdjustedMetrics } from '@/lib/news/adjustments'
import PositionMatrix from '@/components/position-matrix/PositionMatrix'
import { fromCompany as companyToMatrixTarget } from '@/lib/position-matrix/auto-fill'
import { CHAIN } from '@/lib/data/chain'

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
  const { isSelected: isIndustrySelected } = useIndustryFilter()
  const { atlasListed, atlasPrivate } = useIndustryAtlas()
  // Pull the full live universe from LiveSnapshotProvider so anything
  // the admin adds via SME Discovery (user_companies table — e.g.
  // Eppeltone) flows into the FSA picker, peer lookups, and competitor
  // news scans without a page reload. `allCompanies` already merges
  // static COMPANIES ∪ user_companies ∪ atlas, so we union it with
  // atlasListed only to ensure non-core industries surface even when
  // the LiveSnapshotProvider's atlas fetch hasn't completed yet.
  const { allCompanies } = useLiveSnapshot()
  const mergedListed = useMemo(() => {
    const seen = new Set<string>()
    const out: Company[] = []
    for (const c of allCompanies) {
      if (seen.has(c.ticker)) continue
      seen.add(c.ticker)
      out.push(c)
    }
    for (const c of atlasListed) {
      if (seen.has(c.ticker)) continue
      seen.add(c.ticker)
      out.push(c)
    }
    return out
  }, [allCompanies, atlasListed])
  const mergedPrivate = useMemo(() => [...PRIVATE_COMPANIES, ...atlasPrivate], [atlasPrivate])
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
  const [dcfCompareList, setDcfCompareList] = useState<Array<{ name: string; inputs: DCFInputs; results: DCFResults }>>(() => {
    // Restore from session storage
    try { const s = sessionStorage.getItem('fsa_dcf_compare'); if (s) return JSON.parse(s) } catch { /* ignore */ }
    return []
  })
  const [compareFilter, setCompareFilter] = useState<'peer' | 'nonpeer' | 'all'>('peer')
  const [comparePickTicker, setComparePickTicker] = useState('')
  const [includeCompareInReport, setIncludeCompareInReport] = useState(false)
  const dcfResults = useMemo(() => computeDCF(dcfInputs), [dcfInputs])

  // News data for impact analysis
  const newsDataCtx = useNewsData()
  const newsAck = useNewsAck()
  // Manual impact overrides: key = newsItemKey, value = signed % (e.g., +2.5 or -1.0)
  const [manualImpacts, setManualImpacts] = useState<Record<string, number>>(() => {
    try { const s = sessionStorage.getItem('fsa_manual_impacts'); if (s) return JSON.parse(s) } catch { /* */ }
    return {}
  })

  // Annual-report periods parsed from the RapidAPI /stock response
  const [arPeriods, setArPeriods] = useState<AnnualPeriod[]>([])
  const [arSelectedIdx, setArSelectedIdx] = useState<number>(0)
  const [historicalCagr, setHistoricalCagr] = useState<number | null>(null)

  // Sorted company list — listed first by score, then private.
  // Respect the sidebar industry filter so picker + peer comparisons
  // only show companies from the currently-selected industries.
  const listedOptions = useMemo(
    () => mergedListed.filter((c) => isIndustrySelected(c.sec)).sort((a, b) => b.acqs - a.acqs),
    [isIndustrySelected, mergedListed]
  )
  const privateOptions = useMemo(
    () => mergedPrivate.filter((c) => isIndustrySelected(c.sec)).sort((a, b) => b.acqs - a.acqs),
    [isIndustrySelected, mergedPrivate]
  )

  const selectedCompany: Company | null = useMemo(() => {
    if (!selected || selected.startsWith('P:')) return null
    return mergedListed.find((c) => c.ticker === selected) || null
  }, [selected, mergedListed])

  // 5-year historical FSA results (newest first) — runs full ratio analysis on each annual period
  const historicalResults = useMemo(() => {
    const annual = arPeriods.filter((p) => p.type === 'Annual').slice(0, 5)
    const name = selectedCompany?.name || 'Company'
    return annual
      .map((p) => {
        if (!p.inputs?.revenue || p.inputs.revenue === 0) return null
        try {
          const res = runFullFinancialAnalysis(name, p.inputs as FSAInputs)
          return { label: p.label || p.fiscalYear, fiscalYear: p.fiscalYear, result: res }
        } catch {
          return null
        }
      })
      .filter((x): x is { label: string; fiscalYear: string; result: FSAResult } => x !== null)
  }, [arPeriods, selectedCompany])

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
          {/* Replaced the native select with a searchable picker so the
              full Listed + Private universe (~300+ names once atlas rows
              land) stays usable. The FSA page hits this flow every
              session — typing "waaree" is much faster than scrolling. */}
          <div style={{ flex: 1, minWidth: 220 }}>
            <SearchableSelect
              value={selected}
              onChange={setSelected}
              placeholder="— Select company to begin —"
              searchPlaceholder="Search by name, ticker, stage…"
              style={{ width: '100%' }}
              options={[
                ...listedOptions.map((c) => ({
                  value: c.ticker,
                  label: `${c.name} (${c.ticker})`,
                  group: 'Listed Companies',
                  // Sub-segment labels widen search so "TOPCon" finds
                  // every cell-maker tagged to `ss_1_2_3`, not just the
                  // ones whose raw name contains the word.
                  searchText: `${c.sec || ''} listed ${(c.comp || []).join(' ')} ${(((c as Company).subcomp || []) as string[]).map((s) => getSubSegmentLabel(s)).join(' ')}`,
                })),
                ...privateOptions.map((c) => ({
                  value: 'P:' + c.name,
                  label: c.name,
                  group: 'Private Companies',
                  searchText: `${c.stage || ''} private ${c.sec || ''}`,
                  sub: `[${c.stage}]`,
                })),
              ]}
            />
          </div>
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
        {result && <FSAOutput r={result} historicalResults={historicalResults} />}
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

          {/* Valuation Comparison — company picker with peer/non-peer filter */}
          {(() => {
            const subjectSegs = new Set(selectedCompany?.comp || [])
            const subjectSubs = new Set((selectedCompany?.subcomp || []) as string[])
            const subjectTicker = selectedCompany?.ticker || ''
            // Restrict the pool to industries currently selected in the sidebar.
            const industryPool = mergedListed.filter((c) => isIndustrySelected(c.sec))
            // Peer definition: share a value-chain segment OR a DealNector
            // sub-segment. The sub-segment branch catches cases where the
            // admin has tagged two cos to the same narrow product line
            // (e.g. both on `ss_1_2_3` TOPCon cells) even if their coarse
            // `comp` arrays happen to differ. Generalist vs generalist
            // (both subcomp arrays empty) doesn't trigger the sub branch,
            // so untagged cos still rely on the comp-level overlap.
            const shareComp = (c: any) => (c.comp || []).some((s: string) => subjectSegs.has(s))
            const shareSub = (c: any) => {
              if (subjectSubs.size === 0) return false
              const sub = (c.subcomp || []) as string[]
              return sub.length > 0 && sub.some((s) => subjectSubs.has(s))
            }
            const peerCos = industryPool.filter(c => c.ticker !== subjectTicker && (shareComp(c) || shareSub(c)))
            const nonPeerCos = industryPool.filter(c => c.ticker !== subjectTicker && !shareComp(c) && !shareSub(c))
            const filteredList = compareFilter === 'peer' ? peerCos : compareFilter === 'nonpeer' ? nonPeerCos : industryPool.filter(c => c.ticker !== subjectTicker)
            const sortedList = [...filteredList].sort((a, b) => b.acqs - a.acqs)

            const addCompany = (ticker: string) => {
              // Look up against the merged universe (static ∪ DB ∪ atlas)
              // not bare COMPANIES — otherwise admin-added SMEs like
              // Eppeltone can't be added to the DCF comparison pool.
              const co = mergedListed.find(c => c.ticker === ticker)
              if (!co || dcfCompareList.find(x => x.name === co.name) || dcfCompareList.length >= 5) return
              const debt = co.dbt_eq ? Math.round((co.mktcap * co.dbt_eq) / (1 + co.dbt_eq)) : 80
              const compInputs: DCFInputs = {
                rev: co.rev || 0, ebm: co.ebm || 12, gr: co.revg || 20,
                wacc: co.sec === 'solar' ? 11.5 : 12, tgr: 4, yrs: 7, debt,
                rs: Math.round((co.rev || 0) * 0.05), cs: Math.round((co.rev || 0) * 0.03), ic: Math.round((co.rev || 0) * 0.04),
              }
              const newList = [...dcfCompareList, { name: co.name, inputs: compInputs, results: computeDCF(compInputs) }]
              setDcfCompareList(newList)
              setComparePickTicker('')
              try { sessionStorage.setItem('fsa_dcf_compare', JSON.stringify(newList)) } catch { /* */ }
            }

            return (
              <div style={{ padding: '14px 0', borderTop: '1px solid var(--br)', marginTop: 12 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', marginBottom: 8 }}>Compare Valuations</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>

                  {/* Filter: Peer / Non-Peer / All */}
                  <select
                    value={compareFilter}
                    onChange={e => { setCompareFilter(e.target.value as 'peer' | 'nonpeer' | 'all'); setComparePickTicker('') }}
                    style={{ background: 'var(--s3)', border: '1px solid var(--br)', color: 'var(--txt)', padding: '5px 8px', borderRadius: 4, fontSize: 11 }}
                  >
                    <option value="peer">Peers ({peerCos.length})</option>
                    <option value="nonpeer">Non-Peers ({nonPeerCos.length})</option>
                    <option value="all">All ({industryPool.length - 1})</option>
                  </select>

                  {/* Company dropdown — searchable once the peer / non-peer
                      filter still leaves a long list. Disabled entries
                      represent companies already added to the comparison. */}
                  <div style={{ minWidth: 220 }}>
                    <SearchableSelect
                      value={comparePickTicker}
                      onChange={setComparePickTicker}
                      placeholder="— Select company to add —"
                      searchPlaceholder="Search by name, ticker…"
                      style={{ width: '100%' }}
                      options={sortedList.map((c) => ({
                        value: c.ticker,
                        label: `${c.name} (${c.ticker})`,
                        searchText: `${c.sec || ''} ${(c.comp || []).join(' ')}`,
                        sub: `Score ${c.acqs}/10`,
                        disabled: !!dcfCompareList.find((x) => x.name === c.name),
                      }))}
                    />
                  </div>

                  <button
                    onClick={() => comparePickTicker && addCompany(comparePickTicker)}
                    disabled={!comparePickTicker || dcfCompareList.length >= 5}
                    style={{
                      background: comparePickTicker ? 'var(--golddim)' : 'var(--s3)',
                      border: `1px solid ${comparePickTicker ? 'var(--gold2)' : 'var(--br)'}`,
                      color: comparePickTicker ? 'var(--gold2)' : 'var(--txt4)',
                      padding: '5px 12px', borderRadius: 4, fontSize: 11, fontWeight: 700,
                      cursor: comparePickTicker ? 'pointer' : 'not-allowed',
                    }}
                  >
                    + Add Selected
                  </button>

                  <button
                    onClick={() => {
                      const n = selectedCompany?.name || selected || 'Target'
                      if (dcfCompareList.find(x => x.name === n) || dcfCompareList.length >= 5) return
                      const newList = [...dcfCompareList, { name: n, inputs: { ...dcfInputs }, results: { ...dcfResults } }]
                      setDcfCompareList(newList)
                      try { sessionStorage.setItem('fsa_dcf_compare', JSON.stringify(newList)) } catch { /* */ }
                    }}
                    disabled={!!dcfCompareList.find(x => x.name === (selectedCompany?.name || selected)) || dcfCompareList.length >= 5}
                    style={{
                      background: 'rgba(74,144,217,0.1)', border: '1px solid var(--cyan)', color: 'var(--cyan)',
                      padding: '5px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    + Current ({selectedCompany?.ticker || '—'})
                  </button>

                  {dcfCompareList.length > 0 && (
                    <button onClick={() => { setDcfCompareList([]); try { sessionStorage.removeItem('fsa_dcf_compare') } catch { /* */ } }} style={{
                      background: 'var(--s3)', border: '1px solid var(--br)', color: 'var(--txt3)',
                      padding: '5px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                    }}>
                      Clear
                    </button>
                  )}
                  <span style={{ fontSize: 10, color: 'var(--txt3)' }}>{dcfCompareList.length}/5</span>
                </div>
              </div>
            )
          })()}

          {/* ══ News & Policy Impact on Valuation ══ */}
          {selectedCompany && (
            <div style={{ padding: '14px 0', borderTop: '1px solid var(--br)', marginTop: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)', fontFamily: "'Source Serif 4', Georgia, serif" }}>
                  News &amp; Policy <em style={{ color: 'var(--gold2)' }}>Impact</em>
                </span>
                <Badge variant="cyan">Last 2 Months</Badge>
                {newsDataCtx.loading && <span style={{ fontSize: 10, color: 'var(--gold2)' }}>Loading news...</span>}
                {!newsDataCtx.loading && newsDataCtx.lastRefresh && (
                  <span style={{ fontSize: 9, color: 'var(--txt4)', marginLeft: 'auto' }}>
                    Feed: {newsDataCtx.lastRefresh.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
              {(() => {
                // Gather news for subject + competitors in same segments —
                // use mergedListed so admin-added SMEs also contribute to
                // the news impact scan (they're peers to static rows).
                // When the subject has sub-segments tagged, promote cos
                // sharing those sub-segments to the top of the competitor
                // pool — a TOPCon-cell policy tweak is far more relevant
                // to another TOPCon maker than to a generic solar_cells
                // co, and the news panel shows max 8 entries so ordering
                // matters.
                const subjectSegs = new Set(selectedCompany.comp || [])
                const subjectSubs = new Set((selectedCompany.subcomp || []) as string[])
                const compPeers = mergedListed.filter(c => c.ticker !== selectedCompany.ticker && (c.comp || []).some(s => subjectSegs.has(s)))
                const subPeers = subjectSubs.size > 0
                  ? compPeers.filter(c => {
                      const subs = (c.subcomp || []) as string[]
                      return subs.length > 0 && subs.some(s => subjectSubs.has(s))
                    })
                  : []
                // Union with sub-segment peers first (strongest signal),
                // then comp-only peers, dedupe by ticker.
                const seenTick = new Set<string>()
                const competitors: typeof compPeers = []
                for (const c of [...subPeers, ...compPeers]) {
                  if (seenTick.has(c.ticker)) continue
                  seenTick.add(c.ticker)
                  competitors.push(c)
                  if (competitors.length >= 8) break
                }
                const relevantTickers = [selectedCompany.ticker, ...competitors.map(c => c.ticker)]

                // Get all news items affecting subject or competitors
                const allNews = newsDataCtx.items.filter(n =>
                  n.impact.affectedCompanies.some(t => relevantTickers.includes(t))
                )

                if (allNews.length === 0 && !newsDataCtx.loading) {
                  return (
                    <div style={{ fontSize: 11, color: 'var(--txt3)', fontStyle: 'italic', marginBottom: 10 }}>
                      No news signals detected for {selectedCompany.ticker} or its competitors. Refresh the news feed from the News page.
                      <button onClick={() => newsDataCtx.refresh(true)} style={{ marginLeft: 8, background: 'var(--s3)', border: '1px solid var(--br)', color: 'var(--cyan)', padding: '2px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer' }}>
                        Refresh News
                      </button>
                    </div>
                  )
                }

                // Split: subject-specific, market/policy (multi-company), competitor-specific
                const subjectNews = allNews.filter(n => n.impact.affectedCompanies.includes(selectedCompany.ticker))
                const marketNews = allNews.filter(n => n.impact.affectedCompanies.length > 2) // policy/market impacts many
                const competitorOnly = allNews.filter(n => !n.impact.affectedCompanies.includes(selectedCompany.ticker) && n.impact.affectedCompanies.some(t => competitors.map(c => c.ticker).includes(t)))

                // Apply manual impact overrides to news items before aggregation
                const applyManualOverrides = (items: typeof allNews) =>
                  items.map(n => {
                    const key = newsItemKey(n.item)
                    const manual = manualImpacts[key]
                    if (manual !== undefined) {
                      return { ...n, impact: { ...n.impact, multipleDeltaPct: manual, sentimentScore: manual >= 0 ? Math.abs(manual) : -Math.abs(manual), sentiment: (manual >= 0 ? 'positive' : 'negative') as 'positive' | 'negative' } }
                    }
                    return n
                  })

                // Compute acknowledged-based adjusted metrics for subject (with manual overrides)
                const ackedAgg = aggregateImpactByCompany(applyManualOverrides(subjectNews), newsAck)
                const ackedSubjectAgg = ackedAgg[selectedCompany.ticker]
                const ackedAdjusted = computeAdjustedMetrics(selectedCompany, ackedSubjectAgg)

                // Compute per-competitor acknowledged adjustments (with manual overrides)
                const competitorAdjusted: Array<{ co: Company; adj: CompanyAdjustedMetrics }> = competitors.slice(0, 5).map(co => {
                  const coNews = allNews.filter(n => n.impact.affectedCompanies.includes(co.ticker))
                  const coAgg = aggregateImpactByCompany(applyManualOverrides(coNews), newsAck)
                  return { co, adj: computeAdjustedMetrics(co, coAgg[co.ticker]) }
                })

                const NewsRow = ({ n }: { n: typeof allNews[0] }) => {
                  const key = newsItemKey(n.item)
                  const acked = newsAck.isAcknowledged(key)
                  const isPos = n.impact.sentiment === 'positive'
                  const scope = n.impact.affectedCompanies.length > 2 ? 'Market/Policy' : n.impact.affectedCompanies.length > 1 ? 'Multi-Company' : 'Company-Specific'
                  const manualVal = manualImpacts[key]
                  const effectiveImpact = manualVal !== undefined ? manualVal : n.impact.multipleDeltaPct
                  const hasManual = manualVal !== undefined
                  return (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', padding: '6px 8px', marginBottom: 3, background: acked ? (isPos ? 'rgba(34,197,94,0.08)' : 'rgba(248,113,113,0.08)') : 'var(--s2)', border: `1px solid ${acked ? (isPos ? 'rgba(34,197,94,0.25)' : 'rgba(248,113,113,0.25)') : 'var(--br)'}`, borderRadius: 4 }}>
                      {/* Acknowledge button */}
                      <button
                        onClick={() => {
                          newsAck.toggle(key)
                          // Auto-acknowledge also when entering manual impact
                        }}
                        title={acked ? 'Click to un-acknowledge — removes impact from valuation' : 'Click to acknowledge — applies this news impact to valuation'}
                        style={{
                          flexShrink: 0, width: 22, height: 22, borderRadius: 4,
                          border: `2px solid ${acked ? 'var(--green)' : 'var(--br2)'}`,
                          background: acked ? 'var(--green)' : 'transparent',
                          color: acked ? '#fff' : 'var(--txt4)',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 1,
                        }}
                      >
                        {acked ? '✓' : ''}
                      </button>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, color: 'var(--txt)', fontWeight: 500, lineHeight: 1.4 }}>{n.item.title?.slice(0, 100)}</div>
                        <div style={{ fontSize: 9, color: 'var(--txt3)', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                          <span style={{ color: effectiveImpact >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                            {effectiveImpact >= 0 ? '▲' : '▼'} {effectiveImpact >= 0 ? '+' : ''}{effectiveImpact.toFixed(1)}%
                            {hasManual && <span style={{ color: 'var(--gold2)', fontSize: 8, marginLeft: 2 }}>(manual)</span>}
                          </span>
                          <span>{n.impact.category}</span>
                          <span style={{ color: n.impact.materiality === 'high' ? 'var(--gold2)' : 'var(--txt4)' }}>{n.impact.materiality}</span>
                          <span style={{ color: 'var(--cyan)' }}>{scope}</span>
                          {n.item.source && <span>{n.item.source}</span>}
                          {n.item.pubDate && <span>{n.item.pubDate.slice(0, 10)}</span>}
                        </div>
                      </div>

                      {/* Manual impact input */}
                      <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 3 }}>
                        <input
                          type="number"
                          step="0.1"
                          placeholder={n.impact.multipleDeltaPct.toFixed(1)}
                          value={manualVal !== undefined ? manualVal : ''}
                          onChange={e => {
                            const v = e.target.value.trim()
                            const next = { ...manualImpacts }
                            if (v === '') {
                              delete next[key]
                            } else {
                              next[key] = parseFloat(v) || 0
                            }
                            setManualImpacts(next)
                            try { sessionStorage.setItem('fsa_manual_impacts', JSON.stringify(next)) } catch { /* */ }
                            // Auto-acknowledge when entering manual impact
                            if (v !== '' && !acked) newsAck.toggle(key)
                          }}
                          title="Enter manual impact % (overrides calculated value). Leave blank to use auto-calculated impact."
                          style={{
                            width: 52, background: hasManual ? 'rgba(212,164,59,0.1)' : 'var(--s3)',
                            border: `1px solid ${hasManual ? 'var(--gold2)' : 'var(--br)'}`,
                            color: hasManual ? 'var(--gold2)' : 'var(--txt3)',
                            padding: '2px 4px', borderRadius: 3, fontSize: 10,
                            fontFamily: "'JetBrains Mono', monospace", textAlign: 'right', outline: 'none',
                          }}
                        />
                        <span style={{ fontSize: 9, color: 'var(--txt4)' }}>%</span>
                      </div>
                    </div>
                  )
                }

                return (
                  <>
                    {/* ── Subject Company News ── */}
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold2)', marginBottom: 4 }}>
                        {selectedCompany.ticker} — Direct Impact ({subjectNews.length} items)
                      </div>
                      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                        {subjectNews.slice(0, 10).map((n, i) => <NewsRow key={i} n={n} />)}
                        {subjectNews.length === 0 && <div style={{ fontSize: 10, color: 'var(--txt4)', fontStyle: 'italic' }}>No direct news for {selectedCompany.ticker}</div>}
                      </div>
                    </div>

                    {/* ── Market/Policy News (multi-company) ── */}
                    {marketNews.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', marginBottom: 4 }}>
                          Market &amp; Policy News — Sector-Wide Impact ({marketNews.length} items)
                        </div>
                        <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                          {marketNews.slice(0, 8).map((n, i) => <NewsRow key={`m${i}`} n={n} />)}
                        </div>
                      </div>
                    )}

                    {/* ── Competitor-Specific News ── */}
                    {competitorOnly.length > 0 && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt2)', marginBottom: 4 }}>
                          Competitor News — Peripheral Impact ({competitorOnly.length} items)
                        </div>
                        <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                          {competitorOnly.slice(0, 6).map((n, i) => <NewsRow key={`c${i}`} n={n} />)}
                        </div>
                      </div>
                    )}

                    {/* ═══ Post News & Policy Impact Valuation ═══ */}
                    <div style={{ borderTop: '2px solid var(--gold2)', paddingTop: 12, marginTop: 8 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', marginBottom: 8, fontFamily: "'Source Serif 4', Georgia, serif" }}>
                        Post News &amp; Policy Impact <em style={{ color: 'var(--gold2)' }}>Valuation</em>
                        <span style={{ fontSize: 9, color: 'var(--txt3)', fontWeight: 400, marginLeft: 8 }}>
                          ({newsAck.count} item{newsAck.count !== 1 ? 's' : ''} acknowledged)
                        </span>
                      </div>

                      {/* Subject post-impact */}
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, marginBottom: 10 }}>
                        <thead>
                          <tr style={{ borderBottom: '2px solid var(--br2)' }}>
                            <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--txt3)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>Metric</th>
                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 9 }}>Pre-News</th>
                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--gold2)', fontSize: 9, fontWeight: 700 }}>Post-News</th>
                            <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 9 }}>Change</th>
                            {competitorAdjusted.slice(0, 3).map(ca => (
                              <th key={ca.co.ticker} style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 8 }}>{ca.co.ticker}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { label: 'Acquisition Score', pre: ackedAdjusted.pre.acqs, post: ackedAdjusted.post.acqs, unit: '/10', key: 'acqs' as const },
                            { label: 'EV/EBITDA', pre: ackedAdjusted.pre.ev_eb, post: ackedAdjusted.post.ev_eb, unit: '×', key: 'ev_eb' as const },
                            { label: 'Revenue Growth', pre: ackedAdjusted.pre.revg, post: ackedAdjusted.post.revg, unit: '%', key: 'revg' as const },
                            { label: 'EBITDA Margin', pre: ackedAdjusted.pre.ebm, post: ackedAdjusted.post.ebm, unit: '%', key: 'ebm' as const },
                            { label: 'Enterprise Value', pre: ackedAdjusted.pre.ev, post: ackedAdjusted.post.ev, unit: ' Cr', key: 'ev' as const },
                          ].map(m => {
                            const delta = m.post - m.pre
                            const fmt = (v: number) => m.unit === ' Cr' ? `₹${Math.round(v).toLocaleString('en-IN')}` : `${v.toFixed(1)}${m.unit}`
                            return (
                              <tr key={m.label} style={{ borderBottom: '1px solid var(--br)' }}>
                                <td style={{ padding: '5px 8px', color: 'var(--txt2)', fontWeight: 500 }}>{m.label}</td>
                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", color: 'var(--txt3)' }}>{fmt(m.pre)}</td>
                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontWeight: 700, color: 'var(--gold2)' }}>{fmt(m.post)}</td>
                                <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", color: delta >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                                  {delta >= 0 ? '+' : ''}{m.unit === ' Cr' ? Math.round(delta).toLocaleString('en-IN') : delta.toFixed(1)}{m.unit === ' Cr' ? '' : m.unit}
                                </td>
                                {competitorAdjusted.slice(0, 3).map(ca => (
                                  <td key={ca.co.ticker} style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: ca.adj.post[m.key] !== ca.adj.pre[m.key] ? (ca.adj.post[m.key] > ca.adj.pre[m.key] ? 'var(--green)' : 'var(--red)') : 'var(--txt4)' }}>
                                    {m.unit === ' Cr' ? Math.round(ca.adj.post[m.key]).toLocaleString('en-IN') : ca.adj.post[m.key].toFixed(1)}
                                  </td>
                                ))}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>

                      <div style={{ fontSize: 9, color: 'var(--txt3)', padding: '4px 8px', background: 'var(--s2)', borderRadius: 3, border: '1px solid var(--br)', lineHeight: 1.5 }}>
                        <strong style={{ color: 'var(--gold2)' }}>How acknowledgement works:</strong> Click ✓ on any news item to acknowledge its impact. Acknowledged items contribute to the post-news valuation. Policy/market news affects all companies in the segment. Company-specific news affects only the named company. Competitor columns show their own post-news metrics for comparison.
                      </div>
                    </div>
                  </>
                )
              })()}
            </div>
          )}

          {/* ══ Valuation Comparison Table — Editable Assumptions ══ */}
          {dcfCompareList.length >= 1 && (
            <div style={{ overflowX: 'auto', marginBottom: 10 }}>
              {/* Report toggle */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt2)' }}>Valuation Comparison</span>
                <button
                  onClick={() => {
                    setIncludeCompareInReport(!includeCompareInReport)
                    try { localStorage.setItem('fsa_compare_in_report', JSON.stringify(!includeCompareInReport)) } catch { /* */ }
                  }}
                  title={includeCompareInReport ? 'Remove comparison from report' : 'Include this comparison table in the PDF report'}
                  style={{
                    background: includeCompareInReport ? 'rgba(212,164,59,0.15)' : 'transparent',
                    border: `1px solid ${includeCompareInReport ? 'var(--gold2)' : 'var(--br2)'}`,
                    borderRadius: 10, padding: '2px 8px', fontSize: 9, cursor: 'pointer',
                    color: includeCompareInReport ? 'var(--gold2)' : 'var(--txt4)', fontWeight: 600,
                  }}
                >
                  {includeCompareInReport ? '📎 In Report' : '+ Add to Report'}
                </button>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--br2)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--txt3)', fontSize: 9, fontWeight: 600, textTransform: 'uppercase' }}>Parameter</th>
                    {dcfCompareList.map(c => (
                      <th key={c.name} style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--gold2)', fontSize: 9, fontWeight: 700 }}>
                        {c.name.slice(0, 14)}
                        <button onClick={() => { const nl = dcfCompareList.filter(x => x.name !== c.name); setDcfCompareList(nl); try { sessionStorage.setItem('fsa_dcf_compare', JSON.stringify(nl)) } catch{/* */} }} style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', fontSize: 9, marginLeft: 3 }}>✕</button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {/* Editable assumption rows */}
                  {([
                    { label: 'Revenue ₹Cr', key: 'rev' as keyof DCFInputs, step: 10 },
                    { label: 'EBITDA Margin %', key: 'ebm' as keyof DCFInputs, step: 0.5 },
                    { label: 'Revenue Growth %', key: 'gr' as keyof DCFInputs, step: 0.5 },
                    { label: 'WACC %', key: 'wacc' as keyof DCFInputs, step: 0.25 },
                    { label: 'Terminal Growth %', key: 'tgr' as keyof DCFInputs, step: 0.25 },
                    { label: 'Net Debt ₹Cr', key: 'debt' as keyof DCFInputs, step: 10 },
                  ]).map(row => (
                    <tr key={row.label} style={{ borderBottom: '1px solid var(--br)' }}>
                      <td style={{ padding: '4px 8px', color: 'var(--txt3)', fontSize: 10 }}>{row.label}</td>
                      {dcfCompareList.map((c, ci) => (
                        <td key={c.name} style={{ padding: '2px 4px', textAlign: 'right' }}>
                          <input
                            type="number"
                            value={c.inputs[row.key]}
                            step={row.step}
                            onChange={e => {
                              const v = parseFloat(e.target.value) || 0
                              const newList = dcfCompareList.map((x, i) => {
                                if (i !== ci) return x
                                const newInputs = { ...x.inputs, [row.key]: v }
                                return { ...x, inputs: newInputs, results: computeDCF(newInputs) }
                              })
                              setDcfCompareList(newList)
                              try { sessionStorage.setItem('fsa_dcf_compare', JSON.stringify(newList)) } catch { /* */ }
                            }}
                            style={{
                              width: '100%', maxWidth: 90, background: 'var(--s3)', border: '1px solid var(--br)',
                              color: 'var(--txt)', padding: '3px 5px', borderRadius: 3, fontSize: 11,
                              fontFamily: "'JetBrains Mono', monospace", textAlign: 'right', outline: 'none',
                            }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                  {/* Separator */}
                  <tr><td colSpan={dcfCompareList.length + 1} style={{ padding: '4px 0', borderBottom: '2px solid var(--gold2)' }}><span style={{ fontSize: 9, color: 'var(--gold2)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Valuation Output</span></td></tr>
                  {/* Output rows */}
                  {([
                    { label: 'EV (Base) ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.evBase), bold: true, clickable: true },
                    { label: 'Equity Value ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.equity), bold: true, clickable: true },
                    { label: 'EV + Synergies ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.evSyn), bold: false, clickable: false },
                    { label: 'Equity + Synergies', get: (c: { results: DCFResults }) => Math.round(c.results.eqSyn), bold: false, clickable: false },
                    { label: 'Implied EV/EBITDA', get: (c: { results: DCFResults }) => c.results.eveb.toFixed(1) + '×', bold: false, clickable: false },
                    { label: 'Bid Low ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.bidLow), bold: false, clickable: false },
                    { label: 'Bid High ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.bidHigh), bold: false, clickable: false },
                    { label: 'Walk-Away ₹Cr', get: (c: { results: DCFResults }) => Math.round(c.results.walkAway), bold: false, clickable: false },
                  ] as Array<{ label: string; get: (c: { inputs: DCFInputs; results: DCFResults }) => number | string; bold: boolean; clickable: boolean }>).map(m => (
                    <tr key={m.label} style={{ borderBottom: '1px solid var(--br)' }}>
                      <td style={{ padding: '5px 8px', color: 'var(--txt2)', fontWeight: m.bold ? 700 : 400, fontSize: 10 }}>{m.label}</td>
                      {dcfCompareList.map(c => {
                        const val = m.get(c)
                        return (
                          <td
                            key={c.name}
                            onClick={() => { if (m.clickable) showWorking(wkDCFOutput({ name: c.name, ...c.inputs, evBase: c.results.evBase, evSyn: c.results.evSyn, termPV: c.results.termPV, pv: c.results.pv, synPV: c.results.synPV })) }}
                            title={m.clickable ? 'Click for detailed calculation' : undefined}
                            style={{
                              padding: '5px 8px', textAlign: 'right',
                              fontFamily: "'JetBrains Mono', monospace", fontWeight: m.bold ? 700 : 500,
                              color: m.bold ? 'var(--gold2)' : 'var(--txt)', fontSize: 12,
                              cursor: m.clickable ? 'pointer' : 'default',
                            }}
                          >
                            {typeof val === 'number' ? val.toLocaleString('en-IN') : val}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  {/* ── Financial Ratios section ── */}
                  {/* Same estimation chain as the FSA Intelligence Panel:       */}
                  {/* book equity is inferred from mktcap / P/B, total debt from */}
                  {/* D/E × equity, EBIT from EBITDA − estimated D&A (~4.5% of   */}
                  {/* revenue). Returns null → "—" so missing inputs don't lie.  */}
                  <tr><td colSpan={dcfCompareList.length + 1} style={{ padding: '4px 0', borderTop: '1px solid var(--br)', borderBottom: '2px solid var(--cyan2)' }}><span style={{ fontSize: 9, color: 'var(--cyan2)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1 }}>Financial Ratios</span></td></tr>
                  {(() => {
                    const estBookEq = (co: Company): number | null =>
                      co.mktcap > 0 && co.pb > 0 ? co.mktcap / co.pb : null
                    const estDebt = (co: Company): number | null => {
                      const eq = estBookEq(co); return eq == null ? null : eq * (co.dbt_eq ?? 0)
                    }
                    const estEbitVal = (co: Company): number | null => {
                      if (!co.ebitda || co.ebitda <= 0) return null
                      const da = co.rev > 0 ? co.rev * 0.045 : 0
                      return co.ebitda - da
                    }
                    const ratioRows: Array<{ label: string; calc: (co: Company) => string; hint: string }> = [
                      { label: 'EBITDA Margin %', calc: (co) => (co.ebm != null ? `${co.ebm.toFixed(1)}%` : '—'), hint: 'EBITDA / Revenue' },
                      { label: 'Net Margin %',    calc: (co) => (co.rev > 0 && co.pat != null ? `${((co.pat / co.rev) * 100).toFixed(1)}%` : '—'), hint: 'PAT / Revenue' },
                      { label: 'ROE %',           calc: (co) => {
                          const eq = estBookEq(co)
                          return eq != null && eq > 0 && co.pat > 0 ? `${((co.pat / eq) * 100).toFixed(1)}%` : '—'
                        }, hint: 'PAT / Book Equity (est. from MCap / PB)' },
                      { label: 'ROCE %',          calc: (co) => {
                          const eq = estBookEq(co); const debt = estDebt(co); const ebit = estEbitVal(co)
                          if (eq == null || eq <= 0 || ebit == null) return '—'
                          const capEmp = eq + (debt ?? 0)
                          return capEmp > 0 ? `${((ebit / capEmp) * 100).toFixed(1)}%` : '—'
                        }, hint: 'EBIT / (Equity + Debt)' },
                      { label: 'ROIC %',          calc: (co) => {
                          const eq = estBookEq(co); const debt = estDebt(co); const ebit = estEbitVal(co)
                          if (eq == null || eq <= 0 || ebit == null) return '—'
                          const invCap = eq + (debt ?? 0) // cash unavailable at this grain
                          return invCap > 0 ? `${((ebit * 0.75) / invCap * 100).toFixed(1)}%` : '—'
                        }, hint: 'NOPAT / Invested Capital (25% tax)' },
                      { label: 'D/E Ratio',       calc: (co) => (co.dbt_eq != null ? `${co.dbt_eq.toFixed(2)}×` : '—'), hint: 'Total Debt / Total Equity' },
                      { label: 'EV / EBITDA',     calc: (co) => (co.ev_eb > 0 ? `${co.ev_eb.toFixed(1)}×` : '—'), hint: 'Enterprise Value / EBITDA' },
                      { label: 'P / E',           calc: (co) => (co.pe > 0 ? `${co.pe.toFixed(1)}×` : '—'), hint: 'Price / Earnings' },
                      { label: 'P / B',           calc: (co) => (co.pb > 0 ? `${co.pb.toFixed(2)}×` : '—'), hint: 'Price / Book' },
                      { label: 'Revenue Growth %',calc: (co) => (co.revg != null ? `${co.revg.toFixed(1)}%` : '—'), hint: 'YoY revenue growth' },
                      { label: 'Acq Score',       calc: (co) => (co.acqs != null ? `${co.acqs.toFixed(1)} / 10` : '—'), hint: '7-driver composite (live)' },
                    ]
                    return ratioRows.map((row) => (
                      <tr key={row.label} style={{ borderBottom: '1px solid var(--br)' }}>
                        <td title={row.hint} style={{ padding: '5px 8px', color: 'var(--txt2)', fontSize: 10, cursor: 'help', borderBottom: '1px dotted var(--br2)' }}>{row.label}</td>
                        {dcfCompareList.map((entry) => {
                          const co = mergedListed.find((x) => x.name === entry.name)
                          const val = co ? row.calc(co) : '—'
                          return (
                            <td
                              key={entry.name}
                              style={{
                                padding: '5px 8px', textAlign: 'right',
                                fontFamily: "'JetBrains Mono', monospace", fontWeight: 500,
                                color: val === '—' ? 'var(--txt3)' : 'var(--txt)', fontSize: 12,
                              }}
                            >
                              {val}
                            </td>
                          )
                        })}
                      </tr>
                    ))
                  })()}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ fontSize: 10, color: 'var(--txt4)', padding: '6px 10px', background: 'var(--s2)', borderRadius: 4, border: '1px solid var(--br)' }}>
            Edit any assumption to instantly recalculate valuations. Click EV/Equity values for detailed working. Use "Add to Report" to include this comparison in the PDF. News signals show direct, indirect, and peripheral impact classification.
          </div>
        </div>
      )}

      {/* Position Matrix — peer-to-peer 9-box, all peers mapped by default */}
      {(() => {
        const subject = selectedCompany
        const industryPool = mergedListed.filter(c => isIndustrySelected(c.sec))
        // Peer set: share a value-chain segment with subject. If no subject
        // is picked, plot the whole industry pool so the user sees the
        // cross-peer positioning before choosing a focus company.
        const peers = subject
          ? mergedListed.filter(c => isIndustrySelected(c.sec) && (c.comp || []).some(s => (subject.comp || []).includes(s)))
          : industryPool
        if (peers.length === 0) return null
        const universe = subject && !peers.find(p => p.ticker === subject.ticker)
          ? [subject, ...peers]
          : peers
        const matrixTargets = universe.map(companyToMatrixTarget)
        const chainById = new Map<string, typeof CHAIN[number]>(CHAIN.map((n) => [n.id, n]))
        const chainLookup = (id: string) => chainById.get(id)
        const subtitle = subject
          ? `${peers.length} peer${peers.length === 1 ? '' : 's'} mapped vs. ${subject.name}. Segment overlap via value-chain tags; hover for the calculation.`
          : `All ${peers.length} peers in the current industry filter, plotted on a 9-box. Pick a subject company above to narrow the peer set.`
        return (
          <PositionMatrix
            targets={matrixTargets}
            chainLookup={chainLookup}
            mode="fsa"
            title={subject ? `Peer Position Matrix — ${subject.name}` : 'Peer Position Matrix'}
            subtitle={subtitle}
          />
        )
      })()}

      {/* FSA Intelligence Panel */}
      {showFsaPanel && selected && !selected.startsWith('P:') && (() => {
        const co = mergedListed.find(c => c.ticker === selected)
        if (!co) return null
        return (
          <FSAIntelligencePanel
            company={co}
            peers={mergedListed.filter(c => c.ticker !== co.ticker && isIndustrySelected(c.sec) && (c.comp || []).some(s => (co.comp || []).includes(s))).slice(0, 5)}
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

function FSAOutput({
  r,
  historicalResults = [],
}: {
  r: FSAResult
  historicalResults?: Array<{ label: string; fiscalYear: string; result: FSAResult }>
}) {
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

      {/* Ratio tables — horizontal scroll on narrow viewports */}
      <div style={{ overflowX: 'auto', overflowY: 'hidden', marginBottom: 10, paddingBottom: 4 }}>
      <div className="g2" style={{ gap: 10, minWidth: 720 }}>
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
      </div>

      {/* 5-Year Historical Ratio Trend (annual periods) */}
      <HistoricalRatiosTable rows={historicalResults} />

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

// ── 5-year historical ratio table (newest first) ──
function HistoricalRatiosTable({
  rows,
}: {
  rows: Array<{ label: string; fiscalYear: string; result: FSAResult }>
}) {
  if (!rows || rows.length === 0) return null

  // Display newest → oldest left → right (rows already newest-first)
  const cols = rows

  type Getter = (r: FSAResult) => number | null | undefined
  type RatioRow = {
    label: string
    get: Getter
    fmt: 'num' | 'pct' | 'days' | 'cr'
    decimals?: number
  }

  const groups: Array<{ title: string; ratios: RatioRow[] }> = [
    {
      title: 'Profitability',
      ratios: [
        { label: 'Gross Margin', get: (r) => r.ratios.profitability.grossMargin?.value, fmt: 'pct' },
        { label: 'Operating Margin', get: (r) => r.ratios.profitability.operatingMargin?.value, fmt: 'pct' },
        { label: 'EBITDA Margin', get: (r) => r.ratios.profitability.ebitdaMargin?.value, fmt: 'pct' },
        { label: 'Net Profit Margin', get: (r) => r.ratios.profitability.netProfitMargin?.value, fmt: 'pct' },
        { label: 'ROA', get: (r) => r.ratios.profitability.roa?.value, fmt: 'pct' },
        { label: 'ROE', get: (r) => r.ratios.profitability.roe?.value, fmt: 'pct' },
        { label: 'ROIC', get: (r) => r.ratios.profitability.roic?.value, fmt: 'pct' },
        { label: 'ROCE', get: (r) => r.ratios.profitability.roce?.value, fmt: 'pct' },
      ],
    },
    {
      title: 'Liquidity',
      ratios: [
        { label: 'Current Ratio', get: (r) => r.ratios.liquidity.currentRatio?.value, fmt: 'num' },
        { label: 'Quick Ratio', get: (r) => r.ratios.liquidity.quickRatio?.value, fmt: 'num' },
        { label: 'Cash Ratio', get: (r) => r.ratios.liquidity.cashRatio?.value, fmt: 'num' },
        { label: 'Defensive Interval (days)', get: (r) => r.ratios.liquidity.defensiveIntervalRatio?.value, fmt: 'days' },
      ],
    },
    {
      title: 'Solvency',
      ratios: [
        { label: 'Debt-to-Assets %', get: (r) => r.ratios.solvency.debtToAssets?.pct, fmt: 'pct' },
        { label: 'Debt-to-Equity', get: (r) => r.ratios.solvency.debtToEquity?.value, fmt: 'num' },
        { label: 'Financial Leverage', get: (r) => r.ratios.solvency.financialLeverage?.value, fmt: 'num' },
        { label: 'Debt / EBITDA', get: (r) => r.ratios.solvency.debtToEBITDA?.value, fmt: 'num' },
        { label: 'Interest Coverage', get: (r) => r.ratios.solvency.interestCoverage?.value, fmt: 'num' },
      ],
    },
    {
      title: 'Activity',
      ratios: [
        { label: 'Inventory Turnover', get: (r) => r.ratios.activity.inventoryTurnover?.value, fmt: 'num' },
        { label: 'DSO (days)', get: (r) => r.ratios.activity.daysSalesOutstanding?.value, fmt: 'days' },
        { label: 'DPO (days)', get: (r) => r.ratios.activity.daysPayables?.value, fmt: 'days' },
        { label: 'Cash Conv. Cycle (days)', get: (r) => r.ratios.activity.cashConversionCycle?.value, fmt: 'days' },
        { label: 'Asset Turnover', get: (r) => r.ratios.activity.totalAssetTurnover?.value, fmt: 'num' },
      ],
    },
  ]

  const formatCell = (v: number | null | undefined, fmt: RatioRow['fmt']): string => {
    if (v == null || !Number.isFinite(v)) return 'N/A'
    if (fmt === 'pct') return v.toFixed(1) + '%'
    if (fmt === 'days') return Math.round(v).toString()
    if (fmt === 'cr') return '₹' + Math.round(v).toLocaleString('en-IN')
    return v.toFixed(2)
  }

  const cellStyle: React.CSSProperties = {
    padding: '5px 10px',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
    color: 'var(--txt)',
    textAlign: 'right',
    borderBottom: '1px solid var(--br)',
    whiteSpace: 'nowrap',
  }
  const labelCellStyle: React.CSSProperties = {
    padding: '5px 10px',
    fontSize: 11,
    color: 'var(--txt3)',
    borderBottom: '1px solid var(--br)',
    position: 'sticky',
    left: 0,
    background: 'var(--s1)',
    zIndex: 1,
    whiteSpace: 'nowrap',
  }
  const headerCellStyle: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--txt2)',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    textAlign: 'right',
    borderBottom: '2px solid var(--gold2)',
    background: 'var(--s2)',
    whiteSpace: 'nowrap',
  }
  const headerLabelStyle: React.CSSProperties = {
    ...headerCellStyle,
    textAlign: 'left',
    position: 'sticky',
    left: 0,
    zIndex: 2,
  }
  const groupHeaderStyle: React.CSSProperties = {
    padding: '6px 10px',
    fontSize: 10,
    fontWeight: 700,
    color: 'var(--gold2)',
    textTransform: 'uppercase',
    letterSpacing: '1px',
    background: 'var(--s2)',
    borderBottom: '1px solid var(--br)',
    position: 'sticky',
    left: 0,
  }

  return (
    <div className="card" style={{ marginBottom: 10, padding: 0 }}>
      <div className="card-title" style={{ padding: '10px 12px 6px' }}>
        📅 5-Year Historical Ratio Trend{' '}
        <span style={{ fontSize: 10, color: 'var(--txt3)', fontWeight: 400, marginLeft: 6 }}>
          most recent annual periods · scroll horizontally if more years
        </span>
      </div>
      <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 560 }}>
          <thead>
            <tr>
              <th style={headerLabelStyle}>Ratio</th>
              {cols.map((c) => (
                <th key={c.fiscalYear || c.label} style={headerCellStyle}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={g.title}>
                <tr>
                  <td colSpan={cols.length + 1} style={groupHeaderStyle}>
                    {g.title}
                  </td>
                </tr>
                {g.ratios.map((row) => (
                  <tr key={row.label}>
                    <td style={labelCellStyle}>{row.label}</td>
                    {cols.map((c) => (
                      <td key={(c.fiscalYear || c.label) + row.label} style={cellStyle}>
                        {formatCell(row.get(c.result), row.fmt)}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
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
