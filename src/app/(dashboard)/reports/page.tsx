'use client'

/**
 * Report Builder — /reports
 *
 * In-app HTML report composer that sits next to the FSA page. Lets
 * the analyst:
 *
 *   1. Pick any listed company
 *   2. Include / exclude each report section via checkbox
 *   3. Edit the assumptions that drive each section (WACC, growth,
 *      synergy rates, book-value premium, scenario deltas)
 *   4. See a live HTML preview of the assembled report
 *   5. Open a "Calculations" audit tab that lists EVERY number in
 *      the report with its formula, inputs, source and concept, so
 *      a user can verify correctness
 *   6. Download the assembled report as standalone HTML or open the
 *      print-friendly /report/[ticker] view
 *
 * Persistence: writes to the same localStorage keys that the
 * existing /report/[ticker] page reads from, so changes made here
 * flow through to the print PDF automatically.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { COMPANIES, type Company } from '@/lib/data/companies'
import { CHAIN } from '@/lib/data/chain'
import { formatInrCr } from '@/lib/format'
import {
  runDcf,
  runComparables,
  runBookValue,
  buildFootballField,
  defaultDcfAssumptions,
  type DcfResult,
  type ComparableResult,
  type BookValueResult,
  type FootballFieldBar,
  type DcfAssumptions,
} from '@/lib/valuation/methods'
import { findPeers, computePeerStats, type PeerSet, type PeerStats } from '@/lib/valuation/peers'
import { buildFinancialHistory, type FinancialHistory } from '@/lib/valuation/history'
import { useNewsData } from '@/components/news/NewsDataProvider'
import { computeAdjustedMetrics } from '@/lib/news/adjustments'
import type { CompanyNewsAggregate } from '@/lib/news/impact'
import { buildCalcTrace, type CalcTraceEntry, type TraceSection } from '@/lib/valuation/calc-trace'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'

// ─── Section config ────────────────────────────────────────────

type SectionId =
  | 'cover'
  | 'execSummary'
  | 'inputs'
  | 'history'
  | 'peers'
  | 'dcf'
  | 'comparables'
  | 'bookValue'
  | 'football'
  | 'news'
  | 'synergy'
  | 'scenarios'
  | 'concentration'
  | 'conclusion'

interface SectionDef {
  id: SectionId
  label: string
  category: 'overview' | 'valuation' | 'context' | 'decision'
  description: string
}

const SECTIONS: SectionDef[] = [
  { id: 'cover', label: 'Cover', category: 'overview', description: 'Title page with headline DCF value and upside' },
  { id: 'execSummary', label: 'Executive Summary', category: 'overview', description: 'Key metrics table + recommendation' },
  { id: 'inputs', label: 'Subject Inputs', category: 'overview', description: 'Revenue, EBITDA, MktCap, EV, current multiples' },
  { id: 'history', label: 'Financial History', category: 'context', description: 'Multi-year revenue, EBITDA, margins, CAGRs' },
  { id: 'peers', label: 'Peer Set', category: 'valuation', description: 'Selected peers + median / Q1 / Q3 stats' },
  { id: 'dcf', label: 'DCF Valuation', category: 'valuation', description: '5-year FCF forecast, terminal value, equity value' },
  { id: 'comparables', label: 'Comparable Multiples', category: 'valuation', description: 'EV/EBITDA, P/E, P/B, EV/Sales' },
  { id: 'bookValue', label: 'Book Value', category: 'valuation', description: 'Shareholders\u2019 equity × strategic premium' },
  { id: 'football', label: 'Football Field', category: 'valuation', description: 'Range across all methods' },
  { id: 'news', label: 'News Impact', category: 'context', description: 'News-adjusted revenue, margin, multiple deltas' },
  { id: 'synergy', label: 'Synergy NPV', category: 'decision', description: 'Revenue + cost synergies minus integration cost' },
  { id: 'scenarios', label: 'Bull / Base / Bear', category: 'valuation', description: 'Scenario DCF with configurable deltas' },
  { id: 'concentration', label: 'Market Concentration', category: 'context', description: 'Segment HHI + top players' },
  { id: 'conclusion', label: 'Conclusion & Recommendation', category: 'decision', description: 'Blended range + verdict' },
]

const DEFAULT_SECTIONS: Record<SectionId, boolean> = SECTIONS.reduce(
  (acc, s) => ({ ...acc, [s.id]: true }),
  {} as Record<SectionId, boolean>
)

// ─── Page ──────────────────────────────────────────────────────

export default function ReportBuilderPage() {
  // Ticker picker
  const [tickerFilter, setTickerFilter] = useState('')
  const [ticker, setTicker] = useState<string>(() => COMPANIES[0]?.ticker ?? '')
  const [tab, setTab] = useState<'preview' | 'calc' | 'export'>('preview')

  // Live snapshot — applies Tier 1 (NSE) / Tier 2 (Screener) / Tier 3
  // (RapidAPI) overlays so every number the Report Builder shows matches
  // what Dashboard, Stocks, Valuation, FSA, and the print /report page
  // show. Without this, subject.ev_eb displayed here would differ from
  // the same ticker's EV/EBITDA displayed everywhere else.
  const { mergeCompany } = useLiveSnapshot()

  const subject = useMemo(() => {
    const base = COMPANIES.find((c) => c.ticker === ticker) ?? COMPANIES[0]
    return mergeCompany(base)
  }, [ticker, mergeCompany])

  // Section include/exclude (persisted per ticker)
  const [sections, setSections] = useState<Record<SectionId, boolean>>(DEFAULT_SECTIONS)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(`report_sections_${subject.ticker}`)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<Record<SectionId, boolean>>
        setSections({ ...DEFAULT_SECTIONS, ...parsed })
      } else {
        setSections(DEFAULT_SECTIONS)
      }
    } catch {
      setSections(DEFAULT_SECTIONS)
    }
  }, [subject.ticker])

  const toggleSection = (id: SectionId) => {
    setSections((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try {
        localStorage.setItem(`report_sections_${subject.ticker}`, JSON.stringify(next))
      } catch { /* ignore */ }
      return next
    })
  }

  // Assumption overrides (shared with /report/[ticker] via same keys)
  const [dcfAssum, setDcfAssum] = useState<Partial<DcfAssumptions>>({})
  const [synRevPct, setSynRevPct] = useState(0.03)
  const [synCostPct, setSynCostPct] = useState(0.015)
  const [integrationCostPct, setIntegrationCostPct] = useState(0.03)
  const [bookValuePremium, setBookValuePremium] = useState(1.25)
  const [bullGrowthDelta, setBullGrowthDelta] = useState(0.03)
  const [bullMarginDelta, setBullMarginDelta] = useState(0.02)
  const [bullWaccDelta, setBullWaccDelta] = useState(-0.005)

  // Load persisted assumptions
  useEffect(() => {
    try {
      const dcfRaw = localStorage.getItem(`dcf_inputs_${subject.ticker}`)
      if (dcfRaw) {
        const custom = JSON.parse(dcfRaw) as { gr?: number; ebm?: number; wacc?: number; tgr?: number; yrs?: number }
        const patch: Partial<DcfAssumptions> = {}
        if (custom.gr != null) patch.startingGrowth = custom.gr / 100
        if (custom.ebm != null) patch.startingEbitdaMargin = custom.ebm / 100
        if (custom.wacc != null) patch.wacc = custom.wacc / 100
        if (custom.tgr != null) patch.terminalGrowth = custom.tgr / 100
        if (custom.yrs != null) patch.years = custom.yrs
        setDcfAssum(patch)
      } else {
        setDcfAssum({})
      }
      const cfgRaw = localStorage.getItem(`report_config_${subject.ticker}`)
      if (cfgRaw) {
        const cfg = JSON.parse(cfgRaw)
        if (cfg.synergyRevenuePct != null) setSynRevPct(cfg.synergyRevenuePct)
        if (cfg.synergyCostPct != null) setSynCostPct(cfg.synergyCostPct)
        if (cfg.integrationCostPct != null) setIntegrationCostPct(cfg.integrationCostPct)
        if (cfg.bookValuePremium != null) setBookValuePremium(cfg.bookValuePremium)
        if (cfg.bullGrowthDelta != null) setBullGrowthDelta(cfg.bullGrowthDelta)
        if (cfg.bullMarginDelta != null) setBullMarginDelta(cfg.bullMarginDelta)
        if (cfg.bullWaccDelta != null) setBullWaccDelta(cfg.bullWaccDelta)
      }
    } catch { /* ignore */ }
  }, [subject.ticker])

  const persistDcf = (patch: Partial<DcfAssumptions>) => {
    const merged = { ...dcfAssum, ...patch }
    setDcfAssum(merged)
    try {
      const payload: Record<string, number> = {}
      if (merged.startingGrowth != null) payload.gr = merged.startingGrowth * 100
      if (merged.startingEbitdaMargin != null) payload.ebm = merged.startingEbitdaMargin * 100
      if (merged.wacc != null) payload.wacc = merged.wacc * 100
      if (merged.terminalGrowth != null) payload.tgr = merged.terminalGrowth * 100
      if (merged.years != null) payload.yrs = merged.years
      payload.rev = subject.rev
      localStorage.setItem(`dcf_inputs_${subject.ticker}`, JSON.stringify(payload))
    } catch { /* ignore */ }
  }

  const persistCfg = (patch: Record<string, number>) => {
    try {
      const existing = JSON.parse(localStorage.getItem(`report_config_${subject.ticker}`) || '{}')
      const merged = { ...existing, ...patch }
      localStorage.setItem(`report_config_${subject.ticker}`, JSON.stringify(merged))
    } catch { /* ignore */ }
  }

  // ── Compute everything ──
  const history: FinancialHistory = useMemo(
    () => buildFinancialHistory(subject, undefined),
    [subject]
  )

  const baseAssum = useMemo(
    () => defaultDcfAssumptions(subject, history.cagrs.revenueCagrPct),
    [subject, history]
  )

  const effectiveAssum: DcfAssumptions = useMemo(() => {
    const merged = { ...baseAssum, ...dcfAssum }
    // Guard: terminal growth must be below WACC
    if (merged.terminalGrowth >= merged.wacc) {
      merged.terminalGrowth = merged.wacc - 0.005
    }
    return merged
  }, [baseAssum, dcfAssum])

  const dcf: DcfResult = useMemo(() => runDcf(subject, effectiveAssum), [subject, effectiveAssum])

  const peerSet: PeerSet = useMemo(() => findPeers(subject, COMPANIES, 5), [subject])
  const peers: PeerStats = useMemo(() => computePeerStats(peerSet), [peerSet])
  const comps: ComparableResult[] = useMemo(() => runComparables(subject, peers), [subject, peers])
  const bv: BookValueResult = useMemo(() => runBookValue(subject, bookValuePremium), [subject, bookValuePremium])
  const football: FootballFieldBar[] = useMemo(
    () => buildFootballField(subject, dcf, comps, bv),
    [subject, dcf, comps, bv]
  )

  // Scenarios
  const scenarios = useMemo(() => {
    const bull = { ...effectiveAssum, startingGrowth: effectiveAssum.startingGrowth + bullGrowthDelta, startingEbitdaMargin: effectiveAssum.startingEbitdaMargin + bullMarginDelta, wacc: effectiveAssum.wacc + bullWaccDelta }
    const bear = { ...effectiveAssum, startingGrowth: Math.max(0.01, effectiveAssum.startingGrowth - bullGrowthDelta), startingEbitdaMargin: Math.max(0.02, effectiveAssum.startingEbitdaMargin - bullMarginDelta), wacc: effectiveAssum.wacc - bullWaccDelta }
    if (bull.terminalGrowth >= bull.wacc) bull.terminalGrowth = bull.wacc - 0.005
    if (bear.terminalGrowth >= bear.wacc) bear.terminalGrowth = bear.wacc - 0.005
    return [
      { label: 'Bull', assum: bull, result: runDcf(subject, bull) },
      { label: 'Base', assum: effectiveAssum, result: dcf },
      { label: 'Bear', assum: bear, result: runDcf(subject, bear) },
    ]
  }, [subject, effectiveAssum, bullGrowthDelta, bullMarginDelta, bullWaccDelta, dcf])

  // Synergy
  const synergy = useMemo(() => {
    const rs = subject.rev * synRevPct
    const cs = subject.ebitda * synCostPct
    const ic = subject.mktcap * integrationCostPct
    const npv = (rs * 0.3 + cs) * 7 - ic
    return { rs, cs, ic, npv }
  }, [subject, synRevPct, synCostPct, integrationCostPct])

  // Concentration (HHI)
  const segmentCompanies = useMemo(
    () => COMPANIES.filter((co) => co.mktcap > 0 && (co.comp || []).some((s) => (subject.comp || []).includes(s))),
    [subject]
  )
  const hhi = useMemo(() => {
    const total = segmentCompanies.reduce((s, c) => s + c.mktcap, 0)
    if (total === 0) return { hhi: 0, risk: 'Safe' as const, totalMktcapCr: 0, topShare: null as number | null, shares: [] as Array<{ ticker: string; name: string; pct: number }> }
    const shares = segmentCompanies.map((c) => ({
      ticker: c.ticker, name: c.name, pct: (c.mktcap / total) * 100,
    })).sort((a, b) => b.pct - a.pct)
    const val = shares.reduce((s, c) => s + c.pct * c.pct, 0)
    const risk = val < 1500 ? 'Safe' : val < 2500 ? 'Moderate' : 'High'
    return { hhi: Math.round(val), risk, totalMktcapCr: total, topShare: shares[0]?.pct ?? null, shares }
  }, [segmentCompanies])

  // News
  const newsData = useNewsData()
  const newsAgg: CompanyNewsAggregate | null = useMemo(
    () => newsData.aggregates[subject.ticker] ?? null,
    [newsData, subject.ticker]
  )
  const adjusted = useMemo(() => computeAdjustedMetrics(subject, newsAgg ?? undefined), [subject, newsAgg])

  // Calc trace
  const trace: CalcTraceEntry[] = useMemo(
    () => buildCalcTrace({
      subject,
      history,
      peerSet,
      peers,
      dcf,
      comps,
      bv,
      football,
      newsAgg,
      adjusted,
      synergyInputs: { synRevPct, synCostPct, integrationCostPct },
      hhi: { hhi: hhi.hhi, risk: hhi.risk, totalMktcapCr: hhi.totalMktcapCr, topShare: hhi.topShare },
    }),
    [subject, history, peerSet, peers, dcf, comps, bv, football, newsAgg, adjusted, synRevPct, synCostPct, integrationCostPct, hhi]
  )

  // Download handler
  const downloadHtml = () => {
    const html = buildStandaloneHtml({
      subject, history, peerSet, peers, dcf, comps, bv, football,
      scenarios, synergy, hhi,
      sections, trace,
      bookValuePremium, synRevPct, synCostPct, integrationCostPct,
    })
    const blob = new Blob([html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${subject.ticker}-valuation-report.html`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Filter companies for picker
  const filteredCompanies = useMemo(() => {
    const q = tickerFilter.trim().toLowerCase()
    if (!q) return COMPANIES.slice(0, 40)
    return COMPANIES.filter(
      (c) => c.name.toLowerCase().includes(q) || c.ticker.toLowerCase().includes(q)
    ).slice(0, 40)
  }, [tickerFilter])

  return (
    <div style={{ padding: '14px 18px 80px', background: 'var(--bg)', minHeight: '100vh' }}>
      {/* Header */}
      <div className="phdr">
        <div className="phdr-breadcrumb">
          <span className="dn-wordmark">Deal<em>Nector</em></span> › Report Builder
        </div>
        <div className="phdr-title">
          Valuation Report <em>Builder</em>
        </div>
        <div className="phdr-meta">
          <span style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Pick sections, edit assumptions, audit every number, then download HTML.
          </span>
        </div>
      </div>

      {/* Ticker + tab controls */}
      <div style={{
        display: 'flex', gap: 10, alignItems: 'center', padding: '10px 12px',
        marginBottom: 12, background: 'var(--s2)', border: '1px solid var(--br)',
        borderRadius: 6, flexWrap: 'wrap',
      }}>
        <span style={labelStyle}>Company:</span>
        <select
          value={subject.ticker}
          onChange={(e) => setTicker(e.target.value)}
          style={{
            ...inputStyle, minWidth: 260, fontWeight: 600, color: 'var(--gold2)',
          }}
        >
          {filteredCompanies.map((c) => (
            <option key={c.ticker} value={c.ticker}>
              {c.name} ({c.ticker}) — {c.sec === 'solar' ? '☀' : '⚡'}
            </option>
          ))}
        </select>
        <input
          value={tickerFilter}
          onChange={(e) => setTickerFilter(e.target.value)}
          placeholder="Filter..."
          style={{ ...inputStyle, minWidth: 140 }}
        />
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', gap: 2 }}>
          {(['preview', 'calc', 'export'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                ...tabBtnStyle,
                background: tab === t ? 'var(--golddim)' : 'var(--s3)',
                color: tab === t ? 'var(--gold2)' : 'var(--txt2)',
                borderColor: tab === t ? 'var(--gold2)' : 'var(--br2)',
              }}
            >
              {t === 'preview' ? 'Preview' : t === 'calc' ? 'Calculations' : 'Export'}
            </button>
          ))}
        </div>
        <button onClick={downloadHtml} style={downloadBtnStyle}>
          ↓ Download HTML
        </button>
        <Link
          href={`/report/${subject.ticker}`}
          target="_blank"
          style={{ ...downloadBtnStyle, background: 'var(--s3)', color: 'var(--txt2)', borderColor: 'var(--br2)' }}
        >
          ↗ Print view
        </Link>
      </div>

      {/* Two-pane layout */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(280px, 340px) 1fr', gap: 14 }}>
        {/* LEFT: section toggles + assumption editors */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SectionTogglePanel sections={sections} onToggle={toggleSection} />

          <AssumptionPanel title="DCF Assumptions" color="var(--cyan2)">
            <NumberInput
              label="Starting Growth"
              value={effectiveAssum.startingGrowth * 100}
              unit="%"
              onChange={(v) => persistDcf({ startingGrowth: v / 100 })}
              help="Year-1 revenue growth; decays linearly to Ending Growth."
            />
            <NumberInput
              label="Starting EBITDA Margin"
              value={effectiveAssum.startingEbitdaMargin * 100}
              unit="%"
              onChange={(v) => persistDcf({ startingEbitdaMargin: v / 100 })}
            />
            <NumberInput
              label="WACC"
              value={effectiveAssum.wacc * 100}
              unit="%"
              step={0.1}
              onChange={(v) => persistDcf({ wacc: v / 100 })}
              help="Weighted average cost of capital. Solar default 11.5%, T&D 12.0%."
            />
            <NumberInput
              label="Terminal Growth"
              value={effectiveAssum.terminalGrowth * 100}
              unit="%"
              step={0.1}
              onChange={(v) => persistDcf({ terminalGrowth: v / 100 })}
              help="Must be strictly below WACC; auto-clamped."
            />
            <NumberInput
              label="Forecast Years"
              value={effectiveAssum.years}
              unit=""
              step={1}
              onChange={(v) => persistDcf({ years: Math.max(3, Math.min(10, Math.round(v))) })}
            />
          </AssumptionPanel>

          <AssumptionPanel title="Synergy Assumptions" color="var(--gold2)">
            <NumberInput
              label="Revenue Synergy %"
              value={synRevPct * 100}
              unit="%"
              step={0.5}
              onChange={(v) => { setSynRevPct(v / 100); persistCfg({ synergyRevenuePct: v / 100 }) }}
              help="% of subject revenue expected as incremental synergy (cross-sell, distribution)."
            />
            <NumberInput
              label="Cost Synergy %"
              value={synCostPct * 100}
              unit="%"
              step={0.5}
              onChange={(v) => { setSynCostPct(v / 100); persistCfg({ synergyCostPct: v / 100 }) }}
              help="% of subject EBITDA savable (procurement, SG&A, headcount)."
            />
            <NumberInput
              label="Integration Cost %"
              value={integrationCostPct * 100}
              unit="%"
              step={0.5}
              onChange={(v) => { setIntegrationCostPct(v / 100); persistCfg({ integrationCostPct: v / 100 }) }}
              help="One-time cost as % of MktCap."
            />
          </AssumptionPanel>

          <AssumptionPanel title="Book Value & Scenarios" color="var(--green)">
            <NumberInput
              label="Book Value Premium"
              value={bookValuePremium}
              unit="×"
              step={0.05}
              onChange={(v) => { setBookValuePremium(v); persistCfg({ bookValuePremium: v }) }}
              help="Strategic premium on derived book value. 1.0 = no premium."
            />
            <NumberInput
              label="Bull Growth Δ"
              value={bullGrowthDelta * 100}
              unit="%"
              step={0.5}
              onChange={(v) => { setBullGrowthDelta(v / 100); persistCfg({ bullGrowthDelta: v / 100 }) }}
              help="Bull-case adds, bear-case subtracts this from base growth."
            />
            <NumberInput
              label="Bull Margin Δ"
              value={bullMarginDelta * 100}
              unit="%"
              step={0.5}
              onChange={(v) => { setBullMarginDelta(v / 100); persistCfg({ bullMarginDelta: v / 100 }) }}
            />
            <NumberInput
              label="Bull WACC Δ"
              value={bullWaccDelta * 100}
              unit="%"
              step={0.1}
              onChange={(v) => { setBullWaccDelta(v / 100); persistCfg({ bullWaccDelta: v / 100 }) }}
              help="Negative = bull has lower WACC."
            />
          </AssumptionPanel>
        </div>

        {/* RIGHT: preview or calc tab */}
        <div style={{ background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 6, overflow: 'hidden' }}>
          {tab === 'preview' && (
            <PreviewPane
              sections={sections}
              subject={subject}
              history={history}
              peerSet={peerSet}
              peers={peers}
              dcf={dcf}
              comps={comps}
              bv={bv}
              football={football}
              scenarios={scenarios}
              synergy={synergy}
              hhi={hhi}
              adjusted={adjusted}
              newsAgg={newsAgg}
            />
          )}
          {tab === 'calc' && <CalcTracePane trace={trace} />}
          {tab === 'export' && (
            <ExportPane sections={sections} onDownload={downloadHtml} ticker={subject.ticker} />
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Section toggle panel ────────────────────────────────────

function SectionTogglePanel({
  sections,
  onToggle,
}: {
  sections: Record<SectionId, boolean>
  onToggle: (id: SectionId) => void
}) {
  const categories: Array<{ key: SectionDef['category']; label: string; color: string }> = [
    { key: 'overview', label: 'Overview', color: 'var(--cyan2)' },
    { key: 'valuation', label: 'Valuation', color: 'var(--gold2)' },
    { key: 'context', label: 'Context', color: 'var(--green)' },
    { key: 'decision', label: 'Decision', color: 'var(--orange)' },
  ]
  const enabled = Object.values(sections).filter(Boolean).length

  return (
    <div style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, padding: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--txt)' }}>
          Sections
        </div>
        <div style={{ fontSize: 9, color: 'var(--txt3)' }}>
          {enabled} of {SECTIONS.length} included
        </div>
      </div>
      {categories.map((cat) => (
        <div key={cat.key} style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 8, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: cat.color, marginBottom: 3 }}>
            {cat.label}
          </div>
          {SECTIONS.filter((s) => s.category === cat.key).map((s) => (
            <label
              key={s.id}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 6,
                padding: '4px 6px', fontSize: 11, color: 'var(--txt2)',
                cursor: 'pointer', borderRadius: 3,
                background: sections[s.id] ? 'rgba(255,255,255,0.03)' : 'transparent',
              }}
              title={s.description}
            >
              <input
                type="checkbox"
                checked={sections[s.id]}
                onChange={() => onToggle(s.id)}
                style={{ marginTop: 2, accentColor: cat.color }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ color: sections[s.id] ? 'var(--txt)' : 'var(--txt3)', fontWeight: 500 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: 9, color: 'var(--txt3)', marginTop: 1 }}>
                  {s.description}
                </div>
              </div>
            </label>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Assumption panel ────────────────────────────────────────

function AssumptionPanel({
  title,
  color,
  children,
}: {
  title: string
  color: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, overflow: 'hidden' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: '100%', textAlign: 'left', background: 'transparent',
          border: 'none', padding: '8px 10px', cursor: 'pointer',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          borderBottom: open ? '1px solid var(--br)' : 'none',
        }}
      >
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color }}>
          {title}
        </span>
        <span style={{ color: 'var(--txt3)', fontSize: 11 }}>{open ? '−' : '+'}</span>
      </button>
      {open && <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>{children}</div>}
    </div>
  )
}

function NumberInput({
  label, value, unit, step = 0.5, onChange, help,
}: {
  label: string
  value: number
  unit: string
  step?: number
  onChange: (v: number) => void
  help?: string
}) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 6, alignItems: 'center' }}>
      <span style={{ fontSize: 10, color: 'var(--txt2)' }} title={help}>
        {label}
        {help && <span style={{ fontSize: 9, color: 'var(--txt3)', marginLeft: 3 }}>ⓘ</span>}
      </span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <input
          type="number"
          value={Number.isFinite(value) ? value.toFixed(step < 1 ? 2 : 0) : ''}
          step={step}
          onChange={(e) => {
            const n = parseFloat(e.target.value)
            if (Number.isFinite(n)) onChange(n)
          }}
          style={{ ...inputStyle, width: 70, padding: '4px 6px', fontSize: 11 }}
        />
        <span style={{ fontSize: 10, color: 'var(--txt3)', minWidth: 12 }}>{unit}</span>
      </div>
    </label>
  )
}

// ─── Preview pane ────────────────────────────────────────────

interface PreviewData {
  sections: Record<SectionId, boolean>
  subject: Company
  history: FinancialHistory
  peerSet: PeerSet
  peers: PeerStats
  dcf: DcfResult
  comps: ComparableResult[]
  bv: BookValueResult
  football: FootballFieldBar[]
  scenarios: Array<{ label: string; assum: DcfAssumptions; result: DcfResult }>
  synergy: { rs: number; cs: number; ic: number; npv: number }
  hhi: { hhi: number; risk: string; topShare: number | null; shares: Array<{ ticker: string; name: string; pct: number }> }
  adjusted: ReturnType<typeof computeAdjustedMetrics>
  newsAgg: CompanyNewsAggregate | null
}

function PreviewPane(p: PreviewData) {
  const { sections, subject, history, peerSet, peers, dcf, comps, bv, football, scenarios, synergy, hhi, adjusted, newsAgg } = p

  const pct = (n: number | null | undefined, d = 1) =>
    n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(d)}%`
  const mult = (n: number | null | undefined, d = 1) =>
    n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(d)}×`

  // Verdict based on blended mid
  const allEquity = [dcf.equityValue, ...comps.map((c) => c.equityMedian), bv.equityValue].filter((v) => v > 0)
  const mid = allEquity.length > 0 ? allEquity.reduce((a, b) => a + b, 0) / allEquity.length : 0
  const upside = subject.mktcap > 0 ? ((mid - subject.mktcap) / subject.mktcap) * 100 : 0
  const verdict =
    upside > 25 ? { label: 'Strong Buy', color: '#1B7F3F' } :
    upside > 10 ? { label: 'Buy', color: '#1B7F3F' } :
    upside > -5 ? { label: 'Hold', color: '#A6860A' } :
    upside > -20 ? { label: 'Monitor', color: '#9A4600' } :
    { label: 'Pass', color: '#A9232B' }

  return (
    <div style={{ padding: 18, background: '#FAFAF7', color: '#1a1a1a', minHeight: 500, overflowY: 'auto' }}>
      {sections.cover && (
        <ReportSection>
          <div style={{ borderBottom: '3px solid #9A4600', paddingBottom: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: '#9A4600' }}>
              Valuation Report · Confidential
            </div>
            <div style={{ fontSize: 30, fontWeight: 700, color: '#051C2C', marginTop: 8, fontFamily: 'Source Serif 4, Georgia, serif' }}>
              {subject.name}
            </div>
            <div style={{ fontSize: 12, color: '#555', marginTop: 4 }}>
              {subject.ticker} · {subject.sec === 'solar' ? 'Solar Value Chain' : 'T&D Infrastructure'}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <KPI label="DCF Equity Value" value={formatInrCr(dcf.equityValue)} accent />
            <KPI label="Upside vs. MktCap" value={pct(dcf.upsideVsMarketCap)} accent={dcf.upsideVsMarketCap > 0} negative={dcf.upsideVsMarketCap < 0} />
            <KPI label="Recommendation" value={verdict.label} color={verdict.color} />
          </div>
        </ReportSection>
      )}

      {sections.execSummary && (
        <ReportSection title="Executive Summary">
          <table style={previewTableStyle}>
            <tbody>
              <tr><td style={lblCellStyle}>Current MktCap</td><td style={numCellStyle}>{formatInrCr(subject.mktcap)}</td></tr>
              <tr><td style={lblCellStyle}>Current EV</td><td style={numCellStyle}>{formatInrCr(subject.ev)}</td></tr>
              <tr><td style={lblCellStyle}>TTM Revenue</td><td style={numCellStyle}>{formatInrCr(subject.rev)}</td></tr>
              <tr><td style={lblCellStyle}>TTM EBITDA</td><td style={numCellStyle}>{formatInrCr(subject.ebitda)} ({pct(subject.ebm)})</td></tr>
              <tr><td style={lblCellStyle}>Current EV/EBITDA</td><td style={numCellStyle}>{mult(subject.ev_eb)}</td></tr>
              <tr><td style={lblCellStyle}>Revenue CAGR (hist.)</td><td style={numCellStyle}>{pct(history.cagrs.revenueCagrPct)}</td></tr>
              <tr><td style={lblCellStyle}>DCF Equity</td><td style={{ ...numCellStyle, fontWeight: 700, color: '#1B7F3F' }}>{formatInrCr(dcf.equityValue)}</td></tr>
              <tr><td style={lblCellStyle}>Acquisition Score</td><td style={numCellStyle}>{subject.acqs?.toFixed(1) ?? '—'} / 10 — {subject.acqf}</td></tr>
            </tbody>
          </table>
        </ReportSection>
      )}

      {sections.inputs && (
        <ReportSection title="Subject Inputs">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <KPI label="Revenue" value={formatInrCr(subject.rev)} />
            <KPI label="EBITDA" value={formatInrCr(subject.ebitda)} />
            <KPI label="Net Profit" value={formatInrCr(subject.pat)} />
            <KPI label="EV" value={formatInrCr(subject.ev)} />
            <KPI label="EV/EBITDA" value={mult(subject.ev_eb)} />
            <KPI label="P/E" value={mult(subject.pe)} />
            <KPI label="P/B" value={mult(subject.pb, 2)} />
            <KPI label="D/E" value={subject.dbt_eq?.toFixed(2) ?? '—'} />
          </div>
        </ReportSection>
      )}

      {sections.history && (
        <ReportSection title="Financial History">
          <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>
            {history.yearsOfHistory}-year history · source: <strong>{history.source}</strong>
          </div>
          <table style={previewTableStyle}>
            <tbody>
              <tr><td style={lblCellStyle}>Revenue CAGR</td><td style={numCellStyle}>{pct(history.cagrs.revenueCagrPct)}</td></tr>
              <tr><td style={lblCellStyle}>EBITDA CAGR</td><td style={numCellStyle}>{pct(history.cagrs.ebitdaCagrPct)}</td></tr>
              <tr><td style={lblCellStyle}>Net Income CAGR</td><td style={numCellStyle}>{pct(history.cagrs.netIncomeCagrPct)}</td></tr>
            </tbody>
          </table>
          {history.history.length > 0 && (
            <table style={{ ...previewTableStyle, marginTop: 10 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Year</th>
                  <th style={thStyle}>Revenue</th>
                  <th style={thStyle}>EBITDA</th>
                  <th style={thStyle}>Net Income</th>
                  <th style={thStyle}>EBITDA %</th>
                </tr>
              </thead>
              <tbody>
                {history.history.slice(0, 5).map((y, i) => (
                  <tr key={i}>
                    <td style={lblCellStyle}>{y.fiscalYear}</td>
                    <td style={numCellStyle}>{y.revenue != null ? formatInrCr(y.revenue) : '—'}</td>
                    <td style={numCellStyle}>{y.ebitda != null ? formatInrCr(y.ebitda) : '—'}</td>
                    <td style={numCellStyle}>{y.netIncome != null ? formatInrCr(y.netIncome) : '—'}</td>
                    <td style={numCellStyle}>{y.ebitdaMarginPct != null ? pct(y.ebitdaMarginPct) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </ReportSection>
      )}

      {sections.peers && (
        <ReportSection title="Peer Set">
          <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>
            {peerSet.peers.length} closest peers selected by value-chain overlap
          </div>
          <table style={previewTableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Peer</th>
                <th style={thStyle}>MktCap</th>
                <th style={thStyle}>EV/EBITDA</th>
                <th style={thStyle}>P/E</th>
                <th style={thStyle}>EBM %</th>
                <th style={thStyle}>Overlap</th>
              </tr>
            </thead>
            <tbody>
              {peerSet.peers.map((p) => (
                <tr key={p.ticker}>
                  <td style={lblCellStyle}>{p.name}<br /><span style={{ fontSize: 9, color: '#888' }}>{p.ticker}</span></td>
                  <td style={numCellStyle}>{formatInrCr(p.mktcap)}</td>
                  <td style={numCellStyle}>{mult(p.ev_eb)}</td>
                  <td style={numCellStyle}>{mult(p.pe)}</td>
                  <td style={numCellStyle}>{pct(p.ebm)}</td>
                  <td style={numCellStyle}>{peerSet.scores[p.ticker] ?? 0}</td>
                </tr>
              ))}
              <tr style={{ background: 'rgba(154,70,0,0.06)', fontWeight: 600 }}>
                <td style={lblCellStyle}>Peer Median</td>
                <td style={numCellStyle}>{formatInrCr(peers.mktcap.median)}</td>
                <td style={numCellStyle}>{mult(peers.ev_eb.median)}</td>
                <td style={numCellStyle}>{mult(peers.pe.median)}</td>
                <td style={numCellStyle}>{pct(peers.ebm.median)}</td>
                <td style={numCellStyle}>—</td>
              </tr>
            </tbody>
          </table>
        </ReportSection>
      )}

      {sections.dcf && (
        <ReportSection title="DCF Valuation">
          {dcf.reliability !== 'high' && (
            <div style={{
              padding: '8px 10px', marginBottom: 10,
              background: dcf.reliability === 'nm' ? '#fff0f0' : dcf.reliability === 'low' ? '#fff7e0' : '#f5f5f0',
              border: `1px solid ${dcf.reliability === 'nm' ? '#A9232B' : dcf.reliability === 'low' ? '#9A4600' : '#a6860a'}`,
              borderRadius: 4, fontSize: 10, color: '#3a3a3a',
            }}>
              <strong style={{ textTransform: 'uppercase', fontSize: 9, letterSpacing: 0.5 }}>
                DCF reliability: {dcf.reliability === 'nm' ? 'Not meaningful' : dcf.reliability}
              </strong>
              {dcf.reliabilityNotes.length > 0 && (
                <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                  {dcf.reliabilityNotes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
            <KPI label="DCF EV" value={formatInrCr(dcf.enterpriseValue)} />
            <KPI label="DCF Equity" value={formatInrCr(dcf.equityValue)} accent />
            <KPI label="Implied EV/EBITDA" value={mult(dcf.impliedEvEbitda)} />
            <KPI label="Upside" value={pct(dcf.upsideVsMarketCap)} accent={dcf.upsideVsMarketCap > 0} />
          </div>
          <table style={previewTableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Year</th>
                <th style={thStyle}>Revenue</th>
                <th style={thStyle}>Growth</th>
                <th style={thStyle}>EBITDA</th>
                <th style={thStyle}>FCF</th>
                <th style={thStyle}>PV of FCF</th>
              </tr>
            </thead>
            <tbody>
              {dcf.rows.map((r) => (
                <tr key={r.year}>
                  <td style={lblCellStyle}>Y{r.year}</td>
                  <td style={numCellStyle}>{formatInrCr(r.revenue)}</td>
                  <td style={numCellStyle}>{pct(r.growthPct)}</td>
                  <td style={numCellStyle}>{formatInrCr(r.ebitda)}</td>
                  <td style={numCellStyle}>{formatInrCr(r.fcf)}</td>
                  <td style={numCellStyle}>{formatInrCr(r.pvFcf)}</td>
                </tr>
              ))}
              <tr style={{ background: 'rgba(27,127,63,0.08)', fontWeight: 600 }}>
                <td style={lblCellStyle}>Sum of PV(FCF)</td>
                <td colSpan={4} style={numCellStyle}></td>
                <td style={numCellStyle}>{formatInrCr(dcf.sumPvFcf)}</td>
              </tr>
              <tr style={{ background: 'rgba(27,127,63,0.08)', fontWeight: 600 }}>
                <td style={lblCellStyle}>PV of Terminal Value</td>
                <td colSpan={4} style={numCellStyle}>
                  <span style={{ fontSize: 10, color: '#555' }}>
                    TV = {formatInrCr(dcf.terminalValue)} at {pct(dcf.assumptions.terminalGrowth * 100, 2)} g · {pct(dcf.assumptions.wacc * 100, 2)} WACC
                  </span>
                </td>
                <td style={numCellStyle}>{formatInrCr(dcf.pvTerminalValue)}</td>
              </tr>
              <tr style={{ background: 'rgba(154,70,0,0.1)', fontWeight: 700 }}>
                <td style={lblCellStyle}>Enterprise Value</td>
                <td colSpan={4} style={numCellStyle}></td>
                <td style={numCellStyle}>{formatInrCr(dcf.enterpriseValue)}</td>
              </tr>
              <tr>
                <td style={lblCellStyle}>Less: Net Debt</td>
                <td colSpan={4} style={numCellStyle}></td>
                <td style={numCellStyle}>{formatInrCr(dcf.netDebt)}</td>
              </tr>
              <tr style={{ background: 'rgba(27,127,63,0.12)', fontWeight: 700 }}>
                <td style={lblCellStyle}>Equity Value</td>
                <td colSpan={4} style={numCellStyle}></td>
                <td style={numCellStyle}>{formatInrCr(dcf.equityValue)}</td>
              </tr>
            </tbody>
          </table>
        </ReportSection>
      )}

      {sections.comparables && (
        <ReportSection title="Comparable Multiples">
          <table style={previewTableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Method</th>
                <th style={thStyle}>Peer Low (Q1)</th>
                <th style={thStyle}>Peer Median</th>
                <th style={thStyle}>Peer High (Q3)</th>
                <th style={thStyle}>Equity Median</th>
                <th style={thStyle}>Upside %</th>
              </tr>
            </thead>
            <tbody>
              {comps.map((c) => (
                <tr key={c.method}>
                  <td style={lblCellStyle}>{c.label}</td>
                  <td style={numCellStyle}>{mult(c.peerLow)}</td>
                  <td style={numCellStyle}>{mult(c.peerMedian)}</td>
                  <td style={numCellStyle}>{mult(c.peerHigh)}</td>
                  <td style={numCellStyle}>{formatInrCr(c.equityMedian)}</td>
                  <td style={{ ...numCellStyle, color: c.upsidePctMedian > 0 ? '#1B7F3F' : '#A9232B' }}>
                    {c.upsidePctMedian > 0 ? '+' : ''}{c.upsidePctMedian.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportSection>
      )}

      {sections.bookValue && (
        <ReportSection title="Book Value">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <KPI label="Derived Book" value={formatInrCr(bv.bookValue)} />
            <KPI label="Premium" value={`${bv.strategicPremium.toFixed(2)}×`} />
            <KPI label="Book × Premium" value={formatInrCr(bv.equityValue)} accent={bv.upsidePct > 0} />
          </div>
        </ReportSection>
      )}

      {sections.football && (
        <ReportSection title="Football Field">
          <FootballFieldChart bars={football} currentMktcap={subject.mktcap} />
        </ReportSection>
      )}

      {sections.news && newsAgg && newsAgg.items.length > 0 && (
        <ReportSection title="News Impact">
          <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>
            {newsAgg.items.length} news items analysed · {adjusted.acknowledgedCount} acknowledged
          </div>
          <table style={previewTableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Parameter</th>
                <th style={thStyle}>Pre</th>
                <th style={thStyle}>Post</th>
                <th style={thStyle}>Δ%</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={lblCellStyle}>Revenue Growth</td>
                <td style={numCellStyle}>{pct(adjusted.pre.revg)}</td>
                <td style={numCellStyle}>{pct(adjusted.post.revg)}</td>
                <td style={{ ...numCellStyle, color: adjusted.deltaPct.revg > 0 ? '#1B7F3F' : '#A9232B' }}>
                  {pct(adjusted.deltaPct.revg, 2)}
                </td>
              </tr>
              <tr>
                <td style={lblCellStyle}>EBITDA Margin</td>
                <td style={numCellStyle}>{pct(adjusted.pre.ebm)}</td>
                <td style={numCellStyle}>{pct(adjusted.post.ebm)}</td>
                <td style={{ ...numCellStyle, color: adjusted.deltaPct.ebm > 0 ? '#1B7F3F' : '#A9232B' }}>
                  {pct(adjusted.deltaPct.ebm, 2)}
                </td>
              </tr>
              <tr>
                <td style={lblCellStyle}>EV/EBITDA Multiple</td>
                <td style={numCellStyle}>{mult(adjusted.pre.ev_eb)}</td>
                <td style={numCellStyle}>{mult(adjusted.post.ev_eb)}</td>
                <td style={{ ...numCellStyle, color: adjusted.deltaPct.ev_eb > 0 ? '#1B7F3F' : '#A9232B' }}>
                  {pct(adjusted.deltaPct.ev_eb, 2)}
                </td>
              </tr>
            </tbody>
          </table>
        </ReportSection>
      )}

      {sections.synergy && (
        <ReportSection title="Synergy NPV">
          <table style={previewTableStyle}>
            <tbody>
              <tr><td style={lblCellStyle}>Annual Revenue Synergy</td><td style={numCellStyle}>{formatInrCr(synergy.rs)}</td></tr>
              <tr><td style={lblCellStyle}>Annual Cost Synergy</td><td style={numCellStyle}>{formatInrCr(synergy.cs)}</td></tr>
              <tr><td style={lblCellStyle}>One-time Integration Cost</td><td style={numCellStyle}>−{formatInrCr(synergy.ic)}</td></tr>
              <tr style={{ background: 'rgba(154,70,0,0.1)', fontWeight: 700 }}>
                <td style={lblCellStyle}>Synergy NPV</td>
                <td style={{ ...numCellStyle, color: synergy.npv > 0 ? '#1B7F3F' : '#A9232B' }}>
                  {formatInrCr(synergy.npv)}
                </td>
              </tr>
            </tbody>
          </table>
          <div style={{ fontSize: 10, color: '#555', marginTop: 6 }}>
            Formula: (Rev Syn × 30% realisation + Cost Syn) × 7× perpetuity − Integration Cost
          </div>
        </ReportSection>
      )}

      {sections.scenarios && (
        <ReportSection title="Bull / Base / Bear Scenarios">
          <table style={previewTableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Scenario</th>
                <th style={thStyle}>Growth</th>
                <th style={thStyle}>EBITDA %</th>
                <th style={thStyle}>WACC</th>
                <th style={thStyle}>Equity Value</th>
                <th style={thStyle}>Upside</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((s) => (
                <tr key={s.label} style={{ background: s.label === 'Base' ? 'rgba(154,70,0,0.06)' : undefined, fontWeight: s.label === 'Base' ? 600 : 400 }}>
                  <td style={lblCellStyle}>{s.label}</td>
                  <td style={numCellStyle}>{pct(s.assum.startingGrowth * 100)}</td>
                  <td style={numCellStyle}>{pct(s.assum.startingEbitdaMargin * 100)}</td>
                  <td style={numCellStyle}>{pct(s.assum.wacc * 100, 2)}</td>
                  <td style={numCellStyle}>{formatInrCr(s.result.equityValue)}</td>
                  <td style={{ ...numCellStyle, color: s.result.upsideVsMarketCap > 0 ? '#1B7F3F' : '#A9232B' }}>
                    {pct(s.result.upsideVsMarketCap)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportSection>
      )}

      {sections.concentration && (
        <ReportSection title="Market Concentration">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 }}>
            <KPI label="HHI" value={hhi.hhi.toLocaleString()} />
            <KPI label="Concentration Risk" value={hhi.risk} color={hhi.risk === 'Safe' ? '#1B7F3F' : hhi.risk === 'Moderate' ? '#A6860A' : '#A9232B'} />
            <KPI label="Top Player Share" value={hhi.topShare != null ? pct(hhi.topShare) : '—'} />
          </div>
          <table style={previewTableStyle}>
            <thead><tr><th style={thStyle}>Company</th><th style={thStyle}>MktCap Share</th></tr></thead>
            <tbody>
              {hhi.shares.slice(0, 5).map((s) => (
                <tr key={s.ticker}>
                  <td style={lblCellStyle}>{s.name}</td>
                  <td style={numCellStyle}>{pct(s.pct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ReportSection>
      )}

      {sections.conclusion && (
        <ReportSection title="Conclusion & Recommendation">
          <div style={{
            padding: 16, background: `${verdict.color}15`, border: `2px solid ${verdict.color}`,
            borderRadius: 4, marginBottom: 10,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: verdict.color }}>
              Recommendation
            </div>
            <div style={{ fontSize: 28, fontWeight: 700, color: verdict.color, marginTop: 4 }}>
              {verdict.label}
            </div>
            <div style={{ fontSize: 12, color: '#333', marginTop: 4 }}>
              Blended mid: <strong>{formatInrCr(mid)}</strong> · Current MktCap: <strong>{formatInrCr(subject.mktcap)}</strong> · Upside: <strong>{pct(upside)}</strong>
            </div>
          </div>
          <table style={previewTableStyle}>
            <thead><tr><th style={thStyle}>Method</th><th style={thStyle}>Equity Value</th></tr></thead>
            <tbody>
              <tr><td style={lblCellStyle}>DCF</td><td style={numCellStyle}>{formatInrCr(dcf.equityValue)}</td></tr>
              {comps.map((c) => (
                <tr key={c.method}><td style={lblCellStyle}>{c.method}</td><td style={numCellStyle}>{formatInrCr(c.equityMedian)}</td></tr>
              ))}
              <tr><td style={lblCellStyle}>Book × Premium</td><td style={numCellStyle}>{formatInrCr(bv.equityValue)}</td></tr>
              <tr style={{ background: 'rgba(154,70,0,0.06)', fontWeight: 700 }}>
                <td style={lblCellStyle}>Blended Mean</td>
                <td style={numCellStyle}>{formatInrCr(mid)}</td>
              </tr>
            </tbody>
          </table>
        </ReportSection>
      )}
    </div>
  )
}

// ─── Calculation Trace pane ──────────────────────────────────

function CalcTracePane({ trace }: { trace: CalcTraceEntry[] }) {
  const [filter, setFilter] = useState<TraceSection | 'all'>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const sections = useMemo(
    () => Array.from(new Set(trace.map((t) => t.section))) as TraceSection[],
    [trace]
  )
  const filtered = useMemo(
    () => (filter === 'all' ? trace : trace.filter((t) => t.section === filter)),
    [trace, filter]
  )
  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div style={{ padding: 14, minHeight: 500 }}>
      <div style={{ marginBottom: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={labelStyle}>Filter by section:</span>
        <button
          onClick={() => setFilter('all')}
          style={{ ...tabBtnStyle, fontSize: 10, padding: '4px 10px', background: filter === 'all' ? 'var(--golddim)' : 'var(--s3)', color: filter === 'all' ? 'var(--gold2)' : 'var(--txt2)' }}
        >
          All ({trace.length})
        </button>
        {sections.map((s) => {
          const count = trace.filter((t) => t.section === s).length
          return (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{ ...tabBtnStyle, fontSize: 10, padding: '4px 10px', background: filter === s ? 'var(--golddim)' : 'var(--s3)', color: filter === s ? 'var(--gold2)' : 'var(--txt2)' }}
            >
              {s} ({count})
            </button>
          )
        })}
      </div>
      <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 8 }}>
        {filtered.length} calculations · click a row to expand the formula, inputs, source and concept.
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
          <thead style={{ background: 'var(--s3)', position: 'sticky', top: 0 }}>
            <tr>
              <th style={calcTh}>#</th>
              <th style={calcTh}>Section</th>
              <th style={calcTh}>Metric</th>
              <th style={calcTh}>Value</th>
              <th style={calcTh}>Source</th>
              <th style={calcTh}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e, i) => (
              <FragmentRow key={e.id} idx={i + 1} entry={e} expanded={expanded.has(e.id)} onToggle={() => toggle(e.id)} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function FragmentRow({ idx, entry, expanded, onToggle }: { idx: number; entry: CalcTraceEntry; expanded: boolean; onToggle: () => void }) {
  const sectionColor: Partial<Record<TraceSection, string>> = {
    Inputs: 'var(--cyan2)',
    'Financial History': 'var(--cyan2)',
    DCF: 'var(--green)',
    Comparables: 'var(--gold2)',
    'Book Value': 'var(--gold2)',
    Peers: 'var(--gold2)',
    'Football Field': 'var(--orange)',
    'News Impact': 'var(--red)',
    Synergy: 'var(--orange)',
    Concentration: 'var(--txt2)',
    Conclusion: 'var(--gold2)',
  }
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: 'pointer', borderBottom: '1px solid var(--br)', background: expanded ? 'var(--s3)' : 'transparent' }}
      >
        <td style={calcTd}>{idx}</td>
        <td style={{ ...calcTd, color: sectionColor[entry.section] ?? 'var(--txt2)', fontWeight: 600, fontSize: 10 }}>
          {entry.section}
        </td>
        <td style={{ ...calcTd, color: 'var(--txt)', fontWeight: 500 }}>{entry.metric}</td>
        <td style={{ ...calcTd, fontFamily: 'JetBrains Mono, monospace', color: 'var(--gold2)' }}>{entry.value}</td>
        <td style={{ ...calcTd, fontSize: 10, color: 'var(--txt3)' }}>{entry.source}</td>
        <td style={{ ...calcTd, color: 'var(--txt3)', textAlign: 'center', width: 30 }}>{expanded ? '▾' : '▸'}</td>
      </tr>
      {expanded && (
        <tr style={{ background: 'var(--s3)', borderBottom: '1px solid var(--br)' }}>
          <td colSpan={6} style={{ padding: '10px 14px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <div>
                <div style={calcDetailLbl}>Formula</div>
                <div style={{ ...calcDetailVal, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'pre-wrap' }}>
                  {entry.formula}
                </div>
              </div>
              <div>
                <div style={calcDetailLbl}>Concept</div>
                <div style={calcDetailVal}>{entry.concept}</div>
              </div>
              <div>
                <div style={calcDetailLbl}>Inputs</div>
                <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse' }}>
                  <tbody>
                    {entry.inputs.map((inp, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--br)' }}>
                        <td style={{ padding: '3px 6px', color: 'var(--txt3)', width: '45%' }}>{inp.name}</td>
                        <td style={{ padding: '3px 6px', color: 'var(--txt)', fontFamily: 'JetBrains Mono, monospace' }}>{inp.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <div style={calcDetailLbl}>Source</div>
                <div style={calcDetailVal}>{entry.source}</div>
                {entry.notes && (
                  <>
                    <div style={{ ...calcDetailLbl, marginTop: 8 }}>Notes</div>
                    <div style={{ ...calcDetailVal, color: 'var(--orange)' }}>{entry.notes}</div>
                  </>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ─── Export pane ─────────────────────────────────────────────

function ExportPane({ sections, onDownload, ticker }: { sections: Record<SectionId, boolean>; onDownload: () => void; ticker: string }) {
  const enabledCount = Object.values(sections).filter(Boolean).length
  return (
    <div style={{ padding: 24, minHeight: 500 }}>
      <div style={{ fontSize: 14, color: 'var(--txt)', fontWeight: 600, marginBottom: 12 }}>
        Export Options
      </div>

      <div style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, padding: 16, marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--gold2)' }}>
          Standalone HTML
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt2)', marginTop: 6, lineHeight: 1.6 }}>
          Downloads a self-contained HTML file with inline CSS — no external dependencies, opens in any browser, prints cleanly to PDF.
          Contains exactly the {enabledCount} sections you\u2019ve selected, plus the Calculations audit appendix.
        </div>
        <button onClick={onDownload} style={{ ...downloadBtnStyle, marginTop: 12 }}>
          ↓ Download {ticker}-valuation-report.html
        </button>
      </div>

      <div style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, padding: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--cyan2)' }}>
          Print-Friendly PDF View
        </div>
        <div style={{ fontSize: 12, color: 'var(--txt2)', marginTop: 6, lineHeight: 1.6 }}>
          Opens the styled print layout in a new tab. Use browser Print → Save as PDF for the institutional-quality version with charts.
          Respects the same section toggles and assumptions.
        </div>
        <Link
          href={`/report/${ticker}`}
          target="_blank"
          style={{ ...downloadBtnStyle, background: 'var(--cyan2)', marginTop: 12, display: 'inline-block', textAlign: 'center' }}
        >
          ↗ Open /report/{ticker}
        </Link>
      </div>
    </div>
  )
}

// ─── Shared preview components ───────────────────────────────

function ReportSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid #E8E5DA' }}>
      {title && (
        <div style={{ fontSize: 16, fontWeight: 700, color: '#051C2C', marginBottom: 10, fontFamily: 'Source Serif 4, Georgia, serif', borderLeft: '3px solid #9A4600', paddingLeft: 10 }}>
          {title}
        </div>
      )}
      {children}
    </div>
  )
}

function KPI({ label, value, accent, negative, color }: { label: string; value: string; accent?: boolean; negative?: boolean; color?: string }) {
  const fg = color || (accent ? '#1B7F3F' : negative ? '#A9232B' : '#051C2C')
  return (
    <div style={{ padding: 10, background: '#fff', border: '1px solid #E8E5DA', borderRadius: 3 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', color: '#888' }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: fg, marginTop: 4, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
    </div>
  )
}

function FootballFieldChart({ bars, currentMktcap }: { bars: FootballFieldBar[]; currentMktcap: number }) {
  const maxVal = Math.max(currentMktcap, ...bars.map((b) => b.high))
  return (
    <div>
      {bars.map((b, i) => {
        const lowPct = (b.low / maxVal) * 100
        const highPct = (b.high / maxVal) * 100
        const midPct = (b.medianOrMid / maxVal) * 100
        return (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '200px 1fr 120px', alignItems: 'center', gap: 8, padding: '6px 0' }}>
            <div style={{ fontSize: 11, color: '#333' }}>{b.label}</div>
            <div style={{ position: 'relative', height: 18, background: '#F0EDE5', borderRadius: 2 }}>
              <div
                style={{
                  position: 'absolute',
                  left: `${lowPct}%`,
                  width: `${Math.max(0.5, highPct - lowPct)}%`,
                  top: 0, bottom: 0,
                  background: '#9A4600',
                  opacity: 0.85,
                  borderRadius: 2,
                }}
              />
              <div style={{ position: 'absolute', left: `${midPct}%`, top: -2, bottom: -2, width: 2, background: '#051C2C' }} />
            </div>
            <div style={{ fontSize: 10, color: '#555', fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>
              {formatInrCr(b.low)} — {formatInrCr(b.high)}
            </div>
          </div>
        )
      })}
      <div style={{ fontSize: 10, color: '#888', marginTop: 6 }}>
        Vertical line = median · bar = Q1–Q3 range · scale: 0 → {formatInrCr(maxVal)}
      </div>
    </div>
  )
}

// ─── Standalone HTML builder ─────────────────────────────────

function buildStandaloneHtml(p: {
  subject: Company
  history: FinancialHistory
  peerSet: PeerSet
  peers: PeerStats
  dcf: DcfResult
  comps: ComparableResult[]
  bv: BookValueResult
  football: FootballFieldBar[]
  scenarios: Array<{ label: string; assum: DcfAssumptions; result: DcfResult }>
  synergy: { rs: number; cs: number; ic: number; npv: number }
  hhi: { hhi: number; risk: string; topShare: number | null; shares: Array<{ ticker: string; name: string; pct: number }> }
  sections: Record<SectionId, boolean>
  trace: CalcTraceEntry[]
  bookValuePremium: number
  synRevPct: number
  synCostPct: number
  integrationCostPct: number
}): string {
  const s = p.subject
  const pct = (n: number | null | undefined, d = 1) =>
    n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(d)}%`
  const mult = (n: number | null | undefined, d = 1) =>
    n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(d)}×`

  const allEquity = [p.dcf.equityValue, ...p.comps.map((c) => c.equityMedian), p.bv.equityValue].filter((v) => v > 0)
  const mid = allEquity.length > 0 ? allEquity.reduce((a, b) => a + b, 0) / allEquity.length : 0
  const upside = s.mktcap > 0 ? ((mid - s.mktcap) / s.mktcap) * 100 : 0
  const verdictText =
    upside > 25 ? 'Strong Buy' : upside > 10 ? 'Buy' : upside > -5 ? 'Hold' : upside > -20 ? 'Monitor' : 'Pass'
  const verdictColor =
    upside > 10 ? '#1B7F3F' : upside > -5 ? '#A6860A' : upside > -20 ? '#9A4600' : '#A9232B'

  const sections: string[] = []

  if (p.sections.cover) {
    sections.push(`<section class="cover">
      <div class="eyebrow">Valuation Report · Confidential</div>
      <h1>${escapeHtml(s.name)}</h1>
      <div class="subtitle">${s.ticker} · ${s.sec === 'solar' ? 'Solar Value Chain' : 'T&D Infrastructure'}</div>
      <div class="cover-kpis">
        <div class="kpi"><div class="kpi-label">DCF Equity</div><div class="kpi-value accent">${formatInrCr(p.dcf.equityValue)}</div></div>
        <div class="kpi"><div class="kpi-label">Upside</div><div class="kpi-value ${p.dcf.upsideVsMarketCap > 0 ? 'accent' : 'neg'}">${pct(p.dcf.upsideVsMarketCap)}</div></div>
        <div class="kpi"><div class="kpi-label">Recommendation</div><div class="kpi-value" style="color:${verdictColor}">${verdictText}</div></div>
      </div>
    </section>`)
  }

  if (p.sections.execSummary) {
    sections.push(`<section><h2>Executive Summary</h2>
      <table class="kv">
        <tr><td>Current MktCap</td><td>${formatInrCr(s.mktcap)}</td></tr>
        <tr><td>Current EV</td><td>${formatInrCr(s.ev)}</td></tr>
        <tr><td>TTM Revenue</td><td>${formatInrCr(s.rev)}</td></tr>
        <tr><td>TTM EBITDA (margin)</td><td>${formatInrCr(s.ebitda)} (${pct(s.ebm)})</td></tr>
        <tr><td>Current EV/EBITDA</td><td>${mult(s.ev_eb)}</td></tr>
        <tr><td>Revenue CAGR (hist.)</td><td>${pct(p.history.cagrs.revenueCagrPct)}</td></tr>
        <tr><td>DCF Equity Value</td><td class="good">${formatInrCr(p.dcf.equityValue)}</td></tr>
        <tr><td>Acquisition Score</td><td>${s.acqs?.toFixed(1) ?? '—'} / 10 — ${s.acqf}</td></tr>
      </table>
    </section>`)
  }

  if (p.sections.inputs) {
    sections.push(`<section><h2>Subject Inputs</h2>
      <div class="grid">
        <div class="kpi"><div class="kpi-label">Revenue</div><div class="kpi-value">${formatInrCr(s.rev)}</div></div>
        <div class="kpi"><div class="kpi-label">EBITDA</div><div class="kpi-value">${formatInrCr(s.ebitda)}</div></div>
        <div class="kpi"><div class="kpi-label">Net Profit</div><div class="kpi-value">${formatInrCr(s.pat)}</div></div>
        <div class="kpi"><div class="kpi-label">EV</div><div class="kpi-value">${formatInrCr(s.ev)}</div></div>
        <div class="kpi"><div class="kpi-label">EV/EBITDA</div><div class="kpi-value">${mult(s.ev_eb)}</div></div>
        <div class="kpi"><div class="kpi-label">P/E</div><div class="kpi-value">${mult(s.pe)}</div></div>
        <div class="kpi"><div class="kpi-label">P/B</div><div class="kpi-value">${mult(s.pb, 2)}</div></div>
        <div class="kpi"><div class="kpi-label">D/E</div><div class="kpi-value">${s.dbt_eq?.toFixed(2) ?? '—'}</div></div>
      </div>
    </section>`)
  }

  if (p.sections.history) {
    sections.push(`<section><h2>Financial History</h2>
      <p class="muted">${p.history.yearsOfHistory}-year history · source: ${p.history.source}</p>
      <table class="kv">
        <tr><td>Revenue CAGR</td><td>${pct(p.history.cagrs.revenueCagrPct)}</td></tr>
        <tr><td>EBITDA CAGR</td><td>${pct(p.history.cagrs.ebitdaCagrPct)}</td></tr>
        <tr><td>Net Income CAGR</td><td>${pct(p.history.cagrs.netIncomeCagrPct)}</td></tr>
      </table>
      ${p.history.history.length > 0 ? `<table class="data"><thead><tr><th>Year</th><th>Revenue</th><th>EBITDA</th><th>Net Income</th><th>EBITDA%</th></tr></thead>
      <tbody>${p.history.history.slice(0, 5).map((y) => `<tr><td>${y.fiscalYear}</td><td>${y.revenue != null ? formatInrCr(y.revenue) : '—'}</td><td>${y.ebitda != null ? formatInrCr(y.ebitda) : '—'}</td><td>${y.netIncome != null ? formatInrCr(y.netIncome) : '—'}</td><td>${y.ebitdaMarginPct != null ? pct(y.ebitdaMarginPct) : '—'}</td></tr>`).join('')}</tbody></table>` : ''}
    </section>`)
  }

  if (p.sections.peers) {
    sections.push(`<section><h2>Peer Set</h2>
      <table class="data">
        <thead><tr><th>Peer</th><th>MktCap</th><th>EV/EBITDA</th><th>P/E</th><th>EBM %</th><th>Overlap</th></tr></thead>
        <tbody>
          ${p.peerSet.peers.map((pp) => `<tr><td>${escapeHtml(pp.name)}<br><small>${pp.ticker}</small></td><td>${formatInrCr(pp.mktcap)}</td><td>${mult(pp.ev_eb)}</td><td>${mult(pp.pe)}</td><td>${pct(pp.ebm)}</td><td>${p.peerSet.scores[pp.ticker] ?? 0}</td></tr>`).join('')}
          <tr class="median"><td><strong>Peer Median</strong></td><td>${formatInrCr(p.peers.mktcap.median)}</td><td>${mult(p.peers.ev_eb.median)}</td><td>${mult(p.peers.pe.median)}</td><td>${pct(p.peers.ebm.median)}</td><td>—</td></tr>
        </tbody>
      </table>
    </section>`)
  }

  if (p.sections.dcf) {
    const relBanner = p.dcf.reliability === 'high' ? '' :
      `<div class="reliability-banner reliability-${p.dcf.reliability}">
        <strong>DCF reliability: ${p.dcf.reliability === 'nm' ? 'Not meaningful' : p.dcf.reliability}</strong>
        ${p.dcf.reliabilityNotes.length > 0 ? `<ul>${p.dcf.reliabilityNotes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ul>` : ''}
      </div>`
    sections.push(`<section><h2>DCF Valuation</h2>
      ${relBanner}
      <table class="data">
        <thead><tr><th>Year</th><th>Revenue</th><th>Growth</th><th>EBITDA</th><th>FCF</th><th>PV(FCF)</th></tr></thead>
        <tbody>
          ${p.dcf.rows.map((r) => `<tr><td>Y${r.year}</td><td>${formatInrCr(r.revenue)}</td><td>${pct(r.growthPct)}</td><td>${formatInrCr(r.ebitda)}</td><td>${formatInrCr(r.fcf)}</td><td>${formatInrCr(r.pvFcf)}</td></tr>`).join('')}
          <tr class="sub"><td>Sum of PV(FCF)</td><td colspan="4"></td><td>${formatInrCr(p.dcf.sumPvFcf)}</td></tr>
          <tr class="sub"><td>PV of Terminal Value</td><td colspan="4">TV = ${formatInrCr(p.dcf.terminalValue)} at g=${pct(p.dcf.assumptions.terminalGrowth * 100, 2)}, WACC=${pct(p.dcf.assumptions.wacc * 100, 2)}</td><td>${formatInrCr(p.dcf.pvTerminalValue)}</td></tr>
          <tr class="total"><td>Enterprise Value</td><td colspan="4"></td><td>${formatInrCr(p.dcf.enterpriseValue)}</td></tr>
          <tr><td>Less: Net Debt</td><td colspan="4"></td><td>${formatInrCr(p.dcf.netDebt)}</td></tr>
          <tr class="total good"><td>Equity Value</td><td colspan="4"></td><td>${formatInrCr(p.dcf.equityValue)}</td></tr>
        </tbody>
      </table>
    </section>`)
  }

  if (p.sections.comparables) {
    sections.push(`<section><h2>Comparable Multiples</h2>
      <table class="data">
        <thead><tr><th>Method</th><th>Peer Q1</th><th>Median</th><th>Q3</th><th>Equity Median</th><th>Upside</th></tr></thead>
        <tbody>${p.comps.map((c) => `<tr><td>${c.label}</td><td>${mult(c.peerLow)}</td><td>${mult(c.peerMedian)}</td><td>${mult(c.peerHigh)}</td><td>${formatInrCr(c.equityMedian)}</td><td class="${c.upsidePctMedian > 0 ? 'good' : 'bad'}">${c.upsidePctMedian > 0 ? '+' : ''}${c.upsidePctMedian.toFixed(1)}%</td></tr>`).join('')}</tbody>
      </table>
    </section>`)
  }

  if (p.sections.bookValue) {
    sections.push(`<section><h2>Book Value</h2>
      <table class="kv">
        <tr><td>Derived Book Value</td><td>${formatInrCr(p.bv.bookValue)} <small>(MktCap ÷ P/B)</small></td></tr>
        <tr><td>Strategic Premium</td><td>${p.bookValuePremium.toFixed(2)}×</td></tr>
        <tr><td>Book × Premium</td><td class="good">${formatInrCr(p.bv.equityValue)}</td></tr>
      </table>
    </section>`)
  }

  if (p.sections.synergy) {
    sections.push(`<section><h2>Synergy NPV</h2>
      <table class="kv">
        <tr><td>Annual Revenue Synergy</td><td>${formatInrCr(p.synergy.rs)} (${pct(p.synRevPct * 100)} of revenue)</td></tr>
        <tr><td>Annual Cost Synergy</td><td>${formatInrCr(p.synergy.cs)} (${pct(p.synCostPct * 100)} of EBITDA)</td></tr>
        <tr><td>One-time Integration</td><td>−${formatInrCr(p.synergy.ic)} (${pct(p.integrationCostPct * 100)} of MktCap)</td></tr>
        <tr class="total"><td>Synergy NPV</td><td class="${p.synergy.npv > 0 ? 'good' : 'bad'}">${formatInrCr(p.synergy.npv)}</td></tr>
      </table>
      <p class="muted small">Formula: (Rev × 30% realisation + Cost) × 7× perpetuity − Integration</p>
    </section>`)
  }

  if (p.sections.scenarios) {
    sections.push(`<section><h2>Bull / Base / Bear</h2>
      <table class="data">
        <thead><tr><th>Scenario</th><th>Growth</th><th>EBM</th><th>WACC</th><th>Equity</th><th>Upside</th></tr></thead>
        <tbody>${p.scenarios.map((sc) => `<tr${sc.label === 'Base' ? ' class="base"' : ''}><td>${sc.label}</td><td>${pct(sc.assum.startingGrowth * 100)}</td><td>${pct(sc.assum.startingEbitdaMargin * 100)}</td><td>${pct(sc.assum.wacc * 100, 2)}</td><td>${formatInrCr(sc.result.equityValue)}</td><td class="${sc.result.upsideVsMarketCap > 0 ? 'good' : 'bad'}">${pct(sc.result.upsideVsMarketCap)}</td></tr>`).join('')}</tbody>
      </table>
    </section>`)
  }

  if (p.sections.concentration) {
    sections.push(`<section><h2>Market Concentration</h2>
      <div class="grid">
        <div class="kpi"><div class="kpi-label">HHI</div><div class="kpi-value">${p.hhi.hhi.toLocaleString()}</div></div>
        <div class="kpi"><div class="kpi-label">Risk Band</div><div class="kpi-value">${p.hhi.risk}</div></div>
        <div class="kpi"><div class="kpi-label">Top Player</div><div class="kpi-value">${p.hhi.topShare != null ? pct(p.hhi.topShare) : '—'}</div></div>
      </div>
      <table class="data"><thead><tr><th>Company</th><th>MktCap Share</th></tr></thead>
      <tbody>${p.hhi.shares.slice(0, 5).map((sh) => `<tr><td>${escapeHtml(sh.name)}</td><td>${pct(sh.pct)}</td></tr>`).join('')}</tbody></table>
    </section>`)
  }

  if (p.sections.conclusion) {
    sections.push(`<section><h2>Conclusion &amp; Recommendation</h2>
      <div class="verdict" style="border-color:${verdictColor};background:${verdictColor}15">
        <div class="verdict-label" style="color:${verdictColor}">Recommendation</div>
        <div class="verdict-value" style="color:${verdictColor}">${verdictText}</div>
        <div>Blended mid: <strong>${formatInrCr(mid)}</strong> · Current MktCap: <strong>${formatInrCr(s.mktcap)}</strong> · Upside: <strong>${pct(upside)}</strong></div>
      </div>
      <table class="data">
        <thead><tr><th>Method</th><th>Equity Value</th></tr></thead>
        <tbody>
          <tr><td>DCF</td><td>${formatInrCr(p.dcf.equityValue)}</td></tr>
          ${p.comps.map((c) => `<tr><td>${c.method}</td><td>${formatInrCr(c.equityMedian)}</td></tr>`).join('')}
          <tr><td>Book × Premium</td><td>${formatInrCr(p.bv.equityValue)}</td></tr>
          <tr class="total"><td>Blended Mean</td><td>${formatInrCr(mid)}</td></tr>
        </tbody>
      </table>
    </section>`)
  }

  // Calculations audit appendix
  sections.push(`<section class="calc-appendix"><h2>Calculations Audit</h2>
    <p class="muted small">Every number in this report, with its formula, inputs, source and concept.</p>
    <table class="calc">
      <thead><tr><th>#</th><th>Section</th><th>Metric</th><th>Value</th><th>Formula</th><th>Source</th></tr></thead>
      <tbody>${p.trace.map((e, i) => `<tr><td>${i + 1}</td><td>${e.section}</td><td>${escapeHtml(e.metric)}</td><td class="mono">${escapeHtml(e.value)}</td><td class="mono small">${escapeHtml(e.formula)}</td><td class="small">${e.source}</td></tr>`).join('')}</tbody>
    </table>
  </section>`)

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(s.name)} — Valuation Report</title>
<style>
* { box-sizing: border-box; }
body { margin: 0; padding: 40px; font-family: Inter, -apple-system, Segoe UI, sans-serif; font-size: 13px; color: #1a1a1a; background: #FAFAF7; line-height: 1.6; }
.container { max-width: 900px; margin: 0 auto; background: #fff; padding: 40px; box-shadow: 0 2px 20px rgba(0,0,0,0.06); }
h1 { font-family: "Source Serif 4", Georgia, serif; font-size: 32px; color: #051C2C; margin: 10px 0; }
h2 { font-family: "Source Serif 4", Georgia, serif; font-size: 20px; color: #051C2C; border-left: 3px solid #9A4600; padding-left: 10px; margin: 30px 0 12px; }
.eyebrow { font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #9A4600; }
.subtitle { color: #555; font-size: 13px; }
section { margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid #E8E5DA; }
section.cover { border-bottom: 3px solid #9A4600; }
.cover-kpis, .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 12px; }
.cover-kpis { grid-template-columns: repeat(3, 1fr); }
.kpi { background: #F6F3EB; border: 1px solid #E8E5DA; border-radius: 3px; padding: 10px; }
.kpi-label { font-size: 9px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #888; }
.kpi-value { font-family: "JetBrains Mono", monospace; font-size: 18px; font-weight: 700; color: #051C2C; margin-top: 4px; }
.kpi-value.accent, .good { color: #1B7F3F; }
.kpi-value.neg, .bad { color: #A9232B; }
table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
table th { text-align: left; padding: 8px 10px; background: #F6F3EB; border-bottom: 2px solid #9A4600; font-size: 10px; text-transform: uppercase; letter-spacing: 0.6px; color: #555; }
table td { padding: 7px 10px; border-bottom: 1px solid #EDEAE2; }
table.kv td:first-child { color: #555; width: 45%; }
table.kv td:last-child, table.data td:not(:first-child) { text-align: right; font-family: "JetBrains Mono", monospace; }
tr.median, tr.sub, tr.total, tr.base { background: #F6F3EB; font-weight: 600; }
tr.total { background: #F0E3D0; font-weight: 700; }
.verdict { padding: 20px; border: 2px solid; border-radius: 4px; margin-bottom: 12px; }
.verdict-label { font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; }
.verdict-value { font-size: 28px; font-weight: 700; margin: 4px 0; }
.muted { color: #888; }
.small { font-size: 10px; }
.mono { font-family: "JetBrains Mono", monospace; }
table.calc { font-size: 10px; }
table.calc td, table.calc th { padding: 4px 8px; }
.calc-appendix { page-break-before: always; }
.reliability-banner { border: 1px solid; border-radius: 4px; padding: 8px 10px; margin-bottom: 10px; font-size: 10px; }
.reliability-banner strong { text-transform: uppercase; font-size: 9px; letter-spacing: 0.5px; }
.reliability-banner ul { margin: 4px 0 0; padding-left: 16px; }
.reliability-banner.reliability-medium { background: #f5f5f0; border-color: #a6860a; color: #3a3a3a; }
.reliability-banner.reliability-low { background: #fff7e0; border-color: #9A4600; color: #3a3a3a; }
.reliability-banner.reliability-nm { background: #fff0f0; border-color: #A9232B; color: #3a3a3a; }
@media print { body { padding: 0; background: #fff; } .container { box-shadow: none; padding: 20px; } }
</style></head><body><div class="container">
<header><div class="eyebrow">DealNector · Institutional Intelligence</div><div style="font-size:10px;color:#888;">Generated ${new Date().toLocaleString('en-IN')}</div></header>
${sections.join('\n')}
<footer style="margin-top:40px;padding-top:20px;border-top:2px solid #051C2C;font-size:10px;color:#888;">
  <strong>DealNector</strong> · Valuation Report · Confidential · Generated ${new Date().toLocaleString('en-IN')}
</footer>
</div></body></html>`
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

// ─── Styles ──────────────────────────────────────────────────

const labelStyle: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '1.2px',
  textTransform: 'uppercase',
  color: 'var(--txt3)',
}

