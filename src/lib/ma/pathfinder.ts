/**
 * Pathfinder — The Ally-vs-Acquire Decision Engine.
 *
 * Integrates two HBR-grade frameworks into a single deterministic scoring
 * engine for acquisition strategy decisions:
 *
 *   1. Dyer, Kale & Singh (HBR 2004) — "When to Ally, When to Acquire"
 *      Five resource/market factors that map to one of four pathways:
 *          NONEQUITY_ALLIANCE | EQUITY_ALLIANCE | ACQUISITION | WALK_AWAY
 *
 *   2. 7-Phase Decision Algorithm
 *      Frame → Intelligence → Options → Evaluate → Decide → Execute → Learn
 *      Used to generate a phase-by-phase execution roadmap for the chosen
 *      pathway so the acquirer gets not just a verdict but a plan.
 *
 * The engine is deliberately DETERMINISTIC (no LLM call) so the logic is
 * transparent, defensible in an M&A committee, reproducible given the
 * same inputs, and works offline. Each factor casts votes across the four
 * pathways; the pathway with the highest vote total wins. Confidence is
 * the winning pathway's share of total votes.
 *
 * All scoring logic is derived from the decision matrix in the HBR 2004
 * paper, Table 1. See README.md of strategic-decision-engine for the
 * canonical reference.
 */

import type { Company } from '@/lib/data/companies'

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/**
 * Acquisition mandate the acquirer has set BEFORE the analysis.
 * The engine checks whether the optimal pathway matches this mandate
 * and surfaces any mismatch as a "mandate tension" diagnostic — this
 * is where most board-level frustration originates (e.g., CEO wants
 * full buyout but factors scream "JV only").
 */
export type Mandate =
  | 'complete_buyout'   // 100% acquisition
  | 'majority_stake'    // >50% equity, operational control
  | 'minority_invest'   // <50% equity, financial interest
  | 'joint_venture'     // new legal entity, shared equity
  | 'partnership'       // contractual, nonequity alliance

export const MANDATE_LABELS: Record<Mandate, string> = {
  complete_buyout: 'Complete Buyout (100%)',
  majority_stake: 'Majority Stake (>50%)',
  minority_invest: 'Minority Investment (<50%)',
  joint_venture: 'Joint Venture (new entity)',
  partnership: 'Contractual Partnership',
}

/** Three-level intensity rating used for every Dyer-Singh factor. */
export type Rating = 'low' | 'medium' | 'high'

/**
 * The five factors from Dyer/Kale/Singh HBR 2004, Table 1.
 * Each rating maps deterministically to votes across the four pathways.
 */
export interface DyerSinghFactors {
  /** Synergy type — how deeply the two firms' operations must interlock.
   *  low = modular (independent value creation) → nonequity
   *  med = sequential (one firm's output feeds the other) → equity alliance
   *  high = reciprocal (continuous deep collaboration) → acquisition */
  synergyType: Rating
  /** Resource nature — asset mix in play.
   *  low = hard assets (plants, machines) → alliance works
   *  med = mixed
   *  high = soft assets (people, brand, IP, culture) → acquisition
   *        because soft assets walk out the door under alliance */
  resourceNature: Rating
  /** Redundancy — how much overlap exists.
   *  low = little overlap (complementary) → nonequity
   *  med = some overlap → equity alliance
   *  high = significant overlap → acquisition unlocks the synergy */
  redundancy: Rating
  /** Market uncertainty — how predictable is the market evolution.
   *  low = stable, predictable → acquisition (commit & own)
   *  med = moderate → acquisition
   *  high = volatile, disruptive → equity alliance (keep optionality) */
  marketUncertainty: Rating
  /** Competition intensity — how contested is the asset.
   *  low = few bidders → nonequity works, we're patient
   *  med = several interested → equity alliance locks us in
   *  high = heavily contested → acquisition or we lose access */
  competitionIntensity: Rating
}

