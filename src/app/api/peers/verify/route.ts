/**
 * POST /api/peers/verify
 *
 * Server-side Gemini 2.5 Flash call with Google Search grounding that
 * returns peer candidates for a given sub-segment.
 *
 * Layered cache (cheapest first):
 *   1. `sub_segment_classifications` with source='user' or 'gemini_web'
 *      AND last_verified_at < 30 days old → serve from DB, zero Gemini hit.
 *   2. `gemini_peer_verifications` keyed on sub_segment_id with TTL 7 days
 *      → serve cached Gemini response.
 *   3. Live Gemini call (counts against free 500/day quota).
 *
 * Rate / quota guard:
 *   • Only authenticated users may trigger a live Gemini call. Anonymous
 *     callers always get DB-only results.
 *   • If `gemini_api_log` shows ≥ 450 successful calls in the past 24h,
 *     the endpoint falls back to DB-only and marks the response
 *     quotaGuarded=true for the UI to show a gentle notice.
 *
 * Body shape:
 *   { subSegmentId: "1.2.3", subjectTicker?: "WAAREEENS",
 *     force?: boolean  // admin-only: bypass caches }
 */

import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import sql from '@/lib/db'
import { ensureSchema } from '@/lib/db/ensure-schema'
import {
  TAXONOMY_STAGES,
  type SubSegment,
} from '@/lib/data/sub-segments'
import {
  verifyPeersForSubSegment,
  GEMINI_FREE_DAILY_CAP,
  getGeminiModelId,
  type PeerCandidate,
} from '@/lib/llm/gemini'
import { findValueChain, type CatalogCompany } from '@/lib/public-report/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DB_TTL_DAYS = 30
const RECENT_CACHE_TTL_DAYS = 7
const QUOTA_WARN_THRESHOLD = 450

interface PostBody {
  subSegmentId?: string
  subjectTicker?: string
  force?: boolean
}

interface DbClassificationRow {
  ticker: string | null
  company_name: string
  is_private: boolean
  source: string
  confidence: number
  product_line: string | null
  verification_sources: Array<{ url: string; title?: string }> | null
  last_verified_at: string | null
  user_confirmations: number
}

