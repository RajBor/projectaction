/**
 * Investment criteria + market-intelligence data modules.
 *
 * These tables lift signals out of the M&A Strategy page (where they
 * previously lived as hardcoded JSX) into reusable TypeScript so the
 * Op-Identifier algorithm can filter / score on them.
 *
 * Scope:
 *   - COUNTRY_POLICY_REGIMES  — per-country policy score, active
 *     incentives, and restrictions to navigate. Feeds scoreCountryRegimeFit.
 *   - TRADE_FLOW_MATRIX       — sub-segment × country import economics
 *     (volume, growth, tariff) used for domestic-acquisition theses.
 *     Feeds scoreTradeFlowFit.
 *   - TARGET_ASSET_TYPES      — integration-direction taxonomy (upstream,
 *     downstream, tech, geographic platform, cross-sector). Feeds
 *     scoreAssetTypeFit via the OpTarget.integrationDir classifier.
 *
 * None of these are hard filters by themselves — they contribute to the
 * shared `preferenceBoost` ceiling inside identifyTargets().
 */

export type CountryRegimeId =
  | 'india' | 'usa' | 'uae' | 'western_europe' | 'south_asia' | 'china' | 'sea_korea'

export interface CountryPolicyRegime {
  id: CountryRegimeId
  label: string
  stance: string                        // one-line summary
  polScore: number                      // 0..100 — higher = better regime
  incentives: string[]
  restrictions: string[]
  tradeAgreements: string[]
  marketDrivers: string[]
}

export const COUNTRY_POLICY_REGIMES: CountryPolicyRegime[] = [
  {
    id: 'india',
    label: 'India',
    stance: 'Highly favourable for energy transition · BJP-led NDA (Modi 3.0)',
    polScore: 88,
    incentives: [
      'PLI — Solar modules ($3.2B outlay)',
      'PLI — ACC battery ($2.4B outlay)',
      'Green Hydrogen Mission ($2.3B)',
      'RDSS distribution reform',
      'NEP-2032 transmission capex',
    ],
    restrictions: [
      'Press Note 3: China FDI needs approval',
      'GST anti-profiteering for passed-through incentives',
      'Local content rules on certain tenders',
    ],
    tradeAgreements: ['UAE CEPA (0% tariff)', 'Australia ECTA', 'EFTA TEPA'],
    marketDrivers: ['500 GW non-fossil by 2030', '₹10 lakh crore transmission capex pipeline'],
  },
  {
    id: 'usa',
    label: 'USA',
    stance: 'Favourable domestic, restrictive foreign — IRA-driven',
    polScore: 72,
    incentives: [
      'IRA ITC 30% + bonus for domestic content',
      '48C advanced manufacturing credit',
      '45X production tax credit (per MWh / kWh)',
    ],
    restrictions: [
      'CFIUS review for Chinese / UAE-linked capital',
      'Section 301 tariffs on China imports',
      'Buy America provisions',
    ],
    tradeAgreements: ['USMCA', 'Bilateral FTAs with Korea, Japan, Singapore'],
    marketDrivers: ['IRA $369B clean-energy deployment', 'Grid modernization $13B'],
  },
  {
    id: 'uae',
    label: 'UAE',
    stance: 'Strongly favourable — Vision 2030 diversification',
    polScore: 82,
    incentives: [
      '44% clean energy by 2050 mandate',
      '$54B COP28 commitments',
      'Masdar equity co-investment',
    ],
    restrictions: [
      'Emiratization quotas for large employers',
      'Onshore ownership caps removed (2021)',
      'ESG disclosure mandatory for listed cos',
    ],
    tradeAgreements: ['India CEPA (0% tariff on 97% of trade)', 'UK FTA', 'Indonesia CEPA'],
    marketDrivers: ['ADIA / Mubadala / ADQ $2.5T AUM deployment', 'Masdar 100 GW by 2030 pipeline'],
  },
  {
    id: 'western_europe',
    label: 'Western Europe',
    stance: 'Net Zero 2050 mandate · CBAM and state-aid constraints',
    polScore: 68,
    incentives: [
      'EU Green Deal ($1T programme)',
      'InvestEU €372B guarantee envelope',
      'Net-Zero Industry Act (40% domestic manufacturing)',
    ],
    restrictions: [
      'CBAM phase-in (2026) — carbon border adjustment',
      'Foreign Subsidies Regulation review',
      'REPowerEU due-diligence on supply chains',
    ],
    tradeAgreements: ['UK FTA', 'India EFTA TEPA', 'Korea FTA'],
    marketDrivers: ['CBAM phase-in', 'Transmission grid expansion €584B'],
  },
  {
    id: 'south_asia',
    label: 'South Asia (ex-India)',
    stance: 'Mixed — Pakistan energy crisis, Bangladesh RE push',
    polScore: 48,
    incentives: ['Pakistan net-metering scheme', 'Bangladesh 40% RE by 2041'],
    restrictions: ['Forex/repatriation risk', 'Political volatility'],
    tradeAgreements: ['SAFTA (limited)'],
    marketDrivers: ['Pakistan IMF conditionalities favour private RE', 'Bangladesh import-substitution policy'],
  },
  {
    id: 'sea_korea',
    label: 'SEA + Korea',
    stance: 'Favourable — supply-chain diversification beneficiary',
    polScore: 64,
    incentives: ['Indonesia CEPA (with UAE)', 'Vietnam PPA reform', 'Korea K-Taxonomy + Green New Deal'],
    restrictions: ['Local content minimums (Indonesia, Vietnam)', 'PPA tariff caps'],
    tradeAgreements: ['AIFTA', 'Korea-India CEPA'],
    marketDrivers: ['China+1 capacity relocation', 'Data-centre RE PPAs'],
  },
  {
    id: 'china',
    label: 'China',
    stance: 'Restrictive for foreign acquirers — scale advantages offset by geopolitics',
    polScore: 35,
    incentives: ['Internal scale + cost leadership'],
    restrictions: ['CFIUS / FDI screening in buyer jurisdictions', 'Export-control overlap with dual-use'],
    tradeAgreements: ['RCEP'],
    marketDrivers: ['Overcapacity spill-over to exports'],
  },
]

