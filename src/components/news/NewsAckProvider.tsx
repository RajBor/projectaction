'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { NewsItem } from '@/lib/news/api'
import type { ValuationParam } from '@/lib/news/params'

/**
 * Per-item news acknowledgment context.
 *
 * By default, news items are displayed as *signals* only — they do NOT
 * affect downstream estimations. A user must explicitly click
 * "Acknowledge" on a specific item for its impact to be applied.
 *
 * Each acknowledged item can also carry a set of *manual overrides* —
 * signed percentage adjustments per valuation parameter (e.g.
 * `management: -25` to override the automated management-score impact
 * with a -25% view). When a manual override is present it takes
 * precedence over the auto-derived value. When blank, the automated
 * estimate applies.
 *
 * Persistence key: `sg4_news_ack`. Storage shape migrated once from
 * the old `Record<string, true>` format to:
 *
 *   Record<itemKey, { manual?: Partial<Record<ValuationParam, number>> }>
 *
 * A key existing in the record = acknowledged. Deleting the key
 * un-acknowledges the item.
 */

const STORAGE_KEY = 'sg4_news_ack'

export interface AckEntry {
  /** Signed % manual overrides per parameter (blank = use auto degree). */
  manual?: Partial<Record<ValuationParam, number>>
  /** Parameters the user has explicitly switched OFF for this item —
   *  their auto degree is ignored and they do not contribute to the
   *  aggregate even if auto-detected. */
  disabled?: ValuationParam[]
}

interface NewsAckContextShape {
  isAcknowledged: (itemKey: string) => boolean
  acknowledge: (itemKey: string) => void
  unacknowledge: (itemKey: string) => void
  toggle: (itemKey: string) => void
  acknowledged: Record<string, AckEntry>
  count: number
  clearAll: () => void
  /**
   * Set (or clear) a manual per-parameter override. Passing `null`
   * removes the override so the auto-degree takes over. Setting a
   * manual value on an un-acked item does NOT auto-acknowledge.
   */
  setManualOverride: (
    itemKey: string,
    param: ValuationParam,
    value: number | null
  ) => void
  /** Return the manual override for an (item, param) pair, or null. */
  getManualOverride: (itemKey: string, param: ValuationParam) => number | null
  /** True when the user has disabled a specific parameter for the item. */
  isParamDisabled: (itemKey: string, param: ValuationParam) => boolean
  /** Toggle or set a parameter as disabled. */
  setParamDisabled: (
    itemKey: string,
    param: ValuationParam,
    disabled: boolean
  ) => void
  /** Clear ALL overrides (manual + disabled) for one item but keep its
   *  ack state as-is. Used by the "Reset" button in the impact modal. */
  resetOverrides: (itemKey: string) => void
  /** Return the full ack entry for direct reads in UI (read-only). */
  getEntry: (itemKey: string) => AckEntry | null
}

const NewsAckContext = createContext<NewsAckContextShape | null>(null)

/** Canonical key for a news item — prefers `link`, then `guid`, then title. */
export function newsItemKey(item: NewsItem): string {
  return item.link || item.guid || item.title
}

/** Migrate the legacy `Record<string, true>` shape to the new AckEntry shape. */
function normalizeLoaded(raw: unknown): Record<string, AckEntry> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, AckEntry> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === true) {
      out[k] = {}
    } else if (v && typeof v === 'object') {
      const entry = v as AckEntry
      const copied: AckEntry = {}
      if (
        entry.manual &&
        typeof entry.manual === 'object' &&
        !Array.isArray(entry.manual)
      ) {
        copied.manual = { ...entry.manual }
      }
      if (Array.isArray(entry.disabled)) {
        copied.disabled = entry.disabled.filter((p) => typeof p === 'string') as ValuationParam[]
      }
      out[k] = copied
    }
  }
  return out
}

/** Shallow-dedupe + drop empty keys so serialization stays compact. */
function pruneEntry(entry: AckEntry): AckEntry {
  const out: AckEntry = {}
  if (entry.manual && Object.keys(entry.manual).length > 0) {
    out.manual = entry.manual
  }
  if (entry.disabled && entry.disabled.length > 0) {
    out.disabled = Array.from(new Set(entry.disabled))
  }
  return out
}

