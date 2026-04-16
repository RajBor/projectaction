/**
 * Peer selection + statistical aggregation for valuation reports.
 *
 * Three tiers of peers (strongest signal first):
 *   1. Sub-segment peers — share at least one DealNector VC-taxonomy
 *      sub-segment id (e.g. `ss_1_2_3` TOPCon cells). Tightest group —
 *      same product-line economics, competes on the same RFQs.
 *   2. Value-chain peers — share at least one value-chain segment id
 *      (e.g. `solar_modules`, `hv_cables`). Close comparables across
 *      stages but potentially different product lines.
 *   3. Sector peers — same sector tag (`solar` | `td` | etc.) but
 *      different value-chain segments. Fallback when overlap is small.
 *
 * A company with empty `subcomp` is treated as a GENERALIST — we do NOT
 * grant sub-segment bonus for such pairings (there's no evidence they
 * share a narrow line), but they're still eligible via the `comp`
 * overlap tier so reports don't break when admin hasn't tagged them.
 *
 * The output is a ranked peer list plus median / Q1 / Q3 / min / max
 * for every metric the valuation report needs. Medians are used in
 * preference to means because the universe is small and long-tailed.
 */

import type { Company } from '@/lib/data/companies'
import { formatInrCr } from '@/lib/format'

export interface PeerSet {
  subject: Company
  /** Up to `limit` closest peers, excluding the subject. */
  peers: Company[]
  /** Overlap score for each peer: # shared segments, descending. */
  scores: Record<string, number>
}

export interface PeerStats {
  ev_eb: PeerStat
  pe: PeerStat
  pb: PeerStat
  revg: PeerStat
  ebm: PeerStat
  dbt_eq: PeerStat
  mktcap: PeerStat
  ev: PeerStat
  rev: PeerStat
}

export interface PeerStat {
  /** Array of numbers used to compute this stat, sorted ascending. */
  values: number[]
  min: number
  q1: number
  median: number
  q3: number
  max: number
  mean: number
  /** Subject's value on this metric (for delta computation). */
  subject: number
  /** Subject's percentile within the peer set (0..100). */
  subjectPercentile: number
}

export function findPeers(
  subject: Company,
  universe: Company[],
  limit = 5
): PeerSet {
  const subjectSegs = new Set(subject.comp || [])
  const subjectSubs = new Set(subject.subcomp || [])
  const scores: Record<string, number> = {}
  const ranked: Array<{ co: Company; score: number }> = []

  for (const co of universe) {
    if (co.ticker === subject.ticker) continue
    // Exclude companies with no market cap (data placeholders)
    if (!co.mktcap || co.mktcap <= 0) continue

    let compOverlap = 0
    for (const seg of co.comp || []) {
      if (subjectSegs.has(seg)) compOverlap++
    }

    // Sub-segment overlap — strongest signal. We only grant this bonus
    // when BOTH subject and peer have at least one sub-segment tagged
    // (otherwise "generalist vs generalist" would score artificially
    // high and crowd out the more informative comp-tier ranking).
    let subOverlap = 0
    if (subjectSubs.size > 0 && (co.subcomp?.length ?? 0) > 0) {
      for (const sub of co.subcomp!) {
        if (subjectSubs.has(sub)) subOverlap++
      }
    }

    // Weighted score: sub-segment × 100 ≫ value-chain × 10 ≫ sector × 1.
    // A single shared sub-segment beats multiple shared comps so
    // narrow-product peers rank above broad-stage peers.
    let score = subOverlap * 100 + compOverlap * 10
    if (co.sec === subject.sec) score += 1
    if (score === 0) continue

    scores[co.ticker] = score
    ranked.push({ co, score })
  }

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Prefer peers with closer market cap to the subject so the list
    // doesn't collapse to a single mega-cap dominating every report.
    const aDiff = Math.abs(a.co.mktcap - subject.mktcap)
    const bDiff = Math.abs(b.co.mktcap - subject.mktcap)
    return aDiff - bDiff
  })

  const peers = ranked.slice(0, limit).map((r) => r.co)
  return { subject, peers, scores }
}

