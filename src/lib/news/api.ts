/**
 * Client-side helpers for the Google News RSS proxy.
 *
 * Every function calls our own `/api/news` route, which handles the
 * upstream fetch, RSS parsing, and caching server-side.
 */

import type { Company } from '@/lib/data/companies'
import { estimateNewsImpact, type NewsImpact } from './impact'

export interface NewsItem {
  title: string
  link: string
  pubDate: string
  source: string
  description: string
  guid: string
}

export interface NewsApiResponse {
  ok: boolean
  data?: NewsItem[]
  total?: number
  cached?: boolean
  error?: string
  detail?: string
}

export interface FetchNewsOpts {
  q?: string
  topic?:
    | 'WORLD'
    | 'NATION'
    | 'BUSINESS'
    | 'TECHNOLOGY'
    | 'SCIENCE'
    | 'HEALTH'
  limit?: number
  fresh?: boolean
  signal?: AbortSignal
}

export async function fetchNews(opts: FetchNewsOpts = {}): Promise<NewsApiResponse> {
  const qs = new URLSearchParams()
  if (opts.q) qs.set('q', opts.q)
  if (opts.topic) qs.set('topic', opts.topic)
  if (opts.limit) qs.set('limit', String(opts.limit))
  if (opts.fresh) qs.set('fresh', '1')
  try {
    const res = await fetch(`/api/news${qs.toString() ? `?${qs}` : ''}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: opts.signal,
    })
    const json = await res.json().catch(() => ({ ok: false, error: 'Bad JSON' }))
    return json as NewsApiResponse
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

// ─── Domain-specific query builders ──────────────────────────────────

/** News feed focused on the India solar + T&D M&A space. */
export const DOMAIN_QUERIES = {
  solar_value_chain: '(India solar) (module OR cell OR wafer OR polysilicon OR manufacturer OR PLI)',
  td_infrastructure: '(India) (power transformer OR transmission OR distribution OR smart meter OR RDSS)',
  ma_investment: '(India) (renewable energy OR solar OR power) (acquisition OR merger OR stake OR investment OR deal)',
  policy_regulation: '(India) (MNRE OR SECI OR PLI OR ALMM OR RDSS OR Basic Customs Duty OR "Green Energy Corridor")',
  market_trends: '(India) (solar tariff OR renewable) (outlook OR forecast OR demand)',
  financial_results: '(India) (solar OR transformer OR cable OR power) (results OR earnings OR profit OR revenue)',
  supply_chain: '(India) (solar OR module OR wafer OR polysilicon) (import OR export OR duty OR dumping OR shortage)',
} as const

export type DomainCategoryId = keyof typeof DOMAIN_QUERIES

export const DOMAIN_CATEGORIES: Array<{
  id: DomainCategoryId
  label: string
  short: string
  icon: string
}> = [
  { id: 'solar_value_chain', label: 'Solar Value Chain', short: 'Solar', icon: '☀' },
  { id: 'td_infrastructure', label: 'T&D Infrastructure', short: 'T&D', icon: '⚡' },
  { id: 'ma_investment', label: 'M&A & Investment', short: 'M&A', icon: '◈' },
  { id: 'policy_regulation', label: 'Policy & Regulation', short: 'Policy', icon: '⚖' },
  { id: 'market_trends', label: 'Market Trends', short: 'Market', icon: '📈' },
  { id: 'financial_results', label: 'Financial Results', short: 'Results', icon: '₹' },
  { id: 'supply_chain', label: 'Supply Chain', short: 'Supply', icon: '⚙' },
]

/** Search string that finds news for a specific tracked company. */
export function companyQuery(co: Company): string {
  const primary = co.name.split(' ').slice(0, 2).join(' ')
  return `"${primary}" (solar OR power OR transformer OR cable OR inverter OR module)`
}

// ─── Decorate + filter helpers ───────────────────────────────────────

/**
 * Attach impact metadata to every news item. Items that look entirely
 * off-topic (no sentiment, no company, no segment, no industry) can be
 * filtered by the caller using `filterRelevant`.
 */
export function decorateNews(
  items: NewsItem[],
  companies: Company[]
): Array<{ item: NewsItem; impact: NewsImpact }> {
  return items.map((item) => ({ item, impact: estimateNewsImpact(item, companies) }))
}

export function filterRelevant(
  decorated: Array<{ item: NewsItem; impact: NewsImpact }>
): Array<{ item: NewsItem; impact: NewsImpact }> {
  return decorated.filter(
    ({ impact }) =>
      impact.affectedCompanies.length > 0 ||
      impact.affectedChainSegments.length > 0 ||
      impact.affectedIndustries.length > 0 ||
      impact.isPolicy
  )
}

/** Sort by recency (pubDate desc). */
export function sortByDate(
  decorated: Array<{ item: NewsItem; impact: NewsImpact }>
): Array<{ item: NewsItem; impact: NewsImpact }> {
  return [...decorated].sort((a, b) =>
    (b.item.pubDate || '').localeCompare(a.item.pubDate || '')
  )
}

/** Dedupe by URL, keeping the first occurrence. */
export function dedupe<T extends { item: NewsItem }>(list: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const entry of list) {
    const key = entry.item.link || entry.item.guid || entry.item.title
    if (!seen.has(key)) {
      seen.add(key)
      out.push(entry)
    }
  }
  return out
}

/** Pretty relative date — "2h ago", "1d ago". */
export function relativeDate(pubDate: string): string {
  if (!pubDate) return ''
  const d = new Date(pubDate)
  if (!Number.isFinite(d.getTime())) return ''
  const diffMs = Date.now() - d.getTime()
  const min = Math.floor(diffMs / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hrs = Math.floor(min / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
