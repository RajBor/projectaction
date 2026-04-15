import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * GET /api/data/user-companies
 *
 * Returns all companies from the user_companies DB table (admin-added
 * companies including SME discoveries). Any authenticated user can
 * read this — the data feeds into the platform's Company list
 * alongside the static COMPANIES[] array.
 */

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }

  try {
    await ensureSchema()
    const rows = await sql`
      SELECT id, name, ticker, nse, sec, comp,
             mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
             acqs, acqf, rea, added_by, created_at, updated_at,
             baseline_updated_at, baseline_source
      FROM user_companies
      ORDER BY created_at DESC
    `

    // Parse the comp JSON string back to string[]
    const companies = rows.map((r) => ({
      name: r.name,
      ticker: r.ticker,
      nse: r.nse || r.ticker,
      sec: r.sec || 'solar',
      comp: (() => { try { return JSON.parse(r.comp || '[]') } catch { return [] } })(),
      mktcap: Number(r.mktcap) || 0,
      rev: Number(r.rev) || 0,
      ebitda: Number(r.ebitda) || 0,
      pat: Number(r.pat) || 0,
      ev: Number(r.ev) || 0,
      ev_eb: Number(r.ev_eb) || 0,
      pe: Number(r.pe) || 0,
      pb: Number(r.pb) || 0,
      dbt_eq: Number(r.dbt_eq) || 0,
      revg: Number(r.revg) || 0,
      ebm: Number(r.ebm) || 0,
      acqs: Number(r.acqs) || 5,
      acqf: r.acqf || 'MONITOR',
      rea: r.rea || '',
      _dbId: r.id,
      _addedBy: r.added_by,
      _createdAt: r.created_at,
      // Baseline-refresh audit (admin push from NSE/Screener/RapidAPI).
      // `null` when the company has never had an admin push.
      _baselineUpdatedAt: r.baseline_updated_at,
      _baselineSource: r.baseline_source,
    }))

    return NextResponse.json({ ok: true, companies, count: companies.length })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
