/**
 * POST /api/public/request-access
 *
 * Captures a lead for a *customised* report or full platform access.
 * The sample report is free and gated only by the CAPTCHA; this
 * endpoint is the "please build me something bespoke" path.
 *
 * Body:
 *   { name, email, organization?, designation?, phone?,
 *     industryId?, valueChainId?, subSegmentId?, companies?,
 *     purpose?, captchaToken, captchaAnswer }
 *
 * Validates the same CAPTCHA used by the sample-report flow, records
 * the requester IP + location, and writes a row to
 * `public_access_requests`. Returns `{ ok: true, ticketId }`.
 */

import { NextResponse } from 'next/server'
import { verifyCaptcha } from '@/lib/public-report/captcha'
import { geoFromRequest } from '@/lib/ip-location'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface AccessReqBody {
  name?: string
  email?: string
  organization?: string
  designation?: string
  phone?: string
  industryId?: string
  valueChainId?: string
  subSegmentId?: string
  companies?: string
  purpose?: string
  captchaToken?: string
  captchaAnswer?: string | number
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  let body: AccessReqBody = {}
  try {
    body = (await req.json()) as AccessReqBody
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  const name = (body.name || '').trim()
  const email = (body.email || '').trim().toLowerCase()
  if (!name || name.length < 2)
    return NextResponse.json({ error: 'name_required' }, { status: 400 })
  if (!EMAIL_RE.test(email))
    return NextResponse.json({ error: 'email_invalid' }, { status: 400 })

  const captcha = verifyCaptcha(body.captchaToken, body.captchaAnswer)
  if (!captcha.ok) {
    return NextResponse.json(
      { error: 'captcha_failed', reason: captcha.reason },
      { status: 400 }
    )
  }

  const { ip, location } = await geoFromRequest(req)
  const userAgent = req.headers.get('user-agent') || ''

  try {
    await ensureSchema()
    const rows = await sql`
      INSERT INTO public_access_requests
        (name, email, organization, designation, phone,
         industry_id, value_chain_id, sub_segment_id,
         companies_of_interest, purpose,
         requester_ip, requester_location, user_agent)
      VALUES
        (${name}, ${email}, ${body.organization || null},
         ${body.designation || null}, ${body.phone || null},
         ${body.industryId || null}, ${body.valueChainId || null},
         ${body.subSegmentId || null},
         ${body.companies || null}, ${body.purpose || null},
         ${ip}, ${location}, ${userAgent})
      RETURNING id
    `
    const ticketId = rows[0]?.id as number | undefined
    return NextResponse.json({
      ok: true,
      ticketId: ticketId || null,
      message:
        'Thank you. Our team will reach out within one business day with tailored access options.',
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'persist_failed', message: (err as Error).message },
      { status: 500 }
    )
  }
}
