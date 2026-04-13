import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * POST /api/auth/verify-code — Verify the one-time authentication code.
 *
 * Called on first login after admin approval. Matches the code entered
 * by the user against the `auth_code` stored in the DB. On success,
 * sets `auth_code_used = true` so subsequent logins skip the prompt.
 *
 * Body: { email: string, code: string }
 */
export async function POST(req: NextRequest) {
  try {
    await ensureSchema()
    const body = await req.json().catch(() => ({}))
    const { email, code } = body as { email?: string; code?: string }

    if (!email || !code) {
      return NextResponse.json(
        { ok: false, error: 'Email and authentication code are required' },
        { status: 400 }
      )
    }

    const rows = await sql`
      SELECT id, auth_code, auth_code_used, is_active
      FROM users
      WHERE email = ${email}
      LIMIT 1
    `
    if (!rows[0]) {
      return NextResponse.json(
        { ok: false, error: 'User not found' },
        { status: 404 }
      )
    }

    const user = rows[0]

    if (!user.is_active) {
      return NextResponse.json(
        { ok: false, error: 'Account is not yet approved by admin' },
        { status: 403 }
      )
    }

    if (user.auth_code_used) {
      // Already verified — allow login
      return NextResponse.json({ ok: true, alreadyVerified: true })
    }

    if (!user.auth_code) {
      // No auth code set — legacy user, allow login
      return NextResponse.json({ ok: true, alreadyVerified: true })
    }

    // Compare codes (case-insensitive)
    if (code.toUpperCase().trim() !== user.auth_code.toUpperCase().trim()) {
      return NextResponse.json(
        { ok: false, error: 'Invalid authentication code. Please check your welcome email.' },
        { status: 400 }
      )
    }

    // Mark code as used
    await sql`UPDATE users SET auth_code_used = true WHERE id = ${user.id}`

    return NextResponse.json({ ok: true, verified: true })
  } catch (err) {
    console.error('[verify-code] Error:', err)
    return NextResponse.json(
      { ok: false, error: 'Internal server error' },
      { status: 500 }
    )
  }
}
