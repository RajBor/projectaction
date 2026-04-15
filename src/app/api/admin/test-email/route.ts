import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin, extractRole } from '@/lib/auth-helpers'
import { sendBrevoEmail } from '@/lib/email/brevo'
import { welcomeEmailHtml } from '@/lib/email/templates/welcome'

/**
 * POST /api/admin/test-email
 * Body: { to: string }
 *
 * Dry-runs the full welcome email pipeline — same Brevo API key, same
 * sender, same HTML template — but with a fixed sample auth code. Admins
 * use this to verify deliverability without approving a real user.
 *
 * Returns { ok, emailSent, error?, messageId? } so the admin UI can show
 * exactly what went wrong if Brevo rejected the message.
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = extractRole(session?.user)
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return NextResponse.json(
      { ok: false, error: 'Valid recipient email required (e.g. "to": "you@example.com")' },
      { status: 400 }
    )
  }

  const firstName = (session.user as { name?: string }).name?.split(' ')[0] || 'Admin'
  const loginUrl = process.env.NEXTAUTH_URL || 'https://dealnector.com'
  const sampleAuthCode = 'TEST42'

  try {
    const result = await sendBrevoEmail({
      to: { email: to, name: 'Test Recipient' },
      subject: '[TEST] DealNector welcome email preview',
      htmlContent: welcomeEmailHtml({ firstName, loginUrl, authCode: sampleAuthCode }),
      purpose: 'welcome',
      tags: ['test', 'welcome-preview'],
    })
    return NextResponse.json({
      ok: true,
      emailSent: result.ok,
      messageId: result.messageId,
      error: result.ok ? undefined : result.error,
      to,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        emailSent: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    )
  }
}
