import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ADMIN_CONFIG } from '@/lib/db/ensure-schema'
import { isAdminOrSubadmin, isFullAdmin, extractRole } from '@/lib/auth-helpers'
import { sendBrevoEmail } from '@/lib/email/brevo'
import { welcomeEmailHtml } from '@/lib/email/templates/welcome'

/**
 * PATCH /api/admin/users/:id  → { isActive: boolean } OR { approve: true }
 *   Toggle is_active flag, or approve a pending user (sends welcome email with auth code).
 * DELETE /api/admin/users/:id
 *   Hard-delete a user row. ADMIN ONLY — subadmin cannot delete users.
 */

function generateAuthCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(6)
  return Array.from(bytes).map(b => chars[b % chars.length]).join('')
}

async function guardAdminOrSub() {
  const session = await getServerSession(authOptions)
  const role = extractRole(session?.user)
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return { err: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }), role: undefined }
  }
  return { err: null, role }
}

async function guardFullAdmin() {
  const session = await getServerSession(authOptions)
  const role = extractRole(session?.user)
  if (!session?.user || !isFullAdmin(role)) {
    return NextResponse.json({ ok: false, error: 'Only the platform admin can delete users' }, { status: 403 })
  }
  return null
}

type RouteContext = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: RouteContext) {
  const { err: forbidden } = await guardAdminOrSub()
  if (forbidden) return forbidden
  const { id } = await ctx.params
  const userId = parseInt(id, 10)
  if (!Number.isFinite(userId)) {
    return NextResponse.json({ ok: false, error: 'Invalid user id' }, { status: 400 })
  }
  const body = await req.json().catch(() => ({}))
  const { isActive, approve } = body as { isActive?: boolean; approve?: boolean }

  try {
    const rows = await sql`SELECT email, full_name, username, auth_code, is_active FROM users WHERE id = ${userId} LIMIT 1`
    if (!rows[0]) {
      return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404 })
    }
    if (rows[0].email === ADMIN_CONFIG.email) {
      return NextResponse.json(
        { ok: false, error: 'The platform admin cannot be disabled.' },
        { status: 400 }
      )
    }

    // ── Approve action: activate + send welcome email with auth code ──
    if (approve === true) {
      let authCode = rows[0].auth_code
      if (!authCode) {
        authCode = generateAuthCode()
        await sql`UPDATE users SET auth_code = ${authCode} WHERE id = ${userId}`
      }
      await sql`UPDATE users SET is_active = true WHERE id = ${userId}`

      // Send welcome email with auth code. We AWAIT the Brevo call (was
      // previously fire-and-forget which masked every failure — a missing
      // BREVO_API_KEY_WELCOME env var would silently drop the email and
      // the admin UI still showed "email sent"). Now we surface the
      // actual delivery status so the admin can either resend or hand
      // the auth code to the user by another channel.
      const user = rows[0]
      const firstName = user.full_name?.split(' ')[0] || user.username
      let emailOk = false
      let emailError: string | undefined
      try {
        const result = await sendBrevoEmail({
          to: { email: user.email, name: user.full_name || user.username },
          subject: 'Welcome to DealNector — Your Access Has Been Approved',
          htmlContent: welcomeEmailHtml({
            firstName,
            loginUrl: process.env.NEXTAUTH_URL || 'https://dealnector.com',
            authCode,
          }),
          purpose: 'welcome',
          tags: ['signup', 'welcome', 'approved'],
        })
        emailOk = result.ok
        emailError = result.error
        if (result.ok) {
          console.log(`[admin] Welcome email sent to ${user.email}, code: ${authCode}`)
        } else {
          console.error(`[admin] Welcome email FAILED for ${user.email}: ${result.error}`)
        }
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err)
        console.error('[admin] Welcome email exception:', err)
      }

      // The user is still considered approved even if the email bounced —
      // admin can copy the authCode manually from the response / users table.
      return NextResponse.json({
        ok: true,
        approved: true,
        authCode,
        emailSent: emailOk,
        emailError: emailOk ? undefined : emailError,
      })
    }

    // ── Standard toggle ──
    if (typeof isActive !== 'boolean') {
      return NextResponse.json({ ok: false, error: 'isActive boolean or approve:true required' }, { status: 400 })
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
  const forbidden = await guardFullAdmin()
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
