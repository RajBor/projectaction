/**
 * CRVI threshold & calculator helpers.
 *
 * Pure functions — no React, no I/O. Every function takes a typed
 * input object and returns either a boolean alert flag or a numeric
 * result plus a short legal citation the UI can display alongside.
 *
 * The numbers chosen here reflect the statutory thresholds in force
 * as of April 2026:
 *   — SEBI SAST Reg 3:           creeping / takeover trigger at 25%
 *   — CCI combination thresholds: ₹2,500 Cr assets or ₹7,500 Cr
 *                                 turnover in India (post-2024 reset)
 *   — SARFAESI §13(2):            NPA > 90 days
 *   — Buy-back §68(2)(d):         post-buyback D/E ≤ 2:1
 *   — SICA (repealed — retained as a signal): net worth
 *                                 ≤ 50% of peak over last 4 FYs
 */

export interface CRVIInputs {
  /** Company identity */
  name: string
  cin?: string
  listed: boolean
  /** Paid-up share capital (₹ Cr) */
  pucCr: number
  reservesCr: number
  /** Security premium reserve (₹ Cr) — relevant for capital reduction */
  secPremiumCr: number
  /** Debit balance in P&L (₹ Cr, positive number) */
  debitPlCr: number
  /** Secured debt + unsecured debt (₹ Cr) */
  securedDebtCr: number
  unsecuredDebtCr: number
  /** Net worth history for the last 4 FYs, oldest → newest (₹ Cr) */
  netWorthHistoryCr: number[]
  /** Latest revenue (₹ Cr) */
  revCr: number
  ebitdaCr: number
  patCr: number
  accLossCr: number
  totalAssetsCr: number
  fixedAssetsCr: number
  intangiblesCr: number
  /** India revenue used for CCI threshold */
  indiaTurnoverCr: number
  /** Global (group) turnover for CCI international test (USD millions) */
  globalAssetsUsdMn: number
  globalRevUsdMn: number
  /** Shareholding — % */
  promoterPct: number
  publicPct: number
  totalShares: number
  faceVal: number
  /** Current market price, 52-week high, 60-day VWAP */
  cmp: number
  h52: number
  vwap60: number
  mcapCr: number
  /** Secured-creditor position */
  npaPrincipalCr?: number
  overdueDays?: number
  /** Acquisition target details (for swap-ratio / open-offer calcs) */
  tName?: string
  tAssetsCr?: number
  tTurnoverCr?: number
  tNwCr?: number
  tEbitdaCr?: number
  tCmp?: number
  tNegotiatedPrice?: number
  tPostHoldPct?: number
}

// ── 1. SEBI SAST — Takeover / Creeping Trigger ───────────────

export interface SASTResult {
  triggered: boolean
  basis: string
  minOpenOfferPrice: number // per share
  openOfferSize: number // shares
  law: string
}

export function sastOpenOfferCheck(inp: CRVIInputs, postHoldPct?: number): SASTResult {
  const hold = postHoldPct ?? inp.tPostHoldPct ?? 0
  const triggered = hold >= 25
  const creeping = inp.promoterPct >= 25 && inp.promoterPct < 75 && hold - inp.promoterPct > 5

  const basis = triggered
    ? `Post-transaction holding ${hold.toFixed(1)}% ≥ 25% SAST trigger`
    : creeping
    ? `Creeping acquisition > 5% within 25–75% band`
    : 'Below SAST trigger — no open offer required'

  // Price = highest of negotiated, 60-day VWAP, 26-week high, 2-week high
  const minOpenOfferPrice = Math.max(
    inp.tNegotiatedPrice || 0,
    inp.vwap60 || 0,
    inp.h52 || 0,
    inp.cmp || 0
  )

  const openOfferSize = Math.round(inp.totalShares * 0.26)

  return {
    triggered: triggered || creeping,
    basis,
    minOpenOfferPrice,
    openOfferSize,
    law: 'SEBI SAST Reg 3 / 4 / 8',
  }
}

