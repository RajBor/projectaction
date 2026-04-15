import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { COMPANIES, type Company } from '@/lib/data/companies'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import {
  screenerCode,
  fetchOneScreener,
  type ScreenerRow,
  type ScreenerYearData,
  type ScreenerQuarter,
} from '@/lib/live/screener-fetch'

/**
 * POST /api/data/screener-fill — Tier 2 gap-fill endpoint.
 *
 * Any authenticated user can call this (no admin gate). The auto-refresh
 * scheduler calls it at 9am, 12:01pm, 4pm IST for companies whose
 * Tier 1 (NSE) data left gaps.
 *
 * Body: { tickers: string[], multiYear?: boolean, quarters?: boolean }
 *   tickers REQUIRED, max 20
 *   multiYear — include annual 10-year financials (for charts / CAGR)
 *   quarters  — include last ~10 quarters (DISPLAY-ONLY; must never be
 *               piped into annual CAGR / DuPont / valuation math)
 * Returns: { ok, data, multiYear?, quarters?, count, errors }
 */
export { type ScreenerRow, type ScreenerYearData, type ScreenerQuarter }

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }

  let tickers: string[] = []
  let wantMultiYear = false
  let wantQuarters = false
  try {
    const body = await req.json().catch(() => ({}))
    if (Array.isArray(body.tickers)) {
      tickers = body.tickers.slice(0, 20) // cap at 20
    }
    if (body.multiYear === true) wantMultiYear = true
    if (body.quarters === true) wantQuarters = true
  } catch { /* ignore */ }

  if (tickers.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'tickers[] required (max 20)' },
      { status: 400 }
    )
  }

  // Pool = static COMPANIES ∪ user_companies so admin-added SME rows also
  // get Tier-2 gap-fill. Without this the scheduler would skip DB tickers
  // entirely — the admin status bar's "Screener: X/Y" would never reach
  // parity with the true total universe.
  const pool = new Map<string, Company>()
  for (const c of COMPANIES) pool.set(c.ticker, c)
  try {
    await ensureSchema()
    const dbRows = await sql`
      SELECT ticker, nse, name FROM user_companies
    `
    for (const r of dbRows as Array<{ ticker: string; nse: string | null; name: string }>) {
      const base = pool.get(r.ticker)
      pool.set(r.ticker, {
        ...(base ?? ({ ticker: r.ticker } as Company)),
        ticker: r.ticker,
        nse: r.nse || r.ticker,
        name: r.name,
      } as Company)
    }
  } catch (err) {
    console.warn('[screener-fill] user_companies read skipped:', err instanceof Error ? err.message : err)
  }

  const targets = Array.from(pool.values()).filter((c) => tickers.includes(c.ticker))
  const data: Record<string, ScreenerRow> = {}
  const multiYearData: Record<string, ScreenerYearData[]> = {}
  const quartersData: Record<string, ScreenerQuarter[]> = {}
  const errors: string[] = []

  for (let i = 0; i < targets.length; i++) {
    const co = targets[i]
    const code = screenerCode(co.ticker, co.nse)
    const result = await fetchOneScreener(co.ticker, code, co.name)
    if (result.row) data[co.ticker] = result.row
    if (result.multiYear && result.multiYear.length > 0) {
      multiYearData[co.ticker] = result.multiYear
    }
    if (result.quarters && result.quarters.length > 0) {
      quartersData[co.ticker] = result.quarters
    }
    if (result.error) errors.push(`${co.ticker}: ${result.error}`)
    // Rate limit: ~2 req/sec
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 550))
    }
  }

  return NextResponse.json({
    ok: true,
    data,
    ...(wantMultiYear && Object.keys(multiYearData).length > 0 ? { multiYear: multiYearData } : {}),
    ...(wantQuarters && Object.keys(quartersData).length > 0 ? { quarters: quartersData } : {}),
    count: Object.keys(data).length,
    errors: errors.length > 0 ? errors : undefined,
  })
}
