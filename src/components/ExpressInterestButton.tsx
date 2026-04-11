'use client'

import { useEffect, useState } from 'react'

interface Props {
  ticker?: string | null
  companyName: string
  dealType: 'listed' | 'private'
  sector?: string | null
  rationale?: string | null
  sourcePage: 'maradar' | 'private' | 'dashboard' | 'stocks' | 'valuation' | 'other'
  size?: 'sm' | 'md'
}

/**
 * "Express Interest" button that any user can click on a recommendation.
 *
 * Sends a POST to /api/deals/interest which writes a deal_interests row
 * and fires an email alert to the platform admin. The admin sees every
 * click on the /admin dashboard under the Deal Interests tab.
 *
 * Each click is remembered locally in localStorage (`sg4_expressed`) so
 * that once a user has expressed interest in a target, every subsequent
 * visit to any page that shows the same target displays a clear
 * "You have expressed interest" confirmation in green instead of the
 * idle call-to-action. Keyed by ticker (or name for privates).
 */

const STORAGE_KEY = 'sg4_expressed'

function keyFor(ticker: string | null | undefined, companyName: string): string {
  return ticker && ticker.trim() ? `t:${ticker.trim().toUpperCase()}` : `n:${companyName.trim().toLowerCase()}`
}

function loadExpressed(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, string>
    return {}
  } catch {
    return {}
  }
}

function saveExpressed(map: Record<string, string>): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export function ExpressInterestButton({
  ticker,
  companyName,
  dealType,
  sector,
  rationale,
  sourcePage,
  size = 'sm',
}: Props) {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [err, setErr] = useState<string | null>(null)

  // Hydrate from localStorage on mount so state persists across navigation.
  useEffect(() => {
    const map = loadExpressed()
    if (map[keyFor(ticker, companyName)]) {
      setState('done')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, companyName])

  const submit = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (state === 'sending' || state === 'done') return
    setState('sending')
    setErr(null)
    try {
      const res = await fetch('/api/deals/interest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticker: ticker || null,
          companyName,
          dealType,
          sector: sector || null,
          rationale: rationale || null,
          sourcePage,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setState('error')
        setErr(data.error || 'Failed')
        return
      }
      // Remember this interest locally so it persists across sessions and pages
      const map = loadExpressed()
      map[keyFor(ticker, companyName)] = new Date().toISOString()
      saveExpressed(map)
      setState('done')
    } catch {
      setState('error')
      setErr('Network error')
    }
  }

  const padY = size === 'sm' ? 3 : 5
  const padX = size === 'sm' ? 9 : 12
  const fontSize = size === 'sm' ? 10 : 11

  const label =
    state === 'sending'
      ? 'Sending…'
      : state === 'done'
        ? '✓ You have expressed interest'
        : state === 'error'
          ? err || 'Retry'
          : '✦ Express Interest'

  const bg =
    state === 'done'
      ? 'var(--greendim)'
      : state === 'error'
        ? 'var(--reddim)'
        : 'var(--golddim)'
  const color =
    state === 'done'
      ? 'var(--green)'
      : state === 'error'
        ? 'var(--red)'
        : 'var(--gold2)'
  const border =
    state === 'done'
      ? 'var(--green)'
      : state === 'error'
        ? 'var(--red)'
        : 'var(--gold2)'

  return (
    <button
      onClick={submit}
      disabled={state === 'sending' || state === 'done'}
      title={
        state === 'done'
          ? `You have already expressed interest in ${companyName}. The admin has been notified.`
          : `Let the platform admin know you want to explore ${companyName}`
      }
      style={{
        background: bg,
        color,
        border: `1.5px solid ${border}`,
        padding: `${padY}px ${padX}px`,
        fontSize,
        fontWeight: 700,
        letterSpacing: '0.3px',
        textTransform: 'uppercase',
        borderRadius: 3,
        cursor: state === 'sending' || state === 'done' ? 'default' : 'pointer',
        whiteSpace: 'nowrap',
        fontFamily: 'inherit',
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  )
}
