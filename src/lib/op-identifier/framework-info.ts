/**
 * Framework-info registry — transparency layer for the Op Identifier.
 *
 * For each framework surfaced in the Chapter 2 panel, this records:
 *   - how the framework works (plain-English summary of the theory),
 *   - which inputs the scoring reads (state fields + company-record fields),
 *   - the deterministic algorithm used to produce the sub-score or match,
 *   - the weight / preference boost it contributes to final conviction,
 *   - the downstream output sections it shapes.
 *
 * Rendered in a popup next to each framework title so the analyst can
 * trace "I clicked X — what did it actually change?" without leaving
 * the page.
 */

export type InfoKey =
  | 'ansoff' | 'porter' | 'seven_powers' | 'bcg' | 'mckinsey'
  | 'integration' | 'deal_structure' | 'synergy' | 'vc_position'
  | 'sub_segments' | 'geographies' | 'target_scope'

export interface FrameworkInfo {
  name: string
  /** One-line positioning — shown in the modal header under the name. */
  tagline: string
  /** How the framework works, in 2-4 sentences. */
  howItWorks: string
  /** Named inputs it reads. */
  inputs: string[]
  /** Plain-English description of the scoring math. */
  algorithm: string
  /** Quantified contribution: either a sub-score weight or a preference-boost increment. */
  contribution: string
  /** Bullet list of downstream artefacts the framework shapes. */
  outputImpact: string[]
  /** Honest caveats — caps, defaults, known gaps. */
  notes?: string
}

