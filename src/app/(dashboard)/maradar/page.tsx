'use client'

import { useState } from 'react'
import { COMPANIES } from '@/lib/data/companies'
import { CHAIN } from '@/lib/data/chain'
import { PRIVATE_COMPANIES } from '@/lib/data/private-companies'
import { Badge } from '@/components/ui/Badge'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { ExpressInterestButton } from '@/components/ExpressInterestButton'
import { DataRefreshButton } from '@/components/live/DataRefreshButton'
import { QuotaBanner } from '@/components/live/QuotaBanner'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'
import { useWorkingPopup } from '@/components/working/WorkingPopup'
import type { WorkingDef } from '@/components/working/WorkingPopup'
import {
  wkRevGrowth,
  wkEBITDAMargin,
  wkDebtEquity,
  wkAcqFlag,
  wkDashboardKPI,
  wkEVAudit,
  wkEVEBITDAAudit,
  wkAcqScoreAudit,
} from '@/lib/working'
import { useNewsData } from '@/components/news/NewsDataProvider'
import { FSAIntelligencePanel } from '@/components/fsa/FSAIntelligencePanel'

const PHDR_STYLE: React.CSSProperties = {
  padding: '20px 24px',
  borderBottom: '1px solid var(--br)',
  background: 'linear-gradient(180deg, var(--s2) 0%, var(--s1) 100%)',
  marginBottom: 20,
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

const KPI_STYLE: React.CSSProperties = {
  background: 'var(--s2)',
  border: '1px solid var(--br)',
  borderRadius: 8,
  padding: '14px 16px',
  flex: 1,
  minWidth: 160,
  position: 'relative',
  overflow: 'hidden',
}

const CARD_STYLE: React.CSSProperties = {
  background: 'var(--s2)',
  border: '1px solid var(--br)',
  borderRadius: 8,
  padding: 14,
  marginBottom: 10,
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

function tdColor(good: boolean, med: boolean): string {
  if (good) return 'var(--green)'
  if (med) return 'var(--gold2)'
  return 'var(--orange)'
}

function evColor(ev_eb: number): string {
  if (ev_eb <= 0) return 'var(--txt2)'
  if (ev_eb <= 15) return 'var(--green)'
  if (ev_eb <= 25) return 'var(--gold2)'
  if (ev_eb <= 40) return 'var(--orange)'
  return 'var(--red)'
}

export default function MARadarPage() {
  const { showWorking } = useWorkingPopup()
  const { getAdjusted } = useNewsData()
  // Overlay live per-ticker data from RapidAPI onto every Company row.
  const { mergeCompany, deriveCompany } = useLiveSnapshot()
  const LIVE_COMPANIES = COMPANIES.map((co) => mergeCompany(co))
  const [fsaPanelCo, setFsaPanelCo] = useState<typeof COMPANIES[number] | null>(null)
  // Small helper to open an audit popup keyed by ticker — looks up
  // the ORIGINAL baseline row so deriveCompany() runs on the raw
  // editorial snapshot, not on an already-scaled live row.
  const openAudit = (
    co: { ticker: string },
    which: 'ev' | 'ev_eb' | 'acqs'
  ) => {
    const baseline =
      COMPANIES.find((b) => b.ticker === co.ticker) ?? (co as typeof COMPANIES[number])
    const metrics = deriveCompany(baseline)
    if (which === 'ev') return showWorking(wkEVAudit(metrics))
    if (which === 'ev_eb') return showWorking(wkEVEBITDAAudit(metrics))
    return showWorking(wkAcqScoreAudit(metrics))
  }

  const strongBuy = LIVE_COMPANIES.filter((c) => c.acqs >= 9).length
  const consider = LIVE_COMPANIES.filter((c) => c.acqs >= 7 && c.acqs < 9).length
  const monitor = LIVE_COMPANIES.filter((c) => c.acqs >= 5 && c.acqs < 7).length
  const pass = LIVE_COMPANIES.filter((c) => c.acqs < 5).length
  const privateTargets = PRIVATE_COMPANIES.length

  const top = LIVE_COMPANIES.filter((c) => c.acqs >= 8).sort((a, b) => b.acqs - a.acqs)
  const all = [...LIVE_COMPANIES].sort((a, b) => b.acqs - a.acqs)

  const kpiStrongBuyDef: WorkingDef = wkDashboardKPI(
    'Strong Buy (9–10)',
    String(strongBuy),
    'Companies with acquisition score ≥ 9',
    [
      {
        label: 'Universe',
        calc: 'COMPANIES',
        result: `${COMPANIES.length} listed firms`,
      },
      { label: 'Filter', calc: 'acqs >= 9', result: `${strongBuy} matches` },
      {
        label: 'Meaning',
        calc: 'Top-tier acquisition candidates',
        result: 'Pursue with priority',
      },
    ],
    [{ name: 'Acquisition Score Model', color: 'var(--gold2)', note: 'Proprietary' }]
  )

  const kpiConsiderDef: WorkingDef = wkDashboardKPI(
    'Consider (7–8)',
    String(consider),
    'Companies with acquisition score between 7 and 8',
    [
      { label: 'Filter', calc: '7 <= acqs < 9', result: `${consider} matches` },
      {
        label: 'Meaning',
        calc: 'Viable with diligence',
        result: 'Deeper due diligence required',
      },
    ],
    [{ name: 'Acquisition Score Model', color: 'var(--gold2)', note: 'Proprietary' }]
  )

  const kpiMonitorDef: WorkingDef = wkDashboardKPI(
    'Monitor (5–6)',
    String(monitor),
    'Companies with acquisition score between 5 and 6',
    [
      { label: 'Filter', calc: '5 <= acqs < 7', result: `${monitor} matches` },
      {
        label: 'Meaning',
        calc: 'Watch for entry point',
        result: 'Track quarterly, no active pursuit',
      },
    ],
    [{ name: 'Acquisition Score Model', color: 'var(--gold2)', note: 'Proprietary' }]
  )

  const kpiPassDef: WorkingDef = wkDashboardKPI(
    'Pass (1–4)',
    String(pass),
    'Companies with acquisition score below 5',
    [
      { label: 'Filter', calc: 'acqs < 5', result: `${pass} matches` },
      {
        label: 'Meaning',
        calc: 'Size/valuation/strategic barrier',
        result: 'Not actionable in current window',
      },
    ],
    [{ name: 'Acquisition Score Model', color: 'var(--gold2)', note: 'Proprietary' }]
  )

  const kpiPrivateDef: WorkingDef = wkDashboardKPI(
    'Private Targets',
    String(privateTargets),
    'Total unlisted companies in PRIVATE_COMPANIES dataset',
    [
      {
        label: 'Dataset',
        calc: 'PRIVATE_COMPANIES.length',
        result: `${privateTargets} firms`,
      },
      {
        label: 'Meaning',
        calc: 'Unlisted but acquirable',
        result: 'Evaluate via private-targets tab',
      },
    ],
    [{ name: 'Private Targets Dataset', color: 'var(--gold2)', note: 'Internal research' }]
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
          <span className="dn-wordmark">Deal<em>Nector</em></span> <span style={{ margin: '0 6px' }}>›</span> M&A Intelligence
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
          M&A <em style={{ color: 'var(--gold2)', fontStyle: 'italic' }}>Radar</em> — All Segments
        </h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge variant="gray">
            Consolidated acquisition intelligence across entire value chain
          </Badge>
          <DataRefreshButton />
        </div>
      </div>

      <QuotaBanner />

      {/* KPI Row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <KpiTile
          label="Strong Buy (9–10)"
          value={strongBuy}
          sub="Ideal targets"
          color="green"
          onClick={() => showWorking(kpiStrongBuyDef)}
        />
        <KpiTile
          label="Consider (7–8)"
          value={consider}
          sub="Viable with diligence"
          onClick={() => showWorking(kpiConsiderDef)}
        />
        <KpiTile
          label="Monitor (5–6)"
          value={monitor}
          sub="Watch for entry"
          color="cyan"
          onClick={() => showWorking(kpiMonitorDef)}
        />
        <KpiTile
          label="Pass (1–4)"
          value={pass}
          sub="Size/valuation barrier"
          color="red"
          onClick={() => showWorking(kpiPassDef)}
        />
        <KpiTile
          label="Private Targets"
          value={privateTargets}
          sub="Unlisted acquirable"
          color="orange"
          onClick={() => showWorking(kpiPrivateDef)}
        />
      </div>

      {/* Strong Buy cards */}
      <div style={STITLE_STYLE}>⭐ STRONG BUY — Ranked Acquisition Targets</div>
      {top.map((co) => {
        const adjusted = getAdjusted(co)
        const postAcqs = adjusted.post.acqs
        const postEvEb = adjusted.post.ev_eb
        const scoreChanged =
          adjusted.hasAdjustment && Math.round(postAcqs * 10) !== Math.round(co.acqs * 10)
        const evEbChanged =
          adjusted.hasAdjustment && co.ev_eb > 0 && Math.abs(postEvEb - co.ev_eb) > 0.005
        return (
        <div
          key={co.ticker}
          style={{
            ...CARD_STYLE,
            borderLeft: co.acqs >= 9 ? '3px solid var(--gold2)' : '3px solid var(--br2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <div
              style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
              title="Click for full driver-by-driver audit (live metrics)"
              onClick={() => openAudit(co, 'acqs')}
            >
              <ScoreBadge score={co.acqs} size={40} />
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
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--txt)' }}>
                {co.name}{' '}
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--txt3)',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  ({co.ticker})
                </span>
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--gold2)',
                  margin: '5px 0',
                  fontFamily: 'JetBrains Mono, monospace',
                  cursor: 'pointer',
                  borderBottom: '1px dotted var(--gold2)',
                  display: 'inline-block',
                }}
                title="Click for full EV / EV/EBITDA calculation audit"
                onClick={() => openAudit(co, 'ev_eb')}
              >
                Rev ₹{co.rev.toLocaleString('en-IN')}Cr · EBITDA {co.ebm}% · EV ₹
                {co.ev > 0 ? co.ev.toLocaleString('en-IN') + 'Cr' : 'N/A'} · EV/EBITDA{' '}
                {co.ev_eb > 0 ? co.ev_eb + '×' : '—'}
                {evEbChanged && (
                  <span
                    style={{
                      fontSize: 10,
                      marginLeft: 4,
                      color: postEvEb >= co.ev_eb ? 'var(--green)' : 'var(--red)',
                      fontWeight: 700,
                    }}
                  >
                    → {postEvEb.toFixed(2)}×
                  </span>
                )}
                {' '}· D/E {co.dbt_eq} · RevGr {co.revg}%
              </div>
              <div style={{ fontSize: 13, color: 'var(--txt2)' }}>{co.rea}</div>
              <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 5 }}>
                Components:{' '}
                {co.comp.map((id) => CHAIN.find((c) => c.id === id)?.name || id).join(' · ')}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                alignItems: 'flex-end',
                flexShrink: 0,
              }}
            >
              <div
                style={{ cursor: 'pointer' }}
                title="Why this flag?"
                onClick={() => showWorking(wkAcqFlag(co.acqf, co.rea))}
              >
                <Badge variant={co.acqs >= 9 ? 'green' : co.acqs >= 7 ? 'gold' : 'cyan'}>
                  {co.acqf}
                </Badge>
              </div>
              <Badge variant={co.sec === 'solar' ? 'gold' : 'cyan'}>
                {co.sec.toUpperCase()}
              </Badge>
              <ExpressInterestButton
                ticker={co.ticker}
                companyName={co.name}
                dealType="listed"
                sector={co.sec}
                rationale={co.rea}
                sourcePage="maradar"
              />
              <a
                href={`/report/${co.ticker}?print=1`}
                target="_blank"
                rel="noopener noreferrer"
                title="Open full institutional PDF report"
                style={{
                  background: 'var(--golddim)',
                  border: '1px solid var(--gold2)',
                  color: 'var(--gold2)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.4px',
                  textTransform: 'uppercase',
                  padding: '4px 10px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  textDecoration: 'none',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                ◈ PDF Report
              </a>
              <button
                onClick={() => setFsaPanelCo(co)}
                title="Open FSA Intelligence Panel"
                style={{
                  background: 'rgba(74,144,217,0.1)',
                  border: '1px solid rgba(74,144,217,0.3)',
                  color: 'var(--cyan)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.4px',
                  textTransform: 'uppercase',
                  padding: '4px 10px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                📊 FSA
              </button>
            </div>
          </div>
        </div>
        )
      })}

      {/* All companies table */}
      <div style={STITLE_STYLE}>📋 All Companies — Ranked by Score</div>
      <div
        style={{
          overflowX: 'auto',
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--s3)' }}>
              {[
                'Score',
                'Company',
                'Sector',
                'Mkt Cap ₹Cr',
                'EV ₹Cr',
                'EV/EBITDA',
                'Rev Gr%',
                'EBITDA%',
                'D/E',
                'Flag',
                'Action',
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '10px 12px',
                    textAlign: 'left',
                    fontSize: 11,
                    color: 'var(--txt2)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    borderBottom: '1px solid var(--br)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {all.map((co) => {
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
              <tr
                key={co.ticker}
                style={{
                  borderBottom: '1px solid var(--br)',
                  background: co.acqs >= 8 ? 'var(--golddim)' : undefined,
                }}
              >
                <td
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    borderBottom: '1px dotted var(--gold2)',
                  }}
                  title="Click for full driver-by-driver audit (live metrics)"
                  onClick={() => openAudit(co, 'acqs')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <ScoreBadge score={co.acqs} />
                    {scoreChanged && (
                      <span
                        style={{
                          fontSize: 9,
                          fontFamily: 'JetBrains Mono, monospace',
                          color: postAcqs >= co.acqs ? 'var(--green)' : 'var(--red)',
                          fontWeight: 700,
                        }}
                      >
                        → {postAcqs.toFixed(1)}
                      </span>
                    )}
                  </div>
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--txt)', whiteSpace: 'nowrap' }}>
                  {co.acqs >= 8 ? '★ ' : ''}
                  {co.name}
                  <br />
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--txt3)',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    {co.ticker}
                  </span>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <Badge variant={co.sec === 'solar' ? 'gold' : 'cyan'}>{co.sec}</Badge>
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--txt2)' }}>
                  {co.mktcap > 0 ? '₹' + co.mktcap.toLocaleString('en-IN') : 'Private'}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: 'var(--gold2)',
                    cursor: 'pointer',
                    borderBottom: '1px dotted var(--gold2)',
                  }}
                  title="Click for full Enterprise Value audit (baseline → live)"
                  onClick={() => openAudit(co, 'ev')}
                >
                  {co.ev > 0 ? '₹' + co.ev.toLocaleString('en-IN') : '—'}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: evColor(co.ev_eb),
                    cursor: 'pointer',
                    borderBottom: '1px dotted var(--gold2)',
                  }}
                  title="Click for full EV/EBITDA calculation audit"
                  onClick={() => openAudit(co, 'ev_eb')}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' }}>
                    <span>{co.ev_eb > 0 ? co.ev_eb + '×' : '—'}</span>
                    {evEbChanged && (
                      <span
                        style={{
                          fontSize: 9,
                          fontFamily: 'JetBrains Mono, monospace',
                          color: postEvEb >= co.ev_eb ? 'var(--green)' : 'var(--red)',
                          fontWeight: 700,
                        }}
                      >
                        → {postEvEb.toFixed(2)}×
                      </span>
                    )}
                  </div>
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: tdColor(co.revg >= 25, co.revg >= 12),
                    cursor: 'pointer',
                    borderBottom: '1px dotted var(--gold2)',
                  }}
                  title="How is revenue growth derived?"
                  onClick={() => showWorking(wkRevGrowth(co))}
                >
                  {co.revg}%
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: tdColor(co.ebm >= 15, co.ebm >= 10),
                    cursor: 'pointer',
                    borderBottom: '1px dotted var(--gold2)',
                  }}
                  title="How is the EBITDA margin calculated?"
                  onClick={() => showWorking(wkEBITDAMargin(co))}
                >
                  {co.ebm}%
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: tdColor(co.dbt_eq <= 0.3, co.dbt_eq <= 0.7),
                    cursor: 'pointer',
                    borderBottom: '1px dotted var(--gold2)',
                  }}
                  title="How is the debt/equity derived?"
                  onClick={() => showWorking(wkDebtEquity(co))}
                >
                  {co.dbt_eq}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    cursor: 'pointer',
                    borderBottom: '1px dotted var(--gold2)',
                  }}
                  title="Why this flag?"
                  onClick={() => showWorking(wkAcqFlag(co.acqf, co.rea))}
                >
                  <Badge
                    variant={
                      co.acqs >= 8
                        ? 'green'
                        : co.acqs >= 6
                          ? 'gold'
                          : co.acqs >= 4
                            ? 'cyan'
                            : 'red'
                    }
                  >
                    {co.acqf}
                  </Badge>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <ExpressInterestButton
                      ticker={co.ticker}
                      companyName={co.name}
                      dealType="listed"
                      sector={co.sec}
                      rationale={co.rea}
                      sourcePage="maradar"
                    />
                    <a
                      href={`/report/${co.ticker}?print=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open full institutional PDF report"
                      style={{
                        background: 'var(--golddim)',
                        border: '1px solid var(--gold2)',
                        color: 'var(--gold2)',
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.3px',
                        textTransform: 'uppercase',
                        padding: '3px 8px',
                        borderRadius: 3,
                        cursor: 'pointer',
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      PDF
                    </a>
                    <button
                      onClick={() => setFsaPanelCo(co)}
                      title="Open FSA Intelligence Panel"
                      style={{
                        background: 'rgba(74,144,217,0.1)',
                        border: '1px solid rgba(74,144,217,0.3)',
                        color: 'var(--cyan)',
                        fontSize: 10,
                        fontWeight: 700,
                        letterSpacing: '0.3px',
                        textTransform: 'uppercase',
                        padding: '3px 8px',
                        borderRadius: 3,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      FSA
                    </button>
                  </div>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* FSA Intelligence Panel */}
      {fsaPanelCo && (
        <FSAIntelligencePanel
          company={fsaPanelCo}
          peers={LIVE_COMPANIES.filter(c => c.ticker !== fsaPanelCo.ticker && (c.comp || []).some(s => (fsaPanelCo.comp || []).includes(s))).slice(0, 5)}
          onClose={() => setFsaPanelCo(null)}
        />
      )}
    </div>
  )
}
