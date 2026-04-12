import { isAdminOrSubadmin, extractRole } from '@/lib/auth-helpers'
import { NextResponse } from 'next/server'
import { ADMIN_CONFIG, ensureSchema } from '@/lib/db/ensure-schema'

/**
 * Idempotent setup endpoint. Runs all additive DDL and seeds the
 * admin user if missing. Safe to hit multiple times.
 *
 *   GET  /api/admin/bootstrap → { ok, adminEmail }
 */
export async function GET() {
  try {
    await ensureSchema()
    return NextResponse.json({
      ok: true,
      adminEmail: ADMIN_CONFIG.email,
      message: 'Schema ensured. Admin user seeded if missing.',
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    )
  }
}
