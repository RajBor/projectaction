import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import * as XLSX from 'xlsx'

/**
 * POST /api/industries/:id/upload
 *
 * Multipart form-data: { file: <xlsx|xls|csv> }
 *
 * Parses the spreadsheet's first sheet into chain nodes and bulk-inserts
 * them. The sheet must have header columns matching the ChainNode fields
 * (case-insensitive, whitespace-tolerant):
 *
 *   name, cat, flag,
 *   market_india, market_india_cagr,
 *   market_global, market_global_cagr,
 *   market_global_leaders, market_india_status,
 *   fin_gross_margin, fin_ebit_margin, fin_capex, fin_moat,
 *   str_forward, str_backward, str_organic, str_inorganic
 *
 * Also stores a copy of the raw file in industry_uploads for audit.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  const { id: industryId } = await params

  try {
    await ensureSchema()
    const parent = await sql`SELECT id FROM industries WHERE id = ${industryId} LIMIT 1`
    if (parent.length === 0) {
      return NextResponse.json({ ok: false, error: 'industry not found' }, { status: 404 })
    }

    const form = await req.formData()
    const file = form.get('file')
    if (!file || typeof file === 'string') {
      return NextResponse.json({ ok: false, error: 'file required' }, { status: 400 })
    }
    const arrayBuffer = await file.arrayBuffer()
    const bytes = new Uint8Array(arrayBuffer)
    const filename = (file as File).name || 'upload'
    const mime = (file as File).type || 'application/octet-stream'
    const lower = filename.toLowerCase()
    const isExcel = lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.csv')
    if (!isExcel) {
      return NextResponse.json(
        { ok: false, error: 'Only .xlsx, .xls, .csv supported' },
        { status: 400 }
      )
    }

    const workbook = XLSX.read(bytes, { type: 'array' })
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) {
      return NextResponse.json({ ok: false, error: 'spreadsheet has no sheets' }, { status: 400 })
    }
    const sheet = workbook.Sheets[sheetName]
    const rawRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: false,
    })
    if (rawRows.length === 0) {
      return NextResponse.json({ ok: false, error: 'spreadsheet is empty' }, { status: 400 })
    }

    // Normalise header keys: lowercase, strip non-alnum
    const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '')
    const HEADER_MAP: Record<string, string> = {
      name: 'name',
      segment: 'name',
      node: 'name',
      cat: 'cat',
      category: 'cat',
      group: 'cat',
      flag: 'flag',
      priority: 'flag',
      marketindia: 'market_india',
      indiamarket: 'market_india',
      indiamarketsize: 'market_india',
      indiacagr: 'market_india_cagr',
      marketindiacagr: 'market_india_cagr',
      marketglobal: 'market_global',
      globalmarket: 'market_global',
      globalmarketsize: 'market_global',
      globalcagr: 'market_global_cagr',
      marketglobalcagr: 'market_global_cagr',
      globalleaders: 'market_global_leaders',
      marketgloballeaders: 'market_global_leaders',
      indiastatus: 'market_india_status',
      marketindiastatus: 'market_india_status',
      fingrossmargin: 'fin_gross_margin',
      grossmargin: 'fin_gross_margin',
      finebitmargin: 'fin_ebit_margin',
      ebitmargin: 'fin_ebit_margin',
      fincapex: 'fin_capex',
      capex: 'fin_capex',
      finmoat: 'fin_moat',
      moat: 'fin_moat',
      strforward: 'str_forward',
      forwardstrategy: 'str_forward',
      strbackward: 'str_backward',
      backwardstrategy: 'str_backward',
      strorganic: 'str_organic',
      organicstrategy: 'str_organic',
      strinorganic: 'str_inorganic',
      inorganicstrategy: 'str_inorganic',
    }

    const remapped: Array<Record<string, string | null>> = rawRows.map((row) => {
      const out: Record<string, string | null> = {}
      for (const [rawKey, rawVal] of Object.entries(row)) {
        const key = HEADER_MAP[norm(rawKey)]
        if (!key) continue
        out[key] = rawVal == null || rawVal === '' ? null : String(rawVal).trim()
      }
      return out
    })

    // Filter out rows without at least name + cat
    const valid = remapped.filter((r) => r.name && r.cat)
    if (valid.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error:
            'No valid rows parsed. Each row needs at least "name" and "cat" (or "category") columns.',
        },
        { status: 400 }
      )
    }

    let inserted = 0
    for (const r of valid) {
      const nodeIdRaw = (r.name || '').toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 60)
      const nodeId = `${industryId}__${nodeIdRaw}`
      await sql`
        INSERT INTO industry_chain_nodes (
          id, industry_id, name, cat, flag,
          market_india, market_india_cagr,
          market_global, market_global_cagr,
          market_global_leaders, market_india_status,
          fin_gross_margin, fin_ebit_margin, fin_capex, fin_moat,
          str_forward, str_backward, str_organic, str_inorganic
        )
        VALUES (
          ${nodeId}, ${industryId}, ${r.name}, ${r.cat},
          ${r.flag || 'medium'},
          ${r.market_india}, ${r.market_india_cagr},
          ${r.market_global}, ${r.market_global_cagr},
          ${r.market_global_leaders}, ${r.market_india_status},
          ${r.fin_gross_margin}, ${r.fin_ebit_margin},
          ${r.fin_capex}, ${r.fin_moat},
          ${r.str_forward}, ${r.str_backward},
          ${r.str_organic}, ${r.str_inorganic}
        )
        ON CONFLICT (id) DO UPDATE
          SET name = EXCLUDED.name,
              cat = EXCLUDED.cat,
              flag = EXCLUDED.flag,
              market_india = EXCLUDED.market_india,
              market_india_cagr = EXCLUDED.market_india_cagr,
              market_global = EXCLUDED.market_global,
              market_global_cagr = EXCLUDED.market_global_cagr,
              market_global_leaders = EXCLUDED.market_global_leaders,
              market_india_status = EXCLUDED.market_india_status,
              fin_gross_margin = EXCLUDED.fin_gross_margin,
              fin_ebit_margin = EXCLUDED.fin_ebit_margin,
              fin_capex = EXCLUDED.fin_capex,
              fin_moat = EXCLUDED.fin_moat,
              str_forward = EXCLUDED.str_forward,
              str_backward = EXCLUDED.str_backward,
              str_organic = EXCLUDED.str_organic,
              str_inorganic = EXCLUDED.str_inorganic
      `
      inserted++
    }

    // Audit record — store base64 of the source file. Capped at ~4MB.
    if (bytes.byteLength < 4 * 1024 * 1024) {
      const email = (session.user as { email?: string }).email ?? null
      const b64 = Buffer.from(bytes).toString('base64')
      await sql`
        INSERT INTO industry_uploads (industry_id, filename, mime, size_bytes, content_base64, uploaded_by)
        VALUES (${industryId}, ${filename}, ${mime}, ${bytes.byteLength}, ${b64}, ${email})
      `
    }

    return NextResponse.json({
      ok: true,
      inserted,
      parsed: valid.length,
      total: rawRows.length,
      filename,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
