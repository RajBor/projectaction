/**
 * Calculation-basis specifications for the investment-criteria filters.
 *
 * These popup specs document *how* each threshold would be estimated
 * from the Strategy Engine reference framework (deal-size tier, Ansoff
 * vector, sector median multiples, and so on). The on-screen input is
 * left blank by default — this module just documents the derivation
 * so an analyst clicking the ⓘ icon understands what to enter.
 *
 * Source reference: dealnector-strategy-engine_2.html — investCriteria
 * block (lines 1562–1570) and DEAL_SIZES map (lines 806–812).
 */

import type { WorkingDef } from '@/components/working/WorkingPopup'

// ── Deal-size → threshold tables (mirror the HTML reference) ────────

export const DEAL_SIZE_THRESHOLDS = {
  micro:  { label: 'Micro (under $25M)',       minRevUsd: '$2M',    minEbitda: 'break-even', maxMultiple: '2–5×',   equity: 'Bootstrapped / Angel' },
  small:  { label: 'Small ($25M–$150M)',       minRevUsd: '$10M',   minEbitda: '8%',         maxMultiple: '5–9×',   equity: 'PE Fund / Family Office' },
  mid:    { label: 'Mid-market ($150M–$750M)', minRevUsd: '$30M',   minEbitda: '12%',        maxMultiple: '8–14×',  equity: 'PE / Growth Capital' },
  large:  { label: 'Large ($750M–$3B)',        minRevUsd: '$100M',  minEbitda: '15%',        maxMultiple: '12–18×', equity: 'Institutional PE / SWF' },
  mega:   { label: 'Mega ($3B+)',              minRevUsd: '$300M',  minEbitda: '18%',        maxMultiple: '15–25×', equity: 'Consortium / Strategic' },
} as const

export type DealSizeTier = keyof typeof DEAL_SIZE_THRESHOLDS

export const ANSOFF_RETURN_EXPECTATION = {
  penetration:     { label: 'Market penetration',    irr: '15–20%', payback: '3–4 yrs', risk: 'Low' },
  market_dev:      { label: 'Market development',    irr: '18–25%', payback: '4–5 yrs', risk: 'Medium' },
  product_dev:     { label: 'Product development',   irr: '20–30%', payback: '4–6 yrs', risk: 'Medium' },
  diversification: { label: 'Diversification',       irr: '25–35%', payback: '5–7 yrs', risk: 'High' },
} as const

export type AnsoffKey = keyof typeof ANSOFF_RETURN_EXPECTATION

/**
 * Pick the deal-size tier from the current min/max deal-size band.
 * Roughly matches the HTML reference's revMap thresholds:
 *   micro < 25Cr, small 25–150, mid 150–750, large 750–3000, mega 3000+.
 */
export function pickDealSizeTier(minCr: number, maxCr: number): DealSizeTier {
  const mid = (minCr + maxCr) / 2 || maxCr || minCr
  if (mid <= 25) return 'micro'
  if (mid <= 150) return 'small'
  if (mid <= 750) return 'mid'
  if (mid <= 3000) return 'large'
  return 'mega'
}

/** Parse "12%" → 12, "break-even" → 0, "15%" → 15, unknown → null. */
function parsePercent(raw: string): number | null {
  const s = (raw || '').toLowerCase().trim()
  if (s.includes('break')) return 0
  const match = s.match(/(-?[\d.]+)\s*%/)
  if (!match) return null
  const n = parseFloat(match[1])
  return Number.isFinite(n) ? n : null
}

/** Parse "8–14×" → 14 (upper bound), "5–9×" → 9, unknown → null. */
function parseMultipleCeiling(raw: string): number | null {
  const s = (raw || '').replace(/[\u00D7\u2013\u2014]/g, (c) => (c === '×' ? '' : '-'))
  const match = s.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/)
  if (match) {
    const hi = parseFloat(match[2])
    return Number.isFinite(hi) ? hi : null
  }
  const single = s.match(/(\d+(?:\.\d+)?)/)
  if (single) {
    const n = parseFloat(single[1])
    return Number.isFinite(n) ? n : null
  }
  return null
}

/**
 * Auto-estimate the four investment-criteria fields from the current
 * deal-size band. Mirrors the HTML reference's investCriteria block
 * (L1562–1570 of dealnector-strategy-engine_2.html).
 *
 * Used by the op-identifier UI when the analyst opts in to auto-fill.
 */
