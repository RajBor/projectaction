/**
 * Landing-page catalog — the data that powers the three cascading
 * dropdowns (Industry → Value chain → Sub value chain) plus the
 * optional "pick a company" step on the fourth dropdown.
 *
 * Built once at module load from three existing sources so we don't
 * have to round-trip the DB for every landing page visit:
 *
 *  1. TAXONOMY_STAGES / SUB_SEGMENTS — DealNector VC-Taxonomy (15
 *     industries · 79 stages · 668 sub-segments).
 *  2. CHAIN / GROUPS                  — the curated solar & T&D seed
 *     that already drives the Dashboard and Value Chain pages. Used
 *     to fold the hand-curated stage names ("Solar — Raw Materials")
 *     in front of the Excel taxonomy stages.
 *  3. atlas-seed.json                 — tickers + role descriptions
 *     for the other 13 industries so the company picker still has
 *     a meaningful pool for wind / EV / steel / etc.
 *
 * The resulting tree is purely illustrative — the landing page is
 * public, so it must not leak any paid-tier insights. Numbers come
 * from COMPANIES[] (solar & T&D) at report-generation time, while
 * the other industries render with atlas-seed's qualitative roles
 * and the taxonomy-backed market narrative.
 */

import { CHAIN } from '@/lib/data/chain'
import { COMPANIES, type Company } from '@/lib/data/companies'
import {
  TAXONOMY_STAGES,
  INDUSTRY_ID_TO_CODE,
  type SubSegment,
} from '@/lib/data/sub-segments'
import atlasSeed from '@/data/atlas-seed.json'

// ────────────────────────────────────────────────────────────────────
// Canonical industry display — 15 DealNector-taxonomy industries plus
// 'td' which isn't a taxonomy top-level but IS a first-class site
// industry for the curated T&D data we already ship.
// ────────────────────────────────────────────────────────────────────

export interface CatalogCompany {
  name: string
  ticker: string | null
  role?: string | null
  status?: string | null
  hasNumbers: boolean // true iff this ticker resolves into COMPANIES[]
}

export interface CatalogSubSegment {
  id: string
  code: string // e.g. '1.1.3'
  name: string
}

export interface CatalogValueChain {
  id: string // stageCode when from taxonomy, CHAIN.id for curated fallback
  name: string
  subSegments: CatalogSubSegment[]
  companies: CatalogCompany[]
}

export interface CatalogIndustry {
  id: string // site industry id ('solar', 'td', 'wind_energy' …)
  label: string
  description: string
  hasRichData: boolean // true if COMPANIES[] carries numeric rows for this industry
  valueChains: CatalogValueChain[]
}

// ── Atlas-seed helpers ──────────────────────────────────────────────

interface AtlasCompanyRaw {
  name: string
  ticker?: string | null
  role?: string | null
  status?: string | null
  exchange?: string | null
}
interface AtlasStageRaw {
  id: string
  name: string
  description?: string
  companies?: AtlasCompanyRaw[]
}
interface AtlasIndustryRaw {
  code: string // 'I01'..'I15'
  label: string
  description?: string
  stages?: AtlasStageRaw[]
}

const atlas = (atlasSeed as { industries: AtlasIndustryRaw[] }).industries

/** Maps atlas code ('I01') → taxonomy industry code ('1'). */
function atlasCodeToTaxCode(atlasCode: string): string {
  // 'I01' → '1', 'I15' → '15'
  return String(parseInt(atlasCode.slice(1), 10))
}

/** Maps taxonomy industry code → our site industry id. Inverts INDUSTRY_ID_TO_CODE. */
function taxCodeToSiteId(taxCode: string): string {
  // Prefer the shortest canonical alias per code (e.g. 'solar' over 'solar_pv').
  const preferred: Record<string, string> = {
    '1': 'solar',
    '2': 'wind_energy',
    '3': 'ev_battery',
    '4': 'steel',
    '5': 'pharma',
    '6': 'chemicals',
    '7': 'semicon',
    '8': 'textiles',
    '9': 'fmcg',
    '10': 'infra',
    '11': 'defence',
    '12': 'it',
    '13': 'agri',
    '14': 'cement',
    '15': 'shipping',
  }
  return preferred[taxCode] || `industry_${taxCode}`
}

// ── Build the catalog (lazy-initialised, cached in module scope) ────

let cached: CatalogIndustry[] | null = null

