import { NextRequest, NextResponse } from 'next/server'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { generateAuthCode } from '@/lib/email'
import { sendBrevoEmail } from '@/lib/email/brevo'
import { passwordResetEmailHtml } from '@/lib/email/templates/password-reset'

/**
 * POST /api/auth/forgot-password
 *
 * Public endpoint (no session required). Accepts an email address,
 * validates captcha, checks the 2×/day limit, and sends a password
 * reset code via Brevo if the user exists.
 *
 * Body: { email: string, captchaAnswer: number, captchaExpected: number }
 *
 * Rate limit: max 2 reset requests per email per calendar day (IST).
 * This is enforced via the admin_auth_codes table.
 *
 * Security: if the email doesn't exist, we still return { ok: true }
 * so an attacker can't enumerate registered emails.
 */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const { email, captchaAnswer, captchaExpected } = body as {
      email?: string
      captchaAnswer?: number
      captchaExpected?: number
    }

    // Validate inputs
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { ok: false, error: 'Valid email address is required' },
        { status: 400 }
      )
    }

    // Captcha validation
    if (captchaAnswer == null || captchaExpected == null) {
      return NextResponse.json(
        { ok: false, error: 'Captcha answer is required' },
        { status: 400 }
      )
    }
    if (
      !Number.isFinite(captchaAnswer) ||
      !Number.isFinite(captchaExpected) ||
      captchaAnswer !== captchaExpected
    ) {
      return NextResponse.json(
        { ok: false, error: 'Captcha answer is incorrect' },
        { status: 400 }
      )
    }

    await ensureSchema()

    // Check 2×/day rate limit (IST day = UTC +5:30)
    const todayStart = getTodayStartIst()
    const todayEnd = getTodayEndIst()
    const recentCodes = await sql`
      SELECT COUNT(*)::int AS cnt
      FROM admin_auth_codes
      WHERE purpose = ${'user-password-reset-' + email.toLowerCase().trim()}
        AND created_at >= ${todayStart}
        AND created_at < ${todayEnd}
    `
    const count = recentCodes[0]?.cnt ?? 0
    if (count >= 2) {
      return NextResponse.json(
        { ok: false, error: 'Maximum 2 password reset requests per day. Try again tomorrow.' },
        { status: 429 }
      )
    }

    // Look up the user (silently succeed even if not found)
    const users = await sql`
      SELECT id, email, full_name, username
      FROM users
      WHERE email = ${email.toLowerCase().trim()} AND is_active = true
      LIMIT 1
    `

    if (users.length === 0) {
      // Don't reveal that the email doesn't exist
      return NextResponse.json({
        ok: true,
        message: 'If this email is registered, a reset code has been sent.',
      })
    }

    const user = users[0]
    const code = generateAuthCode()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

    // Store the code
    await sql`
      INSERT INTO admin_auth_codes (code, purpose, expires_at)
      VALUES (${code}, ${'user-password-reset-' + email.toLowerCase().trim()}, ${expiresAt.toISOString()})
    `

    // Send via Brevo
    sendBrevoEmail({
      to: { email: user.email, name: user.full_name || user.username },
      subject: 'DealNector · Password Reset Code',
      htmlContent: passwordResetEmailHtml({
        code,
        expiresInMinutes: 15,
        recipientEmail: user.email,
      }),
      purpose: 'password',
      tags: ['user', 'password-reset'],
    }).catch((err) => {
      console.error('[forgot-password] Email send failed:', err)
    })

    return NextResponse.json({
      ok: true,
      message: 'If this email is registered, a reset code has been sent.',
    })
  } catch (error) {
    console.error('Forgot password error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/** Get today's start in IST as an ISO string (for rate limiting). */
function getTodayStartIst(): string {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const istNow = new Date(now.getTime() + istOffset)
  const y = istNow.getUTCFullYear()
  const m = String(istNow.getUTCMonth() + 1).padStart(2, '0')
  const d = String(istNow.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}T00:00:00+05:30`
}

function getTodayEndIst(): string {
  const now = new Date()
  const istOffset = 5.5 * 60 * 60 * 1000
  const istNow = new Date(now.getTime() + istOffset)
  const y = istNow.getUTCFullYear()
  const m = String(istNow.getUTCMonth() + 1).padStart(2, '0')
  const d = String(istNow.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}T23:59:59+05:30`
}
