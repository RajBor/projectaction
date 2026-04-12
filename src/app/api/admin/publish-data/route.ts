import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { COMPANIES } from '@/lib/data/companies'

/**
 * POST /api/admin/publish-data
 *
 * Admin / sub-admin only. Two operations:
 *
 * 1. newCompanies[] — INSERT new companies into the `user_companies`
 *    DB table (works on read-only filesystems like Vercel).
 *
 * 2. overrides{} — UPDATE existing user_companies rows OR insert
 *    if the ticker doesn't exist yet (upsert).
 *
 * Body: {
 *   overrides?: Record<string, Partial<CompanyFields>>
 *   newCompanies?: CompanyFields[]
 * }
 */

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

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let body: {
    overrides?: Record<string, Partial<CompanyFields>>
    newCompanies?: CompanyFields[]
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const addedBy = session.user.email || 'admin'

  try {
    await ensureSchema()

    let insertedCount = 0
    let updatedCount = 0
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
            acqs, acqf, rea, added_by
          ) VALUES (
            ${nc.name}, ${nc.ticker}, ${nc.nse || nc.ticker}, ${nc.sec}, ${compJson},
            ${nc.mktcap || 0}, ${nc.rev || 0}, ${nc.ebitda || 0}, ${nc.pat || 0},
            ${nc.ev || 0}, ${nc.ev_eb || 0}, ${nc.pe || 0}, ${nc.pb || 0},
            ${nc.dbt_eq || 0}, ${nc.revg || 0}, ${nc.ebm || 0},
            ${nc.acqs || 5}, ${nc.acqf || 'MONITOR'}, ${nc.rea || ''}, ${addedBy}
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
            updated_at = NOW()
        `
        insertedCount++
      } catch (err) {
        console.error(`[publish-data] Insert ${nc.ticker} failed:`, err)
      }
    }

    // ── Update overrides (upsert into user_companies) ──
    const overrides = body.overrides || {}
    for (const [ticker, patch] of Object.entries(overrides)) {
      try {
        // Check if it exists in user_companies
        const existing = await sql`
          SELECT id FROM user_companies WHERE ticker = ${ticker} LIMIT 1
        `
        if (existing.length > 0) {
          await sql`
            UPDATE user_companies SET
              mktcap = COALESCE(${patch.mktcap ?? null}, mktcap),
              rev = COALESCE(${patch.rev ?? null}, rev),
              ebitda = COALESCE(${patch.ebitda ?? null}, ebitda),
              pat = COALESCE(${patch.pat ?? null}, pat),
              ev = COALESCE(${patch.ev ?? null}, ev),
              ev_eb = COALESCE(${patch.ev_eb ?? null}, ev_eb),
              pe = COALESCE(${patch.pe ?? null}, pe),
              pb = COALESCE(${patch.pb ?? null}, pb),
              dbt_eq = COALESCE(${patch.dbt_eq ?? null}, dbt_eq),
              ebm = COALESCE(${patch.ebm ?? null}, ebm),
              updated_at = NOW()
            WHERE ticker = ${ticker}
          `
          updatedCount++
        }
        // If it's only in COMPANIES[] (static file), we skip the
        // DB update — those are handled via the baseline refresh script
      } catch (err) {
        console.error(`[publish-data] Update ${ticker} failed:`, err)
      }
    }

    return NextResponse.json({
      ok: true,
      message: `Published: ${insertedCount} inserted, ${updatedCount} updated${skipped.length > 0 ? `, ${skipped.length} skipped (duplicates)` : ''}.`,
      insertedCount,
      updatedCount,
      skipped: skipped.length > 0 ? skipped : undefined,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
