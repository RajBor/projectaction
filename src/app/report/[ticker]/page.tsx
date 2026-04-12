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

  const subject = useMemo<Company | null>(
    () => COMPANIES.find((c) => c.ticker === ticker) || null,
    [ticker]
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

  const dcf: DcfResult = useMemo(() => runDcf(subject, defaultDcfAssumptions(subject)), [subject])
  const comps: ComparableResult[] = useMemo(() => runComparables(subject, peers), [subject, peers])
  const bv: BookValueResult = useMemo(() => runBookValue(subject, 1.25), [subject])
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

  // Bull / Base / Bear scenarios
  const scenarios = useMemo(() => {
    const base = defaultDcfAssumptions(subject)
    const bull = { ...base, startingGrowth: base.startingGrowth + 0.03, startingEbitdaMargin: base.startingEbitdaMargin + 0.02, wacc: base.wacc - 0.005 }
    const bear = { ...base, startingGrowth: Math.max(0.01, base.startingGrowth - 0.03), startingEbitdaMargin: Math.max(0.02, base.startingEbitdaMargin - 0.02), wacc: base.wacc + 0.005 }
    return [bull, base, bear].map((a, i) => {
      const r = runDcf(subject, a)
      return { label: ['Bull','Base','Bear'][i], equityValue: r.equityValue, upsidePct: r.upsideVsMarketCap, assumptions: a }
    })
  }, [subject])

  // Synergy NPV estimate
  const synergyNpv = useMemo(() => {
    const rs = subject.rev * 0.03  // 3% revenue synergy
    const cs = subject.ebitda * 0.015  // 1.5% cost synergy
    const ic = subject.mktcap * 0.03  // 3% integration cost
    return (rs * 0.3 + cs) * 7 - ic  // NPV over 7 years at 30% realisation
  }, [subject])

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
      <ValuationMethodsPage subject={subject} dcf={dcf} comps={comps} bv={bv} />
      <IndustryPolicyPage subject={subject} chainNodes={subjectChainNodes} segmentCompanies={segmentCompanies} />
      <PeerComparisonPage subject={subject} peerSet={peerSet} peers={peers} />
      <ShareholdingAcquisitionPage subject={subject} hhi={hhi} dcf={dcf} synergyNpv={synergyNpv} />
      <FootballFieldPage subject={subject} football={football} />
      <SensitivityScenarioPage subject={subject} sensitivityMatrix={sensitivityMatrix} scenarios={scenarios} dcf={dcf} />
      <NewsImpactPage subject={subject} adjusted={autoAdjusted} highMatNews={highMatNews} newsAgg={newsAgg} chainNodes={subjectChainNodes} />
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
    <section className="dn-page dn-cover">
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
            <div className="value">{subject.acqs.toFixed(1)}/10</div>
            <div className="sub">{subject.acqf}</div>
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
      <PageHeader subject={subject} section="Valuation Methods" pageNum="04" />
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
      <PageHeader subject={subject} section="Peer Comparison" pageNum="06" />
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
      <PageHeader subject={subject} section="Football Field" pageNum="08" />
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
      <PageHeader subject={subject} section="News &amp; Policy Impact" pageNum="10" />
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
    <section className="dn-page">
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
      <PageHeader subject={subject} section="Industry &amp; Policy" pageNum="05" />
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
      <PageHeader subject={subject} section="Acquisition Strategy" pageNum="07" />
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
          {/* Estimated breakdown strip */}
          <div className="dn-stacked-bar">
            <div className="band navy" style={{ width: '55%' }}>Promoter 55%</div>
            <div className="band gold" style={{ width: '15%' }}>FII 15%</div>
            <div className="band green" style={{ width: '12%' }}>DII 12%</div>
            <div className="band muted" style={{ width: '18%' }}>Public 18%</div>
          </div>
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
    <section className="dn-page">
      <PageHeader subject={subject} section="Sensitivity &amp; Scenarios" pageNum="09" />
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
      <PageHeader subject={subject} section="Appendix &amp; Disclosures" pageNum="11" />
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
