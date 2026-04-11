'use client'

import { useLiveSnapshot } from './LiveSnapshotProvider'

/**
 * Banner that appears whenever the LiveSnapshotProvider has detected
 * a "RapidAPI monthly quota exhausted" response from the upstream.
 *
 * This is the difference between "live data isn't working" (the user
 * sees stale numbers silently) and "live data isn't working because
 * the platform's RapidAPI plan needs an upgrade" (the user sees a
 * clear, actionable banner).
 *
 * Drop this at the top of any page that shows Company / valuation
 * data. Renders nothing when the quota is healthy.
 */
export function QuotaBanner() {
  const { quotaExhausted, error } = useLiveSnapshot()

  if (!quotaExhausted) return null

  return (
    <div
      role="alert"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        background: 'var(--reddim)',
        border: '1.5px solid var(--red)',
        borderLeft: '4px solid var(--red)',
        borderRadius: 6,
        padding: '12px 14px',
        marginBottom: 14,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: 18,
          color: 'var(--red)',
          lineHeight: 1,
          flexShrink: 0,
        }}
      >
        ⚠
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '1.2px',
            textTransform: 'uppercase',
            color: 'var(--red)',
            marginBottom: 4,
          }}
        >
          Live data paused · RapidAPI monthly quota exhausted
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.5 }}>
          The platform&apos;s RapidAPI BASIC plan has hit its monthly request
          ceiling. Every company table on this page is currently showing the
          last snapshot saved to local storage. To resume live refreshes,
          upgrade the plan at{' '}
          <a
            href="https://rapidapi.com/linuz/api/indian-stock-exchange-api2"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              color: 'var(--red)',
              fontWeight: 700,
              textDecoration: 'underline',
            }}
          >
            rapidapi.com/linuz/indian-stock-exchange-api2
          </a>{' '}
          or wait for the quota to reset next billing cycle.
        </div>
        {error && (
          <div
            style={{
              marginTop: 4,
              fontSize: 10,
              color: 'var(--txt3)',
              fontFamily: 'JetBrains Mono, monospace',
            }}
          >
            Upstream: {error}
          </div>
        )}
      </div>
    </div>
  )
}
