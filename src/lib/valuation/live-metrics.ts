/**
 * Live metrics derivation — unit-safe.
 *
 * Why this exists:
 *   The RapidAPI Indian Stock Exchange response is schema-inconsistent
 *   across companies. `netDebtLFY` came back as `-67,490.80` for Waaree
 *   (impossibly large if interpreted as ₹Cr — Waaree only has ~₹5K Cr
 *   net cash) but as `~3,050` for Premier Energies (plausible). The
 *   adapter's attempt to compute `EV = marketCap + netDebt` therefore
 *   produced a correct number for some tickers and a nonsense number
 *   for others (Waaree EV came out at ₹26,907 Cr — should be ~₹94K Cr).
 *
 * The fix:
 *   Instead of trusting the netDebt field, we preserve the RELATIONSHIPS
 *   captured in the baseline `Company` row and scale them by the change
 *   in market cap. If Waaree's baseline was { mktcap: 50,000, ev: 52,000 }
 *   and live market cap is 94,398, we keep the ev/mktcap ratio of 1.04
 *   and derive a live EV of ~₹98,174 Cr. This is unit-safe because
 *   both baseline and live come from the same source (market cap in ₹Cr)
 *   and we never look at netDebt in isolation.
 *
 *   EBITDA comes from the baseline `ebitda` field (which is curated from
 *   annual reports, in ₹Cr) — we only update it if the API gives us a
 *   clearly-scoped direct value. EV/EBITDA is then derived from live EV
 *   and baseline EBITDA.
 *
 *   The acquisition score is recomputed from the post-refresh metrics
 *   so users see an updated score that reflects the live valuation
 *   (a company becoming more expensive on EV/EBITDA will score slightly
 *   lower, matching the news-adjustment behaviour in the Valuation page).
 *
 * Every downstream popup / table / report should flow through
 * `deriveLiveMetrics(baseCo, live)` instead of directly overlaying API
 * fields — that way the entire platform uses one consistent formula.
 */

import type { Company } from '@/lib/data/companies'
import type { TickerLive } from '@/lib/stocks/profile-adapter'

export interface DerivedMetrics {
  /** The final Company row to display. */
  company: Company
  /** True when the live snapshot contributed a real refresh. */
  hasLiveData: boolean
  /** mktcap_live / mktcap_baseline. 1.0 means no change. */
  scalingFactor: number
  /** Per-field derivation audit so popups can show the math. */
  audit: MetricAudit
  /** ISO timestamp of when the live data was captured, when present. */
  updatedAt: string | null
}

export interface MetricAudit {
  mktcap: {
    baseline: number
    live: number | null
    source: 'live' | 'baseline'
  }
  ev: {
    baseline: number
    live: number
    method: 'mktcap-scaled' | 'baseline'
    note: string
  }
  ev_eb: {
    baseline: number
    live: number
    method: 'derived-from-live-ev' | 'baseline'
    ebitdaCr: number
    note: string
  }
  pe: {
    baseline: number
    live: number
    source: 'live' | 'baseline-scaled' | 'baseline'
  }
  acqs: {
    baseline: number
    live: number
    drivers: AcqScoreDriver[]
    weightedTotal: number
    note: string
  }
}

export interface AcqScoreDriver {
  name: string
  rawScore: number // 1..10
  weight: number // 0..1
  contribution: number // rawScore * weight
  rationale: string
}

// ── Core derivation ──────────────────────────────────────────

/**
 * Returns a fully-derived Company row with a complete audit trail.
 * `live` may be undefined when no refresh has happened yet — in that
 * case the returned `company` equals `baseCo` and `hasLiveData` is false.
 */
