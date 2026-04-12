import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

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

    // ── Insert new companies ──
    const newCompanies = body.newCompanies || []
    for (const nc of newCompanies) {
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
      message: `Published: ${insertedCount} inserted, ${updatedCount} updated.`,
      insertedCount,
      updatedCount,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