const inputStyle: React.CSSProperties = {
  background: 'var(--s3)',
  border: '1px solid var(--br)',
  color: 'var(--txt)',
  padding: '6px 10px',
  borderRadius: 3,
  fontSize: 12,
  fontFamily: 'inherit',
  outline: 'none',
}

const tabBtnStyle: React.CSSProperties = {
  background: 'var(--s3)',
  border: '1px solid var(--br2)',
  padding: '6px 14px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.4px',
  textTransform: 'uppercase',
  borderRadius: 3,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

const downloadBtnStyle: React.CSSProperties = {
  background: 'var(--gold2)',
  color: '#000',
  border: 'none',
  padding: '8px 18px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.6px',
  textTransform: 'uppercase',
  borderRadius: 3,
  cursor: 'pointer',
  fontFamily: 'inherit',
  textDecoration: 'none',
}

const previewTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.6px',
  color: '#666',
  borderBottom: '2px solid #9A4600',
  background: '#F6F3EB',
}

const lblCellStyle: React.CSSProperties = {
  padding: '5px 8px',
  color: '#333',
  borderBottom: '1px solid #EDEAE2',
}

const numCellStyle: React.CSSProperties = {
  padding: '5px 8px',
  textAlign: 'right',
  fontFamily: 'JetBrains Mono, monospace',
  borderBottom: '1px solid #EDEAE2',
}

const calcTh: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.6px',
  color: 'var(--txt3)',
  fontWeight: 700,
  borderBottom: '1px solid var(--br)',
}

const calcTd: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 11,
  color: 'var(--txt2)',
}

const calcDetailLbl: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: '1.2px',
  textTransform: 'uppercase',
  color: 'var(--txt3)',
  marginBottom: 4,
}

const calcDetailVal: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--txt)',
  lineHeight: 1.6,
}

// Silence unused import warnings — CHAIN is kept for future segment enrichment.
void CHAIN
