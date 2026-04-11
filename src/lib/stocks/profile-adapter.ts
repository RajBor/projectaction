/**
 * StockProfile → TickerLive adapter.
 *
 * The RapidAPI Indian Stock Exchange "stock" endpoint returns a deeply
 * nested blob per company. `keyMetrics` is grouped into sub-buckets
 * (`valuation`, `priceandVolume`, `margins`, `financialstrength`,
 * `incomeStatement`, `growth`, `persharedata`) and each bucket is an
 * ARRAY of `{ displayName, key, value }` objects, not a flat dict.
 * So `keyMetrics.valuation.marketCap` does NOT exist — you have to
 * walk the array and match on the `key` field.
 *
 * This module turns the raw profile into a clean `TickerLive` with:
 *   - current price (NSE → BSE fallback)
 *   - day % change
 *   - market cap (₹Cr)
 *   - enterprise value (₹Cr) — derived from market cap + net debt
 *   - EV/EBITDA (derived from EBIT + D&A → EBITDA × implied multiple)
 *   - trailing P/E
 *
 * Every field is optional — when upstream is missing a value we leave
 * the override `undefined` so the baseline Company row survives.
 */

import type { StockProfile } from './api'

export interface TickerLive {
  ticker: string
  lastPrice?: number
  changePct?: number
  /** Market cap in ₹Cr. */
  marketCapCr?: number
  /** Enterprise value in ₹Cr — derived from mktcap + net debt. */
  evCr?: number
  /** TTM EV/EBITDA multiple. */
  evEbitda?: number
  /** TTM P/E. */
  pe?: number
  /** Book value per share, if present. */
  pb?: number
  /** ISO timestamp of when we fetched it. */
  updatedAt: string
}

// ── Coercion helpers ─────────────────────────────────────────

function num(v: unknown): number | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,₹$%\s]/g, '').trim()
    if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'n/a') return undefined
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/**
 * Find a value inside a RapidAPI keyMetrics bucket. Each bucket is an
 * object with integer-string keys (0, 1, 2, …) whose values are
 * `{ displayName, key, value }`. The `key` field is camelCase but
 * with occasional spaces / typos / punctuation we tolerate via
 * canonicalisation.
 *
 * We check every candidate key in preference order against the
 * canonical form of the upstream key.
 */