export function deriveLiveMetrics(
  baseCo: Company,
  live: TickerLive | undefined | null
): DerivedMetrics {
  // Atlas-seeded stubs have no editorial financials — recomputing the
  // acq score over zero-filled fields produces garbage (Revenue Growth
  // scores 1, EBITDA Margin scores 1, D/E scores 10, etc.). We treat
  // the row as a stub when EITHER rev or ebitda is missing: the
  // previous check required ALL four of {rev, ebitda, revg, ebm} to be
  // zero, which let partially-seeded rows (e.g., a stub carrying only
  // a placeholder revg) through into recomputeAcqScore with real-looking
  // numbers built on top of zero-filled peers.
  const isAtlasStub =
    (baseCo.rev == null || baseCo.rev === 0) ||
    (baseCo.ebitda == null || baseCo.ebitda === 0)
  // No live data yet — return baseline unchanged but still compute
  // the acq-score audit so the popup can display the breakdown.
  if (!live || live.marketCapCr == null || live.marketCapCr <= 0) {
    const acqAudit = isAtlasStub
      ? {
          drivers: [] as AcqScoreDriver[],
          weightedTotal: baseCo.acqs,
          normalised: baseCo.acqs,
        }
      : recomputeAcqScore(baseCo)
    return {
      company: { ...baseCo, acqs: acqAudit.normalised },
      hasLiveData: false,
      scalingFactor: 1,
      audit: {
        mktcap: { baseline: baseCo.mktcap, live: null, source: 'baseline' },
        ev: {
          baseline: baseCo.ev,
          live: baseCo.ev,
          method: 'baseline',
          note: 'No live snapshot — showing curated baseline from COMPANIES[].',
        },
        ev_eb: {
          baseline: baseCo.ev_eb,
          live: baseCo.ev_eb,
          method: 'baseline',
          ebitdaCr: impliedEbitda(baseCo),
          note: 'No live snapshot.',
        },
        pe: { baseline: baseCo.pe, live: baseCo.pe, source: 'baseline' },
        acqs: {
          baseline: baseCo.acqs,
          live: acqAudit.normalised,
          drivers: acqAudit.drivers,
          weightedTotal: acqAudit.weightedTotal,
          note:
            'Score recomputed from the seven Strategic Analysis drivers on the baseline Company row.',
        },
      },
      updatedAt: null,
    }
  }

  const baselineMktcap = baseCo.mktcap || baseCo.ev || 1

  // ── Sanity clamp for the RapidAPI overlay ──
  //
  // When our internal cascade has already produced a trustworthy
  // market cap (from NSE quote-equity or Screener scraping — see
  // cascadeMerge), the RapidAPI overlay becomes just a tie-breaker /
  // freshness signal. If the RapidAPI `marketCapCr` instead diverges
  // by more than 5× from the cascade result, it's almost always a
  // unit-conversion bug in the upstream adapter (RapidAPI occasionally
  // returns market cap in raw rupees instead of crores, or vice versa,
  // depending on the ticker class). Surfacing a wrong-by-100×
  // "NSE/BSE Live" value is far worse than ignoring the overlay, so
  // we short-circuit back to the no-live branch when the divergence
  // is that extreme.
  //
  // Example: BBL (Bharat Bijlee) — real mktcap ~₹3,125 Cr. RapidAPI
  // cached value was ₹338,223 Cr (108×). Previously this painted
  // the admin comparison table's "NSE/BSE Live" mktcap at ₹3,38,223
  // and EV at ₹3,58,896 with a +11,326% diff badge. After the
  // clamp, the divergence trips the guard and we fall back to the
  // ₹3,125 Cr cascade value.
  const divergence = baselineMktcap > 0 ? live.marketCapCr / baselineMktcap : 1
  if (divergence > 5 || divergence < 0.2) {
    const acqAudit = isAtlasStub
      ? {
          drivers: [] as AcqScoreDriver[],
          weightedTotal: baseCo.acqs,
          normalised: baseCo.acqs,
        }
      : recomputeAcqScore(baseCo)
    return {
      company: { ...baseCo, acqs: acqAudit.normalised },
      hasLiveData: false,
      scalingFactor: 1,
      audit: {
        mktcap: { baseline: baseCo.mktcap, live: null, source: 'baseline' },
        ev: {
          baseline: baseCo.ev,
          live: baseCo.ev,
          method: 'baseline',
          note: `RapidAPI overlay (₹${Math.round(live.marketCapCr).toLocaleString('en-IN')} Cr) diverged ${divergence > 1 ? '+' : ''}${Math.round((divergence - 1) * 100)}% from cascade — likely a unit-conversion bug in the upstream adapter. Showing cascade value.`,
        },
        ev_eb: {
          baseline: baseCo.ev_eb,
          live: baseCo.ev_eb,
          method: 'baseline',
          ebitdaCr: impliedEbitda(baseCo),
          note: 'Live overlay rejected by divergence clamp.',
        },
        pe: { baseline: baseCo.pe, live: baseCo.pe, source: 'baseline' },
        acqs: {
          baseline: baseCo.acqs,
          live: acqAudit.normalised,
          drivers: acqAudit.drivers,
          weightedTotal: acqAudit.weightedTotal,
          note:
            'Score recomputed from the seven Strategic Analysis drivers on the cascade-merged row (RapidAPI overlay discarded).',
        },
      },
      updatedAt: null,
    }
  }

  const scalingFactor = live.marketCapCr / baselineMktcap

  // ── EV ──
  // Preserve the baseline ev/mktcap ratio through the scaling factor.
  // This is unit-safe (both sides are in ₹Cr) and avoids trusting
  // netDebt fields whose units vary across companies in the API.
  const baselineEvRatio =
    baseCo.mktcap > 0 ? baseCo.ev / baseCo.mktcap : 1
  const liveEv = Math.round(live.marketCapCr * baselineEvRatio)

  // Sanity check — a highly-levered company (D/E > 0.9) should have
  // an EV/mktcap ratio > 1.5 at minimum. If it doesn't, the baseline
  // row was probably undercooked for net debt. Flag this in the audit.
  const ratioLooksSuspicious =
    baseCo.dbt_eq > 0.9 && baselineEvRatio < 1.5

  // ── EBITDA ──
  // Use the curated baseline EBITDA (from annual reports) unless the
  // adapter gave us a live evEbitda we can trust inside a sensible
  // range. The baseline EBITDA is in ₹Cr.
  const ebitdaCr = impliedEbitda(baseCo)
  const liveEvEb = ebitdaCr > 0
    ? Math.round((liveEv / ebitdaCr) * 10) / 10
    : baseCo.ev_eb

  // ── P/E ──
  // Prefer the direct live P/E (unit-safe, just a ratio). If missing,
  // scale the baseline by the mktcap ratio, since PAT is relatively
  // sticky between quarters and P/E changes track price movements.
  const livePe =
    live.pe != null
      ? Math.round(live.pe * 10) / 10
      : Math.round(baseCo.pe * scalingFactor * 10) / 10

  // ── Acquisition score ──
  // Recompute from the live post-refresh row so the score reflects
  // the new valuation. A richer EV/EBITDA drags the score down.
  // For atlas stubs (no editorial financials), keep the heuristic acqs.
  const liveCompanyPre: Company = {
    ...baseCo,
    mktcap: live.marketCapCr,
    ev: liveEv,
    ev_eb: liveEvEb,
    pe: livePe,
  }
  const acqAudit = isAtlasStub
    ? {
        drivers: [] as AcqScoreDriver[],
        weightedTotal: baseCo.acqs,
        normalised: baseCo.acqs,
      }
    : recomputeAcqScore(liveCompanyPre)

  const liveCompany: Company = {
    ...liveCompanyPre,
    acqs: acqAudit.normalised,
  }

  return {
    company: liveCompany,
    hasLiveData: true,
    scalingFactor,
    audit: {
      mktcap: {
        baseline: baseCo.mktcap,
        live: live.marketCapCr,
        source: 'live',
      },
      ev: {
        baseline: baseCo.ev,
        live: liveEv,
        method: 'mktcap-scaled',
        note:
          `EV scaled by mktcap factor ${scalingFactor.toFixed(3)}× to preserve the baseline ev/mktcap ratio of ${baselineEvRatio.toFixed(3)}.` +
          (ratioLooksSuspicious
            ? ` ⚠ Warning: D/E is ${baseCo.dbt_eq.toFixed(2)} but ev/mktcap ratio is only ${baselineEvRatio.toFixed(3)} — the baseline row may understate net debt. Live EV is likely biased low.`
            : ''),
      },
      ev_eb: {
        baseline: baseCo.ev_eb,
        live: liveEvEb,
        method: 'derived-from-live-ev',
        ebitdaCr,
        note: `Live EV (₹${liveEv.toLocaleString('en-IN')} Cr) ÷ curated EBITDA (₹${ebitdaCr.toLocaleString('en-IN')} Cr).`,
      },
      pe: {
        baseline: baseCo.pe,
        live: livePe,
        source: live.pe != null ? 'live' : 'baseline-scaled',
      },
      acqs: {
        baseline: baseCo.acqs,
        live: acqAudit.normalised,
        drivers: acqAudit.drivers,
        weightedTotal: acqAudit.weightedTotal,
        note:
          'Score recomputed from the seven Strategic Analysis drivers using the post-refresh metrics.',
      },
    },
    updatedAt: live.updatedAt,
  }
}

