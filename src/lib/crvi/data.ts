/**
 * CRVI — Corporate Restructuring, Valuation & Insolvency framework.
 *
 * Adapted from the PP-CRVI-2014 ICSI syllabus. This module exposes:
 *
 *   STRATEGIES  — 25 canonical restructuring / valuation / insolvency
 *                 strategies, each scored /20 across the four-lens
 *                 Strategic-Tactical-Economic-Compliance model used in
 *                 the CRVI Intelligence Studio reference.
 *   ALGO        — the 23-node decision wizard (A1…F4) that walks a user
 *                 from company profile → applicable strategy class. Each
 *                 node references the governing statute.
 *   OUTCOMES    — 17 terminal recommendations the algorithm can land on,
 *                 each carrying a headline strategy, a composite score
 *                 (/20), the law it sits under, the execution checklist
 *                 and the legal rationale.
 *   CASE_LAWS   — 15 landmark Indian judgements / ICSI exam-grade cases
 *                 referenced across the framework.
 *
 * Everything here is a plain typed constant — no runtime dependencies.
 * UI modules import these constants and render them; scoring /
 * thresholding logic lives in `./thresholds.ts`.
 */

export type CRVIPart = 'A' | 'B' | 'C' // A=Restructuring, B=Valuation, C=Insolvency

export interface Strategy {
  /** Stable id used in ALGO references. */
  id: string
  /** Human-readable short name. */
  name: string
  /** Syllabus part (A / B / C). */
  part: CRVIPart
  /** Composite score out of 20. */
  score: number
  /** Strategic lens score /5. */
  s: number
  /** Tactical lens score /5. */
  t: number
  /** Economic lens score /5. */
  e: number
  /** Compliance lens score /5. */
  c: number
  /** Governing law / section reference. */
  law: string
  /** Trigger condition a strategist should watch for. */
  trigger: string
  /** One-line execution hint. */
  action: string
}

