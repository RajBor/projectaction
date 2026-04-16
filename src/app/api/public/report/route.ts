/**
 * POST /api/public/report
 *
 * The landing-page report generator. Flow:
 *
 *   1. Parse body         → { industryId, valueChainId?, subSegmentId?,
 *                             companyTicker?, name, email, organization?,
 *                             designation?, purpose?,
 *                             captchaToken, captchaAnswer }
 *   2. Validate inputs    → industry must exist; email must parse.
 *   3. Verify CAPTCHA     → signed HMAC + expiry + answer match.
 *   4. Per-IP rate limit  → 10 successful renders per hour.
 *   5. Acquire slot       → global concurrency gate (max 3 parallel).
 *      Adds artificial 600–1200ms jitter so the "thank you for your
 *      patience" screen always has *something* to wait for.
 *   6. Generate HTML      → lib/public-report/generator.
 *   7. Persist to DB      → public_report_requests row keyed by the
 *      returned reportId; lets the preview/download endpoints re-serve
 *      without re-running the generator.
 *   8. Respond            → { reportId, title, subjectLabel,
 *                             previewHtml, downloadUrl }
 *
 * If the queue is saturated (>20 waiting) we return 503 with a hint
 * to retry in a minute. The UI displays that as a cheerful "we're a
 * bit busy — please hang on" rather than an error.
 */

import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { verifyCaptcha } from '@/lib/public-report/captcha'
import {
  acquireSlot,
  checkIp,
  queueDepth,
  RateLimitBusyError,
} from '@/lib/public-report/rate-limit'
import { generateReportHtml } from '@/lib/public-report/generator'
import { findIndustry } from '@/lib/public-report/catalog'
import { geoFromRequest } from '@/lib/ip-location'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface ReportRequestBody {
  industryId?: string
  valueChainId?: string | null
  subSegmentId?: string | null
  companyTicker?: string | null
  name?: string
  email?: string
  organization?: string | null
  designation?: string | null
  purpose?: string | null
  captchaToken?: string
  captchaAnswer?: string | number
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function POST(req: Request) {
  let body: ReportRequestBody = {}
  try {
    body = (await req.json()) as ReportRequestBody
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }

  // ── basic field validation ────────────────────────
  const name = (body.name || '').trim()
  const email = (body.email || '').trim().toLowerCase()
  if (!name || name.length < 2)
    return NextResponse.json({ error: 'name_required' }, { status: 400 })
  if (!EMAIL_RE.test(email))
    return NextResponse.json({ error: 'email_invalid' }, { status: 400 })
  if (!body.industryId)
    return NextResponse.json({ error: 'industry_required' }, { status: 400 })

  const industry = findIndustry(body.industryId)
  if (!industry)
    return NextResponse.json({ error: 'industry_unknown' }, { status: 400 })

  // ── CAPTCHA ────────────────────────────────────────
  const captcha = verifyCaptcha(body.captchaToken, body.captchaAnswer)
  if (!captcha.ok) {
    return NextResponse.json(
      { error: 'captcha_failed', reason: captcha.reason },
      { status: 400 }
    )
  }

  // ── IP + location ─────────────────────────────────
  const { ip, location } = await geoFromRequest(req)
  const ipKey = ip || 'anon'

  const ipCheck = checkIp(ipKey)
  if (!ipCheck.ok) {
    return NextResponse.json(
      {
        error: 'rate_limited',
        resetMs: ipCheck.resetMs,
        message: 'Hourly limit reached from your IP. Try again later.',
      },
      { status: 429 }
    )
  }

  // ── Concurrency gate + queueing ───────────────────
  let release: (() => void) | null = null
  try {
    release = await acquireSlot()
  } catch (err) {
    if (err instanceof RateLimitBusyError) {
      const { active, waiting } = queueDepth()
      return NextResponse.json(
        {
          error: 'busy',
          active,
          waiting,
          message:
            'We are generating a few reports right now — please try again in about a minute. Thank you for your patience.',
        },
        { status: 503 }
      )
    }
    throw err
  }

  try {
    // Small render-latency so the "please wait" screen always has
    // something to display; real generation is sub-100ms.
    const jitter = 600 + Math.floor(Math.random() * 700)
    await sleep(jitter)

    const reportId = newReportId()
    const bundle = generateReportHtml({
      reportId,
      generatedAt: new Date(),
      industryId: body.industryId,
      valueChainId: body.valueChainId ?? null,
      subSegmentId: body.subSegmentId ?? null,
      companyTicker: body.companyTicker ?? null,
      user: {
        name,
        email,
        organization: body.organization ?? null,
        purpose: body.purpose ?? null,
      },
      requesterIp: ip,
      requesterLocation: location,
    })

    // Persist — non-fatal if DB is down, user still gets the HTML.
    try {
      await ensureSchema()
      const userAgent = req.headers.get('user-agent') || ''
      await sql`
        INSERT INTO public_report_requests
          (id, industry_id, value_chain_id, sub_segment_id, company_ticker,
           requester_name, requester_email, requester_organization,
           requester_designation, requester_purpose,
           requester_ip, requester_location, user_agent,
           title, subject_label, html_body)
        VALUES
          (${reportId}, ${body.industryId}, ${body.valueChainId || null},
           ${body.subSegmentId || null}, ${body.companyTicker || null},
           ${name}, ${email}, ${body.organization || null},
           ${body.designation || null}, ${body.purpose || null},
           ${ip}, ${location}, ${userAgent},
           ${bundle.title}, ${bundle.subjectLabel}, ${bundle.html})
      `
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[public-report] persistence skipped:', (err as Error).message)
    }

    return NextResponse.json({
      reportId,
      title: bundle.title,
      subjectLabel: bundle.subjectLabel,
      industryLabel: bundle.industryLabel,
      previewHtml: bundle.html,
      downloadUrl: `/api/public/report/${encodeURIComponent(reportId)}?download=1`,
      viewUrl: `/api/public/report/${encodeURIComponent(reportId)}`,
      disclaimer:
        'This report may not be an accurate representation of reality and should not be used for any financial transaction or investment decision.',
    })
  } finally {
    release()
  }
}

function newReportId(): string {
  // Short, URL-safe, sortable: timestamp(b36) + 8 hex chars of random.
  const ts = Date.now().toString(36).toUpperCase()
  const rand = crypto.randomBytes(4).toString('hex').toUpperCase()
  return `RPT-${ts}-${rand}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
