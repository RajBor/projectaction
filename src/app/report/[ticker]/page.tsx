'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { COMPANIES, type Company } from '@/lib/data/companies'
import { stockQuote, tickerToApiName, type StockProfile } from '@/lib/stocks/api'
import { buildFinancialHistory, formatCr, formatPct, formatRatio, type FinancialHistory } from '@/lib/valuation/history'
import { findPeers, computePeerStats, formatPeerValue, derivePeerRatios, type PeerSet, type PeerStats } from '@/lib/valuation/peers'
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
import { aggregateImpactByCompany, type CompanyNewsAggregate } from '@/lib/news/impact'
import { computeAdjustedMetrics, type CompanyAdjustedMetrics } from '@/lib/news/adjustments'
import { CHAIN, type ChainNode } from '@/lib/data/chain'
import { getSubSegmentLabel } from '@/lib/data/sub-segments'
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
 * Route: /report/[ticker]?print=1&public=1&src=landing
 *
 * Loads a company by ticker, assembles multi-year financials from
 * RapidAPI (with graceful fallback to the Company snapshot), runs
 * DCF + comparables + book-value methods, pulls peer statistics, and
 * renders a consulting-grade report that prints to PDF cleanly.
 *
 * ── Public mode (public=1) ──────────────────────────────────────
 * Landing-page visitors who pick a company from the hero picker are
 * routed straight here with `?public=1`. In that mode we:
 *   • skip the RapidAPI `stockQuote` call entirely (cost + quota),
 *   • render every section from the static Company snapshot only,
 *   • tweak the PrintToolbar "Back" button to return to '/' (the
 *     landing page) when the visitor isn't signed in, or behave
 *     like normal history.back() when they are.
 *
 * This route itself is NOT auth-gated (unlike everything under
 * (dashboard)/), so the public visitor flow works without login.
 */

export default function ReportPage() {
  const params = useParams<{ ticker: string }>()
  const searchParams = useSearchParams()
  const ticker = String(params?.ticker || '').toUpperCase()
  const autoPrint = searchParams.get('print') === '1'
  const publicMode = searchParams.get('public') === '1'

  // Resolve subject from the FULL live universe, not just the static
  // COMPANIES[] seed. A company added via admin /api/admin/publish-data
  // lives in user_companies (or industry_chain_companies / "atlas"), and
  // the previous `COMPANIES.find(...)` would miss them entirely — which
  // is why freshly-pushed SMEs were hitting "No company found" and the
  // entire report (including Company Details + Market Analysis) never
  // rendered. Using `allCompanies` makes the lookup cover: static seed
  // + user_companies DB rows + atlas chain rows, same as every other
  // page via the provider.
  const { mergeCompany, allCompanies } = useLiveSnapshot()
  const baseSubject = useMemo<Company | null>(
    () =>
      allCompanies.find((c) => c.ticker === ticker)
      ?? COMPANIES.find((c) => c.ticker === ticker)   // belt-and-braces
      ?? null,
    [ticker, allCompanies]
  )

  // Apply live NSE/Screener data to refresh market metrics + recomputed acq score
  const subject = useMemo<Company | null>(
    () => baseSubject ? mergeCompany(baseSubject) : null,
    [baseSubject, mergeCompany]
  )

  const [profile, setProfile] = useState<StockProfile | null>(null)
  const [loadingProfile, setLoadingProfile] = useState(true)
  const [profileErr, setProfileErr] = useState<string | null>(null)

  // Minimum display time for the processing screen.
  //
  // The report page runs a dozen synchronous analyses in useMemo hooks
  // (DCF, comparables, book-value, peer stats, football-field chart, etc).
  // They complete in a few hundred ms, but if we render the report shell
  // immediately the visitor SEES zeroes / placeholder rows fill in live —
  // which looks broken on first impression. We show a branded "processing"
  // screen for at least MIN_LOADING_MS so the report only reveals itself
  // once every number has settled. In authenticated mode we also wait on
  // the RapidAPI profile fetch; in public mode profile is skipped so the
  // timer is the only gate.
  const MIN_LOADING_MS = 1800
  const [minTimeElapsed, setMinTimeElapsed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMinTimeElapsed(true), MIN_LOADING_MS)
    return () => clearTimeout(t)
  }, [])

  // Fetch rapidapi profile for multi-year history (best-effort).
  //
  // In `public=1` mode (landing-page visitor) we deliberately SKIP
  // this RapidAPI call. RapidAPI has a paid quota that's reserved
  // for authenticated analysts; exposing it on the public landing
  // flow would let anonymous visitors burn our monthly budget. The
  // page still renders fully — every section has a graceful
  // single-snapshot fallback via `buildFinancialHistory(subject, null)`
  // that uses the Company row's last reported year as the anchor.
  useEffect(() => {
    if (!subject) {
      setLoadingProfile(false)
      return
    }
    if (publicMode) {
      setProfile(null)
      setLoadingProfile(false)
      setProfileErr(null)
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
  }, [subject, publicMode])

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

  // ── Gate: only reveal the report once everything is ready ──────
  //
  // `ready` means: subject resolved AND profile fetch (if any) settled
  // AND the minimum display time elapsed. That ensures the visitor sees
  // a stable, fully-populated report rather than partial numbers
  // flickering as each useMemo resolves. "No company found" only shows
  // once the min time has passed too, so we don't flash an error for a
  // ticker that's still being resolved from allCompanies.
  const ready = !!subject && !loadingProfile && minTimeElapsed

  if (!ready) {
    // While loading, prefer the subject name when we already have it —
    // it reassures the visitor they've landed on the right report.
    return (
      <ReportLoadingScreen
        subjectName={subject?.name || null}
        ticker={ticker}
        publicMode={publicMode}
        subjectMissing={!subject && minTimeElapsed}
      />
    )
  }

  // After ready: subject is guaranteed non-null by the gate above, but
  // keep the narrow runtime check for TS + defence in depth.
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
      publicMode={publicMode}
    />
  )
}