export type Pathway =
  | 'NONEQUITY_ALLIANCE'
  | 'EQUITY_ALLIANCE'
  | 'ACQUISITION'
  | 'WALK_AWAY'

export const PATHWAY_LABELS: Record<Pathway, string> = {
  NONEQUITY_ALLIANCE: 'Nonequity Alliance',
  EQUITY_ALLIANCE: 'Equity Alliance / JV',
  ACQUISITION: 'Acquisition',
  WALK_AWAY: 'Walk Away',
}

export const PATHWAY_COLORS: Record<Pathway, string> = {
  NONEQUITY_ALLIANCE: 'var(--cyan2)',
  EQUITY_ALLIANCE: 'var(--gold2)',
  ACQUISITION: 'var(--green)',
  WALK_AWAY: 'var(--red)',
}

/** One row of the factor-by-factor breakdown shown in the results panel. */
export interface FactorVerdict {
  key: keyof DyerSinghFactors
  label: string
  rating: Rating
  pathwayVotes: Record<Pathway, number>
  interpretation: string
}

/** One step of the 7-phase roadmap tailored to the chosen pathway. */
export interface RoadmapPhase {
  num: number
  name: string
  headline: string
  actions: string[]
}

/** Mandate-vs-optimal-pathway tension diagnostic. */
export interface MandateFit {
  status: 'aligned' | 'upgrade' | 'downgrade' | 'mismatch'
  note: string
}

/** Affordability diagnostic driven by acquirer financials vs target EV. */
export interface AffordabilityFit {
  ratio: number          // target.ev / acquirer.mktcap
  status: 'comfortable' | 'stretch' | 'transformative' | 'unaffordable'
  note: string
}

/** Full engine output. */
export interface PathwayRecommendation {
  pathway: Pathway
  confidence: number              // 0..1, winner's share of total votes
  pathwayScores: Record<Pathway, number>  // raw votes per pathway
  factorVerdicts: FactorVerdict[]
  mandateFit: MandateFit
  affordability: AffordabilityFit
  roadmap: RoadmapPhase[]
  headline: string                // one-line executive summary
  rationale: string[]             // 3-5 reasoning bullets
}

// ─────────────────────────────────────────────────────────────
// Voting matrices — one entry per factor per rating.
// Each cell is the vote weight that rating contributes to that pathway.
// Matrix derived from Dyer/Kale/Singh HBR 2004 Table 1.
// ─────────────────────────────────────────────────────────────

type VoteMatrix = Record<Rating, Record<Pathway, number>>

const SYNERGY_VOTES: VoteMatrix = {
  low:    { NONEQUITY_ALLIANCE: 2, EQUITY_ALLIANCE: 1, ACQUISITION: 0, WALK_AWAY: 0 },
  medium: { NONEQUITY_ALLIANCE: 0, EQUITY_ALLIANCE: 2, ACQUISITION: 1, WALK_AWAY: 0 },
  high:   { NONEQUITY_ALLIANCE: 0, EQUITY_ALLIANCE: 1, ACQUISITION: 2, WALK_AWAY: 0 },
}

const RESOURCE_VOTES: VoteMatrix = {
  low:    { NONEQUITY_ALLIANCE: 2, EQUITY_ALLIANCE: 1, ACQUISITION: 0, WALK_AWAY: 0 },
  medium: { NONEQUITY_ALLIANCE: 1, EQUITY_ALLIANCE: 2, ACQUISITION: 1, WALK_AWAY: 0 },
  high:   { NONEQUITY_ALLIANCE: 0, EQUITY_ALLIANCE: 1, ACQUISITION: 2, WALK_AWAY: 0 },
}

