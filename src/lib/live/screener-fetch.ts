/**
 * Shared Screener.in fetch + parse logic.
 *
 * Used by the admin scrape-screener route (full publish flow + ratios)
 * and the non-admin screener-fill route (gap-filling for Tier 2).
 */

/**
 * Single quarter snapshot from Screener's `id="quarters"` table.
 *
 * DISPLAY-ONLY: these values are a supplementary signal for the UI
 * (show a "last 4 quarters" sparkline / table, let users eyeball
 * momentum). They MUST NOT be merged into FSAInputs, annual CAGR,
 * ROE/DuPont, valuation ratios, or any other model calculation —
 * mixing quarterly and annual lines produces garbage. Downstream
 * consumers should treat this strictly as human-readable context.
 */
export interface ScreenerQuarter {
  /** Column header from Screener, e.g. "Jun 2024", "Sep 2024", "Dec 2024", "Mar 2025". */
  period: string
  salesCr: number | null
  expensesCr: number | null
  operatingProfitCr: number | null
  /** Operating profit margin %, as reported by Screener. */
  opmPct: number | null
  otherIncomeCr: number | null
  interestCr: number | null
  depreciationCr: number | null
  profitBeforeTaxCr: number | null
  taxPct: number | null
  netProfitCr: number | null
  epsRs: number | null
}

export interface ScreenerRow {
  ticker: string
  nse: string
  name: string
  mktcapCr: number | null
  pricePer: number | null
  pe: number | null
  bookValue: number | null
  dividendYield: number | null
  roce: number | null
  roe: number | null
  faceValue: number | null
  salesCr: number | null
  /**
   * Sales from the column immediately to the left of the latest P&L
   * column. Used to derive a year-over-year growth figure (`revgPct`)
   * when the latest column is TTM or an annual close — the growth
   * calc is `(salesCr / salesPrevCr - 1) * 100`. Exposed so downstream
   * can audit / explain the derivation; the primary consumer is the
   * admin push pipeline, which previously left `revg` frozen at the
   * hand-curated baseline whenever a live Screener refresh landed.
   */
  salesPrevCr: number | null
  netProfitCr: number | null
  opm: number | null
  ebitdaCr: number | null
  ebm: number | null
  /**
   * Year-over-year revenue growth %, derived from `salesCr / salesPrevCr`.
   * Null when either sales figure is missing or non-positive. A 0..100+
   * percentage (e.g. 18 means +18%), matching the convention `Company.revg`
   * uses everywhere else in the app.
   */
  revgPct: number | null
  evCr: number | null
  evEbitda: number | null
  dbtEq: number | null
  pbRatio: number | null
  totalAssetsCr: number | null
  totalLiabilitiesCr: number | null
  /**
   * Total shareholders' equity = Equity Capital + Reserves.
   * NOT share capital alone (that's `equityCapitalCr`). Using this as the
   * denominator in ROE / Equity Multiplier is what makes DuPont work.
   */
  equityCr: number | null
  /** Paid-up share capital only (face value × shares). Diagnostic — not the DuPont equity base. */
  equityCapitalCr: number | null
  /** Reserves & surplus. Added to share capital to derive total equity. */
  reservesCr: number | null
  /**
   * Human-readable period descriptor.
   * Format: "<P&L header> (P&L) · <BS header> (BS)"
   * e.g. "TTM (P&L) · Mar 2024 (BS)"  or  "Mar 2024 (P&L) · Mar 2024 (BS)"
   * Screener reports P&L with a rolling TTM column but balance-sheet is
   * always a year-end snapshot, so we surface both to prevent mix-ups.
   */
  period: string
  /** Just the P&L header, e.g. "TTM" or "Mar 2024". */
  plPeriod: string | null
  /** Just the balance-sheet header, e.g. "Mar 2024". Always a year-end. */
  bsPeriod: string | null
  fetchedAt: string
  source: 'screener.in'
}

