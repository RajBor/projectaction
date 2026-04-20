/**
 * Auto-refresh scheduling logic — IST time utilities, field coverage
 * analysis, and cascade merge function.
 *
 * Pure logic module (no React). Used by the LiveSnapshotProvider to
 * decide when to fire Tier 1 (NSE) and Tier 2 (Screener) refreshes
 * and how to merge data across sources.
 */

import type { Company } from '@/lib/data/companies'
import type { ExchangeRow } from '@/lib/live/nse-fetch'
import type { ScreenerRow } from '@/lib/live/screener-fetch'

// ── IST time utilities ───────────────────────────────────────

/** Returns current hour + minute in IST (UTC+5:30). */
export function currentIstHourMinute(): { hour: number; minute: number } {
  const now = new Date()
  // IST = UTC + 5h 30m
  const istMs = now.getTime() + (5 * 60 + 30) * 60 * 1000
  const ist = new Date(istMs)
  return {
    hour: ist.getUTCHours(),
    minute: ist.getUTCMinutes(),
  }
}

/** True if the IST time falls within a Screener refresh slot (±2 min). */
export function isScreenerSlot(hour: number, minute: number): boolean {
  // 9:00, 12:01, 16:00 IST — with ±2 minute tolerance
  if (hour === 9 && minute <= 2) return true
  if (hour === 12 && minute >= 0 && minute <= 3) return true
  if (hour === 16 && minute <= 2) return true
  return false
}

const SLOTS = [
  { h: 9, m: 0, label: '9:00 AM IST' },
  { h: 12, m: 1, label: '12:01 PM IST' },
  { h: 16, m: 0, label: '4:00 PM IST' },
]

/** Returns the next upcoming Screener slot label. */
export function nextScreenerSlotLabel(): string {
  const { hour, minute } = currentIstHourMinute()
  const nowMins = hour * 60 + minute
  for (const s of SLOTS) {
    const slotMins = s.h * 60 + s.m
    if (slotMins > nowMins) return s.label
  }
  return SLOTS[0].label + ' (tomorrow)'
}

/** Minutes until the next hourly NSE refresh. */
export function minutesUntilNextNseRefresh(
  lastRefreshedAt: Date | null
): number {
  if (!lastRefreshedAt) return 0 // fire immediately
  const elapsed = Date.now() - lastRefreshedAt.getTime()
  const remaining = 60 * 60 * 1000 - elapsed
  return Math.max(0, Math.round(remaining / 60000))
}

// ── Field coverage analysis ──────────────────────────────────

/** Fields that NSE Direct provides (Tier 1). */
const TIER1_FIELDS = ['mktcap', 'pe', 'ev', 'ev_eb'] as const

/** Fields that only Screener provides (Tier 2). */
const TIER2_FIELDS = ['rev', 'ebitda', 'pat', 'ebm', 'dbt_eq', 'pb'] as const

export interface FieldCoverage {
  filled: string[]
  missing: string[]
  tier1Filled: boolean
  tier2Filled: boolean
  needsTier3: boolean
}

export function fieldCoverage(
  _co: Company,
  nseRow?: ExchangeRow | null,
  screenerRow?: ScreenerRow | null
): FieldCoverage {
  const filled: string[] = []
  const missing: string[] = []

  // Tier 1 check
  const t1 = {
    mktcap: nseRow?.mktcapCr,
    pe: nseRow?.pe,
    ev: nseRow?.evCr,
    ev_eb: nseRow?.evEbitda,
  }
  for (const [k, v] of Object.entries(t1)) {
    if (v != null && Number.isFinite(v) && v > 0) filled.push(k)
    else missing.push(k)
  }
  const tier1Filled = TIER1_FIELDS.every(
    (f) => t1[f] != null && Number.isFinite(t1[f]!) && t1[f]! > 0
  )

  // Tier 2 check
  const t2 = {
    rev: screenerRow?.salesCr,
    ebitda: screenerRow?.ebitdaCr,
    pat: screenerRow?.netProfitCr,
    ebm: screenerRow?.ebm,
    dbt_eq: screenerRow?.dbtEq,
    pb: screenerRow?.pbRatio,
  }
  for (const [k, v] of Object.entries(t2)) {
    if (v != null && Number.isFinite(v)) filled.push(k)
    else missing.push(k)
  }
  const tier2Filled = TIER2_FIELDS.every(
    (f) => t2[f] != null && Number.isFinite(t2[f]!)
  )

  return {
    filled,
    missing,
    tier1Filled,
    tier2Filled,
    needsTier3: !tier1Filled || !tier2Filled,
  }
}

// ── Cascade merge ────────────────────────────────────────────

/**
 * Pick the first positive finite number from the candidates, falling
 * back to `base`. Treats 0 and negative values as "no data" for ratio
 * / price-type fields where a zero would almost always be a parsing
 * failure rather than a genuine signal (e.g. Screener rendering an
 * empty OPM cell as 0 would otherwise wipe out a valid static margin).
 */
function pickPositive(
  ...candidates: Array<number | null | undefined>
): number | null | undefined {
  for (const c of candidates) {
    if (c != null && Number.isFinite(c) && c > 0) return c
  }
  return candidates[candidates.length - 1]
}

