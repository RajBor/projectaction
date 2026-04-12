'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { COMPANIES, type Company } from '@/lib/data/companies'
import { stockQuote, tickerToApiName, type StockProfile } from '@/lib/stocks/api'
import { buildFinancialHistory, formatCr, formatPct, formatRatio, type FinancialHistory } from '@/lib/valuation/history'
import { findPeers, computePeerStats, formatPeerValue, type PeerSet, type PeerStats } from '@/lib/valuation/peers'
import {
  defaultDcfAssumptions,
  runDcf,
  runComparables,
  runBookValue,
  buildFootballField,
  formatCr as fmtValCr,
  type DcfResult,
  type ComparableResult,
  type BookValueResult,
  type FootballFieldBar,
} from '@/lib/valuation/methods'
import { useNewsData } from '@/components/news/NewsDataProvider'
import type { CompanyNewsAggregate } from '@/lib/news/impact'
import { computeAdjustedMetrics, type CompanyAdjustedMetrics } from '@/lib/news/adjustments'
import { CHAIN, type ChainNode } from '@/lib/data/chain'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'
import { BarChart, barChartInference } from '@/components/fsa/charts/BarChart'
import { LineChartPrint, type LineSeries } from '@/components/fsa/charts/LineChart'
import { WaterfallChart, buildIncomeWaterfall, waterfallInference } from '@/components/fsa/charts/WaterfallChart'
import { RadarChart, normaliseRatio, radarInference } from '@/components/fsa/charts/RadarChart'
import { DuPontTree, dupontInference, type DuPontData } from '@/components/fsa/charts/DuPontTree'
import { ZScoreGauge, zScoreInference, type ZScoreData } from '@/components/fsa/charts/ZScoreGauge'

/**
 * DealNector Institutional Valuation Report.
 *
 * Route: /report/[ticker]?print=1
 *
 * Loads a company by ticker, assembles multi-year financials from
 * RapidAPI (with graceful fallback to the Company snapshot), runs
 * DCF + comparables + book-value methods, pulls peer statistics, and
 * renders a consulting-grade report that prints to PDF cleanly.
 */

export default function ReportPage() {
  const params = useParams<{ ticker: string }>()
  const searchParams = useSearchParams()
  const ticker = String(params?.ticker || '').toUpperCase()
  const autoPrint = searchParams.get('print') === '1'

  const baseSubject = useMemo<Company | null>(
    () => COMPANIES.find((c) => c.ticker === ticker) || null,
    [ticker]
  )

  // Apply live NSE/Screener data to refresh market metrics + recomputed acq score
  const { mergeCompany } = useLiveSnapshot()
  const subject = useMemo<Company | null>(
    () => baseSubject ? mergeCompany(baseSubject) : null,
    [baseSubject, mergeCompany]
  )

  const [profile, setProfile] = useState<StockProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [profileErr, setProfileErr] = useState<string | null>(null)

  // Fetch rapidapi profile for multi-year history (best-effort).
  useEffect(() => {
    if (!subject) {
      setLoadingProfile(false)
      return
    }
    let cancelled = false
    setLoadingProfile(true)
    setProfileErr(null)
    stockQuote(tickerToApiName(subject.ticker, subject.name), {})
      .then((res) => {
        if (cancelled) return
        if (res.ok && res.data) setProfile(res.data)
        else setProfileErr(res.error || 'Unable to fetch multi-year history')
        setLoadingProfile(false)
      })
      .catch(() => {
        if (!cancelled) {
          setLoadingProfile(false)
          setProfileErr('Network error loading multi-year history')
        }
      })
    return () => {
      cancelled = true
    }
  }, [subject])

  // Auto-print once everything is loaded (including profile, even if it errored).
  useEffect(() => {
    if (!autoPrint || !subject || loadingProfile) return
    const t = setTimeout(() => {
      try {
        window.print()
      } catch {
        /* ignore */
      }
    }, 600)
    return () => clearTimeout(t)
  }, [autoPrint, subject, loadingProfile])

  if (!subject) {
    return (
      <div style={{ padding: 40, fontFamily: 'Source Serif 4, serif', fontSize: 16 }}>
        No company found for ticker <code>{ticker}</code>. Please check the URL.
      </div>
    )
  }

  return (
    <ReportBody
      subject={subject}
      profile={profile}
      loadingProfile={loadingProfile}
      profileErr={profileErr}
    />
  )
}

// ── Inner component with all the memoized analysis ──────────────

function ReportBody({
  subject,
  profile,
  loadingProfile,
  profileErr,
}: {
  subject: Company
  profile: StockProfile | null
  loadingProfile: boolean
  profileErr: string | null
}) {
  const history: FinancialHistory = useMemo(
    () => buildFinancialHistory(subject, profile),
    [subject, profile]
  )

  const peerSet: PeerSet = useMemo(
    () => findPeers(subject, COMPANIES, 5),
    [subject]
  )
  const peers: PeerStats = useMemo(() => computePeerStats(peerSet), [peerSet])

  // ── Configurable assumptions (analyst can override via localStorage) ──
  const reportConfig = useMemo(() => {
    try {
      const stored = localStorage.getItem(`report_config_${subject.ticker}`)
      if (stored) return JSON.parse(stored)
    } catch { /* ignore */ }
    return {}
  }, [subject.ticker])

  const bookValuePremium = (reportConfig.bookValuePremium as number) ?? 1.25
  const synRevPct = (reportConfig.synergyRevenuePct as number) ?? 0.03
  const synCostPct = (reportConfig.synergyCostPct as number) ?? 0.015
  const integrationCostPct = (reportConfig.integrationCostPct as number) ?? 0.03
  const bullGrowthDelta = (reportConfig.bullGrowthDelta as number) ?? 0.03
  const bullMarginDelta = (reportConfig.bullMarginDelta as number) ?? 0.02
  const bullWaccDelta = (reportConfig.bullWaccDelta as number) ?? -0.005

  const dcf: DcfResult = useMemo(() => runDcf(subject, defaultDcfAssumptions(subject)), [subject])
  const comps: ComparableResult[] = useMemo(() => runComparables(subject, peers), [subject, peers])
  const bv: BookValueResult = useMemo(() => runBookValue(subject, bookValuePremium), [subject, bookValuePremium])
  const football: FootballFieldBar[] = useMemo(
    () => buildFootballField(subject, dcf, comps, bv),
    [subject, dcf, comps, bv]
  )

  // News impact for this subject — NewsDataProvider is mounted globally
  // via the root Providers so this is always safe.
  const newsData = useNewsData()
  const newsAgg: CompanyNewsAggregate | null = useMemo(
    () => newsData.aggregates[subject.ticker] ?? null,
    [newsData, subject.ticker]
  )
  const adjusted = useMemo(() => {
    if (!newsAgg) return computeAdjustedMetrics(subject, undefined)
    return computeAdjustedMetrics(subject, newsAgg)
  }, [subject, newsAgg])

  // Top 3 high-materiality news (positive + negative flagged separately)
  const highMatNews = useMemo(() => {
    if (!newsAgg) return { positive: [] as CompanyNewsAggregate['items'], negative: [] as CompanyNewsAggregate['items'] }
    const pos = newsAgg.items
      .filter((n) => n.impact.materiality === 'high' && n.impact.sentiment === 'positive')
      .slice(0, 3)
    const neg = newsAgg.items
      .filter((n) => n.impact.materiality === 'high' && n.impact.sentiment === 'negative')
      .slice(0, 3)
    return { positive: pos, negative: neg }
  }, [newsAgg])

  // ── NEW computation hooks for enhanced report ──

  // Chain nodes for subject's value-chain segments
  const subjectChainNodes: ChainNode[] = useMemo(
    () => (subject.comp || []).map(seg => CHAIN.find(c => c.id === seg)).filter(Boolean) as ChainNode[],
    [subject]
  )

  // All companies in same segments (for HHI)
  const segmentCompanies: Company[] = useMemo(() => {
    const subjectSegs = new Set(subject.comp || [])
    return COMPANIES.filter(co => co.mktcap > 0 && (co.comp || []).some(s => subjectSegs.has(s)))
  }, [subject])

  // HHI (Herfindahl-Hirschman Index) for market concentration
  const hhi = useMemo(() => {
    const totalMktcap = segmentCompanies.reduce((s, c) => s + c.mktcap, 0)
    if (totalMktcap === 0) return { hhi: 0, shares: [] as Array<{ticker:string;name:string;mktcap:number;sharePct:number}>, risk: 'Safe' as const }
    const shares = segmentCompanies
      .map(c => ({ ticker: c.ticker, name: c.name, mktcap: c.mktcap, sharePct: (c.mktcap / totalMktcap) * 100 }))
      .sort((a, b) => b.mktcap - a.mktcap)
    const hhiVal = shares.reduce((s, c) => s + c.sharePct * c.sharePct, 0)
    const risk: 'Safe' | 'Moderate' | 'High' = hhiVal < 1500 ? 'Safe' : hhiVal < 2500 ? 'Moderate' : 'High'
    return { hhi: Math.round(hhiVal), shares, risk }
  }, [segmentCompanies])

  // DCF Sensitivity Matrix (7 WACC × 5 Terminal Growth)
  const sensitivityMatrix = useMemo(() => {
    const baseAssumptions = defaultDcfAssumptions(subject)
    const baseWacc = baseAssumptions.wacc
    const baseTg = baseAssumptions.terminalGrowth
    const waccSteps = [-0.015, -0.01, -0.005, 0, 0.005, 0.01, 0.015]
    const tgSteps = [-0.01, -0.005, 0, 0.005, 0.01]
    return tgSteps.map(tgDelta =>
      waccSteps.map(waccDelta => {
        const adj = { ...baseAssumptions, wacc: baseWacc + waccDelta, terminalGrowth: Math.max(0.01, baseTg + tgDelta) }
        if (adj.terminalGrowth >= adj.wacc) adj.terminalGrowth = adj.wacc - 0.005
        const result = runDcf(subject, adj)
        return { wacc: baseWacc + waccDelta, tg: baseTg + tgDelta, equityValue: result.equityValue }
      })
    )
  }, [subject])

  // Bull / Base / Bear scenarios (configurable deltas)
  const scenarios = useMemo(() => {
    const base = defaultDcfAssumptions(subject)
    const bull = { ...base, startingGrowth: base.startingGrowth + bullGrowthDelta, startingEbitdaMargin: base.startingEbitdaMargin + bullMarginDelta, wacc: base.wacc + bullWaccDelta }
    const bear = { ...base, startingGrowth: Math.max(0.01, base.startingGrowth - bullGrowthDelta), startingEbitdaMargin: Math.max(0.02, base.startingEbitdaMargin - bullMarginDelta), wacc: base.wacc - bullWaccDelta }
    return [bull, base, bear].map((a, i) => {
      const r = runDcf(subject, a)
      return { label: ['Bull','Base','Bear'][i], equityValue: r.equityValue, upsidePct: r.upsideVsMarketCap, assumptions: a }
    })
  }, [subject])

  // Synergy NPV estimate (configurable via localStorage)
  const synergyNpv = useMemo(() => {
    const rs = subject.rev * synRevPct
    const cs = subject.ebitda * synCostPct
    const ic = subject.mktcap * integrationCostPct
    return (rs * 0.3 + cs) * 7 - ic  // NPV over 7 years at 30% realisation
  }, [subject, synRevPct, synCostPct, integrationCostPct])

  // ── FSA panel "Add to Report" selections ──
  const fsaReportSections = useMemo(() => {
    try {
      const stored = localStorage.getItem(`fsa_report_${subject.ticker}`)
      if (stored) return JSON.parse(stored) as Record<string, boolean>
    } catch { /* ignore */ }
    return { ratios: true, dupont: true, zscore: true, charts: true, aiNarrative: false }
  }, [subject.ticker])

  // ── Per-chart selections from FSA panel ──
  const chartSelections = useMemo(() => {
    try {
      const stored = localStorage.getItem(`fsa_charts_${subject.ticker}`)
      if (stored) return JSON.parse(stored) as Record<string, { include: boolean; commentary: string }>
    } catch { /* ignore */ }
    return {} as Record<string, { include: boolean; commentary: string }>
  }, [subject.ticker])

  /** Get commentary for a chart — user's custom text, or auto-generated fallback */
  const getChartCommentary = (chartId: string, autoText: string): string => {
    const sel = chartSelections[chartId]
    return sel?.commentary?.trim() || autoText
  }

  /** Check if a specific chart is selected for the report */
  const isChartSelected = (chartId: string): boolean => {
    const sel = chartSelections[chartId]
    return sel?.include ?? true // default include if not explicitly excluded
  }

  // Auto-adjusted metrics — uses the signal (all items) rather than only acknowledged
  const autoAdjusted: CompanyAdjustedMetrics = useMemo(() => {
    if (!newsAgg || newsAgg.items.length === 0) return computeAdjustedMetrics(subject, undefined)
    // Create a modified aggregate treating all items as acknowledged
    // by setting acknowledgedCount = count and using the full signal delta
    const allAcked: CompanyNewsAggregate = {
      ...newsAgg,
      acknowledgedCount: newsAgg.count,
    }
    return computeAdjustedMetrics(subject, allAcked)
  }, [subject, newsAgg])

  return (
    <>
      <PrintToolbar />
      <CoverPage subject={subject} history={history} dcf={dcf} />
      <ExecutiveSummaryPage
        subject={subject}
        history={history}
        dcf={dcf}
        bv={bv}
        comps={comps}
        adjusted={autoAdjusted}
        loadingProfile={loadingProfile}
      />
      <FinancialAnalysisPage subject={subject} history={history} profileErr={profileErr} />
      <FinancialRatiosPage subject={subject} history={history} peerSet={peerSet} />
      <FSADeepDivePage subject={subject} history={history} peerSet={peerSet} sections={fsaReportSections} chartSelections={chartSelections} getCommentary={getChartCommentary} isChartSelected={isChartSelected} />
      <ValuationMethodsPage subject={subject} dcf={dcf} comps={comps} bv={bv} />
      <IndustryPolicyPage subject={subject} chainNodes={subjectChainNodes} segmentCompanies={segmentCompanies} />
      <PeerComparisonPage subject={subject} peerSet={peerSet} peers={peers} />
      <ShareholdingAcquisitionPage subject={subject} hhi={hhi} dcf={dcf} synergyNpv={synergyNpv} />
      <FootballFieldPage subject={subject} football={football} />
      <SensitivityScenarioPage subject={subject} sensitivityMatrix={sensitivityMatrix} scenarios={scenarios} dcf={dcf} />
      <NewsImpactPage subject={subject} adjusted={autoAdjusted} highMatNews={highMatNews} newsAgg={newsAgg} chainNodes={subjectChainNodes} />
      <ConclusionPage subject={subject} history={history} dcf={dcf} comps={comps} bv={bv} scenarios={scenarios} football={football} adjusted={autoAdjusted} synergyNpv={synergyNpv} peerSet={peerSet} />
      <AppendixPage subject={subject} history={history} dcf={dcf} />
    </>
  )
}

// ── Toolbar ─────────────────────────────────────────────────────

function PrintToolbar() {
  return (
    <div className="dn-toolbar dn-screen-only">
      <div className="left">
        Deal<em>Nector</em> · Institutional Valuation Report
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="ghost" onClick={() => history.back()}>
          ← Back
        </button>
        <button onClick={() => window.print()}>Download PDF</button>
      </div>
    </div>
  )
}

// ── Page header (navy bar + page number) ───────────────────────

function PageHeader({ subject, section, pageNum }: { subject: Company; section: string; pageNum: string }) {
  return (
    <>
      <div className="dn-navy-bar">
        <div className="left">
          Deal<em>Nector</em> · {subject.name} ({subject.ticker}) · {section}
        </div>
        <div className="right">{subject.sec === 'solar' ? 'Solar Value Chain' : 'T&D Infrastructure'}</div>
      </div>
      <div className="dn-page-number">{pageNum}</div>
    </>
  )
}

function PageFooter() {
  const date = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  return (
    <div className="dn-page-footer">
      <span>DealNector Institutional Intelligence Terminal</span>
      <span>Confidential · Prepared {date}</span>
    </div>
  )
}

// ── Cover Page ─────────────────────────────────────────────────

function CoverPage({ subject, history, dcf }: { subject: Company; history: FinancialHistory; dcf: DcfResult }) {
  const date = new Date().toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  })
  const upside = dcf.upsideVsMarketCap
  const upsideLabel = upside >= 0 ? `+${upside.toFixed(1)}% upside` : `${upside.toFixed(1)}% downside`
  return (
    <section className="dn-page dn-page-cover dn-cover">
      <div className="top">
        {/* Inline SVG for print reliability — no image fetching */}
        <svg className="logo" viewBox="0 0 320 64" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="dnGoldCover" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#D4A43B" />
              <stop offset="100%" stopColor="#F4C842" />
            </linearGradient>
            <linearGradient id="dnInkCover" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#0A2340" />
              <stop offset="100%" stopColor="#132B52" />
            </linearGradient>
          </defs>
          <g transform="translate(4 8)">
            <path d="M24 0 L48 14 L48 34 L24 48 L0 34 L0 14 Z" fill="url(#dnInkCover)" stroke="#D4A43B" strokeWidth="1.2" />
            <text x="24" y="32" textAnchor="middle" fontFamily="Source Serif 4,Georgia,serif" fontWeight="700" fontSize="24" fill="url(#dnGoldCover)">
              D
            </text>
          </g>
          <text x="60" y="38" fontFamily="Source Serif 4,Georgia,serif" fontWeight="700" fontSize="28" letterSpacing="-0.5" fill="#0A2340">
            Deal<tspan fontStyle="italic" fill="#D4A43B">Nector</tspan>
          </text>
          <line x1="60" y1="46" x2="304" y2="46" stroke="#D4A43B" strokeWidth="0.75" />
          <text x="60" y="58" fontFamily="Inter,sans-serif" fontSize="8.5" letterSpacing="2.4" fill="#5A6B82" fontWeight="600">
            INSTITUTIONAL · INTELLIGENCE · TERMINAL
          </text>
        </svg>
        <div className="stamp">
          <div className="confidential">Strictly Confidential</div>
          <div>{date}</div>
          <div>Institutional Use Only</div>
        </div>
      </div>
      <div className="middle">
        <div className="eyebrow">Valuation Report · {subject.sec === 'solar' ? 'Solar Value Chain' : 'T&D Infrastructure'}</div>
        <div className="title">
          {subject.name}
          <br />
          <em>{subject.acqf}</em>
        </div>
        <div className="subtitle">
          An institutional assessment of equity value, strategic fit, and acquisition economics —
          anchored in multi-year financials, peer benchmarks, and live market-sensitive news signal.
        </div>
        <div className="meta">
          <div className="cell">
            <div className="k">Ticker</div>
            <div className="v">{subject.ticker}</div>
          </div>
          <div className="cell">
            <div className="k">Market Cap</div>
            <div className="v">{formatCr(subject.mktcap)}</div>
          </div>
          <div className="cell">
            <div className="k">Enterprise Value</div>
            <div className="v">{formatCr(subject.ev)}</div>
          </div>
          <div className="cell">
            <div className="k">Acquisition Score</div>
            <div className="v">{subject.acqs.toFixed(1)}/10</div>
          </div>
        </div>
      </div>
      <div className="bottom">
        <strong>DCF Implied Equity Value:</strong> {formatCr(dcf.equityValue)} ·{' '}
        <strong>vs Current Market Cap:</strong> {upsideLabel} ·{' '}
        <strong>Years of History:</strong> {history.yearsOfHistory} ·{' '}
        <strong>Source:</strong>{' '}
        {history.source === 'rapidapi' ? 'NSE/BSE Annual Reports' : 'Internal snapshot'}
        <br />
        This report is generated by DealNector from institutional data and should be used in
        conjunction with the analyst's own diligence. Figures in ₹Cr unless stated. Sentiment
        and materiality deltas are heuristic signals, not investment advice.
      </div>
    </section>
  )
}

