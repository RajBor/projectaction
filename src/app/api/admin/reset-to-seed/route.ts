import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { COMPANIES } from '@/lib/data/companies'

/**
 * POST /api/admin/reset-to-seed — delete user_companies override rows so
 * the hand-curated static `COMPANIES[]` seed resurfaces through the
 * LiveSnapshotProvider merge.
 *
 * Body: { tickers?: string[] }
 *   - tickers omitted / empty → reset ALL tickers that have a static seed
 *   - otherwise → reset just the listed tickers
 *
 * SAFETY:
 *   - Admin / sub-admin only.
 *   - Only deletes user_companies rows whose `ticker` ALSO exists in the
 *     static seed. Admin-added rows (SME / Atlas discoveries) that have
 *     no static counterpart are LEFT UNTOUCHED — deleting them would
 *     orphan the companies from the universe. If the admin wants those
 *     gone they need to delete the row through the existing "remove
 *     company" flow, not this one.
 *
 * WHY THIS EXISTS:
 *   When an earlier buggy Screener push poisons a DB row (e.g. Premier
 *   Energies wrote salesCr=658 when the real TTM is 7,215 Cr because
 *   the parser was mis-reading `Sales&nbsp;+`), clearing the browser
 *   cache doesn't help — the stale numbers live in Postgres. This
 *   endpoint gives the admin a one-click escape hatch: drop the DB row
 *   and let the curated seed take over, then (optionally) push fresh
 *   Screener / NSE data on top.
 *
 * Returns: { ok, deleted, kept, skippedSme }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let tickers: string[] | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (Array.isArray(body.tickers) && body.tickers.length > 0) {
      tickers = body.tickers.map((t: unknown) => String(t).toUpperCase())
    }
  } catch {
    // empty body = reset all
  }

  const staticTickers = new Set(COMPANIES.map((c) => c.ticker))
  const requested = tickers && tickers.length > 0 ? new Set(tickers) : null

  try {
    await ensureSchema()

    // Current DB rows that COULD be reset (intersect request × static).
    const dbRows = await sql`SELECT ticker FROM user_companies`
    const allDb: string[] = (dbRows as Array<{ ticker: string }>).map((r) => r.ticker)

    const toDelete: string[] = []
    const skippedSme: string[] = []
    for (const t of allDb) {
      if (!staticTickers.has(t)) {
        // Admin-added row (no static seed to fall back to). Leave alone.
        skippedSme.push(t)
        continue
      }
      if (requested && !requested.has(t)) continue
      toDelete.push(t)
    }

    if (toDelete.length > 0) {
      await sql`DELETE FROM user_companies WHERE ticker = ANY(${toDelete})`
    }

    return NextResponse.json({
      ok: true,
      deleted: toDelete.length,
      deletedTickers: toDelete,
      // Caller-facing counts so the admin can confirm at a glance that
      // nothing unexpected was touched.
      kept: allDb.length - toDelete.length,
      skippedSme: skippedSme.length > 0 ? skippedSme : undefined,
      message:
        toDelete.length > 0
          ? `Reset ${toDelete.length} row${toDelete.length === 1 ? '' : 's'} to hand-curated baseline. Admin-added SME/Atlas rows (${skippedSme.length}) were left alone.`
          : 'Nothing to reset — no DB override rows matched.',
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
