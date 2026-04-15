import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { COMPANIES, type Company } from '@/lib/data/companies'
import { recomputeAcqScore } from '@/lib/valuation/live-metrics'
import {
  fetchScreenerHtml,
  screenerCode,
  parseTopRatios,
  parseProfitLoss,
} from '@/lib/live/screener-fetch'

// Bulk push from the admin "Push All from …" buttons can UPSERT up to
// ~294 rows in sequence. With Neon cold-start latency that can take
// north of 45s, which blows past the default Vercel serverless 10–15s
// ceiling and returns a gateway-timeout HTML page — precisely the body
// that produced the "Unexpected token 'A', 'An error o'..." crash the
// admin saw before safeJson + this knob landed.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * POST /api/admin/publish-data
 *
 * Admin / sub-admin only. Two operations:
 *
 * 1. newCompanies[] — INSERT new companies into the `user_companies`
 *    DB table (works on read-only filesystems like Vercel).
 *
 * 2. overrides{} — UPDATE existing user_companies rows OR seed a new
 *    row from the static COMPANIES[] seed if the ticker isn't in the
 *    DB yet. This is what the admin Data Sources tab "Push to Website"
 *    button drives — picking NSE, Screener, or RapidAPI as the source
 *    and pushing fresh financials that replace the baseline.
 *
 * Dynamic acquisition score:
 *    After applying the override financials to the baseline seed, we
 *    recompute the 7-driver acqs score via recomputeAcqScore so the
 *    M&A Radar / Valuation / Dashboard pages immediately reflect the
 *    new valuation. A richer EV/EBITDA drags acqs down; stronger
 *    revenue growth pushes it up. The client can also supply an
 *    explicit acqs/acqf to hard-override, in which case we use that.
 *
 * Audit trail:
 *    `baseline_updated_at` is stamped to NOW() and `baseline_source`
 *    to the caller-supplied label ('screener', 'exchange', 'rapidapi')
 *    so the admin table shows per-company "last refreshed from X" info.
 *
 * Body: {
 *   overrides?: Record<string, Partial<CompanyFields> & { source?: BaselineSource }>
 *   source?: BaselineSource                          // bulk default
 *   newCompanies?: CompanyFields[]
 * }
 */

type BaselineSource = 'exchange' | 'screener' | 'rapidapi' | 'manual'

interface CompanyFields {
  name: string
  ticker: string
  nse: string | null
  sec: 'solar' | 'td'
  comp: string[]
  mktcap: number
  rev: number
  ebitda: number
  pat: number
  ev: number
  ev_eb: number
  pe: number
  pb: number
  dbt_eq: number
  revg: number
  ebm: number
  acqs: number
  acqf: string
  rea: string
}

interface OverridePatch extends Partial<CompanyFields> {
  source?: BaselineSource
}

