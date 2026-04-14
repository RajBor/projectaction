/**
 * Valuation methods library — DCF, Comparable Multiples, Precedent
 * Transactions, Book Value, and a Football-Field synthesizer.
 *
 * All values are in ₹Cr unless noted. The functions here take a
 * subject Company plus a PeerStats bundle and produce structured
 * outputs that the report template can render without any in-line
 * math. This is deliberately kept separate from the FSA ratio engine
 * so the report logic doesn't depend on having a full FSAResult.
 */

import type { Company } from '@/lib/data/companies'
import type { PeerStats } from './peers'

// ─── Assumptions ─────────────────────────────────────────────────

export interface DcfAssumptions {
  /** Forecast horizon in years (typically 5). */
  years: number
  /** Starting year revenue growth (decimals, e.g. 0.18 for 18%). */
  startingGrowth: number
  /** Growth fades linearly to this by the final forecast year. */
  endingGrowth: number
  /** Starting EBITDA margin (decimals). */
  startingEbitdaMargin: number
  /** Terminal EBITDA margin (decimals). */
  terminalEbitdaMargin: number
  /** Effective tax rate (decimals). */
  taxRate: number
  /** D&A as % of revenue (decimals). Drives EBIT from EBITDA. */
  daPctOfRevenue: number
  /** CapEx as % of revenue (decimals). */
  capexPctOfRevenue: number
  /** Working-capital investment as % of incremental revenue (decimals). */
  nwcPctOfIncrementalRevenue: number
  /** Weighted average cost of capital (decimals). */
  wacc: number
  /** Terminal growth rate (decimals). */
  terminalGrowth: number
}

export function defaultDcfAssumptions(co: Company, historicalCagrPct?: number | null): DcfAssumptions {
  // Use historical revenue CAGR if available (more reliable than single-year revg).
  // Falls back to Company snapshot's revg (trailing 1-year growth).
  const growthSource = historicalCagrPct != null && historicalCagrPct > 0 ? historicalCagrPct : (co.revg || 12)
  const startG = Math.min(0.35, Math.max(0.03, growthSource / 100))
  const endG = Math.min(startG, 0.08)
  const ebm = Math.min(0.4, Math.max(0.04, (co.ebm || 12) / 100))
  const terminalEbm = Math.min(0.25, ebm + 0.01)
  return {
    years: 5,
    startingGrowth: startG,
    endingGrowth: endG,
    startingEbitdaMargin: ebm,
    terminalEbitdaMargin: terminalEbm,
    taxRate: 0.25,
    daPctOfRevenue: 0.045,
    capexPctOfRevenue: 0.06,
    nwcPctOfIncrementalRevenue: 0.12,
    wacc: co.sec === 'solar' ? 0.115 : 0.12,
    terminalGrowth: 0.045,
  }
}

// ─── DCF output ──────────────────────────────────────────────────

export interface DcfYearRow {
  year: number
  label: string
  revenue: number
  growthPct: number
  ebitda: number
  ebitdaMarginPct: number
  ebit: number
  nopat: number
  da: number
  capex: number
  nwcChange: number
  fcf: number
  discountFactor: number
  pvFcf: number
}

export type DcfReliability = 'high' | 'medium' | 'low' | 'nm'

export interface DcfResult {
  rows: DcfYearRow[]
  sumPvFcf: number
  terminalValue: number
  pvTerminalValue: number
  enterpriseValue: number
  netDebt: number
  equityValue: number
  impliedEvEbitda: number
  impliedSharePrice: number | null
  upsideVsMarketCap: number
  assumptions: DcfAssumptions
  /** Reliability of the DCF output:
   *  - `high`: inputs are valid and the implied EV is within 0.5–2.5× current EV
   *  - `medium`: runs but diverges noticeably from current market EV
   *  - `low`: final-year FCF is negative (so TV uses an exit-multiple proxy),
   *    or the Gordon formula would otherwise produce an unreliable value
   *  - `nm`: "not meaningful" — revenue or EBITDA inputs are missing/≤0 */
  reliability: DcfReliability
  /** Human-readable notes explaining reliability flags and any proxies used. */
  reliabilityNotes: string[]
  /** True when the terminal value was computed via an exit EV/EBITDA multiple
   *  instead of Gordon growth (because final-year FCF was negative). */
  terminalViaExitMultiple: boolean
}