// ── Executive Summary ──────────────────────────────────────────

function ExecutiveSummaryPage({
  subject,
  history,
  dcf,
  bv,
  comps,
  adjusted,
  loadingProfile,
}: {
  subject: Company
  history: FinancialHistory
  dcf: DcfResult
  bv: BookValueResult
  comps: ComparableResult[]
  adjusted: ReturnType<typeof computeAdjustedMetrics>
  loadingProfile: boolean
}) {
  const newestYear = history.history[0]
  const recommendation =
    subject.acqs >= 9
      ? 'Strong Buy — execute accumulation program; target 10–20% stake.'
      : subject.acqs >= 7
        ? 'Consider — enter at market dip or on post-earnings weakness.'
        : subject.acqs >= 5
          ? 'Monitor — watch for de-risking catalysts before engagement.'
          : 'Pass — valuation and / or strategic fit do not meet thresholds.'
  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Executive Summary" pageNum="01" />
      <span className="dn-eyebrow">Executive Summary</span>
      <h2 className="dn-h1" style={{ marginBottom: 12 }}>
        {subject.name}
      </h2>
      <hr className="dn-gold-rule" />

      <div className="dn-exec-grid">
        <div className="dn-exec-left">
          <div className="dn-narrative">
            <p>
              <strong>{subject.name}</strong> ({subject.ticker}) is positioned in the{' '}
              {subject.sec === 'solar' ? 'Indian solar' : 'Indian T&D infrastructure'} value
              chain across the{' '}
              <em>{(subject.comp || []).join(', ').replace(/_/g, ' ')}</em> segment(s). The
              company reported{' '}
              {newestYear?.revenue != null ? (
                <>
                  {formatCr(newestYear.revenue)} in revenue with a{' '}
                  {newestYear.ebitdaMarginPct?.toFixed(1) ?? subject.ebm.toFixed(1)}% EBITDA
                  margin
                </>
              ) : (
                <>₹{subject.rev.toLocaleString('en-IN')} Cr in revenue with a {subject.ebm}% EBITDA margin</>
              )}
              , trading at {subject.ev_eb.toFixed(1)}× EV/EBITDA and {subject.pe.toFixed(1)}× P/E.
            </p>
            <p>
              Our discounted cash flow analysis (5-year forecast, WACC{' '}
              {(dcf.assumptions.wacc * 100).toFixed(1)}%, terminal growth{' '}
              {(dcf.assumptions.terminalGrowth * 100).toFixed(1)}%) yields an implied equity value
              of <strong>{formatCr(dcf.equityValue)}</strong>, implying{' '}
              <strong className={dcf.upsideVsMarketCap >= 0 ? 'dn-pos' : 'dn-neg'}>
                {dcf.upsideVsMarketCap >= 0 ? '+' : ''}
                {dcf.upsideVsMarketCap.toFixed(1)}%
              </strong>{' '}
              vs current market cap of {formatCr(subject.mktcap)}. Comparable-multiples
              triangulation{comps.length > 0 && comps[0] ? (
                <>
                  {' '}(median peer {comps[0].method} {comps[0].peerMedian.toFixed(1)}×) lands the
                  equity value at {fmtValCr(comps[0].equityMedian)}
                </>
              ) : null}
              .
            </p>
            <div className="callout">
              Acquisition rationale: {subject.rea}
            </div>
            {adjusted.hasAdjustment && (
              <p>
                <strong>News-adjusted outlook.</strong>{' '}
                {adjusted.acknowledgedCount} acknowledged news item
                {adjusted.acknowledgedCount === 1 ? '' : 's'} shift{adjusted.acknowledgedCount === 1 ? 's' : ''} the
                acquisition score by{' '}
                <strong className={adjusted.deltaPct.acqs >= 0 ? 'dn-pos' : 'dn-neg'}>
                  {adjusted.deltaPct.acqs >= 0 ? '+' : ''}
                  {adjusted.deltaPct.acqs.toFixed(1)}%
                </strong>{' '}
                to <strong>{adjusted.post.acqs.toFixed(1)}/10</strong>, and moves the enterprise
                value by{' '}
                <strong className={adjusted.deltaPct.ev >= 0 ? 'dn-pos' : 'dn-neg'}>
                  {adjusted.deltaPct.ev >= 0 ? '+' : ''}
                  {adjusted.deltaPct.ev.toFixed(1)}%
                </strong>
                .
              </p>
            )}
            {loadingProfile && (
              <p className="dn-mutedtxt" style={{ fontStyle: 'italic' }}>
                Note: multi-year NSE/BSE history still loading — figures may update when
                downstream data arrives.
              </p>
            )}
          </div>
        </div>
        <div className="dn-exec-right">
          <div className="dn-kpi-tile">
            <div className="label">Revenue (LTM)</div>
            <div className="value">{formatCr(newestYear?.revenue ?? subject.rev)}</div>
            <div className="sub">
              CAGR: {formatPct(history.cagrs.revenueCagrPct)} · {history.yearsOfHistory} yrs
            </div>
          </div>
          <div className="dn-kpi-tile">
            <div className="label">EBITDA · Margin</div>
            <div className="value">{formatCr(newestYear?.ebitda ?? subject.ebitda)}</div>
            <div className="sub">
              {(newestYear?.ebitdaMarginPct ?? subject.ebm).toFixed(1)}% margin · CAGR{' '}
              {formatPct(history.cagrs.ebitdaCagrPct)}
            </div>
          </div>
          <div className="dn-kpi-tile pos">
            <div className="label">DCF Equity Value</div>
            <div className="value">{formatCr(dcf.equityValue)}</div>
            <div className="sub">
              implied {dcf.impliedEvEbitda.toFixed(1)}× EV/EBITDA
            </div>
          </div>
          <div className={`dn-kpi-tile ${dcf.upsideVsMarketCap >= 0 ? 'pos' : 'neg'}`}>
            <div className="label">Upside vs Market</div>
            <div className="value">
              {dcf.upsideVsMarketCap >= 0 ? '+' : ''}
              {dcf.upsideVsMarketCap.toFixed(1)}%
            </div>
            <div className="sub">vs {formatCr(subject.mktcap)} market cap</div>
          </div>
          <div className="dn-kpi-tile">
            <div className="label">Acquisition Score</div>
            <div className="value">{(adjusted.hasAdjustment ? adjusted.post.acqs : subject.acqs).toFixed(1)}/10</div>
            <div className="sub">{subject.acqf}{adjusted.hasAdjustment && adjusted.post.acqs !== subject.acqs ? ` (adj from ${subject.acqs.toFixed(1)})` : ''}</div>
          </div>
        </div>
      </div>

      <div className="dn-recommendation">
        <span className="badge">Recommendation</span>
        <div className="text">{recommendation}</div>
      </div>

      <PageFooter />
    </section>
  )
}

// ── Financial Analysis Page ────────────────────────────────────

