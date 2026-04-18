/**
 * Public catalog endpoint for the landing-page report picker.
 *
 * GET /api/public/catalog
 *
 * Returns the three-level tree the cascading dropdowns consume:
 *   { industries: [{ id, label, description, hasRichData,
 *                    valueChains: [{ id, name,
 *                      subSegments: [{id,code,name}],
 *                      companies: [{name,ticker,role,hasNumbers}] }] }] }
 *
 * No auth required — this endpoint is intentionally public.
 */

import { NextResponse } from 'next/server'
import { getPublicCatalog } from '@/lib/public-report/catalog'
import { getFeatureFlags } from '@/lib/platform-settings'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Bump this when the catalog shape/data changes. Paired with the
 * `?v=<CATALOG_VERSION>` query the client sends — together they
 * guarantee visitors with a stale browser cache immediately see the
 * new catalog on the next page load, without waiting for the old
 * `max-age` window to expire.
 *
 * History:
 *   1 – initial landing picker
 *   2 – normaliseTicker collapses placeholder em-dashes to null
 *   3 – name-fallback resolution + two-key dedup so atlas stale
 *       tickers (WAAREEENER, PREMIERENE) merge into the real
 *       COMPANIES rows (WAAREEENS, PREMIENRG) with ★.
 */
// Bumped to 4 — adds dynamic hasNumbers flag based on DB-published
// data, so stale browser caches don't hide freshly-published atlas
// tickers (or resurrect tickers whose DB rows have been zeroed).
const CATALOG_VERSION = 4

/**
 * Build a set of tickers that currently have usable financial data
 * in user_companies. Used to dynamically flag `hasNumbers: true` on
 * the catalog — which drives the landing-page dropdown filter so
 * only companies the user can actually generate a report for show up.
 *
 * "Usable" = at least ONE of mktcap / rev / ebitda is non-zero. That
 * matches the same threshold /reports and /report/[ticker] use to
 * decide whether a report renders as real numbers vs "no data" banner.
 * A single field is enough because the cascade (exchange → screener
 * → baseline) will fill the rest, and DCF / peer comparison degrade
 * gracefully when some fields are missing but at least mktcap is
 * present.
 *
 * Cached in module scope on the server — Next.js force-dynamic
 * re-runs the route per request, so this doesn't leak across builds,
 * but per-request the DB hit is sub-100ms with Neon's pooled driver.
 */
/**
 * Retry a Neon query up to `attempts` times with a short linear backoff.
 *
 * Neon's free-tier serverless Postgres scales compute to zero after a
 * few minutes of inactivity. The FIRST query after a wake-up typically
 * fails with `Couldn't connect to compute node` while the compute
 * spins up; the 2nd or 3rd succeeds ~1-2s later. Without a retry the
 * landing catalog would silently drop to the static skeleton (2
 * industries) on the very first visit after a quiet period, which
 * surfaces as "only 2 industries on the dropdown — where did the
 * others go?" — exactly the bug we're fixing.
 *
 * We keep the catch → empty-fallback semantics for the CATALOG-LEVEL
 * wrappers (so the route can still return the static part on genuine
 * errors) but retry the inner query so a cold-start wake-up is
 * handled transparently.
 */
async function withNeonRetry<T>(
  fn: () => Promise<T>,
  attempts = 4,
  baseDelayMs = 400,
): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message.toLowerCase() : String(err)
      const retryable =
        msg.includes('connect to compute node') ||
        msg.includes('timeout') ||
        msg.includes('econnreset') ||
        msg.includes('connection terminated') ||
        msg.includes('53300') || // too_many_connections
        msg.includes('57p03')    // cannot_connect_now
      if (!retryable || i === attempts - 1) break
      await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)))
    }
  }
  throw lastErr
}

