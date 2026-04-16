import { NextResponse } from 'next/server'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { fetchQualitativeFromScreener } from '@/lib/live/screener-qualitative'
import { COMPANIES } from '@/lib/data/companies'

/**
 * GET /api/data/company-qualitative/[ticker]
 *
 * Returns the free-source qualitative bundle for one ticker:
 *   - ar_url / ar_year / ar_fetched_at  (Annual Report PDF link)
 *   - credit_rating                      (rating-agency doc links)
 *   - shareholding                       (% breakdown over recent quarters)
 *
 * **Public endpoint** — no authentication required. The data is sourced
 * entirely from public Screener.in HTML (SEBI-mandated quarterly filings
 * and NSE/BSE-published annual reports), so there's no privileged content
 * to gate. Previously this was auth-gated which silently hid real
 * shareholding data from public report visitors (/report/[ticker]?public=1)
 * and they always fell back to sector-median heuristics.
 *
 * Lookup flow:
 *   1. Check `user_companies.shareholding` — served instantly if present
 *      and < 30 days old (Screener's quarterly filings don't refresh
 *      more often than that anyway).
 *   2. Otherwise scrape Screener on demand and upsert into user_companies
 *      so the next caller gets the cached row. One scrape ≈ 1-2 s.
 *   3. If the scrape also fails (Screener down / ticker delisted) return
 *      empty fields so the report gracefully falls back to its sector
 *      heuristic.
 *
 * Rate limiting: natural — a ticker only gets scraped once per 30 days
 * thanks to the DB cache. Per-IP rate limits live in middleware.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DB_FRESHNESS_DAYS = 30

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
  const { ticker: rawTicker } = await params
  const ticker = String(rawTicker || '').toUpperCase().trim()
  if (!ticker) {
    return NextResponse.json({ ok: false, error: 'ticker required' }, { status: 400 })
  }

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

  try {
    await ensureSchema()

    // Tier 1: existing row.
    const rows = await sql`
      SELECT ar_url, ar_year, ar_fetched_at, ar_parsed,
             credit_rating, shareholding, facilities,
             customers, nclt_cases, mda_extract
      FROM user_companies
      WHERE ticker = ${ticker}
      LIMIT 1
    `
    const parseMaybe = (v: unknown): unknown => {
      if (v == null) return null
      if (typeof v === 'string') {
        try { return JSON.parse(v) } catch { return null }
      }
      return v
    }

    if (rows && rows.length > 0) {
      const r = rows[0] as QualitativeRow
      const shParsed = parseMaybe(r.shareholding)
      const hasShareholding = Array.isArray(shParsed) && shParsed.length > 0
      const freshMs = DB_FRESHNESS_DAYS * 24 * 3600 * 1000
      const fetchedAt = r.ar_fetched_at ? new Date(r.ar_fetched_at).getTime() : 0
      const isFresh = fetchedAt > 0 && (Date.now() - fetchedAt) < freshMs

      // Cached hit: return immediately.
      if (hasShareholding && isFresh) {
        return NextResponse.json({
          ok: true,
          ticker,
          cacheSource: 'db_fresh',
          qualitative: {
            arUrl: r.ar_url,
            arYear: r.ar_year,
            arFetchedAt: r.ar_fetched_at,
            creditRating: parseMaybe(r.credit_rating) ?? [],
            shareholding: shParsed,
            facilities: parseMaybe(r.facilities),
            customers: parseMaybe(r.customers),
            ncltCases: parseMaybe(r.nclt_cases),
            mdaExtract: parseMaybe(r.mda_extract),
            arParsed: parseMaybe(r.ar_parsed),
          },
        })
      }
    }

    // Tier 2: on-demand Screener scrape.
    //
    // Resolve the NSE code from COMPANIES first (some SMEs have a
    // divergent Screener code vs display ticker). If not in the static
    // seed just pass the ticker through; screenerCode() handles that.
    const staticRow = COMPANIES.find((c) => c.ticker === ticker)
    const nseCode = staticRow?.nse || null

    const scraped = await fetchQualitativeFromScreener(ticker, nseCode)

    // Persist whatever we got so the next caller skips the scrape.
    // We insert even when shareholding is empty — that caches the
    // fact that the scraper found nothing (e.g. fresh IPO) so we
    // don't re-scrape on every pageview.
    const arUrl = scraped.ar.url
    const arYear = scraped.ar.year
    const creditRatingJson = scraped.creditRatings.length > 0
      ? JSON.stringify(scraped.creditRatings)
      : null
    const shareholdingJson = scraped.shareholding.length > 0
      ? JSON.stringify(scraped.shareholding)
      : null

    await sql`
      INSERT INTO user_companies
        (name, ticker, nse, sec,
         ar_url, ar_year, ar_fetched_at, credit_rating, shareholding)
      VALUES
        (${staticRow?.name || ticker}, ${ticker}, ${nseCode || ticker},
         ${staticRow?.sec || 'unknown'},
         ${arUrl}, ${arYear}, NOW(),
         ${creditRatingJson}::jsonb,
         ${shareholdingJson}::jsonb)
      ON CONFLICT (ticker) DO UPDATE SET
        ar_url         = COALESCE(EXCLUDED.ar_url, user_companies.ar_url),
        ar_year        = COALESCE(EXCLUDED.ar_year, user_companies.ar_year),
        ar_fetched_at  = NOW(),
        credit_rating  = COALESCE(EXCLUDED.credit_rating, user_companies.credit_rating),
        shareholding   = COALESCE(EXCLUDED.shareholding, user_companies.shareholding)
    `.catch(() => {
      // Non-fatal: if the upsert fails (e.g. schema not yet migrated)
      // we still return the scraped data to the caller.
    })

    return NextResponse.json({
      ok: true,
      ticker,
      cacheSource: rows && rows.length > 0 ? 'db_stale_rescrape' : 'screener_live',
      qualitative: {
        arUrl: arUrl,
        arYear: arYear,
        arFetchedAt: new Date().toISOString(),
        creditRating: scraped.creditRatings,
        shareholding: scraped.shareholding,
        facilities: null,
        customers: null,
        ncltCases: null,
        mdaExtract: null,
        arParsed: null,
      },
    })
  } catch (err) {
    // Hard failure — return empty so the report still renders.
    return NextResponse.json({
      ok: true,
      ticker,
      cacheSource: 'empty_fallback',
      error: err instanceof Error ? err.message : String(err),
      qualitative: empty,
    })
  }
}
