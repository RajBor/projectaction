'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { CHAIN, GROUPS, type ChainNode } from '@/lib/data/chain'
import { COMPANIES, type Company } from '@/lib/data/companies'
import { PRIVATE_COMPANIES, type PrivateCompany } from '@/lib/data/private-companies'
import { POLICIES } from '@/lib/data/policies'
import { Badge } from '@/components/ui/Badge'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { useWorkingPopup } from '@/components/working/WorkingPopup'
import { useIndustryFilter } from '@/hooks/useIndustryFilter'
import { useIndustryAtlas } from '@/hooks/useIndustryAtlas'
import { AddToPortfolioModal } from '@/components/portfolio/AddToPortfolioModal'
import { AddToDealModal } from '@/components/portfolio/AddToDealModal'
import { CommodityPanel } from '@/components/live/CommodityPanel'
import { QuotaBanner } from '@/components/live/QuotaBanner'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'
import {
  wkChainMarketSize,
  wkEVAudit,
  wkEVEBITDAAudit,
  wkAcqScoreAudit,
  wkEBITDAMargin,
  wkAcqFlag,
  wkRevGrowth,
  wkPE,
  wkDebtEquity,
} from '@/lib/working'

type TabId = 'overview' | 'market' | 'competitors' | 'valuation' | 'ma' | 'policy' | 'ai'

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'market', label: 'Market Analysis' },
  { id: 'competitors', label: 'Competitors' },
  { id: 'valuation', label: 'Valuation' },
  { id: 'ma', label: 'M&A Targets' },
  { id: 'policy', label: 'Policies' },
  { id: 'ai', label: 'AI Intel' },
]

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

const CARD_STYLE: React.CSSProperties = {
  background: 'var(--s2)',
  border: '1px solid var(--br)',
  borderRadius: 8,
  padding: 16,
}

const CARD_TITLE_STYLE: React.CSSProperties = {
  fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
  fontSize: 14,
  fontWeight: 700,
  color: 'var(--gold2)',
  marginBottom: 8,
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
  return (
    <div
      onClick={onClick}
      title={onClick ? 'Click for methodology' : undefined}
      style={{
        ...KPI_STYLE,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={
        onClick
          ? (e) => {
              e.currentTarget.style.borderColor = main
            }
          : undefined
      }
      onMouseLeave={
        onClick
          ? (e) => {
              e.currentTarget.style.borderColor = 'var(--br)'
            }
          : undefined
      }
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
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
          fontSize: 22,
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

function OverviewTab({ c }: { c: ChainNode }) {
  const { showWorking } = useWorkingPopup()
  return (
    <>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiTile
          label="India Market"
          value={c.mkt.ig}
          sub="FY2024 estimate"
          onClick={() => showWorking(wkChainMarketSize(c))}
        />
        <KpiTile label="India CAGR" value={c.mkt.icagr} sub="2024–2030" />
        <KpiTile
          label="Global Market"
          value={c.mkt.gg}
          sub="Global 2024"
          color="cyan"
          onClick={() => showWorking(wkChainMarketSize(c))}
        />
        <KpiTile label="Global CAGR" value={c.mkt.gcagr} sub="2024–2030" color="cyan" />
        <KpiTile label="Gross Margin" value={c.fin.gm} sub="Industry range" color="green" />
        <KpiTile
          label="EBITDA Margin"
          value={c.fin.eb}
          sub="Industry range"
          color={c.flag === 'critical' ? 'red' : undefined}
        />
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
          marginTop: 20,
        }}
      >
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>🇮🇳 India Market Status</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>{c.mkt.ist}</p>
        </div>
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>🌐 Global Landscape</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>{c.mkt.gc}</p>
          <p style={{ marginTop: 6, color: 'var(--txt3)', fontSize: 12 }}>
            Capex Intensity: {c.fin.capex}
          </p>
        </div>
      </div>
      <div style={STITLE_STYLE}>Strategic Integration Map</div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
        }}
      >
        {[
          { ttl: '▲ Forward Integration', txt: c.str.fwd, color: 'var(--green)' },
          { ttl: '▼ Backward Integration', txt: c.str.bwd, color: 'var(--cyan2)' },
          { ttl: '↑ Organic Growth Path', txt: c.str.org, color: 'var(--gold2)' },
          { ttl: '⊕ Inorganic / M&A', txt: c.str.inorg, color: 'var(--purple)' },
        ].map((item) => (
          <div
            key={item.ttl}
            style={{
              ...CARD_STYLE,
              borderLeft: `3px solid ${item.color}`,
            }}
          >
            <div
              style={{
                fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                fontSize: 13,
                fontWeight: 700,
                color: item.color,
                marginBottom: 8,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              {item.ttl}
            </div>
            <div style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>{item.txt}</div>
          </div>
        ))}
      </div>
      <div style={{ ...CARD_STYLE, marginTop: 14 }}>
        <div style={CARD_TITLE_STYLE}>🏆 Competitive Moat</div>
        <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>{c.fin.moat}</p>
      </div>
    </>
  )
}

function MarketTab({ c }: { c: ChainNode }) {
  const pols = POLICIES.filter((p) => p.comp.includes(c.id))
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 14,
        }}
      >
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>🇮🇳 India Snapshot</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--gold2)' }}>Market Size:</strong> {c.mkt.ig}
            <br />
            <strong style={{ color: 'var(--gold2)' }}>CAGR 2024–30:</strong> {c.mkt.icagr}
            <br />
            <strong style={{ color: 'var(--gold2)' }}>Status:</strong> {c.mkt.ist}
          </p>
        </div>
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>🌐 Global Snapshot</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--txt)' }}>Market Size:</strong> {c.mkt.gg}
            <br />
            <strong style={{ color: 'var(--txt)' }}>CAGR 2024–30:</strong> {c.mkt.gcagr}
            <br />
            <strong style={{ color: 'var(--txt)' }}>Leaders:</strong> {c.mkt.gc}
          </p>
        </div>
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          marginTop: 14,
        }}
      >
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>📈 Demand Drivers</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>
            500GW RE 2030 · PM Surya Ghar · RDSS DISCOMs · PM-KUSUM · Green Energy Corridor
          </p>
        </div>
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>🏭 Supply Enablers</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>
            PLI Solar ₹24,000Cr · PLI-ACC ₹18,100Cr · ALMM mandate · BCD protection
          </p>
        </div>
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>⚠️ Key Risks</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>
            China import dependency · CRGO/silver cost · Policy continuity · Financing cost ·
            Technology obsolescence
          </p>
        </div>
      </div>
      <div style={STITLE_STYLE}>Mapped Policies ({pols.length})</div>
      {pols.length > 0 ? (
        pols.map((p) => (
          <div
            key={p.name}
            style={{
              ...CARD_STYLE,
              marginBottom: 8,
              display: 'grid',
              gridTemplateColumns: '1fr 2fr auto',
              gap: 14,
              alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{p.name}</div>
              <div style={{ marginTop: 4 }}>
                <Badge variant="gray">{p.sh}</Badge>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt2)' }}>{p.desc}</div>
            <Badge variant={p.imp === 'Direct' ? 'red' : 'cyan'}>{p.imp}</Badge>
          </div>
        ))
      ) : (
        <p style={{ fontSize: 13, color: 'var(--txt3)', fontStyle: 'italic' }}>
          No policies directly mapped
        </p>
      )}
    </>
  )
}

