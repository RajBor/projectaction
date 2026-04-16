import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import * as XLSX from 'xlsx'
import { COMPANIES } from '@/lib/data/companies'
import {
  SUB_SEGMENTS,
  getSubSegmentsForComp,
  getSubSegmentsForIndustry,
} from '@/lib/data/sub-segments'

/**
 * POST /api/admin/upload-subcomp-mapping
 *
 * Admin / sub-admin only. Bulk-apply DealNector VC-Taxonomy sub-segment
 * tags to many companies at once.
 *
 * Multipart form-data: { file: <xlsx|xls|csv> }
 *
 * Expected sheet shape (first sheet is used, headers case/whitespace-
 * insensitive). Only the first two meaningful columns are read:
 *
 *   ┌────────┬─────────────────────────────────────────────┐
 *   │ Ticker │ Sub-segments                                │
 *   ├────────┼─────────────────────────────────────────────┤
 *   │ WAAREE │ 1.2.3, 1.2.4                                │
 *   │ TATASP │ ss_1_2_3; ss_1_2_7                          │
 *   │ INOX   │ all                                         │
 *   │ SUZLON │                                             │ ← blank = reset to default (all)
 *   └────────┴─────────────────────────────────────────────┘
 *
 * Header synonyms accepted: Ticker | Symbol | NSE | Code
 *                          ; Sub-segments | Subsegments | Subcomp | SS | Tags
 *
 * Sub-segment resolution (per cell):
 *   • "all" / "*"      → every sub-segment in the company's stage
 *                       (if sec+comp is known) else industry pool
 *   • ""  / blank      → [] (default state = treated as all by the filter)
 *   • "1.2.3,1.2.4"    → resolve each dotted code → ss_1_2_3, ss_1_2_4
 *   • "ss_1_2_3"       → used as-is after validation
 *   • "TOPCon Cell"    → case-insensitive sub-segment name match
 *   • mixed            → all of the above work in the same cell
 *
 * Unknown tokens are collected into an `unresolved` array per row and
 * surfaced in the response so the admin can fix the mapping file.
 *
 * Companies not yet in user_companies are seeded from the static
 * COMPANIES baseline (same seed path as /api/admin/update-classification).
 * Tickers with no static + no DB row are skipped and reported.
 *
 * The caller is responsible for broadcasting `sg4:data-pushed` after the
 * response so Valuation / Value Chain pages refetch live.
 */

interface RowResult {
  ticker: string
  status: 'updated' | 'seeded' | 'skipped_not_found' | 'error'
  subcomp: string[]
  unresolved?: string[]
  error?: string
}

// Header-norm: "Sub-segments" → "subsegments"
const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '')

const TICKER_HEADERS = new Set(['ticker', 'symbol', 'nse', 'code', 'tickercode'])
const SUBCOMP_HEADERS = new Set([
  'subsegments', 'subsegment', 'subcomp', 'ss', 'tags', 'subcompids',
  'subs', 'substage', 'taxonomy', 'subsegids', 'subsegid',
])

// Pre-index SUB_SEGMENTS by id, code, and name for fast lookup.
const BY_ID = new Map<string, typeof SUB_SEGMENTS[number]>()
const BY_CODE = new Map<string, typeof SUB_SEGMENTS[number]>()
const BY_NAME = new Map<string, typeof SUB_SEGMENTS[number]>()
for (const sub of SUB_SEGMENTS) {
  BY_ID.set(sub.id.toLowerCase(), sub)
  BY_CODE.set(sub.code.toLowerCase(), sub)
  BY_NAME.set(sub.name.toLowerCase(), sub)
}

