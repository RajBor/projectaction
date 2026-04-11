'use client'

import { COMPANIES } from '@/lib/data/companies'
import { CHAIN, GROUPS } from '@/lib/data/chain'
import { Badge } from '@/components/ui/Badge'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { useWorkingPopup } from '@/components/working/WorkingPopup'
import type { WorkingDef } from '@/components/working/WorkingPopup'
import {
  wkCriticalPriority,
  wkAcqFlag,
  wkChainMarketSize,
  wkDashboardKPI,
  wkAcqScoreWithNews,
  wkEVEBITDAWithNews,
} from '@/lib/working'
import { useNewsData } from '@/components/news/NewsDataProvider'

const MARKET_SEGMENTS = [
  { l: 'Solar Raw Materials', v: '$1.8B', c: '22%', cl: 'red' as const },
  { l: 'Module Assembly', v: '$4.8B', c: '22%', cl: 'gold' as const },
  { l: 'Solar BoS', v: '$2.3B', c: '19%', cl: 'orange' as const },
  { l: 'Power Transformers', v: '$2.8B', c: '16%', cl: 'cyan' as const },
  { l: 'Conductors + HTLS', v: '$2.2B', c: '14%', cl: 'gray' as const },
  { l: 'Smart Meters', v: '$2.4B', c: '35%', cl: 'green' as const },
  { l: 'HV Cables', v: '$1.2B', c: '18%', cl: 'cyan' as const },
  { l: 'BESS', v: '$0.8B', c: '45%', cl: 'purple' as const },
  { l: 'Switchgear', v: '$2.2B', c: '15%', cl: 'gray' as const },
  { l: 'EMS/SCADA', v: '$0.6B', c: '20%', cl: 'purple' as const },
]

const PHDR_STYLE: React.CSSProperties = {
  padding: '20px 24px',
  borderBottom: '1px solid var(--br)',
  background: 'linear-gradient(180deg, var(--s2) 0%, var(--s1) 100%)',
  marginBottom: 20,
}

const PANEL_STYLE: React.CSSProperties = {
  padding: '0 4px',
}

const STITLE_STYLE: React.CSSProperties = {
  fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--txt)',
  textTransform: 'uppercase',
  letterSpacing: '0.6px',
  marginBottom: 12,
  marginTop: 20,
  paddingBottom: 6,
  borderBottom: '1px solid var(--br)',
}

const CARD_STYLE: React.CSSProperties = {
  background: 'var(--s2)',
  border: '1px solid var(--br)',
  borderRadius: 8,
  padding: 16,
}

const ACQ_CARD_STYLE: React.CSSProperties = {
  background: 'var(--s2)',
  border: '1px solid var(--br)',
  borderRadius: 8,
  padding: 12,
  marginBottom: 10,
}

const KPI_STYLE: React.CSSProperties = {
  background: 'var(--s2)',
  border: '1px solid var(--br)',
  borderRadius: 8,
  padding: '14px 16px',
  flex: 1,
  minWidth: 140,
  position: 'relative',
  overflow: 'hidden',
}