export function autoEstimateInvestmentCriteria(
  minDealSizeCr: number,
  maxDealSizeCr: number,
): {
  tier: DealSizeTier
  minEbitdaMarginPct: number
  maxEvEbitdaMultiple: number
  maxCustomerConcentration: number
  esgRequired: boolean
  rationale: {
    minEbitdaMarginPct: string
    maxEvEbitdaMultiple: string
    maxCustomerConcentration: string
    esgRequired: string
  }
} {
  const tier = pickDealSizeTier(minDealSizeCr, maxDealSizeCr)
  const t = DEAL_SIZE_THRESHOLDS[tier]
  const ebitda = parsePercent(t.minEbitda) ?? 0
  const ceiling = parseMultipleCeiling(t.maxMultiple) ?? 14
  // Customer-concentration DD flag threshold — the 30% single-buyer
  // marker is the "red flag" line in the reference DD checklist; 50
  // is the inflection point where inferred risk turns structural.
  const customer = 50
  return {
    tier,
    minEbitdaMarginPct: ebitda,
    maxEvEbitdaMultiple: ceiling,
    maxCustomerConcentration: customer,
    esgRequired: true,
    rationale: {
      minEbitdaMarginPct: `Tier floor for ${t.label} (DEAL_SIZE_THRESHOLDS.${tier}.minEbitda = ${t.minEbitda})`,
      maxEvEbitdaMultiple: `Upper bound of tier-typical range (DEAL_SIZE_THRESHOLDS.${tier}.maxMultiple = ${t.maxMultiple})`,
      maxCustomerConcentration: `Standard DD flag — 50 is the structural-dependency inflection`,
      esgRequired: `Default on for policy-driven sectors (PLI / ALMM / RDSS universe)`,
    },
  }
}

// ── WorkingDef builders ────────────────────────────────────────────

export function minEbitdaMarginDerivation(tier: DealSizeTier): WorkingDef {
  const t = DEAL_SIZE_THRESHOLDS[tier]
  const rows = (Object.keys(DEAL_SIZE_THRESHOLDS) as DealSizeTier[]).map((k) => [
    DEAL_SIZE_THRESHOLDS[k].label,
    DEAL_SIZE_THRESHOLDS[k].minEbitda,
  ])
  return {
    icon: '%',
    title: 'Minimum EBITDA margin',
    subtitle: 'Hard screen — targets below the tier floor are dropped from the pool.',
    result: t.minEbitda,
    resultLabel: `Suggested for ${t.label}`,
    formula: 'floor(sector EBITDA band) × deal-size tier scaler',
    steps: [
      { label: 'Pick deal-size tier', calc: `min/max deal size → ${tier}`, result: t.label },
      { label: 'Apply tier floor', calc: `DEAL_SIZE_THRESHOLDS[${tier}].minEbitda`, result: t.minEbitda },
      { label: 'Rationale', calc: 'Mid / large deals must clear sector median margin; micro allows break-even because value is in talent / IP, not near-term cash' },
    ],
    table: {
      title: 'Deal-size tier → EBITDA floor (reference)',
      headers: ['Tier', 'Min EBITDA margin'],
      rows,
    },
    sources: [
      { name: 'Strategy Engine reference', color: 'var(--gold2)', note: 'dealnector-strategy-engine_2.html · investCriteria (L1564)' },
      { name: 'Sector medians', color: 'var(--cyan2)', note: 'CHAIN[].fin.eb — EBITDA margin band per value-chain stage' },
    ],
    notes: [
      { type: 'note', k: 'Leave blank', v: 'No screen. All targets pass this check.' },
      { type: 'warn', k: 'Missing data', v: 'Targets whose ebm is 0 / unreported are NOT dropped — only demonstrably weak margins fail.' },
    ],
  }
}

export function maxEvEbitdaDerivation(tier: DealSizeTier): WorkingDef {
  const t = DEAL_SIZE_THRESHOLDS[tier]
  const rows = (Object.keys(DEAL_SIZE_THRESHOLDS) as DealSizeTier[]).map((k) => [
    DEAL_SIZE_THRESHOLDS[k].label,
    DEAL_SIZE_THRESHOLDS[k].maxMultiple,
  ])
  return {
    icon: '×',
    title: 'Max EV/EBITDA entry multiple',
    subtitle: 'Hard screen — targets above the ceiling are dropped. Preserves disciplined entry economics.',
    result: t.maxMultiple,
    resultLabel: `Typical for ${t.label}`,
    formula: 'upper bound of tier-typical EV/EBITDA range',
    steps: [
      { label: 'Pick deal-size tier', calc: `min/max deal size → ${tier}`, result: t.label },
      { label: 'Read tier band', calc: `DEAL_SIZE_THRESHOLDS[${tier}].maxMultiple`, result: t.maxMultiple },
      { label: 'Set ceiling', calc: 'Use the top of the band as the hard stop; analyst can tighten further' },
    ],
    table: {
      title: 'Deal-size tier → multiple band',
      headers: ['Tier', 'Typical EV/EBITDA band'],
      rows,
    },
    sources: [
      { name: 'Strategy Engine reference', color: 'var(--gold2)', note: 'DEAL_SIZES.ebitda (L806–812)' },
    ],
    notes: [
      { type: 'note', k: 'Leave blank', v: 'No screen. Multiple is visible on the card but not enforced.' },
      { type: 'warn', k: 'Missing data', v: 'Targets with ev_eb ≤ 0 are NOT dropped.' },
    ],
  }
}