function CompetitorsTab({ c }: { c: ChainNode }) {
  const { showWorking } = useWorkingPopup()
  const { mergeCompany, deriveCompany } = useLiveSnapshot()
  const comps = COMPANIES.filter((co) => co.comp.includes(c.id)).map((co) =>
    mergeCompany(co)
  )
  const openAudit = (co: Company, which: 'ev' | 'ev_eb' | 'acqs') => {
    const baseline = COMPANIES.find((b) => b.ticker === co.ticker) ?? co
    const metrics = deriveCompany(baseline)
    if (which === 'ev') return showWorking(wkEVAudit(metrics))
    if (which === 'ev_eb') return showWorking(wkEVEBITDAAudit(metrics))
    return showWorking(wkAcqScoreAudit(metrics))
  }
  const clickStyle: React.CSSProperties = {
    cursor: 'pointer',
    borderBottom: '1px dotted var(--br2)',
  }
  return (
    <>
      <div style={STITLE_STYLE}>India Players ({comps.length} tracked)</div>
      {comps.length > 0 ? (
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
                  'Company',
                  'Revenue ₹Cr',
                  'EBITDA Margin',
                  'Mkt Cap ₹Cr',
                  'EV/EBITDA',
                  'Score',
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
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {comps.map((co) => (
                <tr key={co.ticker} style={{ borderBottom: '1px solid var(--br)' }}>
                  <td style={{ padding: '10px 12px', color: 'var(--txt)' }}>
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
                  <td style={{ padding: '10px 12px', color: 'var(--gold2)' }}>
                    ₹{co.rev.toLocaleString('en-IN')}
                  </td>
                  <td
                    onClick={() => showWorking(wkEBITDAMargin(co))}
                    title="Click to see calculation"
                    style={{
                      padding: '10px 12px',
                      color: tdColor(co.ebm >= 15, co.ebm >= 10),
                      ...clickStyle,
                    }}
                  >
                    {co.ebm}%
                  </td>
                  <td
                    onClick={co.mktcap > 0 ? () => openAudit(co, 'ev') : undefined}
                    title={co.mktcap > 0 ? 'Click for full EV audit' : undefined}
                    style={{
                      padding: '10px 12px',
                      color: 'var(--txt2)',
                      ...(co.mktcap > 0 ? clickStyle : {}),
                    }}
                  >
                    {co.mktcap > 0 ? '₹' + co.mktcap.toLocaleString('en-IN') : 'Private'}
                  </td>
                  <td
                    onClick={co.ev_eb > 0 ? () => openAudit(co, 'ev_eb') : undefined}
                    title={co.ev_eb > 0 ? 'Click for full EV/EBITDA audit' : undefined}
                    style={{
                      padding: '10px 12px',
                      color: tdColor(co.ev_eb > 0 && co.ev_eb <= 20, co.ev_eb <= 35),
                      ...(co.ev_eb > 0 ? clickStyle : {}),
                    }}
                  >
                    {co.ev_eb > 0 ? co.ev_eb + '×' : '—'}
                  </td>
                  <td
                    onClick={() => openAudit(co, 'acqs')}
                    title="Click for driver-by-driver acquisition score audit"
                    style={{ padding: '10px 12px', cursor: 'pointer' }}
                  >
                    <ScoreBadge score={co.acqs} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: 'var(--txt3)', fontStyle: 'italic' }}>
          No India companies tracked for this component
        </p>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
          marginTop: 16,
        }}
      >
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>🏆 Moat</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>{c.fin.moat}</p>
        </div>
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>💰 Margin Range</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>
            Gross: {c.fin.gm}
            <br />
            EBITDA: {c.fin.eb}
          </p>
        </div>
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>🔧 Capex</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>{c.fin.capex}</p>
        </div>
      </div>
    </>
  )
}

function ValuationTab({ c }: { c: ChainNode }) {
  const { showWorking } = useWorkingPopup()
  const { mergeCompany, deriveCompany } = useLiveSnapshot()
  const comps = COMPANIES.filter((co) => co.comp.includes(c.id)).map((co) =>
    mergeCompany(co)
  )
  const privComps = PRIVATE_COMPANIES.filter((co) => co.comp.includes(c.id))
  const top = comps.filter((co) => co.acqs >= 8).sort((a, b) => b.acqs - a.acqs)
  const openAudit = (co: Company, which: 'ev' | 'ev_eb' | 'acqs') => {
    const baseline = COMPANIES.find((b) => b.ticker === co.ticker) ?? co
    const metrics = deriveCompany(baseline)
    if (which === 'ev') return showWorking(wkEVAudit(metrics))
    if (which === 'ev_eb') return showWorking(wkEVEBITDAAudit(metrics))
    return showWorking(wkAcqScoreAudit(metrics))
  }
  const clickStyle: React.CSSProperties = {
    cursor: 'pointer',
    borderBottom: '1px dotted var(--br2)',
  }
  // Modal state for Portfolio + Deal adds
  const [wlTarget, setWlTarget] = useState<
    { kind: 'listed'; co: Company } | { kind: 'private'; co: PrivateCompany } | null
  >(null)
  const [dealTarget, setDealTarget] = useState<
    { name: string; ev: string; sector: string } | null
  >(null)
  const openWlListed = (co: Company) => setWlTarget({ kind: 'listed', co })
  const openWlPrivate = (co: PrivateCompany) => setWlTarget({ kind: 'private', co })
  const openDealListed = (co: Company) =>
    setDealTarget({
      name: co.name,
      ev: co.ev > 0 ? `₹${co.ev.toLocaleString('en-IN')}Cr` : '',
      sector: co.sec,
    })
  const openDealPrivate = (co: PrivateCompany) =>
    setDealTarget({
      name: co.name,
      ev: co.ev_est > 0 ? `₹${co.ev_est.toLocaleString('en-IN')}Cr` : '',
      sector: co.sec,
    })
  return (
    <>
      {top.length > 0 && (
        <>
          <div style={STITLE_STYLE}>⭐ Top Acquisition Picks for {c.name}</div>
          {top.map((co) => (
            <div
              key={co.ticker}
              style={{
                ...CARD_STYLE,
                marginBottom: 10,
                display: 'flex',
                gap: 12,
                borderLeft: '3px solid var(--gold2)',
              }}
            >
              <div
                onClick={() => openAudit(co, 'acqs')}
                title="Click for driver-by-driver audit (live metrics)"
                style={{ cursor: 'pointer' }}
              >
                <ScoreBadge score={co.acqs} size={36} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)' }}>
                  ★ {co.name}{' '}
                  <span style={{ fontSize: 12, color: 'var(--txt3)' }}>({co.ticker})</span>
                </div>
                <div style={{ fontSize: 13, color: 'var(--gold2)', margin: '4px 0' }}>
                  EV: ₹{co.ev > 0 ? co.ev.toLocaleString('en-IN') + 'Cr' : 'N/A'} · EV/EBITDA:{' '}
                  {co.ev_eb > 0 ? co.ev_eb + '×' : '—'} · EBITDA: {co.ebm}% · Rev Gr:{' '}
                  {co.revg}%
                </div>
                <div style={{ fontSize: 13, color: 'var(--txt2)' }}>{co.rea}</div>
              </div>
              <div
                onClick={() => showWorking(wkAcqFlag(co.acqf, co.rea))}
                title="Click for flag methodology"
                style={{ cursor: 'pointer' }}
              >
                <Badge variant="green">{co.acqf}</Badge>
              </div>
            </div>
          ))}
        </>
      )}
      <div style={STITLE_STYLE}>All Tracked Companies</div>
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
                'Company',
                'Rev ₹Cr',
                'EBITDA%',
                'EV ₹Cr',
                'EV/EBITDA',
                'P/E',
                'D/E',
                'Rev Gr%',
                'Score',
                'Flag',
                'Actions',
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
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comps.map((co) => (
              <tr key={co.ticker} style={{ borderBottom: '1px solid var(--br)' }}>
                <td style={{ padding: '10px 12px', color: 'var(--txt)' }}>
                  {co.acqs >= 8 ? '★ ' : ''}
                  {co.name}
                  <br />
                  <span style={{ fontSize: 11, color: 'var(--txt3)' }}>{co.ticker}</span>
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--gold2)' }}>
                  ₹{co.rev.toLocaleString('en-IN')}
                </td>
                <td
                  onClick={() => showWorking(wkEBITDAMargin(co))}
                  title="Click to see calculation"
                  style={{
                    padding: '10px 12px',
                    color: tdColor(co.ebm >= 15, co.ebm >= 10),
                    ...clickStyle,
                  }}
                >
                  {co.ebm}%
                </td>
                <td
                  onClick={co.ev > 0 ? () => openAudit(co, 'ev') : undefined}
                  title={co.ev > 0 ? 'Click for full EV audit' : undefined}
                  style={{
                    padding: '10px 12px',
                    color: 'var(--txt2)',
                    ...(co.ev > 0 ? clickStyle : {}),
                  }}
                >
                  {co.ev > 0 ? '₹' + co.ev.toLocaleString('en-IN') : '—'}
                </td>
                <td
                  onClick={co.ev_eb > 0 ? () => openAudit(co, 'ev_eb') : undefined}
                  title={co.ev_eb > 0 ? 'Click for full EV/EBITDA audit' : undefined}
                  style={{
                    padding: '10px 12px',
                    color: tdColor(co.ev_eb > 0 && co.ev_eb <= 15, co.ev_eb <= 25),
                    ...(co.ev_eb > 0 ? clickStyle : {}),
                  }}
                >
                  {co.ev_eb > 0 ? co.ev_eb + '×' : '—'}
                </td>
                <td
                  onClick={co.pe ? () => showWorking(wkPE(co)) : undefined}
                  title={co.pe ? 'Click to see calculation' : undefined}
                  style={{
                    padding: '10px 12px',
                    color: tdColor(co.pe > 0 && co.pe <= 25, co.pe <= 45),
                    ...(co.pe ? clickStyle : {}),
                  }}
                >
                  {co.pe || '—'}
                </td>
                <td
                  onClick={() => showWorking(wkDebtEquity(co))}
                  title="Click to see calculation"
                  style={{
                    padding: '10px 12px',
                    color: tdColor(co.dbt_eq <= 0.3, co.dbt_eq <= 0.7),
                    ...clickStyle,
                  }}
                >
                  {co.dbt_eq}
                </td>
                <td
                  onClick={() => showWorking(wkRevGrowth(co))}
                  title="Click to see calculation"
                  style={{
                    padding: '10px 12px',
                    color: tdColor(co.revg >= 25, co.revg >= 12),
                    ...clickStyle,
                  }}
                >
                  {co.revg}%
                </td>
                <td
                  onClick={() => openAudit(co, 'acqs')}
                  title="Click for driver-by-driver audit (live metrics)"
                  style={{ padding: '10px 12px', cursor: 'pointer' }}
                >
                  <ScoreBadge score={co.acqs} />
                </td>
                <td
                  onClick={() => showWorking(wkAcqFlag(co.acqf, co.rea))}
                  title="Click for flag methodology"
                  style={{ padding: '10px 12px', cursor: 'pointer' }}
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
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                  <button
                    onClick={() => openWlListed(co)}
                    title="Add to a portfolio / watchlist"
                    style={actionBtn('gold')}
                  >
                    + WL
                  </button>
                  <button
                    onClick={() => openDealListed(co)}
                    title="Add to deal pipeline"
                    style={{ ...actionBtn('cyan'), marginLeft: 4 }}
                  >
                    + Deal
                  </button>
                </td>
              </tr>
            ))}
            {/* Private companies in this segment */}
            {privComps.map((co) => (
              <tr
                key={`priv-${co.name}`}
                style={{ borderBottom: '1px solid var(--br)', background: 'rgba(120, 80, 200, 0.04)' }}
              >
                <td style={{ padding: '10px 12px', color: 'var(--txt)' }}>
                  {co.acqs >= 8 ? '★ ' : ''}
                  {co.name}
                  <br />
                  <span style={{ fontSize: 10, color: 'var(--purple)', letterSpacing: '0.5px' }}>
                    PRIVATE · {co.stage}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--gold2)' }}>
                  ₹{co.rev_est.toLocaleString('en-IN')}
                  <span style={{ fontSize: 9, color: 'var(--txt3)', marginLeft: 3 }}>est</span>
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--txt2)' }}>
                  {co.ebm_est}%
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--txt2)' }}>
                  {co.ev_est > 0 ? '₹' + co.ev_est.toLocaleString('en-IN') : '—'}
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--txt3)' }}>—</td>
                <td style={{ padding: '10px 12px', color: 'var(--txt3)' }}>—</td>
                <td style={{ padding: '10px 12px', color: 'var(--txt3)' }}>—</td>
                <td style={{ padding: '10px 12px', color: 'var(--txt2)' }}>
                  {co.revg_est}%
                </td>
                <td style={{ padding: '10px 12px', cursor: 'default' }}>
                  <ScoreBadge score={co.acqs} />
                </td>
                <td style={{ padding: '10px 12px' }}>
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
                <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                  <button
                    onClick={() => openWlPrivate(co)}
                    title="Add to a portfolio / watchlist"
                    style={actionBtn('gold')}
                  >
                    + WL
                  </button>
                  <button
                    onClick={() => openDealPrivate(co)}
                    title="Add to deal pipeline"
                    style={{ ...actionBtn('cyan'), marginLeft: 4 }}
                  >
                    + Deal
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AddToPortfolioModal target={wlTarget} onClose={() => setWlTarget(null)} />
      <AddToDealModal target={dealTarget} onClose={() => setDealTarget(null)} />
    </>
  )
}

