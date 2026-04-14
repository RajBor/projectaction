'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Industry filter hook — shared across all dashboard pages.
 *
 * Reads selected industries from localStorage (`sg4_industries`)
 * and listens to `sg4:industry-change` custom events dispatched
 * by the Sidebar when the user toggles industry checkboxes.
 *
 * Default: both Solar and T&D selected.
 */

const STORAGE_KEY = 'sg4_industries'
const EVENT_NAME = 'sg4:industry-change'
const DEFAULT_INDUSTRIES = ['solar', 'td']

export interface IndustryFilterShape {
  /** Currently selected industry IDs */
  selectedIndustries: string[]
  /** Check if a sector is currently selected */
  isSelected: (sec: string) => boolean
  /** Update selected industries (also persists + dispatches event) */
  setIndustries: (ids: string[]) => void
  /** Toggle a single industry on/off */
  toggleIndustry: (id: string) => void
}

function loadFromStorage(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* ignore */ }
  return DEFAULT_INDUSTRIES
}

export function useIndustryFilter(): IndustryFilterShape {
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>(loadFromStorage)

  // Listen for changes from other components (e.g., Sidebar)
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
    const clamped = ids.slice(0, 5) // max 5
    setSelectedIndustries(clamped)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clamped))
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { industries: clamped } }))
  }, [])

  const toggleIndustry = useCallback((id: string) => {
    setSelectedIndustries(prev => {
      const next = prev.includes(id)
        ? prev.filter(x => x !== id)
        : prev.length < 5 ? [...prev, id] : prev
      // Don't allow empty — keep at least one
      if (next.length === 0) return prev
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { industries: next } }))
      return next
    })
  }, [])

  const isSelected = useCallback((sec: string) => {
    return selectedIndustries.includes(sec)
  }, [selectedIndustries])

  return { selectedIndustries, isSelected, setIndustries, toggleIndustry }
}
