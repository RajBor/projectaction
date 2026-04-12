import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * Server-side proxy for the RapidAPI "Indian Stock Exchange" API.
 *
 *   GET /api/stocks?path=stock&name=infosys
 *   GET /api/stocks?path=historical_data&stock_name=infosys&period=1yr&filter=price
 *   GET /api/stocks?path=corporate_actions&stock_name=infosys
 *   GET /api/stocks?path=trending
 *   GET /api/stocks?path=fetch_52_week_high_low_data
 *
 * The RapidAPI host + key live ONLY on the server (see .env.local). The key
 * is never sent to the browser. Requires an authenticated NextAuth session
 * so unauthenticated visitors cannot burn our RapidAPI quota.
 */

// ── RapidAPI Quota Tracking ──
// Extracted from response headers on each successful call.
// Stored in module-level variable (lives as long as the server process).
export interface RapidAPIQuota {
  requestsLimit: number | null
  requestsRemaining: number | null
  requestsUsed: number | null
  lastUpdated: string
  totalCallsMade: number
}

export const rapidApiQuota: RapidAPIQuota = {
  requestsLimit: null,
  requestsRemaining: null,
  requestsUsed: null,
  lastUpdated: '',
  totalCallsMade: 0,
}

// Whitelist of allowed upstream endpoints — keep this tight so the proxy
// cannot be used as an open forwarder.
const ALLOWED_PATHS = new Set([
  'stock',
  'historical_data',
  'corporate_actions',
  'trending',
  'NSE_most_active',
  'BSE_most_active',
  'price_shockers',
  'fetch_52_week_high_low_data',
  'industry_search',
  'news',
  'ipo',
  'mutual_funds',
  'statement',
  'commodities',
  'stock_forecasts',
])

// Simple in-memory cache (per serverless instance). Keeps us within the
// RapidAPI rate limit when multiple users hit the same stock.
const cache = new Map<string, { data: unknown; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }

  const host = process.env.RAPIDAPI_INDIAN_STOCK_HOST
  const key = process.env.RAPIDAPI_INDIAN_STOCK_KEY
  if (!host || !key) {
    return NextResponse.json(
      { ok: false, error: 'RapidAPI credentials not configured on server' },
      { status: 500 }
    )
  }

  const url = new URL(req.url)
  const path = (url.searchParams.get('path') || '').trim()
  if (!path || !ALLOWED_PATHS.has(path)) {
    return NextResponse.json(
      { ok: false, error: `Invalid or disallowed path: ${path}` },
      { status: 400 }
    )
  }

  // Forward every query param except `path` and `fresh` to the upstream.
  const fresh = url.searchParams.get('fresh') === '1'
  const forwardParams = new URLSearchParams()
  url.searchParams.forEach((value, name) => {
    if (name !== 'path' && name !== 'fresh') forwardParams.set(name, value)
  })

  const cacheKey = `${path}?${forwardParams.toString()}`
  if (!fresh) {
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({ ok: true, data: cached.data, cached: true })
    }
  } else {
    cache.delete(cacheKey)
  }

  const upstreamUrl = `https://${host}/${path}${
    forwardParams.toString() ? `?${forwardParams}` : ''
  }`

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'x-rapidapi-host': host,
        'x-rapidapi-key': key,
        'Content-Type': 'application/json',
      },
      // Next.js fetch caching — belt & braces with our in-memory cache.
      // `fresh=1` forces a bypass of both caches.
      ...(fresh
        ? { cache: 'no-store' as const }
        : { next: { revalidate: 300 } }),
    })

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      // Detect the RapidAPI monthly-quota exhausted response so the
      // client can surface a dedicated banner instead of silent stale
      // data. The upstream returns HTTP 429 with a JSON body whose
      // message contains "exceeded the MONTHLY quota".
      const isQuota =
        upstream.status === 429 &&
        /exceeded.*quota/i.test(text)
      return NextResponse.json(
        {
          ok: false,
          error: isQuota
            ? 'RapidAPI monthly quota exhausted — upgrade plan to resume live data'
            : `Upstream ${upstream.status}`,
          status: upstream.status,
          quotaExhausted: isQuota || undefined,
          detail: text.slice(0, 500),
        },
        { status: upstream.status >= 500 ? 502 : upstream.status }
      )
    }

    // Track RapidAPI quota from response headers
    rapidApiQuota.totalCallsMade++
    rapidApiQuota.lastUpdated = new Date().toISOString()
    const limitH = upstream.headers.get('x-ratelimit-requests-limit')
    const remainH = upstream.headers.get('x-ratelimit-requests-remaining')
    if (limitH) rapidApiQuota.requestsLimit = parseInt(limitH, 10)
    if (remainH) rapidApiQuota.requestsRemaining = parseInt(remainH, 10)
    if (rapidApiQuota.requestsLimit !== null && rapidApiQuota.requestsRemaining !== null) {
      rapidApiQuota.requestsUsed = rapidApiQuota.requestsLimit - rapidApiQuota.requestsRemaining
    }

    const data = await upstream.json().catch(() => null)
    if (data === null) {
      return NextResponse.json(
        { ok: false, error: 'Upstream returned non-JSON' },
        { status: 502 }
      )
    }

    cache.set(cacheKey, { data, expiresAt: Date.now() + CACHE_TTL_MS })
    // Prevent unbounded cache growth — drop the oldest entry when over limit
    if (cache.size > 500) {
      let oldestKey: string | null = null
      let oldestExp = Infinity
      cache.forEach((entry, key) => {
        if (entry.expiresAt < oldestExp) {
          oldestExp = entry.expiresAt
          oldestKey = key
        }
      })
      if (oldestKey) cache.delete(oldestKey)
    }

    return NextResponse.json({ ok: true, data, cached: false })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Network error contacting upstream',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    )
  }
}
