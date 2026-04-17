import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { COMPANIES } from '@/lib/data/companies'
import { loadCompanyPool } from '@/lib/live/company-pool'
import sql from '@/lib/db'
import {
  fetchScreenerHtmlWithFallback,
  parseTopRatios,
  parseProfitLoss,
  parseBalanceSheet,
  parseLastColumnHeader,
} from '@/lib/live/screener-fetch'

// Runtime knobs for Vercel. The NSE sweep runs ~1.7s per ticker × ~294
// tickers = ~8 minutes end-to-end, which overshoots any Hobby timeout
// and even Pro's default 60s. We pin `maxDuration = 300` (Pro cap) so
// Vercel doesn't nuke the function mid-sweep; on Hobby plans Vercel
// silently caps at 60s, so the admin UI still needs to chunk via
// `body.tickers` in batches of ~30 for production use. The chunk UI
// enforcement lives client-side; here we just refuse to be a short
// ceiling on top of a short ceiling.
// Also force `dynamic = 'force-dynamic'` so this route never gets
// inadvertently cached / prerendered during `next build` — the session
// check + outbound NSE calls must happen at request time, every time.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/scrape-exchange — "DealNector API"
 *
 * Admin-only. Fetches equity data DIRECTLY from the NSE India public
 * JSON API (nseindia.com/api/quote-equity) — zero dependency on
 * RapidAPI or Screener.in. Free, no API key required.
 *
 * For each company we get:
 *   - lastPrice, pChange (from priceInfo)
 *   - pdSymbolPe (trailing P/E from metadata)
 *   - issuedSize (total shares from securityInfo)
 *   - faceValue
 *   - weekHighLow
 *   - industry info
 *
 * And derive:
 *   - marketCapCr = lastPrice × issuedSize / 1e7
 *   - EV = marketCapCr × (baseline_ev / baseline_mktcap) — same unit-safe scaling
 *   - EV/EBITDA = EV / baseline_ebitda
 *
 * Body: { tickers?: string[] }
 * Returns: { ok, data: Record<ticker, ExchangeRow>, errors }
 *
 * Rate-limited to ~1 req/sec because NSE throttles aggressively.
 * A session cookie is needed for the NSE API; we fetch the homepage
 * first to get it.
 */

export interface ExchangeRow {
  ticker: string
  nse: string
  name: string
  /** Last traded price in ₹/share (NSE priceInfo.lastPrice). */
  lastPrice: number | null
  /**
   * Day % change vs previous close. Stored as a 0..100 percentage
   * (e.g. 2.5 means +2.5%), matching NSE's `priceInfo.pChange` which
   * is already a percentage. Do NOT multiply by 100 downstream.
   */
  changePct: number | null
  /**
   * Market cap in ₹Cr. Derived from lastPrice × issuedSize / 1e7.
   * NSE's `securityInfo.issuedSize` is in RAW shares (e.g. 9,500,000,000
   * for Reliance), not crore-shares. Dividing by 1e7 converts
   * ₹ total to ₹Cr. Rounded to whole ₹Cr for storage.
   */
  mktcapCr: number | null
  /** Trailing P/E from NSE `metadata.pdSymbolPe`. */
  pe: number | null
  /** Raw share count (NSE `securityInfo.issuedSize`). */
  sharesOutstanding: number | null
  faceValue: number | null
  weekHigh: number | null
  weekLow: number | null
  industry: string | null
  /** Derived from baseline scaling (unit-safe) */
  evCr: number | null
  evEbitda: number | null
  /**
   * Annual revenue (₹Cr) pulled from NSE's corporates-financial-results
   * filings endpoint (`re_total_income`, reported in ₹Lakh → /100 → ₹Cr).
   * Preference order across the filings list:
   *   Consolidated+Audited > Consolidated > Audited > most recent.
   * null when the company has no annual filing in NSE (e.g. fresh IPOs)
   * or when the JSON schema drifted and our defensive parser couldn't
   * locate a numeric value. The admin UI falls back to the Screener row
   * in that case (cross-source composition).
   */
  salesCr: number | null
  /**
   * Annual PAT (₹Cr) pulled from the same filing row — first non-null of
   * `re_proft_loss_for_period`, `re_profit_for_period`, `re_net_profit`,
   * `re_pro_loss_aft_tax_from_ord_act`. Same fallback story as salesCr.
   */
  patCr: number | null
  /**
   * Annual EBITDA (₹Cr). NSE filings don't expose EBITDA as a single line
   * item (it's non-GAAP), so we derive it via unit-safe baseline scaling:
   *   ebitdaCr = salesCr × (baseline_ebitda / baseline_rev)
   * This assumes the operating margin stays close to the curated baseline.
   * When the new sales number is live and the baseline margin is curated,
   * the derived EBITDA is directionally correct without pulling quarterly
   * P&L line items we'd have to sum ourselves.
   */
  ebitdaCr: number | null
  /** EBITDA margin % derived from salesCr/ebitdaCr above. null if either is null. */
  ebm: number | null
  /**
   * YoY revenue growth % derived from the two most recent annual filings.
   * (salesCr_new / salesCr_prev - 1) × 100, rounded to 1 dp. Null when
   * either filing is missing or prior-year revenue is ≤ 0.
   */
  revgPct: number | null
  /** Period label for the annual filing (e.g. "Annual FY25 (Consolidated-Audited)"). */
  financialPeriod: string | null
  /**
   * Period descriptor. NSE quote data is LIVE / spot — price is today's
   * last trade, PE is trailing, 52w high/low is the rolling window.
   * Surfaced for consistency with Screener's richer period labels.
   */
  period: string
  fetchedAt: string
  /**
   * `nse-direct`  → baseline came from NSE quote-equity + filings endpoints.
   * `screener-sme` → SME Emerge listing; NSE main-board endpoints were
   *                  bypassed and Screener served everything. This is NOT
   *                  a failure mode — SMEs simply don't exist on NSE's
   *                  mainboard API, so Screener is the correct primary.
   */
  source: 'nse-direct' | 'screener-sme'
}