export const STRATEGIES: Strategy[] = [
  // ── Part A: Corporate Restructuring ───────────────────────
  { id: 'merger_h', name: 'Horizontal Merger', part: 'A', score: 18, s: 5, t: 4, e: 5, c: 4,
    law: 'Companies Act 2013 §§230–232; SEBI LODR; CCI §§5–6',
    trigger: 'Peer with complementary capacity + CCI threshold headroom',
    action: 'Scheme of amalgamation → NCLT → Regional Director → Registrar' },
  { id: 'merger_v', name: 'Vertical Merger', part: 'A', score: 17, s: 5, t: 4, e: 5, c: 3,
    law: 'Companies Act 2013 §§230–232; Competition Act 2002 §§5–6',
    trigger: 'Captive supplier / customer acquirable at < 1.0× NAV',
    action: 'Backward / forward integration via scheme — mandatory CCI if thresholds breached' },
  { id: 'demerger', name: 'Demerger / Spin-off', part: 'A', score: 18, s: 5, t: 4, e: 5, c: 4,
    law: 'Companies Act 2013 §232(2); Income Tax §2(19AA); SEBI Circular 2017',
    trigger: 'Undervalued non-core division dragging blended multiple',
    action: 'Scheme of arrangement — tax-neutral if §2(19AA) conditions met' },
  { id: 'slump_sale', name: 'Slump Sale', part: 'A', score: 15, s: 4, t: 4, e: 4, c: 3,
    law: 'Income Tax §§2(42C), 50B; Companies Act 2013 §180(1)(a)',
    trigger: 'Non-core undertaking saleable for lump-sum without itemisation',
    action: 'BTA — LTCG if held >36m; requires special resolution' },
  { id: 'asset_sale', name: 'Itemised Asset Sale', part: 'A', score: 12, s: 3, t: 3, e: 3, c: 3,
    law: 'Companies Act 2013 §180(1)(a); GST Act',
    trigger: 'Specific assets marketable but going-concern value diluted',
    action: 'Board / SR approval; each asset separately valued + transferred' },
  { id: 'takeover', name: 'Takeover / Open Offer', part: 'A', score: 17, s: 5, t: 4, e: 4, c: 4,
    law: 'SEBI SAST Regulations 2011 Regs 3, 4, 8',
    trigger: 'Promoter stake buy crossing 25% (or 5% creeping within 25–75%)',
    action: 'Mandatory 26% open offer at highest of six statutory prices' },
  { id: 'buyback', name: 'Share Buy-back', part: 'A', score: 14, s: 3, t: 4, e: 4, c: 3,
    law: 'Companies Act 2013 §§68–70; SEBI Buy-back Regs 2018',
    trigger: 'Surplus cash + D/E ≤ 2:1 post-buyback + share price < intrinsic value',
    action: 'Max 25% paid-up capital; 1-year cooling period between buy-backs' },
  { id: 'cap_red', name: 'Capital Reduction', part: 'A', score: 13, s: 4, t: 3, e: 3, c: 3,
    law: 'Companies Act 2013 §66; NCLT confirmation',
    trigger: 'Accumulated losses impairing distributable reserves',
    action: 'Special resolution + NCLT order to adjust debit P&L against paid-up capital' },
  { id: 'pmi', name: 'Post-Merger Integration', part: 'A', score: 16, s: 5, t: 5, e: 3, c: 3,
    law: 'Ind AS 103; SEBI LODR continuous disclosure',
    trigger: 'Day-1 readiness gap between buyer & target ops',
    action: '100-day plan across 7 integration streams; synergy capture tracked weekly' },
  { id: 'cross_border', name: 'Cross-Border M&A', part: 'A', score: 18, s: 5, t: 4, e: 5, c: 4,
    law: 'Companies Act 2013 §234; FEMA 1999; RBI Master Direction',
    trigger: 'Foreign target with Indian nexus + ODI / inbound route open',
    action: 'NCLT + RBI approvals; AD bank reporting; Form FC-GPR / ODI' },
  { id: 'joint_venture', name: 'Joint Venture / Strategic Alliance', part: 'A', score: 15, s: 5, t: 4, e: 3, c: 3,
    law: 'Companies Act 2013; Contract Act 1872; FEMA (if foreign partner)',
    trigger: 'Complementary capability but target not for sale',
    action: 'SHA + SSA; choose between equity JV, contractual JV or LLP structure' },

  // ── Part B: Valuation ─────────────────────────────────────
  { id: 'dcf', name: 'DCF Valuation', part: 'B', score: 19, s: 5, t: 4, e: 5, c: 5,
    law: 'ICAI Valuation Standards 103; Companies (Registered Valuers) Rules 2017',
    trigger: 'Forecastable FCF + stable WACC + discernible terminal profile',
    action: 'Two-stage model; sensitivity on g, WACC & terminal multiple' },
  { id: 'market_val', name: 'Market / Comparable Multiple', part: 'B', score: 19, s: 5, t: 5, e: 4, c: 5,
    law: 'ICAI VS 102; SEBI LODR Reg 30 (price-sensitive info)',
    trigger: 'Liquid listed peer set ≥ 4 comparables',
    action: 'EV/EBITDA, P/E, P/B medians ± size / growth adjustments' },
  { id: 'asset_val', name: 'Asset-Based Valuation', part: 'B', score: 17, s: 4, t: 4, e: 4, c: 5,
    law: 'ICAI VS 101; Income Tax Rule 11UA',
    trigger: 'Asset-heavy business, loss-making operations, or wind-down',
    action: 'Net Asset Value = realisable assets − all liabilities' },
  { id: 'intangibles', name: 'Intangibles / Brand Valuation', part: 'B', score: 19, s: 5, t: 4, e: 5, c: 5,
    law: 'Ind AS 38; ICAI VS on intangible assets',
    trigger: 'Acquired brand / IP / customer contracts materially exceed book',
    action: 'Relief-from-royalty or multi-period excess earnings method' },
  { id: 'financial_inst', name: 'Financial Instrument Valuation', part: 'B', score: 17, s: 4, t: 4, e: 4, c: 5,
    law: 'Ind AS 109 / 113; SEBI ICDR for preferential issue',
    trigger: 'Convertibles, ESOPs, warrants or complex debt outstanding',
    action: 'Black-Scholes / binomial / fair-value waterfall' },
  { id: 'swap_ratio', name: 'Swap Ratio Determination', part: 'B', score: 16, s: 4, t: 4, e: 4, c: 4,
    law: 'Companies Act 2013 §232; SEBI Listed-Entity Scheme Circular 2017',
    trigger: 'Share-for-share merger between two listed entities',
    action: 'Registered valuer report: simple average of DCF, Market & NAV' },

  // ── Part C: Insolvency ────────────────────────────────────
  { id: 'bifr_rehab', name: 'BIFR / Sick-Company Rehab (historic)', part: 'C', score: 13, s: 3, t: 3, e: 4, c: 3,
    law: 'SICA 1985 (repealed 2016 — replaced by IBC)',
    trigger: 'Net worth ≤ 50% of peak over last 4 years (retained as trigger signal)',
    action: 'Route now via IBC §7/§10; SICA is reference only' },
  { id: 'sarfaesi', name: 'SARFAESI Enforcement', part: 'C', score: 16, s: 4, t: 4, e: 4, c: 4,
    law: 'SARFAESI Act 2002 §§13(2), 13(4)',
    trigger: 'Secured NPA > 90 days + ≥ ₹1 lakh dues',
    action: 'S-13(2) notice → 60 days → possession → auction / DRT if resisted' },
  { id: 'drt_recovery', name: 'DRT Debt Recovery', part: 'C', score: 14, s: 3, t: 4, e: 4, c: 3,
    law: 'RDDB Act 1993; SARFAESI §17',
    trigger: 'Unsecured / partly secured dues ≥ ₹20 lakh',
    action: 'OA before DRT; Recovery Certificate enforced by Recovery Officer' },
  { id: 'cirp', name: 'CIRP under IBC', part: 'C', score: 19, s: 5, t: 5, e: 5, c: 4,
    law: 'IBC 2016 §§7, 9, 10; CIRP Regs 2016',
    trigger: 'Default ≥ ₹1 Cr uncured for ≥ 14 days',
    action: 'Application to NCLT → IRP → CoC → Resolution Plan in 180 (+90) days' },
  { id: 'prepack', name: 'Pre-Packaged Insolvency (MSME)', part: 'C', score: 15, s: 4, t: 4, e: 4, c: 3,
    law: 'IBC Chapter III-A (inserted 2021, §§54A–54P)',
    trigger: 'MSME in default with 66% financial-creditor support',
    action: 'Debtor-in-possession plan filed with NCLT — 120-day window' },
  { id: 'wind_comp', name: 'Winding-Up by Tribunal', part: 'C', score: 11, s: 3, t: 3, e: 3, c: 2,
    law: 'Companies Act 2013 §§271–272',
    trigger: 'CIRP failed or just-and-equitable grounds proved',
    action: 'Petition → Official Liquidator → asset realisation → distribution waterfall' },
  { id: 'wind_vol', name: 'Voluntary Liquidation', part: 'C', score: 12, s: 3, t: 3, e: 3, c: 3,
    law: 'IBC §59; Voluntary Liquidation Regs 2017',
    trigger: 'Solvent company (declaration by majority directors) wishing to exit',
    action: 'Board declaration → SR → Liquidator → dissolution by NCLT' },
]

