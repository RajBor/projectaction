'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import type { IndustryRow } from '@/app/api/industries/route'

/**
 * Industry filter hook — shared across all dashboard pages.
 *
 * Behaviour depends on the signed-in user's role:
 *
 *   admin / subadmin
 *     - Default to ALL registered industries
 *     - No max cap on selection
 *     - Changes persist only in localStorage (they are per-session filters,
 *       not user-specific preferences)
 *
 *   analyst (or unauthenticated)
 *     - Default to whatever is persisted on the user record
 *       (populated via the first-login picker modal)
 *     - Hard max of 5 industries
 *     - Changes still hit localStorage for responsiveness; the DB copy is
 *       only updated through the first-login picker / settings flow.
 *
 * Events:
 *   localStorage key `sg4_industries` — active selection (string[])
 *   window event `sg4:industry-change` — dispatched on every change
 */

const STORAGE_KEY = 'sg4_industries'
const AVAILABLE_KEY = 'sg4_industries_available'
const EVENT_NAME = 'sg4:industry-change'
/**
 * Dispatched by POST/DELETE handlers for /api/industries when the admin
 * adds or removes an industry. Every mounted filter hook listens for this
 * and refetches the registry, so a new industry (or a renamed one) shows
 * up instantly in the sidebar multi-select / dashboard "Customize" menu
 * without needing a full page reload.
 */
const REGISTRY_EVENT = 'sg4:industries-registry-change'
const FALLBACK_IDS = ['solar', 'wind', 'td']
const ANALYST_MAX = 5

export interface IndustryFilterShape {
  /** Currently selected industry IDs */
  selectedIndustries: string[]
  /** All industries available to pick (from the DB registry) */
  availableIndustries: IndustryRow[]
  /** Check if a sector is currently selected */
  isSelected: (sec: string) => boolean
  /** Update selected industries (also persists + dispatches event) */
  setIndustries: (ids: string[]) => void
  /** Toggle a single industry on/off */
  toggleIndustry: (id: string) => void
  /** Max industries allowed for the current user (admin = Infinity) */
  maxIndustries: number
  /** True while the DB registry is being fetched on mount */
  loadingIndustries: boolean
}

function loadFromStorage(): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) return parsed.map(String)
    }
  } catch { /* ignore */ }
  return null
}

function loadAvailableFromStorage(): IndustryRow[] {
  if (typeof window === 'undefined') return []
  try {
    const stored = localStorage.getItem(AVAILABLE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed)) return parsed as IndustryRow[]
    }
  } catch { /* ignore */ }
  return []
}

export function useIndustryFilter(): IndustryFilterShape {
  const { data: session } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role
  const isPrivileged = role === 'admin' || role === 'subadmin'
  const maxIndustries = isPrivileged ? Infinity : ANALYST_MAX

  const [availableIndustries, setAvailableIndustries] = useState<IndustryRow[]>(loadAvailableFromStorage)
  const [loadingIndustries, setLoadingIndustries] = useState(availableIndustries.length === 0)
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>(() => {
    const stored = loadFromStorage()
    if (stored && stored.length > 0) return stored
    return FALLBACK_IDS
  })

  // Fetch the available-industries registry on mount AND whenever the
  // admin adds/removes an industry (the POST/DELETE handlers dispatch
  // `sg4:industries-registry-change`). Served from /api/industries —
  // requires the user to be signed in, so anonymous visits fall back to
  // the solar/wind/td seed from localStorage.
  useEffect(() => {
    let cancelled = false
    const refetch = () => {
      fetch('/api/industries', { credentials: 'same-origin' })
        .then((r) => r.json())
        .then((json) => {
          if (cancelled) return
          if (json?.ok && Array.isArray(json.industries)) {
            setAvailableIndustries(json.industries)
            try { localStorage.setItem(AVAILABLE_KEY, JSON.stringify(json.industries)) } catch { /* ignore */ }
          }
        })
        .catch(() => { /* offline — keep localStorage snapshot */ })
        .finally(() => { if (!cancelled) setLoadingIndustries(false) })
    }
    refetch()
    // Live-refresh trigger: admin Add/Remove-industry flow fires this event
    // via broadcastIndustryRegistryChange(). Without it, a new industry
    // wouldn't appear in other open tabs / sidebar instances until reload.
    const onRegistryChange = () => refetch()
    window.addEventListener(REGISTRY_EVENT, onRegistryChange)
    return () => {
      cancelled = true
      window.removeEventListener(REGISTRY_EVENT, onRegistryChange)
    }
  }, [])

  // Privileged users with no stored selection default to ALL available
  // industries. Do this AFTER the registry fetch so we actually know the
  // full list.
  useEffect(() => {
    if (!isPrivileged) return
    if (availableIndustries.length === 0) return
    const stored = loadFromStorage()
    if (stored && stored.length > 0) return
    const allIds = availableIndustries.map((i) => i.id)
    setSelectedIndustries(allIds)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(allIds))
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { industries: allIds } }))
    } catch { /* ignore */ }
  }, [isPrivileged, availableIndustries])

  // Listen for cross-component changes
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail?.industries && Array.isArray(detail.industries)) {
        setSelectedIndustries(detail.industries)
      }
    }
    window.addEventListener(EVENT_NAME, handler)
    return () => window.removeEventListener(EVENT_NAME, handler)
  }, [])

  const setIndustries = useCallback((ids: string[]) => {
    const clamped = isPrivileged ? ids : ids.slice(0, ANALYST_MAX)
    setSelectedIndustries(clamped)
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clamped)) } catch { /* ignore */ }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { industries: clamped } }))
  }, [isPrivileged])

  const toggleIndustry = useCallback((id: string) => {
    setSelectedIndustries(prev => {
      let next: string[]
      if (prev.includes(id)) {
        next = prev.filter(x => x !== id)
      } else {
        if (!isPrivileged && prev.length >= ANALYST_MAX) return prev
        next = [...prev, id]
      }
      // Never empty
      if (next.length === 0) return prev
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { industries: next } }))
      return next
    })
  }, [isPrivileged])

  const isSelected = useCallback((sec: string) => {
    return selectedIndustries.includes(sec)
  }, [selectedIndustries])

  return {
    selectedIndustries,
    availableIndustries,
    isSelected,
    setIndustries,
    toggleIndustry,
    maxIndustries,
    loadingIndustries,
  }
}

/**
 * Broadcast that the industries registry has changed (add / remove / rename).
 * Every mounted `useIndustryFilter` hook listens for this event and refetches
 * `/api/industries`, so the sidebar, dashboard Customize picker, value-chain
 * filters, admin comparison rows, etc. all pick up the change without a
 * page reload.
 *
 * Call this AFTER a successful POST or DELETE to `/api/industries`.
 */
export function broadcastIndustryRegistryChange(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent('sg4:industries-registry-change'))
}