export const SCREENER_CODE: Record<string, string> = {
  WAAREEENS: 'WAAREEENER',
  PREMIENRG: 'PREMIERENE',
  // BORORENEW kept unmapped — screener.in/company/BFRENEWABL 404s;
  // the correct code is the ticker itself. Same fix as NSE_SYMBOL.
  WEBELSOLAR: 'WESOLENRGY',
  STERLINWIL: 'SWSOLAR',
  CGPOWER: 'CGPOWER',
  VOLTAMP: 'VOLTAMP',
  HITACHIEN: 'POWERINDIA',
  GENUSPAPER: 'GENUSPOWER',
  ADANIENSOL: 'ADANIENSOL',
  GETANDEL: 'GEVERNOVA',
  STRTECH: 'STLTECH',
  HBLPOWER: 'HBLPOWER',
  INSOLATION: 'INSOLATION',
  KPIGREEN: 'KPIGREEN',
  SWELECTES: 'SWELECTES',
  HPL: 'HPLELECTRIC',
  UNIVCABLES: 'UNIVCABLES',
  INOXGREEN: 'INOXGREEN',
  INOXWIND: 'INOXWIND',
  RECLTD: 'RECLTD',
  IREDA: 'IREDA',
  TRITURBINE: 'TRITURBINE',
  BBL: 'BBL',
  KENNAMET: 'KENNAMET',
}

export function screenerCode(ticker: string, nse: string | null): string {
  return SCREENER_CODE[ticker] ?? nse ?? ticker
}

function parseNum(s: string | undefined): number | null {
  if (!s) return null
  const cleaned = s.replace(/[,₹%\s]/g, '').trim()
  if (!cleaned || cleaned === '-') return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

/**
 * Canonicalise a Screener row/column label from raw HTML.
 *
 * Screener renders expandable rows like `<td class="text">Sales&nbsp;+</td>`
 * where the `+` is an "expand sub-segment" button and `&nbsp;` is an
 * HTML entity. The previous extractor only stripped HTML tags, so labels
 * arrived at the matcher as `"sales&nbsp;+"` — which then failed every
 * exact-match test (`label === 'sales'`) in the whitelist. Downstream
 * consequence: for Premier / Waaree / Polycab (and any company with
 * sub-segment drill-downs on its P&L), `salesCr` and `netProfitCr` came
 * back null while `opm` worked — because the OPM row has no `+` button.
 *
 * This helper now:
 *   1. Strips tags.
 *   2. Decodes the handful of HTML entities Screener actually emits
 *      (`&nbsp;`, `&amp;`, `&#160;`).
 *   3. Removes the trailing `+` expand indicator.
 *   4. Collapses whitespace and lower-cases for stable matching.
 *
 * Exported so both `screener-fetch.ts` parsers and the admin scrape route
 * use identical label semantics — any divergence here silently breaks
 * one consumer while leaving the other fine, which is exactly the
 * failure mode we just spent a morning tracking down.
 */
export function normaliseScreenerLabel(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s*\+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function parseTopRatios(html: string): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  const block = html.match(/id="top-ratios"([\s\S]*?)(?:<\/ul>|<section)/)
  if (!block) return out
  const lis = block[1].split(/<li\b[^>]*>/)
  for (const li of lis) {
    const nameM = li.match(/<span class="name">\s*([\s\S]*?)<\/span>/)
    if (!nameM) continue
    const label = normaliseScreenerLabel(nameM[1])
    const numM = li.match(/<span class="number">([\s\S]*?)<\/span>/)
    if (!numM) continue
    const value = parseNum(numM[1])
    if (label.includes('market cap')) out.mktcap = value
    else if (label.includes('current price')) out.price = value
    else if (label.includes('stock p/e') || label === 'p/e') out.pe = value
    else if (label.includes('book value')) out.bookValue = value
    else if (label.includes('dividend yield')) out.dividendYield = value
    else if (label.includes('roce')) out.roce = value
    else if (label.includes('roe')) out.roe = value
    else if (label.includes('face value')) out.faceValue = value
    else if (label.includes('debt') && !label.includes('/')) out.debt = value
  }
  return out
}

/**
 * Whitelist-based matcher for P&L / BS row labels.
 *
 * We used to do `label.includes('sales')` / `label.includes('net profit')`,
 * which was too permissive: it matched derived rows like "Sales Growth
 * 3Years %" or "Net Profit Margin %" that live in the same table, and
 * whichever one appeared later in the HTML silently overwrote the real
 * metric. For Premier Energies this surfaced as revenue ≈ 85 (%Growth)
 * or net profit ≈ 12 (margin %), making the whole scraped row look like
 * quarterly data when it was really garbage.
 *
 * The fix: compare the trimmed label against a vetted set of canonical
 * spellings Screener actually uses, plus a blacklist of derived-metric
 * suffixes that must never match.
 */
function isPrimaryRevenueLabel(label: string): boolean {
  // Reject any row whose label contains "growth", "variation", "margin",
  // "%" or "cagr" — those are derived metrics, not the Sales line.
  if (/(growth|variation|margin|cagr|%)/.test(label)) return false
  return (
    label === 'sales' ||
    label === 'net sales' ||
    label === 'revenue' ||
    label === 'revenue from operations' ||
    label === 'total revenue' ||
    label === 'income' ||
    label === 'total income'
  )
}

function isPrimaryNetProfitLabel(label: string): boolean {
  if (/(growth|variation|margin|cagr|%)/.test(label)) return false
  return (
    label === 'net profit' ||
    label === 'profit after tax' ||
    label === 'pat' ||
    label === 'net profit for the period' ||
    label === 'profit for the period' ||
    label === 'profit / loss for the period'
  )
}

function isOpmLabel(label: string): boolean {
  // "OPM %" is the only OPM row Screener exposes — treat it as exact.
  return label === 'opm %' || label === 'opm'
}

export function parseProfitLoss(html: string): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  const plM = html.match(/id="profit-loss"[\s\S]*?<table[\s\S]*?<\/table>/)
  if (!plM) return out
  const rows = plM[0].match(/<tr[\s\S]*?<\/tr>/g) || []
  for (const row of rows) {
    const header = row.match(/<td[^>]*class="[^"]*text[^"]*"[^>]*>([\s\S]*?)<\/td>/)
    if (!header) continue
    const label = normaliseScreenerLabel(header[1])
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []
    const lastCell = cells[cells.length - 1]
    if (!lastCell) continue
    const val = parseNum(lastCell.replace(/<[^>]+>/g, '').trim())
    // Use first-wins (only set once) so derived rows that somehow slip
    // past the whitelist can't overwrite an earlier canonical match.
    if (out.sales == null && isPrimaryRevenueLabel(label)) {
      out.sales = val
      // Also capture the column immediately to the left so we can
      // compute year-over-year revenue growth in deriveScreenerRow.
      // Screener orders columns chronologically oldest→newest with TTM
      // rightmost, so `cells[cells.length - 2]` is the prior period
      // (typically prev-year annual). The `- 2` path covers both the
      // TTM-ending case (TTM vs latest Mar) and the annual-ending case
      // (latest Mar vs prior Mar).
      const prevCell = cells[cells.length - 2]
      if (prevCell) {
        out.salesPrev = parseNum(prevCell.replace(/<[^>]+>/g, '').trim())
      }
    }
    if (out.opm == null && isOpmLabel(label)) out.opm = val
    if (out.netProfit == null && isPrimaryNetProfitLabel(label)) out.netProfit = val
  }
  return out
}