const REDUNDANCY_VOTES: VoteMatrix = {
  low:    { NONEQUITY_ALLIANCE: 2, EQUITY_ALLIANCE: 1, ACQUISITION: 0, WALK_AWAY: 0 },
  medium: { NONEQUITY_ALLIANCE: 0, EQUITY_ALLIANCE: 2, ACQUISITION: 1, WALK_AWAY: 0 },
  high:   { NONEQUITY_ALLIANCE: 0, EQUITY_ALLIANCE: 0, ACQUISITION: 2, WALK_AWAY: 0 },
}

// Note: market uncertainty inverts the usual ordering — HIGH uncertainty
// favours keeping optionality (equity alliance), LOW uncertainty rewards
// commitment (acquisition). This is the counter-intuitive insight of the
// HBR framework and is preserved here exactly.
const UNCERTAINTY_VOTES: VoteMatrix = {
  low:    { NONEQUITY_ALLIANCE: 0, EQUITY_ALLIANCE: 0, ACQUISITION: 2, WALK_AWAY: 0 },
  medium: { NONEQUITY_ALLIANCE: 0, EQUITY_ALLIANCE: 1, ACQUISITION: 2, WALK_AWAY: 0 },
  high:   { NONEQUITY_ALLIANCE: 1, EQUITY_ALLIANCE: 2, ACQUISITION: 0, WALK_AWAY: 0 },
}

const COMPETITION_VOTES: VoteMatrix = {
  low:    { NONEQUITY_ALLIANCE: 2, EQUITY_ALLIANCE: 1, ACQUISITION: 0, WALK_AWAY: 0 },
  medium: { NONEQUITY_ALLIANCE: 0, EQUITY_ALLIANCE: 2, ACQUISITION: 1, WALK_AWAY: 0 },
  high:   { NONEQUITY_ALLIANCE: 0, EQUITY_ALLIANCE: 0, ACQUISITION: 2, WALK_AWAY: 0 },
}

// Walk-away trigger: if the target's internal scorecard says PASS/AVOID,
// walk away outweighs everything else. Without this, the engine would
// always recommend SOME pathway even on a clearly terrible target.
function walkAwayBonus(targetFlag: string): number {
  const f = (targetFlag || '').toUpperCase()
  if (f === 'AVOID') return 8       // overwhelming — 5 factors × 2 votes = 10
  if (f === 'PASS') return 5
  return 0
}

// ─────────────────────────────────────────────────────────────
// Factor interpretation text
// ─────────────────────────────────────────────────────────────

const FACTOR_COPY: Record<keyof DyerSinghFactors, { label: string; interp: Record<Rating, string> }> = {
  synergyType: {
    label: 'Synergy type',
    interp: {
      low: 'Modular — the two firms can create value independently; contractual linkage is enough.',
      medium: 'Sequential — one firm\'s output feeds the other; equity alignment increases commitment.',
      high: 'Reciprocal — deep, continuous collaboration; integration unlocks synergy fully only under common ownership.',
    },
  },
  resourceNature: {
    label: 'Resource nature',
    interp: {
      low: 'Hard assets dominate (plant, machinery, inventory) — these transfer cleanly under contract.',
      medium: 'Mixed asset base — equity structure aligns interests around joint investment.',
      high: 'Soft assets lead (people, brand, IP, culture) — these walk out the door unless acquired and retained.',
    },
  },
  redundancy: {
    label: 'Redundancy',
    interp: {
      low: 'Little operational overlap — the firms are complementary; no need to combine.',
      medium: 'Moderate overlap — equity alliance captures duplicated-capacity savings without forced integration.',
      high: 'Significant overlap — only acquisition delivers the cost synergy from consolidation.',
    },
  },
  marketUncertainty: {
    label: 'Market uncertainty',
    interp: {
      low: 'Stable, predictable market — commit capital and own the asset outright.',
      medium: 'Moderate uncertainty — ownership still wins, but with staged integration.',
      high: 'Volatile / disruptive market — keep optionality via equity alliance until signal clarifies.',
    },
  },
  competitionIntensity: {
    label: 'Competition intensity',
    interp: {
      low: 'Few rival bidders — contractual access is patient and cheap.',
      medium: 'Several interested parties — equity lock-in prevents defection.',
      high: 'Heavily contested — move to acquisition or lose access entirely.',
    },
  },
}

