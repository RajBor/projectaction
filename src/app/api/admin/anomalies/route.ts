import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * GET /api/admin/anomalies — most recent parse-time anomalies captured
 * by the scrape-exchange validators. Powers the admin UI panel so
 * operators can see Screener / NSE schema drift as it happens (Unit
 * mismatch, inverted columns, implausible numbers, label changes).
 *
 * Capped at the last 200 entries so the response stays small. Admin
 * and sub-admin only.
 */

export const runtime = 'nodejs'

export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  try {
    await ensureSchema()
    const rows = await sql`
      SELECT id, ticker, source, check_name, field, raw_value, expected, detail, detected_at
      FROM scrape_anomalies
      ORDER BY detected_at DESC
      LIMIT 200
    ` as Array<{
      id: number
      ticker: string
      source: string
      check_name: string
      field: string | null
      raw_value: string | null
      expected: string | null
      detail: string | null
      detected_at: Date | string
    }>
    const toIso = (v: unknown): string | null => {
      if (v == null) return null
      if (v instanceof Date) return v.toISOString()
      return String(v)
    }
    const anomalies = rows.map((r) => ({
      id: r.id,
      ticker: r.ticker,
      source: r.source,
      check: r.check_name,
      field: r.field,
      raw: r.raw_value,
      expected: r.expected,
      detail: r.detail,
      detectedAt: toIso(r.detected_at),
    }))
    return NextResponse.json({ ok: true, anomalies, count: anomalies.length })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
