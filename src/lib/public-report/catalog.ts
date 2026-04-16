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

/**
 * Explicit mapping: CHAIN node id ({@link chain.ts}) → DealNector
 * taxonomy stage code. The CHAIN data groups solar / T&D around our
 * internal seed (e.g. `solar_modules`, `hv_cables`) while the taxonomy
 * uses stage codes like `1.2`. Without an explicit map a company whose
 * `comp` is `["solar_modules"]` would never land in stage `1.2`
 * (Wafer, Cell & Module Manufacturing) because the CHAIN node's
 * category ("Solar → Module Assembly") doesn't loosely match the
 * taxonomy stage name.
 */
const CHAIN_ID_TO_TAX_STAGE: Record<string, string> = {
  // Solar 1.1 — Raw Materials, Glass & Chemicals
  polysilicon: '1.1',
  silver_paste: '1.1',
  pv_glass: '1.1',
  encapsulants: '1.1',
  al_frame: '1.1',
  backsheet: '1.1',
  junction_box: '1.1',
  bus_ribbon: '1.1',
  mc4_connector: '1.1',
  // Solar 1.2 — Wafer, Cell & Module Manufacturing
  wafers: '1.2',
  solar_cells: '1.2',
  solar_modules: '1.2',
  // Solar 1.3 — Inverter, Tracker & Power Electronics
  inverters: '1.3',
  mounting: '1.3',
}

/** Ticker values from the atlas-seed that mean "no public ticker". */
const NULL_TICKERS = new Set(['', '-', '—', '–', 'N/A', 'NA', 'PRIVATE'])

/** Normalise an atlas-seed ticker — returns null when it's a placeholder. */
function normaliseTicker(raw: string | null | undefined): string | null {
  if (!raw) return null
  const t = raw.trim().toUpperCase()
  if (!t || NULL_TICKERS.has(t)) return null
  return t
}

/**
 * Normalise a company name for cross-source matching. The atlas-seed
 * sometimes carries the same company under a mangled ticker (e.g.
 * "Waaree Energies → WAAREEENER" when NSE lists it as WAAREEENS;
 * "Premier Energies → PREMIERENE" vs COMPANIES' PREMIENRG). When the
 * ticker-based lookup misses we fall back to this name key so the
 * right COMPANIES row still gets wired up and the ★ appears.
 *
 * Strategy: lower-case, drop everything except [a-z0-9], and also
 * strip any trailing "(xxx)" suffix (atlas sometimes tags subsidiaries
 * like "Adani Solar (ANIL)"). Corporate-form words like "Ltd" /
 * "Limited" are deliberately preserved because removing them can
 * collapse distinct companies ("Adani Solar" vs "Adani Solar Ltd"
 * are genuinely the same, but "Waaree Energies" must not collide
 * with "Waaree Renewable Technologies").
 */