async function loadPublishedTickers(): Promise<Set<string>> {
  try {
    await ensureSchema()
    const rows = await withNeonRetry(async () => sql`
      SELECT ticker
      FROM user_companies
      WHERE mktcap > 0 OR rev > 0 OR ebitda > 0
    `) as Array<{ ticker: string }>
    return new Set(rows.map((r) => r.ticker.toUpperCase()))
  } catch {
    return new Set()
  }
}

/**
 * Load every atlas-seeded company row (industry_chain_companies) grouped
 * by industry → stage_id. Lets the catalog route enrich industries
 * beyond solar/td with the real ticker list the admin has already
 * discovered — otherwise the landing-page dropdown keeps reporting
 * those industries as empty even after 400+ atlas tickers land in the
 * DB.
 *
 * Returns shape:
 *   Map<industry_id, Map<stage_id, Array<{ ticker, name, role, status }>>>
 */
interface AtlasCatalogCompany {
  ticker: string | null
  name: string
  role: string | null
  status: string | null
}
async function loadAtlasByIndustry(): Promise<
  Map<string, Map<string, AtlasCatalogCompany[]>>
> {
  try {
    const rows = await withNeonRetry(async () => sql`
      SELECT industry_id, stage_id, ticker, name, role, status
      FROM industry_chain_companies
      WHERE industry_id IS NOT NULL AND stage_id IS NOT NULL
    `) as Array<{
      industry_id: string
      stage_id: string
      ticker: string | null
      name: string
      role: string | null
      status: string | null
    }>
    const byIndustry = new Map<string, Map<string, AtlasCatalogCompany[]>>()
    for (const r of rows) {
      const ind = r.industry_id
      const stg = r.stage_id
      if (!byIndustry.has(ind)) byIndustry.set(ind, new Map())
      const byStage = byIndustry.get(ind)!
      if (!byStage.has(stg)) byStage.set(stg, [])
      byStage.get(stg)!.push({
        ticker: r.ticker || null,
        name: r.name,
        role: r.role,
        status: r.status,
      })
    }
    return byIndustry
  } catch {
    return new Map()
  }
}

/**
 * Load every populated user_companies row (admin-published ticker with
 * at least one of mktcap/rev/ebitda > 0) so the catalog can surface
 * industries that have DB-resident data but no static atlas-seed
 * mapping and no industry_chain_companies DB mapping either.
 *
 * Example: after the Phase 1 Fetch Missing sweep the admin has 57
 * pharma tickers in user_companies with sec='pharmaceuticals_and_
 * healthcare'. Without this lookup the landing dropdown has no way to
 * know pharma has reportable data.
 */
interface DbCompanyRow {
  ticker: string
  name: string
  sec: string | null
  mktcap: number
  rev: number
  ebitda: number
  excluded: boolean
}
async function loadDbCompaniesBySec(): Promise<Map<string, DbCompanyRow[]>> {
  try {
    const rows = await withNeonRetry(async () => sql`
      SELECT ticker, name, sec,
             COALESCE(mktcap, 0)::numeric AS mktcap,
             COALESCE(rev, 0)::numeric AS rev,
             COALESCE(ebitda, 0)::numeric AS ebitda,
             COALESCE(excluded_from_reports, FALSE) AS excluded
      FROM user_companies
      WHERE (mktcap > 0 OR rev > 0 OR ebitda > 0)
        AND COALESCE(excluded_from_reports, FALSE) = FALSE
    `) as Array<{
      ticker: string
      name: string
      sec: string | null
      mktcap: string | number
      rev: string | number
      ebitda: string | number
      excluded: boolean
    }>
    const bySec = new Map<string, DbCompanyRow[]>()
    for (const r of rows) {
      const secKey = (r.sec || '').toLowerCase().trim()
      if (!secKey) continue
      if (!bySec.has(secKey)) bySec.set(secKey, [])
      bySec.get(secKey)!.push({
        ticker: r.ticker,
        name: r.name,
        sec: secKey,
        mktcap: Number(r.mktcap) || 0,
        rev: Number(r.rev) || 0,
        ebitda: Number(r.ebitda) || 0,
        excluded: !!r.excluded,
      })
    }
    return bySec
  } catch {
    return new Map()
  }
}