// ─────────────────────────────────────────────────────────────
// Mandate fit logic
// ─────────────────────────────────────────────────────────────

/**
 * Classify the mandate's degree of control commitment on a 0..3 scale so
 * we can compare it with the optimal pathway's implied control level.
 *   0 = partnership
 *   1 = minority invest
 *   2 = JV
 *   3 = majority stake
 *   4 = complete buyout
 */
function mandateIntensity(m: Mandate): number {
  switch (m) {
    case 'partnership': return 0
    case 'minority_invest': return 1
    case 'joint_venture': return 2
    case 'majority_stake': return 3
    case 'complete_buyout': return 4
  }
}

function pathwayIntensity(p: Pathway): number {
  switch (p) {
    case 'WALK_AWAY': return -1
    case 'NONEQUITY_ALLIANCE': return 0
    case 'EQUITY_ALLIANCE': return 2
    case 'ACQUISITION': return 4
  }
}

function computeMandateFit(mandate: Mandate, pathway: Pathway): MandateFit {
  if (pathway === 'WALK_AWAY') {
    return {
      status: 'mismatch',
      note: `Target scorecard says WALK AWAY. The ${MANDATE_LABELS[mandate].toLowerCase()} mandate does not apply — revisit target selection before proceeding with any deal structure.`,
    }
  }
  const mi = mandateIntensity(mandate)
  const pi = pathwayIntensity(pathway)
  const delta = mi - pi
  if (Math.abs(delta) <= 1) {
    return {
      status: 'aligned',
      note: `Your ${MANDATE_LABELS[mandate].toLowerCase()} mandate aligns with the optimal ${PATHWAY_LABELS[pathway].toLowerCase()} pathway. Proceed with confidence.`,
    }
  }
  if (delta > 1) {
    return {
      status: 'downgrade',
      note: `Your mandate (${MANDATE_LABELS[mandate].toLowerCase()}) is MORE aggressive than the framework supports (${PATHWAY_LABELS[pathway].toLowerCase()}). Risk: over-committing capital for synergies you cannot capture. Consider downgrading the structure.`,
    }
  }
  return {
    status: 'upgrade',
    note: `Your mandate (${MANDATE_LABELS[mandate].toLowerCase()}) is LESS aggressive than the framework supports (${PATHWAY_LABELS[pathway].toLowerCase()}). Risk: leaving synergy value and control on the table. Consider upgrading the structure.`,
  }
}

// ─────────────────────────────────────────────────────────────
// Affordability fit — target EV vs acquirer market cap
// ─────────────────────────────────────────────────────────────

function computeAffordability(acquirer: Company, target: Company): AffordabilityFit {
  const acqMcap = Number(acquirer.mktcap) || 0
  const tgtEv = Number(target.ev) || Number(target.mktcap) || 0
  if (acqMcap <= 0 || tgtEv <= 0) {
    return {
      ratio: 0,
      status: 'comfortable',
      note: 'Affordability check skipped — missing market cap or EV on one of the parties.',
    }
  }
  const ratio = tgtEv / acqMcap
  if (ratio <= 0.1) {
    return {
      ratio,
      status: 'comfortable',
      note: `Target EV ≈ ${(ratio * 100).toFixed(0)}% of your market cap. Tuck-in scale — finance from balance sheet.`,
    }
  }
  if (ratio <= 0.3) {
    return {
      ratio,
      status: 'stretch',
      note: `Target EV ≈ ${(ratio * 100).toFixed(0)}% of your market cap. Material deal — expect bridge financing and ~20% equity dilution if all-stock.`,
    }
  }
  if (ratio <= 0.8) {
    return {
      ratio,
      status: 'transformative',
      note: `Target EV ≈ ${(ratio * 100).toFixed(0)}% of your market cap. Transformative — requires board approval, rights issue, and staged regulatory clearance (CCI, sector-specific).`,
    }
  }
  return {
    ratio,
    status: 'unaffordable',
    note: `Target EV ≈ ${(ratio * 100).toFixed(0)}% of your market cap — larger than the acquirer. Reverse-merger territory; consider equity alliance with option to acquire instead.`,
  }
}

