import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { COMPANIES } from '@/lib/data/companies'
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

  const targets = requestedTickers
    ? COMPANIES.filter((c) => requestedTickers!.includes(c.ticker))
    : COMPANIES.filter((c) => c.nse)

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
      data[co.ticker] = buildExchangeRow(co, quote, symbol)
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
