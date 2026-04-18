import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { loadCompanyPool } from '@/lib/live/company-pool'

/**
 * GET /api/admin/fetch-missing
 *
 * Returns the list of tickers that are in the universe (COMPANIES +
 * user_companies + atlas) but currently have no financial baseline
 * (`mktcap = rev = ebitda = 0` in user_companies), and haven't already
 * been banked as permanently-failed (`baseline_fetch_status != 'exhausted'`
 * AND `baseline_fetch_attempts < MAX_ATTEMPTS`).
 *
 * Drives the "⚡ Fetch Missing Financials (N)" admin button — the sweep
 * feeds this list straight into the existing runExchangeSweep, so the
 * user-facing contract matches the regular sweep (per-batch auto-publish,
 * module-scope AbortController, progress events survive navigation).
 *
 * Admin / sub-admin only.
 */

export const runtime = 'nodejs'

/**
 * Max scrape attempts per ticker before we bank it as permanently-failed.
 * 3 covers the typical NSE blip + Screener 429 + Screener 404-on-first-try
 * recovery pattern without soaking our daily quota on truly dead tickers.
 */
const MAX_ATTEMPTS = 3

export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  try {
    await ensureSchema()

    // Pull the full pool (static + user_companies + atlas) so atlas-only
    // tickers are considered "missing" even though they don't have a
    // user_companies row yet. The sweep's per-batch publish path will
    // seed those rows on first successful fetch.
    const pool = await loadCompanyPool()
    const allTickers = Array.from(pool.keys())

    // Current state of user_companies: what's already got financials,
    // what's been tried, and what's been banked.
    const dbRows = await sql`
      SELECT ticker,
             COALESCE(mktcap, 0)::numeric AS mktcap,
             COALESCE(rev, 0)::numeric AS rev,
             COALESCE(ebitda, 0)::numeric AS ebitda,
             COALESCE(baseline_fetch_attempts, 0) AS attempts,
             COALESCE(baseline_fetch_status, 'pending') AS status
      FROM user_companies
    ` as Array<{
      ticker: string
      mktcap: string | number
      rev: string | number
      ebitda: string | number
      attempts: number
      status: string
    }>

    const dbIndex = new Map<string, { mktcap: number; rev: number; ebitda: number; attempts: number; status: string }>()
    for (const r of dbRows) {
      dbIndex.set(r.ticker, {
        mktcap: Number(r.mktcap) || 0,
        rev: Number(r.rev) || 0,
        ebitda: Number(r.ebitda) || 0,
        attempts: Number(r.attempts) || 0,
        status: r.status || 'pending',
      })
    }

    const missing: string[] = []
    const exhausted: string[] = []
    let filled = 0
    for (const t of allTickers) {
      const row = dbIndex.get(t)
      if (row && (row.mktcap > 0 || row.rev > 0 || row.ebitda > 0)) {
        filled++
        continue
      }
      // No user_companies row or all-zero row → candidate.
      if (row && row.status === 'exhausted') { exhausted.push(t); continue }
      if (row && row.attempts >= MAX_ATTEMPTS) { exhausted.push(t); continue }
      missing.push(t)
    }

    // Today's scrape budget so the UI can surface "N/M used today".
    const todayKey = new Date().toISOString().slice(0, 10)
    const budgetRows = await sql`
      SELECT nse_calls, screener_calls FROM scrape_budget WHERE day = ${todayKey}::date
    ` as Array<{ nse_calls: number; screener_calls: number }>
    const budget = budgetRows[0] || { nse_calls: 0, screener_calls: 0 }

    return NextResponse.json({
      ok: true,
      missing,
      exhausted,
      filled,
      total: allTickers.length,
      maxAttempts: MAX_ATTEMPTS,
      budget: {
        day: todayKey,
        nse: Number(budget.nse_calls) || 0,
        screener: Number(budget.screener_calls) || 0,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