/** Sort ascending and compute quartile / percentile stats. */
function summarize(subjectValue: number, peerValues: number[]): PeerStat {
  const cleaned = peerValues
    .filter((v) => Number.isFinite(v) && v !== 0)
    .sort((a, b) => a - b)
  const n = cleaned.length
  if (n === 0) {
    return {
      values: [],
      min: 0,
      q1: 0,
      median: 0,
      q3: 0,
      max: 0,
      mean: 0,
      subject: subjectValue,
      subjectPercentile: 0,
    }
  }
  const q = (p: number): number => {
    const idx = (n - 1) * p
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    if (lo === hi) return cleaned[lo]
    return cleaned[lo] * (hi - idx) + cleaned[hi] * (idx - lo)
  }
  const sum = cleaned.reduce((a, b) => a + b, 0)
  const mean = sum / n

  // Subject percentile
  let belowOrEq = 0
  for (const v of cleaned) if (v <= subjectValue) belowOrEq++
  const percentile = (belowOrEq / n) * 100

  return {
    values: cleaned,
    min: cleaned[0],
    q1: q(0.25),
    median: q(0.5),
    q3: q(0.75),
    max: cleaned[n - 1],
    mean,
    subject: subjectValue,
    subjectPercentile: Math.round(percentile),
  }
}

export function computePeerStats(peerSet: PeerSet): PeerStats {
  const { subject, peers } = peerSet
  const vals = (k: keyof Company) =>
    peers.map((p) => Number(p[k])).filter((n) => Number.isFinite(n))

  return {
    ev_eb: summarize(subject.ev_eb, vals('ev_eb')),
    pe: summarize(subject.pe, vals('pe')),
    pb: summarize(subject.pb, vals('pb')),
    revg: summarize(subject.revg, vals('revg')),
    ebm: summarize(subject.ebm, vals('ebm')),
    dbt_eq: summarize(subject.dbt_eq, vals('dbt_eq')),
    mktcap: summarize(subject.mktcap, vals('mktcap')),
    ev: summarize(subject.ev, vals('ev')),
    rev: summarize(subject.rev, vals('rev')),
  }
}

/** Format helper: ×, %, ₹Cr. Returns "N/A" for missing / zero data. */
export function formatPeerValue(
  metric: keyof PeerStats,
  value: number
): string {
  if (!Number.isFinite(value) || value === 0) return 'N/A'
  switch (metric) {
    case 'ev_eb':
    case 'pe':
    case 'pb':
      return `${value.toFixed(1)}×`
    case 'revg':
    case 'ebm':
      return `${value.toFixed(1)}%`
    case 'dbt_eq':
      return value.toFixed(2)
    case 'mktcap':
    case 'ev':
    case 'rev':
      return formatInrCr(value)
  }
}

/**
 * Derive ratios per peer that aren't directly stored on the Company
 * snapshot — used by the Ratio Benchmark page so ROE / Net Margin
 * etc. don't show as blank columns across the peer group.
 *
 * - netMargin  = pat / rev × 100
 * - roeApprox  = pat / (mktcap / pb) × 100  (BookValue = mktcap/pb)
 * - debtRatio  = EV − MktCap ÷ EV  (when both present)
 * - rocePct    = co.roce when Screener provided it, else
 *                EBIT / (Equity + Debt) × 100, where
 *                EBIT ≈ EBITDA × 0.7 (since D&A isn't on snapshot),
 *                Equity = mktcap / pb, Debt ≈ max(0, EV − mktcap).
 *
 * Callers should treat the returned `null` as "genuinely unknown";
 * non-null values can be shown alongside a tiny "est." marker.
 */
export interface PeerDerivedRatios {
  netMarginPct: number | null
  roePct: number | null
  rocePct: number | null
  bookValue: number | null
  debtShareOfEv: number | null
}

export function derivePeerRatios(co: Company): PeerDerivedRatios {
  const netMarginPct =
    co.rev && co.rev > 0 && Number.isFinite(co.pat)
      ? (co.pat / co.rev) * 100
      : null
  const bookValue =
    co.pb > 0 && co.mktcap > 0 ? co.mktcap / co.pb : null
  const roePct =
    bookValue && bookValue > 0 && Number.isFinite(co.pat)
      ? (co.pat / bookValue) * 100
      : null
  const debtShareOfEv =
    co.ev > 0 && co.mktcap > 0 ? Math.max(0, (co.ev - co.mktcap) / co.ev) * 100 : null

  // ROCE — prefer the live-scraped value if we have one, else estimate.
  let rocePct: number | null = null
  if (co.roce != null && Number.isFinite(co.roce) && co.roce > 0) {
    rocePct = co.roce
  } else if (
    co.ebitda && co.ebitda > 0 &&
    bookValue && bookValue > 0 &&
    co.ev > 0 && co.mktcap > 0
  ) {
    const debt = Math.max(0, co.ev - co.mktcap)
    const capitalEmployed = bookValue + debt
    if (capitalEmployed > 0) {
      const ebitEst = co.ebitda * 0.7 // EBITDA → EBIT heuristic
      rocePct = (ebitEst / capitalEmployed) * 100
    }
  }

  return { netMarginPct, roePct, rocePct, bookValue, debtShareOfEv }
}
