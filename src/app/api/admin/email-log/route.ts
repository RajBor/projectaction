import { isAdminOrSubadmin, extractRole } from '@/lib/auth-helpers'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/** GET /api/admin/email-log — last 100 outbound messages. Admin only. */
export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  try {
    await ensureSchema()
    const rows = await sql`
      SELECT id, to_addr, subject, body, category, sent_at, delivered, error
      FROM email_log
      ORDER BY sent_at DESC
      LIMIT 100
    `
    return NextResponse.json({ ok: true, log: rows })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
