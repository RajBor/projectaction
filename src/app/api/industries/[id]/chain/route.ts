import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

export interface IndustryChainNode {
  id: string
  industry_id: string
  name: string
  cat: string
  flag: string
  market_india: string | null
  market_india_cagr: string | null
  market_global: string | null
  market_global_cagr: string | null
  market_global_leaders: string | null
  market_india_status: string | null
  fin_gross_margin: string | null
  fin_ebit_margin: string | null
  fin_capex: string | null
  fin_moat: string | null
  str_forward: string | null
  str_backward: string | null
  str_organic: string | null
  str_inorganic: string | null
}

/** GET /api/industries/:id/chain — list chain nodes for an industry */
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
      SELECT *
      FROM industry_chain_nodes
      WHERE industry_id = ${industryId}
      ORDER BY cat ASC, name ASC
    `
    return NextResponse.json({ ok: true, nodes: rows })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

/** POST /api/industries/:id/chain — bulk-insert chain nodes. */
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
    const body = await req.json()
    if (!Array.isArray(body.nodes) || body.nodes.length === 0) {
      return NextResponse.json({ ok: false, error: 'nodes[] required' }, { status: 400 })
    }
    await ensureSchema()
    // Confirm the industry exists before inserting children
    const parent = await sql`SELECT id FROM industries WHERE id = ${industryId} LIMIT 1`
    if (parent.length === 0) {
      return NextResponse.json({ ok: false, error: 'industry not found' }, { status: 404 })
    }

    let inserted = 0
    for (const n of body.nodes) {
      const nodeName = String(n.name || '').trim()
      const cat = String(n.cat || '').trim()
      if (!nodeName || !cat) continue
      const nodeId = `${industryId}__${String(n.id || nodeName)
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, '_')
        .slice(0, 60)}`
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
          ${nodeId}, ${industryId}, ${nodeName}, ${cat},
          ${String(n.flag || 'medium')},
          ${n.market_india ?? null}, ${n.market_india_cagr ?? null},
          ${n.market_global ?? null}, ${n.market_global_cagr ?? null},
          ${n.market_global_leaders ?? null}, ${n.market_india_status ?? null},
          ${n.fin_gross_margin ?? null}, ${n.fin_ebit_margin ?? null},
          ${n.fin_capex ?? null}, ${n.fin_moat ?? null},
          ${n.str_forward ?? null}, ${n.str_backward ?? null},
          ${n.str_organic ?? null}, ${n.str_inorganic ?? null}
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

    return NextResponse.json({ ok: true, inserted })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
