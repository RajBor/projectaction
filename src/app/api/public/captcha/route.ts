/**
 * GET /api/public/captcha
 *
 * Issue a fresh signed math challenge for the landing-page report
 * form. Response: { token, question }.
 *
 * Tokens expire after 5 minutes (see lib/public-report/captcha.ts).
 */

import { NextResponse } from 'next/server'
import { issueCaptcha } from '@/lib/public-report/captcha'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const { token, question } = issueCaptcha()
  return NextResponse.json(
    { token, question },
    {
      headers: {
        // Never cache — each request must yield a new token.
        'Cache-Control': 'no-store',
      },
    }
  )
}