// ─────────────────────────────────────────────────────────────
// 7-Phase roadmap generator
// ─────────────────────────────────────────────────────────────

/**
 * Generate a pathway-specific 7-phase roadmap. Each phase has a headline
 * and 3 concrete actions. The roadmap differs by pathway — a nonequity
 * alliance's "Execute" phase is about contract drafting, while an
 * acquisition's is about CCI filing and purchase price allocation.
 */
function buildRoadmap(pathway: Pathway, acquirer: Company, target: Company, mandate: Mandate): RoadmapPhase[] {
  const acqName = acquirer.name
  const tgtName = target.name
  const isAcq = pathway === 'ACQUISITION'
  const isEquityAlliance = pathway === 'EQUITY_ALLIANCE'
  const isNonEquity = pathway === 'NONEQUITY_ALLIANCE'
  const isWalk = pathway === 'WALK_AWAY'

  if (isWalk) {
    return [
      { num: 1, name: 'Frame', headline: 'Document the walk-away decision', actions: [
        `Record the strategic rationale against ${tgtName} for board minutes`,
        'Capture the specific red flag(s) that triggered WALK AWAY',
        'Confirm no informal commitments have been made that require unwind',
      ]},
      { num: 2, name: 'Intelligence', headline: 'Preserve signal for future deals', actions: [
        `Archive ${tgtName} diligence file for 24-month re-evaluation`,
        'Track quarterly updates on the red-flag metrics that may resolve',
        'Note any market moves that would change the thesis (e.g., ALMM policy shift)',
      ]},
      { num: 3, name: 'Options', headline: 'Redirect mandate to adjacent targets', actions: [
        `Re-run the Pathfinder on the next 3 targets in ${acqName}'s M&A Radar`,
        'Consider a greenfield build alternative for the same strategic objective',
        'Evaluate whether a completely different strategic move (partnership, license) meets the original goal',
      ]},
      { num: 4, name: 'Evaluate', headline: 'Communicate externally (if needed)', actions: [
        'If non-public discussions occurred, prepare consistent messaging for both parties',
        'Brief advisors to unwind any standstill or NDA obligations cleanly',
        'Protect confidentiality of both acquirer and target deliberations',
      ]},
      { num: 5, name: 'Decide', headline: 'Formal close of deal pursuit', actions: [
        'Circulate the WALK AWAY memo to the strategy committee',
        'Release any internal resources ring-fenced for the deal',
        'Redirect the deal team to the next-priority target',
      ]},
      { num: 6, name: 'Execute', headline: 'No execution — redirect and learn', actions: [
        'Update the deal pipeline to mark target as "re-evaluate in 12 months"',
        'Reallocate the diligence budget to the next-priority pursuit',
        'Preserve contact with target for future optionality',
      ]},
      { num: 7, name: 'Learn', headline: 'Extract lessons for the next deal', actions: [
        'Post-mortem: which factor(s) drove the WALK decision? Were they detectable earlier?',
        'Update the firm\'s target screening template with the new red-flag patterns',
        'Share the analytical playbook with other deal teams',
      ]},
    ]
  }

  return [
    {
      num: 1,
      name: 'Frame',
      headline: isAcq
        ? 'Define acquisition rationale + walk-away price'
        : isEquityAlliance
          ? 'Scope the joint venture — what goes in, what stays out'
          : 'Scope the contractual relationship',
      actions: isAcq ? [
        `Articulate why ${acqName} acquires ${tgtName} in one sentence (scale / tech / market / talent)`,
        'Set walk-away price using 3 valuation methods (DCF, comps, precedent transactions)',
        `Type 1 vs Type 2 decision: ${mandate === 'complete_buyout' ? 'Type 1 — irreversible, requires full board' : 'Type 2 — staged, decision reversible'}`,
      ] : isEquityAlliance ? [
        `Define the specific scope of the ${acqName}–${tgtName} JV (product/geography/timeframe)`,
        'Set equity split: typically 51/49 for operational leadership; 50/50 only with strong governance',
        'Define exit path: buyout clauses, IPO option, put/call rights',
      ] : [
        `Scope the contractual relationship — supply / distribution / licensing / co-marketing`,
        'Duration + renewal terms (typically 3-5 years with renewal option)',
        'Exclusivity: carve out products/geographies that stay non-exclusive',
      ],
    },
    {
      num: 2,
      name: 'Intelligence',
      headline: 'Outside view + competitive intel',
      actions: [
        `Base rate: ${isAcq ? '70-90% of acquisitions destroy value (Harvard Business Review) — what makes this one the exception?' : 'Alliance failure rates are 30-70% — what governance makes this one sustainable?'}`,
        `Map ${tgtName}'s recent 2-year performance against ${acqName}'s acquisition thesis`,
        `Scan for competing bidders / partners — move faster or lose the asset`,
      ],
    },
    {
      num: 3,
      name: 'Options',
      headline: 'Enumerate at least 3 alternative paths',
      actions: [
        `Build vs buy: can ${acqName} construct this capability organically in 24 months?`,
        isAcq ? `Could a JV with ${tgtName} capture 80% of the value at 30% of the cost?` : `Could full acquisition deliver meaningfully more synergy than the alliance path?`,
        'Do-nothing option: what happens in 24 months if no deal is signed?',
      ],
    },
    {
      num: 4,
      name: 'Evaluate',
      headline: 'Risk-adjusted scoring + pre-mortem',
      actions: [
        `Pre-mortem: assume the deal fails in 3 years — what went wrong?`,
        isAcq ? 'Synergy schedule: when do specific ₹ synergies hit the P&L? Who owns each one?' : 'Governance design: decision rights, deadlock resolution, escalation paths',
        'Regulatory / CCI exposure + timing risk',
      ],
    },
    {
      num: 5,
      name: 'Decide',
      headline: 'Set conviction threshold + capture dissent',
      actions: [
        `Minimum conviction to proceed: ${isAcq ? '8/10 board support, no material dissenting vote' : '6/10 board support with active sponsors'}`,
        'Name 1-2 decision dissenters and document their objections in the board minutes',
        `${isAcq ? 'Green-light triggers definitive agreement drafting' : 'Green-light triggers MOU / term sheet negotiation'}`,
      ],
    },
    {
      num: 6,
      name: 'Execute',
      headline: isAcq
        ? 'CCI filing, PPA, 30/60/90 integration plan'
        : isEquityAlliance
          ? 'Shareholder agreement + board composition'
          : 'Contract execution + KPI definition',
      actions: isAcq ? [
        'File CCI pre-notification (typically 30 days before SPA signing for large deals)',
        'Purchase Price Allocation (PPA) — allocate goodwill, PPE, intangibles; lock in by Day 60',
        `30/60/90 integration: Day 30 - leadership clarity; Day 60 - customer retention plan; Day 90 - first synergy P&L impact`,
      ] : isEquityAlliance ? [
        'Shareholder agreement: equity split, reserved matters, board seats, CEO selection',
        `Contribute assets: ${acqName} contributes ________; ${tgtName} contributes ________`,
        'JV launch: Day 1 legal entity stood up; Day 30 shared KPI dashboard live',
      ] : [
        'Master agreement: SOWs, pricing schedules, SLA commitments',
        'Operational handshake: named counterparts on both sides for each workstream',
        'Quarterly business review cadence established',
      ],
    },
    {
      num: 7,
      name: 'Learn',
      headline: 'Post-close / post-signing audit',
      actions: [
        isAcq ? 'Year-1 synergy audit: actual vs committed ₹ synergies, by line item' : 'Year-1 alliance health check: are the original KPIs still the right ones?',
        'Decision quality audit — separate from outcome audit (good decisions can have bad outcomes and vice versa)',
        isAcq ? 'Integration lessons → update the firm\'s M&A playbook' : 'Governance lessons → refine alliance templates for the next partnership',
      ],
    },
  ]

  // Unreachable — every pathway returns above. Guard retained for safety.
  void isNonEquity
}