/** Classify acqs 1..10 → flag, matching the platform's existing bands. */
function flagFromScore(score: number): string {
  if (score >= 9) return 'STRONG BUY'
  if (score >= 7) return 'CONSIDER'
  if (score >= 5) return 'MONITOR'
  if (score >= 3) return 'PASS'
  return 'PASS'
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let body: {
    overrides?: Record<string, OverridePatch>
    newCompanies?: CompanyFields[]
    source?: BaselineSource
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const addedBy = session.user.email || 'admin'
  const defaultSource: BaselineSource = body.source ?? 'manual'

  try {
    await ensureSchema()

    // Budget: Vercel gateway enforces ~60s on Pro regardless of
    // maxDuration=300 for the *initial* response. We track elapsed time
    // from the top of the handler and short-circuit heavy work (auto-
    // backfill Screener scrapes) once we're past our own internal budget
    // so the admin gets a real 200 instead of a 504 HTML blob.
    const startedAt = Date.now()
    const BUDGET_MS = 45_000

    let insertedCount = 0
    let updatedCount = 0
    let seededCount = 0
    const skipped: string[] = []
    // Tickers that were freshly inserted AND had zero financials — these
    // are candidates for the post-insert Screener auto-backfill pass so
    // the company appears on dashboards with real numbers immediately,
    // not blank until the next admin "Push from Screener" sweep.
    const insertedBlankTickers: Array<{ ticker: string; nse: string; name: string; sec: string }> = []
    let autoBackfilled = 0

    // ── Insert new companies (with duplicate detection) ──
    const newCompanies = body.newCompanies || []
    for (const nc of newCompanies) {
      // Server-side duplicate detection:
      // 1. Exact ticker match in static COMPANIES[]
      // 2. Fuzzy name match (first 2 words) in static COMPANIES[]
      // 3. Financial similarity (mktcap within 10%) in static COMPANIES[]
      // 4. Existing row in user_companies DB table (ticker or name match)
      const ncNameWords = nc.name.toLowerCase().split(/\s+/).slice(0, 2).join(' ')

      const staticDup = COMPANIES.find((c) => {
        // Exact ticker/nse match
        if (c.ticker === nc.ticker || c.nse === nc.ticker) return true
        // Fuzzy name match
        const cNameWords = c.name.toLowerCase().split(/\s+/).slice(0, 2).join(' ')
        if (cNameWords === ncNameWords) return true
        // Financial similarity: if mktcap is within 10% AND name shares a word
        if (nc.mktcap > 0 && c.mktcap > 0) {
          const ratio = nc.mktcap / c.mktcap
          if (ratio > 0.9 && ratio < 1.1) {
            const cWords = new Set(c.name.toLowerCase().split(/\s+/))
            const ncWords = nc.name.toLowerCase().split(/\s+/)
            if (ncWords.some((w) => w.length >= 4 && cWords.has(w))) return true
          }
        }
        return false
      })

      if (staticDup) {
        skipped.push(`${nc.name} — duplicate of ${staticDup.name} (${staticDup.ticker})`)
        continue
      }

      // Check DB for existing row with same ticker or similar name
      const dbDup = await sql`
        SELECT id, name, ticker FROM user_companies
        WHERE ticker = ${nc.ticker}
           OR LOWER(SUBSTRING(name FROM 1 FOR 30)) = ${ncNameWords.slice(0, 30)}
        LIMIT 1
      `
      if (dbDup.length > 0) {
        skipped.push(`${nc.name} — already in DB as ${dbDup[0].name} (${dbDup[0].ticker})`)
        continue
      }

      const compJson = JSON.stringify(nc.comp || [])
      try {
        await sql`
          INSERT INTO user_companies (
            name, ticker, nse, sec, comp,
            mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
            acqs, acqf, rea, added_by,
            baseline_updated_at, baseline_source
          ) VALUES (
            ${nc.name}, ${nc.ticker}, ${nc.nse || nc.ticker}, ${nc.sec}, ${compJson},
            ${nc.mktcap || 0}, ${nc.rev || 0}, ${nc.ebitda || 0}, ${nc.pat || 0},
            ${nc.ev || 0}, ${nc.ev_eb || 0}, ${nc.pe || 0}, ${nc.pb || 0},
            ${nc.dbt_eq || 0}, ${nc.revg || 0}, ${nc.ebm || 0},
            ${nc.acqs || 5}, ${nc.acqf || 'MONITOR'}, ${nc.rea || ''}, ${addedBy},
            NOW(), ${defaultSource}
          )
          ON CONFLICT (ticker) DO UPDATE SET
            name = EXCLUDED.name,
            mktcap = EXCLUDED.mktcap,
            rev = EXCLUDED.rev,
            ebitda = EXCLUDED.ebitda,
            pat = EXCLUDED.pat,
            ev = EXCLUDED.ev,
            ev_eb = EXCLUDED.ev_eb,
            pe = EXCLUDED.pe,
            pb = EXCLUDED.pb,
            dbt_eq = EXCLUDED.dbt_eq,
            ebm = EXCLUDED.ebm,
            baseline_updated_at = NOW(),
            baseline_source = EXCLUDED.baseline_source,
            updated_at = NOW()
        `
        insertedCount++

        // Queue for auto-backfill when the admin added a bare row (no
        // financials supplied). This is the main path for the admin
        // "Add company" modal — they type in a name/ticker, click save,
        // and expect the platform to find the financials itself. Without
        // this queue the row ends up as zeros on every dashboard until
        // the admin remembers to hit "Push All from Screener" afterwards.
        const isBlank = (nc.mktcap || 0) === 0 && (nc.rev || 0) === 0
        if (isBlank) {
          insertedBlankTickers.push({
            ticker: nc.ticker,
            nse: nc.nse || nc.ticker,
            name: nc.name,
            sec: nc.sec,
          })
        }
      } catch (err) {
        console.error(`[publish-data] Insert ${nc.ticker} failed:`, err)
      }
    }

    // ── Auto-backfill newly-inserted blank rows from Screener ──
    // Runs inline (not a background job) so the admin gets a single
    // round-trip: POST → insert → Screener fetch → UPDATE → response
    // with populated numbers. This is what makes "data pushed
    // immediately across the site" actually true — without this, the
    // LiveSnapshotProvider broadcast propagates a row of zeros.
    //
    // Concurrency + budget guards:
    //  - Cap at AUTO_BACKFILL_LIMIT tickers per request. Beyond that
    //    the admin should use the dedicated "Push All from Screener"
    //    sweep which has proper batching. Without this cap, adding
    //    150 companies at once would sequentially fetch 150 Screener
    //    pages inside a 60s Vercel invocation → guaranteed 504.
    //  - Fire the backfills in parallel (they're independent HTTP
    //    calls). The 8s per-fetch timeout inside fetchScreenerHtml
    //    bounds worst-case latency.
    //  - Skip entirely if we're already past BUDGET_MS — the caller
    //    will see the inserted rows (at zeros), and the next scheduled
    //    scrape will fill them in within the hour.
    //
    // Caveats:
    //  1. We only run Screener (not NSE) because NSE needs session
    //     cookies + rate-limiting that's too slow for an inline call.
    //     The admin "Push from Exchange" button stays around for the
    //     authoritative NSE refresh later.
    //  2. Only Screener's top-ratios + last P&L column are pulled —
    //     this gives mktcap, PE, revenue, net profit, OPM. That's
    //     enough for dashboards and the acqs score recompute. Balance-
    //     sheet deep parsing stays on the dedicated scrape route.
    //  3. If Screener 404s or returns a stub, the row stays at zeros
    //     — no harm done, admin can still manually edit later.
    const AUTO_BACKFILL_LIMIT = 5
    const backfillQueue = insertedBlankTickers.slice(0, AUTO_BACKFILL_LIMIT)
    if (backfillQueue.length > 0 && Date.now() - startedAt < BUDGET_MS) {
      const results = await Promise.all(
        backfillQueue.map(async (co) => {
          try {
            const code = screenerCode(co.ticker, co.nse)
            const { html } = await fetchScreenerHtml(code)
            if (!html) return { ticker: co.ticker, ok: false }
            const tr = parseTopRatios(html)
            const pl = parseProfitLoss(html)

            const mktcap = tr.mktcap != null ? Math.round(tr.mktcap) : null
            const pe = tr.pe ?? null
            const rev = pl.sales != null ? Math.round(pl.sales) : null
            const pat = pl.netProfit != null ? Math.round(pl.netProfit) : null
            const ebitda = rev != null && rev > 0 && pl.opm != null && pl.opm > 0
              ? Math.round((rev * pl.opm) / 100)
              : null
            const ebm = ebitda != null && rev != null && rev > 0
              ? Math.round((ebitda / rev) * 1000) / 10
              : null
            const revg = rev != null && rev > 0 && pl.salesPrev != null && pl.salesPrev > 0
              ? Math.round(((rev / pl.salesPrev - 1) * 100) * 10) / 10
              : null
            const debt = tr.debt ?? null
            const ev = mktcap != null ? mktcap + (debt ?? 0) : null
            const evEb = ev != null && ebitda != null && ebitda > 0
              ? Math.round((ev / ebitda) * 10) / 10
              : null
            const pb = tr.price != null && tr.bookValue != null && tr.bookValue > 0
              ? Math.round((tr.price / tr.bookValue) * 100) / 100
              : null
            const equity = pb != null && mktcap != null && pb > 0 ? mktcap / pb : null
            const dbtEq = debt != null && equity != null && equity > 0
              ? Math.round((debt / equity) * 100) / 100
              : null

            const populated: Company = {
              name: co.name,
              ticker: co.ticker,
              nse: co.nse,
              sec: (co.sec as 'solar' | 'td') || 'solar',
              comp: [],
              mktcap: mktcap ?? 0, rev: rev ?? 0, ebitda: ebitda ?? 0, pat: pat ?? 0,
              ev: ev ?? 0, ev_eb: evEb ?? 0, pe: pe ?? 0, pb: pb ?? 0,
              dbt_eq: dbtEq ?? 0, revg: revg ?? 0, ebm: ebm ?? 0,
              acqs: 5, acqf: 'MONITOR', rea: '',
            }
            const hasRealData = (rev ?? 0) > 0 || (mktcap ?? 0) > 0
            const audit = hasRealData ? recomputeAcqScore(populated) : null
            const acqs = audit?.normalised ?? 5
            const acqf = audit ? flagFromScore(audit.normalised) : 'MONITOR'

            await sql`
              UPDATE user_companies SET
                mktcap = COALESCE(${mktcap}, mktcap),
                rev    = COALESCE(${rev},    rev),
                ebitda = COALESCE(${ebitda}, ebitda),
                pat    = COALESCE(${pat},    pat),
                ev     = COALESCE(${ev},     ev),
                ev_eb  = COALESCE(${evEb},   ev_eb),
                pe     = COALESCE(${pe},     pe),
                pb     = COALESCE(${pb},     pb),
                dbt_eq = COALESCE(${dbtEq},  dbt_eq),
                revg   = COALESCE(${revg},   revg),
                ebm    = COALESCE(${ebm},    ebm),
                acqs   = ${acqs},
                acqf   = ${acqf},
                baseline_updated_at = NOW(),
                baseline_source = 'screener',
                updated_at = NOW()
              WHERE ticker = ${co.ticker}
            `
            return { ticker: co.ticker, ok: hasRealData }
          } catch (err) {
            console.warn(`[publish-data] Auto-backfill ${co.ticker} failed:`, err instanceof Error ? err.message : err)
            return { ticker: co.ticker, ok: false }
          }
        })
      )
      autoBackfilled = results.filter((r) => r.ok).length
    }

    // ── Update overrides (upsert into user_companies) ──
    //
    // Per-ticker push: applies the patch fields on top of whatever
    // baseline we can find (existing DB row > static COMPANIES[] seed).
    // If the ticker only exists in static COMPANIES[], we seed a new
    // DB row with the baseline values + the override financials. This
    // is what makes "Push to Website" from the admin Data Sources tab
    // actually replace baseline data on the main site.
    const overrides = body.overrides || {}
    const overrideEntries = Object.entries(overrides)

    // Fan-out override processing in parallel chunks. The sequential
    // for-loop took ~150 × (~200ms SELECT + ~200ms UPDATE + network RTT)
    // which pushed "Push All from DealNector" past Vercel's 60s gateway
    // ceiling and returned a 504 HTML blob — the FUNCTION_INVOCATION_TIMEOUT
    // the admin hit. Running 10 rows in parallel brings the wall-clock
    // down to ~6s for a full 150-row sweep without overloading Neon.
    const OVERRIDE_CONCURRENCY = 10

    const applyOverride = async (ticker: string, patch: OverridePatch): Promise<void> => {
      const patchSource: BaselineSource = patch.source ?? defaultSource
      try {
        // Determine the baseline — prefer DB row (already an override),
        // fall back to static seed.
        const existing = await sql`
          SELECT id, name, nse, sec, comp,
                 mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
                 acqs, acqf, rea
          FROM user_companies WHERE ticker = ${ticker} LIMIT 1
        `

        const staticSeed = COMPANIES.find((c) => c.ticker === ticker)
        if (existing.length === 0 && !staticSeed) {
          // Nothing to override against — this is a typo or a private ticker.
          skipped.push(`${ticker} — not in static seed or DB; use newCompanies[] to add`)
          return
        }

        // Build the post-override Company row so we can recompute acqs.
        const baseline: Company = existing.length > 0
          ? {
              name: existing[0].name,
              ticker,
              nse: existing[0].nse ?? ticker,
              sec: existing[0].sec ?? 'solar',
              comp: (() => {
                try { return JSON.parse(existing[0].comp || '[]') } catch { return [] }
              })(),
              mktcap: Number(existing[0].mktcap) || 0,
              rev: Number(existing[0].rev) || 0,
              ebitda: Number(existing[0].ebitda) || 0,
              pat: Number(existing[0].pat) || 0,
              ev: Number(existing[0].ev) || 0,
              ev_eb: Number(existing[0].ev_eb) || 0,
              pe: Number(existing[0].pe) || 0,
              pb: Number(existing[0].pb) || 0,
              dbt_eq: Number(existing[0].dbt_eq) || 0,
              revg: Number(existing[0].revg) || 0,
              ebm: Number(existing[0].ebm) || 0,
              acqs: Number(existing[0].acqs) || 5,
              acqf: existing[0].acqf || 'MONITOR',
              rea: existing[0].rea || '',
            }
          : (staticSeed as Company)

        const next: Company = {
          ...baseline,
          mktcap: patch.mktcap ?? baseline.mktcap,
          rev: patch.rev ?? baseline.rev,
          ebitda: patch.ebitda ?? baseline.ebitda,
          pat: patch.pat ?? baseline.pat,
          ev: patch.ev ?? baseline.ev,
          ev_eb: patch.ev_eb ?? baseline.ev_eb,
          pe: patch.pe ?? baseline.pe,
          pb: patch.pb ?? baseline.pb,
          dbt_eq: patch.dbt_eq ?? baseline.dbt_eq,
          revg: patch.revg ?? baseline.revg,
          ebm: patch.ebm ?? baseline.ebm,
        }

        // Recompute acqs from the 7-driver model UNLESS the client
        // supplied an explicit hard-override value (rare — only used
        // for editorial tweaks via the admin tool).
        const isAtlasStub = next.rev === 0 && next.ebitda === 0 &&
                            next.revg === 0 && next.ebm === 0
        let finalAcqs: number
        let finalFlag: string
        let finalRea: string
        if (patch.acqs != null) {
          finalAcqs = patch.acqs
          finalFlag = patch.acqf ?? flagFromScore(patch.acqs)
          finalRea = patch.rea ?? next.rea
        } else if (isAtlasStub) {
          // Keep the seeded heuristic score; recomputation over zero
          // financials produces garbage (D/E=0 scores 10, etc).
          finalAcqs = next.acqs
          finalFlag = next.acqf
          finalRea = patch.rea ?? next.rea
        } else {
          const audit = recomputeAcqScore(next)
          finalAcqs = audit.normalised
          finalFlag = flagFromScore(audit.normalised)
          finalRea = patch.rea ?? next.rea
        }

        if (existing.length > 0) {
          await sql`
            UPDATE user_companies SET
              mktcap = ${next.mktcap},
              rev = ${next.rev},
              ebitda = ${next.ebitda},
              pat = ${next.pat},
              ev = ${next.ev},
              ev_eb = ${next.ev_eb},
              pe = ${next.pe},
              pb = ${next.pb},
              dbt_eq = ${next.dbt_eq},
              revg = ${next.revg},
              ebm = ${next.ebm},
              acqs = ${finalAcqs},
              acqf = ${finalFlag},
              rea = ${finalRea},
              baseline_updated_at = NOW(),
              baseline_source = ${patchSource},
              updated_at = NOW()
            WHERE ticker = ${ticker}
          `
          // Counters touched from parallel workers — JS is single-threaded
          // for the actual ++, so the races here are harmless, no need for
          // atomics.
          updatedCount++
        } else if (staticSeed) {
          // Seed a new DB row cloning the static record + overrides.
          // After this, the LiveSnapshotProvider merge will surface
          // the DB row over the static one on every page.
          const compJson = JSON.stringify(staticSeed.comp || [])
          await sql`
            INSERT INTO user_companies (
              name, ticker, nse, sec, comp,
              mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
              acqs, acqf, rea, added_by,
              baseline_updated_at, baseline_source
            ) VALUES (
              ${staticSeed.name}, ${ticker}, ${staticSeed.nse || ticker}, ${staticSeed.sec}, ${compJson},
              ${next.mktcap}, ${next.rev}, ${next.ebitda}, ${next.pat},
              ${next.ev}, ${next.ev_eb}, ${next.pe}, ${next.pb},
              ${next.dbt_eq}, ${next.revg}, ${next.ebm},
              ${finalAcqs}, ${finalFlag}, ${finalRea}, ${addedBy},
              NOW(), ${patchSource}
            )
            ON CONFLICT (ticker) DO UPDATE SET
              mktcap = EXCLUDED.mktcap,
              rev = EXCLUDED.rev,
              ebitda = EXCLUDED.ebitda,
              pat = EXCLUDED.pat,
              ev = EXCLUDED.ev,
              ev_eb = EXCLUDED.ev_eb,
              pe = EXCLUDED.pe,
              pb = EXCLUDED.pb,
              dbt_eq = EXCLUDED.dbt_eq,
              revg = EXCLUDED.revg,
              ebm = EXCLUDED.ebm,
              acqs = EXCLUDED.acqs,
              acqf = EXCLUDED.acqf,
              rea = EXCLUDED.rea,
              baseline_updated_at = NOW(),
              baseline_source = EXCLUDED.baseline_source,
              updated_at = NOW()
          `
          seededCount++
        }
      } catch (err) {
        console.error(`[publish-data] Update ${ticker} failed:`, err)
      }
    }

    // Drain the override queue in parallel chunks. Chunk boundaries let
    // us cap concurrent Neon connections (serverless driver caps at
    // ~15 without connection pooling) while still pipelining the rest.
    for (let i = 0; i < overrideEntries.length; i += OVERRIDE_CONCURRENCY) {
      const chunk = overrideEntries.slice(i, i + OVERRIDE_CONCURRENCY)
      await Promise.all(chunk.map(([t, p]) => applyOverride(t, p)))
      // Budget cutoff: if we're running hot, bail and let the client
      // re-post the remaining tickers — better a partial success with
      // a clean 200 than a 504 that rolls back nothing.
      if (Date.now() - startedAt > BUDGET_MS) {
        const remaining = overrideEntries.length - (i + chunk.length)
        if (remaining > 0) {
          skipped.push(`${remaining} ticker(s) deferred — publish timed out, retry with smaller batch`)
        }
        break
      }
    }

    // ── Revalidate SSR pages ──
    // Purge the Next.js data cache for every page that reads
    // user_companies so the new rows show up on the next navigation
    // without a hard reload. Client components also react to the
    // `sg4:data-pushed` event broadcast by the admin page, but
    // server-rendered pages need this invalidation to see DB changes.
    //
    // Listed here are every page that hydrates companies via either
    // the LiveSnapshotProvider or a direct `/api/data/user-companies`
    // fetch. Adding a new page? Add its path here or it'll lag behind
    // by one navigation on new-company inserts.
    if (insertedCount > 0 || updatedCount > 0 || seededCount > 0) {
      const pathsToPurge = [
        '/dashboard', '/valuechain', '/maradar', '/valuation',
        '/compare', '/private', '/watchlist', '/crvi', '/fsa',
        '/news', '/newshub', '/stocks', '/admin',
      ]
      for (const p of pathsToPurge) {
        try { revalidatePath(p) } catch { /* non-fatal — path may not exist in some builds */ }
      }
      // Also purge dynamic report routes — they're keyed by ticker.
      try { revalidatePath('/report/[ticker]', 'page') } catch { /* ignore */ }
    }

    const bits: string[] = []
    if (insertedCount > 0) bits.push(`${insertedCount} inserted`)
    if (autoBackfilled > 0) bits.push(`${autoBackfilled} auto-filled from Screener`)
    if (updatedCount > 0) bits.push(`${updatedCount} updated`)
    if (seededCount > 0) bits.push(`${seededCount} seeded from baseline`)
    if (skipped.length > 0) bits.push(`${skipped.length} skipped`)
    const message = bits.length > 0
      ? `Published: ${bits.join(', ')}. Live across all pages — dashboards refresh automatically.`
      : 'No changes.'

    return NextResponse.json({
      ok: true,
      message,
      insertedCount,
      updatedCount,
      seededCount,
      autoBackfilled,
      skipped: skipped.length > 0 ? skipped : undefined,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }
}
