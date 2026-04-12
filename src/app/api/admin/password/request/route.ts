import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ADMIN_CONFIG, ensureSchema } from '@/lib/db/ensure-schema'
import { generateAuthCode, sendEmail } from '@/lib/email'
import { sendBrevoEmail } from '@/lib/email/brevo'
import { passwordResetEmailHtml } from '@/lib/email/templates/password-reset'

/**
 * POST /api/admin/password/request
 *
 * Generates a 6-char alphanumeric auth code, stores it with a 15 min
 * expiry, and dispatches an email to the admin address. The admin
 * must then submit the code to /api/admin/password/confirm to actually
 * change the password.
 *
 * Admin only. Any non-admin caller receives 403.
 */
export async function POST() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  try {
    await ensureSchema()
    const code = generateAuthCode()
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000) // 15 minutes

    // Invalidate any prior unused codes so only the latest works
    await sql`
      UPDATE admin_auth_codes SET used = TRUE
      WHERE purpose = 'password-change' AND used = FALSE
    `
    await sql`
      INSERT INTO admin_auth_codes (code, purpose, expires_at)
      VALUES (${code}, 'password-change', ${expiresAt.toISOString()})
    `

    // Dispatch the email. sendEmail() always logs to email_log so the
    // admin dashboard Email Log panel can surface the code even when
    // SMTP is not configured for real delivery.
    const body = `A password-change request has been initiated for the DealNector admin account.

Auth code: ${code}

This code expires at ${expiresAt.toLocaleString()} and can only be used once.

If you did not request this change, ignore this email and no action will be taken.`
    await sendEmail({
      to: ADMIN_CONFIG.email,
      subject: 'DealNector · Admin password change code',
      body,
      category: 'admin-code',
    })

    // Also send via Brevo for real email delivery (non-blocking)
    sendBrevoEmail({
      to: { email: ADMIN_CONFIG.email, name: 'DealNector Admin' },
      subject: 'DealNector · Password Reset Code',
      htmlContent: passwordResetEmailHtml({
        code,
        expiresInMinutes: 15,
        recipientEmail: ADMIN_CONFIG.email,
      }),
      purpose: 'password',
      tags: ['admin', 'password-reset'],
    }).catch((err) => {
      console.error('[password-request] Brevo email failed:', err)
    })

    return NextResponse.json({
      ok: true,
      message: `Auth code dispatched to ${ADMIN_CONFIG.email}. Expires in 15 minutes.`,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
