/**
 * StockProfile → TickerLive adapter.
 *
 * The RapidAPI Indian Stock Exchange "stock" endpoint returns a deeply
 * nested, inconsistently-keyed blob per company (see `StockProfile` in
 * `./api.ts`). This module's job is to extract the five fields we
 * actually care about for the LiveSnapshotProvider:
 *
 *   - current price (₹/share)
 *   - day % change
 *   - market cap (₹Cr)
 *   - EV/EBITDA multiple
 *   - trailing P/E
 *
 * Every upstream key we look at is optional and every value may come
 * through as a string, number, or nested object. The adapter is
 * deliberately defensive: it returns `undefined` for any field it
 * can't confidently extract, and always returns a best-effort
 * `updatedAt` timestamp so the UI knows it's fresh.
 */

import type { StockProfile } from './api'

export interface TickerLive {
  ticker: string
  lastPrice?: number
  changePct?: number
  /** Market cap in ₹Cr (not absolute ₹). */
  marketCapCr?: number
  /** EV in ₹Cr — derived when upstream gives us the components. */
  evCr?: number
  /** TTM EV/EBITDA multiple. */
  evEbitda?: number
  /** TTM P/E. */
  pe?: number
  /** ISO timestamp of when we fetched it. */
  updatedAt: string
}

// ── Coercion helpers ─────────────────────────────────────────

/** Coerce any messy scalar to a finite number, or `undefined`. */
function num(v: unknown): number | undefined {
  if (v == null) return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') {
    // Strip common decoration: ₹, $, commas, % signs, whitespace.
    const cleaned = v.replace(/[,₹$%\s]/g, '').trim()
    if (!cleaned || cleaned === '-' || cleaned.toLowerCase() === 'n/a') {
      return undefined
    }
    // Handle upstream shorthand like "1.5L Cr" / "50K Cr" / "2.3B".
    const lowercase = cleaned.toLowerCase()
    const lMatch = lowercase.match(/^(-?\d*\.?\d+)([kmlb])(cr)?$/)
    if (lMatch) {
      const base = parseFloat(lMatch[1])
      const mult =
        lMatch[2] === 'k'
          ? 1e3
          : lMatch[2] === 'm'
            ? 1e6
            : lMatch[2] === 'l' // "Lakh"
              ? 1e5
              : 1e9
      return Number.isFinite(base) ? base * mult : undefined
    }
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : undefined
  }
  return undefined
}

/** Read a value from a loose record by trying every key in order. */
function pick(
  rec: Record<string, unknown> | null | undefined,
  keys: string[]
): unknown {
  if (!rec) return undefined
  for (const k of keys) {
    if (rec[k] != null) return rec[k]
  }
  // Try case-insensitive match as a safety net.
  const lowerKeys = new Map<string, string>()
  for (const k of Object.keys(rec)) {
    lowerKeys.set(k.toLowerCase(), k)
  }
  for (const k of keys) {
    const mapped = lowerKeys.get(k.toLowerCase())
    if (mapped != null && rec[mapped] != null) return rec[mapped]
  }
  return undefined
}

/**
 * Market cap often arrives in units of absolute ₹ (e.g. 520_000_000_000)
 * rather than ₹Cr. Detect large values and convert down. Also handle
 * upstream shorthand strings like "52,000 Cr" by parsing them directly.
 */
function toMarketCapCr(raw: unknown): number | undefined {
  if (typeof raw === 'string') {
    const cleaned = raw.toLowerCase().replace(/\s+/g, '')
    // "₹52000cr" / "52000 crores" / "52,000cr"
    const crMatch = cleaned.match(/([\d,.\-]+)(?:cr|crore|crores)/)
    if (crMatch) {
      const n = parseFloat(crMatch[1].replace(/,/g, ''))
      if (Number.isFinite(n)) return n
    }
    const lMatch = cleaned.match(/([\d.]+)l(?:cr|crore|crores)?/)
    if (lMatch) {
      const n = parseFloat(lMatch[1]) * 100000 // L Cr → Cr
      if (Number.isFinite(n)) return n
    }
  }
  const n = num(raw)
  if (n == null) return undefined
  // Heuristic: raw numbers over 1e10 are almost certainly absolute ₹,
  // under 1e7 are almost certainly already in Cr.
  if (n >= 1e10) return n / 1e7 // ₹ → Cr
  if (n >= 1e7) return n / 1e7 // large ₹-denominated value
  return n // already Cr
}

