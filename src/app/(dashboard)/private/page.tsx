'use client'

import { useMemo, useState } from 'react'
import { PRIVATE_COMPANIES } from '@/lib/data/private-companies'
import type { PrivateCompany } from '@/lib/data/private-companies'
import type { Company } from '@/lib/data/companies'
import { CHAIN } from '@/lib/data/chain'
import { KpiCard } from '@/components/ui/KpiCard'
import { Badge } from '@/components/ui/Badge'
import { ExpressInterestButton } from '@/components/ExpressInterestButton'
import { useWorkingPopup } from '@/components/working/WorkingPopup'
import { wkAcqScore, wkAcqFlag } from '@/lib/working'

// Adapter: PrivateCompany → Company shape so wk helpers (which expect Company) type-check.
function privateToCompany(p: PrivateCompany): Company {
  return {
    name: p.name,
    ticker: '—',
    nse: '—',
    sec: p.sec,
    comp: p.comp,
    mktcap: 0,
    rev: p.rev_est,
    ebitda: Math.round(((p.rev_est || 0) * (p.ebm_est || 0)) / 100),
    pat: 0,
    ev: p.ev_est,
    ev_eb: 0,
    pe: 0,
    pb: 0,
    dbt_eq: 0,
    revg: p.revg_est,
    ebm: p.ebm_est,
    acqs: p.acqs,
    acqf: p.acqf,
    rea: p.rea,
  }
}

type PrivFilter = 'all' | 'solar' | 'td' | 'Pre-IPO' | 'STRONG BUY' | 'CONSIDER'
type PrivSort = 'acqs' | 'rev_est' | 'ev_est' | 'name'

const FILTERS: { key: PrivFilter; label: string }[] = [
  { key: 'all', label: 'All Companies' },
  { key: 'solar', label: '☀ Solar' },
  { key: 'td', label: '⚡ T&D' },
  { key: 'Pre-IPO', label: '📈 Pre-IPO' },
  { key: 'STRONG BUY', label: '⭐ Strong Buy' },
  { key: 'CONSIDER', label: '✅ Consider' },
]

function scoreColor(s: number): string {
  if (s >= 9) return 'var(--green)'
  if (s >= 7) return 'var(--gold2)'
  if (s >= 5) return 'var(--cyan2)'
  return 'var(--txt3)'
}
function scoreBg(s: number): string {
  if (s >= 9) return 'var(--greendim)'
  if (s >= 7) return 'var(--golddim)'
  if (s >= 5) return 'var(--cyandim)'
  return 'var(--s3)'
}
function flagColor(f: string): string {
  if (f === 'STRONG BUY') return 'var(--green)'
  if (f === 'CONSIDER') return 'var(--gold2)'
  if (f === 'MONITOR') return 'var(--cyan2)'
  return 'var(--txt3)'
}
function flagBg(f: string): string {
  if (f === 'STRONG BUY') return 'var(--greendim)'
  if (f === 'CONSIDER') return 'var(--golddim)'
  if (f === 'MONITOR') return 'var(--cyandim)'
  return 'var(--s3)'
}
function stageColor(stage: string): { bg: string; color: string } {
  if (stage === 'Pre-IPO') return { bg: 'var(--golddim)', color: 'var(--gold2)' }
  if (stage === 'BSE SME Listed')
    return { bg: 'var(--cyandim)', color: 'var(--cyan2)' }
  if (stage === 'Pre-IPO (PSU)' || stage === 'Listed-PSU')
    return { bg: 'var(--purpledim)', color: 'var(--purple)' }
  return { bg: 'var(--s3)', color: 'var(--txt2)' }
}
function ipoClass(ipo?: string): string {
  if (!ipo) return 'var(--txt3)'
  const l = ipo.toLowerCase()
  if (l.includes('ipo planned') || l.includes('ipo expected')) return 'var(--green)'
  if (l.includes('no ipo')) return 'var(--red)'
  return 'var(--gold2)'
}