export function maxCustomerConcentrationDerivation(): WorkingDef {
  return {
    icon: '⚠',
    title: 'Max customer concentration',
    subtitle: 'Soft penalty. The proxy infers concentration from market-cap tier (no direct data in the universe).',
    result: '—',
    resultLabel: 'Enter a 0–100 score',
    formula: 'inferred concentration = f(target market cap) — penalty if > threshold',
    steps: [
      { label: 'Size proxy', calc: 'mktcap > ₹50,000 Cr → 25 (diversified)', result: '25' },
      { label: 'Size proxy', calc: '₹10,000–50,000 Cr → 40 (moderate)', result: '40' },
      { label: 'Size proxy', calc: '₹2,000–10,000 Cr → 55 (likely concentrated)', result: '55' },
      { label: 'Size proxy', calc: '< ₹2,000 Cr → 70 (heavy concentration risk)', result: '70' },
      { label: 'Penalty', calc: 'If inferred > threshold → preferenceBoost −0.02', result: '−2%' },
    ],
    table: {
      title: 'Commercial DD reference bands',
      headers: ['Band', 'Interpretation'],
      rows: [
        ['< 30', 'Diversified customer base; low dependency risk'],
        ['30–50', 'Moderate — track top-10 customer churn'],
        ['50–70', 'Elevated — structural dependency on few anchors'],
        ['> 70', 'Red flag — revenue concentration ≥ 30% with a single buyer'],
      ],
    },
    sources: [
      { name: 'Strategy Engine reference', color: 'var(--gold2)', note: 'DD checklist · Commercial row (L1914) — ">30% single buyer = flag"' },
      { name: 'Inferred from', color: 'var(--cyan2)', note: 'Target.mktcap — no direct customer-concentration field in the universe' },
    ],
    notes: [
      { type: 'note', k: 'Leave blank', v: 'No penalty applied. The proxy is never used as a hard screen.' },
      { type: 'warn', k: 'Proxy only', v: 'Replace with audited customer-count / top-10 revenue share when diligence data is available.' },
    ],
  }
}

export function esgRequiredDerivation(): WorkingDef {
  return {
    icon: '⬢',
    title: 'ESG baseline required',
    subtitle: 'Hard screen. Drops targets that have zero policy / ESG signal in the universe.',
    result: 'Off / On',
    resultLabel: 'Toggle',
    formula: 'passes IF (acqs > 0) OR (≥ 1 applicable policy hit via POLICIES × comp[])',
    steps: [
      { label: 'Policy signal', calc: 'POLICIES table checked for any overlap with target.comp[]' },
      { label: 'Curated flag', calc: 'DealNector acqs score > 0 implies analyst review done' },
      { label: 'Pass gate', calc: 'Either signal → pass; neither → drop from pool' },
    ],
    table: {
      title: 'What the screen accepts',
      headers: ['Target type', 'Accepted?'],
      rows: [
        ['Listed company with acqs rating', 'Yes — curated'],
        ['Atlas-seeded SME with PLI / ALMM / RDSS exposure', 'Yes — policy proxy'],
        ['Atlas-seeded SME with zero tags', 'No — dropped'],
      ],
    },
    sources: [
      { name: 'Strategy Engine reference', color: 'var(--gold2)', note: 'Risk register · Environmental / ESG compliance (L1366)' },
      { name: 'Policy universe', color: 'var(--green)', note: 'POLICIES (PLI-Solar · ALMM · RDSS · NEP-2032 · Green Hydrogen Mission · …)' },
    ],
    notes: [
      { type: 'warn', k: 'Proxy gate', v: 'This is a filter for *screenable* ESG signal, not a full ESG audit. Formal IFC Performance Standards review is the next step once shortlist is frozen.' },
    ],
  }
}

