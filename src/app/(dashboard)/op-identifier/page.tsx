'use client'

/**
 * Op Identifier — inorganic-growth target screener.
 *
 * Flow:
 *   1. Analyst picks an ACQUIRER from the live company universe.
 *   2. Analyst fills growth ambition + Ansoff vector + Porter strategy
 *      + sectors of interest + deal-size band + ownership filter.
 *   3. identifyTargets() scores the universe deterministically; UI
 *      renders ranked targets with per-target rationale.
 *   4. Analyst ticks the targets they'd actually pursue; buildPlan()
 *      rolls up fund requirement + revenue waterfall + reach verdict.
 *
 * No external API / LLM calls. Every number + sentence in the UI is
 * derivable from the DealNector company database + framework metadata.
 */

import { useMemo, useState } from 'react'
import type { Company } from '@/lib/data/companies'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'
import { useIndustryAtlas } from '@/hooks/useIndustryAtlas'
import { useIndustryFilter } from '@/hooks/useIndustryFilter'
import {
  ANSOFF,
  PORTER,
  SEVEN_POWERS,
  HORIZONS,
  type AnsoffVector,
  type PorterStrategy,
} from '@/lib/op-identifier/frameworks'
import {
  identifyTargets,
  buildPlan,
  type OpTarget,
  type OpInputs,
} from '@/lib/op-identifier/algorithm'

const PANEL: React.CSSProperties = {
  background: 'var(--s2)',
  border: '1px solid var(--br)',
  borderRadius: 8,
  padding: 16,
  marginBottom: 14,
}

const H1: React.CSSProperties = {
  fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
  fontSize: 22,
  fontWeight: 700,
  color: 'var(--txt)',
  margin: 0,
}

const H2: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '1.2px',
  textTransform: 'uppercase',
  color: 'var(--txt3)',
  marginBottom: 8,
}

const INPUT: React.CSSProperties = {
  background: 'var(--s3)',
  border: '1px solid var(--br)',
  color: 'var(--txt)',
  padding: '6px 10px',
  borderRadius: 4,
  fontSize: 12,
  outline: 'none',
  fontFamily: 'inherit',
  width: '100%',
}

const LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: 'var(--txt3)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: 4,
  display: 'block',
}

function fmtCr(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1_00_000) return `₹${(n / 1_00_000).toFixed(2)} L Cr`
  return `₹${Math.round(n).toLocaleString('en-IN')} Cr`
}