// ── 2. CCI Combination Threshold ────────────────────────────

export interface CCIResult {
  filingRequired: boolean
  basis: string
  formType: 'I' | 'II' | 'none'
  feeLakh: number
  law: string
}

export function cciThresholdCheck(inp: CRVIInputs): CCIResult {
  const combinedIndiaAssetsCr = (inp.totalAssetsCr || 0) + (inp.tAssetsCr || 0)
  const combinedIndiaTurnoverCr = (inp.indiaTurnoverCr || 0) + (inp.tTurnoverCr || 0)
  const combinedGroupAssetsUsdMn = inp.globalAssetsUsdMn || 0
  const combinedGroupRevUsdMn = inp.globalRevUsdMn || 0

  // India: ₹2,500 Cr assets or ₹7,500 Cr turnover
  const indiaThresholdBreached =
    combinedIndiaAssetsCr > 2500 || combinedIndiaTurnoverCr > 7500

  // International (group): US$1.25 Bn global assets (with ₹1,250 Cr India) OR
  // US$3.75 Bn global turnover (with ₹3,750 Cr India).
  const internationalBreached =
    (combinedGroupAssetsUsdMn > 1250 && combinedIndiaAssetsCr > 1250) ||
    (combinedGroupRevUsdMn > 3750 && combinedIndiaTurnoverCr > 3750)

  const filingRequired = indiaThresholdBreached || internationalBreached

  // Heuristic: Form II if combined market share likely > 15% in same line,
  // proxied here by transaction size > ₹5,000 Cr. Tune with user input.
  const formType: 'I' | 'II' | 'none' = filingRequired
    ? (combinedIndiaAssetsCr > 5000 ? 'II' : 'I')
    : 'none'

  const feeLakh = formType === 'II' ? 90 : formType === 'I' ? 30 : 0

  const basis = filingRequired
    ? `Combined India assets ₹${combinedIndiaAssetsCr.toLocaleString('en-IN')} Cr / turnover ₹${combinedIndiaTurnoverCr.toLocaleString('en-IN')} Cr crosses CCI thresholds`
    : 'Combined metrics below CCI thresholds — no mandatory filing'

  return {
    filingRequired,
    basis,
    formType,
    feeLakh,
    law: 'Competition Act §§5–6; CCI (Combination) Regs 2011',
  }
}

// ── 3. SARFAESI / NPA Eligibility ────────────────────────────

export interface SARFAESIResult {
  eligible: boolean
  basis: string
  minNoticeDays: number
  law: string
}

export function sarfaesiEligibility(inp: CRVIInputs): SARFAESIResult {
  const npa = inp.npaPrincipalCr || 0
  const days = inp.overdueDays || 0
  const eligible = npa >= 0.01 && days > 90 // ≥ ₹1 lakh, > 90 days

  const basis = eligible
    ? `Account NPA for ${days} days (> 90); principal ₹${npa.toFixed(2)} Cr — §13(2) notice valid`
    : npa < 0.01
    ? 'Principal below ₹1 lakh — SARFAESI not invokable'
    : `Only ${days} days overdue (< 90) — account not yet NPA`

  return {
    eligible,
    basis,
    minNoticeDays: 60,
    law: 'SARFAESI Act 2002 §§13(2), 13(4)',
  }
}

// ── 4. SICA / Sick-Industrial-Company Signal ────────────────
// SICA repealed in 2016, but the net-worth-erosion test is still
// a useful amber indicator for imminent IBC §7 petitions.

export interface SICAResult {
  sick: boolean
  basis: string
  erosionPct: number
  law: string
}