export function getPublicCatalog(): CatalogIndustry[] {
  if (cached) return cached

  // Company index by ticker → numeric row (solar + T&D).
  const companyByTicker = new Map<string, Company>()
  for (const c of COMPANIES) {
    if (c.ticker) companyByTicker.set(c.ticker.toUpperCase(), c)
  }

  // 1) Start from the taxonomy (authoritative for sub-segments).
  const industries = new Map<string, CatalogIndustry>()

  for (const stage of TAXONOMY_STAGES) {
    const siteId = taxCodeToSiteId(stage.industryCode)
    if (!industries.has(siteId)) {
      industries.set(siteId, {
        id: siteId,
        label: labelForTaxCode(stage.industryCode),
        description: descForTaxCode(stage.industryCode),
        hasRichData: siteId === 'solar', // solar gets COMPANIES numbers
        valueChains: [],
      })
    }
    const ind = industries.get(siteId)!
    ind.valueChains.push({
      id: stage.code,
      name: stage.name,
      subSegments: stage.subs.map((s: SubSegment) => ({
        id: s.id,
        code: s.code,
        name: s.name,
      })),
      companies: [],
    })
  }

  // 2) Overlay atlas-seed company lists onto the matching taxonomy
  //    stages (match by stage name, case-insensitive, soft-trimmed).
  for (const atlasInd of atlas) {
    const siteId = taxCodeToSiteId(atlasCodeToTaxCode(atlasInd.code))
    const ind = industries.get(siteId)
    if (!ind) continue
    if (atlasInd.description && !ind.description) ind.description = atlasInd.description
    for (const stage of atlasInd.stages || []) {
      const vc = findVcByName(ind, stage.name)
      if (!vc) continue
      for (const raw of stage.companies || []) {
        const ticker = raw.ticker ? raw.ticker.toUpperCase() : null
        vc.companies.push({
          name: raw.name,
          ticker,
          role: raw.role || null,
          status: raw.status || null,
          hasNumbers: !!(ticker && companyByTicker.has(ticker)),
        })
      }
    }
  }

  // 3) Promote COMPANIES tickers into their resolved industry even if
  //    atlas-seed didn't carry them (catches T&D which isn't a
  //    taxonomy top-level and the solar tickers already seeded).
  injectTdIndustry(industries, companyByTicker)
  injectSolarRich(industries, companyByTicker)

  // 4) Deduplicate company lists (by ticker/name) and sort —
  //    hasNumbers first, then alphabetical.
  industries.forEach((ind) => {
    for (const vc of ind.valueChains) {
      vc.companies = dedupeCompanies(vc.companies)
    }
    // Drop empty value chains (they confuse the UI).
    ind.valueChains = ind.valueChains.filter(
      (vc: CatalogValueChain) => vc.subSegments.length > 0 || vc.companies.length > 0
    )
  })

  // Deterministic order: solar → td → the rest alphabetical by label.
  const sorted = Array.from(industries.values()).sort((a, b) => {
    const pri = (id: string) => (id === 'solar' ? 0 : id === 'td' ? 1 : 2)
    const pa = pri(a.id)
    const pb = pri(b.id)
    if (pa !== pb) return pa - pb
    return a.label.localeCompare(b.label)
  })

  cached = sorted
  return sorted
}

function labelForTaxCode(code: string): string {
  const MAP: Record<string, string> = {
    '1': 'Solar PV & Renewable Energy',
    '2': 'Wind Energy',
    '3': 'EV & Battery Storage',
    '4': 'Steel & Metals',
    '5': 'Pharmaceuticals & Healthcare',
    '6': 'Specialty Chemicals',
    '7': 'Semiconductors & Electronics',
    '8': 'Textiles & Apparel',
    '9': 'FMCG & Consumer',
    '10': 'Infrastructure & Construction',
    '11': 'Defence & Aerospace',
    '12': 'IT & Technology Services',
    '13': 'Agribusiness & Food',
    '14': 'Cement & Building Materials',
    '15': 'Shipping & Maritime',
  }
  return MAP[code] || `Industry ${code}`
}

function descForTaxCode(code: string): string {
  const MAP: Record<string, string> = {
    '1': 'India solar value chain — raw materials, modules, BOS, EPC and O&M.',
    '2': 'Onshore & offshore wind — turbines, blades, towers, EPC and O&M.',
    '3': 'EV battery cells, packs, BESS integration and charging infra.',
    '4': 'Primary & secondary steel, specialty steel and non-ferrous metals.',
    '5': 'Pharma formulations, APIs, medical devices and healthcare services.',
    '6': 'Specialty chemicals, agrochemicals and advanced materials.',
    '7': 'Semiconductors, ATMP, OSAT and electronics manufacturing services.',
    '8': 'Spinning, weaving, dyeing, technical textiles and branded apparel.',
    '9': 'Consumer staples, personal care and packaged foods.',
    '10': 'EPC, urban T&D, roads, railways, water and smart-city build-out.',
    '11': 'Defence platforms, electronics, avionics and aerospace supply.',
    '12': 'IT services, SaaS, data-centre and platform businesses.',
    '13': 'Agri inputs, processed foods, cold-chain and agri-logistics.',
    '14': 'Cement, RMC, aggregates and building materials.',
    '15': 'Shipping, ports, containers and maritime logistics.',
  }
  return MAP[code] || ''
}

