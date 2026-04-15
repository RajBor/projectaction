import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { loadCompanyPool } from '@/lib/live/company-pool'
import { fetchScreenerHtml, screenerCode } from '@/lib/live/screener-fetch'

/**
 * POST /api/admin/fetch-qualitative
 *
 * Free-source fetcher for the "qualitative" columns added in ensureSchema:
 *   - ar_url / ar_year / ar_fetched_at   → Annual Report PDF link
 *   - credit_rating                       → list of rating-agency doc links
 *   - shareholding                        → promoter/FII/DII/public/govt %
 *
 * All data comes from Screener.in's free public HTML (`/company/<CODE>/`).
 * We deliberately do NOT hit:
 *   - Rating agencies directly (CRISIL/CARE/ICRA each needs its own scraper,
 *     layouts drift, and we only need the links — Screener already aggregates).
 *   - NCLT.gov.in — JS-rendered, captcha-guarded, not reliably scrapable.
 *   - Any paid API (RapidAPI, Anthropic tool calls, etc.) per the
 *     "free sources only, omit paid data" directive.
 *
 * Columns that the schema defines but this route doesn't populate:
 *   ar_parsed / facilities / customers / mda_extract / nclt_cases
 *
 *   - ar_parsed / mda_extract / facilities would require downloading the
 *     AR PDF and running either (a) heuristic regex over page text —
 *     fragile, inconsistent across annual reports — or (b) an LLM
 *     structured-extraction call, which costs money. Left null on purpose.
 *     If a heuristic fetcher is added later, it should live in a separate
 *     /api/admin/fetch-ar-extract route so the free-only pipeline here
 *     stays well-scoped.
 *   - customers — no reliable free source. Annual reports occasionally
 *     list "key clients" but there's no standard section, and company
 *     websites vary wildly.
 *   - nclt_cases — NCLT portal + MCA filings are technically public but
 *     require JS rendering with headless browsers; out of scope for a
 *     free pure-HTTP scraper.
 *
 * Body:
 *   { tickers?: string[] }   — empty = fetch all eligible tickers
 *
 * Response:
 *   { ok, updated, errors?, summary: { ar, rating, shareholding } }
 *
 * Safety:
 *   - Admin / sub-admin only.
 *   - 800ms sleep between tickers (matches the Screener scrape cadence).
 *   - `ON CONFLICT (ticker) DO UPDATE` so atlas-only tickers (not yet in
 *     user_companies) get auto-seeded when their first qualitative blob
 *     lands — same pattern as publish-data.
 */

interface ShareholdingQuarter {
  period: string
  promoterPct: number | null
  fiiPct: number | null
  diiPct: number | null
  publicPct: number | null
  govtPct: number | null
  pledgedPct: number | null
}

interface CreditRatingLink {
  title: string
  url: string
  date: string | null
}

/**
 * Extract the Annual Report PDF link + year from Screener's
 * "Documents" section. Screener renders this as a fixed block:
 *   <section id="documents" class="card">
 *     <h2>Documents</h2>
 *     <div class="documents">
 *       <div><h3>Annual reports</h3>
 *         <ul><li><a href="...pdf" class="..." target="_blank">from bse<br>Financial Year 2024</a></li>...</ul>
 *       </div>
 *       <div><h3>Credit ratings</h3><ul>...</ul></div>
 *     </div>
 *   </section>
 */
