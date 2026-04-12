import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import { rapidApiQuota } from '@/app/api/stocks/route'

/**
 * GET /api/admin/api-quota — Returns current RapidAPI quota usage.
 * Admin only.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user || !isAdminOrSubadmin(session.user.role)) {
    return NextResponse.json({ ok: false, error: 'Admin access required' }, { status: 403 })
  }

  return NextResponse.json({
    ok: true,
    quota: rapidApiQuota,
  })
}
