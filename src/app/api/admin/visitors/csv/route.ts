import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isAdminOrSubadmin } from '@/lib/auth-helpers'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

/**
 * GET /api/admin/visitors/csv — download the merged visitor log as CSV.
 *
 * Same union as /api/admin/visitors but streams the full set (no row
 * cap) so the admin can hand the file to sales / compliance without
 * paging. Admin-only.
 */

export const runtime = 'nodejs'

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
      ` as Promise<Array<Record<string, unknown>>>,
    ])

    interface Unified {
      id: string
      type: 'report' | 'access'
      created_at: string
      name: string
      email: string
      organization: string
      designation: string
      phone: string
      industry_id: string
      value_chain_id: string
      sub_segment_id: string
      company_ticker: string
      companies_of_interest: string
      purpose: string
      ip: string
      location: string
      user_agent: string
      status: string
    }
    const toStr = (v: unknown): string => {
      if (v == null) return ''
      if (v instanceof Date) return v.toISOString()
      return String(v)
    }
    const merged: Unified[] = [
      ...reportRows.map((r): Unified => ({
        id: `r_${toStr(r.id)}`,
        type: 'report',
        created_at: toStr(r.created_at),
        name: toStr(r.name),
        email: toStr(r.email),
        organization: toStr(r.organization),
        designation: toStr(r.designation),
        phone: '',
        industry_id: toStr(r.industry_id),
        value_chain_id: toStr(r.value_chain_id),
        sub_segment_id: toStr(r.sub_segment_id),
        company_ticker: toStr(r.company_ticker),
        companies_of_interest: '',
        purpose: toStr(r.purpose),
        ip: toStr(r.ip),
        location: toStr(r.location),
        user_agent: toStr(r.user_agent),
        status: '',
      })),
      ...accessRows.map((r): Unified => ({
        id: `a_${toStr(r.id)}`,
        type: 'access',
        created_at: toStr(r.created_at),
        name: toStr(r.name),
        email: toStr(r.email),
        organization: toStr(r.organization),
        designation: toStr(r.designation),
        phone: toStr(r.phone),
        industry_id: toStr(r.industry_id),
        value_chain_id: toStr(r.value_chain_id),
        sub_segment_id: toStr(r.sub_segment_id),
        company_ticker: '',
        companies_of_interest: toStr(r.companies_of_interest),
        purpose: toStr(r.purpose),
        ip: toStr(r.ip),
        location: toStr(r.location),
        user_agent: toStr(r.user_agent),
        status: toStr(r.status),
      })),
    ]
    merged.sort((a, b) => b.created_at.localeCompare(a.created_at))

    const headers: Array<keyof Unified> = [
      'id',
      'type',
      'created_at',
      'name',
      'email',
      'organization',
      'designation',
      'phone',
      'industry_id',
      'value_chain_id',
      'sub_segment_id',
      'company_ticker',
      'companies_of_interest',
      'purpose',
      'ip',
      'location',
      'user_agent',
      'status',
    ]
    const esc = (v: string): string => {
      if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
      return v
    }
    const lines: string[] = [headers.join(',')]
    for (const row of merged) {
      lines.push(headers.map((h) => esc(row[h])).join(','))
    }
    const csv = lines.join('\n')
    const today = new Date().toISOString().slice(0, 10)
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="dealnector-visitors-${today}.csv"`,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