/**
 * Extract the header label for the rightmost data column of a named
 * Screener table section. Used to distinguish "TTM" from year-end.
 * Returns null if the table or thead is not found.
 */
export function parseLastColumnHeader(html: string, sectionId: string): string | null {
  const section = html.match(new RegExp(`id="${sectionId}"[\\s\\S]*?<table[\\s\\S]*?<\\/table>`))
  if (!section) return null
  const thead = section[0].match(/<thead>[\s\S]*?<\/thead>/)
  if (!thead) return null
  const ths: string[] = []
  const thRe = /<th[^>]*>\s*([\s\S]*?)\s*<\/th>/g
  let m
  while ((m = thRe.exec(thead[0]))) {
    const txt = m[1].replace(/<[^>]+>/g, '').trim()
    if (txt) ths.push(txt)
  }
  if (ths.length === 0) return null
  // The first <th> is the row-label column; the rest are data columns.
  return ths[ths.length - 1]
}

export function parseBalanceSheet(
  html: string
): {
  totalAssetsCr: number | null
  totalLiabilitiesCr: number | null
  /** Total equity = Equity Capital + Reserves (correct DuPont denominator). */
  equityCr: number | null
  /** Paid-up share capital only (face value × shares) — for diagnostics. */
  equityCapitalCr: number | null
  /** Reserves & surplus — for diagnostics. */
  reservesCr: number | null
} {
  const out = {
    totalAssetsCr: null as number | null,
    totalLiabilitiesCr: null as number | null,
    equityCr: null as number | null,
    equityCapitalCr: null as number | null,
    reservesCr: null as number | null,
  }
  const bsM = html.match(/id="balance-sheet"[\s\S]*?<table[\s\S]*?<\/table>/)
  if (!bsM) return out
  const rows = bsM[0].match(/<tr[\s\S]*?<\/tr>/g) || []
  for (const row of rows) {
    const labelM = row.match(/<td[^>]*class="[^"]*text[^"]*"[^>]*>([\s\S]*?)<\/td>/)
    if (!labelM) continue
    const label = normaliseScreenerLabel(labelM[1])
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []
    const lastCell = cells[cells.length - 1]
    if (!lastCell) continue
    const val = parseNum(lastCell.replace(/<[^>]+>/g, '').trim())
    // Reject derived / growth / % rows that occasionally live in the
    // same table section — they would otherwise poison the summary row.
    if (/(growth|variation|%|cagr)/.test(label)) continue
    if (label === 'total assets') out.totalAssetsCr = val
    else if (label === 'total liabilities') out.totalLiabilitiesCr = val
    // "Equity Capital" on Indian BS = paid-up share capital (face value × shares).
    // Total shareholders' equity needs Reserves added — without that, ROE and
    // Equity Multiplier come out exceptionally high (share capital is often
    // only 1-5% of total equity). We still expose the raw values for
    // transparency but equityCr is the sum, which is what all downstream
    // ratio math (DuPont, ROE, book value) should consume.
    else if (label === 'equity share capital' || label === 'equity capital' || label === 'share capital') {
      out.equityCapitalCr = val
    }
    else if (label === 'reserves' || label === 'reserves and surplus' || label === 'other equity') {
      // Only accept primary "Reserves" / "Reserves and Surplus" / "Other Equity"
      // lines — skip things like "Revaluation Reserve" sub-items that would
      // double-count. Screener collapses those into the top-level row.
      if (out.reservesCr == null) out.reservesCr = val
    }
  }
  // Synthesise total equity from the two components when both present.
  if (out.equityCapitalCr != null || out.reservesCr != null) {
    out.equityCr = (out.equityCapitalCr ?? 0) + (out.reservesCr ?? 0)
  }
  return out
}