// ── NSE symbol mapping ───────────────────────────────────────
// Canonical NSE_SYMBOL + nseSymbol now live in @/lib/live/nse-fetch.
// We import from there so both the hourly cron and this manual sweep
// share one source of truth — prevents the "map diverged" class of
// bug where an admin fixed one copy and the other kept the stale
// ticker. Re-exported below under the original names to keep the
// rest of this file compiling unchanged.
import { NSE_SYMBOL, nseSymbol, resolveNseSymbolByName } from '@/lib/live/nse-fetch'
void NSE_SYMBOL  // re-export silencer — imported for side effect of sharing the map

// ── NSE fetch with session ───────────────────────────────────

/** NSE requires a valid session cookie. We get it by hitting the
 *  homepage first and capturing the Set-Cookie header. */
let nseCookies = ''
let cookieExpiry = 0

async function ensureNseCookies(): Promise<void> {
  if (nseCookies && Date.now() < cookieExpiry) return
  try {
    const res = await fetch('https://www.nseindia.com/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
      redirect: 'manual',
    })
    const cookies = res.headers.getSetCookie?.() || []
    nseCookies = cookies.map((c) => c.split(';')[0]).join('; ')
    cookieExpiry = Date.now() + 4 * 60 * 1000 // 4-min TTL
  } catch {
    // fallback: try without cookies
    nseCookies = ''
  }
}

interface NseQuote {
  info?: {
    symbol?: string
    companyName?: string
  }
  metadata?: {
    pdSymbolPe?: number
  }
  securityInfo?: {
    issuedSize?: number
    faceValue?: number
  }
  priceInfo?: {
    lastPrice?: number
    pChange?: number
    weekHighLow?: {
      min?: number
      max?: number
    }
  }
  industryInfo?: {
    basicIndustry?: string
  }
}

