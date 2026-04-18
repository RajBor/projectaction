/**
 * Strategic-framework metadata for the Op Identifier pipeline.
 *
 * Three classical frameworks drive target selection:
 *
 *   1. Ansoff Matrix         — market × product combinations that define the
 *                              growth move (same/new market × same/new product).
 *   2. Porter Generic        — cost leadership / differentiation / focus.
 *   3. Seven Powers          — durable-advantage taxonomy (scale, network
 *                              effects, switching costs, brand, cornered
 *                              resource, counter-positioning, process).
 *
 * The library is pure metadata + small helpers. No external calls. The
 * Op Identifier page uses these to:
 *   - Render the framework cards on the summary row.
 *   - Score targets on the Ansoff + Porter axes deterministically.
 *   - Compose natural-language rationale by looking up the stanza
 *     associated with the matched framework cell.
 */

export type AnsoffVector =
  | 'market_penetration'
  | 'market_development'
  | 'product_development'
  | 'diversification'

export type PorterStrategy = 'cost' | 'differentiation' | 'focus'

export type SevenPower =
  | 'scale_economies'
  | 'network_economies'
  | 'counter_positioning'
  | 'switching_costs'
  | 'branding'
  | 'cornered_resource'
  | 'process_power'

export interface AnsoffCell {
  id: AnsoffVector
  label: string
  rowAxis: 'existing' | 'new' // market
  colAxis: 'existing' | 'new' // product
  risk: 'low' | 'medium' | 'high' | 'very-high'
  /** Short thesis shown in UI + used by the rationale composer. */
  thesis: string
  /** Target profile keywords that best match this Ansoff cell. */
  keywords: string[]
}

export const ANSOFF: AnsoffCell[] = [
  {
    id: 'market_penetration',
    label: 'Market Penetration',
    rowAxis: 'existing',
    colAxis: 'existing',
    risk: 'low',
    thesis:
      'Consolidate share in the same sub-segments the acquirer already serves. Fastest to close, lowest integration risk.',
    keywords: ['consolidation', 'same-segment', 'share-gain'],
  },
  {
    id: 'product_development',
    label: 'Product Development',
    rowAxis: 'existing',
    colAxis: 'new',
    risk: 'medium',
    thesis:
      'Add adjacent sub-segments in the acquirer\u2019s current industry. Moderate integration complexity; significant cross-sell.',
    keywords: ['adjacent-segment', 'same-industry', 'cross-sell'],
  },
  {
    id: 'market_development',
    label: 'Market Development',
    rowAxis: 'new',
    colAxis: 'existing',
    risk: 'medium',
    thesis:
      'Take the same product into new industries. Relies on re-using existing engineering or sourcing, extending reach.',
    keywords: ['new-industry', 'same-product', 'extend-reach'],
  },
  {
    id: 'diversification',
    label: 'Diversification',
    rowAxis: 'new',
    colAxis: 'new',
    risk: 'very-high',
    thesis:
      'New industry AND new product capability. Highest transformation value; highest integration risk.',
    keywords: ['new-industry', 'new-product', 'transformation'],
  },
]

export const PORTER: Array<{
  id: PorterStrategy
  label: string
  thesis: string
  targetProfile: string
}> = [
  {
    id: 'cost',
    label: 'Cost Leadership',
    thesis:
      'Scale manufacturing, commodity inputs, volume-driven gross margin. Prefer larger targets with >10% EBITDA.',
    targetProfile: 'Revenue > acquirer\u2019s cost base / 10, EBITDA margin within ±3pp of sector median.',
  },
  {
    id: 'differentiation',
    label: 'Differentiation',
    thesis:
      'Premium brand, IP, specialised tech, customer intimacy. Higher EV/EBITDA acceptable.',
    targetProfile:
      'EBITDA margin > sector median + 5pp OR a unique sub-segment tag (e.g., TOPCon, HJT, BESS).',
  },
  {
    id: 'focus',
    label: 'Focus',
    thesis:
      'Dominate a narrow sub-segment or geography. Smaller targets, lower absolute deal size, niche moat.',
    targetProfile: 'Revenue < 1,000 Cr + ownership private/subsidiary + narrow sub-segment tag.',
  },
]

export const SEVEN_POWERS: Array<{ id: SevenPower; label: string; cue: string }> = [
  { id: 'scale_economies', label: 'Scale Economies', cue: 'large market-cap + low cost per unit' },
  { id: 'network_economies', label: 'Network Economies', cue: 'platform or two-sided business model' },
  { id: 'counter_positioning', label: 'Counter-Positioning', cue: 'incumbent cannot copy without cannibalising' },
  { id: 'switching_costs', label: 'Switching Costs', cue: 'embedded contracts, long-cycle OEM, regulatory lock-in' },
  { id: 'branding', label: 'Branding', cue: 'EBITDA margin premium + low ad-spend elasticity' },
  { id: 'cornered_resource', label: 'Cornered Resource', cue: 'unique licence, PLI allocation, ALMM tier-I' },
  { id: 'process_power', label: 'Process Power', cue: 'proprietary manufacturing yield or quality lead' },
]

