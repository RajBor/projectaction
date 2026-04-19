/**
 * Op Identifier — system recommender.
 *
 * Given an acquirer's current posture (what industries, VC stages, and
 * sub-segments it already operates in), its growth ambition (target
 * revenue + horizon), and its strategic posture (Ansoff + Porter), this
 * module produces a ranked "where to play next" recommendation across
 * three deterministic lenses:
 *
 *   1. Consolidate — deepen where the acquirer already is (same
 *      industries + stages, different sub-segments) for scale + share.
 *   2. Integrate Vertically — same industry, adjacent stages (backward
 *      or forward) to own more of the value chain.
 *   3. Diversify — adjacent industries (via an industry-adjacency
 *      heuristic) for optionality.
 *
 * The user can apply any lens directly, cherry-pick individual items,
 * or override with manual picks. Every recommendation carries a
 * one-line reason so the IC sees why it was surfaced.
 */

import type { Company } from '@/lib/data/companies'
import {
  TAXONOMY_STAGES,
  type TaxonomyStage,
  type SubSegment,
  industryCodeFor,
  COMP_TO_STAGE_CODE,
  TAXONOMY_INDUSTRIES,
  industryLabel,
  getStagesForIndustry,
} from '@/lib/data/sub-segments'
import type { AnsoffVector, PorterStrategy } from './frameworks'

export type RecommendationLens = 'consolidate' | 'integrate' | 'diversify'

export interface RecommendedIndustry {
  code: string
  label: string
  lens: RecommendationLens
  reasoning: string
  priority: 1 | 2 | 3 // 1 = strongest, 3 = optional
}

export interface RecommendedStage {
  code: string
  name: string
  industryCode: string
  industryLabel: string
  lens: RecommendationLens
  direction: 'current' | 'backward' | 'forward' | 'complementary'
  reasoning: string
}

export interface RecommendedSubSegment {
  id: string
  label: string
  stageCode: string
  stageName: string
  industryCode: string
  lens: RecommendationLens
  reasoning: string
}

export interface RecommendedScope {
  /** Ranked industries across all three lenses. */
  industries: RecommendedIndustry[]
  /** Ranked VC stages across all three lenses. */
  stages: RecommendedStage[]
  /** Anchor sub-segments (5-20 items). */
  subSegments: RecommendedSubSegment[]
  /** Per-lens narrative — what does each lens say, in one line. */
  lensSummary: Record<RecommendationLens, string>
  /** Per-lens "Apply" bundles so the UI can set state in one click. */
  lensBundles: Record<RecommendationLens, {
    industries: string[]
    stages: string[]
    subSegments: string[]
  }>
  /** Top-level guidance — which lens dominates given inputs. */
  dominantLens: RecommendationLens
  dominantReason: string
}

/**
 * Industry adjacency map. Each industry lists the 2-4 industries it
 * shares the strongest value-chain / policy / supply-chain overlap with.
 * Used for the Diversify lens. Keys are taxonomy industry codes (1..15).
 */
