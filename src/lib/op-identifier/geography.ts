/**
 * Op Identifier — geography layer.
 *
 * The DealNector company database currently carries only India-listed
 * and India-private companies. Company records have no geographic
 * fields yet (HQ state, plant locations, export destinations). So this
 * module does two things:
 *
 *   1. Encodes sector-level defaults for India hub states and typical
 *      export destinations — good enough to tell an analyst where each
 *      target likely operates and which overseas markets the acquisition
 *      could unlock.
 *   2. Defines the data shapes that will carry per-company geography
 *      when the DB is extended: hq.state, plants[], export_destinations[].
 *      Foreign targets (non-India) drop straight in once the schema
 *      widens — nothing in the report assumes India.
 *
 * Demand patterns for foreign targets will be cross-checked against
 * export/import data once that feed lands — see `validationSource` on
 * ExportDestination.
 */

import type { Company } from '@/lib/data/companies'
import type { OpTarget } from './algorithm'

export type ExportRegionId =
  | 'europe'
  | 'north_america'
  | 'middle_east'
  | 'africa'
  | 'se_asia'
  | 'latin_america'
  | 'oceania'
  | 'south_asia'

export interface ExportRegion {
  id: ExportRegionId
  label: string
  /** Representative destination countries. */
  countries: string[]
  /** Indicative reasoning for this sector→region corridor. */
  reasoning: string
  /** Colour for pills + map arcs. */
  color: string
}

/**
 * Sector → export destinations (ordered by strategic priority).
 * Reasoning lines are deterministic; treat as starter facts an analyst
 * will refine, not as a live trade-flow feed. When DGFT / ITC-HS data
 * lands, replace this map with live export-volume rankings per HS code.
 */
