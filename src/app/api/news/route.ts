import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * Server-side Google News RSS fetcher.
 *
 *   GET /api/news                          → top stories (India)
 *   GET /api/news?q=solar+modules          → keyword search
 *   GET /api/news?topic=BUSINESS           → topic feed
 *   GET /api/news?q=polycab&limit=10       → limit results
 *   GET /api/news?q=...&fresh=1            → bypass the cache
 *
 * Responses are cached in memory for 5 minutes per upstream URL.
 * Requires a NextAuth session so anonymous visitors cannot burn quota.
 */

interface ParsedNewsItem {
  title: string
  link: string
  pubDate: string
  source: string
  description: string
  guid: string
}

// ─── tiny RSS parser (Google News format) ────────────────────────────

function stripCDATA(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim()
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function extract(tag: string, block: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = block.match(re)
  return m ? decodeEntities(stripCDATA(m[1])) : ''
}

function parseRSS(xml: string): ParsedNewsItem[] {
  const items: ParsedNewsItem[] = []
  const itemRe = /<item>([\s\S]*?)<\/item>/g
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml))) {
    const block = m[1]
    const rawDescription = extract('description', block)
    items.push({
      title: extract('title', block),
      link: extract('link', block),
      pubDate: extract('pubDate', block),
      source: extract('source', block),
      // Google News crams each article's description with aggregated
      // source links as HTML. Strip tags so we just have plain text.
      description: rawDescription.replace(/<[^>]+>/g, '').trim(),
      guid: extract('guid', block),
    })
  }
  return items
}

// ─── cache + route handler ────────────────────────────────────────────

const cache = new Map<string, { data: ParsedNewsItem[]; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

const ALLOWED_TOPICS = new Set([
  'WORLD',
  'NATION',
  'BUSINESS',
  'TECHNOLOGY',
  'SCIENCE',
  'HEALTH',
])

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }

  const url = new URL(req.url)
  const q = url.searchParams.get('q') || ''
  const topic = (url.searchParams.get('topic') || '').toUpperCase()
  const fresh = url.searchParams.get('fresh') === '1'
  const rawLimit = parseInt(url.searchParams.get('limit') || '30', 10)
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 30, 100))

  if (topic && !ALLOWED_TOPICS.has(topic)) {
    return NextResponse.json({ ok: false, error: 'Invalid topic' }, { status: 400 })
  }

  let upstreamUrl = ''
  if (q) {
    upstreamUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(
      q
    )}&hl=en-IN&gl=IN&ceid=IN:en`
  } else if (topic) {
    upstreamUrl = `https://news.google.com/rss/headlines/section/topic/${topic}?hl=en-IN&gl=IN&ceid=IN:en`
  } else {
    upstreamUrl = 'https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en'
  }

  const cacheKey = upstreamUrl
  if (!fresh) {
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({
        ok: true,
        data: cached.data.slice(0, limit),
        cached: true,
        total: cached.data.length,
      })
    }
  } else {
    cache.delete(cacheKey)
  }

  try {
    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        // Google News sometimes 403s without a UA
        'User-Agent': 'Mozilla/5.0 (compatible; DealNectorBot/1.0)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      ...(fresh
        ? { cache: 'no-store' as const }
        : { next: { revalidate: 300 } }),
    })

    if (!upstream.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `Upstream ${upstream.status}`,
          detail: (await upstream.text().catch(() => '')).slice(0, 200),
        },
        { status: upstream.status >= 500 ? 502 : upstream.status }
      )
    }

    const xml = await upstream.text()
    const parsed = parseRSS(xml)

    cache.set(cacheKey, { data: parsed, expiresAt: Date.now() + CACHE_TTL_MS })
    // LRU-ish cap
    if (cache.size > 100) {
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

    return NextResponse.json({
      ok: true,
      data: parsed.slice(0, limit),
      cached: false,
      total: parsed.length,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Network error contacting Google News',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    )
  }
}
