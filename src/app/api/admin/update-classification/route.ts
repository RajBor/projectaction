import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { COMPANIES } from '@/lib/data/companies'

/**
 * POST /api/admin/update-classification
 *
 * Admin / sub-admin only. Lets the admin reclassify an existing company
 * by changing its **industry (sec)** and/or **value-chain segment (comp)**.
 *
 * Why a dedicated endpoint?
 *   The bulk `/api/admin/publish-data` route accepts `sec` / `comp` in
 *   its `CompanyFields` interface but its UPDATE statement only touches
 *   financial fields — so classification changes sent via publish-data
 *   were silently dropped. Rather than overload that already-complex
 *   route, this endpoint does one thing: UPDATE user_companies.sec +
 *   user_companies.comp (or SEED a fresh row from the static COMPANIES
 *   baseline and set sec/comp on the new row). The caller is then
 *   responsible for dispatching `sg4:data-pushed` and
 *   `sg4:industry-data-change` so Value Chain / Dashboard / Sidebar
 *   refresh live.
 *
 * Body: { ticker: string, sec: string, comp: string[], subcomp?: string[] }
 *   - ticker  — app-internal ticker (must exist in static COMPANIES OR
 *               user_companies)
 *   - sec     — new industry id (e.g. 'solar', 'td', 'wind', 'storage',
 *               or any atlas industry id)
 *   - comp    — new value-chain segment ids (array of chain node ids)
 *   - subcomp — optional DealNector VC-Taxonomy sub-segment ids
 *               (e.g. ['ss_1_2_3','ss_1_2_6']). Empty array / omitted =
 *               no sub-segments tagged. Persisted to user_companies.subcomp.
 *
 * Returns:
 *   { ok: true, updated: boolean, seeded: boolean, oldSec: string }
 *     - updated: existing user_companies row was UPDATEd
 *     - seeded:  no DB row existed, so we cloned the static seed + set
 *                the new sec/comp
 *     - oldSec:  the industry id BEFORE the change — the admin UI uses
 *                this to invalidate the atlas bundle for both industries
 *                on broadcast
 *
 * Note on acqs: changing classification does NOT recompute the
 *   acquisition score. That's deliberate — acqs is driven by financial
 *   metrics, not industry classification. Admins who also want to update
 *   financials should do so via Push-from-Source flows separately.
 */

interface Body {
  ticker?: unknown
  sec?: unknown
  comp?: unknown
  subcomp?: unknown
}

function parseComp(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '')
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const ticker = typeof body.ticker === 'string' ? body.ticker.trim().toUpperCase() : ''
  const sec = typeof body.sec === 'string' ? body.sec.trim().toLowerCase() : ''
  const comp = parseComp(body.comp)
  // Sub-segments are optional — an admin may want to reclassify without
  // going deeper. Parse defensively so a bad payload silently becomes [].
  const subcomp = parseComp(body.subcomp)

  if (!ticker) {
    return NextResponse.json({ ok: false, error: 'ticker required' }, { status: 400 })
  }
  if (!sec) {
    return NextResponse.json({ ok: false, error: 'sec required' }, { status: 400 })
  }
  // Sec must be a registered industry — look it up in the industries
  // table so we don't persist typos like 'wnd' or 'storge'. The sidebar
  // would silently hide such rows because no industry filter matches.
  try {
    await ensureSchema()
    const indCheck = await sql`
      SELECT id FROM industries WHERE id = ${sec} LIMIT 1
    `
    if (indCheck.length === 0) {
      return NextResponse.json(
        { ok: false, error: `Industry "${sec}" is not registered. Add it via Atlas first.` },
        { status: 400 }
      )
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `Industry check failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 }
    )
  }

  const addedBy = session.user.email || 'admin'
  const compJson = JSON.stringify(comp)
  const subcompJson = JSON.stringify(subcomp)

  try {
    // ── Find the existing user_companies row (if any) + capture the
    //    CURRENT sec so the client can broadcast an invalidation for
    //    BOTH old and new industries. Without this, moving a company
    //    from Wind → Storage would leave Wind's Value Chain showing
    //    the stale company until something else triggered a refetch.
    const existing = await sql`
      SELECT id, sec FROM user_companies WHERE ticker = ${ticker} LIMIT 1
    `

    const staticSeed = COMPANIES.find((c) => c.ticker === ticker)
    const oldSec: string = existing.length > 0
      ? (existing[0].sec || staticSeed?.sec || 'solar')
      : (staticSeed?.sec || 'solar')

    if (existing.length === 0 && !staticSeed) {
      return NextResponse.json(
        { ok: false, error: `Ticker "${ticker}" is not in static COMPANIES or user_companies.` },
        { status: 404 }
      )
    }

    if (existing.length > 0) {
      await sql`
        UPDATE user_companies SET
          sec = ${sec},
          comp = ${compJson},
          subcomp = ${subcompJson},
          updated_at = NOW()
        WHERE ticker = ${ticker}
      `
      return NextResponse.json({
        ok: true,
        updated: true,
        seeded: false,
        oldSec,
      })
    }

    // No DB row yet — seed from the static baseline and apply the new
    // classification on the new row. Every other field is cloned as-is
    // so the LiveSnapshotProvider merge keeps the company's financials
    // unchanged on every page.
    const s = staticSeed!
    await sql`
      INSERT INTO user_companies (
        name, ticker, nse, sec, comp, subcomp,
        mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
        acqs, acqf, rea, added_by,
        baseline_updated_at, baseline_source
      ) VALUES (
        ${s.name}, ${ticker}, ${s.nse || ticker}, ${sec}, ${compJson}, ${subcompJson},
        ${s.mktcap}, ${s.rev}, ${s.ebitda}, ${s.pat},
        ${s.ev}, ${s.ev_eb}, ${s.pe}, ${s.pb},
        ${s.dbt_eq}, ${s.revg}, ${s.ebm},
        ${s.acqs}, ${s.acqf}, ${s.rea}, ${addedBy},
        NOW(), 'manual'
      )
      ON CONFLICT (ticker) DO UPDATE SET
        sec = EXCLUDED.sec,
        comp = EXCLUDED.comp,
        subcomp = EXCLUDED.subcomp,
        updated_at = NOW()
    `
    return NextResponse.json({
      ok: true,
      updated: false,
      seeded: true,
      oldSec,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `DB upsert failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    )
  }
}
