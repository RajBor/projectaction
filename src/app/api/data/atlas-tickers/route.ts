import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { COMPANIES } from '@/lib/data/companies'

/**
 * GET /api/data/atlas-tickers
 *
 * Returns atlas-seeded company stubs (from `industry_chain_companies`)
 * that are NOT already in the static `COMPANIES[]` seed NOR in
 * `user_companies`. The `LiveSnapshotProvider` on the client calls
 * this to union atlas rows into its in-memory `allCompanies`, which
 * is what makes the ~180 SME / subsidiary tickers visible in dashboard
 * / valuation / M&A-radar counts instead of only ~114.
 *
 * This endpoint is intentionally lean:
 *   - Only listed atlas rows (status MAIN/SME/SUBSIDIARY with a ticker).
 *   - Pre-filters on the server against COMPANIES + user_companies so
 *     the client doesn't have to dedupe.
 *   - Returns a minimal `Company`-shape projection — atlas rows have
 *     no P&L baseline, so financials are zeroed out. When a live NSE /
 *     Screener refresh hits the ticker, the row will be PROMOTED into
 *     user_companies (via publish-data) and will start winning over
 *     the atlas stub on subsequent loads.
 *
 * Any authenticated user can read this — the atlas view is not
 * sensitive; it's just a universe expansion.
 */

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }

  try {
    await ensureSchema()

    // Known tickers from static + DB — we'll exclude these so the client
    // doesn't receive duplicates it already has from
    // /api/data/user-companies.
    const knownTickers = new Set<string>(COMPANIES.map((c) => c.ticker))
    const dbTickers = await sql`SELECT ticker FROM user_companies`
    for (const r of dbTickers as Array<{ ticker: string }>) {
      knownTickers.add(r.ticker)
    }

    // Atlas: take one row per ticker across all industries. A ticker can
    // appear in multiple value-chain stages (e.g. Waaree shows up in
    // module assembly AND in cells) — DISTINCT ON collapses those to
    // the first row per ticker so the ticker only appears once in the
    // live universe. `industry_id` is surfaced so the UI can hint
    // "first seen in: solar / modules" if it wants.
    const rows = await sql`
      SELECT DISTINCT ON (ticker) ticker, name, industry_id, stage_id, status
      FROM industry_chain_companies
      WHERE status IN ('MAIN','SME','SUBSIDIARY')
        AND ticker IS NOT NULL
        AND ticker <> ''
      ORDER BY ticker, industry_id ASC
    `

    // Map each atlas row to a minimal Company shape so LiveSnapshotProvider
    // can treat it like any other entry. Zero baselines are intentional —
    // they signal "no curated financials, fill from scrapers" to the
    // cascading merge logic.
    const atlasOnly = (rows as Array<{ ticker: string; name: string; industry_id: string; stage_id: string; status: string }>)
      .filter((r) => {
        const t = String(r.ticker).toUpperCase().trim()
        return t && !knownTickers.has(t)
      })
      .map((r) => ({
        ticker: String(r.ticker).toUpperCase().trim(),
        name: r.name || r.ticker,
        // Atlas rows use the ticker as the NSE symbol by convention. If a
        // specific atlas row needs a different symbol, the admin
        // promotes it to user_companies with an explicit `nse` override.
        nse: String(r.ticker).toUpperCase().trim(),
        // Default to the industry_id as the sec tag. The dashboard
        // filter hook (useIndustryFilter) already expects solar/wind/td/…
        // keys so this lines up cleanly.
        sec: r.industry_id || 'solar',
        comp: [r.stage_id].filter(Boolean),
        // Atlas-sourced rows have no baseline — downstream code treats
        // zero as "gap that needs filling from live sources". The acqs
        // default is 5 (neutral) and acqf MONITOR so filters don't hide
        // atlas tickers by default.
        mktcap: 0, rev: 0, ebitda: 0, pat: 0, ev: 0, ev_eb: 0, pe: 0,
        pb: 0, dbt_eq: 0, revg: 0, ebm: 0,
        acqs: 5, acqf: 'MONITOR', rea: '',
        _atlasIndustry: r.industry_id,
        _atlasStage: r.stage_id,
        _atlasStatus: r.status,
      }))

    return NextResponse.json({ ok: true, companies: atlasOnly, count: atlasOnly.length })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