export function lookupRegime(id: string): CountryPolicyRegime | undefined {
  return COUNTRY_POLICY_REGIMES.find(r => r.id === id)
}

/* ─────────────────────────────────────────────────────────────────
 *  Trade-flow opportunity matrix
 *  ---------------------------------------------------------------
 *  Sub-segment × country import economics. A net-importer country
 *  with high CAGR and tariff protection is a strong domestic-M&A
 *  thesis: onshore target + tariff moat + growth tailwind.
 *  Score = import_volume × CAGR × tariff (normalised).
 * ──────────────────────────────────────────────────────────────── */

export interface TradeFlowRow {
  id: string                         // deterministic row id
  segment: string                    // CHAIN segment id (matches target.comp)
  segmentLabel: string
  country: CountryRegimeId
  countryLabel: string
  position: 'importer' | 'exporter'
  importUsdBn: number                // annual import flow (USD bn)
  cagrPct: number
  tariffPct: number
  keyPartners: string[]
  opptyScore: number                 // 0..100 — pre-computed opportunity score
}

export const TRADE_FLOW_MATRIX: TradeFlowRow[] = [
  {
    id: 'solar_cells_india',
    segment: 'solar_cells', segmentLabel: 'Solar Cells',
    country: 'india', countryLabel: 'India',
    position: 'importer', importUsdBn: 2.1, cagrPct: 35, tariffPct: 25,
    keyPartners: ['China', 'Taiwan'], opptyScore: 80,
  },
  {
    id: 'solar_cells_usa',
    segment: 'solar_cells', segmentLabel: 'Solar Cells',
    country: 'usa', countryLabel: 'USA',
    position: 'importer', importUsdBn: 3.8, cagrPct: 42, tariffPct: 50,
    keyPartners: ['SEA', 'Korea'], opptyScore: 80,
  },
  {
    id: 'polysilicon_india',
    segment: 'polysilicon', segmentLabel: 'Polysilicon',
    country: 'india', countryLabel: 'India',
    position: 'importer', importUsdBn: 0.82, cagrPct: 22, tariffPct: 20,
    keyPartners: ['China'], opptyScore: 70,
  },
  {
    id: 'wafers_india',
    segment: 'wafers', segmentLabel: 'Silicon Wafers',
    country: 'india', countryLabel: 'India',
    position: 'importer', importUsdBn: 0.6, cagrPct: 25, tariffPct: 20,
    keyPartners: ['China'], opptyScore: 68,
  },
  {
    id: 'pv_glass_india',
    segment: 'pv_glass', segmentLabel: 'PV / Solar Glass',
    country: 'india', countryLabel: 'India',
    position: 'importer', importUsdBn: 0.42, cagrPct: 28, tariffPct: 15,
    keyPartners: ['China'], opptyScore: 62,
  },
  {
    id: 'silver_paste_india',
    segment: 'silver_paste', segmentLabel: 'Silver Paste',
    country: 'india', countryLabel: 'India',
    position: 'importer', importUsdBn: 0.28, cagrPct: 18, tariffPct: 10,
    keyPartners: ['Heraeus', 'DuPont'], opptyScore: 52,
  },
  {
    id: 'smart_meters_india',
    segment: 'smart_meters', segmentLabel: 'Smart Prepaid Meters',
    country: 'india', countryLabel: 'India',
    position: 'importer', importUsdBn: 0.8, cagrPct: 35, tariffPct: 15,
    keyPartners: ['Landis+Gyr', 'Itron'], opptyScore: 74,
  },
  {
    id: 'bess_india',
    segment: 'bess', segmentLabel: 'Battery Energy Storage',
    country: 'india', countryLabel: 'India',
    position: 'importer', importUsdBn: 0.8, cagrPct: 45, tariffPct: 20,
    keyPartners: ['China'], opptyScore: 82,
  },
  {
    id: 'power_transformers_usa',
    segment: 'power_transformers', segmentLabel: 'Power Transformers (>10MVA)',
    country: 'usa', countryLabel: 'USA',
    position: 'importer', importUsdBn: 1.6, cagrPct: 18, tariffPct: 15,
    keyPartners: ['Korea', 'Mexico'], opptyScore: 66,
  },
  {
    id: 'htls_india',
    segment: 'htls', segmentLabel: 'HTLS Conductors',
    country: 'india', countryLabel: 'India',
    position: 'importer', importUsdBn: 0.38, cagrPct: 22, tariffPct: 10,
    keyPartners: ['3M', 'CTC Global'], opptyScore: 54,
  },
  {
    id: 'hv_cables_western_europe',
    segment: 'hv_cables', segmentLabel: 'HV/EHV Underground Cables',
    country: 'western_europe', countryLabel: 'Western Europe',
    position: 'importer', importUsdBn: 2.4, cagrPct: 16, tariffPct: 8,
    keyPartners: ['Korea', 'Japan'], opptyScore: 58,
  },
  {
    id: 'ems_usa',
    segment: 'ems', segmentLabel: 'EMS / SCADA / Grid Automation',
    country: 'usa', countryLabel: 'USA',
    position: 'importer', importUsdBn: 0.9, cagrPct: 20, tariffPct: 5,
    keyPartners: ['ABB', 'Siemens'], opptyScore: 50,
  },
]