export function runDcf(
  co: Company,
  assumptions: DcfAssumptions = defaultDcfAssumptions(co)
): DcfResult {
  const rows: DcfYearRow[] = []
  const baseRevenue = co.rev || 0
  const startG = assumptions.startingGrowth
  const endG = assumptions.endingGrowth
  const startM = assumptions.startingEbitdaMargin
  const endM = assumptions.terminalEbitdaMargin
  const years = assumptions.years
  const reliabilityNotes: string[] = []

  // Guard: without revenue we can't run a meaningful DCF. Return a
  // zeroed result marked `nm` so the UI can suppress or flag it
  // instead of silently showing "₹0 Cr equity".
  if (!(baseRevenue > 0)) {
    const netDebtNm =
      co.ev > 0 && co.mktcap > 0 ? co.ev - co.mktcap : 0
    return {
      rows: [],
      sumPvFcf: 0,
      terminalValue: 0,
      pvTerminalValue: 0,
      enterpriseValue: 0,
      netDebt: round(netDebtNm),
      equityValue: 0,
      impliedEvEbitda: 0,
      impliedSharePrice: null,
      upsideVsMarketCap: 0,
      assumptions,
      reliability: 'nm',
      reliabilityNotes: ['Subject has no reported TTM revenue — DCF cannot be computed. Use EV/EBITDA or EV/Sales comparables instead.'],
      terminalViaExitMultiple: false,
    }
  }

  let prevRevenue = baseRevenue
  let sumPv = 0

  for (let y = 1; y <= years; y++) {
    // Linear glidepath for growth and EBITDA margin
    const t = (y - 1) / Math.max(1, years - 1)
    const g = startG * (1 - t) + endG * t
    const m = startM * (1 - t) + endM * t

    const revenue = prevRevenue * (1 + g)
    const ebitda = revenue * m
    const da = revenue * assumptions.daPctOfRevenue
    const ebit = ebitda - da
    const nopat = ebit * (1 - assumptions.taxRate)
    const capex = revenue * assumptions.capexPctOfRevenue
    const nwcChange = (revenue - prevRevenue) * assumptions.nwcPctOfIncrementalRevenue
    const fcf = nopat + da - capex - nwcChange

    const discountFactor = 1 / Math.pow(1 + assumptions.wacc, y)
    const pv = fcf * discountFactor

    sumPv += pv
    rows.push({
      year: y,
      label: `Year ${y}`,
      revenue: round(revenue),
      growthPct: round(g * 100, 1),
      ebitda: round(ebitda),
      ebitdaMarginPct: round(m * 100, 1),
      ebit: round(ebit),
      nopat: round(nopat),
      da: round(da),
      capex: round(capex),
      nwcChange: round(nwcChange),
      fcf: round(fcf),
      discountFactor: round(discountFactor, 4),
      pvFcf: round(pv),
    })

    prevRevenue = revenue
  }

  // Terminal value — Gordon growth off final FCF, but fall back to an
  // exit EV/EBITDA multiple when final FCF is non-positive (high-capex
  // early-stage companies) because Gordon produces a negative/unreliable
  // TV in that case. Exit multiple of 10× EBITDA is a conservative
  // mid-cycle anchor for Indian industrials/solar.
  const finalRow = rows[rows.length - 1]
  const finalFcf = finalRow?.fcf ?? 0
  const finalEbitda = finalRow?.ebitda ?? 0
  const tg = assumptions.terminalGrowth
  const wacc = assumptions.wacc
  // Guard: terminal growth must be strictly below WACC.
  const safeTg = Math.min(tg, wacc - 0.005)

  let terminalValue: number
  let terminalViaExitMultiple = false
  if (finalFcf > 0) {
    terminalValue = (finalFcf * (1 + safeTg)) / Math.max(0.001, wacc - safeTg)
  } else {
    // Exit-multiple TV = 10× terminal-year EBITDA
    terminalValue = finalEbitda * 10
    terminalViaExitMultiple = true
    reliabilityNotes.push(
      `Final-year FCF is non-positive (capex-heavy forecast). Terminal value falls back to 10× exit EV/EBITDA on Year ${years} EBITDA of ₹${Math.round(finalEbitda).toLocaleString('en-IN')} Cr.`
    )
  }
  const pvTerminalValue = terminalValue / Math.pow(1 + wacc, years)

  const ev = sumPv + pvTerminalValue
  // Net debt = EV − MktCap. For net-cash companies this is negative
  // (and should ADD to equity value, not be clamped to zero). Only
  // guard against missing inputs — not against legitimate negatives.
  const netDebt =
    co.ev > 0 && co.mktcap > 0 ? co.ev - co.mktcap : 0
  const equityValue = Math.max(0, ev - netDebt)

  // Implied EV / EBITDA on TTM
  const impliedEvEbitda = co.ebitda > 0 ? ev / co.ebitda : 0

  // Implied share price — Company model doesn't carry shares; fall
  // back to null unless the caller supplies a reasonable proxy.
  const impliedSharePrice: number | null = null

  const upsideVsMarketCap =
    co.mktcap > 0 ? ((equityValue - co.mktcap) / co.mktcap) * 100 : 0

  // Reliability: low if we used the exit-multiple fallback, or if
  // DCF EV diverges more than 2.5× from current EV in either direction;
  // medium if 1.5×–2.5×; high otherwise.
  let reliability: DcfReliability = 'high'
  if (co.ebitda <= 0) {
    reliability = 'nm'
    reliabilityNotes.push('TTM EBITDA is not positive — DCF is indicative only; prefer EV/Sales comparables.')
  } else if (terminalViaExitMultiple) {
    reliability = 'low'
  } else if (co.ev > 0) {
    const ratio = ev / co.ev
    if (ratio < 0.4 || ratio > 2.5) {
      reliability = 'low'
      reliabilityNotes.push(
        `DCF EV (₹${Math.round(ev).toLocaleString('en-IN')} Cr) diverges ${(ratio * 100).toFixed(0)}% from current EV (₹${Math.round(co.ev).toLocaleString('en-IN')} Cr). Review growth/WACC/capex assumptions before relying on this value.`
      )
    } else if (ratio < 0.67 || ratio > 1.5) {
      reliability = 'medium'
    }
  }

  return {
    rows,
    sumPvFcf: round(sumPv),
    terminalValue: round(terminalValue),
    pvTerminalValue: round(pvTerminalValue),
    enterpriseValue: round(ev),
    netDebt: round(netDebt),
    equityValue: round(equityValue),
    impliedEvEbitda: round(impliedEvEbitda, 1),
    impliedSharePrice,
    upsideVsMarketCap: round(upsideVsMarketCap, 1),
    assumptions,
    reliability,
    reliabilityNotes,
    terminalViaExitMultiple,
  }
}

