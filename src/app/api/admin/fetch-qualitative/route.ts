import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { loadCompanyPool } from '@/lib/live/company-pool'
import { fetchScreenerHtml, screenerCode } from '@/lib/live/screener-fetch'
import {
  extractAnnualReport,
  extractCreditRatings,
  extractShareholding,
} from '@/lib/live/screener-qualitative'

// ~294 tickers × 800ms = ~4 minutes end-to-end. Pin to Vercel Pro's
// 300-second cap so the admin doesn't hit the default 60s wall and
// see a "504 gateway timeout" HTML that would crash the UI's
// res.json() call (which is why we added `safeJson` on the client —
// but it's nicer to avoid the timeout in the first place).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/fetch-qualitative
 *
 * Free-source fetcher for the "qualitative" columns added in ensureSchema:
 *   - ar_url / ar_year / ar_fetched_at   → Annual Report PDF link
 *   - credit_rating                       → list of rating-agency doc links
 *   - shareholding                        → promoter/FII/DII/public/govt %
 *
 * All data comes from Screener.in's free public HTML (`/company/<CODE>/`).
 * We deliberately do NOT hit:
 *   - Rating agencies directly (CRISIL/CARE/ICRA each needs its own scraper,
 *     layouts drift, and we only need the links — Screener already aggregates).
 *   - NCLT.gov.in — JS-rendered, captcha-guarded, not reliably scrapable.
 *   - Any paid API (RapidAPI, Anthropic tool calls, etc.) per the
 *     "free sources only, omit paid data" directive.
 *
 * Columns that the schema defines but this route doesn't populate:
 *   ar_parsed / facilities / customers / mda_extract / nclt_cases
 *
 *   - ar_parsed / mda_extract / facilities would require downloading the
 *     AR PDF and running either (a) heuristic regex over page text —
 *     fragile, inconsistent across annual reports — or (b) an LLM
 *     structured-extraction call, which costs money. Left null on purpose.
 *     If a heuristic fetcher is added later, it should live in a separate
 *     /api/admin/fetch-ar-extract route so the free-only pipeline here
 *     stays well-scoped.
 *   - customers — no reliable free source. Annual reports occasionally
 *     list "key clients" but there's no standard section, and company
 *     websites vary wildly.
 *   - nclt_cases — NCLT portal + MCA filings are technically public but
 *     require JS rendering with headless browsers; out of scope for a
 *     free pure-HTTP scraper.
 *
 * Body:
 *   { tickers?: string[] }   — empty = fetch all eligible tickers
 *
 * Response:
 *   { ok, updated, errors?, summary: { ar, rating, shareholding } }
 *
 * Safety:
 *   - Admin / sub-admin only.
 *   - 800ms sleep between tickers (matches the Screener scrape cadence).
 *   - `ON CONFLICT (ticker) DO UPDATE` so atlas-only tickers (not yet in
 *     user_companies) get auto-seeded when their first qualitative blob
 *     lands — same pattern as publish-data.
 */

// Extractors (extractAnnualReport, extractCreditRatings, extractShareholding)
// moved to `@/lib/live/screener-qualitative` so the public GET
// `/api/data/company-qualitative/[ticker]` can share them for on-demand
// scraping. Do NOT reinline here — single source of truth.

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let requestedTickers: string[] | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (Array.isArray(body.tickers) && body.tickers.length > 0) {
      requestedTickers = body.tickers.map((t: unknown) => String(t).toUpperCase())
    }
  } catch { /* empty body = all */ }

  try {
    await ensureSchema()
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'Schema init failed: ' + (err instanceof Error ? err.message : String(err)) },
      { status: 500 }
    )
  }

  const pool = await loadCompanyPool()
  const targets = Array.from(pool.values()).filter((p) => {
    if (!p.nse) return false
    if (requestedTickers && !requestedTickers.includes(p.ticker)) return false
    return true
  })

  const errors: string[] = []
  const summary = { ar: 0, rating: 0, shareholding: 0 }
  let updated = 0

  for (let i = 0; i < targets.length; i++) {
    const co = targets[i]
    const code = screenerCode(co.ticker, co.nse)
    try {
      const { html } = await fetchScreenerHtml(code)
      if (!html) {
        errors.push(`${co.ticker}: Screener page unreachable`)
        continue
      }

      const ar = extractAnnualReport(html)
      const rating = extractCreditRatings(html)
      const shareholding = extractShareholding(html)

      // Skip tickers where we got nothing at all — avoids overwriting
      // a previously-successful row with empty data (e.g. if Screener
      // transiently served a trimmed HTML response).
      const hasAny = ar.url || rating.length > 0 || shareholding.length > 0
      if (!hasAny) {
        errors.push(`${co.ticker}: no qualitative data found on Screener`)
        continue
      }

      if (ar.url) summary.ar++
      if (rating.length > 0) summary.rating++
      if (shareholding.length > 0) summary.shareholding++

      // Upsert into user_companies. If the ticker is atlas-only (not
      // yet a DB row), INSERT creates the shell so the qualitative
      // data has somewhere to land. The financial columns stay at
      // their DEFAULT zero until the next NSE/Screener refresh
      // pushes real baselines.
      const arJson = ar.url ? JSON.stringify(null) : null  // ar_parsed stays null; separate fetcher
      void arJson  // placeholder — ar_parsed intentionally untouched here
      const ratingJson = rating.length > 0 ? JSON.stringify(rating) : null
      const shareholdingJson = shareholding.length > 0 ? JSON.stringify(shareholding) : null

      await sql`
        INSERT INTO user_companies (name, ticker, nse, sec, ar_url, ar_year, ar_fetched_at, credit_rating, shareholding)
        VALUES (
          ${co.name},
          ${co.ticker},
          ${co.nse ?? co.ticker},
          ${co.sec ?? 'solar'},
          ${ar.url},
          ${ar.year},
          NOW(),
          ${ratingJson}::jsonb,
          ${shareholdingJson}::jsonb
        )
        ON CONFLICT (ticker) DO UPDATE SET
          ar_url         = COALESCE(EXCLUDED.ar_url, user_companies.ar_url),
          ar_year        = COALESCE(EXCLUDED.ar_year, user_companies.ar_year),
          ar_fetched_at  = NOW(),
          credit_rating  = COALESCE(EXCLUDED.credit_rating, user_companies.credit_rating),
          shareholding   = COALESCE(EXCLUDED.shareholding, user_companies.shareholding),
          updated_at     = NOW()
      `
      updated++
    } catch (err) {
      errors.push(`${co.ticker}: ${err instanceof Error ? err.message : 'fetch failed'}`)
    }

    // Matches Screener scrape cadence — any faster and the CDN starts
    // returning 429s after ~50 consecutive requests.
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 800))
    }
  }

  return NextResponse.json({
    ok: true,
    updated,
    total: targets.length,
    summary,
    errors: errors.length > 0 ? errors : undefined,
    message: `Updated qualitative data for ${updated}/${targets.length} tickers. AR: ${summary.ar} · Ratings: ${summary.rating} · Shareholding: ${summary.shareholding}.`,
  })
}
