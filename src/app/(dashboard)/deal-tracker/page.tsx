import { getDeals } from '@/lib/data/deals'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionTitle } from '@/components/ui/SectionTitle'
import { Badge, getStageBadgeVariant, getPriorityBadgeVariant } from '@/components/ui/Badge'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import type { Deal } from '@/lib/data/deals'

const STAGES = ['Screening', 'Diligence', 'Negotiation', 'LOI', 'Closed'] as const

const stageColors: Record<string, string> = {
  Screening: 'var(--txt3)',
  Diligence: 'var(--cyan)',
  Negotiation: 'var(--orange)',
  LOI: 'var(--gold2)',
  Closed: 'var(--green)',
}

function DealCard({ deal }: { deal: Deal }) {
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
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', marginBottom: 2 }}>
              {deal.company}
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)' }}>{deal.sector}</div>
          </div>
          <ScoreBadge score={deal.score} size={24} />
        </div>

        {/* EV / MW */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 9, color: 'var(--txt4)', letterSpacing: '1px', marginBottom: 2 }}>
              EV
            </div>
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12,
                color: 'var(--gold2)',
                fontWeight: 500,
              }}
            >
              {deal.ev}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--txt4)', letterSpacing: '1px', marginBottom: 2 }}>
              EQUITY
            </div>
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 12,
                color: 'var(--txt2)',
              }}
            >
              {deal.equity}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 9, color: 'var(--txt4)', letterSpacing: '1px', marginBottom: 2 }}>
              CAPACITY
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt2)' }}>{deal.mw}</div>
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

export default async function DealTrackerPage() {
  const deals = await getDeals()

  const total = deals.length
  const pipelineValue = '₹11,120Cr'
  const avgScore = (deals.reduce((s, d) => s + d.score, 0) / deals.length).toFixed(1)
  const closedCount = deals.filter((d) => d.stage === 'Closed').length

  const dealsByStage = STAGES.reduce(
    (acc, stage) => {
      acc[stage] = deals.filter((d) => d.stage === stage)
      return acc
    },
    {} as Record<string, Deal[]>
  )

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
          Pipeline
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
          Deal Tracker
        </h1>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24 }}>
        <KpiCard
          label="Total Deals"
          value={String(total)}
          sub="Active pipeline"
          color="cyan"
          delay={0}
        />
        <KpiCard
          label="Pipeline Value"
          value={pipelineValue}
          sub="Combined EV"
          color="gold"
          trend={12}
          delay={0.07}
        />
        <KpiCard
          label="Avg Deal Score"
          value={avgScore}
          sub="Quality index"
          color="green"
          delay={0.14}
        />
        <KpiCard
          label="Closed Deals"
          value={String(closedCount)}
          sub="FY25 completed"
          color="purple"
          delay={0.21}
        />
      </div>

      {/* Kanban Board */}
      <div style={{ marginBottom: 16 }}>
        <SectionTitle title="Deal Kanban" subtitle="Stage Overview" />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 12,
        }}
      >
        {STAGES.map((stage) => {
          const stageDeals = dealsByStage[stage] || []
          const stageColor = stageColors[stage]

          return (
            <div
              key={stage}
              style={{
                background: 'var(--s1)',
                border: '1px solid var(--br)',
                borderRadius: 8,
                overflow: 'hidden',
              }}
            >
              {/* Column header */}
              <div
                style={{
                  padding: '12px 14px 10px',
                  borderBottom: '1px solid var(--br)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <div
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: stageColor,
                    }}
                  />
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: stageColor,
                      letterSpacing: '0.5px',
                    }}
                  >
                    {stage}
                  </span>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: 'JetBrains Mono, monospace',
                    color: 'var(--txt3)',
                  }}
                >
                  {stageDeals.length}
                </span>
              </div>

              {/* Cards */}
              <div
                className="kanban-col"
                style={{ padding: 10, minHeight: 300, maxHeight: 520, overflowY: 'auto' }}
              >
                {stageDeals.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      padding: '24px 8px',
                      fontSize: 11,
                      color: 'var(--txt4)',
                    }}
                  >
                    No deals
                  </div>
                ) : (
                  stageDeals.map((deal) => <DealCard key={deal.id} deal={deal} />)
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