// ─── Comparable multiples ────────────────────────────────────────

export interface ComparableResult {
  method: 'EV/EBITDA' | 'P/E' | 'P/B' | 'EV/Sales'
  label: string
  peerMedian: number
  peerLow: number
  peerHigh: number
  subjectBase: number
  /** Enterprise value implied by median multiple × subject base metric. */
  evMedian: number
  evLow: number
  evHigh: number
  /** Equity value — EV minus net debt (for EV methods) or peerMultiple × base. */
  equityMedian: number
  equityLow: number
  equityHigh: number
  upsidePctMedian: number
}

export function runComparables(
  co: Company,
  peers: PeerStats
): ComparableResult[] {
  // Net debt may be negative for net-cash companies (see runDcf note).
  const netDebt =
    co.ev > 0 && co.mktcap > 0 ? co.ev - co.mktcap : 0
  const out: ComparableResult[] = []

  // EV / EBITDA
  if (peers.ev_eb.median > 0 && co.ebitda > 0) {
    const evMed = peers.ev_eb.median * co.ebitda
    const evLo = peers.ev_eb.q1 * co.ebitda
    const evHi = peers.ev_eb.q3 * co.ebitda
    out.push(buildComparable('EV/EBITDA', peers.ev_eb, co.ebitda, netDebt, evMed, evLo, evHi, co.mktcap))
  }
  // P / E
  if (peers.pe.median > 0 && co.pat > 0) {
    const equityMed = peers.pe.median * co.pat
    const equityLo = peers.pe.q1 * co.pat
    const equityHi = peers.pe.q3 * co.pat
    // P/E lands at equity directly; no netDebt bridge.
    out.push({
      method: 'P/E',
      label: 'Price / Earnings (TTM)',
      peerMedian: peers.pe.median,
      peerLow: peers.pe.q1,
      peerHigh: peers.pe.q3,
      subjectBase: co.pat,
      evMedian: round(equityMed + netDebt),
      evLow: round(equityLo + netDebt),
      evHigh: round(equityHi + netDebt),
      equityMedian: round(equityMed),
      equityLow: round(equityLo),
      equityHigh: round(equityHi),
      upsidePctMedian: co.mktcap > 0 ? round(((equityMed - co.mktcap) / co.mktcap) * 100, 1) : 0,
    })
  }
  // P / B
  if (peers.pb.median > 0 && co.mktcap > 0 && co.pb > 0) {
    // Derive book value from current P/B × mktcap
    const book = co.mktcap / co.pb
    const equityMed = peers.pb.median * book
    const equityLo = peers.pb.q1 * book
    const equityHi = peers.pb.q3 * book
    out.push({
      method: 'P/B',
      label: 'Price / Book',
      peerMedian: peers.pb.median,
      peerLow: peers.pb.q1,
      peerHigh: peers.pb.q3,
      subjectBase: book,
      evMedian: round(equityMed + netDebt),
      evLow: round(equityLo + netDebt),
      evHigh: round(equityHi + netDebt),
      equityMedian: round(equityMed),
      equityLow: round(equityLo),
      equityHigh: round(equityHi),
      upsidePctMedian: co.mktcap > 0 ? round(((equityMed - co.mktcap) / co.mktcap) * 100, 1) : 0,
    })
  }
  // EV / Sales (fallback for loss-making targets)
  if (peers.ev_eb.median > 0 && co.rev > 0) {
    // Derive implicit EV/Sales from peers' median EV/EBITDA × median EBITDA
    // margin — a rough proxy when we don't have the direct multiple.
    const proxySalesMult = (peers.ev_eb.median * peers.ebm.median) / 100
    if (proxySalesMult > 0) {
      const evMed = proxySalesMult * co.rev
      const evLo = evMed * 0.85
      const evHi = evMed * 1.15
      out.push(buildComparable('EV/Sales', { ...peers.ev_eb, median: proxySalesMult, q1: proxySalesMult * 0.85, q3: proxySalesMult * 1.15 }, co.rev, netDebt, evMed, evLo, evHi, co.mktcap))
    }
  }

  return out
}

