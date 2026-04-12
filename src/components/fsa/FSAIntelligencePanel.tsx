'use client'

/**
 * FSA Intelligence Panel — Reusable slide-out drawer for financial analysis.
 *
 * Embeddable on any dashboard page (Valuation, M&A Radar, Compare, etc.)
 * Contains tabs: Ratios, DuPont, Z-Score, Formulas, Charts, AI Analysis.
 * Each section has an "Add to Report" toggle for custom report building.
 */

import { useState, useMemo, useCallback, useEffect, type CSSProperties } from 'react'
import type { Company } from '@/lib/data/companies'
import { buildFinancialHistory, type FinancialHistory, type FinancialYear } from '@/lib/valuation/history'
import { stockQuote, tickerToApiName, type StockProfile } from '@/lib/stocks/api'
import type { ScreenerYearData } from '@/lib/live/screener-fetch'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'

/** Convert Screener multi-year data into FinancialYear[] for history. */
function screenerToFinancialYears(years: ScreenerYearData[]): FinancialYear[] {
  return years.map((y, i, arr) => {
    const rev = y.sales
    const ni = y.netProfit
    const ebitda = rev && y.opm ? rev * (y.opm / 100) : (y.operatingProfit && y.depreciation ? y.operatingProfit + y.depreciation : null)
    const ebit = y.operatingProfit ?? (ebitda && y.depreciation ? ebitda - y.depreciation : null)
    const prevRev = i < arr.length - 1 ? arr[i + 1]?.sales : null
    const prevTA = i < arr.length - 1 ? arr[i + 1]?.totalAssets : null
    const prevEq = i < arr.length - 1 ? (arr[i + 1]?.reserves != null && arr[i + 1]?.equity != null ? (arr[i + 1].reserves ?? 0) + (arr[i + 1].equity ?? 0) : null) : null
    const totalEquity = y.reserves != null && y.equity != null ? y.reserves + y.equity : null
    const fcf = y.cfo != null ? y.cfo - Math.abs(y.cfi ?? 0) * 0.8 : null // est capex ~80% of CFI

    return {
      label: y.year,
      fiscalYear: y.year,
      endDate: '',
      type: 'Annual' as const,
      revenue: rev,
      cogs: rev && y.expenses && y.operatingProfit ? y.expenses - (y.depreciation ?? 0) - (y.interest ?? 0) : null,
      grossProfit: rev && y.expenses ? rev - (y.expenses - (y.depreciation ?? 0) - (y.interest ?? 0) - (y.otherIncome ?? 0)) : null,
      ebitda,
      ebit,
      da: y.depreciation,
      interestExpense: y.interest,
      ebt: y.profitBeforeTax,
      taxExpense: y.tax,
      netIncome: ni,
      cash: null,
      receivables: null,
      inventory: null,
      currentAssets: null,
      currentLiabilities: null,
      totalAssets: y.totalAssets,
      totalEquity,
      totalDebt: y.borrowings,
      cfo: y.cfo,
      capex: y.cfi ? Math.abs(y.cfi) * 0.8 : null, // est capex ~80% of CFI
      fcf,
      revenueGrowthPct: rev && prevRev && prevRev > 0 ? ((rev - prevRev) / prevRev) * 100 : null,
      ebitdaMarginPct: ebitda && rev && rev > 0 ? (ebitda / rev) * 100 : null,
      netMarginPct: ni && rev && rev > 0 ? (ni / rev) * 100 : null,
      roePct: ni && totalEquity && prevEq ? (ni / ((totalEquity + prevEq) / 2)) * 100 : null,
      roaPct: ni && y.totalAssets && prevTA ? (ni / ((y.totalAssets + prevTA) / 2)) * 100 : null,
      netWorkingCapital: null,
      nwcTurnover: null,
      cashConversionCycle: y.cashConversionCycle ?? null,
      debtToEquity: y.borrowings && totalEquity && totalEquity > 0 ? y.borrowings / totalEquity : null,
    }
  })
}
import { BarChart, barChartInference } from './charts/BarChart'
import { LineChart, type LineSeries } from './charts/LineChart'
import { WaterfallChart, buildIncomeWaterfall, waterfallInference } from './charts/WaterfallChart'
import { RadarChart, normaliseRatio, radarInference } from './charts/RadarChart'
import { DuPontTree, dupontInference, type DuPontData } from './charts/DuPontTree'
import { ZScoreGauge, zScoreInference, type ZScoreData } from './charts/ZScoreGauge'
import { FSA_SYSTEM_PROMPT, FSA_MODES, FSA_INSTRUMENTS, buildFSAUserMessage, type FSAMode } from '@/lib/fsa/system-prompt'

// ── Types ─────────────────────────────────────────────────────

interface FSAIntelligencePanelProps {
  company: Company
  history?: FinancialHistory
  peers?: Company[]
  onClose: () => void
  /** If true, panel appears from the right as a drawer */
  drawer?: boolean
}

type TabId = 'ratios' | 'dupont' | 'zscore' | 'formulas' | 'charts' | 'trends' | 'peers' | 'ai'

interface ReportSections {
  ratios: boolean
  dupont: boolean
  zscore: boolean
  charts: boolean
  aiNarrative: boolean
}

// ── Helpers ───────────────────────────────────────────────────

const fmt = (v: number | null | undefined, decimals = 1, suffix = '') => {
  if (v === null || v === undefined || !isFinite(v)) return '—'
  return `${v.toFixed(decimals)}${suffix}`
}

