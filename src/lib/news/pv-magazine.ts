/**
 * Client-side helper for the PV Magazine RSS proxy.
 *
 * Calls /api/news/pv-magazine, which fetches both the global feed
 * (pv-magazine.com) and the India feed (pv-magazine-india.com),
 * merges + dedupes + sorts latest-first, and caches for 10 minutes.
 */

import type { NewsItem } from './api'

export type PvRegion = 'all' | 'india' | 'global'

export interface PvNewsItem extends NewsItem {
  /** 'india' when from pv-magazine-india.com, 'global' otherwise. */
  region: 'india' | 'global'
  /** WordPress categories attached to the post. */
  categories: string[]
  /** Author where available. */
  creator?: string
}

export interface PvNewsApiResponse {
  ok: boolean
  data?: PvNewsItem[]
  total?: number
  cached?: boolean
  region?: PvRegion
  error?: string
  detail?: string
  partialErrors?: string[]
}

export interface FetchPvOpts {
  region?: PvRegion
  limit?: number
  fresh?: boolean
  signal?: AbortSignal
}

export async function fetchPvMagazine(
  opts: FetchPvOpts = {}
): Promise<PvNewsApiResponse> {
  const qs = new URLSearchParams()
  if (opts.region) qs.set('region', opts.region)
  if (opts.limit) qs.set('limit', String(opts.limit))
  if (opts.fresh) qs.set('fresh', '1')
  try {
    const res = await fetch(
      `/api/news/pv-magazine${qs.toString() ? `?${qs}` : ''}`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: opts.signal,
      }
    )
    const json = await res.json().catch(() => ({ ok: false, error: 'Bad JSON' }))
    return json as PvNewsApiResponse
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { ok: false, error: 'Cancelled' }
    }
    return {
      ok: false,
      error: 'Network error',
      detail: err instanceof Error ? err.message : String(err),
    }
  }
}

export const PV_REGIONS: Array<{ id: PvRegion; label: string; icon: string }> = [
  { id: 'all', label: 'All PV news', icon: '🌐' },
  { id: 'india', label: 'India', icon: '🇮🇳' },
  { id: 'global', label: 'Global', icon: '🌍' },
]