const INDUSTRY_ADJACENCY: Record<string, Array<{ code: string; reason: string }>> = {
  '1': [ // Solar
    { code: '2', reason: 'Adjacent renewable-energy vertical; shared BoS, project-development DNA, and policy regimes (PLI, RECs).' },
    { code: '3', reason: 'Clean-energy chain: battery storage is the natural pairing for solar IPPs; C&I + utility co-location demand.' },
    { code: '10', reason: 'EPC + T&D capability: solar developers increasingly move into infra-construction to own execution.' },
    { code: '6', reason: 'Upstream specialty chemicals (encapsulants, silicon, polymers) — backward integration into inputs.' },
  ],
  '2': [ // Wind
    { code: '1', reason: 'Adjacent renewable vertical; utility-scale bidding + shared policy tailwinds (PLI-wind, SECI tenders).' },
    { code: '4', reason: 'Steel & metals: towers + castings are steel-intensive — backward integration into inputs.' },
    { code: '10', reason: 'Foundation + O&M capability; wind O&M is an infra-adjacent services play.' },
    { code: '3', reason: 'Battery storage: hybrid wind-storage PPAs are the new procurement pattern.' },
  ],
  '3': [ // EV & Battery Storage
    { code: '1', reason: 'Solar + storage bundles for C&I + utility; co-procurement of cells + modules.' },
    { code: '4', reason: 'Steel for pack casings + chassis; backward integration for cost + sovereignty.' },
    { code: '6', reason: 'Cathode precursors + electrolyte chemistry — specialty-chemical backward integration.' },
    { code: '7', reason: 'BMS + power electronics — semiconductor + electronics upstream.' },
  ],
  '4': [ // Steel & Metals
    { code: '10', reason: 'Largest downstream customer: construction + infrastructure absorb ~60% of India steel.' },
    { code: '14', reason: 'Cement is a co-input in construction supply chains; cement + steel consolidation plays common.' },
    { code: '2', reason: 'Wind towers + castings — downstream into high-margin renewable components.' },
    { code: '3', reason: 'EV chassis + pack casings — downstream into mobility value-add steel.' },
  ],
  '5': [ // Pharma
    { code: '6', reason: 'API + intermediates = specialty chemicals; direct backward integration into inputs.' },
    { code: '7', reason: 'Medical devices + diagnostics electronics — capability extension.' },
  ],
  '6': [ // Specialty Chemicals
    { code: '5', reason: 'API + pharma intermediates — forward integration into a premium downstream customer.' },
    { code: '1', reason: 'Solar polymers (EVA, POE) + silicon chemistry — forward into renewable inputs.' },
    { code: '8', reason: 'Textile dyes + auxiliaries — forward into a legacy downstream customer.' },
    { code: '13', reason: 'Agrochemicals — adjacent category within specialty-chem capability set.' },
  ],
  '7': [ // Semiconductors & Electronics
    { code: '3', reason: 'EV power electronics + BMS — downstream into high-value mobility.' },
    { code: '1', reason: 'Solar inverters + micro-inverters — downstream into renewable power electronics.' },
    { code: '11', reason: 'Defence electronics — dual-use capabilities.' },
  ],
  '8': [ // Textiles
    { code: '6', reason: 'Specialty chemicals (dyes, finishes) — backward integration into the cost base.' },
    { code: '9', reason: 'Apparel brands + retail — forward into consumer-facing margin.' },
  ],
  '9': [ // FMCG
    { code: '13', reason: 'Agri + food processing — backward integration into raw-material supply.' },
    { code: '8', reason: 'Apparel + home textiles — adjacent consumer category.' },
    { code: '6', reason: 'Specialty chemicals for personal-care actives — upstream ingredient control.' },
  ],
  '10': [ // Infrastructure & Construction
    { code: '4', reason: 'Steel — largest input cost; backward integration captures margin on iron-ore to structure.' },
    { code: '14', reason: 'Cement — second largest input; classic construction vertical integration play.' },
    { code: '1', reason: 'Solar + T&D: EPC companies increasingly bundle renewable + distribution into project delivery.' },
    { code: '2', reason: 'Wind foundations + O&M — infra skills transferable to wind project execution.' },
  ],
  '11': [ // Defence & Aerospace
    { code: '7', reason: 'Defence electronics + avionics semiconductors — dual-use capability stack.' },
    { code: '4', reason: 'Aerospace alloys — specialty steel / metals upstream.' },
  ],
  '12': [ // IT & Tech Services
    { code: '15', reason: 'Shipping + logistics tech: IoT fleet, port-ops digitisation.' },
    { code: '9', reason: 'FMCG digital: direct-to-consumer + retail analytics platforms.' },
    { code: '5', reason: 'Healthtech + medtech software — pharma-adjacent.' },
  ],
  '13': [ // Agribusiness & Food Processing
    { code: '9', reason: 'FMCG: direct forward into branded food + beverage.' },
    { code: '6', reason: 'Agrochemicals — input-side adjacency within specialty-chem.' },
  ],
  '14': [ // Cement
    { code: '10', reason: 'Construction + infra: largest single downstream customer.' },
    { code: '4', reason: 'Steel: co-input to construction; bundled material-supply plays.' },
  ],
  '15': [ // Shipping
    { code: '12', reason: 'Logistics tech + port-ops digitisation — IT services adjacency.' },
    { code: '10', reason: 'Port + waterside infrastructure — infra-construction adjacency.' },
  ],
}

