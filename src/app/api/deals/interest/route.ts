import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ADMIN_CONFIG, ensureSchema } from '@/lib/db/ensure-schema'
import { sendEmail } from '@/lib/email'

/**
 * POST /api/deals/interest
 * Body: { ticker, companyName, dealType, sector?, rationale?, sourcePage? }
 *
 * Records an authenticated user's "Express Interest" click and fires
 * an alert to the admin via sendEmail() (which always logs to
 * email_log, and will use SMTP later when configured).
 */
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }
  try {
    await ensureSchema()
    const body = (await req.json()) as {
      ticker?: string
      companyName?: string
      dealType?: string
      sector?: string
      rationale?: string
      sourcePage?: string
    }
    const { ticker, companyName, dealType, sector, rationale, sourcePage } = body
    if (!companyName || !dealType) {
      return NextResponse.json(
        { ok: false, error: 'companyName and dealType are required' },
        { status: 400 }
      )
    }

    // Pull user row for contact details
    const sessUsername = (session.user as { username?: string }).username
    const rows = await sql`
      SELECT id, full_name, email, phone
      FROM users
      WHERE username = ${sessUsername} OR email = ${session.user.email}
      LIMIT 1
    `
    const user = rows[0] as
      | { id: number; full_name: string | null; email: string; phone: string | null }
      | undefined

    const insertRows = await sql`
      INSERT INTO deal_interests (
        user_id, user_email, user_name, user_phone,
        ticker, company_name, deal_type, sector, rationale, source_page
      )
      VALUES (
        ${user?.id ?? null},
        ${user?.email ?? session.user.email ?? null},
        ${user?.full_name ?? session.user.name ?? null},
        ${user?.phone ?? null},
        ${ticker ?? null},
        ${companyName},
        ${dealType},
        ${sector ?? null},
        ${rationale ?? null},
        ${sourcePage ?? null}
      )
      RETURNING id
    `
    const interestId = insertRows[0]?.id

    // Dispatch admin notification (logged either way, delivered if SMTP configured)
    const summary = `${user?.full_name || session.user.name || 'A user'} (${user?.email || session.user.email || '—'}) has expressed interest in ${companyName}${ticker ? ` (${ticker})` : ''}.

Deal type: ${dealType}${sector ? `\nSector: ${sector}` : ''}
Phone: ${user?.phone || '—'}
Source: ${sourcePage || '—'}${rationale ? `\n\nRationale:\n${rationale}` : ''}

View all pending interests in the admin dashboard at /admin.`
    await sendEmail({
      to: ADMIN_CONFIG.email,
      subject: `DealNector · Interest expressed in ${companyName}`,
      body: summary,
      category: 'interest-alert',
    })

    return NextResponse.json({ ok: true, id: interestId })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
