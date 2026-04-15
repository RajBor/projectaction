'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { COMPANIES } from '@/lib/data/companies'
import { PRIVATE_COMPANIES } from '@/lib/data/private-companies'
import { CHAIN, GROUPS } from '@/lib/data/chain'
import { DataRefreshButton } from '@/components/live/DataRefreshButton'
import { QuotaBanner } from '@/components/live/QuotaBanner'
import { Badge } from '@/components/ui/Badge'
import { useIndustryFilter } from '@/hooks/useIndustryFilter'
import { useIndustryAtlas } from '@/hooks/useIndustryAtlas'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'
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

// ── Industry-specific policy/market headline tiles (swap per selected
// industry). Keep 1–2 bite-sized headlines that would actually matter to
// a strategy team — capacity targets, scheme sizes, CAGR anchors.
type IndHeadline = {
  label: string
  value: string
  sub: string
  color?: 'gold' | 'red' | 'green' | 'cyan' | 'orange' | 'purple'
}
const INDUSTRY_HEADLINES: Record<string, IndHeadline[]> = {
  solar: [
    { label: 'Solar Addition Needed', value: '280GW', sub: 'FY24 → FY30 target' },
    { label: 'PLI Scheme (Modules)', value: '₹24,000 Cr', sub: 'Tier-I ALMM outlay', color: 'gold' },
  ],
  td: [
    { label: 'RDSS Scheme', value: '₹3.03L Cr', sub: 'T&D investment', color: 'purple' },
    { label: 'Smart Meters', value: '25Cr units', sub: 'FY25–27 tender pipeline', color: 'cyan' },
  ],
  wind_energy: [
    { label: 'Wind Addition Needed', value: '100GW', sub: 'FY24 → FY30 target', color: 'cyan' },
    { label: 'Offshore Wind', value: '30GW', sub: '2030 national target', color: 'purple' },
  ],
  energy_storage: [
    { label: 'BESS Target', value: '74GWh', sub: '2031–32 national target', color: 'purple' },
    { label: 'Viability Gap Funding', value: '₹3,760 Cr', sub: '4,000 MWh scheme', color: 'orange' },
  ],
  green_hydrogen: [
    { label: 'Green H₂ Target', value: '5 MMT', sub: 'FY30 production goal', color: 'green' },
    { label: 'National Mission', value: '₹19,744 Cr', sub: 'SIGHT outlay', color: 'gold' },
  ],
  ev_batteries: [
    { label: 'Cell PLI (ACC)', value: '₹18,100 Cr', sub: '50 GWh outlay', color: 'orange' },
    { label: 'EV Penetration', value: '30%', sub: '2030 passenger target', color: 'green' },
  ],
  solar_pv_and_renewable_energy: [
    { label: 'Renewable Target', value: '500GW', sub: 'FY30 non-fossil goal' },
    { label: 'PLI Scheme (Modules)', value: '₹24,000 Cr', sub: 'Tier-I ALMM outlay', color: 'gold' },
  ],
}
// Default used when no explicit headline map is defined for a selected id
const INDUSTRY_HEADLINES_DEFAULT: IndHeadline[] = [
  { label: 'RE Target', value: '500GW', sub: 'FY30 non-fossil goal' },
  { label: 'Net Zero', value: '2070', sub: 'India commitment', color: 'green' },
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

// Unique value chain segment IDs across all hardcoded companies. Atlas-
// seeded segments (wind, hydrogen, etc.) get merged in at render time so
// the segment filter dropdown on the Dashboard stays in sync with the
// selected industries.
const HARDCODED_SEGMENTS = Array.from(
  new Set([
    ...COMPANIES.flatMap((c) => c.comp || []),
    ...PRIVATE_COMPANIES.flatMap((c) => c.comp || []),
  ])
).sort()

// Unified target shape so listed + private render the same way
interface UnifiedTarget {
  name: string
  ticker: string
  sec: string
  comp: string[]
  mktcap: number
  ev: number
  ev_eb: number
  ebm: number
  acqs: number
  acqf: string
  rea: string
  kind: 'listed' | 'private'
}

function unifyListed(co: typeof COMPANIES[number]): UnifiedTarget {
  return { ...co, kind: 'listed' }
}
function unifyPrivate(co: typeof PRIVATE_COMPANIES[number]): UnifiedTarget {
  return {
    name: co.name, ticker: co.name.replace(/\s+/g, '').toUpperCase().slice(0, 10),
    sec: co.sec, comp: co.comp, mktcap: co.ev_est, ev: co.ev_est,
    ev_eb: co.ev_est > 0 && co.ebm_est > 0 ? Math.round((co.ev_est / (co.rev_est * co.ebm_est / 100)) * 10) / 10 : 0,
    ebm: co.ebm_est, acqs: co.acqs, acqf: co.acqf, rea: co.rea, kind: 'private',
  }
}

export default function DashboardPage() {
  const { showWorking } = useWorkingPopup()
  const { getAdjusted } = useNewsData()
  const [segFilter, setSegFilter] = useState<string>('all')
  const { selectedIndustries, isSelected: isIndustrySelected, toggleIndustry, availableIndustries, loadingIndustries, maxIndustries } = useIndustryFilter()
  const { atlasChain, atlasListed, atlasPrivate } = useIndustryAtlas()
  // `allCompanies` = static COMPANIES with admin-pushed DB overrides
  // merged on top (see LiveSnapshotProvider). Using this instead of the
  // bare COMPANIES seed lets the "Push to Website" flow in the admin
  // Data Sources tab drive live updates on the Dashboard KPI cards.
  const { allCompanies } = useLiveSnapshot()
  const [showCustomize, setShowCustomize] = useState(false)

  // Merged datasets — DB-overridden listed + atlas-seeded additions.
  // Every downstream filter then runs against the merged lists so admin-
  // added industries show up across the Dashboard immediately.
  const mergedChain = useMemo(() => [...CHAIN, ...atlasChain], [atlasChain])
  const mergedListed = useMemo(() => [...allCompanies, ...atlasListed], [allCompanies, atlasListed])
  const mergedPrivate = useMemo(() => [...PRIVATE_COMPANIES, ...atlasPrivate], [atlasPrivate])

  // Build unified target list — filtered by selected industries + segment filter
  const allTargets = useMemo<UnifiedTarget[]>(() => {
    const listed = mergedListed.filter((c) => c.acqs >= 7 && isIndustrySelected(c.sec)).map(unifyListed)
    const priv = mergedPrivate.filter((c) => c.acqs >= 7 && isIndustrySelected(c.sec)).map(unifyPrivate)
    const combined = [...listed, ...priv].sort((a, b) => b.acqs - a.acqs)
    if (segFilter === 'all') return combined
    return combined.filter((c) => c.comp.includes(segFilter))
  }, [segFilter, isIndustrySelected, mergedListed, mergedPrivate])

  const topPicks = mergedListed.filter((c) => c.acqs >= 9 && isIndustrySelected(c.sec)).sort((a, b) => b.acqs - a.acqs)
  const crits = mergedChain.filter((c) => c.flag === 'critical' && isIndustrySelected(c.sec))

  // Industry-filtered counts for the KPI row
  const filteredChain = useMemo(() => mergedChain.filter((n) => isIndustrySelected(n.sec)), [isIndustrySelected, mergedChain])
  const filteredListed = useMemo(() => mergedListed.filter((c) => isIndustrySelected(c.sec)), [isIndustrySelected, mergedListed])
  const filteredPrivate = useMemo(() => mergedPrivate.filter((c) => isIndustrySelected(c.sec)), [isIndustrySelected, mergedPrivate])

  // Segment filter dropdown — hardcoded ∪ atlas segments, filtered to the
  // currently-selected industries so the list never shows wind segments
  // when wind is off.
  const ALL_SEGMENTS = useMemo(() => {
    const s = new Set<string>(HARDCODED_SEGMENTS)
    for (const c of atlasListed) (c.comp || []).forEach((x) => s.add(x))
    for (const c of atlasPrivate) (c.comp || []).forEach((x) => s.add(x))
    // Scope the dropdown to segments that actually exist under selected industries
    const allowed = new Set(
      mergedChain.filter((n) => isIndustrySelected(n.sec)).map((n) => n.id)
    )
    return Array.from(s).filter((seg) => allowed.has(seg)).sort()
  }, [atlasListed, atlasPrivate, mergedChain, isIndustrySelected])

  // Merge hardcoded GROUPS with atlas-seeded stages grouped by industry
  // label, so wind/green-hydrogen/etc. get their own column in the value-
  // chain flow view.
  const mergedGroups = useMemo<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = { ...GROUPS }
    for (const node of atlasChain) {
      const ind = availableIndustries.find((a) => a.id === node.sec)
      const indLabel = ind?.label || node.sec
      const grpKey = `${indLabel} — ${node.cat}`
      if (!out[grpKey]) out[grpKey] = []
      out[grpKey].push(node.id)
    }
    return out
  }, [atlasChain, availableIndustries])
  const strongBuyListed = useMemo(() => filteredListed.filter((c) => c.acqs >= 9).length, [filteredListed])
  const strongBuyPrivate = useMemo(() => filteredPrivate.filter((c) => c.acqs >= 9).length, [filteredPrivate])
  const considerListed = useMemo(() => filteredListed.filter((c) => c.acqs >= 7 && c.acqs < 9).length, [filteredListed])
  const considerPrivate = useMemo(() => filteredPrivate.filter((c) => c.acqs >= 7 && c.acqs < 9).length, [filteredPrivate])

  // Resolve per-industry headline tiles — up to 2 headlines from the first
  // selected industry so the KPI row stays compact. Falls back to default.
  const industryHeadlines: IndHeadline[] = useMemo(() => {
    for (const id of selectedIndustries) {
      const h = INDUSTRY_HEADLINES[id]
      if (h && h.length > 0) return h.slice(0, 2)
    }
    return INDUSTRY_HEADLINES_DEFAULT
  }, [selectedIndustries])

  const wlCount = 0
  const dsCount = 0

  const kpiNodesDef: WorkingDef = wkDashboardKPI(
    'Value Chain Nodes',
    String(filteredChain.length),
    `Tracked nodes in the currently selected industries (${selectedIndustries.join(', ') || 'none'})`,
    [
      {
        label: 'Total nodes in dataset',
        calc: 'COUNT(CHAIN[])',
        result: `${CHAIN.length} nodes`,
      },
      {
        label: 'Industry filter',
        calc: 'CHAIN.filter(isIndustrySelected(sec))',
        result: `${filteredChain.length} match`,
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
    String(filteredListed.length + filteredPrivate.length),
    `Listed + private firms in the currently selected industries (${selectedIndustries.join(', ') || 'none'})`,
    [
      {
        label: 'Listed (filtered)',
        calc: 'COMPANIES.filter(isIndustrySelected(sec))',
        result: `${filteredListed.length} firms`,
      },
      {
        label: 'Private (filtered)',
        calc: 'PRIVATE_COMPANIES.filter(isIndustrySelected(sec))',
        result: `${filteredPrivate.length} firms`,
      },
      {
        label: 'Dataset total',
        calc: 'COMPANIES.length + PRIVATE_COMPANIES.length',
        result: `${COMPANIES.length + PRIVATE_COMPANIES.length} firms`,
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
          <DataRefreshButton compact />
          {/* Active industry chip — always visible so users know at a glance
              which industries the dashboard, value chain and peer lists are
              currently filtered to. */}
          <div
            title="Selected industries — click Customize to change"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              marginLeft: 'auto',
              padding: '4px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600,
              background: 'var(--golddim)',
              border: '1px solid var(--gold2)',
              color: 'var(--gold2)',
              fontFamily: "'JetBrains Mono',monospace",
              letterSpacing: '0.3px',
            }}
          >
            <span style={{ opacity: 0.7, fontWeight: 500, fontSize: 10 }}>Industry:</span>
            {selectedIndustries.length === 0 ? (
              <span style={{ color: 'var(--txt3)' }}>None</span>
            ) : (
              selectedIndustries.map((id, i) => {
                const ind = availableIndustries.find((a) => a.id === id)
                const icon = ind?.icon || (id === 'solar' ? '☀' : id === 'td' ? '⚡' : '📁')
                const label = ind?.label || (id === 'solar' ? 'Solar' : id === 'td' ? 'T&D' : id)
                return (
                  <span key={id}>
                    {icon} {label}
                    {i < selectedIndustries.length - 1 ? ' ·' : ''}
                  </span>
                )
              })
            )}
          </div>
          <button
            onClick={() => setShowCustomize(!showCustomize)}
            style={{
              background: showCustomize ? 'var(--golddim)' : 'var(--s3)',
              border: `1px solid ${showCustomize ? 'var(--gold2)' : 'var(--br)'}`,
              color: showCustomize ? 'var(--gold2)' : 'var(--txt2)',
              padding: '4px 12px', borderRadius: 4, fontSize: 11, fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ⚙ Customize
          </button>
        </div>

        {/* Customize panel — industry selection */}
        {showCustomize && (
          <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt2)' }}>Industries:</span>
            {loadingIndustries && availableIndustries.length === 0 ? (
              <span style={{ fontSize: 11, color: 'var(--txt4)' }}>Loading…</span>
            ) : availableIndustries.length === 0 ? (
              <span style={{ fontSize: 11, color: 'var(--txt4)' }}>No industries registered yet.</span>
            ) : (
              availableIndustries.map((opt) => {
                const on = isIndustrySelected(opt.id)
                const icon = opt.icon || '📁'
                return (
                  <button
                    key={opt.id}
                    onClick={() => toggleIndustry(opt.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '5px 10px', borderRadius: 4, fontSize: 11, fontWeight: 600, cursor: 'pointer',
                      background: on ? 'rgba(212,164,59,0.12)' : 'transparent',
                      border: `1px solid ${on ? 'var(--gold2)' : 'var(--br2)'}`,
                      color: on ? 'var(--gold2)' : 'var(--txt3)',
                    }}
                  >
                    <span style={{
                      width: 14, height: 14, borderRadius: 3, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      border: `1.5px solid ${on ? 'var(--gold2)' : 'var(--br2)'}`,
                      background: on ? 'var(--gold2)' : 'transparent',
                      color: '#000', fontSize: 9, fontWeight: 700,
                    }}>{on ? '✓' : ''}</span>
                    {icon} {opt.label}
                  </button>
                )
              })
            )}
            <span style={{ fontSize: 9, color: 'var(--txt4)', marginLeft: 'auto' }}>
              {selectedIndustries.length} of {availableIndustries.length} selected{maxIndustries !== Infinity ? ` · Max ${maxIndustries}` : ''}
            </span>
          </div>
        )}
      </div>

      <QuotaBanner />

      <div style={PANEL_STYLE}>
        {/* KPI Row */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <KpiTile
            label="Value Chain Nodes"
            value={filteredChain.length}
            sub={selectedIndustries.length > 0 ? `of ${CHAIN.length} total` : 'Tracked components'}
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
            value={filteredListed.length + filteredPrivate.length}
            sub={`${filteredListed.length} listed · ${filteredPrivate.length} private`}
            color="green"
            onClick={() => showWorking(kpiCompaniesDef)}
          />
          {/* Potential Acquisition Pipeline — compact tile */}
          <div
            style={{
              flex: '1.3 1 220px',
              background: 'var(--golddim)',
              border: '1px solid var(--gold2)',
              borderTop: '3px solid var(--gold2)',
              borderRadius: 6,
              padding: '12px 16px 10px',
              cursor: 'pointer',
              minWidth: 220,
              maxWidth: 340,
            }}
            onClick={() => showWorking(kpiStrongBuyDef)}
            title="Potential acquisition targets across listed + private"
          >
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--gold2)', marginBottom: 8 }}>
              Potential Acquisition Pipeline
            </div>
            <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
              {/* Strong Buy column */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--gold2)', marginBottom: 4 }}>
                  Strong Buy
                </div>
                <div style={{ fontFamily: 'Source Serif 4, Georgia, serif', fontSize: 36, fontWeight: 700, color: 'var(--gold2)', lineHeight: 1 }}>
                  {strongBuyListed + strongBuyPrivate}
                </div>
                <div style={{ fontSize: 9, color: 'var(--txt3)', marginTop: 4 }}>Score 9–10</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 6, fontSize: 10 }}>
                  <span style={{ color: 'var(--txt2)' }}>Listed <strong style={{ color: 'var(--txt)' }}>{strongBuyListed}</strong></span>
                  <span style={{ color: 'var(--txt2)' }}>Private <strong style={{ color: 'var(--purple)' }}>{strongBuyPrivate}</strong></span>
                </div>
              </div>
              {/* Divider */}
              <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--gold2)', opacity: 0.25 }} />
              {/* Consider column */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--cyan2)', marginBottom: 4 }}>
                  Consider
                </div>
                <div style={{ fontFamily: 'Source Serif 4, Georgia, serif', fontSize: 36, fontWeight: 700, color: 'var(--cyan2)', lineHeight: 1 }}>
                  {considerListed + considerPrivate}
                </div>
                <div style={{ fontSize: 9, color: 'var(--txt3)', marginTop: 4 }}>Score 7–8</div>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 6, fontSize: 10 }}>
                  <span style={{ color: 'var(--txt2)' }}>Listed <strong style={{ color: 'var(--txt)' }}>{considerListed}</strong></span>
                  <span style={{ color: 'var(--txt2)' }}>Private <strong style={{ color: 'var(--purple)' }}>{considerPrivate}</strong></span>
                </div>
              </div>
            </div>
          </div>
          <KpiTile label="Watchlist" value={wlCount} sub="Saved companies" color="cyan" />
          <KpiTile label="Deal Pipeline" value={dsCount} sub="Active deals" color="orange" />
          {industryHeadlines.map((h) => (
            <KpiTile
              key={h.label}
              label={h.label}
              value={h.value}
              sub={h.sub}
              color={h.color}
            />
          ))}
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
            {Object.entries(mergedGroups)
              .filter(([, ids]) => {
                // Respect the sidebar industry filter — a group is visible
                // if ANY of its node ids belong to a selected industry.
                return ids.some((id) => {
                  const node = mergedChain.find((n) => n.id === id)
                  return node ? isIndustrySelected(node.sec) : false
                })
              })
              .map(([grp, ids]) => {
              const isSol = grp.startsWith('Solar')
              const isTd = grp.startsWith('T&D')
              const hdrColor = isSol ? 'var(--gold2)' : isTd ? 'var(--cyan2)' : 'var(--purple)'
              const hdrBg = isSol ? 'var(--golddim)' : isTd ? 'var(--cyandim)' : 'rgba(155,90,230,0.15)'
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
                      background: hdrBg,
                      borderRadius: 4,
                      border: `1px solid ${hdrColor}`,
                      textAlign: 'center',
                      marginBottom: 4,
                    }}
                  >
                    {grp.replace(/.* — /, '')}
                  </div>
                  {(ids as string[]).map((id) => {
                    const c = mergedChain.find((x) => x.id === id)
                    if (!c) return null
                    const dotColor =
                      c.flag === 'critical'
                        ? 'var(--red)'
                        : c.flag === 'high'
                          ? 'var(--orange)'
                          : 'var(--gold2)'
                    // Click any tile to jump straight to its dedicated
                    // value-chain page with the ?seg=<id> query param so
                    // the page opens on the right segment with a back
                    // link to the dashboard.
                    return (
                      <Link
                        key={id}
                        href={`/valuechain?seg=${id}&from=dashboard`}
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
                          textDecoration: 'none',
                          transition: 'border-color 0.15s, background 0.15s',
                        }}
                        title={`Open ${c.name} in Value Chain`}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = 'var(--gold2)'
                          e.currentTarget.style.background = 'var(--s3)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = 'var(--br)'
                          e.currentTarget.style.background = 'var(--s2)'
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
                        <span
                          style={{
                            marginLeft: 'auto',
                            fontSize: 10,
                            color: 'var(--txt3)',
                          }}
                        >
                          →
                        </span>
                      </Link>
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
            <div style={{ ...STITLE_STYLE, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span>⭐ Top Acquisition Targets ({allTargets.length})</span>
              {/* Value chain segment filter */}
              <select
                value={segFilter}
                onChange={(e) => setSegFilter(e.target.value)}
                style={{
                  background: 'var(--s3)',
                  border: '1px solid var(--br2)',
                  color: 'var(--txt)',
                  padding: '4px 8px',
                  fontSize: 10,
                  borderRadius: 4,
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  maxWidth: 180,
                }}
              >
                <option value="all">All segments</option>
                {ALL_SEGMENTS.map((seg) => (
                  <option key={seg} value={seg}>
                    {seg.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ maxHeight: 520, overflowY: 'auto' }}>
            {allTargets.slice(0, 20).map((co) => {
              // For listed companies, we can show news-adjusted metrics.
              // Look in the live universe (static ∪ user_companies ∪ atlas)
              // so admin-pushed SMEs (e.g. Eppeltone) get news adjustments
              // instead of falling back to "no baseline".
              const baseCo = co.kind === 'listed'
                ? allCompanies.find((c) => c.ticker === co.ticker)
                : null
              const adjusted = baseCo ? getAdjusted(baseCo) : null
              const borderColor =
                co.acqs >= 9
                  ? 'var(--gold2)'
                  : co.acqs >= 8
                    ? 'var(--green)'
                    : 'var(--cyan2)'
              return (
              <div
                key={co.ticker + co.kind}
                style={{
                  ...ACQ_CARD_STYLE,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  borderLeft: `3px solid ${borderColor}`,
                }}
              >
                <ScoreBadge score={co.acqs} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)' }}>
                    {co.name}{' '}
                    {co.kind === 'private' && (
                      <span style={{ fontSize: 8, color: 'var(--purple)', letterSpacing: '0.6px', fontWeight: 700 }}>PRIVATE</span>
                    )}
                    {co.kind === 'listed' && (
                      <span style={{ fontSize: 11, color: 'var(--txt3)', fontFamily: 'JetBrains Mono, monospace' }}>{co.ticker}</span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--gold2)', margin: '2px 0' }}>
                    EV ₹{co.ev > 0 ? co.ev.toLocaleString('en-IN') : 'N/A'} Cr
                    {co.ev_eb > 0 && <> · {co.ev_eb}×</>}
                    {' '}· {co.ebm}% margin
                    {adjusted && adjusted.hasAdjustment && (
                      <span style={{ fontSize: 10, marginLeft: 6, color: adjusted.post.acqs >= co.acqs ? 'var(--green)' : 'var(--red)', fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>
                        → {adjusted.post.acqs.toFixed(1)}/10
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>
                    {co.comp.slice(0, 3).map((s) => s.replace(/_/g, ' ')).join(' · ')}
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                  <Badge variant={co.acqs >= 9 ? 'green' : co.acqs >= 8 ? 'gold' : 'cyan'}>
                    {co.acqf}
                  </Badge>
                  <Badge variant={co.sec === 'solar' ? 'gold' : 'cyan'}>
                    {co.sec.toUpperCase()}
                  </Badge>
                </div>
              </div>
              )
            })}
            {allTargets.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--txt3)', fontSize: 12, fontStyle: 'italic' }}>
                No targets match this segment filter.
              </div>
            )}
            </div>
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
