/**
 * GET /api/public/report/:id            — inline HTML (for iframe preview)
 * GET /api/public/report/:id?download=1 — force-download .html attachment
 *
 * Serves the report previously persisted by POST /api/public/report.
 * Falls back to 404 when the id is unknown (e.g. the DB trimmed old
 * rows or someone guessed a bogus id). No auth — same public surface.
 */

import { NextResponse } from 'next/server'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: rawId } = await params
  const id = (rawId || '').trim()
  if (!id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  try {
    await ensureSchema()
    const rows = await sql`
      SELECT html_body, title, subject_label
      FROM public_report_requests
      WHERE id = ${id}
      LIMIT 1
    `
    const row = rows[0] as
      | { html_body: string; title: string; subject_label: string }
      | undefined
    if (!row || !row.html_body) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }

    const url = new URL(req.url)
    const wantsDownload = url.searchParams.get('download') === '1'
    const safeTitle = (row.title || 'DealNector-Report')
      .replace(/[^a-z0-9_\- ]/gi, '')
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'DealNector-Report'
    const filename = `${safeTitle}-${id}.html`

    return new Response(row.html_body, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': wantsDownload
          ? `attachment; filename="${filename}"`
          : `inline; filename="${filename}"`,
        'Cache-Control': 'private, max-age=600',
        'X-Report-Id': id,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: 'fetch_failed', message: (err as Error).message },
      { status: 500 }
    )
  }
}