// ── Multi-year data extraction ────────────────────────────────

export interface ScreenerYearData {
  year: string       // e.g. "Mar 2024", "Mar 2023"
  sales: number | null
  expenses: number | null
  operatingProfit: number | null
  opm: number | null
  otherIncome: number | null
  interest: number | null
  depreciation: number | null
  profitBeforeTax: number | null
  tax: number | null
  netProfit: number | null
  // Balance sheet
  totalAssets: number | null
  totalLiabilities: number | null
  equity: number | null
  reserves: number | null
  borrowings: number | null
  // Cash flow
  cfo: number | null
  cfi: number | null
  cff: number | null
  // Working capital (from ratios table)
  debtorDays: number | null
  inventoryDays: number | null
  daysPayable: number | null
  cashConversionCycle: number | null
  workingCapitalDays: number | null
  rocePct: number | null
}

export interface ScreenerMultiYear {
  ticker: string
  years: ScreenerYearData[]
  fetchedAt: string
}

/** Extract year headers from a Screener table section. */
function extractYearHeaders(tableHtml: string): string[] {
  const headerRow = tableHtml.match(/<thead>[\s\S]*?<\/thead>/)
  if (!headerRow) return []
  const years: string[] = []
  // Match data-date-key headers or plain <th> with year text
  const thRe = /<th[^>]*>\s*([\s\S]*?)\s*<\/th>/g
  let m
  while ((m = thRe.exec(headerRow[0]))) {
    const txt = m[1].replace(/<[^>]+>/g, '').trim()
    // Only include if it looks like a year (e.g. "Mar 2024", "2024", "TTM")
    if (/\d{4}|TTM/i.test(txt)) years.push(txt)
  }
  return years
}

/** Parse a Screener table extracting all year columns for each row label. */
function parseMultiYearTable(
  html: string,
  sectionId: string
): { years: string[]; rows: Record<string, (number | null)[]> } {
  const section = html.match(new RegExp(`id="${sectionId}"[\\s\\S]*?<table[\\s\\S]*?<\\/table>`))
  if (!section) return { years: [], rows: {} }
  const years = extractYearHeaders(section[0])
  if (!years.length) return { years, rows: {} }

  const rows: Record<string, (number | null)[]> = {}
  const trs = section[0].match(/<tr[\s\S]*?<\/tr>/g) || []
  for (const tr of trs) {
    const labelM = tr.match(/<td[^>]*class="[^"]*text[^"]*"[^>]*>([\s\S]*?)<\/td>/)
    if (!labelM) continue
    const label = normaliseScreenerLabel(labelM[1])
    const cells = tr.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []
    const dataCells = cells.slice(1) // skip label cell
    const values: (number | null)[] = []
    for (let i = 0; i < years.length; i++) {
      const cell = dataCells[i]
      values.push(cell ? parseNum(cell.replace(/<[^>]+>/g, '').trim()) : null)
    }
    rows[label] = values
  }
  return { years, rows }
}

