import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { COMPANIES, type Company } from '@/lib/data/companies'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import {
  nseSymbol,
  fetchNseQuote,
  buildExchangeRow,
  type ExchangeRow,
} from '@/lib/live/nse-fetch'

/**
 * POST /api/data/nse-quote — Tier 1 auto-refresh endpoint.
 *
 * Any authenticated user can call this (no admin gate). The auto-refresh
 * scheduler in LiveSnapshotProvider calls it every hour.
 *
 * Body: { tickers?: string[] }  — empty = all NSE-listed COMPANIES[]
 * Returns: { ok, data: Record<ticker, ExchangeRow>, count, total, errors }
 */
export { type ExchangeRow }

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }

  let requestedTickers: string[] | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (Array.isArray(body.tickers) && body.tickers.length > 0) {
      requestedTickers = body.tickers
    }
  } catch { /* empty = all */ }

  // Pool = static COMPANIES ∪ user_companies so admin-added SME / discovery
  // rows are refreshed every hour too. Without this merge the NSE Tier-1
  // scheduler would leave DB-added tickers stale forever, and the admin
  // "NSE: X/Y" status bar would undercount on both sides of the fraction.
  // DB row wins on ticker collision so an admin-edited nse symbol surfaces.
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
        // SME listings on NSE often report the ticker itself as the live
        // quote symbol, so fall back to the ticker when `nse` is empty.
        nse: r.nse || r.ticker,
        name: r.name,
      } as Company)
    }
  } catch (err) {
    console.warn('[nse-quote] user_companies read skipped:', err instanceof Error ? err.message : err)
  }

  const allCompanies = Array.from(pool.values())
  const targets = requestedTickers
    ? allCompanies.filter((c) => requestedTickers!.includes(c.ticker))
    : allCompanies.filter((c) => c.nse)

  const data: Record<string, ExchangeRow> = {}
  const errors: string[] = []

  for (let i = 0; i < targets.length; i++) {
    const co = targets[i]
    const symbol = nseSymbol(co.ticker, co.nse)
    try {
      const quote = await fetchNseQuote(symbol)
      if (!quote || !quote.priceInfo?.lastPrice) {
        errors.push(`${co.ticker} (${symbol}): no data`)
        continue
      }
      const row = buildExchangeRow(co, quote, symbol)
      if (row === null) {
        errors.push(`${co.ticker} (${symbol}): identity mismatch — resolved name did not match baseline`)
      } else {
        data[co.ticker] = row
      }
    } catch (err) {
      errors.push(`${co.ticker}: ${err instanceof Error ? err.message : 'failed'}`)
    }
    // NSE rate limit: ~1 req/sec
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 1100))
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
