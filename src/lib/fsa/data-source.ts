/**
 * Data-source adapters that turn whatever we know about a company into
 * a partial `FSAInputs` record. Two sources are supported:
 *
 *   1. Our local `Company` database (always available, coarse granularity)
 *   2. The RapidAPI "Indian Stock Exchange" `stock?name=X` response
 *      (requires a live API call; rich but messy)
 *
 * The output is always a partial record that the /fsa page merges into
 * the live form state. Each adapter also returns a list of missing
 * critical fields so the UI can prompt the user to either type them
 * manually or upload a financial statement document.
 */

import type { Company } from '@/lib/data/companies'
import type { StockProfile } from '@/lib/stocks/api'
import type { FSAInputs } from './types'
import { parseAnnualReportFinancials, enrichWithPriorYearBalances, type RawFinancialEntry } from './annual-report'

export interface InputsGap {
  field: keyof FSAInputs
  label: string
  category: 'income' | 'balance' | 'cashflow' | 'market' | 'derived'
}

/**
 * Period descriptor for the fiscal period the API data represents.
 * Prevents "is this TTM or FY24 annual?" ambiguity that used to bite
 * users when seeding the FSA form from RapidAPI / Screener data.
 */
export interface PeriodInfo {
  /** e.g. "FY25 Annual", "Q2 FY26 Interim", "TTM (P&L) · Mar 2024 (BS)" */
  label: string
  /** Data source that produced this period */
  source: 'rapidapi' | 'screener' | 'db'
  /** Statement type when known */
  type?: 'Annual' | 'Interim' | 'TTM' | 'Derived'
  /** Period end date (YYYY-MM-DD) when known */
  endDate?: string
  /** Fiscal year string (e.g. "2024") when known */
  fiscalYear?: string
}

export interface DataSourceResult {
  inputs: Partial<FSAInputs>
  gaps: InputsGap[]
  /** 0..1 — fraction of critical fields auto-populated */
  completeness: number
  /** What source contributed each value */
  provenance: Partial<Record<keyof FSAInputs, 'db' | 'api' | 'derived'>>
  /** Periods contributing to the inputs — one entry per source that fired */
  periods?: PeriodInfo[]
}

const CRITICAL_FIELDS: Array<{ field: keyof FSAInputs; label: string; category: InputsGap['category'] }> = [
  { field: 'revenue', label: 'Revenue', category: 'income' },
  { field: 'cogs', label: 'COGS', category: 'income' },
  { field: 'grossProfit', label: 'Gross Profit', category: 'income' },
  { field: 'ebitda', label: 'EBITDA', category: 'income' },
  { field: 'ebit', label: 'EBIT', category: 'income' },
  { field: 'da', label: 'D&A', category: 'income' },
  { field: 'interestExpense', label: 'Interest Expense', category: 'income' },
  { field: 'ebt', label: 'Pretax Income (EBT)', category: 'income' },
  { field: 'taxExpense', label: 'Tax Expense', category: 'income' },
  { field: 'netIncome', label: 'Net Income', category: 'income' },
  { field: 'cash', label: 'Cash & Equivalents', category: 'balance' },
  { field: 'receivablesEnd', label: 'Receivables (End)', category: 'balance' },
  { field: 'inventoryEnd', label: 'Inventory (End)', category: 'balance' },
  { field: 'currentAssets', label: 'Current Assets', category: 'balance' },
  { field: 'currentLiabilities', label: 'Current Liabilities', category: 'balance' },
  { field: 'totalAssetsEnd', label: 'Total Assets', category: 'balance' },
  { field: 'totalEquityEnd', label: "Shareholders' Equity", category: 'balance' },
  { field: 'totalDebt', label: 'Total Debt', category: 'balance' },
  { field: 'cfo', label: 'Cash Flow from Operations', category: 'cashflow' },
  { field: 'capex', label: 'CapEx', category: 'cashflow' },
  { field: 'pricePerShare', label: 'Price per Share', category: 'market' },
  { field: 'sharesOutstanding', label: 'Shares Outstanding', category: 'market' },
  { field: 'eps', label: 'EPS', category: 'market' },
]

/** Coerce any messy upstream scalar → number | null. */
function num(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,₹\s%]/g, '')
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Pull what we can from our internal Company database row.
 * These are already in ₹Cr, so no unit conversion needed.
 */