function buildComparable(
  method: ComparableResult['method'],
  peerStat: { median: number; q1: number; q3: number },
  subjectBase: number,
  netDebt: number,
  evMedian: number,
  evLow: number,
  evHigh: number,
  currentMktcap: number
): ComparableResult {
  const equityMed = Math.max(0, evMedian - netDebt)
  const equityLo = Math.max(0, evLow - netDebt)
  const equityHi = Math.max(0, evHigh - netDebt)
  const label =
    method === 'EV/EBITDA'
      ? 'Enterprise Value / EBITDA'
      : method === 'EV/Sales'
        ? 'Enterprise Value / Revenue'
        : method === 'P/B'
          ? 'Price / Book'
          : 'Price / Earnings (TTM)'
  return {
    method,
    label,
    peerMedian: peerStat.median,
    peerLow: peerStat.q1,
    peerHigh: peerStat.q3,
    subjectBase,
    evMedian: round(evMedian),
    evLow: round(evLow),
    evHigh: round(evHigh),
    equityMedian: round(equityMed),
    equityLow: round(equityLo),
    equityHigh: round(equityHi),
    upsidePctMedian:
      currentMktcap > 0 ? round(((equityMed - currentMktcap) / currentMktcap) * 100, 1) : 0,
  }
}

// ─── Book Value ──────────────────────────────────────────────────

export interface BookValueResult {
  bookValue: number
  /** Premium applied (e.g. 1.0× = no premium; 1.25× = 25% strategic premium). */
  strategicPremium: number
  equityValue: number
  upsidePct: number
}

export function runBookValue(co: Company, strategicPremium = 1.25): BookValueResult {
  const book = co.pb > 0 ? co.mktcap / co.pb : 0
  const equityValue = book * strategicPremium
  const upsidePct =
    co.mktcap > 0 ? ((equityValue - co.mktcap) / co.mktcap) * 100 : 0
  return {
    bookValue: round(book),
    strategicPremium,
    equityValue: round(equityValue),
    upsidePct: round(upsidePct, 1),
  }
}

// ─── Football Field synthesizer ──────────────────────────────────

export interface FootballFieldBar {
  label: string
  low: number
  high: number
  medianOrMid: number
}

export function buildFootballField(
  co: Company,
  dcf: DcfResult,
  comps: ComparableResult[],
  bv: BookValueResult
): FootballFieldBar[] {
  const bars: FootballFieldBar[] = []

  // Current trading value as reference
  bars.push({
    label: 'Current Market Cap',
    low: co.mktcap,
    high: co.mktcap,
    medianOrMid: co.mktcap,
  })

  // DCF range — bear / base / bull by re-running with ± 100bps WACC
  const bear = runDcf(co, { ...dcf.assumptions, wacc: dcf.assumptions.wacc + 0.01 })
  const bull = runDcf(co, { ...dcf.assumptions, wacc: dcf.assumptions.wacc - 0.01 })
  bars.push({
    label: 'DCF (WACC ±100bps)',
    low: bear.equityValue,
    high: bull.equityValue,
    medianOrMid: dcf.equityValue,
  })

  for (const c of comps) {
    bars.push({
      label: c.label,
      low: c.equityLow,
      high: c.equityHigh,
      medianOrMid: c.equityMedian,
    })
  }

  bars.push({
    label: `Book Value × ${bv.strategicPremium.toFixed(2)}`,
    low: bv.equityValue * 0.9,
    high: bv.equityValue * 1.1,
    medianOrMid: bv.equityValue,
  })

  return bars
}

// ─── Small helpers ───────────────────────────────────────────────

function round(n: number, digits = 0): number {
  const m = Math.pow(10, digits)
  return Math.round(n * m) / m
}

/** Format ₹Cr with Indian comma grouping. Re-exports the shared
 *  helper so existing imports from this module keep working. */
export { formatInrCr as formatCr } from '@/lib/format'
