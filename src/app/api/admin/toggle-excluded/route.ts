import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { revalidatePath } from 'next/cache'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * POST /api/admin/toggle-excluded
 * Body: { ticker: string; excluded: boolean }
 *
 * Flips `user_companies.excluded_from_reports` for the given ticker.
 * Hidden rows are filtered out of the Report Builder picker and any
 * other surface that respects the admin's editorial judgement.
 *
 * Admin / sub-admin only. Also creates a stub row for atlas-only
 * tickers that don't yet have a user_companies row, because the
 * alternative — silently accepting the request and doing nothing —
 * would leave the admin wondering why the UI's optimistic flip
 * didn't survive reload.
 */

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let body: { ticker?: string; excluded?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }
  const ticker = (body.ticker || '').trim().toUpperCase()
  const excluded = body.excluded === true
  if (!ticker) {
    return NextResponse.json({ ok: false, error: 'ticker is required' }, { status: 400 })
  }

  try {
    await ensureSchema()

    // UPSERT so atlas-only tickers can be hidden even before their
    // user_companies row exists. The stub carries the minimal fields
    // required by the schema; publish-data will overwrite them when
    // real financials land.
    await sql`
      INSERT INTO user_companies (
        name, ticker, nse, sec, comp,
        added_by, excluded_from_reports
      ) VALUES (
        ${ticker}, ${ticker}, ${ticker}, 'unknown', '[]',
        ${session.user.email || 'admin'}, ${excluded}
      )
      ON CONFLICT (ticker) DO UPDATE SET
        excluded_from_reports = ${excluded},
        updated_at = NOW()
    `

    // Revalidate the report builder + other pages that filter on
    // this flag so admins don't have to hard-reload to see the
    // picker update.
    try {
      revalidatePath('/reports')
      revalidatePath('/report/[ticker]', 'page')
    } catch { /* non-fatal */ }

    return NextResponse.json({
      ok: true,
      ticker,
      excluded,
      message: excluded
        ? `${ticker} hidden from Report Builder.`
        : `${ticker} re-enabled in Report Builder.`,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