function normaliseName(raw: string): string {
  return raw
    .replace(/\s*\([^)]*\)\s*$/g, '') // drop trailing "(XYZ)" suffixes
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim()
}

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
  // Company index by normalised name → numeric row. Used as a fallback
  // when the atlas-seed ticker is stale / mangled but the name still
  // matches a real COMPANIES entry (e.g. atlas WAAREEENER → NSE
  // WAAREEENS). First wins on name collisions, which is fine because
  // COMPANIES carries only one listed row per business name.
  const companyByName = new Map<string, Company>()
  for (const c of COMPANIES) {
    if (c.ticker) companyByTicker.set(c.ticker.toUpperCase(), c)
    const nkey = normaliseName(c.name)
    if (nkey && !companyByName.has(nkey)) companyByName.set(nkey, c)
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
        // `normaliseTicker` collapses placeholder tickers like '—',
        // '-' and 'PRIVATE' to null so they don't all dedupe into a
        // single row keyed on the em-dash (which hid ~20 private
        // companies from the Wafer/Cell/Module dropdown).
        const atlasTicker = normaliseTicker(raw.ticker)
        // Prefer a direct COMPANIES ticker hit. When that fails (atlas
        // carries a stale symbol), fall back to a name-based lookup so
        // the entry still lights up with ★ instead of appearing as an
        // orphan "no numbers, request access" row next to the real
        // numeric entry. `resolved` is null only when the atlas name
        // truly doesn't match any COMPANIES row.
        let resolved: Company | null = null
        if (atlasTicker && companyByTicker.has(atlasTicker)) {
          resolved = companyByTicker.get(atlasTicker)!
        } else {
          const hit = companyByName.get(normaliseName(raw.name))
          if (hit) resolved = hit
        }
        vc.companies.push({
          // Always present the COMPANIES-side display name when we
          // resolved to a real row — it's the canonical brand (e.g.
          // "Waaree Energies" rather than atlas' "Waaree Energies ").
          name: resolved?.name || raw.name,
          ticker: resolved?.ticker || atlasTicker,
          role: raw.role || null,
          status: raw.status || null,
          hasNumbers: !!resolved,
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
  // Two dedup keys:
  //   • ticker (if present) — catches the common case of the same NSE
  //     symbol being added by both the atlas overlay and injectSolarRich.
  //   • normalised name      — catches the rarer case where two sources
  //     carry the same business under *different* tickers (atlas's stale
  //     WAAREEENER vs COMPANIES' WAAREEENS, for example). Without this
  //     fallback the dropdown shows "Waaree Energies" twice — once with
  //     numbers, once without — which is maximally confusing.
  //
  // When a collision is detected we keep the entry with richer data:
  // `hasNumbers` wins; if both/neither have numbers, the first wins.
  const byTicker = new Map<string, CatalogCompany>()
  const byName = new Map<string, CatalogCompany>()
  const picked: CatalogCompany[] = []

  const replaceIn = (map: Map<string, CatalogCompany>, key: string, next: CatalogCompany) => {
    const prior = map.get(key)
    if (!prior) {
      map.set(key, next)
      picked.push(next)
      return
    }
    if (next.hasNumbers && !prior.hasNumbers) {
      // Swap in-place so the picked-order stays stable.
      const idx = picked.indexOf(prior)
      if (idx >= 0) picked[idx] = next
      map.set(key, next)
      // Also refresh the other index so a later lookup by the other
      // key still returns the winning entry.
      if (prior.ticker) byTicker.set(prior.ticker.toUpperCase(), next)
      const pn = normaliseName(prior.name)
      if (pn) byName.set(pn, next)
    }
  }

  for (const c of list) {
    const tKey = c.ticker ? c.ticker.toUpperCase() : null
    const nKey = normaliseName(c.name)
    // If either key already collides, route through replaceIn so the
    // merged result flows into both indexes.
    const ticketHit = tKey ? byTicker.get(tKey) : undefined
    const nameHit = nKey ? byName.get(nKey) : undefined
    if (ticketHit || nameHit) {
      if (tKey) replaceIn(byTicker, tKey, c)
      if (nKey) replaceIn(byName, nKey, c)
      continue
    }
    if (tKey) byTicker.set(tKey, c)
    if (nKey) byName.set(nKey, c)
    picked.push(c)
  }

  return picked.sort((a, b) => {
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

/**
 * Inject solar COMPANIES[] rows into every taxonomy stage they operate
 * in. Each company's `comp[]` can list multiple CHAIN node ids (e.g.
 * Waaree: `["solar_modules","solar_cells","wafers"]`), and we want the
 * company to appear under *every* relevant stage — not just the first
 * one. Previously this function used only `comp[0]` and relied on a
 * loose name match between CHAIN categories and taxonomy stage names,
 * which silently failed (e.g. "Module Assembly" vs
 * "Wafer, Cell & Module Manufacturing") and sent the entries to the
 * wrong bucket.
 */
function injectSolarRich(
  industries: Map<string, CatalogIndustry>,
  companyByTicker: Map<string, Company>
) {
  const solar = industries.get('solar')
  if (!solar) return
  const stageByCode = new Map<string, CatalogValueChain>()
  for (const vc of solar.valueChains) stageByCode.set(vc.id, vc)

  for (const c of Array.from(companyByTicker.values()).filter((x) => x.sec === 'solar')) {
    if (!c.comp || c.comp.length === 0) continue
    const hit = new Set<string>()
    for (const compId of c.comp) {
      const stageCode = CHAIN_ID_TO_TAX_STAGE[compId]
      if (!stageCode || hit.has(stageCode)) continue
      const vc = stageByCode.get(stageCode)
      if (!vc) continue
      hit.add(stageCode)
      // Use the CHAIN node name as the "role" label so the competitive
      // landscape table reads "Waaree Energies — Solar Modules
      // (Bifacial/TOPCon)" instead of an anonymous entry.
      const node = CHAIN.find((n) => n.id === compId)
      if (!vc.companies.some((cc) => cc.ticker === c.ticker)) {
        vc.companies.push({
          name: c.name,
          ticker: c.ticker,
          role: node?.name || compId.replace(/_/g, ' '),
          status: 'MAIN',
          hasNumbers: true,
        })
      } else {
        // Company already in this stage via atlas-seed — upgrade the
        // `hasNumbers` flag and role label to the richer version.
        const existing = vc.companies.find((cc) => cc.ticker === c.ticker)
        if (existing) {
          existing.hasNumbers = true
          if (!existing.role && node) existing.role = node.name
        }
      }
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