/**
 * Main recommender. Deterministic. No external calls.
 */
export function recommendTargetScope(input: {
  acquirer: Company
  ansoff: AnsoffVector
  porter: PorterStrategy
  targetRevenueCr: number
  horizonMonths: number
}): RecommendedScope {
  const { acquirer, ansoff, porter, targetRevenueCr } = input

  // ── Current posture ────────────────────────────────────────
  const currentIndustries = new Set<string>()
  const currentStages = new Set<string>()
  const indCode = industryCodeFor(acquirer.sec)
  if (indCode) currentIndustries.add(indCode)
  for (const c of acquirer.comp || []) {
    const stg = COMP_TO_STAGE_CODE[c.toLowerCase()]
    if (stg) {
      currentStages.add(stg)
      const ind = stg.split('.')[0]
      if (ind) currentIndustries.add(ind)
    }
  }

  // ── Gap sizing to decide diversification intensity ────────
  const currentRev = acquirer.rev || 0
  const gap = Math.max(0, targetRevenueCr - currentRev)
  const gapMultiple = currentRev > 0 ? gap / currentRev : 0

  // ── Dominant lens selection ───────────────────────────────
  let dominantLens: RecommendationLens = 'consolidate'
  let dominantReason = ''
  if (ansoff === 'diversification') {
    dominantLens = 'diversify'
    dominantReason = `Ansoff vector is diversification — by definition the programme must enter a new industry. Adjacent industries are prioritised to keep integration risk manageable.`
  } else if (ansoff === 'product_development') {
    dominantLens = 'integrate'
    dominantReason = `Product-Development Ansoff vector — own more of the value chain in the home industry. Upstream (backward) or downstream (forward) stages are prioritised to add new product categories to existing customers.`
  } else if (gapMultiple >= 2) {
    dominantLens = 'diversify'
    dominantReason = `Target revenue implies ${(gapMultiple * 100).toFixed(0)}% growth over ${input.horizonMonths} months — consolidation alone cannot close this gap. Diversification into adjacent industries is required.`
  } else if (porter === 'cost') {
    dominantLens = 'integrate'
    dominantReason = `Cost-Leadership posture + manageable revenue gap — backward integration captures supplier margin and de-risks input cost volatility.`
  } else if (porter === 'focus') {
    dominantLens = 'consolidate'
    dominantReason = `Focus posture — deepen scale and share in existing industries/stages via bolt-on acquisitions in adjacent sub-segments.`
  } else {
    dominantLens = 'consolidate'
    dominantReason = `Market-penetration thesis with ${(gapMultiple * 100).toFixed(0)}% growth target — bolt-on acquisitions inside current industries cover most of the gap.`
  }

  const industries: RecommendedIndustry[] = []
  const stages: RecommendedStage[] = []
  const subSegments: RecommendedSubSegment[] = []

  // ── Lens 1: Consolidate (always present) ──────────────────
  for (const code of Array.from(currentIndustries)) {
    industries.push({
      code,
      label: industryLabel(code),
      lens: 'consolidate',
      reasoning: `Acquirer already operates in ${industryLabel(code)} — consolidation adds scale, geographic reach, and new sub-segment coverage without changing the capability stack.`,
      priority: 1,
    })
    // Within each current industry, recommend current stages (consolidation within the stage)
    for (const stg of Array.from(currentStages)) {
      if (stg.startsWith(code + '.')) {
        const stage = TAXONOMY_STAGES.find((s) => s.code === stg)
        if (stage) {
          stages.push({
            code: stage.code,
            name: stage.name,
            industryCode: code,
            industryLabel: industryLabel(code),
            lens: 'consolidate',
            direction: 'current',
            reasoning: `Bolt-on within ${stage.name} — scale plays + share consolidation inside the existing value-chain position.`,
          })
          // Pick 2-3 anchor sub-segments from this stage
          stage.subs.slice(0, 3).forEach((sub) => {
            subSegments.push({
              id: sub.id,
              label: sub.name,
              stageCode: stage.code,
              stageName: stage.name,
              industryCode: code,
              lens: 'consolidate',
              reasoning: `Signature sub-segment in ${stage.name} — deepens acquirer's position in its home stage.`,
            })
          })
        }
      }
    }
  }

  // ── Lens 2: Integrate Vertically ──────────────────────────
  // For each current industry, recommend adjacent stages (one before + one after) from the same industry's stage list.
  for (const code of Array.from(currentIndustries)) {
    const industryStages = getStagesForIndustry(code).sort((a, b) => a.code.localeCompare(b.code))
    const currentForIndustry = industryStages.filter((s) => currentStages.has(s.code))
    if (currentForIndustry.length === 0) continue
    industries.push({
      code,
      label: industryLabel(code),
      lens: 'integrate',
      reasoning: `Vertically integrate inside ${industryLabel(code)} — own supply (backward) or customer relationship (forward) in the acquirer's home industry.`,
      priority: 2,
    })
    // Find upstream (backward) and downstream (forward) stages
    const minIdx = Math.min(...currentForIndustry.map((s) => industryStages.indexOf(s)))
    const maxIdx = Math.max(...currentForIndustry.map((s) => industryStages.indexOf(s)))
    // Backward: stages before minIdx
    if (minIdx > 0) {
      const backStage = industryStages[minIdx - 1]
      if (backStage && !currentStages.has(backStage.code)) {
        stages.push({
          code: backStage.code,
          name: backStage.name,
          industryCode: code,
          industryLabel: industryLabel(code),
          lens: 'integrate',
          direction: 'backward',
          reasoning: porter === 'cost'
            ? `Backward integration into ${backStage.name} — cost-leadership posture rewards capturing supplier margin and de-risking input volatility.`
            : `Backward integration into ${backStage.name} — own the upstream inputs for ${industryLabel(code)}.`,
        })
        backStage.subs.slice(0, 2).forEach((sub) => {
          subSegments.push({
            id: sub.id,
            label: sub.name,
            stageCode: backStage.code,
            stageName: backStage.name,
            industryCode: code,
            lens: 'integrate',
            reasoning: `Anchor sub-segment in upstream ${backStage.name} — most accretive entry point to backward integration.`,
          })
        })
      }
    }
    // Forward: stages after maxIdx
    if (maxIdx >= 0 && maxIdx < industryStages.length - 1) {
      const fwdStage = industryStages[maxIdx + 1]
      if (fwdStage && !currentStages.has(fwdStage.code)) {
        stages.push({
          code: fwdStage.code,
          name: fwdStage.name,
          industryCode: code,
          industryLabel: industryLabel(code),
          lens: 'integrate',
          direction: 'forward',
          reasoning: porter === 'differentiation'
            ? `Forward integration into ${fwdStage.name} — differentiation posture pairs well with owning the customer relationship and downstream margin.`
            : `Forward integration into ${fwdStage.name} — capture downstream margin + customer relationship.`,
        })
        fwdStage.subs.slice(0, 2).forEach((sub) => {
          subSegments.push({
            id: sub.id,
            label: sub.name,
            stageCode: fwdStage.code,
            stageName: fwdStage.name,
            industryCode: code,
            lens: 'integrate',
            reasoning: `Anchor sub-segment in downstream ${fwdStage.name} — first foothold into forward integration.`,
          })
        })
      }
    }
  }

  // ── Lens 3: Diversify ─────────────────────────────────────
  // Pick the strongest 2-3 adjacent industries using the adjacency map.
  const adjacentSet = new Map<string, string>() // industryCode → reason
  for (const code of Array.from(currentIndustries)) {
    const list = INDUSTRY_ADJACENCY[code] || []
    const takeN = ansoff === 'diversification' ? 3 : gapMultiple >= 2 ? 3 : 2
    list.slice(0, takeN).forEach((a) => {
      if (!currentIndustries.has(a.code) && !adjacentSet.has(a.code)) {
        adjacentSet.set(a.code, a.reason)
      }
    })
  }
  adjacentSet.forEach((reason, code) => {
    industries.push({
      code,
      label: industryLabel(code),
      lens: 'diversify',
      reasoning: reason,
      priority: ansoff === 'diversification' || gapMultiple >= 2 ? 2 : 3,
    })
    // For diversification, pick the "anchor" stage (usually first stage of the new industry)
    // and the strongest downstream / manufacturing stage.
    const newStages = getStagesForIndustry(code)
    if (newStages.length > 0) {
      // Prefer mid-chain manufacturing stages as an anchor entry point
      const anchor = newStages[Math.floor(newStages.length / 2)]
      if (anchor) {
        stages.push({
          code: anchor.code,
          name: anchor.name,
          industryCode: code,
          industryLabel: industryLabel(code),
          lens: 'diversify',
          direction: 'complementary',
          reasoning: `Anchor entry point into ${industryLabel(code)} via its manufacturing core — build scale before extending vertically.`,
        })
        anchor.subs.slice(0, 2).forEach((sub) => {
          subSegments.push({
            id: sub.id,
            label: sub.name,
            stageCode: anchor.code,
            stageName: anchor.name,
            industryCode: code,
            lens: 'diversify',
            reasoning: `Anchor sub-segment in ${industryLabel(code)} — first operational beachhead in the new value chain.`,
          })
        })
      }
    }
  })

  // ── Per-lens bundle helpers (Apply buttons) ──────────────
  const bundleFor = (lens: RecommendationLens) => ({
    industries: industries.filter((i) => i.lens === lens).map((i) => i.code),
    stages: stages.filter((s) => s.lens === lens).map((s) => s.code),
    subSegments: subSegments.filter((s) => s.lens === lens).map((s) => s.id),
  })

  // Lens-level narrative
  const consolidateCount = industries.filter((i) => i.lens === 'consolidate').length
  const integrateCount = stages.filter((s) => s.lens === 'integrate').length
  const diversifyCount = industries.filter((i) => i.lens === 'diversify').length

  return {
    industries,
    stages,
    subSegments,
    dominantLens,
    dominantReason,
    lensSummary: {
      consolidate: consolidateCount > 0
        ? `Deepen scale in ${consolidateCount} home industr${consolidateCount === 1 ? 'y' : 'ies'} via bolt-on acquisitions inside the stages the acquirer already covers.`
        : `Acquirer has no taxonomy-mapped industries yet — map Company.comp[] before consolidation can be recommended.`,
      integrate: integrateCount > 0
        ? `Add ${integrateCount} adjacent value-chain stage${integrateCount === 1 ? '' : 's'} via backward (supply capture) or forward (customer capture) moves inside the acquirer's home industry.`
        : `Acquirer already spans the full value chain of its home industry — no vertical-integration targets inside the existing footprint.`,
      diversify: diversifyCount > 0
        ? `Enter ${diversifyCount} adjacent industr${diversifyCount === 1 ? 'y' : 'ies'} where the acquirer's capabilities, supply chain, or customer base create a low-friction bridge.`
        : `No adjacent industries identified — acquirer's sector mapping may be too narrow or too broad to trigger the adjacency heuristic.`,
    },
    lensBundles: {
      consolidate: bundleFor('consolidate'),
      integrate: bundleFor('integrate'),
      diversify: bundleFor('diversify'),
    },
  }
}