/**
 * Acquisition horizon bands. Ordered: smaller / simpler deals close faster.
 * Used by the timeline view AND to ladder fund-requirement over months.
 */
export interface HorizonBand {
  id: 'near' | 'mid' | 'long'
  label: string
  months: [number, number]
  evBand: [number, number] // ₹Cr — upper cap drives classification
}
export const HORIZONS: HorizonBand[] = [
  { id: 'near', label: '0–12 months', months: [0, 12], evBand: [0, 5000] },
  { id: 'mid', label: '12–24 months', months: [12, 24], evBand: [5000, 20000] },
  { id: 'long', label: '24–36 months', months: [24, 36], evBand: [20000, Number.POSITIVE_INFINITY] },
]

export function horizonFor(evCr: number): HorizonBand {
  for (const h of HORIZONS) {
    if (evCr >= h.evBand[0] && evCr < h.evBand[1]) return h
  }
  return HORIZONS[HORIZONS.length - 1]
}

// ════════════════════════════════════════════════════════════════
// BCG Growth-Share Matrix
// ════════════════════════════════════════════════════════════════
export type BcgQuadrant = 'star' | 'cash_cow' | 'question_mark' | 'dog'
export const BCG: Array<{ id: BcgQuadrant; label: string; thesis: string; color: string }> = [
  { id: 'star', label: 'Star', color: 'var(--green)', thesis: 'High growth + high market share. Reinvest; protect category leadership.' },
  { id: 'cash_cow', label: 'Cash Cow', color: 'var(--gold2)', thesis: 'Low growth + high share. Harvest for cash; fund strategic bets.' },
  { id: 'question_mark', label: 'Question Mark', color: 'var(--cyan2)', thesis: 'High growth + low share. Either invest to build share or divest.' },
  { id: 'dog', label: 'Dog', color: 'var(--txt3)', thesis: 'Low growth + low share. Divest or run off; avoid fresh capital.' },
]

// ════════════════════════════════════════════════════════════════
// McKinsey 3 Horizons — core / adjacent / transformational
// ════════════════════════════════════════════════════════════════
export type McKinseyHorizon = 'h1_core' | 'h2_adjacent' | 'h3_transformational'
export const MCKINSEY: Array<{ id: McKinseyHorizon; label: string; thesis: string }> = [
  { id: 'h1_core', label: 'H1 · Core Business', thesis: 'Same sector, proven product. Protects 70% of portfolio value; IRR-driven.' },
  { id: 'h2_adjacent', label: 'H2 · Adjacent', thesis: 'Near-term adjacencies — new segments, geography, or customer tier.' },
  { id: 'h3_transformational', label: 'H3 · Transformational', thesis: 'New businesses, uncertain returns; option value over base-case value.' },
]

// ════════════════════════════════════════════════════════════════
// Integration Complexity — Haspeslagh & Jemison
// (Absorb / Preserve / Symbiosis / Holding)
// ════════════════════════════════════════════════════════════════
export type IntegrationMode = 'absorb' | 'preserve' | 'symbiosis' | 'holding'
export const INTEGRATION: Array<{ id: IntegrationMode; label: string; need: string; autonomy: string; thesis: string }> = [
  { id: 'absorb', label: 'Absorption', need: 'High', autonomy: 'Low', thesis: 'Full integration — cost synergies dominate; consolidate P&L and brand.' },
  { id: 'preserve', label: 'Preservation', need: 'Low', autonomy: 'High', thesis: 'Hands-off — buy for the intangibles; keep target\u2019s culture and leadership.' },
  { id: 'symbiosis', label: 'Symbiosis', need: 'High', autonomy: 'High', thesis: 'Best-of-both — retain target\u2019s edge while sharing platforms. Hardest to execute.' },
  { id: 'holding', label: 'Holding', need: 'Low', autonomy: 'Low', thesis: 'Financial portfolio play — governance only; no operational meshing.' },
]

// ════════════════════════════════════════════════════════════════
// Deal Structure — 7 classical alternatives (SEBI / Companies-Act style)
// ════════════════════════════════════════════════════════════════
export type DealStructure =
  | 'acquisition'
  | 'strategic_stake'
  | 'minority_stake'
  | 'jv'
  | 'asset_purchase'
  | 'merger'
  | 'tech_license'