// ── Main extract ─────────────────────────────────────────────

/**
 * Walk a StockProfile and return a TickerLive with whatever fields we
 * could extract. Always succeeds — missing data just means the
 * corresponding override will be undefined and the baseline Company
 * row keeps its value.
 */
export function adaptStockProfile(
  ticker: string,
  profile: StockProfile
): TickerLive {
  const out: TickerLive = {
    ticker,
    updatedAt: new Date().toISOString(),
  }

  // ── Current price (prefer NSE, fall back to BSE)
  const rawNse = profile.currentPrice?.NSE
  const rawBse = profile.currentPrice?.BSE
  out.lastPrice = num(rawNse) ?? num(rawBse)

  // ── Day % change
  out.changePct = num(profile.percentChange)

  // ── Metric fields live on either `keyMetrics` (common) or on the
  //    profile root or nested under companyProfile. Search all three.
  const keyMetrics = (profile.keyMetrics || {}) as Record<string, unknown>
  const profileRoot = profile as unknown as Record<string, unknown>

  // Many rows come nested like { valuation: { marketCap: ... } }.
  const valuationBucket =
    (pick(keyMetrics, ['valuation', 'Valuation']) as Record<string, unknown>) ??
    null
  const ratiosBucket =
    (pick(keyMetrics, ['ratios', 'Ratios']) as Record<string, unknown>) ?? null

  // Market cap — try every known field across every bucket.
  const marketCapKeys = [
    'marketCap',
    'market_cap',
    'marketCapitalization',
    'marketCapCr',
    'mcap',
    'mktCap',
    'market_capital',
  ]
  const mcRaw =
    pick(valuationBucket, marketCapKeys) ??
    pick(keyMetrics, marketCapKeys) ??
    pick(profileRoot, marketCapKeys)
  out.marketCapCr = toMarketCapCr(mcRaw)

  // EV / EBITDA
  const evEbKeys = [
    'evToEBITDA',
    'evEbitda',
    'ev_to_ebitda',
    'EV/EBITDA',
    'enterpriseToEbitda',
    'evEbit',
  ]
  out.evEbitda =
    num(pick(valuationBucket, evEbKeys)) ??
    num(pick(keyMetrics, evEbKeys)) ??
    num(pick(profileRoot, evEbKeys))

  // Enterprise value (₹Cr)
  const evKeys = ['enterpriseValue', 'ev', 'EV', 'enterprise_value']
  const evRaw =
    pick(valuationBucket, evKeys) ??
    pick(keyMetrics, evKeys) ??
    pick(profileRoot, evKeys)
  out.evCr = toMarketCapCr(evRaw)

  // P/E
  const peKeys = [
    'peRatio',
    'pe',
    'PE',
    'priceToEarnings',
    'p/e',
    'p_e',
    'trailingPE',
    'trailing_pe',
  ]
  out.pe =
    num(pick(ratiosBucket, peKeys)) ??
    num(pick(valuationBucket, peKeys)) ??
    num(pick(keyMetrics, peKeys)) ??
    num(pick(profileRoot, peKeys))

  // Final sanity: if we got a market cap over ~1.5L Cr it's real; if
  // between 10 and 10,000 Cr it could still be real (mid-caps). Only
  // drop obvious junk.
  if (out.marketCapCr != null && out.marketCapCr < 10) {
    out.marketCapCr = undefined
  }
  // Drop impossible multiples.
  if (out.evEbitda != null && (out.evEbitda < 0 || out.evEbitda > 200)) {
    out.evEbitda = undefined
  }
  if (out.pe != null && (out.pe < 0 || out.pe > 400)) {
    out.pe = undefined
  }

  return out
}