async function fetchNseQuote(symbol: string): Promise<NseQuote | null> {
  await ensureNseCookies()
  const url = `https://www.nseindia.com/api/quote-equity?symbol=${encodeURIComponent(symbol)}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'application/json',
      ...(nseCookies ? { Cookie: nseCookies } : {}),
    },
  })
  if (!res.ok) return null
  return (await res.json()) as NseQuote
}

// ── NSE corporates-financial-results (annual P&L filings) ────
//
// Feeds the `salesCr` / `patCr` / `ebitdaCr` / `revgPct` / `ebm` fields on
// ExchangeRow. Hit separately from quote-equity because it sits behind a
// different NSE endpoint (`/api/corporates-financial-results`) with a
// different payload shape.
//
// Why we bother: NSE's quote-equity only exposes price / shares / P/E.
// Revenue and PAT are filed as part of quarterly / annual results XBRL,
// and this endpoint dumps those filings as JSON. EBITDA isn't a GAAP line
// item so NSE never reports it directly — we derive it downstream via
// unit-safe baseline-margin scaling.
//
// CAVEATS:
//   1. NSE rate-limits aggressively. We already sleep ~1.1s per ticker
//      between the two calls (quote + results) inside the main loop.
//   2. The JSON schema drifts occasionally — field names use snake_case
//      with typos that NSE carries forward (e.g. `re_proft_loss_for_period`
//      with "proft"). The parser tries multiple names defensively.
//   3. Values are in ₹Lakh; divide by 100 for ₹Cr.
//   4. `period=Annual` returns annual filings; some companies file only
//      Quarterly, so fresh listings may come back empty — the caller falls
//      back to Screener for those rows.

interface NseFilingRow {
  symbol?: string
  companyName?: string
  fromDate?: string        // dd-MMM-yyyy, period start
  toDate?: string          // dd-MMM-yyyy, period end
  relatingTo?: string      // "Annual" | "Quarterly" | etc.
  consolidated?: string    // "Consolidated" | "Standalone"
  audited?: string         // "Audited" | "Unaudited"
  cumulative?: string      // "Cumulative" | "Non-Cumulative"
  broadCastDate?: string   // dd-MMM-yyyy, when the filing was broadcast
  // Revenue-family fields (₹Lakh, stringified by NSE)
  re_total_income?: string
  re_trading_income?: string
  re_other_income?: string
  // PAT-family fields (₹Lakh, stringified by NSE)
  re_proft_loss_for_period?: string   // NSE's literal field name — yes, "proft"
  re_profit_for_period?: string
  re_net_profit?: string
  re_pro_loss_aft_tax_from_ord_act?: string
  [key: string]: unknown
}

async function fetchNseFinancialResults(symbol: string, period: 'Annual' | 'Quarterly' = 'Annual'): Promise<NseFilingRow[]> {
  await ensureNseCookies()
  const url = `https://www.nseindia.com/api/corporates-financial-results?index=equities&symbol=${encodeURIComponent(symbol)}&period=${period}`
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        ...(nseCookies ? { Cookie: nseCookies } : {}),
      },
    })
    if (!res.ok) return []
    const json = await res.json()
    // Response shape varies: sometimes bare array, sometimes { data: [] }.
    if (Array.isArray(json)) return json as NseFilingRow[]
    if (Array.isArray((json as { data?: unknown })?.data)) return (json as { data: NseFilingRow[] }).data
    return []
  } catch {
    return []
  }
}

/** Parse NSE's "01-Apr-2025" filing dates to epoch-ms so rows can be sorted. */
function parseDdMmmYyyy(s: string | null | undefined): number {
  if (!s) return 0
  const parts = s.split('-')
  if (parts.length !== 3) return 0
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  }
  const d = parseInt(parts[0], 10)
  const m = months[parts[1].slice(0, 3).toLowerCase()]
  const y = parseInt(parts[2], 10)
  if (!Number.isFinite(d) || m == null || !Number.isFinite(y)) return 0
  return new Date(y, m, d).getTime()
}

