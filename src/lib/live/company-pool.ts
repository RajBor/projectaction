/**
 * Unified company pool — single source of truth for the full universe.
 *
 * BEFORE this helper existed, every scraper route (scrape-exchange,
 * scrape-screener, publish-data) re-implemented the same union logic
 * inline: take static `COMPANIES[]`, overlay `user_companies`, done.
 * That was only ~114 companies because atlas-seeded tickers (SUZLON
 * subsidiaries, SME solar players, the Waaree value-chain expansion)
 * live in `industry_chain_companies` and never flowed through — the
 * admin ended up with ~180 companies visible in the value-chain view
 * but invisible to every refresh pipeline.
 *
 * This helper folds all three sources into one dedup'd Map, keyed by
 * ticker, with a precedence rule admin-push matters most:
 *
 *     user_companies  >  COMPANIES static seed  >  industry_chain_companies
 *
 * Rationale:
 *   - user_companies wins because the admin has actively curated /
 *     pushed that row (from Screener, NSE, or manual edit) — it's the
 *     freshest source of record.
 *   - static seed fills in the 85 hand-curated rows whose numbers were
 *     researched by hand; losing those to a stale atlas stub would be
 *     a silent regression.
 *   - industry_chain_companies fills the long tail (MAIN, SME,
 *     SUBSIDIARY with a listed ticker). These atlas rows have no P&L
 *     data of their own — they become candidates for NSE/Screener
 *     pulls, which is exactly what the user asked for.
 *
 * `industry_chain_companies` status values come from the atlas seed:
 *   MAIN       → listed on NSE/BSE main board
 *   SME        → listed on NSE SME / BSE SME platform
 *   SUBSIDIARY → listed (of a different parent ticker)
 *   UNLISTED / PRIVATE → no live quote
 * We include MAIN + SME + SUBSIDIARY (anything with a real ticker) but
 * drop PRIVATE / UNLISTED — the scrapers would 404 on them.
 *
 * This file is SERVER-ONLY (imports `@/lib/db`). The client-side
 * equivalent for LiveSnapshotProvider is GET /api/data/atlas-tickers
 * which exposes just the atlas rows so the provider can merge them
 * into `allCompanies` without duplicating the SQL on the browser.
 */

import { COMPANIES } from '@/lib/data/companies'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

export interface PoolEntry {
  /** Canonical ticker, uppercased. */
  ticker: string
  /** NSE symbol — falls back to ticker when atlas row has no explicit nse. */
  nse: string | null
  name: string
  /** Sector/industry tag if known (solar|wind|td|…). Null for atlas rows. */
  sec: string | null
  /** Which table the row was sourced from. For audit / debugging only. */
  source: 'db' | 'static' | 'atlas'
  /** Baseline financials — zero when the source doesn't carry them (atlas). */
  mktcap: number
  rev: number
  ebitda: number
  ev: number
}

/**
 * Build the live company pool across all three sources.
 *
 * Returns a Map<ticker, PoolEntry> so callers can .get() / .has() /
 * iterate without additional dedup logic. Always calls `ensureSchema()`
 * first so the `industry_chain_companies` table exists on fresh installs.
 *
 * Safe to call on every request — the work is ~3 small queries and the
 * atlas SELECT filters by status so it's cheap even with 500+ rows.
 */
export async function loadCompanyPool(): Promise<Map<string, PoolEntry>> {
  await ensureSchema()

  const pool = new Map<string, PoolEntry>()

  // 1. Static seed — lowest precedence, gets stomped by DB if overlapping.
  //    We take ALL static rows (not just the NSE-bearing ones) so
  //    commodity-index members or delisted entries still appear in the
  //    pool for downstream UI counts, even if no scraper can refresh them.
  for (const c of COMPANIES) {
    pool.set(c.ticker, {
      ticker: c.ticker,
      nse: c.nse || null,
      name: c.name,
      sec: c.sec || null,
      source: 'static',
      mktcap: c.mktcap || 0,
      rev: c.rev || 0,
      ebitda: c.ebitda || 0,
      ev: c.ev || 0,
    })
  }

  // 2. user_companies — wins over static when tickers collide. This is
  //    where admin-pushed overrides live. `rev` is pulled so downstream
  //    consumers (e.g. scrape-exchange) can derive EBITDA margins.
  try {
    const dbRows = await sql`
      SELECT ticker, nse, name, sec, mktcap, rev, ebitda, ev
      FROM user_companies
    `
    for (const r of dbRows as Array<{
      ticker: string; nse: string | null; name: string; sec: string | null;
      mktcap: unknown; rev: unknown; ebitda: unknown; ev: unknown
    }>) {
      pool.set(r.ticker, {
        ticker: r.ticker,
        nse: r.nse || null,
        name: r.name,
        sec: r.sec || null,
        source: 'db',
        mktcap: Number(r.mktcap) || 0,
        rev: Number(r.rev) || 0,
        ebitda: Number(r.ebitda) || 0,
        ev: Number(r.ev) || 0,
      })
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[company-pool] user_companies read skipped:', (err as Error)?.message || err)
  }

  // 3. industry_chain_companies — only fills gaps. We guard with
  //    `!pool.has()` so atlas can't clobber a curated DB row or a
  //    research-quality static seed entry. Only listed entries with a
  //    non-empty ticker become part of the scrape pool — PRIVATE /
  //    UNLISTED rows exist in the value-chain visualiser but would
  //    404 against NSE/Screener.
  try {
    const atlasRows = await sql`
      SELECT DISTINCT ON (ticker) ticker, name, industry_id
      FROM industry_chain_companies
      WHERE status IN ('MAIN','SME','SUBSIDIARY')
        AND ticker IS NOT NULL
        AND ticker <> ''
      ORDER BY ticker, industry_id ASC
    `
    for (const r of atlasRows as Array<{ ticker: string; name: string; industry_id: string }>) {
      const t = String(r.ticker).toUpperCase().trim()
      if (!t) continue
      if (pool.has(t)) continue  // DB / static row already wins
      pool.set(t, {
        ticker: t,
        // Atlas rows don't carry a distinct NSE symbol — the ticker
        // IS the live symbol for main-board / SME listings, which is
        // the same convention as scrape-exchange applies when
        // `user_companies.nse` is null.
        nse: t,
        name: r.name || t,
        sec: r.industry_id || null,
        source: 'atlas',
        // Atlas stubs have no financial baseline — downstream code
        // treats zero as "no baseline", which is what we want.
        mktcap: 0,
        rev: 0,
        ebitda: 0,
        ev: 0,
      })
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[company-pool] industry_chain_companies read skipped:', (err as Error)?.message || err)
  }

  return pool
}

/**
 * Convenience: load the pool and return only the subset that has a
 * live NSE symbol. This is what scrape-exchange / scrape-screener
 * actually want to iterate over — delisted tickers and UNLISTED
 * atlas rows are filtered out.
 */
export async function loadScrapeablePool(): Promise<PoolEntry[]> {
  const pool = await loadCompanyPool()
  return Array.from(pool.values()).filter((p) => p.nse)
}