export function fromCompany(co: Company): DataSourceResult {
  const inputs: Partial<FSAInputs> = {}
  const provenance: DataSourceResult['provenance'] = {}

  const set = <K extends keyof FSAInputs>(key: K, value: FSAInputs[K] | undefined, source: 'db' | 'api' | 'derived' = 'db') => {
    if (value != null && (typeof value !== 'number' || Number.isFinite(value))) {
      inputs[key] = value
      provenance[key] = source
    }
  }

  set('revenue', co.rev)
  set('ebitda', co.ebitda)
  set('netIncome', co.pat)
  // Fill EBITDA from margin × revenue when the raw ebitda field is
  // missing. This previously wrote to `grossProfit`, which is the WRONG
  // P&L line (gross profit excludes OpEx; EBITDA excludes D&A and
  // interest — they are not interchangeable). The old code caused the
  // waterfall chart and gross-margin readout to show EBITDA-as-GP.
  if ((!co.ebitda || co.ebitda <= 0) && co.rev > 0 && co.ebm > 0) {
    set('ebitda', Math.round(co.rev * co.ebm / 100), 'derived')
  }
  if (co.ebitda > 0) {
    const estEbit = Math.round(co.ebitda * 0.7)
    set('ebit', estEbit, 'derived')
    set('da', co.ebitda - estEbit, 'derived')
  }
  if (co.ev > 0 && co.mktcap > 0) {
    set('totalDebt', Math.max(0, co.ev - co.mktcap), 'derived')
  }
  // Share count + price default — picked so share count stays in a
  // plausible band (1M–10B) and EPS / P/E derivations don't blow up.
  // Previously this assumed ₹1,000/share unconditionally, which
  // multiplied share counts for ₹50–₹200 stocks by ~10–20×. Now the
  // assumed price scales with market cap: large caps ≈ ₹1,000/share,
  // mid caps ≈ ₹500/share, small caps ≈ ₹200/share. Still a proxy; the
  // user is expected to override from the annual report.
  if (co.mktcap > 0) {
    const assumedPrice = co.mktcap > 50000 ? 1000 : co.mktcap > 10000 ? 500 : 200
    const shares = Math.round((co.mktcap * 1e7) / assumedPrice / 1e7 * 10) / 10  // in crores
    set('sharesOutstanding', shares, 'derived')
    set('pricePerShare', assumedPrice, 'derived')
  }
  set('taxRate', 0.25, 'derived')
  if (co.revg != null) set('epsGrowthRate', co.revg, 'derived')

  const result = finalise(inputs, provenance)
  result.periods = [{
    label: 'Internal baseline',
    source: 'db',
    type: 'Derived',
  }]
  return result
}

/**
 * Pull as much as we can out of a live RapidAPI StockProfile.
 *
 * The upstream response is extremely unstable — fields come as strings,
 * some as numbers, some missing entirely. RapidAPI's `financials[]`
 * array has a deeply nested shape:
 *   financials[i] = {
 *     stockFinancialMap: { INC: [{key,value}...], BAL: [...], CAS: [...] },
 *     FiscalYear, EndDate, Type: 'Annual' | 'Interim', ...
 *   }
 * An earlier version of this function tried to probe `financials[0]` as
 * a FLAT dict (`revenue`, `cogs`, ...) — those keys don't exist at that
 * level, so every statement-level field silently came back null and the
 * FSA form was seeded with zeros. This version delegates to
 * `parseAnnualReportFinancials`, which properly walks INC/BAL/CAS via
 * canonicalised key matching and returns periods sorted Annual-first,
 * newest-first. We take the first Annual period (latest completed FY)
 * and merge its fields.
 *
 * We also attach a PeriodInfo so the UI can surface "FY25 Annual" /
 * "Q2 FY26 Interim" rather than leaving the user guessing.
 */
