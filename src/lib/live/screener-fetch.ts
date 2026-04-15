/**
 * Shared Screener.in fetch + parse logic.
 *
 * Used by the admin scrape-screener route (full publish flow + ratios)
 * and the non-admin screener-fill route (gap-filling for Tier 2).
 */

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
  netProfitCr: number | null
  opm: number | null
  ebitdaCr: number | null
  ebm: number | null
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
  BORORENEW: 'BFRENEWABL',
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

export function parseTopRatios(html: string): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  const block = html.match(/id="top-ratios"([\s\S]*?)(?:<\/ul>|<section)/)
  if (!block) return out
  const lis = block[1].split(/<li\b[^>]*>/)
  for (const li of lis) {
    const nameM = li.match(/<span class="name">\s*([\s\S]*?)<\/span>/)
    if (!nameM) continue
    const label = nameM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
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

export function parseProfitLoss(html: string): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  const plM = html.match(/id="profit-loss"[\s\S]*?<table[\s\S]*?<\/table>/)
  if (!plM) return out
  const rows = plM[0].match(/<tr[\s\S]*?<\/tr>/g) || []
  for (const row of rows) {
    const header = row.match(/<td[^>]*class="[^"]*text[^"]*"[^>]*>([\s\S]*?)<\/td>/)
    if (!header) continue
    const label = header[1].replace(/<[^>]+>/g, '').trim().toLowerCase()
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []
    const lastCell = cells[cells.length - 1]
    if (!lastCell) continue
    const val = parseNum(lastCell.replace(/<[^>]+>/g, '').trim())
    if (label.includes('sales') || label.includes('revenue')) out.sales = val
    if (label === 'opm %' || label.includes('opm')) out.opm = val
    if (label.includes('net profit') || label === 'profit after tax') out.netProfit = val
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
    const label = labelM[1].replace(/<[^>]+>/g, '').trim().toLowerCase()
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []
    const lastCell = cells[cells.length - 1]
    if (!lastCell) continue
    const val = parseNum(lastCell.replace(/<[^>]+>/g, '').trim())
    if (label.includes('total assets')) out.totalAssetsCr = val
    else if (label.includes('total liabilities')) out.totalLiabilitiesCr = val
    // "Equity Capital" on Indian BS = paid-up share capital (face value × shares).
    // Total shareholders' equity needs Reserves added — without that, ROE and
    // Equity Multiplier come out exceptionally high (share capital is often
    // only 1-5% of total equity). We still expose the raw values for
    // transparency but equityCr is the sum, which is what all downstream
    // ratio math (DuPont, ROE, book value) should consume.
    else if (label.includes('equity share capital') || label === 'equity capital' || label.includes('equity capital')) {
      out.equityCapitalCr = val
    }
    else if (label === 'reserves' || label.startsWith('reserves ') || label === 'other equity' || label === 'reserves and surplus') {
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
    const label = labelM[1].replace(/<[^>]+>/g, '').trim().toLowerCase()
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

/** Find the first matching row by partial label match. */
function findRow(rows: Record<string, (number | null)[]>, ...patterns: string[]): (number | null)[] {
  for (const p of patterns) {
    for (const [label, vals] of Object.entries(rows)) {
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
  const opm = raw.opm ?? null
  const netProfitCr = raw.netProfit ?? null
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
    salesCr, netProfitCr, opm, ebitdaCr, ebm, evCr, evEbitda, dbtEq, pbRatio,
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

export async function fetchOneScreener(
  ticker: string,
  code: string,
  name: string
): Promise<{ row: ScreenerRow | null; multiYear?: ScreenerYearData[]; error?: string }> {
  const url = `https://www.screener.in/company/${code}/`
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
    })
    if (!res.ok) return { row: null, error: `HTTP ${res.status}` }
    const html = await res.text()
    const topRatios = parseTopRatios(html)
    const pl = parseProfitLoss(html)
    const bs = parseBalanceSheet(html)
    const plPeriod = parseLastColumnHeader(html, 'profit-loss')
    const bsPeriod = parseLastColumnHeader(html, 'balance-sheet')
    const combined = { ...topRatios, ...pl }
    const row = deriveScreenerRow(ticker, code, name, combined, bs, plPeriod, bsPeriod)
    // Also extract multi-year data (newest-first after parseMultiYearFinancials's reverse)
    const multiYear = parseMultiYearFinancials(html)
    return { row, multiYear: multiYear.length > 0 ? multiYear : undefined }
  } catch (err) {
    return { row: null, error: err instanceof Error ? err.message : 'fetch failed' }
  }
}
