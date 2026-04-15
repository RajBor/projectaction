import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { COMPANIES } from '@/lib/data/companies'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

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
  source: 'nse-direct'
}

// ── NSE symbol mapping ───────────────────────────────────────

// Hardcoded repo-level NSE-symbol corrections. Per-instance admin edits
// live in user_companies.nse and are merged into the caller's Company
// object before this helper runs, so the explicit `nse` arg wins.
const NSE_SYMBOL: Record<string, string> = {
  WAAREEENS: 'WAAREEENER',
  PREMIENRG: 'PREMIERENE',
  // BORORENEW → kept unmapped; BFRENEWABL alias was a renamed/delisted
  // ticker that no longer responds. See lib/live/nse-fetch.ts.
  WEBELSOLAR: 'WESOLENRGY',
  STERLINWIL: 'SWSOLAR',
  HITACHIEN: 'POWERINDIA',
  GENUSPAPER: 'GENUSPOWER',
  GETANDEL: 'GEVERNOVA',
  STRTECH: 'STLTECH',
  HPL: 'HPLELECTRIC',
}

function nseSymbol(ticker: string, nse: string | null): string {
  // Admin-edited DB value wins over the static correction map so
  // mid-flight fixes take effect on the next refresh tick with no
  // redeploy. See @/lib/live/nse-fetch for the canonical version.
  const trimmed = typeof nse === 'string' ? nse.trim().toUpperCase() : ''
  if (trimmed && trimmed !== ticker) return trimmed
  return NSE_SYMBOL[ticker] ?? (trimmed || ticker)
}

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

  // Build the candidate pool from BOTH the hardcoded COMPANIES seed AND
  // the admin-added rows in user_companies. Previously we filtered only
  // the static array, which meant SME / discovery / atlas-added tickers
  // could never be refreshed from NSE — they'd sit with stale baseline
  // numbers forever. Now every company known to the platform (main +
  // SME + atlas additions) is eligible, keyed by ticker for dedupe.
  // `rev` is carried alongside `ebitda` so we can derive the baseline
  // EBITDA margin (ebitda/rev) and apply it to the live NSE revenue figure.
  // Without baseline rev we can't unit-safely scale EBITDA on top of the
  // NSE financial-results feed.
  type CoSlim = { ticker: string; nse: string | null; name: string; mktcap: number; rev: number; ev: number; ebitda: number }
  const pool = new Map<string, CoSlim>()
  for (const c of COMPANIES) {
    if (c.nse || requestedTickers?.includes(c.ticker)) {
      pool.set(c.ticker, {
        ticker: c.ticker,
        nse: c.nse || null,
        name: c.name,
        mktcap: c.mktcap,
        rev: c.rev,
        ev: c.ev,
        ebitda: c.ebitda,
      })
    }
  }
  try {
    await ensureSchema()
    const dbRows = await sql`
      SELECT ticker, nse, name, mktcap, rev, ev, ebitda FROM user_companies
    `
    for (const r of dbRows as Array<{ ticker: string; nse: string | null; name: string; mktcap: unknown; rev: unknown; ev: unknown; ebitda: unknown }>) {
      // DB row wins over static seed so admin-overridden names/tickers
      // surface. NSE symbol falls back to the ticker when the column is
      // empty — NSE SME listings use their ticker as the live symbol.
      pool.set(r.ticker, {
        ticker: r.ticker,
        nse: r.nse || r.ticker,
        name: r.name,
        mktcap: Number(r.mktcap) || 0,
        rev: Number(r.rev) || 0,
        ev: Number(r.ev) || 0,
        ebitda: Number(r.ebitda) || 0,
      })
    }
  } catch (err) {
    console.warn('[scrape-exchange] user_companies read skipped:', err instanceof Error ? err.message : err)
  }

  const targets: CoSlim[] = requestedTickers
    ? Array.from(pool.values()).filter((c) => requestedTickers!.includes(c.ticker))
    : Array.from(pool.values()).filter((c) => c.nse)

  const data: Record<string, ExchangeRow> = {}
  const errors: string[] = []

  for (let i = 0; i < targets.length; i++) {
    const co = targets[i]
    const symbol = nseSymbol(co.ticker, co.nse)
    try {
      const quote = await fetchNseQuote(symbol)
      if (!quote || !quote.priceInfo?.lastPrice) {
        errors.push(`${co.ticker} (${symbol}): no data`)
        continue
      }

      const lastPrice = quote.priceInfo.lastPrice
      // pChange is NSE's daily % change (e.g. 2.5 means +2.5%). Passed
      // through verbatim — no scaling. Guard against string form in
      // case the API schema drifts.
      const pChangeRaw = quote.priceInfo.pChange
      const changePct = typeof pChangeRaw === 'number' && Number.isFinite(pChangeRaw)
        ? pChangeRaw
        : null
      // issuedSize is raw shares (not crore-shares). Sanity-check that
      // it's in a plausible range for an Indian listed equity
      // (1M–100B shares) before using it — if NSE ever flips to
      // reporting in "Cr shares" we'd get market caps 1e7× too small
      // and silently publish garbage. We flag rather than crash.
      const sharesRaw = quote.securityInfo?.issuedSize
      const shares = typeof sharesRaw === 'number' && Number.isFinite(sharesRaw) && sharesRaw > 1e6 && sharesRaw < 1e12
        ? sharesRaw
        : null
      const mktcapCr = lastPrice && shares
        ? Math.round((lastPrice * shares) / 1e7)
        : null
      const pe = quote.metadata?.pdSymbolPe ?? null

      // ── Second NSE call: annual P&L filings for rev + PAT ──
      // quote-equity has no revenue/EBITDA fields so we hit the
      // corporates-financial-results endpoint separately. Sleep 600ms
      // first to stay inside NSE's rate limit (total ~1.7s per ticker,
      // i.e. ~2.5 min for the full 85-company sweep).
      await new Promise((r) => setTimeout(r, 600))
      const filings = await fetchNseFinancialResults(symbol, 'Annual')
      const { current, prev } = pickAnnualFilings(filings)
      const { revCr: salesCrRaw, patCr: patCrRaw } = extractFilingFinancials(current)
      const { revCr: prevSalesCr } = extractFilingFinancials(prev)
      const salesCr = salesCrRaw
      const patCr = patCrRaw

      // Derive EBITDA via unit-safe baseline-margin scaling. NSE filings
      // don't report EBITDA directly (non-GAAP). As long as the baseline
      // ebitda/rev ratio is close to the real margin, this tracks the
      // live revenue accurately. Falls back to null when baseline rev
      // is zero (unseeded ticker) or live salesCr missing.
      const baselineMargin = co.rev > 0 ? co.ebitda / co.rev : null
      const ebitdaCr = salesCr != null && baselineMargin != null
        ? Math.round(salesCr * baselineMargin)
        : null

      const ebm = ebitdaCr != null && salesCr != null && salesCr > 0
        ? Math.round((ebitdaCr / salesCr) * 1000) / 10
        : null

      const revgPct = salesCr != null && prevSalesCr != null && prevSalesCr > 0
        ? Math.round(((salesCr / prevSalesCr - 1) * 100) * 10) / 10
        : null

      // Prefer live-derived EV/EBITDA (uses the fresh EBITDA from NSE
      // revenue × baseline margin) over the old baseline-only calc.
      // Unit-safe EV derivation from baseline mktcap/ev ratio remains.
      const evRatio = co.mktcap > 0 ? co.ev / co.mktcap : 1
      const evCr = mktcapCr != null ? Math.round(mktcapCr * evRatio) : null
      const evEbitda = evCr != null && ebitdaCr != null && ebitdaCr > 0
        ? Math.round((evCr / ebitdaCr) * 10) / 10
        : evCr != null && co.ebitda > 0
          ? Math.round((evCr / co.ebitda) * 10) / 10
          : null

      // Build a friendly period label from the chosen filing.
      const financialPeriod = current
        ? `${current.relatingTo || 'Annual'} ${current.fromDate || ''}–${current.toDate || ''} (${current.consolidated || ''}${current.audited ? ' · ' + current.audited : ''})`.trim()
        : null

      data[co.ticker] = {
        ticker: co.ticker,
        nse: symbol,
        name: quote.info?.companyName ?? co.name,
        lastPrice,
        changePct,
        mktcapCr,
        pe: pe != null ? Math.round(pe * 10) / 10 : null,
        sharesOutstanding: shares,
        faceValue: quote.securityInfo?.faceValue ?? null,
        weekHigh: quote.priceInfo?.weekHighLow?.max ?? null,
        weekLow: quote.priceInfo?.weekHighLow?.min ?? null,
        industry: quote.industryInfo?.basicIndustry ?? null,
        evCr,
        evEbitda,
        salesCr,
        patCr,
        ebitdaCr,
        ebm,
        revgPct,
        financialPeriod,
        period: 'Live spot (price) · trailing 12m (P/E) · 52w (H/L) · Annual filing (Rev/PAT)',
        fetchedAt: new Date().toISOString(),
        source: 'nse-direct',
      }
    } catch (err) {
      errors.push(
        `${co.ticker}: ${err instanceof Error ? err.message : 'fetch failed'}`
      )
    }
    // NSE rate limit: ~1 req/sec between tickers (on top of the 600ms
    // mid-ticker pause). Total per-ticker cost: ~1.7s, ~2.5min for 85.
    if (i < targets.length - 1) {
      await new Promise((r) => setTimeout(r, 1100))
    }
  }

  return NextResponse.json({
    ok: true,
    data,
    count: Object.keys(data).length,
    total: targets.length,
    errors: errors.length > 0 ? errors : undefined,
  })
}