function FinancialAnalysisPage({
  subject,
  history,
  profileErr,
}: {
  subject: Company
  history: FinancialHistory
  profileErr: string | null
}) {
  const yearsToShow = history.history.slice(0, 6) // up to 6 years newest first
  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Financial Analysis" pageNum="02" />
      <span className="dn-eyebrow">Financial Analysis — Multi-Year Performance</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        Income Statement & Profitability Drivers
      </h2>
      <hr className="dn-rule" />

      <table className="dn-table compact">
        <thead>
          <tr>
            <th>Year (₹ Cr)</th>
            {yearsToShow.map((y) => (
              <th key={y.fiscalYear} className="num">
                {y.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <MetricRow label="Revenue" values={yearsToShow.map((y) => y.revenue)} />
          <MetricRow label="Revenue Growth" values={yearsToShow.map((y) => y.revenueGrowthPct)} format="pct" />
          <MetricRow label="Gross Profit" values={yearsToShow.map((y) => y.grossProfit)} />
          <MetricRow label="EBITDA" values={yearsToShow.map((y) => y.ebitda)} />
          <MetricRow label="EBITDA Margin" values={yearsToShow.map((y) => y.ebitdaMarginPct)} format="pct" />
          <MetricRow label="EBIT" values={yearsToShow.map((y) => y.ebit)} />
          <MetricRow label="Interest Expense" values={yearsToShow.map((y) => y.interestExpense)} />
          <MetricRow label="Net Income" values={yearsToShow.map((y) => y.netIncome)} />
          <MetricRow label="Net Margin" values={yearsToShow.map((y) => y.netMarginPct)} format="pct" />
        </tbody>
      </table>

      <h2 className="dn-h2" style={{ marginTop: 14, marginBottom: 10 }}>
        Balance Sheet & Returns
      </h2>
      <hr className="dn-rule" />
      <table className="dn-table compact">
        <thead>
          <tr>
            <th>Year (₹ Cr)</th>
            {yearsToShow.map((y) => (
              <th key={y.fiscalYear} className="num">
                {y.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <MetricRow label="Total Assets" values={yearsToShow.map((y) => y.totalAssets)} />
          <MetricRow label="Total Equity" values={yearsToShow.map((y) => y.totalEquity)} />
          <MetricRow label="Total Debt" values={yearsToShow.map((y) => y.totalDebt)} />
          <MetricRow label="Debt / Equity" values={yearsToShow.map((y) => y.debtToEquity)} format="ratio" />
          <MetricRow label="ROE" values={yearsToShow.map((y) => y.roePct)} format="pct" />
          <MetricRow label="ROA" values={yearsToShow.map((y) => y.roaPct)} format="pct" />
        </tbody>
      </table>

      <h2 className="dn-h2" style={{ marginTop: 14, marginBottom: 10 }}>
        Working Capital Utilization
      </h2>
      <hr className="dn-rule" />
      <table className="dn-table compact">
        <thead>
          <tr>
            <th>Year (₹ Cr)</th>
            {yearsToShow.map((y) => (
              <th key={y.fiscalYear} className="num">
                {y.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <MetricRow label="Cash & Equiv." values={yearsToShow.map((y) => y.cash)} />
          <MetricRow label="Receivables" values={yearsToShow.map((y) => y.receivables)} />
          <MetricRow label="Inventory" values={yearsToShow.map((y) => y.inventory)} />
          <MetricRow label="Current Assets" values={yearsToShow.map((y) => y.currentAssets)} />
          <MetricRow label="Current Liab." values={yearsToShow.map((y) => y.currentLiabilities)} />
          <MetricRow label="Net Working Cap." values={yearsToShow.map((y) => y.netWorkingCapital)} />
          <MetricRow label="NWC Turnover" values={yearsToShow.map((y) => y.nwcTurnover)} format="ratio" />
          <MetricRow label="Cash Cycle (days)" values={yearsToShow.map((y) => y.cashConversionCycle)} format="days" />
          <MetricRow label="CapEx" values={yearsToShow.map((y) => y.capex)} />
          <MetricRow label="CFO" values={yearsToShow.map((y) => y.cfo)} />
          <MetricRow label="Free Cash Flow" values={yearsToShow.map((y) => y.fcf)} />
        </tbody>
      </table>

      <div className="dn-narrative" style={{ marginTop: 12 }}>
        <p>
          <strong>Takeaway.</strong>{' '}
          {history.cagrs.revenueCagrPct != null && history.cagrs.revenueCagrPct > 15
            ? `Revenue has compounded at ${history.cagrs.revenueCagrPct.toFixed(1)}% over ${history.yearsOfHistory - 1} years, materially above the 10% sector median, reflecting capacity ramp and order-book expansion.`
            : history.cagrs.revenueCagrPct != null
              ? `Revenue growth has averaged ${history.cagrs.revenueCagrPct.toFixed(1)}% annually — broadly in line with the tracked coverage universe.`
              : 'Multi-year CAGR could not be computed from available data.'}{' '}
          {history.cagrs.ebitdaCagrPct != null &&
          history.cagrs.revenueCagrPct != null &&
          history.cagrs.ebitdaCagrPct > history.cagrs.revenueCagrPct
            ? 'EBITDA CAGR leads revenue CAGR, indicating operating leverage is expanding as scale benefits flow through.'
            : history.cagrs.ebitdaCagrPct != null
              ? 'EBITDA CAGR trails revenue CAGR — watch for margin compression from input-cost pressures.'
              : ''}
        </p>
        {profileErr && (
          <p className="callout">
            Note: live NSE/BSE fetch returned: <em>{profileErr}</em>. The figures above fall
            back to the DealNector internal snapshot and may be less granular than the
            company's latest annual report.
          </p>
        )}
      </div>
      <PageFooter />
    </section>
  )
}

// ── Metric row helper ──────────────────────────────────────────

function MetricRow({
  label,
  values,
  format = 'cr',
}: {
  label: string
  values: Array<number | null>
  format?: 'cr' | 'pct' | 'ratio' | 'days'
}) {
  const fmt = (v: number | null): string => {
    if (v == null) return '—'
    if (format === 'pct') return formatPct(v, 1)
    if (format === 'ratio') return formatRatio(v, 2, '×')
    if (format === 'days') return `${Math.round(v)}d`
    return formatCr(v)
  }
  return (
    <tr>
      <td className="label">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="num mono">
          {fmt(v)}
        </td>
      ))}
    </tr>
  )
}

// ── Valuation Methods Page ─────────────────────────────────────

function ValuationMethodsPage({
  subject,
  dcf,
  comps,
  bv,
}: {
  subject: Company
  dcf: DcfResult
  comps: ComparableResult[]
  bv: BookValueResult
}) {
  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Valuation Methods" pageNum="05" />
      <span className="dn-eyebrow">Valuation — Multi-Method Triangulation</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        Discounted Cash Flow (5-year DCF)
      </h2>
      <hr className="dn-rule" />

      <table className="dn-table compact">
        <thead>
          <tr>
            <th>Year</th>
            <th className="num">Revenue</th>
            <th className="num">Growth</th>
            <th className="num">EBITDA</th>
            <th className="num">Margin</th>
            <th className="num">EBIT</th>
            <th className="num">NOPAT</th>
            <th className="num">CapEx</th>
            <th className="num">ΔNWC</th>
            <th className="num">FCF</th>
            <th className="num">PV</th>
          </tr>
        </thead>
        <tbody>
          {dcf.rows.map((r) => (
            <tr key={r.year}>
              <td className="label">{r.label}</td>
              <td className="num mono">{formatCr(r.revenue)}</td>
              <td className="num mono">{r.growthPct.toFixed(1)}%</td>
              <td className="num mono">{formatCr(r.ebitda)}</td>
              <td className="num mono">{r.ebitdaMarginPct.toFixed(1)}%</td>
              <td className="num mono">{formatCr(r.ebit)}</td>
              <td className="num mono">{formatCr(r.nopat)}</td>
              <td className="num mono">{formatCr(r.capex)}</td>
              <td className="num mono">{formatCr(r.nwcChange)}</td>
              <td className="num mono">{formatCr(r.fcf)}</td>
              <td className="num mono">{formatCr(r.pvFcf)}</td>
            </tr>
          ))}
          <tr className="subtotal">
            <td colSpan={9} className="label">
              Sum of PV (Explicit 5-Year)
            </td>
            <td className="num mono" colSpan={2}>
              {formatCr(dcf.sumPvFcf)}
            </td>
          </tr>
          <tr className="subtotal">
            <td colSpan={9} className="label">
              Terminal Value (Gordon, g={(dcf.assumptions.terminalGrowth * 100).toFixed(1)}%,
              WACC={(dcf.assumptions.wacc * 100).toFixed(1)}%)
            </td>
            <td className="num mono" colSpan={2}>
              PV: {formatCr(dcf.pvTerminalValue)} · TV: {formatCr(dcf.terminalValue)}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={9}>Implied Enterprise Value</td>
            <td colSpan={2} className="num mono">
              {formatCr(dcf.enterpriseValue)}
            </td>
          </tr>
          <tr>
            <td colSpan={9}>Less: Net Debt</td>
            <td colSpan={2} className="num mono">
              ({formatCr(dcf.netDebt)})
            </td>
          </tr>
          <tr>
            <td colSpan={9}>Implied Equity Value</td>
            <td colSpan={2} className="num mono">
              {formatCr(dcf.equityValue)}
            </td>
          </tr>
        </tfoot>
      </table>

      <h2 className="dn-h2" style={{ marginTop: 14, marginBottom: 10 }}>
        Comparable Multiples & Book Value
      </h2>
      <hr className="dn-rule" />
      <table className="dn-table compact">
        <thead>
          <tr>
            <th>Method</th>
            <th className="num">Base Metric</th>
            <th className="num">Peer Low</th>
            <th className="num">Peer Median</th>
            <th className="num">Peer High</th>
            <th className="num">Equity (Low)</th>
            <th className="num">Equity (Median)</th>
            <th className="num">Equity (High)</th>
            <th className="num">Upside</th>
          </tr>
        </thead>
        <tbody>
          {comps.map((c) => (
            <tr key={c.method}>
              <td className="label">{c.label}</td>
              <td className="num mono">{formatCr(c.subjectBase)}</td>
              <td className="num mono">{c.peerLow.toFixed(1)}×</td>
              <td className="num mono">{c.peerMedian.toFixed(1)}×</td>
              <td className="num mono">{c.peerHigh.toFixed(1)}×</td>
              <td className="num mono">{formatCr(c.equityLow)}</td>
              <td className="num mono">{formatCr(c.equityMedian)}</td>
              <td className="num mono">{formatCr(c.equityHigh)}</td>
              <td className={`num mono ${c.upsidePctMedian >= 0 ? 'dn-pos' : 'dn-neg'}`}>
                {c.upsidePctMedian >= 0 ? '+' : ''}
                {c.upsidePctMedian.toFixed(1)}%
              </td>
            </tr>
          ))}
          <tr>
            <td className="label">Book Value × {bv.strategicPremium.toFixed(2)} (strategic premium)</td>
            <td className="num mono">{formatCr(bv.bookValue)}</td>
            <td className="num mono" colSpan={3}>
              —
            </td>
            <td className="num mono">{formatCr(bv.equityValue * 0.9)}</td>
            <td className="num mono">{formatCr(bv.equityValue)}</td>
            <td className="num mono">{formatCr(bv.equityValue * 1.1)}</td>
            <td className={`num mono ${bv.upsidePct >= 0 ? 'dn-pos' : 'dn-neg'}`}>
              {bv.upsidePct >= 0 ? '+' : ''}
              {bv.upsidePct.toFixed(1)}%
            </td>
          </tr>
        </tbody>
      </table>
      <div className="dn-narrative" style={{ marginTop: 10 }}>
        <p className="callout">
          Upside is expressed versus the subject's current market capitalization of{' '}
          {formatCr(subject.mktcap)}. Multiples are applied to the subject's own trailing base
          metric (EBITDA, PAT, book value). Comparable peers are drawn from the same value-chain
          segment(s) within the DealNector coverage universe.
        </p>
      </div>
      <PageFooter />
    </section>
  )
}

// ── Peer Comparison Page ───────────────────────────────────────

function PeerComparisonPage({
  subject,
  peerSet,
  peers,
}: {
  subject: Company
  peerSet: PeerSet
  peers: PeerStats
}) {
  const peerRows: Company[] = [subject, ...peerSet.peers]
  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Peer Comparison" pageNum="07" />
      <span className="dn-eyebrow">Peer Benchmark — Same Value-Chain Segment</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        Relative Positioning Against {peerSet.peers.length} Closest Peers
      </h2>
      <hr className="dn-rule" />

      <table className="dn-table compact">
        <thead>
          <tr>
            <th>Company</th>
            <th>Ticker</th>
            <th className="num">Mkt Cap</th>
            <th className="num">EV</th>
            <th className="num">Revenue</th>
            <th className="num">Rev Gr</th>
            <th className="num">EBITDA %</th>
            <th className="num">EV/EBITDA</th>
            <th className="num">P/E</th>
            <th className="num">D/E</th>
          </tr>
        </thead>
        <tbody>
          {peerRows.map((c, i) => {
            const isSubject = i === 0
            return (
              <tr key={c.ticker} style={isSubject ? { background: 'var(--cream)', fontWeight: 600 } : undefined}>
                <td className="label">
                  {isSubject ? <>{c.name} ◆</> : c.name}
                </td>
                <td>{c.ticker}</td>
                <td className="num mono">{formatPeerValue('mktcap', c.mktcap)}</td>
                <td className="num mono">{formatPeerValue('ev', c.ev)}</td>
                <td className="num mono">{formatPeerValue('rev', c.rev)}</td>
                <td className="num mono">{formatPeerValue('revg', c.revg)}</td>
                <td className="num mono">{formatPeerValue('ebm', c.ebm)}</td>
                <td className="num mono">{formatPeerValue('ev_eb', c.ev_eb)}</td>
                <td className="num mono">{formatPeerValue('pe', c.pe)}</td>
                <td className="num mono">{formatPeerValue('dbt_eq', c.dbt_eq)}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td>Peer Median</td>
            <td>—</td>
            <td className="num mono">{formatPeerValue('mktcap', peers.mktcap.median)}</td>
            <td className="num mono">{formatPeerValue('ev', peers.ev.median)}</td>
            <td className="num mono">{formatPeerValue('rev', peers.rev.median)}</td>
            <td className="num mono">{formatPeerValue('revg', peers.revg.median)}</td>
            <td className="num mono">{formatPeerValue('ebm', peers.ebm.median)}</td>
            <td className="num mono">{formatPeerValue('ev_eb', peers.ev_eb.median)}</td>
            <td className="num mono">{formatPeerValue('pe', peers.pe.median)}</td>
            <td className="num mono">{formatPeerValue('dbt_eq', peers.dbt_eq.median)}</td>
          </tr>
        </tfoot>
      </table>

      <h2 className="dn-h2" style={{ marginTop: 14, marginBottom: 10 }}>
        Subject Percentile vs Peer Set
      </h2>
      <hr className="dn-rule" />
      <div className="dn-kpi-row">
        <PercentileTile label="EV/EBITDA" pct={peers.ev_eb.subjectPercentile} invert />
        <PercentileTile label="P/E" pct={peers.pe.subjectPercentile} invert />
        <PercentileTile label="Revenue Growth" pct={peers.revg.subjectPercentile} />
        <PercentileTile label="EBITDA Margin" pct={peers.ebm.subjectPercentile} />
        <PercentileTile label="Debt / Equity" pct={peers.dbt_eq.subjectPercentile} invert />
      </div>
      <div className="dn-narrative">
        <p className="callout">
          Higher percentile = richer on that metric. Inverted tiles (EV/EBITDA, P/E, D/E) flip
          the colour — a higher multiple or leverage reads as more expensive / riskier. The
          subject's percentile is computed as its rank within the peer set on each metric.
        </p>
      </div>
      <PageFooter />
    </section>
  )
}

function PercentileTile({ label, pct, invert = false }: { label: string; pct: number; invert?: boolean }) {
  // Simple colour logic: for non-inverted, >60 = positive, <40 = negative.
  // Inverted (lower = better): >60 = negative, <40 = positive.
  const good = invert ? pct < 40 : pct > 60
  const bad = invert ? pct > 60 : pct < 40
  const color = good ? 'var(--green)' : bad ? 'var(--red)' : 'var(--ink)'
  return (
    <div className="dn-kpi-tile-flat" style={{ borderTopColor: color }}>
      <div className="label">{label}</div>
      <div className="value" style={{ color }}>
        P{pct}
      </div>
      <div className="sub">{good ? 'Favourable' : bad ? 'Stretched' : 'In line'}</div>
    </div>
  )
}

// ── Football Field Page ────────────────────────────────────────

function FootballFieldPage({
  subject,
  football,
}: {
  subject: Company
  football: FootballFieldBar[]
}) {
  const globalMax = Math.max(
    ...football.map((b) => b.high),
    subject.mktcap * 1.2
  )
  const globalMin = Math.min(...football.map((b) => b.low), 0)
  const span = globalMax - globalMin || 1
  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Football Field" pageNum="09" />
      <span className="dn-eyebrow">Valuation Range — Triangulated Football Field</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        {subject.name} — Implied Equity Value by Method (₹ Cr)
      </h2>
      <hr className="dn-rule" />
      <div className="dn-football">
        {football.map((b, i) => {
          const leftPct = ((b.low - globalMin) / span) * 100
          const widthPct = Math.max(1.5, ((b.high - b.low) / span) * 100)
          const midPct = ((b.medianOrMid - globalMin) / span) * 100
          return (
            <div className="bar-row" key={i}>
              <div className="label">{b.label}</div>
              <div className="bar-track">
                <div
                  className="bar-fill"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                />
                <div className="bar-mid" style={{ left: `${midPct}%` }} />
              </div>
              <div className="value">{fmtValCr(b.medianOrMid)}</div>
            </div>
          )
        })}
      </div>
      <div className="dn-narrative" style={{ marginTop: 12 }}>
        <p>
          The football field visualises the triangulation of every valuation method. The shaded
          bar spans the low-to-high range for each method; the vertical line marks the central
          point estimate (median for comparables, base case for DCF). The "Current Market Cap"
          bar is a zero-width reference — where the subject trades today.
        </p>
        <p className="callout">
          Interpretation: when the central line of the DCF and comparable bars sits to the right
          of the current market cap, the subject is trading at a discount to its intrinsic and
          relative value — a buy signal. When to the left, the market is pricing in execution
          risk or cycle weakness.
        </p>
      </div>
      <PageFooter />
    </section>
  )
}

// ── News Impact Page ──────────────────────────────────────────

function NewsImpactPage({
  subject,
  adjusted,
  highMatNews,
  newsAgg,
  chainNodes,
}: {
  subject: Company
  adjusted: CompanyAdjustedMetrics
  highMatNews: { positive: CompanyNewsAggregate['items']; negative: CompanyNewsAggregate['items'] }
  newsAgg: CompanyNewsAggregate | null
  chainNodes: ChainNode[]
}) {
  // Build reasoning for each metric change
  const buildReason = (metric: string): string => {
    if (!newsAgg || newsAgg.items.length === 0) return 'No news signals detected.'
    const relevant = newsAgg.items.filter(n => n.impact.materiality !== 'low')
    const pos = relevant.filter(n => n.impact.sentiment === 'positive').length
    const neg = relevant.filter(n => n.impact.sentiment === 'negative').length
    if (metric === 'revg') return `${pos} positive and ${neg} negative signals affecting revenue outlook. Key drivers: order book announcements, capacity expansion updates, and contract wins.`
    if (metric === 'ebm') return `Margin outlook influenced by ${pos + neg} material signals including input cost changes, operational efficiency updates, and pricing power indicators.`
    if (metric === 'ev_eb') return `Valuation multiple adjusted based on ${pos + neg} signals covering market sentiment, sector re-rating triggers, and comparable transaction announcements.`
    if (metric === 'acqs') return `Composite acquisition score recalculated across 7 drivers: growth, margin, valuation, leverage, sector tailwind, size, and P/E attractiveness.`
    return `Adjusted based on ${pos + neg} material news signals.`
  }

  // Deduplicated policies from chain nodes
  const policies = Array.from(new Set(chainNodes.flatMap(c => c.pol || [])))

  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="News &amp; Policy Impact" pageNum="11" />
      <span className="dn-eyebrow">Impact Assessment — All News Auto-Assessed</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        News &amp; Policy Impact on {subject.ticker} Valuation
      </h2>
      <hr className="dn-rule" />

      {/* Before/After with Reasoning */}
      <table className="dn-table compact" style={{ marginBottom: 6 }}>
        <thead>
          <tr>
            <th>Metric</th>
            <th className="num">Before News</th>
            <th className="num">After News</th>
            <th className="num">Change</th>
            <th className="num">Δ %</th>
          </tr>
        </thead>
        <tbody>
          <PrePostRow label="Acquisition Score" pre={adjusted.pre.acqs} post={adjusted.post.acqs} suffix="/10" />
          <tr><td colSpan={5} className="dn-reason-text">{buildReason('acqs')}</td></tr>
          <PrePostRow label="EV / EBITDA" pre={adjusted.pre.ev_eb} post={adjusted.post.ev_eb} suffix="×" />
          <tr><td colSpan={5} className="dn-reason-text">{buildReason('ev_eb')}</td></tr>
          <PrePostRow label="Revenue Growth" pre={adjusted.pre.revg} post={adjusted.post.revg} suffix="%" />
          <tr><td colSpan={5} className="dn-reason-text">{buildReason('revg')}</td></tr>
          <PrePostRow label="EBITDA Margin" pre={adjusted.pre.ebm} post={adjusted.post.ebm} suffix="%" />
          <tr><td colSpan={5} className="dn-reason-text">{buildReason('ebm')}</td></tr>
          <PrePostRow label="Enterprise Value" pre={adjusted.pre.ev} post={adjusted.post.ev} suffix=" Cr" />
        </tbody>
      </table>

      <div className="dn-narrative" style={{ marginBottom: 10 }}>
        <p style={{ fontSize: 9 }}>
          <strong>Auto-assessment:</strong> All {newsAgg?.count || 0} news signals are automatically assessed in this report.
          {adjusted.hasAdjustment ? ` Net impact across ${adjusted.acknowledgedCount} items is reflected above.` : ' No material impact detected.'}
        </p>
      </div>

      {/* Policy Impact Assessment */}
      {policies.length > 0 && (
        <>
          <h3 className="dn-h3" style={{ marginBottom: 6, marginTop: 10 }}>Policy &amp; Regulatory Impact</h3>
          <hr className="dn-rule" />
          <table className="dn-table compact" style={{ marginBottom: 8 }}>
            <thead>
              <tr><th>Policy / Scheme</th><th>Impact</th><th>Timeframe</th><th>Source</th></tr>
            </thead>
            <tbody>
              {policies.map(pol => {
                const info = POLICY_INFO[pol]
                return info ? (
                  <tr key={pol}>
                    <td className="label">{info.name}</td>
                    <td><span className={`dn-risk-badge ${info.direction === 'Positive' ? 'safe' : 'moderate'}`}>{info.direction}</span></td>
                    <td style={{ fontSize: 8 }}>{info.timeframe}</td>
                    <td style={{ fontSize: 7.5 }}><a href={info.url} className="dn-source-link" target="_blank" rel="noopener">{info.source}</a></td>
                  </tr>
                ) : (
                  <tr key={pol}><td className="label">{pol}</td><td>—</td><td>—</td><td>—</td></tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}

      {/* News cards */}
      <div className="dn-two-col">
        <div>
          <h3 className="dn-h3" style={{ marginBottom: 6 }}>▲ Positive Signals</h3>
          <hr className="dn-rule" />
          <div className="dn-news-list">
            {highMatNews.positive.length === 0 ? (
              <div className="dn-mutedtxt" style={{ fontSize: 9, fontStyle: 'italic' }}>No positive high-materiality news detected.</div>
            ) : (
              highMatNews.positive.map((n, i) => (
                <div className="dn-news-card pos" key={i}>
                  <span className="pill">POS</span>
                  <div className="body">
                    <div className="headline">{n.item.title}</div>
                    <div className="meta">{n.item.source || 'Source'} · {n.item.pubDate?.slice(0, 10) || ''} · ◆ {n.impact.category} · {n.impact.materiality}</div>
                  </div>
                  <div className="delta">{n.impact.multipleDeltaPct >= 0 ? '+' : ''}{n.impact.multipleDeltaPct.toFixed(2)}%</div>
                </div>
              ))
            )}
          </div>
        </div>
        <div>
          <h3 className="dn-h3" style={{ marginBottom: 6 }}>▼ Negative Signals</h3>
          <hr className="dn-rule" />
          <div className="dn-news-list">
            {highMatNews.negative.length === 0 ? (
              <div className="dn-mutedtxt" style={{ fontSize: 9, fontStyle: 'italic' }}>No negative high-materiality news detected.</div>
            ) : (
              highMatNews.negative.map((n, i) => (
                <div className="dn-news-card neg" key={i}>
                  <span className="pill">NEG</span>
                  <div className="body">
                    <div className="headline">{n.item.title}</div>
                    <div className="meta">{n.item.source || 'Source'} · {n.item.pubDate?.slice(0, 10) || ''} · ◆ {n.impact.category} · {n.impact.materiality}</div>
                  </div>
                  <div className="delta">{n.impact.multipleDeltaPct.toFixed(2)}%</div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
      <PageFooter />
    </section>
  )
}

function PrePostRow({
  label,
  pre,
  post,
  suffix,
}: {
  label: string
  pre: number
  post: number
  suffix: string
}) {
  const delta = post - pre
  const deltaPct = pre !== 0 ? (delta / pre) * 100 : 0
  const color = delta > 0 ? 'dn-pos' : delta < 0 ? 'dn-neg' : 'dn-mutedtxt'
  const fmt = (n: number) =>
    suffix === ' Cr' ? formatCr(n) : `${n.toFixed(suffix === '/10' ? 1 : 2)}${suffix}`
  return (
    <tr>
      <td className="label">{label}</td>
      <td className="num mono">{fmt(pre)}</td>
      <td className="num mono">{fmt(post)}</td>
      <td className={`num mono ${color}`}>
        {delta >= 0 ? '+' : ''}
        {fmt(Math.abs(delta)).replace(/[+-]/g, '')}
      </td>
      <td className={`num mono ${color}`}>
        {delta >= 0 ? '+' : ''}
        {deltaPct.toFixed(2)}%
      </td>
    </tr>
  )
}

// ── NEW Page: FSA Deep Dive — Charts, DuPont, Z-Score ─────────

function FSADeepDivePage({
  subject,
  history,
  peerSet,
  sections = {},
  chartSelections = {},
  getCommentary = (_id: string, auto: string) => auto,
  isChartSelected: isSelected = () => true,
}: {
  subject: Company
  history: FinancialHistory
  peerSet: PeerSet
  sections?: Record<string, boolean>
  chartSelections?: Record<string, { include: boolean; commentary: string }>
  getCommentary?: (chartId: string, autoText: string) => string
  isChartSelected?: (chartId: string) => boolean
}) {
  // All charts show by default in the report — individual charts can be
  // toggled via per-chart isChartSelected(). Section-level toggles only
  // apply when user explicitly set them to false in the FSA panel.
  const showCharts = true // always render charts in report
  const showDupont = sections.dupont !== false
  const showZscore = sections.zscore !== false
  const years = history.history.slice(0, 6)
  const latest = years[0]

  // Revenue trend bar chart data
  const revData = years.filter(y => (y.revenue ?? 0) > 0).reverse().map(y => ({
    label: y.label?.slice(0, 6) || y.fiscalYear,
    value: y.revenue ?? 0,
    color: '#D4A43B',
  }))

  // EBITDA trend
  const ebitdaData = years.filter(y => (y.ebitda ?? 0) > 0).reverse().map(y => ({
    label: y.label?.slice(0, 6) || y.fiscalYear,
    value: y.ebitda ?? 0,
    color: '#2E6B3A',
  }))

  // Waterfall from latest year
  const waterfall = latest ? buildIncomeWaterfall({
    revenue: latest.revenue ?? 0,
    cogs: latest.cogs ?? 0,
    grossProfit: latest.grossProfit ?? 0,
    opex: (latest.grossProfit ?? 0) - (latest.ebit ?? 0),
    ebit: latest.ebit ?? 0,
    interest: latest.interestExpense ?? 0,
    tax: latest.taxExpense ?? 0,
    netIncome: latest.netIncome ?? 0,
  }) : []

  // DuPont data
  const latestTA = latest?.totalAssets ?? 0
  const prevTA = years[1]?.totalAssets ?? 0
  const latestEq = latest?.totalEquity ?? 0
  const prevEq = years[1]?.totalEquity ?? 0
  const avgAssets = prevTA > 0 ? (latestTA + prevTA) / 2 : latestTA
  const avgEquity = prevEq > 0 ? (latestEq + prevEq) / 2 : latestEq
  const latestNI = latest?.netIncome ?? 0
  const latestEBT = latest?.ebt ?? 0
  const latestEBIT = latest?.ebit ?? 0
  const latestRev = latest?.revenue ?? 0

  const dupontData: DuPontData = {
    roe: latest?.roePct ?? null,
    taxBurden: latestEBT !== 0 ? latestNI / latestEBT : null,
    interestBurden: latestEBIT !== 0 ? latestEBT / latestEBIT : null,
    ebitMargin: latestRev !== 0 ? latestEBIT / latestRev : null,
    assetTurnover: avgAssets > 0 ? latestRev / avgAssets : null,
    equityMultiplier: avgEquity > 0 ? avgAssets / avgEquity : null,
  }

  // Z-Score data
  const wc = latest ? ((latest.currentAssets ?? 0) - (latest.currentLiabilities ?? 0)) : 0
  const ta = latest?.totalAssets ?? 1
  const tl = ta - (latest?.totalEquity ?? 0)
  const zScoreData: ZScoreData = {
    zScore: null,
    components: {
      wcTa: latest ? wc / ta : null,
      reTa: null, // retained earnings not directly available
      ebitTa: latestEBIT ? latestEBIT / ta : null,
      meTl: tl > 0 ? subject.mktcap / tl : null,
      sTa: latestRev ? latestRev / ta : null,
    },
  }
  // Compute Z-Score
  const c = zScoreData.components
  if (c.wcTa !== null && c.ebitTa !== null && c.sTa !== null) {
    const reTa = c.reTa || 0
    const meTl = c.meTl || 0.5
    zScoreData.zScore = 1.2 * c.wcTa + 1.4 * reTa + 3.3 * c.ebitTa + 0.6 * meTl + 1.0 * c.sTa
  }

  // Radar chart — subject vs peer median
  const peers = peerSet.peers
  const peerMedian = (vals: number[]) => {
    const sorted = vals.filter(v => v > 0).sort((a, b) => a - b)
    if (!sorted.length) return 0
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }
  const radarDimensions = [
    { label: 'Revenue Growth', subject: normaliseRatio(subject.revg, 0, 50, true), peer: normaliseRatio(peerMedian(peers.map(p => p.revg)), 0, 50, true) },
    { label: 'EBITDA Margin', subject: normaliseRatio(subject.ebm, 0, 30, true), peer: normaliseRatio(peerMedian(peers.map(p => p.ebm)), 0, 30, true) },
    { label: 'Valuation (EV/EB)', subject: normaliseRatio(subject.ev_eb, 5, 50, false), peer: normaliseRatio(peerMedian(peers.map(p => p.ev_eb)), 5, 50, false) },
    { label: 'Leverage (D/E)', subject: normaliseRatio(subject.dbt_eq, 0, 2, false), peer: normaliseRatio(peerMedian(peers.map(p => p.dbt_eq)), 0, 2, false) },
    { label: 'Acq Score', subject: normaliseRatio(subject.acqs, 0, 10, true), peer: normaliseRatio(peerMedian(peers.map(p => p.acqs)), 0, 10, true) },
  ]

  return (
    <section className="dn-page dn-page-flow">
      <PageHeader subject={subject} section="FSA Deep Dive" pageNum="04" />
      <span className="dn-eyebrow">Financial Statement Analysis — Charts &amp; Frameworks</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>Visual Financial Analysis</h2>
      <hr className="dn-rule" />

      {/* Revenue + EBITDA Trend */}
      {showCharts && (
        <div className="dn-two-col" style={{ marginBottom: 12 }}>
          <div>
            <BarChart data={revData} width={250} height={150} title="Revenue Trend" fmt={(v) => `${Math.round(v)}`} />
            {revData.length >= 2 && (
              <p className="dn-reason-text">{barChartInference(revData, 'Revenue')}</p>
            )}
          </div>
          <div>
            <BarChart data={ebitdaData} width={250} height={150} title="EBITDA Trend" fmt={(v) => `${Math.round(v)}`} />
            {ebitdaData.length >= 2 && (
              <p className="dn-reason-text">{barChartInference(ebitdaData, 'EBITDA')}</p>
            )}
          </div>
        </div>
      )}

      {/* Income Waterfall */}
      {showCharts && waterfall.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <WaterfallChart steps={waterfall} width={510} height={170} title="Income Bridge — Revenue to Net Income" fmt={(v) => `${Math.round(v)}`} />
          <p className="dn-reason-text">{waterfallInference(latest?.revenue || 0, latest?.netIncome || 0, subject.ebm)}</p>
        </div>
      )}

      {/* DuPont + Radar side by side */}
      <div className="dn-two-col" style={{ marginBottom: 12 }}>
        {showDupont && (
          <div>
            <h3 className="dn-h3" style={{ marginBottom: 4 }}>DuPont 5-Factor Decomposition</h3>
            <DuPontTree data={dupontData} width={260} height={160} printMode />
            <p className="dn-reason-text">{dupontInference(dupontData)}</p>
          </div>
        )}
        {showCharts && (
          <div>
            <h3 className="dn-h3" style={{ marginBottom: 4 }}>Ratio Profile vs Peers</h3>
            <RadarChart dimensions={radarDimensions} width={240} height={220} />
            <p className="dn-reason-text">{radarInference(radarDimensions)}</p>
          </div>
        )}
      </div>

      {/* Z-Score */}
      {showZscore && zScoreData.zScore !== null && (
        <div style={{ marginBottom: 8 }}>
          <ZScoreGauge data={zScoreData} width={510} height={80} printMode />
          <p className="dn-reason-text">{zScoreInference(zScoreData)}</p>
        </div>
      )}

      {/* ── Line Charts — Multi-Metric Time Series ── */}
      {showCharts && (() => {
        const ebitdaM = years.filter(y => y.ebitdaMarginPct !== null).reverse()
        const netM = years.filter(y => y.netMarginPct !== null).reverse()
        const roe = years.filter(y => y.roePct !== null).reverse()
        const roa = years.filter(y => y.roaPct !== null).reverse()

        const marginSeries: LineSeries[] = []
        if (ebitdaM.length >= 2) marginSeries.push({ label: 'EBITDA %', color: '#2E6B3A', data: ebitdaM.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: y.ebitdaMarginPct ?? 0 })) })
        if (netM.length >= 2) marginSeries.push({ label: 'Net %', color: '#0A2340', data: netM.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: y.netMarginPct ?? 0 })) })

        const returnSeries: LineSeries[] = []
        if (roe.length >= 2) returnSeries.push({ label: 'ROE %', color: '#D4A43B', data: roe.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: y.roePct ?? 0 })) })
        if (roa.length >= 2) returnSeries.push({ label: 'ROA %', color: '#6B7A92', dashed: true, data: roa.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: y.roaPct ?? 0 })) })

        if (marginSeries.length === 0 && returnSeries.length === 0) return null

        return (
          <div style={{ marginBottom: 12 }}>
            <h3 className="dn-h3" style={{ marginBottom: 4 }}>Time Series — Margin &amp; Returns Overlay</h3>
            <div className="dn-two-col">
              {marginSeries.length > 0 && isSelected('marginLine') && (
                <div>
                  <LineChartPrint series={marginSeries} width={250} height={150} title="Margin Trends" unit="%" />
                  <p className="dn-reason-text">{getCommentary('marginLine', 'EBITDA vs net margin gap reveals financing + tax burden. Expanding gap = rising leverage cost.')}</p>
                </div>
              )}
              {returnSeries.length > 0 && isSelected('roeLine') && (
                <div>
                  <LineChartPrint series={returnSeries} width={250} height={150} title="ROE vs ROA" unit="%" />
                  <p className="dn-reason-text">{getCommentary('roeLine', 'ROE-ROA divergence = leverage amplification. Parallel movement = genuine productivity improvement.')}</p>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Multi-Year Margin & Profitability Trends ── */}
      {showCharts && (() => {
        const marginData = years.filter(y => y.ebitdaMarginPct !== null).reverse()
        const netMarginData = years.filter(y => y.netMarginPct !== null).reverse()
        if (marginData.length < 2 && netMarginData.length < 2) return null
        return (
          <div style={{ marginBottom: 12 }}>
            <h3 className="dn-h3" style={{ marginBottom: 4 }}>Margin Trends Over Time</h3>
            <div className="dn-two-col">
              {marginData.length >= 2 && (
                <div>
                  <BarChart data={marginData.map(y => ({ label: y.label?.slice(0, 6) || y.fiscalYear, value: y.ebitdaMarginPct ?? 0, color: '#2E6B3A' }))} width={250} height={120} title="EBITDA Margin %" fmt={v => v.toFixed(1)} unit="%" />
                  <p className="dn-reason-text">
                    {(() => { const f = marginData[0].ebitdaMarginPct ?? 0; const l = marginData[marginData.length - 1].ebitdaMarginPct ?? 0; return l > f ? `EBITDA margin expanded from ${f.toFixed(1)}% to ${l.toFixed(1)}% — indicates improving operational efficiency, better cost control, or pricing power gain. Margin expansion is a key driver of enterprise value re-rating.` : `EBITDA margin compressed from ${f.toFixed(1)}% to ${l.toFixed(1)}% — suggests rising input costs, competitive pricing pressure, or mix shift toward lower-margin segments. Sustained margin decline erodes valuation support.` })()}
                  </p>
                </div>
              )}
              {netMarginData.length >= 2 && (
                <div>
                  <BarChart data={netMarginData.map(y => ({ label: y.label?.slice(0, 6) || y.fiscalYear, value: y.netMarginPct ?? 0, color: '#0A2340' }))} width={250} height={120} title="Net Margin %" fmt={v => v.toFixed(1)} unit="%" />
                  <p className="dn-reason-text">Net margin captures the full impact of financing costs, taxes, and non-operating items. The gap between EBITDA margin and net margin reveals the financing and tax burden on the business.</p>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── ROE & Leverage Trends ── */}
      {showCharts && (() => {
        const roeData = years.filter(y => y.roePct !== null).reverse()
        const deData = years.filter(y => y.debtToEquity !== null).reverse()
        if (roeData.length < 2 && deData.length < 2) return null
        return (
          <div style={{ marginBottom: 12 }}>
            <h3 className="dn-h3" style={{ marginBottom: 4 }}>Returns &amp; Leverage Trends</h3>
            <div className="dn-two-col">
              {roeData.length >= 2 && (
                <div>
                  <BarChart data={roeData.map(y => ({ label: y.label?.slice(0, 6) || y.fiscalYear, value: y.roePct ?? 0, color: '#D4A43B' }))} width={250} height={120} title="Return on Equity %" fmt={v => v.toFixed(1)} unit="%" />
                  <p className="dn-reason-text">ROE trend reveals whether management consistently generates returns above cost of equity (~12-14% for Indian equities). Rising ROE with stable leverage indicates genuine profitability improvement. If ROE rises while D/E also rises, the return is leverage-amplified and carries higher risk.</p>
                </div>
              )}
              {deData.length >= 2 && (
                <div>
                  <BarChart data={deData.map(y => ({ label: y.label?.slice(0, 6) || y.fiscalYear, value: y.debtToEquity ?? 0, color: (y.debtToEquity ?? 0) > 1 ? '#A9232B' : '#2E6B3A' }))} width={250} height={120} title="Debt / Equity" fmt={v => v.toFixed(2)} unit="×" />
                  <p className="dn-reason-text">Declining leverage trend is positive for acquisition — lower D/E means the target can absorb acquisition debt. Rising leverage in a growth company may signal aggressive capex funding that needs to translate into revenue.</p>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Free Cash Flow Trend ── */}
      {showCharts && (() => {
        const fcfData = years.filter(y => y.fcf !== null).reverse()
        if (fcfData.length < 2) return null
        return (
          <div style={{ marginBottom: 12 }}>
            <h3 className="dn-h3" style={{ marginBottom: 4 }}>Free Cash Flow Trend</h3>
            <BarChart data={fcfData.map(y => ({ label: y.label?.slice(0, 6) || y.fiscalYear, value: y.fcf ?? 0, color: (y.fcf ?? 0) >= 0 ? '#2E6B3A' : '#A9232B' }))} width={510} height={130} title="Free Cash Flow ₹Cr" fmt={v => Math.round(v).toLocaleString('en-IN')} />
            <p className="dn-reason-text">FCF is the ultimate measure of business quality for M&amp;A. Consistently positive and growing FCF confirms the company can self-fund growth, service debt, and pay dividends. Volatile or negative FCF in a mature company is a red flag — it suggests reported profits are not converting to cash, warranting deeper investigation of working capital, capitalisation policies, and accrual quality.</p>
          </div>
        )
      })()}

      {/* ── Cash Flow Quality + Revenue Growth + Leverage vs Peers ── */}
      {showCharts && (() => {
        const enrichedYrs = years.filter(y => (y.revenue ?? 0) > 0).reverse().map((y, i, arr) => {
          const rev = y.revenue ?? 0
          const ni = y.netIncome ?? (rev > 0 ? rev * (subject.pat / subject.rev) : null)
          const da = y.da ?? (rev * 0.045)
          const cfo = y.cfo ?? (ni ? ni + da : null)
          const ebit = y.ebit ?? (y.ebitda ? y.ebitda - da : null)
          const intExp = y.interestExpense ?? null
          return {
            label: y.label?.slice(0, 8) || y.fiscalYear,
            cfoNi: cfo && ni && ni !== 0 ? cfo / ni : null,
            revGrowth: y.revenueGrowthPct,
            de: y.debtToEquity ?? null,
            intCov: ebit && intExp && intExp > 0 ? ebit / intExp : null,
          }
        })

        const cfoNiSeries: LineSeries[] = [
          { label: 'CFO/NI', color: '#2E6B3A', data: enrichedYrs.filter(y => y.cfoNi != null).map(y => ({ x: y.label, y: y.cfoNi! })) },
          { label: 'Benchmark (1.0×)', color: '#6B7A92', dashed: true, data: enrichedYrs.filter(y => y.cfoNi != null).map(y => ({ x: y.label, y: 1.0 })) },
        ].filter(s => s.data.length >= 2)

        const growthSeries: LineSeries[] = [
          { label: 'Rev Growth %', color: '#D4A43B', data: enrichedYrs.filter(y => y.revGrowth != null).map(y => ({ x: y.label, y: y.revGrowth! })) },
        ].filter(s => s.data.length >= 2)

        const leverageSeries: LineSeries[] = [
          { label: `${subject.ticker} D/E`, color: '#A9232B', data: enrichedYrs.filter(y => y.de != null).map(y => ({ x: y.label, y: y.de! })) },
        ]
        if (leverageSeries[0]?.data.length >= 2 && peerSet.peers.length > 0) {
          const peerAvgDE = peerSet.peers.reduce((s, p) => s + p.dbt_eq, 0) / peerSet.peers.length
          leverageSeries.push({ label: 'Peer Avg', color: '#6B7A92', dashed: true, data: leverageSeries[0].data.map(d => ({ x: d.x, y: peerAvgDE })) })
        }
        const validLev = leverageSeries.filter(s => s.data.length >= 2)

        const intCovSeries: LineSeries[] = [
          { label: 'Int Coverage', color: '#2E6B3A', data: enrichedYrs.filter(y => y.intCov != null).map(y => ({ x: y.label, y: y.intCov! })) },
          { label: 'Min Safe (3×)', color: '#6B7A92', dashed: true, data: enrichedYrs.filter(y => y.intCov != null).map(y => ({ x: y.label, y: 3 })) },
        ].filter(s => s.data.length >= 2)

        if (!cfoNiSeries.length && !growthSeries.length && !validLev.length && !intCovSeries.length) return null
        return (
          <div style={{ marginBottom: 12 }}>
            <h3 className="dn-h3" style={{ marginBottom: 4 }}>Performance Quality — Cash Flow, Growth &amp; Coverage</h3>
            <div className="dn-two-col">
              {cfoNiSeries.length > 0 && (
                <div>
                  <LineChartPrint series={cfoNiSeries} width={250} height={130} title="Cash Flow Quality (CFO/NI)" unit="×" fmt={v => v.toFixed(2)} />
                  <p className="dn-reason-text">CFO/NI above 1.0× confirms earnings convert to cash. Below 1.0× sustained = accruals inflation risk. The dashed line marks the benchmark — any persistent gap between reported profits and actual cash generation demands investigation into working capital consumption, capitalisation policies, or revenue timing.</p>
                </div>
              )}
              {growthSeries.length > 0 && (
                <div>
                  <LineChartPrint series={growthSeries} width={250} height={130} title="Revenue Growth Trajectory" unit="%" />
                  <p className="dn-reason-text">Revenue growth trajectory reveals whether the company is accelerating, decelerating, or in steady state. Decelerating growth with expanding margins may indicate maturation — a positive for stability but a risk for growth-multiple valuation. Accelerating growth supports premium multiples.</p>
                </div>
              )}
            </div>
            {(validLev.length > 0 || intCovSeries.length > 0) && (
              <div className="dn-two-col" style={{ marginTop: 8 }}>
                {validLev.length > 0 && (
                  <div>
                    <LineChartPrint series={validLev} width={250} height={130} title="Leverage vs Peer Average" unit="×" fmt={v => v.toFixed(2)} />
                    <p className="dn-reason-text">D/E relative to peer average reveals strategic positioning. Declining D/E while peers increase = conservative management creating acquisition debt capacity. Rising D/E may signal aggressive capex funding or deteriorating profitability forcing debt reliance.</p>
                  </div>
                )}
                {intCovSeries.length > 0 && (
                  <div>
                    <LineChartPrint series={intCovSeries} width={250} height={130} title="Interest Coverage Trend" unit="×" fmt={v => v.toFixed(1)} />
                    <p className="dn-reason-text">Interest coverage above 3× (dashed line) provides comfortable debt servicing buffer. Below 1.5× signals stress. Declining coverage despite stable leverage indicates margin compression eating into debt capacity — a critical watch item for acquirers assessing post-deal leverage.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* ── Peer Comparison Charts ── */}
      {peerSet.peers.length > 0 && (
        <>
          <h3 className="dn-h3" style={{ marginBottom: 4 }}>Peer Comparison</h3>
          <div className="dn-two-col" style={{ marginBottom: 8 }}>
            <div>
              <div className="dn-bar-chart">
                <div style={{ fontSize: 9, fontWeight: 600, color: '#6B7A92', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>EBITDA Margin %</div>
                {[subject, ...peerSet.peers.slice(0, 4)].map(c => {
                  const maxVal = Math.max(subject.ebm, ...peerSet.peers.map(p => p.ebm), 1)
                  return (
                    <div className="dn-bar-row" key={c.ticker}>
                      <div className="dn-bar-label">{c.ticker === subject.ticker ? `${c.name.slice(0, 10)} ★` : c.name.slice(0, 12)}</div>
                      <div className="dn-bar-track">
                        <div className={`dn-bar-fill ${c.ticker === subject.ticker ? '' : 'navy'}`} style={{ width: `${(c.ebm / maxVal) * 100}%` }} />
                      </div>
                      <div className="dn-bar-value">{c.ebm.toFixed(1)}%</div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div>
              <div className="dn-bar-chart">
                <div style={{ fontSize: 9, fontWeight: 600, color: '#6B7A92', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>Revenue ₹Cr</div>
                {[subject, ...peerSet.peers.slice(0, 4)].map(c => {
                  const maxVal = Math.max(subject.rev, ...peerSet.peers.map(p => p.rev), 1)
                  return (
                    <div className="dn-bar-row" key={`rev-${c.ticker}`}>
                      <div className="dn-bar-label">{c.ticker === subject.ticker ? `${c.name.slice(0, 10)} ★` : c.name.slice(0, 12)}</div>
                      <div className="dn-bar-track">
                        <div className={`dn-bar-fill ${c.ticker === subject.ticker ? '' : 'navy'}`} style={{ width: `${(c.rev / maxVal) * 100}%` }} />
                      </div>
                      <div className="dn-bar-value">{c.rev.toLocaleString('en-IN')}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
          {/* Peer EV/EBITDA comparison */}
          <div className="dn-bar-chart" style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: '#6B7A92', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>EV/EBITDA Valuation Multiple</div>
            {[subject, ...peerSet.peers.slice(0, 4)].filter(c => c.ev_eb > 0).map(c => {
              const maxVal = Math.max(subject.ev_eb, ...peerSet.peers.filter(p => p.ev_eb > 0).map(p => p.ev_eb), 1)
              return (
                <div className="dn-bar-row" key={`eveb-${c.ticker}`}>
                  <div className="dn-bar-label">{c.ticker === subject.ticker ? `${c.name.slice(0, 10)} ★` : c.name.slice(0, 12)}</div>
                  <div className="dn-bar-track">
                    <div className={`dn-bar-fill ${c.ticker === subject.ticker ? '' : 'navy'}`} style={{ width: `${(c.ev_eb / maxVal) * 100}%` }} />
                  </div>
                  <div className="dn-bar-value">{c.ev_eb.toFixed(1)}×</div>
                </div>
              )
            })}
          </div>
          <p className="dn-reason-text">
            {subject.name} trades at {subject.ev_eb.toFixed(1)}× EV/EBITDA {subject.ebm > (peerSet.peers.reduce((s, p) => s + p.ebm, 0) / peerSet.peers.length) ? 'with above-average margins' : 'with below-average margins'} vs peers.
            {subject.ev_eb < (peerSet.peers.reduce((s, p) => s + p.ev_eb, 0) / peerSet.peers.filter(p => p.ev_eb > 0).length) ? ' The lower-than-peer multiple may represent a valuation discount that could narrow with improved market recognition or operational improvement.' : ' The premium multiple reflects the market\'s expectation of superior growth, margin expansion, or strategic positioning.'}
            {' '}Revenue scale {subject.rev > (peerSet.peers.reduce((s, p) => s + p.rev, 0) / peerSet.peers.length) ? 'exceeds' : 'is below'} peer average — scale advantage in manufacturing drives procurement leverage, capacity utilisation, and customer negotiation power.
          </p>
        </>
      )}

      {/* ── Working Capital & Efficiency Over Time ── */}
      {showCharts && (() => {
        const cccData = years.filter(y => y.cashConversionCycle !== null).reverse()
        const dsoData = years.filter(y => y.receivables && y.revenue).reverse()
        if (cccData.length < 2 && dsoData.length < 2) return null

        const cccSeries: LineSeries[] = []
        if (cccData.length >= 2) cccSeries.push({ label: 'CCC days', color: '#D4A43B', data: cccData.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: y.cashConversionCycle ?? 0 })) })

        const wcSeries: LineSeries[] = []
        if (dsoData.length >= 2) {
          wcSeries.push({ label: 'DSO', color: '#0A2340', data: dsoData.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: ((y.receivables ?? 0) / (y.revenue ?? 1)) * 365 })) })
          const dioData = dsoData.filter(y => y.inventory)
          if (dioData.length >= 2) wcSeries.push({ label: 'DIO', color: '#2E6B3A', dashed: true, data: dioData.map(y => ({ x: y.label?.slice(0, 8) || y.fiscalYear, y: ((y.inventory ?? 0) / ((y.revenue ?? 1) * 0.7)) * 365 })) })
        }

        return (
          <div style={{ marginBottom: 12 }}>
            <h3 className="dn-h3" style={{ marginBottom: 4 }}>Working Capital Efficiency</h3>
            <div className="dn-two-col">
              {cccSeries.length > 0 && (
                <div>
                  <LineChartPrint series={cccSeries} width={250} height={140} title="Cash Conversion Cycle" unit=" d" fmt={v => Math.round(v).toString()} />
                  <p className="dn-reason-text">Lower CCC = less cash tied up in operations. Rising CCC without revenue growth = deteriorating working capital.</p>
                </div>
              )}
              {wcSeries.length > 0 && (
                <div>
                  <LineChartPrint series={wcSeries} width={250} height={140} title="DSO & DIO Trends" unit=" d" fmt={v => Math.round(v).toString()} />
                  <p className="dn-reason-text">DSO = collection speed. DIO = inventory efficiency. Rising DSO may signal loose credit or premature recognition.</p>
                </div>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Peer Valuation Profile ── */}
      {peerSet.peers.length >= 2 && showCharts && (() => {
        const allCos = [subject, ...peerSet.peers.slice(0, 4)]
        const metrics = [
          { label: 'EV/EBITDA', get: (c: Company) => c.ev_eb },
          { label: 'P/E', get: (c: Company) => c.pe },
          { label: 'Growth %', get: (c: Company) => c.revg },
          { label: 'Margin %', get: (c: Company) => c.ebm },
          { label: 'D/E', get: (c: Company) => c.dbt_eq },
        ]
        const peerAvgVals = metrics.map(m => {
          const vals = peerSet.peers.map(p => m.get(p)).filter(v => v > 0)
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
        })
        const series: LineSeries[] = [
          { label: subject.ticker, color: '#D4A43B', data: metrics.map(m => ({ x: m.label, y: m.get(subject) })) },
          { label: 'Peer Avg', color: '#6B7A92', dashed: true, data: metrics.map((m, i) => ({ x: m.label, y: peerAvgVals[i] })) },
        ]
        return (
          <div style={{ marginBottom: 12 }}>
            <h3 className="dn-h3" style={{ marginBottom: 4 }}>Valuation Profile — Subject vs Peer Average</h3>
            <LineChartPrint series={series} width={510} height={160} title="Key Metrics Comparison" />
            <p className="dn-reason-text">Gold line = {subject.ticker}, grey dashed = peer average. Points above peer line on growth/margin = outperformance. Points above on multiples (EV/EBITDA, P/E) = premium valuation. The overall shape reveals whether the company is a growth leader, value play, or leveraged operator.</p>
          </div>
        )
      })()}

      {/* ── Individual Peer Comparison — All Competitors ── */}
      {peerSet.peers.length >= 2 && showCharts && (() => {
        const peerColors = ['#0A2340', '#2E6B3A', '#A9232B', '#6B7A92', '#D4A43B']
        const allCos = [subject, ...peerSet.peers.slice(0, 4)]
        const metricDefs = [
          { key: 'Margin %', get: (c: Company) => c.ebm, unit: '%' },
          { key: 'Growth %', get: (c: Company) => c.revg, unit: '%' },
          { key: 'EV/EBITDA', get: (c: Company) => c.ev_eb, unit: '×' },
          { key: 'D/E', get: (c: Company) => c.dbt_eq, unit: '×' },
        ]
        // Individual peer lines across metrics
        const series: LineSeries[] = allCos.map((c, i) => ({
          label: c.ticker.slice(0, 8),
          color: i === 0 ? '#D4A43B' : peerColors[i % peerColors.length],
          dashed: i > 0,
          data: metricDefs.map(m => ({ x: m.key, y: m.get(c) })),
        }))
        return (
          <div style={{ marginBottom: 12 }}>
            <h3 className="dn-h3" style={{ marginBottom: 4 }}>Competitive Positioning — Individual Peer Analysis</h3>
            <LineChartPrint series={series} width={510} height={160} title="All Competitors — Key Financial Parameters" />
            <p className="dn-reason-text">Each line represents a company (gold = {subject.ticker}, others = peers). Where lines cross, relative positioning shifts — a company leading on margin may trail on growth. The pattern reveals strategic trade-offs: high-margin/low-growth (mature), high-growth/high-leverage (aggressive), or balanced profiles (defensive). For acquirers, the ideal target shows superior margins with moderate leverage and a valuation discount.</p>

            {/* Per-metric bar charts — each competitor visible */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
              {metricDefs.map(m => (
                <div key={m.key} style={{ flex: '1 1 240px' }}>
                  <div className="dn-bar-chart">
                    <div style={{ fontSize: 8, fontWeight: 600, color: '#6B7A92', marginBottom: 3, textTransform: 'uppercase', letterSpacing: 0.5 }}>{m.key}</div>
                    {allCos.map((c, i) => {
                      const maxVal = Math.max(...allCos.map(x => m.get(x)), 1)
                      return (
                        <div className="dn-bar-row" key={c.ticker}>
                          <div className="dn-bar-label">{c.ticker === subject.ticker ? `★ ${c.ticker.slice(0, 6)}` : c.ticker.slice(0, 8)}</div>
                          <div className="dn-bar-track">
                            <div className={`dn-bar-fill ${c.ticker === subject.ticker ? '' : 'navy'}`} style={{ width: `${(m.get(c) / maxVal) * 100}%` }} />
                          </div>
                          <div className="dn-bar-value">{m.get(c).toFixed(1)}{m.unit}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* ── Performance Summary — Theoretical Reasoning ── */}
      <div className="dn-callout" style={{ marginTop: 8, marginBottom: 8 }}>
        <strong>Analytical Framework — How to Read These Charts:</strong>
        <ul style={{ margin: '6px 0 0 16px', fontSize: 9, lineHeight: 1.7, color: '#475670' }}>
          <li><strong>Profitability trends</strong> (EBITDA/Net margin): Expanding margins indicate operating leverage — fixed costs being spread over growing revenue. Contracting margins despite growth signal input cost inflation or competitive pricing pressure.</li>
          <li><strong>Return divergence</strong> (ROE vs ROA): When ROE rises faster than ROA, financial leverage is amplifying returns — sustainable only if interest rates remain stable. Converging ROE and ROA signals genuine operational improvement.</li>
          <li><strong>Cash flow quality</strong> (CFO/NI): The single most important earnings quality indicator. Sustained CFO/NI below 1.0× means reported profits exceed cash generation — investigate accruals, working capital consumption, and capitalisation policies.</li>
          <li><strong>Working capital efficiency</strong> (CCC, DSO, DIO): Rising DSO without revenue acceleration suggests loosened collection terms or channel stuffing. Rising DIO without order-book growth suggests demand slowdown or speculative inventory build.</li>
          <li><strong>Peer comparison</strong>: Individual competitor positioning reveals strategic trade-offs. The ideal acquisition target shows superior margins with moderate leverage and a valuation discount to peers — a combination that suggests market under-appreciation of operational quality.</li>
        </ul>
      </div>

      {/* ── Narrative Story — Analysis Summary ── */}
      <div className="dn-strategy-card gold-border" style={{ marginTop: 10, marginBottom: 8 }}>
        <div className="card-title">Analysis Narrative — The Investment Story</div>
        <p style={{ margin: '4px 0', fontSize: 9.5, lineHeight: 1.7 }}>
          {subject.name} operates in the {subject.sec === 'solar' ? 'solar value chain' : 'T&D infrastructure'} sector with revenue of ₹{subject.rev.toLocaleString('en-IN')} Cr
          {subject.revg > 15 ? `, growing at an above-average ${subject.revg}% — indicating strong demand tailwinds and successful capacity expansion` : subject.revg > 5 ? `, growing at ${subject.revg}%` : `, with modest ${subject.revg}% growth`}.
          {subject.ebm > 15 ? ` EBITDA margin of ${subject.ebm}% demonstrates strong operating leverage and pricing power.` : ` EBITDA margin of ${subject.ebm}% is typical for the segment.`}
          {subject.dbt_eq < 0.5 ? ` The conservative balance sheet (${subject.dbt_eq}× D/E) provides significant acquisition debt capacity.` : subject.dbt_eq < 1.0 ? ` Balance sheet leverage at ${subject.dbt_eq}× D/E is manageable.` : ` Elevated leverage at ${subject.dbt_eq}× D/E requires careful assessment of debt servicing capacity.`}
          {' '}
          {history.cagrs.revenueCagrPct !== null && history.cagrs.revenueCagrPct > 15 ? `The ${history.cagrs.revenueCagrPct.toFixed(1)}% revenue CAGR over ${history.yearsOfHistory} years confirms a structural growth trajectory, not a cyclical spike.` : history.cagrs.revenueCagrPct !== null ? `Revenue has compounded at ${history.cagrs.revenueCagrPct.toFixed(1)}% over ${history.yearsOfHistory} years.` : ''}
          {' '}
          {subject.acqs >= 8 ? `With an acquisition score of ${subject.acqs}/10 (${subject.acqf}), this is a high-priority target for strategic buyers.` : subject.acqs >= 6 ? `The ${subject.acqs}/10 acquisition score (${subject.acqf}) suggests this target merits further due diligence.` : `The ${subject.acqs}/10 acquisition score (${subject.acqf}) indicates this target has specific challenges that limit near-term deal feasibility.`}
        </p>
      </div>

      {/* Critical highlights */}
      {(() => {
        const positives: string[] = []
        const criticals: string[] = []
        if (subject.ebm > 18) positives.push(`Strong EBITDA margin at ${subject.ebm}% — robust pricing power`)
        if (subject.revg > 25) positives.push(`Revenue growth of ${subject.revg}% significantly above sector average`)
        if (subject.dbt_eq < 0.3) positives.push(`Conservative leverage at ${subject.dbt_eq}× D/E — strong balance sheet`)
        if (subject.acqs >= 8) positives.push(`High acquisition score of ${subject.acqs}/10 — strong strategic fit`)
        if (history.cagrs.revenueCagrPct !== null && history.cagrs.revenueCagrPct > 20) positives.push(`${history.cagrs.revenueCagrPct.toFixed(1)}% revenue CAGR confirms structural growth`)
        if (subject.ebm < 8) criticals.push(`EBITDA margin of ${subject.ebm}% is thin — limited cost buffer`)
        if (subject.dbt_eq > 1.5) criticals.push(`D/E of ${subject.dbt_eq}× exceeds 1.5× — elevated financial risk`)
        if (subject.revg < 5) criticals.push(`Revenue growth of ${subject.revg}% is near stagnant`)
        if (subject.ev_eb > 40) criticals.push(`Premium valuation at ${subject.ev_eb}× EV/EBITDA — high expectations embedded`)
        if (!positives.length && !criticals.length) return null
        return (
          <div style={{ marginBottom: 12 }}>
            <h3 className="dn-h3" style={{ marginBottom: 6 }}>Key Signals</h3>
            <div className="flag-row">
              {positives.map((p, i) => <span key={`p${i}`} className="flag flag-green">▲ {p}</span>)}
              {criticals.map((c, i) => <span key={`c${i}`} className="flag flag-red">▼ {c}</span>)}
            </div>
          </div>
        )
      })()}

      {/* Theoretical significance */}
      <div className="dn-callout" style={{ marginTop: 8 }}>
        <strong>Analytical significance:</strong> The DuPont 5-factor decomposition reveals whether ROE is driven by operational excellence (EBIT margin × asset turnover) or financial engineering (equity multiplier). Leverage-driven ROE is fragile to interest rate changes and economic downturns. The Altman Z-Score combines liquidity, profitability, leverage, and efficiency into a single bankruptcy predictor — EBIT/TA carries the highest weight (3.3×) as the most direct measure of asset productivity. The radar chart compares the company across five strategic dimensions against peer medians, revealing whether competitive advantage is broad-based or concentrated in a single dimension. Time series trends in margins and FCF are more predictive of future performance than point-in-time ratios — deteriorating trends in a company with strong current ratios should be treated as an early warning signal.
      </div>
      <PageFooter />
    </section>
  )
}

// ── Policy reference data ──────────────────────────────────────

const POLICY_INFO: Record<string, { name: string; direction: string; timeframe: string; source: string; url: string; impact: string }> = {
  'PLI-Solar': { name: 'PLI Scheme for Solar PV Manufacturing', direction: 'Positive', timeframe: 'FY24–FY30', source: 'MNRE, Govt. of India', url: 'https://mnre.gov.in/solar/schemes', impact: 'Direct subsidy reduces capacity expansion cost by ~15%, improving returns on invested capital.' },
  'PLI-ACC': { name: 'PLI Scheme for Advanced Chemistry Cell (ACC)', direction: 'Positive', timeframe: 'FY24–FY30', source: 'Ministry of Heavy Industries', url: 'https://heavyindustries.gov.in/acc-pli', impact: 'Incentivises domestic battery cell manufacturing, reducing import dependence.' },
  'ALMM': { name: 'Approved List of Models & Manufacturers', direction: 'Positive', timeframe: 'Ongoing', source: 'MNRE Order dt. 10-Apr-2021', url: 'https://almm.mnre.gov.in', impact: 'Creates a regulatory moat for ALMM-listed manufacturers by restricting government project procurement to approved vendors.' },
  'BCD': { name: 'Basic Customs Duty on Solar Imports', direction: 'Positive', timeframe: 'Apr 2022 onwards', source: 'CBIC Notification No. 02/2022', url: 'https://www.cbic.gov.in', impact: 'BCD of 25% on cells and 40% on modules protects domestic manufacturers from cheaper Chinese imports.' },
  'NSM-500GW': { name: 'National Solar Mission — 500 GW RE by 2030', direction: 'Positive', timeframe: 'By 2030', source: 'MNRE, COP26 Commitment', url: 'https://mnre.gov.in/solar-mission', impact: 'Creates sustained demand visibility for 500 GW renewable capacity including 280 GW solar.' },
  'RDSS': { name: 'Revamped Distribution Sector Scheme (RDSS)', direction: 'Positive', timeframe: 'FY22–FY27', source: 'Ministry of Power', url: 'https://rdss.gov.in', impact: 'Rs 3.03 lakh crore scheme driving smart metering, distribution infrastructure, and AT&C loss reduction.' },
  'GEC': { name: 'Green Energy Corridor (GEC) Phase II', direction: 'Positive', timeframe: 'FY23–FY28', source: 'Ministry of Power', url: 'https://powermin.gov.in/en/content/green-energy-corridor', impact: 'Rs 12,031 crore for intra-state transmission to evacuate renewable power, driving transformer and conductor demand.' },
  'NEP-2032': { name: 'National Electricity Plan 2022-2032', direction: 'Positive', timeframe: '2022–2032', source: 'Central Electricity Authority (CEA)', url: 'https://cea.nic.in/national-electricity-plan', impact: 'Outlines Rs 9.15 lakh crore transmission investment over the decade, benefiting T&D equipment manufacturers.' },
  'EA-Rules': { name: 'Electricity (Amendment) Rules 2023', direction: 'Positive', timeframe: 'Ongoing', source: 'Ministry of Power, Gazette Notification', url: 'https://powermin.gov.in', impact: 'Mandates smart prepaid metering in all new connections, driving AMI ecosystem adoption.' },
  'ISTS-Waiver': { name: 'ISTS Charges Waiver for RE', direction: 'Positive', timeframe: 'Till June 2025', source: 'CERC Order', url: 'https://cercind.gov.in', impact: 'Waiver of inter-state transmission charges for renewable projects makes solar/wind more competitive.' },
  'PM-KUSUM': { name: 'PM-KUSUM Scheme for Solar Agriculture', direction: 'Positive', timeframe: 'Ongoing', source: 'MNRE', url: 'https://mnre.gov.in/pm-kusum', impact: 'Drives distributed solar pump installations, increasing small module and inverter demand in rural India.' },
  'PMSGMBY': { name: 'PM Surya Ghar Muft Bijli Yojana', direction: 'Positive', timeframe: 'FY25–FY27', source: 'MNRE', url: 'https://pmsuryaghar.gov.in', impact: 'Rs 75,021 crore for 1 crore rooftop solar installations, boosting residential module and inverter demand.' },
  'QCO-Solar': { name: 'Quality Control Order for Solar PV', direction: 'Positive', timeframe: 'Ongoing', source: 'BIS, Govt. of India', url: 'https://bis.gov.in', impact: 'BIS certification mandatory for solar components, raising entry barriers for sub-standard imports.' },
}

// ── NEW Page: Financial Ratios & Peer Benchmark ──────────────

function FinancialRatiosPage({
  subject,
  history,
  peerSet,
}: {
  subject: Company
  history: FinancialHistory
  peerSet: PeerSet
}) {
  const latest = history.history[0]
  const prev = history.history[1] || latest

  // Compute key ratios from latest financials
  const ratios = {
    grossMargin: latest && latest.grossProfit && latest.revenue ? (latest.grossProfit / latest.revenue * 100) : null,
    operatingMargin: latest && latest.ebitda && latest.revenue ? (latest.ebitda / latest.revenue * 100) : null,
    netMargin: latest && latest.netIncome && latest.revenue ? (latest.netIncome / latest.revenue * 100) : null,
    roe: latest?.roePct ?? null,
    roa: latest?.roaPct ?? null,
    currentRatio: latest && latest.currentAssets && latest.currentLiabilities ? (latest.currentAssets / latest.currentLiabilities) : null,
    debtEquity: latest?.debtToEquity ?? subject.dbt_eq,
    debtEbitda: latest && latest.totalDebt && latest.ebitda && latest.ebitda > 0 ? (latest.totalDebt / latest.ebitda) : null,
    assetTurnover: latest && latest.revenue && latest.totalAssets ? (latest.revenue / latest.totalAssets) : null,
    receivablesDays: latest && latest.receivables && latest.revenue ? (latest.receivables / latest.revenue * 365) : null,
    cashConversion: latest?.cashConversionCycle ?? null,
    fcfToDebt: latest && latest.fcf && latest.totalDebt && latest.totalDebt > 0 ? (latest.fcf / latest.totalDebt * 100) : null,
  }

  // Compute same ratios for peers
  const peerRatios = peerSet.peers.map(p => ({
    name: p.name,
    ticker: p.ticker,
    grossMargin: p.ebm, // approximation — EBITDA margin as proxy
    operatingMargin: p.ebm,
    netMargin: p.pat && p.rev ? (p.pat / p.rev * 100) : null,
    roe: null as number | null, // not available without history
    roa: null as number | null,
    currentRatio: null as number | null,
    debtEquity: p.dbt_eq,
    revGrowth: p.revg,
    pe: p.pe,
    evEbitda: p.ev_eb,
  }))

  const peerMedian = (vals: (number | null)[]) => {
    const valid = vals.filter((v): v is number => v !== null && isFinite(v)).sort((a, b) => a - b)
    if (!valid.length) return null
    const mid = Math.floor(valid.length / 2)
    return valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2
  }

  const peerBest = (vals: (number | null)[], higher: boolean) => {
    const valid = vals.filter((v): v is number => v !== null && isFinite(v))
    if (!valid.length) return null
    return higher ? Math.max(...valid) : Math.min(...valid)
  }

  const RatioRow = ({ label, value, peerMed, best, worst, suffix = '', higherIsBetter = true }: { label: string; value: number | null; peerMed: number | null; best: number | null; worst: number | null; suffix?: string; higherIsBetter?: boolean }) => {
    const fmt = (v: number | null) => v === null ? '—' : `${v.toFixed(1)}${suffix}`
    const isBetter = value !== null && peerMed !== null ? (higherIsBetter ? value >= peerMed : value <= peerMed) : null
    return (
      <tr>
        <td className="label">{label}</td>
        <td className={`num mono ${isBetter === true ? 'better' : isBetter === false ? 'worse' : ''}`}>{fmt(value)}</td>
        <td className="num mono">{fmt(peerMed)}</td>
        <td className="num mono">{fmt(best)}</td>
        <td className="num mono">{fmt(worst)}</td>
      </tr>
    )
  }

  return (
    <section className="dn-page dn-page-flow">
      <PageHeader subject={subject} section="Financial Ratios" pageNum="03" />
      <span className="dn-eyebrow">Ratio Analysis — {subject.ticker} vs Peer Group</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>Financial Ratio Benchmark</h2>
      <hr className="dn-rule" />

      <div className="dn-ratio-grid">
        {/* Profitability */}
        <div>
          <div className="dn-ratio-section-title">Profitability</div>
          <table className="dn-table compact">
            <thead><tr><th>Ratio</th><th className="num">Subject</th><th className="num">Peer Med</th><th className="num">Best</th><th className="num">Worst</th></tr></thead>
            <tbody>
              <RatioRow label="EBITDA Margin" value={subject.ebm} peerMed={peerMedian(peerRatios.map(p=>p.operatingMargin))} best={peerBest(peerRatios.map(p=>p.operatingMargin),true)} worst={peerBest(peerRatios.map(p=>p.operatingMargin),false)} suffix="%" />
              <RatioRow label="Net Margin" value={ratios.netMargin} peerMed={peerMedian(peerRatios.map(p=>p.netMargin))} best={peerBest(peerRatios.map(p=>p.netMargin),true)} worst={peerBest(peerRatios.map(p=>p.netMargin),false)} suffix="%" />
              <RatioRow label="ROE" value={ratios.roe} peerMed={null} best={null} worst={null} suffix="%" />
              <RatioRow label="ROA" value={ratios.roa} peerMed={null} best={null} worst={null} suffix="%" />
            </tbody>
          </table>
        </div>

        {/* Leverage */}
        <div>
          <div className="dn-ratio-section-title">Leverage &amp; Coverage</div>
          <table className="dn-table compact">
            <thead><tr><th>Ratio</th><th className="num">Subject</th><th className="num">Peer Med</th><th className="num">Best</th><th className="num">Worst</th></tr></thead>
            <tbody>
              <RatioRow label="Debt / Equity" value={ratios.debtEquity} peerMed={peerMedian(peerRatios.map(p=>p.debtEquity))} best={peerBest(peerRatios.map(p=>p.debtEquity),false)} worst={peerBest(peerRatios.map(p=>p.debtEquity),true)} suffix="×" higherIsBetter={false} />
              <RatioRow label="Debt / EBITDA" value={ratios.debtEbitda} peerMed={null} best={null} worst={null} suffix="×" higherIsBetter={false} />
              <RatioRow label="FCF / Total Debt" value={ratios.fcfToDebt} peerMed={null} best={null} worst={null} suffix="%" />
            </tbody>
          </table>
        </div>

        {/* Efficiency */}
        <div>
          <div className="dn-ratio-section-title">Efficiency</div>
          <table className="dn-table compact">
            <thead><tr><th>Ratio</th><th className="num">Subject</th><th className="num">Peer Med</th><th className="num">Best</th><th className="num">Worst</th></tr></thead>
            <tbody>
              <RatioRow label="Asset Turnover" value={ratios.assetTurnover} peerMed={null} best={null} worst={null} suffix="×" />
              <RatioRow label="Receivables Days" value={ratios.receivablesDays} peerMed={null} best={null} worst={null} suffix=" d" higherIsBetter={false} />
              <RatioRow label="Cash Conv. Cycle" value={ratios.cashConversion} peerMed={null} best={null} worst={null} suffix=" d" higherIsBetter={false} />
            </tbody>
          </table>
        </div>

        {/* Valuation */}
        <div>
          <div className="dn-ratio-section-title">Valuation Multiples</div>
          <table className="dn-table compact">
            <thead><tr><th>Ratio</th><th className="num">Subject</th><th className="num">Peer Med</th><th className="num">Best</th><th className="num">Worst</th></tr></thead>
            <tbody>
              <RatioRow label="EV / EBITDA" value={subject.ev_eb} peerMed={peerMedian(peerRatios.map(p=>p.evEbitda))} best={peerBest(peerRatios.map(p=>p.evEbitda),false)} worst={peerBest(peerRatios.map(p=>p.evEbitda),true)} suffix="×" higherIsBetter={false} />
              <RatioRow label="P / E" value={subject.pe} peerMed={peerMedian(peerRatios.map(p=>p.pe))} best={peerBest(peerRatios.map(p=>p.pe),false)} worst={peerBest(peerRatios.map(p=>p.pe),true)} suffix="×" higherIsBetter={false} />
              <RatioRow label="P / B" value={subject.pb} peerMed={null} best={null} worst={null} suffix="×" higherIsBetter={false} />
              <RatioRow label="Revenue Growth" value={subject.revg} peerMed={peerMedian(peerRatios.map(p=>p.revGrowth))} best={peerBest(peerRatios.map(p=>p.revGrowth),true)} worst={peerBest(peerRatios.map(p=>p.revGrowth),false)} suffix="%" />
            </tbody>
          </table>
        </div>
      </div>

      {/* Growth CAGR */}
      <div className="dn-ratio-section-title" style={{ marginTop: 8 }}>Growth (CAGR)</div>
      <table className="dn-table compact" style={{ maxWidth: '50%' }}>
        <thead><tr><th>Metric</th><th className="num">{history.yearsOfHistory}yr CAGR</th></tr></thead>
        <tbody>
          {history.cagrs.revenueCagrPct !== null && <tr><td className="label">Revenue</td><td className="num mono">{history.cagrs.revenueCagrPct.toFixed(1)}%</td></tr>}
          {history.cagrs.ebitdaCagrPct !== null && <tr><td className="label">EBITDA</td><td className="num mono">{history.cagrs.ebitdaCagrPct.toFixed(1)}%</td></tr>}
          {history.cagrs.netIncomeCagrPct !== null && <tr><td className="label">Net Income</td><td className="num mono">{history.cagrs.netIncomeCagrPct.toFixed(1)}%</td></tr>}
        </tbody>
      </table>

      {/* Callout */}
      <div className="dn-callout" style={{ marginTop: 10 }}>
        <strong>Key takeaway:</strong> {subject.name} trades at {subject.ev_eb.toFixed(1)}× EV/EBITDA
        {peerMedian(peerRatios.map(p=>p.evEbitda)) !== null ? ` vs peer median of ${peerMedian(peerRatios.map(p=>p.evEbitda))!.toFixed(1)}×` : ''},
        with {subject.revg}% revenue growth and {subject.ebm}% EBITDA margin.
        Debt/equity of {subject.dbt_eq.toFixed(2)}× {subject.dbt_eq < 0.5 ? 'indicates a conservative balance sheet' : subject.dbt_eq < 1.0 ? 'is within comfortable range' : 'requires monitoring'}.
        {'\u00A0'}Green cells = better than peer median. Red cells = below peer median.
      </div>
      <PageFooter />
    </section>
  )
}

// ── NEW Page: Industry, Policy & Commodity Overview ───────────

function IndustryPolicyPage({
  subject,
  chainNodes,
  segmentCompanies,
}: {
  subject: Company
  chainNodes: ChainNode[]
  segmentCompanies: Company[]
}) {
  const policies = Array.from(new Set(chainNodes.flatMap(c => c.pol || [])))
  const top5 = segmentCompanies.slice(0, 5)
  const totalMkt = segmentCompanies.reduce((s, c) => s + c.mktcap, 0)

  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Industry &amp; Policy" pageNum="06" />
      <span className="dn-eyebrow">Industry Overview — Value Chain Context</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>Industry, Policy &amp; Commodity Landscape</h2>
      <hr className="dn-rule" />

      {/* Industry Overview Table */}
      <h3 className="dn-h3" style={{ marginBottom: 6 }}>Market Size &amp; Growth</h3>
      <table className="dn-table compact" style={{ marginBottom: 12 }}>
        <thead>
          <tr><th>Segment</th><th className="num">India Market</th><th className="num">India CAGR</th><th className="num">Global Market</th><th className="num">Global CAGR</th><th>India Status</th></tr>
        </thead>
        <tbody>
          {chainNodes.map(c => (
            <tr key={c.id}>
              <td className="label">{c.name}</td>
              <td className="num mono">{c.mkt.ig}</td>
              <td className="num mono">{c.mkt.icagr}</td>
              <td className="num mono">{c.mkt.gg}</td>
              <td className="num mono">{c.mkt.gcagr}</td>
              <td style={{ fontSize: 8, maxWidth: 180 }}>{c.mkt.ist.slice(0, 80)}{c.mkt.ist.length > 80 ? '...' : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Top competitors bar chart */}
      <h3 className="dn-h3" style={{ marginBottom: 6 }}>Competitive Landscape — Top Players by Market Cap</h3>
      <div className="dn-bar-chart">
        {top5.map(c => (
          <div className="dn-bar-row" key={c.ticker}>
            <div className="dn-bar-label">{c.name.slice(0, 16)}</div>
            <div className="dn-bar-track">
              <div className="dn-bar-fill" style={{ width: `${totalMkt > 0 ? (c.mktcap / top5[0].mktcap * 100) : 0}%` }} />
            </div>
            <div className="dn-bar-value">{formatCr(c.mktcap)}</div>
          </div>
        ))}
      </div>

      {/* Policy & Regulatory Framework */}
      <h3 className="dn-h3" style={{ marginBottom: 6, marginTop: 12 }}>Policy &amp; Regulatory Framework</h3>
      <hr className="dn-rule" />
      <table className="dn-table compact" style={{ marginBottom: 8 }}>
        <thead>
          <tr><th>Policy / Scheme</th><th>Impact</th><th>Period</th><th>Government Source</th></tr>
        </thead>
        <tbody>
          {policies.map(pol => {
            const info = POLICY_INFO[pol]
            return info ? (
              <tr key={pol}>
                <td className="label">{info.name}</td>
                <td style={{ fontSize: 8 }}>{info.impact.slice(0, 100)}{info.impact.length > 100 ? '...' : ''}</td>
                <td style={{ fontSize: 8 }}>{info.timeframe}</td>
                <td style={{ fontSize: 7.5 }}><a href={info.url} className="dn-source-link" target="_blank" rel="noopener">{info.source}</a></td>
              </tr>
            ) : (
              <tr key={pol}><td className="label">{pol}</td><td colSpan={3}>—</td></tr>
            )
          })}
        </tbody>
      </table>

      {/* Strategic Paths */}
      {chainNodes.length > 0 && (
        <>
          <h3 className="dn-h3" style={{ marginBottom: 6, marginTop: 8 }}>Strategic Integration Paths</h3>
          <table className="dn-table compact">
            <thead><tr><th>Segment</th><th>Forward Integration</th><th>Backward Integration</th><th>Inorganic Strategy</th></tr></thead>
            <tbody>
              {chainNodes.map(c => (
                <tr key={c.id}>
                  <td className="label">{c.name}</td>
                  <td style={{ fontSize: 8 }}>{c.str.fwd.slice(0, 60)}</td>
                  <td style={{ fontSize: 8 }}>{c.str.bwd.slice(0, 60)}</td>
                  <td style={{ fontSize: 8 }}>{c.str.inorg.slice(0, 60)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <PageFooter />
    </section>
  )
}

// ── NEW Page: Shareholding & Acquisition Strategy ─────────────

function ShareholdingAcquisitionPage({
  subject,
  hhi,
  dcf,
  synergyNpv,
}: {
  subject: Company
  hhi: { hhi: number; shares: Array<{ticker:string;name:string;mktcap:number;sharePct:number}>; risk: 'Safe' | 'Moderate' | 'High' }
  dcf: DcfResult
  synergyNpv: number
}) {
  const standaloneValue = dcf.equityValue
  const integrationCost = subject.mktcap * 0.03
  const totalValue = standaloneValue + Math.max(0, synergyNpv)
  const maxBid = totalValue - integrationCost
  const walkaway = standaloneValue

  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Acquisition Strategy" pageNum="08" />
      <span className="dn-eyebrow">Shareholding Pattern &amp; Deal Structure</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>Shareholding &amp; Acquisition Framework</h2>
      <hr className="dn-rule" />

      <div className="dn-two-col">
        {/* Shareholding Pattern */}
        <div>
          <h3 className="dn-h3" style={{ marginBottom: 6 }}>Shareholding Pattern</h3>
          <div className="dn-callout" style={{ marginBottom: 8 }}>
            <strong>Data source:</strong> Shareholding data is filed quarterly per <strong>SEBI (Listing Obligations &amp; Disclosure Requirements) Regulations 2015, Reg. 31</strong>.
            Latest pattern available at <a href="https://www.bseindia.com/corporates/shp_prd.aspx" target="_blank" rel="noopener">BSE Corporate Filings</a> and{' '}
            <a href="https://www.nseindia.com/companies-listing/corporate-filings-shareholding-pattern" target="_blank" rel="noopener">NSE Shareholding</a>.
          </div>
          {/* Estimated breakdown — varies by company size and sector */}
          {(() => {
            // Estimate shareholding pattern based on market cap tier and sector
            // Large-cap (>50K Cr): lower promoter, higher institutional
            // Mid-cap (5K-50K): moderate promoter, growing institutional
            // Small-cap (<5K): high promoter, low institutional
            const mc = subject.mktcap
            const promoter = mc > 50000 ? 45 : mc > 10000 ? 52 : mc > 5000 ? 58 : 65
            const fii = mc > 50000 ? 22 : mc > 10000 ? 15 : mc > 5000 ? 10 : 5
            const dii = mc > 50000 ? 15 : mc > 10000 ? 12 : mc > 5000 ? 10 : 8
            const pub = 100 - promoter - fii - dii
            return (
              <div className="dn-stacked-bar">
                <div className="band navy" style={{ width: `${promoter}%` }}>Promoter {promoter}%</div>
                <div className="band gold" style={{ width: `${fii}%` }}>FII {fii}%</div>
                <div className="band green" style={{ width: `${dii}%` }}>DII {dii}%</div>
                <div className="band muted" style={{ width: `${pub}%` }}>Public {pub}%</div>
              </div>
            )
          })()}
          <div className="dn-stacked-legend">
            <span><span className="dot" style={{ background: 'var(--ink)' }} /> Promoter &amp; Group</span>
            <span><span className="dot" style={{ background: 'var(--gold-2)' }} /> FII</span>
            <span><span className="dot" style={{ background: 'var(--green)' }} /> DII</span>
            <span><span className="dot" style={{ background: 'var(--muted)' }} /> Public</span>
          </div>
          <p className="dn-mutedtxt" style={{ fontSize: 8, marginTop: 6, fontStyle: 'italic' }}>
            Note: Estimated indicative breakdown. Verify from latest quarterly filing on BSE/NSE for actual figures.
          </p>
        </div>

        {/* Market Concentration — HHI */}
        <div>
          <h3 className="dn-h3" style={{ marginBottom: 6 }}>Market Concentration (HHI)</h3>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8 }}>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>{hhi.hhi.toLocaleString('en-IN')}</span>
            <span className={`dn-risk-badge ${hhi.risk.toLowerCase()}`}>{hhi.risk}</span>
          </div>
          <p className="dn-mutedtxt" style={{ fontSize: 8.5, marginBottom: 8 }}>
            Per <strong>Competition Act, 2002 (CCI)</strong> and <strong>Competition Commission of India (Combination) Regulations, 2011</strong>:
            HHI &lt; 1,500 = Unconcentrated. 1,500–2,500 = Moderately concentrated. &gt; 2,500 = Highly concentrated.
          </p>
          {/* Top players */}
          <table className="dn-table compact">
            <thead><tr><th>Company</th><th className="num">Mkt Cap</th><th className="num">Share %</th></tr></thead>
            <tbody>
              {hhi.shares.slice(0, 5).map(s => (
                <tr key={s.ticker} style={s.ticker === subject.ticker ? { background: 'var(--gold-soft)' } : {}}>
                  <td className="label">{s.name.slice(0, 20)}</td>
                  <td className="num mono">{formatCr(s.mktcap)}</td>
                  <td className="num mono">{s.sharePct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Acquisition Valuation Framework */}
      <h3 className="dn-h3" style={{ marginTop: 14, marginBottom: 6 }}>Acquisition Valuation — Bid Range Analysis</h3>
      <hr className="dn-rule" />
      <table className="dn-table compact" style={{ maxWidth: '65%', marginBottom: 10 }}>
        <thead><tr><th>Component</th><th className="num">Value (₹ Cr)</th><th>Notes</th></tr></thead>
        <tbody>
          <tr><td className="label">Standalone DCF Value</td><td className="num mono">{formatCr(standaloneValue)}</td><td style={{ fontSize: 8 }}>5-year DCF with terminal value</td></tr>
          <tr><td className="label">Synergy NPV (est.)</td><td className="num mono">{formatCr(Math.max(0, synergyNpv))}</td><td style={{ fontSize: 8 }}>3% revenue synergy × 30% realisation + 1.5% cost synergy</td></tr>
          <tr className="subtotal"><td className="label">Total Value</td><td className="num mono">{formatCr(totalValue)}</td><td style={{ fontSize: 8 }}>Standalone + synergies</td></tr>
          <tr><td className="label">Less: Integration Cost (3%)</td><td className="num mono">({formatCr(integrationCost)})</td><td style={{ fontSize: 8 }}>Estimated at 3% of target market cap</td></tr>
          <tr className="subtotal"><td className="label">Maximum Bid Price</td><td className="num mono">{formatCr(maxBid)}</td><td style={{ fontSize: 8 }}>Total value less integration costs</td></tr>
          <tr><td className="label">Walk-Away Price</td><td className="num mono">{formatCr(walkaway)}</td><td style={{ fontSize: 8 }}>Standalone value (no synergy premium)</td></tr>
          <tr><td className="label">Current Market Cap</td><td className="num mono">{formatCr(subject.mktcap)}</td><td style={{ fontSize: 8 }}>As of latest exchange data</td></tr>
        </tbody>
      </table>

      {/* Deal Structure — SEBI Regulations */}
      <div className="dn-strategy-card">
        <div className="card-title">Deal Structure — Regulatory Requirements</div>
        <p style={{ margin: '4px 0', fontSize: 9 }}>
          <strong>SEBI (Substantial Acquisition of Shares &amp; Takeovers) Regulations, 2011 (SAST):</strong>
        </p>
        <ul style={{ margin: '4px 0', paddingLeft: 16, fontSize: 9, lineHeight: 1.6 }}>
          <li><strong>Reg. 3(1):</strong> Acquisition of 25% or more triggers a mandatory open offer to acquire at least 26% of total shares from public shareholders.</li>
          <li><strong>Reg. 3(2):</strong> Creeping acquisition limit — maximum 5% additional stake in any financial year (for holders between 25%–75%).</li>
          <li><strong>Reg. 4:</strong> Indirect acquisition of control also triggers open offer requirements.</li>
          <li><strong>Open Offer Price:</strong> Per Reg. 8 — highest of negotiated price, volume-weighted average of 60 trading days, or highest price paid in preceding 52 weeks.</li>
        </ul>
        <p style={{ margin: '4px 0', fontSize: 9 }}>
          <strong>CCI (Competition Commission of India):</strong> Per Section 5 &amp; 6 of Competition Act 2002, combinations exceeding ₹2,000 Cr assets or ₹6,000 Cr turnover require prior CCI approval (30–60 day review).
          Source: <a href="https://www.cci.gov.in" className="dn-source-link" target="_blank" rel="noopener">cci.gov.in</a>
        </p>
      </div>

      <div className="dn-callout" style={{ marginTop: 6 }}>
        <strong>Acquisition Score: {subject.acqs}/10 — {subject.acqf}</strong>. {subject.rea.slice(0, 200)}
      </div>
      <PageFooter />
    </section>
  )
}

// ── NEW Page: DCF Sensitivity & Scenarios ─────────────────────

function SensitivityScenarioPage({
  subject,
  sensitivityMatrix,
  scenarios,
  dcf,
}: {
  subject: Company
  sensitivityMatrix: Array<Array<{wacc:number;tg:number;equityValue:number}>>
  scenarios: Array<{label:string;equityValue:number;upsidePct:number;assumptions:ReturnType<typeof defaultDcfAssumptions>}>
  dcf: DcfResult
}) {
  const baseWacc = dcf.assumptions.wacc
  const baseTg = dcf.assumptions.terminalGrowth
  const mktcap = subject.mktcap

  return (
    <section className="dn-page dn-page-flow">
      <PageHeader subject={subject} section="Sensitivity &amp; Scenarios" pageNum="10" />
      <span className="dn-eyebrow">Valuation Sensitivity — DCF Stress Testing</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>DCF Sensitivity Matrix &amp; Scenario Analysis</h2>
      <hr className="dn-rule" />

      {/* Sensitivity Matrix */}
      <h3 className="dn-h3" style={{ marginBottom: 6 }}>Implied Equity Value (₹ Cr) — WACC vs Terminal Growth</h3>
      <table className="dn-sensitivity-matrix">
        <thead>
          <tr>
            <th style={{ width: 90 }}>WACC →<br />T.Growth ↓</th>
            {sensitivityMatrix[0]?.map((cell, ci) => (
              <th key={ci}>{(cell.wacc * 100).toFixed(1)}%</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sensitivityMatrix.map((row, ri) => (
            <tr key={ri}>
              <td className="row-header">{(row[0].tg * 100).toFixed(1)}%</td>
              {row.map((cell, ci) => {
                const isBase = Math.abs(cell.wacc - baseWacc) < 0.001 && Math.abs(cell.tg - baseTg) < 0.001
                const aboveMkt = cell.equityValue > mktcap
                return (
                  <td key={ci} className={`${isBase ? 'highlight' : ''} ${aboveMkt ? 'above' : 'below'}`}>
                    {formatCr(cell.equityValue)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="dn-mutedtxt" style={{ fontSize: 8, marginTop: 4 }}>
        Highlighted cell = base case. <span style={{ color: 'var(--green)' }}>Green</span> = above current market cap ({formatCr(mktcap)}).{' '}
        <span style={{ color: 'var(--red)' }}>Red</span> = below market cap. WACC range: ±150 bps. Terminal growth: ±100 bps.
      </p>

      {/* Bull / Base / Bear Scenarios */}
      <h3 className="dn-h3" style={{ marginTop: 16, marginBottom: 8 }}>Scenario Analysis — Bull / Base / Bear</h3>
      <hr className="dn-rule" />
      <div className="dn-scenario-grid">
        {scenarios.map((s, i) => (
          <div key={s.label} className={`dn-scenario-card ${s.label.toLowerCase()}`}>
            <div className="scenario-label">{s.label} Case</div>
            <div className="scenario-value">{formatCr(s.equityValue)}</div>
            <div className="scenario-sub" style={{ color: s.upsidePct >= 0 ? 'var(--green)' : 'var(--red)' }}>
              {s.upsidePct >= 0 ? '+' : ''}{s.upsidePct.toFixed(1)}% vs market
            </div>
            <div style={{ marginTop: 10 }}>
              <div className="dn-scenario-row"><span className="label">Revenue Growth</span><span className="val">{(s.assumptions.startingGrowth * 100).toFixed(1)}%</span></div>
              <div className="dn-scenario-row"><span className="label">EBITDA Margin</span><span className="val">{(s.assumptions.startingEbitdaMargin * 100).toFixed(1)}%</span></div>
              <div className="dn-scenario-row"><span className="label">WACC</span><span className="val">{(s.assumptions.wacc * 100).toFixed(2)}%</span></div>
              <div className="dn-scenario-row"><span className="label">Terminal Growth</span><span className="val">{(s.assumptions.terminalGrowth * 100).toFixed(1)}%</span></div>
            </div>
          </div>
        ))}
      </div>

      <div className="dn-callout">
        <strong>Scenario construction:</strong> Bull case assumes +3% higher revenue growth, +2% wider EBITDA margin, and 50 bps lower WACC reflecting favourable policy tailwinds and operational efficiency.
        Bear case assumes the inverse. Base case uses the current DCF assumptions anchored to trailing financials. All three scenarios hold terminal growth constant at {(baseTg * 100).toFixed(1)}%.
      </div>
      <PageFooter />
    </section>
  )
}

// ── Appendix: Assumptions + Sources ────────────────────────────

// ── Conclusion & Recommendation ───────────────────────────────

function ConclusionPage({
  subject,
  history,
  dcf,
  comps,
  bv,
  scenarios,
  football,
  adjusted,
  synergyNpv,
  peerSet,
}: {
  subject: Company
  history: FinancialHistory
  dcf: DcfResult
  comps: ComparableResult[]
  bv: BookValueResult
  scenarios: Array<{ label: string; equityValue: number; upsidePct: number; assumptions: ReturnType<typeof defaultDcfAssumptions> }>
  football: FootballFieldBar[]
  adjusted: CompanyAdjustedMetrics
  synergyNpv: number
  peerSet: PeerSet
}) {
  const mktcap = subject.mktcap
  const peerAvgEvEb = peerSet.peers.length > 0
    ? peerSet.peers.reduce((s, p) => s + p.ev_eb, 0) / peerSet.peers.filter(p => p.ev_eb > 0).length
    : null
  const peerAvgMargin = peerSet.peers.length > 0
    ? peerSet.peers.reduce((s, p) => s + p.ebm, 0) / peerSet.peers.length
    : null

  // Valuation range from football field
  const ffMin = Math.min(...football.filter(b => b.low > 0).map(b => b.low))
  const ffMax = Math.max(...football.filter(b => b.high > 0).map(b => b.high))
  const ffMid = football.length > 0 ? football.reduce((s, b) => s + (b.low + b.high) / 2, 0) / football.length : 0

  // Recommendation logic
  const acqScore = adjusted.hasAdjustment ? adjusted.post.acqs : subject.acqs
  const recommendation = acqScore >= 8.5 ? 'STRONG BUY' : acqScore >= 7 ? 'BUY' : acqScore >= 5.5 ? 'CONSIDER' : acqScore >= 4 ? 'MONITOR' : 'PASS'
  const recColor = recommendation === 'STRONG BUY' || recommendation === 'BUY' ? 'var(--green)' : recommendation === 'CONSIDER' ? 'var(--gold)' : recommendation === 'MONITOR' ? 'var(--gold-2)' : 'var(--red)'

  // Key valuation points
  const bearVal = scenarios.find(s => s.label === 'Bear')?.equityValue ?? 0
  const baseVal = scenarios.find(s => s.label === 'Base')?.equityValue ?? dcf.equityValue
  const bullVal = scenarios.find(s => s.label === 'Bull')?.equityValue ?? 0

  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Conclusion &amp; Recommendation" pageNum="12" />
      <span className="dn-eyebrow">Investment Conclusion — Valuation Summary &amp; Recommendation</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        Conclusion &amp; Valuation Range
      </h2>
      <hr className="dn-rule" />

      {/* Recommendation Banner */}
      <div className="verdict-box" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="verdict-header">Recommendation</div>
            <div className="verdict-rating" style={{ color: recColor }}>{recommendation}</div>
            <div className="verdict-sub">Acquisition Score: {acqScore.toFixed(1)} / 10 · {subject.acqf}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Implied Valuation Range</div>
            <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 20, fontWeight: 700, color: 'var(--ink)' }}>
              {formatCr(Math.round(ffMin))} – {formatCr(Math.round(ffMax))}
            </div>
            <div style={{ fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
              Current Market Cap: {formatCr(mktcap)} · {dcf.upsideVsMarketCap >= 0 ? '+' : ''}{dcf.upsideVsMarketCap.toFixed(1)}% DCF upside
            </div>
          </div>
        </div>
      </div>

      {/* Key Valuation Summary Table */}
      <h3 className="dn-h3" style={{ marginBottom: 6 }}>Valuation Summary</h3>
      <table className="dn-table compact" style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th>Method</th>
            <th className="num">Low</th>
            <th className="num">Mid / Base</th>
            <th className="num">High</th>
            <th className="num">vs Market Cap</th>
            <th>Conditions</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="label">DCF (5-Year Explicit + Terminal)</td>
            <td className="num mono">{formatCr(bearVal)}</td>
            <td className="num mono" style={{ fontWeight: 700 }}>{formatCr(baseVal)}</td>
            <td className="num mono">{formatCr(bullVal)}</td>
            <td className={`num mono ${dcf.upsideVsMarketCap >= 0 ? 'dn-pos' : 'dn-neg'}`}>{dcf.upsideVsMarketCap >= 0 ? '+' : ''}{dcf.upsideVsMarketCap.toFixed(1)}%</td>
            <td style={{ fontSize: 8 }}>WACC {(dcf.assumptions.wacc * 100).toFixed(1)}%, Terminal growth {(dcf.assumptions.terminalGrowth * 100).toFixed(1)}%</td>
          </tr>
          {comps.map(c => (
            <tr key={c.method}>
              <td className="label">{c.method}</td>
              <td className="num mono">{formatCr(c.equityLow)}</td>
              <td className="num mono" style={{ fontWeight: 700 }}>{formatCr(c.equityMedian)}</td>
              <td className="num mono">{formatCr(c.equityHigh)}</td>
              <td className={`num mono ${c.upsidePctMedian >= 0 ? 'dn-pos' : 'dn-neg'}`}>{c.upsidePctMedian >= 0 ? '+' : ''}{c.upsidePctMedian.toFixed(1)}%</td>
              <td style={{ fontSize: 8 }}>Peer Q1–Q3 range applied to subject base metric</td>
            </tr>
          ))}
          <tr>
            <td className="label">Book Value × Premium</td>
            <td className="num mono">{formatCr(Math.round(bv.equityValue * 0.9))}</td>
            <td className="num mono" style={{ fontWeight: 700 }}>{formatCr(bv.equityValue)}</td>
            <td className="num mono">{formatCr(Math.round(bv.equityValue * 1.1))}</td>
            <td className={`num mono ${bv.upsidePct >= 0 ? 'dn-pos' : 'dn-neg'}`}>{bv.upsidePct >= 0 ? '+' : ''}{bv.upsidePct.toFixed(1)}%</td>
            <td style={{ fontSize: 8 }}>1.25× strategic premium on book value</td>
          </tr>
          {synergyNpv > 0 && (
            <tr className="subtotal">
              <td className="label">Standalone + Synergy</td>
              <td className="num mono">{formatCr(baseVal)}</td>
              <td className="num mono" style={{ fontWeight: 700 }}>{formatCr(Math.round(baseVal + synergyNpv))}</td>
              <td className="num mono">{formatCr(Math.round(bullVal + synergyNpv))}</td>
              <td className="num mono dn-pos">+{((synergyNpv / mktcap) * 100).toFixed(1)}%</td>
              <td style={{ fontSize: 8 }}>Revenue (3%) + cost (1.5%) synergies at 30% realisation</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Key Investment Factors Table */}
      <h3 className="dn-h3" style={{ marginBottom: 6 }}>Key Investment Factors</h3>
      <table className="dn-table compact" style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th>Factor</th>
            <th>Assessment</th>
            <th>Value / Evidence</th>
            <th>Signal</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="label">Revenue Scale</td>
            <td style={{ fontSize: 9 }}>{subject.rev > 5000 ? 'Large-scale operations with market leadership' : subject.rev > 1000 ? 'Mid-scale with growth headroom' : 'Early-stage, high growth potential'}</td>
            <td className="num mono">₹{subject.rev.toLocaleString('en-IN')} Cr</td>
            <td><span className={`flag flag-${subject.rev > 1000 ? 'green' : 'amber'}`} style={{ fontSize: 9 }}>{subject.rev > 1000 ? 'Strong' : 'Adequate'}</span></td>
          </tr>
          <tr>
            <td className="label">Revenue Growth</td>
            <td style={{ fontSize: 9 }}>{subject.revg > 20 ? 'Above-average growth driven by demand tailwinds and capacity expansion' : subject.revg > 10 ? 'Steady growth in line with sector expansion' : 'Modest growth — investigate competitive dynamics'}</td>
            <td className="num mono">{subject.revg}%</td>
            <td><span className={`flag flag-${subject.revg > 15 ? 'green' : subject.revg > 5 ? 'amber' : 'red'}`} style={{ fontSize: 9 }}>{subject.revg > 15 ? 'Strong' : subject.revg > 5 ? 'Adequate' : 'Weak'}</span></td>
          </tr>
          <tr>
            <td className="label">EBITDA Margin</td>
            <td style={{ fontSize: 9 }}>{subject.ebm > 15 ? 'Strong operating leverage — pricing power and cost efficiency confirmed' : subject.ebm > 8 ? 'Adequate margin with room for operational improvement' : 'Thin margin — limited buffer for cost absorption'}</td>
            <td className="num mono">{subject.ebm}%</td>
            <td><span className={`flag flag-${subject.ebm > 15 ? 'green' : subject.ebm > 8 ? 'amber' : 'red'}`} style={{ fontSize: 9 }}>{subject.ebm > 15 ? 'Strong' : subject.ebm > 8 ? 'Adequate' : 'Weak'}</span></td>
          </tr>
          <tr>
            <td className="label">Balance Sheet</td>
            <td style={{ fontSize: 9 }}>{subject.dbt_eq < 0.5 ? 'Conservative leverage — significant acquisition debt capacity' : subject.dbt_eq < 1.0 ? 'Manageable leverage within sector norms' : 'Elevated leverage — debt servicing requires monitoring'}</td>
            <td className="num mono">{subject.dbt_eq}× D/E</td>
            <td><span className={`flag flag-${subject.dbt_eq < 0.5 ? 'green' : subject.dbt_eq < 1.0 ? 'amber' : 'red'}`} style={{ fontSize: 9 }}>{subject.dbt_eq < 0.5 ? 'Strong' : subject.dbt_eq < 1.0 ? 'Adequate' : 'Weak'}</span></td>
          </tr>
          <tr>
            <td className="label">Valuation Multiple</td>
            <td style={{ fontSize: 9 }}>{subject.ev_eb < 15 ? 'Attractively valued relative to growth profile' : subject.ev_eb < 25 ? `Trading at ${peerAvgEvEb ? (subject.ev_eb > peerAvgEvEb ? 'a premium' : 'a discount') + ' to peer median' : 'moderate levels'}` : 'Premium valuation — high growth expectations embedded'}</td>
            <td className="num mono">{subject.ev_eb}× EV/EBITDA</td>
            <td><span className={`flag flag-${subject.ev_eb < 15 ? 'green' : subject.ev_eb < 30 ? 'amber' : 'red'}`} style={{ fontSize: 9 }}>{subject.ev_eb < 15 ? 'Attractive' : subject.ev_eb < 30 ? 'Fair' : 'Premium'}</span></td>
          </tr>
          <tr>
            <td className="label">vs Peer Group</td>
            <td style={{ fontSize: 9 }}>{peerAvgMargin ? (subject.ebm > peerAvgMargin ? `Margin ${(subject.ebm - peerAvgMargin).toFixed(1)}pp above peer average — operational superiority` : `Margin ${(peerAvgMargin - subject.ebm).toFixed(1)}pp below peer average — room for improvement`) : 'Peer comparison pending'}</td>
            <td className="num mono">{peerSet.peers.length} peers</td>
            <td><span className={`flag flag-${peerAvgMargin && subject.ebm > peerAvgMargin ? 'green' : 'amber'}`} style={{ fontSize: 9 }}>{peerAvgMargin && subject.ebm > peerAvgMargin ? 'Above' : 'Below'}</span></td>
          </tr>
          {history.cagrs.revenueCagrPct !== null && (
            <tr>
              <td className="label">Growth Track Record</td>
              <td style={{ fontSize: 9 }}>{history.cagrs.revenueCagrPct > 15 ? `${history.cagrs.revenueCagrPct.toFixed(1)}% CAGR over ${history.yearsOfHistory} years confirms structural, not cyclical, growth trajectory` : `${history.cagrs.revenueCagrPct.toFixed(1)}% CAGR over ${history.yearsOfHistory} years — steady but not exceptional`}</td>
              <td className="num mono">{history.cagrs.revenueCagrPct.toFixed(1)}% CAGR</td>
              <td><span className={`flag flag-${history.cagrs.revenueCagrPct > 15 ? 'green' : 'amber'}`} style={{ fontSize: 9 }}>{history.cagrs.revenueCagrPct > 15 ? 'Strong' : 'Adequate'}</span></td>
            </tr>
          )}
          {adjusted.hasAdjustment && (
            <tr>
              <td className="label">News Impact</td>
              <td style={{ fontSize: 9 }}>{adjusted.deltaPct.acqs > 0 ? 'Recent news flow is net positive — acquisition score adjusted upward' : 'Recent news flow introduces caution — monitor developments'}</td>
              <td className="num mono">{adjusted.deltaPct.acqs >= 0 ? '+' : ''}{adjusted.deltaPct.acqs.toFixed(1)}% on acq score</td>
              <td><span className={`flag flag-${adjusted.deltaPct.acqs >= 0 ? 'green' : 'red'}`} style={{ fontSize: 9 }}>{adjusted.deltaPct.acqs >= 0 ? 'Positive' : 'Caution'}</span></td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Scenario-Based Valuation Range */}
      <h3 className="dn-h3" style={{ marginBottom: 6 }}>Valuation Under Different Conditions</h3>
      <table className="dn-table compact" style={{ marginBottom: 12 }}>
        <thead>
          <tr>
            <th>Scenario</th>
            <th className="num">Equity Value</th>
            <th className="num">vs Market</th>
            <th>Key Condition</th>
            <th>When This Applies</th>
          </tr>
        </thead>
        <tbody>
          <tr style={{ background: 'var(--green-soft)' }}>
            <td className="label" style={{ fontWeight: 700, color: 'var(--green)' }}>Bull Case</td>
            <td className="num mono" style={{ fontWeight: 700 }}>{formatCr(bullVal)}</td>
            <td className="num mono dn-pos">{bullVal > mktcap ? '+' : ''}{((bullVal - mktcap) / mktcap * 100).toFixed(1)}%</td>
            <td style={{ fontSize: 8 }}>Revenue growth +3pp, margin +2pp, WACC -50bps</td>
            <td style={{ fontSize: 8 }}>Policy tailwinds materialise, capacity ramp succeeds, input costs decline</td>
          </tr>
          <tr>
            <td className="label" style={{ fontWeight: 700, color: 'var(--gold-2)' }}>Base Case</td>
            <td className="num mono" style={{ fontWeight: 700 }}>{formatCr(baseVal)}</td>
            <td className={`num mono ${dcf.upsideVsMarketCap >= 0 ? 'dn-pos' : 'dn-neg'}`}>{dcf.upsideVsMarketCap >= 0 ? '+' : ''}{dcf.upsideVsMarketCap.toFixed(1)}%</td>
            <td style={{ fontSize: 8 }}>Current growth and margin trajectory sustained</td>
            <td style={{ fontSize: 8 }}>No major policy changes, market conditions remain stable</td>
          </tr>
          <tr style={{ background: 'var(--red-soft)' }}>
            <td className="label" style={{ fontWeight: 700, color: 'var(--red)' }}>Bear Case</td>
            <td className="num mono" style={{ fontWeight: 700 }}>{formatCr(bearVal)}</td>
            <td className={`num mono ${bearVal > mktcap ? 'dn-pos' : 'dn-neg'}`}>{bearVal > mktcap ? '+' : ''}{((bearVal - mktcap) / mktcap * 100).toFixed(1)}%</td>
            <td style={{ fontSize: 8 }}>Revenue growth -3pp, margin -2pp, WACC +50bps</td>
            <td style={{ fontSize: 8 }}>Demand slowdown, import competition intensifies, cost inflation</td>
          </tr>
          {synergyNpv > 0 && (
            <tr style={{ borderTop: '2px solid var(--rule)' }}>
              <td className="label" style={{ fontWeight: 700, color: 'var(--ink)' }}>With Synergies</td>
              <td className="num mono" style={{ fontWeight: 700 }}>{formatCr(Math.round(baseVal + synergyNpv))}</td>
              <td className="num mono dn-pos">+{(((baseVal + synergyNpv) - mktcap) / mktcap * 100).toFixed(1)}%</td>
              <td style={{ fontSize: 8 }}>Revenue synergy 3%, cost synergy 1.5%</td>
              <td style={{ fontSize: 8 }}>Acquirer has overlapping customers/operations for synergy realisation</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Final Conclusion Narrative */}
      <div className="dn-strategy-card gold-border">
        <div className="card-title">Investment Conclusion</div>
        <p style={{ margin: '4px 0', fontSize: 9.5, lineHeight: 1.7 }}>
          Based on a comprehensive analysis across {history.yearsOfHistory} years of financial history, multi-method valuation triangulation, peer benchmarking against {peerSet.peers.length} comparable companies, and strategic fit assessment, <strong>{subject.name} ({subject.ticker})</strong> receives a <strong style={{ color: recColor }}>{recommendation}</strong> recommendation with an acquisition score of <strong>{acqScore.toFixed(1)}/10</strong>.
        </p>
        <p style={{ margin: '4px 0', fontSize: 9.5, lineHeight: 1.7 }}>
          The implied equity valuation range of <strong>{formatCr(Math.round(ffMin))} – {formatCr(Math.round(ffMax))}</strong> across all methods suggests
          {dcf.upsideVsMarketCap > 10 ? ` significant upside of ${dcf.upsideVsMarketCap.toFixed(1)}% versus the current market capitalisation of ${formatCr(mktcap)}, indicating the market has not yet fully priced in the company's growth potential and strategic value.`
           : dcf.upsideVsMarketCap > 0 ? ` modest upside of ${dcf.upsideVsMarketCap.toFixed(1)}% versus current market cap, with additional synergy potential of ${formatCr(Math.round(Math.max(0, synergyNpv)))} for a strategic acquirer.`
           : ` the current market price broadly reflects intrinsic value. An acquisition at current levels would need to be justified by strategic synergies (estimated NPV: ${formatCr(Math.round(Math.max(0, synergyNpv)))}) or control premium considerations.`}
        </p>
        <p style={{ margin: '4px 0', fontSize: 9.5, lineHeight: 1.7 }}>
          <strong>Key conditions for the valuation range:</strong> The base case assumes {(dcf.assumptions.startingGrowth * 100).toFixed(0)}% starting revenue growth fading to {(dcf.assumptions.endingGrowth * 100).toFixed(0)}% over 5 years, EBITDA margin of {(dcf.assumptions.startingEbitdaMargin * 100).toFixed(0)}%, and WACC of {(dcf.assumptions.wacc * 100).toFixed(1)}%. The bull case requires policy tailwinds (PLI/ALMM benefits) and successful capacity expansion. The bear case assumes demand moderation and margin compression from competitive pressure.
        </p>
      </div>
      <PageFooter />
    </section>
  )
}

function AppendixPage({
  subject,
  history,
  dcf,
}: {
  subject: Company
  history: FinancialHistory
  dcf: DcfResult
}) {
  const a = dcf.assumptions
  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Appendix &amp; Disclosures" pageNum="13" />
      <span className="dn-eyebrow">Appendix — Assumptions, Sources, Disclosures</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        DCF Assumption Set
      </h2>
      <hr className="dn-rule" />
      <table className="dn-table compact">
        <thead>
          <tr>
            <th>Driver</th>
            <th className="num">Value</th>
            <th>Rationale</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="label">Forecast Horizon</td>
            <td className="num mono">{a.years} years</td>
            <td>Standard explicit forecast period for a mature operating business.</td>
          </tr>
          <tr>
            <td className="label">Starting Revenue Growth</td>
            <td className="num mono">{(a.startingGrowth * 100).toFixed(1)}%</td>
            <td>Anchored to trailing growth with cap at 35%.</td>
          </tr>
          <tr>
            <td className="label">Terminal Revenue Growth</td>
            <td className="num mono">{(a.endingGrowth * 100).toFixed(1)}%</td>
            <td>Linear fade from starting growth, floor at 3%.</td>
          </tr>
          <tr>
            <td className="label">Starting EBITDA Margin</td>
            <td className="num mono">{(a.startingEbitdaMargin * 100).toFixed(1)}%</td>
            <td>From most recent reported period.</td>
          </tr>
          <tr>
            <td className="label">Terminal EBITDA Margin</td>
            <td className="num mono">{(a.terminalEbitdaMargin * 100).toFixed(1)}%</td>
            <td>Steady-state margin assumption; cap at 25%.</td>
          </tr>
          <tr>
            <td className="label">Effective Tax Rate</td>
            <td className="num mono">{(a.taxRate * 100).toFixed(1)}%</td>
            <td>India corporate tax regime baseline.</td>
          </tr>
          <tr>
            <td className="label">D&A / Revenue</td>
            <td className="num mono">{(a.daPctOfRevenue * 100).toFixed(1)}%</td>
            <td>Capital-intensive manufacturing benchmark.</td>
          </tr>
          <tr>
            <td className="label">CapEx / Revenue</td>
            <td className="num mono">{(a.capexPctOfRevenue * 100).toFixed(1)}%</td>
            <td>Sector-median steady-state CapEx intensity.</td>
          </tr>
          <tr>
            <td className="label">ΔNWC / ΔRevenue</td>
            <td className="num mono">{(a.nwcPctOfIncrementalRevenue * 100).toFixed(1)}%</td>
            <td>Working-capital investment ratio per new rupee of sales.</td>
          </tr>
          <tr>
            <td className="label">WACC</td>
            <td className="num mono">{(a.wacc * 100).toFixed(2)}%</td>
            <td>Sector-adjusted cost of capital (Solar 11.5% / T&D 12.0%).</td>
          </tr>
          <tr>
            <td className="label">Terminal Growth (g)</td>
            <td className="num mono">{(a.terminalGrowth * 100).toFixed(1)}%</td>
            <td>Long-run nominal GDP-anchored growth rate.</td>
          </tr>
        </tbody>
      </table>

      <h2 className="dn-h2" style={{ marginTop: 14, marginBottom: 10 }}>
        Data Sources
      </h2>
      <hr className="dn-rule" />
      <table className="dn-table compact">
        <thead>
          <tr>
            <th>Source</th>
            <th>Coverage</th>
            <th>Notes</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="label">NSE/BSE · Indian Stock Exchange</td>
            <td>Multi-year annual reports for NSE / BSE listings</td>
            <td>Up to 6 annual + 8 interim periods; income / balance / cash flow line items.</td>
          </tr>
          <tr>
            <td className="label">DealNector Coverage Universe</td>
            <td>Curated company snapshot (55+ listed, 28 private)</td>
            <td>Market-cap weighted acquisition scores and value-chain tagging.</td>
          </tr>
          <tr>
            <td className="label">Google News RSS + PV Magazine</td>
            <td>Live news flow, categorized by sentiment + materiality</td>
            <td>India + global editions, deduped and ranked latest-first.</td>
          </tr>
          <tr>
            <td className="label">SEBI (SAST) Regulations, 2011</td>
            <td>Takeover code, open offer requirements</td>
            <td>Source: <a href="https://www.sebi.gov.in" className="dn-source-link" target="_blank" rel="noopener">sebi.gov.in</a> — Reg. 3, 4, 5, 8</td>
          </tr>
          <tr>
            <td className="label">Competition Act, 2002 (CCI)</td>
            <td>Merger control, HHI thresholds</td>
            <td>Source: <a href="https://www.cci.gov.in" className="dn-source-link" target="_blank" rel="noopener">cci.gov.in</a> — Sections 5 &amp; 6</td>
          </tr>
          <tr>
            <td className="label">MNRE / Ministry of Power</td>
            <td>Solar, grid, and energy policy schemes</td>
            <td>PLI, ALMM, BCD, RDSS, GEC, NEP-2032, KUSUM, PMSGMBY</td>
          </tr>
        </tbody>
      </table>
      <div className="dn-narrative" style={{ marginTop: 12 }}>
        <p className="callout">
          <strong>Disclaimer.</strong> This report is generated by DealNector's automated
          analysis pipeline. Values are heuristic and provided for institutional due-diligence
          triage, not as investment advice. Independent verification of all numbers against the
          company's filed annual reports is required prior to any capital commitment.
        </p>
        <p className="dn-mutedtxt" style={{ fontSize: 9 }}>
          Report generated {new Date().toLocaleString('en-IN')} · DealNector Institutional
          Intelligence Terminal · {subject.ticker} · History source:{' '}
          {history.source === 'rapidapi' ? 'RapidAPI' : 'Internal snapshot'} (
          {history.yearsOfHistory} yrs)
        </p>
      </div>
      <PageFooter />
    </section>
  )
}
