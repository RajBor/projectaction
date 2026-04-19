/**
 * DealNector API client — thin typed wrapper around the Next.js
 * /api/mobile/news/feed endpoint.
 */

export interface NewsChannelMeta {
  id: string
  label: string
  tagline?: string
  color: string
}

export interface NewsFlipCard {
  id: string
  title: string
  summary: string
  source: string
  sourceUrl: string
  publishedAt: string
  channels: string[]
  imageUrl?: string
}

export interface FeedResponse {
  ok: boolean
  error?: string
  fetchedAt?: string
  count?: number
  channels?: NewsChannelMeta[]
  data?: NewsFlipCard[]
}

export interface CatalogueResponse {
  ok: boolean
  channels?: NewsChannelMeta[]
}

function buildUrl(apiBase: string, path: string, params: Record<string, string> = {}): string {
  const base = apiBase.replace(/\/$/, '')
  const qs = new URLSearchParams(params).toString()
  return `${base}${path}${qs ? '?' + qs : ''}`
}

export async function fetchCatalogue(apiBase: string, apiKey: string): Promise<NewsChannelMeta[]> {
  const url = buildUrl(apiBase, '/api/mobile/news/feed')
  const res = await fetch(url, {
    method: 'OPTIONS',
    headers: apiKey ? { 'x-dn-key': apiKey } : {},
  })
  const json = (await res.json()) as CatalogueResponse
  if (!json.ok || !json.channels) throw new Error('Catalogue fetch failed')
  return json.channels
}

export async function fetchFeed(
  apiBase: string,
  apiKey: string,
  channels: string[],
  opts: { limit?: number; fresh?: boolean } = {},
): Promise<FeedResponse> {
  const params: Record<string, string> = {
    channels: channels.join(','),
    limit: String(opts.limit ?? 60),
  }
  if (opts.fresh) params.fresh = '1'
  if (apiKey) params.key = apiKey
  const url = buildUrl(apiBase, '/api/mobile/news/feed', params)
  const res = await fetch(url, {
    headers: apiKey ? { 'x-dn-key': apiKey } : {},
  })
  const json = (await res.json()) as FeedResponse
  return json
}