export function NewsAckProvider({ children }: { children: React.ReactNode }) {
  const [acknowledged, setAcknowledged] = useState<Record<string, AckEntry>>({})

  // Hydrate from localStorage once on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        setAcknowledged(normalizeLoaded(parsed))
      }
    } catch {
      // corrupt value — ignore
    }
  }, [])

  // Persist on every change
  useEffect(() => {
    try {
      if (Object.keys(acknowledged).length === 0) {
        localStorage.removeItem(STORAGE_KEY)
      } else {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(acknowledged))
      }
    } catch {
      // storage full / disabled — ignore
    }
  }, [acknowledged])

  const isAcknowledged = useCallback(
    (key: string) => Object.prototype.hasOwnProperty.call(acknowledged, key),
    [acknowledged]
  )

  const acknowledge = useCallback((key: string) => {
    setAcknowledged((prev) => (prev[key] ? prev : { ...prev, [key]: {} }))
  }, [])

  const unacknowledge = useCallback((key: string) => {
    setAcknowledged((prev) => {
      if (!prev[key]) return prev
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const toggle = useCallback((key: string) => {
    setAcknowledged((prev) => {
      if (prev[key]) {
        const next = { ...prev }
        delete next[key]
        return next
      }
      return { ...prev, [key]: {} }
    })
  }, [])

  const clearAll = useCallback(() => setAcknowledged({}), [])

  const setManualOverride = useCallback(
    (key: string, param: ValuationParam, value: number | null) => {
      setAcknowledged((prev) => {
        const entry = prev[key]
        // Setting a value on an un-acked item doesn't auto-ack, but we
        // DO store the manual value so it's ready when the user acks.
        const manual = { ...(entry?.manual || {}) }
        if (value == null || Number.isNaN(value)) {
          delete manual[param]
        } else {
          // Clamp to -100..+100 and round to 1 decimal
          const clamped = Math.max(-100, Math.min(100, value))
          manual[param] = Math.round(clamped * 10) / 10
        }
        const nextEntry: AckEntry = {}
        if (Object.keys(manual).length > 0) nextEntry.manual = manual
        // If the item is already acked, update it. If not, store the
        // entry anyway — but keep it un-acked by deleting it. Manual
        // overrides on un-acked items have no downstream effect, so
        // we only preserve them if the item is acked. Otherwise we'd
        // leak storage.
        if (entry) {
          return { ...prev, [key]: nextEntry }
        }
        // Un-acked: discard the override (nothing to store)
        return prev
      })
    },
    []
  )

  const getManualOverride = useCallback(
    (key: string, param: ValuationParam): number | null => {
      const entry = acknowledged[key]
      if (!entry || !entry.manual) return null
      const v = entry.manual[param]
      return typeof v === 'number' ? v : null
    },
    [acknowledged]
  )

  const isParamDisabled = useCallback(
    (key: string, param: ValuationParam): boolean => {
      const entry = acknowledged[key]
      if (!entry || !entry.disabled) return false
      return entry.disabled.includes(param)
    },
    [acknowledged]
  )

  const setParamDisabled = useCallback(
    (key: string, param: ValuationParam, disabled: boolean) => {
      setAcknowledged((prev) => {
        const entry = prev[key]
        if (!entry) {
          // Setting on an un-acked item is a no-op — the disabled list
          // only has meaning for acked items.
          return prev
        }
        const current = new Set(entry.disabled || [])
        if (disabled) {
          current.add(param)
        } else {
          current.delete(param)
        }
        const next = pruneEntry({
          manual: entry.manual,
          disabled: Array.from(current),
        })
        return { ...prev, [key]: next }
      })
    },
    []
  )

  const resetOverrides = useCallback((key: string) => {
    setAcknowledged((prev) => {
      const entry = prev[key]
      if (!entry) return prev
      // Keep the ack flag (empty object) but drop manual + disabled.
      return { ...prev, [key]: {} }
    })
  }, [])

  const getEntry = useCallback(
    (key: string): AckEntry | null => acknowledged[key] ?? null,
    [acknowledged]
  )

  const value = useMemo<NewsAckContextShape>(
    () => ({
      isAcknowledged,
      acknowledge,
      unacknowledge,
      toggle,
      acknowledged,
      clearAll,
      count: Object.keys(acknowledged).length,
      setManualOverride,
      getManualOverride,
      isParamDisabled,
      setParamDisabled,
      resetOverrides,
      getEntry,
    }),
    [
      isAcknowledged,
      acknowledge,
      unacknowledge,
      toggle,
      acknowledged,
      clearAll,
      setManualOverride,
      getManualOverride,
      isParamDisabled,
      setParamDisabled,
      resetOverrides,
      getEntry,
    ]
  )

  return <NewsAckContext.Provider value={value}>{children}</NewsAckContext.Provider>
}

export function useNewsAck(): NewsAckContextShape {
  const ctx = useContext(NewsAckContext)
  if (!ctx) {
    throw new Error('useNewsAck must be used inside <NewsAckProvider>')
  }
  return ctx
}
