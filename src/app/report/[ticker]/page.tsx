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
import { computeAdjustedMetrics } from '@/lib/news/adjustments'

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
    if (!newsAgg) return { positive: [], negative: [] }
    const pos = newsAgg.items
      .filter((n) => n.impact.materiality === 'high' && n.impact.sentiment === 'positive')
      .slice(0, 3)
    const neg = newsAgg.items
      .filter((n) => n.impact.materiality === 'high' && n.impact.sentiment === 'negative')
      .slice(0, 3)
    return { positive: pos, negative: neg }
  }, [newsAgg])

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
        adjusted={adjusted}
        loadingProfile={loadingProfile}
      />
      <FinancialAnalysisPage subject={subject} history={history} profileErr={profileErr} />
      <ValuationMethodsPage subject={subject} dcf={dcf} comps={comps} bv={bv} />
      <PeerComparisonPage subject={subject} peerSet={peerSet} peers={peers} />
      <FootballFieldPage subject={subject} football={football} />
      <NewsImpactPage subject={subject} adjusted={adjusted} highMatNews={highMatNews} newsAgg={newsAgg} />
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
        {history.source === 'rapidapi' ? 'RapidAPI Annual Reports' : 'Internal snapshot'}
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
                Note: multi-year RapidAPI history still loading — figures may update when
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
            Note: live RapidAPI fetch returned: <em>{profileErr}</em>. The figures above fall
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
      <PageHeader subject={subject} section="Valuation Methods" pageNum="03" />
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
      <PageHeader subject={subject} section="Peer Comparison" pageNum="04" />
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
      <PageHeader subject={subject} section="Football Field" pageNum="05" />
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
}: {
  subject: Company
  adjusted: ReturnType<typeof computeAdjustedMetrics>
  highMatNews: { positive: CompanyNewsAggregate['items']; negative: CompanyNewsAggregate['items'] }
  newsAgg: CompanyNewsAggregate | null
}) {
  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="News Impact" pageNum="06" />
      <span className="dn-eyebrow">News Impact on Valuation</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        High-Materiality News — Effect on {subject.ticker} Metrics
      </h2>
      <hr className="dn-rule" />

      <table className="dn-table compact" style={{ marginBottom: 14 }}>
        <thead>
          <tr>
            <th>Metric</th>
            <th className="num">Pre-News</th>
            <th className="num">Post-News</th>
            <th className="num">Δ Absolute</th>
            <th className="num">Δ %</th>
          </tr>
        </thead>
        <tbody>
          <PrePostRow label="Acquisition Score" pre={adjusted.pre.acqs} post={adjusted.post.acqs} suffix="/10" />
          <PrePostRow label="EV / EBITDA" pre={adjusted.pre.ev_eb} post={adjusted.post.ev_eb} suffix="×" />
          <PrePostRow label="Revenue Growth" pre={adjusted.pre.revg} post={adjusted.post.revg} suffix="%" />
          <PrePostRow label="EBITDA Margin" pre={adjusted.pre.ebm} post={adjusted.post.ebm} suffix="%" />
          <PrePostRow label="Enterprise Value" pre={adjusted.pre.ev} post={adjusted.post.ev} suffix=" Cr" />
        </tbody>
      </table>
      <div className="dn-narrative" style={{ marginBottom: 12 }}>
        {adjusted.hasAdjustment ? (
          <p>
            <strong>{adjusted.acknowledgedCount}</strong> acknowledged news item
            {adjusted.acknowledgedCount === 1 ? '' : 's'} are currently folded into the metrics
            above. Remove acknowledgement in the News Hub to revert any item to baseline.
          </p>
        ) : (
          <p className="dn-mutedtxt" style={{ fontStyle: 'italic' }}>
            No acknowledged news items are currently affecting valuation. The pre-news metrics
            equal the post-news metrics. Use the News Hub ⚙ Impact button on any item to apply
            its effect.
          </p>
        )}
      </div>

      <div className="dn-two-col">
        <div>
          <h3 className="dn-h3" style={{ marginBottom: 6 }}>
            ▲ Positive High-Materiality Signals
          </h3>
          <hr className="dn-rule" />
          <div className="dn-news-list">
            {highMatNews.positive.length === 0 ? (
              <div className="dn-mutedtxt" style={{ fontSize: 9, fontStyle: 'italic' }}>
                No positive high-materiality news detected for {subject.ticker}.
              </div>
            ) : (
              highMatNews.positive.map((n, i) => (
                <div className="dn-news-card pos" key={i}>
                  <span className="pill">POS</span>
                  <div className="body">
                    <div className="headline">{n.item.title}</div>
                    <div className="meta">
                      {n.item.source || 'Source'} · {n.item.pubDate?.slice(0, 10) || ''} · ◆{' '}
                      {n.impact.category} · {n.impact.materiality}
                    </div>
                  </div>
                  <div className="delta">
                    {n.impact.multipleDeltaPct >= 0 ? '+' : ''}
                    {n.impact.multipleDeltaPct.toFixed(2)}%
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        <div>
          <h3 className="dn-h3" style={{ marginBottom: 6 }}>
            ▼ Negative High-Materiality Signals
          </h3>
          <hr className="dn-rule" />
          <div className="dn-news-list">
            {highMatNews.negative.length === 0 ? (
              <div className="dn-mutedtxt" style={{ fontSize: 9, fontStyle: 'italic' }}>
                No negative high-materiality news detected for {subject.ticker}.
              </div>
            ) : (
              highMatNews.negative.map((n, i) => (
                <div className="dn-news-card neg" key={i}>
                  <span className="pill">NEG</span>
                  <div className="body">
                    <div className="headline">{n.item.title}</div>
                    <div className="meta">
                      {n.item.source || 'Source'} · {n.item.pubDate?.slice(0, 10) || ''} · ◆{' '}
                      {n.impact.category} · {n.impact.materiality}
                    </div>
                  </div>
                  <div className="delta">
                    {n.impact.multipleDeltaPct.toFixed(2)}%
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {newsAgg && newsAgg.items.length > 0 && (
        <div className="dn-narrative" style={{ marginTop: 12 }}>
          <p className="dn-mutedtxt" style={{ fontSize: 9 }}>
            Showing up to 3 items per sentiment bucket. A total of {newsAgg.count} impact
            signal{newsAgg.count === 1 ? '' : 's'} have been detected for {subject.ticker} in
            the current news feed window. Average sentiment:{' '}
            {newsAgg.avgSentimentScore >= 0 ? '+' : ''}
            {newsAgg.avgSentimentScore.toFixed(1)}.
          </p>
        </div>
      )}
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
      <PageHeader subject={subject} section="Appendix & Disclosures" pageNum="07" />
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
            <td className="label">RapidAPI · Indian Stock Exchange</td>
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
