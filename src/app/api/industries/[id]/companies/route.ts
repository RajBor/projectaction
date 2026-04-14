import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * GET /api/industries/:id/companies
 *
 * Returns all atlas companies for an industry, grouped by stage.
 * Used by the admin Industries tab (expandable per-industry drawer)
 * and by the Industry Detail page for the value-chain overlay.
 *
 * Any signed-in user may read.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }
  const { id: industryId } = await params
  try {
    await ensureSchema()
    const rows = await sql`
      SELECT id, stage_id, name, status, exchange, ticker, role,
             market_data, market_data_fetched_at
      FROM industry_chain_companies
      WHERE industry_id = ${industryId}
      ORDER BY stage_id ASC,
               CASE status
                 WHEN 'MAIN' THEN 1
                 WHEN 'SME' THEN 2
                 WHEN 'SUBSIDIARY' THEN 3
                 WHEN 'GOVT/PSU' THEN 4
                 WHEN 'PRIVATE' THEN 5
                 ELSE 9
               END ASC,
               name ASC
    `
    return NextResponse.json({ ok: true, companies: rows })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
