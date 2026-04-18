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
