'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { IndexTick } from '@/app/api/data/nse-indices/route'

/**
 * Hourly-refreshed NSE market indices for the left sidebar.
 *
 * Mirrors the Tier 1 auto-refresh pattern used by LiveSnapshotProvider:
 *   - Hydrate from localStorage on mount (offline-first)
 *   - Fetch immediately if cache is older than REFRESH_MS
 *   - setInterval every REFRESH_MS (1 hour)
 *
 * The underlying `/api/data/nse-indices` route is auth-gated; if the
 * user is not signed in we fall back to whatever we cached previously
 * (or an empty list on first load).
 */

const KEY_INDICES = 'sg4_indices_cache'
const KEY_INDICES_TIME = 'sg4_indices_time'
const REFRESH_MS = 60 * 60 * 1000 // 1 hour

function loadCache(): { indices: IndexTick[]; at: Date | null } {
  if (typeof window === 'undefined') return { indices: [], at: null }
  try {
    const raw = window.localStorage.getItem(KEY_INDICES)
    const rawTime = window.localStorage.getItem(KEY_INDICES_TIME)
    const indices = raw ? (JSON.parse(raw) as IndexTick[]) : []
    const at = rawTime ? new Date(rawTime) : null
    return { indices, at }
  } catch {
    return { indices: [], at: null }
  }
}

function saveCache(indices: IndexTick[], at: Date) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY_INDICES, JSON.stringify(indices))
    window.localStorage.setItem(KEY_INDICES_TIME, at.toISOString())
  } catch { /* storage full → ignore */ }
}

export function useLiveIndices() {
  const [state, setState] = useState<{
    indices: IndexTick[]
    lastRefreshed: Date | null
    refreshing: boolean
  }>(() => {
    const { indices, at } = loadCache()
    return { indices, lastRefreshed: at, refreshing: false }
  })
  const fetchingRef = useRef(false)

  const fetchIndices = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setState((s) => ({ ...s, refreshing: true }))
    try {
      const res = await fetch('/api/data/nse-indices', {
        method: 'GET',
        credentials: 'same-origin',
      })
      const json = await res.json().catch(() => null)
      if (json?.ok && Array.isArray(json.indices) && json.indices.length > 0) {
        const now = new Date()
        saveCache(json.indices, now)
        setState({ indices: json.indices, lastRefreshed: now, refreshing: false })
        return
      }
      setState((s) => ({ ...s, refreshing: false }))
    } catch {
      setState((s) => ({ ...s, refreshing: false }))
    } finally {
      fetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    const stale =
      !state.lastRefreshed ||
      Date.now() - state.lastRefreshed.getTime() > REFRESH_MS
    if (stale) fetchIndices()
    const id = setInterval(fetchIndices, REFRESH_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { ...state, refresh: fetchIndices }
}
