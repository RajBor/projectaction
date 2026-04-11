/**
 * Annual-report parser.
 *
 * The RapidAPI "Indian Stock Exchange" `/stock?name=X` response carries
 * a `financials[]` array with up to 6 annual statements + 8 quarterly
 * interims for every listed BSE/NSE company. Each entry has a
 * `stockFinancialMap` with three sub-blocks:
 *
 *   INC — Income statement (28 line items)
 *   BAL — Balance sheet (43 line items)
 *   CAS — Cash flow statement (18 line items)
 *
 * This module turns that raw block into per-year `FSAInputs` records
 * plus a sorted list of available years / interims so the /fsa page
 * can offer a year picker ("FY25 Annual", "FY24 Annual", "Q2 FY26", …).
 *
 * The RapidAPI response is notoriously inconsistent — numbers come as
 * strings, keys have embedded spaces and punctuation, and the taxonomy
 * changes between companies. Every lookup here is tolerant: unknown
 * keys are silently ignored and missing values are left `undefined`
 * so the FSA orchestrator can fall back to its auto-derivation path.
 */

import type { FSAInputs } from './types'

// ── Loose types for the upstream blob ────────────────────

interface RawLineItem {
  key?: string
  displayName?: string
  value?: string | number
}

interface RawStatementMap {
  INC?: RawLineItem[]
  BAL?: RawLineItem[]
  CAS?: RawLineItem[]
}

export interface RawFinancialEntry {
  stockFinancialMap?: RawStatementMap
  FiscalYear?: string | number
  EndDate?: string
  Type?: 'Annual' | 'Interim' | string
  StatementDate?: string
  fiscalPeriodNumber?: string | number
}

// ── Parsed output ────────────────────────────────────────

export interface AnnualPeriod {
  /** Short label for UI: "FY25 Annual", "Q2 FY26 Interim", etc. */
  label: string
  /** "Annual" or "Interim" */
  type: 'Annual' | 'Interim'
  /** Fiscal year as a string to preserve FY24/FY25/FY26. */
  fiscalYear: string
  /** Period end date (YYYY-MM-DD). */
  endDate: string
  /** Parsed `FSAInputs` — every field optional, caller merges over defaults. */
  inputs: Partial<FSAInputs>
  /** Number of line items successfully parsed (for debugging / completeness UI). */
  lineItemCount: number
}

// ── Key aliases ──────────────────────────────────────────
//
// The upstream normalises key names by stripping whitespace but keeps
// punctuation. We match by a canonicalised form (lower-cased, alpha-
// numeric only) so variants like "Revenue" / "TotalRevenue" /
// "NetRevenue" all resolve. Each `FSAInputs` field maps to ONE primary
// and an ordered fallback list.

type FsaFieldKey = keyof FSAInputs

interface FieldAlias {
  /** FSAInputs field to populate */
  field: FsaFieldKey
  /** Which statement block to look in */
  block: 'INC' | 'BAL' | 'CAS'
  /** Raw key candidates in preference order */
  aliases: string[]
  /**
   * Optional post-processor — e.g. flipping sign of CapEx because
   * the upstream reports it as a negative outflow.
   */
  transform?: (n: number) => number
}

const ABS = (n: number) => Math.abs(n)

