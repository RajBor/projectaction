/**
 * Client-side watchlist helpers. Storage is shared with the Watch Board
 * (Kanban) on /watchlist via localStorage key `sg4_wl`.
 *
 * A watchlist item can be added from any page (M&A Radar, Valuation, Value
 * Chain, Private Targets) by calling addToWatchlist(). It's idempotent: if
 * the same ticker is added twice, the existing entry is kept.
 */

export type WLStatus =
  | 'Monitoring'
  | 'Active Diligence'
  | 'In Negotiation'
  | 'LOI Signed'
  | 'Paused'
  | 'Rejected'

export const WL_STATUSES: WLStatus[] = [
  'Monitoring',
  'Active Diligence',
  'In Negotiation',
  'LOI Signed',
  'Paused',
  'Rejected',
]

export interface WLItem {
  ticker: string
  name: string
  sec?: string
  acqs: number
  acqf?: string
  rev?: number
  ev?: number
  ev_eb?: number
  ebm?: number
  notes?: string
  targetEV?: string | number
  addedDate?: string
  status?: WLStatus
  /** Industry ID for filtering on the Watch Board (e.g. 'solar', 'td'). */
  industry?: string
}

export const WL_KEY = 'sg4_wl'
export const WL_EVENT = 'sg4:wl-change'

export function loadWatchlist(): WLItem[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(WL_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as WLItem[]) : []
  } catch {
    return []
  }
}

export function saveWatchlist(items: WLItem[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(WL_KEY, JSON.stringify(items))
    window.dispatchEvent(new CustomEvent(WL_EVENT, { detail: { items } }))
  } catch { /* ignore */ }
}

/**
 * Add a company to the watchlist. Returns true if newly added, false if it
 * was already present (no-op).
 */
export function addToWatchlist(item: WLItem): boolean {
  const existing = loadWatchlist()
  if (existing.some((x) => x.ticker === item.ticker)) return false
  const next: WLItem[] = [
    ...existing,
    {
      ...item,
      status: item.status || 'Monitoring',
      addedDate:
        item.addedDate ||
        new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
    },
  ]
  saveWatchlist(next)
  return true
}

export function isOnWatchlist(ticker: string): boolean {
  return loadWatchlist().some((x) => x.ticker === ticker)
}

export function removeFromWatchlist(ticker: string) {
  const next = loadWatchlist().filter((x) => x.ticker !== ticker)
  saveWatchlist(next)
}
