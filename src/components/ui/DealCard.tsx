'use client'

import { Badge, getStageBadgeVariant, getPriorityBadgeVariant } from '@/components/ui/Badge'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import type { Deal } from '@/lib/data/deals'

const stageColors: Record<string, string> = {
  Screening: 'var(--txt3)',
  Diligence: 'var(--cyan)',
  Negotiation: 'var(--orange)',
  LOI: 'var(--gold2)',
  Closed: 'var(--green)',
}

export function DealCard({ deal }: { deal: Deal }) {
  return (
    <div
      style={{
        background: 'var(--s3)',
        border: '1px solid var(--br)',
        borderRadius: 7,
        padding: '14px 14px 12px',
        marginBottom: 10,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Left accent */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          background: stageColors[deal.stage],
          borderRadius: '7px 0 0 7px',
        }}
      />

      <div style={{ paddingLeft: 4 }}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 8,
          }}
        >
          <div>
            <h3
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--txt)',
                margin: 0,
                marginBottom: 2,
              }}
            >
              {deal.company}
            </h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Badge variant={getStageBadgeVariant(deal.stage)}>{deal.stage}</Badge>
            <ScoreBadge score={deal.score} size={24} />
          </div>
        </div>

        {/* Metrics */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 12,
            marginBottom: 12,
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--txt3)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 2,
              }}
            >
              EV
            </div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--txt)',
                fontFamily: 'JetBrains Mono, monospace',
                fontWeight: 500,
              }}
            >
              {deal.ev}
            </div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--txt3)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 2,
              }}
            >
              Sector
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt2)' }}>{deal.sector}</div>
          </div>
          <div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--txt3)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: 2,
              }}
            >
              Status
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt2)' }}>{deal.stage}</div>
          </div>
        </div>

        {/* Notes */}
        <div
          style={{
            fontSize: 11,
            color: 'var(--txt3)',
            background: 'var(--s4)',
            borderRadius: 4,
            padding: '6px 8px',
            marginBottom: 8,
            lineHeight: 1.4,
          }}
        >
          {deal.notes}
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            <Badge variant={getPriorityBadgeVariant(deal.priority)}>{deal.priority}</Badge>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 10, color: 'var(--txt4)' }}>
              {deal.analyst} · {deal.updatedAt}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}