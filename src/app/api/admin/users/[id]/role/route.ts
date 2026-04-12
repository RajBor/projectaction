import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ADMIN_CONFIG } from '@/lib/db/ensure-schema'
import { isFullAdmin, extractRole } from '@/lib/auth-helpers'

/**
 * PATCH /api/admin/users/:id/role  → { role: 'subadmin' | 'analyst' }
 *
 * Admin-only (full admin, NOT subadmin). Promotes a user to subadmin
 * or demotes them back to analyst. Cannot change the platform admin's
 * own role.
 */

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const session = await getServerSession(authOptions)
  const callerRole = extractRole(session?.user)
  if (!session?.user || !isFullAdmin(callerRole)) {
    return NextResponse.json({ ok: false, error: 'Only the platform admin can manage roles' }, { status: 403 })
  }

  const { id } = await ctx.params
  const userId = parseInt(id, 10)
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ ok: false, error: 'Invalid user id' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const { role } = body as { role?: string }
  if (role !== 'subadmin' && role !== 'analyst') {
    return NextResponse.json(
      { ok: false, error: 'Role must be "subadmin" or "analyst"' },
      { status: 400 }
    )
  }

  try {
    const rows = await sql`SELECT email, role FROM users WHERE id = ${userId} LIMIT 1`
    if (!rows[0]) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
    }
    if (rows[0].email === ADMIN_CONFIG.email) {
      return NextResponse.json(
        { ok: false, error: 'The platform admin role cannot be changed.' },
        { status: 400 }
      )
    }
    if (rows[0].role === 'admin') {
      return NextResponse.json(
        { ok: false, error: 'Cannot change another admin. Only one admin exists.' },
        { status: 400 }
      )
    }

    await sql`UPDATE users SET role = ${role} WHERE id = ${userId}`
    return NextResponse.json({ ok: true, message: `User role updated to ${role}` })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
