/**
 * Public catalog endpoint for the landing-page report picker.
 *
 * GET /api/public/catalog
 *
 * Returns the three-level tree the cascading dropdowns consume:
 *   { industries: [{ id, label, description, hasRichData,
 *                    valueChains: [{ id, name,
 *                      subSegments: [{id,code,name}],
 *                      companies: [{name,ticker,role,hasNumbers}] }] }] }
 *
 * No auth required — this endpoint is intentionally public.
 */

import { NextResponse } from 'next/server'
import { getPublicCatalog } from '@/lib/public-report/catalog'
import { getFeatureFlags } from '@/lib/platform-settings'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Bump this when the catalog shape/data changes. Paired with the
 * `?v=<CATALOG_VERSION>` query the client sends — together they
 * guarantee visitors with a stale browser cache immediately see the
 * new catalog on the next page load, without waiting for the old
 * `max-age` window to expire.
 *
 * History:
 *   1 – initial landing picker
 *   2 – normaliseTicker collapses placeholder em-dashes to null
 *   3 – name-fallback resolution + two-key dedup so atlas stale
 *       tickers (WAAREEENER, PREMIERENE) merge into the real
 *       COMPANIES rows (WAAREEENS, PREMIENRG) with ★.
 */
// Bumped to 4 — adds dynamic hasNumbers flag based on DB-published
// data, so stale browser caches don't hide freshly-published atlas
// tickers (or resurrect tickers whose DB rows have been zeroed).
const CATALOG_VERSION = 4

/**
 * Build a set of tickers that currently have usable financial data
 * in user_companies. Used to dynamically flag `hasNumbers: true` on
 * the catalog — which drives the landing-page dropdown filter so
 * only companies the user can actually generate a report for show up.
 *
 * "Usable" = at least ONE of mktcap / rev / ebitda is non-zero. That
 * matches the same threshold /reports and /report/[ticker] use to
 * decide whether a report renders as real numbers vs "no data" banner.
 * A single field is enough because the cascade (exchange → screener
 * → baseline) will fill the rest, and DCF / peer comparison degrade
 * gracefully when some fields are missing but at least mktcap is
 * present.
 *
 * Cached in module scope on the server — Next.js force-dynamic
 * re-runs the route per request, so this doesn't leak across builds,
 * but per-request the DB hit is sub-100ms with Neon's pooled driver.
 */
async function loadPublishedTickers(): Promise<Set<string>> {
  try {
    await ensureSchema()
    const rows = await sql`
      SELECT ticker
      FROM user_companies
      WHERE mktcap > 0 OR rev > 0 OR ebitda > 0
    ` as Array<{ ticker: string }>
    return new Set(rows.map((r) => r.ticker.toUpperCase()))
  } catch {
    return new Set()
  }
}

export async function GET() {
  try {
    const flags = await getFeatureFlags()
    if (!flags.landingSampleReportEnabled) {
      return NextResponse.json(
        { error: 'feature_disabled' },
        { status: 403 }
      )
    }
    const industries = getPublicCatalog()
    const publishedTickers = await loadPublishedTickers()

    // Post-process: a catalog company is flagged `hasNumbers: true`
    // when EITHER (a) the curated COMPANIES[] resolution marked it so
    // during catalog build (the original behaviour), OR (b) it has
    // usable data published to user_companies. This is what surfaces
    // freshly-swept atlas tickers on the landing dropdown without
    // waiting for them to be added to the static seed. Companies
    // whose catalog flag was true but whose user_companies row has
    // since been zeroed stay true because the static fallback data
    // still exists — we never hide a curated row.
    const enriched = industries.map((ind) => ({
      ...ind,
      valueChains: ind.valueChains.map((vc) => ({
        ...vc,
        companies: vc.companies.map((c) => ({
          ...c,
          hasNumbers:
            c.hasNumbers ||
            (c.ticker != null && publishedTickers.has(c.ticker.toUpperCase())),
        })),
      })),
    }))

    return NextResponse.json(
      { industries: enriched, v: CATALOG_VERSION, published: publishedTickers.size },
      {
        headers: {
          'Cache-Control':
            'public, max-age=60, s-maxage=60, stale-while-revalidate=600',
        },
      }
    )
  } catch (err) {
    return NextResponse.json(
      { error: 'catalog_failed', message: (err as Error).message },
      { status: 500 }
    )
  }
}
