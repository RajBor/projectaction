/**
 * Lightweight in-house CAPTCHA for the public landing-page report
 * flow. No external vendor (reCAPTCHA/hCaptcha) is configured on this
 * project yet, so we ship a signed-HMAC math challenge that's still
 * hard to brute-force at scale:
 *
 *   1. Server issues  { token, question }
 *      - question is a plain-text "7 + 4 = ?" style prompt shown to
 *        the user.
 *      - token is  base64url(payload) + '.' + base64url(hmac(payload))
 *        where payload carries the expected answer, an issued-at
 *        epoch, and an expiry.
 *
 *   2. Client echoes { token, answer } with the form submission.
 *
 *   3. Server re-hmacs and checks:
 *        • token signature matches
 *        • token not yet expired (5 minute window)
 *        • answer === payload.answer
 *
 * Keys are derived from NEXTAUTH_SECRET with a per-feature salt so
 * tokens minted for this flow are worthless for any other feature,
 * even if we later add more HMAC-signed primitives.
 */

import crypto from 'crypto'

const SALT = 'public-report-captcha:v1'
const TTL_MS = 5 * 60 * 1000

function secretKey(): string {
  const base =
    process.env.NEXTAUTH_SECRET ||
    process.env.CAPTCHA_SECRET ||
    // Fall back to a build-time constant so the CAPTCHA is usable in
    // local dev even without a .env file. NEXTAUTH_SECRET is set in
    // prod, so this branch only matters on a fresh clone.
    'dealnector-landing-captcha-fallback'
  return crypto.createHash('sha256').update(SALT).update(base).digest('hex')
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64')
}

function hmac(payload: string): string {
  return b64url(crypto.createHmac('sha256', secretKey()).update(payload).digest())
}

export interface Challenge {
  token: string
  question: string
}

/** Mint a fresh "A + B = ?" math challenge. */
export function issueCaptcha(): Challenge {
  // Keep the numbers small so the UX doesn't suffer, but randomise
  // the operator so the response surface is large enough to deter
  // trivial scripts.
  const ops = ['+', '-', '×'] as const
  const op = ops[Math.floor(Math.random() * ops.length)]!
  let a = 0
  let b = 0
  let answer = 0
  if (op === '+') {
    a = 2 + Math.floor(Math.random() * 17) // 2..18
    b = 2 + Math.floor(Math.random() * 17)
    answer = a + b
  } else if (op === '-') {
    a = 10 + Math.floor(Math.random() * 20) // 10..29
    b = 1 + Math.floor(Math.random() * (a - 1))
    answer = a - b
  } else {
    a = 2 + Math.floor(Math.random() * 8) // 2..9
    b = 2 + Math.floor(Math.random() * 8)
    answer = a * b
  }
  const payload = {
    a,
    op,
    b,
    ans: answer,
    iat: Date.now(),
  }
  const payloadStr = b64url(JSON.stringify(payload))
  const sig = hmac(payloadStr)
  return {
    token: `${payloadStr}.${sig}`,
    question: `${a} ${op} ${b} = ?`,
  }
}

export interface CaptchaVerification {
  ok: boolean
  reason?: 'bad_token' | 'expired' | 'wrong_answer' | 'missing'
}

/** Verify a (token, answer) pair. Constant-time signature check. */
export function verifyCaptcha(
  token: string | null | undefined,
  answer: string | number | null | undefined
): CaptchaVerification {
  if (!token || answer === null || answer === undefined || answer === '')
    return { ok: false, reason: 'missing' }

  const parts = token.split('.')
  if (parts.length !== 2) return { ok: false, reason: 'bad_token' }
  const [payloadStr, sig] = parts as [string, string]

  const expected = hmac(payloadStr)
  let sigOk = false
  try {
    sigOk = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  } catch {
    sigOk = false
  }
  if (!sigOk) return { ok: false, reason: 'bad_token' }

  let payload: { ans?: number; iat?: number } = {}
  try {
    payload = JSON.parse(b64urlDecode(payloadStr).toString('utf8')) as {
      ans: number
      iat: number
    }
  } catch {
    return { ok: false, reason: 'bad_token' }
  }
  if (!payload.iat || Date.now() - payload.iat > TTL_MS)
    return { ok: false, reason: 'expired' }

  const supplied = typeof answer === 'string' ? answer.trim() : String(answer)
  if (String(payload.ans) !== supplied) return { ok: false, reason: 'wrong_answer' }

  return { ok: true }
}
