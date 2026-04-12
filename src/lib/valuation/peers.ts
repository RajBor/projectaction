/**
 * Peer selection + statistical aggregation for valuation reports.
 *
 * Two tiers of peers:
 *   1. Value-chain peers — share at least one value-chain segment id
 *      (e.g. "solar_modules", "hv_cables"). Closest comparables.
 *   2. Sector peers — same sector tag ("solar" | "td") but different
 *      value-chain segments. Fallback when segment overlap is small.
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
  const scores: Record<string, number> = {}
  const ranked: Array<{ co: Company; score: number }> = []

  for (const co of universe) {
    if (co.ticker === subject.ticker) continue
    // Exclude companies with no market cap (data placeholders)
    if (!co.mktcap || co.mktcap <= 0) continue

    let overlap = 0
    for (const seg of co.comp || []) {
      if (subjectSegs.has(seg)) overlap++
    }
    // Value-chain overlap is the primary signal. Same-sector acts as
    // a secondary tiebreaker when overlap is tied.
    let score = overlap * 10
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

/** Format helper: ×, %, ₹Cr. */
export function formatPeerValue(
  metric: keyof PeerStats,
  value: number
): string {
  if (!Number.isFinite(value)) return '—'
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
