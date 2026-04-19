/**
 * Op Identifier report generator — deterministic HTML output.
 *
 * Given the acquirer, scored/ranked targets, selected targets, plan
 * roll-up, lender match, balance-sheet projection, and placement
 * narrative, compose a multi-section institutional memo in plain HTML
 * that can be previewed in a modal and downloaded as a standalone file.
 *
 * Sections (mirror the existing /reports builder pattern):
 *   1.  Executive Summary
 *   2.  Acquirer Profile
 *   3.  Strategic Framework
 *   4.  Target Portfolio (ranked)
 *   5.  Per-Target Memos (Thesis / Risks / Integration / Valuation)
 *   6.  Acquisition Strategy & Legal Path (per selected target)
 *   7.  Hostile-Takeover Exposure
 *   8.  Acquisition Timeline (3 horizons)
 *   9.  Fund Requirement & Lender Map
 *   10. Balance-Sheet Projection
 *   11. Pre vs Post Firm Placement
 *   12. Risks & Next Steps
 *   13. Methodology appendix
 *
 * Zero external calls. All narrative composed from the scored output.
 */

import type { Company } from '@/lib/data/companies'
import type {
  OpTarget,
  PlanOutput,
  LenderMatch,
  BalanceSheetProjection,
  PlacementNarrative,
  OpInputs,
} from './algorithm'
import { ANSOFF, PORTER, HORIZONS } from './frameworks'
import { aggregateGeography, renderProgrammeMap } from './geography'

export interface ReportBundle {
  id: string
  title: string
  subtitle: string
  generatedAt: string
  acquirerTicker: string
  html: string
}