function extractAnnualReport(html: string): { url: string | null; year: number | null } {
  // Narrow to the Documents card first so we don't accidentally grab a
  // "related documents" link elsewhere on the page.
  const docSection = html.match(/<section[^>]*id="documents"[\s\S]*?<\/section>/i)?.[0] || ''
  if (!docSection) return { url: null, year: null }

  // Find the Annual reports sub-block.
  const arBlock = docSection.match(/Annual reports[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i)?.[1] || ''
  if (!arBlock) return { url: null, year: null }

  // First `<a href="...">...</a>` — Screener lists most-recent first.
  const firstLink = arBlock.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
  if (!firstLink) return { url: null, year: null }

  const url = firstLink[1]
  // Link text contains something like "from bse<br>Financial Year 2024"
  // or "Annual Report 2023-24". We pull the 4-digit year.
  const text = firstLink[2].replace(/<[^>]+>/g, ' ').trim()
  const yearMatch = text.match(/(20\d{2})(?:-\d{2})?/)
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null

  return { url, year }
}

/**
 * Extract credit rating doc links from Screener's Documents section.
 * Returns an array of `{ title, url, date }` — the rating VALUE itself
 * (AAA / AA+ / etc.) lives inside the linked PDF, which we don't parse
 * (would require pdf extraction + non-trivial regex per agency layout).
 * Storing the links is enough for an admin to drill through.
 */
function extractCreditRatings(html: string): CreditRatingLink[] {
  const docSection = html.match(/<section[^>]*id="documents"[\s\S]*?<\/section>/i)?.[0] || ''
  if (!docSection) return []

  const rrBlock = docSection.match(/(?:Credit ratings?|Rating rationale)[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i)?.[1] || ''
  if (!rrBlock) return []

  const links: CreditRatingLink[] = []
  // Iterate every <a href=...> in the block.
  const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(rrBlock)) !== null) {
    const url = m[1]
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const dateMatch = text.match(/(\d{1,2}\s+\w+\s+20\d{2}|20\d{2}-\d{2}-\d{2})/)
    links.push({ title: text, url, date: dateMatch ? dateMatch[1] : null })
    if (links.length >= 10) break  // hard cap — no company has 10+ active ratings
  }
  return links
}

/**
 * Extract the shareholding pattern table.
 *
 * Screener renders this in `<section id="shareholding">` with TWO
 * switchable sub-tables ("Quarterly" and "Yearly"). We parse the
 * Quarterly one because it's the most recent. The table is a standard
 * pivot: columns = periods, rows = shareholder categories.
 *
 * Rows we care about (labels as rendered):
 *   Promoters, FIIs, DIIs, Public, Government, Pledged
 *
 * Values are stringified percentages like "46.80%". We parse them
 * into floats; "-" → null.
 */