export async function POST(req: NextRequest) {
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

  // Resolve sub-segment metadata from the static taxonomy (no DB hit).
  const resolved = resolveSubSegment(subSegmentId)
  if (!resolved) {
    return NextResponse.json({ ok: false, error: 'unknown_sub_segment' }, { status: 404 })
  }

  await ensureSchema().catch(() => {})
  const session = await getServerSession(authOptions).catch(() => null)
  const userId = (session?.user as { id?: number })?.id || null
  const userRole = (session?.user as { role?: string })?.role || null
  const isAuthed = !!userId
  const isAdmin = userRole === 'admin'
  const force = !!body.force && isAdmin

  // ── Tier 1: user-confirmed / recently-verified rows from DB ──
  //
  // Previously this required BOTH >=5 candidates AND freshness for the
  // cache hit to fire. For freshly-seeded sub-segments with only 2-3
  // entries the tier-1 branch was skipped entirely even though real
  // verified data was sitting in the DB, forcing every request through
  // to a live Gemini call. We now serve the cached set whenever there's
  // at least ONE fresh candidate — the UI lets the user top up with
  // live Gemini via the refresh button if they want more.
  if (!force) {
    const dbHit = await loadClassifications(subSegmentId)
    if (dbHit.candidates.length >= 1 && dbHit.freshEnough) {
      // Top up with the catalog universe so the user sees the full
      // pool, not just the handful an earlier analyst confirmed.
      // Merge order: verified DB rows first, then catalog fillers.
      const universe = buildUniverseCandidates(resolved)
      const merged = mergeCandidates(dbHit.candidates, universe)
      return NextResponse.json({
        ok: true,
        cacheSource: 'user_confirmed_db',
        subSegment: resolved,
        candidates: merged,
        quotaGuarded: false,
      })
    }
  }

  // ── Tier 2: recent Gemini cache ──
  if (!force) {
    const recent = await loadRecentGeminiCache(subSegmentId)
    if (recent) {
      return NextResponse.json({
        ok: true,
        cacheSource: 'recent_cache',
        subSegment: resolved,
        candidates: recent.candidates,
        quotaGuarded: false,
        cachedAt: recent.createdAt,
      })
    }
  }

  // ── Tier 3: live Gemini call (authenticated users only) ──
  if (!isAuthed) {
    // Public visitor — merge DB rows with catalog universe so they
    // see at least the same starting pool a signed-in user gets.
    const dbAny = await loadClassifications(subSegmentId, { ignoreFreshness: true })
    const universe = buildUniverseCandidates(resolved)
    const merged = mergeCandidates(dbAny.candidates, universe)
    return NextResponse.json({
      ok: true,
      cacheSource: 'db_partial',
      subSegment: resolved,
      candidates: merged,
      quotaGuarded: true,
      notice: merged.length > 0
        ? `Showing ${merged.length} peer${merged.length === 1 ? '' : 's'} from our universe (${dbAny.candidates.length} analyst-verified, ${universe.length} catalog match). Sign in to run a fresh Gemini web verification.`
        : 'No peers matched for this sub-segment. Sign in to run a live web verification via Gemini.',
    })
  }

  // Config guard: if the server key isn't wired up we bail early with
  // a clear admin-facing message. Falling through into
  // `verifyPeersForSubSegment` would throw "GEMINI_API_KEY is not
  // set on the server" which looks alarming in the UI even though
  // it's a pure ops config miss.
  //
  // We STILL return the merged universe pool so the user can pick
  // peers without waiting for Gemini to be wired up — Gemini only
  // adds discovery of unclassified companies.
  if (!process.env.GEMINI_API_KEY) {
    const dbAny = await loadClassifications(subSegmentId, { ignoreFreshness: true })
    const universe = buildUniverseCandidates(resolved)
    const merged = mergeCandidates(dbAny.candidates, universe)
    return NextResponse.json({
      ok: true,
      cacheSource: 'db_partial',
      subSegment: resolved,
      candidates: merged,
      quotaGuarded: true,
      notice:
        'Live Gemini verification is not yet enabled on this deployment (ask an admin to set GEMINI_API_KEY in Vercel). ' +
        (merged.length > 0
          ? `Meanwhile, here are ${merged.length} peer${merged.length === 1 ? '' : 's'} from our universe catalog (${dbAny.candidates.length} analyst-verified, ${universe.length} stage match) that you can pick from now.`
          : 'The catalog has no companies mapped to this sub-segment yet — once Gemini is enabled it will discover them.'),
    })
  }

  // Quota guard: if we've already burned >450 calls today, fail open.
  const usedToday = await countGeminiCallsToday()
  if (usedToday >= QUOTA_WARN_THRESHOLD) {
    const dbAny = await loadClassifications(subSegmentId, { ignoreFreshness: true })
    return NextResponse.json({
      ok: true,
      cacheSource: 'quota_guard',
      subSegment: resolved,
      candidates: dbAny.candidates,
      quotaGuarded: true,
      notice: `Daily Gemini free-tier quota nearly exhausted (${usedToday}/${GEMINI_FREE_DAILY_CAP}). Live verification pauses until reset at UTC midnight.`,
    })
  }

  // Live call.
  const started = Date.now()
  try {
    const result = await verifyPeersForSubSegment({
      subSegmentId,
      subSegmentName: resolved.name,
      subSegmentParentStage: resolved.stageName,
      industryName: resolved.industryName,
      subjectName: body.subjectTicker || undefined,
    })

    // Persist raw response for TTL cache (upsert — one row per sub_segment).
    await sql`
      INSERT INTO gemini_peer_verifications
        (sub_segment_id, sub_segment_name, response_json, candidates_count, model, created_at)
      VALUES
        (${subSegmentId}, ${resolved.name}, ${JSON.stringify({
          candidates: result.candidates,
          groundingSources: result.groundingSources,
        })}::jsonb, ${result.candidates.length}, ${getGeminiModelId()}, NOW())
      ON CONFLICT (sub_segment_id) DO UPDATE SET
        sub_segment_name = EXCLUDED.sub_segment_name,
        response_json    = EXCLUDED.response_json,
        candidates_count = EXCLUDED.candidates_count,
        model            = EXCLUDED.model,
        created_at       = NOW()
    `.catch(() => {}) // non-fatal

    // Also seed sub_segment_classifications with source='gemini_web'
    // so future cache-miss DB lookups surface these even without user
    // confirmation. Each row starts at confidence=0.7; a user confirm
    // on /api/peers/confirm bumps it to 0.95.
    for (const c of result.candidates) {
      await sql`
        INSERT INTO sub_segment_classifications
          (sub_segment_id, ticker, company_name, is_private, source, confidence,
           product_line, verification_sources, last_verified_at, verified_by)
        VALUES
          (${subSegmentId}, ${c.ticker || null}, ${c.name}, ${c.isPrivate},
           'gemini_web', 0.7, ${c.productLine},
           ${JSON.stringify(c.evidence)}::jsonb, NOW(), ${userId})
        ON CONFLICT (sub_segment_id, ticker, company_name) DO UPDATE SET
          product_line = EXCLUDED.product_line,
          verification_sources = EXCLUDED.verification_sources,
          last_verified_at = NOW(),
          confidence = GREATEST(sub_segment_classifications.confidence, EXCLUDED.confidence)
      `.catch(() => {})
    }

    await sql`
      INSERT INTO gemini_api_log
        (endpoint, sub_segment_id, requested_by, status, latency_ms)
      VALUES ('verify', ${subSegmentId}, ${userId}, 'ok', ${Date.now() - started})
    `.catch(() => {})

    return NextResponse.json({
      ok: true,
      cacheSource: 'gemini_live',
      subSegment: resolved,
      candidates: result.candidates,
      groundingSources: result.groundingSources,
      quotaGuarded: false,
      quotaUsedToday: usedToday + 1,
      quotaCap: GEMINI_FREE_DAILY_CAP,
    })
  } catch (err) {
    const msg = (err as Error).message || 'gemini_failed'
    await sql`
      INSERT INTO gemini_api_log
        (endpoint, sub_segment_id, requested_by, status, latency_ms, error)
      VALUES ('verify', ${subSegmentId}, ${userId}, 'error', ${Date.now() - started}, ${msg.slice(0, 500)})
    `.catch(() => {})

    // Fail open — always return SOMETHING useful.
    const dbAny = await loadClassifications(subSegmentId, { ignoreFreshness: true })
    return NextResponse.json({
      ok: false,
      error: 'gemini_call_failed',
      detail: msg.slice(0, 300),
      cacheSource: 'db_fallback',
      subSegment: resolved,
      candidates: dbAny.candidates,
      quotaGuarded: false,
    })
  }
}