/**
 * Find the first matching row by label.
 *
 * A pattern prefixed with "=" requires an exact match; plain patterns
 * fall back to substring match BUT skip any row whose label contains a
 * derived-metric suffix (growth / variation / % / cagr / margin). This
 * prevents "Compounded Sales Growth 3Years %" from being picked up as
 * the Sales series when the caller passes `findRow(rows, 'sales')`.
 */
function findRow(rows: Record<string, (number | null)[]>, ...patterns: string[]): (number | null)[] {
  // Only reject derived / growth / CAGR rows. Legitimate ratio labels
  // like "OPM %", "ROCE %", "Tax %" must still match their patterns, so
  // we don't blacklist plain "%" here — just growth-style suffixes.
  const isDerived = (label: string) =>
    /(growth|variation|cagr)/.test(label)
  for (const p of patterns) {
    // Exact-match pattern (prefixed with '='): bypasses the derived filter.
    if (p.startsWith('=')) {
      const exact = p.slice(1)
      const hit = rows[exact]
      if (hit) return hit
      continue
    }
    for (const [label, vals] of Object.entries(rows)) {
      if (isDerived(label)) continue
      if (label.includes(p)) return vals
    }
  }
  return []
}

/**
 * Extract multi-year P&L, Balance Sheet, and Cash Flow from Screener HTML.
 * Returns up to 10 years of data (whatever Screener provides).
 */
export function parseMultiYearFinancials(html: string): ScreenerYearData[] {
  const pl = parseMultiYearTable(html, 'profit-loss')
  const bs = parseMultiYearTable(html, 'balance-sheet')
  const cf = parseMultiYearTable(html, 'cash-flow')

  // Use P&L years as primary (most likely to have data)
  const yearLabels = pl.years.length ? pl.years : bs.years.length ? bs.years : cf.years
  if (!yearLabels.length) return []

  // Extract P&L rows
  const sales = findRow(pl.rows, 'sales', 'revenue', 'net sales')
  const expenses = findRow(pl.rows, 'total expenses', 'expenses')
  const opProfit = findRow(pl.rows, 'operating profit')
  const opmRow = findRow(pl.rows, 'opm')
  const otherIncome = findRow(pl.rows, 'other income')
  const interest = findRow(pl.rows, 'interest')
  const depreciation = findRow(pl.rows, 'depreciation')
  const pbt = findRow(pl.rows, 'profit before tax')
  const taxRow = findRow(pl.rows, 'tax')
  const netProfit = findRow(pl.rows, 'net profit', 'profit after tax')

  // Extract BS rows
  const totalAssets = findRow(bs.rows, 'total assets')
  const totalLiabilities = findRow(bs.rows, 'total liabilities')
  const equity = findRow(bs.rows, 'equity capital', 'share capital')
  const reserves = findRow(bs.rows, 'reserves')
  const borrowings = findRow(bs.rows, 'borrowings', 'total debt')

  // Extract CF rows
  const cfoRow = findRow(cf.rows, 'cash from operating', 'operating activity')
  const cfiRow = findRow(cf.rows, 'cash from investing', 'investing activity')
  const cffRow = findRow(cf.rows, 'cash from financing', 'financing activity')

  // Extract Ratios table (working capital, efficiency)
  const rt = parseMultiYearTable(html, 'ratios')
  const debtorDays = findRow(rt.rows, 'debtor')
  const inventoryDays = findRow(rt.rows, 'inventory')
  const daysPayable = findRow(rt.rows, 'payable')
  const cccRow = findRow(rt.rows, 'cash conversion')
  const wcDays = findRow(rt.rows, 'working capital')
  const roceRow = findRow(rt.rows, 'roce')

  // Balance-sheet column count usually ≤ P&L column count (BS has no TTM
  // column). If the BS table starts N years later than P&L, aligning by
  // index shifts the wrong equity value into each P&L year. Use bs.years
  // to find the index explicitly so Mar-2024 equity lines up with
  // Mar-2024 revenue, not with the next-younger year's balance.
  const bsIndexFor = (yearLabel: string, fallbackIdx: number): number => {
    const hit = bs.years.indexOf(yearLabel)
    return hit >= 0 ? hit : fallbackIdx
  }
  const cfIndexFor = (yearLabel: string, fallbackIdx: number): number => {
    const hit = cf.years.indexOf(yearLabel)
    return hit >= 0 ? hit : fallbackIdx
  }

  const mapped = yearLabels.map((year, i) => {
    // Match ratio year to P&L year (ratios may have different number of columns)
    const rIdx = rt.years.indexOf(year)
    const ri = rIdx >= 0 ? rIdx : i
    const bi = bsIndexFor(year, i)
    const ci = cfIndexFor(year, i)
    return {
      year,
      sales: sales[i] ?? null,
      expenses: expenses[i] ?? null,
      operatingProfit: opProfit[i] ?? null,
      opm: opmRow[i] ?? null,
      otherIncome: otherIncome[i] ?? null,
      interest: interest[i] ?? null,
      depreciation: depreciation[i] ?? null,
      profitBeforeTax: pbt[i] ?? null,
      tax: taxRow[i] ?? null,
      netProfit: netProfit[i] ?? null,
      totalAssets: totalAssets[bi] ?? null,
      totalLiabilities: totalLiabilities[bi] ?? null,
      equity: equity[bi] ?? null,
      reserves: reserves[bi] ?? null,
      borrowings: borrowings[bi] ?? null,
      cfo: cfoRow[ci] ?? null,
      cfi: cfiRow[ci] ?? null,
      cff: cffRow[ci] ?? null,
      debtorDays: debtorDays[ri] ?? null,
      inventoryDays: inventoryDays[ri] ?? null,
      daysPayable: daysPayable[ri] ?? null,
      cashConversionCycle: cccRow[ri] ?? null,
      workingCapitalDays: wcDays[ri] ?? null,
      rocePct: roceRow[ri] ?? null,
    }
  })

  // Screener renders years chronologically (oldest → newest, with TTM
  // rightmost for P&L). Downstream consumers expect newest-first so
  // that `latest = years[0]` picks the most recent period. Reversing
  // here — once — fixes ROE/growth calculations across the whole
  // stack (FSA panel, ratio charts, DuPont).
  return mapped.reverse()
}

