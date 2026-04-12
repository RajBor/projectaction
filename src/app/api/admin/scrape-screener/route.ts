import { isAdminOrSubadmin, extractRole } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { COMPANIES } from '@/lib/data/companies'

/**
 * POST /api/admin/scrape-screener
 *
 * Admin-only. Fetches company pages from screener.in, parses:
 *   1. Top-ratios (market cap, PE, PB, ROCE, ROE, debt etc.)
 *   2. Profit-loss latest column (Sales, OPM, Net Profit)
 *   3. Ratios section — multi-year time series (DSO, DIO, DPO, CCC,
 *      Working Capital Days, ROCE%)
 *   4. Balance sheet latest column (Total Assets, Total Liabilities, Equity)
 *
 * Body: { tickers?: string[], codes?: {ticker,code}[] }
 *   - tickers = filter to these COMPANIES[] tickers
 *   - codes = scrape arbitrary NSE codes (for SME discovery)
 * Returns: { ok, data, ratios, errors }
 */

// ── Types ────────────────────────────────────────────────────

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
  /** Balance sheet */
  totalAssetsCr: number | null
  totalLiabilitiesCr: number | null
  equityCr: number | null
  period: string
  fetchedAt: string
  source: 'screener.in'
}

export interface ScreenerRatioYear {
  year: string // "Mar 2024"
  debtorDays: number | null
  inventoryDays: number | null
  daysPayable: number | null
  cashConversionCycle: number | null
  workingCapitalDays: number | null
  rocePct: number | null
}

export interface ScreenerRatioRow {
  ticker: string
  name: string
  years: ScreenerRatioYear[]
  fetchedAt: string
}

// ── NSE code mapping ─────────────────────────────────────────

const SCREENER_CODE: Record<string, string> = {
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

function screenerCode(ticker: string, nse: string | null): string {
  return SCREENER_CODE[ticker] ?? nse ?? ticker
}

// ── HTML parsers ─────────────────────────────────────────────

function parseNum(s: string | undefined): number | null {
  if (!s) return null
  const cleaned = s.replace(/[,₹%\s]/g, '').trim()
  if (!cleaned || cleaned === '-') return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

function parseTopRatios(html: string): Record<string, number | null> {
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

function parseProfitLoss(html: string): Record<string, number | null> {
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

/** Parse the multi-year ratios table (DSO, DIO, DPO, CCC, WC Days, ROCE). */
function parseRatiosTable(html: string): ScreenerRatioYear[] {
  const section = html.match(/id="ratios"[\s\S]*?<table[\s\S]*?<\/table>/)
  if (!section) return []

  // Extract column headers (years)
  const headerRow = section[0].match(/<thead>[\s\S]*?<\/thead>/)
  if (!headerRow) return []
  const yearHeaders: string[] = []
  const thRe = /data-date-key="[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/th>/g
  let thM
  while ((thM = thRe.exec(headerRow[0]))) {
    yearHeaders.push(thM[1].replace(/<[^>]+>/g, '').trim())
  }
  if (yearHeaders.length === 0) return []

  // Initialize year objects
  const years: ScreenerRatioYear[] = yearHeaders.map((y) => ({
    year: y,
    debtorDays: null,
    inventoryDays: null,
    daysPayable: null,
    cashConversionCycle: null,
    workingCapitalDays: null,
    rocePct: null,
  }))

  // Parse each data row
  const rows = section[0].match(/<tr[\s\S]*?<\/tr>/g) || []
  for (const row of rows) {
    const labelM = row.match(/<td[^>]*class="[^"]*text[^"]*"[^>]*>([\s\S]*?)<\/td>/)
    if (!labelM) continue
    const label = labelM[1].replace(/<[^>]+>/g, '').trim().toLowerCase()

    // Extract all numeric cells
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []
    // Skip the first cell (label)
    const dataCells = cells.slice(1)

    let fieldKey: keyof ScreenerRatioYear | null = null
    if (label.includes('debtor')) fieldKey = 'debtorDays'
    else if (label.includes('inventory')) fieldKey = 'inventoryDays'
    else if (label.includes('payable')) fieldKey = 'daysPayable'
    else if (label.includes('cash conversion')) fieldKey = 'cashConversionCycle'
    else if (label.includes('working capital')) fieldKey = 'workingCapitalDays'
    else if (label.includes('roce')) fieldKey = 'rocePct'

    if (!fieldKey) continue

    for (let i = 0; i < Math.min(dataCells.length, years.length); i++) {
      const val = parseNum(dataCells[i].replace(/<[^>]+>/g, '').trim())
      if (val != null) {
        ;(years[i] as unknown as Record<string, unknown>)[fieldKey] = val
      }
    }
  }

  return years
}

/** Parse balance sheet latest year: Total Assets, Total Liabilities, Equity. */
function parseBalanceSheet(
  html: string
): { totalAssetsCr: number | null; totalLiabilitiesCr: number | null; equityCr: number | null } {
  const out = { totalAssetsCr: null as number | null, totalLiabilitiesCr: null as number | null, equityCr: null as number | null }
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
    else if (label.includes('equity capital')) out.equityCr = val
  }
  return out
}

// ── Derivation ───────────────────────────────────────────────

function deriveRow(
  ticker: string,
  nse: string,
  name: string,
  raw: Record<string, number | null>,
  bs: ReturnType<typeof parseBalanceSheet>
): ScreenerRow {
  const mktcapCr = raw.mktcap ?? null
  const salesCr = raw.sales ?? null
  const opm = raw.opm ?? null
  const netProfitCr = raw.netProfit ?? null
  const ebitdaCr = salesCr != null && opm != null ? Math.round((salesCr * opm) / 100) : null
  const ebm = ebitdaCr != null && salesCr != null && salesCr > 0
    ? Math.round((ebitdaCr / salesCr) * 1000) / 10
    : null
  const debt = raw.debt ?? null
  const evCr = mktcapCr != null ? mktcapCr + (debt ?? 0) : null
  const evEbitda = evCr != null && ebitdaCr != null && ebitdaCr > 0
    ? Math.round((evCr / ebitdaCr) * 10) / 10
    : null
  const pbRatio = raw.price != null && raw.bookValue != null && raw.bookValue > 0
    ? Math.round((raw.price / raw.bookValue) * 100) / 100
    : null
  const equity = pbRatio != null && mktcapCr != null && pbRatio > 0
    ? mktcapCr / pbRatio
    : null
  const dbtEq = debt != null && equity != null && equity > 0
    ? Math.round((debt / equity) * 100) / 100
    : null

  return {
    ticker, nse, name,
    mktcapCr,
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
    period: 'TTM / Latest Annual',
    fetchedAt: new Date().toISOString(),
    source: 'screener.in',
  }
}

// ── Fetch one company ────────────────────────────────────────

async function fetchOne(
  ticker: string,
  code: string,
  name: string
): Promise<{
  row: ScreenerRow | null
  ratios: ScreenerRatioRow | null
  error?: string
}> {
  const url = `https://www.screener.in/company/${code}/`
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
    })
    if (!res.ok) return { row: null, ratios: null, error: `HTTP ${res.status}` }
    const html = await res.text()
    const topRatios = parseTopRatios(html)
    const pl = parseProfitLoss(html)
    const bs = parseBalanceSheet(html)
    const combined = { ...topRatios, ...pl }
    const row = deriveRow(ticker, code, name, combined, bs)
    const ratioYears = parseRatiosTable(html)
    const ratios: ScreenerRatioRow = {
      ticker,
      name,
      years: ratioYears,
      fetchedAt: new Date().toISOString(),
    }
    return { row, ratios: ratioYears.length > 0 ? ratios : null }
  } catch (err) {
    return { row: null, ratios: null, error: err instanceof Error ? err.message : 'fetch failed' }
  }
}

