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

/**
 * Strategic-advantage catalogue per region. These are the levers an
 * acquirer pulls when it looks at a geography: why that region is
 * attractive beyond just "the sector exports there". Deterministic
 * defaults for now; will be enriched by live World Bank / UN Comtrade /
 * DGFT feeds once those land (see `evidenceSource`).
 */
export type AdvantageAxis =
  | 'cheap_labor'
  | 'raw_materials'
  | 'policy_tailwind'
  | 'trade_agreement'
  | 'market_size'
  | 'proximity_logistics'
  | 'energy_cost'
  | 'demographic'
  | 'infrastructure'
  | 'currency'

export interface StrategicAdvantage {
  axis: AdvantageAxis
  short: string
  detail: string
  evidenceSource: string
}

export const REGION_ADVANTAGES: Record<ExportRegionId, StrategicAdvantage[]> = {
  europe: [
    { axis: 'market_size', short: 'Large affluent demand pool', detail: 'EU27 + UK together are a ~$20 T GDP block with premium willingness-to-pay for sustainability-compliant goods.', evidenceSource: 'Eurostat + World Bank WDI' },
    { axis: 'policy_tailwind', short: 'CBAM + REPowerEU + CRM Act', detail: 'Carbon border tax rewards low-embodied-carbon Indian goods; REPowerEU unlocks renewable procurement; Critical Raw Materials Act opens non-China sourcing lanes.', evidenceSource: 'European Commission CBAM regulation' },
    { axis: 'trade_agreement', short: 'India-EU FTA on the table + India-UK CETA signed (2024)', detail: 'Bilateral tariff concessions and rules-of-origin favour vertically-integrated Indian manufacturers.', evidenceSource: 'India MoCI FTA dashboard' },
  ],
  north_america: [
    { axis: 'market_size', short: 'Largest single-country consumer market', detail: 'USA: ~$27 T GDP, premium pricing bands, BFSI + healthcare + retail IT services concentration.', evidenceSource: 'BEA + World Bank' },
    { axis: 'policy_tailwind', short: 'IRA + CHIPS + BILL domestic-content premiums', detail: 'India-origin components qualify for IRA bonus credit via FTA-partner pathways (e.g. 30D EV credit; 45X advanced-manufacturing).', evidenceSource: 'US Treasury IRA guidance' },
    { axis: 'policy_tailwind', short: 'China+1 de-risking across supply chains', detail: 'UFLPA + sections 301/232 tariffs push US buyers to non-China second sources; India wins in solar, chemicals, pharma, electronics.', evidenceSource: 'USTR section-301 determinations' },
  ],
  middle_east: [
    { axis: 'energy_cost', short: 'Cheapest power + gas in the world', detail: 'Gulf grids deliver <4¢/kWh industrial tariffs; attractive for energy-intensive refining + petrochemicals + aluminium downstream.', evidenceSource: 'IEA Electricity Prices report' },
    { axis: 'policy_tailwind', short: 'Saudi Vision-2030 + UAE D33 capex', detail: '~$3 T combined mega-project pipeline through 2030 across renewables, logistics, semiconductors, tourism infra.', evidenceSource: 'PIF + Mubadala public annual reports' },
    { axis: 'trade_agreement', short: 'India-UAE CEPA + GCC-wide FTA in negotiation', detail: 'Zero/low tariff on ~85% of HS lines for India-origin goods; fast-track customs at Jebel Ali + Abu Dhabi FTZs.', evidenceSource: 'India MoCI CEPA text' },
    { axis: 'infrastructure', short: 'Duty-free Free Zones (Jebel Ali, KIZAD, KAEC)', detail: '100% foreign ownership, no corporate tax for 15-50 years, direct access to deep-sea ports + airline cargo hubs.', evidenceSource: 'DMCC / JAFZA authority data' },
  ],
  africa: [
    { axis: 'cheap_labor', short: 'Lowest median wages globally ex-South-Asia', detail: 'Manufacturing wage bands ~$80\u2013$200/month in Ethiopia, Kenya, Nigeria, Egypt; 10\u201315 years behind India wage curve.', evidenceSource: 'ILO Global Wage Report + Deloitte GMCI' },
    { axis: 'raw_materials', short: 'Cobalt, lithium, platinum, copper, rare earths', detail: 'DRC (cobalt 70% of world supply), Zimbabwe (lithium, PGM), South Africa (PGM, chrome), Zambia (copper). Critical for EV + wind + solar upstream.', evidenceSource: 'USGS Mineral Commodity Summaries' },
    { axis: 'policy_tailwind', short: 'AfCFTA single market + EXIM India LoCs', detail: 'African Continental Free Trade Area = 1.3 B people, $3 T GDP by 2030; India EXIM extends concessional credit backing Indian-origin procurement.', evidenceSource: 'AfCFTA Secretariat + EXIM India LoC directory' },
    { axis: 'demographic', short: 'World\u2019s youngest + fastest-growing workforce', detail: 'Median age 19 in Sub-Saharan Africa; 2.5x the population growth rate of Asia.', evidenceSource: 'UN DESA WPP' },
  ],
  se_asia: [
    { axis: 'trade_agreement', short: 'India-ASEAN FTA + RCEP-adjacent access', detail: 'Zero-duty access across 10 ASEAN economies; Indian FTAs with Japan (CEPA), Korea (CEPA), and Thailand (EHS) compound.', evidenceSource: 'ASEAN Secretariat trade stats' },
    { axis: 'market_size', short: 'Vietnam + Indonesia + Philippines growth cluster', detail: 'Combined ~600 M population with $5k+ GDP/capita trajectories by 2030; manufacturing + middle-class consumption tailwind.', evidenceSource: 'IMF WEO projections' },
    { axis: 'raw_materials', short: 'Indonesian nickel + Vietnamese bauxite + Malaysian rare earths', detail: 'Indonesia controls ~50% global nickel supply (critical for EV cathodes); Vietnam has world-class bauxite and rare-earth reserves.', evidenceSource: 'USGS MCS + OECD Raw Materials Risk list' },
    { axis: 'proximity_logistics', short: '3\u20137 day shipping from West Coast India', detail: 'Chennai/Mundra to Jakarta/Ho Chi Minh/Manila: shortest Indian Ocean sea lanes after Gulf.', evidenceSource: 'Shipping alliance schedule data' },
  ],
  latin_america: [
    { axis: 'raw_materials', short: 'Lithium triangle + iron ore + copper + soy', detail: 'Chile + Argentina + Bolivia hold ~58% of world lithium reserves; Brazil is top iron-ore exporter; Peru + Chile together ~40% of world copper.', evidenceSource: 'USGS + DNPM Brazil' },
    { axis: 'market_size', short: 'Brazil + Mexico anchor + USMCA adjacency', detail: 'Brazil ~$2 T GDP consumer market; Mexico nearshoring tailwind via USMCA rules-of-origin.', evidenceSource: 'IMF WEO + USTR USMCA impact report' },
    { axis: 'currency', short: 'Structural peso/real depreciation cycle', detail: 'Historical 8\u201315%/yr depreciation against USD makes India-origin CIF pricing 20\u201330% below local alternatives for capital goods.', evidenceSource: 'BIS Nominal Effective Exchange Rate' },
  ],
  oceania: [
    { axis: 'trade_agreement', short: 'India-Australia ECTA + CECA (in negotiation)', detail: 'ECTA zero/low tariff on ~96% of India-origin goods; CECA will extend to services + investment protection.', evidenceSource: 'DFAT Australia ECTA text' },
    { axis: 'raw_materials', short: 'Critical minerals powerhouse', detail: 'Australia: world\u2019s largest lithium exporter, top-3 for cobalt + rare earths; strategic Indian interest via KABIL JV.', evidenceSource: 'Geoscience Australia + MEA KABIL' },
    { axis: 'market_size', short: 'High-income but compact market', detail: 'Combined ~$2 T GDP; tech services, education, and defence-industrial verticals with India-diaspora pull.', evidenceSource: 'ABS + StatsNZ' },
  ],
  south_asia: [
    { axis: 'trade_agreement', short: 'SAFTA + bilateral FTAs (Sri Lanka, Bhutan, Nepal)', detail: 'Duty-free access to ~85% HS lines; India-Bangladesh transit + transhipment protocols easing bulk cargo.', evidenceSource: 'SAARC Secretariat + India MoCI' },
    { axis: 'proximity_logistics', short: 'Cross-border rail + road transit', detail: 'Petrapole\u2013Benapole, Raxaul\u2013Birgunj, Wagah\u2013Attari corridors handle billions in bilateral trade; sub-24-hr delivery possible.', evidenceSource: 'Land Ports Authority of India' },
    { axis: 'cheap_labor', short: 'Bangladesh garment cluster + low-wage hubs', detail: 'Bangladesh + Nepal manufacturing wages 50\u201370% of India median; used for low-value apparel offshoring.', evidenceSource: 'ILO LABORSTA' },
  ],
}