/**
 * Normalise a user_companies.sec value onto a catalog industry id.
 * The DB holds both short ids (`solar`, `td`, `wind_energy`, `fmcg`)
 * and long auto-generated labels (`pharmaceuticals_and_healthcare`,
 * `cement_and_building_materials`) depending on which seeding path
 * inserted the row. We build a lookup by:
 *   1. exact id match
 *   2. normalised label match (lowercase, alphanumerics + underscores)
 * This way both forms converge onto the same catalog id.
 */
function buildSecToIndustryId(
  industries: Array<{ id: string; label: string }>,
): Map<string, string> {
  const norm = (s: string) =>
    s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const map = new Map<string, string>()
  // Pass 1 — exact matches on id and on normalised label.
  for (const ind of industries) {
    map.set(ind.id, ind.id)
    map.set(norm(ind.label), ind.id)
  }
  // Pass 2 — register a handful of taxonomy synonyms that differ from
  // the short catalog id. These are the longer `sec` strings that came
  // out of the admin seed-atlas / scrape-exchange paths before the
  // short-id convention was adopted. Keeps 38 chemicals + 20 EV +
  // 41 FMCG rows visible on the landing dropdown instead of
  // silently dropping them because the label-derived id didn't match.
  const synonyms: Record<string, string[]> = {
    chemicals: ['specialty_chemicals_and_agrochemicals', 'specialty_chemicals'],
    ev_battery: ['electric_vehicles_and_battery_storage', 'electric_vehicles'],
    fmcg: ['fmcg_and_consumer_products', 'fmcg_consumer_products'],
    pharma: ['pharmaceuticals_and_healthcare'],
    cement: ['cement_and_building_materials'],
    infra: ['infrastructure_and_construction'],
    it: ['it_and_technology_services', 'information_technology'],
    steel: ['steel_and_metals'],
    textiles: ['textiles_and_apparel'],
    solar: ['solar_pv_and_renewable_energy'],
    semicon: ['semiconductors_and_electronics'],
    shipping: ['shipping_and_maritime', 'shipping_logistics_and_maritime'],
    defence: ['defence_and_aerospace'],
    agri: ['agribusiness_and_food', 'agri_and_food'],
  }
  for (const [indId, aliases] of Object.entries(synonyms)) {
    // Only register aliases if the industry actually exists in the
    // catalog — guards against orphan synonym entries pointing at a
    // removed industry.
    if (industries.some((i) => i.id === indId)) {
      for (const alias of aliases) map.set(alias, indId)
    }
  }
  return map
}

/**
 * Load the curated stage names for each industry so the catalog can
 * display human-readable value-chain labels instead of raw stage ids
 * like `wind_energy__i15_blade_manufacturing`. Falls back to deriving a
 * title from the stage id if the stages table is empty / missing.
 */
interface AtlasStageRow {
  id: string
  industry_id: string
  name: string
}
async function loadAtlasStageNames(): Promise<Map<string, string>> {
  try {
    const rows = await withNeonRetry(async () => sql`
      SELECT id, name FROM industry_chain_stages
    `) as Array<{ id: string; name: string }>
    const map = new Map<string, string>()
    for (const r of rows) if (r.id && r.name) map.set(r.id, r.name)
    return map
  } catch {
    return new Map()
  }
  void ({} as AtlasStageRow)
}

/** Reasonable display name derived from a stage id when the stages
 *  table is empty. `wind_energy__i15_blade_manufacturing` becomes
 *  "Blade Manufacturing". */
