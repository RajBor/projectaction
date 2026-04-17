'use client'

/**
 * Module-level state for the DealNector "Refresh / Push All" exchange
 * sweep — the long-running loop that fetches NSE + Screener for every
 * pool ticker and auto-publishes each batch to user_companies.
 *
 * Why a module singleton (not React state)?
 *
 *   The sweep takes ~10-15 min to cover the ~500-ticker universe. If
 *   the admin navigates off the page mid-sweep, unmounting the admin
 *   component throws away its local `useState` + `useRef` holders. The
 *   running async function keeps executing (fetches + localStorage
 *   writes still complete), but the UI on remount has no way to
 *   observe the in-flight work — it sees stale localStorage snapshots
 *   and has no handle on the AbortController.
 *
 *   Lifting the running state and the abort handle to module scope
 *   means the sweep survives component unmount cleanly. The admin
 *   page subscribes via `useExchangeSweep()` (wraps
 *   `useSyncExternalStore`) so on remount it immediately sees
 *   `running: true` with live progress, and the Cancel button still
 *   targets the real in-flight controller.
 *
 *   Full page reload still resets everything (JS context is gone) —
 *   which is correct: the browser also killed the in-flight fetches.
 *   Only client-side navigation preserves the sweep.
 */

import { useSyncExternalStore } from 'react'
import type { ExchangeRow } from '@/app/api/admin/scrape-exchange/route'

export interface ExchangeSweepProgress {
  done: number
  total: number
  nseOk: number
  screenerOk: number
  dealnectorOk: number
  dbPublished: number
  dbFailed: number
}

export interface ExchangeSweepState {
  running: boolean
  data: Record<string, ExchangeRow>
  /** null until the first sweep emits a progress snapshot; keeps the
   *  conditional `{exchangeProgress && ...}` render pattern in the
   *  admin page working unchanged. */
  progress: ExchangeSweepProgress | null
  error: string | null
  time: string | null
}

let current: ExchangeSweepState = {
  running: false,
  data: {},
  progress: null,
  error: null,
  time: null,
}

const listeners = new Set<() => void>()
let abortCtl: AbortController | null = null

// Hydrate from localStorage once on client so a fresh mount of the
// admin page (after a full reload) sees the previous sweep's cached
// batch data and completion timestamp without flashing empty.
if (typeof window !== 'undefined') {
  try {
    const raw = window.localStorage.getItem('sg4_exchange_data')
    if (raw) current.data = JSON.parse(raw) as Record<string, ExchangeRow>
  } catch { /* ignore */ }
  try {
    const rawTime = window.localStorage.getItem('sg4_exchange_time')
    if (rawTime) current.time = new Date(rawTime).toLocaleString('en-IN')
  } catch { /* ignore */ }
}

function emit() {
  listeners.forEach((fn) => fn())
}

export function getExchangeSweepSnapshot(): ExchangeSweepState {
  return current
}

export function subscribeExchangeSweep(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

export function patchExchangeSweep(patch: Partial<ExchangeSweepState>) {
  current = { ...current, ...patch }
  emit()
}

export function setExchangeSweepData(data: Record<string, ExchangeRow>) {
  current = { ...current, data }
  emit()
}

/**
 * Merge a batch of freshly-scraped rows into the sweep data. Used by
 * both the main batch loop and the per-row "Fetch" button so single-
 * ticker refreshes show up in the same comparison table without
 * clobbering sibling rows.
 */
export function mergeExchangeSweepData(rows: Record<string, ExchangeRow>) {
  current = { ...current, data: { ...current.data, ...rows } }
  emit()
}

export function getExchangeAbortController(): AbortController | null {
  return abortCtl
}

export function setExchangeAbortController(ctl: AbortController | null) {
  abortCtl = ctl
}

/**
 * Cancel the in-flight sweep (if any) and clear the running flag.
 * Safe to call even when nothing is running. Does NOT clear the
 * accumulated `data` — Resume relies on those cached rows so we
 * don't re-scrape completed tickers.
 */
export function cancelExchangeSweep() {
  if (abortCtl) {
    try { abortCtl.abort() } catch { /* ignore */ }
    abortCtl = null
  }
  patchExchangeSweep({ running: false })
}

/**
 * React hook — subscribes to the module state via the standard
 * external-store contract so the admin page always sees the latest
 * progress even after a navigation round-trip.
 */
export function useExchangeSweep(): ExchangeSweepState {
  return useSyncExternalStore(
    subscribeExchangeSweep,
    getExchangeSweepSnapshot,
    getExchangeSweepSnapshot,
  )
}