const FIELD_MAP: FieldAlias[] = [
  // ── Income Statement ──
  { field: 'revenue', block: 'INC', aliases: ['TotalRevenue', 'Revenue', 'NetRevenue'] },
  { field: 'cogs', block: 'INC', aliases: ['CostofRevenueTotal', 'CostofRevenue', 'CostofGoodsSold'] },
  { field: 'grossProfit', block: 'INC', aliases: ['GrossProfit'] },
  { field: 'operatingExpenses', block: 'INC', aliases: ['TotalOperatingExpense', 'SellingGeneralAdminExpensesTotal'] },
  { field: 'ebit', block: 'INC', aliases: ['OperatingIncome', 'EBIT'] },
  { field: 'da', block: 'INC', aliases: ['DepreciationAmortization', 'Depreciation/Amortization', 'Depreciation'] },
  {
    field: 'interestExpense',
    block: 'INC',
    aliases: ['InterestExpense', 'InterestExpNonOp', 'InterestIncExpNetNonOpTotal', 'InterestInc(Exp)Net-Non-OpTotal'],
    transform: ABS,
  },
  { field: 'ebt', block: 'INC', aliases: ['NetIncomeBeforeTaxes', 'PretaxIncome'] },
  { field: 'taxExpense', block: 'INC', aliases: ['ProvisionforIncomeTaxes', 'IncomeTaxExpense'] },
  { field: 'netIncome', block: 'INC', aliases: ['NetIncome', 'NetIncomeAfterTaxes', 'NetIncomeBeforeExtraItems'] },
  { field: 'eps', block: 'INC', aliases: ['DilutedEPSExcludingExtraOrdItems', 'DilutedNormalizedEPS', 'BasicEPSExcludingExtraOrdItems', 'BasicNormalizedEPS'] },

  // ── Balance Sheet ──
  { field: 'cash', block: 'BAL', aliases: ['CashandShortTermInvestments', 'Cash', 'CashEquivalents'] },
  { field: 'shortTermInvestments', block: 'BAL', aliases: ['ShortTermInvestments'] },
  { field: 'receivablesEnd', block: 'BAL', aliases: ['TotalReceivablesNet', 'AccountsReceivable-TradeNet', 'AccountsReceivableTradeNet'] },
  { field: 'inventoryEnd', block: 'BAL', aliases: ['TotalInventory', 'Inventories'] },
  { field: 'currentAssets', block: 'BAL', aliases: ['TotalCurrentAssets'] },
  { field: 'currentLiabilities', block: 'BAL', aliases: ['TotalCurrentLiabilities'] },
  { field: 'totalAssetsEnd', block: 'BAL', aliases: ['TotalAssets'] },
  { field: 'totalEquityEnd', block: 'BAL', aliases: ['TotalEquity', "TotalLiabilitiesShareholders'Equity"] },
  { field: 'totalDebt', block: 'BAL', aliases: ['TotalDebt', 'TotalLongTermDebt'] },
  { field: 'grossPPE', block: 'BAL', aliases: ['Property/Plant/EquipmentTotal-Gross', 'PropertyPlantEquipmentTotalGross'] },
  {
    field: 'accumulatedDepreciation',
    block: 'BAL',
    aliases: ['AccumulatedDepreciationTotal', 'AccumulatedDepreciation'],
    transform: ABS,
  },
  { field: 'bvps', block: 'BAL', aliases: ['TangibleBookValueperShareCommonEq', 'BookValuePerShare'] },
  { field: 'sharesOutstanding', block: 'BAL', aliases: ['TotalCommonSharesOutstanding'] },

  // ── Cash Flow ──
  { field: 'cfo', block: 'CAS', aliases: ['CashfromOperatingActivities', 'CashFromOperations'] },
  { field: 'cfi', block: 'CAS', aliases: ['CashfromInvestingActivities'] },
  { field: 'cff', block: 'CAS', aliases: ['CashfromFinancingActivities'] },
  {
    field: 'capex',
    block: 'CAS',
    aliases: ['CapitalExpenditures'],
    transform: ABS,
  },
]

// ── Helpers ──────────────────────────────────────────────

/** Canonicalise a raw upstream key so we can match despite punctuation. */
function canon(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Coerce a string/number scalar from the upstream into a finite number. */
function toNumber(v: unknown): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,₹\s]/g, '').trim()
    if (!cleaned) return null
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Look up the first matching alias in a statement block. */
function findInBlock(block: RawLineItem[] | undefined, aliases: string[]): number | null {
  if (!block || !Array.isArray(block)) return null
  // Build a cached canonical index once per call
  const index = new Map<string, number>()
  for (const item of block) {
    const rawKey = typeof item.key === 'string' ? item.key : ''
    if (!rawKey) continue
    const n = toNumber(item.value)
    if (n == null) continue
    index.set(canon(rawKey), n)
  }
  for (const a of aliases) {
    const n = index.get(canon(a))
    if (n != null) return n
  }
  return null
}