/** Build a (segment → row[]) index for fast per-target lookup. */
export function tradeFlowIndex(): Map<string, TradeFlowRow[]> {
  const m = new Map<string, TradeFlowRow[]>()
  for (const r of TRADE_FLOW_MATRIX) {
    const arr = m.get(r.segment) ?? []
    arr.push(r)
    m.set(r.segment, arr)
  }
  return m
}

/* ─────────────────────────────────────────────────────────────────
 *  Target asset type taxonomy
 *  ---------------------------------------------------------------
 *  Maps the strategic intent (upstream integration, downstream
 *  market access, technology build, geographic platform, cross-
 *  sector adjacency) onto OpTarget.integrationDir + sector heuristics.
 * ──────────────────────────────────────────────────────────────── */

export type TargetAssetType = 'upstream' | 'downstream' | 'technology' | 'geographic' | 'cross_sector'

export interface TargetAssetTypeMeta {
  id: TargetAssetType
  label: string
  rationale: string
}

export const TARGET_ASSET_TYPES: TargetAssetTypeMeta[] = [
  { id: 'upstream',    label: 'Upstream integration',     rationale: 'Secures input chain; reduces cost volatility; supply-security moat.' },
  { id: 'downstream',  label: 'Downstream / market access', rationale: 'Captures downstream margin pool; direct customer access.' },
  { id: 'technology',  label: 'Technology / capability',    rationale: 'Fills product or digital-capability gap; accelerates roadmap.' },
  { id: 'geographic',  label: 'Geographic platform',        rationale: 'Opens a new market or policy regime; local-partner foothold.' },
  { id: 'cross_sector', label: 'Cross-sector adjacency',    rationale: 'Portfolio de-risking; reduces single-sector concentration.' },
]

/**
 * Classify a target's asset type against the acquirer using the
 * integration direction heuristic already computed upstream.
 *   - backward → upstream
 *   - forward  → downstream
 *   - horizontal → technology (consolidation in same stage = capability deepening)
 *   - adjacent → cross_sector
 * When the target is in a different sector than the acquirer we flip
 * to geographic / cross_sector based on sector proximity.
 */
export function classifyAssetType(
  integrationDir: 'backward' | 'forward' | 'horizontal' | 'adjacent',
  acquirerSec: string,
  targetSec: string,
): TargetAssetType {
  if (integrationDir === 'backward') return 'upstream'
  if (integrationDir === 'forward') return 'downstream'
  if (integrationDir === 'adjacent') {
    return acquirerSec && targetSec && acquirerSec !== targetSec ? 'cross_sector' : 'geographic'
  }
  return 'technology'
}
