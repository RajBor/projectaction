'use client'

import { useState } from 'react'

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
 */
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
      setState('done')
      setTimeout(() => setState('idle'), 3000)
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
        ? '✓ Interest sent'
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
      title={`Let the platform admin know you want to explore ${companyName}`}
      style={{
        background: bg,
        color,
        border: `1px solid ${border}`,
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
