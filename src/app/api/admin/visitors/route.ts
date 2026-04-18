import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * GET /api/admin/visitors — merged site-visitor log.
 *
 * Unifies two public lead-capture tables into a single chronological
 * feed for the admin "Visitor Log" tab:
 *
 *   1. public_report_requests — every landing-page "Download sample
 *      report" submission. Carries industry / value-chain / sub-segment
 *      / company-ticker context and the form contact fields.
 *   2. public_access_requests — every "Request customised access" lead.
 *      Adds phone, companies_of_interest, and a status column.
 *
 * Both tables already stamp IP + reverse-geo location + user-agent via
 * `geoFromRequest` in the capture endpoints, so the admin sees where
 * each visitor came from without a separate geo-lookup round-trip here.
 *
 * Shape: one uniform row per visit with `type: 'report' | 'access'`
 * discriminating which table it came from. Fields only present on one
 * side (phone, companies_of_interest, company_ticker, status) are
 * nullable in the unified shape.
 *
 * Admin-only. Capped at 2000 rows (newest first) to keep the admin
 * table responsive; a future "Load more" button can page beyond.
 */

export const runtime = 'nodejs'

export interface VisitorLogRow {
  id: string
  type: 'report' | 'access'
  created_at: string | null
  name: string | null
  email: string | null
  organization: string | null
  designation: string | null
  phone: string | null
  industry_id: string | null
  value_chain_id: string | null
  sub_segment_id: string | null
  company_ticker: string | null
  companies_of_interest: string | null
  purpose: string | null
  ip: string | null
  location: string | null
  user_agent: string | null
  status: string | null
}

export async function GET() {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || !isAdminOrSubadmin(role)) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }
  try {
    await ensureSchema()
    const [reportRows, accessRows] = await Promise.all([
      sql`
        SELECT id, created_at,
               requester_name AS name,
               requester_email AS email,
               requester_organization AS organization,
               requester_designation AS designation,
               requester_purpose AS purpose,
               industry_id, value_chain_id, sub_segment_id, company_ticker,
               requester_ip AS ip,
               requester_location AS location,
               user_agent
        FROM public_report_requests
        ORDER BY created_at DESC
        LIMIT 2000
      ` as Promise<Array<Record<string, unknown>>>,
      sql`
        SELECT id, created_at,
               name, email, organization, designation, phone,
               industry_id, value_chain_id, sub_segment_id,
               companies_of_interest, purpose,
               requester_ip AS ip,
               requester_location AS location,
               user_agent,
               status
        FROM public_access_requests
        ORDER BY created_at DESC
        LIMIT 2000
      ` as Promise<Array<Record<string, unknown>>>,
    ])

    const toIso = (v: unknown): string | null => {
      if (v == null) return null
      if (v instanceof Date) return v.toISOString()
      return String(v)
    }
    const visitors: VisitorLogRow[] = [
      ...reportRows.map((r) => ({
        id: `r_${String(r.id)}`,
        type: 'report' as const,
        created_at: toIso(r.created_at),
        name: (r.name as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        organization: (r.organization as string | null) ?? null,
        designation: (r.designation as string | null) ?? null,
        phone: null,
        industry_id: (r.industry_id as string | null) ?? null,
        value_chain_id: (r.value_chain_id as string | null) ?? null,
        sub_segment_id: (r.sub_segment_id as string | null) ?? null,
        company_ticker: (r.company_ticker as string | null) ?? null,
        companies_of_interest: null,
        purpose: (r.purpose as string | null) ?? null,
        ip: (r.ip as string | null) ?? null,
        location: (r.location as string | null) ?? null,
        user_agent: (r.user_agent as string | null) ?? null,
        status: null,
      })),
      ...accessRows.map((r) => ({
        id: `a_${String(r.id)}`,
        type: 'access' as const,
        created_at: toIso(r.created_at),
        name: (r.name as string | null) ?? null,
        email: (r.email as string | null) ?? null,
        organization: (r.organization as string | null) ?? null,
        designation: (r.designation as string | null) ?? null,
        phone: (r.phone as string | null) ?? null,
        industry_id: (r.industry_id as string | null) ?? null,
        value_chain_id: (r.value_chain_id as string | null) ?? null,
        sub_segment_id: (r.sub_segment_id as string | null) ?? null,
        company_ticker: null,
        companies_of_interest: (r.companies_of_interest as string | null) ?? null,
        purpose: (r.purpose as string | null) ?? null,
        ip: (r.ip as string | null) ?? null,
        location: (r.location as string | null) ?? null,
        user_agent: (r.user_agent as string | null) ?? null,
        status: (r.status as string | null) ?? null,
      })),
    ]

    // Newest first across both sources. created_at defaults to NOW() on
    // both tables, so plain string compare of the ISO timestamp works.
    visitors.sort((a, b) => {
      const ta = a.created_at || ''
      const tb = b.created_at || ''
      return tb.localeCompare(ta)
    })

    return NextResponse.json({ ok: true, visitors, count: visitors.length })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
