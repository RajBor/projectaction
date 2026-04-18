/**
 * POST /api/public/report
 *
 * The landing-page lead-capture + report-routing endpoint. Flow:
 *
 *   1. Parse body         → { industryId, valueChainId?, subSegmentId?,
 *                             companyTicker?, name, email, organization?,
 *                             designation?, purpose?,
 *                             captchaToken, captchaAnswer }
 *   2. Validate inputs    → industry must exist; email must parse.
 *   3. Verify CAPTCHA     → signed HMAC + expiry + answer match.
 *   4. Per-IP rate limit  → 10 successful requests per hour.
 *   5. Acquire slot       → global concurrency gate (max 3 parallel).
 *      Adds artificial 600–1200ms jitter so the "thank you for your
 *      patience" screen always has *something* to wait for.
 *
 *   Branch A — company picked:
 *     6a. Skip HTML generation entirely. The visitor will be routed
 *         to the live /report/[ticker] page in `public=1` mode, which
 *         renders the same DealNector valuation report authenticated
 *         analysts see (minus the RapidAPI calls).
 *     7a. Persist a lead row to public_report_requests (html_body NULL).
 *     8a. Respond with { mode: 'redirect', redirectUrl, reportId, … }
 *
 *   Branch B — industry / stage only (no company ticker):
 *     6b. Generate qualitative HTML brief via lib/public-report/generator.
 *     7b. Persist row including html_body.
 *     8b. Respond with { mode: 'preview', previewHtml, downloadUrl, … }
 *
 * Company-mode deliberately avoids RapidAPI and HTML generation so
 * public visitors don't consume paid quota and get the same visual
 * system as the paid-tier report. Industry-mode keeps the existing
 * static HTML brief because there's no single ticker to route to.
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
import { loadCompanyPool } from '@/lib/live/company-pool'
import { COMPANIES } from '@/lib/data/companies'
import { geoFromRequest } from '@/lib/ip-location'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { getFeatureFlags } from '@/lib/platform-settings'

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
  // ── Feature flag gate ─────────────────────────────
  // Admin can disable this whole flow from the admin panel without a
  // redeploy. When disabled, new requests get a clear 403 instead of
  // quietly accepting input and queueing a render that would never
  // surface in the UI anyway.
  const flags = await getFeatureFlags()
  if (!flags.landingSampleReportEnabled) {
    return NextResponse.json(
      {
        error: 'feature_disabled',
        message:
          'The sample report feature is currently disabled. Please request full access for a tailored report.',
      },
      { status: 403 }
    )
  }

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
    const userAgent = req.headers.get('user-agent') || ''

    // ── Branch A: company ticker picked → route to /report/[ticker] ──
    //
    // The visitor will land on the full DealNector valuation report
    // in public=1 mode. No HTML generation here — the live page
    // renders everything from the static Company snapshot. We still
    // persist the lead so the commercial team can see which companies
    // anonymous visitors are researching, and we validate the ticker
    // so we don't redirect to a "No company found" page.
    const rawTicker = (body.companyTicker || '').trim().toUpperCase()
    if (rawTicker) {
      // Accept tickers from the full live pool, not just the curated
      // COMPANIES seed. The landing dropdown now exposes user_companies
      // + industry_chain_companies tickers across every populated
      // industry (pharma / cement / IT / EV / chemicals / etc.). The
      // downstream /report/[ticker] page resolves all three sources
      // via useLiveSnapshot, so accepting any pool ticker is safe —
      // previously this endpoint would 400 with `company_unknown` for
      // anything not in the static 87-row seed, surfacing on the
      // client as the generic "Something went wrong." banner whenever
      // a visitor picked a newly-enabled industry company like INFY.
      let subjectName: string | null = null
      let subjectTicker = rawTicker
      const staticHit = COMPANIES.find((c) => c.ticker === rawTicker)
      if (staticHit) {
        subjectName = staticHit.name
        subjectTicker = staticHit.ticker
      } else {
        try {
          const pool = await loadCompanyPool()
          const poolHit = pool.get(rawTicker)
          if (poolHit) {
            subjectName = poolHit.name
            subjectTicker = poolHit.ticker
          }
        } catch { /* fall through to 400 below */ }
      }
      if (!subjectName) {
        return NextResponse.json(
          { error: 'company_unknown', message: `Ticker ${rawTicker} is not in the sample universe.` },
          { status: 400 }
        )
      }
      const subject = { name: subjectName, ticker: subjectTicker }
      const title = `${subject.name} — DealNector Valuation Report`
      const subjectLabel = `${subject.name} (${subject.ticker})`

      try {
        await ensureSchema()
        await sql`
          INSERT INTO public_report_requests
            (id, industry_id, value_chain_id, sub_segment_id, company_ticker,
             requester_name, requester_email, requester_organization,
             requester_designation, requester_purpose,
             requester_ip, requester_location, user_agent,
             title, subject_label, html_body)
          VALUES
            (${reportId}, ${body.industryId}, ${body.valueChainId || null},
             ${body.subSegmentId || null}, ${subject.ticker},
             ${name}, ${email}, ${body.organization || null},
             ${body.designation || null}, ${body.purpose || null},
             ${ip}, ${location}, ${userAgent},
             ${title}, ${subjectLabel}, ${null})
        `
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[public-report] lead persistence skipped:', (err as Error).message)
      }

      const redirectUrl = `/report/${encodeURIComponent(subject.ticker)}?public=1&src=landing&rid=${encodeURIComponent(reportId)}`
      return NextResponse.json({
        mode: 'redirect',
        reportId,
        title,
        subjectLabel,
        industryLabel: industry.label,
        redirectUrl,
        disclaimer:
          'This report may not be an accurate representation of reality and should not be used for any financial transaction or investment decision.',
      })
    }

    // ── Branch B: industry / stage only → static qualitative HTML brief ──
    //
    // No company to route to, so fall back to the existing generator
    // for a concise multi-section industry brief. This flow deliberately
    // stays HTML-based (modal preview + download) because there's no
    // live page to hand off to at the industry level.
    const bundle = generateReportHtml({
      reportId,
      generatedAt: new Date(),
      industryId: body.industryId,
      valueChainId: body.valueChainId ?? null,
      subSegmentId: body.subSegmentId ?? null,
      companyTicker: null,
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
      await sql`
        INSERT INTO public_report_requests
          (id, industry_id, value_chain_id, sub_segment_id, company_ticker,
           requester_name, requester_email, requester_organization,
           requester_designation, requester_purpose,
           requester_ip, requester_location, user_agent,
           title, subject_label, html_body)
        VALUES
          (${reportId}, ${body.industryId}, ${body.valueChainId || null},
           ${body.subSegmentId || null}, ${null},
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
      mode: 'preview',
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