// ─────────────────────────────────────────────────────────────
// Main engine
// ─────────────────────────────────────────────────────────────

/**
 * Run Pathfinder. Pure function — given the same inputs it always returns
 * the same output. Safe to call synchronously on every keystroke.
 */
export function runPathfinder(
  acquirer: Company,
  target: Company,
  mandate: Mandate,
  factors: DyerSinghFactors,
): PathwayRecommendation {
  // ── Tally votes across pathways ──
  const pathwayScores: Record<Pathway, number> = {
    NONEQUITY_ALLIANCE: 0,
    EQUITY_ALLIANCE: 0,
    ACQUISITION: 0,
    WALK_AWAY: 0,
  }

  const matrices: [keyof DyerSinghFactors, VoteMatrix][] = [
    ['synergyType', SYNERGY_VOTES],
    ['resourceNature', RESOURCE_VOTES],
    ['redundancy', REDUNDANCY_VOTES],
    ['marketUncertainty', UNCERTAINTY_VOTES],
    ['competitionIntensity', COMPETITION_VOTES],
  ]

  const factorVerdicts: FactorVerdict[] = []

  for (const [key, matrix] of matrices) {
    const rating = factors[key]
    const votes = matrix[rating]
    pathwayScores.NONEQUITY_ALLIANCE += votes.NONEQUITY_ALLIANCE
    pathwayScores.EQUITY_ALLIANCE += votes.EQUITY_ALLIANCE
    pathwayScores.ACQUISITION += votes.ACQUISITION
    pathwayScores.WALK_AWAY += votes.WALK_AWAY
    factorVerdicts.push({
      key,
      label: FACTOR_COPY[key].label,
      rating,
      pathwayVotes: votes,
      interpretation: FACTOR_COPY[key].interp[rating],
    })
  }

  // ── Add walk-away bonus from target's own acqf flag ──
  pathwayScores.WALK_AWAY += walkAwayBonus(target.acqf)

  // ── Pick the winner ──
  const entries = (Object.entries(pathwayScores) as [Pathway, number][])
  entries.sort((a, b) => b[1] - a[1])
  const pathway: Pathway = entries[0][0]
  const totalVotes = entries.reduce((sum, [, v]) => sum + v, 0) || 1
  const confidence = entries[0][1] / totalVotes

  // ── Diagnostics ──
  const mandateFit = computeMandateFit(mandate, pathway)
  const affordability = computeAffordability(acquirer, target)
  const roadmap = buildRoadmap(pathway, acquirer, target, mandate)

  // ── Headline + rationale bullets ──
  const acqName = acquirer.name
  const tgtName = target.name
  const headline = pathway === 'WALK_AWAY'
    ? `${acqName} should WALK AWAY from ${tgtName}. The target's own scorecard flags disqualifying risk.`
    : `${acqName} should pursue ${tgtName} via ${PATHWAY_LABELS[pathway].toUpperCase()} — ${(confidence * 100).toFixed(0)}% confidence.`

  const rationale: string[] = []
  // Top factor — the one contributing most votes to the winning pathway
  const factorsByContribution = [...factorVerdicts].sort(
    (a, b) => (b.pathwayVotes[pathway] || 0) - (a.pathwayVotes[pathway] || 0),
  )
  if (factorsByContribution[0] && factorsByContribution[0].pathwayVotes[pathway] > 0) {
    const top = factorsByContribution[0]
    rationale.push(`Dominant factor: ${top.label.toLowerCase()} rated ${top.rating.toUpperCase()} — ${top.interpretation}`)
  }
  rationale.push(mandateFit.note)
  rationale.push(affordability.note)
  if (target.acqf) {
    rationale.push(`Target internal scorecard: ${target.acqf} (acqs ${target.acqs}/10).`)
  }
  if (pathway === 'ACQUISITION' && (target.ev_eb || 0) > 15) {
    rationale.push(`Valuation: ${tgtName} trades at ${target.ev_eb.toFixed(1)}× EV/EBITDA — above the 10-15× comfort band; stress-test the synergy case.`)
  }

  return {
    pathway,
    confidence,
    pathwayScores,
    factorVerdicts,
    mandateFit,
    affordability,
    roadmap,
    headline,
    rationale,
  }
}

