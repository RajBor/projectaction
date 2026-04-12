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
 * Merge data from NSE (Tier 1) → Screener (Tier 2) → baseline fallback.
 * Priority: NSE wins for price/mktcap/pe/ev, Screener wins for
 * revenue/ebitda/pat/margins, baseline covers everything else.
 */
export function cascadeMerge(
  baseCo: Company,
  nseRow?: ExchangeRow | null,
  screenerRow?: ScreenerRow | null
): Company {
  return {
    ...baseCo,
    // Tier 1 fields — NSE first, then Screener, then baseline
    mktcap: nseRow?.mktcapCr ?? screenerRow?.mktcapCr ?? baseCo.mktcap,
    pe: nseRow?.pe ?? screenerRow?.pe ?? baseCo.pe,
    ev: nseRow?.evCr ?? screenerRow?.evCr ?? baseCo.ev,
    ev_eb: nseRow?.evEbitda ?? screenerRow?.evEbitda ?? baseCo.ev_eb,
    // Tier 2 fields — Screener only (NSE doesn't have P&L data)
    rev: screenerRow?.salesCr ?? baseCo.rev,
    ebitda: screenerRow?.ebitdaCr ?? baseCo.ebitda,
    pat: screenerRow?.netProfitCr ?? baseCo.pat,
    ebm: screenerRow?.ebm ?? baseCo.ebm,
    dbt_eq: screenerRow?.dbtEq ?? baseCo.dbt_eq,
    pb: screenerRow?.pbRatio ?? baseCo.pb,
  }
}
