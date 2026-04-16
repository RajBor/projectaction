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
      { industries },
      {
        headers: {
          // Catalog changes only when the seed data ships — safe to cache.
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
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