export default function OpIdentifierPage() {
  const { allCompanies } = useLiveSnapshot()
  const { atlasListed } = useIndustryAtlas()
  const { availableIndustries } = useIndustryFilter()

  // Dedup universe by ticker — allCompanies already unions static +
  // user_companies + atlas-tickers, and atlasListed adds the atlas
  // stages. A single Map keeps us honest.
  const universe = useMemo<Company[]>(() => {
    const m = new Map<string, Company>()
    for (const c of allCompanies) m.set(c.ticker, c)
    for (const c of atlasListed) if (!m.has(c.ticker)) m.set(c.ticker, c)
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [allCompanies, atlasListed])

  // ── State: acquirer + inputs ────────────────────────────────
  const [acquirerTicker, setAcquirerTicker] = useState<string>('')
  const [targetRevenueCr, setTargetRevenueCr] = useState<string>('5000')
  const [horizonMonths, setHorizonMonths] = useState<number>(36)
  const [ansoff, setAnsoff] = useState<AnsoffVector>('product_development')
  const [porter, setPorter] = useState<PorterStrategy>('differentiation')
  const [sectorsOfInterest, setSectorsOfInterest] = useState<string[]>([])
  const [dealSizeMinCr, setDealSizeMinCr] = useState<string>('200')
  const [dealSizeMaxCr, setDealSizeMaxCr] = useState<string>('10000')
  const [ownership, setOwnership] = useState<Array<'listed' | 'private' | 'subsidiary'>>([
    'listed',
    'private',
  ])
  const [ownershipPct, setOwnershipPct] = useState<number>(1.0)
  const [ran, setRan] = useState<boolean>(false)
  const [selectedTickers, setSelectedTickers] = useState<Set<string>>(new Set())

  const acquirer = useMemo<Company | null>(
    () => universe.find((c) => c.ticker === acquirerTicker) || null,
    [universe, acquirerTicker],
  )

  // ── Auto-seed some inputs when acquirer is picked ────────────
  function pickAcquirer(t: string) {
    setAcquirerTicker(t)
    const co = universe.find((c) => c.ticker === t)
    if (!co) return
    // Default sectors-of-interest = acquirer's own sec (+ nothing else);
    // the analyst then broadens or narrows as they see fit.
    if (co.sec) setSectorsOfInterest([co.sec])
    // Auto-fill target revenue at 2× current revenue — a reasonable
    // 3-year default for a growth-ambitious acquirer.
    if (co.rev > 0) setTargetRevenueCr(String(Math.round(co.rev * 2)))
  }

  // ── Run algorithm ────────────────────────────────────────────
  const inputs: OpInputs = useMemo(
    () => ({
      targetRevenueCr: Number(targetRevenueCr) || 0,
      horizonMonths,
      ansoff,
      porter,
      sectorsOfInterest,
      dealSizeMinCr: Number(dealSizeMinCr) || 0,
      dealSizeMaxCr: Number(dealSizeMaxCr) || 0,
      ownership,
    }),
    [targetRevenueCr, horizonMonths, ansoff, porter, sectorsOfInterest, dealSizeMinCr, dealSizeMaxCr, ownership],
  )

  const ranked = useMemo<OpTarget[]>(() => {
    if (!acquirer || !ran) return []
    return identifyTargets(acquirer, universe, inputs)
  }, [acquirer, universe, inputs, ran])

  const displayed = ranked.slice(0, 30)

  const selectedTargets = useMemo(
    () => ranked.filter((t) => selectedTickers.has(t.ticker)),
    [ranked, selectedTickers],
  )

  const plan = useMemo(() => {
    if (!acquirer || selectedTargets.length === 0) return null
    return buildPlan({
      acquirerCurrentRevCr: acquirer.rev || 0,
      targetRevenueCr: Number(targetRevenueCr) || 0,
      selected: selectedTargets,
      ownershipPct,
    })
  }, [acquirer, selectedTargets, targetRevenueCr, ownershipPct])

  function toggleSelect(t: string) {
    setSelectedTickers((prev) => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  function toggleSector(id: string) {
    setSectorsOfInterest((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    )
  }

  function toggleOwnership(kind: 'listed' | 'private' | 'subsidiary') {
    setOwnership((prev) => (prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind]))
  }

  // ── Render ──────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '14px 16px 60px' }}>
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          <span className="dn-wordmark">Deal<em>Nector</em></span> <span style={{ opacity: 0.5 }}>›</span> Opportunity Identifier
        </div>
        <h1 style={H1}>
          Op <em style={{ color: 'var(--gold2)', fontStyle: 'italic' }}>Identifier</em>
        </h1>
        <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4, maxWidth: 840 }}>
          Pick an acquirer from the live universe, set a growth thesis, and the algorithm will rank target
          companies from the DealNector database — Ansoff + Porter fit, deal-size match, growth + margin
          signals — then roll up fund requirement and revenue achievability over your horizon.
        </div>
      </div>

      {/* §1 Acquirer + inputs */}
      <div style={PANEL}>
        <div style={H2}>1 · Acquirer &amp; Growth Ambition</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={LABEL}>Acquirer (company)</label>
            <select value={acquirerTicker} onChange={(e) => pickAcquirer(e.target.value)} style={INPUT}>
              <option value="">— Select acquirer —</option>
              {universe.map((c) => (
                <option key={c.ticker} value={c.ticker}>
                  {c.name} ({c.ticker}){c.sec ? ` — ${c.sec}` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={LABEL}>Current Revenue (₹Cr)</label>
            <input
              type="text"
              value={acquirer ? Math.round(acquirer.rev || 0).toLocaleString('en-IN') : ''}
              readOnly
              style={{ ...INPUT, background: 'var(--s1)', color: 'var(--txt2)' }}
            />
          </div>
          <div>
            <label style={LABEL}>Target Revenue (₹Cr)</label>
            <input
              type="number"
              value={targetRevenueCr}
              onChange={(e) => setTargetRevenueCr(e.target.value)}
              style={INPUT}
            />
          </div>
          <div>
            <label style={LABEL}>Horizon (months)</label>
            <input
              type="number"
              value={horizonMonths}
              onChange={(e) => setHorizonMonths(Number(e.target.value) || 36)}
              style={INPUT}
            />
          </div>
        </div>

        {acquirer && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              background: 'var(--s1)',
              border: '1px dashed var(--br)',
              borderRadius: 6,
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 10,
              fontSize: 11,
            }}
          >
            <Stat label="Sector" value={acquirer.sec || '—'} />
            <Stat label="MktCap" value={fmtCr(acquirer.mktcap)} />
            <Stat label="EBITDA margin" value={`${(acquirer.ebm || 0).toFixed(1)}%`} />
            <Stat label="Acquisition Score" value={`${acquirer.acqs || 0}/10 · ${acquirer.acqf || 'MONITOR'}`} />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 14 }}>
          <div>
            <label style={LABEL}>Ansoff Vector</label>
            <select value={ansoff} onChange={(e) => setAnsoff(e.target.value as AnsoffVector)} style={INPUT}>
              {ANSOFF.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} · {a.risk} risk
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={LABEL}>Porter Strategy</label>
            <select value={porter} onChange={(e) => setPorter(e.target.value as PorterStrategy)} style={INPUT}>
              {PORTER.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={LABEL}>Deal Size min (₹Cr)</label>
            <input
              type="number"
              value={dealSizeMinCr}
              onChange={(e) => setDealSizeMinCr(e.target.value)}
              style={INPUT}
            />
          </div>
          <div>
            <label style={LABEL}>Deal Size max (₹Cr)</label>
            <input
              type="number"
              value={dealSizeMaxCr}
              onChange={(e) => setDealSizeMaxCr(e.target.value)}
              style={INPUT}
            />
          </div>
        </div>

        {/* Sectors + ownership */}
        <div style={{ marginTop: 14 }}>
          <label style={LABEL}>Sectors of Interest ({sectorsOfInterest.length} selected)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {availableIndustries.map((ind) => {
              const on = sectorsOfInterest.includes(ind.id)
              return (
                <button
                  key={ind.id}
                  onClick={() => toggleSector(ind.id)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 4,
                    fontSize: 10,
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: on ? 'rgba(212,164,59,0.16)' : 'transparent',
                    border: `1px solid ${on ? 'var(--gold2)' : 'var(--br)'}`,
                    color: on ? 'var(--gold2)' : 'var(--txt3)',
                    fontFamily: 'inherit',
                  }}
                >
                  {on ? '✓ ' : ''}
                  {ind.label}
                </button>
              )
            })}
          </div>
        </div>

        <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={LABEL}>Ownership filter</label>
          {(['listed', 'private', 'subsidiary'] as const).map((k) => {
            const on = ownership.includes(k)
            return (
              <button
                key={k}
                onClick={() => toggleOwnership(k)}
                style={{
                  padding: '4px 10px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  background: on ? 'rgba(16,185,129,0.15)' : 'transparent',
                  border: `1px solid ${on ? 'var(--green)' : 'var(--br)'}`,
                  color: on ? 'var(--green)' : 'var(--txt3)',
                  fontFamily: 'inherit',
                }}
              >
                {on ? '✓ ' : ''}
                {k}
              </button>
            )
          })}
          <div style={{ flex: 1 }} />
          <label style={{ ...LABEL, margin: 0 }}>Ownership % per deal</label>
          <select
            value={String(ownershipPct)}
            onChange={(e) => setOwnershipPct(Number(e.target.value))}
            style={{ ...INPUT, width: 140 }}
          >
            <option value="1">100% (acquisition)</option>
            <option value="0.51">51% (controlling stake)</option>
            <option value="0.26">26% (strategic stake)</option>
          </select>
        </div>

        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <button
            onClick={() => {
              setRan(true)
              setSelectedTickers(new Set())
            }}
            disabled={!acquirer}
            style={{
              background: acquirer ? 'var(--gold2)' : 'var(--s3)',
              color: acquirer ? '#000' : 'var(--txt4)',
              border: 'none',
              padding: '8px 18px',
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.4px',
              cursor: acquirer ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
            }}
          >
            ◉ Identify Opportunities
          </button>
          {ran && (
            <button
              onClick={() => {
                setRan(false)
                setSelectedTickers(new Set())
              }}
              style={{
                background: 'transparent',
                color: 'var(--txt3)',
                border: '1px solid var(--br)',
                padding: '8px 14px',
                borderRadius: 5,
                fontSize: 11,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Reset
            </button>
          )}
        </div>
      </div>

      {/* §2 Framework summary */}
      <div style={PANEL}>
        <div style={H2}>2 · Strategic Framework</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <FrameworkCard
            title="Ansoff Matrix"
            body={
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 10 }}>
                {ANSOFF.map((a) => {
                  const active = a.id === ansoff
                  return (
                    <div
                      key={a.id}
                      style={{
                        padding: 8,
                        borderRadius: 4,
                        background: active ? 'rgba(212,164,59,0.16)' : 'var(--s3)',
                        border: `1px solid ${active ? 'var(--gold2)' : 'var(--br)'}`,
                        color: active ? 'var(--gold2)' : 'var(--txt2)',
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{a.label}</div>
                      <div style={{ color: 'var(--txt3)', marginTop: 3, fontSize: 9 }}>
                        risk: {a.risk}
                      </div>
                    </div>
                  )
                })}
              </div>
            }
          />
          <FrameworkCard
            title="Porter Generic Strategy"
            body={
              <div style={{ fontSize: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {PORTER.map((p) => {
                  const active = p.id === porter
                  return (
                    <div
                      key={p.id}
                      style={{
                        padding: 8,
                        borderRadius: 4,
                        background: active ? 'rgba(212,164,59,0.16)' : 'var(--s3)',
                        border: `1px solid ${active ? 'var(--gold2)' : 'var(--br)'}`,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: active ? 'var(--gold2)' : 'var(--txt)' }}>
                        {p.label}
                      </div>
                      <div style={{ color: 'var(--txt3)', marginTop: 2 }}>{p.thesis}</div>
                    </div>
                  )
                })}
              </div>
            }
          />
          <FrameworkCard
            title="Seven Powers"
            body={
              <div style={{ fontSize: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {SEVEN_POWERS.map((p) => (
                  <div
                    key={p.id}
                    style={{
                      padding: '6px 8px',
                      borderRadius: 4,
                      background: 'var(--s3)',
                      border: '1px solid var(--br)',
                    }}
                  >
                    <span style={{ color: 'var(--cyan2)', fontWeight: 700 }}>{p.label}</span>
                    <span style={{ color: 'var(--txt3)', marginLeft: 6 }}>· {p.cue}</span>
                  </div>
                ))}
              </div>
            }
          />
        </div>
      </div>

      {/* §3 Ranked targets */}
      {ran && (
        <div style={PANEL}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div style={H2}>3 · Ranked Targets</div>
            <div style={{ fontSize: 10, color: 'var(--txt3)' }}>
              Showing top {displayed.length} of {ranked.length} scored · select rows to build the plan below
            </div>
          </div>
          {displayed.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--txt3)', fontSize: 12 }}>
              No targets passed the pre-screen. Relax the sector / deal-size / ownership filters above.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--txt3)', background: 'var(--s3)' }}>
                    <th style={{ padding: '6px 8px', width: 30 }}></th>
                    <th style={{ padding: '6px 8px', width: 36 }}>#</th>
                    <th style={{ padding: '6px 8px' }}>Target</th>
                    <th style={{ padding: '6px 8px' }}>Conviction</th>
                    <th style={{ padding: '6px 8px' }}>Horizon</th>
                    <th style={{ padding: '6px 8px' }}>Deal size</th>
                    <th style={{ padding: '6px 8px' }}>Revenue</th>
                    <th style={{ padding: '6px 8px' }}>Growth</th>
                    <th style={{ padding: '6px 8px' }}>EBITDA m%</th>
                  </tr>
                </thead>
                <tbody>
                  {displayed.map((t, i) => {
                    const on = selectedTickers.has(t.ticker)
                    return (
                      <TargetRow
                        key={t.ticker}
                        t={t}
                        rank={i + 1}
                        on={on}
                        onToggle={() => toggleSelect(t.ticker)}
                      />
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* §4 Acquisition plan */}
      {ran && plan && (
        <div
          style={{
            ...PANEL,
            background: plan.isGoalAchievable ? 'rgba(16,185,129,0.08)' : 'var(--s2)',
            borderColor: plan.isGoalAchievable ? 'var(--green)' : 'var(--br)',
          }}
        >
          <div style={H2}>4 · Acquisition Plan &amp; Fund Requirement</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 12,
              marginBottom: 14,
            }}
          >
            <Stat label="Targets selected" value={String(selectedTargets.length)} />
            <Stat label="Total fund required" value={fmtCr(plan.totalFundRequiredCr)} color="var(--gold2)" />
            <Stat label="Projected revenue" value={fmtCr(plan.projectedRevCr)} color="var(--cyan2)" />
            <Stat
              label={plan.isGoalAchievable ? 'Goal met' : 'Gap to goal'}
              value={plan.isGoalAchievable ? '✓ achievable' : `${fmtCr(Math.abs(plan.gapToGoalCr))} short`}
              color={plan.isGoalAchievable ? 'var(--green)' : 'var(--red)'}
            />
          </div>

          {/* Horizon timeline */}
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--txt3)', marginBottom: 6, letterSpacing: '0.5px' }}>
              ACQUISITION TIMELINE
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${HORIZONS.length}, 1fr)`, gap: 8 }}>
              {HORIZONS.map((h) => {
                const inBand = selectedTargets.filter((t) => t.horizon.id === h.id)
                const fund = inBand.reduce((s, t) => s + Math.round(t.dealSizeCr * ownershipPct), 0)
                const rev = inBand.reduce((s, t) => s + Math.round(t.revCr * ownershipPct), 0)
                return (
                  <div
                    key={h.id}
                    style={{
                      padding: 10,
                      background: 'var(--s1)',
                      border: '1px solid var(--br)',
                      borderRadius: 6,
                    }}
                  >
                    <div style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '0.6px', textTransform: 'uppercase' }}>
                      {h.label}
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--txt)', marginTop: 4 }}>
                      {inBand.length}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--txt3)' }}>
                      deals · {fmtCr(fund)} · +{fmtCr(rev)} rev
                    </div>
                    {inBand.length > 0 && (
                      <div
                        style={{
                          marginTop: 6,
                          fontSize: 10,
                          color: 'var(--txt2)',
                          maxHeight: 60,
                          overflowY: 'auto',
                        }}
                      >
                        {inBand.map((t) => (
                          <div key={t.ticker} style={{ padding: '2px 0', borderBottom: '1px dotted var(--br)' }}>
                            {t.name}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Revenue waterfall */}
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--txt3)', marginBottom: 6, letterSpacing: '0.5px' }}>
              REVENUE WATERFALL
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 4,
                height: 120,
                padding: 10,
                background: 'var(--s1)',
                border: '1px solid var(--br)',
                borderRadius: 6,
                overflowX: 'auto',
              }}
            >
              {(() => {
                const start = acquirer?.rev || 0
                const goal = Number(targetRevenueCr) || 0
                const maxY = Math.max(start + selectedTargets.reduce((s, t) => s + t.revCr * ownershipPct, 0), goal, 1)
                const bars: Array<{ label: string; value: number; color: string }> = [
                  { label: 'Current', value: start, color: 'var(--cyan2)' },
                ]
                for (const t of [...selectedTargets].sort((a, b) => a.horizon.months[1] - b.horizon.months[1])) {
                  bars.push({ label: t.name.slice(0, 12), value: t.revCr * ownershipPct, color: 'var(--gold2)' })
                }
                bars.push({ label: 'Goal', value: goal, color: 'var(--green)' })
                return bars.map((b, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 60 }}>
                    <div
                      style={{
                        height: (b.value / maxY) * 90,
                        width: '100%',
                        background: b.color,
                        borderRadius: '4px 4px 0 0',
                        opacity: 0.85,
                      }}
                      title={`${b.label}: ${fmtCr(b.value)}`}
                    />
                    <div style={{ fontSize: 8, color: 'var(--txt3)', marginTop: 4, textAlign: 'center' }}>
                      {b.label}
                      <br />
                      {fmtCr(b.value)}
                    </div>
                  </div>
                ))
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '0.6px', textTransform: 'uppercase' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, fontWeight: 700, color: color || 'var(--txt)', marginTop: 2 }}>{value}</div>
    </div>
  )
}

function FrameworkCard({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div style={{ padding: 10, background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 6 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--gold2)', marginBottom: 8 }}>
        {title}
      </div>
      {body}
    </div>
  )
}

function TargetRow({
  t,
  rank,
  on,
  onToggle,
}: {
  t: OpTarget
  rank: number
  on: boolean
  onToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  const rowBg = on ? 'rgba(247,183,49,0.08)' : undefined
  return (
    <>
      <tr
        style={{ borderBottom: '1px solid var(--br)', background: rowBg, cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <td style={{ padding: '8px' }}>
          <input
            type="checkbox"
            checked={on}
            onChange={onToggle}
            onClick={(e) => e.stopPropagation()}
            style={{ accentColor: 'var(--gold2)' }}
          />
        </td>
        <td style={{ padding: '8px', color: 'var(--txt3)', fontFamily: 'JetBrains Mono, monospace' }}>
          #{rank}
        </td>
        <td style={{ padding: '8px', color: 'var(--txt)', fontWeight: 600 }}>
          {t.name}{' '}
          <span style={{ color: 'var(--txt3)', fontWeight: 400, fontSize: 10 }}>
            ({t.ticker}) · {t.sec || '—'}
          </span>
        </td>
        <td style={{ padding: '8px' }}>
          <span
            style={{
              display: 'inline-block',
              padding: '2px 8px',
              borderRadius: 3,
              background:
                t.conviction >= 0.7
                  ? 'rgba(16,185,129,0.18)'
                  : t.conviction >= 0.5
                    ? 'rgba(212,164,59,0.16)'
                    : 'rgba(85,104,128,0.2)',
              color:
                t.conviction >= 0.7
                  ? 'var(--green)'
                  : t.conviction >= 0.5
                    ? 'var(--gold2)'
                    : 'var(--txt3)',
              fontWeight: 700,
              fontSize: 11,
            }}
          >
            {(t.conviction * 100).toFixed(0)}%
          </span>
        </td>
        <td style={{ padding: '8px', fontSize: 10, color: 'var(--txt3)' }}>{t.horizon.label}</td>
        <td style={{ padding: '8px', fontFamily: 'JetBrains Mono, monospace' }}>{fmtCr(t.dealSizeCr)}</td>
        <td style={{ padding: '8px', fontFamily: 'JetBrains Mono, monospace' }}>{fmtCr(t.revCr)}</td>
        <td
          style={{
            padding: '8px',
            fontFamily: 'JetBrains Mono, monospace',
            color: t.revGrowthPct >= 0 ? 'var(--green)' : 'var(--red)',
          }}
        >
          {t.revGrowthPct.toFixed(1)}%
        </td>
        <td style={{ padding: '8px', fontFamily: 'JetBrains Mono, monospace' }}>
          {t.ebitdaMarginPct.toFixed(1)}%
        </td>
      </tr>
      {open && (
        <tr style={{ background: 'var(--s1)' }}>
          <td colSpan={9} style={{ padding: '10px 14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 16 }}>
              <div>
                <div
                  style={{
                    fontSize: 9,
                    color: 'var(--gold2)',
                    fontWeight: 700,
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}
                >
                  Why this target ranked #{rank}
                </div>
                <ul style={{ paddingLeft: 18, margin: 0, fontSize: 11, color: 'var(--txt2)', lineHeight: 1.55 }}>
                  {t.rationale.map((r, i) => (
                    <li key={i} style={{ marginBottom: 4 }}>
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div
                  style={{
                    fontSize: 9,
                    color: 'var(--gold2)',
                    fontWeight: 700,
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}
                >
                  Score breakdown
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(Object.keys(t.subScores) as Array<keyof typeof t.subScores>).map((k) => (
                    <ScoreBar key={k} label={k} value={t.subScores[k]} />
                  ))}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const pct = Math.round(value * 100)
  const prettyLabel = label
    .replace(/Fit$/, '')
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim()
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr 40px', alignItems: 'center', gap: 8, fontSize: 10 }}>
      <div style={{ color: 'var(--txt3)' }}>{prettyLabel}</div>
      <div style={{ background: 'var(--s3)', borderRadius: 3, height: 6, overflow: 'hidden' }}>
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: pct >= 70 ? 'var(--green)' : pct >= 45 ? 'var(--gold2)' : 'var(--txt3)',
          }}
        />
      </div>
      <div style={{ color: 'var(--txt3)', textAlign: 'right', fontFamily: 'JetBrains Mono, monospace' }}>{pct}%</div>
    </div>
  )
}