function KpiTile({
  label,
  value,
  sub,
  color,
  onClick,
}: {
  label: string
  value: string | number
  sub: string
  color?: 'gold' | 'red' | 'green' | 'cyan' | 'orange' | 'purple'
  onClick?: () => void
}) {
  const colorMap: Record<string, string> = {
    gold: 'var(--gold2)',
    red: 'var(--red)',
    green: 'var(--green)',
    cyan: 'var(--cyan2)',
    orange: 'var(--orange)',
    purple: 'var(--purple)',
  }
  const main = color ? colorMap[color] : 'var(--gold2)'
  const clickable = typeof onClick === 'function'
  return (
    <div
      style={{
        ...KPI_STYLE,
        cursor: clickable ? 'pointer' : undefined,
      }}
      onClick={onClick}
      onMouseEnter={
        clickable
          ? (e) => {
              ;(e.currentTarget as HTMLDivElement).style.background = 'var(--s3)'
            }
          : undefined
      }
      onMouseLeave={
        clickable
          ? (e) => {
              ;(e.currentTarget as HTMLDivElement).style.background = 'var(--s2)'
            }
          : undefined
      }
      title={clickable ? 'How was this calculated?' : undefined}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(to right, ${main}, transparent)`,
        }}
      />
      <div
        style={{
          fontSize: 10,
          color: 'var(--txt3)',
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          marginBottom: 8,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {label}
        {clickable && <span style={{ fontSize: 10, color: 'var(--gold2)' }}>ⓘ</span>}
      </div>
      <div
        style={{
          fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
          fontSize: 24,
          fontWeight: 700,
          color: main,
          lineHeight: 1,
          marginBottom: 6,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--txt3)' }}>{sub}</div>
    </div>
  )
}

export default function DashboardPage() {
  const { showWorking } = useWorkingPopup()
  const { getAdjusted } = useNewsData()
  const topPicks = COMPANIES.filter((c) => c.acqs >= 9).sort((a, b) => b.acqs - a.acqs)
  const crits = CHAIN.filter((c) => c.flag === 'critical')

  const wlCount = 0
  const dsCount = 0

  const kpiNodesDef: WorkingDef = wkDashboardKPI(
    'Value Chain Nodes',
    String(CHAIN.length),
    'Sum of all tracked nodes across solar + T&D segments',
    [
      {
        label: 'Total nodes tracked',
        calc: 'COUNT(CHAIN[])',
        result: `${CHAIN.length} nodes`,
      },
      {
        label: 'Solar nodes',
        calc: "CHAIN.filter(sec=='solar').length",
        result: `${CHAIN.filter((c) => c.sec === 'solar').length}`,
      },
      {
        label: 'T&D nodes',
        calc: "CHAIN.filter(sec=='td').length",
        result: `${CHAIN.filter((c) => c.sec === 'td').length}`,
      },
    ],
    [
      { name: 'Value Chain Dataset', color: 'var(--gold2)', note: 'Internal research' },
    ]
  )

  const kpiStrongBuyDef: WorkingDef = wkDashboardKPI(
    'Strong Buy Targets',
    String(topPicks.length),
    'Filter COMPANIES where acquisition score ≥ 9',
    [
      {
        label: 'Universe',
        calc: 'COMPANIES (listed Indian universe)',
        result: `${COMPANIES.length} companies`,
      },
      {
        label: 'Threshold filter',
        calc: 'acqs >= 9',
        result: `${topPicks.length} match`,
      },
      {
        label: 'Interpretation',
        calc: 'Score 9–10 = Strong Buy tier',
        result: 'Ideal acquisition targets',
      },
    ],
    [
      { name: 'Acquisition Score Model', color: 'var(--gold2)', note: 'Proprietary' },
    ]
  )

  const kpiCompaniesDef: WorkingDef = wkDashboardKPI(
    'Companies Tracked',
    String(COMPANIES.length),
    'Total entries in COMPANIES dataset',
    [
      {
        label: 'Listed Indian companies',
        calc: 'COMPANIES.length',
        result: `${COMPANIES.length} firms`,
      },
      {
        label: 'Solar',
        calc: "filter(sec=='solar')",
        result: `${COMPANIES.filter((c) => c.sec === 'solar').length}`,
      },
      {
        label: 'T&D',
        calc: "filter(sec=='td')",
        result: `${COMPANIES.filter((c) => c.sec === 'td').length}`,
      },
    ],
    [
      { name: 'COMPANIES Dataset', color: 'var(--gold2)', note: 'Internal research' },
    ]
  )

  return (
    <div>
      {/* Page header */}
      <div style={PHDR_STYLE}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          <span className="dn-wordmark">Deal<em>Nector</em></span> <span style={{ margin: '0 6px' }}>›</span> Executive Dashboard
        </div>
        <h1
          style={{
            fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
            fontSize: 26,
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
            marginBottom: 10,
          }}
        >
          Deal <em style={{ color: 'var(--gold2)', fontStyle: 'italic' }}>Board</em>
        </h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge variant="gold">🇮🇳 India Focus</Badge>
          <Badge variant="gray">500GW RE Target 2030</Badge>
          <Badge variant="gray">₹3.03L Cr RDSS</Badge>
          <Badge variant="green">Live Data Active</Badge>
        </div>
      </div>

      <div style={PANEL_STYLE}>
        {/* KPI Row */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <KpiTile
            label="Value Chain Nodes"
            value={CHAIN.length}
            sub="Tracked components"
            onClick={() => showWorking(kpiNodesDef)}
          />
          <KpiTile
            label="Critical Priority"
            value={crits.length}
            sub="Require action now"
            color="red"
            onClick={() => showWorking(wkCriticalPriority(CHAIN))}
          />
          <KpiTile
            label="Companies Tracked"
            value={COMPANIES.length}
            sub="Indian firms"
            color="green"
            onClick={() => showWorking(kpiCompaniesDef)}
          />
          <KpiTile
            label="Strong Buy Targets"
            value={topPicks.length}
            sub="Score 9–10"
            onClick={() => showWorking(kpiStrongBuyDef)}
          />
          <KpiTile label="Watchlist" value={wlCount} sub="Saved companies" color="cyan" />
          <KpiTile label="Deal Pipeline" value={dsCount} sub="Active deals" color="orange" />
          <KpiTile label="Solar Addition Needed" value="280GW" sub="2024–2030" />
          <KpiTile
            label="RDSS Scheme"
            value="₹3.03L Cr"
            sub="T&D investment"
            color="purple"
          />
        </div>

        {/* Value Chain — Full Flow */}
        <div style={STITLE_STYLE}>Value Chain — Full Flow</div>
        <div
          style={{
            overflowX: 'auto',
            background: 'var(--s1)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: 14,
          }}
        >
          <div style={{ display: 'flex', gap: 14, minWidth: 'max-content' }}>
            {Object.entries(GROUPS).map(([grp, ids]) => {
              const isSol = grp.startsWith('Solar')
              const hdrColor = isSol ? 'var(--gold2)' : 'var(--cyan2)'
              return (
                <div
                  key={grp}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    minWidth: 160,
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.6px',
                      color: hdrColor,
                      padding: '6px 10px',
                      background: isSol ? 'var(--golddim)' : 'var(--cyandim)',
                      borderRadius: 4,
                      border: `1px solid ${hdrColor}`,
                      textAlign: 'center',
                      marginBottom: 4,
                    }}
                  >
                    {grp.replace('Solar — ', '').replace('T&D — ', '')}
                  </div>
                  {(ids as string[]).map((id) => {
                    const c = CHAIN.find((x) => x.id === id)
                    if (!c) return null
                    const dotColor =
                      c.flag === 'critical'
                        ? 'var(--red)'
                        : c.flag === 'high'
                          ? 'var(--orange)'
                          : 'var(--gold2)'
                    return (
                      <div
                        key={id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          padding: '8px 10px',
                          background: 'var(--s2)',
                          border: '1px solid var(--br)',
                          borderRadius: 4,
                          fontSize: 12,
                          color: 'var(--txt)',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{
                            width: 7,
                            height: 7,
                            borderRadius: '50%',
                            background: dotColor,
                            flexShrink: 0,
                          }}
                        />
                        {c.name}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>

        {/* 2-col: Top Targets + Critical Components */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 16,
            marginTop: 20,
          }}
        >
          <div>
            <div style={STITLE_STYLE}>⭐ Top Acquisition Targets (Score 9–10)</div>
            {topPicks.slice(0, 6).map((co) => {
              const adjusted = getAdjusted(co)
              const postAcqs = adjusted.post.acqs
              const postEvEb = adjusted.post.ev_eb
              const scoreChanged =
                adjusted.hasAdjustment &&
                Math.round(postAcqs * 10) !== Math.round(co.acqs * 10)
              const evEbChanged =
                adjusted.hasAdjustment &&
                co.ev_eb > 0 &&
                Math.abs(postEvEb - co.ev_eb) > 0.005
              return (
              <div
                key={co.ticker}
                style={{
                  ...ACQ_CARD_STYLE,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  borderLeft: '3px solid var(--gold2)',
                }}
              >
                <div
                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}
                  title={
                    scoreChanged
                      ? `Pre-news ${co.acqs}/10 → Post-news ${postAcqs.toFixed(1)}/10 (${adjusted.acknowledgedCount} acked).`
                      : 'How is the acquisition score calculated?'
                  }
                  onClick={() => showWorking(wkAcqScoreWithNews(co, adjusted))}
                >
                  <ScoreBadge score={co.acqs} size={36} />
                  {scoreChanged && (
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: 'JetBrains Mono, monospace',
                        color: postAcqs >= co.acqs ? 'var(--green)' : 'var(--red)',
                        fontWeight: 700,
                      }}
                    >
                      → {postAcqs.toFixed(1)}
                    </span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)' }}>
                    {co.name}{' '}
                    <span
                      style={{
                        fontSize: 12,
                        color: 'var(--txt3)',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      {co.ticker}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      color: 'var(--gold2)',
                      margin: '2px 0',
                      cursor: 'pointer',
                      borderBottom: '1px dotted var(--gold2)',
                      display: 'inline-block',
                    }}
                    title={
                      evEbChanged
                        ? `Pre-news ${co.ev_eb}× → Post-news ${postEvEb.toFixed(2)}× (${adjusted.acknowledgedCount} acked).`
                        : 'How is EV/EBITDA calculated?'
                    }
                    onClick={() => showWorking(wkEVEBITDAWithNews(co, adjusted))}
                  >
                    EV ₹{co.ev > 0 ? co.ev.toLocaleString() + 'Cr' : 'N/A'} · EV/EBITDA{' '}
                    {co.ev_eb > 0 ? co.ev_eb + '×' : '—'}
                    {evEbChanged && (
                      <span
                        style={{
                          fontSize: 10,
                          marginLeft: 4,
                          fontFamily: 'JetBrains Mono, monospace',
                          color: postEvEb >= co.ev_eb ? 'var(--green)' : 'var(--red)',
                          fontWeight: 700,
                        }}
                      >
                        → {postEvEb.toFixed(2)}×
                      </span>
                    )}
                    {' '}· EBITDA {co.ebm}%
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    alignItems: 'flex-end',
                  }}
                >
                  <div
                    style={{ cursor: 'pointer' }}
                    title="Why this flag?"
                    onClick={() => showWorking(wkAcqFlag(co.acqf, co.rea))}
                  >
                    <Badge variant="green">{co.acqf}</Badge>
                  </div>
                </div>
              </div>
              )
            })}
          </div>
          <div>
            <div style={STITLE_STYLE}>🔴 Critical Priority Components</div>
            {crits.map((c) => (
              <div
                key={c.id}
                style={{
                  ...ACQ_CARD_STYLE,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: 'var(--red)',
                    flexShrink: 0,
                    marginTop: 4,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)' }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 2 }}>
                    {c.mkt.ist.substring(0, 70)}…
                  </div>
                  <div style={{ marginTop: 5, display: 'flex', gap: 6 }}>
                    <span
                      style={{ cursor: 'pointer' }}
                      title="How is the India market size derived?"
                      onClick={(e) => {
                        e.stopPropagation()
                        showWorking(wkChainMarketSize(c))
                      }}
                    >
                      <Badge variant="gray">India: {c.mkt.ig}</Badge>
                    </span>
                    <Badge variant="gold">CAGR {c.mkt.icagr}</Badge>
                  </div>
                </div>
                <Badge variant="red">CRITICAL</Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Market Opportunity */}
        <div style={STITLE_STYLE}>📊 India Market Opportunity by Segment</div>
        <div
          style={{
            overflowX: 'auto',
            background: 'var(--s1)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: 14,
          }}
        >
          <div style={{ display: 'flex', gap: 12, minWidth: 'max-content' }}>
            {MARKET_SEGMENTS.map((s) => (
              <div
                key={s.l}
                style={{
                  ...KPI_STYLE,
                  minWidth: 160,
                  flexShrink: 0,
                  flex: 'none',
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--txt3)',
                    letterSpacing: '1.5px',
                    textTransform: 'uppercase',
                    marginBottom: 8,
                  }}
                >
                  {s.l}
                </div>
                <div
                  style={{
                    fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                    fontSize: 18,
                    fontWeight: 700,
                    color: 'var(--gold2)',
                    lineHeight: 1,
                    marginBottom: 6,
                  }}
                >
                  {s.v}
                </div>
                <div style={{ marginTop: 6 }}>
                  <Badge variant={s.cl}>+{s.c} CAGR</Badge>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Policy Pulse */}
        <div style={STITLE_STYLE}>🏛 Policy Pulse</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 14,
            marginBottom: 20,
          }}
        >
          <div style={CARD_STYLE}>
            <div
              style={{
                fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--gold2)',
                marginBottom: 8,
              }}
            >
              PLI Solar — ₹24,000Cr
            </div>
            <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>
              65GW integrated manufacturing target. Incentivises poly→wafer→cell→module chain.
              PLI disbursement started FY25.
            </p>
          </div>
          <div style={CARD_STYLE}>
            <div
              style={{
                fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--gold2)',
                marginBottom: 8,
              }}
            >
              RDSS — ₹3.03 Lakh Crore
            </div>
            <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>
              250M smart meters by 2026. Distribution infrastructure upgrade. Largest T&D demand
              driver 2024–2028.
            </p>
          </div>
          <div style={CARD_STYLE}>
            <div
              style={{
                fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                fontSize: 14,
                fontWeight: 700,
                color: 'var(--gold2)',
                marginBottom: 8,
              }}
            >
              Green Energy Corridor ₹12,000Cr+
            </div>
            <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>
              Dedicated RE transmission corridors. HVDC + 765kV. Creates ₹8,000Cr+ equipment
              demand for transformers, conductors, GIS.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
