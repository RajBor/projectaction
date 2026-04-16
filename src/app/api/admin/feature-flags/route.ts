/**
 * GET  /api/admin/feature-flags
 *   → { ok: true, flags: FeatureFlags }
 *
 * POST /api/admin/feature-flags
 *   body { key: 'landing.sampleReportEnabled', value: boolean }
 *   → { ok: true, flags: FeatureFlags }
 *
 * Admin/sub-admin only. Writes a row to `platform_settings` and
 * returns the fresh flag snapshot so the admin UI can refresh state
 * without a second round-trip.
 */

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import {
  FLAG_LANDING_SAMPLE_REPORT,
  getFeatureFlags,
  setFlag,
} from '@/lib/platform-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_KEYS = new Set<string>([FLAG_LANDING_SAMPLE_REPORT])

export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  const flags = await getFeatureFlags()
  return NextResponse.json({ ok: true, flags })
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  const user = session?.user as { email?: string; role?: string } | undefined
  if (!user || !isAdminOrSubadmin(user.role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let body: { key?: string; value?: unknown } = {}
  try {
    body = (await req.json()) as { key?: string; value?: unknown }
  } catch {
    return NextResponse.json({ ok: false, error: 'bad_json' }, { status: 400 })
  }

  const key = (body.key || '').trim()
  if (!ALLOWED_KEYS.has(key)) {
    return NextResponse.json(
      { ok: false, error: 'unknown_key', message: `Flag ${key} is not toggleable.` },
      { status: 400 }
    )
  }

  // All currently-supported flags are boolean. If we add typed flags
  // later we'll branch on `key` and validate per-type here.
  if (typeof body.value !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'bad_value', message: 'Value must be boolean.' },
      { status: 400 }
    )
  }

  try {
    await setFlag(key, body.value, user.email || 'admin')
    const flags = await getFeatureFlags()
    return NextResponse.json({ ok: true, flags })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'persist_failed', message: (err as Error).message },
      { status: 500 }
    )
  }
}
