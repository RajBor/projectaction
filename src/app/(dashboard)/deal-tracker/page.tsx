import { getDeals } from '@/lib/data/deals'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionTitle } from '@/components/ui/SectionTitle'
import { DealCard } from '@/components/ui/DealCard'

const STAGES = ['Screening', 'Diligence', 'Negotiation', 'LOI', 'Closed'] as const

export default async function DealTrackerPage() {
  const deals = await getDeals()

  const total = deals.length
  const pipelineValue = 'â‚¹11,120Cr'
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

      {/* Deal Pipeline Kanban */}
      <div style={{ marginBottom: 24 }}>
        <SectionTitle title="Deal Pipeline" subtitle="Kanban View" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 16,
            marginTop: 16,
          }}
        >
          {STAGES.map((stage) => {
            const stageDeals = dealsByStage[stage] || []
            const stageColor =
              stage === 'Screening'
                ? 'var(--txt3)'
                : stage === 'Diligence'
                ? 'var(--cyan)'
                : stage === 'Negotiation'
                ? 'var(--orange)'
                : stage === 'LOI'
                ? 'var(--gold2)'
                : 'var(--green)'

            return (
              <div
                key={stage}
                style={{
                  background: 'var(--s2)',
                  border: '1px solid var(--br)',
                  borderRadius: 8,
                  minHeight: 400,
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
                        fontSize: 12,
                        fontWeight: 600,
                        color: 'var(--txt)',
                      }}
                    >
                      {stage}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--txt3)',
                      background: 'var(--s3)',
                      padding: '2px 6px',
                      borderRadius: 3,
                    }}
                  >
                    {stageDeals.length}
                  </span>
                </div>

                {/* Deals */}
                <div style={{ padding: '10px 14px' }}>
                  {stageDeals.map((deal) => (
                    <DealCard key={deal.id} deal={deal} />
                  ))}
                  {stageDeals.length === 0 && (
                    <div
                      style={{
                        textAlign: 'center',
                        padding: '40px 20px',
                        color: 'var(--txt4)',
                        fontSize: 12,
                      }}
                    >
                      No deals in {stage.toLowerCase()}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
