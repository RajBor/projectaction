import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * POST /api/auth/reset-password
 *
 * Public endpoint. Verifies the 6-char code and sets a new password.
 *
 * Body: { email: string, code: string, newPassword: string }
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { email, code, newPassword } = body as {
      email?: string
      code?: string
      newPassword?: string
    }

    if (!email || !code || !newPassword) {
      return NextResponse.json(
        { ok: false, error: 'Email, code, and new password are required' },
        { status: 400 }
      )
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { ok: false, error: 'Password must be at least 6 characters' },
        { status: 400 }
      )
    }

    await ensureSchema()

    const purpose = 'user-password-reset-' + email.toLowerCase().trim()

    // Find the code
    const rows = await sql`
      SELECT id, code, expires_at, used
      FROM admin_auth_codes
      WHERE purpose = ${purpose}
        AND code = ${code.trim()}
        AND used = false
      ORDER BY created_at DESC
      LIMIT 1
    `

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'Invalid or expired code' },
        { status: 400 }
      )
    }

    const row = rows[0]
    if (new Date(row.expires_at) < new Date()) {
      return NextResponse.json(
        { ok: false, error: 'Code has expired. Request a new one.' },
        { status: 400 }
      )
    }

    // Mark code as used
    await sql`UPDATE admin_auth_codes SET used = true WHERE id = ${row.id}`

    // Update the password
    const hash = await bcrypt.hash(newPassword, 10)
    const updated = await sql`
      UPDATE users SET password_hash = ${hash}
      WHERE email = ${email.toLowerCase().trim()} AND is_active = true
      RETURNING id
    `

    if (updated.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'User not found or inactive' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      ok: true,
      message: 'Password has been reset successfully. You can now sign in.',
    })
  } catch (error) {
    console.error('Reset password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