function actionBtn(tone: 'gold' | 'cyan'): React.CSSProperties {
  return {
    background: tone === 'gold' ? 'var(--golddim)' : 'var(--cyandim)',
    border: `1px solid ${tone === 'gold' ? 'var(--gold2)' : 'var(--cyan2)'}`,
    color: tone === 'gold' ? 'var(--gold2)' : 'var(--cyan2)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.3px',
    textTransform: 'uppercase',
    padding: '3px 8px',
    borderRadius: 3,
    cursor: 'pointer',
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  }
}

function MATab({ c }: { c: ChainNode }) {
  const { mergeCompany } = useLiveSnapshot()
  const comps = COMPANIES.filter((co) => co.comp.includes(c.id))
    .map((co) => mergeCompany(co))
    .sort((a, b) => b.acqs - a.acqs)
  const privComps = PRIVATE_COMPANIES.filter((co) => co.comp.includes(c.id)).sort(
    (a, b) => b.acqs - a.acqs
  )
  const [wlTarget, setWlTarget] = useState<
    { kind: 'listed'; co: Company } | { kind: 'private'; co: PrivateCompany } | null
  >(null)
  const [dealTarget, setDealTarget] = useState<
    { name: string; ev: string; sector: string } | null
  >(null)
  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 14,
        }}
      >
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>📊 Valuation Metrics</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>
            EV/EBITDA primary · EV/Revenue pre-profit · P/E listed · DCF greenfield · Book
            asset-heavy
            <br />
            <br />
            <strong style={{ color: 'var(--green)' }}>≤15× EV/EBITDA</strong> = attractive
            <br />
            <strong style={{ color: 'var(--gold2)' }}>15–25×</strong> = fair
            <br />
            <strong style={{ color: 'var(--red)' }}>35×+</strong> = expensive
          </p>
        </div>
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>🔑 Deal Structures</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>
            Staged 20%→51%→100%
            <br />
            Earnout on PLI/ALMM milestones
            <br />
            JV with tech transfer clause
            <br />
            Asset vs share deal
            <br />
            Convertible note for startups
          </p>
        </div>
        <div style={CARD_STYLE}>
          <div style={CARD_TITLE_STYLE}>⚠️ Diligence Focus</div>
          <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.5 }}>
            ALMM/PLI eligibility status
            <br />
            Capacity utilisation %<br />
            Customer HHI (concentration)
            <br />
            DSO/DIO working capital
            <br />
            Related-party transactions
          </p>
        </div>
      </div>
      <div style={STITLE_STYLE}>Ranked Targets — {c.name} ({comps.length + privComps.length})</div>
      {comps.map((co) => (
        <div
          key={co.ticker}
          style={{
            ...CARD_STYLE,
            marginBottom: 10,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            borderLeft: co.acqs >= 8 ? '3px solid var(--gold2)' : undefined,
          }}
        >
          <ScoreBadge score={co.acqs} size={36} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)' }}>
              {co.acqs >= 8 ? '★ ' : ''}
              {co.name} <span style={{ fontSize: 12, color: 'var(--txt3)' }}>({co.ticker})</span>{' '}
              <span style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '0.8px' }}>
                · LISTED
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--gold2)', margin: '3px 0' }}>
              EV: ₹{co.ev > 0 ? co.ev.toLocaleString('en-IN') + 'Cr' : 'N/A'} · EV/EBITDA:{' '}
              {co.ev_eb > 0 ? co.ev_eb + '×' : '—'} · Rev Gr: {co.revg}%
            </div>
            <div style={{ fontSize: 13, color: 'var(--txt2)' }}>{co.rea}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <Badge variant={co.acqs >= 8 ? 'green' : co.acqs >= 6 ? 'gold' : 'cyan'}>
              {co.acqf}
            </Badge>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setWlTarget({ kind: 'listed', co })} style={actionBtn('gold')}>
                + WL
              </button>
              <button
                onClick={() =>
                  setDealTarget({
                    name: co.name,
                    ev: co.ev > 0 ? `₹${co.ev.toLocaleString('en-IN')}Cr` : '',
                    sector: co.sec,
                  })
                }
                style={actionBtn('cyan')}
              >
                + Deal
              </button>
            </div>
          </div>
        </div>
      ))}
      {/* Private companies in this segment */}
      {privComps.map((co) => (
        <div
          key={`priv-${co.name}`}
          style={{
            ...CARD_STYLE,
            marginBottom: 10,
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            borderLeft: co.acqs >= 8 ? '3px solid var(--purple)' : '3px solid rgba(120,80,200,0.4)',
            background: 'rgba(120, 80, 200, 0.04)',
          }}
        >
          <ScoreBadge score={co.acqs} size={36} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)' }}>
              {co.acqs >= 8 ? '★ ' : ''}
              {co.name}{' '}
              <span style={{ fontSize: 9, color: 'var(--purple)', letterSpacing: '0.8px' }}>
                · PRIVATE · {co.stage}
              </span>
            </div>
            <div style={{ fontSize: 13, color: 'var(--gold2)', margin: '3px 0' }}>
              EV est: ₹{co.ev_est > 0 ? co.ev_est.toLocaleString('en-IN') + 'Cr' : 'N/A'} · Rev est: ₹
              {co.rev_est.toLocaleString('en-IN')}Cr · EBITDA: {co.ebm_est}% · Rev Gr est: {co.revg_est}%
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
              {co.hq} · {co.tech} · {co.ipo}
            </div>
            <div style={{ fontSize: 13, color: 'var(--txt2)', marginTop: 4 }}>{co.rea}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
            <Badge variant={co.acqs >= 8 ? 'green' : co.acqs >= 6 ? 'gold' : 'cyan'}>
              {co.acqf}
            </Badge>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setWlTarget({ kind: 'private', co })} style={actionBtn('gold')}>
                + WL
              </button>
              <button
                onClick={() =>
                  setDealTarget({
                    name: co.name,
                    ev: co.ev_est > 0 ? `₹${co.ev_est.toLocaleString('en-IN')}Cr` : '',
                    sector: co.sec,
                  })
                }
                style={actionBtn('cyan')}
              >
                + Deal
              </button>
            </div>
          </div>
        </div>
      ))}
      <AddToPortfolioModal target={wlTarget} onClose={() => setWlTarget(null)} />
      <AddToDealModal target={dealTarget} onClose={() => setDealTarget(null)} />
    </>
  )
}