export function fromStockProfile(
  profile: StockProfile | null | undefined,
  base: DataSourceResult = { inputs: {}, gaps: [], completeness: 0, provenance: {} }
): DataSourceResult {
  if (!profile) return base

  const inputs: Partial<FSAInputs> = { ...base.inputs }
  const provenance: DataSourceResult['provenance'] = { ...base.provenance }
  const periods: PeriodInfo[] = [...(base.periods ?? [])]

  const set = <K extends keyof FSAInputs>(key: K, value: FSAInputs[K] | undefined) => {
    if (value == null) return
    if (typeof value === 'number' && !Number.isFinite(value)) return
    // API takes precedence over db-derived values, NOT over existing
    // API values (so the first one wins if the same key is pulled twice)
    if (provenance[key] === 'api') return
    inputs[key] = value
    provenance[key] = 'api'
  }

  // Current price (NSE preferred, BSE fallback). `num()` strips ₹ and %.
  const nse = num(profile.currentPrice?.NSE)
  const bse = num(profile.currentPrice?.BSE)
  const price = nse ?? bse
  if (price != null) set('pricePerShare', price)

  // Try to pull EPS / BVPS from the keyMetrics bag (top-level fallback).
  const km = (profile.keyMetrics || {}) as Record<string, unknown>
  const probeNum = (obj: unknown, ...keys: string[]): number | null => {
    if (!obj || typeof obj !== 'object') return null
    for (const k of keys) {
      const v = (obj as Record<string, unknown>)[k]
      const n = num(v)
      if (n != null) return n
    }
    return null
  }

  // ── Financial statements (correct nested walk) ──
  // Use parseAnnualReportFinancials which understands stockFinancialMap's
  // INC/BAL/CAS arrays and the canonical-key alias map. We then pick the
  // latest ANNUAL period — not an interim quarter, not a random index.
  if (Array.isArray(profile.financials) && profile.financials.length) {
    const parsed = enrichWithPriorYearBalances(
      parseAnnualReportFinancials(profile.financials as RawFinancialEntry[])
    )
    // parsed is already sorted: Annual-first, then by endDate descending.
    // Prefer the latest Annual period — that's the completed fiscal year
    // we want to seed the form with. Fall back to the newest entry if
    // there are no annuals (rare — e.g. new IPO with only interims).
    const latestAnnual = parsed.find((p) => p.type === 'Annual') ?? parsed[0]
    if (latestAnnual) {
      const ai = latestAnnual.inputs
      // Merge every FSAInputs key the parser surfaced. The `set` guard
      // keeps first-wins semantics so Screener data (higher priority)
      // isn't clobbered.
      for (const [k, v] of Object.entries(ai)) {
        if (v == null) continue
        if (typeof v !== 'number' || !Number.isFinite(v)) continue
        set(k as keyof FSAInputs, v as FSAInputs[keyof FSAInputs])
      }
      periods.push({
        label: latestAnnual.label,
        source: 'rapidapi',
        type: latestAnnual.type,
        endDate: latestAnnual.endDate || undefined,
        fiscalYear: latestAnnual.fiscalYear || undefined,
      })
    }
  }

  // keyMetrics block is a key-value bag with some useful fields. Only
  // fires as a fallback when the statement walk didn't populate them.
  set('eps', probeNum(km, 'eps', 'EPS') ?? undefined)
  set('bvps', probeNum(km, 'bvps', 'bookValue') ?? undefined)

  const result = finalise(inputs, provenance)
  result.periods = periods
  return result
}

/** Combine provenance records and compute completeness + gaps. */
function finalise(
  inputs: Partial<FSAInputs>,
  provenance: DataSourceResult['provenance']
): DataSourceResult {
  const gaps: InputsGap[] = []
  let filled = 0
  for (const spec of CRITICAL_FIELDS) {
    const v = inputs[spec.field]
    const isValid =
      v != null && (typeof v !== 'number' || (Number.isFinite(v) && v !== 0))
    if (isValid) {
      filled++
    } else {
      gaps.push({ field: spec.field, label: spec.label, category: spec.category })
    }
  }
  const completeness = filled / CRITICAL_FIELDS.length
  return { inputs, gaps, completeness, provenance }
}

/**
 * Estimate missing FSAInputs from whatever IS available using standard
 * accounting relationships. This mirrors the estimation engine in the
 * FSA Intelligence Panel but works on the FSAInputs interface.
 *
 * Called after fromCompany() + fromStockProfile() to fill remaining gaps.
 */
