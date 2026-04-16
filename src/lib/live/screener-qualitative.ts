/**
 * Shared qualitative-data extractors for Screener.in company pages.
 *
 * These parsers were originally inlined in `/api/admin/fetch-qualitative`
 * (admin-only batch sweep). We've now lifted them here so the public
 * GET `/api/data/company-qualitative/[ticker]` can scrape on demand
 * when a ticker has no cached row in `user_companies`.
 *
 * All functions are pure HTML regex — no DOM, no external calls except
 * the Screener fetch itself (via `fetchScreenerHtml`). They degrade
 * gracefully on layout changes: missing sections return empty arrays /
 * null fields rather than throwing.
 */

import { fetchScreenerHtml, screenerCode } from '@/lib/live/screener-fetch'

export interface ShareholdingQuarter {
  period: string
  promoterPct: number | null
  fiiPct: number | null
  diiPct: number | null
  publicPct: number | null
  govtPct: number | null
  pledgedPct: number | null
}

export interface CreditRatingLink {
  title: string
  url: string
  date: string | null
}

export interface AnnualReportLink {
  url: string | null
  year: number | null
}

export interface QualitativeExtract {
  ar: AnnualReportLink
  creditRatings: CreditRatingLink[]
  shareholding: ShareholdingQuarter[]
}

// ── Annual report ────────────────────────────────────────────────

export function extractAnnualReport(html: string): AnnualReportLink {
  const docSection = html.match(/<section[^>]*id="documents"[\s\S]*?<\/section>/i)?.[0] || ''
  if (!docSection) return { url: null, year: null }

  const arBlock = docSection.match(/Annual reports[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i)?.[1] || ''
  if (!arBlock) return { url: null, year: null }

  const firstLink = arBlock.match(/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i)
  if (!firstLink) return { url: null, year: null }

  const url = firstLink[1]
  const text = firstLink[2].replace(/<[^>]+>/g, ' ').trim()
  const yearMatch = text.match(/(20\d{2})(?:-\d{2})?/)
  const year = yearMatch ? parseInt(yearMatch[1], 10) : null
  return { url, year }
}

// ── Credit ratings ───────────────────────────────────────────────

export function extractCreditRatings(html: string): CreditRatingLink[] {
  const docSection = html.match(/<section[^>]*id="documents"[\s\S]*?<\/section>/i)?.[0] || ''
  if (!docSection) return []

  const rrBlock = docSection.match(/(?:Credit ratings?|Rating rationale)[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>/i)?.[1] || ''
  if (!rrBlock) return []

  const links: CreditRatingLink[] = []
  const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
  let m: RegExpExecArray | null
  while ((m = linkRe.exec(rrBlock)) !== null) {
    const url = m[1]
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const dateMatch = text.match(/(\d{1,2}\s+\w+\s+20\d{2}|20\d{2}-\d{2}-\d{2})/)
    links.push({ title: text, url, date: dateMatch ? dateMatch[1] : null })
    if (links.length >= 10) break
  }
  return links
}

// ── Shareholding pattern ─────────────────────────────────────────

/**
 * Decode common HTML entities we encounter in Screener tables. The
 * shareholding block uses `&nbsp;` between the label and the expand
 * button on every row (e.g. "Promoters&nbsp;<span>+</span>"). Before
 * this decoder the row-label regex `/^promoters?$/i` would silently
 * fail to match "Promoters&nbsp;" and every ticker's shareholding
 * came back empty.
 *
 * We intentionally decode only the entities Screener actually emits,
 * not the full HTML5 entity set — keeps the surface tiny and
 * well-understood.
 */
function decodeEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
}

/**
 * Parses Screener's `<section id="shareholding">` block.
 *
 * Screener renders two tables: quarterly + yearly. We prefer quarterly
 * (most recent) and fall back to yearly only if the quarterly block
 * is missing (occasional glitch on fresh IPOs).
 */
export function extractShareholding(html: string): ShareholdingQuarter[] {
  const shSection = html.match(/<section[^>]*id="shareholding"[\s\S]*?<\/section>/i)?.[0] || ''
  if (!shSection) return []

  const tableMatch = shSection.match(/<div[^>]+id="quarterly-shp"[\s\S]*?(<table[\s\S]*?<\/table>)/i)
    ?? shSection.match(/<div[^>]+id="yearly-shp"[\s\S]*?(<table[\s\S]*?<\/table>)/i)
    ?? shSection.match(/(<table[\s\S]*?<\/table>)/i)
  const tableHtml = tableMatch?.[1] || ''
  if (!tableHtml) return []

  const headerRow = tableHtml.match(/<thead[\s\S]*?<\/thead>/i)?.[0] || ''
  const headerCells = Array.from(headerRow.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi))
    .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim())
  const periods = headerCells[0] === '' ? headerCells.slice(1) : headerCells

  const body = tableHtml.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] || ''
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  const rows: Array<{ label: string; vals: (number | null)[] }> = []
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRe.exec(body)) !== null) {
    const cells = Array.from(rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi))
      .map((m) => decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim())
    if (cells.length < 2) continue
    // Row label strip: "Promoters + " → "Promoters". Screener wraps the
    // label in a <button> with a trailing "+" expand icon; after tag
    // stripping + entity decode the label reads "Promoters + " and
    // we chop the trailing "+" and any surrounding whitespace.
    const label = cells[0].replace(/\s*\+\s*$/, '').replace(/\s+/g, ' ').trim()
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

  const quarters: ShareholdingQuarter[] = periods.map((period, i) => ({
    period,
    promoterPct: promoters[i] ?? null,
    fiiPct: fiis[i] ?? null,
    diiPct: diis[i] ?? null,
    publicPct: publicR[i] ?? null,
    govtPct: govt[i] ?? null,
    pledgedPct: pledged[i] ?? null,
  }))

  while (quarters.length > 0) {
    const last = quarters[quarters.length - 1]
    const allNull =
      last.promoterPct == null && last.fiiPct == null
      && last.diiPct == null && last.publicPct == null
      && last.govtPct == null && last.pledgedPct == null
    if (allNull) quarters.pop()
    else break
  }

  return quarters
}

// ── Combined on-demand fetch ─────────────────────────────────────

/**
 * One-shot extractor: fetches the Screener HTML for a ticker and pulls
 * all three qualitative blocks at once. Used by the on-demand GET
 * `/api/data/company-qualitative/[ticker]` fallback when the DB row is
 * missing or stale.
 *
 * `nseCode` lets the caller pass the ticker's NSE symbol separately
 * from the display ticker when they diverge (rare, but e.g. some SMEs
 * on BSE carry a different code). When omitted we use `ticker` itself.
 *
 * Returns an empty bundle on any failure — callers should treat it as
 * "no free-source data available" and fall back to sector heuristics.
 */
export async function fetchQualitativeFromScreener(
  ticker: string,
  nseCode?: string | null
): Promise<QualitativeExtract> {
  const empty: QualitativeExtract = {
    ar: { url: null, year: null },
    creditRatings: [],
    shareholding: [],
  }
  const code = screenerCode(ticker, nseCode ?? null)
  if (!code) return empty

  try {
    const { html } = await fetchScreenerHtml(code)
    if (!html || html.length < 500) return empty
    return {
      ar: extractAnnualReport(html),
      creditRatings: extractCreditRatings(html),
      shareholding: extractShareholding(html),
    }
  } catch {
    return empty
  }
}
