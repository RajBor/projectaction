/**
 * Client-side compare-queue helpers. Storage is shared across all pages
 * that offer a "+Cmp" quick-add button (Valuation Matrix, Stocks, etc.)
 * via localStorage key `sg4_compare`.
 *
 * The Compare page (/compare) reads from this key on mount and listens
 * for `sg4:compare-change` events so additions from other pages appear
 * instantly without a reload.
 *
 * Capacity: up to 4 tickers. Adding a 5th is a no-op.
 */

export const COMPARE_KEY = 'sg4_compare'
export const COMPARE_EVENT = 'sg4:compare-change'
export const COMPARE_MAX = 4

export function loadCompareList(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(COMPARE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as string[]) : []
  } catch {
    return []
  }
}

export function saveCompareList(tickers: string[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(COMPARE_KEY, JSON.stringify(tickers))
    window.dispatchEvent(new CustomEvent(COMPARE_EVENT, { detail: { tickers } }))
  } catch { /* ignore */ }
}

/**
 * Add a ticker to the compare queue. Returns:
 *   'added'     — ticker appended
 *   'duplicate' — ticker already in the list (no-op)
 *   'full'      — list is at COMPARE_MAX capacity (no-op)
 */
export function addToCompare(ticker: string): 'added' | 'duplicate' | 'full' {
  const list = loadCompareList()
  if (list.includes(ticker)) return 'duplicate'
  if (list.length >= COMPARE_MAX) return 'full'
  saveCompareList([...list, ticker])
  return 'added'
}

export function removeFromCompare(ticker: string): void {
  saveCompareList(loadCompareList().filter((t) => t !== ticker))
}

export function clearCompareList(): void {
  saveCompareList([])
}

export function isOnCompare(ticker: string): boolean {
  return loadCompareList().includes(ticker)
}
