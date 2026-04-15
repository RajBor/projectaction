import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { COMPANIES } from '@/lib/data/companies'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import {
  screenerCode as sharedScreenerCode,
  parseTopRatios as sharedParseTopRatios,
  parseProfitLoss as sharedParseProfitLoss,
  parseBalanceSheet as sharedParseBalanceSheet,
  parseLastColumnHeader as sharedParseLastColumnHeader,
  parseQuarters as sharedParseQuarters,
  deriveScreenerRow as sharedDeriveRow,
  fetchScreenerHtml,
  normaliseScreenerLabel,
  type ScreenerRow as SharedScreenerRow,
  type ScreenerQuarter,
} from '@/lib/live/screener-fetch'

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

// Re-export the canonical ScreenerRow from the shared module so downstream
// consumers (admin page, API clients) see one consistent shape.
export type ScreenerRow = SharedScreenerRow

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
//
// The canonical symbol mapping + parsers live in `@/lib/live/screener-fetch`.
// We re-bind the shared helpers under the names this file used to export
// locally, so the route handler below can keep its existing call sites.
// This used to be duplicated here — and the duplicate `parseBalanceSheet`
// in particular silently dropped Reserves, which broke DuPont ROE across
// the app for any company scraped via the admin route.

const screenerCode = sharedScreenerCode
const parseTopRatios = sharedParseTopRatios
const parseProfitLoss = sharedParseProfitLoss
const parseBalanceSheet = sharedParseBalanceSheet
const parseLastColumnHeader = sharedParseLastColumnHeader
const parseQuarters = sharedParseQuarters
const deriveRow = sharedDeriveRow

// ── Local parser: multi-year ratios (admin-specific ratio bundle) ───

function parseNum(s: string | undefined): number | null {
  if (!s) return null
  const cleaned = s.replace(/[,₹%\s]/g, '').trim()
  if (!cleaned || cleaned === '-') return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
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
    // Share the normaliser with screener-fetch so ratios-table labels
    // decode `&nbsp;` / strip `+` the same way the P&L parser does.
    const label = normaliseScreenerLabel(labelM[1])

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

// ── Fetch one company ────────────────────────────────────────

async function fetchOne(
  ticker: string,
  code: string,
  name: string
): Promise<{
  row: ScreenerRow | null
  ratios: ScreenerRatioRow | null
  /** Display-only quarterly snapshots. NEVER fed into calculations. */
  quarters: ScreenerQuarter[] | null
  error?: string
}> {
  try {
    // Use the shared helper so the admin route inherits consolidated-first
    // fallback logic (same as the Tier-2 gap-fill route). For companies
    // like Premier Energies where only the consolidated page has the
    // full P&L / BS, this avoids the standalone-page mis-scrape we were
    // seeing before.
    const { html } = await fetchScreenerHtml(code)
    if (!html) {
      return { row: null, ratios: null, quarters: null, error: 'HTTP fetch failed' }
    }
    const topRatios = parseTopRatios(html)
    const pl = parseProfitLoss(html)
    const bs = parseBalanceSheet(html)
    // Capture the rightmost header of each table so admins can tell
    // whether P&L is TTM vs year-end and BS is which year-end.
    const plPeriod = parseLastColumnHeader(html, 'profit-loss')
    const bsPeriod = parseLastColumnHeader(html, 'balance-sheet')
    const combined = { ...topRatios, ...pl }
    const row = deriveRow(ticker, code, name, combined, bs, plPeriod, bsPeriod)
    const ratioYears = parseRatiosTable(html)
    const ratios: ScreenerRatioRow = {
      ticker,
      name,
      years: ratioYears,
      fetchedAt: new Date().toISOString(),
    }
    // Quarterly snapshot — separate field so it can never be merged
    // into annual calculations. The UI is expected to render it as a
    // read-only momentum strip.
    const quarters = parseQuarters(html)
    return {
      row,
      ratios: ratioYears.length > 0 ? ratios : null,
      quarters: quarters.length > 0 ? quarters : null,
    }
  } catch (err) {
    return {
      row: null,
      ratios: null,
      quarters: null,
      error: err instanceof Error ? err.message : 'fetch failed',
    }
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

  // Pool = static COMPANIES ∪ user_companies so admin-added SME /
  // discovery rows are scraped on the default (no body) pass. DB rows
  // win on ticker collisions so admin-updated names/codes surface.
  type CoSlim = { ticker: string; nse: string | null; name: string }
  const pool = new Map<string, CoSlim>()
  for (const c of COMPANIES) {
    if (c.nse || requestedTickers?.includes(c.ticker)) {
      pool.set(c.ticker, { ticker: c.ticker, nse: c.nse || null, name: c.name })
    }
  }
  try {
    await ensureSchema()
    const dbRows = await sql`SELECT ticker, nse, name FROM user_companies`
    for (const r of dbRows as Array<{ ticker: string; nse: string | null; name: string }>) {
      pool.set(r.ticker, {
        ticker: r.ticker,
        // For SME listings the NSE column often IS the ticker — Screener
        // looks up "/company/<CODE>" where CODE is the NSE symbol.
        nse: r.nse || r.ticker,
        name: r.name,
      })
    }
  } catch (err) {
    console.warn('[scrape-screener] user_companies read skipped:', err instanceof Error ? err.message : err)
  }

  const comps = requestedTickers
    ? Array.from(pool.values()).filter((c) => requestedTickers!.includes(c.ticker))
    : Array.from(pool.values()).filter((c) => c.nse)
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
  const quarters: Record<string, ScreenerQuarter[]> = {}
  const errors: string[] = []

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    const result = await fetchOne(t.ticker, t.code, t.name)
    if (result.row) data[t.ticker] = result.row
    if (result.ratios) ratios[t.ticker] = result.ratios
    if (result.quarters) quarters[t.ticker] = result.quarters
    if (result.error) errors.push(`${t.ticker} (${t.code}): ${result.error}`)
    // Rate limit
    if (i < targets.length - 1) await new Promise((r) => setTimeout(r, 550))
  }

  return NextResponse.json({
    ok: true,
    data,
    ratios,
    // Display-only momentum data; admin UI can render a read-only
    // "last 4 quarters" strip from this but must never mix it into
    // annual valuation or ratio calculations.
    quarters,
    count: Object.keys(data).length,
    total: targets.length,
    errors: errors.length > 0 ? errors : undefined,
  })
}