/**
 * Parse Screener's `id="quarters"` table — last ~10 quarters of P&L.
 *
 * Returned array is **newest-first** (same contract as the annual
 * parser). Fields mirror the standard Screener quarterly row set.
 *
 * WARNING: This data is for DISPLAY ONLY. A quarter is ~3 months of
 * operations and must never be plugged into a model that expects
 * annualised figures — doing so would understate revenue by 4×, break
 * any TTM comparison, and silently corrupt DuPont / valuation outputs.
 * Callers should surface this through a read-only strip (sparkline,
 * trend arrows) separate from the annual / ratio panels.
 */
export function parseQuarters(html: string): ScreenerQuarter[] {
  const section = html.match(/id="quarters"[\s\S]*?<table[\s\S]*?<\/table>/)
  if (!section) return []

  // Extract period headers from <thead>.
  const headerRow = section[0].match(/<thead>[\s\S]*?<\/thead>/)
  if (!headerRow) return []
  const headers: string[] = []
  const thRe = /<th[^>]*>\s*([\s\S]*?)\s*<\/th>/g
  let thM
  while ((thM = thRe.exec(headerRow[0]))) {
    const txt = thM[1].replace(/<[^>]+>/g, '').trim()
    if (txt) headers.push(txt)
  }
  if (headers.length < 2) return []
  // First header is the row label; rest are period columns.
  const periods = headers.slice(1)

  // Build per-row value arrays (one slot per period column).
  type Slot = Array<number | null>
  const mk = (): Slot => periods.map(() => null)
  const sales = mk()
  const expenses = mk()
  const operatingProfit = mk()
  const opm = mk()
  const otherIncome = mk()
  const interest = mk()
  const depreciation = mk()
  const pbt = mk()
  const taxPct = mk()
  const netProfit = mk()
  const eps = mk()

  const bodyRows = section[0].match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []
  for (const row of bodyRows) {
    const labelM = row.match(/<td[^>]*class="[^"]*text[^"]*"[^>]*>([\s\S]*?)<\/td>/)
    if (!labelM) continue
    const label = normaliseScreenerLabel(labelM[1])

    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []
    const dataCells = cells.slice(1) // skip label cell
    const values = dataCells.map((c) => parseNum(c.replace(/<[^>]+>/g, '').trim()))

    let target: Slot | null = null
    if (label === 'sales' || label.startsWith('sales ') || label === 'revenue') target = sales
    else if (label === 'expenses' || label.startsWith('expenses ')) target = expenses
    else if (label.includes('operating profit')) target = operatingProfit
    else if (label === 'opm %' || label.includes('opm')) target = opm
    else if (label.includes('other income')) target = otherIncome
    else if (label === 'interest' || label.startsWith('interest ')) target = interest
    else if (label.includes('depreciation')) target = depreciation
    else if (label.includes('profit before tax')) target = pbt
    else if (label === 'tax %' || label.includes('tax %')) target = taxPct
    else if (label.includes('net profit')) target = netProfit
    else if (label === 'eps in rs' || label.startsWith('eps')) target = eps

    if (!target) continue
    for (let i = 0; i < Math.min(values.length, target.length); i++) {
      if (values[i] != null) target[i] = values[i]
    }
  }

  const rows: ScreenerQuarter[] = periods.map((period, i) => ({
    period,
    salesCr: sales[i] ?? null,
    expensesCr: expenses[i] ?? null,
    operatingProfitCr: operatingProfit[i] ?? null,
    opmPct: opm[i] ?? null,
    otherIncomeCr: otherIncome[i] ?? null,
    interestCr: interest[i] ?? null,
    depreciationCr: depreciation[i] ?? null,
    profitBeforeTaxCr: pbt[i] ?? null,
    taxPct: taxPct[i] ?? null,
    netProfitCr: netProfit[i] ?? null,
    epsRs: eps[i] ?? null,
  }))

  // Newest-first for consistency with parseMultiYearFinancials.
  return rows.reverse()
}

