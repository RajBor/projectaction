/**
 * Thin accessor over the `platform_settings` key/value table.
 *
 * Keeps the DB-default contract in one place — if the row doesn't
 * exist (e.g. on a fresh deployment before `ensureSchema` has run)
 * every getter falls back to a documented default so the UI never
 * crashes on an undefined flag.
 *
 * All values are JSONB in the DB; this module unwraps them into
 * strongly-typed shapes per key. Adding a new flag? Add it here with
 * a default + typed getter so callers don't have to know about the
 * JSON wrapper at all.
 */

import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

export const FLAG_LANDING_SAMPLE_REPORT = 'landing.sampleReportEnabled'

export interface FeatureFlags {
  /**
   * When true, the landing page renders the cascading sample-report
   * picker. When false, the landing page renders the legacy "What you
   * get" rail and /api/public/report* endpoints refuse the request
   * with a clear "feature_disabled" error.
   */
  landingSampleReportEnabled: boolean
}

const DEFAULTS: FeatureFlags = {
  landingSampleReportEnabled: true,
}

async function fetchOne(key: string): Promise<unknown> {
  try {
    const rows = await sql`
      SELECT value FROM platform_settings WHERE key = ${key} LIMIT 1
    `
    const row = rows[0] as { value?: unknown } | undefined
    return row?.value
  } catch {
    return undefined
  }
}

function coerceBool(value: unknown, fallback: boolean): boolean {
  if (value === true) return true
  if (value === false) return false
  if (typeof value === 'string') {
    if (value === 'true') return true
    if (value === 'false') return false
  }
  return fallback
}

/** Returns every flag the UI needs in one round-trip. */
export async function getFeatureFlags(): Promise<FeatureFlags> {
  try {
    await ensureSchema()
  } catch {
    // If schema init fails we still want the landing page to render —
    // fall through to defaults rather than 500'ing.
    return { ...DEFAULTS }
  }

  const landing = await fetchOne(FLAG_LANDING_SAMPLE_REPORT)

  return {
    landingSampleReportEnabled: coerceBool(
      landing,
      DEFAULTS.landingSampleReportEnabled
    ),
  }
}

/** Write a single flag. Caller must have already authorised the request. */
export async function setFlag(
  key: string,
  value: unknown,
  updatedBy: string | null
): Promise<void> {
  await ensureSchema()
  const payload = JSON.stringify(value)
  await sql`
    INSERT INTO platform_settings (key, value, updated_by, updated_at)
    VALUES (${key}, ${payload}::jsonb, ${updatedBy || 'admin'}, NOW())
    ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_by = EXCLUDED.updated_by,
           updated_at = NOW()
  `
}
