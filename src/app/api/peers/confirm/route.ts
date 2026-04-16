/**
 * POST /api/peers/confirm
 *
 * Called when an authenticated user clicks "Use checked peers in report"
 * on the SubSegmentPeerPicker. Persists their selection so future users
 * who pick the same sub-segment see a pre-verified list (with a
 * "verified by N analysts" badge) without re-calling Gemini.
 *
 * Body: {
 *   subSegmentId: "1.2.3",
 *   confirmed: [
 *     { name, ticker?, isPrivate, productLine?, evidence?: [{url,title?}] }
 *   ]
 * }
 *
 * Response: { ok, inserted, upgraded }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ConfirmCandidate {
  name: string
  ticker?: string | null
  isPrivate?: boolean
  productLine?: string
  evidence?: Array<{ url: string; title?: string }>
}

interface PostBody {
  subSegmentId?: string
  confirmed?: ConfirmCandidate[]
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const userId = (session?.user as { id?: number } | undefined)?.id
  if (!userId) {
    return NextResponse.json({ ok: false, error: 'auth_required' }, { status: 401 })
  }

  let body: PostBody
  try {
    body = (await req.json()) as PostBody
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  const subSegmentId = (body.subSegmentId || '').trim()
  if (!subSegmentId) {
    return NextResponse.json({ ok: false, error: 'subSegmentId required' }, { status: 400 })
  }
  if (!Array.isArray(body.confirmed) || body.confirmed.length === 0) {
    return NextResponse.json({ ok: false, error: 'no_candidates' }, { status: 400 })
  }

  await ensureSchema().catch(() => {})

  let inserted = 0
  let upgraded = 0

  for (const c of body.confirmed) {
    const name = String(c.name || '').trim()
    if (!name) continue
    const ticker = c.ticker ? String(c.ticker).trim().toUpperCase() : null
    const isPrivate = c.isPrivate ?? !ticker
    const evidenceJson = JSON.stringify(c.evidence || [])
    try {
      // Upsert. If the row already existed with source='gemini_web', we
      // "upgrade" it to user-confirmed by bumping source='user',
      // confidence=0.95, and incrementing user_confirmations.
      const rows = (await sql`
        INSERT INTO sub_segment_classifications
          (sub_segment_id, ticker, company_name, is_private, source, confidence,
           product_line, verification_sources, last_verified_at, verified_by, user_confirmations)
        VALUES
          (${subSegmentId}, ${ticker}, ${name}, ${isPrivate}, 'user', 0.95,
           ${c.productLine || null}, ${evidenceJson}::jsonb, NOW(), ${userId}, 1)
        ON CONFLICT (sub_segment_id, ticker, company_name) DO UPDATE SET
          source                = 'user',
          confidence            = GREATEST(sub_segment_classifications.confidence, EXCLUDED.confidence),
          product_line          = COALESCE(EXCLUDED.product_line, sub_segment_classifications.product_line),
          verification_sources  = EXCLUDED.verification_sources,
          last_verified_at      = NOW(),
          verified_by           = EXCLUDED.verified_by,
          user_confirmations    = sub_segment_classifications.user_confirmations + 1
        RETURNING (xmax = 0) AS inserted
      `) as Array<{ inserted: boolean }>
      if (rows[0]?.inserted) inserted++
      else upgraded++
    } catch {
      // Non-fatal — keep processing the rest of the batch.
    }
  }

  return NextResponse.json({ ok: true, inserted, upgraded })
}
