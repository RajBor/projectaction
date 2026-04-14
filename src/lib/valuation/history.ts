/**
 * Multi-year financial history store.
 *
 * The goal is to answer "what is the per-year history of Revenue, EBITDA,
 * Net Income, Working Capital, CapEx, ROE, etc. for this company?" with a
 * single structured bundle the report template can render.
 *
 * Priority of sources (highest wins):
 *   1. A user-uploaded document (currently only seeded from RapidAPI
 *      via `parseAnnualReportFinancials` — no PDF text extraction yet)
 *   2. RapidAPI stockQuote.financials[] (up to 6 annual periods)
 *   3. The single-snapshot `Company` model as a last-period fallback
 *
 * User projections are kept in a separate `projections[]` array and
 * never mixed with historical periods. Report consumers always see
 * history and projections as two distinct lists.
 *
 * Persistence: `sg4_fin_history_<TICKER>` in localStorage (optional).
 * The report page can call `buildFinancialHistory()` on the fly without
 * persistence — the store is for capturing user-entered projections
 * or manual edits.
 */

import type { Company } from '@/lib/data/companies'
import { formatInrCr } from '@/lib/format'
import type { StockProfile } from '@/lib/stocks/api'
import {
  parseAnnualReportFinancials,
  enrichWithPriorYearBalances,
  type AnnualPeriod,
} from '@/lib/fsa/annual-report'

export interface FinancialYear {
  label: string
  fiscalYear: string
  endDate: string
  type: 'Annual' | 'Interim' | 'Projection'
  revenue: number | null
  cogs: number | null
  grossProfit: number | null
  ebitda: number | null
  ebit: number | null
  da: number | null
  interestExpense: number | null
  ebt: number | null
  taxExpense: number | null
  netIncome: number | null
  cash: number | null
  receivables: number | null
  inventory: number | null
  currentAssets: number | null
  currentLiabilities: number | null
  totalAssets: number | null
  totalEquity: number | null
  totalDebt: number | null
  cfo: number | null
  capex: number | null
  fcf: number | null
  /** Derived: revenue growth vs prior year (%). */
  revenueGrowthPct: number | null
  /** Derived: EBITDA margin (%). */
  ebitdaMarginPct: number | null
  /** Derived: Net margin (%). */
  netMarginPct: number | null
  /** Derived: Return on equity (%). */
  roePct: number | null
  /** Derived: Return on assets (%). */
  roaPct: number | null
  /** Derived: Net working capital (current assets − current liabilities). */
  netWorkingCapital: number | null
  /** Derived: Working-capital turnover (Revenue / Avg NWC). */
  nwcTurnover: number | null
  /** Derived: Cash conversion cycle proxy (days). */
  cashConversionCycle: number | null
  /** Derived: Debt / Equity. */
  debtToEquity: number | null
}

export interface FinancialHistory {
  ticker: string
  companyName: string
  /** Historical years, newest first. */
  history: FinancialYear[]
  /** User-entered forward projections, oldest first. */
  projections: FinancialYear[]
  /** Provenance of the history data. */
  source: 'rapidapi' | 'company-snapshot' | 'manual'
  /** Number of years of history we were able to assemble. */
  yearsOfHistory: number
  /** High-level CAGR drivers, computed across the full history span. */
  cagrs: {
    revenueCagrPct: number | null
    ebitdaCagrPct: number | null
    netIncomeCagrPct: number | null
  }
}

// ── Internal helpers ──────────────────────────────────────────

function emptyYear(): FinancialYear {
  return {
    label: '',
    fiscalYear: '',
    endDate: '',
    type: 'Annual',
    revenue: null,
    cogs: null,
    grossProfit: null,
    ebitda: null,
    ebit: null,
    da: null,
    interestExpense: null,
    ebt: null,
    taxExpense: null,
    netIncome: null,
    cash: null,
    receivables: null,
    inventory: null,
    currentAssets: null,
    currentLiabilities: null,
    totalAssets: null,
    totalEquity: null,
    totalDebt: null,
    cfo: null,
    capex: null,
    fcf: null,
    revenueGrowthPct: null,
    ebitdaMarginPct: null,
    netMarginPct: null,
    roePct: null,
    roaPct: null,
    netWorkingCapital: null,
    nwcTurnover: null,
    cashConversionCycle: null,
    debtToEquity: null,
  }
}