export function deriveScreenerRow(
  ticker: string,
  nse: string,
  name: string,
  raw: Record<string, number | null>,
  bs: ReturnType<typeof parseBalanceSheet>,
  plPeriod: string | null = null,
  bsPeriod: string | null = null
): ScreenerRow {
  const mktcapCr = raw.mktcap ?? null
  const salesCr = raw.sales ?? null
  const salesPrevCr = raw.salesPrev ?? null
  const opm = raw.opm ?? null
  const netProfitCr = raw.netProfit ?? null
  // Year-over-year revenue growth from the last two P&L columns. Only
  // emit a number when both sides are positive — a negative or zero prev
  // base produces meaningless percentages (turnaround companies coming
  // off a loss year). Rounded to 1 dp to match the rest of the row.
  const revgPct =
    salesCr != null && salesCr > 0 && salesPrevCr != null && salesPrevCr > 0
      ? Math.round(((salesCr / salesPrevCr - 1) * 100) * 10) / 10
      : null
  // Guard: if Screener reports OPM as 0 (or parsing fell through to 0)
  // we cannot trust the derived EBITDA / margin. Emit null so the
  // cascade merge falls back to the curated static baseline instead
  // of wiping out a valid non-zero margin with a bogus 0.
  const ebitdaCr = salesCr != null && salesCr > 0 && opm != null && opm > 0
    ? Math.round((salesCr * opm) / 100) : null
  const ebm = ebitdaCr != null && ebitdaCr > 0 && salesCr != null && salesCr > 0
    ? Math.round((ebitdaCr / salesCr) * 1000) / 10 : null
  const debt = raw.debt ?? null
  const evCr = mktcapCr != null ? mktcapCr + (debt ?? 0) : null
  const evEbitda = evCr != null && ebitdaCr != null && ebitdaCr > 0
    ? Math.round((evCr / ebitdaCr) * 10) / 10 : null
  const pbRatio = raw.price != null && raw.bookValue != null && raw.bookValue > 0
    ? Math.round((raw.price / raw.bookValue) * 100) / 100 : null
  const equity = pbRatio != null && mktcapCr != null && pbRatio > 0 ? mktcapCr / pbRatio : null
  const dbtEq = debt != null && equity != null && equity > 0
    ? Math.round((debt / equity) * 100) / 100 : null

  // Compose a human-readable period string. P&L uses TTM (trailing-12m)
  // as its rightmost column; BS uses the latest year-end. Making both
  // visible removes any ambiguity about what scraped numbers represent.
  const periodStr = plPeriod || bsPeriod
    ? `${plPeriod ?? '—'} (P&L) · ${bsPeriod ?? '—'} (BS)`
    : 'TTM / Latest Annual'

  return {
    ticker, nse, name, mktcapCr,
    pricePer: raw.price ?? null,
    pe: raw.pe ?? null,
    bookValue: raw.bookValue ?? null,
    dividendYield: raw.dividendYield ?? null,
    roce: raw.roce ?? null,
    roe: raw.roe ?? null,
    faceValue: raw.faceValue ?? null,
    salesCr, salesPrevCr, netProfitCr, opm, ebitdaCr, ebm, revgPct,
    evCr, evEbitda, dbtEq, pbRatio,
    totalAssetsCr: bs.totalAssetsCr,
    totalLiabilitiesCr: bs.totalLiabilitiesCr,
    equityCr: bs.equityCr,
    equityCapitalCr: bs.equityCapitalCr,
    reservesCr: bs.reservesCr,
    period: periodStr,
    plPeriod,
    bsPeriod,
    fetchedAt: new Date().toISOString(),
    source: 'screener.in',
  }
}

