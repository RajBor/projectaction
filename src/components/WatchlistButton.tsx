'use client'

import { useEffect, useState } from 'react'
import { addToWatchlist, isOnWatchlist, removeFromWatchlist, WL_EVENT } from '@/lib/watchlist'
import type { Company } from '@/lib/data/companies'

/**
 * "+ Watchlist" / "✓ On Watchlist" toggle button. Click once to add the
 * company; if already on the watchlist, clicking again removes it.
 *
 * Lives next to the Express-Interest button on M&A Radar and anywhere else
 * that renders a company card.
 */
export function WatchlistButton({ company, compact }: { company: Company; compact?: boolean }) {
  const [on, setOn] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  useEffect(() => {
    setOn(isOnWatchlist(company.ticker))
    const handler = () => setOn(isOnWatchlist(company.ticker))
    window.addEventListener(WL_EVENT, handler)
    return () => window.removeEventListener(WL_EVENT, handler)
  }, [company.ticker])

  const toggle = () => {
    if (on) {
      removeFromWatchlist(company.ticker)
      setOn(false)
      setMsg('Removed')
    } else {
      const added = addToWatchlist({
        ticker: company.ticker,
        name: company.name,
        sec: company.sec,
        industry: company.sec,
        acqs: company.acqs,
        acqf: company.acqf,
        rev: company.rev,
        ev: company.ev,
        ev_eb: company.ev_eb,
        ebm: company.ebm,
        notes: company.rea,
      })
      setOn(true)
      setMsg(added ? 'Added' : 'Already on list')
    }
    setTimeout(() => setMsg(null), 1600)
  }

  return (
    <button
      onClick={toggle}
      title={on ? 'Remove from Watchlist' : 'Add to Watchlist'}
      style={{
        background: on ? 'rgba(16,185,129,0.12)' : 'var(--golddim)',
        border: `1px solid ${on ? 'var(--green)' : 'var(--gold2)'}`,
        color: on ? 'var(--green)' : 'var(--gold2)',
        fontSize: compact ? 9 : 10,
        fontWeight: 700,
        letterSpacing: '0.4px',
        textTransform: 'uppercase',
        padding: compact ? '3px 8px' : '4px 10px',
        borderRadius: 4,
        cursor: 'pointer',
        fontFamily: 'inherit',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        whiteSpace: 'nowrap',
      }}
    >
      {on ? '★ On Watchlist' : '+ Watchlist'}
      {msg && (
        <span style={{ fontSize: 8, opacity: 0.8, fontWeight: 400, textTransform: 'none' }}>
          · {msg}
        </span>
      )}
    </button>
  )
}