export const FRAMEWORK_INFO: Record<InfoKey, FrameworkInfo> = {
  ansoff: {
    name: 'Ansoff Matrix',
    tagline: 'Growth-vector classifier on sector × product overlap',
    howItWorks:
      'Classifies an acquisition into one of four growth vectors: Market Penetration (same sector + same products), Product Development (same sector + new products), Market Development (new sector + same products), and Diversification (new sector + new products). Multi-select lets the analyst blend theses — a target that fits any selected vector gets the max score across the blend.',
    inputs: ['acquirer.sec', 'target.sec', 'acquirer.comp[]', 'target.comp[]'],
    algorithm:
      'For each selected vector, checks whether target.sec matches acquirer.sec and whether their comp[] arrays overlap. Market Penetration: 1.0 if same-sector + overlap, 0.7 if same-sector only, 0.2 otherwise. Product Development: 1.0 if same-sector + no overlap, 0.75 if same-sector, 0.3 otherwise. Market Development: 1.0 if different-sector + overlap. Diversification: 1.0 if different-sector + no overlap. Final ansoffFit = max across selected vectors.',
    contribution:
      'Sub-score ansoffFit — weight 0.10 of total conviction (100 = max achievable from this axis).',
    outputImpact: [
      'Target ranking order (direct sub-score contribution)',
      'Dossier thesis bullets reference the active Ansoff vector',
      'Recommender dominant-lens selection (Diversification forces the Diversify lens)',
      'Report §3 Strategic Framework narrative + Executive Summary hero label',
    ],
    notes: 'When multi-select is used, reporting shows "blended" in the framework description and lists each vector as a bullet.',
  },

  porter: {
    name: 'Porter Generic Strategy',
    tagline: 'Competitive-posture fit on scale × margin signals',
    howItWorks:
      'Three postures: Cost Leadership (scale + commoditised products), Differentiation (premium-margin brand/moat), Focus (niche depth with disciplined capital). Multi-select blends postures; Focus being in the blend triggers lean-capital tactics downstream.',
    inputs: ['target.rev', 'target.ebm (EBITDA margin)', 'target.subcomp[] (sub-component breadth)'],
    algorithm:
      'Cost = 0.5 × min(rev/1000, 1) + 0.5 × min(margin/10, 1). Differentiation = 0.7 × min(margin/15, 1) + 0.3 × (1 if subcomp non-empty else 0). Focus = 0.5 × (1 if rev < 1000 Cr, linearly decaying above) + 0.5 × min(margin/8, 1). Final porterFit = max across selected postures.',
    contribution:
      'Sub-score porterFit — weight 0.08 of total conviction.',
    outputImpact: [
      'Target ranking order',
      'Deal-structure recommendation: Focus in blend → strategic-stake bias (lean capital, smaller first tranche)',
      'Takeover multiple applied to enterprise value: 0.55× if Focus in blend, 1.25× otherwise',
      'Acquisition Strategy execution steps reference Focus-specific tactics',
    ],
  },

  seven_powers: {
    name: 'Seven Powers (Hamilton Helmer)',
    tagline: 'Structural-advantage checklist — what makes the target defensible',
    howItWorks:
      'Hamilton Helmer\'s seven sources of sustainable competitive advantage: Scale Economies, Network Economies, Counter-Positioning, Switching Costs, Branding, Cornered Resource, Process Power. Picking any of these tells the system which defensibility lenses matter most for this deal.',
    inputs: ['user preference chips (no company-field read today)'],
    algorithm:
      'Currently qualitative — the picks feed the report narrative but do not flow into the conviction score. Targets are not auto-classified into Seven Powers today.',
    contribution:
      'Display-only. No conviction boost wired. (Candidate for future scoring: sub-comp depth → scale; EBITDA margin premium → branding; policy tailwinds → cornered resource.)',
    outputImpact: [
      'Appears as a labelled chip group in Chapter 2 for IC communication',
      'No downstream algorithmic effect yet',
    ],
    notes: 'Known gap — picks do not alter ranking. Flag if you want this wired into preferenceBoost.',
  },

  bcg: {
    name: 'BCG Growth-Share Matrix',
    tagline: 'Portfolio quadrant on growth × margin',
    howItWorks:
      'Classifies each target into one of four quadrants: Star (high growth + high margin), Cash Cow (low growth + high margin), Question Mark (high growth + low margin), Dog (low growth + low margin). Multi-select means the analyst is comfortable acquiring anything in the selected quadrants.',
    inputs: ['target.revg (revenue growth %)', 'target.ebm (EBITDA margin %)'],
    algorithm:
      'Growth cutoff: 15%. Margin cutoff: 12%. Star: growth ≥ 15% AND margin ≥ 12%. Cash Cow: growth < 15% AND margin ≥ 12%. Question Mark: growth ≥ 15% AND margin < 12%. Dog: growth < 15% AND margin < 12%.',
    contribution:
      'Preference boost — +0.04 to conviction when target\'s BCG quadrant matches a selected preference. Folds into the 0.15-capped preference-boost ceiling.',
    outputImpact: [
      'Dossier hero BCG chip (e.g. "BCG · Star")',
      'Cross-target comparison §5D uses quadrant as one tie-breaker',
      'Recommender logic: Cash Cow acquirers are nudged toward Diversify; Stars toward Integrate Vertically',
      'Report thesis bullets reference the quadrant',
    ],
  },

  mckinsey: {
    name: 'McKinsey 3 Horizons',
    tagline: 'Time-to-value band — core, adjacent, or transformational',
    howItWorks:
      'H1 Core (extends the current business, 0–12 months to accretion), H2 Adjacent (emerging growth vectors, 12–36 months), H3 Transformational (new-market bets, 36+ months). Picking H2 or H3 tells the system you have patience for longer-term bets.',
    inputs: ['acquirer.sec vs target.sec', 'comp[] overlap', 'target.revg (growth signal)'],
    algorithm:
      'Same-sector + high comp overlap → H1 Core. Same-sector + partial overlap + above-median growth → H2 Adjacent. Different-sector OR revg ≥ 30% OR no overlap → H3 Transformational.',
    contribution:
      'Preference boost — +0.04 when target\'s horizon band matches a selected preference.',
    outputImpact: [
      'Dossier hero McKinsey chip (e.g. "McK · H1 Core")',
      'Gantt placement: H1 → near-horizon band (0–12 m), H2 → mid (12–24 m), H3 → long (24 m+)',
      'Fund-requirement timing (near-horizon deals compress capital needs into Year 1)',
    ],
  },

  integration: {
    name: 'Integration Complexity (Haspeslagh–Jemison)',
    tagline: 'Post-close integration mode from strategic × organisational needs',
    howItWorks:
      'Four modes — Preservation (keep target standalone), Absorption (fully consolidate), Symbiosis (shared platforms, preserved identity), Holding (financial-only). Derived from the need for strategic interdependence and the need for organisational autonomy.',
    inputs: ['acquirer size vs target size (size-ratio proxy)', 'sector overlap', 'cultural-distance proxy'],
    algorithm:
      'Small target + same sector + overlap → Absorption. Large target + different sector → Preservation. Medium target + partial overlap → Symbiosis. No operational link → Holding. Interdependence and autonomy signals are combined via a rules-of-thumb matrix.',
    contribution:
      'Preference boost — +0.03 when recommended integration mode matches a selected preference.',
    outputImpact: [
      'Dossier integration-mode pill',
      'Deal-structure recommendation (Symbiosis → JV; Preservation → strategic stake; Absorption → 100% acquisition)',
      'Execution-steps section in §6 with integration-specific 100-day plan elements',
    ],
  },

  deal_structure: {
    name: 'Deal Structure Options',
    tagline: 'Recommended legal path for each target',
    howItWorks:
      'Seven canonical structures: Acquisition (100%), Strategic Stake (26–51%), Joint Venture, Scheme of Arrangement, Asset Purchase, Creeping Tender, Hostile Bid. The system auto-recommends one per target based on integration mode, Porter Focus tilt, and distress signals.',
    inputs: ['integration mode (above)', 'porter blend (Focus tilt)', 'target.dbt_eq (distress proxy)', 'hostile-exposure flag'],
    algorithm:
      'Oversized deal (EV > 1.5× band max) OR Preservation → Strategic Stake. Symbiosis → Joint Venture. Distressed (D/E > 2) → Asset Purchase. Low promoter stake + hostile exposure → Creeping Tender or Hostile Bid. Otherwise → Acquisition.',
    contribution:
      'Preference boost — +0.03 when recommended structure matches a selected preference.',
    outputImpact: [
      'Dossier structure pill',
      'Legal path + execution steps in §6 Acquisition Strategy',
      '§7 Hostile-Takeover Exposure trigger when applicable',
    ],
  },

  synergy: {
    name: 'Synergy Matrix',
    tagline: 'Where value is created post-close',
    howItWorks:
      'Four synergy types: Revenue (cross-sell, bundling), Cost (procurement, overhead), Financial (capital-structure, tax), Risk (diversification, hedge). Typical ranges: 1–3% of combined revenue for revenue synergy, 2–4% for cost, 1–2% for financial.',
    inputs: ['target.rev', 'target.ebitda', 'acquirer.rev'],
    algorithm:
      'Revenue synergy = 3% of target rev + 1% of acquirer rev. Cost synergy = 2% of target EBITDA + 0.5% of target rev. Financial synergy = 1% of combined rev (not surfaced). Total = sum of the three, reported as per-year steady-state ₹Cr.',
    contribution:
      'Display-only preference chips (no conviction boost). Synergy totals flow into the trajectory + 5-year value-add regardless of chip selection.',
    outputImpact: [
      'Dossier synergy-pool stat (₹Cr/yr)',
      '5-year trajectory synergy ramp column',
      'Cross-target comparison value index (synergy density)',
      'Programme fund vs. value MOIC calculation',
    ],
    notes: 'Known gap — synergy-type preference chips do not alter ranking; flag if you want them wired.',
  },

  vc_position: {
    name: 'Value-Chain Position',
    tagline: 'Where the target sits on the industry value chain',
    howItWorks:
      'Six canonical positions: Raw Materials, Manufacturing, Equipment, Systems Integration, Services & O&M, End Use. Each target is auto-mapped from its comp[] using keyword heuristics.',
    inputs: ['target.comp[] (lowercased, keyword-matched)'],
    algorithm:
      'Keyword map: wafer/ingot/polysilicon → Raw; manufacturing/cell/module/blade/tower/battery → Manufacture; inverter/transformer/switchgear/turbine → Equipment; epc/integration/commissioning → Integration; o&m/service/monitoring → Services; ipp/utility/developer → End-use. First match wins.',
    contribution:
      'Preference boost — +0.03 when target\'s position matches a selected preference.',
    outputImpact: [
      'Value-chain strip diagram in §5G',
      'Integration direction classifier (backward / forward / complementary / diversification)',
      'Dossier VC-position chip',
      'Integration Strategy Matrix quadrant placement',
    ],
  },

  sub_segments: {
    name: 'Sub-Segments of Interest',
    tagline: '668-node DealNector VC Taxonomy — target-level precision',
    howItWorks:
      'The deepest layer of targeting. 668 sub-segments across 79 value-chain stages across 15 industries. Every target\'s comp[] is matched to sub-segments; overlap with user picks drives both a core sub-score and a preference boost.',
    inputs: ['target.overlappingSubSegments[] (derived from comp[] via the taxonomy)', 'preferredSubSegments[] (user picks)'],
    algorithm:
      'For each target, subSegmentFit = min(1, overlap_count / 3). If user has picks, overlap is restricted to user-selected nodes; otherwise it\'s the full taxonomy overlap with the acquirer. Preference boost adds 0.015 per user-matched overlap, capped at 0.04.',
    contribution:
      'TWO effects: (1) Sub-score subSegmentFit — weight 0.12 of total conviction. (2) Preference boost — up to +0.04 on top.',
    outputImpact: [
      'Target ranking (large weight on core axis)',
      'Dossier sub-segment overlap pill count',
      'Acquisition card sub-segment overlap row',
      '§5G anchor sub-segments table',
      'Recommender anchor-segment picks per lens',
    ],
    notes: 'Highest-impact Chapter 2 framework. Picks move the ranking meaningfully.',
  },

  geographies: {
    name: 'Geographies of Interest',
    tagline: 'Export-corridor targeting — 8 regions',
    howItWorks:
      '8 export regions (Europe, N America, Middle East, Africa, SE Asia, Latin America, Oceania, South Asia). Each sector has typical corridors it exports to; picks boost targets whose sector exports to preferred regions.',
    inputs: ['target.sec → SECTOR_EXPORT_DESTINATIONS lookup', 'preferredGeographies[] (user picks)'],
    algorithm:
      'For each user-preferred region, check if target\'s sector exports there per the lookup. Sector-match = +0.02. Opportunistic (user picked a non-typical corridor) = +0.005. Total capped at +0.05.',
    contribution:
      'Preference boost — up to +0.05 combined across picked regions.',
    outputImpact: [
      'Radial map in §5F Programme Geography',
      'Per-target prospective corridor table (§5E) — user-preferred regions get ★ marker',
      'Strategic-reason commentary (labour / raw materials / policy / FTA / market size)',
    ],
  },

  target_scope: {
    name: 'Target Scope — Industry / Stage / Sub-Segment',
    tagline: 'Hierarchical where-to-play scope',
    howItWorks:
      'Three-level cascade: Industry → Value-Chain Stage → Sub-Segment. All multi-select. Auto-seeded from the acquirer\'s own posture so the analyst starts from where the acquirer IS and layers on expansion scope.',
    inputs: ['targetIndustries[] (1-15)', 'targetStages[] (dotted codes)', 'preferredSubSegments[] (ids)'],
    algorithm:
      'Industry match: +0.02 per target whose sec maps into a picked industry. Stage match: up to +0.04 per target whose comp[] includes a stage code from the picks (scales with hit count). Sub-segment match: see Sub-Segments framework above.',
    contribution:
      'Industries: +0.02 per match. Stages: +0.04 (capped). Sub-segments: +0.04 boost + 0.12 core sub-axis. All fold into the 0.15 preference-boost ceiling.',
    outputImpact: [
      'Target ranking',
      'Report §3 Target Scope pills (gold for industries + stages, cyan for sub-segments)',
      'Acquirer Current Posture diff (green pills show what acquirer already has)',
      'System Recommendation alignment commentary (% overlap with recommended scope)',
    ],
    notes: 'Auto-seeded from Company.sec + comp[] on acquirer pick — clear all and re-pick to override.',
  },
}