export function sicaSickCheck(inp: CRVIInputs): SICAResult {
  const nws = (inp.netWorthHistoryCr || []).filter((n) => Number.isFinite(n))
  if (nws.length === 0) {
    return {
      sick: false,
      basis: 'Insufficient net-worth history',
      erosionPct: 0,
      law: 'SICA 1985 (retained as signal only)',
    }
  }
  const peak = Math.max(...nws)
  const latest = nws[nws.length - 1]
  const erosionPct = peak > 0 ? ((peak - latest) / peak) * 100 : 0
  const sick = latest <= peak * 0.5

  const basis = sick
    ? `Net worth eroded ${erosionPct.toFixed(1)}% from peak ₹${peak.toFixed(0)} Cr — sick-company signal`
    : `Net worth at ${(100 - erosionPct).toFixed(1)}% of peak — company not sick under SICA test`

  return { sick, basis, erosionPct, law: 'SICA 1985 (signal only, repealed 2016)' }
}

// ── 5. Buy-back Headroom ────────────────────────────────────

export interface BuybackResult {
  eligible: boolean
  maxBuybackCr: number
  postDe: number
  basis: string
  law: string
}

export function buybackHeadroom(inp: CRVIInputs, proposedBuybackCr = 0): BuybackResult {
  const puc = inp.pucCr || 0
  const reserves = inp.reservesCr || 0
  const totalDebt = (inp.securedDebtCr || 0) + (inp.unsecuredDebtCr || 0)
  const netWorth = puc + reserves
  // §68(2)(b): buy-back ≤ 25% of paid-up capital + free reserves
  const cap25 = (puc + reserves) * 0.25
  // §68(2)(d): post-buyback D/E ≤ 2:1
  const postBuybackNw = netWorth - proposedBuybackCr
  const postDe = postBuybackNw > 0 ? totalDebt / postBuybackNw : Infinity

  const cap10 = (puc + reserves) * 0.1 // board-only route
  const maxBuybackCr = Math.max(0, Math.min(cap25, netWorth - totalDebt / 2))

  const eligible = proposedBuybackCr > 0 && postDe <= 2 && proposedBuybackCr <= cap25

  const basis = eligible
    ? `Buy-back of ₹${proposedBuybackCr.toFixed(0)} Cr within 25% cap (₹${cap25.toFixed(0)} Cr); post-D/E ${postDe.toFixed(2)} ≤ 2:1`
    : proposedBuybackCr > cap25
    ? `Proposed buy-back ₹${proposedBuybackCr.toFixed(0)} Cr exceeds 25% cap (₹${cap25.toFixed(0)} Cr)`
    : postDe > 2
    ? `Post-buyback D/E ${postDe.toFixed(2)} > 2:1 — §68(2)(d) breach`
    : `Headroom: up to ₹${maxBuybackCr.toFixed(0)} Cr via SR; ₹${cap10.toFixed(0)} Cr via board resolution`

  return {
    eligible,
    maxBuybackCr,
    postDe,
    basis,
    law: 'Companies Act 2013 §68; SEBI Buy-back Regs 2018',
  }
}

// ── 6. Capital-Reduction Need ────────────────────────────────

export interface CapRedResult {
  recommended: boolean
  absorbableCr: number
  basis: string
  law: string
}

export function capitalReductionCheck(inp: CRVIInputs): CapRedResult {
  const debit = inp.debitPlCr || 0
  const puc = inp.pucCr || 0
  const secPrem = inp.secPremiumCr || 0
  // Accumulated losses absorbable up to PUC + securities-premium write-down
  const absorbableCr = Math.min(debit, puc * 0.5 + secPrem)

  const recommended = debit > 0 && puc > 0
  const basis = recommended
    ? `Debit P&L ₹${debit.toFixed(0)} Cr blocks distribution — capital reduction can absorb ₹${absorbableCr.toFixed(0)} Cr`
    : 'No debit P&L or insufficient capital base — capital reduction not indicated'

  return {
    recommended,
    absorbableCr,
    basis,
    law: 'Companies Act 2013 §66',
  }
}

