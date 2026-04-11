'use client'

import { useLiveSnapshot } from './LiveSnapshotProvider'

/**
 * Reusable small refresh button that shows the last-refreshed time
 * from the LiveSnapshotProvider and re-fetches commodities + news on
 * click. Drop this into any page header to give users a manual data
 * refresh without a full page reload.
 */

interface Props {
  compact?: boolean
  label?: string
}

export function DataRefreshButton({ compact = false, label = 'Refresh live data' }: Props) {
  const { refresh, loading, lastRefreshed, error } = useLiveSnapshot()

  const timeText = lastRefreshed
    ? lastRefreshed.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'never'

  return (
    <button
      onClick={() => refresh()}
      disabled={loading}
      title={
        error
          ? `Last refresh failed: ${error}. Click to retry.`
          : `Live data: commodities + news. Last refreshed ${timeText}`
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 5 : 7,
        background: error
          ? 'var(--reddim)'
          : loading
            ? 'var(--s3)'
            : 'var(--golddim)',
        border: `1px solid ${error ? 'var(--red)' : 'var(--gold2)'}`,
        color: error ? 'var(--red)' : 'var(--gold2)',
        padding: compact ? '4px 9px' : '6px 12px',
        fontSize: compact ? 10 : 11,
        fontWeight: 700,
        letterSpacing: '0.4px',
        textTransform: 'uppercase',
        borderRadius: 4,
        cursor: loading ? 'wait' : 'pointer',
        opacity: loading ? 0.75 : 1,
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          transform: loading ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.4s',
          fontSize: compact ? 11 : 12,
        }}
      >
        ↻
      </span>
      {loading ? 'Refreshing…' : label}
      {!loading && lastRefreshed && !compact && (
        <span
          style={{
            fontSize: 9,
            color: 'var(--txt3)',
            fontWeight: 500,
            letterSpacing: 0,
            textTransform: 'none',
            fontFamily: 'JetBrains Mono, monospace',
            marginLeft: 2,
          }}
        >
          · {timeText}
        </span>
      )}
    </button>
  )
}