function extractShareholding(html: string): ShareholdingQuarter[] {
  const shSection = html.match(/<section[^>]*id="shareholding"[\s\S]*?<\/section>/i)?.[0] || ''
  if (!shSection) return []

  // Prefer the quarterly table; fall back to yearly if quarterly absent.
  const tableMatch = shSection.match(/<div[^>]+id="quarterly-shp"[\s\S]*?(<table[\s\S]*?<\/table>)/i)
    ?? shSection.match(/<div[^>]+id="yearly-shp"[\s\S]*?(<table[\s\S]*?<\/table>)/i)
    ?? shSection.match(/(<table[\s\S]*?<\/table>)/i)
  const tableHtml = tableMatch?.[1] || ''
  if (!tableHtml) return []

  // Header row → period labels.
  const headerRow = tableHtml.match(/<thead[\s\S]*?<\/thead>/i)?.[0] || ''
  const headerCells = Array.from(headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi))
    .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
  // First cell is a blank / "Mar 2024" style label. Drop the 0th if empty.
  const periods = headerCells[0] === '' ? headerCells.slice(1) : headerCells

  // Body rows — category name in first cell, % values in the rest.
  const body = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] || ''
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const rows: Array<{ label: string; vals: (number | null)[] }> = []
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(body)) !== null) {
    const cells = Array.from(rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
      .map((m) => m[1].replace(/<[^>]+>/g, '').trim())
    if (cells.length < 2) continue
    const label = cells[0].replace(/[+\s]+$/, '').trim()
    const vals = cells.slice(1).map((c) => {
      if (!c || c === '-') return null
      const n = parseFloat(c.replace(/[%,]/g, ''))
      return Number.isFinite(n) ? n : null
    })
    rows.push({ label, vals })
  }

  const findRow = (needle: RegExp): (number | null)[] => {
    const r = rows.find((x) => needle.test(x.label))
    return r?.vals ?? []
  }

  const promoters = findRow(/^promoters?$/i)
  const fiis = findRow(/^fiis?$/i)
  const diis = findRow(/^diis?$/i)
  const publicR = findRow(/^public$/i)
  const govt = findRow(/^government$/i)
  const pledged = findRow(/pledg/i)

  // Transpose to per-period rows.
  const quarters: ShareholdingQuarter[] = periods.map((period, i) => ({
    period,
    promoterPct: promoters[i] ?? null,
    fiiPct: fiis[i] ?? null,
    diiPct: diis[i] ?? null,
    publicPct: publicR[i] ?? null,
    govtPct: govt[i] ?? null,
    pledgedPct: pledged[i] ?? null,
  }))

  // Drop trailing quarters that are entirely null (trailing empty columns
  // in Screener's HTML for fresh IPOs).
  while (quarters.length > 0) {
    const last = quarters[quarters.length - 1]
    const allNull = last.promoterPct == null && last.fiiPct == null
      && last.diiPct == null && last.publicPct == null
      && last.govtPct == null && last.pledgedPct == null
    if (allNull) quarters.pop()
    else break
  }

  return quarters
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let requestedTickers: string[] | null = null
  try {
    const body = await req.json().catch(() => ({}))
    if (Array.isArray(body.tickers) && body.tickers.length > 0) {
      requestedTickers = body.tickers.map((t: unknown) => String(t).toUpperCase())
    }
  } catch { /* empty body = all */ }

  try {
    await ensureSchema()
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: 'Schema init failed: ' + (err instanceof Error ? err.message : String(err)) },
      { status: 500 }
    )
  }

  const pool = await loadCompanyPool()
  const targets = Array.from(pool.values()).filter((p) => {
    if (!p.nse) return false
    if (requestedTickers && !requestedTickers.includes(p.ticker)) return false
    return true
  })

  const errors: string[] = []
  const summary = { ar: 0, rating: 0, shareholding: 0 }
  let updated = 0

  for (let i = 0; i < targets.length; i++) {
    const co = targets[i]
    const code = screenerCode(co.ticker, co.nse)
    try {
      const { html } = await fetchScreenerHtml(code)
      if (!html) {
        errors.push(`${co.ticker}: Screener page unreachable`)
        continue
      }

      const ar = extractAnnualReport(html)
      const rating = extractCreditRatings(html)
      const shareholding = extractShareholding(html)

      // Skip tickers where we got nothing at all — avoids overwriting
      // a previously-successful row with empty data (e.g. if Screener
      // transiently served a trimmed HTML response).
      const hasAny = ar.url || rating.length > 0 || shareholding.length > 0
      if (!hasAny) {
        errors.push(`${co.ticker}: no qualitative data found on Screener`)
        continue
      }

      if (ar.url) summary.ar++
      if (rating.length > 0) summary.rating++
      if (shareholding.length > 0) summary.shareholding++

      // Upsert into user_companies. If the ticker is atlas-only (not
      // yet a DB row), INSERT creates the shell so the qualitative
      // data has somewhere to land. The financial columns stay at
      // their DEFAULT zero until the next NSE/Screener refresh
      // pushes real baselines.
      const arJson = ar.url ? JSON.stringify(null) : null  // ar_parsed stays null; separate fetcher
      void arJson  // placeholder — ar_parsed intentionally untouched here
      const ratingJson = rating.length > 0 ? JSON.stringify(rating) : null
      const shareholdingJson = shareholding.length > 0 ? JSON.stringify(shareholding) : null

      await sql`
        INSERT INTO user_companies (name, ticker, nse, sec, ar_url, ar_year, ar_fetched_at, credit_rating, shareholding)
        VALUES (
          ${co.name},
          ${co.ticker},
          ${co.nse ?? co.ticker},
          ${co.sec ?? 'solar'},
          ${ar.url},
          ${ar.year},
          NOW(),
          ${ratingJson}::jsonb,
          ${shareholdingJson}::jsonb
        )
        ON CONFLICT (ticker) DO UPDATE SET
          ar_url         = COALESCE(EXCLUDED.ar_url, user_companies.ar_url),
          ar_year        = COALESCE(EXCLUDED.ar_year, user_companies.ar_year),
          ar_fetched_at  = NOW(),
          credit_rating  = COALESCE(EXCLUDED.credit_rating, user_companies.credit_rating),
          shareholding   = COALESCE(EXCLUDED.shareholding, user_companies.shareholding),
          updated_at     = NOW()
      `
      updated++
    } catch (err) {
      errors.push(`${co.ticker}: ${err instanceof Error ? err.message : 'fetch failed'}`)
    }

    // Matches Screener scrape cadence — any faster and the CDN starts
    // returning 429s after ~50 consecutive requests.
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 800))
    }
  }

  return NextResponse.json({
    ok: true,
    updated,
    total: targets.length,
    summary,
    errors: errors.length > 0 ? errors : undefined,
    message: `Updated qualitative data for ${updated}/${targets.length} tickers. AR: ${summary.ar} · Ratings: ${summary.rating} · Shareholding: ${summary.shareholding}.`,
  })
}