function resolveSubToken(
  token: string,
  sec: string | null,
  comp: string[] | null
): string | null {
  const t = token.trim().toLowerCase()
  if (!t) return null
  if (t === 'all' || t === '*') {
    // 'all' is resolved to the concrete id-list by the caller because it
    // depends on the company's sec/comp. We return a sentinel here.
    return '__ALL__'
  }
  // Direct id (ss_1_2_3)
  if (BY_ID.has(t)) return BY_ID.get(t)!.id
  // Dotted code (1.2.3)
  if (BY_CODE.has(t)) return BY_CODE.get(t)!.id
  // Name
  if (BY_NAME.has(t)) return BY_NAME.get(t)!.id
  // Try normalising away spaces/dashes for names
  const tNorm = t.replace(/[^a-z0-9]/g, '')
  const nameEntries = Array.from(BY_NAME.entries())
  for (let i = 0; i < nameEntries.length; i++) {
    const [name, sub] = nameEntries[i]
    if (name.replace(/[^a-z0-9]/g, '') === tNorm) {
      return sub.id
    }
  }
  // Intentionally silent about sec/comp — they're just hints that would
  // narrow a fuzzy match. We keep the global search instead so the admin
  // isn't surprised by "I typed 1.2.3 but got rejected because the
  // company is tagged to 1.4".
  void sec
  void comp
  return null
}