// ─────────────────────────────────────────────────────────────
// Smart defaults for factor ratings based on company data
// ─────────────────────────────────────────────────────────────

/**
 * Suggest default factor ratings from the acquirer & target data so the
 * analyst gets a reasonable starting point rather than an empty form.
 * They can override any value.
 */
export function suggestFactors(acquirer: Company, target: Company): DyerSinghFactors {
  // Same industry + same value-chain segment ⇒ high redundancy
  const sameIndustry = acquirer.sec === target.sec
  const overlap = (acquirer.comp || []).some((c) => (target.comp || []).includes(c))
  // Sub-segment overlap is a stronger redundancy signal — two TOPCon
  // cell makers will share customers, suppliers, and cost curves more
  // than two solar_cells companies who happen to run different product
  // lines. When either side lacks subcomp tagging (admin hasn't
  // narrowed them), we fall back to the comp-level heuristic so
  // untagged pairings don't get downgraded.
  const acqSubs = acquirer.subcomp || []
  const tgtSubs = target.subcomp || []
  const subOverlap =
    acqSubs.length > 0 &&
    tgtSubs.length > 0 &&
    acqSubs.some((s) => tgtSubs.includes(s))
  // Any shared sub-segment pushes redundancy to 'high' regardless of
  // industry because the commercial footprint is literally identical.
  const redundancy: Rating = subOverlap
    ? 'high'
    : sameIndustry && overlap
      ? 'high'
      : sameIndustry
        ? 'medium'
        : 'low'

  // Synergy type — proxy via industry & segment overlap, with a
  // sub-segment-overlap boost for the same reason as above.
  const synergyType: Rating = subOverlap
    ? 'high'
    : sameIndustry && overlap
      ? 'high'
      : sameIndustry
        ? 'medium'
        : 'low'

  // Resource nature — assume equipment-heavy for manufacturing segments,
  // people/IP-heavy for services / EPC / financing.
  const softSegments = ['epc', 'financing', 'rooftop', 'pv_design', 'engineering', 'developer']
  const isSoft = (target.comp || []).some((c) => softSegments.some((s) => c.toLowerCase().includes(s)))
  const resourceNature: Rating = isSoft ? 'high' : 'medium'

  // Market uncertainty — use revenue growth volatility as a proxy.
  // Very high growth (>40%) ⇒ high uncertainty; very low (<5%) ⇒ low; else medium.
  const revg = Number(target.revg) || 0
  const marketUncertainty: Rating = revg > 40 ? 'high' : revg < 5 ? 'low' : 'medium'

  // Competition intensity — use acqs score as a proxy for how contested
  // the asset is (high acqs = high desirability = contested).
  const acqs = Number(target.acqs) || 5
  const competitionIntensity: Rating = acqs >= 8 ? 'high' : acqs >= 6 ? 'medium' : 'low'

  return {
    synergyType,
    resourceNature,
    redundancy,
    marketUncertainty,
    competitionIntensity,
  }
}
