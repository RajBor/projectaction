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

export interface InputsGap {
  field: keyof FSAInputs
  label: string
  category: 'income' | 'balance' | 'cashflow' | 'market' | 'derived'
}

export interface DataSourceResult {
  inputs: Partial<FSAInputs>
  gaps: InputsGap[]
  /** 0..1 — fraction of critical fields auto-populated */
  completeness: number
  /** What source contributed each value */
  provenance: Partial<Record<keyof FSAInputs, 'db' | 'api' | 'derived'>>
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
  if (co.rev > 0 && co.ebm > 0) {
    set('grossProfit', Math.round(co.rev * co.ebm / 100), 'derived')
  }
  if (co.ebitda > 0) {
    const estEbit = Math.round(co.ebitda * 0.7)
    set('ebit', estEbit, 'derived')
    set('da', co.ebitda - estEbit, 'derived')
  }
  if (co.ev > 0 && co.mktcap > 0) {
    set('totalDebt', Math.max(0, co.ev - co.mktcap), 'derived')
  }
  // Approximate share count from market cap (assume ₹1,000 / share)
  if (co.mktcap > 0) {
    set('sharesOutstanding', Math.round((co.mktcap / 1000) * 10) / 10, 'derived')
    set('pricePerShare', 1000, 'derived')
  }
  set('taxRate', 0.25, 'derived')
  if (co.revg != null) set('epsGrowthRate', co.revg, 'derived')

  return finalise(inputs, provenance)
}

/**
 * Pull as much as we can out of a live RapidAPI StockProfile.
 *
 * The upstream response is extremely unstable — fields come as strings,
 * some as numbers, some missing entirely. We only touch a handful of
 * fields that we're reasonably sure about, and leave the rest for
 * manual entry or document upload.
 */
export function fromStockProfile(
  profile: StockProfile | null | undefined,
  base: DataSourceResult = { inputs: {}, gaps: [], completeness: 0, provenance: {} }
): DataSourceResult {
  if (!profile) return base

  const inputs: Partial<FSAInputs> = { ...base.inputs }
  const provenance: DataSourceResult['provenance'] = { ...base.provenance }

  const set = <K extends keyof FSAInputs>(key: K, value: FSAInputs[K] | undefined) => {
    if (value == null) return
    if (typeof value === 'number' && !Number.isFinite(value)) return
    // API takes precedence over db-derived values, NOT over existing
    // API values (so the first one wins if the same key is pulled twice)
    if (provenance[key] === 'api') return
    inputs[key] = value
    provenance[key] = 'api'
  }

  // Current price (NSE preferred, BSE fallback)
  const nse = num(profile.currentPrice?.NSE)
  const bse = num(profile.currentPrice?.BSE)
  const price = nse ?? bse
  if (price != null) set('pricePerShare', price)

  // Try to pull key metrics from the loose shape if present
  const km = (profile.keyMetrics || {}) as Record<string, unknown>
  // RapidAPI structures vary — we probe common key paths defensively
  const probeNum = (obj: unknown, ...keys: string[]): number | null => {
    if (!obj || typeof obj !== 'object') return null
    for (const k of keys) {
      const v = (obj as Record<string, unknown>)[k]
      const n = num(v)
      if (n != null) return n
    }
    return null
  }

  // Financials block — sometimes present as an array of statements
  if (Array.isArray(profile.financials) && profile.financials.length) {
    const latest = profile.financials[0] as Record<string, unknown>
    // These key names are educated guesses — the API is undocumented for
    // many fields. We silently skip anything we can't parse.
    set('revenue', probeNum(latest, 'revenue', 'Revenue', 'totalRevenue') ?? undefined)
    set('cogs', probeNum(latest, 'cogs', 'costOfGoodsSold') ?? undefined)
    set('grossProfit', probeNum(latest, 'grossProfit') ?? undefined)
    set('ebitda', probeNum(latest, 'ebitda', 'EBITDA') ?? undefined)
    set('ebit', probeNum(latest, 'ebit', 'operatingIncome') ?? undefined)
    set('netIncome', probeNum(latest, 'netIncome', 'profit', 'pat') ?? undefined)
    set('interestExpense', probeNum(latest, 'interestExpense', 'interest') ?? undefined)
    set('taxExpense', probeNum(latest, 'taxExpense', 'tax') ?? undefined)
    set('totalAssetsEnd', probeNum(latest, 'totalAssets') ?? undefined)
    set('totalDebt', probeNum(latest, 'totalDebt', 'debt') ?? undefined)
    set('cash', probeNum(latest, 'cash', 'cashAndEquivalents') ?? undefined)
    set('receivablesEnd', probeNum(latest, 'receivables', 'tradeReceivables') ?? undefined)
    set('inventoryEnd', probeNum(latest, 'inventory', 'inventories') ?? undefined)
    set('currentAssets', probeNum(latest, 'currentAssets') ?? undefined)
    set('currentLiabilities', probeNum(latest, 'currentLiabilities') ?? undefined)
    set('totalEquityEnd', probeNum(latest, 'equity', 'totalEquity', 'shareholdersEquity') ?? undefined)
    set('cfo', probeNum(latest, 'cfo', 'cashFromOperations', 'operatingCashFlow') ?? undefined)
    set('capex', probeNum(latest, 'capex', 'capitalExpenditure') ?? undefined)
    set('eps', probeNum(latest, 'eps', 'earningsPerShare') ?? undefined)
    set('bvps', probeNum(latest, 'bvps', 'bookValuePerShare') ?? undefined)
  }

  // keyMetrics block is a key-value bag with some useful fields
  set('eps', probeNum(km, 'eps', 'EPS') ?? undefined)
  set('bvps', probeNum(km, 'bvps', 'bookValue') ?? undefined)

  return finalise(inputs, provenance)
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