function deriveStageName(stageId: string): string {
  const tail = stageId.includes('__') ? stageId.split('__').slice(1).join('__') : stageId
  const withoutPrefix = tail.replace(/^i\d+_/, '')
  return withoutPrefix
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export async function GET() {
  try {
    const flags = await getFeatureFlags()
    if (!flags.landingSampleReportEnabled) {
      return NextResponse.json(
        { error: 'feature_disabled' },
        { status: 403 }
      )
    }
    const industries = getPublicCatalog()
    const [publishedTickers, atlasByIndustry, atlasStageNames, dbBySec] =
      await Promise.all([
        loadPublishedTickers(),
        loadAtlasByIndustry(),
        loadAtlasStageNames(),
        loadDbCompaniesBySec(),
      ])
    const secToIndustryId = buildSecToIndustryId(industries)

    // Post-process pass 1 — flip `hasNumbers` on existing catalog
    // companies when they've been published to user_companies.
    const seeded = industries.map((ind) => ({
      ...ind,
      valueChains: ind.valueChains.map((vc) => ({
        ...vc,
        companies: vc.companies.map((c) => ({
          ...c,
          hasNumbers:
            c.hasNumbers ||
            (c.ticker != null && publishedTickers.has(c.ticker.toUpperCase())),
        })),
      })),
    }))

    // Post-process pass 2 — union in `industry_chain_companies` rows
    // for every registered industry. The static atlas-seed JSON only
    // carries curated solar/T&D ticker lists, which is why industries
    // like wind/pharma/cement appeared empty on the landing dropdown
    // even after admin pushed 400+ atlas rows into user_companies.
    //
    // For each industry we now:
    //   • Merge atlas companies into an existing value chain that
    //     matches the stage id (in case TAXONOMY_STAGES already
    //     reserved a VC with that code).
    //   • Otherwise create a new value chain from the stage id with a
    //     human-readable name from industry_chain_stages (or a derived
    //     label when the stages table is empty).
    //   • Flag `hasNumbers` against the publishedTickers set — admin
    //     push → landing dropdown lights up the industry immediately.
    const enriched = seeded.map((ind) => {
      const atlasStages = atlasByIndustry.get(ind.id)
      if (!atlasStages || atlasStages.size === 0) return ind

      const vcByStageId = new Map(ind.valueChains.map((vc) => [vc.id, vc]))
      const nextChains = ind.valueChains.map((vc) => ({ ...vc, companies: [...vc.companies] }))
      const nextChainsByStageId = new Map(nextChains.map((vc) => [vc.id, vc]))

      for (const [stageId, companies] of Array.from(atlasStages.entries())) {
        let vc = nextChainsByStageId.get(stageId)
        if (!vc) {
          vc = {
            id: stageId,
            name: atlasStageNames.get(stageId) || deriveStageName(stageId),
            subSegments: [],
            companies: [],
          }
          nextChains.push(vc)
          nextChainsByStageId.set(stageId, vc)
        }
        // Dedupe: skip atlas rows whose ticker is already in this VC's
        // company list (the curated seed wins).
        const seenTickers = new Set(vc.companies.map((c) => (c.ticker || '').toUpperCase()))
        const seenNames = new Set(vc.companies.map((c) => c.name.toLowerCase().trim()))
        for (const co of companies) {
          const tkey = (co.ticker || '').toUpperCase()
          if (tkey && seenTickers.has(tkey)) continue
          const nkey = co.name.toLowerCase().trim()
          if (!tkey && seenNames.has(nkey)) continue
          const hasNumbers = !!(tkey && publishedTickers.has(tkey))
          vc.companies.push({
            name: co.name,
            ticker: co.ticker,
            role: co.role,
            status: co.status,
            hasNumbers,
          })
          if (tkey) seenTickers.add(tkey)
          seenNames.add(nkey)
        }
      }

      // Drop any VC that still has zero companies AND zero sub-segments
      // to avoid clutter in the dropdown.
      const trimmed = nextChains.filter(
        (vc) => vc.subSegments.length > 0 || vc.companies.length > 0
      )

      // Mark the industry as rich when ANY company in any VC has
      // numbers — solar+td keep their hardcoded true from the static
      // catalog; others now light up once the admin publishes even
      // one ticker for that industry.
      const anyWithNumbers = trimmed.some((vc) =>
        vc.companies.some((c) => c.hasNumbers)
      )
      return {
        ...ind,
        hasRichData: ind.hasRichData || anyWithNumbers,
        valueChains: trimmed,
      }
      void vcByStageId
    })

    // Post-process pass 3 — union populated user_companies rows that
    // weren't covered by the static atlas-seed or the atlas DB table.
    //
    // The Phase-1 "Fetch Missing" sweep inserts a user_companies row
    // for every ticker it scrapes, tagged with the sec (industry) the
    // scrape pool knew at fetch time. 443 such rows span 13 industries
    // (pharma=57, cement=41, IT=29, chemicals=38, steel=34, textiles=
    // 51, …) that otherwise have zero rows in industry_chain_companies
    // and no atlas-seed entries, so the landing dropdown couldn't
    // discover them even though the data to generate reports is right
    // there in user_companies.
    //
    // For each industry we add any missing tickers to a synthetic
    // "All Listed Companies" value chain so the landing picker has
    // something to show without requiring the admin to curate stage
    // mappings first. Once atlas stage mappings arrive the tickers
    // promote naturally into the real VCs.
    const finalIndustries = enriched.map((ind) => {
      const coRows: DbCompanyRow[] = []
      // Collect every DB row whose normalised sec maps to this industry.
      for (const [secKey, rows] of Array.from(dbBySec.entries())) {
        if (secToIndustryId.get(secKey) === ind.id) {
          coRows.push(...rows)
        }
      }
      if (coRows.length === 0) return ind

      // Dedupe against whatever already exists in this industry's VCs.
      const seenTickers = new Set<string>()
      const seenNames = new Set<string>()
      for (const vc of ind.valueChains) {
        for (const c of vc.companies) {
          if (c.ticker) seenTickers.add(c.ticker.toUpperCase())
          seenNames.add(c.name.toLowerCase().trim())
        }
      }
      const extras: Array<{ name: string; ticker: string | null; role: string | null; status: string | null; hasNumbers: boolean }> = []
      for (const r of coRows) {
        const tkey = r.ticker.toUpperCase()
        if (seenTickers.has(tkey)) continue
        const nkey = r.name.toLowerCase().trim()
        if (seenNames.has(nkey)) continue
        extras.push({
          name: r.name,
          ticker: r.ticker,
          role: null,
          status: null,
          hasNumbers: true, // filter above already required non-zero financials
        })
        seenTickers.add(tkey)
        seenNames.add(nkey)
      }
      if (extras.length === 0) return ind

      const nextChains = [...ind.valueChains]
      // Find or create the "All Listed Companies" catch-all VC.
      const catchAllId = `__all_${ind.id}`
      let catchAll = nextChains.find((vc) => vc.id === catchAllId)
      if (!catchAll) {
        catchAll = {
          id: catchAllId,
          name: 'All Listed Companies',
          subSegments: [],
          companies: [],
        }
        nextChains.push(catchAll)
      }
      catchAll.companies.push(...extras)

      // The industry is now rich by definition — we just added
      // companies with verified non-zero financials.
      return {
        ...ind,
        hasRichData: true,
        valueChains: nextChains,
      }
    })

    return NextResponse.json(
      { industries: finalIndustries, v: CATALOG_VERSION, published: publishedTickers.size },
      {
        headers: {
          'Cache-Control':
            'public, max-age=60, s-maxage=60, stale-while-revalidate=600',
        },
      }
    )
  } catch (err) {
    return NextResponse.json(
      { error: 'catalog_failed', message: (err as Error).message },
      { status: 500 }
    )
  }
}
