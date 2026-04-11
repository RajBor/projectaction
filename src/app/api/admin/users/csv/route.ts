import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * GET /api/admin/users/csv — returns all users as a CSV download.
 * Admin only.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  try {
    await ensureSchema()
    const rows = await sql`
      SELECT id, username, email, full_name, phone,
             organization, designation, official_email,
             role, is_active,
             signup_ip, signup_location, last_login_ip, last_login_location,
             created_at, last_login
      FROM users
      ORDER BY created_at DESC
    `

    const headers = [
      'id',
      'username',
      'email',
      'full_name',
      'phone',
      'organization',
      'designation',
      'official_email',
      'role',
      'is_active',
      'signup_ip',
      'signup_location',
      'last_login_ip',
      'last_login_location',
      'created_at',
      'last_login',
    ]
    const esc = (v: unknown): string => {
      if (v == null) return ''
      const s = String(v)
      if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
      return s
    }
    const lines: string[] = [headers.join(',')]
    for (const r of rows) {
      lines.push(headers.map((h) => esc((r as Record<string, unknown>)[h])).join(','))
    }
    const csv = lines.join('\n')
    const today = new Date().toISOString().slice(0, 10)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="dealnector-users-${today}.csv"`,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
