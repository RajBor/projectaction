import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { COMPANIES } from '@/lib/data/companies'

/**
 * POST /api/admin/scrape-screener
 *
 * Admin-only endpoint that fetches company pages from screener.in and
 * parses the top-ratios section. No puppeteer — just fetch + regex on
 * the server, rate-limited to ~2 req/sec so we're respectful.
 *
 * Body: { tickers?: string[] }   — empty/missing = all COMPANIES[]
 * Returns: { ok, data: Record<ticker, ScreenerRow>, errors: string[] }
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
  /** Derived fields — filled when the raw HTML gives us enough. */
  salesCr: number | null
  netProfitCr: number | null
  opm: number | null
  /** Our derivations */
  ebitdaCr: number | null
  ebm: number | null
  evCr: number | null
  evEbitda: number | null
  dbtEq: number | null
  pbRatio: number | null
  period: string
  fetchedAt: string
  source: 'screener.in'
}

// ── NSE code mapping ─────────────────────────────────────────

/** Screener uses the NSE code in the URL. Most of our COMPANIES[]
 *  already have a `.nse` field. Override the few that differ. */
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

// ── HTML parser ──────────────────────────────────────────────

function parseNum(s: string | undefined): number | null {
  if (!s) return null
  const cleaned = s.replace(/[,₹%\s]/g, '').trim()
  if (!cleaned || cleaned === '-') return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Extract all top-ratios from screener HTML. The section is:
 *  <ul id="top-ratios"> ... <li>...<span class="name">Label</span>
 *  ...<span class="number">Value</span>...</li> ... </ul>
 */
function parseScreenerHTML(html: string): Record<string, number | null> {
  const out: Record<string, number | null> = {}

  // Extract the top-ratios block
  const ratiosMatch = html.match(
    /id="top-ratios"([\s\S]*?)(?:<\/ul>|<section)/
  )
  if (!ratiosMatch) return out
  const block = ratiosMatch[1]

  // Split into individual <li> blocks
  const liBlocks = block.split(/<li\b[^>]*>/)
  for (const li of liBlocks) {
    // Extract the label
    const nameMatch = li.match(/<span class="name">\s*([\s\S]*?)<\/span>/)
    if (!nameMatch) continue
    const label = nameMatch[1]
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()

    // Extract the first <span class="number">
    const numMatch = li.match(/<span class="number">([\s\S]*?)<\/span>/)
    if (!numMatch) continue
    const value = parseNum(numMatch[1])

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

  // Extract the latest annual P&L section — Sales, OPM, Net Profit
  // These live in the "profit-loss" section table. We want the latest
  // TTM or annual column.
  const salesMatch = html.match(
    /Compounded Sales Growth[\s\S]*?TTM[^<]*<[^>]*>([^<]*)/
  )
  // Fallback: look for the "profit-loss" table's header + first data row
  const plMatch = html.match(
    /id="profit-loss"[\s\S]*?<table[\s\S]*?<\/table>/
  )
  if (plMatch) {
    // Latest column = last <td> in the first data row
    const rows = plMatch[0].match(/<tr[\s\S]*?<\/tr>/g) || []
    for (const row of rows) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []
      const header = row.match(/<td[^>]*class="[^"]*text[^"]*"[^>]*>([\s\S]*?)<\/td>/)
      if (!header) continue
      const label = header[1].replace(/<[^>]+>/g, '').trim().toLowerCase()
      // Get the last numeric cell (TTM or latest year)
      const lastCell = cells[cells.length - 1]
      if (!lastCell) continue
      const numStr = lastCell.replace(/<[^>]+>/g, '').trim()
      const val = parseNum(numStr)
      if (label.includes('sales') || label.includes('revenue'))
        out.sales = val
      if (label === 'opm %' || label.includes('opm'))
        out.opm = val
      if (label.includes('net profit') || label === 'profit after tax')
        out.netProfit = val
    }
  }

  return out
}

function deriveScreenerRow(
  ticker: string,
  nse: string,
  name: string,
  raw: Record<string, number | null>
): ScreenerRow {
  const mktcapCr = raw.mktcap ?? null
  const salesCr = raw.sales ?? null
  const opm = raw.opm ?? null
  const netProfitCr = raw.netProfit ?? null

  // EBITDA ≈ Sales × OPM%
  const ebitdaCr =
    salesCr != null && opm != null ? Math.round((salesCr * opm) / 100) : null

  // EBM = ebitda / sales × 100
  const ebm =
    ebitdaCr != null && salesCr != null && salesCr > 0
      ? Math.round((ebitdaCr / salesCr) * 1000) / 10
      : null

  // EV = MktCap + Debt (screener gives total debt in the ratios)
  const debt = raw.debt ?? null
  const evCr =
    mktcapCr != null ? mktcapCr + (debt ?? 0) : null

  // EV/EBITDA
  const evEbitda =
    evCr != null && ebitdaCr != null && ebitdaCr > 0
      ? Math.round((evCr / ebitdaCr) * 10) / 10
      : null

  // P/B
  const pbRatio =
    raw.price != null && raw.bookValue != null && raw.bookValue > 0
      ? Math.round((raw.price / raw.bookValue) * 100) / 100
      : null

  // D/E — debt / (mktcap / pb) → debt / equity. Equity = mktcap / pb
  const equity = pbRatio != null && mktcapCr != null && pbRatio > 0
    ? mktcapCr / pbRatio
    : null
  const dbtEq =
    debt != null && equity != null && equity > 0
      ? Math.round((debt / equity) * 100) / 100
      : null

  return {
    ticker,
    nse,
    name,
    mktcapCr,
    pricePer: raw.price ?? null,
    pe: raw.pe ?? null,
    bookValue: raw.bookValue ?? null,
    dividendYield: raw.dividendYield ?? null,
    roce: raw.roce ?? null,
    roe: raw.roe ?? null,
    faceValue: raw.faceValue ?? null,
    salesCr,
    netProfitCr,
    opm,
    ebitdaCr,
    ebm,
    evCr,
    evEbitda,
    dbtEq,
    pbRatio,
    period: 'TTM / Latest Annual',
    fetchedAt: new Date().toISOString(),
    source: 'screener.in',
  }
}

// ── Route handler ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let requestedTickers: string[] | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (Array.isArray(body.tickers) && body.tickers.length > 0) {
      requestedTickers = body.tickers as string[]
    }
  } catch {
    // empty body = all
  }

  const targets = requestedTickers
    ? COMPANIES.filter((c) => requestedTickers!.includes(c.ticker))
    : COMPANIES.filter((c) => c.nse)

  const data: Record<string, ScreenerRow> = {}
  const errors: string[] = []

  for (let i = 0; i < targets.length; i++) {
    const co = targets[i]
    const code = screenerCode(co.ticker, co.nse)
    const url = `https://www.screener.in/company/${code}/`
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html',
        },
      })
      if (!res.ok) {
        errors.push(`${co.ticker} (${code}): HTTP ${res.status}`)
        continue
      }
      const html = await res.text()
      const raw = parseScreenerHTML(html)
      const row = deriveScreenerRow(co.ticker, code, co.name, raw)
      data[co.ticker] = row
    } catch (err) {
      errors.push(
        `${co.ticker}: ${err instanceof Error ? err.message : 'fetch failed'}`
      )
    }
    // Rate limit: ~2 req/sec
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 550))
    }
  }

  return NextResponse.json({
    ok: true,
    data,
    count: Object.keys(data).length,
    total: targets.length,
    errors: errors.length > 0 ? errors : undefined,
  })
}
