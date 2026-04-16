import { NextResponse } from 'next/server'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import {
  fetchScreenerHtml,
  parseMultiYearFinancials,
  screenerCode,
  type ScreenerYearData,
} from '@/lib/live/screener-fetch'
import { COMPANIES } from '@/lib/data/companies'

/**
 * GET /api/data/screener-financials/[ticker]
 *
 * Returns up to 10 years of profit-and-loss + balance-sheet + cash-flow
 * figures for a ticker, sourced from Screener.in's public HTML. Used by
 * the public report (/report/[ticker]?public=1) to populate the
 * Historical Financials, Balance Sheet & Returns and Working Capital
 * tables with REAL reported numbers instead of the single-year heuristic
 * estimates the Company snapshot produces in isolation.
 *
 * **Public endpoint** — Screener data is SEBI-filed quarterly/annual
 * disclosure, already public; no auth required. This matches the
 * pattern we just applied to the qualitative endpoint.
 *
 * Caching:
 *   1. `user_companies.financials_multi` JSONB is checked first — served
 *      instantly when fresh (< 30 days). Annual filings don't refresh
 *      more often than that.
 *   2. On miss / stale, scrape Screener on demand (~300-500 ms),
 *      upsert the cache, and return. Next caller gets the cached row.
 *   3. On scraper failure we return empty `{years:[]}` so the consuming
 *      report page can fall back to its snapshot heuristic.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DB_FRESHNESS_DAYS = 30

interface FinancialsRow {
  financials_multi: unknown
  financials_multi_at: string | null
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

  try {
    await ensureSchema()

    // Tier 1: existing cached row.
    const rows = (await sql`
      SELECT financials_multi, financials_multi_at
      FROM user_companies
      WHERE ticker = ${ticker}
      LIMIT 1
    `.catch(() => [])) as FinancialsRow[]

    const parseMaybe = (v: unknown): ScreenerYearData[] | null => {
      if (v == null) return null
      if (typeof v === 'string') {
        try {
          const parsed = JSON.parse(v)
          return Array.isArray(parsed) ? (parsed as ScreenerYearData[]) : null
        } catch {
          return null
        }
      }
      if (Array.isArray(v)) return v as ScreenerYearData[]
      return null
    }

    if (rows.length > 0) {
      const r = rows[0]
      const cached = parseMaybe(r.financials_multi)
      const fetchedAt = r.financials_multi_at ? new Date(r.financials_multi_at).getTime() : 0
      const freshMs = DB_FRESHNESS_DAYS * 24 * 3600 * 1000
      const isFresh = fetchedAt > 0 && Date.now() - fetchedAt < freshMs
      if (cached && cached.length > 0 && isFresh) {
        return NextResponse.json({
          ok: true,
          ticker,
          cacheSource: 'db_fresh',
          fetchedAt: r.financials_multi_at,
          years: cached,
        })
      }
    }

    // Tier 2: on-demand Screener scrape.
    const staticRow = COMPANIES.find((c) => c.ticker === ticker)
    const nseCode = staticRow?.nse || null
    const code = screenerCode(ticker, nseCode)

    const { html } = await fetchScreenerHtml(code)
    if (!html) {
      return NextResponse.json({
        ok: true,
        ticker,
        cacheSource: 'screener_unreachable',
        fetchedAt: null,
        years: [],
      })
    }

    const years = parseMultiYearFinancials(html)

    // Persist whatever we got. We upsert even an empty array — that
    // caches the "no data" signal so we don't re-scrape on every view.
    // The UPDATE clause refreshes financials_multi_at unconditionally
    // so the 30-day TTL restarts; the next live-miss is one month away.
    const financialsJson = years.length > 0 ? JSON.stringify(years) : null
    await sql`
      INSERT INTO user_companies
        (name, ticker, nse, sec, financials_multi, financials_multi_at)
      VALUES
        (${staticRow?.name || ticker}, ${ticker}, ${nseCode || ticker},
         ${staticRow?.sec || 'unknown'},
         ${financialsJson}::jsonb, NOW())
      ON CONFLICT (ticker) DO UPDATE SET
        financials_multi    = COALESCE(EXCLUDED.financials_multi, user_companies.financials_multi),
        financials_multi_at = NOW()
    `.catch(() => {
      // Non-fatal — still return the scraped data.
    })

    return NextResponse.json({
      ok: true,
      ticker,
      cacheSource: rows.length > 0 ? 'db_stale_rescrape' : 'screener_live',
      fetchedAt: new Date().toISOString(),
      years,
    })
  } catch (err) {
    return NextResponse.json({
      ok: true,
      ticker,
      cacheSource: 'empty_fallback',
      error: err instanceof Error ? err.message : String(err),
      fetchedAt: null,
      years: [] as ScreenerYearData[],
    })
  }
}