// ── Decision Algorithm ───────────────────────────────────────
// The wizard starts at node A1 and traverses yes/no edges until it
// reaches an OUTCOME reference. Every edge is annotated with the
// statute that justifies branching.

export interface AlgoNode {
  id: string
  q: string
  /** Either the next node id, or an OUTCOMES key prefixed with `OUT:`. */
  yes: string
  /** Same convention as `yes`. */
  no: string
  law: string
  hint?: string
}

export const ALGO: Record<string, AlgoNode> = {
  // ── Branch A: Listing & Control Gate ─────
  A1: { id: 'A1', q: 'Is the subject a listed company on NSE / BSE?',
    yes: 'A2', no: 'B1',
    law: 'SEBI LODR Regulations 2015',
    hint: 'Listed status triggers SAST, LODR and takeover disclosures.' },
  A2: { id: 'A2', q: 'Is the proposed acquirer crossing the 25% SAST threshold?',
    yes: 'OUT:OO_TRIGGER', no: 'A3',
    law: 'SEBI SAST Reg 3(1)',
    hint: 'Crossing 25% mandates a 26% open offer.' },
  A3: { id: 'A3', q: 'Is the acquirer in the 25–75% band and creeping > 5% this FY?',
    yes: 'OUT:OO_TRIGGER', no: 'A4',
    law: 'SEBI SAST Reg 3(2)' },
  A4: { id: 'A4', q: 'Does the transaction breach CCI asset / turnover thresholds?',
    yes: 'OUT:CCI_FILING', no: 'B1',
    law: 'Competition Act §§5, 6 + CCI (Combination) Regs 2011',
    hint: 'India assets > ₹2,500 Cr or turnover > ₹7,500 Cr (post-2024 thresholds).' },

  // ── Branch B: Restructuring Form ─────────
  B1: { id: 'B1', q: 'Is the objective scale / market-share via combining two going-concerns?',
    yes: 'B2', no: 'C1',
    law: 'Companies Act 2013 §§230–232' },
  B2: { id: 'B2', q: 'Are both entities in the same line of business?',
    yes: 'OUT:MERGER_H', no: 'B3',
    law: 'Competition Act §5' },
  B3: { id: 'B3', q: 'Is one entity a supplier or customer of the other?',
    yes: 'OUT:MERGER_V', no: 'OUT:CONG_MERGER',
    law: 'Companies Act 2013 §232' },

  // ── Branch C: Divestiture / Carve-Out ────
  C1: { id: 'C1', q: 'Is a non-core / under-valued division being separated?',
    yes: 'C2', no: 'D1',
    law: 'Companies Act 2013 §232(2); IT Act §2(19AA)' },
  C2: { id: 'C2', q: 'Is the transferee intended to be a separately listed vehicle?',
    yes: 'OUT:DEMERGER_QUAL', no: 'C3',
    law: 'SEBI Circular 2017 on listed-scheme compliance' },
  C3: { id: 'C3', q: 'Is the undertaking being sold for a lump-sum without itemised values?',
    yes: 'OUT:SLUMP_LTCG', no: 'OUT:ASSET_SALE',
    law: 'IT §§2(42C), 50B' },

  // ── Branch D: Capital / Equity Tools ─────
  D1: { id: 'D1', q: 'Is there surplus cash with share price below intrinsic value?',
    yes: 'D2', no: 'E1',
    law: 'Companies Act 2013 §68' },
  D2: { id: 'D2', q: 'Is post-buyback D/E forecast ≤ 2:1 and accumulated-loss ratio acceptable?',
    yes: 'OUT:BUYBACK', no: 'D3',
    law: 'Companies Act 2013 §68(2); SEBI Buy-back Regs 2018' },
  D3: { id: 'D3', q: 'Is there a debit balance in P&L impairing distributable reserves?',
    yes: 'OUT:CAP_RED', no: 'E1',
    law: 'Companies Act 2013 §66' },

  // ── Branch E: Distress / Insolvency ──────
  E1: { id: 'E1', q: 'Does the company have a default ≥ ₹1 Cr outstanding for ≥ 14 days?',
    yes: 'E2', no: 'F1',
    law: 'IBC 2016 §4, §7' },
  E2: { id: 'E2', q: 'Is the company an MSME eligible for pre-pack?',
    yes: 'OUT:PREPACK', no: 'E3',
    law: 'IBC §54A' },
  E3: { id: 'E3', q: 'Does the secured creditor hold ≥ 60% in value and wish enforcement?',
    yes: 'OUT:SARFAESI_PATH', no: 'E4',
    law: 'SARFAESI §13(2)' },
  E4: { id: 'E4', q: 'Is insolvency resolution (CIRP) still a viable going-concern option?',
    yes: 'OUT:CIRP', no: 'E5',
    law: 'IBC §§7, 9, 10' },
  E5: { id: 'E5', q: 'Is the company solvent and simply wishing to wind down?',
    yes: 'OUT:WIND_VOL', no: 'OUT:WIND_COMP',
    law: 'IBC §59 vs Companies Act §§271–272' },

  // ── Branch F: Cross-Border / Misc. ───────
  F1: { id: 'F1', q: 'Is the transaction cross-border (Indian ⇄ foreign entity)?',
    yes: 'F2', no: 'OUT:JV_OR_REVIEW',
    law: 'Companies Act 2013 §234; FEMA 1999' },
  F2: { id: 'F2', q: 'Is an outbound direct investment (ODI) involved?',
    yes: 'OUT:CROSS_BORDER_ODI', no: 'F3',
    law: 'FEMA ODI Regulations 2022' },
  F3: { id: 'F3', q: 'Is it an inbound FDI under the automatic route sector?',
    yes: 'OUT:CROSS_BORDER_FDI', no: 'F4',
    law: 'FEMA FDI Regulations 2017' },
  F4: { id: 'F4', q: 'Is government route approval required (Press Note 3 neighbouring-country)?',
    yes: 'OUT:PN3_GOV', no: 'OUT:CROSS_BORDER_ODI',
    law: 'Press Note 3 (2020 Series)' },
}

