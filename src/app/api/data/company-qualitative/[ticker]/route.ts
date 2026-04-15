import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * GET /api/data/company-qualitative/[ticker]
 *
 * Returns the free-source qualitative bundle for one ticker:
 *   - ar_url / ar_year / ar_fetched_at  (Annual Report PDF link)
 *   - credit_rating                      (rating-agency doc links)
 *   - shareholding                       (% breakdown over recent quarters)
 *   - facilities / customers / nclt_cases / mda_extract / ar_parsed
 *     (always null today — paid-source columns deliberately left empty)
 *
 * Used by the Institutional Valuation Report at /report/[ticker] to
 * populate the new "Company Details" + "Market Analysis" sections
 * without bloating /api/data/user-companies (which is fetched on every
 * page load by LiveSnapshotProvider — keeping the JSONB blobs out of
 * that hot path matters for the dashboard's initial paint).
 *
 * Auth: any signed-in user. The data is sourced entirely from public
 * Screener.in HTML so there's no privileged content to gate.
 *
 * Response shape (always 200, even for missing tickers — the report
 * gracefully renders "no data" placeholders when fields are null):
 *
 *   {
 *     ok: true,
 *     ticker,
 *     qualitative: {
 *       arUrl, arYear, arFetchedAt,
 *       creditRating: [{title, url, date}],
 *       shareholding: [{period, promoterPct, fiiPct, diiPct, publicPct, govtPct, pledgedPct}],
 *       facilities, customers, ncltCases, mdaExtract, arParsed  // all null today
 *     }
 *   }
 */

interface QualitativeRow {
  ar_url: string | null
  ar_year: number | null
  ar_fetched_at: string | null
  ar_parsed: unknown
  credit_rating: unknown
  shareholding: unknown
  facilities: unknown
  customers: unknown
  nclt_cases: unknown
  mda_extract: unknown
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }

  const { ticker: rawTicker } = await params
  const ticker = String(rawTicker || '').toUpperCase().trim()
  if (!ticker) {
    return NextResponse.json({ ok: false, error: 'ticker required' }, { status: 400 })
  }

  try {
    await ensureSchema()
    const rows = await sql`
      SELECT ar_url, ar_year, ar_fetched_at, ar_parsed,
             credit_rating, shareholding, facilities,
             customers, nclt_cases, mda_extract
      FROM user_companies
      WHERE ticker = ${ticker}
      LIMIT 1
    `

    // Default empty payload — report has to render even if a ticker
    // hasn't been swept by /api/admin/fetch-qualitative yet.
    const empty = {
      arUrl: null,
      arYear: null,
      arFetchedAt: null,
      creditRating: [] as unknown[],
      shareholding: [] as unknown[],
      facilities: null,
      customers: null,
      ncltCases: null,
      mdaExtract: null,
      arParsed: null,
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: true, ticker, qualitative: empty })
    }

    const r = rows[0] as QualitativeRow

    // Postgres JSONB comes back already parsed via the `sql` driver.
    // Defensive parse only if a string slipped through (older rows).
    const parseMaybe = (v: unknown): unknown => {
      if (v == null) return null
      if (typeof v === 'string') {
        try { return JSON.parse(v) } catch { return null }
      }
      return v
    }

    return NextResponse.json({
      ok: true,
      ticker,
      qualitative: {
        arUrl: r.ar_url,
        arYear: r.ar_year,
        arFetchedAt: r.ar_fetched_at,
        creditRating: parseMaybe(r.credit_rating) ?? [],
        shareholding: parseMaybe(r.shareholding) ?? [],
        facilities: parseMaybe(r.facilities),
        customers: parseMaybe(r.customers),
        ncltCases: parseMaybe(r.nclt_cases),
        mdaExtract: parseMaybe(r.mda_extract),
        arParsed: parseMaybe(r.ar_parsed),
      },
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
