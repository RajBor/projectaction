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
  // Anonymous visitors — the public /report/[ticker]?public=1 flow needs
  // to resolve admin-published tickers (TATAELXSI, INFY, atlas-only
  // pharma/cement rows, …) that don't live in the static COMPANIES
  // seed. Returning 401 here left allCompanies stuck at the 87-row
  // curated set, so every non-seed landing-dropdown pick flashed
  // "Company not found" on the redirect page. Serve a minimal shape
  // (identity + published financials already visible in the public
  // report) without the admin-only metadata (added_by, _dbId, etc.).
  const isAnonymous = !session?.user

  try {
    await ensureSchema()
    // For anonymous callers we drop the admin-only audit fields
    // (added_by, baseline_source, fetch_attempts …) and omit any row
    // flagged excluded_from_reports so the public flow mirrors the
    // Report Builder picker exactly. Authenticated callers still get
    // the full shape for the admin tools.
    const rows = isAnonymous
      ? await sql`
          SELECT name, ticker, nse, sec, comp, subcomp,
                 mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
                 acqs, acqf, rea
          FROM user_companies
          WHERE COALESCE(excluded_from_reports, FALSE) = FALSE
        `
      : await sql`
          SELECT id, name, ticker, nse, sec, comp, subcomp,
                 mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
                 acqs, acqf, rea, added_by, created_at, updated_at,
                 baseline_updated_at, baseline_source, baseline_verified_at,
                 baseline_fetch_attempts, baseline_fetch_status,
                 excluded_from_reports
          FROM user_companies
          ORDER BY created_at DESC
        `

    // Parse the comp / subcomp JSON strings back to string[]. subcomp is
    // DealNector VC-Taxonomy sub-segment ids like 'ss_1_2_3'. Empty array
    // is the normal default — means "no sub-segments tagged".
    const companies = rows.map((r) => ({
      name: r.name,
      ticker: r.ticker,
      nse: r.nse || r.ticker,
      sec: r.sec || 'solar',
      comp: (() => { try { return JSON.parse(r.comp || '[]') } catch { return [] } })(),
      subcomp: (() => { try { return JSON.parse(r.subcomp || '[]') } catch { return [] } })(),
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
      // Sticky-verified cache — only advances when a scrape passed every
      // validator (Phase 2). Downstream code reads this to decide when
      // to show "verified X ago" vs "stale / needs re-check" badges.
      _baselineVerifiedAt: r.baseline_verified_at,
      _fetchAttempts: Number(r.baseline_fetch_attempts) || 0,
      _fetchStatus: r.baseline_fetch_status || 'pending',
      // Admin-toggled hide flag — consumed by the Report Builder picker
      // and any other place that surfaces companies for external use.
      _excludedFromReports: !!r.excluded_from_reports,
    }))

    return NextResponse.json({ ok: true, companies, count: companies.length })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
