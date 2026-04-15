import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * Server-side PV Magazine RSS fetcher.
 *
 *   GET /api/news/pv-magazine                       → global + India, merged
 *   GET /api/news/pv-magazine?region=india          → India edition only
 *   GET /api/news/pv-magazine?region=global         → global edition only
 *   GET /api/news/pv-magazine?region=all            → both (default)
 *   GET /api/news/pv-magazine?limit=40              → cap items
 *   GET /api/news/pv-magazine?fresh=1               → bypass cache
 *
 * Responses are cached in memory for 10 minutes per region key.
 * Requires a NextAuth session so anonymous visitors cannot burn quota.
 *
 * PV Magazine runs two separate WordPress properties:
 *   • pv-magazine.com         — global edition, one feed at /feed/
 *   • pv-magazine-india.com   — India edition, one feed at /feed/
 *
 * Both expose standard RSS 2.0 with item > title, link, pubDate,
 * description, content:encoded, dc:creator, and category tags. We
 * normalise them to the same NewsItem shape as /api/news (Google News
 * RSS proxy) so the existing NewsCard component renders them without
 * any changes.
 */

interface ParsedNewsItem {
  title: string
  link: string
  pubDate: string // ISO 8601 so client can sort
  source: string
  description: string
  guid: string
  region: 'india' | 'global'
  categories: string[]
  creator?: string
}

// ─── tiny RSS 2.0 parser (WordPress dialect) ─────────────────────────

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
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8217;/g, '’')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&nbsp;/g, ' ')
}

function extract(tag: string, block: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i')
  const m = block.match(re)
  return m ? decodeEntities(stripCDATA(m[1])) : ''
}

function extractAll(tag: string, block: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi')
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(block))) {
    const val = decodeEntities(stripCDATA(m[1])).trim()
    if (val) out.push(val)
  }
  return out
}

function normalizePubDate(raw: string): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isFinite(d.getTime())) return d.toISOString()
  return raw
}

function parseWordPressRSS(
  xml: string,
  region: 'india' | 'global',
  fallbackSource: string
): ParsedNewsItem[] {
  const items: ParsedNewsItem[] = []
  const itemRe = /<item>([\s\S]*?)<\/item>/g
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml))) {
    const block = m[1]
    const title = extract('title', block)
    const link = extract('link', block)
    const pubDate = normalizePubDate(extract('pubDate', block))
    // Prefer the richer content:encoded when present, fall back to the
    // shorter <description> summary. Then strip HTML tags for plain text.
    const rawContent =
      extract('content:encoded', block) || extract('description', block)
    const description = rawContent
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 600)
    const guid = extract('guid', block) || link
    const creator = extract('dc:creator', block) || undefined
    const categories = extractAll('category', block)

    if (!title || !link) continue

    items.push({
      title,
      link,
      pubDate,
      source: fallbackSource,
      description,
      guid,
      region,
      categories,
      creator,
    })
  }
  return items
}

// ─── cache + fetcher ─────────────────────────────────────────────────

type Region = 'all' | 'india' | 'global'

interface CacheEntry {
  data: ParsedNewsItem[]
  expiresAt: number
}

const cache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 10 * 60 * 1000

const FEEDS: Record<Exclude<Region, 'all'>, { url: string; source: string }> = {
  global: {
    url: 'https://www.pv-magazine.com/feed/',
    source: 'PV Magazine',
  },
  india: {
    url: 'https://www.pv-magazine-india.com/feed/',
    source: 'PV Magazine India',
  },
}

async function fetchFeed(
  region: 'india' | 'global',
  fresh: boolean
): Promise<ParsedNewsItem[]> {
  const { url, source } = FEEDS[region]
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DealNectorBot/1.0; +https://dealnector.com/bot)',
      Accept: 'application/rss+xml, application/xml, text/xml, */*',
    },
    ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: 600 } }),
  })
  if (!res.ok) {
    throw new Error(`Upstream ${region} ${res.status}`)
  }
  const xml = await res.text()
  return parseWordPressRSS(xml, region, source)
}

// Dedupe by canonical link, keeping the one with the later pubDate.
function dedupe(list: ParsedNewsItem[]): ParsedNewsItem[] {
  const byKey = new Map<string, ParsedNewsItem>()
  for (const it of list) {
    const key = (it.link || it.guid || it.title).replace(/\/$/, '')
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, it)
    } else {
      // Keep the one with the newer pubDate
      if ((it.pubDate || '') > (existing.pubDate || '')) {
        byKey.set(key, it)
      }
    }
  }
  return Array.from(byKey.values())
}

function sortByDateDesc(list: ParsedNewsItem[]): ParsedNewsItem[] {
  // RSS pubDate is RFC-2822 ("Wed, 15 Apr 2026 10:00:00 GMT"), which
  // does NOT sort correctly via localeCompare — "Fri" > "Wed" alphabetically
  // puts older Friday items above newer Wednesday items. Parse to epoch
  // millis so chronological ordering is correct. Invalid dates fall to 0
  // (i.e. bottom of the list).
  const toMs = (s: string | undefined): number => {
    if (!s) return 0
    const t = Date.parse(s)
    return Number.isFinite(t) ? t : 0
  }
  return [...list].sort((a, b) => toMs(b.pubDate) - toMs(a.pubDate))
}

// ─── route handler ───────────────────────────────────────────────────

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }

  const url = new URL(req.url)
  const regionRaw = (url.searchParams.get('region') || 'all').toLowerCase()
  const region: Region =
    regionRaw === 'india' || regionRaw === 'global' ? (regionRaw as Region) : 'all'
  const fresh = url.searchParams.get('fresh') === '1'
  const rawLimit = parseInt(url.searchParams.get('limit') || '40', 10)
  const limit = Math.max(1, Math.min(Number.isFinite(rawLimit) ? rawLimit : 40, 100))

  const cacheKey = `pv:${region}`
  if (!fresh) {
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return NextResponse.json({
        ok: true,
        data: cached.data.slice(0, limit),
        cached: true,
        total: cached.data.length,
        region,
      })
    }
  } else {
    cache.delete(cacheKey)
  }

  try {
    const feedsToFetch: Array<Exclude<Region, 'all'>> =
      region === 'all' ? ['india', 'global'] : [region]

    // Parallel fetch — if one side fails, still return what we got from the
    // other. This mirrors how resilient news aggregators behave.
    const results = await Promise.allSettled(
      feedsToFetch.map((r) => fetchFeed(r, fresh))
    )

    const combined: ParsedNewsItem[] = []
    const errors: string[] = []
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        combined.push(...r.value)
      } else {
        errors.push(`${feedsToFetch[idx]}: ${r.reason?.message || r.reason}`)
      }
    })

    if (combined.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: 'All PV Magazine feeds failed',
          detail: errors.join(' · '),
        },
        { status: 502 }
      )
    }

    const normalized = sortByDateDesc(dedupe(combined))

    cache.set(cacheKey, {
      data: normalized,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })

    // LRU-ish cap
    if (cache.size > 20) {
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
      data: normalized.slice(0, limit),
      cached: false,
      total: normalized.length,
      region,
      partialErrors: errors.length ? errors : undefined,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Network error contacting PV Magazine',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    )
  }
}