export function estimateMissingInputs(
  inputs: Partial<FSAInputs>,
  provenance: DataSourceResult['provenance']
): { inputs: Partial<FSAInputs>; provenance: DataSourceResult['provenance'] } {
  const out = { ...inputs }
  const prov = { ...provenance }
  const est = <K extends keyof FSAInputs>(key: K, value: number) => {
    if (out[key] == null || (typeof out[key] === 'number' && !Number.isFinite(out[key] as number))) {
      ;(out as Record<string, unknown>)[key] = Math.round(value * 100) / 100
      prov[key] = 'derived'
    }
  }
  const v = (key: keyof FSAInputs) => {
    const val = out[key]
    return typeof val === 'number' && Number.isFinite(val) && val !== 0 ? val : null
  }

  const rev = v('revenue')
  const ebitda = v('ebitda')
  const ni = v('netIncome')
  const gp = v('grossProfit')
  const ebit = v('ebit')
  const da = v('da')
  const totalDebt = v('totalDebt')
  const taxRate = v('taxRate') ?? 0.25

  // Income statement estimation chain
  if (rev) {
    if (!v('cogs') && gp) est('cogs', rev - gp)
    else if (!v('cogs')) est('cogs', rev * 0.7) // 70% COGS for manufacturing

    if (!gp) est('grossProfit', rev - (v('cogs') ?? rev * 0.7))
    if (!da && ebitda && ebit) est('da', ebitda - ebit)
    else if (!da && rev) est('da', rev * 0.045) // D&A ~4.5% of revenue
    if (!ebit && ebitda) est('ebit', ebitda - (v('da') ?? rev * 0.045))
    if (!v('interestExpense') && ebit && ni) {
      const ebtEst = ni / (1 - taxRate)
      est('interestExpense', Math.max(0, ebit - ebtEst))
    } else if (!v('interestExpense') && totalDebt) {
      est('interestExpense', totalDebt * 0.09) // ~9% cost of debt
    }
    if (!v('ebt') && ebit) est('ebt', ebit - (v('interestExpense') ?? 0))
    if (!v('taxExpense') && v('ebt')) est('taxExpense', (v('ebt')!) * taxRate)
    if (!ni && v('ebt')) est('netIncome', (v('ebt')!) * (1 - taxRate))
    if (!v('operatingExpenses') && gp && ebit) est('operatingExpenses', gp - ebit)
  }

  // Balance sheet estimation chain
  const mktcap = (v('pricePerShare') ?? 0) * (v('sharesOutstanding') ?? 0)
  const pb = mktcap > 0 && v('eps') ? mktcap / ((v('eps')! / 0.15) * (v('sharesOutstanding') ?? 1)) : null // rough P/B

  if (!v('totalEquityEnd') && mktcap > 0) {
    // Estimate equity from market cap and a P/B of ~3 (typical Indian manufacturing)
    est('totalEquityEnd', mktcap / 3)
  }
  const eq = v('totalEquityEnd')
  if (!v('totalDebt') && eq) est('totalDebt', eq * 0.5) // est D/E ~0.5
  if (!v('totalAssetsEnd') && eq) est('totalAssetsEnd', eq + (v('totalDebt') ?? eq * 0.5))
  if (!v('currentAssets') && v('totalAssetsEnd')) est('currentAssets', (v('totalAssetsEnd')!) * 0.4) // 40% of TA
  if (!v('currentLiabilities') && v('totalAssetsEnd')) est('currentLiabilities', (v('totalAssetsEnd')!) * 0.25) // 25% of TA
  if (!v('receivablesEnd') && rev) est('receivablesEnd', rev * (60 / 365)) // 60 days DSO
  if (!v('receivablesBegin') && v('receivablesEnd')) est('receivablesBegin', (v('receivablesEnd')!) * 0.9) // ~10% less prior year
  if (!v('inventoryEnd') && rev) est('inventoryEnd', rev * 0.7 * (45 / 365)) // 45 days DIO on COGS
  if (!v('inventoryBegin') && v('inventoryEnd')) est('inventoryBegin', (v('inventoryEnd')!) * 0.9)
  if (!v('payablesEnd') && rev) est('payablesEnd', rev * 0.7 * (30 / 365)) // 30 days DPO
  if (!v('payablesBegin') && v('payablesEnd')) est('payablesBegin', (v('payablesEnd')!) * 0.9)
  if (!v('cash') && v('currentAssets')) est('cash', (v('currentAssets')!) * 0.2) // 20% of CA
  if (!v('shortTermInvestments')) est('shortTermInvestments', 0)
  if (!v('totalAssetsBegin') && v('totalAssetsEnd')) est('totalAssetsBegin', (v('totalAssetsEnd')!) * 0.9)
  if (!v('totalEquityBegin') && eq) est('totalEquityBegin', eq * 0.9)

  // Cash flow estimation
  if (!v('cfo') && ni && v('da')) est('cfo', ni + (v('da')!)) // CFO ≈ NI + D&A
  if (!v('capex') && rev) est('capex', rev * 0.06) // 6% of revenue

  // Market data
  if (!v('eps') && ni && v('sharesOutstanding')) est('eps', ni / (v('sharesOutstanding')!))
  if (!v('bvps') && eq && v('sharesOutstanding')) est('bvps', eq / (v('sharesOutstanding')!))

  return { inputs: out, provenance: prov }
}