function PrivCard({ c }: { c: PrivateCompany }) {
  const { showWorking } = useWorkingPopup()
  const sColor = scoreColor(c.acqs)
  const sBg = scoreBg(c.acqs)
  const fColor = flagColor(c.acqf)
  const fBg = flagBg(c.acqf)
  const stg = stageColor(c.stage)
  const chain = (c.comp || [])
    .map((id: string) => {
      const ch = CHAIN.find((x) => x.id === id)
      return ch ? ch.name : id
    })
    .join(' · ')
  const ipoC = ipoClass(c.ipo)

  return (
    <div
      style={{
        background: 'var(--s2)',
        border: `1px solid ${c.acqs >= 8 ? 'rgba(247,183,49,0.3)' : 'var(--br)'}`,
        borderRadius: 8,
        padding: 18,
        marginBottom: 14,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {c.acqs >= 8 && (
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 2,
            background: 'linear-gradient(to right, var(--gold2), transparent)',
          }}
        />
      )}

      {/* Header */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 12 }}>
        <div
          onClick={() => showWorking(wkAcqScore(privateToCompany(c)))}
          title="Click for Strategic Analysis score breakdown"
          style={{
            background: sBg,
            color: sColor,
            border: `1.5px solid ${sColor}`,
            width: 44,
            height: 44,
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
            fontSize: 18,
            fontWeight: 700,
            flexShrink: 0,
            cursor: 'pointer',
            transition: 'transform 0.15s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
        >
          {c.acqs}
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                fontSize: 15,
                fontWeight: 700,
                color: 'var(--txt)',
              }}
            >
              {c.acqs >= 8 ? '⭐ ' : ''}
              {c.name}
            </div>
            <span
              style={{
                background: stg.bg,
                color: stg.color,
                border: `1px solid ${stg.color}`,
                padding: '2px 8px',
                borderRadius: 3,
                fontSize: 10,
                fontWeight: 600,
                letterSpacing: '0.5px',
              }}
            >
              {c.stage}
            </span>
            <span
              onClick={() => showWorking(wkAcqFlag(c.acqf, c.rea))}
              title="Click for acquisition flag methodology"
              style={{
                background: fBg,
                color: fColor,
                border: `1px solid ${fColor}`,
                padding: '2px 8px',
                borderRadius: 3,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                borderBottom: `1px dotted ${fColor}`,
              }}
            >
              {c.acqf}
            </span>
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--txt3)',
              marginTop: 4,
            }}
          >
            {c.hq} · Founded {c.founded} · {c.sec.toUpperCase()}
          </div>
        </div>
      </div>

      {/* Capacity */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--txt2)',
          marginBottom: 12,
        }}
      >
        <strong style={{ color: 'var(--txt)' }}>Capacity / Scale:</strong> {c.cap}
      </div>

      {/* KPI grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          marginBottom: 12,
        }}
      >
        {[
          {
            val: c.rev_est ? '₹' + c.rev_est.toLocaleString() + 'Cr' : 'N/A',
            lbl: 'Est. Revenue',
          },
          {
            val: c.ev_est > 0 ? '₹' + c.ev_est.toLocaleString() + 'Cr' : '—',
            lbl: 'Est. EV',
          },
          {
            val: (c.ebm_est || '—') + '%',
            lbl: 'EBITDA% (est.)',
          },
          {
            val: (c.revg_est || '—') + '%',
            lbl: 'Rev Growth',
          },
        ].map((k, i) => (
          <div
            key={i}
            style={{
              background: 'var(--s1)',
              border: '1px solid var(--br)',
              borderRadius: 6,
              padding: '8px 10px',
            }}
          >
            <div
              style={{
                fontFamily: 'JetBrains Mono, monospace',
                fontSize: 13,
                fontWeight: 700,
                color: 'var(--gold2)',
              }}
            >
              {k.val}
            </div>
            <div
              style={{
                fontSize: 9,
                color: 'var(--txt3)',
                letterSpacing: '0.5px',
                marginTop: 2,
              }}
            >
              {k.lbl}
            </div>
          </div>
        ))}
      </div>

      {/* Tech line */}
      <div
        style={{
          fontSize: 11,
          color: 'var(--txt3)',
          marginBottom: 8,
          lineHeight: 1.7,
        }}
      >
        <span style={{ color: 'var(--txt2)', fontWeight: 600 }}>Tech:</span> {c.tech || 'N/A'}
        {'  |  '}
        <span style={{ color: 'var(--txt2)', fontWeight: 600 }}>PLI:</span> {c.pli || 'N/A'}
        {'  |  '}
        <span style={{ color: 'var(--txt2)', fontWeight: 600 }}>ALMM:</span> {c.almm || 'N/A'}
      </div>

      {/* IPO Pill */}
      {c.ipo && (
        <div style={{ marginBottom: 8 }}>
          <span
            style={{
              display: 'inline-block',
              fontSize: 11,
              color: ipoC,
              background: 'var(--s1)',
              border: `1px solid ${ipoC}`,
              padding: '3px 10px',
              borderRadius: 3,
              fontWeight: 500,
            }}
          >
            📋 {c.ipo}
          </span>
        </div>
      )}

      {/* Strategic Note */}
      <div
        style={{
          fontSize: 12,
          color: 'var(--txt2)',
          background: 'var(--s1)',
          borderRadius: 5,
          padding: '10px 12px',
          borderLeft: `3px solid ${fColor}`,
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: fColor }}>Strategic Note:</strong> {c.rea}
      </div>

      <div
        style={{
          fontSize: 11,
          color: 'var(--txt3)',
          marginTop: 8,
        }}
      >
        Value Chain: {chain}
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          gap: 6,
          marginTop: 10,
          flexWrap: 'wrap',
        }}
      >
        <button
          style={{
            background: 'var(--s3)',
            border: '1px solid var(--br2)',
            color: 'var(--txt2)',
            fontSize: 11,
            padding: '4px 10px',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          + Watchlist
        </button>
        <button
          style={{
            background: 'var(--s3)',
            border: '1px solid var(--br2)',
            color: 'var(--txt2)',
            fontSize: 11,
            padding: '4px 10px',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          + Deal Pipeline
        </button>
        {c.ev_est > 0 && (
          <button
            style={{
              background: 'var(--s3)',
              border: '1px solid var(--br2)',
              color: 'var(--txt2)',
              fontSize: 11,
              padding: '4px 10px',
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            Open in DCF
          </button>
        )}
        <ExpressInterestButton
          companyName={c.name}
          dealType="private"
          sector={c.sec}
          rationale={c.rea}
          sourcePage="private"
          size="sm"
        />
      </div>
    </div>
  )
}

export default function PrivatePage() {
  const [filter, setFilter] = useState<PrivFilter>('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<PrivSort>('acqs')

  const data = useMemo(() => {
    let d = PRIVATE_COMPANIES.filter((c) => {
      if (filter === 'solar' && c.sec !== 'solar') return false
      if (filter === 'td' && c.sec !== 'td') return false
      if (filter === 'Pre-IPO' && c.stage !== 'Pre-IPO') return false
      if (filter === 'STRONG BUY' && c.acqf !== 'STRONG BUY') return false
      if (filter === 'CONSIDER' && c.acqf !== 'CONSIDER') return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !c.name.toLowerCase().includes(q) &&
          !(c.hq || '').toLowerCase().includes(q) &&
          !(c.tech || '').toLowerCase().includes(q)
        )
          return false
      }
      return true
    })
    d = [...d].sort((a, b) => {
      if (sort === 'acqs') return b.acqs - a.acqs
      if (sort === 'rev_est') return (b.rev_est || 0) - (a.rev_est || 0)
      if (sort === 'ev_est') return (b.ev_est || 0) - (a.ev_est || 0)
      if (sort === 'name') return a.name.localeCompare(b.name)
      return 0
    })
    return d
  }, [filter, search, sort])

  const totalRev = PRIVATE_COMPANIES.reduce((s, c) => s + (c.rev_est || 0), 0)
  const totalEV = PRIVATE_COMPANIES.reduce((s, c) => s + (c.ev_est || 0), 0)
  const preIpo = PRIVATE_COMPANIES.filter((c) => c.stage === 'Pre-IPO').length
  const strongBuy = PRIVATE_COMPANIES.filter((c) => c.acqf === 'STRONG BUY').length

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          <span className="dn-wordmark">Deal<em>Nector</em></span> <span style={{ margin: '0 6px' }}>›</span> Target Intelligence
        </div>
        <h1
          style={{
            fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
          }}
        >
          Private &amp; Unlisted{' '}
          <em style={{ color: 'var(--gold2)', fontStyle: 'normal' }}>Target Assets</em>
        </h1>
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Badge variant="gold">{PRIVATE_COMPANIES.length} Private Companies</Badge>
          <Badge variant="gray">Pre-IPO · Family-Owned · PE-Backed · Strategic Targets</Badge>
          <Badge variant="cyan">India Solar + T&amp;D Value Chain</Badge>
          <button
            style={{
              background: 'var(--green)',
              border: '1px solid var(--green)',
              color: '#fff',
              fontSize: 12,
              padding: '4px 14px',
              borderRadius: 4,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            + Add Private Company
          </button>
        </div>
      </div>

      {/* KPI Summary */}
      <div
        style={{
          display: 'flex',
          gap: 14,
          marginBottom: 20,
          flexWrap: 'wrap',
        }}
      >
        <KpiCard
          label="Private Targets"
          value={String(PRIVATE_COMPANIES.length)}
          sub="All sectors"
          color="gold"
          delay={0}
        />
        <KpiCard
          label="Pre-IPO"
          value={String(preIpo)}
          sub="Near-term listing"
          color="cyan"
          delay={0.07}
        />
        <KpiCard
          label="Strong Buy"
          value={String(strongBuy)}
          sub="High conviction"
          color="green"
          delay={0.14}
        />
        <KpiCard
          label="Total Est. Revenue"
          value={`₹${Math.round(totalRev / 1000)}K Cr`}
          sub="Aggregate across targets"
          color="orange"
          delay={0.21}
        />
        <KpiCard
          label="Total Est. EV"
          value={`₹${Math.round(totalEV / 1000)}K Cr`}
          sub="Enterprise value"
          color="purple"
          delay={0.28}
        />
      </div>

      {/* Filter Bar */}
      <div
        style={{
          display: 'flex',
          gap: 10,
          alignItems: 'center',
          flexWrap: 'wrap',
          marginBottom: 16,
          padding: '10px 14px',
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
        }}
      >
        <span style={{ fontSize: 12, color: 'var(--txt3)', fontWeight: 600 }}>Filter:</span>
        {FILTERS.map((f) => {
          const active = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                background: active ? 'var(--golddim)' : 'transparent',
                border: `1px solid ${active ? 'var(--gold2)' : 'var(--br)'}`,
                color: active ? 'var(--gold2)' : 'var(--txt3)',
                padding: '5px 12px',
                borderRadius: 4,
                fontSize: 11,
                cursor: 'pointer',
                fontWeight: active ? 600 : 400,
              }}
            >
              {f.label}
            </button>
          )
        })}
        <div style={{ flex: 1 }} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search..."
          style={{
            background: 'var(--s1)',
            border: '1px solid var(--br)',
            color: 'var(--txt)',
            padding: '5px 10px',
            fontSize: 12,
            borderRadius: 4,
            width: 180,
          }}
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as PrivSort)}
          style={{
            background: 'var(--s1)',
            border: '1px solid var(--br)',
            color: 'var(--txt)',
            padding: '5px 8px',
            fontSize: 12,
            borderRadius: 4,
            width: 150,
          }}
        >
          <option value="acqs">Sort: Acq Score</option>
          <option value="rev_est">Sort: Revenue</option>
          <option value="ev_est">Sort: Est. EV</option>
          <option value="name">Sort: Name</option>
        </select>
      </div>

      {/* List */}
      {data.length === 0 ? (
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            textAlign: 'center',
            padding: 48,
            color: 'var(--txt3)',
          }}
        >
          No companies match current filters.
        </div>
      ) : (
        <div>
          {data.map((c) => (
            <PrivCard key={c.name} c={c} />
          ))}
        </div>
      )}
    </div>
  )
}