/**
 * Pick the first defined, finite number. Allows 0 as a valid value
 * (used for fields like `dbt_eq` where 0 is a meaningful "no debt"
 * signal — but still guards against NaN / Infinity).
 */
function pickFinite(
  ...candidates: Array<number | null | undefined>
): number | null | undefined {
  for (const c of candidates) {
    if (c != null && Number.isFinite(c)) return c
  }
  return candidates[candidates.length - 1]
}

/**
 * Merge data from NSE (Tier 1) → Screener (Tier 2) → baseline fallback.
 * Priority: NSE wins for price/mktcap/pe/ev, Screener wins for
 * revenue/ebitda/pat/margins, baseline covers everything else.
 *
 * IMPORTANT: For ratio / multiple fields we use `pickPositive` rather
 * than `??` so that a Screener scrape returning 0 (typically a parse
 * failure) does not override the curated static value. A zero EBITDA
 * margin on a profitable company is almost never correct; trusting it
 * produced the Paramount Communications bug where live data showed
 * EBM=0 while static data had 3.7%.
 */
/**
 * Divergence clamp — rejects live mktcap / ev values that are off by
 * more than 5× or less than 0.2× the curated baseline. This mirrors the
 * guard already present in deriveLiveMetrics for the RapidAPI overlay
 * ([live-metrics.ts:181]). The NSE + Screener cascade was missing the
 * same safety net, so a mis-parsed row (wrong ticker resolution, bad
 * shares-outstanding, unit-conversion bug at the adapter) could silently
 * overwrite a ₹12,000 Cr EV with a ₹15 Cr value.
 *
 * Example incident: Legrand India (unlisted subsidiary of Legrand SA)
 * — NSE auto-refresh landed on a wrong-ticker row → mktcap ≈ 14 Cr →
 * cascadeMerge accepted it → op-identifier estimated deal size at
 * ₹19 Cr instead of ₹15,000 Cr.
 *
 * Returns the live value if it's within the sane band, else null so
 * pickPositive falls through to the baseline.
 */
function sanityCheck(liveVal: number | null | undefined, baselineVal: number): number | null {
  if (liveVal == null || !Number.isFinite(liveVal) || liveVal <= 0) return null
  if (baselineVal > 0) {
    const ratio = liveVal / baselineVal
    if (ratio > 5 || ratio < 0.2) return null
  }
  return liveVal
}

export function cascadeMerge(
  baseCo: Company,
  nseRow?: ExchangeRow | null,
  screenerRow?: ScreenerRow | null
): Company {
  // Pre-filter live mktcap / ev / ev_eb values against the baseline so
  // a single bad row from an upstream adapter can't corrupt the merged
  // Company. P&L fields (rev, ebitda, pat, margins) are not clamped —
  // they're calibrated independently by Screener and zero on those is
  // already handled by pickPositive.
  const cleanNseMktcap = sanityCheck(nseRow?.mktcapCr, baseCo.mktcap)
  const cleanScrMktcap = sanityCheck(screenerRow?.mktcapCr, baseCo.mktcap)
  const cleanNseEv = sanityCheck(nseRow?.evCr, baseCo.ev || baseCo.mktcap)
  const cleanScrEv = sanityCheck(screenerRow?.evCr, baseCo.ev || baseCo.mktcap)
  const cleanNseEvEb = sanityCheck(nseRow?.evEbitda, baseCo.ev_eb)
  const cleanScrEvEb = sanityCheck(screenerRow?.evEbitda, baseCo.ev_eb)

  return {
    ...baseCo,
    // Tier 1 fields — NSE first, then Screener, then baseline.
    // Market cap and EV are absolute values — zero is never valid.
    mktcap: pickPositive(cleanNseMktcap, cleanScrMktcap, baseCo.mktcap) as number,
    pe: pickPositive(nseRow?.pe, screenerRow?.pe, baseCo.pe) as number,
    ev: pickPositive(cleanNseEv, cleanScrEv, baseCo.ev) as number,
    ev_eb: pickPositive(cleanNseEvEb, cleanScrEvEb, baseCo.ev_eb) as number,
    // Tier 2 fields — Screener only (NSE doesn't have P&L data).
    // Revenue, EBITDA, and margins must be positive. `pat` can be
    // negative (loss-making company) so use finite-only check.
    rev: pickPositive(screenerRow?.salesCr, baseCo.rev) as number,
    ebitda: pickPositive(screenerRow?.ebitdaCr, baseCo.ebitda) as number,
    pat: pickFinite(screenerRow?.netProfitCr, baseCo.pat) as number,
    ebm: pickPositive(screenerRow?.ebm, baseCo.ebm) as number,
    // Debt/Equity of 0 means zero debt — that's legitimate, so allow
    // 0 but only when the Screener value is finite (not a parse fail).
    dbt_eq: pickFinite(screenerRow?.dbtEq, baseCo.dbt_eq) as number,
    pb: pickPositive(screenerRow?.pbRatio, baseCo.pb) as number,
    // ROCE — optional, only populated from Screener (not on static
    // Company snapshot). Fall back to null if Screener didn't give it.
    roce: pickPositive(screenerRow?.roce, baseCo.roce ?? null) ?? undefined,
  }
}