/**
 * Merge Screener.in row into FSAInputs. The row should already carry
 * the parser's `plPeriod` / `bsPeriod` strings (e.g. "TTM", "Mar 2024")
 * so the UI can surface an unambiguous period label instead of
 * guessing "latest annual".
 */
export function fromScreenerRow(
  row: Record<string, unknown>,
  base: DataSourceResult
): DataSourceResult {
  const inputs = { ...base.inputs }
  const provenance = { ...base.provenance }
  const periods: PeriodInfo[] = [...(base.periods ?? [])]
  const set = <K extends keyof FSAInputs>(key: K, value: unknown, source: 'db' | 'api' | 'derived' = 'api') => {
    const n = num(value)
    if (n != null && n !== 0 && inputs[key] == null) {
      ;(inputs as Record<string, unknown>)[key] = n
      provenance[key] = source
    }
  }

  set('revenue', row.salesCr)
  set('ebitda', row.ebitdaCr)
  set('netIncome', row.netProfitCr)
  set('totalAssetsEnd', row.totalAssetsCr)
  // equityCr from screener-fetch is now (Equity Capital + Reserves) —
  // the correct shareholders'-equity base. Using share-capital-only
  // would send Equity Multiplier into the 50-100× range (the root cause
  // behind the "exceptionally high ROE" bug) — that's fixed at the
  // parser. We just forward the clean value here.
  set('totalEquityEnd', row.equityCr)
  set('totalDebt', row.borrowings || row.dbtEq && row.equityCr ? (num(row.dbtEq) ?? 0) * (num(row.equityCr) ?? 0) : null)
  if (row.mktcapCr && row.pricePer) {
    const mc = num(row.mktcapCr)
    const price = num(row.pricePer)
    if (mc && price && price > 0) {
      set('sharesOutstanding', mc / price)
      set('pricePerShare', price)
    }
  }
  if (row.roce) set('epsGrowthRate', row.roce, 'derived') // rough proxy
  if (row.roe && !inputs.netIncome && inputs.totalEquityEnd) {
    const roe = num(row.roe)
    if (roe) set('netIncome', (inputs.totalEquityEnd as number) * roe / 100, 'derived')
  }

  // Attach period info so the FSA form can tell the user whether the
  // seeded numbers are TTM (rolling 12m) or a completed fiscal year.
  const plPeriod = typeof row.plPeriod === 'string' ? row.plPeriod : null
  const bsPeriod = typeof row.bsPeriod === 'string' ? row.bsPeriod : null
  const periodLabel = (typeof row.period === 'string' && row.period)
    ? row.period
    : (plPeriod || bsPeriod || 'Screener latest')
  // Heuristic: if P&L header literally says "TTM", mark as TTM so the
  // DuPont / ROE cells can warn that this is a rolling number.
  const isTTM = plPeriod?.toUpperCase().includes('TTM') ?? false
  periods.push({
    label: periodLabel,
    source: 'screener',
    type: isTTM ? 'TTM' : 'Annual',
    endDate: bsPeriod || plPeriod || undefined,
  })

  const result = finalise(inputs, provenance)
  result.periods = periods
  return result
}

/**
 * Merge `inputs` into `defaults`, but only where `inputs` has a real
 * finite numeric value. Used by the form when the user has partially
 * typed over an auto-filled field.
 */
export function mergeInputs(
  defaults: Partial<FSAInputs>,
  userEdits: Partial<FSAInputs>
): Partial<FSAInputs> {
  const out: Partial<FSAInputs> = { ...defaults }
  for (const [k, v] of Object.entries(userEdits)) {
    if (v === undefined) continue
    if (typeof v === 'number' && (!Number.isFinite(v) || v === 0)) continue
    ;(out as Record<string, unknown>)[k] = v
  }
  return out
}
