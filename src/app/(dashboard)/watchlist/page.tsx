import { getWatchlist } from '@/lib/data/watchlist'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionTitle } from '@/components/ui/SectionTitle'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import type { WatchlistItem } from '@/lib/data/watchlist'

const statusColors: Record<string, string> = {
  Monitoring: 'var(--cyan)',
  'Pre-IPO Watch': 'var(--gold2)',
  'Deep Dive': 'var(--purple)',
  'Strategic Watch': 'var(--orange)',
  Exited: 'var(--txt3)',
}

function WatchlistCard({ item }: { item: WatchlistItem }) {
  const statusColor = statusColors[item.currentStatus] || 'var(--txt2)'

  return (
    <div
      style={{
        background: 'var(--s2)',
        border: `1px solid ${item.starred ? 'rgba(247,183,49,0.3)' : 'var(--br)'}`,
        borderRadius: 8,
        padding: '18px 20px',
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.2s',
      }}
    >
      {/* Top accent */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: item.starred
            ? 'linear-gradient(to right, var(--gold2), transparent)'
            : 'transparent',
        }}
      />

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 12,
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            {item.starred && (
              <span style={{ color: 'var(--gold2)', fontSize: 13 }}>★</span>
            )}
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--txt)',
                fontFamily: 'Space Grotesk, sans-serif',
              }}
            >
              {item.company}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 11,
                color: 'var(--txt3)',
              }}
            >
              {item.ticker}
            </span>
            <span style={{ fontSize: 11, color: 'var(--txt3)' }}>·</span>
            <span style={{ fontSize: 11, color: 'var(--txt3)' }}>{item.sector}</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              fontSize: 11,
              color: statusColor,
              background: `${statusColor}18`,
              border: `1px solid ${statusColor}40`,
              padding: '3px 10px',
              borderRadius: 4,
            }}
          >
            {item.currentStatus}
          </div>
          <ScoreBadge score={item.score} size={30} />
        </div>
      </div>

      {/* Rationale */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--txt2)',
          lineHeight: 1.6,
          marginBottom: 14,
          borderLeft: '2px solid var(--br2)',
          paddingLeft: 12,
        }}
      >
        {item.rationale}
      </div>

      {/* Footer metrics */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 12,
          borderTop: '1px solid var(--br)',
        }}
      >
        <div>
          <div style={{ fontSize: 9, color: 'var(--txt4)', letterSpacing: '1px', marginBottom: 3 }}>
            TARGET EV
          </div>
          <div
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 13,
              color: 'var(--gold2)',
              fontWeight: 600,
            }}
          >
            {item.targetEV}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 9, color: 'var(--txt4)', letterSpacing: '1px', marginBottom: 3 }}>
            ADDED
          </div>
          <div style={{ fontSize: 11, color: 'var(--txt3)' }}>{item.addedOn}</div>
        </div>
      </div>
    </div>
  )
}

export default async function WatchlistPage() {
  const items = await getWatchlist()

  const starred = items.filter((i) => i.starred).length
  const avgScore = (items.reduce((s, i) => s + i.score, 0) / items.length).toFixed(1)
  const totalTargetEV = items.length

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          Coverage
        </div>
        <h1
          style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
          }}
        >
          Watchlist
        </h1>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24 }}>
        <KpiCard
          label="Companies Tracked"
          value={String(totalTargetEV)}
          sub="Active coverage"
          color="cyan"
          delay={0}
        />
        <KpiCard
          label="Starred"
          value={String(starred)}
          sub="Priority watch"
          color="gold"
          delay={0.07}
        />
        <KpiCard
          label="Avg Score"
          value={avgScore}
          sub="Portfolio quality"
          color="green"
          delay={0.14}
        />
        <KpiCard
          label="Pre-IPO Watch"
          value="2"
          sub="IPO expected FY26"
          color="purple"
          delay={0.21}
        />
      </div>

      {/* Status filters */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        {['All', 'Monitoring', 'Pre-IPO Watch', 'Deep Dive', 'Strategic Watch'].map((f) => (
          <button
            key={f}
            style={{
              background: f === 'All' ? 'var(--s3)' : 'transparent',
              border: `1px solid ${f === 'All' ? 'var(--br2)' : 'var(--br)'}`,
              color: f === 'All' ? 'var(--txt)' : 'var(--txt3)',
              padding: '5px 12px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {f}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--txt3)' }}>★ Starred only</span>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <SectionTitle title="Tracked Companies" subtitle="Investment Watchlist" />
      </div>

      {/* Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 16,
        }}
      >
        {items.map((item) => (
          <WatchlistCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