// ── Route handler ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let requestedTickers: string[] | null = null
  let extraCodes: Array<{ ticker: string; code: string; name?: string }> | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (Array.isArray(body.tickers) && body.tickers.length > 0) {
      requestedTickers = body.tickers as string[]
    }
    if (Array.isArray(body.codes) && body.codes.length > 0) {
      extraCodes = body.codes
    }
  } catch {
    // empty body = all
  }

  const targets: Array<{ ticker: string; code: string; name: string }> = []

  // Existing COMPANIES
  const comps = requestedTickers
    ? COMPANIES.filter((c) => requestedTickers!.includes(c.ticker))
    : COMPANIES.filter((c) => c.nse)
  for (const co of comps) {
    targets.push({
      ticker: co.ticker,
      code: screenerCode(co.ticker, co.nse),
      name: co.name,
    })
  }

  // Extra codes (from SME discovery)
  if (extraCodes) {
    for (const ec of extraCodes) {
      if (!targets.some((t) => t.code === ec.code)) {
        targets.push({
          ticker: ec.ticker || ec.code,
          code: ec.code,
          name: ec.name || ec.code,
        })
      }
    }
  }

  const data: Record<string, ScreenerRow> = {}
  const ratios: Record<string, ScreenerRatioRow> = {}
  const errors: string[] = []

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    const result = await fetchOne(t.ticker, t.code, t.name)
    if (result.row) data[t.ticker] = result.row
    if (result.ratios) ratios[t.ticker] = result.ratios
    if (result.error) errors.push(`${t.ticker} (${t.code}): ${result.error}`)
    // Rate limit
    if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 550))
  }

  return NextResponse.json({
    ok: true,
    data,
    ratios,
    count: Object.keys(data).length,
    total: targets.length,
    errors: errors.length > 0 ? errors : undefined,
  })
}