/** Lookup a value chain by loose name match (case + whitespace insensitive). */
function findVcByName(ind: CatalogIndustry, rawName: string): CatalogValueChain | null {
  const norm = (s: string) => s.toLowerCase().replace(/[\s,_&\-/]+/g, '')
  const target = norm(rawName)
  let best: CatalogValueChain | null = null
  let bestScore = -1
  for (const vc of ind.valueChains) {
    const candidate = norm(vc.name)
    if (candidate === target) return vc
    if (candidate.includes(target) || target.includes(candidate)) {
      const score = Math.min(candidate.length, target.length)
      if (score > bestScore) {
        bestScore = score
        best = vc
      }
    }
  }
  return best
}

function dedupeCompanies(list: CatalogCompany[]): CatalogCompany[] {
  const seen = new Map<string, CatalogCompany>()
  for (const c of list) {
    const key = (c.ticker || c.name).toUpperCase()
    const prior = seen.get(key)
    if (!prior) {
      seen.set(key, c)
      continue
    }
    // Prefer the entry with numbers; otherwise keep the first.
    if (c.hasNumbers && !prior.hasNumbers) seen.set(key, c)
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.hasNumbers !== b.hasNumbers) return a.hasNumbers ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/**
 * T&D doesn't have a DealNector-taxonomy top-level, but we ship a rich
 * CHAIN + COMPANIES set for it. Synthesise an industry out of the
 * CHAIN nodes whose sec='td' and populate companies from COMPANIES.
 */
function injectTdIndustry(
  industries: Map<string, CatalogIndustry>,
  companyByTicker: Map<string, Company>
) {
  const tdNodes = CHAIN.filter((n) => n.sec === 'td')
  if (tdNodes.length === 0) return

  const byCategory = new Map<string, { name: string; companies: CatalogCompany[] }>()
  for (const n of tdNodes) {
    // cat looks like "T&D → Transformers" — use suffix as stage name
    const stageName = (n.cat.split('→').pop() || n.cat).trim()
    if (!byCategory.has(stageName)) {
      byCategory.set(stageName, { name: stageName, companies: [] })
    }
    const bucket = byCategory.get(stageName)!
    const matchingCompanies = Array.from(companyByTicker.values()).filter(
      (c) => c.sec === 'td' && c.comp.includes(n.id)
    )
    for (const mc of matchingCompanies) {
      bucket.companies.push({
        name: mc.name,
        ticker: mc.ticker,
        role: n.name,
        status: 'MAIN',
        hasNumbers: true,
      })
    }
  }

  industries.set('td', {
    id: 'td',
    label: 'Power Transmission & Distribution (T&D)',
    description:
      'Grid-side infrastructure — transformers, switchgear, conductors, smart metering, SCADA/EMS and BESS integration.',
    hasRichData: true,
    valueChains: Array.from(byCategory.values()).map((b, i) => ({
      id: `td_stage_${i + 1}`,
      name: b.name,
      subSegments: [], // T&D isn't in the taxonomy; no sub-segments to show
      companies: dedupeCompanies(b.companies),
    })),
  })
}

/** Inject solar COMPANIES rows into the best-matching solar stage. */
function injectSolarRich(
  industries: Map<string, CatalogIndustry>,
  companyByTicker: Map<string, Company>
) {
  const solar = industries.get('solar')
  if (!solar) return
  // For each solar company, pick the taxonomy stage that maps to its
  // primary comp[] entry. We use CHAIN to find the node's category.
  for (const c of Array.from(companyByTicker.values()).filter((x) => x.sec === 'solar')) {
    const primaryComp = c.comp[0]
    if (!primaryComp) continue
    const node = CHAIN.find((n) => n.id === primaryComp)
    if (!node) continue
    const stageName = (node.cat.split('→').pop() || node.cat).trim()
    const vc = findVcByName(solar, stageName) || solar.valueChains[0]
    if (!vc) continue
    if (!vc.companies.some((cc) => cc.ticker === c.ticker)) {
      vc.companies.push({
        name: c.name,
        ticker: c.ticker,
        role: node.name,
        status: 'MAIN',
        hasNumbers: true,
      })
    }
  }
}

// ── Resolution helpers for the report API ──────────────────────────

export function findIndustry(id: string): CatalogIndustry | null {
  return getPublicCatalog().find((i) => i.id === id) || null
}

export function findValueChain(
  industryId: string,
  vcId: string
): { industry: CatalogIndustry; vc: CatalogValueChain } | null {
  const industry = findIndustry(industryId)
  if (!industry) return null
  const vc = industry.valueChains.find((v) => v.id === vcId)
  if (!vc) return null
  return { industry, vc }
}

export function findSubSegment(
  industryId: string,
  vcId: string,
  subId: string
): CatalogSubSegment | null {
  const hit = findValueChain(industryId, vcId)
  if (!hit) return null
  return hit.vc.subSegments.find((s) => s.id === subId) || null
}

/** Unused canary to confirm INDUSTRY_ID_TO_CODE is in scope when debugging. */
export const __DEBUG_INDUSTRY_CODE_MAP = INDUSTRY_ID_TO_CODE
