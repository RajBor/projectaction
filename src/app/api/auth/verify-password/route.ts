import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import bcrypt from 'bcryptjs'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }

  let body: { password?: string } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request' }, { status: 400 })
  }

  const password = (body.password || '').trim()
  if (!password) {
    return NextResponse.json({ ok: false, error: 'Password required' }, { status: 400 })
  }

  const username = (session.user as { username?: string }).username
  const email = session.user.email || undefined

  try {
    const rows = await sql`
      SELECT password_hash FROM users
      WHERE (username = ${username} OR email = ${email})
      AND is_active = true
      LIMIT 1
    `
    if (!rows[0]) {
      return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
    }
    const valid = await bcrypt.compare(password, rows[0].password_hash)
    if (!valid) {
      return NextResponse.json({ ok: false, error: 'Incorrect password' }, { status: 401 })
    }
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'Verification failed' }, { status: 500 })
  }
}
