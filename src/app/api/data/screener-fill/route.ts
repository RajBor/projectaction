import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { COMPANIES } from '@/lib/data/companies'
import {
  screenerCode,
  fetchOneScreener,
  type ScreenerRow,
} from '@/lib/live/screener-fetch'

/**
 * POST /api/data/screener-fill — Tier 2 gap-fill endpoint.
 *
 * Any authenticated user can call this (no admin gate). The auto-refresh
 * scheduler calls it at 9am, 12:01pm, 4pm IST for companies whose
 * Tier 1 (NSE) data left gaps.
 *
 * Body: { tickers: string[] }  — REQUIRED, max 20 per request
 * Returns: { ok, data: Record<ticker, ScreenerRow>, count, errors }
 */
export { type ScreenerRow }

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }

  let tickers: string[] = []
  try {
    const body = await req.json().catch(() => ({}))
    if (Array.isArray(body.tickers)) {
      tickers = body.tickers.slice(0, 20) // cap at 20
    }
  } catch { /* ignore */ }

  if (tickers.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'tickers[] required (max 20)' },
      { status: 400 }
    )
  }

  const targets = COMPANIES.filter((c) => tickers.includes(c.ticker))
  const data: Record<string, ScreenerRow> = {}
  const errors: string[] = []

  for (let i = 0; i < targets.length; i++) {
    const co = targets[i]
    const code = screenerCode(co.ticker, co.nse)
    const result = await fetchOneScreener(co.ticker, code, co.name)
    if (result.row) data[co.ticker] = result.row
    if (result.error) errors.push(`${co.ticker}: ${result.error}`)
    // Rate limit: ~2 req/sec
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 550))
    }
  }

  return NextResponse.json({
    ok: true,
    data,
    count: Object.keys(data).length,
    errors: errors.length > 0 ? errors : undefined,
  })
}
