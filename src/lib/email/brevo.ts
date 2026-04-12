/**
 * Brevo (Sendinblue) transactional email sender.
 *
 * Two API keys are used — one for welcome/onboarding emails and one
 * for password-related emails — so they can be rotated independently.
 *
 * Endpoint: POST https://api.brevo.com/v3/smtp/email
 * Docs: https://developers.brevo.com/docs/send-a-transactional-email
 */

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'

export type EmailPurpose = 'welcome' | 'password'

function apiKey(purpose: EmailPurpose): string {
  if (purpose === 'password') {
    return process.env.BREVO_API_KEY_PASSWORD || ''
  }
  return process.env.BREVO_API_KEY_WELCOME || ''
}

function sender() {
  return {
    name: process.env.BREVO_SENDER_NAME || 'DealNector',
    email: process.env.BREVO_SENDER_EMAIL || 'noreply@dealnector.com',
  }
}

export interface SendEmailParams {
  to: { email: string; name?: string }
  subject: string
  htmlContent: string
  purpose: EmailPurpose
  /** Optional reply-to override. */
  replyTo?: { email: string; name?: string }
  /** Optional tags for Brevo analytics. */
  tags?: string[]
}

export interface SendEmailResult {
  ok: boolean
  messageId?: string
  error?: string
}

/**
 * Send a single transactional email via Brevo.
 * Returns { ok, messageId } on success.
 */
export async function sendBrevoEmail(
  params: SendEmailParams
): Promise<SendEmailResult> {
  const key = apiKey(params.purpose)
  if (!key) {
    console.error(`[brevo] Missing API key for purpose "${params.purpose}"`)
    return { ok: false, error: 'Brevo API key not configured' }
  }

  const body = {
    sender: sender(),
    to: [{ email: params.to.email, name: params.to.name || params.to.email }],
    subject: params.subject,
    htmlContent: params.htmlContent,
    ...(params.replyTo ? { replyTo: params.replyTo } : {}),
    ...(params.tags && params.tags.length > 0 ? { tags: params.tags } : {}),
  }

  try {
    const res = await fetch(BREVO_ENDPOINT, {
      method: 'POST',
      headers: {
        'api-key': key,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error(`[brevo] ${res.status}: ${errText}`)
      return { ok: false, error: `Brevo ${res.status}: ${errText.slice(0, 200)}` }
    }

    const data = await res.json().catch(() => ({}))
    return { ok: true, messageId: data.messageId || data.messageIds?.[0] }
  } catch (err) {
    console.error('[brevo] Network error:', err)
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Network error',
    }
  }
}