/**
 * Fetch the raw Screener HTML, preferring the consolidated variant
 * when it exists and has P&L data. Shared by `fetchOneScreener` and
 * the admin scrape-screener route (which runs its own ratios parser
 * on top of the HTML). Returns both the HTML and a flag so callers
 * can label the provenance.
 */
export async function fetchScreenerHtml(
  code: string
): Promise<{ html: string | null; consolidated: boolean }> {
  const urlConsolidated = `https://www.screener.in/company/${code}/consolidated/`
  const urlDefault = `https://www.screener.in/company/${code}/`
  const headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html',
  }
  const load = async (url: string): Promise<string | null> => {
    try {
      const r = await fetch(url, { headers })
      return r.ok ? await r.text() : null
    } catch {
      return null
    }
  }
  const cHtml = await load(urlConsolidated)
  if (cHtml) {
    const sanityPL = parseProfitLoss(cHtml)
    if (sanityPL.sales != null) return { html: cHtml, consolidated: true }
  }
  const dHtml = await load(urlDefault)
  return { html: dHtml, consolidated: false }
}

/**
 * Sanity-check a freshly-parsed ScreenerRow. Logs a warning when the
 * scraped values look implausible (e.g. sales that look quarterly, or
 * an OPM in the 0..1 fraction range). Does NOT mutate the row — the
 * downstream cascade is responsible for deciding how to react. Purely
 * diagnostic, scoped to server logs.
 */
function sanityCheckRow(ticker: string, code: string, row: ScreenerRow): void {
  const warn = (msg: string) =>
    console.warn(`[screener-fetch] ${ticker} (${code}): ${msg}`)
  if (row.salesCr != null && row.salesCr > 0 && row.salesCr < 50) {
    // A Nifty/SME listed company with <₹50Cr ANNUAL sales is highly
    // unusual; this is usually a sign the parser picked up a growth-%
    // or quarterly row instead of the real revenue line.
    warn(
      `salesCr=${row.salesCr} looks suspiciously small for an annual figure — ` +
      `possible parser label-collision with a growth/ratio row.`
    )
  }
  if (row.opm != null && row.opm > 0 && row.opm < 1) {
    warn(
      `opm=${row.opm} looks like a fraction rather than a percentage — ` +
      `Screener normally reports OPM as 0..100 (e.g. 18 = 18%).`
    )
  }
  if (row.netProfitCr != null && row.salesCr != null && row.salesCr > 0) {
    const ratio = row.netProfitCr / row.salesCr
    if (Math.abs(ratio) > 0.6) {
      warn(
        `netProfit/sales ratio = ${(ratio * 100).toFixed(1)}% — implausibly ` +
        `high net margin, possible label collision with "Net Profit Margin %".`
      )
    }
  }
}

export async function fetchOneScreener(
  ticker: string,
  code: string,
  name: string
): Promise<{
  row: ScreenerRow | null
  multiYear?: ScreenerYearData[]
  /** Display-only quarterly snapshots. NOT to be fed into calculations. */
  quarters?: ScreenerQuarter[]
  error?: string
}> {
  try {
    const { html, consolidated } = await fetchScreenerHtml(code)
    if (!html) return { row: null, error: 'HTTP fetch failed' }

    const topRatios = parseTopRatios(html)
    const pl = parseProfitLoss(html)
    const bs = parseBalanceSheet(html)
    const plPeriod = parseLastColumnHeader(html, 'profit-loss')
    const bsPeriod = parseLastColumnHeader(html, 'balance-sheet')
    const combined = { ...topRatios, ...pl }
    const row = deriveScreenerRow(ticker, code, name, combined, bs, plPeriod, bsPeriod)
    sanityCheckRow(ticker, consolidated ? `${code}/consolidated` : code, row)
    // Multi-year annual data (newest-first after parseMultiYearFinancials's reverse)
    const multiYear = parseMultiYearFinancials(html)
    // Quarterly snapshot — display-only, returned as a separate field so
    // it can never be accidentally merged into FSAInputs or ratio math.
    const quarters = parseQuarters(html)
    return {
      row,
      multiYear: multiYear.length > 0 ? multiYear : undefined,
      quarters: quarters.length > 0 ? quarters : undefined,
    }
  } catch (err) {
    return { row: null, error: err instanceof Error ? err.message : 'fetch failed' }
  }
}
