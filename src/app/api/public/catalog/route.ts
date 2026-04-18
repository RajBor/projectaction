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
async function loadPublishedTickers(): Promise<Set<string>> {
  try {
    await ensureSchema()
    const rows = await sql`
      SELECT ticker
      FROM user_companies
      WHERE mktcap > 0 OR rev > 0 OR ebitda > 0
    ` as Array<{ ticker: string }>
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
    const rows = await sql`
      SELECT industry_id, stage_id, ticker, name, role, status
      FROM industry_chain_companies
      WHERE industry_id IS NOT NULL AND stage_id IS NOT NULL
    ` as Array<{
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
    const rows = await sql`
      SELECT id, name FROM industry_chain_stages
    ` as Array<{ id: string; name: string }>
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
    const [publishedTickers, atlasByIndustry, atlasStageNames] =
      await Promise.all([
        loadPublishedTickers(),
        loadAtlasByIndustry(),
        loadAtlasStageNames(),
      ])

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

    return NextResponse.json(
      { industries: enriched, v: CATALOG_VERSION, published: publishedTickers.size },
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