function expandAllForCompany(sec: string | null, comp: string[] | null): string[] {
  // Prefer the precise stage pool (the company's first declared comp in
  // the given industry). Fall back to the full industry pool when sec is
  // known but no comp, and empty array when neither is known.
  if (sec && comp && comp.length > 0) {
    const pool = getSubSegmentsForComp(sec, comp[0])
    if (pool.length > 0) return pool.map((s) => s.id)
  }
  if (sec) {
    return getSubSegmentsForIndustry(sec).map((s) => s.id)
  }
  return []
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  try {
    await ensureSchema()

    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') {
      return NextResponse.json({ ok: false, error: 'file required' }, { status: 400 })
    }
    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    const filename = (file as File).name || 'upload'
    const lower = filename.toLowerCase()
    const isExcel =
      lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')
    if (!isExcel) {
      return NextResponse.json(
        { ok: false, error: 'Only .xlsx, .xls, .csv supported' },
        { status: 400 }
      )
    }

    const workbook = XLSX.read(bytes, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      return NextResponse.json(
        { ok: false, error: 'spreadsheet has no sheets' },
        { status: 400 }
      )
    }
    const sheet = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: false,
    })
    if (rawRows.length === 0) {
      return NextResponse.json(
        { ok: false, error: 'spreadsheet is empty' },
        { status: 400 }
      )
    }

    // Resolve the ticker + subs columns case-insensitively.
    const firstHeaders = Object.keys(rawRows[0])
    const headerMap: Record<string, 'ticker' | 'subs'> = {}
    for (const h of firstHeaders) {
      const n = norm(h)
      if (TICKER_HEADERS.has(n)) headerMap[h] = 'ticker'
      else if (SUBCOMP_HEADERS.has(n)) headerMap[h] = 'subs'
    }
    // Fallback: if we couldn't identify, take the first two columns.
    if (!Object.values(headerMap).includes('ticker') && firstHeaders[0]) {
      headerMap[firstHeaders[0]] = 'ticker'
    }
    if (!Object.values(headerMap).includes('subs') && firstHeaders[1]) {
      headerMap[firstHeaders[1]] = 'subs'
    }

    // Preload existing user_companies rows so we can bulk-decide
    // updated-vs-seeded without querying per row.
    const existing = await sql`
      SELECT ticker, sec, comp FROM user_companies
    `
    const existingByTicker = new Map<
      string,
      { sec: string; comp: string[] }
    >()
    for (const r of existing) {
      let comp: string[] = []
      try {
        comp = JSON.parse(r.comp || '[]')
      } catch {
        comp = []
      }
      existingByTicker.set(String(r.ticker).toUpperCase(), {
        sec: r.sec || 'solar',
        comp,
      })
    }

    const results: RowResult[] = []
    const addedBy = session.user.email || 'admin'

    for (const rawRow of rawRows) {
      let ticker = ''
      let subsCell = ''
      for (const [rawKey, val] of Object.entries(rawRow)) {
        const role = headerMap[rawKey]
        if (!role) continue
        const s = val == null ? '' : String(val).trim()
        if (role === 'ticker') ticker = s.toUpperCase()
        else if (role === 'subs') subsCell = s
      }
      if (!ticker) continue // blank row

      // Discover the company's sec/comp for expanding "all"
      const dbRow = existingByTicker.get(ticker)
      const staticRow = COMPANIES.find(
        (c) => c.ticker.toUpperCase() === ticker
      )
      const sec = dbRow?.sec ?? staticRow?.sec ?? null
      const comp = dbRow?.comp ?? staticRow?.comp ?? null

      if (!dbRow && !staticRow) {
        results.push({
          ticker,
          status: 'skipped_not_found',
          subcomp: [],
          error:
            'Ticker not in static COMPANIES or user_companies. Add the company first, then re-upload.',
        })
        continue
      }

      // Parse the subs cell — split on comma / semicolon / pipe.
      const tokens = subsCell
        .split(/[,;|]/)
        .map((t) => t.trim())
        .filter((t) => t.length > 0)

      const resolvedIds: string[] = []
      const unresolved: string[] = []
      let requestedAll = false

      for (const token of tokens) {
        const resolved = resolveSubToken(token, sec, comp)
        if (resolved === '__ALL__') {
          requestedAll = true
        } else if (resolved) {
          if (!resolvedIds.includes(resolved)) resolvedIds.push(resolved)
        } else {
          unresolved.push(token)
        }
      }

      // If "all" requested, expand to every sub-segment in the stage.
      let finalSubcomp: string[]
      if (requestedAll) {
        finalSubcomp = expandAllForCompany(sec, comp)
        // Merge any explicit picks alongside "all" (rare but possible).
        for (const id of resolvedIds) {
          if (!finalSubcomp.includes(id)) finalSubcomp.push(id)
        }
      } else {
        finalSubcomp = resolvedIds
      }

      const compJson = JSON.stringify(finalSubcomp)

      try {
        if (dbRow) {
          await sql`
            UPDATE user_companies
               SET subcomp = ${compJson}, updated_at = NOW()
             WHERE ticker = ${ticker}
          `
          results.push({
            ticker,
            status: 'updated',
            subcomp: finalSubcomp,
            unresolved: unresolved.length ? unresolved : undefined,
          })
        } else if (staticRow) {
          // Seed a fresh user_companies row from the static baseline.
          const s = staticRow
          const seedComp = JSON.stringify(s.comp || [])
          await sql`
            INSERT INTO user_companies (
              name, ticker, nse, sec, comp, subcomp,
              mktcap, rev, ebitda, pat, ev, ev_eb, pe, pb, dbt_eq, revg, ebm,
              acqs, acqf, rea, added_by,
              baseline_updated_at, baseline_source
            ) VALUES (
              ${s.name}, ${ticker}, ${s.nse || ticker}, ${s.sec}, ${seedComp}, ${compJson},
              ${s.mktcap}, ${s.rev}, ${s.ebitda}, ${s.pat},
              ${s.ev}, ${s.ev_eb}, ${s.pe}, ${s.pb},
              ${s.dbt_eq}, ${s.revg}, ${s.ebm},
              ${s.acqs}, ${s.acqf}, ${s.rea}, ${addedBy},
              NOW(), 'manual'
            )
            ON CONFLICT (ticker) DO UPDATE SET
              subcomp = EXCLUDED.subcomp,
              updated_at = NOW()
          `
          results.push({
            ticker,
            status: 'seeded',
            subcomp: finalSubcomp,
            unresolved: unresolved.length ? unresolved : undefined,
          })
        }
      } catch (err) {
        results.push({
          ticker,
          status: 'error',
          subcomp: finalSubcomp,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    const summary = {
      total: results.length,
      updated: results.filter((r) => r.status === 'updated').length,
      seeded: results.filter((r) => r.status === 'seeded').length,
      skipped: results.filter((r) => r.status === 'skipped_not_found').length,
      errors: results.filter((r) => r.status === 'error').length,
      unresolvedTokens: results.reduce(
        (n, r) => n + (r.unresolved?.length || 0),
        0
      ),
    }

    return NextResponse.json({
      ok: true,
      filename,
      summary,
      results,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
