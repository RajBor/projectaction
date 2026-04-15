import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import { COMPANIES } from '@/lib/data/companies'
import {
  fetchNseQuote,
  buildExchangeRow,
  type ExchangeRow,
} from '@/lib/live/nse-fetch'

/**
 * POST /api/admin/update-symbol
 *
 * Admin-only. Lets the admin correct the NSE symbol for a ticker whose
 * live fetch has been failing (wrong mapping, NSE rename, SME symbol
 * that differs from the ticker, etc.).
 *
 * Body: { ticker: string, nse: string, testOnly?: boolean }
 *   - ticker    — the app-internal ticker (matches COMPANIES[].ticker /
 *                 user_companies.ticker)
 *   - nse       — the candidate NSE symbol (what NSE India serves at
 *                 /api/quote-equity?symbol=<nse>)
 *   - testOnly  — if true, only attempt the live fetch and return the
 *                 result without persisting. Useful for an "Test" button
 *                 in the admin UI before saving.
 *
 * Flow:
 *   1. Validate auth and input.
 *   2. Attempt a live NSE fetch with the candidate symbol. We always
 *      do this — there is no "save without validating" path, because
 *      letting admins persist broken symbols would put us right back in
 *      the "silent 58/85" situation this endpoint exists to fix.
 *   3. If the fetch returns nothing or priceInfo.lastPrice is absent,
 *      return { ok: false, error: … } WITHOUT touching the DB.
 *   4. If it succeeds and testOnly !== true, upsert into user_companies:
 *        - Existing row → UPDATE nse.
 *        - No DB row, but ticker in static COMPANIES[] → INSERT a new
 *          row cloning the static baseline with the new nse value.
 *        - Ticker not known anywhere → 404.
 *
 * Returns:
 *   { ok: true, saved: boolean, row: ExchangeRow }          on success
 *   { ok: false, error: string }                            on failure
 */

interface Body {
  ticker?: unknown
  nse?: unknown
  testOnly?: unknown
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
  // Uppercase + strip whitespace. NSE rejects mixed-case symbols, so
  // normalising here avoids a class of "it works in my browser" bugs.
  const nse = typeof body.nse === 'string' ? body.nse.trim().toUpperCase() : ''
  const testOnly = body.testOnly === true

  if (!ticker || !nse) {
    return NextResponse.json(
      { ok: false, error: 'ticker and nse required' },
      { status: 400 }
    )
  }
  // Basic sanity: NSE symbols are alphanumeric, sometimes with & or -.
  // Reject anything else outright so we don't send junk at NSE India.
  if (!/^[A-Z0-9&\-]+$/.test(nse)) {
    return NextResponse.json(
      { ok: false, error: 'NSE symbol may contain only letters, digits, & and -' },
      { status: 400 }
    )
  }

  // ── Step 1: live test-fetch ──────────────────────────────────
  let quote
  try {
    quote = await fetchNseQuote(nse)
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `NSE fetch threw: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 }
    )
  }

  if (!quote || !quote.priceInfo?.lastPrice) {
    return NextResponse.json(
      {
        ok: false,
        error: `NSE returned no price for "${nse}". Double-check the symbol on nseindia.com.`,
      },
      { status: 404 }
    )
  }

  // ── Step 2: find the baseline Company row for this ticker ────
  //
  // We need it to build a valid ExchangeRow (for the EV scaling ratio)
  // and, if we INSERT a fresh user_companies row, to seed the other
  // columns with sensible non-null values.
  let baselineCo = COMPANIES.find((c) => c.ticker === ticker) ?? null
  try {
    await ensureSchema()
    const dbRow = await sql`
      SELECT name, ticker, nse, sec, comp,
             mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
             acqs, acqf, rea
      FROM user_companies WHERE ticker = ${ticker} LIMIT 1
    `
    if (dbRow.length > 0) {
      const r = dbRow[0]
      baselineCo = {
        name: r.name,
        ticker: r.ticker,
        nse: r.nse,
        sec: (r.sec as 'solar' | 'td') || 'solar',
        comp: (() => { try { return JSON.parse(r.comp || '[]') } catch { return [] } })(),
        mktcap: Number(r.mktcap) || 0,
        rev: Number(r.rev) || 0,
        ebitda: Number(r.ebitda) || 0,
        pat: Number(r.pat) || 0,
        ev: Number(r.ev) || 0,
        ev_eb: Number(r.ev_eb) || 0,
        pe: Number(r.pe) || 0,
        pb: Number(r.pb) || 0,
        dbt_eq: Number(r.dbt_eq) || 0,
        revg: Number(r.revg) || 0,
        ebm: Number(r.ebm) || 0,
        acqs: Number(r.acqs) || 5,
        acqf: r.acqf || 'MONITOR',
        rea: r.rea || '',
      }
    }
  } catch (err) {
    console.warn(
      '[update-symbol] user_companies read skipped:',
      err instanceof Error ? err.message : err
    )
  }

  if (!baselineCo) {
    return NextResponse.json(
      {
        ok: false,
        error: `Ticker "${ticker}" is not in static COMPANIES or user_companies. Add it first via the Discover tab.`,
      },
      { status: 404 }
    )
  }

  const exchangeRow: ExchangeRow = buildExchangeRow(baselineCo, quote, nse)

  // Test-only: return the preview without writing anything.
  if (testOnly) {
    return NextResponse.json({ ok: true, saved: false, row: exchangeRow })
  }

  // ── Step 3: upsert the corrected symbol ──────────────────────
  //
  // We deliberately only touch the `nse` column + audit timestamps.
  // All other financial fields are preserved — admins use separate
  // endpoints (publish-data, scrape-screener, etc.) to refresh those.
  try {
    const addedBy = session.user.email || 'admin'
    const existing = await sql`
      SELECT id FROM user_companies WHERE ticker = ${ticker} LIMIT 1
    `
    if (existing.length > 0) {
      await sql`
        UPDATE user_companies SET
          nse = ${nse},
          updated_at = NOW()
        WHERE ticker = ${ticker}
      `
    } else {
      // Seed a new DB row from the static baseline — we need one in the
      // DB so future admin-edit flows have somewhere to write to, and so
      // the LiveSnapshotProvider merge picks up the corrected symbol on
      // the next refresh tick.
      const compJson = JSON.stringify(baselineCo.comp || [])
      await sql`
        INSERT INTO user_companies (
          name, ticker, nse, sec, comp,
          mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
          acqs, acqf, rea, added_by,
          baseline_updated_at, baseline_source
        ) VALUES (
          ${baselineCo.name}, ${ticker}, ${nse}, ${baselineCo.sec}, ${compJson},
          ${baselineCo.mktcap}, ${baselineCo.rev}, ${baselineCo.ebitda}, ${baselineCo.pat},
          ${baselineCo.ev}, ${baselineCo.ev_eb}, ${baselineCo.pe}, ${baselineCo.pb},
          ${baselineCo.dbt_eq}, ${baselineCo.revg}, ${baselineCo.ebm},
          ${baselineCo.acqs}, ${baselineCo.acqf}, ${baselineCo.rea}, ${addedBy},
          NOW(), 'manual'
        )
        ON CONFLICT (ticker) DO UPDATE SET
          nse = EXCLUDED.nse,
          updated_at = NOW()
      `
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `DB upsert failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    )
  }

  return NextResponse.json({ ok: true, saved: true, row: exchangeRow })
}