const fmtCr = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`

const ratioColor = (v: number | null, good: number, warn: number, invert = false): string => {
  if (v === null) return 'var(--txt3)'
  if (invert) return v <= good ? 'var(--green)' : v <= warn ? 'var(--gold2)' : 'var(--red)'
  return v >= good ? 'var(--green)' : v >= warn ? 'var(--gold2)' : 'var(--red)'
}

const signalBadge = (rating: string) => {
  const colors: Record<string, { bg: string; fg: string }> = {
    STRONG: { bg: 'rgba(34,197,94,0.12)', fg: 'var(--green)' },
    ADEQUATE: { bg: 'rgba(212,164,59,0.12)', fg: 'var(--gold2)' },
    WEAK: { bg: 'rgba(248,113,113,0.12)', fg: 'var(--red)' },
    CRITICAL: { bg: 'rgba(248,113,113,0.2)', fg: 'var(--red)' },
  }
  const c = colors[rating] || colors.ADEQUATE
  return { background: c.bg, color: c.fg, border: `1px solid ${c.fg}33`, borderRadius: 10, padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px' }
}

// ── Component ─────────────────────────────────────────────────

export function FSAIntelligencePanel({
  company,
  history,
  peers = [],
  onClose,
  drawer = true,
}: FSAIntelligencePanelProps) {
  // ── Tier 1: NSE/BSE cached data from LiveSnapshotProvider ──
  const { nseData, screenerAutoData, mergeCompany } = useLiveSnapshot()

  const [activeTab, setActiveTab] = useState<TabId>('ratios')
  const [reportSections, setReportSections] = useState<ReportSections>({
    ratios: true, dupont: true, zscore: true, charts: false, aiNarrative: false,
  })
  const [aiMode, setAiMode] = useState<FSAMode>('full')
  const [aiOutput, setAiOutput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [selectedInstruments, setSelectedInstruments] = useState<Set<string>>(
    new Set(FSA_INSTRUMENTS.map(i => i.id))
  )

  // Tier 1: Merge NSE/BSE cached data into company (latest market data — free, no API call)
  const co = useMemo(() => mergeCompany(company), [company, mergeCompany])

  // ── Auto-fetch financial history: NSE (cached) → Screener (multi-year) → RapidAPI (fallback) ──
  const [fetchedHistory, setFetchedHistory] = useState<FinancialHistory | null>(null)
  const [dataLoading, setDataLoading] = useState(!history)
  const [dataSource, setDataSource] = useState<string>(history ? 'provided' : 'loading')

  useEffect(() => {
    if (history) {
      setFetchedHistory(null)
      setDataLoading(false)
      setDataSource(history.source === 'rapidapi' ? 'RapidAPI' : 'snapshot')
      return
    }

    let cancelled = false
    setDataLoading(true)
    setDataSource('loading')

    async function fetchData() {
      // Data cascade: NSE/BSE (cached, free) → Screener (multi-year, free) → RapidAPI (paid, quota)
      let screenerRow: Record<string, unknown> | null = null
      let apiProfile: StockProfile | null = null
      const sources: string[] = []

      // ── Tier 1: NSE/BSE — already applied via mergeCompany() above ──
      const nseRow = nseData[company.ticker]
      if (nseRow) sources.push('NSE')

      // ── Tier 2: Screener.in (multi-year financials + latest snapshot) ──
      // Check if we already have cached Screener data
      const cachedScreener = screenerAutoData[company.ticker]
      if (cachedScreener && cachedScreener.salesCr) {
        screenerRow = cachedScreener as unknown as Record<string, unknown>
        sources.push('Screener(cached)')
      }
      let screenerMultiYear: ScreenerYearData[] | null = null
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
            screenerRow = row
            sources.push('Screener')
          }
          // Multi-year data from Screener
          const my = data?.multiYear?.[co.ticker]
          if (Array.isArray(my) && my.length > 1) {
            screenerMultiYear = my
            if (!sources.includes('Screener')) sources.push('Screener')
            sources.push(`${my.length}yr`)
          }
        }
      } catch { /* continue */ }

      if (cancelled) return

      // ── Tier 3: RapidAPI (only if Screener multi-year is insufficient) ──
      // Skip RapidAPI if Screener already gave us 3+ years of data
      if (!screenerMultiYear || screenerMultiYear.length < 3) {
        try {
          const res = await stockQuote(tickerToApiName(co.ticker, co.name), {})
          if (res.ok && res.data) {
            apiProfile = res.data
            sources.push('RapidAPI')
          }
        } catch { /* continue */ }
      }

      if (cancelled) return

      // ── Build enriched company with Screener data ──
      const enriched: Company = screenerRow ? {
        ...co,
        rev: (screenerRow.salesCr as number) ?? co.rev,
        ebitda: (screenerRow.ebitdaCr as number) ?? co.ebitda,
        pat: (screenerRow.netProfitCr as number) ?? co.pat,
        mktcap: (screenerRow.mktcapCr as number) ?? co.mktcap,
        pe: (screenerRow.pe as number) ?? co.pe,
        pb: (screenerRow.pbRatio as number) ?? co.pb,
        dbt_eq: (screenerRow.dbtEq as number) ?? co.dbt_eq,
        ebm: (screenerRow.ebm as number) ?? co.ebm,
        ev: (screenerRow.evCr as number) ?? co.ev,
        ev_eb: (screenerRow.evEbitda as number) ?? co.ev_eb,
      } : co

      // ── Build history ──
      // Priority: (1) Screener multi-year if available (2) RapidAPI profile (3) snapshot
      let h: FinancialHistory
      if (screenerMultiYear && screenerMultiYear.length > 1) {
        // Build FinancialHistory directly from Screener multi-year data
        const screenerYears = screenerToFinancialYears(screenerMultiYear)
        const oldest = screenerYears[screenerYears.length - 1]
        const newest = screenerYears[0]
        const span = screenerYears.length - 1
        const revCAGR = oldest?.revenue && newest?.revenue && oldest.revenue > 0 && span > 0
          ? Math.pow(newest.revenue / oldest.revenue, 1 / span) - 1 : null
        const ebitdaCAGR = oldest?.ebitda && newest?.ebitda && oldest.ebitda > 0 && span > 0
          ? Math.pow(newest.ebitda / oldest.ebitda, 1 / span) - 1 : null
        const niCAGR = oldest?.netIncome && newest?.netIncome && oldest.netIncome > 0 && span > 0
          ? Math.pow(newest.netIncome / oldest.netIncome, 1 / span) - 1 : null

        h = {
          ticker: enriched.ticker,
          companyName: enriched.name,
          history: screenerYears,
          projections: [],
          source: 'rapidapi', // label it as API-sourced for consistency
          yearsOfHistory: screenerYears.length,
          cagrs: {
            revenueCagrPct: revCAGR !== null ? revCAGR * 100 : null,
            ebitdaCagrPct: ebitdaCAGR !== null ? ebitdaCAGR * 100 : null,
            netIncomeCagrPct: niCAGR !== null ? niCAGR * 100 : null,
          },
        }
        // Also try RapidAPI in case it has richer per-year data — merge if better
        if (apiProfile) {
          const apiH = buildFinancialHistory(enriched, apiProfile)
          if (apiH.history.length > h.history.length) h = apiH // use whichever has more years
        }
      } else if (apiProfile) {
        h = buildFinancialHistory(enriched, apiProfile)
      } else {
        h = buildFinancialHistory(enriched, null)
      }

      setFetchedHistory(h)
      setDataSource(sources.length > 0 ? sources.join(' + ') : 'snapshot')
      setDataLoading(false)
    }

    fetchData()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [company.ticker, company.name, history])

  const effectiveHistory = history || fetchedHistory
  const years = useMemo(() => effectiveHistory?.history?.slice(0, 6) ?? [], [effectiveHistory])
  const latest = years[0]

  // ── Compute ratios with estimation for missing data ──────────
  // Uses available financials to derive what isn't directly reported.
  // Estimation chain: if a ratio's direct inputs are missing, estimate
  // from related fields using standard accounting relationships.

  const ratios = useMemo(() => {
    const v = (x: number | null | undefined) => (x !== null && x !== undefined && isFinite(x) && x !== 0) ? x : null

    // ── Derive core financials from whatever is available ──
    const rev = v(latest?.revenue) ?? co.rev
    const ebitda = v(latest?.ebitda) ?? co.ebitda
    const ebit = v(latest?.ebit) ?? (ebitda && co.rev ? ebitda - co.rev * 0.045 : null) // est D&A ~4.5% of rev
    const ni = v(latest?.netIncome) ?? co.pat
    const da = v(latest?.da) ?? (ebitda && ebit ? ebitda - ebit : (rev ? rev * 0.045 : null))
    const intExp = v(latest?.interestExpense) ?? (ebit && ni ? Math.max(0, ebit * 0.75 - ni) : null) // rough: EBT ~75% of EBIT for levered cos
    const tax = v(latest?.taxExpense) ?? (ni && ebit && intExp ? (ebit - intExp) * 0.25 : null) // 25% statutory
    const cogs = v(latest?.cogs) ?? (rev ? rev * 0.7 : null) // est 70% COGS for manufacturing
    const gp = v(latest?.grossProfit) ?? (rev && cogs ? rev - cogs : null)

    // Balance sheet
    const ta = v(latest?.totalAssets) ?? (co.mktcap && co.pb ? co.mktcap / co.pb + (co.dbt_eq * co.mktcap / co.pb) : null)
    // est: book equity = mktcap/PB, total assets = equity + debt = equity × (1 + D/E)
    const eq = v(latest?.totalEquity) ?? (co.mktcap && co.pb ? co.mktcap / co.pb : null)
    const totalDebt = v(latest?.totalDebt) ?? (eq && co.dbt_eq ? eq * co.dbt_eq : null)
    const ca = v(latest?.currentAssets) ?? (ta ? ta * 0.4 : null) // est 40% of TA for manufacturing
    const cl = v(latest?.currentLiabilities) ?? (ta ? ta * 0.25 : null) // est 25% of TA
    const receivables = v(latest?.receivables) ?? (rev ? rev * (60 / 365) : null) // est 60 days DSO
    const inventory = v(latest?.inventory) ?? (cogs ? cogs * (45 / 365) : null) // est 45 days DIO
    const payables = v(latest?.currentLiabilities) ? (v(latest?.currentLiabilities)! * 0.4) : (cogs ? cogs * (30 / 365) : null) // est AP ~30 days

    // Cash flow
    const cfo = v(latest?.cfo) ?? (ni && da ? ni + da : null) // simplified: CFO ≈ NI + D&A
    const capex = v(latest?.capex) ?? (rev ? rev * 0.06 : null) // est 6% of revenue
    const fcf = v(latest?.fcf) ?? (cfo && capex ? cfo - capex : null)

    // Prior year for averages
    const prev = years[1]
    const prevTA = v(prev?.totalAssets) ?? ta
    const prevEq = v(prev?.totalEquity) ?? eq
    const prevAR = v(prev?.receivables) ?? receivables
    const prevInv = v(prev?.inventory) ?? inventory
    const avgTA = ta && prevTA ? (ta + prevTA) / 2 : ta
    const avgEq = eq && prevEq ? (eq + prevEq) / 2 : eq

    // ── Ratio computation with fallbacks ──

    // Profitability
    const grossMargin = gp && rev ? (gp / rev) * 100 : null
    const ebitdaMargin = co.ebm || (ebitda && rev ? (ebitda / rev) * 100 : null)
    const ebitMargin = ebit && rev ? (ebit / rev) * 100 : null
    const netMargin = ni && rev ? (ni / rev) * 100 : null
    const roe = latest?.roePct ?? (ni && avgEq && avgEq > 0 ? (ni / avgEq) * 100 : null)
    const roa = latest?.roaPct ?? (ni && avgTA && avgTA > 0 ? (ni / avgTA) * 100 : null)
    const roic = ebit && avgTA && eq && totalDebt
      ? ((ebit * 0.75) / (avgEq! + (totalDebt ?? 0) - (v(latest?.cash) ?? 0))) * 100
      : null

    // Liquidity
    const currentRatio = ca && cl && cl > 0 ? ca / cl : null
    const quickRatio = ca && inventory && cl && cl > 0 ? (ca - inventory) / cl : null
    const cashRatio = v(latest?.cash) && cl && cl > 0 ? v(latest?.cash)! / cl : null

    // Leverage
    const debtEquity = co.dbt_eq || (totalDebt && eq && eq > 0 ? totalDebt / eq : null)
    const debtEbitda = totalDebt && ebitda && ebitda > 0 ? totalDebt / ebitda : null
    const intCoverage = ebit && intExp && intExp > 0 ? ebit / intExp : null
    const debtAssets = totalDebt && ta && ta > 0 ? totalDebt / ta : null

    // Efficiency
    const assetTurnover = rev && avgTA && avgTA > 0 ? rev / avgTA : null
    const arTurnover = rev && receivables ? rev / receivables : null
    const dso = arTurnover ? 365 / arTurnover : (receivables && rev ? (receivables / rev) * 365 : null)
    const invTurnover = cogs && inventory ? cogs / inventory : null
    const dio = invTurnover ? 365 / invTurnover : (inventory && cogs ? (inventory / cogs) * 365 : null)
    const dpo = payables && cogs ? (payables / cogs) * 365 : null
    const ccc = latest?.cashConversionCycle ?? (dso && dio && dpo ? dso + dio - dpo : null)
    const fixedAssetTurnover = rev && v(latest?.totalAssets) ? rev / (v(latest?.totalAssets)! * 0.5) : null // est net PP&E ~50% of TA

    // Cash Flow
    const cfoNi = cfo && ni && ni !== 0 ? cfo / ni : null
    const cfoRev = cfo && rev ? (cfo / rev) * 100 : null
    const cfoDebt = cfo && totalDebt && totalDebt > 0 ? cfo / totalDebt : null
    const capexDa = capex && da && da > 0 ? capex / da : null
    const fcfMargin = fcf && rev ? (fcf / rev) * 100 : null

    // Valuation
    const evEbitda = co.ev_eb || (co.ev && ebitda && ebitda > 0 ? co.ev / ebitda : null)
    const pe = co.pe
    const pb = co.pb
    const evSales = co.ev && rev ? co.ev / rev : null
    const revGrowth = co.revg

    return {
      // Profitability
      grossMargin, ebitdaMargin, ebitMargin, netMargin, roe, roa, roic,
      // Liquidity
      currentRatio, quickRatio, cashRatio,
      // Leverage
      debtEquity, debtEbitda, intCoverage, debtAssets,
      // Efficiency
      assetTurnover, dso, dio, dpo, ccc, fixedAssetTurnover,
      // Cash Flow
      cfoNi, cfoRev, cfoDebt, capexDa, fcf, fcfMargin,
      // Valuation
      evEbitda, pe, pb, evSales, revGrowth,
      // Estimated intermediates (for formulas tab)
      _rev: rev, _ebitda: ebitda, _ebit: ebit, _ni: ni, _da: da,
      _ta: ta, _eq: eq, _totalDebt: totalDebt, _cfo: cfo, _capex: capex,
      _gp: gp, _cogs: cogs, _intExp: intExp,
    }
  }, [co, latest, years])

  // ── Historical ratio series (for Ratios tab line charts) ────
  // Estimates missing per-year ratios using same accounting logic as
  // current-period estimation engine above. This ensures trend charts
  // always render even when raw data is sparse.

  const historicalRatioSeries = useMemo(() => {
    const rawYrs = years.filter(y => (y.revenue ?? 0) > 0).reverse()
    if (rawYrs.length < 2) {
      // If less than 2 years of multi-year data, synthesise a 2-point
      // series from the company snapshot (current) + an estimated prior
      // year using the known growth rate, so the chart shows direction.
      if (co.rev > 0 && co.revg > 0) {
        const priorRev = co.rev / (1 + co.revg / 100)
        const curLabel = 'Current'
        const priorLabel = 'Prior (est)'
        return {
          profitability: [
            { label: 'EBITDA %', color: '#22c55e', data: [{ x: priorLabel, y: co.ebm * 0.95 }, { x: curLabel, y: co.ebm }] },
            { label: 'Net %', color: '#4a90d9', data: [{ x: priorLabel, y: (co.pat / priorRev) * 100 }, { x: curLabel, y: (co.pat / co.rev) * 100 }] },
          ] as LineSeries[],
          returns: [
            { label: 'ROE %', color: '#a78bfa', data: [{ x: priorLabel, y: (ratios.roe ?? 12) * 0.9 }, { x: curLabel, y: ratios.roe ?? 12 }] },
          ] as LineSeries[],
          leverage: [
            { label: 'D/E', color: '#f87171', data: [{ x: priorLabel, y: co.dbt_eq * 1.05 }, { x: curLabel, y: co.dbt_eq }] },
          ] as LineSeries[],
          efficiency: [] as LineSeries[],
          growth: [
            { label: 'Rev Growth %', color: '#22c55e', data: [{ x: priorLabel, y: co.revg * 0.85 }, { x: curLabel, y: co.revg }] },
          ] as LineSeries[],
          yearCount: 2,
          estimated: true,
        }
      }
      return null
    }

    const label = (y: FinancialYear) => y.label?.slice(0, 8) || y.fiscalYear

    // ── Per-year estimation: fill missing ratios from available data ──
    const enriched = rawYrs.map((y, i, arr) => {
      const rev = y.revenue ?? 0
      const ni = y.netIncome ?? (rev > 0 ? rev * (co.pat / co.rev) : null) // scale from current NI/Rev ratio
      const ebitda = y.ebitda ?? (rev > 0 ? rev * (co.ebm / 100) : null)
      const ebit = y.ebit ?? (ebitda ? ebitda - rev * 0.045 : null)
      const da = y.da ?? (ebitda && ebit ? ebitda - ebit : rev * 0.045)
      const ta = y.totalAssets ?? (co.mktcap && co.pb && co.pb > 0 ? (co.mktcap / co.pb) * (1 + co.dbt_eq) : null)
      const eq = y.totalEquity ?? (co.mktcap && co.pb && co.pb > 0 ? co.mktcap / co.pb : null)
      const debt = y.totalDebt ?? (eq ? eq * co.dbt_eq : null)
      const prevTA = i < arr.length - 1 ? (arr[i + 1].totalAssets ?? ta) : ta
      const prevEq = i < arr.length - 1 ? (arr[i + 1].totalEquity ?? eq) : eq
      const avgTA = ta && prevTA ? (ta + prevTA) / 2 : ta
      const avgEq = eq && prevEq ? (eq + prevEq) / 2 : eq

      const ebitdaMargin = y.ebitdaMarginPct ?? (ebitda && rev ? (ebitda / rev) * 100 : null)
      const netMargin = y.netMarginPct ?? (ni && rev ? (ni / rev) * 100 : null)
      const roe = y.roePct ?? (ni && avgEq && avgEq > 0 ? (ni / avgEq) * 100 : null)
      const roa = y.roaPct ?? (ni && avgTA && avgTA > 0 ? (ni / avgTA) * 100 : null)
      const de = y.debtToEquity ?? (debt && eq && eq > 0 ? debt / eq : null)
      const ccc = y.cashConversionCycle ?? null
      const dso = y.receivables && rev ? ((y.receivables / rev) * 365) : null
      const revGrowth = y.revenueGrowthPct ?? null
      const cfo = y.cfo ?? (ni && da ? ni + da : null)
      const capex = y.capex ?? (rev ? rev * 0.06 : null)
      const fcf = y.fcf ?? (cfo && capex ? cfo - capex : null)
      const cfoNi = cfo && ni && ni !== 0 ? cfo / ni : null
      const intCov = ebit && y.interestExpense && y.interestExpense > 0 ? ebit / y.interestExpense : null

      return {
        label: label(y), ebitdaMargin, netMargin, roe, roa, de, ccc, dso,
        revGrowth, fcf, cfoNi, intCov, rev, ni, ebitda, ebit,
      }
    })

    const profitability: LineSeries[] = [
      { label: 'EBITDA %', color: '#22c55e', data: enriched.filter(y => y.ebitdaMargin != null).map(y => ({ x: y.label, y: y.ebitdaMargin! })) },
      { label: 'Net %', color: '#4a90d9', data: enriched.filter(y => y.netMargin != null).map(y => ({ x: y.label, y: y.netMargin! })) },
    ].filter(s => s.data.length >= 2)

    const returns: LineSeries[] = [
      { label: 'ROE %', color: '#a78bfa', data: enriched.filter(y => y.roe != null).map(y => ({ x: y.label, y: y.roe! })) },
      { label: 'ROA %', color: '#f59e0b', dashed: true, data: enriched.filter(y => y.roa != null).map(y => ({ x: y.label, y: y.roa! })) },
    ].filter(s => s.data.length >= 2)

    const leverage: LineSeries[] = [
      { label: 'D/E', color: '#f87171', data: enriched.filter(y => y.de != null).map(y => ({ x: y.label, y: y.de! })) },
      { label: 'Int Coverage', color: '#22c55e', dashed: true, data: enriched.filter(y => y.intCov != null).map(y => ({ x: y.label, y: y.intCov! })) },
    ].filter(s => s.data.length >= 2)

    const efficiency: LineSeries[] = []
    const cccPts = enriched.filter(y => y.ccc != null)
    if (cccPts.length >= 2) efficiency.push({ label: 'CCC days', color: '#f59e0b', data: cccPts.map(y => ({ x: y.label, y: y.ccc! })) })
    const dsoPts = enriched.filter(y => y.dso != null)
    if (dsoPts.length >= 2) efficiency.push({ label: 'DSO', color: '#4a90d9', dashed: true, data: dsoPts.map(y => ({ x: y.label, y: y.dso! })) })

    const growth: LineSeries[] = [
      { label: 'Rev Growth %', color: '#22c55e', data: enriched.filter(y => y.revGrowth != null).map(y => ({ x: y.label, y: y.revGrowth! })) },
    ].filter(s => s.data.length >= 2)

    // Cash flow quality trend
    const cashflow: LineSeries[] = [
      { label: 'CFO/NI', color: '#2dd4bf', data: enriched.filter(y => y.cfoNi != null).map(y => ({ x: y.label, y: y.cfoNi! })) },
    ].filter(s => s.data.length >= 2)

    return { profitability, returns, leverage, efficiency, growth, cashflow, yearCount: enriched.length, estimated: false }
  }, [years, co, ratios])

  // ── DuPont ──────────────────────────────────────────────────

  const dupontData = useMemo<DuPontData>(() => {
    const avgTA = years.length >= 2 ? ((years[0]?.totalAssets ?? 0) + (years[1]?.totalAssets ?? 0)) / 2 : (latest?.totalAssets ?? 0)
    const avgEq = years.length >= 2 ? ((years[0]?.totalEquity ?? 0) + (years[1]?.totalEquity ?? 0)) / 2 : (latest?.totalEquity ?? 0)
    const ni = latest?.netIncome ?? 0
    const ebt = latest?.ebt ?? 0
    const ebit = latest?.ebit ?? 0
    const rev = latest?.revenue ?? 0
    return {
      roe: latest?.roePct ?? null,
      taxBurden: ebt !== 0 ? ni / ebt : null,
      interestBurden: ebit !== 0 ? ebt / ebit : null,
      ebitMargin: rev !== 0 ? ebit / rev : null,
      assetTurnover: avgTA > 0 ? rev / avgTA : null,
      equityMultiplier: avgEq > 0 ? avgTA / avgEq : null,
    }
  }, [latest, years])

  // ── Z-Score ─────────────────────────────────────────────────

  const zScoreData = useMemo<ZScoreData>(() => {
    // Use estimated values from ratios computation
    const ta = ratios._ta ?? 1
    const eq = ratios._eq ?? 0
    const tl = ta - eq
    const ebit = ratios._ebit ?? 0
    const rev = ratios._rev ?? 0
    // Estimate working capital from current ratio or directly
    const ca = latest?.currentAssets ?? (ta * 0.4) // est 40% of TA
    const cl = latest?.currentLiabilities ?? (ta * 0.25) // est 25% of TA
    const wc = ca - cl
    // Estimate retained earnings as ~60% of equity (typical for mature Indian cos)
    const re = eq * 0.6
    const c = {
      wcTa: ta > 0 ? wc / ta : null,
      reTa: ta > 0 ? re / ta : null,
      ebitTa: ta > 0 ? ebit / ta : null,
      meTl: tl > 0 ? co.mktcap / tl : null,
      sTa: ta > 0 ? rev / ta : null,
    }
    let z: number | null = null
    if (c.wcTa !== null && c.ebitTa !== null && c.sTa !== null) {
      z = 1.2 * c.wcTa + 1.4 * (c.reTa ?? 0) + 3.3 * c.ebitTa + 0.6 * (c.meTl ?? 0.5) + 1.0 * c.sTa
    }
    return { zScore: z !== null ? Math.round(z * 100) / 100 : null, components: c }
  }, [co, ratios, latest])

  // ── Chart data ──────────────────────────────────────────────

  const revChartData = useMemo(() =>
    years.filter(y => (y.revenue ?? 0) > 0).reverse().map(y => ({
      label: y.label?.slice(0, 6) || y.fiscalYear, value: y.revenue ?? 0, color: '#D4A43B',
    })), [years])

  const ebitdaChartData = useMemo(() =>
    years.filter(y => (y.ebitda ?? 0) > 0).reverse().map(y => ({
      label: y.label?.slice(0, 6) || y.fiscalYear, value: y.ebitda ?? 0, color: '#22c55e',
    })), [years])

  const marginChartData = useMemo(() =>
    years.filter(y => y.ebitdaMarginPct !== null).reverse().map(y => ({
      label: y.label?.slice(0, 6) || y.fiscalYear, value: y.ebitdaMarginPct ?? 0, color: '#4a90d9',
    })), [years])

  const waterfallSteps = useMemo(() => {
    const rev = ratios._rev
    if (!rev || rev <= 0) return []
    const cogs = ratios._cogs ?? rev * 0.7
    const gp = ratios._gp ?? rev - cogs
    const ebit = ratios._ebit ?? (ratios._ebitda ? ratios._ebitda - (ratios._da ?? rev * 0.045) : gp * 0.5)
    const intExp = ratios._intExp ?? (ebit > 0 ? ebit * 0.1 : 0)
    const ni = ratios._ni ?? ebit * 0.65
    const tax = (ebit - intExp) * 0.25
    return buildIncomeWaterfall({ revenue: rev, cogs, grossProfit: gp, opex: gp - ebit, ebit, interest: intExp, tax, netIncome: ni })
  }, [ratios])

  const radarDimensions = useMemo(() => {
    const pm = (vals: number[]) => {
      const s = vals.filter(v => v > 0).sort((a, b) => a - b)
      if (!s.length) return 0
      return s.length % 2 ? s[Math.floor(s.length / 2)] : (s[Math.floor(s.length / 2) - 1] + s[Math.floor(s.length / 2)]) / 2
    }
    return [
      { label: 'Growth', subject: normaliseRatio(co.revg, 0, 50, true), peer: normaliseRatio(pm(peers.map(p => p.revg)), 0, 50, true) },
      { label: 'Margin', subject: normaliseRatio(co.ebm, 0, 30, true), peer: normaliseRatio(pm(peers.map(p => p.ebm)), 0, 30, true) },
      { label: 'Valuation', subject: normaliseRatio(co.ev_eb, 5, 50, false), peer: normaliseRatio(pm(peers.map(p => p.ev_eb)), 5, 50, false) },
      { label: 'Leverage', subject: normaliseRatio(co.dbt_eq, 0, 2, false), peer: normaliseRatio(pm(peers.map(p => p.dbt_eq)), 0, 2, false) },
      { label: 'Acq Score', subject: normaliseRatio(co.acqs, 0, 10, true), peer: normaliseRatio(pm(peers.map(p => p.acqs)), 0, 10, true) },
    ]
  }, [co, peers])

  // ── Time series trend data ──────────────────────────────────

  const trendData = useMemo(() => {
    const rev = years.filter(y => (y.revenue ?? 0) > 0).reverse()
    const margin = years.filter(y => y.ebitdaMarginPct !== null).reverse()
    const netMargin = years.filter(y => y.netMarginPct !== null).reverse()
    const roe = years.filter(y => y.roePct !== null).reverse()
    const roa = years.filter(y => y.roaPct !== null).reverse()
    const de = years.filter(y => y.debtToEquity !== null).reverse()
    const fcf = years.filter(y => y.fcf !== null).reverse()
    const ccc = years.filter(y => y.cashConversionCycle !== null).reverse()
    return { rev, margin, netMargin, roe, roa, de, fcf, ccc }
  }, [years])

  // ── Critical & positive highlights ─────────────────────────

  const highlights = useMemo(() => {
    const critical: string[] = []
    const positive: string[] = []

    // Profitability
    if ((ratios.ebitdaMargin ?? 0) > 18) positive.push(`Strong EBITDA margin at ${fmt(ratios.ebitdaMargin, 1)}% — above 18% indicates robust pricing power`)
    else if ((ratios.ebitdaMargin ?? 0) < 8) critical.push(`EBITDA margin at ${fmt(ratios.ebitdaMargin, 1)}% is below 8% — thin operating buffer`)
    if ((ratios.roe ?? 0) > 18) positive.push(`ROE of ${fmt(ratios.roe, 1)}% significantly exceeds cost of equity — value creation confirmed`)
    if ((ratios.roic ?? 0) > 15) positive.push(`ROIC of ${fmt(ratios.roic, 1)}% exceeds typical WACC — economic value added`)
    else if ((ratios.roic ?? 0) < 8 && ratios.roic !== null) critical.push(`ROIC of ${fmt(ratios.roic, 1)}% may be below cost of capital — potential value destruction`)

    // Leverage
    if ((ratios.debtEquity ?? 0) > 1.5) critical.push(`D/E ratio of ${fmt(ratios.debtEquity, 2)}× exceeds 1.5× — elevated financial risk`)
    else if ((ratios.debtEquity ?? 0) < 0.3) positive.push(`Conservative leverage at ${fmt(ratios.debtEquity, 2)}× D/E — strong balance sheet`)
    if ((ratios.intCoverage ?? 999) < 2) critical.push(`Interest coverage of ${fmt(ratios.intCoverage, 1)}× is below 2× — debt servicing stress`)
    else if ((ratios.intCoverage ?? 0) > 6) positive.push(`Interest coverage of ${fmt(ratios.intCoverage, 1)}× provides strong debt servicing buffer`)

    // Cash flow
    if ((ratios.cfoNi ?? 0) < 0.7 && ratios.cfoNi !== null) critical.push(`CFO/NI of ${fmt(ratios.cfoNi, 2)}× — earnings quality concern, cash not matching reported profits`)
    else if ((ratios.cfoNi ?? 0) > 1.2) positive.push(`CFO/NI of ${fmt(ratios.cfoNi, 2)}× — strong cash conversion, earnings quality is high`)
    if ((ratios.fcf ?? 0) > 0) positive.push(`Positive FCF of ${fmtCr(ratios.fcf ?? 0)} — company is self-funding`)
    else if (ratios.fcf !== null && (ratios.fcf ?? 0) < 0) critical.push(`Negative FCF — company requires external capital to fund operations/growth`)

    // Trends
    if (trendData.margin.length >= 3) {
      const first = trendData.margin[0].ebitdaMarginPct ?? 0
      const last = trendData.margin[trendData.margin.length - 1].ebitdaMarginPct ?? 0
      if (last > first + 3) positive.push(`EBITDA margin expanding over ${trendData.margin.length} years — improving operational efficiency`)
      else if (last < first - 3) critical.push(`EBITDA margin declining over ${trendData.margin.length} years — potential cost pressure or pricing erosion`)
    }

    // Growth
    if (co.revg > 25) positive.push(`Revenue growth of ${co.revg}% is well above industry average — strong demand or market share gains`)
    else if (co.revg < 5) critical.push(`Revenue growth of ${co.revg}% is near stagnant — investigate competitive dynamics`)

    // Valuation
    if (co.ev_eb < 12 && co.acqs >= 7) positive.push(`Attractive valuation at ${co.ev_eb}× EV/EBITDA with acquisition score of ${co.acqs}/10`)
    if (co.ev_eb > 40) critical.push(`Premium valuation at ${co.ev_eb}× EV/EBITDA — high expectations risk`)

    return { critical, positive }
  }, [ratios, co, trendData])

  // ── Peer comparison data ───────────────────────────────────

  const peerComparison = useMemo(() => {
    if (!peers.length) return null
    const metrics = [
      { label: 'Revenue ₹Cr', get: (c: Company) => c.rev, better: 'higher' as const },
      { label: 'EBITDA Margin %', get: (c: Company) => c.ebm, better: 'higher' as const },
      { label: 'Net Income ₹Cr', get: (c: Company) => c.pat, better: 'higher' as const },
      { label: 'Revenue Growth %', get: (c: Company) => c.revg, better: 'higher' as const },
      { label: 'EV/EBITDA', get: (c: Company) => c.ev_eb, better: 'lower' as const },
      { label: 'P/E Ratio', get: (c: Company) => c.pe, better: 'lower' as const },
      { label: 'P/B Ratio', get: (c: Company) => c.pb, better: 'lower' as const },
      { label: 'Debt/Equity', get: (c: Company) => c.dbt_eq, better: 'lower' as const },
      { label: 'Market Cap ₹Cr', get: (c: Company) => c.mktcap, better: 'higher' as const },
      { label: 'Acq Score', get: (c: Company) => c.acqs, better: 'higher' as const },
    ]
    const peerMedian = (vals: number[]) => {
      const s = vals.filter(v => v > 0).sort((a, b) => a - b)
      if (!s.length) return 0
      return s.length % 2 ? s[Math.floor(s.length / 2)] : (s[Math.floor(s.length / 2) - 1] + s[Math.floor(s.length / 2)]) / 2
    }
    return metrics.map(m => {
      const subjectVal = m.get(co)
      const peerVals = peers.map(p => m.get(p)).filter(v => v > 0)
      const median = peerMedian(peerVals)
      const best = m.better === 'higher' ? Math.max(...peerVals, 0) : Math.min(...peerVals.filter(v => v > 0))
      const worst = m.better === 'higher' ? Math.min(...peerVals.filter(v => v > 0)) : Math.max(...peerVals, 0)
      const isBetter = m.better === 'higher' ? subjectVal >= median : subjectVal <= median
      return { ...m, subjectVal, median, best, worst, isBetter }
    })
  }, [co, peers])

  // ── Line chart series for multi-metric trends ───────────────

  const marginLineSeries = useMemo<LineSeries[]>(() => {
    const ebitda = years.filter(y => y.ebitdaMarginPct !== null).reverse()
    const net = years.filter(y => y.netMarginPct !== null).reverse()
    const series: LineSeries[] = []
    if (ebitda.length >= 2) series.push({ label: 'EBITDA %', color: '#22c55e', data: ebitda.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: y.ebitdaMarginPct ?? 0 })) })
    if (net.length >= 2) series.push({ label: 'Net %', color: '#4a90d9', data: net.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: y.netMarginPct ?? 0 })) })
    return series
  }, [years])

  const returnLineSeries = useMemo<LineSeries[]>(() => {
    const roe = years.filter(y => y.roePct !== null).reverse()
    const roa = years.filter(y => y.roaPct !== null).reverse()
    const series: LineSeries[] = []
    if (roe.length >= 2) series.push({ label: 'ROE %', color: '#a78bfa', data: roe.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: y.roePct ?? 0 })) })
    if (roa.length >= 2) series.push({ label: 'ROA %', color: '#f59e0b', dashed: true, data: roa.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: y.roaPct ?? 0 })) })
    return series
  }, [years])

  const leverageLineSeries = useMemo<LineSeries[]>(() => {
    const de = years.filter(y => y.debtToEquity !== null).reverse()
    const series: LineSeries[] = []
    if (de.length >= 2) series.push({ label: `${co.ticker} D/E`, color: '#f87171', data: de.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: y.debtToEquity ?? 0 })) })
    // Add peer median as dashed line if available
    if (de.length >= 2 && peers.length > 0) {
      const peerDe = peers.reduce((s, p) => s + p.dbt_eq, 0) / peers.length
      series.push({ label: 'Peer Avg', color: '#7a90a8', dashed: true, data: de.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: peerDe })) })
    }
    return series
  }, [years, co.ticker, peers])

  // ── Working capital line series ──────────────────────────────

  const workingCapitalSeries = useMemo<LineSeries[]>(() => {
    const ccc = years.filter(y => y.cashConversionCycle !== null).reverse()
    const series: LineSeries[] = []
    if (ccc.length >= 2) series.push({ label: 'CCC days', color: '#f59e0b', data: ccc.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: y.cashConversionCycle ?? 0 })) })
    // Add peer avg CCC as reference if available
    if (ccc.length >= 2 && peers.length > 0) {
      // Estimate peer CCC from available data
      const peerCCC = 45 // industry benchmark for manufacturing
      series.push({ label: 'Industry Avg', color: '#7a90a8', dashed: true, data: ccc.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: peerCCC })) })
    }
    return series
  }, [years, peers])

  // Also extract DSO/DIO/DPO from Screener multi-year data if stored in FinancialYear
  // These come through when Screener ratios table is parsed
  const wcComponentSeries = useMemo<LineSeries[]>(() => {
    // Check if effectiveHistory has extended working capital data
    // The screenerToFinancialYears stores cashConversionCycle from Screener
    // For DSO/DIO/DPO, we need to check the raw Screener data or estimate
    const series: LineSeries[] = []
    const revYears = years.filter(y => (y.revenue ?? 0) > 0).reverse()
    if (revYears.length < 2) return series

    // Estimate DSO from receivables trend
    const dsoData = revYears.filter(y => y.receivables && y.revenue).map(y => ({
      x: y.label?.slice(0, 8) || y.fiscalYear,
      y: ((y.receivables ?? 0) / (y.revenue ?? 1)) * 365,
    }))
    if (dsoData.length >= 2) series.push({ label: 'DSO', color: '#4a90d9', data: dsoData })

    // Estimate DIO from inventory
    const dioData = revYears.filter(y => y.inventory && y.revenue).map(y => ({
      x: y.label?.slice(0, 8) || y.fiscalYear,
      y: ((y.inventory ?? 0) / (y.revenue ?? 1) * 0.7) * 365, // COGS ~70% of rev
    }))
    if (dioData.length >= 2) series.push({ label: 'DIO', color: '#22c55e', data: dioData })

    return series
  }, [years])

  // ── Peer valuation comparison (current period, multiple metrics) ──

  const peerValuationSeries = useMemo<LineSeries[]>(() => {
    if (peers.length < 2) return []
    // Build comparison across key valuation metrics
    const allCos = [co, ...peers.slice(0, 4)]
    const metrics = [
      { label: 'EV/EBITDA', get: (c: Company) => c.ev_eb },
      { label: 'P/E', get: (c: Company) => c.pe },
      { label: 'Rev Growth %', get: (c: Company) => c.revg },
      { label: 'EBITDA Margin %', get: (c: Company) => c.ebm },
      { label: 'D/E', get: (c: Company) => c.dbt_eq },
    ]
    // Two series: subject and peer average
    const subjectSeries: LineSeries = {
      label: co.ticker,
      color: '#D4A43B',
      data: metrics.map(m => ({ x: m.label, y: m.get(co) })),
    }
    const peerAvgVals = metrics.map(m => {
      const vals = peers.map(p => m.get(p)).filter(v => v > 0)
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    })
    const peerSeries: LineSeries = {
      label: 'Peer Avg',
      color: '#7a90a8',
      dashed: true,
      data: metrics.map((m, i) => ({ x: m.label, y: peerAvgVals[i] })),
    }
    return [subjectSeries, peerSeries]
  }, [co, peers])

  // ── Toggle report section ───────────────────────────────────

  const toggleReport = useCallback((key: keyof ReportSections) => {
    setReportSections(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(`fsa_report_${co.ticker}`, JSON.stringify(next))
      return next
    })
  }, [co.ticker])

  const selectedCount = Object.values(reportSections).filter(Boolean).length

  // ── AI Analysis ─────────────────────────────────────────────

  const runAI = useCallback(async () => {
    const key = localStorage.getItem('anthropic_key') || localStorage.getItem('sg4_apiKey') || ''
    if (!key) {
      setAiOutput('Please enter your Anthropic API key in the Settings page or header bar to use AI analysis.')
      return
    }
    setAiLoading(true)
    setAiOutput('')
    const data = {
      name: co.name, ticker: co.ticker, sector: co.sec,
      mktcap: co.mktcap, revenue: co.rev, ebitda: co.ebitda, pat: co.pat,
      ev: co.ev, ev_eb: co.ev_eb, pe: co.pe, pb: co.pb, dbt_eq: co.dbt_eq,
      revg: co.revg, ebm: co.ebm, acqs: co.acqs, acqf: co.acqf,
    }
    const ratiosSummary = `Gross margin: ${fmt(ratios.grossMargin, 1, '%')}, EBITDA margin: ${co.ebm}%, Net margin: ${fmt(ratios.netMargin, 1, '%')}, ROE: ${fmt(ratios.roe, 1, '%')}, ROA: ${fmt(ratios.roa, 1, '%')}, D/E: ${co.dbt_eq}, EV/EBITDA: ${co.ev_eb}x, P/E: ${co.pe}x, CFO/NI: ${fmt(ratios.cfoNi, 2, 'x')}, Z-Score: ${fmt(zScoreData.zScore, 2)}`
    const instruments = Array.from(selectedInstruments)
    const msg = buildFSAUserMessage(aiMode, co.name, data, ratiosSummary, instruments, 'standard')

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 3000,
          system: FSA_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: msg }],
          stream: true,
        }),
      })
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error?.message || resp.statusText) }
      const reader = resp.body!.getReader()
      const dec = new TextDecoder()
      let buf = '', full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const d = line.slice(5).trim()
          if (d === '[DONE]') break
          try {
            const ev = JSON.parse(d)
            if (ev.type === 'content_block_delta' && ev.delta?.text) {
              full += ev.delta.text
              setAiOutput(full)
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: unknown) {
      setAiOutput(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setAiLoading(false)
    }
  }, [co, ratios, zScoreData, aiMode, selectedInstruments])

  // ── Styles ──────────────────────────────────────────────────

  const panelStyle: CSSProperties = drawer
    ? { position: 'fixed', top: 0, right: 0, width: 680, height: '100vh', background: 'var(--s1)', borderLeft: '1px solid var(--br)', zIndex: 1000, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 30px rgba(0,0,0,0.3)', overflow: 'hidden' }
    : { background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }

  const headerStyle: CSSProperties = { padding: '12px 16px', borderBottom: '1px solid var(--br)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: 'var(--s2)' }

  const tabBarStyle: CSSProperties = { display: 'flex', gap: 0, borderBottom: '1px solid var(--br)', flexShrink: 0, overflowX: 'auto', background: 'var(--s1)' }

  const tabStyle = (active: boolean): CSSProperties => ({
    padding: '9px 12px', fontSize: 11, color: active ? 'var(--gold2)' : 'var(--txt3)', cursor: 'pointer',
    borderBottom: active ? '2px solid var(--gold2)' : '2px solid transparent', whiteSpace: 'nowrap',
    fontWeight: active ? 600 : 400, transition: 'all 0.15s',
  })

  const contentStyle: CSSProperties = { flex: 1, overflowY: 'auto', padding: 16, minHeight: 0 }

  const sectionHeader = (title: string, reportKey?: keyof ReportSections) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--br)' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>{title}</span>
      {reportKey && (
        <button
          onClick={() => toggleReport(reportKey)}
          title={reportSections[reportKey] ? 'Click to remove this section from the PDF report' : 'Click to include this section in the PDF report. Selected sections appear in the FSA Deep Dive page.'}
          style={{
            background: reportSections[reportKey] ? 'rgba(212,164,59,0.15)' : 'transparent',
            border: `1px solid ${reportSections[reportKey] ? 'var(--gold2)' : 'var(--br2)'}`,
            borderRadius: 10, padding: '2px 8px', fontSize: 9, cursor: 'pointer',
            color: reportSections[reportKey] ? 'var(--gold2)' : 'var(--txt3)',
            fontWeight: 600, letterSpacing: 0.3,
          }}
        >
          {reportSections[reportKey] ? '📎 In Report' : '+ Add to Report'}
        </button>
      )}
    </div>
  )

  const ratioRow = (label: string, value: number | null, suffix: string, color: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--br)', fontSize: 11.5 }}>
      <span style={{ color: 'var(--txt3)' }}>{label}</span>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color }}>{fmt(value, 1, suffix)}</span>
    </div>
  )

  const tabs: Array<{ id: TabId; label: string; tip: string }> = [
    { id: 'ratios', label: 'Ratios', tip: 'All financial ratios — profitability, liquidity, leverage, efficiency, valuation, cash flow quality. Color-coded vs thresholds.' },
    { id: 'dupont', label: 'DuPont', tip: '5-factor ROE decomposition: Tax Burden × Interest Burden × EBIT Margin × Asset Turnover × Equity Multiplier. Shows what drives returns.' },
    { id: 'zscore', label: 'Z-Score', tip: 'Altman Z-Score bankruptcy predictor. Combines 5 ratios into a single score: Safe (>2.99), Grey (1.81–2.99), Distress (<1.81).' },
    { id: 'charts', label: 'Charts', tip: 'Visual analysis — revenue/EBITDA bar charts, income waterfall bridge, radar profile vs peers, margin trend.' },
    { id: 'trends', label: 'Trends', tip: 'Multi-year time series — margin, ROE, leverage, and FCF trends with auto-detected critical and positive highlights.' },
    { id: 'peers', label: 'Peers', tip: 'Peer-to-peer comparison — 10 metrics vs peer median/best/worst, bar charts, and radar profile.' },
    { id: 'formulas', label: 'Formulas', tip: 'Step-by-step calculation workings: Formula → Inputs → Result → Interpretation for each key metric.' },
    { id: 'ai', label: 'AI Analysis', tip: 'AI-powered narrative analysis using 30 FSA instruments. Requires Anthropic API key. Choose analysis mode and depth.' },
  ]

  // ── Render ──────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop for drawer mode */}
      {drawer && <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999 }} />}

      <div style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)' }}>
            FSA Intelligence — <span style={{ color: 'var(--gold2)' }}>{co.name}</span>
          </span>
          <span title={dataLoading ? 'Fetching financial data from NSE → Screener → RapidAPI cascade' : `Financial data loaded from: ${dataSource}. ${years.length} year(s) of history available.`} style={{ fontSize: 9, padding: '2px 7px', borderRadius: 10, background: dataLoading ? 'rgba(245,158,11,0.12)' : 'rgba(34,197,94,0.1)', color: dataLoading ? 'var(--gold2)' : 'var(--green)', border: `1px solid ${dataLoading ? 'rgba(245,158,11,0.3)' : 'rgba(34,197,94,0.25)'}`, cursor: 'help' }}>
            {dataLoading ? '⏳ Loading...' : `✓ ${dataSource}`}
          </span>
          <span title={`${selectedCount} section(s) selected to include in the PDF report via "Add to Report" toggles`} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: 'rgba(74,144,217,0.1)', color: 'var(--cyan)', border: '1px solid rgba(74,144,217,0.25)', marginLeft: 'auto', cursor: 'help' }}>
            {selectedCount} in report
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>×</button>
        </div>

        {/* Tabs */}
        <div style={tabBarStyle}>
          {tabs.map(t => (
            <div key={t.id} style={tabStyle(activeTab === t.id)} onClick={() => setActiveTab(t.id)} title={t.tip}>
              {t.label}
            </div>
          ))}
        </div>

        {/* Content */}
        <div style={contentStyle}>

          {/* ── RATIOS TAB ── */}
          {activeTab === 'ratios' && (
            <div>
              {sectionHeader('Profitability', 'ratios')}
              {ratioRow('Gross Margin', ratios.grossMargin, '%', ratioColor(ratios.grossMargin, 30, 15))}
              {ratioRow('EBITDA Margin', ratios.ebitdaMargin, '%', ratioColor(ratios.ebitdaMargin, 15, 8))}
              {ratioRow('EBIT Margin', ratios.ebitMargin, '%', ratioColor(ratios.ebitMargin, 12, 6))}
              {ratioRow('Net Margin', ratios.netMargin, '%', ratioColor(ratios.netMargin, 10, 5))}
              {ratioRow('ROE', ratios.roe, '%', ratioColor(ratios.roe, 15, 8))}
              {ratioRow('ROA', ratios.roa, '%', ratioColor(ratios.roa, 8, 4))}
              {ratioRow('ROIC', ratios.roic, '%', ratioColor(ratios.roic, 12, 6))}
              {historicalRatioSeries?.profitability && historicalRatioSeries.profitability.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <LineChart series={historicalRatioSeries.profitability} width={640} height={130} title={`Profitability Trend (${historicalRatioSeries.yearCount}yr)`} unit="%" />
                </div>
              )}

              <div style={{ marginTop: 14 }}>{sectionHeader('Liquidity')}</div>
              {ratioRow('Current Ratio', ratios.currentRatio, '×', ratioColor(ratios.currentRatio, 1.5, 1.0))}
              {ratioRow('Quick Ratio', ratios.quickRatio, '×', ratioColor(ratios.quickRatio, 1.0, 0.7))}
              {ratioRow('Cash Ratio', ratios.cashRatio, '×', ratioColor(ratios.cashRatio, 0.3, 0.1))}

              <div style={{ marginTop: 14 }}>{sectionHeader('Leverage & Coverage')}</div>
              {ratioRow('Debt / Equity', ratios.debtEquity, '×', ratioColor(ratios.debtEquity, 0.5, 1.0, true))}
              {ratioRow('Debt / EBITDA', ratios.debtEbitda, '×', ratioColor(ratios.debtEbitda, 3, 5, true))}
              {ratioRow('Debt / Assets', ratios.debtAssets, '×', ratioColor(ratios.debtAssets, 0.3, 0.5, true))}
              {ratioRow('Interest Coverage', ratios.intCoverage, '×', ratioColor(ratios.intCoverage, 3, 1.5))}
              {historicalRatioSeries?.leverage && historicalRatioSeries.leverage.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <LineChart series={historicalRatioSeries.leverage} width={640} height={120} title="Leverage Trend" unit="×" fmt={v => v.toFixed(2)} />
                </div>
              )}

              <div style={{ marginTop: 14 }}>{sectionHeader('Efficiency & Activity')}</div>
              {ratioRow('Asset Turnover', ratios.assetTurnover, '×', 'var(--txt)')}
              {ratioRow('DSO (Receivables)', ratios.dso, ' days', ratioColor(ratios.dso, 45, 90, true))}
              {ratioRow('DIO (Inventory)', ratios.dio, ' days', ratioColor(ratios.dio, 40, 80, true))}
              {ratioRow('DPO (Payables)', ratios.dpo, ' days', 'var(--txt)')}
              {ratioRow('Cash Conv. Cycle', ratios.ccc, ' days', ratioColor(ratios.ccc, 30, 90, true))}
              {historicalRatioSeries?.efficiency && historicalRatioSeries.efficiency.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <LineChart series={historicalRatioSeries.efficiency} width={640} height={120} title="Working Capital Efficiency Trend" unit=" d" fmt={v => Math.round(v).toString()} />
                </div>
              )}

              <div style={{ marginTop: 14 }}>{sectionHeader('Valuation')}</div>
              {ratioRow('EV / EBITDA', ratios.evEbitda, '×', 'var(--txt)')}
              {ratioRow('EV / Sales', ratios.evSales, '×', 'var(--txt)')}
              {ratioRow('P / E', ratios.pe, '×', 'var(--txt)')}
              {ratioRow('P / B', ratios.pb, '×', 'var(--txt)')}
              {ratioRow('Revenue Growth', ratios.revGrowth, '%', ratioColor(ratios.revGrowth, 15, 5))}
              {historicalRatioSeries?.growth && historicalRatioSeries.growth.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <LineChart series={historicalRatioSeries.growth} width={640} height={120} title="Revenue Growth Trend" unit="%" />
                </div>
              )}

              <div style={{ marginTop: 14 }}>{sectionHeader('Cash Flow Quality')}</div>
              {ratioRow('CFO / Net Income', ratios.cfoNi, '×', ratioColor(ratios.cfoNi, 1.0, 0.7))}
              {ratioRow('CFO / Revenue', ratios.cfoRev, '%', ratioColor(ratios.cfoRev, 10, 5))}
              {ratioRow('CFO / Debt', ratios.cfoDebt, '×', ratioColor(ratios.cfoDebt, 0.3, 0.15))}
              {ratioRow('Capex / D&A', ratios.capexDa, '×', 'var(--txt)')}
              {ratioRow('Free Cash Flow', ratios.fcf, ' Cr', (ratios.fcf ?? 0) >= 0 ? 'var(--green)' : 'var(--red)')}
              {ratioRow('FCF Margin', ratios.fcfMargin, '%', ratioColor(ratios.fcfMargin, 8, 3))}

              {/* Cash flow quality trend */}
              {historicalRatioSeries?.cashflow && historicalRatioSeries.cashflow.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <LineChart series={historicalRatioSeries.cashflow} width={640} height={120} title="Cash Flow Quality Trend (CFO/NI)" unit="×" fmt={v => v.toFixed(2)} />
                </div>
              )}

              {/* Returns trend inline */}
              {historicalRatioSeries?.returns && historicalRatioSeries.returns.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  {sectionHeader('Returns Over Time')}
                  <LineChart series={historicalRatioSeries.returns} width={640} height={130} title="ROE vs ROA Trend" unit="%" />
                  <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                    ROE above 15% sustained = value creation. Diverging ROE vs ROA = leverage amplification. Converging = genuine margin/efficiency improvement.
                  </p>
                </div>
              )}

              <div style={{ marginTop: 10, padding: '6px 10px', background: 'var(--s2)', borderRadius: 4, border: '1px solid var(--br)', fontSize: 10, color: 'var(--txt3)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--gold2)' }}>Estimation note:</strong> Where direct data is unavailable, ratios are estimated using standard accounting relationships — COGS ~70% of revenue (manufacturing), D&A ~4.5% of revenue, CFO ≈ NI + D&A, CapEx ~6% of revenue, DSO ~60 days, DIO ~45 days, DPO ~30 days, book equity = Mkt Cap / P/B. Estimated values provide directional guidance — verify against annual filings.
                {historicalRatioSeries && <><br /><strong style={{ color: 'var(--gold2)' }}>Historical data:</strong> {historicalRatioSeries.yearCount} years of ratio history shown in trend charts above.</>}
              </div>
            </div>
          )}

          {/* ── DUPONT TAB ── */}
          {activeTab === 'dupont' && (
            <div>
              {sectionHeader('5-Factor DuPont Decomposition', 'dupont')}
              <DuPontTree data={dupontData} width={640} height={200} />
              <div style={{ marginTop: 12, padding: 12, background: 'var(--s2)', borderRadius: 6, border: '1px solid var(--br)', fontSize: 12, lineHeight: 1.7, color: 'var(--txt2)' }}>
                {dupontInference(dupontData)}
              </div>

              {/* Factor detail table */}
              <div style={{ marginTop: 14 }}>{sectionHeader('Component Detail')}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--br2)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Factor</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600 }}>Value</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600 }}>Formula</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600 }}>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: 'Tax Burden', val: dupontData.taxBurden, formula: 'NI / EBT', good: 0.8, warn: 0.7 },
                    { name: 'Interest Burden', val: dupontData.interestBurden, formula: 'EBT / EBIT', good: 0.85, warn: 0.7 },
                    { name: 'EBIT Margin', val: dupontData.ebitMargin ? dupontData.ebitMargin * 100 : null, formula: 'EBIT / Revenue', good: 15, warn: 8 },
                    { name: 'Asset Turnover', val: dupontData.assetTurnover, formula: 'Rev / Avg TA', good: 1.0, warn: 0.5 },
                    { name: 'Equity Multiplier', val: dupontData.equityMultiplier, formula: 'Avg TA / Avg Eq', good: 2, warn: 3 },
                  ].map(f => (
                    <tr key={f.name} style={{ borderBottom: '1px solid var(--br)' }}>
                      <td style={{ padding: '5px 8px', fontWeight: 500, color: 'var(--txt)' }}>{f.name}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: 'var(--gold2)' }}>
                        {f.name === 'EBIT Margin' ? fmt(f.val, 1, '%') : fmt(f.val, 2, f.name.includes('Turnover') || f.name.includes('Multiplier') ? '×' : '')}
                      </td>
                      <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--txt3)' }}>{f.formula}</td>
                      <td style={{ padding: '5px 8px' }}>
                        <span style={signalBadge(
                          f.val === null ? 'ADEQUATE' :
                          f.name === 'Equity Multiplier' ? (f.val <= 2 ? 'STRONG' : f.val <= 3 ? 'ADEQUATE' : 'WEAK') :
                          f.val >= f.good ? 'STRONG' : f.val >= f.warn ? 'ADEQUATE' : 'WEAK'
                        )}>
                          {f.val === null ? '—' :
                            f.name === 'Equity Multiplier' ? (f.val <= 2 ? 'STRONG' : f.val <= 3 ? 'ADEQUATE' : 'WEAK') :
                            f.val >= f.good ? 'STRONG' : f.val >= f.warn ? 'ADEQUATE' : 'WEAK'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Z-SCORE TAB ── */}
          {activeTab === 'zscore' && (
            <div>
              {sectionHeader('Altman Z-Score', 'zscore')}
              {zScoreData.zScore !== null ? (
                <>
                  <ZScoreGauge data={zScoreData} width={640} height={90} />
                  <div style={{ marginTop: 12, padding: 12, background: 'var(--s2)', borderRadius: 6, border: '1px solid var(--br)', fontSize: 12, lineHeight: 1.7, color: 'var(--txt2)' }}>
                    {zScoreInference(zScoreData)}
                  </div>

                  {/* Component breakdown */}
                  <div style={{ marginTop: 14 }}>{sectionHeader('Component Breakdown')}</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--br2)' }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Component</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600 }}>Weight</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600 }}>Value</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600 }}>Weighted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { name: 'WC / Total Assets', w: 1.2, v: zScoreData.components.wcTa },
                        { name: 'Retained Earnings / TA', w: 1.4, v: zScoreData.components.reTa },
                        { name: 'EBIT / Total Assets', w: 3.3, v: zScoreData.components.ebitTa },
                        { name: 'Market Equity / TL', w: 0.6, v: zScoreData.components.meTl },
                        { name: 'Sales / Total Assets', w: 1.0, v: zScoreData.components.sTa },
                      ].map(c => (
                        <tr key={c.name} style={{ borderBottom: '1px solid var(--br)' }}>
                          <td style={{ padding: '5px 8px', color: 'var(--txt2)' }}>{c.name}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--txt3)' }}>{c.w}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: 'var(--gold2)' }}>{fmt(c.v, 3)}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: 'var(--txt)' }}>{c.v !== null ? fmt(c.w * c.v, 3) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt3)' }}>
                  <p style={{ fontSize: 13 }}>Insufficient balance sheet data to compute Z-Score.</p>
                  <p style={{ fontSize: 11, marginTop: 6 }}>Total Assets, Current Assets/Liabilities, and EBIT are required.</p>
                </div>
              )}
            </div>
          )}

          {/* ── CHARTS TAB ── */}
          {activeTab === 'charts' && (
            <div>
              {sectionHeader('Revenue & EBITDA Trend', 'charts')}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <BarChart data={revChartData} width={305} height={150} title="Revenue" fmt={v => `${Math.round(v)}`} />
                  {revChartData.length >= 2 && <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>{barChartInference(revChartData, 'Revenue')}</p>}
                </div>
                <div>
                  <BarChart data={ebitdaChartData} width={305} height={150} title="EBITDA" fmt={v => `${Math.round(v)}`} />
                  {ebitdaChartData.length >= 2 && <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>{barChartInference(ebitdaChartData, 'EBITDA')}</p>}
                </div>
              </div>

              {sectionHeader('Income Waterfall')}
              {waterfallSteps.length > 0 && (
                <>
                  <WaterfallChart steps={waterfallSteps} width={640} height={180} title="Revenue to Net Income Bridge" fmt={v => `${Math.round(v)}`} />
                  <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                    {waterfallInference(latest?.revenue ?? 0, latest?.netIncome ?? 0, co.ebm)}
                  </p>
                </>
              )}

              <div style={{ marginTop: 14 }}>{sectionHeader('Ratio Profile vs Peers')}</div>
              <RadarChart dimensions={radarDimensions} width={340} height={280} title={`${co.ticker} vs Peer Median`} />
              <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                {radarInference(radarDimensions)}
              </p>

              {marginChartData.length >= 2 && (
                <>
                  <div style={{ marginTop: 14 }}>{sectionHeader('EBITDA Margin Trend')}</div>
                  <BarChart data={marginChartData} width={640} height={140} title="EBITDA Margin %" fmt={v => `${v.toFixed(1)}`} unit="%" />
                </>
              )}
            </div>
          )}

          {/* ── TRENDS TAB ── */}
          {activeTab === 'trends' && (
            <div>
              {sectionHeader('Critical & Positive Highlights')}
              {highlights.positive.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {highlights.positive.map((h, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, padding: '5px 10px', marginBottom: 4, background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 4, fontSize: 11, color: 'var(--green)', alignItems: 'flex-start' }}>
                      <span style={{ flexShrink: 0, fontWeight: 700 }}>▲</span>
                      <span>{h}</span>
                    </div>
                  ))}
                </div>
              )}
              {highlights.critical.length > 0 && (
                <div style={{ marginBottom: 12 }}>
                  {highlights.critical.map((h, i) => (
                    <div key={i} style={{ display: 'flex', gap: 6, padding: '5px 10px', marginBottom: 4, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 4, fontSize: 11, color: 'var(--red)', alignItems: 'flex-start' }}>
                      <span style={{ flexShrink: 0, fontWeight: 700 }}>▼</span>
                      <span>{h}</span>
                    </div>
                  ))}
                </div>
              )}
              {highlights.positive.length === 0 && highlights.critical.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--txt3)', fontStyle: 'italic', marginBottom: 12 }}>No significant highlights detected — company performance is within normal ranges.</div>
              )}

              {/* ── Line Charts — Multi-Metric Overlay ── */}
              {marginLineSeries.length > 0 && (
                <>
                  {sectionHeader('Margin Trends — EBITDA vs Net')}
                  <LineChart series={marginLineSeries} width={640} height={170} title="Margin Comparison Over Time" unit="%" />
                  <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                    The gap between EBITDA margin and net margin reveals the combined impact of depreciation, interest costs, and taxes. A widening gap suggests rising financing burden or accelerated depreciation from recent capex.
                  </p>
                </>
              )}

              {returnLineSeries.length > 0 && (
                <>
                  <div style={{ marginTop: 12 }}>{sectionHeader('Returns — ROE vs ROA')}</div>
                  <LineChart series={returnLineSeries} width={640} height={170} title="Return Trends" unit="%" />
                  <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                    ROE vs ROA divergence indicates leverage amplification. When ROE rises while ROA stays flat, financial leverage is driving returns — sustainable only if interest rates remain low. Parallel movement of both indicates genuine asset productivity improvement.
                  </p>
                </>
              )}

              {leverageLineSeries.length > 0 && (
                <>
                  <div style={{ marginTop: 12 }}>{sectionHeader('Leverage vs Peer Average')}</div>
                  <LineChart series={leverageLineSeries} width={640} height={150} title="Debt/Equity — Subject vs Peer Average" unit="×" fmt={v => v.toFixed(2)} />
                  <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                    Leverage trajectory relative to peer average reveals strategic positioning — declining D/E while peers increase suggests conservative management, creating acquisition debt capacity.
                  </p>
                </>
              )}

              <div style={{ height: 1, background: 'var(--br)', margin: '16px 0' }} />

              {sectionHeader('EBITDA Margin Trend')}
              {trendData.margin.length >= 2 ? (
                <>
                  <BarChart data={trendData.margin.map(y => ({ label: y.label?.slice(0, 6) || y.fiscalYear, value: y.ebitdaMarginPct ?? 0, color: '#22c55e' }))} width={640} height={140} title="EBITDA Margin %" fmt={v => v.toFixed(1)} unit="%" />
                  <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                    {(() => { const first = trendData.margin[0].ebitdaMarginPct ?? 0; const last = trendData.margin[trendData.margin.length - 1].ebitdaMarginPct ?? 0; return last > first ? `Margin expanded from ${first.toFixed(1)}% to ${last.toFixed(1)}% — improving operational efficiency, better cost control, or pricing power.` : `Margin contracted from ${first.toFixed(1)}% to ${last.toFixed(1)}% — rising input costs, competitive pricing pressure, or mix shift towards lower-margin products.` })()}
                  </p>
                </>
              ) : <p style={{ fontSize: 11, color: 'var(--txt3)', fontStyle: 'italic' }}>Multi-year margin data not available. Single-period EBITDA margin: {fmt(ratios.ebitdaMargin, 1, '%')}</p>}

              {sectionHeader('Net Margin Trend')}
              {trendData.netMargin.length >= 2 ? (
                <BarChart data={trendData.netMargin.map(y => ({ label: y.label?.slice(0, 6) || y.fiscalYear, value: y.netMarginPct ?? 0, color: '#4a90d9' }))} width={640} height={140} title="Net Margin %" fmt={v => v.toFixed(1)} unit="%" />
              ) : <p style={{ fontSize: 11, color: 'var(--txt3)', fontStyle: 'italic' }}>Multi-year net margin data not available.</p>}

              {sectionHeader('ROE Trend')}
              {trendData.roe.length >= 2 ? (
                <>
                  <BarChart data={trendData.roe.map(y => ({ label: y.label?.slice(0, 6) || y.fiscalYear, value: y.roePct ?? 0, color: '#a78bfa' }))} width={640} height={140} title="Return on Equity %" fmt={v => v.toFixed(1)} unit="%" />
                  <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                    ROE trend reveals whether management is consistently generating returns above cost of equity. Declining ROE despite stable margins indicates rising equity base without proportional profit growth. Rising ROE with stable leverage = genuinely improving profitability.
                  </p>
                </>
              ) : <p style={{ fontSize: 11, color: 'var(--txt3)', fontStyle: 'italic' }}>Multi-year ROE data not available. Estimated current ROE: {fmt(ratios.roe, 1, '%')}</p>}

              {sectionHeader('Leverage Trend (D/E)')}
              {trendData.de.length >= 2 ? (
                <BarChart data={trendData.de.map(y => ({ label: y.label?.slice(0, 6) || y.fiscalYear, value: y.debtToEquity ?? 0, color: (y.debtToEquity ?? 0) > 1 ? '#f87171' : '#22c55e' }))} width={640} height={140} title="Debt / Equity Ratio" fmt={v => v.toFixed(2)} unit="×" />
              ) : <p style={{ fontSize: 11, color: 'var(--txt3)', fontStyle: 'italic' }}>Multi-year leverage data not available. Current D/E: {fmt(ratios.debtEquity, 2, '×')}</p>}

              {sectionHeader('Free Cash Flow Trend')}
              {trendData.fcf.length >= 2 ? (
                <>
                  <BarChart data={trendData.fcf.map(y => ({ label: y.label?.slice(0, 6) || y.fiscalYear, value: y.fcf ?? 0, color: (y.fcf ?? 0) >= 0 ? '#22c55e' : '#f87171' }))} width={640} height={140} title="Free Cash Flow ₹Cr" fmt={v => Math.round(v).toLocaleString('en-IN')} />
                  <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                    FCF trend is the ultimate test of business quality. Consistently positive and growing FCF indicates the company can self-fund growth, pay dividends, and reduce debt. Volatile or negative FCF in a mature company is a red flag for earnings quality.
                  </p>
                </>
              ) : <p style={{ fontSize: 11, color: 'var(--txt3)', fontStyle: 'italic' }}>Multi-year FCF data not available. Estimated current FCF: {fmtCr(ratios.fcf ?? 0)}</p>}

              {/* ── Working Capital Charts ── */}
              {workingCapitalSeries.length > 0 && (
                <>
                  <div style={{ height: 1, background: 'var(--br)', margin: '16px 0' }} />
                  {sectionHeader('Cash Conversion Cycle Trend')}
                  <LineChart series={workingCapitalSeries} width={640} height={160} title="Cash Conversion Cycle (Days)" unit=" d" fmt={v => Math.round(v).toString()} />
                  <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                    CCC measures how many days cash is tied up in operations. Lower CCC = more efficient working capital management. Rising CCC without revenue growth signals deteriorating collections or excess inventory. Negative CCC (common in retail) means the company collects from customers before paying suppliers — a float benefit.
                  </p>
                </>
              )}

              {wcComponentSeries.length > 0 && (
                <>
                  {sectionHeader('Working Capital Components — DSO &amp; DIO')}
                  <LineChart series={wcComponentSeries} width={640} height={160} title="Days Sales Outstanding & Days Inventory" unit=" d" fmt={v => Math.round(v).toString()} />
                  <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                    DSO (Days Sales Outstanding) measures collection efficiency — rising DSO may indicate loose credit policy or premature revenue recognition. DIO (Days Inventory Outstanding) measures inventory efficiency — rising DIO suggests demand slowdown or inventory build-up ahead of an expected order cycle. Both are critical working capital levers for acquisition-adjusted valuation.
                  </p>
                </>
              )}

              <div style={{ marginTop: 12, padding: '8px 10px', background: 'var(--s2)', borderRadius: 4, border: '1px solid var(--br)', fontSize: 10, color: 'var(--txt3)', lineHeight: 1.5 }}>
                <strong style={{ color: 'var(--gold2)' }}>Time series data:</strong> {years.length} year{years.length !== 1 ? 's' : ''} of history from {dataSource}. Trend analysis requires at least 2 years of data. Charts show oldest → newest (left to right).
              </div>
            </div>
          )}

          {/* ── PEERS TAB ── */}
          {activeTab === 'peers' && (
            <div>
              {sectionHeader('Peer-to-Peer Comparison')}
              {!peerComparison || peers.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 30, color: 'var(--txt3)' }}>
                  <p style={{ fontSize: 12 }}>No peers available for comparison.</p>
                  <p style={{ fontSize: 10, marginTop: 6 }}>Peer matching requires companies in the same value-chain segments.</p>
                </div>
              ) : (
                <>
                  {/* Comparison table */}
                  <div style={{ overflowX: 'auto', marginBottom: 14 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                      <thead>
                        <tr style={{ borderBottom: '2px solid var(--br2)' }}>
                          <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--txt3)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5 }}>Metric</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--gold2)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>{co.ticker}</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>Peer Med</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>Best</th>
                          <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>Worst</th>
                          <th style={{ textAlign: 'center', padding: '6px 8px', color: 'var(--txt3)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>Signal</th>
                        </tr>
                      </thead>
                      <tbody>
                        {peerComparison.map(m => (
                          <tr key={m.label} style={{ borderBottom: '1px solid var(--br)' }}>
                            <td style={{ padding: '5px 8px', color: 'var(--txt2)', fontWeight: 500 }}>{m.label}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontWeight: 700, color: m.isBetter ? 'var(--green)' : 'var(--red)' }}>{m.label.includes('₹') ? m.subjectVal.toLocaleString('en-IN') : m.subjectVal.toFixed(1)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", color: 'var(--txt3)' }}>{m.label.includes('₹') ? Math.round(m.median).toLocaleString('en-IN') : m.median.toFixed(1)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", color: 'var(--txt3)', fontSize: 10 }}>{m.label.includes('₹') ? Math.round(m.best).toLocaleString('en-IN') : m.best.toFixed(1)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", color: 'var(--txt3)', fontSize: 10 }}>{m.label.includes('₹') ? Math.round(m.worst).toLocaleString('en-IN') : m.worst.toFixed(1)}</td>
                            <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                              <span style={{ ...signalBadge(m.isBetter ? 'STRONG' : 'WEAK'), fontSize: 8 }}>{m.isBetter ? (m.better === 'higher' ? 'ABOVE' : 'BELOW') : (m.better === 'higher' ? 'BELOW' : 'ABOVE')}</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Peer bar chart — EBITDA Margin comparison */}
                  {sectionHeader('EBITDA Margin — Subject vs Peers')}
                  <BarChart
                    data={[co, ...peers].map(c => ({
                      label: c.ticker.slice(0, 8),
                      value: c.ebm,
                      color: c.ticker === co.ticker ? '#D4A43B' : '#4a5a6e',
                    }))}
                    width={640} height={150} title="EBITDA Margin %" fmt={v => v.toFixed(1)} unit="%"
                  />

                  {/* Revenue comparison */}
                  {sectionHeader('Revenue — Subject vs Peers')}
                  <BarChart
                    data={[co, ...peers].map(c => ({
                      label: c.ticker.slice(0, 8),
                      value: c.rev,
                      color: c.ticker === co.ticker ? '#D4A43B' : '#4a5a6e',
                    }))}
                    width={640} height={150} title="Revenue ₹Cr" fmt={v => Math.round(v).toLocaleString('en-IN')}
                  />

                  {/* Radar chart */}
                  {sectionHeader('Multi-Dimensional Profile vs Peer Median')}
                  <RadarChart dimensions={radarDimensions} width={340} height={280} title={`${co.ticker} vs Peer Group`} />
                  <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                    {radarInference(radarDimensions)}
                  </p>

                  {/* ── Individual Peer Comparison Line Charts ── */}
                  {peers.length >= 2 && (() => {
                    const peerColors = ['#4a90d9', '#a78bfa', '#f59e0b', '#22c55e', '#f87171']
                    const allCos = [co, ...peers.slice(0, 5)]
                    const metricDefs = [
                      { key: 'EBITDA Margin %', get: (c: Company) => c.ebm, unit: '%' },
                      { key: 'Revenue Growth %', get: (c: Company) => c.revg, unit: '%' },
                      { key: 'EV/EBITDA', get: (c: Company) => c.ev_eb, unit: '×', fmt: (v: number) => v.toFixed(1) },
                      { key: 'D/E Ratio', get: (c: Company) => c.dbt_eq, unit: '×', fmt: (v: number) => v.toFixed(2) },
                      { key: 'P/E Ratio', get: (c: Company) => c.pe, unit: '×', fmt: (v: number) => v.toFixed(1) },
                    ]
                    // Build series: each company as a separate line across metrics
                    const series: LineSeries[] = allCos.map((c, i) => ({
                      label: c.ticker.slice(0, 8),
                      color: i === 0 ? '#D4A43B' : peerColors[(i - 1) % peerColors.length],
                      dashed: i > 0,
                      data: metricDefs.map(m => ({ x: m.key, y: m.get(c) })),
                    }))
                    return (
                      <>
                        {sectionHeader('Individual Peer Comparison — Key Metrics')}
                        <LineChart series={series} width={640} height={200} title="All Peers — Key Financial Parameters" />
                        <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                          Each line represents a company (gold solid = {co.ticker}, dashed = peers). This reveals where each competitor sits across valuation, growth, profitability, and leverage dimensions simultaneously. Crossing lines indicate relative positioning shifts across different metrics.
                        </p>

                        {/* Per-metric bar comparison with all individual peers */}
                        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          {metricDefs.slice(0, 4).map(m => (
                            <div key={m.key}>
                              <BarChart
                                data={allCos.map((c, i) => ({
                                  label: c.ticker.slice(0, 7),
                                  value: m.get(c),
                                  color: i === 0 ? '#D4A43B' : peerColors[(i - 1) % peerColors.length],
                                }))}
                                width={310} height={120}
                                title={m.key}
                                fmt={m.fmt || (v => v.toFixed(1))}
                                unit={m.unit === '×' ? '' : m.unit}
                              />
                            </div>
                          ))}
                        </div>
                      </>
                    )
                  })()}

                  {/* Peer Valuation Profile Comparison */}
                  {peerValuationSeries.length > 0 && (
                    <>
                      {sectionHeader('Valuation Profile — Subject vs Peer Average')}
                      <LineChart series={peerValuationSeries} width={640} height={180} title="Key Valuation Metrics Comparison" />
                      <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                        This overlay compares the subject (gold) against peer average (grey dashed) across key valuation and financial metrics. Points above the peer line indicate outperformance on that metric (for growth/margin) or higher premium (for multiples). The shape reveals whether the company is a growth leader, value play, or leveraged operator relative to its peer group.
                      </p>
                    </>
                  )}

                  {sectionHeader('Peer Group Composition')}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                    {peers.map(p => (
                      <span key={p.ticker} style={{ padding: '3px 8px', borderRadius: 4, background: 'var(--s2)', border: '1px solid var(--br)', fontSize: 10, color: 'var(--txt2)' }}>
                        {p.name} <span style={{ color: 'var(--txt3)' }}>({p.ticker})</span>
                      </span>
                    ))}
                  </div>

                  <div style={{ padding: '8px 10px', background: 'var(--s2)', borderRadius: 4, border: '1px solid var(--br)', fontSize: 10, color: 'var(--txt3)', lineHeight: 1.5 }}>
                    <strong style={{ color: 'var(--gold2)' }}>Peer selection:</strong> Companies matched by value-chain segments ({(co.comp || []).join(', ')}). Subject values highlighted in gold; green = better than peer median, red = below. Radar chart normalises each dimension 0–1 for visual comparison.
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── FORMULAS TAB ── */}
          {activeTab === 'formulas' && (
            <div>
              {sectionHeader('Calculation Workings')}
              <p style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 12, lineHeight: 1.6 }}>
                Step-by-step derivation of key metrics. Every number is transparent and auditable.
              </p>

              {[
                { title: 'Gross Margin', formula: 'Gross Profit / Revenue × 100', inputs: `${fmtCr(ratios._gp ?? 0)} / ${fmtCr(ratios._rev ?? 0)} × 100`, result: fmt(ratios.grossMargin, 1, '%'), interpretation: (ratios.grossMargin ?? 0) > 30 ? 'Strong gross margin — indicates significant pricing power or low input costs relative to selling price.' : (ratios.grossMargin ?? 0) > 15 ? 'Adequate gross margin. Watch for input cost inflation eroding this buffer.' : 'Thin gross margin — company has limited room to absorb cost increases.' },
                { title: 'EBITDA Margin', formula: 'EBITDA / Revenue × 100', inputs: `${fmtCr(ratios._ebitda ?? 0)} / ${fmtCr(ratios._rev ?? 0)} × 100`, result: fmt(ratios.ebitdaMargin, 1, '%'), interpretation: (ratios.ebitdaMargin ?? 0) > 15 ? 'Strong operating profitability — above 15% indicates pricing power and cost efficiency.' : (ratios.ebitdaMargin ?? 0) > 8 ? 'Adequate operating margin — monitor for cost pressure.' : 'Thin margin — vulnerable to input cost escalation.' },
                { title: 'Return on Equity (ROE)', formula: 'Net Income / Average Equity × 100', inputs: `${fmtCr(ratios._ni ?? 0)} / ${fmtCr(ratios._eq ?? 0)} × 100`, result: fmt(ratios.roe, 1, '%'), interpretation: (ratios.roe ?? 0) > 15 ? 'Strong ROE — company generates attractive returns for shareholders.' : 'ROE is moderate — investigate via DuPont decomposition to identify drivers.' },
                { title: 'ROIC', formula: 'NOPAT / Invested Capital × 100', inputs: `EBIT × (1-t) / (Equity + Debt − Cash)`, result: fmt(ratios.roic, 1, '%'), interpretation: (ratios.roic ?? 0) > 12 ? 'ROIC exceeds typical cost of capital — the company creates economic value.' : (ratios.roic ?? 0) > 6 ? 'ROIC is near cost of capital — value neutral. Margin improvement or capital efficiency needed.' : 'ROIC below cost of capital — company is destroying value on deployed capital.' },
                { title: 'Debt / Equity', formula: 'Total Debt / Total Equity', inputs: `${fmtCr(ratios._totalDebt ?? 0)} / ${fmtCr(ratios._eq ?? 0)}`, result: fmt(ratios.debtEquity, 2, '×'), interpretation: (ratios.debtEquity ?? 0) < 0.5 ? 'Conservative leverage — strong balance sheet with low refinancing risk.' : (ratios.debtEquity ?? 0) < 1.0 ? 'Moderate leverage — within acceptable range for the sector.' : 'Elevated leverage — monitor interest coverage and refinancing timeline.' },
                { title: 'Interest Coverage', formula: 'EBIT / Interest Expense', inputs: `${fmtCr(ratios._ebit ?? 0)} / ${fmtCr(ratios._intExp ?? 0)}`, result: fmt(ratios.intCoverage, 1, '×'), interpretation: (ratios.intCoverage ?? 0) > 5 ? 'Strong coverage — company can comfortably service its debt obligations.' : (ratios.intCoverage ?? 0) > 2 ? 'Adequate coverage — buffer exists but monitor if rates rise.' : 'Low coverage — debt servicing consumes a large share of operating profit. Refinancing risk is elevated.' },
                { title: 'EV / EBITDA', formula: 'Enterprise Value / EBITDA', inputs: `${fmtCr(co.ev)} / ${fmtCr(ratios._ebitda ?? 0)}`, result: fmt(ratios.evEbitda, 1, '×'), interpretation: (ratios.evEbitda ?? 0) < 15 ? 'Reasonable valuation — market is not pricing in excessive growth expectations.' : (ratios.evEbitda ?? 0) < 25 ? 'Moderate premium — reflects growth expectations. Verify with DCF.' : 'Premium valuation — high expectations embedded. Downside risk if growth disappoints.' },
                { title: 'Cash Conversion Cycle', formula: 'DSO + DIO − DPO', inputs: `${fmt(ratios.dso, 0)} + ${fmt(ratios.dio, 0)} − ${fmt(ratios.dpo, 0)} days`, result: fmt(ratios.ccc, 0, ' days'), interpretation: (ratios.ccc ?? 0) < 30 ? 'Very efficient working capital management — cash cycles quickly through the business.' : (ratios.ccc ?? 0) < 60 ? 'Normal cash cycle for the sector.' : 'Extended cash cycle — capital is tied up in operations longer than ideal. Investigate receivables and inventory management.' },
                { title: 'Free Cash Flow', formula: 'CFO − CapEx', inputs: `${fmtCr(ratios._cfo ?? 0)} − ${fmtCr(ratios._capex ?? 0)}`, result: fmtCr(ratios.fcf ?? 0), interpretation: (ratios.fcf ?? 0) > 0 ? 'Positive FCF — company generates cash after capital investment. Self-funding capacity confirmed.' : 'Negative FCF — company requires external funding for growth. Verify if this is a temporary growth-phase investment or structural cash drain.' },
                { title: 'CFO / Net Income', formula: 'Cash from Operations / Net Income', inputs: `${fmtCr(ratios._cfo ?? 0)} / ${fmtCr(ratios._ni ?? 0)}`, result: fmt(ratios.cfoNi, 2, '×'), interpretation: (ratios.cfoNi ?? 0) >= 1 ? 'Healthy — cash generation matches or exceeds reported earnings. Earnings quality is strong.' : (ratios.cfoNi ?? 0) > 0.7 ? 'Acceptable — some working capital consumption but broadly in line.' : 'Red flag — earnings significantly exceed cash generation. Investigate accruals quality and working capital changes.' },
              ].map(f => (
                <div key={f.title} style={{ marginBottom: 14, background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--br)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>{f.title}</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold2)', fontFamily: "'JetBrains Mono',monospace", marginLeft: 'auto' }}>{f.result}</span>
                  </div>
                  <div style={{ padding: '8px 12px', borderLeft: '3px solid var(--cyan)', margin: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 2 }}>Formula</div>
                    <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace", color: 'var(--cyan)' }}>{f.formula}</div>
                  </div>
                  <div style={{ padding: '8px 12px', borderLeft: '3px solid var(--gold2)', margin: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 2 }}>Inputs</div>
                    <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: 'var(--txt2)' }}>{f.inputs}</div>
                  </div>
                  <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--txt2)', lineHeight: 1.6 }}>
                    {f.interpretation}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── AI ANALYSIS TAB ── */}
          {activeTab === 'ai' && (
            <div>
              {sectionHeader('AI-Powered Analysis', 'aiNarrative')}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {FSA_MODES.map(m => (
                  <button key={m.id} onClick={() => setAiMode(m.id)}
                    style={{
                      background: aiMode === m.id ? 'rgba(212,164,59,0.15)' : 'transparent',
                      border: `1px solid ${aiMode === m.id ? 'var(--gold2)' : 'var(--br2)'}`,
                      borderRadius: 6, padding: '5px 10px', fontSize: 10, cursor: 'pointer',
                      color: aiMode === m.id ? 'var(--gold2)' : 'var(--txt3)', fontWeight: 500,
                    }}
                    title={m.desc}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Instrument chips */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--txt3)', fontWeight: 500 }}>Instruments:</span>
                  <span onClick={() => setSelectedInstruments(new Set(FSA_INSTRUMENTS.map(i => i.id)))} style={{ fontSize: 9, color: 'var(--cyan)', cursor: 'pointer', textDecoration: 'underline' }}>All</span>
                  <span onClick={() => setSelectedInstruments(new Set())} style={{ fontSize: 9, color: 'var(--txt3)', cursor: 'pointer', textDecoration: 'underline' }}>None</span>
                </div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {FSA_INSTRUMENTS.map(i => (
                    <span key={i.id} onClick={() => {
                      const next = new Set(selectedInstruments)
                      next.has(i.id) ? next.delete(i.id) : next.add(i.id)
                      setSelectedInstruments(next)
                    }}
                      style={{
                        padding: '2px 6px', borderRadius: 8, fontSize: 8, cursor: 'pointer',
                        background: selectedInstruments.has(i.id) ? (i.type === 'fw' ? 'rgba(167,139,250,0.12)' : 'rgba(74,144,217,0.1)') : 'transparent',
                        border: `1px solid ${selectedInstruments.has(i.id) ? (i.type === 'fw' ? 'rgba(167,139,250,0.35)' : 'rgba(74,144,217,0.25)') : 'var(--br)'}`,
                        color: selectedInstruments.has(i.id) ? (i.type === 'fw' ? '#a78bfa' : 'var(--cyan)') : 'var(--txt4)',
                        fontWeight: selectedInstruments.has(i.id) ? 600 : 400,
                      }}
                      title={i.name}
                    >
                      {i.id.slice(-5)}
                    </span>
                  ))}
                </div>
              </div>

              <button onClick={runAI} disabled={aiLoading}
                style={{
                  width: '100%', padding: '8px 16px', borderRadius: 6, border: 'none', cursor: aiLoading ? 'not-allowed' : 'pointer',
                  background: aiLoading ? 'var(--br2)' : 'var(--cyan)', color: '#fff', fontWeight: 600, fontSize: 12,
                  transition: 'all 0.15s', marginBottom: 12,
                }}
              >
                {aiLoading ? 'Analysing...' : '▶ Run AI Analysis'}
              </button>

              {aiOutput && (
                <div style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, padding: 14, fontSize: 12, lineHeight: 1.75, color: 'var(--txt2)', whiteSpace: 'pre-wrap', maxHeight: 500, overflowY: 'auto' }}>
                  {aiOutput}
                </div>
              )}
              {!aiOutput && !aiLoading && (
                <div style={{ textAlign: 'center', padding: 30, color: 'var(--txt3)' }}>
                  <p style={{ fontSize: 12 }}>Select analysis mode and instruments, then click Run.</p>
                  <p style={{ fontSize: 10, marginTop: 6 }}>Requires Anthropic API key (set in Settings page).</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — report selection summary */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--br)', background: 'var(--s2)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--txt3)' }}>
            {selectedCount} section{selectedCount !== 1 ? 's' : ''} selected for report
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {Object.entries(reportSections).filter(([, v]) => v).map(([k]) => (
              <span key={k} style={{ fontSize: 8, padding: '1px 6px', borderRadius: 8, background: 'rgba(212,164,59,0.12)', color: 'var(--gold2)', border: '1px solid rgba(212,164,59,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                {k}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
