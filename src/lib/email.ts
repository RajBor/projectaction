/**
 * Outbound email adapter.
 *
 * v1 logs every send to the `email_log` table + console. This gives
 * the admin a visible inbox inside the /admin dashboard without
 * requiring any SMTP configuration.
 *
 * To enable real delivery later, add one of:
 *   - SMTP env vars (SMTP_HOST, SMTP_USER, SMTP_PASS) and switch the
 *     `deliverViaSmtp()` branch below to actually dispatch
 *   - A transactional service (Resend, Postmark, SendGrid) — same
 *     pattern, just replace `deliverViaSmtp` with a fetch call
 *
 * Every call returns `{ ok, logged, delivered }` so the caller can
 * surface useful messaging to the admin regardless of whether a real
 * email was sent.
 */

import sql from '@/lib/db'

export interface SendEmailInput {
  to: string
  subject: string
  body: string
  category?: 'admin-code' | 'interest-alert' | 'other'
}

export interface SendEmailResult {
  ok: boolean
  logged: boolean
  delivered: boolean
  error?: string
  logId?: number
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const { to, subject, body } = input
  const category = input.category || 'other'

  let delivered = false
  let deliveryError: string | undefined

  // Attempt real delivery only if SMTP env vars are configured.
  // Left as a placeholder — the adapter is intentionally non-blocking
  // on SMTP failure so the admin dashboard always has a record.
  const smtpHost = process.env.SMTP_HOST
  if (smtpHost) {
    try {
      // A caller can swap this stub for real nodemailer/Resend/SMTP
      // once they've set the env vars. Keeping it a no-op here avoids
      // adding an optional dependency to the build.
      // eslint-disable-next-line no-console
      console.log('[email] SMTP configured but no transport wired — would send:', {
        to,
        subject,
      })
    } catch (err) {
      deliveryError = err instanceof Error ? err.message : String(err)
    }
  }

  // Always log to console so devs see activity in the terminal
  // eslint-disable-next-line no-console
  console.log(`[email] → ${to} · ${subject}\n${body}\n`)

  // Persist to DB so the admin dashboard can always read it
  let logId: number | undefined
  try {
    const rows = await sql`
      INSERT INTO email_log (to_addr, subject, body, category, delivered, error)
      VALUES (${to}, ${subject}, ${body}, ${category}, ${delivered}, ${deliveryError ?? null})
      RETURNING id
    `
    logId = rows[0]?.id
  } catch (err) {
    return {
      ok: false,
      logged: false,
      delivered,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  return { ok: true, logged: true, delivered, logId, error: deliveryError }
}

/** Generate a 6-character alphanumeric code (uppercase, no ambiguous chars). */
export function generateAuthCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}