export function targetAssetTypesDerivation(): WorkingDef {
  return {
    icon: '◆',
    title: 'Target asset type',
    subtitle: 'Soft boost. Rewards targets whose integration direction matches the chosen strategic intent.',
    result: 'Multi-select',
    resultLabel: 'Up to 5 types',
    formula: 'classifyAssetType(integrationDir, acquirerSec, targetSec)',
    steps: [
      { label: 'Backward integration', calc: 'acquirer VC stage × target upstream of it', result: 'upstream' },
      { label: 'Forward integration', calc: 'target downstream of acquirer stage', result: 'downstream' },
      { label: 'Horizontal', calc: 'same stage, different product / capability', result: 'technology' },
      { label: 'Adjacent, same sector', calc: 'different VC, same industry', result: 'geographic' },
      { label: 'Adjacent, different sector', calc: 'cross-industry play', result: 'cross_sector' },
      { label: 'Boost', calc: 'match → preferenceBoost +0.03, no match → 0' },
    ],
    sources: [
      { name: 'Strategy Engine reference', color: 'var(--gold2)', note: 'Target assets tab (L1569, target-type taxonomy)' },
      { name: 'Classifier', color: 'var(--cyan2)', note: 'classifyAssetType() in investment-criteria.ts' },
    ],
    notes: [
      { type: 'note', k: 'No preset', v: 'When nothing is selected, asset type is reported on the card but not scored.' },
    ],
  }
}

export function countryRegimeDerivation(): WorkingDef {
  return {
    icon: '🏛',
    title: 'Policy regime preference',
    subtitle: 'Soft boost. Weights the pol-score of selected country regimes against sector export destinations.',
    result: 'avg(pol_score / 100) × 1.25',
    resultLabel: 'Capped at 1.0',
    formula: 'boost = min(0.04, regimeFit.score × 0.05)',
    steps: [
      { label: 'Match', calc: 'target sector → SECTOR_EXPORT_DESTINATIONS → region ids' },
      { label: 'Filter', calc: 'keep only regimes that are in preferredCountryRegimes' },
      { label: 'Average', calc: 'mean(pol_score) across matched regimes' },
      { label: 'Scale', calc: '(avg / 100) × 1.25 — India (88) alone → 1.0 cap' },
      { label: 'Boost', calc: 'contribute up to +0.04 to preferenceBoost' },
    ],
    table: {
      title: 'Pol scores (reference)',
      headers: ['Country', 'Pol score', 'Stance'],
      rows: [
        ['India', 88, 'Highly favourable · PLI · NEP-2032'],
        ['UAE', 82, 'Strongly favourable · Vision 2030'],
        ['USA', 72, 'Favourable domestic · IRA-driven · restrictive foreign'],
        ['Western Europe', 68, 'Net Zero mandate · CBAM constraints'],
        ['SEA + Korea', 64, 'Supply-chain diversification beneficiary'],
        ['South Asia (ex-India)', 48, 'Mixed · forex risk'],
        ['China', 35, 'Restrictive for foreign acquirers'],
      ],
    },
    sources: [
      { name: 'Strategy Engine reference', color: 'var(--gold2)', note: 'Policy regime cards (L1591–1592)' },
    ],
  }
}

export function tradeFlowDerivation(): WorkingDef {
  return {
    icon: '⇄',
    title: 'Trade-flow opportunity',
    subtitle: 'Soft boost. Rewards targets whose value-chain segment matches a preferred net-importer corridor.',
    result: 'best(oppty_score / 100)',
    resultLabel: 'Capped at 1.0',
    formula: 'boost = min(0.05, flowFit.score × 0.06)',
    steps: [
      { label: 'Map', calc: 'target.comp[] → matching TRADE_FLOW_MATRIX rows' },
      { label: 'Filter', calc: 'keep only rows listed in preferredTradeFlowCorridors' },
      { label: 'Select', calc: 'max opportunity score across matched rows' },
      { label: 'Score', calc: 'score × 0.06, capped at 0.05 of preferenceBoost' },
    ],
    table: {
      title: 'Oppty-score composition per row',
      headers: ['Input', 'Direction'],
      rows: [
        ['Import volume ($bn)', 'Higher → larger prize'],
        ['CAGR (%)', 'Higher → growth tailwind'],
        ['Tariff (%)', 'Higher → moat for domestic M&A'],
        ['Trade partner concentration', 'Concentrated → vulnerable, worth reshoring'],
      ],
    },
    sources: [
      { name: 'Strategy Engine reference', color: 'var(--gold2)', note: 'Trade-flow matrix (L1577–1589)' },
      { name: 'Scoring', color: 'var(--cyan2)', note: 'scoreTradeFlowFit() in algorithm.ts' },
    ],
  }
}
