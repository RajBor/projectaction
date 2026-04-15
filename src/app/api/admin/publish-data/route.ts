import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { COMPANIES, type Company } from '@/lib/data/companies'
import { recomputeAcqScore } from '@/lib/valuation/live-metrics'

// Bulk push from the admin "Push All from …" buttons can UPSERT up to
// ~294 rows in sequence. With Neon cold-start latency that can take
// north of 45s, which blows past the default Vercel serverless 10–15s
// ceiling and returns a gateway-timeout HTML page — precisely the body
// that produced the "Unexpected token 'A', 'An error o'..." crash the
// admin saw before safeJson + this knob landed.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/publish-data
 *
 * Admin / sub-admin only. Two operations:
 *
 * 1. newCompanies[] — INSERT new companies into the `user_companies`
 *    DB table (works on read-only filesystems like Vercel).
 *
 * 2. overrides{} — UPDATE existing user_companies rows OR seed a new
 *    row from the static COMPANIES[] seed if the ticker isn't in the
 *    DB yet. This is what the admin Data Sources tab "Push to Website"
 *    button drives — picking NSE, Screener, or RapidAPI as the source
 *    and pushing fresh financials that replace the baseline.
 *
 * Dynamic acquisition score:
 *    After applying the override financials to the baseline seed, we
 *    recompute the 7-driver acqs score via recomputeAcqScore so the
 *    M&A Radar / Valuation / Dashboard pages immediately reflect the
 *    new valuation. A richer EV/EBITDA drags acqs down; stronger
 *    revenue growth pushes it up. The client can also supply an
 *    explicit acqs/acqf to hard-override, in which case we use that.
 *
 * Audit trail:
 *    `baseline_updated_at` is stamped to NOW() and `baseline_source`
 *    to the caller-supplied label ('screener', 'exchange', 'rapidapi')
 *    so the admin table shows per-company "last refreshed from X" info.
 *
 * Body: {
 *   overrides?: Record<string, Partial<CompanyFields> & { source?: BaselineSource }>
 *   source?: BaselineSource                          // bulk default
 *   newCompanies?: CompanyFields[]
 * }
 */

type BaselineSource = 'exchange' | 'screener' | 'rapidapi' | 'manual'

interface CompanyFields {
  name: string
  ticker: string
  nse: string | null
  sec: 'solar' | 'td'
  comp: string[]
  mktcap: number
  rev: number
  ebitda: number
  pat: number
  ev: number
  ev_eb: number
  pe: number
  pb: number
  dbt_eq: number
  revg: number
  ebm: number
  acqs: number
  acqf: string
  rea: string
}

interface OverridePatch extends Partial<CompanyFields> {
  source?: BaselineSource
}

