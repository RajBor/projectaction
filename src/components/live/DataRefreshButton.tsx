'use client'

import { useLiveSnapshot } from './LiveSnapshotProvider'

/**
 * Reusable small refresh button that:
 *   - Triggers a full refresh (commodities + news + every Company
 *     profile in parallel batches) on click
 *   - Shows the last-refreshed timestamp
 *   - Reports per-company progress while the batch is running
 *     (e.g. "Refreshing 42 / 83…")
 *   - Turns red on error with a retry tooltip
 *
 * Drop this into any page header — it gives users a single manual
 * button to replace every stale Company snapshot with fresh RapidAPI
 * data.
 */

interface Props {
  compact?: boolean
  label?: string
}

export function DataRefreshButton({ compact = false, label = 'Refresh live data' }: Props) {
  const {
    refresh,
    loading,
    refreshingCompanies,
    companyProgress,
    lastRefreshed,
    error,
  } = useLiveSnapshot()

  const timeText = lastRefreshed
    ? lastRefreshed.toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
    : 'never'

  const busy = loading || refreshingCompanies
  const busyLabel = refreshingCompanies
    ? `Refreshing ${companyProgress.done} / ${companyProgress.total}…`
    : 'Refreshing…'

  return (
    <button
      onClick={() => refresh()}
      disabled={busy}
      title={
        error
          ? `Last refresh returned: ${error}. Click to retry.`
          : `Pulls fresh commodities + news + every company profile from NSE/BSE. Last refreshed ${timeText}.`
      }
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: compact ? 5 : 7,
        background: error
          ? 'var(--reddim)'
          : busy
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
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.85 : 1,
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
        transition: 'all 0.15s',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          animation: busy ? 'dnSpin 1s linear infinite' : 'none',
          fontSize: compact ? 11 : 12,
        }}
      >
        ↻
      </span>
      {busy ? busyLabel : label}
      {!busy && lastRefreshed && !compact && (
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
      <style jsx global>{`
        @keyframes dnSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </button>
  )
}