export const DEAL_STRUCTURES: Array<{ id: DealStructure; label: string; ownership: string; thesis: string }> = [
  { id: 'acquisition', label: 'Acquisition', ownership: '\u2265 75%', thesis: 'Full control; suited to Absorption integration; max synergy, max risk.' },
  { id: 'strategic_stake', label: 'Strategic Stake', ownership: '51\u201375%', thesis: 'Board control; mitigates integration shock; retains founder incentives.' },
  { id: 'minority_stake', label: 'Minority Stake', ownership: '10\u201349%', thesis: 'Optionality play; board seat + ROFR; low capital at risk.' },
  { id: 'jv', label: 'Joint Venture', ownership: '50/50', thesis: 'Shared risk/reward on new market or product; shortest time-to-market.' },
  { id: 'asset_purchase', label: 'Asset Purchase', ownership: 'n/a', thesis: 'Buy plants / IP / brand only; avoids target liabilities; favoured for distressed assets.' },
  { id: 'merger', label: 'Merger', ownership: 'swap', thesis: 'Share-swap deal; preserves cash; share-dilution discipline required.' },
  { id: 'tech_license', label: 'Technology License', ownership: 'n/a', thesis: 'Licensing/JV on IP only; suited to regulatory-blocked geographies.' },
]

// ════════════════════════════════════════════════════════════════
// Synergy Matrix — revenue / cost / capital / tax
// ════════════════════════════════════════════════════════════════
export type SynergyBucket = 'revenue' | 'cost' | 'capital' | 'tax'
export const SYNERGY_BUCKETS: Array<{ id: SynergyBucket; label: string; examples: string }> = [
  { id: 'revenue', label: 'Revenue Synergy', examples: 'Cross-sell, bundled pricing, new geographies, upsell into acquirer base.' },
  { id: 'cost', label: 'Cost Synergy', examples: 'Procurement leverage, overhead consolidation, manufacturing footprint rationalisation.' },
  { id: 'capital', label: 'Capital Synergy', examples: 'Shared capex, working-capital optimisation, lower cost of debt post-close.' },
  { id: 'tax', label: 'Tax Synergy', examples: 'Loss carry-forward utilisation, MAT credits, holding-structure efficiency.' },
]

// ════════════════════════════════════════════════════════════════
// Value-chain position — where along Raw \u2192 Make \u2192 Deliver
// ════════════════════════════════════════════════════════════════
export type VcPosition = 'raw' | 'manufacture' | 'equipment' | 'integration' | 'services' | 'end_use'
export const VC_POSITIONS: Array<{ id: VcPosition; label: string; keywords: string[] }> = [
  { id: 'raw', label: 'Raw Materials', keywords: ['polysilicon', 'wafer', 'silver', 'glass', 'aluminium', 'copper', 'encapsulant', 'backsheet', 'chemical', 'lithium'] },
  { id: 'manufacture', label: 'Cell / Module / Component Mfg', keywords: ['cell', 'module', 'battery', 'bess', 'transformer', 'conductor', 'cable', 'switchgear', 'turbine', 'nacelle', 'blade', 'tower'] },
  { id: 'equipment', label: 'Equipment & Machinery', keywords: ['inverter', 'tracker', 'mounting', 'ems', 'scada', 'meter', 'junction_box', 'mc4'] },
  { id: 'integration', label: 'EPC / Project Development', keywords: ['epc', 'solar_plant', 'ipp', 'project', 'grid', 'transmission'] },
  { id: 'services', label: 'O&M / Services', keywords: ['o_and_m', 'oandm', 'maintenance', 'service', 'installation'] },
  { id: 'end_use', label: 'End Use / Distribution', keywords: ['retail', 'dealer', 'distribution', 'consumer'] },
]

/**
 * Map one or more `comp` ids (internal value-chain node ids) to the
 * most likely VC position. Uses substring match on the keyword list
 * above. Returns 'integration' as a reasonable default when nothing
 * matches — most unknowns are EPC/project-development plays.
 */
export function vcPositionFor(comps: string[] | null | undefined): VcPosition {
  if (!comps || comps.length === 0) return 'integration'
  for (const pos of VC_POSITIONS) {
    for (const c of comps) {
      const lc = c.toLowerCase()
      for (const k of pos.keywords) {
        if (lc.includes(k)) return pos.id
      }
    }
  }
  return 'integration'
}

/**
 * Deterministic integration-direction classification:
 *   - backward: acquirer is downstream of target (moves upstream)
 *   - forward:  acquirer is upstream of target (moves downstream)
 *   - horizontal: same stage
 */
const POSITION_ORDER: VcPosition[] = ['raw', 'manufacture', 'equipment', 'integration', 'services', 'end_use']
export function integrationDirection(
  acquirerComps: string[] | null | undefined,
  targetComps: string[] | null | undefined,
): 'backward' | 'forward' | 'horizontal' | 'adjacent' {
  const a = vcPositionFor(acquirerComps)
  const t = vcPositionFor(targetComps)
  if (a === t) return 'horizontal'
  const ai = POSITION_ORDER.indexOf(a)
  const ti = POSITION_ORDER.indexOf(t)
  if (ai < 0 || ti < 0) return 'adjacent'
  if (ti < ai) return 'backward' // target is upstream of acquirer → moving upstream
  if (ti > ai) return 'forward' // target is downstream → moving downstream
  return 'adjacent'
}
