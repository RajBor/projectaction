import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

export interface IndustryRow {
  id: string
  label: string
  icon: string | null
  description: string | null
  is_builtin: boolean
  added_by: string | null
  created_at: string
}

/**
 * GET /api/industries — list all registered industries.
 * Any signed-in user can read (the sidebar filter needs this list).
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }
  try {
    await ensureSchema()
    const rows = await sql`
      SELECT id, label, icon, description, is_builtin, added_by, created_at
      FROM industries
      ORDER BY is_builtin DESC, label ASC
    `
    return NextResponse.json({ ok: true, industries: rows })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/industries — create a new industry (admin + subadmin only).
 * Body: { id, label, icon?, description? }
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  try {
    const body = await req.json()
    const id = String(body.id || '').toLowerCase().trim().replace(/[^a-z0-9_]/g, '_')
    const label = String(body.label || '').trim()
    const icon = body.icon ? String(body.icon).slice(0, 8) : null
    const description = body.description ? String(body.description).slice(0, 2000) : null
    if (!id || !label) {
      return NextResponse.json({ ok: false, error: 'id and label are required' }, { status: 400 })
    }
    await ensureSchema()
    const email = (session.user as { email?: string }).email ?? null
    await sql`
      INSERT INTO industries (id, label, icon, description, is_builtin, added_by)
      VALUES (${id}, ${label}, ${icon}, ${description}, FALSE, ${email})
      ON CONFLICT (id) DO UPDATE
        SET label = EXCLUDED.label,
            icon = EXCLUDED.icon,
            description = EXCLUDED.description,
            updated_at = NOW()
    `
    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/industries?id=xxx — remove a non-builtin industry.
 */
export async function DELETE(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  try {
    await ensureSchema()
    const existing = await sql`SELECT is_builtin FROM industries WHERE id = ${id} LIMIT 1`
    if (existing[0]?.is_builtin) {
      return NextResponse.json(
        { ok: false, error: 'Cannot delete a built-in industry' },
        { status: 400 }
      )
    }
    await sql`DELETE FROM industries WHERE id = ${id}`
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