/** NSE-string-to-number, tolerant of commas, "-", "NA", and nulls. */
function parseNseNum(v: unknown): number | null {
  if (v == null) return null
  const s = String(v).replace(/,/g, '').trim()
  if (!s || s === '-' || s.toUpperCase() === 'NA' || s.toUpperCase() === 'N.A.') return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Pick the most recent annual filing, preferring Consolidated+Audited.
 * Returns both the chosen filing AND the next-most-recent one BEFORE it
 * (same consolidated/audited flavour when possible) so we can derive YoY
 * revenue growth without an extra roundtrip.
 */
function pickAnnualFilings(rows: NseFilingRow[]): { current: NseFilingRow | null; prev: NseFilingRow | null } {
  if (!rows || rows.length === 0) return { current: null, prev: null }
  const scored = rows.map((r) => {
    const cons = r.consolidated?.toLowerCase() || ''
    const aud = r.audited?.toLowerCase() || ''
    const isConsolidated = cons.includes('consolidated') ? 1 : 0
    const isAudited = aud.includes('audited') && !aud.includes('unaudited') ? 1 : 0
    // Broadcast date wins; fall back to period end.
    const dateMs = parseDdMmmYyyy(r.broadCastDate) || parseDdMmmYyyy(r.toDate)
    return { row: r, consolidated: isConsolidated, audited: isAudited, dateMs }
  })
  // Sort: most-recent-date first, then consolidated, then audited.
  scored.sort((a, b) => {
    if (b.dateMs !== a.dateMs) return b.dateMs - a.dateMs
    if (b.consolidated !== a.consolidated) return b.consolidated - a.consolidated
    return b.audited - a.audited
  })
  const current = scored[0]?.row || null
  if (!current) return { current: null, prev: null }

  // For prev: prefer the same flavour (consolidated+audited) from an
  // earlier period. Match by consolidated flag first, then date desc.
  const targetCons = current.consolidated?.toLowerCase().includes('consolidated') ? 1 : 0
  const currentMs = parseDdMmmYyyy(current.broadCastDate) || parseDdMmmYyyy(current.toDate)
  const prevCandidates = scored
    .filter((s) => s.dateMs < currentMs - 300 * 24 * 3600 * 1000)  // ≥300 days older = prior FY
    .sort((a, b) => {
      const aMatch = a.consolidated === targetCons ? 1 : 0
      const bMatch = b.consolidated === targetCons ? 1 : 0
      if (bMatch !== aMatch) return bMatch - aMatch
      return b.dateMs - a.dateMs
    })
  return { current, prev: prevCandidates[0]?.row || null }
}

/** Pull revenue + PAT from a single filing row (₹Lakh → ₹Cr). */
function extractFilingFinancials(row: NseFilingRow | null): { revCr: number | null; patCr: number | null } {
  if (!row) return { revCr: null, patCr: null }
  // Revenue: total_income is the standard XBRL line (operating + other).
  // If missing, fall back to trading_income alone (raw revenue from ops).
  const revLakh = parseNseNum(row.re_total_income) ?? parseNseNum(row.re_trading_income)
  // PAT: NSE oscillates between a few field names. Try in order.
  const patLakh = parseNseNum(row.re_proft_loss_for_period)
    ?? parseNseNum(row.re_profit_for_period)
    ?? parseNseNum(row.re_net_profit)
    ?? parseNseNum(row.re_pro_loss_aft_tax_from_ord_act)
  return {
    revCr: revLakh != null ? Math.round(revLakh / 100) : null,
    patCr: patLakh != null ? Math.round(patLakh / 100) : null,
  }
}

// ── Route handler ────────────────────────────────────────────

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
      requestedTickers = body.tickers
    }
  } catch {
    // empty = all
  }

  // Build the candidate pool from ALL THREE sources (static seed +
  // user_companies + industry_chain_companies atlas rows) via the
  // shared helper. This is what pushes the sweep size from ~114 to
  // the full ~294 tickers — atlas-seeded SME / subsidiary rows were
  // invisible to NSE refreshes before this helper existed.
  // Precedence: DB > static > atlas (curated data wins). See
  // `@/lib/live/company-pool` for the full rationale.
  type CoSlim = {
    ticker: string; nse: string | null; name: string; sec: string | null;
    mktcap: number; rev: number; ev: number; ebitda: number;
    /** Propagated from the atlas `status` column — drives SME routing. */
    listingType: 'MAIN' | 'SME' | 'SUBSIDIARY' | 'UNKNOWN'
  }
  const pool = new Map<string, CoSlim>()
  try {
    const universe = await loadCompanyPool()
    for (const entry of Array.from(universe.values())) {
      pool.set(entry.ticker, {
        ticker: entry.ticker,
        // Atlas rows use the ticker as their NSE symbol by convention.
        // Static rows without `nse` (non-listed entries in the seed)
        // only enter the sweep if explicitly requested by the caller.
        nse: entry.nse || (entry.source === 'atlas' ? entry.ticker : null),
        name: entry.name,
        sec: entry.sec,
        listingType: entry.listingType,
        mktcap: entry.mktcap,
        rev: entry.rev,
        ev: entry.ev,
        ebitda: entry.ebitda,
      })
    }
  } catch (err) {
    console.warn('[scrape-exchange] company pool load failed, falling back to static seed:', err instanceof Error ? err.message : err)
    // Fallback: if the pool helper blows up (e.g. DB unreachable during
    // dev), at least still refresh the static seed. Losing atlas/DB rows
    // is less bad than returning a 500 to the admin.
    for (const c of COMPANIES) {
      if (c.nse || requestedTickers?.includes(c.ticker)) {
        pool.set(c.ticker, {
          ticker: c.ticker,
          nse: c.nse || null,
          name: c.name,
          sec: c.sec || null,
          listingType: 'MAIN',
          mktcap: c.mktcap,
          rev: c.rev,
          ev: c.ev,
          ebitda: c.ebitda,
        })
      }
    }
  }

  const targets: CoSlim[] = requestedTickers
    ? Array.from(pool.values()).filter((c) => requestedTickers!.includes(c.ticker))
    : Array.from(pool.values()).filter((c) => c.nse)

  const data: Record<string, ExchangeRow> = {}
  const errors: string[] = []

  // ── Sector-median EBITDA margin fallback ────────────────────────
  // When a ticker comes through the atlas pool with no baseline P&L
  // (co.rev === 0 && co.ebitda === 0) AND NSE returns a salesCr but no
  // way to derive EBITDA, we used to emit `ebitdaCr = null`, which is
  // precisely the "blank in DealNector column" behaviour the user flagged.
  // These medians are conservative mid-range estimates sourced from the
  // hand-curated COMPANIES[] seed (2024 data). They're deliberately
  // directional — the goal is "non-blank with a reasonable estimate"
  // not "precise to the percentage point". Admin can always push
  // Screener on top afterwards for a more accurate number.
  const SECTOR_MARGIN_MEDIAN: Record<string, number> = {
    solar: 0.12,   // module / EPC / cell blended
    td: 0.15,      // T&D infrastructure (cables, switchgear, transformers)
    wind: 0.10,
    wind_energy: 0.10,
    storage: 0.11,
    commodities: 0.18,
  }
  const DEFAULT_MARGIN = 0.12

  for (let i = 0; i < targets.length; i++) {
    const co = targets[i]
    const symbol = nseSymbol(co.ticker, co.nse)
    try {
      // ── SME short-circuit ──
      // NSE's main quote-equity + corporates-financial-results endpoints
      // return empty / 404 for SME Emerge / BSE SME listings ~90% of the
      // time. A minute of NSE rate-limited failures per SME ticker was
      // the root of "DealNector API is blank for SME" complaints.
      //
      // When the pool marks the ticker as SME, we skip the NSE chain
      // entirely and go straight to Screener. That cuts per-ticker
      // latency by ~1.7s → ~600ms and actually produces data. The NSE
      // tier stays for MAIN and UNKNOWN classifications.
      const isSme = co.listingType === 'SME'
      let quote = isSme ? null : await fetchNseQuote(symbol)
      let resolvedSymbol = symbol

      // ── NSE symbol auto-resolution ──
      //
      // When the primary NSE fetch returns null for a main-board ticker
      // the cause is usually one of two rename events:
      //   a) The company rebranded and NSE reassigned the symbol (GE
      //      Vernova went GEVERNOVA → GVT&D; Sterling Wilson went
      //      SWSOLAR → STERLINWIL; Websol went WESOLENRGY → WEBELSOLAR).
      //   b) Our internal ticker simply differs from the NSE one and
      //      the NSE_SYMBOL map is missing the entry.
      //
      // Instead of giving up, we query NSE's OWN autocomplete by
      // company NAME and retry with whatever current symbol NSE
      // returns. This is self-healing — as soon as NSE knows a
      // company by a different symbol, our sweep finds it without
      // needing a human to update the NSE_SYMBOL map.
      //
      // Costs one extra ~500ms HTTP call per failed ticker, only on
      // the sad path. Happy path (symbol works first try) is
      // unchanged.
      if (!isSme && !quote && co.name) {
        const hit = await resolveNseSymbolByName(co.name).catch(() => null)
        if (hit && hit.symbol && hit.symbol !== symbol) {
          const retry = await fetchNseQuote(hit.symbol).catch(() => null)
          if (retry) {
            quote = retry
            resolvedSymbol = hit.symbol
            // Persist the correction to user_companies.nse so the next
            // sweep uses the right symbol without re-resolving. The
            // admin keeps full control — they can still override via
            // the "Edit NSE Symbol" UI if NSE's autocomplete picked
            // a less-preferred alias.
            try {
              await sql`
                INSERT INTO user_companies (ticker, nse, name, sec)
                VALUES (${co.ticker}, ${hit.symbol}, ${co.name}, ${co.sec || 'unknown'})
                ON CONFLICT (ticker) DO UPDATE SET
                  nse = EXCLUDED.nse,
                  updated_at = NOW()
              `
              console.log(
                `[scrape-exchange] ${co.ticker} auto-resolved NSE symbol ${symbol} → ${hit.symbol} (${hit.symbolInfo})`
              )
            } catch (err) {
              // Non-fatal — the correction is still applied in-memory
              // for this sweep; next sweep will re-resolve if needed.
              console.warn(
                `[scrape-exchange] ${co.ticker} failed to persist NSE symbol correction:`,
                err instanceof Error ? err.message : err
              )
            }
          }
        }
      }

      // Declare the mutable field set up-front so the Screener fallback
      // can cross-fill into the same locals regardless of which NSE call
      // returned null. Previously we bailed early on "no NSE data" and
      // never even tried Screener — which is exactly the blank-row case
      // the user flagged. Now NSE failure demotes to a Screener attempt.
      let lastPrice: number | null = quote?.priceInfo?.lastPrice ?? null
      const pChangeRaw = quote?.priceInfo?.pChange
      const changePct = typeof pChangeRaw === 'number' && Number.isFinite(pChangeRaw)
        ? pChangeRaw
        : null
      // issuedSize is raw shares (not crore-shares). Sanity-check that
      // it's in a plausible range for an Indian listed equity
      // (1M–100B shares) before using it — if NSE ever flips to
      // reporting in "Cr shares" we'd get market caps 1e7× too small
      // and silently publish garbage. We flag rather than crash.
      const sharesRaw = quote?.securityInfo?.issuedSize
      const shares = typeof sharesRaw === 'number' && Number.isFinite(sharesRaw) && sharesRaw > 1e6 && sharesRaw < 1e12
        ? sharesRaw
        : null
      let mktcapCr: number | null = lastPrice && shares
        ? Math.round((lastPrice * shares) / 1e7)
        : null
      let pe: number | null = quote?.metadata?.pdSymbolPe ?? null
      const weekHigh: number | null = quote?.priceInfo?.weekHighLow?.max ?? null
      const weekLow: number | null = quote?.priceInfo?.weekHighLow?.min ?? null

      // ── Revenue / EBITDA / PAT: Screener (canonical) ──
      //
      // NSE's `corporates-financial-results` API used to return flat P&L
      // fields inline (`re_total_income`, `re_net_profit`, etc.) — since
      // mid-2025 NSE moved the actual numbers into per-filing XBRL XML
      // and the JSON payload now carries only filing metadata. That
      // silently broke our salesCr / patCr extraction: every NSE row
      // had null for Revenue and null for EBITDA even when the ticker
      // had audited annuals. Rather than parsing fragile per-ticker
      // XBRL XML (each filing uses a different ns prefix depending on
      // the filer's Ind-AS taxonomy version), we switched P&L to
      // Screener — which pulls directly from BSE/NSE filings via its
      // own scraped pipeline, consistently exposes salesCr / netProfit
      // / opm / salesPrev in a parseable HTML table, and covers the
      // same universe.
      //
      // NSE quote-equity (price / mktcap / PE / 52-week) still comes
      // from NSE because those fields ARE live and correct.
      let financialPeriod: string | null = null
      let salesCr: number | null = null
      let patCr: number | null = null
      let prevSalesCr: number | null = null
      let screenerEbitdaCr: number | null = null
      let screenerDebtCr: number | null = null
      let usedScreenerFallback = false

      try {
        // No pacing sleep needed — NSE and Screener are different
        // hosts; the natural per-request latency (~800ms NSE + ~800ms
        // Screener = 1.6s between Screener fetches on adjacent tickers)
        // already keeps us under Screener's ~1.5 req/sec soft limit
        // even at chunk scale.
        // Use the fallback-enabled fetcher. If the hand-curated mapping
        // in SCREENER_CODE has gone stale (e.g. WEBELSOLAR's old
        // WESOLENRGY URL now 404s), this transparently retries with
        // the NSE symbol and then the bare ticker until a real company
        // page responds.
        const { html } = await fetchScreenerHtmlWithFallback(co.ticker, co.nse)
        if (html) {
          const tr = parseTopRatios(html)
          const pl = parseProfitLoss(html)
          const plPeriod = parseLastColumnHeader(html, 'profit-loss')

          // NSE remains authoritative for price / mktcap / PE because
          // those are LIVE spot values. Screener cross-fills only when
          // NSE returned null (e.g. SME, freshly-listed, weekend fetch).
          if (mktcapCr == null && tr.mktcap != null) mktcapCr = Math.round(tr.mktcap)
          if (pe == null && tr.pe != null) pe = tr.pe
          if (lastPrice == null && tr.price != null) lastPrice = tr.price
          // Capture Screener's reported Debt so downstream can derive a
          // REAL enterprise value. Previously we relied on the baseline
          // EV/MktCap ratio which for atlas-only tickers defaults to 1.0
          // — that made EV come out equal to MktCap for every newly-
          // added company, exactly the complaint we just got.
          //
          // Two-source strategy because Screener dropped the "Debt" row
          // from top-ratios around mid-2025:
          //   1. tr.debt       — top-ratios (only works on legacy pages
          //                       still carrying the row)
          //   2. bs.borrowings — balance-sheet table (authoritative,
          //                       present on every real company page)
          if (tr.debt != null && Number.isFinite(tr.debt) && tr.debt >= 0) {
            screenerDebtCr = Math.round(tr.debt)
          }
          if (screenerDebtCr == null) {
            const bs = parseBalanceSheet(html)
            if (bs.borrowingsCr != null && Number.isFinite(bs.borrowingsCr) && bs.borrowingsCr >= 0) {
              screenerDebtCr = Math.round(bs.borrowingsCr)
            }
          }

          // P&L: Screener is primary. If for any reason Screener doesn't
          // return a sales figure (fresh IPO + no quarter filed yet) we
          // leave the field null and let the EBITDA cascade degrade
          // gracefully downstream.
          if (pl.sales != null) salesCr = Math.round(pl.sales)
          if (pl.netProfit != null) patCr = Math.round(pl.netProfit)
          if (pl.salesPrev != null && pl.salesPrev > 0) {
            prevSalesCr = Math.round(pl.salesPrev)
          }
          // Screener exposes OPM % — convert to ₹Cr EBITDA.
          if (pl.opm != null && pl.opm > 0 && salesCr != null && salesCr > 0) {
            screenerEbitdaCr = Math.round((salesCr * pl.opm) / 100)
          }
          if (plPeriod) {
            financialPeriod = `${plPeriod} (Screener P&L)`
          }
          usedScreenerFallback = true
        }
      } catch (err) {
        // Screener fetch is best-effort — if it fails we emit whatever
        // NSE quote-equity produced (price/mktcap/PE) and let the
        // downstream cascade fall back to baseline margin × something.
        console.warn(
          `[scrape-exchange] ${co.ticker} Screener P&L fetch failed:`,
          err instanceof Error ? err.message : err
        )
      }

      const revgPct: number | null =
        salesCr != null && prevSalesCr != null && prevSalesCr > 0
          ? Math.round(((salesCr / prevSalesCr - 1) * 100) * 10) / 10
          : null

      // After both tiers: if the ticker is STILL totally empty, we genuinely
      // have no data to publish. Record an error and skip it rather than
      // emitting a row of nulls that would clutter the admin table.
      if (lastPrice == null && mktcapCr == null && salesCr == null) {
        errors.push(`${co.ticker} (${symbol}): NSE + Screener both empty`)
        continue
      }

      // ── EBITDA derivation with a 3-tier cascade ───────────────────
      //   1. baseline margin (co.ebitda / co.rev)  — curated P&L, most accurate
      //   2. Screener OPM-derived EBITDA            — live but lightly noisy
      //   3. sector-median margin                   — "non-blank guess"
      //
      // Before the cascade: atlas rows with baseline rev=0 fell through to
      // null, which is the blank the user flagged. After: every atlas row
      // whose NSE or Screener salesCr is populated produces a directionally
      // correct EBITDA estimate.
      const baselineMargin = co.rev > 0 ? co.ebitda / co.rev : null
      const sec = (co.sec || '').toLowerCase().trim()
      const sectorMargin = SECTOR_MARGIN_MEDIAN[sec] ?? DEFAULT_MARGIN
      let ebitdaCr: number | null = null
      if (salesCr != null && baselineMargin != null && baselineMargin > 0) {
        ebitdaCr = Math.round(salesCr * baselineMargin)
      } else if (screenerEbitdaCr != null) {
        ebitdaCr = screenerEbitdaCr
      } else if (salesCr != null && salesCr > 0) {
        ebitdaCr = Math.round(salesCr * sectorMargin)
      }

      const ebm = ebitdaCr != null && salesCr != null && salesCr > 0
        ? Math.round((ebitdaCr / salesCr) * 1000) / 10
        : null

      // ── Enterprise Value derivation (3-tier cascade) ──
      //
      // Previously EV was derived purely as mktcap × (baseline_ev /
      // baseline_mktcap). For atlas-only tickers (no static COMPANIES
      // row), co.mktcap is 0 which forced the ratio to default 1.0 —
      // so every freshly-scraped atlas row came back with EV exactly
      // equal to MktCap, regardless of the company's actual debt
      // position. That's the bug you flagged.
      //
      // New cascade (first that produces a realistic number wins):
      //   1. mktcap + Screener-reported Debt — EV = MktCap + Debt
      //      (canonical accounting definition; Screener's top-ratios
      //      block exposes "Debt" as a single line item we already
      //      parse into `tr.debt`). Net-cash companies are handled
      //      because Screener still reports them as small-positive
      //      debt, not negative.
      //   2. mktcap × baseline_ev_ratio — only when the baseline ratio
      //      is MEANINGFULLY > 1.0 (at least 1.02, i.e. at least 2%
      //      of market cap is debt). This preserves the old behaviour
      //      for established COMPANIES[] rows where the ratio is real
      //      and curated.
      //   3. mktcap alone — last resort. Flagged with "zero-debt
      //      assumption" in the period label for audit visibility.
      let evCr: number | null = null
      if (mktcapCr != null) {
        if (screenerDebtCr != null && screenerDebtCr >= 0) {
          evCr = mktcapCr + screenerDebtCr
        } else if (co.mktcap > 0 && co.ev > 0 && co.ev / co.mktcap > 1.02) {
          evCr = Math.round(mktcapCr * (co.ev / co.mktcap))
        } else {
          // Zero-debt fallback. EV == MktCap is correct for genuinely
          // debt-free companies (many SMEs, cash-rich IT firms). Still
          // emit the number so the table doesn't blank out — the admin
          // can sanity-check against the company's actual balance sheet.
          evCr = mktcapCr
        }
      }
      const evEbitda = evCr != null && ebitdaCr != null && ebitdaCr > 0
        ? Math.round((evCr / ebitdaCr) * 10) / 10
        : evCr != null && co.ebitda > 0
          ? Math.round((evCr / co.ebitda) * 10) / 10
          : null

      data[co.ticker] = {
        ticker: co.ticker,
        // Emit the resolved symbol so the admin UI reflects the
        // auto-correction (if any). For the common case where the
        // initial symbol worked, resolvedSymbol === symbol.
        nse: resolvedSymbol,
        name: quote?.info?.companyName ?? co.name,
        lastPrice,
        changePct,
        mktcapCr,
        pe: pe != null ? Math.round(pe * 10) / 10 : null,
        sharesOutstanding: shares,
        faceValue: quote?.securityInfo?.faceValue ?? null,
        weekHigh,
        weekLow,
        industry: quote?.industryInfo?.basicIndustry ?? null,
        evCr,
        evEbitda,
        salesCr,
        patCr,
        ebitdaCr,
        ebm,
        revgPct,
        financialPeriod,
        period: isSme
          ? 'SME listing · Screener-only (NSE main-board endpoints skipped)'
          : usedScreenerFallback
            ? 'Live spot (price) · trailing 12m (P/E) · 52w (H/L) · Annual filing (Rev/PAT) · Screener-filled gaps'
            : 'Live spot (price) · trailing 12m (P/E) · 52w (H/L) · Annual filing (Rev/PAT)',
        fetchedAt: new Date().toISOString(),
        source: isSme ? 'screener-sme' : 'nse-direct',
      }
    } catch (err) {
      errors.push(
        `${co.ticker}: ${err instanceof Error ? err.message : 'fetch failed'}`
      )
    }
    // Inter-ticker sleep removed. It existed when we called NSE's
    // corporates-financial-results endpoint back-to-back (NSE throttles
    // ~1 req/sec on that one), but we dropped that endpoint entirely
    // when NSE restructured it mid-2025 and moved P&L fields into XBRL
    // files we no longer parse. The remaining NSE call (quote-equity)
    // has natural ~1s latency per request; back-to-back calls stay
    // well under NSE's threshold. Removing the 1100ms sleep halves
    // per-ticker cost from ~3.3s → ~1.7s, which is what lets a batch
    // of 15-25 fit inside Vercel's 60s gateway ceiling instead of
    // triggering FUNCTION_INVOCATION_TIMEOUT.
  }

  return NextResponse.json({
    ok: true,
    data,
    count: Object.keys(data).length,
    total: targets.length,
    errors: errors.length > 0 ? errors : undefined,
  })
}
