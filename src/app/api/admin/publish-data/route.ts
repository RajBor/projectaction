import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { COMPANIES } from '@/lib/data/companies'
import { writeFileSync } from 'fs'
import { join } from 'path'

/**
 * POST /api/admin/publish-data
 *
 * Admin-only. Receives a map of { ticker → overrideFields } and writes
 * an updated COMPANIES[] array back into src/lib/data/companies.ts.
 *
 * Body: { overrides: Record<string, Partial<CompanyOverride>> }
 *
 * Only the numeric fields are overrideable — name, ticker, nse, sec,
 * comp, acqs, acqf, rea are preserved from the current file.
 */

interface CompanyOverride {
  mktcap?: number
  rev?: number
  ebitda?: number
  pat?: number
  ev?: number
  ev_eb?: number
  pe?: number
  pb?: number
  dbt_eq?: number
  revg?: number
  ebm?: number
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  let body: { overrides?: Record<string, CompanyOverride> }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const overrides = body.overrides
  if (!overrides || typeof overrides !== 'object') {
    return NextResponse.json(
      { ok: false, error: 'Missing overrides map' },
      { status: 400 }
    )
  }

  // Build the updated rows
  const updated = COMPANIES.map((co) => {
    const patch = overrides[co.ticker]
    if (!patch) return co
    return {
      ...co,
      mktcap: patch.mktcap ?? co.mktcap,
      rev: patch.rev ?? co.rev,
      ebitda: patch.ebitda ?? co.ebitda,
      pat: patch.pat ?? co.pat,
      ev: patch.ev ?? co.ev,
      ev_eb: patch.ev_eb ?? co.ev_eb,
      pe: patch.pe ?? co.pe,
      pb: patch.pb ?? co.pb,
      dbt_eq: patch.dbt_eq ?? co.dbt_eq,
      revg: patch.revg ?? co.revg,
      ebm: patch.ebm ?? co.ebm,
    }
  })

  // Generate the TypeScript source
  const header = `export interface Company {
  name: string;
  ticker: string;
  nse: string | null;
  sec: "solar" | "td";
  comp: string[];
  mktcap: number;
  rev: number;
  ebitda: number;
  pat: number;
  ev: number;
  ev_eb: number;
  pe: number;
  pb: number;
  dbt_eq: number;
  revg: number;
  ebm: number;
  acqs: number;
  acqf: string;
  rea: string;
}

export const COMPANIES: Company[] = [\n`

  const rows = updated.map((co) => {
    const nseVal = co.nse ? `"${co.nse}"` : 'null'
    const compArr = JSON.stringify(co.comp)
    const rea = co.rea.replace(/"/g, '\\"')
    return `  {name:"${co.name}",ticker:"${co.ticker}",nse:${nseVal},sec:"${co.sec}",comp:${compArr},mktcap:${co.mktcap},rev:${co.rev},ebitda:${co.ebitda},pat:${co.pat},ev:${co.ev},ev_eb:${co.ev_eb},pe:${co.pe},pb:${co.pb},dbt_eq:${co.dbt_eq},revg:${co.revg},ebm:${co.ebm},acqs:${co.acqs},acqf:"${co.acqf}",rea:"${rea}"},`
  })

  const source = header + rows.join('\n') + '\n]\n'

  try {
    const filePath = join(process.cwd(), 'src', 'lib', 'data', 'companies.ts')
    writeFileSync(filePath, source, 'utf8')
    return NextResponse.json({
      ok: true,
      message: `Published ${Object.keys(overrides).length} company overrides to companies.ts`,
      updatedCount: Object.keys(overrides).length,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `Failed to write: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    )
  }
}
