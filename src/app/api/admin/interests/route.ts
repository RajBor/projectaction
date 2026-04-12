import { isAdminOrSubadmin, extractRole } from '@/lib/auth-helpers'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/** GET /api/admin/interests — all deal interest expressions. Admin only. */
export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  try {
    await ensureSchema()
    const rows = await sql`
      SELECT id, user_id, user_email, user_name, user_phone,
             ticker, company_name, deal_type, sector, rationale,
             source_page, expressed_at, notified
      FROM deal_interests
      ORDER BY expressed_at DESC
      LIMIT 500
    `
    return NextResponse.json({ ok: true, interests: rows })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