/**
 * Prospective-corridor ranker. Given a target and (optional) user-
 * preferred regions, returns a ranked list of export corridors with
 * composite attractiveness score + top strategic reasons.
 *
 * Composite score = sectorFitScore + advantageScore + userPrefBoost.
 *   sectorFitScore: 3 for top sector corridor, 2 for second, 1 for others,
 *     0.5 for regions not in the sector map at all (opportunistic).
 *   advantageScore: number of strategic advantages / 2, capped at 3.
 *   userPrefBoost: +2 when the region is in the user's preferred list.
 *
 * Returning top 5 keeps the report readable and the scoring meaningful.
 */
export interface ProspectiveCorridor {
  region: ExportRegion
  score: number
  sectorMatchRank: number | null // 1-based rank in sector map (null if opportunistic)
  advantages: StrategicAdvantage[]
  isUserPreferred: boolean
  rationale: string
}

export function prospectiveGeographies(
  target: OpTarget,
  sectorOfRecord: string,
  preferredRegions: ExportRegionId[] = [],
): ProspectiveCorridor[] {
  const sec = target.sec || sectorOfRecord
  const sectorCorridors = SECTOR_EXPORT_DESTINATIONS[sec] || []
  const sectorRankMap = new Map<ExportRegionId, number>()
  sectorCorridors.forEach((r, i) => sectorRankMap.set(r.id, i + 1))
  // Union of sector-typical corridors + user-preferred (so we always surface user picks even if sector-atypical).
  const candidateIds: ExportRegionId[] = []
  for (const r of sectorCorridors) {
    if (!candidateIds.includes(r.id)) candidateIds.push(r.id)
  }
  for (const r of preferredRegions) {
    if (!candidateIds.includes(r)) candidateIds.push(r)
  }

  const corridors: ProspectiveCorridor[] = []
  for (const id of candidateIds) {
    // Resolve the ExportRegion descriptor: prefer sector-specific (has
    // sector-calibrated reasoning) else synthesise from REGION_ADVANTAGES.
    let region: ExportRegion | undefined = sectorCorridors.find((r) => r.id === id)
    if (!region) {
      // Build a minimal ExportRegion descriptor for opportunistic candidates.
      const labelByRegion: Record<ExportRegionId, { label: string; countries: string[]; color: string }> = {
        europe: { label: 'Europe (EU + UK)', countries: ['Germany', 'France', 'UK', 'Netherlands'], color: '#1e5aa8' },
        north_america: { label: 'North America', countries: ['USA', 'Canada'], color: '#c7334f' },
        middle_east: { label: 'Middle East', countries: ['UAE', 'Saudi Arabia', 'Qatar'], color: '#C8A24B' },
        africa: { label: 'Africa', countries: ['South Africa', 'Egypt', 'Nigeria', 'Kenya'], color: '#d97706' },
        se_asia: { label: 'SE Asia', countries: ['Vietnam', 'Indonesia', 'Singapore'], color: '#0aa5b2' },
        latin_america: { label: 'Latin America', countries: ['Brazil', 'Mexico', 'Chile'], color: '#0f9e6e' },
        oceania: { label: 'Oceania (ANZ)', countries: ['Australia', 'New Zealand'], color: '#6d28d9' },
        south_asia: { label: 'South Asia', countries: ['Bangladesh', 'Nepal', 'Sri Lanka'], color: '#6d28d9' },
      }
      const meta = labelByRegion[id]
      region = {
        id,
        label: meta.label,
        countries: meta.countries,
        color: meta.color,
        reasoning: 'Opportunistic expansion corridor \u2014 sector-atypical but flagged by user preference or cross-corridor strategic fit.',
      }
    }
    const rank = sectorRankMap.get(id) || null
    const sectorFitScore = rank === 1 ? 3 : rank === 2 ? 2 : rank ? 1 : 0.5
    const advantages = REGION_ADVANTAGES[id] || []
    const advantageScore = Math.min(3, advantages.length * 0.5)
    const isUserPreferred = preferredRegions.includes(id)
    const userPrefBoost = isUserPreferred ? 2 : 0
    const score = sectorFitScore + advantageScore + userPrefBoost
    let rationale = ''
    if (isUserPreferred && rank === 1) rationale = 'User-preferred + top sector corridor \u2014 highest priority.'
    else if (isUserPreferred) rationale = 'User-preferred corridor; sector fit is secondary but strategic advantages compensate.'
    else if (rank === 1) rationale = 'Top sector-typical corridor \u2014 immediate inheritance from acquisition.'
    else if (rank === 2) rationale = 'Secondary sector corridor \u2014 meaningful but smaller than top.'
    else if (rank) rationale = 'Tertiary sector corridor \u2014 diversification potential.'
    else rationale = 'Opportunistic: not a sector-typical corridor today, but strategic-advantage stack makes it worth scoping.'
    corridors.push({ region, score, sectorMatchRank: rank, advantages, isUserPreferred, rationale })
  }
  corridors.sort((a, b) => b.score - a.score)
  return corridors.slice(0, 5)
}

/**
 * Label for UI rendering (short + human).
 */
export const REGION_LABELS: Record<ExportRegionId, string> = {
  europe: 'Europe',
  north_america: 'North America',
  middle_east: 'Middle East',
  africa: 'Africa',
  se_asia: 'SE Asia',
  latin_america: 'Latin America',
  oceania: 'Oceania',
  south_asia: 'South Asia',
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