/**
 * Parse a single `financials[]` entry into a partial FSAInputs.
 * Returns `null` if the entry has no statement map at all.
 */
export function parseEntry(entry: RawFinancialEntry): AnnualPeriod | null {
  const map = entry.stockFinancialMap
  if (!map) return null
  const inputs: Partial<FSAInputs> = {}
  let count = 0

  for (const { field, block, aliases, transform } of FIELD_MAP) {
    const raw = findInBlock(map[block], aliases)
    if (raw == null) continue
    const value = transform ? transform(raw) : raw
    // Skip 0 values for fields where 0 is almost certainly "not reported"
    // (e.g. you don't have genuinely 0 revenue or 0 total assets)
    if (
      value === 0 &&
      (field === 'revenue' ||
        field === 'totalAssetsEnd' ||
        field === 'totalEquityEnd')
    ) {
      continue
    }
    ;(inputs as Record<string, number>)[field as string] = value
    count++
  }

  const type: 'Annual' | 'Interim' = entry.Type === 'Interim' ? 'Interim' : 'Annual'
  const fy = String(entry.FiscalYear ?? '')
  const endDate = String(entry.EndDate ?? '')

  // Label for the year picker
  let label = ''
  if (type === 'Annual') {
    label = `FY${fy.slice(-2)} Annual`
  } else {
    // Infer quarter from month of end date
    const month = endDate ? parseInt(endDate.slice(5, 7), 10) : 0
    const qMap: Record<number, string> = {
      6: 'Q1',
      9: 'Q2',
      12: 'Q3',
      3: 'Q4',
    }
    const q = qMap[month] || '?'
    label = `${q} FY${fy.slice(-2)} Interim`
  }

  return {
    label,
    type,
    fiscalYear: fy,
    endDate,
    inputs,
    lineItemCount: count,
  }
}

/** Parse the top-level `financials[]` array. Sorts Annual first, newest first. */
export function parseAnnualReportFinancials(
  financials: RawFinancialEntry[] | null | undefined
): AnnualPeriod[] {
  if (!Array.isArray(financials)) return []
  const parsed: AnnualPeriod[] = []
  for (const entry of financials) {
    const p = parseEntry(entry)
    if (p && p.lineItemCount > 0) parsed.push(p)
  }
  // Sort: Annual before Interim, then by endDate descending
  parsed.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'Annual' ? -1 : 1
    return b.endDate.localeCompare(a.endDate)
  })
  return parsed
}

/**
 * Carry forward the previous year's balance-sheet values as *Begin
 * balances on the current year, so averaging-based ratios work
 * (e.g. avg receivables, avg assets, avg equity). The periods array
 * is already sorted newest-first, so we look at periods[i + 1] for
 * the prior-year end.
 */
export function enrichWithPriorYearBalances(periods: AnnualPeriod[]): AnnualPeriod[] {
  if (periods.length === 0) return periods
  const annuals = periods.filter((p) => p.type === 'Annual')
  for (let i = 0; i < annuals.length - 1; i++) {
    const current = annuals[i]
    const prior = annuals[i + 1]
    const pi = prior.inputs
    const ci = current.inputs
    if (pi.totalAssetsEnd != null && ci.totalAssetsBegin == null)
      ci.totalAssetsBegin = pi.totalAssetsEnd
    if (pi.totalEquityEnd != null && ci.totalEquityBegin == null)
      ci.totalEquityBegin = pi.totalEquityEnd
    if (pi.receivablesEnd != null && ci.receivablesBegin == null)
      ci.receivablesBegin = pi.receivablesEnd
    if (pi.inventoryEnd != null && ci.inventoryBegin == null)
      ci.inventoryBegin = pi.inventoryEnd
    // Fixed-asset / invested-capital averages use PP&E-net approximation
    if (pi.grossPPE != null && ci.fixedAssetsBegin == null)
      ci.fixedAssetsBegin = pi.grossPPE - (pi.accumulatedDepreciation ?? 0)
    if (ci.grossPPE != null && ci.fixedAssetsEnd == null)
      ci.fixedAssetsEnd = ci.grossPPE - (ci.accumulatedDepreciation ?? 0)
  }
  return periods
}