/** Use curated ebitda when present, else derive from rev × ebm%. */
function impliedEbitda(co: Company): number {
  if (co.ebitda && co.ebitda > 0) return co.ebitda
  if (co.rev > 0 && co.ebm > 0) return Math.round((co.rev * co.ebm) / 100)
  return 0
}

// ── Acquisition score recomputation ──────────────────────────

/**
 * Recompute the acquisition score from scratch using the seven
 * Strategic Analysis drivers, reading from the post-refresh Company row.
 * Every driver is scored 1..10 based on objective thresholds (not
 * circular self-references). Weights sum to 1.0.
 *
 * This replaces the hand-coded `co.acqs` as the authoritative score
 * once live data is available.
 */
export function recomputeAcqScore(co: Company): {
  drivers: AcqScoreDriver[]
  weightedTotal: number
  normalised: number
} {
  const drivers: AcqScoreDriver[] = []

  // 1. Revenue Growth (25%) — the single biggest driver in our model
  drivers.push({
    name: 'Revenue Growth',
    rawScore: scoreByThreshold(co.revg, [40, 30, 22, 15, 8]),
    weight: 0.25,
    contribution: 0, // filled below
    rationale: `Trailing revenue growth ${co.revg.toFixed(1)}%`,
  })

  // 2. EBITDA Margin (20%) — cash flow quality
  drivers.push({
    name: 'EBITDA Margin',
    rawScore: scoreByThreshold(co.ebm, [22, 17, 13, 9, 6]),
    weight: 0.2,
    contribution: 0,
    rationale: `EBITDA margin ${co.ebm.toFixed(1)}%`,
  })

  // 3. Valuation attractiveness via EV/EBITDA (15%) — inverted
  // (cheaper multiples score higher on acquirability)
  const evEbRaw = co.ev_eb > 0 ? scoreByInverseThreshold(co.ev_eb, [12, 18, 25, 35, 50]) : 5
  drivers.push({
    name: 'Valuation (EV/EBITDA)',
    rawScore: evEbRaw,
    weight: 0.15,
    contribution: 0,
    rationale: `EV/EBITDA ${co.ev_eb.toFixed(1)}× (lower is better for acquirer)`,
  })

  // 4. Leverage / Balance sheet (15%) — inverted D/E
  drivers.push({
    name: 'Balance Sheet (D/E)',
    rawScore: scoreByInverseThreshold(co.dbt_eq, [0.15, 0.35, 0.6, 0.9, 1.3]),
    weight: 0.15,
    contribution: 0,
    rationale: `Debt/Equity ${co.dbt_eq.toFixed(2)}`,
  })

  // 5. Sector tailwind (10%) — curated by sector tag
  drivers.push({
    name: 'Sector Tailwind',
    rawScore: co.sec === 'solar' ? 8 : co.sec === 'td' ? 7 : 5,
    weight: 0.1,
    contribution: 0,
    rationale:
      co.sec === 'solar'
        ? 'Solar value chain — 500GW target + ALMM/PLI moats'
        : co.sec === 'td'
          ? 'T&D infrastructure — ₹3.03L Cr RDSS + grid modernisation'
          : 'Neutral sector tailwind',
  })

  // 6. Size & acquirability (10%) — inverted mktcap (smaller = easier)
  // Cap at ₹75,000 Cr (mega-cap) so above that it scores 1.
  drivers.push({
    name: 'Acquirability (Size)',
    rawScore: co.mktcap > 0 ? scoreByInverseThreshold(co.mktcap, [2000, 7500, 20000, 40000, 75000]) : 5,
    weight: 0.1,
    contribution: 0,
    rationale:
      co.mktcap > 75000
        ? `Market cap ₹${co.mktcap.toLocaleString('en-IN')} Cr — size-prohibitive`
        : `Market cap ₹${co.mktcap.toLocaleString('en-IN')} Cr`,
  })

  // 7. P/E attractiveness (5%) — inverted
  drivers.push({
    name: 'P/E Attractiveness',
    rawScore: co.pe > 0 ? scoreByInverseThreshold(co.pe, [18, 28, 40, 55, 80]) : 5,
    weight: 0.05,
    contribution: 0,
    rationale: `P/E ${co.pe.toFixed(1)}×`,
  })

  // Compute contributions and weighted total
  let weightedTotal = 0
  for (const d of drivers) {
    d.contribution = Math.round(d.rawScore * d.weight * 100) / 100
    weightedTotal += d.contribution
  }
  weightedTotal = Math.round(weightedTotal * 100) / 100

  const normalised = Math.max(1, Math.min(10, Math.round(weightedTotal)))
  return { drivers, weightedTotal, normalised }
}

/** Score a higher-is-better metric using descending thresholds. */
function scoreByThreshold(value: number, thresholds: number[]): number {
  // thresholds sorted desc; e.g. [40, 30, 22, 15, 8] → 10, 8, 6, 4, 2, 1
  if (value >= thresholds[0]) return 10
  if (value >= thresholds[1]) return 8
  if (value >= thresholds[2]) return 6
  if (value >= thresholds[3]) return 4
  if (value >= thresholds[4]) return 2
  return 1
}

/** Score a lower-is-better metric using ascending thresholds. */
function scoreByInverseThreshold(value: number, thresholds: number[]): number {
  // thresholds sorted asc; e.g. [12, 18, 25, 35, 50] → 10, 8, 6, 4, 2, 1
  if (value <= thresholds[0]) return 10
  if (value <= thresholds[1]) return 8
  if (value <= thresholds[2]) return 6
  if (value <= thresholds[3]) return 4
  if (value <= thresholds[4]) return 2
  return 1
}
