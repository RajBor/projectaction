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

import { useEffect, useMemo, useState } from 'react'
import type { Company } from '@/lib/data/companies'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'
import { useIndustryAtlas } from '@/hooks/useIndustryAtlas'
import { useIndustryFilter } from '@/hooks/useIndustryFilter'
import {
  ANSOFF,
  PORTER,
  SEVEN_POWERS,
  HORIZONS,
  BCG,
  MCKINSEY,
  INTEGRATION,
  DEAL_STRUCTURES,
  SYNERGY_BUCKETS,
  VC_POSITIONS,
  type AnsoffVector,
  type PorterStrategy,
  type SevenPower,
  type BcgQuadrant,
  type McKinseyHorizon,
  type IntegrationMode,
  type DealStructure,
  type SynergyBucket,
  type VcPosition,
} from '@/lib/op-identifier/frameworks'
import {
  identifyTargets,
  buildPlan,
  matchLenders,
  projectBalanceSheet,
  narratePlacement,
  recommendTargetCount,
  type OpTarget,
  type OpInputs,
} from '@/lib/op-identifier/algorithm'
import {
  TAXONOMY_STAGES,
  TAXONOMY_INDUSTRIES,
  getStagesForIndustry,
  industryLabel,
  industryCodeFor,
  COMP_TO_STAGE_CODE,
  getSubSegmentById,
} from '@/lib/data/sub-segments'
import { recommendTargetScope, type RecommendationLens } from '@/lib/op-identifier/recommender'
import {
  generateOpReport,
  REPORT_SECTION_LABELS,
  REPORT_PRESETS,
  type ReportBundle,
  type ReportSectionId,
} from '@/lib/op-identifier/report'
import { REGION_LABELS, type ExportRegionId } from '@/lib/op-identifier/geography'

const PANEL: React.CSSProperties = {
  background: 'var(--s2)',
  border: '1px solid var(--br)',
  borderRadius: 12,
  padding: '26px 30px',
  marginBottom: 22,
  boxShadow: '0 1px 0 rgba(255,255,255,0.02), 0 8px 28px rgba(0,0,0,0.18)',
  position: 'relative',
}

const SECTION_HEADING_BLOCK: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 12,
  paddingBottom: 14,
  marginBottom: 18,
  borderBottom: '1px solid var(--br)',
}

const H1: React.CSSProperties = {
  fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
  fontSize: 30,
  fontWeight: 700,
  color: 'var(--txt)',
  margin: 0,
  letterSpacing: '-0.015em',
  lineHeight: 1.2,
}

const H2: React.CSSProperties = {
  fontFamily: 'Source Serif 4, Georgia, serif',
  fontSize: 17,
  fontWeight: 700,
  letterSpacing: '-0.005em',
  color: 'var(--txt)',
  marginBottom: 0,
  textTransform: 'none',
}

const EYEBROW: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '2px',
  textTransform: 'uppercase',
  color: 'var(--gold2)',
  fontFamily: 'JetBrains Mono, ui-monospace, monospace',
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

const shareItemStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--txt2)',
  border: 'none',
  padding: '6px 10px',
  fontSize: 11,
  textAlign: 'left',
  cursor: 'pointer',
  borderRadius: 3,
  fontFamily: 'inherit',
}