export const SECTOR_EXPORT_DESTINATIONS: Record<string, ExportRegion[]> = {
  solar: [
    { id: 'europe', label: 'Europe (EU + UK)', countries: ['Germany', 'Netherlands', 'Spain', 'UK'], reasoning: 'CBAM + REPowerEU: 70GW/yr module demand; China+1 sourcing shift post-UFLPA.', color: '#1e5aa8' },
    { id: 'north_america', label: 'North America', countries: ['USA', 'Canada'], reasoning: 'IRA-linked domestic-content premiums; utility-scale pipeline; India-origin qualifies via DOC circumvention ruling.', color: '#c7334f' },
    { id: 'middle_east', label: 'Middle East', countries: ['UAE', 'Saudi Arabia', 'Oman'], reasoning: 'NEOM / Vision-2030 programmes; GCC targeting 100GW renewable by 2030.', color: '#C8A24B' },
    { id: 'africa', label: 'Africa', countries: ['Egypt', 'South Africa', 'Morocco', 'Kenya'], reasoning: 'Mission 300 + off-grid demand; Indian EXIM-backed LoCs open procurement to Indian OEMs.', color: '#d97706' },
  ],
  wind_energy: [
    { id: 'europe', label: 'Europe (offshore)', countries: ['UK', 'Germany', 'Denmark'], reasoning: 'Offshore wind tower + castings demand; India supply-chain favoured for cost position.', color: '#1e5aa8' },
    { id: 'se_asia', label: 'SE Asia', countries: ['Vietnam', 'Philippines', 'Indonesia'], reasoning: 'Onshore wind expansion; India OEMs competitive on turbine + blade economics.', color: '#0aa5b2' },
    { id: 'middle_east', label: 'Middle East', countries: ['Saudi Arabia', 'Oman'], reasoning: 'Saudi Vision-2030 16GW wind target; Adani-TotalEnergies already live.', color: '#C8A24B' },
    { id: 'africa', label: 'Africa', countries: ['South Africa', 'Morocco'], reasoning: 'REIPPPP auctions; Moroccan wind corridor expanding toward Mediterranean export.', color: '#d97706' },
  ],
  td: [
    { id: 'middle_east', label: 'Middle East', countries: ['UAE', 'Saudi Arabia', 'Kuwait'], reasoning: 'GCC grid modernisation; HVDC + GIS demand for smart-grid rollout.', color: '#C8A24B' },
    { id: 'africa', label: 'Africa', countries: ['Nigeria', 'Kenya', 'Tanzania'], reasoning: 'Mission 300 electrification + EPC inflows via EXIM LoCs.', color: '#d97706' },
    { id: 'se_asia', label: 'SE Asia', countries: ['Bangladesh', 'Nepal', 'Vietnam'], reasoning: 'Cross-border interconnects; Bangladesh-India 1600MW HVDC path.', color: '#0aa5b2' },
  ],
  electric_vehicles_and_battery_storage: [
    { id: 'europe', label: 'Europe', countries: ['Germany', 'France', 'UK'], reasoning: 'BEV + cell demand; CRM Act opens non-China sourcing lane.', color: '#1e5aa8' },
    { id: 'se_asia', label: 'SE Asia', countries: ['Thailand', 'Indonesia', 'Vietnam'], reasoning: 'Indonesia nickel-to-cathode integration; Thailand 2W + 3W fleets.', color: '#0aa5b2' },
    { id: 'north_america', label: 'North America', countries: ['USA'], reasoning: 'IRA 30D credit + domestic-content bonus for FTA-partner components.', color: '#c7334f' },
  ],
  pharmaceuticals_and_healthcare: [
    { id: 'north_america', label: 'USA', countries: ['USA'], reasoning: 'Largest generics market; ANDA pipeline + BD-led injectables growth.', color: '#c7334f' },
    { id: 'europe', label: 'Europe', countries: ['UK', 'Germany', 'France', 'Netherlands'], reasoning: 'Generics tenders + biosimilars launch window; MHRA/EMA approvals.', color: '#1e5aa8' },
    { id: 'latin_america', label: 'LatAm', countries: ['Brazil', 'Mexico'], reasoning: 'ANVISA/COFEPRIS pathways; cost-competitive generics demand.', color: '#0f9e6e' },
    { id: 'africa', label: 'Africa', countries: ['South Africa', 'Nigeria', 'Kenya'], reasoning: 'PQP-WHO tenders + HIV/TB regimens; public-sector procurement.', color: '#d97706' },
  ],
  specialty_chemicals_and_agrochemicals: [
    { id: 'north_america', label: 'USA', countries: ['USA'], reasoning: 'China+1 de-risking by US formulators; contract manufacturing demand.', color: '#c7334f' },
    { id: 'europe', label: 'Europe', countries: ['Germany', 'Netherlands', 'Italy'], reasoning: 'REACH-compliant sourcing alternative to Chinese intermediates.', color: '#1e5aa8' },
    { id: 'se_asia', label: 'Japan/Korea', countries: ['Japan', 'South Korea'], reasoning: 'High-purity intermediates for electronics + pharma API demand.', color: '#0aa5b2' },
  ],
  textiles_and_apparel: [
    { id: 'north_america', label: 'USA', countries: ['USA'], reasoning: 'Largest apparel importer; Tier-1 buyer programmes (Walmart, Target, Gap).', color: '#c7334f' },
    { id: 'europe', label: 'Europe', countries: ['UK', 'Germany', 'France'], reasoning: 'Sustainability + recyclability mandates favour Indian integrated mills.', color: '#1e5aa8' },
    { id: 'middle_east', label: 'GCC', countries: ['UAE', 'Saudi Arabia'], reasoning: 'Fashion retail + home-textiles; FTAs reducing tariff friction.', color: '#C8A24B' },
  ],
  steel_and_metals: [
    { id: 'se_asia', label: 'SE Asia', countries: ['Vietnam', 'Indonesia', 'Thailand'], reasoning: 'Construction-grade HR/CR coil demand; India freight advantage.', color: '#0aa5b2' },
    { id: 'middle_east', label: 'Middle East', countries: ['UAE', 'Saudi Arabia'], reasoning: 'Vision-2030 mega-projects driving long-products + pipe demand.', color: '#C8A24B' },
    { id: 'africa', label: 'North Africa', countries: ['Morocco', 'Egypt'], reasoning: 'Local construction boom + auto-sector localisation.', color: '#d97706' },
  ],
  fmcg_and_consumer_products: [
    { id: 'middle_east', label: 'GCC', countries: ['UAE', 'Saudi Arabia', 'Kuwait'], reasoning: 'Large Indian diaspora + ethnic retail chains anchor demand.', color: '#C8A24B' },
    { id: 'se_asia', label: 'SE Asia', countries: ['Singapore', 'Malaysia'], reasoning: 'Ethnic + convenience retail; halal certification often reusable.', color: '#0aa5b2' },
    { id: 'africa', label: 'East/West Africa', countries: ['Nigeria', 'Kenya', 'Tanzania'], reasoning: 'Fast-growing consumer base; Indian brands (Godrej, Dabur) already present.', color: '#d97706' },
    { id: 'europe', label: 'UK + EU', countries: ['UK', 'Germany'], reasoning: 'Diaspora-led demand + premium spices/tea category expansion.', color: '#1e5aa8' },
  ],
  it_and_technology_services: [
    { id: 'north_america', label: 'USA', countries: ['USA'], reasoning: '60%+ of India IT exports; BFSI + healthcare + retail verticals.', color: '#c7334f' },
    { id: 'europe', label: 'UK + EU', countries: ['UK', 'Germany', 'France', 'Netherlands'], reasoning: 'Nearshoring + GDPR-compliant managed services.', color: '#1e5aa8' },
    { id: 'oceania', label: 'ANZ', countries: ['Australia', 'New Zealand'], reasoning: 'Time-zone-adjacent delivery; banking + government digitisation.', color: '#6d28d9' },
    { id: 'middle_east', label: 'GCC', countries: ['UAE', 'Saudi Arabia'], reasoning: 'Digitisation spend; Indian SIs winning large public-sector deals.', color: '#C8A24B' },
  ],
  cement_and_building_materials: [
    { id: 'south_asia', label: 'South Asia', countries: ['Bangladesh', 'Nepal', 'Sri Lanka'], reasoning: 'Cross-border bulk cement + clinker; freight advantage.', color: '#6d28d9' },
    { id: 'africa', label: 'East Africa', countries: ['Tanzania', 'Kenya'], reasoning: 'Indian cement majors (UltraTech, Shree) with clinker grinding units.', color: '#d97706' },
  ],
  shipping_and_maritime_logistics: [
    { id: 'middle_east', label: 'Middle East', countries: ['UAE', 'Saudi Arabia'], reasoning: 'India-GCC corridor + IMEC economic corridor anchor.', color: '#C8A24B' },
    { id: 'se_asia', label: 'SE Asia', countries: ['Singapore', 'Malaysia'], reasoning: 'Transhipment hubs; Malacca strait volume.', color: '#0aa5b2' },
    { id: 'africa', label: 'East Africa', countries: ['Kenya', 'Tanzania', 'Mozambique'], reasoning: 'Indian Ocean trade lanes; container + bulk.', color: '#d97706' },
  ],
  agribusiness_and_food_processing: [
    { id: 'middle_east', label: 'GCC', countries: ['UAE', 'Saudi Arabia'], reasoning: 'Food-import-dependent; India basmati + spices + processed foods.', color: '#C8A24B' },
    { id: 'se_asia', label: 'SE Asia', countries: ['Indonesia', 'Vietnam', 'Philippines'], reasoning: 'Palm oil, rice, pulses trade lanes bi-directional.', color: '#0aa5b2' },
    { id: 'africa', label: 'Africa', countries: ['Nigeria', 'Egypt', 'Kenya'], reasoning: 'Rice + dairy + edible-oil demand; Indian trading houses active.', color: '#d97706' },
  ],
  infrastructure_and_construction: [
    { id: 'middle_east', label: 'Middle East', countries: ['UAE', 'Saudi Arabia', 'Qatar'], reasoning: 'Vision-2030 mega-projects; Indian EPC labour + equipment footprint.', color: '#C8A24B' },
    { id: 'africa', label: 'Sub-Saharan Africa', countries: ['Kenya', 'Mozambique', 'Tanzania'], reasoning: 'EXIM-backed LoC pipeline for rail, road, power projects.', color: '#d97706' },
  ],
}

