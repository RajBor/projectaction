import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ADMIN_CONFIG, ensureSchema } from '@/lib/db/ensure-schema'

/**
 * POST /api/admin/password/confirm
 * Body: { code: string, newPassword: string }
 *
 * Verifies the code is the latest unused code for 'password-change',
 * not expired, then hashes the new password and updates the admin
 * row. The code is marked used on success.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  try {
    await ensureSchema()
    const { code, newPassword } = (await req.json()) as {
      code?: string
      newPassword?: string
    }
    if (!code || !newPassword) {
      return NextResponse.json(
        { ok: false, error: 'code and newPassword are required' },
        { status: 400 }
      )
    }
    if (newPassword.length < 6) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }

    const rows = await sql`
      SELECT id, expires_at, used FROM admin_auth_codes
      WHERE purpose = 'password-change' AND code = ${code.trim().toUpperCase()}
      ORDER BY created_at DESC
      LIMIT 1
    `
    if (!rows[0]) {
      return NextResponse.json({ ok: false, error: 'Invalid code' }, { status: 400 })
    }
    if (rows[0].used) {
      return NextResponse.json({ ok: false, error: 'Code already used' }, { status: 400 })
    }
    if (new Date(rows[0].expires_at).getTime() < Date.now()) {
      return NextResponse.json({ ok: false, error: 'Code expired' }, { status: 400 })
    }

    const hash = await bcrypt.hash(newPassword, 10)
    await sql`UPDATE users SET password_hash = ${hash} WHERE email = ${ADMIN_CONFIG.email}`
    await sql`UPDATE admin_auth_codes SET used = TRUE WHERE id = ${rows[0].id}`

    return NextResponse.json({
      ok: true,
      message: 'Admin password updated.',
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
