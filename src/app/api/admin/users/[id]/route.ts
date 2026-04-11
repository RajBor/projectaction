import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ADMIN_CONFIG } from '@/lib/db/ensure-schema'

/**
 * PATCH /api/admin/users/:id  → { isActive: boolean }
 *   Toggle is_active flag (restrict / unrestrict login).
 * DELETE /api/admin/users/:id
 *   Hard-delete a user row. The platform admin cannot be deleted or
 *   disabled through this endpoint.
 */

async function guard() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  return null
}

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const forbidden = await guard()
  if (forbidden) return forbidden
  const { id } = await ctx.params
  const userId = parseInt(id, 10)
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ ok: false, error: 'Invalid user id' }, { status: 400 })
  }
  const body = await req.json().catch(() => ({}))
  const { isActive } = body as { isActive?: boolean }
  if (typeof isActive !== 'boolean') {
    return NextResponse.json(
      { ok: false, error: 'isActive boolean required' },
      { status: 400 }
    )
  }
  try {
    const rows = await sql`SELECT email FROM users WHERE id = ${userId} LIMIT 1`
    if (!rows[0]) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }
    if (rows[0].email === ADMIN_CONFIG.email) {
      return NextResponse.json(
        { ok: false, error: 'The platform admin cannot be disabled.' },
        { status: 400 }
      )
    }
    await sql`UPDATE users SET is_active = ${isActive} WHERE id = ${userId}`
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

export async function DELETE(_req: NextRequest, ctx: RouteContext) {
  const forbidden = await guard()
  if (forbidden) return forbidden
  const { id } = await ctx.params
  const userId = parseInt(id, 10)
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ ok: false, error: 'Invalid user id' }, { status: 400 })
  }
  try {
    const rows = await sql`SELECT email FROM users WHERE id = ${userId} LIMIT 1`
    if (!rows[0]) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }
    if (rows[0].email === ADMIN_CONFIG.email) {
      return NextResponse.json(
        { ok: false, error: 'The platform admin cannot be deleted.' },
        { status: 400 }
      )
    }
    await sql`DELETE FROM users WHERE id = ${userId}`
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
