'use client'

import { useMemo } from 'react'
import { useLiveSnapshot } from './LiveSnapshotProvider'
import { DataRefreshButton } from './DataRefreshButton'
import {
  fmtCommodityChange,
  fmtCommodityPrice,
  type NormalizedCommodity,
  type SegmentImpactSummary,
} from '@/lib/commodities'

/**
 * Commodity snapshot card with an industry-impact commentary tab.
 *
 * Props let you filter to a specific value-chain segment so it can
 * be embedded on the Value Chain page (pass the active segment id)
 * as well as on the Valuation / M&A Radar pages (no filter = show
 * everything). Always includes a refresh button in the header.
 */

interface Props {
  /** Optional — when provided, impact commentary is filtered to
   *  segments that overlap this id (exact match first, fallback to
   *  all segments the commodities map covers). */
  activeSegmentId?: string
  /** Collapsed compact mode — just the commodity grid, no commentary. */
  compact?: boolean
  /** Optional heading override. */
  title?: string
}

export function CommodityPanel({ activeSegmentId, compact = false, title }: Props) {
  const { commodities, segmentImpacts, loading, error, lastRefreshed } =
    useLiveSnapshot()

  const filteredImpacts = useMemo<SegmentImpactSummary[]>(() => {
    if (!activeSegmentId) return segmentImpacts
    const exact = segmentImpacts.filter((s) => s.segmentId === activeSegmentId)
    return exact.length > 0 ? exact : segmentImpacts.slice(0, 3)
  }, [segmentImpacts, activeSegmentId])

  const displayCommodities = commodities.filter((c) => c.lastPrice != null)

  return (
    <div
      style={{
        background: 'var(--s1)',
        border: '1px solid var(--br)',
        borderRadius: 8,
        padding: 14,
        marginBottom: 16,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '1.4px',
              textTransform: 'uppercase',
              color: 'var(--gold2)',
            }}
          >
            Live Commodities · Industry Impact
          </div>
          <div
            style={{
              fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
              fontSize: 18,
              fontWeight: 600,
              color: 'var(--txt)',
              letterSpacing: '-0.01em',
              marginTop: 2,
            }}
          >
            {title ||
              (activeSegmentId
                ? 'Cost pressure on this segment'
                : 'Raw material pressure across the value chain')}
          </div>
        </div>
        <DataRefreshButton />
      </div>

      {/* Loading / error states */}
      {loading && displayCommodities.length === 0 && (
        <div
          style={{
            padding: 18,
            textAlign: 'center',
            color: 'var(--txt3)',
            fontSize: 12,
            fontStyle: 'italic',
          }}
        >
          Loading live commodities…
        </div>
      )}
      {!loading && error && displayCommodities.length === 0 && (
        <div
          style={{
            padding: 14,
            background: 'var(--reddim)',
            border: '1px solid var(--red)',
            borderRadius: 5,
            color: 'var(--red)',
            fontSize: 12,
          }}
        >
          Live commodities unavailable: {error}. Click Refresh to retry.
        </div>
      )}
      {!loading && displayCommodities.length === 0 && !error && (
        <div
          style={{
            padding: 18,
            textAlign: 'center',
            color: 'var(--txt3)',
            fontSize: 12,
            fontStyle: 'italic',
          }}
        >
          No commodity data yet. Click the refresh button to fetch from
          Indian Commodity Exchange (MCX/NCDEX).
        </div>
      )}

      {/* Commodities grid */}
      {displayCommodities.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 8,
            marginBottom: compact ? 0 : 14,
          }}
        >
          {displayCommodities.map((c) => (
            <CommodityTile key={c.rawSymbol} commodity={c} />
          ))}
        </div>
      )}

      {/* Industry impact commentary */}
      {!compact && filteredImpacts.length > 0 && (
        <div
          style={{
            borderTop: '1px solid var(--br)',
            paddingTop: 12,
            marginTop: 4,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '1.2px',
              textTransform: 'uppercase',
              color: 'var(--txt3)',
              marginBottom: 8,
            }}
          >
            Demand / supply impact by segment
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {filteredImpacts.map((imp) => (
              <ImpactRow key={imp.segmentId} summary={imp} />
            ))}
          </div>
        </div>
      )}

      {lastRefreshed && (
        <div
          style={{
            marginTop: 10,
            fontSize: 9,
            color: 'var(--txt3)',
            fontStyle: 'italic',
          }}
        >
          Source: Indian Commodity Exchange (MCX/NCDEX) · Last refreshed{' '}
          {lastRefreshed.toLocaleString('en-IN')}
        </div>
      )}
    </div>
  )
}

function CommodityTile({ commodity }: { commodity: NormalizedCommodity }) {
  const changePct = commodity.changePct ?? 0
  const color =
    changePct > 0 ? 'var(--green)' : changePct < 0 ? 'var(--red)' : 'var(--txt3)'
  return (
    <div
      style={{
        background: 'var(--s2)',
        border: '1px solid var(--br)',
        borderRadius: 5,
        padding: '9px 11px',
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: '0.8px',
          textTransform: 'uppercase',
          color: 'var(--txt3)',
          marginBottom: 3,
        }}
      >
        {commodity.name}
      </div>
      <div
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--txt)',
          lineHeight: 1.1,
        }}
      >
        {fmtCommodityPrice(commodity)}
        {commodity.unit && (
          <span
            style={{
              fontSize: 9,
              color: 'var(--txt3)',
              fontWeight: 500,
              marginLeft: 4,
            }}
          >
            {commodity.unit}
          </span>
        )}
      </div>
      <div
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 10,
          fontWeight: 700,
          color,
          marginTop: 2,
        }}
      >
        {fmtCommodityChange(commodity)}
      </div>
    </div>
  )
}

function ImpactRow({ summary }: { summary: SegmentImpactSummary }) {
  const net = summary.netImpactPct
  const color = net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--txt3)'
  const bg =
    net > 0
      ? 'var(--greendim)'
      : net < 0
        ? 'var(--reddim)'
        : 'var(--s2)'
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '180px 80px 1fr',
        gap: 10,
        alignItems: 'center',
        padding: '8px 11px',
        background: bg,
        border: `1px solid ${
          net > 0 ? 'var(--green)' : net < 0 ? 'var(--red)' : 'var(--br)'
        }`,
        borderLeft: `3px solid ${color}`,
        borderRadius: 4,
        fontSize: 11,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: 'var(--txt)',
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
        }}
      >
        {summary.segmentId.replace(/_/g, ' ')}
      </div>
      <div
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 12,
          fontWeight: 700,
          color,
          textAlign: 'right',
        }}
      >
        {net > 0 ? '+' : ''}
        {net.toFixed(2)}%
      </div>
      <div style={{ fontSize: 10, color: 'var(--txt2)', lineHeight: 1.4 }}>
        {summary.commentary}
      </div>
    </div>
  )
}
