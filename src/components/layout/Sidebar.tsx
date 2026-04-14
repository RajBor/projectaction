'use client'

import { useIndustryFilter } from '@/hooks/useIndustryFilter'
import { useLiveIndices } from '@/hooks/useLiveIndices'

// Fallback values shown while the live NSE fetch is in flight or the user
// is signed out. They are clearly tagged as stale via the "— snapshot" suffix
// in `lastRefreshed` below.
const FALLBACK_INDICES: Array<{
  label: string; value: number; changePct: number; up: boolean
}> = [
  { label: 'NIFTY 50', value: 22326, changePct: 0.67, up: true },
  { label: 'NIFTY ENERGY', value: 40182, changePct: -0.31, up: false },
  { label: 'NIFTY POWER', value: 6842, changePct: 0.42, up: true },
  { label: 'NIFTY METAL', value: 9418, changePct: 1.12, up: true },
  { label: 'USD/INR', value: 83.42, changePct: -0.08, up: false },
]

function formatIndexValue(label: string, v: number): string {
  // USD/INR: 2-decimal rupee quote. All equity indices: group + 2 dec.
  if (label.includes('USD')) return v.toFixed(2)
  return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatRefreshTime(d: Date | null): string {
  if (!d) return 'never'
  const now = Date.now()
  const ms = now - d.getTime()
  if (ms < 60_000) return 'just now'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ago`
}

export function Sidebar({ onClose }: { onClose?: () => void }) {
  const { selectedIndustries, toggleIndustry, availableIndustries, loadingIndustries } = useIndustryFilter()
  const { indices: liveIndices, lastRefreshed, refreshing } = useLiveIndices()

  // Build a label lookup (id -> label) used by the "Active:" chip below.
  const labelById: Record<string, string> = {}
  for (const ind of availableIndustries) {
    labelById[ind.id] = ind.label
  }
  // Fallbacks so chips still read cleanly for the two hardcoded core
  // industries even before the registry fetch resolves.
  if (!labelById.solar) labelById.solar = 'Solar'
  if (!labelById.td) labelById.td = 'T&D'

  // Use live indices when available, otherwise a static snapshot so the UI
  // never feels empty on first paint or when offline.
  const indicesToShow: Array<{
    label: string; value: number; changePct: number; up: boolean
  }> = liveIndices.length > 0
    ? liveIndices.map((i) => ({ label: i.label, value: i.value, changePct: i.changePct, up: i.up }))
    : FALLBACK_INDICES

  return (
    <div
      style={{
        width: 260,
        height: '100%',
        background: 'var(--s1)',
        borderRight: '1px solid var(--br)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '8px 0 32px rgba(0,0,0,0.4)',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--br)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div
          style={{
            fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--txt)',
            letterSpacing: '-0.01em',
          }}
        >
          Workspace
        </div>
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Close sidebar"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--txt3)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--gold2)')}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = 'var(--txt3)')}
          >
            ×
          </button>
        )}
      </div>

      {/* Industry selector — checkboxes */}
      <div style={{ padding: '16px 16px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: 'var(--txt3)', letterSpacing: '1.5px', textTransform: 'uppercase' }}>
            Industry
          </span>
          <span style={{ fontSize: 9, color: 'var(--txt4)' }}>
            {selectedIndustries.length} selected
          </span>
        </div>

        {/* Active-industries summary chip — always visible, reinforces to
            the user which filter is driving the dashboard / value chain. */}
        <div
          style={{
            padding: '6px 10px',
            marginBottom: 10,
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 600,
            fontFamily: "'JetBrains Mono',monospace",
            letterSpacing: '0.3px',
            background: selectedIndustries.length > 0 ? 'var(--golddim)' : 'var(--s2)',
            border: `1px solid ${selectedIndustries.length > 0 ? 'var(--gold2)' : 'var(--br)'}`,
            color: selectedIndustries.length > 0 ? 'var(--gold2)' : 'var(--txt3)',
            textAlign: 'center',
          }}
        >
          {selectedIndustries.length === 0
            ? 'No industries active'
            : `Active: ${selectedIndustries.map((id) => labelById[id] || id).join(' · ')}`}
        </div>
        {loadingIndustries && availableIndustries.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--txt4)', padding: '8px 10px' }}>
            Loading industries…
          </div>
        ) : availableIndustries.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--txt4)', padding: '8px 10px' }}>
            No industries registered yet.
          </div>
        ) : (
          availableIndustries.map((opt) => {
            const checked = selectedIndustries.includes(opt.id)
            const icon = opt.icon || '📁'
            const desc = opt.description || ''
            return (
              <div
                key={opt.id}
                onClick={() => toggleIndustry(opt.id)}
                style={{
                  display: 'flex', alignItems: 'flex-start', gap: 8,
                  padding: '8px 10px', marginBottom: 4,
                  background: checked ? 'rgba(212,164,59,0.08)' : 'var(--s2)',
                  border: `1px solid ${checked ? 'rgba(212,164,59,0.3)' : 'var(--br)'}`,
                  borderRadius: 6, cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 3, flexShrink: 0, marginTop: 1,
                  border: `1.5px solid ${checked ? 'var(--gold2)' : 'var(--br2)'}`,
                  background: checked ? 'var(--gold2)' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 10, color: '#000', fontWeight: 700,
                }}>
                  {checked ? '✓' : ''}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: checked ? 'var(--gold2)' : 'var(--txt2)' }}>
                    {icon} {opt.label}
                  </div>
                  {desc && (
                    <div style={{ fontSize: 10, color: 'var(--txt4)', marginTop: 1, lineHeight: 1.3 }}>{desc}</div>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div style={{ height: 1, background: 'var(--br)', margin: '4px 16px' }} />

      {/* Market Pulse — hourly refreshed from NSE allIndices + open.er-api */}
      <div style={{ padding: '14px 16px 12px', overflowY: 'auto', flex: 1 }}>
        <div
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 10,
          }}
        >
          <span
            style={{
              fontSize: 10,
              color: 'var(--txt3)',
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
            }}
          >
            Market Pulse
          </span>
          <span
            title={liveIndices.length > 0 ? `Last refreshed ${formatRefreshTime(lastRefreshed)} — auto-refresh hourly` : 'Offline snapshot — will refresh when online'}
            style={{
              fontSize: 9,
              color: refreshing ? 'var(--gold2)' : liveIndices.length > 0 ? 'var(--green)' : 'var(--txt4)',
              fontFamily: "'JetBrains Mono',monospace",
            }}
          >
            {refreshing ? '⟳ live' : liveIndices.length > 0 ? `● ${formatRefreshTime(lastRefreshed)}` : '○ snapshot'}
          </span>
        </div>
        {indicesToShow.map(({ label, value, changePct, up }) => (
          <div
            key={label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '7px 0',
              borderBottom: '1px solid var(--br)',
            }}
          >
            <span style={{ fontSize: 11, color: 'var(--txt3)' }}>{label}</span>
            <span
              style={{
                fontSize: 11,
                fontFamily: 'JetBrains Mono, monospace',
                color: up ? 'var(--green)' : 'var(--red)',
                fontWeight: 500,
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 4,
              }}
            >
              {up ? '▲' : '▼'}
              <span>{formatIndexValue(label, value)}</span>
              {changePct !== 0 && (
                <span style={{ fontSize: 9, opacity: 0.75 }}>
                  {changePct > 0 ? '+' : ''}{changePct.toFixed(2)}%
                </span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Footer — Coverage */}
      <div style={{ padding: '12px 16px 18px', borderTop: '1px solid var(--br)' }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 8,
          }}
        >
          Coverage
        </div>
        <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.6 }}>
          {availableIndustries.length > 0
            ? `${availableIndustries.length} ${availableIndustries.length === 1 ? 'Industry' : 'Industries'} Registered`
            : 'India Solar & T&D'}
          <br />
          {selectedIndustries.length} Active
          <br />
          {selectedIndustries.map((id) => labelById[id] || id).join(' · ') || '—'}
        </div>
      </div>
    </div>
  )
}