// ── Processing / loading screen ─────────────────────────────────
//
// Shown while the report page is pulling everything together: subject
// lookup, optional RapidAPI profile, peer stats, DCF run, comparables,
// football-field, news-impact overlay. We deliberately hold this up
// for ~1.8 seconds even on fast paths so public visitors experience a
// premium "we're preparing your report" feel rather than a jarring
// flash of half-populated numbers.
function ReportLoadingScreen({
  subjectName,
  ticker,
  publicMode,
  subjectMissing,
}: {
  subjectName: string | null
  ticker: string
  publicMode: boolean
  subjectMissing: boolean
}) {
  const steps = useMemo(
    () => [
      'Loading company profile…',
      'Assembling multi-year financial history…',
      'Running DCF and comparable transactions…',
      'Fetching peer comparables and valuation statistics…',
      'Rendering institutional report…',
    ],
    []
  )
  const [stepIdx, setStepIdx] = useState(0)
  useEffect(() => {
    const iv = setInterval(() => {
      setStepIdx((i) => (i + 1) % steps.length)
    }, 520)
    return () => clearInterval(iv)
  }, [steps.length])

  // If the min-time elapsed and there's still no subject, switch the
  // copy to a "not found" message — but keep the same shell so the
  // visitor doesn't see a jarring style change.
  if (subjectMissing) {
    return (
      <div style={wrapStyle}>
        <div style={cardStyle}>
          <div style={{ fontSize: 48, lineHeight: 1, marginBottom: 12 }}>⚠️</div>
          <div style={titleStyle}>Company not found</div>
          <div style={subStyle}>
            No company in our coverage universe matches ticker{' '}
            <code style={codeStyle}>{ticker}</code>. Please check the URL or
            return to the homepage.
          </div>
          <a href="/" style={backLinkStyle}>
            ← Back to DealNector
          </a>
        </div>
      </div>
    )
  }

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <div style={spinnerStyle} aria-hidden="true">
          <div style={spinnerInnerStyle} />
        </div>
        <div style={eyebrowStyle}>DealNector · Institutional Valuation</div>
        <div style={titleStyle}>
          Preparing report
          {subjectName ? (
            <>
              {' '}for{' '}
              <em style={{ color: '#C8A24B', fontStyle: 'normal' }}>
                {subjectName}
              </em>
            </>
          ) : null}
        </div>
        <div style={subStyle}>
          {steps.map((s, i) => (
            <div
              key={s}
              style={{
                opacity: i === stepIdx ? 1 : 0.35,
                transform: i === stepIdx ? 'translateX(0)' : 'translateX(-6px)',
                transition: 'opacity 260ms ease, transform 260ms ease',
                fontVariationSettings: '"wght" 450',
                padding: '3px 0',
              }}
            >
              {i === stepIdx ? '▸ ' : '  '}
              {s}
            </div>
          ))}
        </div>
        {publicMode ? (
          <div style={disclaimerStyle}>
            This is a public preview of the DealNector valuation engine.
            Numbers render from our static coverage snapshot and should not
            be used for any financial transaction or investment decision.
          </div>
        ) : (
          <div style={disclaimerStyle}>
            Pulling the latest financials and peer data — this takes a
            moment.
          </div>
        )}
      </div>
      <style>{`
        @keyframes dn-report-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

const wrapStyle: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 32,
  background:
    'radial-gradient(ellipse at 50% -20%, #1b2a4a 0%, #0b1628 55%, #050a14 100%)',
  fontFamily:
    '"Source Serif 4", "Source Serif Pro", Georgia, "Times New Roman", serif',
}

const cardStyle: React.CSSProperties = {
  maxWidth: 560,
  width: '100%',
  textAlign: 'center',
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(200,162,75,0.25)',
  borderRadius: 14,
  padding: '48px 40px 40px',
  boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
  color: '#E6EBF2',
}

const spinnerStyle: React.CSSProperties = {
  width: 64,
  height: 64,
  margin: '0 auto 28px',
  borderRadius: '50%',
  border: '3px solid rgba(200,162,75,0.15)',
  borderTopColor: '#C8A24B',
  animation: 'dn-report-spin 900ms linear infinite',
  position: 'relative',
}

const spinnerInnerStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 8,
  borderRadius: '50%',
  border: '2px solid rgba(200,162,75,0.08)',
  borderBottomColor: 'rgba(200,162,75,0.55)',
  animation: 'dn-report-spin 1400ms linear infinite reverse',
}

const eyebrowStyle: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: 2.4,
  textTransform: 'uppercase',
  color: '#9FB0C8',
  marginBottom: 10,
  fontFamily: '"Inter", system-ui, sans-serif',
}

const titleStyle: React.CSSProperties = {
  fontSize: 26,
  lineHeight: 1.25,
  marginBottom: 22,
  color: '#F4E7C8',
}

const subStyle: React.CSSProperties = {
  fontSize: 14.5,
  lineHeight: 1.55,
  color: '#C5D1E1',
  textAlign: 'left',
  maxWidth: 380,
  margin: '0 auto 22px',
  fontFamily: '"Inter", system-ui, sans-serif',
}

const disclaimerStyle: React.CSSProperties = {
  marginTop: 18,
  paddingTop: 18,
  borderTop: '1px solid rgba(200,162,75,0.15)',
  fontSize: 12,
  lineHeight: 1.5,
  color: '#8A98AE',
  fontFamily: '"Inter", system-ui, sans-serif',
}

const codeStyle: React.CSSProperties = {
  fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
  background: 'rgba(200,162,75,0.12)',
  border: '1px solid rgba(200,162,75,0.3)',
  borderRadius: 4,
  padding: '1px 6px',
  color: '#F4E7C8',
}

const backLinkStyle: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 14,
  color: '#C8A24B',
  textDecoration: 'none',
  fontFamily: '"Inter", system-ui, sans-serif',
  fontSize: 14,
  fontWeight: 500,
  border: '1px solid rgba(200,162,75,0.4)',
  borderRadius: 999,
  padding: '9px 22px',
}

// ── Inner component with all the memoized analysis ──────────────

function ReportBody({
  subject,
  profile,
  loadingProfile,
  profileErr,
  publicMode,
}: {
  subject: Company
  profile: StockProfile | null
  loadingProfile: boolean
  profileErr: string | null
  publicMode: boolean
}) {
  const history: FinancialHistory = useMemo(
    () => buildFinancialHistory(subject, profile),
    [subject, profile]
  )

  // Apply live NSE/Screener cascade to peers too, so their snapshot
  // ratios (mktcap, ev, pe, pb, revg, ebm, dbt_eq) reflect freshly-
  // fetched tier-1/tier-2 data rather than the static COMPANIES entry.
  const { mergeCompany } = useLiveSnapshot()
  const peerSet: PeerSet = useMemo(() => {
    const raw = findPeers(subject, COMPANIES, 5)
    return {
      ...raw,
      peers: raw.peers.map((p) => mergeCompany(p)),
    }
  }, [subject, mergeCompany])
  const peers: PeerStats = useMemo(() => computePeerStats(peerSet), [peerSet])

  // ── Background peer-history fetch ─────────────────────────────
  // For each peer, call stockQuote once to retrieve the same multi-year
  // financials bundle the subject uses. Cached in sessionStorage so
  // reopening the report doesn't re-fetch. Failures are silent — peers
  // that can't be fetched just fall back to the single-snapshot history.
  const [peerProfiles, setPeerProfiles] = useState<Record<string, StockProfile>>({})

  useEffect(() => {
    if (publicMode) return            // RapidAPI is off-limits for public visitors
    if (peerSet.peers.length === 0) return
    let cancelled = false
    const todo = peerSet.peers.filter((p) => !peerProfiles[p.ticker])
    if (todo.length === 0) return

    ;(async () => {
      const updates: Record<string, StockProfile> = {}
      for (const peer of todo) {
        if (cancelled) break
        // Session-cache check (avoids refetching across React re-renders
        // within the same browser tab).
        const cacheKey = `sg4_peer_profile_${peer.ticker}`
        try {
          const cached = sessionStorage.getItem(cacheKey)
          if (cached) {
            updates[peer.ticker] = JSON.parse(cached) as StockProfile
            continue
          }
        } catch { /* ignore */ }
        try {
          const res = await stockQuote(tickerToApiName(peer.ticker, peer.name), {})
          if (res.ok && res.data) {
            updates[peer.ticker] = res.data
            try {
              sessionStorage.setItem(cacheKey, JSON.stringify(res.data))
            } catch { /* quota / JSON errors ignored */ }
          }
        } catch { /* ignore — single-snapshot fallback applies */ }
      }
      if (!cancelled && Object.keys(updates).length > 0) {
        setPeerProfiles((prev) => ({ ...prev, ...updates }))
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [peerSet, publicMode])

  // Build a FinancialHistory per peer (best-effort, uses snapshot
  // fallback when profile isn't available yet).
  const peerHistories: Record<string, FinancialHistory> = useMemo(() => {
    const out: Record<string, FinancialHistory> = {}
    for (const p of peerSet.peers) {
      out[p.ticker] = buildFinancialHistory(p, peerProfiles[p.ticker] ?? null)
    }
    return out
  }, [peerSet, peerProfiles])

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

  // Single effective DCF assumption set — starts from historical-CAGR
  // baseline, then overlays any analyst overrides persisted from the
  // FSA or Report Builder pages. Every DCF instance in this report
  // (main table, scenarios, sensitivity matrix) derives from this
  // object so the "Base" scenario equity always equals the main DCF
  // equity, and the sensitivity matrix centers on it too.
  const effectiveDcfAssumptions: ReturnType<typeof defaultDcfAssumptions> = useMemo(() => {
    const base = defaultDcfAssumptions(subject, history.cagrs.revenueCagrPct)
    try {
      const stored = localStorage.getItem(`dcf_inputs_${subject.ticker}`)
      if (stored) {
        const custom = JSON.parse(stored) as { rev?: number; ebm?: number; gr?: number; wacc?: number; tgr?: number; yrs?: number }
        // Only apply overrides when the stored payload carries a real
        // revenue anchor (older payloads without it may be stale).
        if (custom.rev && custom.rev > 0) {
          const wacc = custom.wacc != null ? custom.wacc / 100 : base.wacc
          const tgr = custom.tgr != null ? custom.tgr / 100 : base.terminalGrowth
          return {
            ...base,
            startingGrowth: custom.gr != null ? custom.gr / 100 : base.startingGrowth,
            startingEbitdaMargin: custom.ebm != null ? custom.ebm / 100 : base.startingEbitdaMargin,
            wacc,
            terminalGrowth: Math.min(tgr, wacc - 0.005),
            years: custom.yrs ?? base.years,
          }
        }
      }
    } catch { /* ignore */ }
    return base
  }, [subject, history])

  const dcf: DcfResult = useMemo(
    () => runDcf(subject, effectiveDcfAssumptions),
    [subject, effectiveDcfAssumptions]
  )
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

  // All companies in same segments (for HHI). When the subject has no
  // value-chain tagging (newly-added SME with `comp: []`), fall back to
  // "companies in the same sector tag" so peer comparison + HHI still
  // produce a meaningful table. Otherwise the Market Analysis page shows
  // no peers for untagged tickers, which makes it look broken.
  const segmentCompanies: Company[] = useMemo(() => {
    const subjectSegs = new Set(subject.comp || [])
    if (subjectSegs.size > 0) {
      return COMPANIES.filter(co => co.mktcap > 0 && (co.comp || []).some(s => subjectSegs.has(s)))
    }
    // Fallback: same sector tag
    return COMPANIES.filter(co => co.mktcap > 0 && co.sec === subject.sec)
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

  // DCF Sensitivity Matrix (7 WACC × 5 Terminal Growth) — centered on
  // the same effective assumptions as the main DCF table so the grid's
  // centre cell equals the headline DCF Equity Value.
  const sensitivityMatrix = useMemo(() => {
    const baseWacc = effectiveDcfAssumptions.wacc
    const baseTg = effectiveDcfAssumptions.terminalGrowth
    const waccSteps = [-0.015, -0.01, -0.005, 0, 0.005, 0.01, 0.015]
    const tgSteps = [-0.01, -0.005, 0, 0.005, 0.01]
    return tgSteps.map(tgDelta =>
      waccSteps.map(waccDelta => {
        const adj = { ...effectiveDcfAssumptions, wacc: baseWacc + waccDelta, terminalGrowth: Math.max(0.01, baseTg + tgDelta) }
        if (adj.terminalGrowth >= adj.wacc) adj.terminalGrowth = adj.wacc - 0.005
        const result = runDcf(subject, adj)
        return { wacc: baseWacc + waccDelta, tg: baseTg + tgDelta, equityValue: result.equityValue }
      })
    )
  }, [subject, effectiveDcfAssumptions])

  // Bull / Base / Bear scenarios — Base uses the same effective
  // assumptions (and therefore the same equity value) as the main
  // DCF table. Bull/Bear perturb growth, margin and WACC off that
  // shared base so all scenarios remain consistent with user overrides.
  const scenarios = useMemo(() => {
    const base = effectiveDcfAssumptions
    const bull = { ...base, startingGrowth: base.startingGrowth + bullGrowthDelta, startingEbitdaMargin: base.startingEbitdaMargin + bullMarginDelta, wacc: base.wacc + bullWaccDelta }
    const bear = { ...base, startingGrowth: Math.max(0.01, base.startingGrowth - bullGrowthDelta), startingEbitdaMargin: Math.max(0.02, base.startingEbitdaMargin - bullMarginDelta), wacc: base.wacc - bullWaccDelta }
    // Ensure terminal growth stays strictly below WACC after the
    // perturbation — otherwise Gordon blows up.
    if (bull.terminalGrowth >= bull.wacc) bull.terminalGrowth = bull.wacc - 0.005
    if (bear.terminalGrowth >= bear.wacc) bear.terminalGrowth = bear.wacc - 0.005
    return [bull, base, bear].map((a, i) => {
      const r = runDcf(subject, a)
      return { label: ['Bull','Base','Bear'][i], equityValue: r.equityValue, upsidePct: r.upsideVsMarketCap, assumptions: a }
    })
  }, [subject, effectiveDcfAssumptions, bullGrowthDelta, bullMarginDelta, bullWaccDelta])

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
  // Auto-adjusted metrics — re-aggregate ALL news items as acknowledged
  // so the report shows the full impact without manual user acknowledgment.
  const autoAdjusted: CompanyAdjustedMetrics = useMemo(() => {
    if (!newsAgg || newsAgg.items.length === 0) return computeAdjustedMetrics(subject, undefined)
    // Re-run aggregation with an AckAccessors that treats every item as acknowledged.
    // This ensures paramAdjustments are properly computed from all items.
    const allAckedAgg = aggregateImpactByCompany(
      newsAgg.items,
      { isAcknowledged: () => true } // treat ALL items as acknowledged
    )
    const reAgg = allAckedAgg[subject.ticker] ?? null
    return computeAdjustedMetrics(subject, reAgg)
  }, [subject, newsAgg])

  // ── Free-source qualitative bundle (AR, credit ratings, shareholding) ──
  // Fed straight from /api/admin/fetch-qualitative output — see
  // /api/data/company-qualitative/[ticker]/route.ts for the contract.
  // Fetched lazily so a missing row doesn't block the rest of the report.
  const [qualitative, setQualitative] = useState<QualitativeBundle>(EMPTY_QUALITATIVE)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/data/company-qualitative/${subject.ticker}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled || !j?.ok) return
        setQualitative(j.qualitative as QualitativeBundle)
      })
      .catch(() => { /* silent — page renders empty placeholders */ })
    return () => { cancelled = true }
  }, [subject.ticker])

  // ── Section visibility (toggle in PrintToolbar) ──
  // Persisted per-ticker so that an analyst's last picks for, say,
  // POLYCAB carry over across browser refreshes. Cover + Appendix are
  // always rendered (the toolbar UI hides their checkboxes too).
  const [sectionsEnabled, setSectionsEnabled] = useState<Record<string, boolean>>(() => {
    const defaults: Record<string, boolean> = {}
    REPORT_SECTIONS.forEach((s) => { defaults[s.id] = true })
    return defaults
  })
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`report_sections_${subject.ticker}`)
      if (stored) {
        const parsed = JSON.parse(stored) as Record<string, boolean>
        // Merge with defaults so newly-added sections default to ON.
        setSectionsEnabled((prev) => ({ ...prev, ...parsed }))
      }
    } catch { /* ignore */ }
  }, [subject.ticker])
  const toggleSection = (id: string, on: boolean) => {
    setSectionsEnabled((prev) => {
      const next = { ...prev, [id]: on }
      try { localStorage.setItem(`report_sections_${subject.ticker}`, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }

  // Helper that returns true unless the section is explicitly disabled.
  // New sections default to ON for users who already have a stored
  // selection from before this feature shipped.
  const isOn = (id: string) => sectionsEnabled[id] !== false

  // ── Analyst overrides (edit mode) ──
  // `editMode` flips the CompanyDetails (and any other editable section)
  // into inline-edit UI. `overrides` is a per-ticker localStorage blob
  // that wins over both the qualitative API and the sector heuristic.
  const [overrides, setOverride, clearOverrides] = useReportOverrides(subject.ticker)
  const [editMode, setEditMode] = useState(false)

  return (
    <>
      <PrintToolbar
        subject={subject}
        sectionsEnabled={sectionsEnabled}
        toggleSection={toggleSection}
        editMode={editMode}
        setEditMode={setEditMode}
        hasOverrides={Object.values(overrides).some((v) => v !== null && v !== '' && !(Array.isArray(v) && v.length === 0))}
        clearOverrides={clearOverrides}
        publicMode={publicMode}
      />
      {/* Cover + Appendix render unconditionally — they're the report
          frame. Every other section is gated on the toolbar checkbox. */}
      <CoverPage subject={subject} history={history} dcf={dcf} />
      {isOn('execSummary') && (
        <ExecutiveSummaryPage
          subject={subject}
          history={history}
          dcf={dcf}
          bv={bv}
          comps={comps}
          adjusted={autoAdjusted}
          loadingProfile={loadingProfile}
        />
      )}
      {isOn('companyDetails') && (
        <CompanyDetailsPage
          subject={subject}
          qualitative={qualitative}
          chainNodes={subjectChainNodes}
          overrides={overrides}
          setOverride={setOverride}
          editMode={editMode}
        />
      )}
      {isOn('marketAnalysis') && (
        <MarketAnalysisPage subject={subject} chainNodes={subjectChainNodes} segmentCompanies={segmentCompanies} />
      )}
      {isOn('financial')  && <FinancialAnalysisPage subject={subject} history={history} profileErr={profileErr} />}
      {isOn('ratios')     && <FinancialRatiosPage subject={subject} history={history} peerSet={peerSet} />}
      {isOn('fsa')        && <FSADeepDivePage subject={subject} history={history} peerSet={peerSet} sections={fsaReportSections} chartSelections={chartSelections} getCommentary={getChartCommentary} isChartSelected={isChartSelected} />}
      {isOn('valuation')  && <ValuationMethodsPage subject={subject} dcf={dcf} comps={comps} bv={bv} />}
      {isOn('industry')   && <IndustryPolicyPage subject={subject} chainNodes={subjectChainNodes} segmentCompanies={segmentCompanies} />}
      {isOn('peers')      && <PeerComparisonPage subject={subject} peerSet={peerSet} peers={peers} />}
      {isOn('peerCharts') && <PeerChartsPage subject={subject} peerSet={peerSet} peers={peers} history={history} />}
      {isOn('historical') && <HistoricalPeerComparisonPage subject={subject} peerSet={peerSet} history={history} peerHistories={peerHistories} />}
      {isOn('shareholding') && <ShareholdingAcquisitionPage subject={subject} hhi={hhi} dcf={dcf} synergyNpv={synergyNpv} />}
      {isOn('football')   && <FootballFieldPage subject={subject} football={football} />}
      {isOn('sensitivity') && <SensitivityScenarioPage subject={subject} sensitivityMatrix={sensitivityMatrix} scenarios={scenarios} dcf={dcf} />}
      {isOn('news')       && <NewsImpactPage subject={subject} adjusted={autoAdjusted} highMatNews={highMatNews} newsAgg={newsAgg} chainNodes={subjectChainNodes} />}
      {isOn('conclusion') && <ConclusionPage subject={subject} history={history} dcf={dcf} comps={comps} bv={bv} scenarios={scenarios} football={football} adjusted={autoAdjusted} synergyNpv={synergyNpv} peerSet={peerSet} />}
      <AppendixPage subject={subject} history={history} dcf={dcf} />
    </>
  )
}

// ── Section catalog (drives the toolbar toggle) ─────────────────
//
// Order here matches the render order above; the PrintToolbar pulls
// from this list so adding a new section is one entry in REPORT_SECTIONS
// + one render line + the section component itself. `alwaysOn` sections
// don't get a checkbox — useful for the cover and appendix that bound
// every report.

interface ReportSectionMeta {
  id: string
  label: string
  /** Optional one-line tooltip for the toolbar checkbox. */
  hint?: string
}

const REPORT_SECTIONS: ReportSectionMeta[] = [
  { id: 'execSummary',    label: 'Executive Summary' },
  { id: 'companyDetails', label: 'Company Details', hint: 'Owner, Credit Rating, NCLT, Product Basket, Business Cycle' },
  { id: 'marketAnalysis', label: 'Market Analysis', hint: 'Segment TAM, CAGR, competitive landscape, policy backdrop' },
  { id: 'financial',      label: 'Financial Analysis' },
  { id: 'ratios',         label: 'Financial Ratios' },
  { id: 'fsa',            label: 'FSA Deep Dive' },
  { id: 'valuation',      label: 'Valuation Methods' },
  { id: 'industry',       label: 'Industry & Policy' },
  { id: 'peers',          label: 'Peer Comparison' },
  { id: 'peerCharts',     label: 'Peer Charts' },
  { id: 'historical',     label: 'Historical Peer Trends' },
  { id: 'shareholding',   label: 'Shareholding & Acquisition' },
  { id: 'football',       label: 'Football Field' },
  { id: 'sensitivity',    label: 'Sensitivity & Scenarios' },
  { id: 'news',           label: 'News Impact' },
  { id: 'conclusion',     label: 'Conclusion' },
]

// ── Qualitative bundle types (matches /api/data/company-qualitative) ──

interface CreditRatingLink { title: string; url: string; date: string | null }
interface ShareholdingQ {
  period: string
  promoterPct: number | null
  fiiPct: number | null
  diiPct: number | null
  publicPct: number | null
  govtPct: number | null
  pledgedPct: number | null
}
interface QualitativeBundle {
  arUrl: string | null
  arYear: number | null
  arFetchedAt: string | null
  creditRating: CreditRatingLink[]
  shareholding: ShareholdingQ[]
  // The columns below stay null today (paid sources) but are typed so
  // a future fetcher can populate them without API contract changes.
  facilities: unknown
  customers: unknown
  ncltCases: unknown
  mdaExtract: unknown
  arParsed: unknown
}
const EMPTY_QUALITATIVE: QualitativeBundle = {
  arUrl: null, arYear: null, arFetchedAt: null,
  creditRating: [], shareholding: [],
  facilities: null, customers: null, ncltCases: null, mdaExtract: null, arParsed: null,
}

// ── Editable report overrides (per-ticker localStorage) ────────
//
// The analyst can open "Edit mode" in the PrintToolbar and override any
// Company Details field — owner %, credit rating row, NCLT note, etc.
// Overrides persist per-ticker (`report_overrides_<TICKER>`) and take
// precedence over both the qualitative API blob and the sector heuristic.
//
// Precedence: override (manual)  >  qualitative API  >  heuristic fallback
//
// The heuristic layer exists because the free Screener scrape misses data
// for many SME / atlas tickers — but an M&A report that shows blank boxes
// for "Promoter Holding" or "Credit Rating" is worse than one showing a
// sector-median estimate clearly flagged "Est.". Analysts can then click
// Edit, replace the estimate with a known value, and the report finalises.
//
// `ReportOverrides` is deliberately a flat, JSON-serialisable shape —
// localStorage keeps it simple and lets an analyst hand-edit if needed.

interface ReportOverrides {
  // Ownership
  promoterPct: number | null
  pledgedPct: number | null
  fiiPct: number | null
  diiPct: number | null
  govtPct: number | null
  publicPct: number | null
  shAsOf: string | null
  // Business cycle
  cyclePhase: string | null
  cycleDriver: string | null
  // Credit + compliance
  creditRatings: CreditRatingLink[] | null
  cdrNote: string | null
  ncltNote: string | null
  // Annual report
  arUrl: string | null
  arYear: number | null
  // Company identity overrides (useful when Screener mislabels SMEs)
  ownerName: string | null
  // Notes — free-text
  analystNote: string | null
}

const EMPTY_OVERRIDES: ReportOverrides = {
  promoterPct: null, pledgedPct: null, fiiPct: null, diiPct: null,
  govtPct: null, publicPct: null, shAsOf: null,
  cyclePhase: null, cycleDriver: null,
  creditRatings: null, cdrNote: null, ncltNote: null,
  arUrl: null, arYear: null, ownerName: null, analystNote: null,
}

/**
 * Persist analyst overrides per-ticker. Returns [overrides, setField, clearAll].
 * Mirrors the section-toggle pattern used above so the two features age
 * consistently when localStorage gets cleared / migrated.
 */
function useReportOverrides(ticker: string): [
  ReportOverrides,
  <K extends keyof ReportOverrides>(key: K, value: ReportOverrides[K]) => void,
  () => void,
] {
  const [overrides, setOverrides] = useState<ReportOverrides>(EMPTY_OVERRIDES)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(`report_overrides_${ticker}`)
      if (stored) {
        const parsed = JSON.parse(stored) as Partial<ReportOverrides>
        setOverrides({ ...EMPTY_OVERRIDES, ...parsed })
      } else {
        setOverrides(EMPTY_OVERRIDES)
      }
    } catch { setOverrides(EMPTY_OVERRIDES) }
  }, [ticker])

  const setField = <K extends keyof ReportOverrides>(key: K, value: ReportOverrides[K]) => {
    setOverrides((prev) => {
      const next = { ...prev, [key]: value }
      try {
        // Strip nulls so the stored blob stays lean and the "reset" path
        // (setField('x', null)) doesn't leave dead keys around forever.
        const trimmed: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(next)) {
          if (v !== null && v !== '' && v !== undefined) trimmed[k] = v
        }
        if (Object.keys(trimmed).length === 0) {
          localStorage.removeItem(`report_overrides_${ticker}`)
        } else {
          localStorage.setItem(`report_overrides_${ticker}`, JSON.stringify(trimmed))
        }
      } catch { /* quota / private mode — in-memory only */ }
      return next
    })
  }

  const clearAll = () => {
    setOverrides(EMPTY_OVERRIDES)
    try { localStorage.removeItem(`report_overrides_${ticker}`) } catch { /* ignore */ }
  }

  return [overrides, setField, clearAll]
}

/**
 * Sector-median shareholding estimate. These are curated midpoints from
 * public Q3FY25 NSE bulk filings for the universe's largest 3–5 names in
 * each sector — good enough as a display placeholder, bad enough that the
 * analyst must confirm before the PDF goes out. Always paired with an
 * "Est." badge in the UI so the provenance is never ambiguous.
 */
const SECTOR_SH_HEURISTIC: Record<string, {
  promoter: number; fii: number; dii: number; public_: number; govt: number; pledged: number
}> = {
  solar:       { promoter: 55, fii: 15, dii: 10, public_: 20, govt: 0, pledged: 2 },
  td:          { promoter: 52, fii: 18, dii: 12, public_: 18, govt: 0, pledged: 1 },
  wind:        { promoter: 50, fii: 14, dii: 10, public_: 26, govt: 0, pledged: 3 },
  wind_energy: { promoter: 50, fii: 14, dii: 10, public_: 26, govt: 0, pledged: 3 },
  storage:     { promoter: 60, fii: 12, dii:  8, public_: 20, govt: 0, pledged: 2 },
  commodities: { promoter: 48, fii: 20, dii: 14, public_: 18, govt: 0, pledged: 1 },
}
const SECTOR_SH_DEFAULT = { promoter: 55, fii: 15, dii: 10, public_: 20, govt: 0, pledged: 2 }

function heuristicShareholding(sec: string | undefined) {
  return SECTOR_SH_HEURISTIC[sec || ''] ?? SECTOR_SH_DEFAULT
}

// ── Sector descriptors for Market Analysis fallback ──────────────
// Used when a ticker has no `comp` value-chain mapping yet (common for
// newly-added SMEs before an analyst has tagged segments). We still
// want the Market Analysis section to render *something* useful — a
// sector-level narrative is better than a blank stub.
const SECTOR_LABEL: Record<string, string> = {
  solar: 'Solar PV Value Chain',
  td: 'Power Transmission & Distribution Infrastructure',
  wind: 'Wind Energy — Turbines, Blades, Services',
  wind_energy: 'Wind Energy — Turbines, Blades, Services',
  storage: 'Battery Energy Storage Systems (BESS)',
  commodities: 'Energy-Transition Commodities (Polysilicon / Copper / Aluminium)',
}
const SECTOR_NARRATIVE: Record<string, string> = {
  solar:
    'India targets 280 GW+ cumulative solar capacity by 2030 under NEP-2022. ALMM + PLI + customs duty (40% BCD on modules) drive a $20B+ domestic manufacturing TAM, with module capacity expected to cross 100 GW by FY28. Cell + wafer + polysilicon integration is the active M&A theme.',
  td:
    'NEP 2032 mandates ₹9+ lakh Cr in T&D capex; ISTS charge waivers + RE integration push 8–10% annual spending growth. HVDC links, GIS substations, 765kV transformers + digital grid automation are the most acquired sub-segments.',
  wind:
    'Wind capacity re-accelerating after 2017–22 reverse-auction slowdown — hybrid (RE+storage) tenders, FDRE tenders, 3-MW+ onshore platforms drive the next cycle. Blade + gearbox + tower value-chain M&A ticks up on PLI announcements.',
  wind_energy:
    'Wind capacity re-accelerating after 2017–22 reverse-auction slowdown — hybrid (RE+storage) tenders, FDRE tenders, 3-MW+ onshore platforms drive the next cycle. Blade + gearbox + tower value-chain M&A ticks up on PLI announcements.',
  storage:
    'Utility + behind-the-meter BESS addressable market estimated at $15B+ by 2030. Viability-Gap Funding (VGF) + 4-hour standalone BESS tenders unlocking the first wave; LFP cell + BMS + EPC chain is where strategic acquisitions cluster.',
  commodities:
    'Polysilicon, copper, aluminium — the structural inputs to the energy transition. Prices track global EV + grid capex cycles; domestic players building pull-forward capacity to de-risk Chinese supply. Watch integrated silicon and copper-rod M&A.',
}
function sectorLabel(sec: string | undefined): string {
  return SECTOR_LABEL[sec || ''] ?? 'Power & Industrial Sector'
}
function sectorNarrative(sec: string | undefined): string {
  return SECTOR_NARRATIVE[sec || ''] ?? 'Sector narrative not catalogued — refer to peer benchmarking section for positioning.'
}

// ── EditableField ────────────────────────────────────────────────
//
// A field that flips between a display span and an input/textarea when
// `editMode` is on. Hidden edit chrome is achieved via `.dn-editable-*`
// classes that the `@media print` block strips — so the printed PDF
// always shows resolved values as static text, regardless of edit state.
//
// `isEst` renders a subtle "Est." pill so an analyst can see at a glance
// which fields are sector-heuristic vs. sourced/overridden.

function EstBadge({ visible }: { visible: boolean }) {
  if (!visible) return null
  return (
    <span className="dn-est-badge" title="Sector-median estimate — override via Edit mode to finalise">Est.</span>
  )
}

function EditableField(props: {
  value: string
  displayValue?: ReactNode  // optional richer render for display mode
  editMode: boolean
  onSave: (next: string) => void
  placeholder?: string
  suffix?: string
  type?: 'text' | 'number' | 'textarea' | 'url'
  isEst?: boolean
  width?: number | string
}) {
  const {
    value, displayValue, editMode, onSave,
    placeholder, suffix, type = 'text', isEst = false, width,
  } = props
  const [draft, setDraft] = useState(value)
  useEffect(() => { setDraft(value) }, [value])

  if (!editMode) {
    const hasValue = value != null && value !== ''
    return (
      <span className="dn-editable-display">
        {hasValue ? (displayValue ?? <>{value}{suffix ?? ''}</>) : <span style={{ color: 'var(--muted)' }}>{placeholder || '—'}</span>}
        <EstBadge visible={isEst && hasValue} />
      </span>
    )
  }

  const commit = () => {
    const trimmed = draft.trim()
    if (trimmed === (value ?? '')) return
    onSave(trimmed)
  }

  if (type === 'textarea') {
    return (
      <span className="dn-editable-wrap">
        <textarea
          className="dn-editable-input dn-editable-textarea"
          value={draft}
          placeholder={placeholder}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          style={{ width: width ?? '100%' }}
        />
      </span>
    )
  }
  return (
    <span className="dn-editable-wrap">
      <input
        className="dn-editable-input"
        type={type === 'number' ? 'number' : 'text'}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.currentTarget.blur() }
          if (e.key === 'Escape') { setDraft(value); e.currentTarget.blur() }
        }}
        style={{ width: width ?? 100 }}
        step={type === 'number' ? '0.01' : undefined}
      />
      {suffix && <span style={{ marginLeft: 2, color: 'var(--muted)', fontSize: 9 }}>{suffix}</span>}
    </span>
  )
}

// ── Toolbar ─────────────────────────────────────────────────────
//
// Screen-only toolbar with Back / Sections / Share / Download. The
// Sections + Share dropdowns are local-state popovers; clicking outside
// closes them. The whole bar is hidden in print via .dn-screen-only.

function PrintToolbar({
  subject,
  sectionsEnabled,
  toggleSection,
  editMode,
  setEditMode,
  hasOverrides,
  clearOverrides,
  publicMode,
}: {
  subject: Company
  sectionsEnabled: Record<string, boolean>
  toggleSection: (id: string, on: boolean) => void
  editMode: boolean
  setEditMode: (on: boolean) => void
  hasOverrides: boolean
  clearOverrides: () => void
  publicMode: boolean
}) {
  const router = useRouter()
  const { status: sessionStatus } = useSession()
  const isSignedIn = sessionStatus === 'authenticated'

  // Back-button logic has two branches because the two audiences
  // arrive on this page by very different paths:
  //
  //   • Signed-in analyst  — opened the report from /valuation,
  //     /maradar, /dashboard, etc. `history.back()` returns them to
  //     wherever they came from (the normal SPA behaviour).
  //
  //   • Public visitor     — landed here from the hero picker on
  //     '/'. `history.back()` in a fresh tab has nowhere to go and
  //     either no-ops or lands them on a blank about:blank page.
  //     We route them explicitly to '/' which also drops the
  //     ?public=1 URL param if they re-land on this page later.
  //
  // Edge case: a signed-in user who happens to hit the public flow
  // (e.g. a dev testing with a cookie in the same browser) keeps
  // the normal history.back behaviour.
  const handleBack = () => {
    if (publicMode && !isSignedIn) {
      router.push('/')
      return
    }
    if (typeof window !== 'undefined' && window.history.length > 1) {
      window.history.back()
    } else {
      router.push('/')
    }
  }
  const [openMenu, setOpenMenu] = useState<null | 'sections' | 'share'>(null)
  const [shareToast, setShareToast] = useState<string | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Outside-click closes the open dropdown.
  useEffect(() => {
    if (!openMenu) return
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpenMenu(null)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [openMenu])

  // Build a stable, shareable URL. We strip `?print=1` so that anyone
  // opening the link doesn't get a forced print dialog — they can hit
  // the Download PDF button themselves.
  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') return ''
    const u = new URL(window.location.href)
    u.searchParams.delete('print')
    return u.toString()
  }, [])
  const shareTitle = `${subject.name} (${subject.ticker}) — DealNector Valuation Report`
  const shareBody = `${shareTitle}\n${shareUrl}`

  const flashToast = (msg: string) => {
    setShareToast(msg)
    setTimeout(() => setShareToast(null), 2200)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl)
      flashToast('Link copied')
    } catch {
      // Older browsers / iframe sandboxes — fall back to a temp textarea.
      const ta = document.createElement('textarea')
      ta.value = shareUrl
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy'); flashToast('Link copied') }
      catch { flashToast('Copy failed — select the URL bar and copy manually') }
      finally { document.body.removeChild(ta) }
    }
    setOpenMenu(null)
  }

  const handleNativeShare = async () => {
    // Web Share API where supported (mobile + recent macOS Safari).
    try {
      if (navigator.share) {
        await navigator.share({ title: shareTitle, text: shareTitle, url: shareUrl })
        return
      }
    } catch { /* user cancelled */ }
    handleCopy()
  }

  const enabledCount = REPORT_SECTIONS.filter((s) => sectionsEnabled[s.id] !== false).length

  return (
    <div className="dn-toolbar dn-screen-only" ref={wrapperRef}>
      <div className="left">
        Deal<em>Nector</em> · Institutional Valuation Report
      </div>
      <div style={{ display: 'flex', gap: 8, position: 'relative', alignItems: 'center' }}>
        <button
          className="ghost"
          onClick={handleBack}
          title={publicMode && !isSignedIn ? 'Back to DealNector homepage' : 'Back to previous page'}
        >
          ← {publicMode && !isSignedIn ? 'Back to home' : 'Back'}
        </button>

        {/* Sections toggle — checkboxes for everything except Cover/Appendix */}
        <div style={{ position: 'relative' }}>
          <button
            className="ghost"
            onClick={() => setOpenMenu((m) => (m === 'sections' ? null : 'sections'))}
            title="Choose which sections appear in the report"
          >
            ☷ Sections ({enabledCount}/{REPORT_SECTIONS.length})
          </button>
          {openMenu === 'sections' && (
            <div className="dn-tb-menu" style={{ width: 320, maxHeight: 480, overflowY: 'auto' }}>
              <div className="dn-tb-menu-header">
                Sections to include
                <button
                  className="dn-tb-menu-link"
                  onClick={() => REPORT_SECTIONS.forEach((s) => toggleSection(s.id, true))}
                >Select all</button>
                <span style={{ color: '#94a4bd' }}>·</span>
                <button
                  className="dn-tb-menu-link"
                  onClick={() => REPORT_SECTIONS.forEach((s) => toggleSection(s.id, false))}
                >Clear</button>
              </div>
              {REPORT_SECTIONS.map((s) => (
                <label key={s.id} className="dn-tb-menu-row" title={s.hint}>
                  <input
                    type="checkbox"
                    checked={sectionsEnabled[s.id] !== false}
                    onChange={(e) => toggleSection(s.id, e.target.checked)}
                  />
                  <span>
                    <span style={{ fontWeight: 600 }}>{s.label}</span>
                    {s.hint && (
                      <span style={{ display: 'block', fontSize: 10, color: '#94a4bd', marginTop: 1 }}>
                        {s.hint}
                      </span>
                    )}
                  </span>
                </label>
              ))}
              <div style={{ padding: '8px 12px', fontSize: 10, color: '#94a4bd', borderTop: '1px solid #2a3a52' }}>
                Cover and Appendix are always included.
              </div>
            </div>
          )}
        </div>

        {/* Share menu — copy / mailto / wa.me / linkedin / native */}
        <div style={{ position: 'relative' }}>
          <button
            className="ghost"
            onClick={() => setOpenMenu((m) => (m === 'share' ? null : 'share'))}
          >
            ⤴ Share
          </button>
          {openMenu === 'share' && (
            <div className="dn-tb-menu" style={{ width: 240 }}>
              <div className="dn-tb-menu-header">Share this report</div>
              <button className="dn-tb-menu-row dn-tb-menu-button" onClick={handleCopy}>
                <span style={{ width: 22 }}>🔗</span> Copy link
              </button>
              <a
                className="dn-tb-menu-row"
                href={`mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareBody)}`}
                onClick={() => setOpenMenu(null)}
              >
                <span style={{ width: 22 }}>✉</span> Email
              </a>
              <a
                className="dn-tb-menu-row"
                href={`https://wa.me/?text=${encodeURIComponent(shareBody)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpenMenu(null)}
              >
                <span style={{ width: 22 }}>💬</span> WhatsApp
              </a>
              <a
                className="dn-tb-menu-row"
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpenMenu(null)}
              >
                <span style={{ width: 22 }}>in</span> LinkedIn
              </a>
              <a
                className="dn-tb-menu-row"
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareTitle)}&url=${encodeURIComponent(shareUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpenMenu(null)}
              >
                <span style={{ width: 22 }}>𝕏</span> X / Twitter
              </a>
              <button
                className="dn-tb-menu-row dn-tb-menu-button"
                onClick={handleNativeShare}
              >
                <span style={{ width: 22 }}>↗</span> System share…
              </button>
            </div>
          )}
        </div>

        {/* Edit toggle — when ON, Company Details (and any future editable
            sections) render inline inputs. Overrides persist per-ticker to
            localStorage and win over API / heuristic data.
            Hidden in public mode — public visitors can view / share /
            download but shouldn't be able to edit analyst fields. */}
        {!publicMode && (
          <button
            className={editMode ? undefined : 'ghost'}
            onClick={() => setEditMode(!editMode)}
            title={editMode ? 'Save edits and exit edit mode' : 'Override analyst-editable fields (promoter %, credit ratings, NCLT note, etc.)'}
            style={editMode ? { background: 'var(--gold)', color: 'var(--ink)' } : undefined}
          >
            {editMode ? '✓ Done editing' : '✎ Edit'}
          </button>
        )}

        {!publicMode && hasOverrides && (
          <button
            className="ghost"
            onClick={() => {
              if (confirm('Reset all manual overrides for this report? Data will revert to API + heuristic sources.')) {
                clearOverrides()
              }
            }}
            title="Clear all manual overrides on this report — keeps API / heuristic data."
            style={{ fontSize: 9 }}
          >
            ↺ Reset
          </button>
        )}

        <button onClick={() => window.print()}>Download PDF</button>

        {shareToast && (
          <div className="dn-tb-toast">{shareToast}</div>
        )}
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
              <em>{(subject.comp || []).join(', ').replace(/_/g, ' ')}</em> segment(s)
              {/* Sub-segment pinpoints from the DealNector VC-Taxonomy. When
                  present, narrow the narrative from the stage level down to the
                  exact product line (TOPCon cells, XLPE EHV cables, etc.), so
                  the analyst reading the exec summary instantly sees how
                  precisely this company competes. Empty ⇒ "generalist" — we
                  suppress the phrase rather than say "all sub-segments" to
                  keep the sentence clean. */}
              {(subject.subcomp || []).length > 0 && (
                <>
                  {' '}— specifically{' '}
                  <em>
                    {(subject.subcomp || [])
                      .map((s) => getSubSegmentLabel(s))
                      .join(', ')}
                  </em>
                </>
              )}
              . The company reported{' '}
              {newestYear?.revenue != null ? (
                <>
                  {formatCr(newestYear.revenue)} in revenue with a{' '}
                  {newestYear.ebitdaMarginPct?.toFixed(1) ?? subject.ebm.toFixed(1)}% EBITDA
                  margin
                </>
              ) : (
                <>₹{subject.rev.toLocaleString('en-IN')} Cr in revenue with a {subject.ebm.toFixed(1)}% EBITDA margin</>
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
    if (v == null || !Number.isFinite(v)) return 'N/A'
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
              {dcf.terminalViaExitMultiple
                ? `Terminal Value (Exit 10× EV/EBITDA, WACC=${(dcf.assumptions.wacc * 100).toFixed(1)}%)`
                : `Terminal Value (Gordon, g=${(dcf.assumptions.terminalGrowth * 100).toFixed(1)}%, WACC=${(dcf.assumptions.wacc * 100).toFixed(1)}%)`}
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

// ── Peer Charts & Critical Factors Page ────────────────────────

/**
 * Visual peer-comparison page. One bar chart per metric shows the
 * subject (highlighted) alongside its peer set, and — if multi-year
 * history is available — a line chart tracks revenue, EBITDA, and
 * net income trends. A "Critical Factors" narrative block summarises
 * the two or three most material drivers identified from the peer
 * stats (valuation premium/discount, growth leadership, margin
 * profile, leverage).
 */
function PeerChartsPage({
  subject,
  peerSet,
  peers,
  history,
}: {
  subject: Company
  peerSet: PeerSet
  peers: PeerStats
  history: FinancialHistory
}) {
  // Short labels (first word of the company name truncated to 8 chars)
  // keep the bar-chart axes readable without the legend cluttering up.
  const shortLabel = (name: string): string => {
    const first = name.split(/[\s.]+/)[0] || name
    return first.length > 8 ? first.slice(0, 8) : first
  }
  const subjectColor = '#9A4600'
  const peerColor = '#4C6A8C'
  const medianColor = '#1B7F3F'

  const rows = [subject, ...peerSet.peers]

  // Build a bar dataset for a given metric. Includes the subject first
  // (highlighted colour) and each peer that has a usable data point.
  const buildSeries = (
    key: 'ev_eb' | 'pe' | 'revg' | 'ebm' | 'dbt_eq'
  ): Array<{ label: string; value: number; color: string }> =>
    rows
      .map((c, i) => {
        const raw = Number(c[key])
        if (!Number.isFinite(raw) || raw === 0) return null
        return {
          label: (i === 0 ? '◆ ' : '') + shortLabel(c.name),
          value: Number(raw.toFixed(2)),
          color: i === 0 ? subjectColor : peerColor,
        }
      })
      .filter((v): v is { label: string; value: number; color: string } => v !== null)

  const evEbData = buildSeries('ev_eb')
  const peData = buildSeries('pe')
  const revgData = buildSeries('revg')
  const ebmData = buildSeries('ebm')
  const deData = buildSeries('dbt_eq')

  // ROCE series — subject first, then each peer. Prefer scraped
  // `co.roce`, else fall back to the derived estimate used by the
  // ratio table, so the chart stays in sync with the peer table.
  const roceData: Array<{ label: string; value: number; color: string }> = rows
    .map((c, i) => {
      const scraped = Number(c.roce)
      const derived = derivePeerRatios(c).rocePct
      const raw =
        Number.isFinite(scraped) && scraped !== 0
          ? scraped
          : derived != null && Number.isFinite(derived)
            ? derived
            : null
      if (raw == null || !Number.isFinite(raw) || raw === 0) return null
      return {
        label: (i === 0 ? '◆ ' : '') + shortLabel(c.name),
        value: Number(raw.toFixed(2)),
        color: i === 0 ? subjectColor : peerColor,
      }
    })
    .filter((v): v is { label: string; value: number; color: string } => v !== null)

  // Line-chart time series: subject's actual history (newest-first reversed
  // for chronological order). We don't have peer history, so we plot the
  // subject only — the caption explains why the median isn't overlaid.
  const histAsc = [...history.history].reverse()
  const revenueSeries: LineSeries = {
    label: 'Revenue',
    data: histAsc.map((y) => ({ x: y.label || y.fiscalYear, y: y.revenue ?? 0 })).filter((d) => d.y > 0),
    color: subjectColor,
  }
  const ebitdaSeries: LineSeries = {
    label: 'EBITDA',
    data: histAsc.map((y) => ({ x: y.label || y.fiscalYear, y: y.ebitda ?? 0 })).filter((d) => d.y > 0),
    color: peerColor,
  }
  const netIncomeSeries: LineSeries = {
    label: 'Net Inc.',
    data: histAsc.map((y) => ({ x: y.label || y.fiscalYear, y: y.netIncome ?? 0 })).filter((d) => d.y > 0),
    color: medianColor,
  }
  const marginSeries: LineSeries[] = [
    {
      label: 'EBITDA%',
      data: histAsc.map((y) => ({ x: y.label || y.fiscalYear, y: y.ebitdaMarginPct ?? 0 })).filter((d) => d.y > 0),
      color: subjectColor,
    },
    {
      label: 'Net %',
      data: histAsc.map((y) => ({ x: y.label || y.fiscalYear, y: y.netMarginPct ?? 0 })).filter((d) => d.y > 0),
      color: peerColor,
    },
  ]

  const hasHistory = revenueSeries.data.length >= 2

  // ── Critical-factor inferences ──
  const factors: Array<{ label: string; text: string; sentiment: 'positive' | 'negative' | 'neutral' }> = []

  if (Number.isFinite(peers.ev_eb.median) && peers.ev_eb.median > 0 && Number.isFinite(subject.ev_eb)) {
    const delta = ((subject.ev_eb - peers.ev_eb.median) / peers.ev_eb.median) * 100
    const absPct = Math.abs(delta).toFixed(0)
    if (delta > 15) {
      factors.push({
        label: 'Valuation — Premium to Peers',
        sentiment: 'negative',
        text: `${subject.name} trades at ${subject.ev_eb.toFixed(1)}× EV/EBITDA versus a peer median of ${peers.ev_eb.median.toFixed(1)}× — a ${absPct}% premium. Either growth / margin expansion has to outperform peers to justify the multiple, or a correction risk exists.`,
      })
    } else if (delta < -15) {
      factors.push({
        label: 'Valuation — Discount to Peers',
        sentiment: 'positive',
        text: `The stock trades at a ${absPct}% discount to the peer median of ${peers.ev_eb.median.toFixed(1)}× EV/EBITDA. If fundamentals are comparable to peers, this represents a re-rating opportunity.`,
      })
    } else {
      factors.push({
        label: 'Valuation — In-line with Peers',
        sentiment: 'neutral',
        text: `EV/EBITDA of ${subject.ev_eb.toFixed(1)}× is within ±15% of the peer median (${peers.ev_eb.median.toFixed(1)}×). Relative valuation is neutral; focus on fundamental drivers for directional conviction.`,
      })
    }
  }

  if (Number.isFinite(peers.revg.median) && Number.isFinite(subject.revg)) {
    const delta = subject.revg - peers.revg.median
    if (delta > 5) {
      factors.push({
        label: 'Growth Leadership',
        sentiment: 'positive',
        text: `Revenue growth of ${subject.revg.toFixed(1)}% leads the peer median by ${delta.toFixed(1)} ppt. Market-share gains or capacity ramp is outpacing the cohort — a core thesis driver.`,
      })
    } else if (delta < -5) {
      factors.push({
        label: 'Growth Lag',
        sentiment: 'negative',
        text: `Revenue growth of ${subject.revg.toFixed(1)}% trails the peer median by ${Math.abs(delta).toFixed(1)} ppt. Investigate whether this reflects end-market mix, capex timing, or share loss.`,
      })
    }
  }

  if (Number.isFinite(peers.ebm.median) && Number.isFinite(subject.ebm)) {
    const delta = subject.ebm - peers.ebm.median
    if (delta > 3) {
      factors.push({
        label: 'Margin Superiority',
        sentiment: 'positive',
        text: `EBITDA margin of ${subject.ebm.toFixed(1)}% is ${delta.toFixed(1)} ppt above peer median (${peers.ebm.median.toFixed(1)}%). Suggests cost leadership, product-mix advantage, or scale benefits.`,
      })
    } else if (delta < -3) {
      factors.push({
        label: 'Margin Compression Risk',
        sentiment: 'negative',
        text: `EBITDA margin of ${subject.ebm.toFixed(1)}% is ${Math.abs(delta).toFixed(1)} ppt below peer median. Watch input costs, pricing discipline, and operating leverage in coming quarters.`,
      })
    }
  }

  if (Number.isFinite(subject.dbt_eq)) {
    if (subject.dbt_eq > 1.0) {
      factors.push({
        label: 'Elevated Leverage',
        sentiment: 'negative',
        text: `Debt/Equity of ${subject.dbt_eq.toFixed(2)}× is above the 1.0× comfort threshold and peer median of ${peers.dbt_eq.median.toFixed(2)}×. A refinancing or capex pause could tighten free-cash-flow.`,
      })
    } else if (subject.dbt_eq < 0.3) {
      factors.push({
        label: 'Conservative Balance Sheet',
        sentiment: 'positive',
        text: `Debt/Equity of ${subject.dbt_eq.toFixed(2)}× is meaningfully below peer median of ${peers.dbt_eq.median.toFixed(2)}×. Balance-sheet capacity supports inorganic growth, buybacks, or dividends.`,
      })
    }
  }

  if (history.cagrs.revenueCagrPct != null && history.cagrs.ebitdaCagrPct != null) {
    const gap = history.cagrs.ebitdaCagrPct - history.cagrs.revenueCagrPct
    if (gap > 2) {
      factors.push({
        label: 'Positive Operating Leverage',
        sentiment: 'positive',
        text: `EBITDA CAGR (${history.cagrs.ebitdaCagrPct.toFixed(1)}%) is outpacing Revenue CAGR (${history.cagrs.revenueCagrPct.toFixed(1)}%) over the history window. Fixed-cost absorption is improving margins as scale builds.`,
      })
    } else if (gap < -2) {
      factors.push({
        label: 'Negative Operating Leverage',
        sentiment: 'negative',
        text: `EBITDA CAGR (${history.cagrs.ebitdaCagrPct.toFixed(1)}%) is trailing Revenue CAGR (${history.cagrs.revenueCagrPct.toFixed(1)}%). Cost base is growing faster than top-line — operating-leverage thesis needs re-validation.`,
      })
    }
  }

  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Peer Charts" pageNum="07B" />
      <span className="dn-eyebrow">Peer Visuals — Relative Multiples &amp; Historical Trends</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        Peer-to-Peer Comparison Charts
      </h2>
      <hr className="dn-rule" />

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
        {evEbData.length >= 2 && (
          <div>
            <BarChart data={evEbData} title="EV / EBITDA (×)" height={180} unit="×" fmt={(v) => v.toFixed(1)} />
          </div>
        )}
        {peData.length >= 2 && (
          <div>
            <BarChart data={peData} title="P / E (×)" height={180} unit="×" fmt={(v) => v.toFixed(1)} />
          </div>
        )}
        {revgData.length >= 2 && (
          <div>
            <BarChart data={revgData} title="Revenue Growth (%)" height={180} unit="%" fmt={(v) => v.toFixed(1)} />
          </div>
        )}
        {ebmData.length >= 2 && (
          <div>
            <BarChart data={ebmData} title="EBITDA Margin (%)" height={180} unit="%" fmt={(v) => v.toFixed(1)} />
          </div>
        )}
        {deData.length >= 2 && (
          <div>
            <BarChart data={deData} title="Debt / Equity (×)" height={180} unit="×" fmt={(v) => v.toFixed(2)} />
          </div>
        )}
        {roceData.length >= 2 && (
          <div>
            <BarChart data={roceData} title="ROCE (%)" height={180} unit="%" fmt={(v) => v.toFixed(1)} />
          </div>
        )}
      </div>

      <div className="dn-narrative" style={{ marginTop: 4 }}>
        <p style={{ fontSize: 10, color: '#555' }}>
          <strong>Read as:</strong> ◆ bar is the subject; other bars are the closest value-chain peers. Peer set is
          selected by shared value-chain segments, then closest market-cap proximity. Missing bars mean the peer has
          no reported data for that metric — shown as N/A rather than zero.
        </p>
      </div>

      {hasHistory && (
        <>
          <h2 className="dn-h2" style={{ marginTop: 12, marginBottom: 8 }}>
            Historical Financial Trend — {subject.name}
          </h2>
          <hr className="dn-rule" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <LineChartPrint
              series={[revenueSeries, ebitdaSeries, netIncomeSeries].filter((s) => s.data.length >= 2)}
              title="Revenue / EBITDA / Net Income (₹ Cr)"
              height={180}
              fmt={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0))}
            />
            <LineChartPrint
              series={marginSeries.filter((s) => s.data.length >= 2)}
              title="Margin Trajectory (%)"
              height={180}
              unit="%"
              fmt={(v) => v.toFixed(1)}
            />
          </div>
        </>
      )}

      <h2 className="dn-h2" style={{ marginTop: 12, marginBottom: 8 }}>
        Critical Factors Identified
      </h2>
      <hr className="dn-rule" />
      {factors.length === 0 ? (
        <div className="dn-narrative">
          <p>
            No outlier factors flagged — {subject.name}'s ratios sit broadly in line with its peer set on valuation,
            growth, margins and leverage. Review the table above for metric-level detail.
          </p>
        </div>
      ) : (
        <ul className="dn-bulleted" style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
          {factors.map((f, i) => {
            const color =
              f.sentiment === 'positive' ? 'var(--green)'
              : f.sentiment === 'negative' ? 'var(--red)'
              : 'var(--ink)'
            return (
              <li key={i} style={{ marginBottom: 6, fontSize: 10.5, lineHeight: 1.5 }}>
                <strong style={{ color }}>{f.label}.</strong> {f.text}
              </li>
            )
          })}
        </ul>
      )}
      <PageFooter />
    </section>
  )
}