/** Classify acqs 1..10 → flag, matching the platform's existing bands. */
function flagFromScore(score: number): string {
  if (score >= 9) return 'STRONG BUY'
  if (score >= 7) return 'CONSIDER'
  if (score >= 5) return 'MONITOR'
  if (score >= 3) return 'PASS'
  return 'PASS'
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let body: {
    overrides?: Record<string, OverridePatch>
    newCompanies?: CompanyFields[]
    source?: BaselineSource
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const addedBy = session.user.email || 'admin'
  const defaultSource: BaselineSource = body.source ?? 'manual'

  try {
    await ensureSchema()

    let insertedCount = 0
    let updatedCount = 0
    let seededCount = 0
    const skipped: string[] = []

    // ── Insert new companies (with duplicate detection) ──
    const newCompanies = body.newCompanies || []
    for (const nc of newCompanies) {
      // Server-side duplicate detection:
      // 1. Exact ticker match in static COMPANIES[]
      // 2. Fuzzy name match (first 2 words) in static COMPANIES[]
      // 3. Financial similarity (mktcap within 10%) in static COMPANIES[]
      // 4. Existing row in user_companies DB table (ticker or name match)
      const ncNameWords = nc.name.toLowerCase().split(/\s+/).slice(0, 2).join(' ')

      const staticDup = COMPANIES.find((c) => {
        // Exact ticker/nse match
        if (c.ticker === nc.ticker || c.nse === nc.ticker) return true
        // Fuzzy name match
        const cNameWords = c.name.toLowerCase().split(/\s+/).slice(0, 2).join(' ')
        if (cNameWords === ncNameWords) return true
        // Financial similarity: if mktcap is within 10% AND name shares a word
        if (nc.mktcap > 0 && c.mktcap > 0) {
          const ratio = nc.mktcap / c.mktcap
          if (ratio > 0.9 && ratio < 1.1) {
            const cWords = new Set(c.name.toLowerCase().split(/\s+/))
            const ncWords = nc.name.toLowerCase().split(/\s+/)
            if (ncWords.some((w) => w.length >= 4 && cWords.has(w))) return true
          }
        }
        return false
      })

      if (staticDup) {
        skipped.push(`${nc.name} — duplicate of ${staticDup.name} (${staticDup.ticker})`)
        continue
      }

      // Check DB for existing row with same ticker or similar name
      const dbDup = await sql`
        SELECT id, name, ticker FROM user_companies
        WHERE ticker = ${nc.ticker}
           OR LOWER(SUBSTRING(name FROM 1 FOR 30)) = ${ncNameWords.slice(0, 30)}
        LIMIT 1
      `
      if (dbDup.length > 0) {
        skipped.push(`${nc.name} — already in DB as ${dbDup[0].name} (${dbDup[0].ticker})`)
        continue
      }

      const compJson = JSON.stringify(nc.comp || [])
      try {
        await sql`
          INSERT INTO user_companies (
            name, ticker, nse, sec, comp,
            mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
            acqs, acqf, rea, added_by,
            baseline_updated_at, baseline_source
          ) VALUES (
            ${nc.name}, ${nc.ticker}, ${nc.nse || nc.ticker}, ${nc.sec}, ${compJson},
            ${nc.mktcap || 0}, ${nc.rev || 0}, ${nc.ebitda || 0}, ${nc.pat || 0},
            ${nc.ev || 0}, ${nc.ev_eb || 0}, ${nc.pe || 0}, ${nc.pb || 0},
            ${nc.dbt_eq || 0}, ${nc.revg || 0}, ${nc.ebm || 0},
            ${nc.acqs || 5}, ${nc.acqf || 'MONITOR'}, ${nc.rea || ''}, ${addedBy},
            NOW(), ${defaultSource}
          )
          ON CONFLICT (ticker) DO UPDATE SET
            name = EXCLUDED.name,
            mktcap = EXCLUDED.mktcap,
            rev = EXCLUDED.rev,
            ebitda = EXCLUDED.ebitda,
            pat = EXCLUDED.pat,
            ev = EXCLUDED.ev,
            ev_eb = EXCLUDED.ev_eb,
            pe = EXCLUDED.pe,
            pb = EXCLUDED.pb,
            dbt_eq = EXCLUDED.dbt_eq,
            ebm = EXCLUDED.ebm,
            baseline_updated_at = NOW(),
            baseline_source = EXCLUDED.baseline_source,
            updated_at = NOW()
        `
        insertedCount++
      } catch (err) {
        console.error(`[publish-data] Insert ${nc.ticker} failed:`, err)
      }
    }

    // ── Update overrides (upsert into user_companies) ──
    //
    // Per-ticker push: applies the patch fields on top of whatever
    // baseline we can find (existing DB row > static COMPANIES[] seed).
    // If the ticker only exists in static COMPANIES[], we seed a new
    // DB row with the baseline values + the override financials. This
    // is what makes "Push to Website" from the admin Data Sources tab
    // actually replace baseline data on the main site.
    const overrides = body.overrides || {}
    for (const [ticker, patch] of Object.entries(overrides)) {
      const patchSource: BaselineSource = patch.source ?? defaultSource
      try {
        // Determine the baseline — prefer DB row (already an override),
        // fall back to static seed.
        const existing = await sql`
          SELECT id, name, nse, sec, comp,
                 mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
                 acqs, acqf, rea
          FROM user_companies WHERE ticker = ${ticker} LIMIT 1
        `

        const staticSeed = COMPANIES.find((c) => c.ticker === ticker)
        if (existing.length === 0 && !staticSeed) {
          // Nothing to override against — this is a typo or a private ticker.
          skipped.push(`${ticker} — not in static seed or DB; use newCompanies[] to add`)
          continue
        }

        // Build the post-override Company row so we can recompute acqs.
        const baseline: Company = existing.length > 0
          ? {
              name: existing[0].name,
              ticker,
              nse: existing[0].nse ?? ticker,
              sec: existing[0].sec ?? 'solar',
              comp: (() => {
                try { return JSON.parse(existing[0].comp || '[]') } catch { return [] }
              })(),
              mktcap: Number(existing[0].mktcap) || 0,
              rev: Number(existing[0].rev) || 0,
              ebitda: Number(existing[0].ebitda) || 0,
              pat: Number(existing[0].pat) || 0,
              ev: Number(existing[0].ev) || 0,
              ev_eb: Number(existing[0].ev_eb) || 0,
              pe: Number(existing[0].pe) || 0,
              pb: Number(existing[0].pb) || 0,
              dbt_eq: Number(existing[0].dbt_eq) || 0,
              revg: Number(existing[0].revg) || 0,
              ebm: Number(existing[0].ebm) || 0,
              acqs: Number(existing[0].acqs) || 5,
              acqf: existing[0].acqf || 'MONITOR',
              rea: existing[0].rea || '',
            }
          : (staticSeed as Company)

        const next: Company = {
          ...baseline,
          mktcap: patch.mktcap ?? baseline.mktcap,
          rev: patch.rev ?? baseline.rev,
          ebitda: patch.ebitda ?? baseline.ebitda,
          pat: patch.pat ?? baseline.pat,
          ev: patch.ev ?? baseline.ev,
          ev_eb: patch.ev_eb ?? baseline.ev_eb,
          pe: patch.pe ?? baseline.pe,
          pb: patch.pb ?? baseline.pb,
          dbt_eq: patch.dbt_eq ?? baseline.dbt_eq,
          revg: patch.revg ?? baseline.revg,
          ebm: patch.ebm ?? baseline.ebm,
        }

        // Recompute acqs from the 7-driver model UNLESS the client
        // supplied an explicit hard-override value (rare — only used
        // for editorial tweaks via the admin tool).
        const isAtlasStub = next.rev === 0 && next.ebitda === 0 &&
                            next.revg === 0 && next.ebm === 0
        let finalAcqs: number
        let finalFlag: string
        let finalRea: string
        if (patch.acqs != null) {
          finalAcqs = patch.acqs
          finalFlag = patch.acqf ?? flagFromScore(patch.acqs)
          finalRea = patch.rea ?? next.rea
        } else if (isAtlasStub) {
          // Keep the seeded heuristic score; recomputation over zero
          // financials produces garbage (D/E=0 scores 10, etc).
          finalAcqs = next.acqs
          finalFlag = next.acqf
          finalRea = patch.rea ?? next.rea
        } else {
          const audit = recomputeAcqScore(next)
          finalAcqs = audit.normalised
          finalFlag = flagFromScore(audit.normalised)
          finalRea = patch.rea ?? next.rea
        }

        if (existing.length > 0) {
          await sql`
            UPDATE user_companies SET
              mktcap = ${next.mktcap},
              rev = ${next.rev},
              ebitda = ${next.ebitda},
              pat = ${next.pat},
              ev = ${next.ev},
              ev_eb = ${next.ev_eb},
              pe = ${next.pe},
              pb = ${next.pb},
              dbt_eq = ${next.dbt_eq},
              revg = ${next.revg},
              ebm = ${next.ebm},
              acqs = ${finalAcqs},
              acqf = ${finalFlag},
              rea = ${finalRea},
              baseline_updated_at = NOW(),
              baseline_source = ${patchSource},
              updated_at = NOW()
            WHERE ticker = ${ticker}
          `
          updatedCount++
        } else if (staticSeed) {
          // Seed a new DB row cloning the static record + overrides.
          // After this, the LiveSnapshotProvider merge will surface
          // the DB row over the static one on every page.
          const compJson = JSON.stringify(staticSeed.comp || [])
          await sql`
            INSERT INTO user_companies (
              name, ticker, nse, sec, comp,
              mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
              acqs, acqf, rea, added_by,
              baseline_updated_at, baseline_source
            ) VALUES (
              ${staticSeed.name}, ${ticker}, ${staticSeed.nse || ticker}, ${staticSeed.sec}, ${compJson},
              ${next.mktcap}, ${next.rev}, ${next.ebitda}, ${next.pat},
              ${next.ev}, ${next.ev_eb}, ${next.pe}, ${next.pb},
              ${next.dbt_eq}, ${next.revg}, ${next.ebm},
              ${finalAcqs}, ${finalFlag}, ${finalRea}, ${addedBy},
              NOW(), ${patchSource}
            )
            ON CONFLICT (ticker) DO UPDATE SET
              mktcap = EXCLUDED.mktcap,
              rev = EXCLUDED.rev,
              ebitda = EXCLUDED.ebitda,
              pat = EXCLUDED.pat,
              ev = EXCLUDED.ev,
              ev_eb = EXCLUDED.ev_eb,
              pe = EXCLUDED.pe,
              pb = EXCLUDED.pb,
              dbt_eq = EXCLUDED.dbt_eq,
              revg = EXCLUDED.revg,
              ebm = EXCLUDED.ebm,
              acqs = EXCLUDED.acqs,
              acqf = EXCLUDED.acqf,
              rea = EXCLUDED.rea,
              baseline_updated_at = NOW(),
              baseline_source = EXCLUDED.baseline_source,
              updated_at = NOW()
          `
          seededCount++
        }
      } catch (err) {
        console.error(`[publish-data] Update ${ticker} failed:`, err)
      }
    }

    const bits: string[] = []
    if (insertedCount > 0) bits.push(`${insertedCount} inserted`)
    if (updatedCount > 0) bits.push(`${updatedCount} updated`)
    if (seededCount > 0) bits.push(`${seededCount} seeded from baseline`)
    if (skipped.length > 0) bits.push(`${skipped.length} skipped`)
    const message = bits.length > 0
      ? `Published: ${bits.join(', ')}. Acquisition scores recomputed live — refresh pages to see updates.`
      : 'No changes.'

    return NextResponse.json({
      ok: true,
      message,
      insertedCount,
      updatedCount,
      seededCount,
      skipped: skipped.length > 0 ? skipped : undefined,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
