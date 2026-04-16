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
import type { ScreenerYearData } from '@/lib/live/screener-fetch'
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
  source: 'rapidapi' | 'screener' | 'company-snapshot' | 'manual'
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

  // ── Estimated Balance Sheet + Working Capital ─────────────────
  //
  // When RapidAPI is skipped (public-mode visitors) the only source is
  // this Company snapshot. Previously fields like Gross Profit, Interest
  // Expense, Total Assets, Cash, Receivables, Inventory and CapEx all
  // defaulted to null and rendered as N/A across the entire report,
  // which looked half-broken on first impression.
  //
  // We now derive reasonable single-period estimates using sector-aware
  // working-capital ratios and standard accounting relationships. These
  // are labelled internally as derived (source stays 'company-snapshot')
  // and should be read as directional, not reported.
  const isSolar = co.sec === 'solar'
  const isTd = co.sec === 'td'

  // Total Assets ≈ Equity + Debt + operating liabilities.
  // The 1.3× multiple captures accounts-payable + accruals + other
  // current liabilities typical of Indian industrials. This keeps
  // ROA derivations alive even without a multi-year history.
  if (year.totalEquity != null && year.totalDebt != null) {
    const investedCapital = year.totalEquity + year.totalDebt
    if (investedCapital > 0) {
      year.totalAssets = Math.round(investedCapital * 1.3)
    }
  }

  // Working capital envelope — uses sector-specific days-sales /
  // days-payable benchmarks tuned for Indian solar + T&D manufacturers.
  if (co.rev && co.rev > 0) {
    const rev = co.rev
    const daily = rev / 365

    // Cash — solar mfg run leaner (~5% of rev), T&D slightly higher
    // due to long project cycles. Applies only when no live data.
    year.cash = Math.round(rev * (isTd ? 0.07 : 0.05))

    // Inventory — heaviest for solar (polysilicon/cell stockpile) and
    // T&D (transformer cores, copper). Services-heavy industries less.
    const invPct = isSolar ? 0.20 : isTd ? 0.22 : 0.15
    year.inventory = Math.round(rev * invPct)

    // Receivables — DSO of 90d solar (EPC heavy), 110d T&D (utilities
    // pay late), 75d default.
    const dso = isSolar ? 90 : isTd ? 110 : 75
    year.receivables = Math.round(daily * dso)

    // Current assets = cash + receivables + inventory + other (~5% rev).
    const other = Math.round(rev * 0.05)
    year.currentAssets =
      (year.cash || 0) + (year.receivables || 0) + (year.inventory || 0) + other

    // Current liabilities — payables DPO 70d solar, 85d T&D + 5% rev
    // short-term accruals / unearned revenue.
    const dpo = isSolar ? 70 : isTd ? 85 : 70
    year.currentLiabilities = Math.round(daily * dpo + rev * 0.05)

    // CapEx intensity — solar mfg capex-heavy (6-8%), T&D moderate (5%).
    const capexPct = isSolar ? 0.07 : isTd ? 0.05 : 0.04
    year.capex = Math.round(rev * capexPct)

    // Gross profit — margin = EBITDA margin + 8 ppts (approximates SG&A
    // + opex ex-D&A). Capped at 60% to avoid unrealistic software-grade
    // margins for a manufacturer.
    if (co.ebitda > 0) {
      const ebitdaMargin = co.ebitda / rev
      const gpMargin = Math.min(0.6, ebitdaMargin + 0.08)
      if (gpMargin > 0) {
        year.grossProfit = Math.round(rev * gpMargin)
        year.cogs = rev - year.grossProfit
      }
    }
  }

  // Interest expense = Debt × effective rate. 9% is the typical
  // blended cost for Indian mid-cap corporates (banks ~9-10%, NCDs
  // ~8-9%). Only fires when we have a positive debt estimate.
  if (year.totalDebt != null && year.totalDebt > 0) {
    year.interestExpense = Math.round(year.totalDebt * 0.09)
  }

  // EBT = EBIT − Interest; Tax = EBT − Net Income (if consistent)
  if (year.ebit != null && year.interestExpense != null) {
    year.ebt = year.ebit - year.interestExpense
  }
  if (year.ebt != null && year.netIncome != null && year.ebt >= year.netIncome) {
    year.taxExpense = year.ebt - year.netIncome
  }

  // Operating cash flow ≈ EBITDA × 0.85 (approximates tax + change in
  // working capital drag). Good enough for a single-year snapshot.
  if (co.ebitda && co.ebitda > 0) {
    year.cfo = Math.round(co.ebitda * 0.85)
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

/**
 * Map a Screener multi-year data row into our FinancialYear shape.
 *
 * Screener gives real reported numbers for the high-signal fields:
 * Sales, Op Profit, Interest, Depreciation, PBT, Tax, Net Profit,
 * Total Assets, Equity Capital, Reserves, Borrowings, CFO, CFI, CFF,
 * Debtor/Inventory/Payable Days, and ROCE. It does NOT break out cash,
 * receivables, inventory, current assets, current liabilities or
 * CapEx separately — those get derived from working-capital DAYS
 * (debtorDays, inventoryDays, daysPayable) applied to revenue, or
 * left null where no reasonable derivation exists.
 */
function fromScreenerYear(s: ScreenerYearData, sec: string | undefined): FinancialYear {
  const y = emptyYear()
  y.type = 'Annual'
  y.label = s.year
  y.fiscalYear = s.year
  y.endDate = s.year
  // Revenue + derived items.
  y.revenue = s.sales ?? null
  // EBITDA = Operating Profit (same definition Screener uses for OP).
  y.ebitda = s.operatingProfit ?? null
  // EBIT = Operating Profit − Depreciation (Screener splits Dep out).
  if (s.operatingProfit != null && s.depreciation != null) {
    y.ebit = s.operatingProfit - s.depreciation
    y.da = s.depreciation
  }
  y.interestExpense = s.interest ?? null
  y.ebt = s.profitBeforeTax ?? null
  y.taxExpense = s.tax ?? null
  y.netIncome = s.netProfit ?? null
  // Gross profit isn't reported — derive via EBITDA margin + 8ppts.
  if (y.revenue && y.revenue > 0 && y.ebitda != null && y.ebitda > 0) {
    const gpMargin = Math.min(0.6, y.ebitda / y.revenue + 0.08)
    y.grossProfit = Math.round(y.revenue * gpMargin)
    y.cogs = y.revenue - y.grossProfit
  }
  // Balance sheet — Equity Capital is only share capital. Reserves is
  // retained earnings + other reserves. Real "Total Equity" = sum.
  const equityCapital = s.equity ?? 0
  const reserves = s.reserves ?? 0
  y.totalEquity = equityCapital + reserves > 0 ? equityCapital + reserves : null
  y.totalDebt = s.borrowings ?? null
  y.totalAssets = s.totalAssets ?? null
  // Cash flow.
  y.cfo = s.cfo ?? null
  // CapEx ≈ −CFI (cash from investing is usually dominated by capex).
  // If CFI is positive (e.g. divestment year) fall back to 5% of rev.
  if (s.cfi != null) {
    y.capex = s.cfi < 0 ? Math.abs(s.cfi) : null
  }
  if (y.capex == null && y.revenue && y.revenue > 0) {
    const pct = sec === 'solar' ? 0.07 : sec === 'td' ? 0.05 : 0.04
    y.capex = Math.round(y.revenue * pct)
  }
  // Working capital — derive from Screener's days metrics when possible.
  if (y.revenue && y.revenue > 0) {
    const daily = y.revenue / 365
    if (s.debtorDays != null && s.debtorDays > 0) {
      y.receivables = Math.round(daily * s.debtorDays)
    }
    if (s.inventoryDays != null && s.inventoryDays > 0) {
      y.inventory = Math.round(daily * s.inventoryDays)
    }
    if (s.daysPayable != null && s.daysPayable > 0) {
      // Payables form the bulk of current liabilities; uplift ~25% for
      // accruals + other short-term obligations.
      y.currentLiabilities = Math.round(daily * s.daysPayable * 1.25)
    }
    // Cash ≈ 5-7% of revenue (same heuristic as the snapshot fallback).
    y.cash = Math.round(y.revenue * (sec === 'td' ? 0.07 : 0.05))
    // Current assets roll up from the components above plus other.
    const rec = y.receivables ?? 0
    const inv = y.inventory ?? 0
    const cash = y.cash ?? 0
    const other = Math.round(y.revenue * 0.05)
    if (rec + inv + cash > 0) {
      y.currentAssets = rec + inv + cash + other
    }
  }
  return y
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
    // NWC turnover (Revenue / avg NWC). Falls back to single-period
    // (Revenue / NWC) when there's no prior year — essential for public
    // snapshots where we only have one derived year available. Without
    // this fallback the row was always N/A regardless of data quality.
    if (
      y.revenue != null &&
      y.netWorkingCapital != null &&
      prior?.netWorkingCapital != null
    ) {
      const avg = (y.netWorkingCapital + prior.netWorkingCapital) / 2
      if (avg !== 0) y.nwcTurnover = y.revenue / avg
    } else if (
      y.revenue != null &&
      y.netWorkingCapital != null &&
      y.netWorkingCapital !== 0
    ) {
      y.nwcTurnover = y.revenue / y.netWorkingCapital
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
 * for a given company.
 *
 * **Screener is the canonical source for every viewer** — signed-in,
 * signed-off, and public-anonymous all see the same numbers, which
 * matters for analyst credibility. Previously RapidAPI was primary for
 * authenticated users and Screener for public visitors, so the exact
 * same company rendered different revenue / EBITDA / ratios depending
 * on login state. That's the wrong architecture: audited financials
 * don't change based on who's looking at the report.
 *
 * Source precedence (highest wins):
 *   1. Screener multi-year scrape (`screenerYears`) — free, public,
 *      pulled directly from Indian NSE/BSE filings (Ind-AS). Covers
 *      ~90% of listed tickers with up to 10 years of history.
 *   2. RapidAPI (`profile.financials`) — fallback when Screener has
 *      nothing (mostly fresh IPOs + delisted names). Yahoo-derived
 *      figures use US-GAAP conventions that occasionally miss Indian
 *      fiscal year boundaries, which is why this isn't primary.
 *   3. Single-year Company snapshot — last-resort heuristic derivation
 *      kept for SME tickers not on Screener at all.
 *
 * When Screener AND RapidAPI are both available, we use Screener and
 * drop RapidAPI. Mixing them would introduce rounding drift between
 * rows of the same report (EBITDA from Screener, D&A from Rapid, etc.)
 * which is worse than picking one source and sticking with it.
 */
export function buildFinancialHistory(
  co: Company,
  profile: StockProfile | null = null,
  screenerYears: ScreenerYearData[] | null = null
): FinancialHistory {
  let source: FinancialHistory['source'] = 'company-snapshot'
  let history: FinancialYear[] = []

  // 1) Canonical: Screener multi-year from Indian filings.
  if (screenerYears && screenerYears.length > 0) {
    history = screenerYears.map((s) => fromScreenerYear(s, co.sec))
    source = 'screener'
  }

  // 2) Fallback: RapidAPI (Yahoo) multi-year. Only fires when Screener
  //    returned nothing at all. This is rare and usually means the
  //    ticker is a fresh IPO / pre-listing / recently delisted — cases
  //    where Rapid's broader coverage wins over Screener's Indian focus.
  if (history.length === 0 && profile?.financials && Array.isArray(profile.financials)) {
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

  // 3) Final fallback — heuristic single-year from the Company snapshot.
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
