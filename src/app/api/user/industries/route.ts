import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * GET /api/user/industries — returns the current user's saved industry
 *   selection and the first-login-done flag.
 * POST /api/user/industries — persist the signed-in user's selection.
 *
 * For analyst roles the caller must not submit more than 5 IDs; the
 * server clamps to 5 regardless. Admins/subadmins can send more.
 */

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }
  const email = (session.user as { email?: string }).email
  if (!email) {
    return NextResponse.json({ ok: false, error: 'No email in session' }, { status: 400 })
  }
  try {
    await ensureSchema()
    const rows = await sql`
      SELECT industries, industries_chosen_at, role
      FROM users WHERE email = ${email} LIMIT 1
    `
    if (rows.length === 0) {
      return NextResponse.json({ ok: true, industries: [], chosen: false })
    }
    const raw = rows[0].industries
    let industries: string[] = []
    try {
      const parsed = JSON.parse(raw || '[]')
      if (Array.isArray(parsed)) industries = parsed.map(String)
    } catch { /* default empty */ }
    return NextResponse.json({
      ok: true,
      industries,
      chosen: rows[0].industries_chosen_at != null,
      role: rows[0].role,
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }
  const email = (session.user as { email?: string }).email
  const role = (session.user as { role?: string }).role
  if (!email) {
    return NextResponse.json({ ok: false, error: 'No email in session' }, { status: 400 })
  }
  try {
    const body = await req.json()
    if (!Array.isArray(body.industries)) {
      return NextResponse.json({ ok: false, error: 'industries[] required' }, { status: 400 })
    }
    const clean = Array.from(new Set(body.industries.map((x: unknown) => String(x))))
    // Analyst: hard cap at 5. Admin/subadmin: unlimited.
    const limited = role === 'admin' || role === 'subadmin' ? clean : clean.slice(0, 5)
    await ensureSchema()
    await sql`
      UPDATE users
      SET industries = ${JSON.stringify(limited)},
          industries_chosen_at = NOW()
      WHERE email = ${email}
    `
    return NextResponse.json({ ok: true, industries: limited })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