/**
 * Sector → typical India hub states (ordered by cluster prominence).
 * Will be superseded by per-company plant data once the DB has it.
 */
export const SECTOR_HUB_STATES: Record<string, string[]> = {
  solar: ['Gujarat', 'Tamil Nadu', 'Maharashtra', 'Rajasthan'],
  wind_energy: ['Tamil Nadu', 'Gujarat', 'Karnataka', 'Maharashtra'],
  td: ['Gujarat', 'Maharashtra', 'Haryana', 'Karnataka'],
  electric_vehicles_and_battery_storage: ['Karnataka', 'Tamil Nadu', 'Gujarat', 'Maharashtra'],
  pharmaceuticals_and_healthcare: ['Telangana', 'Gujarat', 'Maharashtra', 'Karnataka'],
  specialty_chemicals_and_agrochemicals: ['Gujarat', 'Maharashtra'],
  textiles_and_apparel: ['Tamil Nadu', 'Gujarat', 'Maharashtra', 'West Bengal'],
  steel_and_metals: ['Odisha', 'Jharkhand', 'Chhattisgarh', 'Karnataka'],
  fmcg_and_consumer_products: ['Maharashtra', 'Uttar Pradesh', 'Karnataka', 'Gujarat'],
  it_and_technology_services: ['Karnataka', 'Telangana', 'Maharashtra', 'Tamil Nadu'],
  cement_and_building_materials: ['Rajasthan', 'Madhya Pradesh', 'Andhra Pradesh', 'Tamil Nadu'],
  shipping_and_maritime_logistics: ['Gujarat', 'Maharashtra', 'Tamil Nadu', 'Andhra Pradesh'],
  agribusiness_and_food_processing: ['Punjab', 'Uttar Pradesh', 'Maharashtra', 'Gujarat'],
  infrastructure_and_construction: ['Maharashtra', 'Delhi NCR', 'Karnataka', 'Tamil Nadu'],
}

