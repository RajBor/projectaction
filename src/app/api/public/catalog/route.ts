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
const CATALOG_VERSION = 3

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
    return NextResponse.json(
      { industries, v: CATALOG_VERSION },
      {
        headers: {
          // Short TTL — when we ship a fix to the catalog builder (new
          // atlas ticker remap rule, new industry label, etc) visitors
          // need to see it within a minute, not an hour. `stale-while-
          // revalidate` still absorbs bursty traffic after the TTL
          // without hammering the function. Historically this was
          // max-age=3600 which held visitors on the pre-remap dropdown
          // for up to an hour after a deploy.
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