// ── Terminal outcomes ────────────────────────────────────────

export interface Outcome {
  id: string
  label: string
  strategy: string // references Strategy.id
  score: number // /20 composite
  law: string
  /** Ordered execution checklist. */
  action: string[]
  /** Legal rationale shown with the recommendation. */
  rationale: string
}

export const OUTCOMES: Record<string, Outcome> = {
  OO_TRIGGER: {
    id: 'OO_TRIGGER', label: 'Mandatory Open Offer',
    strategy: 'takeover', score: 17,
    law: 'SEBI SAST Reg 3 / 4 / 8',
    action: [
      'Public announcement within 1 working day of trigger',
      'Detailed public statement within 5 working days',
      'Letter of offer to SEBI within 5 working days of DPS',
      'Open offer ≥ 26% of voting capital',
      'Price = highest of (a) negotiated, (b) volume-weighted 60-day avg, (c) 26-week avg, (d) 2-week avg',
    ],
    rationale: 'Crossing 25% voting rights (or > 5% creeping in 25–75%) compels a tender offer under SAST Reg 3. Non-compliance invites SEBI Reg 32 penalties.',
  },
  CCI_FILING: {
    id: 'CCI_FILING', label: 'CCI Pre-Combination Filing Required',
    strategy: 'merger_h', score: 17,
    law: 'Competition Act §6(2); CCI (Combination) Regs 2011',
    action: [
      'File Form I (green) or Form II (complex) with CCI',
      'Standstill — no closing until 210 days or CCI approval (Phase 1 in 30 days)',
      'Pay fee: ₹30 lakh (Form I) or ₹90 lakh (Form II)',
      'Publish combination summary on CCI portal',
    ],
    rationale: 'Combined India assets > ₹2,500 Cr or turnover > ₹7,500 Cr triggers mandatory notification. Gun-jumping invites up to 1% turnover penalty.',
  },
  MERGER_H: {
    id: 'MERGER_H', label: 'Horizontal Merger — Scheme of Amalgamation',
    strategy: 'merger_h', score: 18,
    law: 'Companies Act 2013 §§230–232',
    action: [
      'Board approval + scheme drafting (share-exchange + appointed date)',
      'Registered-valuer swap-ratio report',
      'NCLT application; notice to creditors + members',
      'Creditor / shareholder meetings (3/4 value majority)',
      'NCLT sanction order → ROC filing within 30 days',
    ],
    rationale: 'Same-line merger is the textbook scale play. Expect CCI interplay, SAST triggers (if listed), and stamp-duty on the final order.',
  },
  MERGER_V: {
    id: 'MERGER_V', label: 'Vertical Merger — Integration Scheme',
    strategy: 'merger_v', score: 17,
    law: 'Companies Act 2013 §232',
    action: [
      'Integration thesis + transfer-pricing review (arm\'s-length test)',
      'Scheme filing + Registered Valuer report',
      'Dual NCLT filing if benches differ',
      'Continue existing customer / supplier contracts post-effective date',
    ],
    rationale: 'Backward or forward integration locks in supply or demand. CCI screening is usually lighter than horizontal but anti-competitive foreclosure still reviewed.',
  },
  CONG_MERGER: {
    id: 'CONG_MERGER', label: 'Conglomerate Combination — Alternative Structures',
    strategy: 'joint_venture', score: 14,
    law: 'Companies Act 2013 §230; SEBI LODR',
    action: [
      'Re-examine acquisition thesis — synergy evidence thin for pure conglomerate',
      'Consider JV / SPV instead of full merger',
      'If proceeding: additional scrutiny for managerial bandwidth',
    ],
    rationale: 'Strategic literature shows conglomerate mergers destroy value unless clear financial / tax synergy exists. Default to JV / strategic alliance.',
  },
  DEMERGER_QUAL: {
    id: 'DEMERGER_QUAL', label: 'Qualifying Demerger (Tax-Neutral)',
    strategy: 'demerger', score: 18,
    law: 'Companies Act 2013 §232(2); IT §2(19AA)',
    action: [
      'Identify and ring-fence undertaking (≥ all assets + liabilities transferred)',
      'Issue shares to resulting company shareholders proportionately',
      'Maintain ≥ 3/4 book value continuity; no cash consideration',
      'NCLT sanction + listing of resulting company',
    ],
    rationale: 'All five §2(19AA) conditions must be met for capital-gains and carry-forward-loss neutrality. Breach taxes the transfer as a sale.',
  },
  SLUMP_LTCG: {
    id: 'SLUMP_LTCG', label: 'Slump Sale — Going-Concern Transfer',
    strategy: 'slump_sale', score: 15,
    law: 'IT §§2(42C), 50B',
    action: [
      'Business-Transfer Agreement with lump-sum consideration',
      'Valuer certificate per Rule 11UAE (post-2021)',
      'Capital-gain = sale consideration − net worth; LTCG if undertaking held > 36m',
      'File Form 3CEA before filing ITR',
    ],
    rationale: 'Slump sale avoids itemised VAT / stamp on movables but requires pure lump-sum and going-concern transfer.',
  },
  ASSET_SALE: {
    id: 'ASSET_SALE', label: 'Itemised Asset Sale',
    strategy: 'asset_sale', score: 12,
    law: 'Companies Act 2013 §180(1)(a)',
    action: [
      'Special resolution for sale of "whole / substantially whole" undertaking',
      'Separate valuation + conveyance per asset class',
      'GST on movables; stamp duty on immovable conveyance',
    ],
    rationale: 'Used when specific assets have higher realisable value than going-concern. More compliance cost than slump sale.',
  },
  BUYBACK: {
    id: 'BUYBACK', label: 'Share Buy-Back',
    strategy: 'buyback', score: 14,
    law: 'Companies Act 2013 §68; SEBI Buy-back Regs 2018',
    action: [
      'Board resolution (up to 10% of paid-up + free reserves) OR Special resolution (up to 25%)',
      'Post-buyback D/E ≤ 2:1 mandatory',
      'Declaration of solvency filed with ROC',
      'Extinguish shares within 7 days of completion',
      '1-year cool-off before next buy-back',
    ],
    rationale: 'Efficient return of surplus capital when share price < intrinsic value. Tax now on company (20% + SC + cess) post-2020.',
  },
  CAP_RED: {
    id: 'CAP_RED', label: 'Capital Reduction — Accumulated-Loss Wash',
    strategy: 'cap_red', score: 13,
    law: 'Companies Act 2013 §66',
    action: [
      'Special resolution + NCLT petition',
      'Notice to SEBI / stock exchange / creditors',
      'NCLT order adjusting paid-up capital against debit P&L',
      'ROC filing + updated share certificates',
    ],
    rationale: 'Clears accumulated losses from the balance sheet — restores dividend and buy-back eligibility without fresh infusion.',
  },
  PREPACK: {
    id: 'PREPACK', label: 'Pre-Packaged Insolvency (MSME)',
    strategy: 'prepack', score: 15,
    law: 'IBC Chapter III-A (§§54A–54P)',
    action: [
      'Special resolution by corporate debtor',
      'Obtain 66% financial-creditor approval for Base Plan',
      'Appoint RP; file Form 1 with NCLT',
      'Plan submission within 90 days; NCLT approval within 120 days',
    ],
    rationale: 'Debtor-in-possession model for MSMEs preserves promoter control while ring-fencing creditor rights. Lower cost and time than full CIRP.',
  },
  SARFAESI_PATH: {
    id: 'SARFAESI_PATH', label: 'SARFAESI Secured-Creditor Enforcement',
    strategy: 'sarfaesi', score: 16,
    law: 'SARFAESI Act 2002 §§13(2), 13(4)',
    action: [
      'Classify account as NPA (> 90 days overdue)',
      'Issue §13(2) demand notice — 60-day window for borrower',
      'On non-payment, take §13(4) possession (symbolic / physical)',
      'Valuation + auction through approved process',
      'DRT recourse if borrower resists under §17',
    ],
    rationale: 'Fastest route for secured creditors with ≥ 60% value to realise security without court permission. Borrower right to contest lies with DRT.',
  },
  CIRP: {
    id: 'CIRP', label: 'Corporate Insolvency Resolution Process',
    strategy: 'cirp', score: 19,
    law: 'IBC 2016 §§7, 9, 10',
    action: [
      'Application under §7 (financial creditor), §9 (operational), or §10 (corporate debtor)',
      'Moratorium declared on admission',
      'Interim Resolution Professional → Committee of Creditors',
      'Resolution plans invited; CoC vote with 66%',
      'NCLT approval within 180 days (+90 day extension)',
    ],
    rationale: 'CIRP is the primary going-concern resolution tool under IBC. 330-day outer limit including litigation.',
  },
  WIND_VOL: {
    id: 'WIND_VOL', label: 'Voluntary Liquidation (IBC §59)',
    strategy: 'wind_vol', score: 12,
    law: 'IBC §59; Voluntary Liquidation Regs 2017',
    action: [
      'Directors\' declaration of solvency',
      'Special resolution to wind up + appoint liquidator',
      'Creditor approval (2/3 in value) if company has debts',
      'Liquidator distributes assets → applies to NCLT for dissolution',
    ],
    rationale: 'Solvent-exit route — faster than tribunal winding-up. No debts or all debts paid is the acid test.',
  },
  WIND_COMP: {
    id: 'WIND_COMP', label: 'Compulsory Winding-Up by Tribunal',
    strategy: 'wind_comp', score: 11,
    law: 'Companies Act 2013 §§271–272',
    action: [
      'Petition by company / creditor / contributory / RoC / Central Govt',
      'NCLT admission + Official Liquidator appointment',
      'Asset realisation and distribution per §53 waterfall',
      'Final dissolution order',
    ],
    rationale: 'Last-resort path when CIRP fails or just-and-equitable grounds succeed. Slower than IBC voluntary liquidation.',
  },
  CROSS_BORDER_FDI: {
    id: 'CROSS_BORDER_FDI', label: 'Inbound FDI — Automatic Route',
    strategy: 'cross_border', score: 18,
    law: 'FEMA 1999; FEMA (Non-Debt Instruments) Rules 2019',
    action: [
      'Confirm sector cap + entry route + sectoral conditions',
      'Valuation per RBI pricing guidelines',
      'File Form FC-GPR within 30 days of issue',
      'Annual Return on Foreign Liabilities & Assets (FLA) by 15 July',
    ],
    rationale: 'Most solar / T&D manufacturing sectors permit 100% FDI under automatic route, subject to PN-3 screening for land-border countries.',
  },
  CROSS_BORDER_ODI: {
    id: 'CROSS_BORDER_ODI', label: 'Outbound Direct Investment (ODI)',
    strategy: 'cross_border', score: 18,
    law: 'FEMA (Overseas Investment) Rules 2022',
    action: [
      'ODI route: up to 400% of net worth under Automatic Route',
      'AD-bank reporting + Form FC',
      'Annual Performance Report by 31 December',
      'Realisation of export proceeds / dividends within 9 months',
    ],
    rationale: 'The 2022 Overseas Investment Rules consolidate ODI + OPI. Bona-fide business test applied by AD bank.',
  },
  PN3_GOV: {
    id: 'PN3_GOV', label: 'Government Route — Press Note 3',
    strategy: 'cross_border', score: 15,
    law: 'Press Note 3 (2020 Series) — DPIIT',
    action: [
      'Inter-ministerial DPIIT approval required',
      'Consortium with non-neighbouring-country partner if possible',
      'Expect 4–6 month review; national-security angle scrutinised',
    ],
    rationale: 'Any beneficial-owner from a land-border country (China, Bangladesh, Pakistan, Nepal, Myanmar, Bhutan, Afghanistan) needs Government route.',
  },
  JV_OR_REVIEW: {
    id: 'JV_OR_REVIEW', label: 'Joint Venture / Strategic Alliance — Re-examine Thesis',
    strategy: 'joint_venture', score: 15,
    law: 'Companies Act 2013; Contract Act 1872',
    action: [
      'Draft SHA + SSA / LLP deed',
      'Reserved matters + veto list',
      'Exit mechanics (RoFR / RoFO / tag-drag)',
    ],
    rationale: 'When the algorithm doesn\'t land on a clear restructuring or insolvency path, a JV typically preserves optionality while the commercial case develops.',
  },
}