export interface GeographyBrief {
  ticker: string
  name: string
  /** 'India' today; widens to any ISO code once non-India targets land. */
  countryOfOperations: string
  hubs: string[]
  exports: ExportRegion[]
  /** What the acquirer's market access in this sector unlocks by adding this target. */
  domesticUnlocks: string[]
  exportUnlocks: string[]
  /** Data-source note for the analyst. */
  validationSource: string
}

export function geographyFor(acquirerSec: string, target: OpTarget): GeographyBrief {
  const sec = target.sec || acquirerSec || ''
  const hubs = SECTOR_HUB_STATES[sec] || ['Pan-India']
  const exports = SECTOR_EXPORT_DESTINATIONS[sec] || []
  const sameSector = sec === acquirerSec
  const domesticUnlocks: string[] = []
  const exportUnlocks: string[] = []

  if (sameSector) {
    if (target.overlappingSubSegments.length > 0) {
      domesticUnlocks.push(`Deepens acquirer\u2019s domestic share in ${target.overlappingSubSegments.slice(0, 3).map((s) => s.label).join(', ')}${target.overlappingSubSegments.length > 3 ? '…' : ''}.`)
    } else {
      domesticUnlocks.push('Strengthens acquirer\u2019s existing regional footprint via overlapping sector presence.')
    }
  } else {
    domesticUnlocks.push(`Opens a new domestic vertical (${sec.replace(/_/g, ' ')}) adjacent to the acquirer\u2019s existing business.`)
  }

  if (exports.length > 0) {
    exportUnlocks.push(`Inherits established channels to ${exports.map((r) => r.label).join(', ')} via the target\u2019s sector footprint.`)
    const top = exports[0]
    exportUnlocks.push(`${top.label} is the strategic anchor \u2014 ${top.reasoning}`)
    if (exports.length >= 2) {
      const second = exports[1]
      exportUnlocks.push(`${second.label} is a secondary corridor \u2014 ${second.reasoning}`)
    }
  } else {
    exportUnlocks.push('Sector is primarily domestic today; export optionality requires independent diligence.')
  }

  return {
    ticker: target.ticker,
    name: target.name,
    countryOfOperations: 'India',
    hubs,
    exports,
    domesticUnlocks,
    exportUnlocks,
    validationSource: 'Sector-level defaults (to be replaced by DGFT ITC-HS export data once ingested).',
  }
}

export interface ProgrammeGeography {
  acquirerCountry: string
  acquirerHubs: string[]
  /** Union of target hubs (deduped). */
  operationsFootprint: string[]
  /** Unique export regions touched, with which targets touch them. */
  exportMatrix: Array<{ region: ExportRegion; targets: Array<{ ticker: string; name: string }> }>
  briefs: GeographyBrief[]
}

