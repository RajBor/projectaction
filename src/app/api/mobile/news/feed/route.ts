import { NextResponse } from 'next/server'
import { NEWS_CHANNELS, NEWS_CHANNEL_BY_ID, type NewsFlipCard, type NewsChannel } from '@/lib/news/channels'

/**
 * Mobile news feed — unifies the Google News RSS per-channel queries
 * into a single flat flip-card schema that the Expo/React Native app
 * can render directly.
 *
 *   GET /api/mobile/news/feed
 *   GET /api/mobile/news/feed?channels=solar,td,ma
 *   GET /api/mobile/news/feed?channels=solar&limit=40
 *   GET /api/mobile/news/feed?channels=solar&fresh=1
 *
 * Access: an optional `DEALNECTOR_MOBILE_API_KEY` env var gates the
 * endpoint when set (client sends `?key=...` or `x-dn-key` header).
 * Unset = open access, same trust level as the public RSS feeds
 * we proxy. Either way, rate limiting remains the in-memory cache.
 *
 * Caching: 5-minute in-memory per channel upstream URL, shared across
 * requests. Fresh=1 bypasses + repopulates.
 */

const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map<string, { items: RawItem[]; expiresAt: number }>()

interface RawItem {
  title: string
  link: string
  pubDate: string
  source: string
  description: string
  guid: string
}

// ─── RSS parsing (self-contained to avoid auth coupling) ──────────

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

function parseRSS(xml: string): RawItem[] {
  const items: RawItem[] = []
  const itemRe = /<item>([\s\S]*?)<\/item>/g
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(xml))) {
    const block = m[1]
    items.push({
      title: extract('title', block),
      link: extract('link', block),
      pubDate: extract('pubDate', block),
      source: extract('source', block),
      description: extract('description', block).replace(/<[^>]+>/g, '').trim(),
      guid: extract('guid', block),
    })
  }
  return items
}

async function fetchChannel(channel: NewsChannel, fresh: boolean): Promise<RawItem[]> {
  const upstream = `https://news.google.com/rss/search?q=${encodeURIComponent(
    channel.query,
  )}&hl=en-IN&gl=IN&ceid=IN:en`
  if (!fresh) {
    const hit = cache.get(upstream)
    if (hit && hit.expiresAt > Date.now()) return hit.items
  }
  try {
    const res = await fetch(upstream, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DealNectorMobile/1.0)',
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
      },
      ...(fresh ? { cache: 'no-store' as const } : { next: { revalidate: 300 } }),
    })
    if (!res.ok) return []
    const xml = await res.text()
    const items = parseRSS(xml)
    cache.set(upstream, { items, expiresAt: Date.now() + CACHE_TTL_MS })
    return items
  } catch {
    return []
  }
}

// ─── Schema shaping ───────────────────────────────────────────────

function summarise(description: string, max = 280): string {
  // Google News description bundles multi-publisher links + snippets.
  // Take the first sentence-like chunk then cap by length.
  const cleaned = description.replace(/\s+/g, ' ').trim()
  if (cleaned.length <= max) return cleaned
  const slice = cleaned.slice(0, max)
  const lastStop = Math.max(slice.lastIndexOf('.'), slice.lastIndexOf('!'), slice.lastIndexOf('?'))
  if (lastStop > max * 0.6) return slice.slice(0, lastStop + 1).trim()
  return slice.trim() + '…'
}

function cardIdFor(item: RawItem): string {
  if (item.guid) return item.guid
  try {
    return new URL(item.link).hostname + '|' + item.link.slice(0, 200)
  } catch {
    return item.link.slice(0, 200)
  }
}

function shapeCard(item: RawItem, channelIds: string[]): NewsFlipCard {
  // Google News titles come as "Headline — Publisher Name"; split off.
  const title = item.title.replace(/\s+-\s+[^-]*$/, '').trim()
  const sourceFromTitle = (item.title.match(/\s+-\s+([^-]+)$/) || [])[1]?.trim()
  const source = (item.source || sourceFromTitle || 'Google News').trim()
  let publishedAt = new Date().toISOString()
  if (item.pubDate) {
    const d = new Date(item.pubDate)
    if (!isNaN(d.getTime())) publishedAt = d.toISOString()
  }
  return {
    id: cardIdFor(item),
    title,
    summary: summarise(item.description || title),
    source,
    sourceUrl: item.link,
    publishedAt,
    channels: channelIds,
  }
}

// ─── Handler ──────────────────────────────────────────────────────

export async function GET(req: Request) {
  const expectedKey = process.env.DEALNECTOR_MOBILE_API_KEY
  if (expectedKey) {
    const url = new URL(req.url)
    const given = url.searchParams.get('key') || req.headers.get('x-dn-key') || ''
    if (given !== expectedKey) {
      return NextResponse.json({ ok: false, error: 'Invalid or missing API key' }, { status: 401 })
    }
  }

  const url = new URL(req.url)
  const channelsParam = (url.searchParams.get('channels') || '').trim()
  const limit = Math.max(1, Math.min(200, parseInt(url.searchParams.get('limit') || '60', 10) || 60))
  const fresh = url.searchParams.get('fresh') === '1'

  // If no channels requested, default to the full catalogue.
  const requestedIds = channelsParam
    ? channelsParam.split(',').map((s) => s.trim()).filter(Boolean)
    : NEWS_CHANNELS.map((c) => c.id)

  const requestedChannels = requestedIds
    .map((id) => NEWS_CHANNEL_BY_ID[id])
    .filter((c): c is NewsChannel => !!c)

  if (requestedChannels.length === 0) {
    return NextResponse.json(
      { ok: false, error: 'No valid channels supplied', validChannels: NEWS_CHANNELS.map((c) => c.id) },
      { status: 400 },
    )
  }

  // Fan out in parallel — per-channel cache keeps this cheap.
  const perChannel = await Promise.all(
    requestedChannels.map(async (c) => ({ channel: c, items: await fetchChannel(c, fresh) })),
  )

  // Merge + dedupe by cardId. If the same article appeared in multiple
  // channels, union the channel ids so the mobile UI can show all
  // matching chips on the card back.
  const merged = new Map<string, NewsFlipCard>()
  for (const { channel, items } of perChannel) {
    for (const item of items) {
      const card = shapeCard(item, [channel.id])
      const existing = merged.get(card.id)
      if (existing) {
        // Prefer the longer summary + earlier publishedAt if RSS sources disagree.
        if (card.summary.length > existing.summary.length) existing.summary = card.summary
        if (!existing.channels.includes(channel.id)) existing.channels.push(channel.id)
      } else {
        merged.set(card.id, card)
      }
    }
  }

  const cards = Array.from(merged.values())
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit)

  return NextResponse.json({
    ok: true,
    fetchedAt: new Date().toISOString(),
    count: cards.length,
    channels: requestedChannels.map((c) => ({ id: c.id, label: c.label, color: c.color })),
    data: cards,
  })
}

/** Lightweight channel catalogue — mobile app calls this on first launch
 *  to populate the industry picker without hardcoding the list. */
export async function OPTIONS() {
  return NextResponse.json({
    ok: true,
    channels: NEWS_CHANNELS.map((c) => ({
      id: c.id,
      label: c.label,
      tagline: c.tagline,
      color: c.color,
    })),
  })
}