// ── 7. Swap-Ratio Calculator (Miheer Mafatlal basis) ─────────

export interface SwapRatioResult {
  ratio: number // acquirer shares per target share
  acquirerPerShare: number
  targetPerShare: number
  basis: string
  law: string
}

export function swapRatioCalc(inp: CRVIInputs): SwapRatioResult {
  // Simple method: value per share = market cap / shares OR ebitda-based EV/share.
  const acquirerPerShare = inp.mcapCr * 1e7 / Math.max(1, inp.totalShares)
  const tMcapCr = (inp.tCmp || 0) * ((inp.tAssetsCr && inp.tNwCr) ? 1 : 1) // user supplies t-mcap; fallback to CMP×1
  const targetPerShare = inp.tCmp || (inp.tNwCr || 0)
  const ratio = targetPerShare > 0 && acquirerPerShare > 0
    ? targetPerShare / acquirerPerShare
    : 0

  const basis = ratio > 0
    ? `${ratio.toFixed(3)} acquirer shares per target share (based on value/share)`
    : 'Insufficient data — provide target CMP or NW/share'

  return {
    ratio,
    acquirerPerShare,
    targetPerShare,
    basis,
    law: 'Miheer Mafatlal v. Mafatlal Industries (SC, 1996); Cos Act §232',
  }
}

// ── 8. Slump-Sale Tax (§50B) ─────────────────────────────────

export interface SlumpSaleResult {
  lumpSumCr: number
  netWorthCr: number
  capitalGainCr: number
  taxCr: number
  isLTCG: boolean
  basis: string
  law: string
}

export function slumpSaleTax(
  lumpSumCr: number,
  netWorthCr: number,
  heldMonths: number
): SlumpSaleResult {
  const capitalGainCr = Math.max(0, lumpSumCr - netWorthCr)
  const isLTCG = heldMonths > 36
  // Post-2024: LTCG on slump sale at 12.5% (indexation removed for companies).
  // STCG on slump sale taxed at 22% (company corporate rate, simplified).
  const rate = isLTCG ? 0.125 : 0.22
  const taxCr = capitalGainCr * rate

  const basis = `Gain ₹${capitalGainCr.toFixed(0)} Cr × ${(rate * 100).toFixed(1)}% = ₹${taxCr.toFixed(1)} Cr (${isLTCG ? 'LTCG' : 'STCG'})`

  return {
    lumpSumCr,
    netWorthCr,
    capitalGainCr,
    taxCr,
    isLTCG,
    basis,
    law: 'Income Tax Act §§2(42C), 50B',
  }
}

// ── 9. Composite Score Rollup ────────────────────────────────
// Given applicable outcomes from the wizard + threshold checks,
// produce a priority-ordered list of strategies with combined
// scoring (wizard-match bonus + four-lens score).

import { OUTCOMES, STRATEGIES, type Outcome, type Strategy } from './data'

export interface RankedStrategy {
  strategy: Strategy
  outcome: Outcome | null
  reason: string
}

export function rankedRecommendations(
  outcomeIds: string[],
  inp: CRVIInputs
): RankedStrategy[] {
  const results: RankedStrategy[] = []
  const seen = new Set<string>()

  for (const oid of outcomeIds) {
    const out = OUTCOMES[oid]
    if (!out) continue
    const strat = STRATEGIES.find((s) => s.id === out.strategy)
    if (!strat || seen.has(strat.id)) continue
    seen.add(strat.id)
    results.push({
      strategy: strat,
      outcome: out,
      reason: out.rationale,
    })
  }

  // Append additional high-score strategies not already surfaced, as "also-consider"
  const topGeneral = [...STRATEGIES]
    .sort((a, b) => b.score - a.score)
    .filter((s) => !seen.has(s.id))
    .slice(0, 3)
  for (const s of topGeneral) {
    results.push({ strategy: s, outcome: null, reason: s.trigger })
  }

  return results
}