export function aggregateGeography(acquirer: Company, targets: OpTarget[]): ProgrammeGeography {
  const briefs = targets.map((t) => geographyFor(acquirer.sec || '', t))
  const hubSet = new Set<string>()
  const regionMap = new Map<ExportRegionId, { region: ExportRegion; targets: Array<{ ticker: string; name: string }> }>()
  for (const b of briefs) {
    b.hubs.forEach((h) => hubSet.add(h))
    for (const r of b.exports) {
      if (!regionMap.has(r.id)) regionMap.set(r.id, { region: r, targets: [] })
      regionMap.get(r.id)!.targets.push({ ticker: b.ticker, name: b.name })
    }
  }
  const exportMatrix = Array.from(regionMap.values()).sort((a, b) => b.targets.length - a.targets.length)
  return {
    acquirerCountry: 'India',
    acquirerHubs: SECTOR_HUB_STATES[acquirer.sec || ''] || ['Pan-India'],
    operationsFootprint: Array.from(hubSet).sort(),
    exportMatrix,
    briefs,
  }
}

/**
 * Simplified SVG flow map — not a real world projection. Renders:
 *   [ India + hub states ]  ─────►  Europe
 *                           ─────►  North America
 *                           ─────►  Middle East
 *                           …one arrow per destination region, thickness encoding
 *                           the number of targets touching that region.
 *
 * Designed to be readable in the PDF / letter-size preview without needing
 * any map-projection library. When non-India acquirer / targets land, we
 * render one "home country" box per ISO-group instead.
 */
export function renderProgrammeMap(programme: ProgrammeGeography): string {
  const width = 860
  const height = 60 + programme.exportMatrix.length * 42 + 20
  const leftW = 220
  const rightX = leftW + 180
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

  const rows = programme.exportMatrix.map((m, i) => {
    const y = 60 + i * 42
    const thickness = Math.min(6, 1.5 + m.targets.length)
    const targetNames = m.targets.map((t) => t.name).join(', ')
    return `
      <g>
        <line x1="${leftW + 8}" y1="${y + 10}" x2="${rightX - 8}" y2="${y + 10}" stroke="${m.region.color}" stroke-width="${thickness}" marker-end="url(#arrow-${m.region.id})" opacity="0.85" />
        <rect x="${rightX}" y="${y}" width="${width - rightX - 16}" height="28" rx="4" ry="4" fill="${m.region.color}" opacity="0.12" stroke="${m.region.color}" />
        <text x="${rightX + 10}" y="${y + 13}" font-size="11" font-weight="700" fill="${m.region.color}" font-family="Source Serif 4, Georgia, serif">${esc(m.region.label)} \u00b7 ${m.targets.length} target${m.targets.length === 1 ? '' : 's'}</text>
        <text x="${rightX + 10}" y="${y + 24}" font-size="9" fill="#0b1220" font-family="Source Serif 4, Georgia, serif">${esc(targetNames.length > 70 ? targetNames.slice(0, 68) + '\u2026' : targetNames)}</text>
        <defs>
          <marker id="arrow-${m.region.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="${m.region.color}"/>
          </marker>
        </defs>
      </g>`
  }).join('')

  const hubsLabel = programme.operationsFootprint.length > 0
    ? programme.operationsFootprint.slice(0, 4).join(', ') + (programme.operationsFootprint.length > 4 ? '…' : '')
    : 'Pan-India'

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="background:#fff;border:1px solid #d9dde3;border-radius:6px">
      <rect x="10" y="20" width="${leftW - 10}" height="${height - 40}" fill="#C8A24B" opacity="0.08" stroke="#C8A24B" rx="6" ry="6" />
      <text x="24" y="44" font-size="13" font-weight="800" fill="#0b1220" font-family="Source Serif 4, Georgia, serif">\ud83c\uddee\ud83c\uddf3 ${esc(programme.acquirerCountry)}</text>
      <text x="24" y="62" font-size="10" fill="#5c6477" font-family="Source Serif 4, Georgia, serif">Operations: ${esc(hubsLabel)}</text>
      <text x="24" y="78" font-size="9" fill="#5c6477" font-family="Source Serif 4, Georgia, serif">${programme.briefs.length} target${programme.briefs.length === 1 ? '' : 's'} in-country</text>
      <text x="10" y="14" font-size="9" fill="#5c6477" font-family="JetBrains Mono, monospace" letter-spacing="1">PROGRAMME GEOGRAPHY \u00b7 HOME \u2192 EXPORT CORRIDORS</text>
      ${rows}
    </svg>`
}
