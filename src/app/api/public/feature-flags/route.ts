/**
 * GET /api/public/feature-flags
 *
 * Public (no-auth) read of the landing-page feature flags so the
 * HeroReportPicker / legacy rail switch without requiring the visitor
 * to be signed in.
 *
 * Returns the resolved flag object even when the DB is unavailable —
 * callers can always render SOMETHING.
 */

import { NextResponse } from 'next/server'
import { getFeatureFlags } from '@/lib/platform-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const flags = await getFeatureFlags()
  return NextResponse.json(flags, {
    headers: {
      // Cache briefly — admin toggles should propagate within a
      // minute. Long enough to absorb a burst of landing-page hits,
      // short enough that the admin never feels like the flag is
      // stuck.
      'Cache-Control': 'public, max-age=30, s-maxage=30',
    },
  })
}