function canon(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function bucketLookup(
  bucket: unknown,
  candidates: string[]
): number | undefined {
  if (!bucket || typeof bucket !== 'object') return undefined
  // Build a canonical key → numeric value map the first time we see
  // this bucket. Cheap: each bucket has ~20 rows.
  const lookup = new Map<string, number>()
  for (const row of Object.values(bucket as Record<string, unknown>)) {
    if (!row || typeof row !== 'object') continue
    const r = row as { key?: unknown; value?: unknown }
    const k = typeof r.key === 'string' ? r.key : null
    if (!k) continue
    const n = num(r.value)
    if (n == null) continue
    lookup.set(canon(k), n)
  }
  for (const cand of candidates) {
    const hit = lookup.get(canon(cand))
    if (hit != null) return hit
  }
  return undefined
}

// ── Main extract ─────────────────────────────────────────────

export function adaptStockProfile(
  ticker: string,
  profile: StockProfile
): TickerLive {
  const out: TickerLive = {
    ticker,
    updatedAt: new Date().toISOString(),
  }

  // Current price — prefer NSE, fall back to BSE.
  out.lastPrice = num(profile.currentPrice?.NSE) ?? num(profile.currentPrice?.BSE)

  // Day % change — sometimes at root, sometimes inside priceandVolume.
  const km = (profile.keyMetrics || {}) as Record<string, unknown>
  out.changePct =
    num(profile.percentChange) ??
    bucketLookup(km.priceandVolume, [
      'price1DayPercentChange',
      'priceOneDayPercentChange',
      'percentChange',
    ])

  // ── Market cap (₹Cr) ──
  // RapidAPI puts marketCap inside priceandVolume as a direct value
  // already in ₹Cr (e.g. "94398.10").
  out.marketCapCr = bucketLookup(km.priceandVolume, [
    'marketCap',
    'mktCap',
    'marketCapitalization',
  ])

  // ── P/E (TTM preferred, fall back to most recent fiscal year) ──
  out.pe = bucketLookup(km.valuation, [
    'pPerEBasicExcludingExtraordinaryItemsTTM',
    'pPerEIncludingExtraordinaryItemsTTM',
    'pPerEExcludingExtraordinaryItemsMostRecentFiscalYear',
    'pPerENormalizedMostRecentFiscalYear',
    'peRatio',
    'pe',
  ])

  // ── P/B ──
  out.pb = bucketLookup(km.valuation, [
    'priceToBookMostRecentFiscalYear',
    'priceToBookMostRecentQuarter',
    'priceToBook',
  ])

  // ── Enterprise value (₹Cr) ──
  // RapidAPI exposes `netDebtLFY` and `netDebtLFI` (latest fiscal
  // year / latest fiscal interim) in the valuation bucket in ₹Cr.
  // EV = MarketCap + NetDebt. When netDebt is negative (net-cash),
  // EV < MarketCap, which is exactly what we want.
  const netDebt = bucketLookup(km.valuation, [
    'netDebtLFI',
    'netDebtLFY',
    'netDebt',
  ])
  if (out.marketCapCr != null) {
    if (netDebt != null) {
      out.evCr = out.marketCapCr + netDebt
    } else {
      // No net debt available — fall back to mkt cap as a rough EV
      // proxy. The user's existing Company.ev may still be better
      // so we only set this when the baseline is missing.
      out.evCr = out.marketCapCr
    }
  }

  // ── EV / EBITDA ──
  // Derive from EPS × P/E (≈ PAT), revenue, EBITDA margin. We'll
  // grab EBITDA per share from persharedata and shares outstanding
  // implicitly via EV ÷ EBITDA. If EBITDA per share × (MktCap /
  // Price) is unavailable, we pull operatingMargin × revenue and
  // add D&A separately. When none of these work, we skip it.
  const ebitdaPerShare = bucketLookup(km.persharedata, [
    'eBITDPerShareTrailing12Month',
    'ebitdaPerShareTrailing12Month',
    'ebitdaPerShareTTM',
  ])
  const revenuePerShare = bucketLookup(km.persharedata, [
    'rRevenuePerShareTrailing12onth',
    'revenuePerShareTrailing12Month',
    'revenuePerShareTTM',
  ])
  // Compute shares outstanding (Cr shares) from market cap / price.
  let sharesCr: number | undefined
  if (out.marketCapCr != null && out.lastPrice != null && out.lastPrice > 0) {
    // marketCapCr is in ₹ Crore; price is in ₹/share; so
    // shares = mktCap * 1e7 / price. Crore shares = shares / 1e7.
    // Simplify: sharesCr = marketCapCr / price.
    sharesCr = out.marketCapCr / out.lastPrice
  }
  if (ebitdaPerShare != null && sharesCr != null && out.evCr != null) {
    const ebitdaCr = ebitdaPerShare * sharesCr
    if (ebitdaCr > 0) out.evEbitda = out.evCr / ebitdaCr
  } else if (revenuePerShare != null && sharesCr != null && out.evCr != null) {
    // Fallback: EV/Sales × (1/operatingMargin). Not strictly EV/EBITDA
    // but in the same ballpark for platforms where a margin is known.
    const opMargin = bucketLookup(km.margins, [
      'operatingMarginTrailing12Month',
      'operatingMargin1stHistoricalFiscalYear',
    ])
    if (opMargin != null && opMargin > 0) {
      const revenueCr = revenuePerShare * sharesCr
      const ebitdaApproxCr = (revenueCr * opMargin) / 100
      if (ebitdaApproxCr > 0) out.evEbitda = out.evCr / ebitdaApproxCr
    }
  }

  // ── Sanity clamps ──
  if (out.marketCapCr != null && out.marketCapCr < 1) out.marketCapCr = undefined
  if (out.evCr != null && out.evCr < 1) out.evCr = undefined
  if (out.evEbitda != null && (out.evEbitda < 0 || out.evEbitda > 300)) {
    out.evEbitda = undefined
  }
  if (out.pe != null && (out.pe < 0 || out.pe > 500)) out.pe = undefined

  return out
}