// ── Historical Peer Comparison Page ───────────────────────────
// Line-charts subject vs peer-median for key ratios across the
// overlapping year window. Falls back to snapshot-only peers when
// RapidAPI multi-year data isn't available for every peer.

interface PeerHistMap { [ticker: string]: FinancialHistory }

function HistoricalPeerComparisonPage({
  subject,
  peerSet,
  history,
  peerHistories,
}: {
  subject: Company
  peerSet: PeerSet
  history: FinancialHistory
  peerHistories: PeerHistMap
}) {
  // Align everything to fiscal-year keys. Use the subject's fiscal-year
  // labels as the anchor — peers that share a year contribute to the
  // median for that year.
  const subjectAsc = [...history.history].reverse()
  const years = subjectAsc
    .map((y) => y.fiscalYear || y.label)
    .filter((s): s is string => !!s)

  // Build per-year peer-median ratio series
  type MetricKey = 'revenueGrowthPct' | 'ebitdaMarginPct' | 'netMarginPct' | 'roePct' | 'debtToEquity' | 'revenue'
  const peerMedianSeries = (key: MetricKey): number[] => {
    return years.map((yr) => {
      const vals: number[] = []
      for (const p of peerSet.peers) {
        const ph = peerHistories[p.ticker]
        if (!ph) continue
        const row = ph.history.find((h) => (h.fiscalYear || h.label) === yr)
        if (!row) continue
        const v = row[key as keyof typeof row] as number | null
        if (v != null && Number.isFinite(v)) vals.push(v)
      }
      if (vals.length === 0) return NaN
      const sorted = [...vals].sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid]
    })
  }

  const subjectSeries = (key: MetricKey): number[] =>
    subjectAsc.map((y) => {
      const v = y[key as keyof typeof y] as number | null
      return v != null && Number.isFinite(v) ? v : NaN
    })

  const subjectColor = '#9A4600'
  const medianColor = '#1B7F3F'

  const mkLine = (
    key: MetricKey,
    label: string,
  ): { subj: LineSeries; peer: LineSeries; hasData: boolean } => {
    const subjVals = subjectSeries(key)
    const peerVals = peerMedianSeries(key)
    const subjData = subjVals
      .map((v, i) => ({ x: years[i], y: v }))
      .filter((d) => Number.isFinite(d.y))
    const peerData = peerVals
      .map((v, i) => ({ x: years[i], y: v }))
      .filter((d) => Number.isFinite(d.y))
    return {
      subj: { label: `${label} — ${subject.ticker}`, data: subjData, color: subjectColor },
      peer: { label: `${label} — Peer Median`, data: peerData, color: medianColor },
      hasData: subjData.length >= 2 && peerData.length >= 1,
    }
  }

  const revgLine = mkLine('revenueGrowthPct', 'Rev Growth %')
  const ebmLine = mkLine('ebitdaMarginPct', 'EBITDA Margin %')
  const nmLine = mkLine('netMarginPct', 'Net Margin %')
  const roeLine = mkLine('roePct', 'ROE %')
  const deLine = mkLine('debtToEquity', 'Debt / Equity')
  const revLine = mkLine('revenue', 'Revenue ₹ Cr')

  // How many peers ended up with multi-year RapidAPI data vs only snapshot
  const peersWithMultiYear = peerSet.peers.filter(
    (p) => (peerHistories[p.ticker]?.yearsOfHistory ?? 0) >= 2
  ).length
  const peersTotal = peerSet.peers.length
  const dataQuality =
    peersWithMultiYear === peersTotal
      ? 'complete'
      : peersWithMultiYear > 0
      ? 'partial'
      : 'snapshot-only'

  // ── Analysis narrative ──
  // Compare subject's latest ratio vs peer-median-latest, plus trajectory.
  const analyses: Array<{ title: string; text: string; tone: 'positive' | 'negative' | 'neutral' }> = []

  const latestIdx = subjectAsc.length - 1
  const firstIdx = 0

  const analyzeRatio = (
    key: MetricKey,
    label: string,
    unit: string,
    higherIsBetter: boolean,
    thresholdPpt: number
  ) => {
    const subjVals = subjectSeries(key)
    const peerVals = peerMedianSeries(key)
    const subjLatest = subjVals[latestIdx]
    const peerLatest = peerVals[latestIdx]
    if (!Number.isFinite(subjLatest) || !Number.isFinite(peerLatest)) return

    const delta = subjLatest - peerLatest
    const absDelta = Math.abs(delta).toFixed(1)
    const subjFirst = subjVals[firstIdx]
    const peerFirst = peerVals[firstIdx]
    let trajectory = ''
    if (Number.isFinite(subjFirst) && Number.isFinite(peerFirst)) {
      const subjShift = subjLatest - subjFirst
      const peerShift = peerLatest - peerFirst
      const relShift = subjShift - peerShift
      if (Math.abs(relShift) >= 1) {
        trajectory = ` Over the history window, the gap ${
          relShift > 0 ? 'widened in favour of' : 'narrowed against'
        } ${subject.ticker} by ${Math.abs(relShift).toFixed(1)}${unit}.`
      } else {
        trajectory = ' The gap has been roughly stable across the history window.'
      }
    }

    const outperforming =
      (higherIsBetter && delta > thresholdPpt) ||
      (!higherIsBetter && delta < -thresholdPpt)
    const underperforming =
      (higherIsBetter && delta < -thresholdPpt) ||
      (!higherIsBetter && delta > thresholdPpt)

    if (outperforming) {
      analyses.push({
        title: `${label} — outperforming peers`,
        tone: 'positive',
        text: `Latest ${label} is ${subjLatest.toFixed(1)}${unit} vs peer median ${peerLatest.toFixed(1)}${unit} — ${absDelta}${unit} ${
          higherIsBetter ? 'above' : 'below'
        } cohort.${trajectory}`,
      })
    } else if (underperforming) {
      analyses.push({
        title: `${label} — trailing peers`,
        tone: 'negative',
        text: `Latest ${label} is ${subjLatest.toFixed(1)}${unit} vs peer median ${peerLatest.toFixed(1)}${unit} — ${absDelta}${unit} ${
          higherIsBetter ? 'below' : 'above'
        } cohort.${trajectory}`,
      })
    } else {
      analyses.push({
        title: `${label} — in line with peers`,
        tone: 'neutral',
        text: `Latest ${label} of ${subjLatest.toFixed(1)}${unit} tracks the peer median (${peerLatest.toFixed(1)}${unit}) within the tolerance band.${trajectory}`,
      })
    }
  }

  analyzeRatio('revenueGrowthPct', 'Revenue Growth', '%', true, 3)
  analyzeRatio('ebitdaMarginPct', 'EBITDA Margin', '%', true, 2)
  analyzeRatio('netMarginPct', 'Net Margin', '%', true, 2)
  analyzeRatio('roePct', 'ROE', '%', true, 2)
  analyzeRatio('debtToEquity', 'Debt / Equity', '×', false, 0.2)

  const anyChart =
    revgLine.hasData || ebmLine.hasData || nmLine.hasData || roeLine.hasData || deLine.hasData || revLine.hasData

  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Historical Peer Comparison" pageNum="07C" />
      <span className="dn-eyebrow">Multi-Year Trajectory vs Peer Median</span>
      <h2 className="dn-h2" style={{ marginBottom: 10 }}>
        Historical Ratio Comparison — {subject.name} vs Peer Median
      </h2>
      <hr className="dn-rule" />

      <div className="dn-narrative" style={{ marginBottom: 10 }}>
        <p style={{ fontSize: 10.5 }}>
          Peer-median series is computed year-by-year from the same multi-year RapidAPI bundle that
          powers the subject's history. Data coverage: <strong>{peersWithMultiYear}/{peersTotal}</strong>{' '}
          peers with ≥2 years of history
          {dataQuality === 'complete' ? ' — full cohort comparable' :
           dataQuality === 'partial' ? ' — partial comparison, remaining peers contribute snapshot-only values' :
           ' — peer coverage limited to the latest snapshot; multi-year fetch is still in progress.'}
        </p>
      </div>

      {!anyChart ? (
        <div className="dn-narrative">
          <p>
            Insufficient overlapping years across subject and peers to plot a historical comparison.
            Peer data is fetched in the background — once multi-year bundles arrive the charts and
            analysis will populate automatically.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 10 }}>
            {revgLine.hasData && (
              <LineChartPrint
                series={[revgLine.subj, revgLine.peer]}
                title="Revenue Growth (%) — vs Peer Median"
                height={170}
                unit="%"
                fmt={(v) => v.toFixed(1)}
              />
            )}
            {ebmLine.hasData && (
              <LineChartPrint
                series={[ebmLine.subj, ebmLine.peer]}
                title="EBITDA Margin (%) — vs Peer Median"
                height={170}
                unit="%"
                fmt={(v) => v.toFixed(1)}
              />
            )}
            {nmLine.hasData && (
              <LineChartPrint
                series={[nmLine.subj, nmLine.peer]}
                title="Net Margin (%) — vs Peer Median"
                height={170}
                unit="%"
                fmt={(v) => v.toFixed(1)}
              />
            )}
            {roeLine.hasData && (
              <LineChartPrint
                series={[roeLine.subj, roeLine.peer]}
                title="ROE (%) — vs Peer Median"
                height={170}
                unit="%"
                fmt={(v) => v.toFixed(1)}
              />
            )}
            {deLine.hasData && (
              <LineChartPrint
                series={[deLine.subj, deLine.peer]}
                title="Debt / Equity (×) — vs Peer Median"
                height={170}
                unit="×"
                fmt={(v) => v.toFixed(2)}
              />
            )}
            {revLine.hasData && (
              <LineChartPrint
                series={[revLine.subj, revLine.peer]}
                title="Revenue (₹ Cr) — vs Peer Median"
                height={170}
                fmt={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(0))}
              />
            )}
          </div>

          <h2 className="dn-h2" style={{ marginTop: 10, marginBottom: 6 }}>
            Analysis — Trajectory vs Cohort
          </h2>
          <hr className="dn-rule" />
          {analyses.length === 0 ? (
            <div className="dn-narrative">
              <p>Not enough comparable data to draw year-on-year conclusions against the cohort.</p>
            </div>
          ) : (
            <ul className="dn-bulleted" style={{ margin: 0, paddingLeft: 18, listStyle: 'disc' }}>
              {analyses.map((a, i) => {
                const color =
                  a.tone === 'positive' ? 'var(--green)' :
                  a.tone === 'negative' ? 'var(--red)' : 'var(--ink)'
                return (
                  <li key={i} style={{ marginBottom: 6, fontSize: 10.5, lineHeight: 1.5 }}>
                    <strong style={{ color }}>{a.title}.</strong> {a.text}
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}

      <PageFooter />
    </section>
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
          {subject.revg > 15 ? `, growing at an above-average ${subject.revg.toFixed(1)}% — indicating strong demand tailwinds and successful capacity expansion` : subject.revg > 5 ? `, growing at ${subject.revg.toFixed(1)}%` : `, with modest ${subject.revg.toFixed(1)}% growth`}.
          {subject.ebm > 15 ? ` EBITDA margin of ${subject.ebm.toFixed(1)}% demonstrates strong operating leverage and pricing power.` : ` EBITDA margin of ${subject.ebm.toFixed(1)}% is typical for the segment.`}
          {subject.dbt_eq < 0.5 ? ` The conservative balance sheet (${subject.dbt_eq.toFixed(2)}× D/E) provides significant acquisition debt capacity.` : subject.dbt_eq < 1.0 ? ` Balance sheet leverage at ${subject.dbt_eq.toFixed(2)}× D/E is manageable.` : ` Elevated leverage at ${subject.dbt_eq.toFixed(2)}× D/E requires careful assessment of debt servicing capacity.`}
          {' '}
          {history.cagrs.revenueCagrPct !== null && history.cagrs.revenueCagrPct > 15 ? `The ${history.cagrs.revenueCagrPct.toFixed(1)}% revenue CAGR over ${history.yearsOfHistory} years confirms a structural growth trajectory, not a cyclical spike.` : history.cagrs.revenueCagrPct !== null ? `Revenue has compounded at ${history.cagrs.revenueCagrPct.toFixed(1)}% over ${history.yearsOfHistory} years.` : ''}
          {' '}
          {subject.acqs >= 8 ? `With an acquisition score of ${subject.acqs.toFixed(1)}/10 (${subject.acqf}), this is a high-priority target for strategic buyers.` : subject.acqs >= 6 ? `The ${subject.acqs.toFixed(1)}/10 acquisition score (${subject.acqf}) suggests this target merits further due diligence.` : `The ${subject.acqs.toFixed(1)}/10 acquisition score (${subject.acqf}) indicates this target has specific challenges that limit near-term deal feasibility.`}
        </p>
      </div>

      {/* Critical highlights */}
      {(() => {
        const positives: string[] = []
        const criticals: string[] = []
        if (subject.ebm > 18) positives.push(`Strong EBITDA margin at ${subject.ebm.toFixed(1)}% — robust pricing power`)
        if (subject.revg > 25) positives.push(`Revenue growth of ${subject.revg.toFixed(1)}% significantly above sector average`)
        if (subject.dbt_eq < 0.3) positives.push(`Conservative leverage at ${subject.dbt_eq.toFixed(2)}× D/E — strong balance sheet`)
        if (subject.acqs >= 8) positives.push(`High acquisition score of ${subject.acqs.toFixed(1)}/10 — strong strategic fit`)
        if (history.cagrs.revenueCagrPct !== null && history.cagrs.revenueCagrPct > 20) positives.push(`${history.cagrs.revenueCagrPct.toFixed(1)}% revenue CAGR confirms structural growth`)
        if (subject.ebm < 8) criticals.push(`EBITDA margin of ${subject.ebm.toFixed(1)}% is thin — limited cost buffer`)
        if (subject.dbt_eq > 1.5) criticals.push(`D/E of ${subject.dbt_eq.toFixed(2)}× exceeds 1.5× — elevated financial risk`)
        if (subject.revg < 5) criticals.push(`Revenue growth of ${subject.revg.toFixed(1)}% is near stagnant`)
        if (subject.ev_eb > 40) criticals.push(`Premium valuation at ${subject.ev_eb.toFixed(1)}× EV/EBITDA — high expectations embedded`)
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

  // Subject's own derived ratios (ROCE estimate + the same estimator
  // used for peers). `derivePeerRatios` works on the snapshot so the
  // subject and peers use a consistent methodology.
  const subjectDerived = derivePeerRatios(subject)

  // Compute key ratios from latest financials
  const ratios = {
    grossMargin: latest && latest.grossProfit && latest.revenue ? (latest.grossProfit / latest.revenue * 100) : null,
    operatingMargin: latest && latest.ebitda && latest.revenue ? (latest.ebitda / latest.revenue * 100) : null,
    netMargin: latest && latest.netIncome && latest.revenue ? (latest.netIncome / latest.revenue * 100) : null,
    roe: latest?.roePct ?? null,
    roa: latest?.roaPct ?? null,
    // ROCE — prefer scraped `subject.roce`, else fall back to the
    // estimator shared with the peer group. `null` when neither
    // source has enough data to compute it.
    roce:
      subject.roce != null && Number.isFinite(subject.roce) && subject.roce > 0
        ? subject.roce
        : subjectDerived.rocePct,
    currentRatio: latest && latest.currentAssets && latest.currentLiabilities ? (latest.currentAssets / latest.currentLiabilities) : null,
    debtEquity: latest?.debtToEquity ?? subject.dbt_eq,
    debtEbitda: latest && latest.totalDebt && latest.ebitda && latest.ebitda > 0 ? (latest.totalDebt / latest.ebitda) : null,
    assetTurnover: latest && latest.revenue && latest.totalAssets ? (latest.revenue / latest.totalAssets) : null,
    receivablesDays: latest && latest.receivables && latest.revenue ? (latest.receivables / latest.revenue * 365) : null,
    cashConversion: latest?.cashConversionCycle ?? null,
    fcfToDebt: latest && latest.fcf && latest.totalDebt && latest.totalDebt > 0 ? (latest.fcf / latest.totalDebt * 100) : null,
  }

  // Compute same ratios for peers. Where a ratio isn't directly stored
  // on the snapshot (ROE, net margin, ROCE), we derive it from
  // available fields via `derivePeerRatios` so the column isn't
  // entirely blank.
  const peerRatios = peerSet.peers.map((p) => {
    const d = derivePeerRatios(p)
    return {
      name: p.name,
      ticker: p.ticker,
      grossMargin: Number.isFinite(p.ebm) && p.ebm !== 0 ? p.ebm : null,
      operatingMargin: Number.isFinite(p.ebm) && p.ebm !== 0 ? p.ebm : null,
      netMargin: d.netMarginPct,
      roe: d.roePct,
      roce: d.rocePct,
      roa: null as number | null, // assets not on snapshot — genuinely N/A
      currentRatio: null as number | null,
      debtEquity: Number.isFinite(p.dbt_eq) && p.dbt_eq !== 0 ? p.dbt_eq : null,
      revGrowth: Number.isFinite(p.revg) ? p.revg : null,
      pe: Number.isFinite(p.pe) && p.pe !== 0 ? p.pe : null,
      evEbitda: Number.isFinite(p.ev_eb) && p.ev_eb !== 0 ? p.ev_eb : null,
    }
  })

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
    const fmt = (v: number | null) =>
      v === null || !Number.isFinite(v) ? 'N/A' : `${v.toFixed(1)}${suffix}`
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
              <RatioRow label="ROE (est.)" value={ratios.roe} peerMed={peerMedian(peerRatios.map(p=>p.roe))} best={peerBest(peerRatios.map(p=>p.roe),true)} worst={peerBest(peerRatios.map(p=>p.roe),false)} suffix="%" />
              <RatioRow label={subject.roce != null && subject.roce > 0 ? 'ROCE' : 'ROCE (est.)'} value={ratios.roce} peerMed={peerMedian(peerRatios.map(p=>p.roce))} best={peerBest(peerRatios.map(p=>p.roce),true)} worst={peerBest(peerRatios.map(p=>p.roce),false)} suffix="%" />
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
        with {subject.revg.toFixed(1)}% revenue growth and {subject.ebm.toFixed(1)}% EBITDA margin.
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
        <strong>Acquisition Score: {subject.acqs.toFixed(1)}/10 — {subject.acqf}</strong>. {subject.rea.slice(0, 200)}
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

// ── Company Details (owner, credit rating, NCLT, products, cycle) ──
//
// Free-source one-pager that consolidates everything we know about the
// company that ISN'T a financial line item: who controls it (top
// promoter %), what they make (subject.comp expanded via CHAIN), what
// rating agencies say (Screener-scraped doc links), whether there's any
// CDR / NCLT exposure (placeholders today — paid sources required), and
// where the business sits in its industry life-cycle.
//
// Designed to print on a single A4 page — long lists are capped (top 5
// ratings, top 4 products) so the page never overflows.

function CompanyDetailsPage({
  subject,
  qualitative,
  chainNodes,
  overrides,
  setOverride,
  editMode,
}: {
  subject: Company
  qualitative: QualitativeBundle
  chainNodes: ChainNode[]
  overrides: ReportOverrides
  setOverride: <K extends keyof ReportOverrides>(key: K, value: ReportOverrides[K]) => void
  editMode: boolean
}) {
  // ── Resolve every field through the 3-tier cascade ──
  // override (manual) → qualitative API → sector heuristic ("Est.")
  //
  // We track an `isEst` flag per field so the UI can badge heuristic
  // values. Once an analyst types an override the flag flips to false.
  const sh = qualitative.shareholding
  const latestSh = sh.length > 0 ? sh[0] : null
  const heuristicSh = heuristicShareholding(subject.sec)

  // Generic 3-tier resolver for numeric shareholding fields.
  const resolveShPct = (
    overrideVal: number | null,
    apiVal: number | null | undefined,
    heuristicVal: number
  ): { value: number | null; isEst: boolean } => {
    if (overrideVal != null) return { value: overrideVal, isEst: false }
    if (apiVal != null) return { value: apiVal, isEst: false }
    return { value: heuristicVal, isEst: true }
  }

  const promoter = resolveShPct(overrides.promoterPct, latestSh?.promoterPct, heuristicSh.promoter)
  const pledged  = resolveShPct(overrides.pledgedPct,  latestSh?.pledgedPct,  heuristicSh.pledged)
  const fii      = resolveShPct(overrides.fiiPct,      latestSh?.fiiPct,      heuristicSh.fii)
  const dii      = resolveShPct(overrides.diiPct,      latestSh?.diiPct,      heuristicSh.dii)
  const govt     = resolveShPct(overrides.govtPct,     latestSh?.govtPct,     heuristicSh.govt)
  const publicR  = resolveShPct(overrides.publicPct,   latestSh?.publicPct,   heuristicSh.public_)
  const shAsOf = overrides.shAsOf
    ?? latestSh?.period
    ?? 'Sector median (Q3FY25 peer avg)'
  const shAsOfIsEst = overrides.shAsOf == null && latestSh == null

  const fmtPct = (v: number | null) =>
    v == null ? '—' : v % 1 === 0 ? `${v.toFixed(0)}%` : `${v.toFixed(2)}%`

  // Business cycle — sector default + analyst override.
  const sectorCycle: Record<string, { phase: string; note: string }> = {
    solar: { phase: 'Growth / Capacity Build-out',
             note: 'Domestic ALMM + PLI tailwinds, 60GW+ module capacity addition by FY28.' },
    td:    { phase: 'Mature Growth',
             note: 'NEP 2032 + ISTS waiver driving 8–10% replacement-cycle CAGR.' },
    wind_energy: { phase: 'Cyclical Recovery',
             note: 'Hybrid auctions + FDRE tenders restarting after 2017–22 slowdown.' },
    wind: { phase: 'Cyclical Recovery',
             note: 'Hybrid auctions + FDRE tenders restarting after 2017–22 slowdown.' },
    storage: { phase: 'Early Emergence',
             note: 'Viability-Gap Funding + 4-hr standalone tenders unlocking utility BESS.' },
    commodities: { phase: 'Cyclical / Mid-Cycle',
             note: 'Polysilicon, copper, aluminium cycles tracking EV + grid infrastructure demand.' },
  }
  const fallbackCycle = sectorCycle[subject.sec || ''] || {
    phase: 'Established Operations',
    note: 'Sector life-cycle not explicitly mapped — refer to peer benchmarking section.',
  }
  const cyclePhase   = overrides.cyclePhase ?? fallbackCycle.phase
  const cyclePhaseIsEst = overrides.cyclePhase == null
  const cycleDriver  = overrides.cycleDriver ?? fallbackCycle.note
  const cycleDriverIsEst = overrides.cycleDriver == null

  // Credit ratings — override wins over API. When override IS provided
  // but empty (analyst deleted all rows), we treat that as intentional
  // "no ratings" and don't fall back to the API.
  const ratings: CreditRatingLink[] =
    overrides.creditRatings != null ? overrides.creditRatings : qualitative.creditRating
  const ratingsIsEst = false  // ratings are never heuristic — they're real Screener links or manual

  // CDR / NCLT — free text with sensible defaults.
  const ncltCases = qualitative.ncltCases as Array<{ caseNo?: string; date?: string; bench?: string; status?: string }> | null
  const ncltDefault = Array.isArray(ncltCases) && ncltCases.length > 0
    ? `${ncltCases.length} case(s) tracked — see Appendix.`
    : 'No active cases tracked via free sources.'
  const ncltNote = overrides.ncltNote ?? ncltDefault
  const ncltIsEst = overrides.ncltNote == null
  const cdrNote = overrides.cdrNote ?? 'Not flagged in free public sources.'
  const cdrIsEst = overrides.cdrNote == null

  // Annual report — override wins, else qualitative.
  const arUrl = overrides.arUrl ?? qualitative.arUrl
  const arYear = overrides.arYear ?? qualitative.arYear

  // Owner / promoter entity name — no free source, pure override today.
  const ownerName = overrides.ownerName ?? ''

  // Map subject.comp ids → ChainNode display names (cap at 6 to fit page).
  const products = chainNodes.slice(0, 6)

  // Credit rating editor helpers — one row per rating, analyst can add/
  // delete rows in edit mode.
  const updateRatingRow = (idx: number, patch: Partial<CreditRatingLink>) => {
    const current = overrides.creditRatings != null ? overrides.creditRatings : qualitative.creditRating
    const next = current.map((r, i) => (i === idx ? { ...r, ...patch } : r))
    setOverride('creditRatings', next)
  }
  const addRatingRow = () => {
    const current = overrides.creditRatings != null ? overrides.creditRatings : qualitative.creditRating
    setOverride('creditRatings', [...current, { title: '', url: '', date: null }])
  }
  const removeRatingRow = (idx: number) => {
    const current = overrides.creditRatings != null ? overrides.creditRatings : qualitative.creditRating
    setOverride('creditRatings', current.filter((_, i) => i !== idx))
  }

  // Numeric input helper — parses to float, clamps to 0–100 for pct fields.
  const parseNumPct = (s: string): number | null => {
    const trimmed = s.trim()
    if (trimmed === '' || trimmed === '-') return null
    const n = parseFloat(trimmed.replace(/[%,]/g, ''))
    if (!Number.isFinite(n)) return null
    if (n < 0) return 0
    if (n > 100) return 100
    return n
  }

  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Company Details" pageNum="3" />
      <span className="dn-eyebrow">Company Profile — Ownership, Credit, Compliance, Product Basket</span>
      <h2 className="dn-h2" style={{ marginBottom: 8 }}>{subject.name} — Company Snapshot</h2>
      <hr className="dn-rule" />

      {editMode && (
        <div className="dn-edit-banner dn-screen-only">
          <strong>Edit mode active.</strong> Click any value to override. Changes persist per-ticker in this browser.
          Fields tagged <span className="dn-est-badge">Est.</span> are sector-median estimates until you provide a value.
        </div>
      )}

      <div className="dn-two-col" style={{ marginTop: 10 }}>
        {/* LEFT: Ownership + business cycle */}
        <div>
          <h3 className="dn-h3" style={{ marginBottom: 4 }}>Ownership & Control</h3>
          <table className="dn-table compact" style={{ marginBottom: 10 }}>
            <tbody>
              {(ownerName || editMode) && (
                <tr>
                  <td className="label" style={{ width: '38%' }}>Promoter / Owner</td>
                  <td>
                    <EditableField
                      value={ownerName}
                      editMode={editMode}
                      placeholder="e.g. Hitesh Chimanlal Doshi & Family"
                      onSave={(v) => setOverride('ownerName', v || null)}
                      width="100%"
                    />
                  </td>
                </tr>
              )}
              <tr>
                <td className="label" style={{ width: '38%' }}>Promoter Holding</td>
                <td className="num mono">
                  <EditableField
                    value={promoter.value == null ? '' : String(promoter.value)}
                    editMode={editMode}
                    type="number"
                    suffix="%"
                    isEst={promoter.isEst}
                    displayValue={fmtPct(promoter.value)}
                    onSave={(v) => setOverride('promoterPct', parseNumPct(v))}
                  />
                </td>
              </tr>
              <tr>
                <td className="label">Promoter Pledged</td>
                <td className="num mono" style={{ color: pledged.value && pledged.value > 30 ? 'var(--red)' : undefined }}>
                  <EditableField
                    value={pledged.value == null ? '' : String(pledged.value)}
                    editMode={editMode}
                    type="number"
                    suffix="%"
                    isEst={pledged.isEst}
                    displayValue={fmtPct(pledged.value)}
                    onSave={(v) => setOverride('pledgedPct', parseNumPct(v))}
                  />
                </td>
              </tr>
              <tr>
                <td className="label">FII / FPI Holding</td>
                <td className="num mono">
                  <EditableField
                    value={fii.value == null ? '' : String(fii.value)}
                    editMode={editMode}
                    type="number"
                    suffix="%"
                    isEst={fii.isEst}
                    displayValue={fmtPct(fii.value)}
                    onSave={(v) => setOverride('fiiPct', parseNumPct(v))}
                  />
                </td>
              </tr>
              <tr>
                <td className="label">DII / Mutual Fund Holding</td>
                <td className="num mono">
                  <EditableField
                    value={dii.value == null ? '' : String(dii.value)}
                    editMode={editMode}
                    type="number"
                    suffix="%"
                    isEst={dii.isEst}
                    displayValue={fmtPct(dii.value)}
                    onSave={(v) => setOverride('diiPct', parseNumPct(v))}
                  />
                </td>
              </tr>
              <tr>
                <td className="label">Government Holding</td>
                <td className="num mono">
                  <EditableField
                    value={govt.value == null ? '' : String(govt.value)}
                    editMode={editMode}
                    type="number"
                    suffix="%"
                    isEst={govt.isEst}
                    displayValue={fmtPct(govt.value)}
                    onSave={(v) => setOverride('govtPct', parseNumPct(v))}
                  />
                </td>
              </tr>
              <tr>
                <td className="label">Public / Retail Holding</td>
                <td className="num mono">
                  <EditableField
                    value={publicR.value == null ? '' : String(publicR.value)}
                    editMode={editMode}
                    type="number"
                    suffix="%"
                    isEst={publicR.isEst}
                    displayValue={fmtPct(publicR.value)}
                    onSave={(v) => setOverride('publicPct', parseNumPct(v))}
                  />
                </td>
              </tr>
              <tr>
                <td className="label">As-of period</td>
                <td className="num mono">
                  <EditableField
                    value={shAsOf}
                    editMode={editMode}
                    isEst={shAsOfIsEst}
                    placeholder="e.g. Dec 2024"
                    onSave={(v) => setOverride('shAsOf', v || null)}
                    width={140}
                  />
                </td>
              </tr>
            </tbody>
          </table>

          <h3 className="dn-h3" style={{ marginBottom: 4 }}>Business Cycle Position</h3>
          <table className="dn-table compact" style={{ marginBottom: 10 }}>
            <tbody>
              <tr>
                <td className="label" style={{ width: '38%' }}>Sector Life-Cycle Phase</td>
                <td>
                  <EditableField
                    value={cyclePhase}
                    editMode={editMode}
                    isEst={cyclePhaseIsEst}
                    onSave={(v) => setOverride('cyclePhase', v || null)}
                    width="100%"
                  />
                </td>
              </tr>
              <tr>
                <td className="label">Cycle Driver</td>
                <td style={{ fontSize: 9.5 }}>
                  <EditableField
                    value={cycleDriver}
                    editMode={editMode}
                    type="textarea"
                    isEst={cycleDriverIsEst}
                    onSave={(v) => setOverride('cycleDriver', v || null)}
                    width="100%"
                  />
                </td>
              </tr>
              <tr>
                <td className="label">Acquisition Score</td>
                <td className="num mono" style={{ fontWeight: 700 }}>{subject.acqs}/10</td>
              </tr>
              <tr>
                <td className="label">Acquisition Flag</td>
                <td>{subject.acqf}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* RIGHT: Credit rating + compliance */}
        <div>
          <h3 className="dn-h3" style={{ marginBottom: 4, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            Credit Ratings
            {editMode && (
              <button
                type="button"
                className="dn-edit-mini-btn dn-screen-only-inline"
                onClick={addRatingRow}
              >
                + Add row
              </button>
            )}
          </h3>
          {ratings.length === 0 && !editMode ? (
            <div className="dn-narrative" style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 10 }}>
              No rating-agency documents available for this ticker. Use
              the toolbar <strong>✎ Edit</strong> button to manually add
              CRISIL / CARE / ICRA grades — or run the Fetch Qualitative
              sweep from the admin page to pull Screener doc links.
            </div>
          ) : (
            <table className="dn-table compact" style={{ marginBottom: 10 }}>
              <thead>
                <tr>
                  <th>Rating / Agency / Document</th>
                  <th>Date</th>
                  {editMode && <th style={{ width: 28 }}></th>}
                </tr>
              </thead>
              <tbody>
                {ratings.slice(0, 5).map((r, i) => (
                  <tr key={i}>
                    <td style={{ fontSize: 9, lineHeight: 1.35 }}>
                      {editMode ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <EditableField
                            value={r.title}
                            editMode={true}
                            placeholder="e.g. CRISIL AA+/Stable"
                            onSave={(v) => updateRatingRow(i, { title: v })}
                            width="100%"
                          />
                          <EditableField
                            value={r.url}
                            editMode={true}
                            type="url"
                            placeholder="https://... rationale PDF link"
                            onSave={(v) => updateRatingRow(i, { url: v })}
                            width="100%"
                          />
                        </div>
                      ) : r.url ? (
                        <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink)' }}>
                          {r.title.length > 90 ? r.title.slice(0, 88) + '…' : r.title}
                        </a>
                      ) : (
                        <span>{r.title}</span>
                      )}
                    </td>
                    <td className="mono" style={{ fontSize: 9 }}>
                      <EditableField
                        value={r.date ?? ''}
                        editMode={editMode}
                        placeholder="2024-09"
                        onSave={(v) => updateRatingRow(i, { date: v || null })}
                        width={80}
                      />
                    </td>
                    {editMode && (
                      <td>
                        <button
                          type="button"
                          className="dn-edit-mini-btn dn-screen-only-inline danger"
                          onClick={() => removeRatingRow(i)}
                          title="Remove this rating row"
                        >×</button>
                      </td>
                    )}
                  </tr>
                ))}
                {editMode && ratings.length === 0 && (
                  <tr><td colSpan={3} style={{ fontSize: 9, color: 'var(--muted)', padding: 8 }}>
                    No ratings yet. Click <strong>+ Add row</strong> above.
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
          {ratingsIsEst && !editMode && ratings.length > 0 && <EstBadge visible={true} />}

          <h3 className="dn-h3" style={{ marginBottom: 4 }}>Compliance & Stress Markers</h3>
          <table className="dn-table compact" style={{ marginBottom: 10 }}>
            <tbody>
              <tr>
                <td className="label" style={{ width: '38%' }}>CDR (Corp Debt Restructuring)</td>
                <td>
                  <EditableField
                    value={cdrNote}
                    editMode={editMode}
                    type="textarea"
                    isEst={cdrIsEst}
                    onSave={(v) => setOverride('cdrNote', v || null)}
                    width="100%"
                  />
                  <span style={{ display: 'block', fontSize: 8.5, color: 'var(--muted)', marginTop: 2 }}>
                    Cross-check against CIBIL / Wilful Defaulter list before deal close.
                  </span>
                </td>
              </tr>
              <tr>
                <td className="label">NCLT Cases</td>
                <td>
                  <EditableField
                    value={ncltNote}
                    editMode={editMode}
                    type="textarea"
                    isEst={ncltIsEst}
                    onSave={(v) => setOverride('ncltNote', v || null)}
                    width="100%"
                  />
                  <span style={{ display: 'block', fontSize: 8.5, color: 'var(--muted)', marginTop: 2 }}>
                    NCLT.gov.in requires JS rendering + captcha; dedicated paid feed needed for full coverage.
                  </span>
                </td>
              </tr>
              <tr>
                <td className="label">Pledged-Equity Risk</td>
                <td>
                  {pledged.value == null
                    ? '—'
                    : pledged.value > 30
                      ? `Elevated — ${pledged.value.toFixed(1)}% of promoter holding pledged.`
                      : pledged.value > 10
                        ? `Moderate — ${pledged.value.toFixed(1)}% pledged.`
                        : `Low — ${pledged.value.toFixed(1)}% pledged.`}
                </td>
              </tr>
              <tr>
                <td className="label">Latest Annual Report</td>
                <td>
                  {editMode ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <EditableField
                        value={arUrl ?? ''}
                        editMode={true}
                        type="url"
                        placeholder="https://... AR PDF URL"
                        onSave={(v) => setOverride('arUrl', v || null)}
                        width="100%"
                      />
                      <EditableField
                        value={arYear == null ? '' : String(arYear)}
                        editMode={true}
                        type="number"
                        placeholder="FY year, e.g. 2024"
                        onSave={(v) => {
                          const n = parseInt(v, 10)
                          setOverride('arYear', Number.isFinite(n) ? n : null)
                        }}
                        width={80}
                      />
                    </div>
                  ) : arUrl ? (
                    <a href={arUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--ink)' }}>
                      FY{arYear || '—'} AR (PDF)
                    </a>
                  ) : (
                    <span style={{ color: 'var(--muted)' }}>Not fetched — use Edit mode to paste a link.</span>
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom row: Product Basket — full width */}
      <h3 className="dn-h3" style={{ marginBottom: 4, marginTop: 4 }}>Product / Service Basket</h3>
      {/* Sub-segment pinpoints from DealNector VC-Taxonomy. When the admin
          has narrowed the company down to specific product lines (TOPCon,
          HJT, XLPE EHV etc.), surface those chips right above the
          segment-level table so the reader can see the precise niche
          before the broader category context. Empty ⇒ "All (default)" —
          i.e. the company competes across every line in its stage. */}
      {(() => {
        const subs = (subject.subcomp || []) as string[]
        if (subs.length === 0) {
          return (
            <div
              className="dn-narrative"
              style={{
                fontSize: 9.5,
                color: 'var(--muted)',
                marginBottom: 6,
                fontStyle: 'italic',
              }}
            >
              Sub-segment coverage: <strong>All (default generalist)</strong> — company
              is treated as participating across every DealNector VC-Taxonomy
              sub-segment within its stage until narrowed by admin.
            </div>
          )
        }
        return (
          <div style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            <span style={{ fontSize: 9, color: 'var(--muted)', marginRight: 4, alignSelf: 'center' }}>
              Sub-segments:
            </span>
            {subs.map((s) => (
              <span
                key={s}
                style={{
                  fontSize: 9,
                  padding: '1px 6px',
                  borderRadius: 2,
                  background: 'var(--gold-soft)',
                  color: 'var(--gold-2)',
                  fontWeight: 600,
                  letterSpacing: '0.2px',
                }}
              >
                {getSubSegmentLabel(s)}
              </span>
            ))}
          </div>
        )
      })()}
      {products.length === 0 ? (
        <div className="dn-narrative" style={{ fontSize: 10, color: 'var(--muted)' }}>
          No value-chain segments mapped to this company.
        </div>
      ) : (
        <table className="dn-table compact">
          <thead>
            <tr>
              <th>Segment</th>
              <th>Category</th>
              <th>Industry Status</th>
              <th>Strategic Importance</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td className="label">{p.name}</td>
                <td style={{ fontSize: 9 }}>{p.cat}</td>
                <td style={{ fontSize: 9 }}>{p.mkt.ist}</td>
                <td style={{ fontSize: 9 }}>
                  <span style={{
                    display: 'inline-block', padding: '1px 6px', borderRadius: 2,
                    background: p.flag === 'critical' ? 'var(--red-soft)' : p.flag === 'high' ? 'var(--gold-soft)' : 'var(--rule-soft)',
                    color: p.flag === 'critical' ? 'var(--red)' : p.flag === 'high' ? 'var(--gold-2)' : 'var(--ink-2)',
                    fontSize: 8.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px',
                  }}>
                    {p.flag}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(overrides.analystNote || editMode) && (
        <div style={{ marginTop: 10 }}>
          <h3 className="dn-h3" style={{ marginBottom: 4 }}>Analyst Notes</h3>
          <EditableField
            value={overrides.analystNote ?? ''}
            editMode={editMode}
            type="textarea"
            placeholder="Deal-specific commentary, red flags, or source caveats — prints with the report."
            onSave={(v) => setOverride('analystNote', v || null)}
            width="100%"
          />
        </div>
      )}

      <div style={{ marginTop: 8, fontSize: 8.5, color: 'var(--muted)', fontStyle: 'italic' }}>
        Sources: Screener.in shareholding pattern + documents (free public HTML scrape).
        Fields tagged &ldquo;Est.&rdquo; are sector-median estimates pending analyst confirmation.
        Use the toolbar <strong>✎ Edit</strong> button to override any value — changes persist per-ticker
        in this browser and print as-is.
      </div>

      <PageFooter />
    </section>
  )
}

// ── Market Analysis (TAM / CAGR / competitive landscape / policy) ──
//
// One-pager that complements IndustryPolicyPage. IndustryPolicyPage
// focuses on the regulatory backdrop; this section is the demand-side
// scan: total addressable market, growth rate, who else competes,
// margin envelope. Aggregates across every value-chain node the
// subject participates in so a multi-segment company (Waaree-style)
// gets every market shown side-by-side.

function MarketAnalysisPage({
  subject,
  chainNodes,
  segmentCompanies,
}: {
  subject: Company
  chainNodes: ChainNode[]
  segmentCompanies: Company[]
}) {
  // Top peers in same segments by market cap — gives a quick "who am
  // I competing with" view that ties the segment context back to
  // listed-company comparables.
  const topPeers = segmentCompanies
    .filter((c) => c.ticker !== subject.ticker)
    .sort((a, b) => b.mktcap - a.mktcap)
    .slice(0, 5)

  return (
    <section className="dn-page">
      <PageHeader subject={subject} section="Market Analysis" pageNum="4" />
      <span className="dn-eyebrow">Market Scan — Sizing, Growth, Competitive Intensity, Margin Envelope</span>
      <h2 className="dn-h2" style={{ marginBottom: 8 }}>Addressable Market & Competitive Position</h2>
      <hr className="dn-rule" />

      {chainNodes.length === 0 ? (
        // No value-chain mapping — happens for newly-added SMEs before
        // an analyst tags their segments. Fall back to sector-level
        // context so the section isn't an empty placeholder. The admin
        // can still curate specific `comp` segments later to replace
        // this with the richer per-segment table.
        <>
          <h3 className="dn-h3" style={{ marginTop: 10, marginBottom: 4 }}>Sector Context</h3>
          <table className="dn-table compact" style={{ marginBottom: 12 }}>
            <tbody>
              <tr><td className="label" style={{ width: '30%' }}>Primary Sector</td>
                  <td>{sectorLabel(subject.sec)}</td></tr>
              <tr><td className="label">India Market Positioning</td>
                  <td>{sectorNarrative(subject.sec)}</td></tr>
              <tr><td className="label">Peers in Same Sector (Top 5)</td>
                  <td>{topPeers.length > 0
                    ? topPeers.map((p) => `${p.name} (${p.ticker})`).join(', ')
                    : '—'}</td></tr>
            </tbody>
          </table>
          <div className="dn-narrative" style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>
            Curate specific value-chain segments (`comp` mapping) via the admin
            Sector tagging tool to unlock the full per-segment TAM / CAGR /
            margin-envelope analysis.
          </div>
        </>
      ) : (
        <>
          {/* Market Sizing & Growth */}
          <h3 className="dn-h3" style={{ marginTop: 10, marginBottom: 4 }}>Market Sizing & Growth</h3>
          <table className="dn-table compact" style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th>Segment</th>
                <th className="num">India TAM</th>
                <th className="num">India CAGR</th>
                <th className="num">Global TAM</th>
                <th className="num">Global CAGR</th>
                <th>India Status</th>
              </tr>
            </thead>
            <tbody>
              {chainNodes.map((n) => (
                <tr key={n.id}>
                  <td className="label">{n.name}</td>
                  <td className="num mono">{n.mkt.ig}</td>
                  <td className="num mono dn-pos">{n.mkt.icagr}</td>
                  <td className="num mono">{n.mkt.gg}</td>
                  <td className="num mono">{n.mkt.gcagr}</td>
                  <td style={{ fontSize: 9 }}>{n.mkt.ist}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Competitive landscape — global leaders + local peers */}
          <div className="dn-two-col" style={{ marginBottom: 12 }}>
            <div>
              <h3 className="dn-h3" style={{ marginBottom: 4 }}>Global Leaders</h3>
              <table className="dn-table compact">
                <thead>
                  <tr><th>Segment</th><th>Global Concentration</th></tr>
                </thead>
                <tbody>
                  {chainNodes.map((n) => (
                    <tr key={n.id}>
                      <td className="label">{n.name}</td>
                      <td style={{ fontSize: 9 }}>{n.mkt.gc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div>
              <h3 className="dn-h3" style={{ marginBottom: 4 }}>Domestic Peers (Top 5 by Mkt Cap)</h3>
              {topPeers.length === 0 ? (
                <div className="dn-narrative" style={{ fontSize: 10, color: 'var(--muted)' }}>
                  No listed peers in this segment in the current universe.
                </div>
              ) : (
                <table className="dn-table compact">
                  <thead>
                    <tr><th>Company</th><th className="num">Mkt Cap</th><th className="num">Score</th></tr>
                  </thead>
                  <tbody>
                    {topPeers.map((p) => (
                      <tr key={p.ticker}>
                        <td className="label">{p.name} <span style={{ color: 'var(--muted)' }}>({p.ticker})</span></td>
                        <td className="num mono">{formatCr(p.mktcap)}</td>
                        <td className="num mono">{p.acqs}/10</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Margin envelope + capex intensity per segment */}
          <h3 className="dn-h3" style={{ marginBottom: 4 }}>Margin Envelope & Capital Intensity</h3>
          <table className="dn-table compact" style={{ marginBottom: 12 }}>
            <thead>
              <tr>
                <th>Segment</th>
                <th className="num">Gross Margin</th>
                <th className="num">EBITDA Margin</th>
                <th>CapEx Intensity</th>
                <th>Moat / Differentiator</th>
              </tr>
            </thead>
            <tbody>
              {chainNodes.map((n) => (
                <tr key={n.id}>
                  <td className="label">{n.name}</td>
                  <td className="num mono">{n.fin.gm}</td>
                  <td className="num mono">{n.fin.eb}</td>
                  <td style={{ fontSize: 9 }}>{n.fin.capex}</td>
                  <td style={{ fontSize: 9 }}>{n.fin.moat}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Policy backdrop summary */}
          {chainNodes.some((n) => n.pol && n.pol.length > 0) && (
            <>
              <h3 className="dn-h3" style={{ marginBottom: 4 }}>Policy Tailwinds Touching These Segments</h3>
              <table className="dn-table compact" style={{ marginBottom: 8 }}>
                <thead>
                  <tr><th>Segment</th><th>Applicable Policy / Scheme</th></tr>
                </thead>
                <tbody>
                  {chainNodes.map((n) => (
                    <tr key={n.id}>
                      <td className="label">{n.name}</td>
                      <td style={{ fontSize: 9 }}>{(n.pol || []).join(' · ') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div style={{ fontSize: 8.5, color: 'var(--muted)', fontStyle: 'italic' }}>
            Sources: DealNector value-chain atlas (curated). Policy mapping
            cross-referenced against MNRE/CEA notifications. Margin and
            capex bands are sector-typical — refer to Financial Analysis
            section for the subject's actual figures.
          </div>
        </>
      )}

      <PageFooter />
    </section>
  )
}

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
            <td className="num mono">{subject.revg.toFixed(1)}%</td>
            <td><span className={`flag flag-${subject.revg > 15 ? 'green' : subject.revg > 5 ? 'amber' : 'red'}`} style={{ fontSize: 9 }}>{subject.revg > 15 ? 'Strong' : subject.revg > 5 ? 'Adequate' : 'Weak'}</span></td>
          </tr>
          <tr>
            <td className="label">EBITDA Margin</td>
            <td style={{ fontSize: 9 }}>{subject.ebm > 15 ? 'Strong operating leverage — pricing power and cost efficiency confirmed' : subject.ebm > 8 ? 'Adequate margin with room for operational improvement' : 'Thin margin — limited buffer for cost absorption'}</td>
            <td className="num mono">{subject.ebm.toFixed(1)}%</td>
            <td><span className={`flag flag-${subject.ebm > 15 ? 'green' : subject.ebm > 8 ? 'amber' : 'red'}`} style={{ fontSize: 9 }}>{subject.ebm > 15 ? 'Strong' : subject.ebm > 8 ? 'Adequate' : 'Weak'}</span></td>
          </tr>
          <tr>
            <td className="label">Balance Sheet</td>
            <td style={{ fontSize: 9 }}>{subject.dbt_eq < 0.5 ? 'Conservative leverage — significant acquisition debt capacity' : subject.dbt_eq < 1.0 ? 'Manageable leverage within sector norms' : 'Elevated leverage — debt servicing requires monitoring'}</td>
            <td className="num mono">{subject.dbt_eq.toFixed(2)}× D/E</td>
            <td><span className={`flag flag-${subject.dbt_eq < 0.5 ? 'green' : subject.dbt_eq < 1.0 ? 'amber' : 'red'}`} style={{ fontSize: 9 }}>{subject.dbt_eq < 0.5 ? 'Strong' : subject.dbt_eq < 1.0 ? 'Adequate' : 'Weak'}</span></td>
          </tr>
          <tr>
            <td className="label">Valuation Multiple</td>
            <td style={{ fontSize: 9 }}>{subject.ev_eb < 15 ? 'Attractively valued relative to growth profile' : subject.ev_eb < 25 ? `Trading at ${peerAvgEvEb ? (subject.ev_eb > peerAvgEvEb ? 'a premium' : 'a discount') + ' to peer median' : 'moderate levels'}` : 'Premium valuation — high growth expectations embedded'}</td>
            <td className="num mono">{subject.ev_eb.toFixed(1)}× EV/EBITDA</td>
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