const SECTION_LABEL: React.CSSProperties = {
  fontSize: 9,
  color: 'var(--gold2)',
  fontWeight: 700,
  letterSpacing: '1px',
  textTransform: 'uppercase',
  marginBottom: 6,
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
  const [acquirerFilter, setAcquirerFilter] = useState<string>('')
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

  // ── Framework preference multi-selects ──────────────────────
  // Each array is empty by default (no filter). Click a card chip to
  // toggle. Matching targets get a small conviction boost; nothing is
  // hard-filtered, so strong outliers still surface.
  const [preferredSevenPowers, setPreferredSevenPowers] = useState<SevenPower[]>([])
  const [preferredBcg, setPreferredBcg] = useState<BcgQuadrant[]>([])
  const [preferredMcKinsey, setPreferredMcKinsey] = useState<McKinseyHorizon[]>([])
  const [preferredIntegrationModes, setPreferredIntegrationModes] = useState<IntegrationMode[]>([])
  const [preferredDealStructures, setPreferredDealStructures] = useState<DealStructure[]>([])
  const [preferredSynergyBuckets, setPreferredSynergyBuckets] = useState<SynergyBucket[]>([])
  const [preferredVcPositions, setPreferredVcPositions] = useState<VcPosition[]>([])
  const [preferredSubSegments, setPreferredSubSegments] = useState<string[]>([])
  const [subSegmentFilter, setSubSegmentFilter] = useState<string>('')
  const [preferredGeographies, setPreferredGeographies] = useState<ExportRegionId[]>([])
  // Target scope — hierarchical: industries → stages → sub-segments.
  // All three lists compound as conviction boosts in the ranker. The UI
  // is a nested accordion: pick industries first; each shows its stages;
  // pick stages to expose their sub-segments.
  const [targetIndustries, setTargetIndustries] = useState<string[]>([])
  const [targetStages, setTargetStages] = useState<string[]>([])
  // Mode toggle: manual vs system-recommended scope. Manual is the
  // default so existing users aren't disrupted. Flipping to 'system'
  // reveals the recommendation card with Apply buttons.
  const [scopeMode, setScopeMode] = useState<'manual' | 'system'>('manual')
  const [activeLens, setActiveLens] = useState<RecommendationLens | null>(null)
  function togglePref<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, value: T) {
    setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]))
  }

  // Filtered acquirer universe for the dropdown search.
  const filteredUniverse = useMemo(() => {
    const q = acquirerFilter.trim().toLowerCase()
    if (!q) return universe
    return universe.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.ticker.toLowerCase().includes(q) ||
        (c.sec || '').toLowerCase().includes(q),
    )
  }, [universe, acquirerFilter])

  // Sub-segments available for the acquirer's sector (or all when no
  // sector chosen). Filtered by user's text input.
  const availableSubSegments = useMemo(() => {
    const q = subSegmentFilter.trim().toLowerCase()
    const stages = TAXONOMY_STAGES
    const subs: Array<{ id: string; label: string; stageCode: string }> = []
    for (const s of stages) {
      for (const sub of s.subs) {
        if (!q || sub.name.toLowerCase().includes(q) || sub.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) {
          subs.push({ id: sub.id, label: sub.name, stageCode: s.code })
        }
      }
    }
    return subs // full 668-sub-segment taxonomy; scroll container keeps it usable
  }, [subSegmentFilter])

  const acquirer = useMemo<Company | null>(
    () => universe.find((c) => c.ticker === acquirerTicker) || null,
    [universe, acquirerTicker],
  )

  // ── Acquirer CURRENT posture (auto-derived, read-only) ─────
  // What the acquirer already IS on the DealNector VC Taxonomy:
  //   industries covered (from sec + comp),
  //   value-chain stages covered (from comp[] → COMP_TO_STAGE_CODE),
  //   sub-segments covered (via getSubSegmentsForComp).
  // The Target scope picker is pre-filled with this set so the user
  // can start from the acquirer's own posture and layer expansion
  // stages / sub-segments on top.
  const acquirerPosture = useMemo(() => {
    if (!acquirer) return { industries: [] as string[], stages: [] as string[], subSegmentIds: [] as string[] }
    const industries = new Set<string>()
    const stages = new Set<string>()
    const subIds = new Set<string>()
    const indCode = industryCodeFor(acquirer.sec)
    if (indCode) industries.add(indCode)
    for (const c of acquirer.comp || []) {
      const key = c.toLowerCase()
      const stg = COMP_TO_STAGE_CODE[key]
      if (stg) {
        stages.add(stg)
        const stageIndustry = stg.split('.')[0]
        if (stageIndustry) industries.add(stageIndustry)
      }
    }
    return {
      industries: Array.from(industries),
      stages: Array.from(stages),
      subSegmentIds: Array.from(subIds),
    }
  }, [acquirer])

  // ── System recommendation: where-to-play based on current
  //    posture + Ansoff/Porter + revenue gap. Deterministic.
  //    Always computed; the UI only surfaces it when scopeMode = 'system'.
  const recommendation = useMemo(() => {
    if (!acquirer) return null
    return recommendTargetScope({
      acquirer,
      ansoff,
      porter,
      targetRevenueCr: Number(targetRevenueCr) || 0,
      horizonMonths,
    })
  }, [acquirer, ansoff, porter, targetRevenueCr, horizonMonths])

  // Auto-select the dominant lens when the recommender updates.
  useEffect(() => {
    if (recommendation && activeLens === null) {
      setActiveLens(recommendation.dominantLens)
    }
  }, [recommendation, activeLens])

  // Helpers to apply a lens bundle or dedupe-merge it onto existing picks.
  function applyLensBundle(lens: RecommendationLens, mode: 'replace' | 'merge') {
    if (!recommendation) return
    const bundle = recommendation.lensBundles[lens]
    if (mode === 'replace') {
      setTargetIndustries(bundle.industries)
      setTargetStages(bundle.stages)
      setPreferredSubSegments(bundle.subSegments)
    } else {
      setTargetIndustries((prev) => Array.from(new Set([...prev, ...bundle.industries])))
      setTargetStages((prev) => Array.from(new Set([...prev, ...bundle.stages])))
      setPreferredSubSegments((prev) => Array.from(new Set([...prev, ...bundle.subSegments])))
    }
  }
  function applyFullRecommendation() {
    if (!recommendation) return
    const allInd = Array.from(new Set(recommendation.industries.map((i) => i.code)))
    const allStg = Array.from(new Set(recommendation.stages.map((s) => s.code)))
    const allSub = Array.from(new Set(recommendation.subSegments.map((s) => s.id)))
    setTargetIndustries(allInd)
    setTargetStages(allStg)
    setPreferredSubSegments(allSub)
  }

  // ── Derived target-profile thresholds ────────────────────────
  // Target Revenue + Horizon give direction to the entire inorganic
  // programme: what size of targets to hunt, what margin floor to
  // require, what growth floor, and what deal-size band is feasible.
  // These thresholds are soft — they inform UI labels and report
  // narrative but don't hard-filter the ranked list (the scoring
  // model's sizeFit / growthFit / marginFit already use them).
  const derivedProfile = useMemo(() => {
    const currentRev = acquirer?.rev || 0
    const goalRev = Number(targetRevenueCr) || 0
    const horizonYears = horizonMonths / 12
    const gap = Math.max(0, goalRev - currentRev)
    const impliedCagr = currentRev > 0 && horizonYears > 0 && goalRev > currentRev
      ? (Math.pow(goalRev / currentRev, 1 / horizonYears) - 1) * 100
      : 0
    // Assume 3-5 deals to absorb the gap (typical M&A programme cadence)
    const minDealRev = gap > 0 ? Math.round(gap / 5) : 0
    const maxDealRev = gap > 0 ? Math.round(gap / 2) : 0
    // Deal-value band using EV/Revenue ≈ 2× (industrial median proxy)
    const minDealSize = Math.round(minDealRev * 2)
    const maxDealSize = Math.round(maxDealRev * 3) // stretch with quality premium
    // Margin floor: higher of acquirer's margin or 12% (industrial median)
    const preferredMarginFloor = Math.max(12, Math.round(acquirer?.ebm || 0))
    // Growth floor: higher of acquirer's growth or 15% (sector median for growth-ambitious acquirer)
    const preferredGrowthFloor = Math.max(15, Math.round(acquirer?.revg || 0))
    // Implied target count — how many deals to land the gap
    const midDealRev = (minDealRev + maxDealRev) / 2 || 1
    const impliedTargetCount = gap > 0 ? Math.max(1, Math.min(8, Math.round(gap / midDealRev))) : 0
    return {
      currentRev, goalRev, gap, horizonYears, impliedCagr,
      minDealRev, maxDealRev, minDealSize, maxDealSize,
      preferredMarginFloor, preferredGrowthFloor,
      impliedTargetCount,
    }
  }, [acquirer, targetRevenueCr, horizonMonths])

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
    // Auto-seed the hierarchical Target Scope picker with the acquirer's
    // own posture — industries it operates in + value-chain stages its
    // comp[] maps to. The analyst can then extend (into adjacent stages,
    // diversification industries) or prune (narrow to a single stage).
    const indCode = industryCodeFor(co.sec)
    const indSet = new Set<string>()
    const stageSet = new Set<string>()
    if (indCode) indSet.add(indCode)
    for (const c of co.comp || []) {
      const key = c.toLowerCase()
      const stg = COMP_TO_STAGE_CODE[key]
      if (stg) {
        stageSet.add(stg)
        const iCode = stg.split('.')[0]
        if (iCode) indSet.add(iCode)
      }
    }
    setTargetIndustries(Array.from(indSet))
    setTargetStages(Array.from(stageSet))
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
      preferredSevenPowers,
      preferredBcg,
      preferredMcKinsey,
      preferredIntegrationModes,
      preferredDealStructures,
      preferredSynergyBuckets,
      preferredVcPositions,
      preferredSubSegments,
      preferredGeographies,
      targetIndustries,
      targetStages,
    }),
    [
      targetRevenueCr, horizonMonths, ansoff, porter, sectorsOfInterest,
      dealSizeMinCr, dealSizeMaxCr, ownership,
      preferredSevenPowers, preferredBcg, preferredMcKinsey,
      preferredIntegrationModes, preferredDealStructures,
      preferredSynergyBuckets, preferredVcPositions, preferredSubSegments,
      preferredGeographies, targetIndustries, targetStages,
    ],
  )

  const ranked = useMemo<OpTarget[]>(() => {
    if (!acquirer || !ran) return []
    return identifyTargets(acquirer, universe, inputs)
  }, [acquirer, universe, inputs, ran])

  const displayed = ranked.slice(0, 30)
  const targetCountRec = useMemo(
    () => (acquirer && ran ? recommendTargetCount(acquirer.rev || 0, Number(targetRevenueCr) || 0, ranked, ownershipPct) : null),
    [acquirer, ran, targetRevenueCr, ranked, ownershipPct],
  )

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

  // ── Report state (preview modal + download + sections) ──────
  const [report, setReport] = useState<ReportBundle | null>(null)
  const [reportPreset, setReportPreset] = useState<'full_memo' | 'executive_brief' | 'ic_grade' | 'custom'>('full_memo')
  const [reportSections, setReportSections] = useState<ReportSectionId[]>(
    REPORT_PRESETS.full_memo as ReportSectionId[],
  )
  function applyPreset(p: 'full_memo' | 'executive_brief' | 'ic_grade') {
    setReportPreset(p)
    setReportSections(REPORT_PRESETS[p] as ReportSectionId[])
  }
  function toggleSection(id: ReportSectionId) {
    setReportPreset('custom')
    setReportSections((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    )
  }
  const [showShareMenu, setShowShareMenu] = useState(false)
  const generateReport = () => {
    if (!acquirer || !plan || selectedTargets.length === 0) return
    const selectedStructures = selectedTargets.map((t) => t.dealStructure)
    const totalFund = plan.totalFundRequiredCr
    const selTargetRev = selectedTargets.reduce((s, t) => s + t.revCr * ownershipPct, 0)
    const selTargetEbitda = selectedTargets.reduce((s, t) => s + t.ebitdaCr * ownershipPct, 0)
    const lenders = matchLenders(acquirer, totalFund, selectedStructures)
    const balance = projectBalanceSheet(acquirer, totalFund, selTargetRev, selTargetEbitda)
    // Post mktcap estimate: current mktcap + (selected EV × ownership) - debt raised.
    const postMktCapEstimate = Math.max(
      0,
      (acquirer.mktcap || 0) + selectedTargets.reduce((s, t) => s + t.evCr * ownershipPct * 0.7, 0),
    )
    const placement = narratePlacement(
      acquirer,
      acquirer.rev || 0,
      plan.projectedRevCr,
      acquirer.mktcap || 0,
      postMktCapEstimate,
    )
    const bundle = generateOpReport({
      acquirer,
      inputs,
      selected: selectedTargets,
      allRanked: ranked,
      plan,
      lenders,
      balance,
      placement,
      postMktCapEstimate,
      sections: reportSections,
    })
    setReport(bundle)
  }
  const printReport = () => {
    const iframe = document.getElementById('op-report-iframe') as HTMLIFrameElement | null
    if (!iframe?.contentWindow) return
    iframe.contentWindow.focus()
    iframe.contentWindow.print()
  }
  const shareMailto = () => {
    if (!report) return
    const subject = encodeURIComponent(report.title)
    const body = encodeURIComponent(
      `${report.title}\n${report.subtitle}\n\nReport ID: ${report.id}\nGenerated: ${new Date(report.generatedAt).toLocaleString('en-IN')}\n\nOpen the attached HTML in a browser for the full institutional memo.`,
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }
  const copyReportLink = async () => {
    if (!report) return
    try {
      const blob = new Blob([report.html], { type: 'text/html;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      await navigator.clipboard.writeText(url)
      setShowShareMenu(false)
      alert('Report blob link copied to clipboard (session-scoped — paste into a new tab).')
    } catch {
      alert('Could not access clipboard. Use Download HTML instead.')
    }
  }
  const downloadReport = () => {
    if (!report) return
    const blob = new Blob([report.html], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${report.acquirerTicker}-op-identifier-${report.id}.html`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

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
    <div
      style={{
        background:
          'radial-gradient(1200px 600px at 20% -10%, rgba(212,164,59,0.06), transparent 60%), radial-gradient(900px 500px at 90% 10%, rgba(0,180,216,0.05), transparent 60%), var(--bg)',
        minHeight: '100vh',
      }}
    >
      {/* Hero band — magazine-style intro */}
      <div
        style={{
          borderBottom: '1px solid var(--br)',
          padding: '40px 32px 32px',
          background: 'linear-gradient(180deg, rgba(212,164,59,0.04) 0%, transparent 100%)',
        }}
      >
        <div style={{ maxWidth: 1280, margin: '0 auto' }}>
          <div
            style={{
              fontSize: 10,
              color: 'var(--gold2)',
              letterSpacing: '2.5px',
              textTransform: 'uppercase',
              fontWeight: 700,
              marginBottom: 10,
            }}
          >
            <span className="dn-wordmark">Deal<em>Nector</em></span>{' '}
            <span style={{ opacity: 0.5 }}>/</span> Institutional M&amp;A Intelligence{' '}
            <span style={{ opacity: 0.5 }}>/</span> Op Identifier
          </div>
          <h1 style={H1}>
            Inorganic growth,{' '}
            <em style={{ color: 'var(--gold2)', fontStyle: 'italic', fontWeight: 600 }}>engineered</em>
          </h1>
          <p
            style={{
              fontSize: 14,
              lineHeight: 1.65,
              color: 'var(--txt2)',
              marginTop: 14,
              maxWidth: 780,
            }}
          >
            Pick an acquirer from the live universe. Set a revenue goal and horizon. DealNector ranks the
            company database against eight deterministic sub-scores — sector fit, deal-size match, growth,
            margin, Ansoff, Porter, policy tailwinds, and sub-segment overlap — then rolls up fund
            requirement, integration archetype, and revenue achievability. Every number is traceable;
            every recommendation carries its reasoning.
          </p>
          <div style={{ display: 'flex', gap: 24, marginTop: 20, flexWrap: 'wrap', fontSize: 11, color: 'var(--txt3)' }}>
            <span>
              <strong style={{ color: 'var(--txt2)' }}>{universe.length}</strong> companies in the live
              universe
            </span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>
              <strong style={{ color: 'var(--txt2)' }}>9</strong> strategic frameworks interlocked
            </span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>
              <strong style={{ color: 'var(--txt2)' }}>668</strong> sub-segments in the VC taxonomy
            </span>
            <span style={{ opacity: 0.4 }}>·</span>
            <span>
              <strong style={{ color: 'var(--txt2)' }}>8</strong> export corridors mapped
            </span>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '32px 32px 80px' }}>
        {/* §1 Acquirer + inputs */}
        <div style={PANEL}>
          <div style={SECTION_HEADING_BLOCK}>
            <div>
              <div style={EYEBROW}>Chapter 01</div>
              <h2 style={H2}>Acquirer &amp; Growth Ambition</h2>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11, color: 'var(--txt3)', textAlign: 'right', maxWidth: 320 }}>
              The mandate that anchors the search: who is acquiring, how much revenue to land, in what horizon.
            </div>
          </div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={LABEL}>
              Acquirer (company) — {filteredUniverse.length} of {universe.length}
            </label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="text"
                placeholder="Filter by name / ticker / sector…"
                value={acquirerFilter}
                onChange={(e) => setAcquirerFilter(e.target.value)}
                style={{ ...INPUT, flex: '0 0 40%' }}
              />
              <select value={acquirerTicker} onChange={(e) => pickAcquirer(e.target.value)} style={{ ...INPUT, flex: 1 }}>
                <option value="">— Select acquirer —</option>
                {filteredUniverse.map((c) => (
                  <option key={c.ticker} value={c.ticker}>
                    {c.name} ({c.ticker}){c.sec ? ` — ${c.sec}` : ''}
                  </option>
                ))}
              </select>
            </div>
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

        {acquirer && derivedProfile.gap > 0 && (
          <div
            style={{
              marginTop: 12,
              padding: 14,
              background: 'rgba(212,164,59,0.06)',
              border: '1px solid var(--gold2)',
              borderRadius: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--gold2)' }}>
                ◆ Derived Target Profile · thresholds that direct the search
              </div>
              <div style={{ fontSize: 10, color: 'var(--txt3)' }}>
                Gap: <strong style={{ color: 'var(--gold2)' }}>{fmtCr(derivedProfile.gap)}</strong> over{' '}
                <strong style={{ color: 'var(--gold2)' }}>{horizonMonths}m</strong> · implied CAGR{' '}
                <strong style={{ color: 'var(--gold2)' }}>{derivedProfile.impliedCagr.toFixed(1)}%</strong>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, fontSize: 11, marginBottom: 10 }}>
              <Stat label="Target revenue size band" value={`${fmtCr(derivedProfile.minDealRev)} – ${fmtCr(derivedProfile.maxDealRev)}`} color="var(--gold2)" />
              <Stat label="Implied deal-value band" value={`${fmtCr(derivedProfile.minDealSize)} – ${fmtCr(derivedProfile.maxDealSize)}`} color="var(--cyan2)" />
              <Stat label="Preferred EBITDA margin floor" value={`≥ ${derivedProfile.preferredMarginFloor}%`} color="var(--green)" />
              <Stat label="Preferred revenue growth floor" value={`≥ ${derivedProfile.preferredGrowthFloor}%`} color="var(--green)" />
            </div>

            <div style={{ fontSize: 10, color: 'var(--txt2)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--txt)' }}>Search direction:</strong> close the{' '}
              <strong style={{ color: 'var(--gold2)' }}>{fmtCr(derivedProfile.gap)}</strong> revenue gap via{' '}
              <strong style={{ color: 'var(--gold2)' }}>~{derivedProfile.impliedTargetCount}</strong> acquisitions of{' '}
              {fmtCr(derivedProfile.minDealRev)}–{fmtCr(derivedProfile.maxDealRev)} revenue each, biased toward{' '}
              margin ≥ <strong>{derivedProfile.preferredMarginFloor}%</strong> and growth{' '}
              ≥ <strong>{derivedProfile.preferredGrowthFloor}%</strong>. These thresholds inform the sizeFit / growthFit / marginFit
              sub-scores in the ranker and auto-seed your deal-size band below.
            </div>

            <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 10, alignItems: 'center' }}>
              <span style={{ color: 'var(--txt3)' }}>Your current deal-size setting:</span>
              <span style={{
                padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                background: 'var(--s3)', border: '1px solid var(--br)', color: 'var(--txt2)',
              }}>
                ₹{Number(dealSizeMinCr).toLocaleString('en-IN')} – ₹{Number(dealSizeMaxCr).toLocaleString('en-IN')} Cr
              </span>
              <button
                onClick={() => {
                  setDealSizeMinCr(String(derivedProfile.minDealSize || 200))
                  setDealSizeMaxCr(String(derivedProfile.maxDealSize || 10000))
                }}
                style={{
                  padding: '3px 10px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                  background: 'var(--gold2)', color: '#000', border: 'none',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
                title="Snap the deal-size band to the derived threshold"
              >
                Snap to derived
              </button>
            </div>
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
        <div style={SECTION_HEADING_BLOCK}>
          <div>
            <div style={EYEBROW}>Chapter 02</div>
            <h2 style={H2}>Strategic Framework</h2>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ fontSize: 11, color: 'var(--txt3)', textAlign: 'right', maxWidth: 380 }}>
            Nine frameworks interlocked — pick the lenses that match the thesis. Preferences nudge conviction; they do not hard-filter.
          </div>
        </div>
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
            title={`Seven Powers (${preferredSevenPowers.length} selected)`}
            body={
              <div style={{ fontSize: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {SEVEN_POWERS.map((p) => {
                  const on = preferredSevenPowers.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePref(setPreferredSevenPowers, p.id)}
                      style={{
                        textAlign: 'left',
                        padding: '6px 8px', borderRadius: 4, cursor: 'pointer',
                        background: on ? 'rgba(0,180,216,0.18)' : 'var(--s3)',
                        border: `1px solid ${on ? 'var(--cyan2)' : 'var(--br)'}`,
                        color: on ? 'var(--cyan2)' : 'var(--txt2)',
                        fontFamily: 'inherit', fontSize: 10,
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>{on ? '✓ ' : ''}{p.label}</span>
                      <span style={{ color: on ? 'var(--cyan2)' : 'var(--txt3)', marginLeft: 6 }}>· {p.cue}</span>
                    </button>
                  )
                })}
              </div>
            }
          />
        </div>
        {/* Row 2 — portfolio & integration lenses */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 12 }}>
          <FrameworkCard
            title={`BCG Growth-Share (${preferredBcg.length} preferred)`}
            body={
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, fontSize: 10 }}>
                {BCG.map((q) => {
                  const on = preferredBcg.includes(q.id)
                  return (
                    <button
                      key={q.id}
                      onClick={() => togglePref(setPreferredBcg, q.id)}
                      style={{
                        textAlign: 'left',
                        padding: 8, borderRadius: 4, cursor: 'pointer',
                        background: on ? `color-mix(in srgb, ${q.color} 18%, transparent)` : 'var(--s3)',
                        border: `1px solid ${on ? q.color : 'var(--br)'}`,
                        fontFamily: 'inherit',
                      }}
                    >
                      <div style={{ fontWeight: 700, color: q.color }}>{on ? '✓ ' : ''}{q.label}</div>
                      <div style={{ color: on ? q.color : 'var(--txt3)', marginTop: 3, fontSize: 9, opacity: on ? 0.9 : 1 }}>{q.thesis}</div>
                    </button>
                  )
                })}
              </div>
            }
          />
          <FrameworkCard
            title={`McKinsey 3 Horizons (${preferredMcKinsey.length} preferred)`}
            body={
              <div style={{ fontSize: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {MCKINSEY.map((m) => {
                  const on = preferredMcKinsey.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      onClick={() => togglePref(setPreferredMcKinsey, m.id)}
                      style={{
                        textAlign: 'left',
                        padding: 8, borderRadius: 4, cursor: 'pointer',
                        background: on ? 'rgba(212,164,59,0.16)' : 'var(--s3)',
                        border: `1px solid ${on ? 'var(--gold2)' : 'var(--br)'}`,
                        fontFamily: 'inherit',
                      }}
                    >
                      <div style={{ color: on ? 'var(--gold2)' : 'var(--txt)', fontWeight: 700 }}>{on ? '✓ ' : ''}{m.label}</div>
                      <div style={{ color: on ? 'var(--gold2)' : 'var(--txt3)', marginTop: 2 }}>{m.thesis}</div>
                    </button>
                  )
                })}
              </div>
            }
          />
          <FrameworkCard
            title={`Integration Complexity (${preferredIntegrationModes.length} preferred)`}
            body={
              <div style={{ fontSize: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {INTEGRATION.map((i) => {
                  const on = preferredIntegrationModes.includes(i.id)
                  return (
                    <button
                      key={i.id}
                      onClick={() => togglePref(setPreferredIntegrationModes, i.id)}
                      style={{
                        textAlign: 'left',
                        padding: 8, borderRadius: 4, cursor: 'pointer',
                        background: on ? 'rgba(16,185,129,0.15)' : 'var(--s3)',
                        border: `1px solid ${on ? 'var(--green)' : 'var(--br)'}`,
                        fontFamily: 'inherit',
                      }}
                    >
                      <div style={{ fontWeight: 700, color: on ? 'var(--green)' : 'var(--txt)' }}>
                        {on ? '✓ ' : ''}{i.label}{' '}
                        <span style={{ color: on ? 'var(--green)' : 'var(--txt4)', fontSize: 9, fontWeight: 400, opacity: 0.85 }}>
                          (interdep {i.need} · autonomy {i.autonomy})
                        </span>
                      </div>
                      <div style={{ color: on ? 'var(--green)' : 'var(--txt3)', marginTop: 2, opacity: on ? 0.9 : 1 }}>{i.thesis}</div>
                    </button>
                  )
                })}
              </div>
            }
          />
        </div>
        {/* Row 3 — structural + synergy + value-chain */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 12 }}>
          <FrameworkCard
            title={`Deal Structure Options (${preferredDealStructures.length} preferred)`}
            body={
              <div style={{ fontSize: 10, display: 'flex', flexDirection: 'column', gap: 5 }}>
                {DEAL_STRUCTURES.map((d) => {
                  const on = preferredDealStructures.includes(d.id)
                  return (
                    <button
                      key={d.id}
                      onClick={() => togglePref(setPreferredDealStructures, d.id)}
                      style={{
                        textAlign: 'left',
                        padding: '6px 8px', borderRadius: 4, cursor: 'pointer',
                        background: on ? 'rgba(200,120,50,0.18)' : 'var(--s3)',
                        border: `1px solid ${on ? 'var(--orange)' : 'var(--br)'}`,
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{ fontWeight: 700, color: on ? 'var(--orange)' : 'var(--gold2)' }}>
                        {on ? '✓ ' : ''}{d.label}
                      </span>
                      <span style={{ color: on ? 'var(--orange)' : 'var(--txt4)', marginLeft: 6, fontSize: 9, opacity: 0.85 }}>{d.ownership}</span>
                      <div style={{ color: on ? 'var(--orange)' : 'var(--txt3)', marginTop: 2, fontSize: 9, opacity: on ? 0.9 : 1 }}>{d.thesis}</div>
                    </button>
                  )
                })}
              </div>
            }
          />
          <FrameworkCard
            title={`Synergy Matrix (${preferredSynergyBuckets.length} preferred)`}
            body={
              <div style={{ fontSize: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SYNERGY_BUCKETS.map((s) => {
                  const on = preferredSynergyBuckets.includes(s.id)
                  return (
                    <button
                      key={s.id}
                      onClick={() => togglePref(setPreferredSynergyBuckets, s.id)}
                      style={{
                        textAlign: 'left',
                        padding: 8, borderRadius: 4, cursor: 'pointer',
                        background: on ? 'rgba(16,185,129,0.15)' : 'var(--s3)',
                        border: `1px solid ${on ? 'var(--green)' : 'var(--br)'}`,
                        fontFamily: 'inherit',
                      }}
                    >
                      <div style={{ fontWeight: 700, color: 'var(--green)' }}>{on ? '✓ ' : ''}{s.label}</div>
                      <div style={{ color: on ? 'var(--green)' : 'var(--txt3)', marginTop: 2, fontSize: 9, opacity: on ? 0.9 : 1 }}>{s.examples}</div>
                    </button>
                  )
                })}
              </div>
            }
          />
          <FrameworkCard
            title={`Value-Chain Position (${preferredVcPositions.length} preferred)`}
            body={
              <div style={{ fontSize: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {VC_POSITIONS.map((p) => {
                  const on = preferredVcPositions.includes(p.id)
                  return (
                    <button
                      key={p.id}
                      onClick={() => togglePref(setPreferredVcPositions, p.id)}
                      style={{
                        textAlign: 'left',
                        padding: '6px 8px', borderRadius: 4, cursor: 'pointer',
                        background: on ? 'rgba(0,180,216,0.18)' : 'var(--s3)',
                        border: `1px solid ${on ? 'var(--cyan2)' : 'var(--br)'}`,
                        fontFamily: 'inherit',
                      }}
                    >
                      <span style={{ color: 'var(--cyan2)', fontWeight: 700 }}>{on ? '✓ ' : ''}{p.label}</span>
                      <div style={{ color: on ? 'var(--cyan2)' : 'var(--txt4)', fontSize: 9, marginTop: 2, opacity: on ? 0.85 : 1 }}>
                        e.g. {p.keywords.slice(0, 4).join(', ')}
                      </div>
                    </button>
                  )
                })}
              </div>
            }
          />
        </div>

        {/* ── Target Scope: hierarchical value-chain picker ──
            Industry → Stage → Sub-segment, multi-select at every level.
            Mode toggle: Manual (user picks) or System Recommendation
            (framework-guided scope with per-lens Apply buttons).
            Expands downward: pick an industry to reveal its value-chain
            stages; pick a stage to reveal its sub-segments.
            Acquirer's CURRENT posture (auto-derived) is shown as a
            read-only strip so the analyst can see what they already
            have before picking what to add. */}
        <div style={{ marginTop: 18, padding: 14, background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ ...EYEBROW, fontSize: 9, marginBottom: 2 }}>Value-Chain Taxonomy</div>
              <label style={{ ...LABEL, fontSize: 11, textTransform: 'none', letterSpacing: 0, color: 'var(--txt)', fontWeight: 700, margin: 0 }}>
                Target Scope — Industry → Value-Chain Stage → Sub-segment
              </label>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ display: 'flex', gap: 4, padding: 2, background: 'var(--s3)', border: '1px solid var(--br)', borderRadius: 4 }}>
              {(['manual', 'system'] as const).map((m) => {
                const on = scopeMode === m
                return (
                  <button key={m} onClick={() => setScopeMode(m)}
                    style={{
                      padding: '3px 10px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                      background: on ? 'var(--gold2)' : 'transparent',
                      color: on ? '#000' : 'var(--txt3)',
                      border: 'none', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    {m === 'manual' ? 'Manual' : '◈ System Rec.'}
                  </button>
                )
              })}
            </div>
            <div style={{ fontSize: 10, color: 'var(--txt3)' }}>
              {targetIndustries.length} industry · {targetStages.length} stage · {preferredSubSegments.length} sub-segment selected
            </div>
            <button
              onClick={() => {
                setTargetIndustries([])
                setTargetStages([])
                setPreferredSubSegments([])
              }}
              style={{
                padding: '4px 10px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                background: 'transparent', color: 'var(--txt3)', border: '1px solid var(--br)',
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Clear all
            </button>
          </div>

          {scopeMode === 'system' && recommendation && (
            <div
              style={{
                padding: 12, marginBottom: 12,
                background: 'rgba(212,164,59,0.05)',
                border: '1px solid var(--gold2)',
                borderRadius: 6,
              }}
            >
              <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ fontSize: 10, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--gold2)', fontWeight: 700 }}>
                  ◈ System Recommendation
                </div>
                <span style={{
                  padding: '2px 8px', borderRadius: 3, fontSize: 9, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
                  background: 'rgba(212,164,59,0.15)', border: '1px solid var(--gold2)', color: 'var(--gold2)',
                }}>
                  Dominant lens · {recommendation.dominantLens}
                </span>
                <div style={{ flex: 1 }} />
                <button
                  onClick={applyFullRecommendation}
                  style={{
                    padding: '5px 12px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                    background: 'var(--gold2)', color: '#000', border: 'none',
                    cursor: 'pointer', fontFamily: 'inherit',
                  }}
                  title="Set target scope to the full system recommendation (all 3 lenses)"
                >
                  Apply full recommendation
                </button>
              </div>

              <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.6, marginBottom: 10 }}>
                {recommendation.dominantReason}
              </div>

              {/* Lens tabs */}
              <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--br)', marginBottom: 10 }}>
                {(['consolidate', 'integrate', 'diversify'] as const).map((lens) => {
                  const on = activeLens === lens
                  const count =
                    recommendation.industries.filter((i) => i.lens === lens).length +
                    recommendation.stages.filter((s) => s.lens === lens).length +
                    recommendation.subSegments.filter((s) => s.lens === lens).length
                  const label = lens === 'consolidate' ? 'Consolidate' : lens === 'integrate' ? 'Integrate Vertically' : 'Diversify'
                  return (
                    <button
                      key={lens}
                      onClick={() => setActiveLens(lens)}
                      style={{
                        padding: '6px 12px', fontSize: 10, fontWeight: 700, cursor: 'pointer',
                        background: 'transparent', color: on ? 'var(--gold2)' : 'var(--txt3)',
                        border: 'none', borderBottom: `2px solid ${on ? 'var(--gold2)' : 'transparent'}`,
                        fontFamily: 'inherit',
                      }}
                    >
                      {label} <span style={{ color: 'var(--txt4)', fontWeight: 500, marginLeft: 4 }}>({count})</span>
                    </button>
                  )
                })}
              </div>

              {activeLens && (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.5, flex: 1, minWidth: 240 }}>
                      {recommendation.lensSummary[activeLens]}
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button
                        onClick={() => applyLensBundle(activeLens, 'merge')}
                        style={{
                          padding: '4px 10px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                          background: 'transparent', color: 'var(--gold2)', border: '1px solid var(--gold2)',
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                        title="Merge this lens onto the existing scope"
                      >
                        + Merge lens
                      </button>
                      <button
                        onClick={() => applyLensBundle(activeLens, 'replace')}
                        style={{
                          padding: '4px 10px', borderRadius: 3, fontSize: 10, fontWeight: 700,
                          background: 'var(--gold2)', color: '#000', border: 'none',
                          cursor: 'pointer', fontFamily: 'inherit',
                        }}
                        title="Replace the scope with only this lens"
                      >
                        Replace with lens
                      </button>
                    </div>
                  </div>

                  {/* Recommended industries for this lens */}
                  {(() => {
                    const items = recommendation.industries.filter((i) => i.lens === activeLens)
                    if (items.length === 0) return null
                    return (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 9, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--txt3)', fontWeight: 700, marginBottom: 4 }}>
                          Industries recommended ({items.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {items.map((item, i) => {
                            const already = targetIndustries.includes(item.code)
                            return (
                              <div key={`${item.code}-${i}`} style={{
                                display: 'flex', gap: 8, padding: 7, borderRadius: 4,
                                background: 'var(--s2)', border: '1px solid var(--br)',
                              }}>
                                <button
                                  onClick={() => togglePref(setTargetIndustries, item.code)}
                                  style={{
                                    padding: '2px 8px', borderRadius: 3, fontSize: 9, fontWeight: 700, cursor: 'pointer',
                                    background: already ? 'rgba(212,164,59,0.18)' : 'transparent',
                                    border: `1px solid ${already ? 'var(--gold2)' : 'var(--br)'}`,
                                    color: already ? 'var(--gold2)' : 'var(--txt3)',
                                    fontFamily: 'inherit', whiteSpace: 'nowrap', alignSelf: 'flex-start',
                                  }}
                                >
                                  {already ? '✓' : '+'} {item.label}
                                </button>
                                <div style={{ fontSize: 10, color: 'var(--txt3)', flex: 1, lineHeight: 1.5 }}>
                                  {item.reasoning}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Recommended stages for this lens */}
                  {(() => {
                    const items = recommendation.stages.filter((s) => s.lens === activeLens)
                    if (items.length === 0) return null
                    return (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 9, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--txt3)', fontWeight: 700, marginBottom: 4 }}>
                          Value-chain stages recommended ({items.length})
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {items.map((item, i) => {
                            const already = targetStages.includes(item.code)
                            const dirColor =
                              item.direction === 'backward' ? 'var(--cyan2)' :
                              item.direction === 'forward' ? 'var(--gold2)' :
                              item.direction === 'complementary' ? '#9333ea' : 'var(--green)'
                            return (
                              <div key={`${item.code}-${i}`} style={{
                                display: 'flex', gap: 8, padding: 7, borderRadius: 4,
                                background: 'var(--s2)', border: '1px solid var(--br)',
                              }}>
                                <button
                                  onClick={() => {
                                    // Also ensure the industry is set
                                    if (!targetIndustries.includes(item.industryCode)) {
                                      setTargetIndustries((prev) => [...prev, item.industryCode])
                                    }
                                    togglePref(setTargetStages, item.code)
                                  }}
                                  style={{
                                    padding: '2px 8px', borderRadius: 3, fontSize: 9, fontWeight: 700, cursor: 'pointer',
                                    background: already ? 'rgba(212,164,59,0.18)' : 'transparent',
                                    border: `1px solid ${already ? 'var(--gold2)' : 'var(--br)'}`,
                                    color: already ? 'var(--gold2)' : 'var(--txt3)',
                                    fontFamily: 'inherit', whiteSpace: 'nowrap', alignSelf: 'flex-start',
                                  }}
                                >
                                  {already ? '✓' : '+'} {item.code} · {item.name}
                                </button>
                                <span style={{
                                  padding: '1px 6px', borderRadius: 3, fontSize: 8, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase',
                                  color: dirColor, border: `1px solid ${dirColor}`, background: 'transparent', alignSelf: 'flex-start',
                                }}>
                                  {item.direction}
                                </span>
                                <div style={{ fontSize: 10, color: 'var(--txt3)', flex: 1, lineHeight: 1.5 }}>
                                  {item.reasoning}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}

                  {/* Recommended sub-segments for this lens */}
                  {(() => {
                    const items = recommendation.subSegments.filter((s) => s.lens === activeLens)
                    if (items.length === 0) return null
                    return (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 9, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--txt3)', fontWeight: 700, marginBottom: 4 }}>
                          Anchor sub-segments ({items.length})
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {items.map((item) => {
                            const already = preferredSubSegments.includes(item.id)
                            return (
                              <button
                                key={item.id}
                                onClick={() => {
                                  if (!targetIndustries.includes(item.industryCode)) setTargetIndustries((prev) => [...prev, item.industryCode])
                                  if (!targetStages.includes(item.stageCode)) setTargetStages((prev) => [...prev, item.stageCode])
                                  togglePref(setPreferredSubSegments, item.id)
                                }}
                                title={item.reasoning}
                                style={{
                                  padding: '2px 7px', borderRadius: 3, fontSize: 9, fontWeight: 600, cursor: 'pointer',
                                  background: already ? 'rgba(0,180,216,0.18)' : 'transparent',
                                  border: `1px solid ${already ? 'var(--cyan2)' : 'var(--br)'}`,
                                  color: already ? 'var(--cyan2)' : 'var(--txt3)',
                                  fontFamily: 'inherit',
                                }}
                              >
                                {already ? '✓' : '+'} {item.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}

          {acquirer && (acquirerPosture.industries.length > 0 || acquirerPosture.stages.length > 0) && (
            <div
              style={{
                padding: 10, marginBottom: 10,
                background: 'rgba(16,185,129,0.06)',
                border: '1px dashed var(--green)',
                borderRadius: 6, fontSize: 10,
              }}
            >
              <div style={{ fontSize: 9, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--green)', fontWeight: 700, marginBottom: 6 }}>
                Acquirer current posture (auto-derived, read-only)
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: 'var(--txt3)', marginRight: 4 }}>Industries:</span>
                {acquirerPosture.industries.length === 0 ? (
                  <span style={{ fontSize: 9, color: 'var(--txt4)' }}>none mapped</span>
                ) : acquirerPosture.industries.map((ind) => (
                  <span key={ind} style={{
                    padding: '1px 7px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                    background: 'rgba(16,185,129,0.12)', border: '1px solid var(--green)', color: 'var(--green)',
                  }}>
                    {industryLabel(ind)}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <span style={{ fontSize: 9, color: 'var(--txt3)', marginRight: 4 }}>Value-chain stages:</span>
                {acquirerPosture.stages.length === 0 ? (
                  <span style={{ fontSize: 9, color: 'var(--txt4)' }}>none mapped via comp[]</span>
                ) : acquirerPosture.stages.map((st) => {
                  const stage = TAXONOMY_STAGES.find((s) => s.code === st)
                  return (
                    <span key={st} style={{
                      padding: '1px 7px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                      background: 'rgba(16,185,129,0.12)', border: '1px solid var(--green)', color: 'var(--green)',
                    }}>
                      {st} · {stage?.name || 'unknown'}
                    </span>
                  )
                })}
              </div>
            </div>
          )}

          {/* Level 1 — Industries */}
          <div style={{ fontSize: 9, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--gold2)', fontWeight: 700, marginBottom: 6 }}>
            1 · Pick industries to target
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
            {TAXONOMY_INDUSTRIES.map((ind) => {
              const on = targetIndustries.includes(ind.code)
              const isCurrent = acquirerPosture.industries.includes(ind.code)
              return (
                <button
                  key={ind.code}
                  onClick={() => {
                    // Toggle industry; if deselecting, also prune its stages/sub-segments.
                    setTargetIndustries((prev) => {
                      const next = prev.includes(ind.code) ? prev.filter((c) => c !== ind.code) : [...prev, ind.code]
                      return next
                    })
                    if (on) {
                      // Prune stages + sub-segs belonging to this industry
                      setTargetStages((prev) => prev.filter((s) => !s.startsWith(ind.code + '.')))
                      setPreferredSubSegments((prev) => prev.filter((id) => {
                        const seg = getSubSegmentById(id)
                        return seg?.industryCode !== ind.code
                      }))
                    }
                  }}
                  style={{
                    padding: '5px 11px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                    background: on ? 'rgba(212,164,59,0.16)' : 'transparent',
                    border: `1px solid ${on ? 'var(--gold2)' : 'var(--br)'}`,
                    color: on ? 'var(--gold2)' : 'var(--txt3)',
                    position: 'relative',
                  }}
                  title={isCurrent ? 'Acquirer currently operates in this industry' : ''}
                >
                  {on ? '✓ ' : ''}{ind.label}
                  {isCurrent && (
                    <span style={{ marginLeft: 5, fontSize: 8, color: 'var(--green)', fontWeight: 700 }}>●</span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Level 2 + 3 — per-industry stages + sub-segments */}
          {targetIndustries.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {targetIndustries.map((indCode) => {
                const stages = getStagesForIndustry(indCode)
                if (stages.length === 0) return null
                const indName = industryLabel(indCode)
                return (
                  <div key={indCode} style={{ padding: 10, background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6 }}>
                    <div style={{ fontSize: 9, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--gold2)', fontWeight: 700, marginBottom: 6 }}>
                      2 · {indName} — value-chain stages ({stages.length})
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                      {stages.map((stage) => {
                        const on = targetStages.includes(stage.code)
                        const isCurrent = acquirerPosture.stages.includes(stage.code)
                        return (
                          <button
                            key={stage.code}
                            onClick={() => {
                              setTargetStages((prev) => {
                                const next = prev.includes(stage.code) ? prev.filter((c) => c !== stage.code) : [...prev, stage.code]
                                return next
                              })
                              if (on) {
                                // Prune sub-segs of this stage
                                setPreferredSubSegments((prev) => prev.filter((id) => {
                                  const seg = getSubSegmentById(id)
                                  return seg?.stageCode !== stage.code
                                }))
                              }
                            }}
                            style={{
                              padding: '3px 8px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                              cursor: 'pointer', fontFamily: 'inherit',
                              background: on ? 'rgba(212,164,59,0.16)' : 'transparent',
                              border: `1px solid ${on ? 'var(--gold2)' : 'var(--br)'}`,
                              color: on ? 'var(--gold2)' : 'var(--txt3)',
                            }}
                            title={isCurrent ? 'Acquirer currently covers this stage' : `Code ${stage.code} · ${stage.subs.length} sub-segments`}
                          >
                            {on ? '✓ ' : ''}{stage.code} · {stage.name}
                            {isCurrent && <span style={{ marginLeft: 5, fontSize: 8, color: 'var(--green)' }}>●</span>}
                            <span style={{ marginLeft: 5, fontSize: 8, color: 'var(--txt4)' }}>({stage.subs.length})</span>
                          </button>
                        )
                      })}
                    </div>

                    {/* Level 3 — sub-segments for each selected stage of this industry */}
                    {(() => {
                      const activeStages = stages.filter((s) => targetStages.includes(s.code))
                      if (activeStages.length === 0) return (
                        <div style={{ fontSize: 9, color: 'var(--txt4)', fontStyle: 'italic' }}>
                          Pick one or more stages above to reveal their sub-segments.
                        </div>
                      )
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                          {activeStages.map((stage) => (
                            <div key={stage.code} style={{ paddingLeft: 10, borderLeft: '2px solid var(--gold2)' }}>
                              <div style={{ fontSize: 9, letterSpacing: '0.5px', textTransform: 'uppercase', color: 'var(--txt3)', fontWeight: 700, marginBottom: 4 }}>
                                3 · {stage.code} · {stage.name} — sub-segments ({stage.subs.length})
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                {stage.subs.map((sub) => {
                                  const on = preferredSubSegments.includes(sub.id)
                                  return (
                                    <button
                                      key={sub.id}
                                      onClick={() => togglePref(setPreferredSubSegments, sub.id)}
                                      style={{
                                        padding: '2px 7px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                                        cursor: 'pointer', fontFamily: 'inherit',
                                        background: on ? 'rgba(0,180,216,0.18)' : 'transparent',
                                        border: `1px solid ${on ? 'var(--cyan2)' : 'var(--br)'}`,
                                        color: on ? 'var(--cyan2)' : 'var(--txt3)',
                                      }}
                                      title={sub.code}
                                    >
                                      {on ? '✓ ' : ''}{sub.name}
                                    </button>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </div>
                )
              })}
            </div>
          )}

          <div style={{ fontSize: 9, color: 'var(--txt4)', marginTop: 8, lineHeight: 1.5 }}>
            Hierarchy: pick one or more industries → each reveals its value-chain stages → each selected stage reveals its sub-segments.
            Green-dot markers (●) show what the acquirer already covers today. Targets whose value-chain mapping matches these picks get a conviction boost (capped in the 0.15 preference-boost ceiling).
          </div>
        </div>

        {/* Geography-of-interest picker (export regions). Feeds the scoring
            model (small conviction boost for sector↔region matches) and
            drives the Prospective Corridors section in the report. */}
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 8, flexWrap: 'wrap' }}>
            <label style={LABEL}>
              Geographies of Interest ({preferredGeographies.length} selected)
            </label>
            <span style={{ fontSize: 9, color: 'var(--txt4)' }}>
              Picks bump conviction for sector-matched corridors · Report surfaces prospective corridors per target with strategic reasons (labour, raw materials, FTAs, policy, logistics).
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, padding: 8, background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 6 }}>
            {(Object.keys(REGION_LABELS) as ExportRegionId[]).map((id) => {
              const on = preferredGeographies.includes(id)
              return (
                <button
                  key={id}
                  onClick={() => togglePref(setPreferredGeographies, id)}
                  style={{
                    padding: '4px 10px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'inherit',
                    background: on ? 'rgba(0,180,216,0.18)' : 'transparent',
                    border: `1px solid ${on ? 'var(--cyan2)' : 'var(--br)'}`,
                    color: on ? 'var(--cyan2)' : 'var(--txt3)',
                  }}
                >
                  {on ? '✓ ' : ''}{REGION_LABELS[id]}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* §3 Acquisition cards */}
      {ran && (
        <div style={PANEL}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingBottom: 14, marginBottom: 18, borderBottom: '1px solid var(--br)' }}>
            <div>
              <div style={EYEBROW}>Chapter 03</div>
              <h2 style={H2}>Acquisition Targets</h2>
              <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4 }}>
                Top {displayed.length} of {ranked.length} ranked
                {targetCountRec ? ` · Framework recommends ${targetCountRec.recommended} target${targetCountRec.recommended === 1 ? '' : 's'}` : ''}
                {' '}· click a card to expand · ✓ to add to plan
              </div>
            </div>
            <button
              onClick={generateReport}
              disabled={selectedTargets.length === 0}
              title={selectedTargets.length === 0 ? 'Select at least one target' : 'Generate DealNector institutional report'}
              style={{
                background: selectedTargets.length === 0 ? 'var(--s3)' : 'var(--gold2)',
                color: selectedTargets.length === 0 ? 'var(--txt4)' : '#000',
                border: 'none', padding: '8px 16px', borderRadius: 5,
                fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
                cursor: selectedTargets.length === 0 ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ◈ Generate Report ({selectedTargets.length})
            </button>
          </div>
          {targetCountRec && (
            <div style={{
              marginTop: 8, marginBottom: 10, padding: '8px 10px',
              background: 'rgba(212,164,59,0.08)', border: '1px dashed var(--gold2)', borderRadius: 6,
              fontSize: 11, color: 'var(--txt2)',
            }}>
              <span style={{ color: 'var(--gold2)', fontWeight: 700 }}>◆ Framework guidance:</span> {targetCountRec.note}
            </div>
          )}
          {displayed.length === 0 ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--txt3)', fontSize: 12 }}>
              No targets passed the pre-screen. Relax the sector / deal-size / ownership filters above.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 10 }}>
              {displayed.map((t, i) => {
                const on = selectedTickers.has(t.ticker)
                const targetNum = i + 1
                const recommended = targetCountRec?.recommended || 0
                return (
                  <TargetCard
                    key={t.ticker}
                    t={t}
                    rank={targetNum}
                    total={displayed.length}
                    recommended={recommended}
                    on={on}
                    onToggle={() => toggleSelect(t.ticker)}
                  />
                )
              })}
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
          <div style={SECTION_HEADING_BLOCK}>
            <div>
              <div style={EYEBROW}>Chapter 04</div>
              <h2 style={H2}>Acquisition Plan &amp; Fund Requirement</h2>
            </div>
            <div style={{ flex: 1 }} />
            <div style={{ fontSize: 11, color: 'var(--txt3)', textAlign: 'right', maxWidth: 340 }}>
              Capital, timeline, revenue waterfall. The commitment that follows from selecting the dossier above.
            </div>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
              gap: 12,
              marginBottom: 14,
            }}
          >
            <Stat label="Targets selected" value={String(selectedTargets.length)} />
            <Stat label="Total fund required" value={fmtCr(plan.totalFundRequiredCr)} color="var(--gold2)" />
            <Stat label="Synergy pool (steady-state)" value={fmtCr(plan.totalSynergyCr) + '/yr'} color="var(--green)" />
            <Stat label="Projected revenue (incl. 50% synergy)" value={fmtCr(plan.projectedRevCr)} color="var(--cyan2)" />
            <Stat
              label={plan.isGoalAchievable ? 'Goal met' : 'Gap to goal'}
              value={plan.isGoalAchievable ? '✓ achievable' : `${fmtCr(Math.abs(plan.gapToGoalCr))} short`}
              color={plan.isGoalAchievable ? 'var(--green)' : 'var(--red)'}
            />
          </div>

          {/* Report options + generate action */}
          <div style={{ padding: '10px 12px', background: 'var(--s1)', border: '1px solid var(--gold2)', borderRadius: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold2)' }}>
                  ◈ Institutional Report — {reportSections.length} section{reportSections.length === 1 ? '' : 's'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                  Pick a preset or toggle sections individually · Preview opens in letter-size (8.5″×11″) · Download as HTML or PDF · Share via email.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['executive_brief', 'full_memo', 'ic_grade'] as const).map((p) => {
                  const on = reportPreset === p
                  const label = p === 'executive_brief' ? 'Exec Brief' : p === 'full_memo' ? 'Full Memo' : 'IC-Grade'
                  return (
                    <button key={p} onClick={() => applyPreset(p)}
                      style={{
                        padding: '5px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700,
                        cursor: 'pointer', fontFamily: 'inherit',
                        background: on ? 'var(--gold2)' : 'transparent',
                        color: on ? '#000' : 'var(--txt3)',
                        border: `1px solid ${on ? 'var(--gold2)' : 'var(--br)'}`,
                      }}
                    >{label}</button>
                  )
                })}
              </div>
              <button
                onClick={generateReport}
                style={{
                  background: 'var(--gold2)', color: '#000', border: 'none',
                  padding: '8px 16px', borderRadius: 5, fontSize: 12, fontWeight: 700,
                  letterSpacing: '0.4px', cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                ◈ Generate Report
              </button>
            </div>
            <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {(Object.keys(REPORT_SECTION_LABELS) as ReportSectionId[]).map((id) => {
                const on = reportSections.includes(id)
                return (
                  <button key={id} onClick={() => toggleSection(id)}
                    style={{
                      padding: '3px 8px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                      cursor: 'pointer', fontFamily: 'inherit',
                      background: on ? 'rgba(212,164,59,0.18)' : 'transparent',
                      border: `1px solid ${on ? 'var(--gold2)' : 'var(--br)'}`,
                      color: on ? 'var(--gold2)' : 'var(--txt4)',
                    }}
                  >
                    {on ? '✓ ' : ''}{REPORT_SECTION_LABELS[id]}
                  </button>
                )
              })}
            </div>
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

      {/* End of main content wrapper — hero band + inner content */}
      </div>

      {/* Report preview modal — renders the generated HTML in a
          sandboxed iframe so the host page's CSS doesn't leak in. */}
      {report && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setReport(null)
          }}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            style={{
              background: 'var(--s2)',
              border: '1px solid var(--gold2)',
              borderRadius: 10,
              maxWidth: 1100,
              width: '100%',
              maxHeight: '92vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid var(--br)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <div>
                <div style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '1px', textTransform: 'uppercase' }}>
                  DealNector · Institutional Report · Preview
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--txt)', marginTop: 2 }}>
                  {report.title}
                </div>
                <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
                  Report ID <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{report.id}</span> · Generated {new Date(report.generatedAt).toLocaleString('en-IN')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  onClick={printReport}
                  title="Open browser print dialog — choose 'Save as PDF'"
                  style={{
                    background: 'var(--gold2)', color: '#000', border: 'none',
                    padding: '8px 14px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                    letterSpacing: '0.3px', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  ⎙ Download PDF
                </button>
                <button
                  onClick={downloadReport}
                  style={{
                    background: 'transparent', color: 'var(--gold2)', border: '1px solid var(--gold2)',
                    padding: '8px 14px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                    letterSpacing: '0.3px', cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  ↓ HTML
                </button>
                <div style={{ position: 'relative' }}>
                  <button
                    onClick={() => setShowShareMenu((v) => !v)}
                    style={{
                      background: 'transparent', color: 'var(--cyan2)', border: '1px solid var(--cyan2)',
                      padding: '8px 14px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                      letterSpacing: '0.3px', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    ↗ Share
                  </button>
                  {showShareMenu && (
                    <div style={{
                      position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 10,
                      background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6,
                      padding: 6, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 2,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
                    }}>
                      <button onClick={shareMailto} style={shareItemStyle}>✉ Email (mailto)</button>
                      <button onClick={copyReportLink} style={shareItemStyle}>🔗 Copy blob link</button>
                      <button onClick={() => { downloadReport(); setShowShareMenu(false) }} style={shareItemStyle}>↓ Save HTML</button>
                    </div>
                  )}
                </div>
                <button
                  onClick={() => { setReport(null); setShowShareMenu(false) }}
                  title="Close preview"
                  style={{
                    background: 'transparent', color: 'var(--txt3)', border: '1px solid var(--br)',
                    padding: '8px 14px', borderRadius: 5, fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >
                  Close
                </button>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', background: '#e9ebef', padding: 16, display: 'flex', justifyContent: 'center' }}>
              <iframe
                id="op-report-iframe"
                srcDoc={report.html}
                sandbox="allow-same-origin allow-modals"
                title="Op Identifier Report"
                style={{
                  width: 816,
                  minHeight: '100%',
                  border: 'none',
                  background: '#fff',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
                }}
              />
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

function TargetCard({
  t,
  rank,
  total,
  recommended,
  on,
  onToggle,
}: {
  t: OpTarget
  rank: number
  total: number
  recommended: number
  on: boolean
  onToggle: () => void
}) {
  const [open, setOpen] = useState(false)
  const withinRecommended = recommended > 0 && rank <= recommended
  const convictionColor =
    t.conviction >= 0.7 ? 'var(--green)' : t.conviction >= 0.5 ? 'var(--gold2)' : 'var(--txt3)'
  const convictionBg =
    t.conviction >= 0.7
      ? 'rgba(16,185,129,0.18)'
      : t.conviction >= 0.5
        ? 'rgba(212,164,59,0.16)'
        : 'rgba(85,104,128,0.2)'
  return (
    <div
      onClick={() => setOpen((v) => !v)}
      style={{
        background: on ? 'rgba(247,183,49,0.06)' : 'var(--s1)',
        border: `1px solid ${on ? 'var(--gold2)' : withinRecommended ? 'var(--cyan2)' : 'var(--br)'}`,
        borderRadius: 8,
        padding: 12,
        cursor: 'pointer',
        transition: 'background 0.15s',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {/* Header row: rank badge + target-of-total + select */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <div
          style={{
            flex: '0 0 auto',
            width: 48, height: 48, borderRadius: 8,
            background: withinRecommended ? 'var(--gold2)' : 'var(--s3)',
            color: withinRecommended ? '#000' : 'var(--txt2)',
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            fontWeight: 800, fontFamily: 'JetBrains Mono, monospace',
          }}
        >
          <div style={{ fontSize: 16, lineHeight: 1 }}>#{rank}</div>
          <div style={{ fontSize: 8, opacity: 0.8, marginTop: 1 }}>rank</div>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)' }}>{t.name}</div>
            <span style={{ fontSize: 10, color: 'var(--txt3)' }}>({t.ticker})</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>
            {t.sec || '—'} · {t.horizon.label}
          </div>
          {recommended > 0 && (
            <div style={{
              fontSize: 9, color: withinRecommended ? 'var(--gold2)' : 'var(--txt4)',
              fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase', marginTop: 3,
            }}>
              {withinRecommended ? `◆ Target ${rank} of ${recommended} (framework-recommended)` : `Target ${rank} of ${total} shown`}
            </div>
          )}
        </div>
        <input
          type="checkbox"
          checked={on}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          style={{ accentColor: 'var(--gold2)', width: 18, height: 18, cursor: 'pointer' }}
          title={on ? 'Remove from plan' : 'Add to plan'}
        />
      </div>

      {/* Badges row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        <span style={{
          padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 700,
          background: convictionBg, color: convictionColor,
        }}>
          {(t.conviction * 100).toFixed(0)}% conviction
        </span>
        <span style={{
          padding: '2px 7px', borderRadius: 3, fontSize: 9, fontWeight: 700,
          letterSpacing: '0.4px', textTransform: 'uppercase',
          background: 'rgba(200,120,50,0.14)', border: '1px solid var(--orange)', color: 'var(--orange)',
        }}>
          {t.dealStructureLabel}
        </span>
        {t.hostileExposure.exposed && (
          <span
            title={`Hostile exposure: ${t.hostileExposure.severity} — promoter ${t.shareholding.promoterPct}%, float ${t.shareholding.publicFloatPct}%`}
            style={{
              padding: '2px 7px', borderRadius: 3, fontSize: 9, fontWeight: 700,
              letterSpacing: '0.4px', textTransform: 'uppercase',
              background: t.hostileExposure.severity === 'high' ? 'rgba(239,68,68,0.2)' : 'rgba(239,68,68,0.1)',
              border: '1px solid var(--red)', color: 'var(--red)',
            }}
          >
            ⚠ Hostile · {t.hostileExposure.severity}
          </span>
        )}
      </div>

      {/* Key metrics strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, fontSize: 10 }}>
        <MiniStat label="Deal size" value={fmtCr(t.dealSizeCr)} />
        <MiniStat label="Synergy/yr" value={fmtCr(t.synergy.totalCr)} color="var(--green)" />
        <MiniStat label="Rev growth" value={`${t.revGrowthPct.toFixed(1)}%`} color={t.revGrowthPct >= 0 ? 'var(--green)' : 'var(--red)'} />
        <MiniStat label="EBITDA m%" value={`${t.ebitdaMarginPct.toFixed(1)}%`} />
      </div>

      {/* Value chain + sub-segment footprint — always visible on the card */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 5,
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          fontSize: 10,
        }}
      >
        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--txt3)', fontWeight: 700, marginBottom: 3 }}>
            Value chain · {t.vcPosition.replace(/_/g, ' ')}
            <span style={{ color: 'var(--txt4)', fontWeight: 500, textTransform: 'none', letterSpacing: 0, marginLeft: 4 }}>
              ({t.integrationDir})
            </span>
          </div>
          {t.sub.length === 0 ? (
            <span style={{ color: 'var(--txt4)', fontSize: 10 }}>No value-chain tags on this target.</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {t.sub.slice(0, 6).map((s) => (
                <span key={s} style={{
                  padding: '2px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                  background: 'rgba(212,164,59,0.10)', border: '1px solid var(--gold2)', color: 'var(--gold2)',
                }}>
                  {s.replace(/_/g, ' ')}
                </span>
              ))}
              {t.sub.length > 6 && (
                <span style={{ fontSize: 9, color: 'var(--txt4)' }}>+{t.sub.length - 6} more</span>
              )}
            </div>
          )}
        </div>

        <div>
          <div style={{ fontSize: 8, letterSpacing: '0.8px', textTransform: 'uppercase', color: 'var(--txt3)', fontWeight: 700, marginBottom: 3 }}>
            Sub-segment overlap · {t.overlappingSubSegments.length} with acquirer
          </div>
          {t.overlappingSubSegments.length === 0 ? (
            <span style={{ color: 'var(--txt4)', fontSize: 10 }}>No taxonomy-level sub-segment overlap.</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {t.overlappingSubSegments.slice(0, 4).map((s) => (
                <span key={s.id} style={{
                  padding: '2px 6px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                  background: 'rgba(0,180,216,0.10)', border: '1px solid var(--cyan2)', color: 'var(--cyan2)',
                }}>
                  {s.label}
                </span>
              ))}
              {t.overlappingSubSegments.length > 4 && (
                <span style={{ fontSize: 9, color: 'var(--txt4)' }}>+{t.overlappingSubSegments.length - 4} more</span>
              )}
            </div>
          )}
        </div>
      </div>

      <div style={{ fontSize: 9, color: 'var(--txt4)', textAlign: 'center', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
        {open ? '▲ collapse' : '▼ click to expand memo'}
      </div>

      {open && (
        <div onClick={(e) => e.stopPropagation()} style={{ borderTop: '1px dashed var(--br)', paddingTop: 10, marginTop: 2, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Classification badges */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <Chip label={`BCG · ${t.bcg}`} color="var(--gold2)" />
              <Chip label={`McKinsey · ${t.mckinsey.replace(/_/g, ' ')}`} color="var(--cyan2)" />
              <Chip label={`Integration · ${t.integrationMode}`} color="var(--green)" />
              <Chip label={`Structure · ${t.dealStructureLabel}`} color="var(--orange)" />
              <Chip label={`VC stage · ${t.vcPosition}`} color="var(--txt2)" />
              <Chip label={`Direction · ${t.integrationDir}`} color="var(--txt2)" />
              {t.policyTailwinds.length > 0 && (
                <Chip label={`Policy · ${t.policyTailwinds.length} tailwind${t.policyTailwinds.length === 1 ? '' : 's'}`} color="var(--green)" />
              )}
            </div>

            {/* Memo grid — four analyst sections */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
              <MemoSection title="Thesis" lines={t.memo.thesis} color="var(--gold2)" />
              <MemoSection title="Top Risks" lines={t.memo.risks} color="var(--red)" />
              <MemoSection title="Integration Plan" lines={t.memo.integration} color="var(--cyan2)" />
              <MemoSection title="Valuation" lines={t.memo.valuation} color="var(--green)" />
            </div>

            {/* Sub-segment overlap + policy tailwinds */}
            {(t.overlappingSubSegments.length > 0 || t.policyTailwinds.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
                <div>
                  <div style={SECTION_LABEL}>Sub-segment overlap</div>
                  {t.overlappingSubSegments.length === 0 ? (
                    <span style={{ color: 'var(--txt4)', fontSize: 10 }}>No taxonomy-level overlap.</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {t.overlappingSubSegments.map((s) => (
                        <span key={s.id} style={{
                          padding: '2px 7px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                          background: 'rgba(212,164,59,0.12)', border: '1px solid var(--gold2)', color: 'var(--gold2)',
                        }}>
                          {s.label}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div style={SECTION_LABEL}>Policy tailwinds that touch this target</div>
                  {t.policyTailwinds.length === 0 ? (
                    <span style={{ color: 'var(--txt4)', fontSize: 10 }}>No direct policy tailwind detected.</span>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {t.policyTailwinds.map((p) => (
                        <span
                          key={p.short}
                          title={p.name}
                          style={{
                            padding: '2px 7px', borderRadius: 3, fontSize: 9, fontWeight: 600,
                            background: 'rgba(16,185,129,0.12)', border: '1px solid var(--green)', color: 'var(--green)',
                          }}
                        >
                          {p.short}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Synergy band + score breakdown */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
              <div>
                <div style={SECTION_LABEL}>Synergy estimate</div>
                <div
                  style={{
                    padding: 10,
                    background: 'var(--s2)',
                    border: '1px solid var(--br)',
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                >
                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
                    <SynStat label="Revenue" value={`\u20B9${t.synergy.revenueCr.toLocaleString('en-IN')} Cr`} color="var(--gold2)" />
                    <SynStat label="Cost" value={`\u20B9${t.synergy.costCr.toLocaleString('en-IN')} Cr`} color="var(--cyan2)" />
                    <SynStat label="Total (steady state)" value={`\u20B9${t.synergy.totalCr.toLocaleString('en-IN')} Cr/yr`} color="var(--green)" />
                  </div>
                  <div style={{ color: 'var(--txt3)', marginTop: 6, fontSize: 10 }}>{t.synergy.note}</div>
                </div>
              </div>
              <div>
                <div style={SECTION_LABEL}>Why this target ranked #{rank} · score breakdown</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {(Object.keys(t.subScores) as Array<keyof typeof t.subScores>).map((k) => (
                    <ScoreBar key={k} label={k} value={t.subScores[k]} />
                  ))}
                </div>
              </div>
            </div>
        </div>
      )}
    </div>
  )
}

function MiniStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 4, padding: '5px 7px' }}>
      <div style={{ fontSize: 8, color: 'var(--txt3)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: color || 'var(--txt)', marginTop: 1, fontFamily: 'JetBrains Mono, monospace' }}>{value}</div>
    </div>
  )
}

function Chip({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        padding: '2px 8px',
        borderRadius: 3,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.4px',
        textTransform: 'uppercase',
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid ${color}`,
        color,
      }}
    >
      {label}
    </span>
  )
}

function MemoSection({ title, lines, color }: { title: string; lines: string[]; color: string }) {
  return (
    <div style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, padding: 10 }}>
      <div
        style={{
          fontSize: 9,
          color,
          fontWeight: 700,
          letterSpacing: '1px',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      <ul style={{ paddingLeft: 16, margin: 0, fontSize: 11, color: 'var(--txt2)', lineHeight: 1.55 }}>
        {lines.map((l, i) => (
          <li key={i} style={{ marginBottom: 3 }}>
            {l}
          </li>
        ))}
      </ul>
    </div>
  )
}

function SynStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 8, color: 'var(--txt3)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color, marginTop: 2 }}>{value}</div>
    </div>
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
