import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/** GET /api/admin/users — list every user row. Admin only. */
export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  try {
    await ensureSchema()
    const rows = await sql`
      SELECT id, username, email, full_name, phone, role, is_active,
             signup_ip, signup_location, last_login_ip, last_login_location,
             created_at, last_login
      FROM users
      ORDER BY created_at DESC
    `
    return NextResponse.json({ ok: true, users: rows })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