// ── Landmark case-laws ───────────────────────────────────────

export interface CaseLaw {
  id: string
  title: string
  court: string
  year: number
  principle: string
  applies: string // area: 'Merger' | 'Takeover' | 'Valuation' | 'IBC' etc.
}

export const CASE_LAWS: CaseLaw[] = [
  { id: 'hindustan_lever', title: 'Hindustan Lever Employees\' Union v. HLL', court: 'Supreme Court', year: 1995,
    principle: 'Court\'s role in merger sanction is limited to testing bona fides and public interest — not commercial wisdom.',
    applies: 'Merger' },
  { id: 'miheer_mafatlal', title: 'Miheer Mafatlal v. Mafatlal Industries', court: 'Supreme Court', year: 1996,
    principle: 'Share-exchange ratio fair if determined by registered valuers using reasonable methods.',
    applies: 'Swap Ratio / Valuation' },
  { id: 'reliance_natural', title: 'Reliance Natural Resources v. Reliance Industries', court: 'Supreme Court', year: 2010,
    principle: 'Family arrangement / demerger cannot override statutory approval requirements.',
    applies: 'Demerger' },
  { id: 'vodafone_essar', title: 'Vodafone International Holdings v. UOI', court: 'Supreme Court', year: 2012,
    principle: 'Indirect transfer of Indian assets outside India not taxable without specific nexus (pre-2012 amendment).',
    applies: 'Cross-border' },
  { id: 'essar_steel', title: 'CoC of Essar Steel v. Satish Kumar Gupta', court: 'Supreme Court', year: 2019,
    principle: 'Commercial wisdom of Committee of Creditors is non-justiciable; equitable treatment does not mean identical treatment.',
    applies: 'IBC / CIRP' },
  { id: 'swiss_ribbons', title: 'Swiss Ribbons v. UOI', court: 'Supreme Court', year: 2019,
    principle: 'IBC constitutional validity upheld; distinction between financial and operational creditors valid.',
    applies: 'IBC' },
  { id: 'innoventive', title: 'Innoventive Industries v. ICICI Bank', court: 'Supreme Court', year: 2017,
    principle: 'Default under IBC is triggered even for a single rupee beyond due date; SICA provisions stand repealed.',
    applies: 'IBC' },
  { id: 'arcelormittal', title: 'ArcelorMittal India v. Satish Kumar Gupta', court: 'Supreme Court', year: 2018,
    principle: '§29A ineligibility extends to connected persons; resolution applicant disqualification is strict.',
    applies: 'IBC §29A' },
  { id: 'mardia_chemicals', title: 'Mardia Chemicals v. UOI', court: 'Supreme Court', year: 2004,
    principle: 'SARFAESI upheld; pre-deposit for DRT appeal valid with tribunal discretion.',
    applies: 'SARFAESI' },
  { id: 'shri_ram', title: 'Shri Ram Piston v. Ushaco', court: 'NCLT Delhi', year: 2018,
    principle: 'Demerger scheme must satisfy all five limbs of §2(19AA) — partial compliance disallows tax neutrality.',
    applies: 'Demerger' },
  { id: 'subhkam', title: 'Subhkam Ventures v. SEBI', court: 'SAT', year: 2010,
    principle: 'Negative / veto rights alone do not constitute "control" under SAST (later reversed by SEBI consent).',
    applies: 'Takeover / Control' },
  { id: 'tulip_star', title: 'CIT v. Tulip Star Hotels', court: 'Supreme Court', year: 2012,
    principle: 'Slump sale consideration must be lump-sum; assigning value to individual assets disqualifies §50B.',
    applies: 'Slump Sale' },
  { id: 'bharti_airtel', title: 'Bharti Airtel — Loop Telecom scheme', court: 'Bombay HC', year: 2014,
    principle: 'Scheme rejected where primary purpose was tax avoidance without commercial substance.',
    applies: 'Merger / Anti-Avoidance' },
  { id: 'cipla_sf', title: 'Cipla Limited (Buy-back)', court: 'SEBI Order', year: 2020,
    principle: 'Buy-back offer size and pricing must align with disclosed reasons; SEBI can direct revision.',
    applies: 'Buy-back' },
  { id: 'vedanta_cairn', title: 'Vedanta–Cairn Merger', court: 'NCLT Mumbai', year: 2017,
    principle: 'Cross-holding structures in merger scheme allowed only with promoter-lockup and minority protections.',
    applies: 'Merger / Cross-holding' },
]