function esc(s: string | number | null | undefined): string {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function fmtCr(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '\u20B90 Cr'
  if (Math.abs(n) >= 1_00_000) return `\u20B9${(n / 1_00_000).toFixed(2)} L Cr`
  return `\u20B9${Math.round(n).toLocaleString('en-IN')} Cr`
}

const CSS = `
  :root {
    --ink: #0b1220;
    --muted: #5c6477;
    --gold: #C8A24B;
    --green: #0f9e6e;
    --red: #c7334f;
    --cyan: #0aa5b2;
    --rule: #d9dde3;
    --bg: #ffffff;
    --soft: #f6f7f9;
  }
  * { box-sizing: border-box; }
  body { font-family: 'Source Serif 4', 'Source Serif Pro', Georgia, serif; color: var(--ink); background: #e9ebef; margin: 0; padding: 0; }
  .page { max-width: 816px; margin: 16px auto; padding: 44px 56px 60px; background: var(--bg); box-shadow: 0 2px 12px rgba(0,0,0,0.08); min-height: 1056px; }
  @media print {
    @page { size: Letter; margin: 0.6in; }
    body { background: #fff; }
    .page { max-width: none; margin: 0; padding: 0; box-shadow: none; min-height: auto; }
    section { page-break-inside: avoid; }
    h2 { page-break-after: avoid; }
    .tgt { page-break-inside: avoid; }
    table { page-break-inside: avoid; }
  }
  .eyebrow { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); font-family: 'JetBrains Mono', monospace; }
  h1, h2, h3 { font-family: 'Source Serif 4', Georgia, serif; font-weight: 700; margin: 0 0 8px; color: var(--ink); }
  h1 { font-size: 28px; letter-spacing: -0.01em; }
  h2 { font-size: 18px; margin-top: 22px; border-top: 2px solid var(--gold); padding-top: 10px; }
  h3 { font-size: 13px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--gold); margin-top: 18px; }
  p { line-height: 1.6; margin: 0 0 10px; color: var(--ink); }
  .muted { color: var(--muted); }
  .grid { display: grid; gap: 10px; }
  .grid-2 { grid-template-columns: 1fr 1fr; }
  .grid-3 { grid-template-columns: repeat(3, 1fr); }
  .grid-4 { grid-template-columns: repeat(4, 1fr); }
  .card { background: var(--soft); border: 1px solid var(--rule); border-radius: 8px; padding: 14px 16px; }
  .stat { font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 18px; color: var(--ink); }
  .stat-lbl { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); margin-bottom: 2px; }
  ul { margin: 0 0 10px; padding-left: 20px; line-height: 1.6; }
  li { margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0; }
  th, td { padding: 7px 10px; border-bottom: 1px solid var(--rule); text-align: left; }
  th { background: var(--soft); color: var(--muted); font-size: 10px; letter-spacing: 0.5px; text-transform: uppercase; font-weight: 700; }
  td.num { font-family: 'JetBrains Mono', monospace; text-align: right; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; }
  .pill-gold { background: rgba(200,162,75,0.12); border: 1px solid var(--gold); color: var(--gold); }
  .pill-green { background: rgba(15,158,110,0.12); border: 1px solid var(--green); color: var(--green); }
  .pill-red { background: rgba(199,51,79,0.12); border: 1px solid var(--red); color: var(--red); }
  .pill-cyan { background: rgba(10,165,178,0.12); border: 1px solid var(--cyan); color: var(--cyan); }
  .hero { border-left: 4px solid var(--gold); padding: 10px 14px; background: var(--soft); border-radius: 0 6px 6px 0; }
  .hero em { font-style: italic; color: var(--gold); font-weight: 700; }
  .small { font-size: 10px; color: var(--muted); }
  .rule { height: 1px; background: var(--rule); margin: 18px 0; }
  .section-tag { display: inline-block; padding: 2px 8px; background: var(--ink); color: #fff; border-radius: 3px; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; font-family: 'JetBrains Mono', monospace; font-weight: 700; }
  .tgt { border: 1px solid var(--rule); border-radius: 8px; padding: 14px; margin-top: 12px; background: #fff; }
  .tgt-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--rule); padding-bottom: 8px; margin-bottom: 10px; }
  .tgt-name { font-family: 'Source Serif 4', Georgia, serif; font-size: 16px; font-weight: 700; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid var(--gold); font-size: 10px; color: var(--muted); }
`

export type ReportSectionId =
  | 'executive'
  | 'acquirer'
  | 'framework'
  | 'portfolio'
  | 'memos'
  | 'marketAnalysis'
  | 'trajectory'
  | 'comparison'
  | 'geography'
  | 'strategy'
  | 'hostile'
  | 'timeline'
  | 'fund'
  | 'balance'
  | 'placement'
  | 'risks'
  | 'methodology'

export const REPORT_SECTION_LABELS: Record<ReportSectionId, string> = {
  executive: 'Executive Summary',
  acquirer: 'Acquirer Profile',
  framework: 'Strategic Framework',
  portfolio: 'Target Portfolio (Top 10)',
  memos: 'Per-Target Memos',
  marketAnalysis: 'Market Analysis & Advantage',
  trajectory: '5-Year Value Trajectory',
  comparison: 'Cross-Target Comparison',
  geography: 'Geographic Footprint & Market Access',
  strategy: 'Acquisition Strategy & Legal Path',
  hostile: 'Hostile-Takeover Exposure',
  timeline: 'Gantt Timeline',
  fund: 'Fund Requirement & Lender Map',
  balance: 'Balance-Sheet Projection',
  placement: 'Pre/Post Firm Placement',
  risks: 'Risks & Next Steps',
  methodology: 'Methodology',
}

export const REPORT_PRESETS: Record<string, ReportSectionId[]> = {
  executive_brief: ['executive', 'acquirer', 'marketAnalysis', 'comparison', 'geography', 'timeline', 'fund', 'placement'],
  full_memo: Object.keys(REPORT_SECTION_LABELS) as ReportSectionId[],
  ic_grade: ['executive', 'acquirer', 'framework', 'memos', 'marketAnalysis', 'trajectory', 'comparison', 'geography', 'strategy', 'hostile', 'timeline', 'fund', 'balance', 'placement', 'risks'],
}

export interface GenerateReportInput {
  acquirer: Company
  inputs: OpInputs
  selected: OpTarget[]
  /** Entire ranked list (so we can show a compact top-10 overview). */
  allRanked: OpTarget[]
  plan: PlanOutput
  lenders: LenderMatch[]
  balance: BalanceSheetProjection
  placement: PlacementNarrative
  postMktCapEstimate: number
  /** If set, only emit these sections (in enum order). Default = all. */
  sections?: ReportSectionId[]
}

/**
 * 5-year value trajectory per target: deterministic revenue + EBITDA
 * projection using historical growth (capped), ebitda-margin expansion
 * toward sector median, and synergy phase-in (0% Y1 → 100% Y3+).
 *
 * Cumulative NPV uses a 10% discount rate (WACC proxy for Indian mid-cap
 * industrial). Growth decay factor applied (0.85 per year) so we don't
 * extrapolate hypergrowth linearly. This is NOT a DCF — it's a value-add
 * overlay meant to show what each target contributes to the acquirer's
 * revenue goal over the 5-year horizon.
 */
export interface TargetTrajectory {
  ticker: string
  name: string
  years: Array<{
    year: number
    revCr: number
    ebitdaCr: number
    synergyCr: number
    valueAddCr: number
    cumulativeValueCr: number
    discountedValueCr: number
  }>
  fiveYearRevCr: number
  fiveYearEbitdaCr: number
  fiveYearValueAddCr: number
  fiveYearDiscountedCr: number
  revCagrPct: number
}

function trajectoryFor(t: OpTarget, ownershipPct: number): TargetTrajectory {
  const growthCapped = Math.max(-10, Math.min(45, t.revGrowthPct || 0))
  const marginStart = Math.max(0, t.ebitdaMarginPct || 0)
  // Margin expansion: halve the gap toward 18% (industrial median) across 5 years.
  const marginTarget = Math.max(marginStart, 18)
  const decay = 0.88
  const synergySteadyCr = t.synergy.totalCr * ownershipPct
  const discountR = 0.10
  let cumulativeValueCr = 0
  const years: TargetTrajectory['years'] = []
  let rev = t.revCr * ownershipPct
  for (let y = 1; y <= 5; y++) {
    const g = growthCapped * Math.pow(decay, y - 1) // growth decays over time
    if (y > 1) rev = rev * (1 + g / 100)
    const marginThisYear = marginStart + (marginTarget - marginStart) * Math.min(1, y / 5)
    const ebitda = rev * (marginThisYear / 100)
    // Synergy ramp: 0 Y1, 35% Y2, 70% Y3, 100% Y4+
    const ramp = y === 1 ? 0 : y === 2 ? 0.35 : y === 3 ? 0.70 : 1
    const synergyCr = synergySteadyCr * ramp
    const valueAddCr = ebitda + synergyCr
    cumulativeValueCr += valueAddCr
    const discountedValueCr = valueAddCr / Math.pow(1 + discountR, y)
    years.push({ year: y, revCr: Math.round(rev), ebitdaCr: Math.round(ebitda), synergyCr: Math.round(synergyCr), valueAddCr: Math.round(valueAddCr), cumulativeValueCr: Math.round(cumulativeValueCr), discountedValueCr: Math.round(discountedValueCr) })
  }
  const startRev = t.revCr * ownershipPct
  const endRev = years[years.length - 1].revCr
  const revCagrPct = startRev > 0 ? (Math.pow(endRev / startRev, 1 / 5) - 1) * 100 : 0
  return {
    ticker: t.ticker, name: t.name, years,
    fiveYearRevCr: endRev,
    fiveYearEbitdaCr: years[years.length - 1].ebitdaCr,
    fiveYearValueAddCr: Math.round(years.reduce((s, y) => s + y.valueAddCr, 0)),
    fiveYearDiscountedCr: Math.round(years.reduce((s, y) => s + y.discountedValueCr, 0)),
    revCagrPct,
  }
}

/**
 * Market analysis lines per target — derived deterministically from the
 * target's sub-scores, growth/margin signals, policy tailwinds, BCG
 * classification, and sub-segment overlap. Mirrors a McKinsey industry
 * analysis deck without any generative text.
 */
function marketAnalysisFor(t: OpTarget): {
  sizing: string[]
  advantage: string[]
  whyRecommended: string[]
} {
  const sizing: string[] = []
  const advantage: string[] = []
  const whyRecommended: string[] = []

  // Sizing: derive from target's own revenue + growth + BCG + sub-segment depth.
  const scaleBand = t.revCr >= 10_000 ? 'large-cap' : t.revCr >= 2_000 ? 'mid-cap' : t.revCr >= 500 ? 'emerging' : 'small'
  sizing.push(`${t.sec || 'sector'} exposure positioned as a ${scaleBand} operator at ₹${Math.round(t.revCr).toLocaleString('en-IN')} Cr revenue — indicative of addressable market scale.`)
  if (t.revGrowthPct >= 20) sizing.push(`Sector growth tracking ${t.revGrowthPct.toFixed(1)}% at target level — market expansion outpaces GDP by 3–4×.`)
  else if (t.revGrowthPct >= 10) sizing.push(`Market growth at ${t.revGrowthPct.toFixed(1)}% signals a mature-growth segment with room for consolidation.`)
  else sizing.push(`Growth of ${t.revGrowthPct.toFixed(1)}% implies a mature or consolidating market — value creation hinges on share-taking, not market tailwind.`)
  if (t.bcg === 'star') sizing.push('BCG Star: high market growth × high relative margin → re-investable economic flywheel.')
  else if (t.bcg === 'cash_cow') sizing.push('BCG Cash Cow: low growth × high margin → free-cash-flow engine, under-deployed capital waiting for redeployment.')
  else if (t.bcg === 'question_mark') sizing.push('BCG Question Mark: high growth × thin margin — bet on scale economics kicking in post-acquisition.')
  else sizing.push('BCG Dog: low growth × low margin — acquisition thesis must rest on turnaround or asset carve-out, not organic trajectory.')
  if (t.overlappingSubSegments.length > 0) sizing.push(`Sub-segment footprint covers ${t.overlappingSubSegments.length} DealNector taxonomy nodes, including ${t.overlappingSubSegments.slice(0, 3).map((s) => s.label).join(', ')}${t.overlappingSubSegments.length > 3 ? '…' : ''}.`)

  // Market advantage: derive from sub-scores + synergy pool + policy tailwinds.
  const subs = t.subScores
  if (subs.marginFit >= 0.7) advantage.push(`Margin profile (${t.ebitdaMarginPct.toFixed(1)}% EBITDA) ranks in the top quintile of sector peers — pricing power proxy signals structural moat.`)
  if (subs.growthFit >= 0.7) advantage.push('Growth trajectory materially ahead of sector median — either share-gainer or category-creator.')
  if (subs.sectorFit >= 0.8) advantage.push('Sector fit with acquirer is near-perfect: integration cost is dominated by talent retention and brand migration, not operating-model redesign.')
  if (subs.subSegmentFit >= 0.6) advantage.push(`Deep sub-segment overlap (${t.overlappingSubSegments.length} nodes) creates product-mix complementarity — cross-sell uplift realistic within 18 months.`)
  if (t.policyTailwinds.length > 0) advantage.push(`Policy tailwinds (${t.policyTailwinds.map((p) => p.short).join(', ')}) give the target a structural cost or revenue advantage for the next 3–5 fiscal years.`)
  if (t.synergy.totalCr >= t.revCr * 0.06) advantage.push(`Synergy pool (₹${Math.round(t.synergy.totalCr).toLocaleString('en-IN')} Cr/yr) equals ${((t.synergy.totalCr / Math.max(1, t.revCr)) * 100).toFixed(1)}% of target revenue — top-quartile combinatorial value.`)
  if (advantage.length === 0) advantage.push('Competitive position is balanced — no dominant structural advantage, thesis rests on execution discipline and synergy capture post-close.')

  // Why recommended: top sub-scores + conviction + BCG + mckinsey + horizon.
  const topSubs = (Object.keys(subs) as Array<keyof typeof subs>)
    .sort((a, b) => subs[b] - subs[a])
    .slice(0, 3)
    .map((k) => k.replace(/Fit$/, '').replace(/([A-Z])/g, ' $1').toLowerCase().trim())
  whyRecommended.push(`Ranked at ${(t.conviction * 100).toFixed(0)}% conviction on a deterministic 8-factor model, led by ${topSubs.join(', ')}.`)
  whyRecommended.push(`Classified as ${t.bcg.replace(/_/g, ' ')} (BCG) and ${t.mckinsey.replace(/_/g, ' ')} (McKinsey Horizons) — aligns with the acquirer's growth vector and time-to-value envelope.`)
  whyRecommended.push(`Deal structure (${t.dealStructureLabel}) selected to match integration complexity (${t.integrationMode}) and acquirer's ${t.integrationDir} posture — minimises execution drag.`)
  whyRecommended.push(`${t.horizon.label}: positions this target within the ${t.horizon.id === 'near' ? 'near-term quick-win' : t.horizon.id === 'mid' ? 'mid-horizon value build' : 'long-horizon platform'} band of the 3-horizon plan.`)
  if (t.hostileExposure.exposed) whyRecommended.push(`Note: hostile-takeover exposure rated ${t.hostileExposure.severity} — competitive bidder risk to be priced into negotiation stance.`)
  return { sizing, advantage, whyRecommended }
}

/**
 * Cross-target comparison: groups selected targets by value-chain segment
 * and sub-segment overlap. Within each group of >=2 targets, picks the
 * "max-value" winner using: conviction × 5-yr discounted value × synergy
 * density. Returns both groupings and a reasoning string per group.
 */
interface ComparisonGroup {
  key: string
  label: string
  basis: 'value_chain' | 'sub_segment'
  targets: Array<{ target: OpTarget; traj: TargetTrajectory; valueScore: number }>
  winner: { target: OpTarget; traj: TargetTrajectory; valueScore: number }
  reasoning: string[]
}

function compareTargets(selected: OpTarget[], trajMap: Map<string, TargetTrajectory>): ComparisonGroup[] {
  if (selected.length < 2) return []
  const groups = new Map<string, ComparisonGroup>()

  const scoreOf = (t: OpTarget) => {
    const traj = trajMap.get(t.ticker)!
    const synDensity = t.revCr > 0 ? t.synergy.totalCr / t.revCr : 0
    // Composite value index: conviction × discounted value × (1 + synergy density) × (integration ease)
    const integrationEase = t.integrationMode === 'preserve' ? 1.1 : t.integrationMode === 'symbiosis' ? 1.0 : t.integrationMode === 'holding' ? 1.05 : 0.9
    return t.conviction * Math.max(1, traj.fiveYearDiscountedCr) * (1 + synDensity) * integrationEase
  }

  // Group by value-chain segment — use the first comp tag as primary.
  for (const t of selected) {
    const vcKey = t.sub[0] || 'unclassified'
    if (!groups.has('vc:' + vcKey)) {
      groups.set('vc:' + vcKey, {
        key: 'vc:' + vcKey,
        label: vcKey.replace(/_/g, ' '),
        basis: 'value_chain',
        targets: [],
        winner: { target: t, traj: trajMap.get(t.ticker)!, valueScore: 0 },
        reasoning: [],
      })
    }
  }

  // Group by shared sub-segment (each sub-segment is its own group).
  for (const t of selected) {
    for (const s of t.overlappingSubSegments) {
      const k = 'ss:' + s.id
      if (!groups.has(k)) {
        groups.set(k, {
          key: k,
          label: s.label,
          basis: 'sub_segment',
          targets: [],
          winner: { target: t, traj: trajMap.get(t.ticker)!, valueScore: 0 },
          reasoning: [],
        })
      }
    }
  }

  // Assign each target to groups it belongs to.
  const groupList = Array.from(groups.values())
  for (const g of groupList) {
    for (const t of selected) {
      let belongs = false
      if (g.basis === 'value_chain') {
        belongs = t.sub[0] === g.key.replace('vc:', '')
      } else {
        belongs = t.overlappingSubSegments.some((s) => 'ss:' + s.id === g.key)
      }
      if (belongs) {
        const traj = trajMap.get(t.ticker)!
        g.targets.push({ target: t, traj, valueScore: scoreOf(t) })
      }
    }
  }

  // Keep only groups with >=2 targets (comparisons are meaningful).
  const out: ComparisonGroup[] = []
  for (const g of groupList) {
    if (g.targets.length < 2) continue
    g.targets.sort((a: ComparisonGroup['targets'][number], b: ComparisonGroup['targets'][number]) => b.valueScore - a.valueScore)
    const winner = g.targets[0]
    g.winner = winner
    const runnerUp = g.targets[1]
    const reasoning: string[] = []
    reasoning.push(`${winner.target.name} leads on composite value index (${winner.valueScore.toExponential(2)} vs. ${runnerUp.valueScore.toExponential(2)} for ${runnerUp.target.name}).`)
    // Sub-score deltas — pick the 2 biggest gaps.
    const subs = winner.target.subScores
    const rSubs = runnerUp.target.subScores
    const deltas = (Object.keys(subs) as Array<keyof typeof subs>)
      .map((k) => ({ k, d: subs[k] - rSubs[k] }))
      .sort((a, b) => b.d - a.d)
    const topGaps = deltas.filter((x) => x.d > 0).slice(0, 2)
    if (topGaps.length > 0) {
      reasoning.push(`Dominant advantages: ${topGaps.map((x) => `${String(x.k).replace(/Fit$/, '')} (+${(x.d * 100).toFixed(0)} pts)`).join(', ')}.`)
    }
    if (winner.traj.fiveYearDiscountedCr > runnerUp.traj.fiveYearDiscountedCr) {
      const uplift = winner.traj.fiveYearDiscountedCr - runnerUp.traj.fiveYearDiscountedCr
      reasoning.push(`5-year NPV uplift vs. next-best: ${fmtCr(uplift)} (${winner.traj.revCagrPct.toFixed(1)}% vs. ${runnerUp.traj.revCagrPct.toFixed(1)}% CAGR).`)
    }
    if (winner.target.synergy.totalCr > runnerUp.target.synergy.totalCr) {
      reasoning.push(`Deeper synergy pool: ${fmtCr(winner.target.synergy.totalCr)}/yr steady-state vs. ${fmtCr(runnerUp.target.synergy.totalCr)}/yr.`)
    }
    if (winner.target.integrationMode !== runnerUp.target.integrationMode) {
      reasoning.push(`Lower integration friction: ${winner.target.integrationMode} vs. ${runnerUp.target.integrationMode}.`)
    }
    if (winner.target.hostileExposure.exposed && !runnerUp.target.hostileExposure.exposed) {
      reasoning.push(`Caveat: ${winner.target.name} carries hostile-takeover exposure (${winner.target.hostileExposure.severity}) — competitive-bid risk to be priced in.`)
    }
    g.reasoning = reasoning
    out.push(g)
  }
  // Order: sub-segment groups first (finer granularity), then value-chain.
  out.sort((a, b) => (a.basis === b.basis ? 0 : a.basis === 'sub_segment' ? -1 : 1))
  return out
}

/**
 * SVG Gantt chart for the acquisition programme. Each selected target is
 * a horizontal bar spanning its horizon's month band; bars are stacked
 * non-overlapping vertically, sorted by start-month then deal-size.
 */
function renderGantt(selected: OpTarget[], horizonMonths: number): string {
  if (selected.length === 0) return ''
  // Chart dimensions — row height grown so name + fund are legible even in narrow bars.
  const maxMonths = Math.max(horizonMonths, ...selected.map((t) => t.horizon.months[1]))
  const rowH = 40
  const barH = 28
  const leftPad = 220
  const rightPad = 20
  const topPad = 36
  const rows = selected.length
  const width = 920
  const plotW = width - leftPad - rightPad
  const height = topPad + rows * rowH + 50
  const xOf = (m: number) => leftPad + (m / maxMonths) * plotW

  // Tick marks every 6 months.
  const ticks: number[] = []
  for (let m = 0; m <= maxMonths; m += 6) ticks.push(m)
  if (ticks[ticks.length - 1] !== maxMonths) ticks.push(maxMonths)

  // Sort bars by start, then by deal size descending (non-overlapping: each
  // gets its own row regardless of month overlap, so bars never collide).
  const bars = [...selected]
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.horizon.months[0] - b.t.horizon.months[0] || b.t.dealSizeCr - a.t.dealSizeCr)
    .map((x, row) => ({ t: x.t, row }))

  const totalFund = selected.reduce((s, t) => s + t.dealSizeCr, 0)

  const barSvg = bars.map(({ t, row }) => {
    const x = xOf(t.horizon.months[0])
    const x2 = xOf(t.horizon.months[1])
    const w = Math.max(60, x2 - x)
    const y = topPad + row * rowH + 4
    const colour = t.horizon.id === 'near' ? '#0f9e6e' : t.horizon.id === 'mid' ? '#C8A24B' : '#0aa5b2'
    // Left rail: row number + full target name + ticker.
    const leftName = t.name.length > 26 ? t.name.slice(0, 24) + '\u2026' : t.name
    const fundLabel = fmtCr(t.dealSizeCr)
    // Bar label: target name centred, fund required right-aligned inside bar.
    // If bar is narrow we drop the name and keep fund only.
    const canShowName = w >= 180
    const nameText = canShowName ? esc(t.name.length > 22 ? t.name.slice(0, 20) + '\u2026' : t.name) : ''
    return `
      <g>
        <text x="10" y="${y + barH / 2 + 1}" font-size="10" fill="#5c6477" font-family="JetBrains Mono, monospace">#${row + 1}</text>
        <text x="36" y="${y + barH / 2 - 3}" font-size="11" fill="#0b1220" font-family="Source Serif 4, Georgia, serif" font-weight="700">${esc(leftName)}</text>
        <text x="36" y="${y + barH / 2 + 10}" font-size="9" fill="#5c6477" font-family="JetBrains Mono, monospace">${esc(t.ticker)} \u00b7 ${esc(t.horizon.label)}</text>

        <rect x="${x}" y="${y}" width="${w}" height="${barH}" fill="${colour}" opacity="0.88" rx="4" ry="4" />
        ${nameText ? `<text x="${x + 8}" y="${y + 13}" font-size="10" fill="#fff" font-weight="700">${nameText}</text>` : ''}
        <text x="${x + w - 8}" y="${y + (nameText ? 24 : 17)}" text-anchor="end" font-size="11" fill="#fff" font-weight="800" font-family="JetBrains Mono, monospace">${esc(fundLabel)}</text>
        <text x="${x}" y="${y - 3}" font-size="8" fill="#5c6477" font-family="JetBrains Mono, monospace">M${t.horizon.months[0]}\u2013M${t.horizon.months[1]}</text>
      </g>`
  }).join('')

  const tickSvg = ticks.map((m) => {
    const x = xOf(m)
    return `
      <line x1="${x}" y1="${topPad - 4}" x2="${x}" y2="${height - 40}" stroke="#d9dde3" stroke-dasharray="2,4" />
      <text x="${x}" y="${height - 22}" text-anchor="middle" font-size="9" fill="#5c6477" font-family="JetBrains Mono, monospace">M${m}</text>`
  }).join('')

  // Legend: horizon colour + total fund programme footer
  const legend = `
    <g>
      <rect x="${leftPad}" y="${height - 16}" width="10" height="10" fill="#0f9e6e" opacity="0.88"/>
      <text x="${leftPad + 14}" y="${height - 7}" font-size="9" fill="#0b1220" font-family="Source Serif 4, Georgia, serif">Near-term (0\u201312 m)</text>
      <rect x="${leftPad + 130}" y="${height - 16}" width="10" height="10" fill="#C8A24B" opacity="0.88"/>
      <text x="${leftPad + 144}" y="${height - 7}" font-size="9" fill="#0b1220" font-family="Source Serif 4, Georgia, serif">Mid-horizon (12\u201324 m)</text>
      <rect x="${leftPad + 290}" y="${height - 16}" width="10" height="10" fill="#0aa5b2" opacity="0.88"/>
      <text x="${leftPad + 304}" y="${height - 7}" font-size="9" fill="#0b1220" font-family="Source Serif 4, Georgia, serif">Long (24 m+)</text>
      <text x="${width - rightPad}" y="${height - 7}" text-anchor="end" font-size="10" fill="#0b1220" font-family="JetBrains Mono, monospace" font-weight="700">Programme fund: ${esc(fmtCr(totalFund))}</text>
    </g>`

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="background:#fff;border:1px solid #d9dde3;border-radius:6px">
      <line x1="${leftPad}" y1="${topPad - 4}" x2="${width - rightPad}" y2="${topPad - 4}" stroke="#0b1220" stroke-width="1" />
      ${tickSvg}
      ${barSvg}
      <text x="${leftPad}" y="20" font-size="10" fill="#5c6477" font-family="JetBrains Mono, monospace" letter-spacing="1">MONTHS FROM PROGRAMME KICK-OFF \u00b7 BARS LABELLED WITH FUND REQUIRED</text>
      ${legend}
    </svg>`
}

export function generateOpReport(input: GenerateReportInput): ReportBundle {
  const { acquirer, inputs, selected, allRanked, plan, lenders, balance, placement } = input
  const enabled = new Set<ReportSectionId>(input.sections || (Object.keys(REPORT_SECTION_LABELS) as ReportSectionId[]))
  const use = (id: ReportSectionId) => enabled.has(id)
  const nowIso = new Date().toISOString()
  const id = `OPID-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const title = `${acquirer.name} \u2014 Inorganic Growth Opportunity Identifier`
  const subtitle = `Target portfolio, acquisition strategy, fund plan, and balance-sheet projection`

  const ansoffMeta = ANSOFF.find((a) => a.id === inputs.ansoff)
  const porterMeta = PORTER.find((p) => p.id === inputs.porter)
  const exposedTargets = selected.filter((s) => s.hostileExposure.exposed)
  const highSeverity = selected.filter((s) => s.hostileExposure.severity === 'high')

  const s1 = !use('executive') ? '' : `
    <section>
      <div class="eyebrow">SECTION 01</div>
      <h2>Executive Summary</h2>
      <div class="hero">
        <p><strong>${esc(acquirer.name)}</strong> is targeting a revenue goal of <em>${fmtCr(inputs.targetRevenueCr)}</em>
           within <em>${inputs.horizonMonths} months</em> via an inorganic growth programme anchored on a
           <em>${esc(ansoffMeta?.label || inputs.ansoff)}</em> / <em>${esc(porterMeta?.label || inputs.porter)}</em> strategic posture.</p>
      </div>
      <div class="grid grid-4" style="margin-top:12px">
        <div class="card"><div class="stat-lbl">Targets selected</div><div class="stat">${selected.length}</div></div>
        <div class="card"><div class="stat-lbl">Total fund required</div><div class="stat">${fmtCr(plan.totalFundRequiredCr)}</div></div>
        <div class="card"><div class="stat-lbl">Projected revenue</div><div class="stat">${fmtCr(plan.projectedRevCr)}</div></div>
        <div class="card"><div class="stat-lbl">Goal verdict</div><div class="stat">${plan.isGoalAchievable ? '\u2713 Met' : `${fmtCr(Math.abs(plan.gapToGoalCr))} short`}</div></div>
      </div>
      <p style="margin-top:14px">
        Universe scored: <strong>${allRanked.length}</strong> companies against 8 deterministic sub-scores (sector fit,
        deal-size fit, growth, margin, Ansoff fit, Porter fit, policy tailwind, DealNector VC-Taxonomy sub-segment overlap).
        ${plan.isGoalAchievable
          ? `Selected portfolio <strong>reaches</strong> the revenue target inside the horizon.`
          : `Portfolio falls short by <strong>${fmtCr(Math.abs(plan.gapToGoalCr))}</strong>; either relax the deal-size band, extend the horizon, or pick additional targets flagged below.`}
        ${exposedTargets.length > 0 ? `<span class="pill pill-red">${exposedTargets.length} targets flagged for hostile-takeover exposure</span>` : ''}
      </p>
    </section>`

  const s2 = !use('acquirer') ? '' : `
    <section>
      <div class="eyebrow">SECTION 02</div>
      <h2>Acquirer Profile</h2>
      <div class="grid grid-3">
        <div class="card"><div class="stat-lbl">Name</div><div class="stat">${esc(acquirer.name)}</div></div>
        <div class="card"><div class="stat-lbl">Ticker</div><div class="stat">${esc(acquirer.ticker)}</div></div>
        <div class="card"><div class="stat-lbl">Sector</div><div class="stat">${esc(acquirer.sec || 'unclassified')}</div></div>
        <div class="card"><div class="stat-lbl">Revenue</div><div class="stat">${fmtCr(acquirer.rev || 0)}</div></div>
        <div class="card"><div class="stat-lbl">EBITDA</div><div class="stat">${fmtCr(acquirer.ebitda || 0)} (${(acquirer.ebm || 0).toFixed(1)}%)</div></div>
        <div class="card"><div class="stat-lbl">Mkt Cap</div><div class="stat">${fmtCr(acquirer.mktcap || 0)}</div></div>
        <div class="card"><div class="stat-lbl">Enterprise Value</div><div class="stat">${fmtCr(acquirer.ev || 0)}</div></div>
        <div class="card"><div class="stat-lbl">Debt / Equity</div><div class="stat">${(acquirer.dbt_eq || 0).toFixed(2)}</div></div>
        <div class="card"><div class="stat-lbl">DealNector Acq Score</div><div class="stat">${acquirer.acqs}/10 \u00b7 ${esc(acquirer.acqf || 'MONITOR')}</div></div>
      </div>
    </section>`

  const s3 = !use('framework') ? '' : `
    <section>
      <div class="eyebrow">SECTION 03</div>
      <h2>Strategic Framework</h2>
      <h3>Ansoff Matrix Vector</h3>
      <p><strong>${esc(ansoffMeta?.label || inputs.ansoff)}</strong> (risk: ${esc(ansoffMeta?.risk || 'medium')}) \u2014 ${esc(ansoffMeta?.thesis || '')}</p>
      <h3>Porter Generic Strategy</h3>
      <p><strong>${esc(porterMeta?.label || inputs.porter)}</strong> \u2014 ${esc(porterMeta?.thesis || '')}</p>
      <p class="muted" style="margin-top:6px">Target profile: ${esc(porterMeta?.targetProfile || '')}</p>
      <h3>Deal-Size Band</h3>
      <p>${fmtCr(inputs.dealSizeMinCr)} \u2013 ${fmtCr(inputs.dealSizeMaxCr)}; ownership preference per deal: ${esc(inputs.ownership.join(', ') || 'any')}.</p>
    </section>`

  const top10 = allRanked.slice(0, 10)
  const s4 = !use('portfolio') ? '' : `
    <section>
      <div class="eyebrow">SECTION 04</div>
      <h2>Target Portfolio \u2014 Top 10 of ${allRanked.length} Scored</h2>
      <table>
        <thead><tr><th>#</th><th>Target</th><th>Conviction</th><th>Structure</th><th>Horizon</th><th class="num">Deal size</th><th class="num">Synergy/yr</th></tr></thead>
        <tbody>
          ${top10.map((t, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${esc(t.name)}</strong> <span class="muted">(${esc(t.ticker)} \u00b7 ${esc(t.sec)})</span></td>
              <td><span class="pill ${t.conviction >= 0.7 ? 'pill-green' : t.conviction >= 0.5 ? 'pill-gold' : ''}">${(t.conviction * 100).toFixed(0)}%</span></td>
              <td>${esc(t.dealStructureLabel)}</td>
              <td class="small">${esc(t.horizon.label)}</td>
              <td class="num">${fmtCr(t.dealSizeCr)}</td>
              <td class="num">${fmtCr(t.synergy.totalCr)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>`

  const renderTarget = (t: OpTarget, idx: number) => `
    <div class="tgt">
      <div class="tgt-head">
        <div>
          <span class="section-tag">Target ${idx + 1}</span>
          <div class="tgt-name">${esc(t.name)} <span class="muted" style="font-size:12px;font-weight:400">(${esc(t.ticker)})</span></div>
          <div class="small">${esc(t.sec)} \u00b7 Conviction <strong>${(t.conviction * 100).toFixed(0)}%</strong> \u00b7 Horizon ${esc(t.horizon.label)}</div>
        </div>
        <div>
          <span class="pill pill-gold">BCG ${esc(t.bcg)}</span>
          <span class="pill pill-cyan">McK ${esc(t.mckinsey.replace(/_/g, ' '))}</span>
          <span class="pill pill-green">${esc(t.dealStructureLabel)}</span>
          ${t.hostileExposure.exposed ? `<span class="pill pill-red">\u26a0 Hostile \u00b7 ${esc(t.hostileExposure.severity)}</span>` : ''}
        </div>
      </div>
      <div class="grid grid-2">
        <div>
          <h3>Thesis</h3>
          <ul>${t.memo.thesis.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          <h3>Top Risks</h3>
          <ul>${t.memo.risks.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        </div>
        <div>
          <h3>Integration Plan</h3>
          <ul>${t.memo.integration.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          <h3>Valuation</h3>
          <ul>${t.memo.valuation.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        </div>
      </div>
      ${t.overlappingSubSegments.length > 0 ? `
        <h3>Sub-segment overlap</h3>
        <div>${t.overlappingSubSegments.map((s) => `<span class="pill pill-gold" style="margin-right:4px;margin-bottom:4px">${esc(s.label)}</span>`).join('')}</div>
      ` : ''}
      ${t.policyTailwinds.length > 0 ? `
        <h3>Policy tailwinds</h3>
        <div>${t.policyTailwinds.map((p) => `<span class="pill pill-green" style="margin-right:4px;margin-bottom:4px" title="${esc(p.name)}">${esc(p.short)}</span>`).join('')}</div>
      ` : ''}
    </div>`

  const s5 = selected.length === 0 || !use('memos') ? '' : `
    <section>
      <div class="eyebrow">SECTION 05</div>
      <h2>Selected-Target Memos</h2>
      ${selected.map((t, i) => renderTarget(t, i)).join('')}
    </section>`

  // ── New McKinsey-grade sections ─────────────────────────────
  // Trajectory assumes 100% consolidation of the target onto acquirer's
  // books post-close; the plan-level ownership scaling is applied in the
  // revenue waterfall, not here.
  const trajectories = selected.map((t) => ({ target: t, traj: trajectoryFor(t, 1.0) }))
  const analysis = selected.map((t) => ({ target: t, m: marketAnalysisFor(t) }))

  const s5b = selected.length === 0 || !use('marketAnalysis') ? '' : `
    <section>
      <div class="eyebrow">SECTION 05B</div>
      <h2>Market Analysis &amp; Competitive Advantage</h2>
      <p class="muted">McKinsey-grade market sizing, structural advantage, and recommendation rationale per selected target. All narrative composed deterministically from the 8-factor conviction model, BCG × McKinsey Horizon classification, policy tailwinds, DealNector sub-segment taxonomy, and synergy economics.</p>
      ${analysis.map(({ target: t, m }, i) => `
        <div class="tgt">
          <div class="tgt-head">
            <div>
              <span class="section-tag">Target ${i + 1}</span>
              <div class="tgt-name">${esc(t.name)} <span class="muted" style="font-size:12px;font-weight:400">(${esc(t.ticker)})</span></div>
              <div class="small">${esc(t.sec)} \u00b7 ${esc(t.bcg)} \u00b7 ${esc(t.mckinsey.replace(/_/g, ' '))}</div>
            </div>
            <div>
              <span class="pill pill-gold">Conviction ${(t.conviction * 100).toFixed(0)}%</span>
            </div>
          </div>
          <div class="grid grid-2">
            <div>
              <h3>Market Sizing &amp; Dynamics</h3>
              <ul>${m.sizing.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
            </div>
            <div>
              <h3>Market Advantage to Acquire</h3>
              <ul>${m.advantage.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
            </div>
          </div>
          <h3>Why This Asset Is Recommended</h3>
          <ul>${m.whyRecommended.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        </div>
      `).join('')}
    </section>`

  // 5-year value trajectory per selected target + portfolio aggregate.
  const aggregateYears = [1, 2, 3, 4, 5].map((y) => {
    const revCr = trajectories.reduce((s, { traj }) => s + traj.years[y - 1].revCr, 0)
    const ebitdaCr = trajectories.reduce((s, { traj }) => s + traj.years[y - 1].ebitdaCr, 0)
    const synergyCr = trajectories.reduce((s, { traj }) => s + traj.years[y - 1].synergyCr, 0)
    const valueAddCr = trajectories.reduce((s, { traj }) => s + traj.years[y - 1].valueAddCr, 0)
    const discountedValueCr = trajectories.reduce((s, { traj }) => s + traj.years[y - 1].discountedValueCr, 0)
    return { year: y, revCr, ebitdaCr, synergyCr, valueAddCr, discountedValueCr }
  })
  const totalDiscounted = aggregateYears.reduce((s, y) => s + y.discountedValueCr, 0)
  const goalGapFiveYear = Math.max(0, inputs.targetRevenueCr - (acquirer.rev || 0) - aggregateYears[4].revCr)

  const s5c = selected.length === 0 || !use('trajectory') ? '' : `
    <section>
      <div class="eyebrow">SECTION 05C</div>
      <h2>5-Year Value Trajectory</h2>
      <p class="muted">Per-target 5-year revenue, EBITDA, and synergy ramp (0% Y1 \u2192 35% Y2 \u2192 70% Y3 \u2192 100% Y4+), plus cumulative discounted value at a 10% WACC proxy. Growth decays at 12%/year to avoid hyper-extrapolation. Margin expands half-way toward an 18% industrial median across the horizon.</p>

      <h3>Portfolio Aggregate (${selected.length} targets)</h3>
      <table>
        <thead><tr><th>Year</th><th class="num">Revenue</th><th class="num">EBITDA</th><th class="num">Synergy</th><th class="num">Value Add</th><th class="num">Discounted</th></tr></thead>
        <tbody>
          ${aggregateYears.map((y) => `
            <tr>
              <td>Y${y.year}</td>
              <td class="num">${fmtCr(y.revCr)}</td>
              <td class="num">${fmtCr(y.ebitdaCr)}</td>
              <td class="num">${fmtCr(y.synergyCr)}</td>
              <td class="num">${fmtCr(y.valueAddCr)}</td>
              <td class="num">${fmtCr(y.discountedValueCr)}</td>
            </tr>
          `).join('')}
          <tr style="font-weight:700;background:#f6f7f9">
            <td>5-Year Total</td>
            <td class="num">\u2014</td>
            <td class="num">${fmtCr(aggregateYears.reduce((s, y) => s + y.ebitdaCr, 0))}</td>
            <td class="num">${fmtCr(aggregateYears.reduce((s, y) => s + y.synergyCr, 0))}</td>
            <td class="num">${fmtCr(aggregateYears.reduce((s, y) => s + y.valueAddCr, 0))}</td>
            <td class="num">${fmtCr(totalDiscounted)}</td>
          </tr>
        </tbody>
      </table>
      <p style="margin-top:10px">
        Cumulative 5-year NPV (10% WACC): <strong>${fmtCr(totalDiscounted)}</strong>.
        Fund requirement of ${fmtCr(plan.totalFundRequiredCr)} \u21d2 implied multiple-on-invested-capital
        <strong>${(totalDiscounted / Math.max(1, plan.totalFundRequiredCr)).toFixed(2)}\u00d7</strong>
        (value add \u00f7 capital deployed over 5 years).
        ${goalGapFiveYear > 0
          ? `At Year-5 the combined entity reaches <strong>${fmtCr((acquirer.rev || 0) + aggregateYears[4].revCr)}</strong> vs. goal of ${fmtCr(inputs.targetRevenueCr)} \u2014 shortfall of ${fmtCr(goalGapFiveYear)} to close via residual organic growth or a top-up transaction.`
          : `Combined entity at Year-5 crosses the ${fmtCr(inputs.targetRevenueCr)} revenue goal \u2014 organic growth of the acquirer alone must fund any overshoot.`}
      </p>

      ${trajectories.map(({ target: t, traj }, i) => `
        <div class="tgt" style="margin-top:14px">
          <div class="tgt-head">
            <div>
              <span class="section-tag">Target ${i + 1}</span>
              <div class="tgt-name">${esc(t.name)}</div>
              <div class="small">Implied 5-yr revenue CAGR <strong>${traj.revCagrPct.toFixed(1)}%</strong> \u00b7 cumulative value add <strong>${fmtCr(traj.fiveYearValueAddCr)}</strong> \u00b7 discounted <strong>${fmtCr(traj.fiveYearDiscountedCr)}</strong></div>
            </div>
            <div>
              <span class="pill pill-cyan">${esc(t.horizon.label)}</span>
            </div>
          </div>
          <table>
            <thead><tr><th>Year</th><th class="num">Revenue</th><th class="num">EBITDA</th><th class="num">Synergy</th><th class="num">Value Add</th><th class="num">Cumulative</th><th class="num">Discounted</th></tr></thead>
            <tbody>
              ${traj.years.map((y) => `
                <tr>
                  <td>Y${y.year}</td>
                  <td class="num">${fmtCr(y.revCr)}</td>
                  <td class="num">${fmtCr(y.ebitdaCr)}</td>
                  <td class="num">${fmtCr(y.synergyCr)}</td>
                  <td class="num">${fmtCr(y.valueAddCr)}</td>
                  <td class="num">${fmtCr(y.cumulativeValueCr)}</td>
                  <td class="num">${fmtCr(y.discountedValueCr)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <p class="small muted">Revenue deploys deal-size \u00f7 EV-on-revenue; synergy ramps from 0% in Y1 to 100% in Y4; EBITDA margin walks from ${t.ebitdaMarginPct.toFixed(1)}% toward 18% across 5 years.</p>
        </div>
      `).join('')}
    </section>`

  // §5D — Cross-target value comparison
  const trajMap = new Map<string, TargetTrajectory>()
  trajectories.forEach(({ target: t, traj }) => trajMap.set(t.ticker, traj))
  const comparisonGroups = compareTargets(selected, trajMap)
  const s5d = selected.length < 2 || !use('comparison') ? '' : `
    <section>
      <div class="eyebrow">SECTION 05D</div>
      <h2>Cross-Target Value Comparison</h2>
      <p class="muted">When multiple selected targets share a value-chain segment or sub-segment, capital should be concentrated on the highest composite-value asset unless a platform-plus-bolt-on rationale is intentional. The comparison below picks a winner per overlap group using:
        <strong>conviction \u00d7 5-year discounted value \u00d7 (1 + synergy density) \u00d7 integration-ease modifier</strong>.</p>
      ${comparisonGroups.length === 0 ? '<p class="muted">No two selected targets overlap on the same value-chain segment or sub-segment \u2014 each target addresses a distinct node. Skip consolidation; pursue all.</p>' : comparisonGroups.map((g) => `
        <div class="tgt">
          <div class="tgt-head">
            <div>
              <span class="section-tag">${g.basis === 'sub_segment' ? 'Sub-segment' : 'Value chain'}</span>
              <div class="tgt-name">${esc(g.label)} \u2014 ${g.targets.length} overlapping targets</div>
            </div>
            <div>
              <span class="pill pill-gold">Winner: ${esc(g.winner.target.name)}</span>
            </div>
          </div>
          <table>
            <thead><tr><th>Rank</th><th>Target</th><th class="num">Conviction</th><th class="num">5-yr NPV</th><th class="num">CAGR</th><th class="num">Synergy/yr</th><th>Integration</th><th class="num">Value Index</th></tr></thead>
            <tbody>
              ${g.targets.map((x, i) => `
                <tr style="${i === 0 ? 'background:rgba(200,162,75,0.08);font-weight:600' : ''}">
                  <td>${i === 0 ? '\u2605' : i + 1}</td>
                  <td>${esc(x.target.name)} <span class="muted">(${esc(x.target.ticker)})</span></td>
                  <td class="num">${(x.target.conviction * 100).toFixed(0)}%</td>
                  <td class="num">${fmtCr(x.traj.fiveYearDiscountedCr)}</td>
                  <td class="num">${x.traj.revCagrPct.toFixed(1)}%</td>
                  <td class="num">${fmtCr(x.target.synergy.totalCr)}</td>
                  <td>${esc(x.target.integrationMode)}</td>
                  <td class="num">${x.valueScore.toExponential(2)}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          <h3>Why ${esc(g.winner.target.name)} is the max-value pick</h3>
          <ul>${g.reasoning.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        </div>
      `).join('')}
    </section>`

  // §5E — Geographic footprint & market access
  const programmeGeo = selected.length === 0 ? null : aggregateGeography(acquirer, selected)
  const s5e = selected.length === 0 || !use('geography') || !programmeGeo ? '' : `
    <section>
      <div class="eyebrow">SECTION 05E</div>
      <h2>Geographic Footprint &amp; Market Access</h2>
      <p class="muted">Where each target operates domestically, which export corridors the acquisition inherits, and what new market avenues open up. Current DealNector universe is India-only \u2014 once the schema widens to carry non-India targets, cross-border candidates drop in via the same renderer and get validated against DGFT/ITC-HS export-import data to confirm demand patterns.</p>

      <h3>Programme-level map</h3>
      ${renderProgrammeMap(programmeGeo)}
      <p class="small muted" style="margin-top:8px">Arrow thickness = number of selected targets touching that export corridor. Coloured pills on the right show each region and the specific targets that anchor it.</p>

      <h3>Domestic operations \u2014 acquirer + programme footprint</h3>
      <div class="grid grid-2">
        <div class="card">
          <div class="stat-lbl">Acquirer (${esc(acquirer.ticker)})</div>
          <div class="stat" style="font-size:14px">${esc(acquirer.name)}</div>
          <div class="small" style="margin-top:4px">Country: <strong>${esc(programmeGeo.acquirerCountry)}</strong></div>
          <div class="small">Sector hub states: ${esc(programmeGeo.acquirerHubs.join(', '))}</div>
        </div>
        <div class="card">
          <div class="stat-lbl">Programme footprint (${selected.length} target${selected.length === 1 ? '' : 's'})</div>
          <div class="stat" style="font-size:14px">${programmeGeo.operationsFootprint.length} hub state${programmeGeo.operationsFootprint.length === 1 ? '' : 's'}</div>
          <div class="small" style="margin-top:4px">${esc(programmeGeo.operationsFootprint.join(', '))}</div>
        </div>
      </div>

      <h3>Per-target geography &amp; unlocks</h3>
      ${programmeGeo.briefs.map((b, i) => `
        <div class="tgt">
          <div class="tgt-head">
            <div>
              <span class="section-tag">Target ${i + 1}</span>
              <div class="tgt-name">${esc(b.name)} <span class="muted" style="font-size:12px;font-weight:400">(${esc(b.ticker)})</span></div>
              <div class="small">Country of operations: <strong>${esc(b.countryOfOperations)}</strong> \u00b7 Hubs: ${esc(b.hubs.join(', '))}</div>
            </div>
            <div>
              ${b.exports.slice(0, 3).map((r) => `<span class="pill" style="background:${r.color}22;border:1px solid ${r.color};color:${r.color};margin-left:3px">${esc(r.label)}</span>`).join('')}
            </div>
          </div>

          <div class="grid grid-2">
            <div>
              <h3>Domestic avenues unlocked</h3>
              <ul>${b.domesticUnlocks.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
            </div>
            <div>
              <h3>Export avenues unlocked</h3>
              <ul>${b.exportUnlocks.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
            </div>
          </div>

          ${b.exports.length > 0 ? `
            <h3>Export corridors \u00b7 sector-typical destinations</h3>
            <table>
              <thead><tr><th>Region</th><th>Representative countries</th><th>Strategic rationale</th></tr></thead>
              <tbody>
                ${b.exports.map((r) => `
                  <tr>
                    <td><span class="pill" style="background:${r.color}22;border:1px solid ${r.color};color:${r.color}">${esc(r.label)}</span></td>
                    <td class="small">${esc(r.countries.join(', '))}</td>
                    <td class="small">${esc(r.reasoning)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          ` : '<p class="muted small">No sector-typical export corridors inferred \u2014 target appears domestic-only.</p>'}
          <p class="small muted">${esc(b.validationSource)}</p>
        </div>
      `).join('')}
    </section>`

  const s6 = selected.length === 0 || !use('strategy') ? '' : `
    <section>
      <div class="eyebrow">SECTION 06</div>
      <h2>Acquisition Strategy &amp; Legal Path</h2>
      ${selected.map((t) => `
        <div class="tgt">
          <div class="tgt-head">
            <div>
              <div class="tgt-name">${esc(t.name)}</div>
              <div class="small">Promoter stake (proxy): <strong>${t.shareholding.promoterPct}%</strong> \u2014 band: <strong>${esc(t.shareholding.band)}</strong>. Public float: ${t.shareholding.publicFloatPct}%.</div>
            </div>
            <div>
              <span class="pill pill-gold">${esc(t.acquisitionStrategy.label)}</span>
            </div>
          </div>
          <h3>Execution Steps</h3>
          <ol>${t.acquisitionStrategy.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          <h3>Legal Considerations</h3>
          <ul>${t.acquisitionStrategy.legal.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          <h3>Shareholding Notes</h3>
          <ul>${t.shareholding.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        </div>
      `).join('')}
    </section>`

  const s7 = selected.length === 0 || !use('hostile') ? '' : `
    <section>
      <div class="eyebrow">SECTION 07</div>
      <h2>Hostile-Takeover Exposure</h2>
      ${exposedTargets.length === 0 ? '<p class="muted">None of the selected targets show material hostile-takeover exposure \u2014 promoter stakes are tight enough to require negotiated consent.</p>' : `
        <p>${exposedTargets.length} of ${selected.length} selected targets are exposed to hostile accumulation.
           ${highSeverity.length > 0 ? `<strong>${highSeverity.length}</strong> show <span class="pill pill-red">high severity</span>.` : ''}
           Below is the per-target assessment and SEBI SAST implication summary.</p>
        ${exposedTargets.map((t) => `
          <div class="tgt">
            <div class="tgt-head">
              <div>
                <div class="tgt-name">${esc(t.name)}</div>
                <div class="small">Promoter ${t.shareholding.promoterPct}% \u00b7 float ${t.shareholding.publicFloatPct}% \u00b7 severity <strong>${esc(t.hostileExposure.severity)}</strong></div>
              </div>
              <div><span class="pill pill-red">EXPOSED</span></div>
            </div>
            <h3>Exposure Triggers</h3>
            <ul>${t.hostileExposure.triggers.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
            <h3>SEBI SAST Notes</h3>
            <ul>${t.hostileExposure.sastNotes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          </div>
        `).join('')}
      `}
    </section>`

  const s8 = !use('timeline') ? '' : `
    <section>
      <div class="eyebrow">SECTION 08</div>
      <h2>Acquisition Timeline \u2014 Gantt</h2>
      ${selected.length === 0 ? '<p class="muted">Select at least one target to render the programme timeline.</p>' : `
        <p class="muted">Each bar spans the horizon band assigned to that target; bars are stacked non-overlapping and ordered by kick-off month. Green = near (0\u201312 m), gold = mid (12\u201324 m), cyan = long (24 m+). Label on each bar shows the deal size; left-rail shows the target name.</p>
        ${renderGantt(selected, inputs.horizonMonths)}
        <h3 style="margin-top:14px">Per-Target Fund &amp; Schedule</h3>
        <table>
          <thead><tr><th>#</th><th>Target</th><th>Horizon</th><th>Start\u2013End</th><th class="num">Deal size</th><th class="num">Cumulative fund</th><th class="num">Revenue add</th></tr></thead>
          <tbody>
            ${(() => {
              const sorted = [...selected].sort((a, b) => a.horizon.months[0] - b.horizon.months[0] || b.dealSizeCr - a.dealSizeCr)
              let cum = 0
              return sorted.map((t, i) => {
                cum += t.dealSizeCr
                return `
                  <tr>
                    <td>${i + 1}</td>
                    <td><strong>${esc(t.name)}</strong> <span class="muted">(${esc(t.ticker)})</span></td>
                    <td>${esc(t.horizon.label)}</td>
                    <td class="small">M${t.horizon.months[0]} \u2013 M${t.horizon.months[1]}</td>
                    <td class="num">${fmtCr(t.dealSizeCr)}</td>
                    <td class="num">${fmtCr(cum)}</td>
                    <td class="num">${fmtCr(t.revCr)}</td>
                  </tr>`
              }).join('')
            })()}
            <tr style="font-weight:700;background:#f6f7f9">
              <td colspan="4">Programme total</td>
              <td class="num">${fmtCr(plan.totalFundRequiredCr)}</td>
              <td class="num">\u2014</td>
              <td class="num">${fmtCr(selected.reduce((s, t) => s + t.revCr, 0))}</td>
            </tr>
          </tbody>
        </table>
        <div class="grid grid-3" style="margin-top:12px">
          ${HORIZONS.map((h) => {
            const inBand = selected.filter((s) => s.horizon.id === h.id)
            const fund = inBand.reduce((s, t) => s + t.dealSizeCr, 0)
            const rev = inBand.reduce((s, t) => s + t.revCr, 0)
            return `
              <div class="card">
                <div class="stat-lbl">${esc(h.label)}</div>
                <div class="stat">${inBand.length} deals</div>
                <div class="small">${fmtCr(fund)} deployed \u00b7 +${fmtCr(rev)} revenue</div>
              </div>`
          }).join('')}
        </div>
      `}
    </section>`

  const topLenders = lenders.slice(0, 4)
  const s9 = !use('fund') ? '' : `
    <section>
      <div class="eyebrow">SECTION 09</div>
      <h2>Fund Requirement &amp; Lender Map</h2>
      <p>Aggregate fund requirement across selected targets: <strong>${fmtCr(plan.totalFundRequiredCr)}</strong>.
         Recommended capital stack below orders lenders by deterministic fit scoring against deal size, structure mix,
         and acquirer leverage profile.</p>
      <table>
        <thead><tr><th>Rank</th><th>Lender / Source</th><th class="num">Fit</th><th>Thesis</th></tr></thead>
        <tbody>
          ${topLenders.map((l, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${esc(l.label)}</strong></td>
              <td class="num">${l.fitPct}%</td>
              <td class="small">${esc(l.thesis)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p class="small muted">Typical blended cost of capital: 9.5\u201311% depending on lender mix and acquirer IG rating.</p>
    </section>`

  const coverageNote = balance.interestCoverageX == null
    ? 'Interest coverage not computable (EBITDA baseline missing).'
    : `Interest coverage post-close: <strong>${balance.interestCoverageX.toFixed(1)}\u00d7</strong> \u2014 ${balance.interestCoverageX >= 3 ? 'comfortable' : balance.interestCoverageX >= 1.8 ? 'manageable' : 'tight; renegotiate covenants'}.`
  const s10 = !use('balance') ? '' : `
    <section>
      <div class="eyebrow">SECTION 10</div>
      <h2>Balance-Sheet Projection</h2>
      <div class="grid grid-4">
        <div class="card"><div class="stat-lbl">Pre-deal D/E</div><div class="stat">${balance.preDebtToEquity.toFixed(2)}\u00d7</div></div>
        <div class="card"><div class="stat-lbl">Post-deal D/E</div><div class="stat">${balance.postDebtToEquity.toFixed(2)}\u00d7</div></div>
        <div class="card"><div class="stat-lbl">Interest coverage</div><div class="stat">${balance.interestCoverageX != null ? balance.interestCoverageX.toFixed(1) + '\u00d7' : '\u2014'}</div></div>
        <div class="card"><div class="stat-lbl">Cash gap</div><div class="stat">${fmtCr(balance.cashGapCr)}</div></div>
      </div>
      <p style="margin-top:12px">${coverageNote}</p>
      <p><strong>Verdict:</strong> ${esc(balance.verdict)}</p>
      <p class="small muted">Assumption: 70% debt / 30% equity financing mix for the deal stack. Target EBITDA fully consolidated from closing date.</p>
    </section>`

  const s11 = !use('placement') ? '' : `
    <section>
      <div class="eyebrow">SECTION 11</div>
      <h2>Pre vs Post Firm Placement</h2>
      <div class="grid grid-2">
        <div class="card">
          <div class="stat-lbl">Pre-deal</div>
          <div class="stat">${esc(placement.preMktCapBand)}</div>
          <div class="small" style="margin-top:6px">${esc(placement.preRevRankApprox)}</div>
        </div>
        <div class="card">
          <div class="stat-lbl">Post-deal (estimate)</div>
          <div class="stat">${esc(placement.postMktCapBand)}</div>
          <div class="small" style="margin-top:6px">${esc(placement.postRevRankApprox)}</div>
        </div>
      </div>
      <div style="margin-top:12px">
        ${placement.narrative.map((n) => `<p>${esc(n)}</p>`).join('')}
      </div>
    </section>`

  const s12 = !use('risks') ? '' : `
    <section>
      <div class="eyebrow">SECTION 12</div>
      <h2>Risks &amp; Next Steps</h2>
      <h3>Programme-level risks</h3>
      <ul>
        <li>Integration execution risk compounds across simultaneous deals \u2014 stagger closings by at least 60 days.</li>
        <li>Interest-rate cycle exposure given ${(balance.postDebtToEquity).toFixed(1)}\u00d7 D/E post-close.</li>
        <li>Regulatory clock: CCI filings add 30\u201390 days per deal above the thresholds.</li>
        ${exposedTargets.length > 0 ? `<li>${exposedTargets.length} hostile-exposed targets \u2014 competing bidder risk; consider SPA exclusivity + break fees.</li>` : ''}
      </ul>
      <h3>30-day next steps</h3>
      <ol>
        <li>Board memo + IC approval for the shortlist of ${selected.length} targets.</li>
        <li>Outreach to top-3 lender relationships to lock indicative term sheets.</li>
        <li>Engage counsel (corporate, tax, antitrust) on the structure recommendation per target.</li>
        <li>Commission commercial DD (customer, supplier, operations) on the near-horizon target(s).</li>
        <li>Pre-alert SEBI and RBI on any inbound FDI involvement for the programme.</li>
      </ol>
    </section>`

  const s13 = !use('methodology') ? '' : `
    <section>
      <div class="eyebrow">APPENDIX</div>
      <h2>Methodology</h2>
      <p class="small muted">Scoring is deterministic: 8 sub-axes (sector fit 0.18, size fit 0.16, growth 0.14, margin 0.12, Ansoff 0.10, Porter 0.08, policy tailwind 0.10, sub-segment overlap 0.12). BCG quadrant via growth \u00d7 margin split at 15%/12%. McKinsey horizon via sector + comp overlap. Haspeslagh\u2013Jemison integration via size ratio + interdependence proxy. Deal structure recommended per integration mode + Focus tilt + distressed signal. Synergy estimate: 3% of target revenue + 1% of acquirer revenue (revenue synergy) + 2% of target EBITDA + 0.5% of target revenue (cost synergy). Valuation triangulation against live sector-median EV/EBITDA computed from the universe at report time. All framework data sourced from the DealNector company database \u2014 no external calls. Report ID: ${esc(id)}.</p>
    </section>`

  const html = `
    <!DOCTYPE html>
    <html lang="en"><head>
      <meta charset="utf-8" />
      <title>${esc(title)}</title>
      <style>${CSS}</style>
    </head><body>
      <div class="page">
        <div class="eyebrow">DealNector \u00b7 Institutional Report</div>
        <h1>${esc(acquirer.name)} \u2014 <em>Op Identifier</em> Report</h1>
        <p class="muted">${esc(subtitle)}</p>
        <p class="small muted">Generated ${esc(new Date(nowIso).toLocaleString('en-IN'))} \u00b7 Report ID ${esc(id)}</p>
        <div class="rule"></div>
        ${s1}${s2}${s3}${s4}${s5}${s5b}${s5c}${s5d}${s5e}${s6}${s7}${s8}${s9}${s10}${s11}${s12}${s13}
        <div class="footer">
          <strong>Confidential \u00b7 DealNector Institutional Intelligence.</strong>
          This report is an illustrative analytical artefact generated from
          the DealNector company database and rule-based frameworks. It is
          not investment advice and must not be the sole basis for any
          transaction decision.
        </div>
      </div>
    </body></html>`

  return {
    id,
    title,
    subtitle,
    generatedAt: nowIso,
    acquirerTicker: acquirer.ticker,
    html,
  }
}