function fromAnnualPeriod(period: AnnualPeriod): FinancialYear {
  const i = period.inputs
  const year = emptyYear()
  year.label = period.label
  year.fiscalYear = period.fiscalYear
  year.endDate = period.endDate
  year.type = period.type
  year.revenue = i.revenue ?? null
  year.cogs = i.cogs ?? null
  year.grossProfit = i.grossProfit ?? null
  year.ebit = i.ebit ?? null
  year.da = i.da ?? null
  year.interestExpense = i.interestExpense ?? null
  year.ebt = i.ebt ?? null
  year.taxExpense = i.taxExpense ?? null
  year.netIncome = i.netIncome ?? null
  year.cash = i.cash ?? null
  year.receivables = i.receivablesEnd ?? null
  year.inventory = i.inventoryEnd ?? null
  year.currentAssets = i.currentAssets ?? null
  year.currentLiabilities = i.currentLiabilities ?? null
  year.totalAssets = i.totalAssetsEnd ?? null
  year.totalEquity = i.totalEquityEnd ?? null
  year.totalDebt = i.totalDebt ?? null
  year.cfo = i.cfo ?? null
  year.capex = i.capex ?? null
  // Derived EBITDA from EBIT + D&A
  if (year.ebit != null && year.da != null) {
    year.ebitda = year.ebit + year.da
  }
  return year
}

function fromCompanySnapshot(co: Company): FinancialYear {
  const year = emptyYear()
  year.label = 'LTM'
  year.fiscalYear = String(new Date().getFullYear())
  year.type = 'Annual'
  year.revenue = co.rev || null
  year.ebitda = co.ebitda || null
  year.netIncome = co.pat || null
  // Estimate ebit as 70% of ebitda (matches data-source.ts heuristic)
  if (co.ebitda > 0) {
    year.ebit = Math.round(co.ebitda * 0.7)
    year.da = co.ebitda - year.ebit
  }
  // Debt derived from EV − MarketCap
  if (co.ev > 0 && co.mktcap > 0) {
    year.totalDebt = Math.max(0, co.ev - co.mktcap)
  }
  // Equity derived from Price/Book × Mktcap
  if (co.pb > 0 && co.mktcap > 0) {
    year.totalEquity = co.mktcap / co.pb
  }

  // ── Snapshot-based ratio seeds so the UI is never fully blank ──
  // These come straight from the DealNector COMPANIES record and act
  // as the "last resort" fallback before `deriveAndAnnotate` runs.
  if (Number.isFinite(co.revg)) year.revenueGrowthPct = co.revg
  if (Number.isFinite(co.ebm)) year.ebitdaMarginPct = co.ebm
  if (co.rev && co.rev > 0 && Number.isFinite(co.pat)) {
    year.netMarginPct = (co.pat / co.rev) * 100
  }
  if (Number.isFinite(co.dbt_eq)) year.debtToEquity = co.dbt_eq
  // ROE estimate: PAT ÷ book-value (book-value = mktcap/pb)
  if (co.pb > 0 && co.mktcap > 0 && Number.isFinite(co.pat)) {
    const bookValue = co.mktcap / co.pb
    if (bookValue > 0) year.roePct = (co.pat / bookValue) * 100
  }
  return year
}

// ── Derivations + annotation ──────────────────────────────────

function deriveAndAnnotate(years: FinancialYear[]): FinancialYear[] {
  // Newest first. Walk in reverse so prior-year references are cheap.
  for (let idx = 0; idx < years.length; idx++) {
    const y = years[idx]
    const prior = years[idx + 1] ?? null

    // Free cash flow (simple: CFO − CapEx)
    if (y.cfo != null && y.capex != null) {
      y.fcf = y.cfo - y.capex
    }

    // Revenue growth vs prior
    if (y.revenue != null && prior?.revenue && prior.revenue !== 0) {
      y.revenueGrowthPct =
        ((y.revenue - prior.revenue) / prior.revenue) * 100
    }

    // Margins
    if (y.revenue && y.revenue !== 0) {
      if (y.ebitda != null) y.ebitdaMarginPct = (y.ebitda / y.revenue) * 100
      if (y.netIncome != null) y.netMarginPct = (y.netIncome / y.revenue) * 100
    }

    // NWC
    if (y.currentAssets != null && y.currentLiabilities != null) {
      y.netWorkingCapital = y.currentAssets - y.currentLiabilities
    }
    // NWC turnover (Revenue / avg NWC)
    if (
      y.revenue != null &&
      y.netWorkingCapital != null &&
      prior?.netWorkingCapital != null
    ) {
      const avg = (y.netWorkingCapital + prior.netWorkingCapital) / 2
      if (avg !== 0) y.nwcTurnover = y.revenue / avg
    }

    // Cash conversion cycle proxy (days of working capital)
    if (y.revenue != null && y.netWorkingCapital != null && y.revenue !== 0) {
      y.cashConversionCycle = (y.netWorkingCapital / y.revenue) * 365
    }

    // ROE (net income / avg equity)
    if (
      y.netIncome != null &&
      y.totalEquity != null &&
      prior?.totalEquity != null
    ) {
      const avg = (y.totalEquity + prior.totalEquity) / 2
      if (avg !== 0) y.roePct = (y.netIncome / avg) * 100
    } else if (y.netIncome != null && y.totalEquity && y.totalEquity !== 0) {
      y.roePct = (y.netIncome / y.totalEquity) * 100
    }

    // ROA (net income / avg total assets)
    if (
      y.netIncome != null &&
      y.totalAssets != null &&
      prior?.totalAssets != null
    ) {
      const avg = (y.totalAssets + prior.totalAssets) / 2
      if (avg !== 0) y.roaPct = (y.netIncome / avg) * 100
    } else if (y.netIncome != null && y.totalAssets && y.totalAssets !== 0) {
      y.roaPct = (y.netIncome / y.totalAssets) * 100
    }

    // Debt / Equity
    if (y.totalDebt != null && y.totalEquity && y.totalEquity !== 0) {
      y.debtToEquity = y.totalDebt / y.totalEquity
    }
  }

  return years
}

