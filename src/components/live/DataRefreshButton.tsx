'use client'

import { useLiveSnapshot } from './LiveSnapshotProvider'
import { nextScreenerSlotLabel, minutesUntilNextNseRefresh } from '@/lib/live/auto-refresh'

/**
 * Passive status badge — shows auto-refresh status. No manual refresh
 * button for regular users. Data updates automatically:
 *   Tier 1 (NSE): every hour
 *   Tier 2 (Screener): at 9am, 12:01pm, 4pm IST
 *   Tier 3 (RapidAPI): admin-only from Data Sources tab
 */

interface Props {
  compact?: boolean
}

export function DataRefreshButton({ compact = false }: Props) {
  const {
    nseLastRefreshed,
    nseRefreshing,
    screenerLastRefreshed,
    screenerRefreshing,
    missingFields,
  } = useLiveSnapshot()

  const missingCount = Object.keys(missingFields).length
  const nseAgo = nseLastRefreshed
    ? `${Math.max(0, Math.round((Date.now() - nseLastRefreshed.getTime()) / 60000))}m ago`
    : 'pending'
  const nextNse = minutesUntilNextNseRefresh(nseLastRefreshed)
  const nextScr = nextScreenerSlotLabel()
  const isRefreshing = nseRefreshing || screenerRefreshing

  if (compact) {
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 5,
          background: isRefreshing ? 'var(--s3)' : 'var(--golddim)',
          border: '1px solid var(--gold2)',
          color: 'var(--gold2)',
          padding: '3px 9px',
          fontSize: 9,
          fontWeight: 600,
          letterSpacing: '0.3px',
          borderRadius: 3,
          whiteSpace: 'nowrap',
        }}
        title={`NSE: ${nseAgo} · Next in ${nextNse}m\nScreener: next at ${nextScr}\n${missingCount > 0 ? missingCount + ' companies need admin refresh' : 'All fields covered'}`}
      >
        {isRefreshing ? '↻ Refreshing…' : `NSE: ${nseAgo}`}
      </span>
    )
  }

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        background: 'var(--s2)',
        border: '1px solid var(--br)',
        borderRadius: 4,
        padding: '5px 12px',
        fontSize: 10,
        color: 'var(--txt2)',
        whiteSpace: 'nowrap',
        flexWrap: 'wrap',
      }}
      title="Data refreshes automatically — no manual action needed"
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: isRefreshing ? 'var(--gold2)' : 'var(--green)',
            display: 'inline-block',
            animation: isRefreshing ? 'dnPulse 1s ease-in-out infinite' : 'none',
          }}
        />
        <strong style={{ color: 'var(--txt)' }}>NSE:</strong>{' '}
        {nseRefreshing ? 'refreshing…' : nseAgo}
        {nextNse > 0 && !nseRefreshing && (
          <span style={{ color: 'var(--txt3)' }}> · next {nextNse}m</span>
        )}
      </span>
      <span style={{ color: 'var(--br2)' }}>|</span>
      <span>
        <strong style={{ color: 'var(--txt)' }}>Screener:</strong>{' '}
        {screenerRefreshing ? 'refreshing…' : `next ${nextScr}`}
      </span>
      {missingCount > 0 && (
        <>
          <span style={{ color: 'var(--br2)' }}>|</span>
          <span style={{ color: 'var(--orange)', fontWeight: 700 }}>
            {missingCount} need admin refresh
          </span>
        </>
      )}
      <style>{`@keyframes dnPulse { 0%,100% { opacity:1; } 50% { opacity:0.3; } }`}</style>
    </div>
  )
}