// ── Helpers --------------------------------------------------------

function resolveSubSegment(id: string):
  | {
      id: string
      code: string
      name: string
      stageCode: string
      stageName: string
      industryCode: string
      industryName: string
    }
  | null {
  for (const stage of TAXONOMY_STAGES) {
    const hit = stage.subs.find((s: SubSegment) => s.id === id || s.code === id)
    if (hit) {
      return {
        id: hit.id,
        code: hit.code,
        name: hit.name,
        stageCode: stage.code,
        stageName: stage.name,
        industryCode: stage.industryCode,
        industryName: industryLabel(stage.industryCode),
      }
    }
  }
  return null
}

function industryLabel(code: string): string {
  const M: Record<string, string> = {
    '1': 'Solar PV & Renewable Energy',
    '2': 'Wind Energy',
    '3': 'EV & Battery Storage',
    '4': 'Steel & Metals',
    '5': 'Pharmaceuticals & Healthcare',
    '6': 'Specialty Chemicals',
    '7': 'Semiconductors & Electronics',
    '8': 'Textiles & Apparel',
    '9': 'FMCG & Consumer',
    '10': 'Infrastructure & Construction',
    '11': 'Defence & Aerospace',
    '12': 'IT & Technology Services',
    '13': 'Agribusiness & Food',
    '14': 'Cement & Building Materials',
    '15': 'Shipping & Maritime',
  }
  return M[code] || `Industry ${code}`
}

async function loadClassifications(
  subSegmentId: string,
  opts?: { ignoreFreshness?: boolean }
): Promise<{ candidates: PeerCandidate[]; freshEnough: boolean }> {
  const rows = (await sql`
    SELECT ticker, company_name, is_private, source, confidence, product_line,
           verification_sources, last_verified_at, user_confirmations
    FROM sub_segment_classifications
    WHERE sub_segment_id = ${subSegmentId}
      AND confidence >= 0.5
    ORDER BY (source = 'user') DESC, confidence DESC, user_confirmations DESC
    LIMIT 12
  `) as DbClassificationRow[]

  const now = Date.now()
  const ttlMs = DB_TTL_DAYS * 24 * 3600 * 1000
  const fresh = rows.filter((r) => {
    if (opts?.ignoreFreshness) return true
    if (!r.last_verified_at) return false
    return now - new Date(r.last_verified_at).getTime() < ttlMs
  })

  const candidates: PeerCandidate[] = (opts?.ignoreFreshness ? rows : fresh).map(
    (r) => ({
      name: r.company_name,
      ticker: r.ticker,
      isPrivate: !!r.is_private,
      productLine: r.product_line || '',
      evidence: Array.isArray(r.verification_sources)
        ? r.verification_sources.map((s) => ({ url: s.url, title: s.title }))
        : [],
    })
  )

  return {
    candidates,
    // `freshEnough` means at least one candidate is within the TTL.
    // The caller decides the threshold — at the time of writing, even
    // a single fresh row short-circuits the Gemini call. The earlier
    // `>= 5` threshold effectively turned the DB cache off for any
    // sub-segment with fewer than 5 verifications, which is most of
    // them in the demand-driven model.
    freshEnough: fresh.length >= 1,
  }
}