function computeCagrs(history: FinancialYear[]): FinancialHistory['cagrs'] {
  // history is newest first; CAGR needs oldest + newest with non-null values
  const out: FinancialHistory['cagrs'] = {
    revenueCagrPct: null,
    ebitdaCagrPct: null,
    netIncomeCagrPct: null,
  }
  if (history.length < 2) return out

  const oldest = history[history.length - 1]
  const newest = history[0]
  const years = Math.max(1, history.length - 1)

  const cagr = (a: number | null, b: number | null): number | null => {
    if (a == null || b == null || a <= 0 || b <= 0) return null
    return (Math.pow(b / a, 1 / years) - 1) * 100
  }

  out.revenueCagrPct = round(cagr(oldest.revenue, newest.revenue), 1)
  out.ebitdaCagrPct = round(cagr(oldest.ebitda, newest.ebitda), 1)
  out.netIncomeCagrPct = round(cagr(oldest.netIncome, newest.netIncome), 1)
  return out
}

function round(n: number | null, digits = 0): number | null {
  if (n == null) return null
  const m = Math.pow(10, digits)
  return Math.round(n * m) / m
}

// ── Public API ───────────────────────────────────────────────

/**
 * Build a FinancialHistory bundle from whatever we can piece together
 * for a given company. `profile` is the optional RapidAPI stockQuote
 * response — pass it when already fetched, otherwise the snapshot-only
 * fallback is used.
 */
export function buildFinancialHistory(
  co: Company,
  profile: StockProfile | null = null
): FinancialHistory {
  let source: FinancialHistory['source'] = 'company-snapshot'
  let history: FinancialYear[] = []

  if (profile?.financials && Array.isArray(profile.financials)) {
    const periods = enrichWithPriorYearBalances(
      parseAnnualReportFinancials(profile.financials)
    )
    const annuals = periods
      .filter((p) => p.type === 'Annual')
      .map(fromAnnualPeriod)
    if (annuals.length > 0) {
      history = annuals
      source = 'rapidapi'
    }
  }

  if (history.length === 0) {
    history = [fromCompanySnapshot(co)]
  }

  history = deriveAndAnnotate(history)
  const cagrs = computeCagrs(history)

  return {
    ticker: co.ticker,
    companyName: co.name,
    history,
    projections: [],
    source,
    yearsOfHistory: history.length,
    cagrs,
  }
}

/**
 * Generate a simple 3-year forward projection from the most recent
 * historical year using the provided CAGRs and assumed margin path.
 * Used when the user wants a quick projection without entering data
 * manually. This is deliberately conservative and linear.
 */
export function generateStraightLineProjection(
  fh: FinancialHistory,
  assumptions: {
    years: number
    revenueGrowthPct: number
    ebitdaMarginPct: number
    netMarginPct: number
  } = { years: 3, revenueGrowthPct: 15, ebitdaMarginPct: 14, netMarginPct: 9 }
): FinancialYear[] {
  if (fh.history.length === 0) return []
  const latest = fh.history[0]
  const out: FinancialYear[] = []
  let prevRev = latest.revenue ?? 0

  for (let y = 1; y <= assumptions.years; y++) {
    const yr = emptyYear()
    yr.type = 'Projection'
    yr.label = `Year +${y}`
    yr.fiscalYear = String(parseInt(latest.fiscalYear || '0', 10) + y || y)
    const rev = prevRev * (1 + assumptions.revenueGrowthPct / 100)
    yr.revenue = Math.round(rev)
    yr.ebitda = Math.round(rev * (assumptions.ebitdaMarginPct / 100))
    yr.netIncome = Math.round(rev * (assumptions.netMarginPct / 100))
    yr.revenueGrowthPct = assumptions.revenueGrowthPct
    yr.ebitdaMarginPct = assumptions.ebitdaMarginPct
    yr.netMarginPct = assumptions.netMarginPct
    out.push(yr)
    prevRev = rev
  }
  return out
}

// ── Formatting ─────────────────────────────────────────────

export function formatCr(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return formatInrCr(v)
}

export function formatPct(v: number | null, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(digits)}%`
}

export function formatRatio(v: number | null, digits = 2, suffix = '×'): string {
  if (v == null || !Number.isFinite(v)) return 'N/A'
  return `${v.toFixed(digits)}${suffix}`
}