function PolicyTab({ c }: { c: ChainNode }) {
  const dir = POLICIES.filter((p) => p.comp.includes(c.id) && p.imp === 'Direct')
  const ind = POLICIES.filter((p) => p.comp.includes(c.id) && p.imp === 'Indirect')
  return (
    <>
      <div style={STITLE_STYLE}>Direct Impact ({dir.length} schemes)</div>
      {dir.length > 0 ? (
        dir.map((p) => (
          <div
            key={p.name}
            style={{
              ...CARD_STYLE,
              marginBottom: 8,
              display: 'grid',
              gridTemplateColumns: '1fr 2fr',
              gap: 14,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{p.name}</div>
              <div style={{ marginTop: 4 }}>
                <Badge variant="red">{p.sh}</Badge>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt2)' }}>{p.desc}</div>
          </div>
        ))
      ) : (
        <p
          style={{
            fontSize: 13,
            color: 'var(--txt3)',
            fontStyle: 'italic',
            marginBottom: 12,
          }}
        >
          None
        </p>
      )}
      <div style={STITLE_STYLE}>Indirect Impact ({ind.length} schemes)</div>
      {ind.length > 0 ? (
        ind.map((p) => (
          <div
            key={p.name}
            style={{
              ...CARD_STYLE,
              marginBottom: 8,
              display: 'grid',
              gridTemplateColumns: '1fr 2fr',
              gap: 14,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>{p.name}</div>
              <div style={{ marginTop: 4 }}>
                <Badge variant="cyan">{p.sh}</Badge>
              </div>
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt2)' }}>{p.desc}</div>
          </div>
        ))
      ) : (
        <p
          style={{
            fontSize: 13,
            color: 'var(--txt3)',
            fontStyle: 'italic',
            marginBottom: 12,
          }}
        >
          None
        </p>
      )}
      <div style={STITLE_STYLE}>All Schemes Reference</div>
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
              {['Scheme', 'Full Name', `Impact on ${c.name}`].map((h) => (
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
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {POLICIES.map((p) => {
              const mapped = p.comp.includes(c.id)
              const direct = mapped && p.imp === 'Direct'
              return (
                <tr key={p.name} style={{ borderBottom: '1px solid var(--br)' }}>
                  <td style={{ padding: '10px 12px', color: 'var(--txt)' }}>{p.sh}</td>
                  <td style={{ padding: '10px 12px', color: 'var(--txt2)' }}>{p.name}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <Badge variant={direct ? 'red' : mapped ? 'cyan' : 'gray'}>
                      {mapped ? p.imp : 'Peripheral'}
                    </Badge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}

function AITab({ c }: { c: ChainNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 8,
          alignItems: 'center',
          padding: 12,
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          borderRadius: 8,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--txt3)', marginRight: 6 }}>Quick queries:</span>
        {[
          '📰 Latest News',
          '🎯 M&A Targets',
          '💰 Financials',
          '🏛 Policy Update',
          '🔮 Strategy Brief',
          '📊 Refresh Data',
        ].map((label) => (
          <button
            key={label}
            style={{
              background: 'var(--s3)',
              border: '1px solid var(--br)',
              color: 'var(--txt2)',
              padding: '6px 12px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        style={{
          ...CARD_STYLE,
          minHeight: 220,
        }}
      >
        <div
          style={{
            padding: 12,
            background: 'var(--s1)',
            borderRadius: 6,
            fontSize: 13,
            color: 'var(--txt2)',
            lineHeight: 1.6,
          }}
        >
          <strong style={{ color: 'var(--gold2)' }}>DealNector AI</strong> — Powered by Claude +
          Live Web Search
          <br />
          <br />
          Analysing: <em style={{ color: 'var(--txt)' }}>{c.name}</em> | India Solar & T&D Value
          Chain
          <br />
          ⚠️ Enter your Anthropic API key in the header bar to activate live AI queries.
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: 12,
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
        }}
      >
        <input
          type="text"
          placeholder={`Ask anything about ${c.name}...`}
          style={{
            flex: 1,
            background: 'var(--s1)',
            border: '1px solid var(--br)',
            color: 'var(--txt)',
            padding: '8px 12px',
            borderRadius: 4,
            fontSize: 13,
          }}
        />
        <button
          style={{
            background: 'var(--gold2)',
            color: 'var(--bg)',
            border: 'none',
            padding: '8px 16px',
            borderRadius: 4,
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Send ↗
        </button>
      </div>
    </div>
  )
}

export default function ValueChainPage() {
  const searchParams = useSearchParams()
  const segParam = searchParams?.get('seg')
  const fromParam = searchParams?.get('from')
  const { isSelected: isIndustrySelected, availableIndustries } = useIndustryFilter()
  const { atlasChain } = useIndustryAtlas()

  // Merged CHAIN (hardcoded + atlas) then filter by selected industries
  const mergedChain = [...CHAIN, ...atlasChain]
  const filteredChain = mergedChain.filter(n => isIndustrySelected(n.sec))

  // Merge GROUPS with atlas-seeded stages grouped by industry label so
  // admin-added industries get their own picker categories.
  const mergedGroups: Record<string, string[]> = { ...GROUPS }
  for (const node of atlasChain) {
    const ind = availableIndustries.find((a) => a.id === node.sec)
    const indLabel = ind?.label || node.sec
    const grpKey = `${indLabel} — ${node.cat}`
    if (!mergedGroups[grpKey]) mergedGroups[grpKey] = []
    mergedGroups[grpKey].push(node.id)
  }
  const filteredGroups = Object.fromEntries(
    Object.entries(mergedGroups).filter(([, ids]) => {
      // Keep the group if ANY of its node ids belong to a selected industry.
      return ids.some((id) => {
        const node = mergedChain.find((n) => n.id === id)
        return node ? isIndustrySelected(node.sec) : false
      })
    })
  )

  // Seed the active segment from ?seg=... when present so deep links
  // from the dashboard, other pages, or a manual URL land on the right
  // segment. Falls back to the first solar module node.
  const initialCompId =
    segParam && filteredChain.some((x) => x.id === segParam) ? segParam : (filteredChain[0]?.id || 'solar_modules')

  const [activeCompId, setActiveCompId] = useState<string>(initialCompId)
  const [activeTab, setActiveTab] = useState<TabId>('overview')

  // Reset active segment when industry filter changes and current segment is no longer visible
  useEffect(() => {
    if (filteredChain.length > 0 && !filteredChain.some(n => n.id === activeCompId)) {
      setActiveCompId(filteredChain[0].id)
    }
  }, [filteredChain, activeCompId])

  // Collapsible Select-Component picker — saves vertical space on
  // wide dashboards. Expanded by default; toggled via the header bar.
  const [pickerOpen, setPickerOpen] = useState<boolean>(false)
  // Each group inside the picker can also be collapsed independently
  // so users can hide the category they don't care about right now.
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  // React to external ?seg=... changes (e.g. the dashboard linking
  // directly to a segment while the page is already mounted).
  useEffect(() => {
    if (segParam && filteredChain.some((x) => x.id === segParam)) {
      setActiveCompId(segParam)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segParam])

  const c = filteredChain.find((x) => x.id === activeCompId) || filteredChain[0]
  if (!c) return <div>Component not found</div>

  const toggleGroup = (grp: string) =>
    setCollapsedGroups((prev) => ({ ...prev, [grp]: !prev[grp] }))

  const flagVariant: 'red' | 'orange' | 'cyan' =
    c.flag === 'critical' ? 'red' : c.flag === 'high' ? 'orange' : 'cyan'
  const nmParts = c.name.split(' ')

  return (
    <div>
      {/* Back-to-dashboard navigation — shown when the user arrived
          via a dashboard tile (or any URL with ?from=dashboard). */}
      {fromParam === 'dashboard' && (
        <div style={{ marginBottom: 12 }}>
          <Link
            href="/dashboard"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--s2)',
              border: '1px solid var(--br2)',
              color: 'var(--txt2)',
              padding: '6px 12px',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.6px',
              textTransform: 'uppercase',
              borderRadius: 4,
              textDecoration: 'none',
              fontFamily: 'inherit',
              transition: 'border-color 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--gold2)'
              e.currentTarget.style.color = 'var(--gold2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--br2)'
              e.currentTarget.style.color = 'var(--txt2)'
            }}
          >
            ← Back to Dashboard
          </Link>
        </div>
      )}

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
          Value Chain <span style={{ margin: '0 6px' }}>›</span> {c.cat}
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
          {nmParts[0]}{' '}
          <em style={{ color: 'var(--gold2)', fontStyle: 'italic' }}>
            {nmParts.slice(1).join(' ')}
          </em>
        </h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge variant={flagVariant}>{c.flag.toUpperCase()} PRIORITY</Badge>
          <Badge variant={c.sec === 'solar' ? 'gold' : 'cyan'}>{c.sec.toUpperCase()}</Badge>
          <Badge variant="gray">India: {c.mkt.ig}</Badge>
          <Badge variant="gray">CAGR: {c.mkt.icagr}</Badge>
          <Badge variant="gray">EBITDA: {c.fin.eb}</Badge>
        </div>
      </div>

      <QuotaBanner />

      {/* Live commodity pressure for the selected segment */}
      <CommodityPanel activeSegmentId={activeCompId} />

      {/* Component picker — collapsible to de-clutter the page */}
      <div
        style={{
          marginBottom: 16,
          padding: 14,
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          borderRadius: 8,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: pickerOpen ? 10 : 0,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--txt3)',
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
            }}
          >
            Select Component
            {!pickerOpen && (
              <span style={{ marginLeft: 10, color: 'var(--gold2)' }}>
                · Currently: {c.name}
              </span>
            )}
          </div>
          <button
            onClick={() => setPickerOpen((v) => !v)}
            title={pickerOpen ? 'Collapse the segment picker' : 'Expand the segment picker'}
            style={{
              background: pickerOpen ? 'var(--s3)' : 'var(--golddim)',
              color: pickerOpen ? 'var(--txt2)' : 'var(--gold2)',
              border: `1px solid ${pickerOpen ? 'var(--br2)' : 'var(--gold2)'}`,
              padding: '4px 10px',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              borderRadius: 3,
              fontFamily: 'inherit',
            }}
          >
            {pickerOpen ? '− Collapse' : '+ Expand'}
          </button>
        </div>
        {pickerOpen && (
        <div style={{ display: 'flex', gap: 14, overflowX: 'auto' }}>
          {Object.entries(filteredGroups).map(([grp, ids]) => {
            const isSol = grp.startsWith('Solar')
            const hdrColor = isSol ? 'var(--gold2)' : 'var(--cyan2)'
            const isCollapsed = !!collapsedGroups[grp]
            return (
              <div
                key={grp}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                  minWidth: isCollapsed ? 120 : 160,
                }}
              >
                <button
                  onClick={() => toggleGroup(grp)}
                  title={isCollapsed ? `Expand ${grp}` : `Collapse ${grp}`}
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
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 6,
                  }}
                >
                  <span>{grp.replace('Solar — ', '').replace('T&D — ', '')}</span>
                  <span>{isCollapsed ? '+' : '−'}</span>
                </button>
                {!isCollapsed &&
                  (ids as string[]).map((id) => {
                  const node = filteredChain.find((x) => x.id === id)
                  if (!node) return null
                  const active = id === activeCompId
                  const dotColor =
                    node.flag === 'critical'
                      ? 'var(--red)'
                      : node.flag === 'high'
                        ? 'var(--orange)'
                        : 'var(--gold2)'
                  return (
                    <button
                      key={id}
                      onClick={() => setActiveCompId(id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '8px 10px',
                        background: active ? 'var(--golddim)' : 'var(--s2)',
                        border: active
                          ? '1px solid var(--gold2)'
                          : '1px solid var(--br)',
                        borderRadius: 4,
                        fontSize: 12,
                        color: active ? 'var(--gold2)' : 'var(--txt)',
                        cursor: 'pointer',
                        textAlign: 'left',
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
                      {node.name}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
        )}
      </div>

      {/* Tab bar */}
      <div
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--br)',
          marginBottom: 16,
        }}
      >
        {TABS.map((t) => {
          const active = t.id === activeTab
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '10px 16px',
                fontSize: 13,
                fontWeight: 600,
                color: active ? 'var(--gold2)' : 'var(--txt2)',
                borderBottom: active ? '2px solid var(--gold2)' : '2px solid transparent',
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'overview' && <OverviewTab c={c} />}
        {activeTab === 'market' && <MarketTab c={c} />}
        {activeTab === 'competitors' && <CompetitorsTab c={c} />}
        {activeTab === 'valuation' && <ValuationTab c={c} />}
        {activeTab === 'ma' && <MATab c={c} />}
        {activeTab === 'policy' && <PolicyTab c={c} />}
        {activeTab === 'ai' && <AITab c={c} />}
      </div>
    </div>
  )
}