async function loadRecentGeminiCache(
  subSegmentId: string
): Promise<
  | {
      candidates: PeerCandidate[]
      createdAt: string
    }
  | null
> {
  const cutoff = new Date(Date.now() - RECENT_CACHE_TTL_DAYS * 24 * 3600 * 1000)
  const rows = (await sql`
    SELECT response_json, created_at
    FROM gemini_peer_verifications
    WHERE sub_segment_id = ${subSegmentId}
      AND created_at > ${cutoff}
    LIMIT 1
  `.catch(() => [])) as Array<{
    response_json: { candidates?: PeerCandidate[] }
    created_at: string
  }>

  if (rows.length === 0) return null
  const raw = rows[0].response_json
  if (!raw?.candidates || !Array.isArray(raw.candidates)) return null
  return { candidates: raw.candidates, createdAt: rows[0].created_at }
}

async function countGeminiCallsToday(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000)
  const rows = (await sql`
    SELECT COUNT(*)::int AS n
    FROM gemini_api_log
    WHERE status = 'ok' AND created_at > ${cutoff}
  `.catch(() => [{ n: 0 }])) as Array<{ n: number }>
  return rows[0]?.n || 0
}

/**
 * Pull candidates from our existing universe catalog that operate in
 * the SAME value-chain stage as the requested sub-segment.
 *
 * The catalog (`@/lib/public-report/catalog`) merges three sources:
 *   • static COMPANIES[] (86 hand-curated solar + T&D rows with numbers)
 *   • user_companies (admin-published DB rows)
 *   • atlas-seed (~1,700 role-description rows across 15 industries)
 *
 * For a sub-segment like "1.2.3 TOPCon Cell" the parent stage is "1.2
 * Wafer, Cell & Module Manufacturing" — all companies flagged to that
 * stage in the catalog are included here as a starting pool. The user
 * picks from them without needing Gemini. When the user confirms, those
 * picks land in `sub_segment_classifications` with source='user' so the
 * next analyst targeting the same sub-segment gets them instantly.
 *
 * Without this function the picker showed zero candidates for any
 * sub-segment no earlier analyst had explicitly verified — which was
 * nearly every sub-segment on day one. Now the picker always surfaces
 * the relevant universe, and Gemini is positioned as a "discover more"
 * feature rather than the only path to any data.
 */
function buildUniverseCandidates(
  resolved: { id: string; code: string; name: string; stageCode: string; industryCode: string }
): PeerCandidate[] {
  const hit = findValueChain(resolved.industryCode === 'td' ? 'td' : resolvedSiteId(resolved.industryCode), resolved.stageCode)
  if (!hit) return []
  const asPeer = (c: CatalogCompany): PeerCandidate => ({
    name: c.name,
    ticker: c.ticker && c.ticker.length > 0 ? c.ticker.toUpperCase() : null,
    isPrivate: !c.ticker || c.ticker.length === 0,
    productLine: c.role || '',
    evidence: [],
  })
  // hasNumbers rows (real COMPANIES tickers) first, then the rest.
  const prioritised = [...hit.vc.companies].sort((a, b) => {
    if (a.hasNumbers !== b.hasNumbers) return a.hasNumbers ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  // Cap at 15 to keep the UI list manageable. The user can add more
  // by running Gemini if they want wider coverage.
  return prioritised.slice(0, 15).map(asPeer)
}

function resolvedSiteId(industryCode: string): string {
  const M: Record<string, string> = {
    '1': 'solar',
    '2': 'wind_energy',
    '3': 'ev_battery',
    '4': 'steel',
    '5': 'pharma',
    '6': 'chemicals',
    '7': 'semicon',
    '8': 'textiles',
    '9': 'fmcg',
    '10': 'infra',
    '11': 'defence',
    '12': 'it',
    '13': 'agri',
    '14': 'cement',
    '15': 'shipping',
  }
  return M[industryCode] || `industry_${industryCode}`
}

/**
 * Dedup across two peer candidate lists, keeping richer rows when there
 * are duplicates. The "primary" list (typically DB-verified peers) wins
 * on name + ticker; the "secondary" list (typically universe catalog)
 * only contributes rows not already present.
 */
function mergeCandidates(
  primary: PeerCandidate[],
  secondary: PeerCandidate[]
): PeerCandidate[] {
  const out: PeerCandidate[] = [...primary]
  const keys = new Set(primary.map(candidateKey))
  for (const c of secondary) {
    const k = candidateKey(c)
    if (keys.has(k)) continue
    keys.add(k)
    out.push(c)
  }
  return out
}

function candidateKey(c: PeerCandidate): string {
  return c.ticker && c.ticker.length > 0
    ? `t:${c.ticker.toUpperCase()}`
    : `n:${c.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`
}
