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
import { ANSOFF, PORTER, HORIZONS, POSITION_ORDER, POSITION_LABELS, type VcPosition } from './frameworks'
import {
  TAXONOMY_STAGES,
  industryLabel,
  industryCodeFor,
  COMP_TO_STAGE_CODE,
  getSubSegmentById,
} from '@/lib/data/sub-segments'
import { recommendTargetScope } from './recommender'
import {
  aggregateGeography,
  renderProgrammeMap,
  prospectiveGeographies,
  geographyFor,
  REGION_LABELS,
  type ExportRegionId,
} from './geography'
import {
  COUNTRY_POLICY_REGIMES,
  TRADE_FLOW_MATRIX,
  TARGET_ASSET_TYPES,
  classifyAssetType,
} from './investment-criteria'
import {
  DEAL_SIZE_THRESHOLDS,
  pickDealSizeTier,
} from './criteria-derivation'

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
    --ink: #0d1b2a;
    --ink-2: #1f2a3d;
    --muted: #6b7280;
    --muted-2: #9ca3af;
    --gold: #a47a28;
    --gold-soft: #c6a255;
    --green: #166534;
    --green-soft: #22c55e;
    --red: #991b1b;
    --red-soft: #ef4444;
    --cyan: #0e7490;
    --rule: #e5e7eb;
    --rule-2: #f3f4f6;
    --bg: #ffffff;
    --soft: #fafaf7;
    --cream: #f8f5ef;
    --navy: #0b1e3a;
    --navy-2: #1a2f4f;
    --blue: #1e5aa8;
    --blue-2: #3778c2;
    --teal: #0e7490;
    --amber: #b45309;
    --plum: #6d28d9;
    --rose: #be185d;
    --slate-50: #f8fafc;
    --slate-100: #f1f5f9;
    --slate-200: #e2e8f0;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { font-family: 'Source Serif 4', 'Source Serif Pro', Georgia, 'Times New Roman', serif; color: var(--ink); background: #e9ebef; -webkit-font-smoothing: antialiased; }
  .page {
    max-width: 816px; width: 100%; margin: 16px auto; padding: 56px 64px 72px;
    background: var(--bg); box-shadow: 0 2px 20px rgba(11,30,58,0.09);
    min-height: 1056px; overflow-wrap: anywhere; word-break: normal;
  }
  @media print {
    @page { size: Letter; margin: 0.65in; }
    body { background: #fff; }
    .page { max-width: none; width: auto; margin: 0; padding: 0; box-shadow: none; min-height: auto; }
    section { page-break-inside: avoid; break-inside: avoid; }
    h2 { page-break-after: avoid; break-after: avoid; }
    .dossier { page-break-inside: avoid; break-inside: avoid; }
    .dossier.force-break, .section-break { page-break-before: always; break-before: page; }
    .cover { page-break-after: always; break-after: page; }
    .part-ribbon { page-break-before: always; break-before: page; }
    table { page-break-inside: avoid; }
    svg { page-break-inside: avoid; }
  }

  /* Cover page — for IC + Detailed variants */
  .cover {
    min-height: 1056px;
    display: flex; flex-direction: column; justify-content: space-between;
    padding: 80px 64px 64px;
    background: linear-gradient(180deg, var(--navy) 0%, var(--navy-2) 50%, #0f2847 100%);
    color: #fff; margin: -56px -64px 0; position: relative; overflow: hidden;
  }
  .cover::before {
    content: ''; position: absolute; top: 0; right: 0; width: 280px; height: 280px;
    background: radial-gradient(circle, rgba(196,162,75,0.22) 0%, transparent 70%);
    pointer-events: none;
  }
  .cover::after {
    content: ''; position: absolute; bottom: 0; left: 0; width: 320px; height: 320px;
    background: radial-gradient(circle, rgba(30,90,168,0.28) 0%, transparent 70%);
    pointer-events: none;
  }
  .cover .cover-eyebrow {
    font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 3.2px;
    text-transform: uppercase; color: #c6a255; font-weight: 700;
  }
  .cover .cover-title {
    font-family: 'Source Serif 4', Georgia, serif; font-size: 44px; font-weight: 700;
    letter-spacing: -0.02em; line-height: 1.1; margin-top: 18px; color: #fff;
  }
  .cover .cover-title em { color: #e9c676; font-style: italic; font-weight: 400; }
  .cover .cover-sub {
    font-family: 'Source Serif 4', Georgia, serif; font-size: 16px; line-height: 1.55;
    color: rgba(255,255,255,0.82); margin-top: 20px; max-width: 560px;
  }
  .cover .cover-tiles {
    display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-top: 40px;
  }
  .cover .cover-tile {
    padding: 14px; background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.15); border-radius: 5px;
  }
  .cover .cover-tile-lbl {
    font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 1.4px;
    text-transform: uppercase; color: #c6a255; margin-bottom: 6px;
  }
  .cover .cover-tile-val {
    font-family: 'Source Serif 4', Georgia, serif; font-size: 20px; font-weight: 700; color: #fff;
    letter-spacing: -0.01em;
  }
  .cover .cover-tile-sub { font-size: 10px; color: rgba(255,255,255,0.55); margin-top: 3px; }
  .cover .cover-foot {
    display: flex; justify-content: space-between; align-items: flex-end; gap: 20px;
    border-top: 1px solid rgba(255,255,255,0.12); padding-top: 22px;
    font-size: 10px; color: rgba(255,255,255,0.6);
    font-family: 'JetBrains Mono', monospace; letter-spacing: 0.5px;
  }
  .cover .cover-pill {
    display: inline-block; padding: 5px 12px; border-radius: 3px;
    background: rgba(196,162,75,0.18); color: #e9c676; font-weight: 700;
    letter-spacing: 1.4px; text-transform: uppercase; font-size: 9px;
  }

  /* Part-level divider ribbons */
  .part-ribbon {
    margin: 36px -64px 22px; padding: 38px 64px 30px;
    color: #fff; position: relative; overflow: hidden;
  }
  .part-ribbon.part-1 { background: linear-gradient(110deg, var(--navy) 0%, var(--navy-2) 100%); }
  .part-ribbon.part-2 { background: linear-gradient(110deg, var(--blue) 0%, var(--blue-2) 100%); }
  .part-ribbon.part-3 { background: linear-gradient(110deg, var(--amber) 0%, var(--gold) 100%); }
  .part-ribbon .part-num {
    font-family: 'JetBrains Mono', monospace; font-size: 11px; letter-spacing: 4px;
    text-transform: uppercase; color: rgba(255,255,255,0.7); font-weight: 700;
  }
  .part-ribbon .part-title {
    font-family: 'Source Serif 4', Georgia, serif; font-size: 28px; font-weight: 700;
    letter-spacing: -0.015em; color: #fff; margin-top: 6px;
  }
  .part-ribbon .part-desc {
    font-size: 12px; color: rgba(255,255,255,0.78); margin-top: 8px; max-width: 540px; line-height: 1.55;
  }

  /* Exhibit numbering — every chart/table gets an exhibit label */
  .exhibit { position: relative; margin: 16px 0; }
  .exhibit-lbl {
    font-family: 'JetBrains Mono', monospace; font-size: 9px; letter-spacing: 1.4px;
    text-transform: uppercase; color: var(--gold); font-weight: 700; margin-bottom: 6px;
  }
  .exhibit-title {
    font-family: 'Source Serif 4', Georgia, serif; font-size: 13px; font-weight: 700;
    color: var(--navy); margin-bottom: 2px;
  }
  .exhibit-sub { font-size: 10.5px; color: var(--muted); margin-bottom: 10px; font-style: italic; }

  /* Accent-tinted section intros — rotate through the palette */
  .sec-accent-blue { border-left: 3px solid var(--blue); padding-left: 14px; }
  .sec-accent-gold { border-left: 3px solid var(--gold); padding-left: 14px; }
  .sec-accent-teal { border-left: 3px solid var(--teal); padding-left: 14px; }
  .sec-accent-plum { border-left: 3px solid var(--plum); padding-left: 14px; }

  /* Dense dashboard strip used across variants */
  .dashboard-strip {
    display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px;
    padding: 14px; background: var(--slate-50);
    border: 1px solid var(--rule); border-radius: 6px; margin: 12px 0;
  }
  .dashboard-cell { text-align: left; }
  .dashboard-lbl {
    font-family: 'JetBrains Mono', monospace; font-size: 8.5px; letter-spacing: 1.2px;
    text-transform: uppercase; color: var(--muted); margin-bottom: 3px;
  }
  .dashboard-val {
    font-family: 'Source Serif 4', Georgia, serif; font-size: 17px; font-weight: 700;
    color: var(--navy); letter-spacing: -0.01em;
  }
  .dashboard-sub { font-size: 9.5px; color: var(--muted); margin-top: 2px; }

  /* Type scale — institutional */
  .eyebrow {
    font-family: 'JetBrains Mono', 'Courier New', monospace;
    font-size: 10px; letter-spacing: 2.5px; text-transform: uppercase;
    color: var(--gold); font-weight: 700; margin-bottom: 6px;
  }
  h1, h2, h3, h4 { font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif; font-weight: 600; color: var(--navy); margin: 0; }
  h1 { font-size: 30px; letter-spacing: -0.015em; line-height: 1.2; margin-bottom: 6px; }
  h2 {
    font-size: 20px; letter-spacing: -0.005em;
    border-top: 1.5px solid var(--gold);
    padding-top: 14px; margin-top: 34px; margin-bottom: 12px;
    position: relative;
  }
  h3 {
    font-family: 'Source Serif 4', Georgia, serif;
    font-size: 13px; letter-spacing: 0.8px; text-transform: uppercase;
    color: var(--gold); font-weight: 700;
    margin-top: 20px; margin-bottom: 8px;
  }
  h4 {
    font-size: 11px; letter-spacing: 1px; text-transform: uppercase;
    color: var(--muted); font-weight: 700;
    margin-top: 12px; margin-bottom: 6px;
  }
  p { font-size: 12px; line-height: 1.65; margin: 0 0 10px; color: var(--ink-2); }
  p.lede { font-size: 13px; line-height: 1.7; color: var(--ink); }
  .muted { color: var(--muted); }
  .small { font-size: 10.5px; color: var(--muted); line-height: 1.55; }
  ul, ol { margin: 0 0 10px; padding-left: 20px; line-height: 1.65; font-size: 12px; color: var(--ink-2); }
  li { margin-bottom: 4px; }

  /* Layout primitives */
  .grid { display: grid; gap: 14px; }
  .grid-2 { grid-template-columns: 1fr 1fr; }
  .grid-3 { grid-template-columns: repeat(3, 1fr); }
  .grid-4 { grid-template-columns: repeat(4, 1fr); }
  .grid > * { min-width: 0; }

  /* Cards */
  .card {
    background: var(--soft); border: 1px solid var(--rule); border-radius: 6px;
    padding: 14px 16px; min-width: 0;
  }
  .card-muted { background: #fff; }
  .stat {
    font-family: 'Source Serif 4', Georgia, serif;
    font-weight: 700; font-size: 19px; color: var(--navy);
    letter-spacing: -0.01em; line-height: 1.2;
  }
  .stat-lbl {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px; letter-spacing: 1.2px; text-transform: uppercase;
    color: var(--muted); margin-bottom: 4px;
  }
  .stat-num { font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 17px; color: var(--navy); }

  /* Tables — editorial grid */
  .table-wrap { max-width: 100%; overflow-x: auto; margin: 10px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; margin: 6px 0; table-layout: auto; }
  th, td { padding: 8px 10px; border-bottom: 1px solid var(--rule); text-align: left; vertical-align: top; }
  th {
    background: var(--cream); color: var(--navy);
    font-size: 9.5px; letter-spacing: 0.8px; text-transform: uppercase;
    font-weight: 700; border-bottom: 1.5px solid var(--gold);
    font-family: 'Source Serif 4', Georgia, serif;
  }
  td.num, th.num { font-family: 'JetBrains Mono', monospace; text-align: right; font-size: 11px; }
  tr:last-child td { border-bottom: none; }

  /* Pills */
  .pill {
    display: inline-block; padding: 2px 9px; border-radius: 2px;
    font-size: 9.5px; font-weight: 700; letter-spacing: 0.6px;
    text-transform: uppercase; font-family: 'Source Serif 4', Georgia, serif;
    margin-right: 4px; margin-bottom: 3px;
  }
  .pill-gold { background: rgba(164,122,40,0.10); border: 1px solid var(--gold); color: var(--gold); }
  .pill-green { background: rgba(22,101,52,0.08); border: 1px solid var(--green); color: var(--green); }
  .pill-red { background: rgba(153,27,27,0.08); border: 1px solid var(--red); color: var(--red); }
  .pill-cyan { background: rgba(14,116,144,0.08); border: 1px solid var(--cyan); color: var(--cyan); }
  .pill-navy { background: rgba(11,30,58,0.06); border: 1px solid var(--navy); color: var(--navy); }

  /* Hero callouts */
  .hero {
    border-left: 3px solid var(--gold);
    padding: 14px 18px; background: var(--cream);
    margin: 14px 0;
  }
  .hero em { font-style: italic; color: var(--gold); font-weight: 700; }

  .rule { height: 1px; background: var(--rule); margin: 20px 0; }
  .section-tag {
    display: inline-block; padding: 3px 10px; background: var(--navy); color: #fff;
    border-radius: 2px; font-size: 9px; letter-spacing: 1.4px; text-transform: uppercase;
    font-family: 'JetBrains Mono', monospace; font-weight: 700;
  }

  /* Dossier — target-first layout */
  .dossier {
    border: 1px solid var(--rule); border-radius: 6px; background: #fff;
    margin: 22px 0; padding: 0; overflow: hidden;
  }
  .dossier-hero {
    padding: 18px 22px; background: linear-gradient(180deg, var(--cream) 0%, #fff 100%);
    border-bottom: 1px solid var(--rule);
    display: flex; justify-content: space-between; align-items: flex-start; gap: 14px; flex-wrap: wrap;
  }
  .dossier-name {
    font-family: 'Source Serif 4', Georgia, serif;
    font-size: 22px; font-weight: 700; color: var(--navy);
    letter-spacing: -0.01em; line-height: 1.2; margin: 0;
  }
  .dossier-ticker { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: var(--muted); font-weight: 500; margin-left: 8px; }
  .dossier-subline { font-size: 11px; color: var(--muted); margin-top: 3px; letter-spacing: 0.3px; }
  .dossier-body { padding: 18px 22px; }
  .dossier-block { margin-top: 18px; }
  .dossier-block:first-child { margin-top: 0; }

  /* Verdict badges */
  .verdict {
    display: inline-block; padding: 8px 14px; border-radius: 3px;
    font-family: 'Source Serif 4', Georgia, serif; font-weight: 700;
    font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase;
    line-height: 1;
  }
  .verdict-strong { background: var(--green); color: #fff; }
  .verdict-recommended { background: var(--gold); color: #fff; }
  .verdict-consider { background: var(--cyan); color: #fff; }
  .verdict-monitor { background: var(--muted); color: #fff; }

  .value-add {
    border-top: 1px solid var(--rule);
    padding: 14px 22px; background: var(--cream);
    font-size: 11.5px; color: var(--ink);
  }
  .value-add-lbl {
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px; letter-spacing: 1.6px; text-transform: uppercase;
    color: var(--gold); font-weight: 700; margin-bottom: 4px;
  }

  /* SVG containment */
  .chart-wrap { max-width: 100%; overflow: hidden; margin: 12px 0; border: 1px solid var(--rule); border-radius: 6px; background: #fff; }
  .chart-wrap svg { display: block; width: 100%; height: auto; max-width: 100%; }

  .score-row { display: grid; grid-template-columns: 130px 1fr 50px; align-items: center; gap: 10px; font-size: 10.5px; margin-bottom: 3px; }
  .score-label { color: var(--muted); font-family: 'JetBrains Mono', monospace; font-size: 10px; letter-spacing: 0.3px; }
  .score-bar { background: var(--rule-2); height: 6px; border-radius: 1px; overflow: hidden; }
  .score-bar-fill { height: 100%; background: var(--gold); }
  .score-val { font-family: 'JetBrains Mono', monospace; font-size: 10px; text-align: right; color: var(--muted); }

  .footer {
    margin-top: 50px; padding-top: 22px; border-top: 2px solid var(--gold);
    font-size: 10px; color: var(--muted); line-height: 1.6;
  }
`

export type ReportSectionId =
  | 'executive'
  | 'keyThemes'
  | 'acquirer'
  | 'framework'
  | 'investmentCriteria'
  | 'marketIntelligence'
  | 'portfolio'
  | 'memos'
  | 'marketAnalysis'
  | 'trajectory'
  | 'comparison'
  | 'whereToPlay'
  | 'geography'
  | 'integrationMap'
  | 'strategy'
  | 'hostile'
  | 'timeline'
  | 'fund'
  | 'balance'
  | 'placement'
  | 'risks'
  | 'conclusion'
  | 'methodology'

export const REPORT_SECTION_LABELS: Record<ReportSectionId, string> = {
  executive: 'Executive Summary',
  keyThemes: 'Key Themes — What You Need to Know',
  acquirer: 'The Mandate — Acquirer & Target Profile',
  framework: 'Strategic Framework',
  investmentCriteria: 'Investment Criteria & Screening Thresholds',
  marketIntelligence: 'Market Intelligence — Policy Regimes & Trade Flows',
  portfolio: 'The Universe — Target Portfolio',
  memos: 'Per-Target Dossiers',
  marketAnalysis: 'Market Analysis & Advantage',
  trajectory: '5-Year Value Trajectory',
  comparison: 'Cross-Target Comparison',
  whereToPlay: 'Where to Play — Moves Mapped',
  geography: 'Geographic Footprint & Market Access',
  integrationMap: 'Integration Strategy Map',
  strategy: 'Acquisition Strategy & Legal Path',
  hostile: 'Hostile-Takeover Exposure',
  timeline: 'Programme Timeline (Gantt)',
  fund: 'Fund Requirement & Lender Map',
  balance: 'Balance-Sheet Projection',
  placement: 'Pre/Post Firm Placement',
  risks: 'Risks & Mitigations',
  conclusion: 'Conclusion — Recommendation & 30/60/90-Day Roadmap',
  methodology: 'Methodology',
}

export type ReportVariant = 'board' | 'ic' | 'detailed'

export const REPORT_PRESETS: Record<ReportVariant, ReportSectionId[]> = {
  // Board — 4-6 pages. Only the essentials a board needs to take a
  // decision: verdict, what we screened for, where we're playing
  // (market intel), the integration shape, the timeline, and the
  // conclusion. Every bulk-detail section (per-target memos, balance
  // sheet exhibits, full portfolio table) is deliberately dropped.
  board: ['executive', 'keyThemes', 'investmentCriteria', 'marketIntelligence', 'integrationMap', 'timeline', 'conclusion'],
  // IC — 15-20 pages. Pre-decisional memo that covers the mandate,
  // the criteria + market intel we filtered on, the framework, the
  // selected target dossiers, the where-to-play map, the integration
  // mode, the deal-structure + timeline, the capital stack, the risks,
  // and the conclusion. Drops per-target trajectories, balance-sheet
  // exhibits, placement narrative, and methodology (lives in Detailed).
  ic: ['executive', 'keyThemes', 'acquirer', 'framework', 'investmentCriteria', 'marketIntelligence', 'memos', 'whereToPlay', 'comparison', 'integrationMap', 'strategy', 'timeline', 'fund', 'risks', 'conclusion'],
  // Detailed — 60-90 pages. Everything: every target's full trajectory
  // table, every sub-segment pill, methodology + per-target appendices.
  detailed: Object.keys(REPORT_SECTION_LABELS) as ReportSectionId[],
}

export const VARIANT_META: Record<ReportVariant, { label: string; description: string; pageTarget: string; accent: string }> = {
  board: {
    label: 'Board Pack',
    description: 'Board-level summary — exec verdict, key themes, timeline, geography, and conclusion. Tight and visual.',
    pageTarget: '4–6 pages',
    accent: '#0b1e3a',
  },
  ic: {
    label: 'Investment Committee',
    description: 'Pre-decisional memo — full dossiers + comparison + capital stack + balance sheet + placement + 30/60/90 roadmap.',
    pageTarget: '15–20 pages',
    accent: '#1e5aa8',
  },
  detailed: {
    label: 'Detailed Memo',
    description: 'Full institutional pack — everything above plus trajectory tables, sub-segment deep-dives, methodology appendix, per-target exhibits.',
    pageTarget: '60–90 pages',
    accent: '#a47a28',
  },
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
  /** Report persona: drives cover page, density, palette accent, and
   *  which extra appendices emit. Defaults to 'ic'. */
  variant?: ReportVariant
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
 * classification, and sub-segment overlap. Mirrors an institutional
 * industry analysis deck without any generative text.
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
 * Integration strategy classifier — four-way mapping of how a target
 * relates to the acquirer's existing value chain. Collapses the
 * algorithm's finer-grained `integrationDir` + sector-match signals
 * into the four buckets institutional M&A playbooks use:
 *
 *   - backward       : same sector, target is upstream (secure supply, capture supplier margin)
 *   - forward        : same sector, target is downstream (own the customer, capture downstream margin)
 *   - complementary  : same sector, same/near stage (bolt-on for scale, geography, capability)
 *   - diversification: different sector (enter a new value chain)
 */
export type IntegrationStrategy = 'backward' | 'forward' | 'complementary' | 'diversification'

export interface IntegrationClassification {
  strategy: IntegrationStrategy
  label: string
  color: string
  reasoning: string
  direction: 'upstream' | 'downstream' | 'parallel' | 'new'
}

function classifyIntegration(acquirer: Company, target: OpTarget): IntegrationClassification {
  const sameSector = (acquirer.sec || '').toLowerCase() === (target.sec || '').toLowerCase()
  if (!sameSector) {
    return {
      strategy: 'diversification',
      label: 'Diversification',
      color: '#7c3aed', // purple
      reasoning: `Target sits in ${target.sec || 'an unclassified sector'} while acquirer is in ${acquirer.sec || 'unclassified'} \u2014 this is a move into a new value chain, opening optionality but requiring fresh capabilities.`,
      direction: 'new',
    }
  }
  if (target.integrationDir === 'backward') {
    return {
      strategy: 'backward',
      label: 'Backward Integration',
      color: '#0e7490', // cyan
      reasoning: `Same sector; target is upstream of the acquirer on the value chain (${target.vcPosition} vs. acquirer's position). Secures supply, captures supplier margin, de-risks input cost volatility.`,
      direction: 'upstream',
    }
  }
  if (target.integrationDir === 'forward') {
    return {
      strategy: 'forward',
      label: 'Forward Integration',
      color: '#a47a28', // gold
      reasoning: `Same sector; target is downstream of the acquirer (${target.vcPosition}). Captures customer relationship, downstream margin, and pricing control closer to the end user.`,
      direction: 'downstream',
    }
  }
  // Same sector + horizontal or adjacent → complementary bolt-on
  return {
    strategy: 'complementary',
    label: 'Complementary',
    color: '#166534', // green
    reasoning: `Same sector, same/adjacent value-chain stage \u2014 a bolt-on for scale, geographic reach, or capability adjacency rather than a vertical move.`,
    direction: 'parallel',
  }
}

/**
 * Value-chain strip diagram. Horizontal axis = 6 VC stages; acquirer
 * chip placed at its position; each target plotted at its VC position
 * with a coloured dot + label. Curved arrows from acquirer to each
 * target show direction. Fits inside the letter-size page width.
 */
function renderValueChainStrip(
  acquirer: Company,
  acquirerPos: VcPosition,
  classifications: Array<{ target: OpTarget; cls: IntegrationClassification }>,
  width = 720,
): string {
  const leftPad = 20
  const rightPad = 20
  const topPad = 40
  const stripY = 90
  const stripH = 40
  const bottomY = 220
  const height = bottomY + 24
  const plotW = width - leftPad - rightPad
  const stages = POSITION_ORDER.length
  const stageW = plotW / stages
  const xAtPos = (pos: VcPosition, offset = 0): number => {
    const i = POSITION_ORDER.indexOf(pos)
    return leftPad + (i + 0.5) * stageW + offset
  }

  // Stage segments
  const stageColours = ['#d8cfb7', '#cdc0a0', '#bfa980', '#b49366', '#a37f4f', '#8f6a38']
  const stageBars = POSITION_ORDER.map((p, i) => {
    const x = leftPad + i * stageW
    return `
      <rect x="${x}" y="${stripY}" width="${stageW - 2}" height="${stripH}" fill="${stageColours[i]}" opacity="0.65" rx="2" ry="2"/>
      <text x="${x + stageW / 2}" y="${stripY + stripH / 2 + 4}" text-anchor="middle" font-size="10" fill="#0b1e3a" font-weight="700" font-family="Source Serif 4, Georgia, serif">${esc(POSITION_LABELS[p])}</text>
      <text x="${x + stageW / 2}" y="${stripY - 6}" text-anchor="middle" font-size="8" fill="#6b7280" font-family="JetBrains Mono, monospace">${i + 1}</text>`
  }).join('')

  // Acquirer marker (centred above strip)
  const ax = xAtPos(acquirerPos)
  const acquirerMarker = `
    <g>
      <line x1="${ax}" y1="${topPad + 10}" x2="${ax}" y2="${stripY - 2}" stroke="#a47a28" stroke-width="2"/>
      <circle cx="${ax}" cy="${topPad + 10}" r="11" fill="#a47a28" stroke="#fff" stroke-width="2"/>
      <text x="${ax}" y="${topPad + 13}" text-anchor="middle" font-size="10" fill="#fff" font-weight="800" font-family="JetBrains Mono, monospace">A</text>
      <text x="${ax}" y="${topPad - 8}" text-anchor="middle" font-size="10" fill="#a47a28" font-weight="700" font-family="Source Serif 4, Georgia, serif">${esc(acquirer.name.slice(0, 18))}</text>
    </g>`

  // Targets below strip with arrow from acquirer to target
  // Group targets by VC position to stack vertically and avoid overlap
  const groupsByPos = new Map<VcPosition, Array<{ target: OpTarget; cls: IntegrationClassification; idx: number }>>()
  classifications.forEach(({ target, cls }, idx) => {
    if (!groupsByPos.has(target.vcPosition)) groupsByPos.set(target.vcPosition, [])
    groupsByPos.get(target.vcPosition)!.push({ target, cls, idx })
  })
  const targetMarkers = Array.from(groupsByPos.entries()).flatMap(([pos, arr]) => {
    return arr.map(({ target, cls, idx }, inGroup) => {
      const baseX = xAtPos(pos)
      const y = bottomY - inGroup * 0
      const dotY = stripY + stripH + 30 + inGroup * 28
      const color = cls.color
      // Curved arrow from acquirer centre to target dot
      const fromX = ax
      const fromY = topPad + 22
      const toX = baseX
      const toY = dotY
      const midX = (fromX + toX) / 2
      const midY = fromY + Math.max(20, Math.abs(toY - fromY) * 0.3)
      return `
        <g>
          <path d="M ${fromX} ${fromY} Q ${midX} ${midY} ${toX} ${toY - 10}" stroke="${color}" stroke-width="1.4" fill="none" opacity="0.55" marker-end="url(#vc-arrow-${cls.strategy})"/>
          <circle cx="${toX}" cy="${toY}" r="8" fill="${color}" stroke="#fff" stroke-width="2"/>
          <text x="${toX}" y="${toY + 3}" text-anchor="middle" font-size="9" fill="#fff" font-weight="800" font-family="JetBrains Mono, monospace">${idx + 1}</text>
          <text x="${toX}" y="${toY + 22}" text-anchor="middle" font-size="9" fill="${color}" font-weight="700" font-family="Source Serif 4, Georgia, serif">${esc(target.name.length > 16 ? target.name.slice(0, 14) + '\u2026' : target.name)}</text>
        </g>`
    })
  }).join('')

  const arrowColors = ['#0e7490', '#a47a28', '#166534', '#7c3aed']
  const arrowDefs = ['backward', 'forward', 'complementary', 'diversification'].map((s, i) => `
    <marker id="vc-arrow-${s}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${arrowColors[i]}"/>
    </marker>`).join('')

  return `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <defs>${arrowDefs}</defs>
      <text x="${leftPad}" y="16" font-size="10" fill="#6b7280" font-family="JetBrains Mono, monospace" letter-spacing="1.4">VALUE CHAIN \u00b7 UPSTREAM \u2192 DOWNSTREAM</text>
      ${stageBars}
      ${acquirerMarker}
      ${targetMarkers}
    </svg>`
}

/**
 * 2x2 integration-strategy matrix. Y-axis: same sector vs. different
 * sector. X-axis: upstream / parallel / downstream. Each target plotted
 * as a colour-coded dot with rank number.
 */
function renderIntegrationMatrix(
  classifications: Array<{ target: OpTarget; cls: IntegrationClassification }>,
  width = 520,
): string {
  const height = 320
  const leftPad = 150
  const rightPad = 20
  const topPad = 30
  const bottomPad = 50
  const plotW = width - leftPad - rightPad
  const plotH = height - topPad - bottomPad
  // Column centres: upstream / parallel / downstream
  const colX = [leftPad + plotW * 0.2, leftPad + plotW * 0.5, leftPad + plotW * 0.8]
  // Row centres: same-sector (top), different-sector (bottom)
  const rowY = [topPad + plotH * 0.3, topPad + plotH * 0.75]
  const quadrants = [
    // same sector × upstream
    { x: leftPad, y: topPad, w: plotW / 3, h: plotH / 2, label: 'Backward Integration', color: '#0e7490', sub: 'Same sector · upstream' },
    // same sector × parallel
    { x: leftPad + plotW / 3, y: topPad, w: plotW / 3, h: plotH / 2, label: 'Complementary', color: '#166534', sub: 'Same sector · bolt-on' },
    // same sector × downstream
    { x: leftPad + (plotW * 2) / 3, y: topPad, w: plotW / 3, h: plotH / 2, label: 'Forward Integration', color: '#a47a28', sub: 'Same sector · downstream' },
    // different sector (full width)
    { x: leftPad, y: topPad + plotH / 2, w: plotW, h: plotH / 2, label: 'Diversification', color: '#7c3aed', sub: 'Different sector \u2014 new value chain' },
  ]
  const quadBg = quadrants.map((q) => `
    <rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" fill="${q.color}" opacity="0.08" stroke="${q.color}" stroke-opacity="0.35"/>
    <text x="${q.x + q.w / 2}" y="${q.y + 18}" text-anchor="middle" font-size="11" font-weight="700" fill="${q.color}" font-family="Source Serif 4, Georgia, serif">${esc(q.label)}</text>
    <text x="${q.x + q.w / 2}" y="${q.y + 32}" text-anchor="middle" font-size="9" fill="${q.color}" font-family="Source Serif 4, Georgia, serif" opacity="0.75">${esc(q.sub)}</text>`).join('')

  // Axis labels
  const axisLabels = `
    <text x="10" y="${rowY[0] + 4}" font-size="10" font-weight="700" fill="#0b1e3a" font-family="Source Serif 4, Georgia, serif">Same sector</text>
    <text x="10" y="${rowY[1] + 4}" font-size="10" font-weight="700" fill="#0b1e3a" font-family="Source Serif 4, Georgia, serif">Different sector</text>
    <text x="${colX[0]}" y="${height - 18}" text-anchor="middle" font-size="10" fill="#0b1e3a" font-weight="600" font-family="Source Serif 4, Georgia, serif">\u2190 Upstream</text>
    <text x="${colX[1]}" y="${height - 18}" text-anchor="middle" font-size="10" fill="#0b1e3a" font-weight="600" font-family="Source Serif 4, Georgia, serif">Parallel</text>
    <text x="${colX[2]}" y="${height - 18}" text-anchor="middle" font-size="10" fill="#0b1e3a" font-weight="600" font-family="Source Serif 4, Georgia, serif">Downstream \u2192</text>
    <text x="${leftPad + plotW / 2}" y="${height - 4}" text-anchor="middle" font-size="9" fill="#6b7280" font-family="JetBrains Mono, monospace" letter-spacing="1">VALUE-CHAIN DIRECTION</text>`

  // Plot targets — bucket by (row, col)
  const bucketMap = new Map<string, Array<{ target: OpTarget; cls: IntegrationClassification; idx: number }>>()
  classifications.forEach(({ target, cls }, idx) => {
    const row = cls.strategy === 'diversification' ? 1 : 0
    const col = cls.direction === 'upstream' ? 0 : cls.direction === 'downstream' ? 2 : 1
    const key = `${row}-${col}`
    if (!bucketMap.has(key)) bucketMap.set(key, [])
    bucketMap.get(key)!.push({ target, cls, idx })
  })
  const dots: string[] = []
  bucketMap.forEach((arr, key) => {
    const [rowStr, colStr] = key.split('-')
    const row = Number(rowStr)
    const col = Number(colStr)
    // For diversification (row 1), col maps into 3 evenly-spaced columns too
    const baseX = colX[col]
    const baseY = rowY[row]
    arr.forEach((item, i) => {
      const x = baseX + ((i % 3) - 1) * 22
      const y = baseY + Math.floor(i / 3) * 22
      dots.push(`
        <circle cx="${x}" cy="${y}" r="11" fill="${item.cls.color}" stroke="#fff" stroke-width="2"/>
        <text x="${x}" y="${y + 4}" text-anchor="middle" font-size="10" fill="#fff" font-weight="800" font-family="JetBrains Mono, monospace">${item.idx + 1}</text>`)
    })
  })

  return `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <text x="${leftPad}" y="18" font-size="10" fill="#6b7280" font-family="JetBrains Mono, monospace" letter-spacing="1.4">INTEGRATION STRATEGY MATRIX</text>
      ${quadBg}
      ${axisLabels}
      ${dots.join('')}
    </svg>`
}

/**
 * Verdict engine: maps conviction + value-add signals into a clear,
 * investor-grade recommendation per target. Four bands:
 *   - strong_buy: conviction ≥ 0.75 + 5-yr NPV > deal size
 *   - recommended: conviction ≥ 0.60
 *   - consider: conviction ≥ 0.45
 *   - monitor: below
 */
export interface TargetVerdict {
  band: 'strong_buy' | 'recommended' | 'consider' | 'monitor'
  label: string
  css: string // verdict-{band}
  valueAddLine: string
  reasoning: string[]
}

function computeVerdict(t: OpTarget, traj: TargetTrajectory, dealSizeCr: number): TargetVerdict {
  const npvBeatsFund = traj.fiveYearDiscountedCr > dealSizeCr
  const synergyDensity = t.revCr > 0 ? t.synergy.totalCr / t.revCr : 0
  let band: TargetVerdict['band'] = 'monitor'
  let label = 'Monitor'
  let css = 'verdict-monitor'
  if (t.conviction >= 0.75 && npvBeatsFund) { band = 'strong_buy'; label = 'Strong Buy'; css = 'verdict-strong' }
  else if (t.conviction >= 0.60) { band = 'recommended'; label = 'Recommended Buy'; css = 'verdict-recommended' }
  else if (t.conviction >= 0.45) { band = 'consider'; label = 'Consider'; css = 'verdict-consider' }
  const npvUplift = traj.fiveYearDiscountedCr
  const revUplift = traj.fiveYearRevCr
  const revPctAtY5 = t.revCr > 0 ? ((revUplift / t.revCr - 1) * 100) : 0
  const valueAddLine = `${fmtCr(npvUplift)} five-year discounted value add (at 10% WACC) \u00b7 ${revPctAtY5 >= 0 ? '+' : ''}${revPctAtY5.toFixed(0)}% Y5 revenue vs. Y0 \u00b7 ${fmtCr(t.synergy.totalCr)}/yr steady-state synergy (${(synergyDensity * 100).toFixed(1)}% of target revenue)`
  const reasoning: string[] = []
  if (band === 'strong_buy') {
    reasoning.push(`Composite conviction of ${(t.conviction * 100).toFixed(0)}% places this in the top decile of the scored universe.`)
    reasoning.push(`5-year discounted value (${fmtCr(npvUplift)}) exceeds deal size (${fmtCr(dealSizeCr)}) \u2014 positive MOIC at plan horizon.`)
    if (synergyDensity >= 0.06) reasoning.push(`Synergy pool equals ${(synergyDensity * 100).toFixed(1)}% of revenue \u2014 top-quartile combinatorial economics.`)
  } else if (band === 'recommended') {
    reasoning.push(`Conviction ${(t.conviction * 100).toFixed(0)}% clears the institutional-quality bar; thesis + frameworks align.`)
    if (npvBeatsFund) reasoning.push(`5-yr NPV (${fmtCr(npvUplift)}) > deal size (${fmtCr(dealSizeCr)}) \u2014 MOIC positive.`)
    else reasoning.push(`5-yr NPV trails deal size \u2014 IC must validate whether synergy ramp timing closes the gap.`)
  } else if (band === 'consider') {
    reasoning.push(`Conviction ${(t.conviction * 100).toFixed(0)}% is below the preferred threshold; requires a strategic rationale beyond financial score.`)
    reasoning.push('Proceed only if there is platform / optionality / defensive logic not captured by the quantitative model.')
  } else {
    reasoning.push(`Conviction ${(t.conviction * 100).toFixed(0)}% places this below the action threshold.`)
    reasoning.push('Retain on watchlist; re-score after next earnings cycle or a material thesis change.')
  }
  if (t.hostileExposure.exposed && t.hostileExposure.severity === 'high') {
    reasoning.push(`Hostile-exposure caveat (severity: high) \u2014 price competitive bid risk into negotiation stance.`)
  }
  return { band, label, css, valueAddLine, reasoning }
}

/**
 * Compact radial map: India at the centre, export regions placed around
 * it at approximate compass bearings (not to scale), colour-coded arrows
 * from India to each touched region, with dot size encoding the number
 * of targets. Designed to fit inside the letter-size page width without
 * overflow. A sidebar table next to this in the report lists the corridor
 * details so the map stays clean.
 */
function renderRadialMap(programme: ReturnType<typeof aggregateGeography>, width = 440, height = 300): string {
  const cx = width / 2
  const cy = height / 2
  const radius = Math.min(cx, cy) - 44
  // Compass bearings (degrees from north, clockwise) for each region relative to India.
  const bearings: Record<string, number> = {
    europe: 330,        // NW
    north_america: 300, // WNW (drawn on the "back side" via long arc)
    middle_east: 285,   // W
    africa: 240,        // SW
    se_asia: 105,       // E-SE
    oceania: 140,       // SE
    latin_america: 250, // W-SW (alternate)
    south_asia: 90,     // E (very close)
  }
  // Sort to render highest-count regions on top.
  const matrix = [...programme.exportMatrix].sort((a, b) => b.targets.length - a.targets.length)
  const toXY = (bearing: number, r: number) => {
    const rad = ((bearing - 90) * Math.PI) / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }
  // Draw concentric grid.
  const grid = [radius * 0.4, radius * 0.7, radius].map((r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-dasharray="1,3" />`).join('')
  // Draw regions.
  const regionNodes = matrix.map((m, i) => {
    const bearing = bearings[m.region.id] ?? (45 + i * 45)
    const ringR = radius * (i % 3 === 0 ? 1.0 : i % 3 === 1 ? 0.82 : 0.64)
    const p = toXY(bearing, ringR)
    const dotR = 6 + Math.min(10, m.targets.length * 2)
    const label = m.region.label.length > 16 ? m.region.label.slice(0, 14) + '\u2026' : m.region.label
    // Arrow from India to region
    const arrowThick = Math.min(4, 1.2 + m.targets.length * 0.6)
    // Anchor label at edge; if on right side, anchor start; left side, anchor end.
    const textAnchor = p.x > cx + 5 ? 'start' : p.x < cx - 5 ? 'end' : 'middle'
    const labelDx = p.x > cx + 5 ? dotR + 4 : p.x < cx - 5 ? -(dotR + 4) : 0
    return `
      <g>
        <line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="${m.region.color}" stroke-width="${arrowThick}" opacity="0.85" marker-end="url(#ar-${m.region.id})" />
        <circle cx="${p.x}" cy="${p.y}" r="${dotR}" fill="${m.region.color}" opacity="0.92" />
        <text x="${p.x}" y="${p.y + 3}" text-anchor="middle" font-size="9" fill="#fff" font-weight="700" font-family="JetBrains Mono, monospace">${m.targets.length}</text>
        <text x="${p.x + labelDx}" y="${p.y + dotR + 10}" text-anchor="${textAnchor}" font-size="10" fill="${m.region.color}" font-weight="700" font-family="Source Serif 4, Georgia, serif">${esc(label)}</text>
      </g>`
  }).join('')
  const markers = matrix.map((m) => `
    <marker id="ar-${m.region.id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${m.region.color}"/>
    </marker>`).join('')
  return `
    <svg viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
      <defs>${markers}</defs>
      ${grid}
      <circle cx="${cx}" cy="${cy}" r="26" fill="#a47a28" opacity="0.95" />
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="14" fill="#fff" font-weight="700" font-family="Source Serif 4, Georgia, serif">\ud83c\uddee\ud83c\uddf3</text>
      <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="9" fill="#fff" font-weight="700" font-family="JetBrains Mono, monospace">INDIA</text>
      ${regionNodes}
    </svg>`
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
  const variant: ReportVariant = input.variant || 'ic'
  const variantMeta = VARIANT_META[variant]
  const nowIso = new Date().toISOString()
  const id = `OPID-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const title = `${acquirer.name} \u2014 Inorganic Growth Opportunity Identifier`
  const subtitle = `Target portfolio, acquisition strategy, fund plan, and balance-sheet projection`

  const ansoffMeta = ANSOFF.find((a) => a.id === inputs.ansoff[0])
  const porterMeta = PORTER.find((p) => p.id === inputs.porter[0])
  const ansoffLabels = inputs.ansoff.map((id) => ANSOFF.find((a) => a.id === id)?.label || id).join(' + ')
  const porterLabels = inputs.porter.map((id) => PORTER.find((p) => p.id === id)?.label || id).join(' + ')
  const exposedTargets = selected.filter((s) => s.hostileExposure.exposed)
  const highSeverity = selected.filter((s) => s.hostileExposure.severity === 'high')

  // Programme verdict tally — computed early so Executive Summary can
  // surface it alongside fund + revenue headlines.
  const programmeVerdicts = selected.map((t) => {
    const traj = trajectoryFor(t, 1.0)
    return computeVerdict(t, traj, t.dealSizeCr)
  })
  const verdictCounts = {
    strong_buy: programmeVerdicts.filter((v) => v.band === 'strong_buy').length,
    recommended: programmeVerdicts.filter((v) => v.band === 'recommended').length,
    consider: programmeVerdicts.filter((v) => v.band === 'consider').length,
    monitor: programmeVerdicts.filter((v) => v.band === 'monitor').length,
  }
  const actionables = verdictCounts.strong_buy + verdictCounts.recommended
  const programmeVerdict: { label: string; css: string; headline: string } = (() => {
    if (selected.length === 0) return { label: 'No Selection', css: 'verdict-monitor', headline: 'Select at least one target to generate a programme recommendation.' }
    if (verdictCounts.strong_buy >= Math.ceil(selected.length / 2) && plan.isGoalAchievable) {
      return { label: 'Programme: Strong Buy', css: 'verdict-strong', headline: `${verdictCounts.strong_buy} of ${selected.length} selected targets are Strong Buy and the portfolio reaches the revenue goal inside the horizon. Proceed to IC with confidence.` }
    }
    if (actionables >= Math.ceil(selected.length / 2)) {
      return { label: 'Programme: Recommended', css: 'verdict-recommended', headline: `${actionables} of ${selected.length} selected targets clear the institutional-quality bar. ${plan.isGoalAchievable ? 'Revenue goal is met.' : `${fmtCr(Math.abs(plan.gapToGoalCr))} shortfall remains.`}` }
    }
    return { label: 'Programme: Consider', css: 'verdict-consider', headline: `Mixed portfolio \u2014 only ${actionables} of ${selected.length} clear the preferred conviction threshold. Tighten selection or expand the universe before committing.` }
  })()

  const s1 = !use('executive') ? '' : `
    <section>
      <div class="eyebrow">SECTION 01</div>
      <h2>Executive Summary</h2>

      <div class="hero" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        <span class="verdict ${programmeVerdict.css}" style="font-size:13px;padding:10px 18px">${esc(programmeVerdict.label)}</span>
        <div style="flex:1;min-width:240px">
          <p class="lede" style="margin:0"><strong>${esc(acquirer.name)}</strong> is targeting <em>${fmtCr(inputs.targetRevenueCr)}</em> revenue within <em>${inputs.horizonMonths} months</em> via a <em>${esc(ansoffLabels || 'Product Development')}</em> / <em>${esc(porterLabels || 'Differentiation')}</em> programme.</p>
          <p style="margin:6px 0 0">${esc(programmeVerdict.headline)}</p>
        </div>
      </div>

      <div class="grid grid-4" style="margin-top:14px">
        <div class="card"><div class="stat-lbl">Targets selected</div><div class="stat">${selected.length}</div></div>
        <div class="card"><div class="stat-lbl">Total fund required</div><div class="stat">${fmtCr(plan.totalFundRequiredCr)}</div></div>
        <div class="card"><div class="stat-lbl">Projected revenue</div><div class="stat">${fmtCr(plan.projectedRevCr)}</div></div>
        <div class="card"><div class="stat-lbl">Goal verdict</div><div class="stat">${plan.isGoalAchievable ? '\u2713 Met' : `${fmtCr(Math.abs(plan.gapToGoalCr))} short`}</div></div>
      </div>

      <div class="grid grid-4" style="margin-top:10px">
        <div class="card"><div class="stat-lbl">Strong Buy</div><div class="stat" style="color:var(--green)">${verdictCounts.strong_buy}</div></div>
        <div class="card"><div class="stat-lbl">Recommended</div><div class="stat" style="color:var(--gold)">${verdictCounts.recommended}</div></div>
        <div class="card"><div class="stat-lbl">Consider</div><div class="stat" style="color:var(--cyan)">${verdictCounts.consider}</div></div>
        <div class="card"><div class="stat-lbl">Monitor only</div><div class="stat" style="color:var(--muted)">${verdictCounts.monitor}</div></div>
      </div>

      <p style="margin-top:16px">
        Universe scored: <strong>${allRanked.length}</strong> companies against 8 deterministic sub-scores (sector fit, deal-size fit, growth, margin, Ansoff fit, Porter fit, policy tailwind, DealNector VC-Taxonomy sub-segment overlap).
        ${plan.isGoalAchievable
          ? `Selected portfolio <strong>reaches</strong> the revenue target inside the horizon.`
          : `Portfolio falls short by <strong>${fmtCr(Math.abs(plan.gapToGoalCr))}</strong>; either relax the deal-size band, extend the horizon, or pick additional targets from the ranked list.`}
        ${exposedTargets.length > 0 ? ` <span class="pill pill-red">${exposedTargets.length} hostile-exposure flag${exposedTargets.length === 1 ? '' : 's'}</span>` : ''}
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

  // Derived target-profile thresholds (mirrors the UI block).
  const currentRev = acquirer.rev || 0
  const horizonYears = inputs.horizonMonths / 12
  const gap = Math.max(0, inputs.targetRevenueCr - currentRev)
  const impliedCagr = currentRev > 0 && horizonYears > 0 && inputs.targetRevenueCr > currentRev
    ? (Math.pow(inputs.targetRevenueCr / currentRev, 1 / horizonYears) - 1) * 100
    : 0
  const minDealRev = gap > 0 ? Math.round(gap / 5) : 0
  const maxDealRev = gap > 0 ? Math.round(gap / 2) : 0
  const minDealSize = Math.round(minDealRev * 2)
  const maxDealSize = Math.round(maxDealRev * 3)
  const preferredMarginFloor = Math.max(12, Math.round(acquirer.ebm || 0))
  const preferredGrowthFloor = Math.max(15, Math.round(acquirer.revg || 0))
  const midDealRev = (minDealRev + maxDealRev) / 2 || 1
  const impliedTargetCount = gap > 0 ? Math.max(1, Math.min(8, Math.round(gap / midDealRev))) : 0

  const s3 = !use('framework') ? '' : `
    <section>
      <div class="eyebrow">SECTION 03</div>
      <h2>Strategic Framework &amp; Target Profile</h2>

      ${gap > 0 ? `
        <div class="hero" style="border-left-color:var(--gold);margin-top:4px">
          <div class="value-add-lbl" style="color:var(--gold)">Derived Target Profile \u2014 thresholds directing the search</div>
          <p class="lede" style="margin:6px 0 10px">Close the <strong>${fmtCr(gap)}</strong> revenue gap over <strong>${inputs.horizonMonths} months</strong> \u2014 implied organic-plus-inorganic CAGR of <strong>${impliedCagr.toFixed(1)}%</strong> \u2014 via approximately <strong>${impliedTargetCount}</strong> acquisitions.</p>
          <div class="grid grid-4" style="margin-top:10px">
            <div class="card card-muted"><div class="stat-lbl">Revenue gap</div><div class="stat-num">${fmtCr(gap)}</div><div class="small">${inputs.horizonMonths} months</div></div>
            <div class="card card-muted"><div class="stat-lbl">Implied CAGR</div><div class="stat-num">${impliedCagr.toFixed(1)}%</div><div class="small">blended organic + inorganic</div></div>
            <div class="card card-muted"><div class="stat-lbl">Target revenue band</div><div class="stat-num" style="font-size:15px">${fmtCr(minDealRev)} \u2013 ${fmtCr(maxDealRev)}</div><div class="small">per acquisition</div></div>
            <div class="card card-muted"><div class="stat-lbl">Implied count</div><div class="stat-num">${impliedTargetCount}</div><div class="small">deals to close gap</div></div>
          </div>
          <div class="grid grid-3" style="margin-top:10px">
            <div class="card card-muted"><div class="stat-lbl">Implied deal-value band</div><div class="stat-num" style="font-size:15px">${fmtCr(minDealSize)} \u2013 ${fmtCr(maxDealSize)}</div><div class="small">EV = Rev \u00d7 2\u20133\u00d7</div></div>
            <div class="card card-muted"><div class="stat-lbl">Preferred EBITDA margin floor</div><div class="stat-num" style="color:var(--green)">\u2265 ${preferredMarginFloor}%</div><div class="small">industrial median + acquirer baseline</div></div>
            <div class="card card-muted"><div class="stat-lbl">Preferred revenue growth floor</div><div class="stat-num" style="color:var(--green)">\u2265 ${preferredGrowthFloor}%</div><div class="small">to keep pace with horizon pressure</div></div>
          </div>
          <p class="small" style="margin-top:10px">These thresholds direct every downstream decision \u2014 which sub-segments of the DealNector VC Taxonomy to screen, which geographies to prioritise, and how the sizeFit / growthFit / marginFit sub-scores weight the ranked universe. They are soft filters, not hard gates: a target below the margin floor can still rank highly if its synergy pool and strategic fit compensate.</p>
        </div>
      ` : `
        <p class="muted">Target revenue ${fmtCr(inputs.targetRevenueCr)} is at or below current acquirer revenue \u2014 no inorganic gap to close. Inputs below describe the strategic posture for any opportunistic acquisitions.</p>
      `}

      <h3>Ansoff Matrix Vector</h3>
      <p><strong>${esc(ansoffLabels)}</strong>${inputs.ansoff.length === 1 && ansoffMeta ? ` (risk: ${esc(ansoffMeta.risk)}) \u2014 ${esc(ansoffMeta.thesis)}` : inputs.ansoff.length > 1 ? ` \u2014 blended Ansoff thesis; scoring takes the max fit across ${inputs.ansoff.length} vectors.` : ''}</p>
      ${inputs.ansoff.length > 1 ? `<ul>${inputs.ansoff.map((id) => { const m = ANSOFF.find((a) => a.id === id); return m ? `<li><strong>${esc(m.label)}</strong> \u2014 ${esc(m.thesis)}</li>` : '' }).join('')}</ul>` : ''}

      <h3>Porter Generic Strategy</h3>
      <p><strong>${esc(porterLabels)}</strong>${inputs.porter.length === 1 && porterMeta ? ` \u2014 ${esc(porterMeta.thesis)}` : inputs.porter.length > 1 ? ` \u2014 blended Porter posture; scoring takes the max fit across ${inputs.porter.length} strategies.` : ''}</p>
      ${inputs.porter.length > 1 ? `<ul>${inputs.porter.map((id) => { const m = PORTER.find((p) => p.id === id); return m ? `<li><strong>${esc(m.label)}</strong> \u2014 ${esc(m.thesis)}</li>` : '' }).join('')}</ul>` : ''}
      <p class="muted" style="margin-top:6px">Target profile: ${esc(porterMeta?.targetProfile || '')}</p>

      ${(() => {
        // System-recommendation block — surface the framework's view of
        // where-to-play alongside the user's actual picks. Computed
        // deterministically from the same inputs.
        const rec = recommendTargetScope({
          acquirer,
          // Recommender takes single-valued Ansoff/Porter for lens selection;
          // pass the first selection (primary thesis) when multiple are set.
          ansoff: inputs.ansoff[0] || 'product_development',
          porter: inputs.porter[0] || 'differentiation',
          targetRevenueCr: inputs.targetRevenueCr,
          horizonMonths: inputs.horizonMonths,
        })
        const recIndSet = new Set(rec.industries.map((i) => i.code))
        const recStgSet = new Set(rec.stages.map((s) => s.code))
        const recSubSet = new Set(rec.subSegments.map((s) => s.id))
        const userIndSet = new Set(inputs.targetIndustries || [])
        const userStgSet = new Set(inputs.targetStages || [])
        const userSubSet = new Set(inputs.preferredSubSegments || [])
        const overlapInd = Array.from(userIndSet).filter((c) => recIndSet.has(c)).length
        const divergenceInd = Array.from(userIndSet).filter((c) => !recIndSet.has(c)).length
        const takenFromSysInd = Array.from(recIndSet).filter((c) => userIndSet.has(c)).length
        const overlapStg = Array.from(userStgSet).filter((c) => recStgSet.has(c)).length
        const overlapSub = Array.from(userSubSet).filter((c) => recSubSet.has(c)).length
        const alignmentPct = rec.industries.length > 0 ? (takenFromSysInd / rec.industries.length) * 100 : 0
        const alignmentLabel = alignmentPct >= 70 ? 'strong alignment' : alignmentPct >= 40 ? 'partial alignment' : alignmentPct > 0 ? 'divergent' : 'fully discretionary'
        return `
          <h3>System Recommendation \u2014 Where to Play</h3>
          <div class="hero" style="border-left-color:var(--gold);margin-top:4px">
            <div class="value-add-lbl" style="color:var(--gold)">Framework guidance \u00b7 dominant lens: ${esc(rec.dominantLens)}</div>
            <p class="lede" style="margin:6px 0 10px">${esc(rec.dominantReason)}</p>
            <div class="grid grid-3" style="margin-top:8px">
              <div class="card card-muted" style="border-left:3px solid var(--green)">
                <div class="stat-lbl" style="color:var(--green)">Lens 1 \u00b7 Consolidate</div>
                <div class="small" style="margin-top:4px">${esc(rec.lensSummary.consolidate)}</div>
              </div>
              <div class="card card-muted" style="border-left:3px solid var(--gold)">
                <div class="stat-lbl" style="color:var(--gold)">Lens 2 \u00b7 Integrate Vertically</div>
                <div class="small" style="margin-top:4px">${esc(rec.lensSummary.integrate)}</div>
              </div>
              <div class="card card-muted" style="border-left:3px solid #7c3aed">
                <div class="stat-lbl" style="color:#7c3aed">Lens 3 \u00b7 Diversify</div>
                <div class="small" style="margin-top:4px">${esc(rec.lensSummary.diversify)}</div>
              </div>
            </div>
          </div>

          <h4>Recommended industries (${rec.industries.length})</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Lens</th><th>Industry</th><th>Reasoning</th><th>Status</th></tr></thead>
              <tbody>
                ${rec.industries.map((r) => {
                  const taken = userIndSet.has(r.code)
                  const lensColor = r.lens === 'consolidate' ? 'var(--green)' : r.lens === 'integrate' ? 'var(--gold)' : '#7c3aed'
                  return `
                    <tr>
                      <td><span class="pill" style="background:${lensColor}18;border:1px solid ${lensColor};color:${lensColor}">${esc(r.lens)}</span></td>
                      <td><strong>${esc(r.label)}</strong></td>
                      <td class="small">${esc(r.reasoning)}</td>
                      <td>${taken ? '<span class="pill pill-green">\u2713 taken</span>' : '<span class="pill" style="background:rgba(107,114,128,0.08);border:1px solid var(--muted);color:var(--muted)">pending</span>'}</td>
                    </tr>`
                }).join('')}
              </tbody>
            </table>
          </div>

          <h4>Recommended value-chain stages (${rec.stages.length})</h4>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Lens</th><th>Direction</th><th>Stage</th><th>Industry</th><th>Reasoning</th><th>Status</th></tr></thead>
              <tbody>
                ${rec.stages.map((r) => {
                  const taken = userStgSet.has(r.code)
                  const lensColor = r.lens === 'consolidate' ? 'var(--green)' : r.lens === 'integrate' ? 'var(--gold)' : '#7c3aed'
                  return `
                    <tr>
                      <td><span class="pill" style="background:${lensColor}18;border:1px solid ${lensColor};color:${lensColor}">${esc(r.lens)}</span></td>
                      <td class="small"><em>${esc(r.direction)}</em></td>
                      <td><strong>${esc(r.code)} \u00b7 ${esc(r.name)}</strong></td>
                      <td class="small">${esc(r.industryLabel)}</td>
                      <td class="small">${esc(r.reasoning)}</td>
                      <td>${taken ? '<span class="pill pill-green">\u2713</span>' : '<span class="pill" style="background:rgba(107,114,128,0.08);border:1px solid var(--muted);color:var(--muted)">pending</span>'}</td>
                    </tr>`
                }).join('')}
              </tbody>
            </table>
          </div>

          <h4>Anchor sub-segments recommended (${rec.subSegments.length})</h4>
          <div style="margin:4px 0 12px">
            ${rec.subSegments.map((s) => {
              const taken = userSubSet.has(s.id)
              return `<span class="pill ${taken ? 'pill-green' : 'pill-navy'}" title="${esc(s.reasoning)}">${taken ? '\u2713 ' : ''}${esc(s.label)}</span>`
            }).join('')}
          </div>

          <div class="card card-muted" style="margin-top:10px;border-left:3px solid var(--gold)">
            <div class="stat-lbl" style="color:var(--gold);margin-bottom:4px">Alignment with system recommendation</div>
            <p style="margin:0;font-size:11.5px;line-height:1.6">
              User picks vs. framework guidance: <strong>${alignmentLabel}</strong>.
              ${overlapInd}/${rec.industries.length} recommended industries taken;
              ${overlapStg}/${rec.stages.length} stages;
              ${overlapSub}/${rec.subSegments.length} sub-segments.
              ${divergenceInd > 0 ? `Analyst added <strong>${divergenceInd}</strong> industr${divergenceInd === 1 ? 'y' : 'ies'} outside the recommendation set \u2014 IC should understand the rationale behind these discretionary picks.` : 'All user-picked industries are within the framework-recommended set \u2014 the thesis is a refinement of the system view, not a departure from it.'}
            </p>
          </div>

          <h3>Target Scope \u2014 Value Chain &amp; Sub-Segment (analyst's final picks)</h3>
          <p>Hierarchical scope the analyst has set: Industry \u2192 Value-Chain Stage \u2192 Sub-segment. Targets whose mapping overlaps these picks receive a conviction boost (capped).</p>
        `
      })()}
      ${inputs.targetIndustries && inputs.targetIndustries.length > 0 ? `
        <div style="margin:8px 0">
          <strong style="font-size:10px;letter-spacing:0.6px;text-transform:uppercase;color:var(--muted)">Industries targeted (${inputs.targetIndustries.length}):</strong>
          <div style="margin-top:4px">${inputs.targetIndustries.map((c) => `<span class="pill pill-gold">${esc(industryLabel(c))}</span>`).join('')}</div>
        </div>
      ` : '<p class="small muted">No industries targeted \u2014 scoring falls back to sectorsOfInterest.</p>'}
      ${inputs.targetStages && inputs.targetStages.length > 0 ? `
        <div style="margin:8px 0">
          <strong style="font-size:10px;letter-spacing:0.6px;text-transform:uppercase;color:var(--muted)">Value-chain stages targeted (${inputs.targetStages.length}):</strong>
          <div style="margin-top:4px">${inputs.targetStages.map((st) => {
            const stage = TAXONOMY_STAGES.find((s) => s.code === st)
            return `<span class="pill pill-gold">${esc(st)} \u00b7 ${esc(stage?.name || 'unknown')}</span>`
          }).join('')}</div>
        </div>
      ` : ''}
      ${inputs.preferredSubSegments && inputs.preferredSubSegments.length > 0 ? `
        <div style="margin:8px 0">
          <strong style="font-size:10px;letter-spacing:0.6px;text-transform:uppercase;color:var(--muted)">Sub-segments targeted (${inputs.preferredSubSegments.length}):</strong>
          <div style="margin-top:4px">${inputs.preferredSubSegments.slice(0, 30).map((id) => {
            const seg = getSubSegmentById(id)
            return `<span class="pill pill-cyan">${esc(seg?.name || id)}</span>`
          }).join('')}${inputs.preferredSubSegments.length > 30 ? `<span class="small muted"> + ${inputs.preferredSubSegments.length - 30} more</span>` : ''}</div>
        </div>
      ` : ''}

      <h3>Acquirer Current Posture (auto-derived)</h3>
      ${(() => {
        const indSet = new Set<string>()
        const stageSet = new Set<string>()
        const indCode = industryCodeFor(acquirer.sec)
        if (indCode) indSet.add(indCode)
        for (const c of acquirer.comp || []) {
          const key = c.toLowerCase()
          const stg = COMP_TO_STAGE_CODE[key]
          if (stg) { stageSet.add(stg); const i = stg.split('.')[0]; if (i) indSet.add(i) }
        }
        const inds = Array.from(indSet)
        const stgs = Array.from(stageSet)
        if (inds.length === 0 && stgs.length === 0) return '<p class="small muted">Acquirer has no taxonomy mapping yet.</p>'
        return `
          <p>Where the acquirer sits today on the DealNector VC Taxonomy \u2014 the starting point the target scope above is expanding from.</p>
          <div style="margin-top:6px">
            <strong style="font-size:10px;letter-spacing:0.6px;text-transform:uppercase;color:var(--muted)">Industries:</strong>
            <div style="margin-top:4px">${inds.map((c) => `<span class="pill pill-green">${esc(industryLabel(c))}</span>`).join('') || '<span class="small muted">none mapped</span>'}</div>
          </div>
          <div style="margin-top:6px">
            <strong style="font-size:10px;letter-spacing:0.6px;text-transform:uppercase;color:var(--muted)">Value-chain stages:</strong>
            <div style="margin-top:4px">${stgs.map((st) => {
              const stage = TAXONOMY_STAGES.find((s) => s.code === st)
              return `<span class="pill pill-green">${esc(st)} \u00b7 ${esc(stage?.name || 'unknown')}</span>`
            }).join('') || '<span class="small muted">none mapped via Company.comp</span>'}</div>
          </div>`
      })()}

      <h3>User-Configured Search Band</h3>
      <p>Deal size: <strong>${fmtCr(inputs.dealSizeMinCr)} \u2013 ${fmtCr(inputs.dealSizeMaxCr)}</strong> \u00b7 Ownership preference per deal: <strong>${esc(inputs.ownership.join(', ') || 'any')}</strong>.</p>
      ${inputs.sectorsOfInterest.length > 0 ? `<p>Sectors of interest: ${inputs.sectorsOfInterest.map((s) => `<span class="pill pill-navy">${esc(s.replace(/_/g, ' '))}</span>`).join('')}</p>` : ''}
    </section>`

  // ── Investment Criteria section (hard filters applied) ────────────
  const dealTier = pickDealSizeTier(inputs.dealSizeMinCr, inputs.dealSizeMaxCr)
  const tierMeta = DEAL_SIZE_THRESHOLDS[dealTier]
  const criteriaRows: Array<{ label: string; user: string; tier: string; note: string }> = [
    {
      label: 'Min EBITDA margin',
      user: inputs.minEbitdaMarginPct ? `${inputs.minEbitdaMarginPct}%` : 'not set',
      tier: tierMeta.minEbitda,
      note: 'Hard screen — targets below are dropped.',
    },
    {
      label: 'Max EV/EBITDA',
      user: inputs.maxEvEbitdaMultiple ? `${inputs.maxEvEbitdaMultiple}\u00d7` : 'not set',
      tier: tierMeta.maxMultiple,
      note: 'Hard screen — entry multiple ceiling.',
    },
    {
      label: 'Max customer conc.',
      user: inputs.maxCustomerConcentration ? `${inputs.maxCustomerConcentration}/100` : 'not set',
      tier: '50 (default flag)',
      note: 'Soft penalty when inferred concentration exceeds threshold.',
    },
    {
      label: 'ESG baseline required',
      user: inputs.esgRequired ? 'Yes' : 'No',
      tier: 'On (policy-driven sectors)',
      note: 'Drops targets with zero policy / ESG signal when on.',
    },
  ]
  const criteriaActive = [
    inputs.minEbitdaMarginPct ? 1 : 0,
    inputs.maxEvEbitdaMultiple ? 1 : 0,
    inputs.maxCustomerConcentration ? 1 : 0,
    inputs.esgRequired ? 1 : 0,
  ].reduce((a, b) => a + b, 0)

  const s3b = !use('investmentCriteria') ? '' : `
    <section>
      <div class="eyebrow">SECTION \u00b7 INVESTMENT CRITERIA</div>
      <h2>Investment Criteria &amp; Screening Thresholds</h2>
      <p class="lede">${criteriaActive} of 4 hard filters active at report time. The thresholds below are derived from the <strong>${esc(tierMeta.label)}</strong> deal-size tier and tightened by analyst overrides where applicable.</p>

      <div class="grid grid-4" style="margin-top:12px">
        <div class="card card-muted"><div class="stat-lbl">Deal-size tier</div><div class="stat-num" style="font-size:14px">${esc(tierMeta.label)}</div><div class="small">min/max deal size \u2192 tier</div></div>
        <div class="card card-muted"><div class="stat-lbl">Filters active</div><div class="stat-num">${criteriaActive} / 4</div><div class="small">${criteriaActive === 0 ? 'all optional; none set' : criteriaActive === 4 ? 'full hardening' : 'partial hardening'}</div></div>
        <div class="card card-muted"><div class="stat-lbl">Targets dropped by criteria</div><div class="stat-num">\u2014</div><div class="small">pre-screen silent on counts</div></div>
        <div class="card card-muted"><div class="stat-lbl">Typical equity sleeve</div><div class="stat-num" style="font-size:13px">${esc(tierMeta.equity)}</div><div class="small">tier-implied financing lane</div></div>
      </div>

      <h3>Thresholds applied</h3>
      <table>
        <thead><tr><th>Criterion</th><th>User value</th><th>Tier reference</th><th>Note</th></tr></thead>
        <tbody>
          ${criteriaRows.map(r => `
            <tr>
              <td>${esc(r.label)}</td>
              <td><strong>${esc(r.user)}</strong></td>
              <td class="muted">${esc(r.tier)}</td>
              <td class="small muted">${esc(r.note)}</td>
            </tr>`).join('')}
        </tbody>
      </table>

      <p class="small muted" style="margin-top:10px">Reference: Strategy Engine framework \u00b7 DEAL_SIZE_THRESHOLDS map (micro \u2192 mega). Criteria can be applied as hard screens or left blank; soft customer-concentration penalty only applies when a threshold is set.</p>
    </section>`

  // ── Market Intelligence section (policy regimes + trade flow) ─────
  const selectedRegimes = COUNTRY_POLICY_REGIMES.filter(r => (inputs.preferredCountryRegimes || []).includes(r.id))
  const selectedCorridors = TRADE_FLOW_MATRIX.filter(r => (inputs.preferredTradeFlowCorridors || []).includes(r.id))
  const selectedAssetTypes = TARGET_ASSET_TYPES.filter(t => (inputs.preferredTargetAssetTypes || []).includes(t.id))
  const avgPolScore = selectedRegimes.length > 0
    ? Math.round(selectedRegimes.reduce((s, r) => s + r.polScore, 0) / selectedRegimes.length)
    : null
  const bestOppty = selectedCorridors.length > 0 ? Math.max(...selectedCorridors.map(r => r.opptyScore)) : null

  // Asset-type breakdown across the selected portfolio (or ranked top 20).
  const assetBuckets: Record<string, number> = { upstream: 0, downstream: 0, technology: 0, geographic: 0, cross_sector: 0 }
  for (const t of (selected.length > 0 ? selected : allRanked.slice(0, 20))) {
    const cls = classifyAssetType(t.integrationDir, acquirer.sec || '', t.sec || '')
    assetBuckets[cls] = (assetBuckets[cls] || 0) + 1
  }

  const s3c = !use('marketIntelligence') ? '' : `
    <section>
      <div class="eyebrow">SECTION \u00b7 MARKET INTELLIGENCE</div>
      <h2>Policy Regimes &amp; Trade-Flow Corridors</h2>
      <p class="lede">How the mandate\u2019s preferred policy regimes and trade-flow corridors shape conviction. Each matched signal contributes a bounded boost inside the shared preferenceBoost ceiling.</p>

      <div class="grid grid-4" style="margin-top:12px">
        <div class="card card-muted"><div class="stat-lbl">Policy regimes selected</div><div class="stat-num">${selectedRegimes.length}</div><div class="small">${avgPolScore !== null ? `avg pol score ${avgPolScore}` : 'none selected'}</div></div>
        <div class="card card-muted"><div class="stat-lbl">Trade-flow corridors</div><div class="stat-num">${selectedCorridors.length}</div><div class="small">${bestOppty !== null ? `best oppty score ${bestOppty}` : 'none selected'}</div></div>
        <div class="card card-muted"><div class="stat-lbl">Asset-type intents</div><div class="stat-num">${selectedAssetTypes.length}</div><div class="small">${selectedAssetTypes.map(a => a.label.toLowerCase()).join(', ') || 'no intent set'}</div></div>
        <div class="card card-muted"><div class="stat-lbl">Portfolio asset-type mix</div><div class="stat-num" style="font-size:12px">${Object.entries(assetBuckets).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replace('_', ' ')}`).join(' \u00b7 ') || 'n/a'}</div><div class="small">top ranks classified</div></div>
      </div>

      ${selectedRegimes.length > 0 ? `
        <h3>Selected regimes</h3>
        <table>
          <thead><tr><th>Country</th><th class="num">Pol score</th><th>Stance</th><th>Key incentives</th></tr></thead>
          <tbody>
            ${selectedRegimes.map(r => `
              <tr>
                <td><strong>${esc(r.label)}</strong></td>
                <td class="num"><strong style="color:${r.polScore >= 75 ? 'var(--green)' : r.polScore >= 55 ? 'var(--gold)' : 'var(--red)'}">${r.polScore}</strong></td>
                <td class="small">${esc(r.stance)}</td>
                <td class="small muted">${esc(r.incentives.slice(0, 2).join(' \u00b7 '))}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      ` : ''}

      ${selectedCorridors.length > 0 ? `
        <h3>Selected trade-flow corridors</h3>
        <table>
          <thead><tr><th>Sub-segment</th><th>Country</th><th class="num">Import $bn</th><th class="num">CAGR</th><th class="num">Tariff</th><th class="num">Oppty</th></tr></thead>
          <tbody>
            ${selectedCorridors.map(r => `
              <tr>
                <td><strong>${esc(r.segmentLabel)}</strong></td>
                <td>${esc(r.countryLabel)}</td>
                <td class="num">$${r.importUsdBn}B</td>
                <td class="num" style="color:var(--green)">${r.cagrPct}%</td>
                <td class="num" style="color:var(--red)">${r.tariffPct}%</td>
                <td class="num"><strong>${r.opptyScore}</strong></td>
              </tr>`).join('')}
          </tbody>
        </table>
      ` : ''}

      ${(selectedRegimes.length === 0 && selectedCorridors.length === 0 && selectedAssetTypes.length === 0) ? `
        <p class="small muted" style="margin-top:10px">No market-intelligence preferences set. Policy fit still contributes to scoring via the universal scorePolicyFit (10% of conviction); this section only reports analyst-directed boosts on top of that baseline.</p>
      ` : ''}

      <p class="small muted" style="margin-top:10px">Reference: dealnector-strategy-engine framework \u00b7 COUNTRY_POLICY_REGIMES (India 88, UAE 82, USA 72, W-Europe 68, SEA-Korea 64, S-Asia 48, China 35) and TRADE_FLOW_MATRIX (sub-segment \u00d7 country net-importer corridors).</p>
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

  // renderTarget — legacy per-target memo card (kept for portfolio overview);
  // the full per-target dossier with all aspects clubbed is renderDossier below.
  const renderTarget = (t: OpTarget, idx: number) => `
    <div class="card" style="margin-top:12px">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:baseline;border-bottom:1px solid var(--rule);padding-bottom:8px;margin-bottom:10px">
        <div>
          <span class="section-tag">Target ${idx + 1}</span>
          <div style="font-family:'Source Serif 4',Georgia,serif;font-size:15px;font-weight:700;color:var(--navy);margin-top:4px">${esc(t.name)} <span class="muted" style="font-size:11px;font-weight:400">(${esc(t.ticker)})</span></div>
          <div class="small">${esc(t.sec)} \u00b7 Conviction <strong>${(t.conviction * 100).toFixed(0)}%</strong> \u00b7 Horizon ${esc(t.horizon.label)}</div>
        </div>
        <div>
          <span class="pill pill-gold">BCG ${esc(t.bcg)}</span>
          <span class="pill pill-cyan">McK ${esc(t.mckinsey.replace(/_/g, ' '))}</span>
          <span class="pill pill-navy">${esc(t.dealStructureLabel)}</span>
          ${t.hostileExposure.exposed ? `<span class="pill pill-red">\u26a0 Hostile \u00b7 ${esc(t.hostileExposure.severity)}</span>` : ''}
        </div>
      </div>
      <div class="grid grid-2">
        <div>
          <h4>Thesis</h4>
          <ul>${t.memo.thesis.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        </div>
        <div>
          <h4>Integration Plan</h4>
          <ul>${t.memo.integration.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        </div>
      </div>
    </div>`

  // ── Per-target maps (computed once, used by the dossier renderer) ──
  const trajectories = selected.map((t) => ({ target: t, traj: trajectoryFor(t, 1.0) }))
  const analysis = selected.map((t) => ({ target: t, m: marketAnalysisFor(t) }))
  const trajByTicker = new Map<string, TargetTrajectory>()
  trajectories.forEach(({ target: t, traj }) => trajByTicker.set(t.ticker, traj))
  const analysisByTicker = new Map<string, ReturnType<typeof marketAnalysisFor>>()
  analysis.forEach(({ target: t, m }) => analysisByTicker.set(t.ticker, m))
  const preferredRegionsList = (inputs.preferredGeographies || []) as ExportRegionId[]
  const verdictByTicker = new Map<string, TargetVerdict>()
  selected.forEach((t) => {
    const traj = trajByTicker.get(t.ticker)!
    verdictByTicker.set(t.ticker, computeVerdict(t, traj, t.dealSizeCr))
  })
  // Integration-strategy classification needs to be available inside
  // renderDossier's hero chip — compute before the dossier template runs.
  const classifications = selected.map((t) => ({ target: t, cls: classifyIntegration(acquirer, t) }))
  const classByTicker = new Map<string, IntegrationClassification>()
  classifications.forEach(({ target, cls }) => classByTicker.set(target.ticker, cls))
  const acquirerPos: VcPosition = (() => {
    const comps = (acquirer.comp || []).map((c) => c.toLowerCase())
    const joined = comps.join(' ')
    if (/raw|polysilicon|wafer|ingot/.test(joined)) return 'raw'
    if (/manufactur|cell|module|blade|tower|casting|battery/.test(joined)) return 'manufacture'
    if (/inverter|transformer|switchgear|turbine|bos|gen set|vfd/.test(joined)) return 'equipment'
    if (/epc|integration|commissioning|erection|engineering/.test(joined)) return 'integration'
    if (/o&m|om |service|monitoring|inspection|consult/.test(joined)) return 'services'
    if (/ipp|utility|developer|retail|end use|end-user/.test(joined)) return 'end_use'
    return 'manufacture'
  })()
  const stratCounts = {
    backward: classifications.filter((x) => x.cls.strategy === 'backward').length,
    forward: classifications.filter((x) => x.cls.strategy === 'forward').length,
    complementary: classifications.filter((x) => x.cls.strategy === 'complementary').length,
    diversification: classifications.filter((x) => x.cls.strategy === 'diversification').length,
  }

  // ── Per-target dossier: all aspects of a single target clubbed together ──
  // Internal blocks are gated by the report-section toggles so Exec Brief
  // vs. IC-Grade still respect the user's section picks.
  const renderDossier = (t: OpTarget, idx: number): string => {
    const traj = trajByTicker.get(t.ticker)!
    const market = analysisByTicker.get(t.ticker)!
    const verdict = verdictByTicker.get(t.ticker)!
    const geoBrief = geographyFor(acquirer.sec || '', t)
    const prospective = prospectiveGeographies(t, acquirer.sec || '', preferredRegionsList)
    return `
      <article class="dossier">
        <div class="dossier-hero">
          <div style="min-width:0;flex:1">
            <span class="section-tag">Target ${idx + 1} of ${selected.length}</span>
            <h3 class="dossier-name" style="margin-top:6px">${esc(t.name)}<span class="dossier-ticker">${esc(t.ticker)}</span></h3>
            <div class="dossier-subline">${esc(t.sec || 'unclassified')} \u00b7 Conviction ${(t.conviction * 100).toFixed(0)}% \u00b7 ${esc(t.horizon.label)}</div>
            <div style="margin-top:10px">
              ${(() => {
                const cls = classByTicker.get(t.ticker)
                return cls ? `<span class="pill" style="background:${cls.color}18;border:1px solid ${cls.color};color:${cls.color}">${esc(cls.label)}</span>` : ''
              })()}
              <span class="pill pill-gold">BCG \u00b7 ${esc(t.bcg)}</span>
              <span class="pill pill-cyan">McK \u00b7 ${esc(t.mckinsey.replace(/_/g, ' '))}</span>
              <span class="pill pill-navy">${esc(t.dealStructureLabel)}</span>
              <span class="pill pill-navy">${esc(t.integrationMode)}</span>
              ${t.hostileExposure.exposed ? `<span class="pill pill-red">\u26a0 Hostile \u00b7 ${esc(t.hostileExposure.severity)}</span>` : ''}
              ${t.policyTailwinds.length > 0 ? `<span class="pill pill-green">${t.policyTailwinds.length} Policy tailwind${t.policyTailwinds.length === 1 ? '' : 's'}</span>` : ''}
            </div>
          </div>
          <div style="text-align:right;min-width:170px">
            <span class="verdict ${verdict.css}">${esc(verdict.label)}</span>
            <div class="stat-lbl" style="margin-top:10px">Deal size</div>
            <div class="stat-num" style="font-size:20px">${fmtCr(t.dealSizeCr)}</div>
          </div>
        </div>

        <div class="dossier-body">
          <div class="dossier-block">
            <div class="grid grid-4">
              <div class="card card-muted"><div class="stat-lbl">Revenue</div><div class="stat-num">${fmtCr(t.revCr)}</div></div>
              <div class="card card-muted"><div class="stat-lbl">EBITDA</div><div class="stat-num">${fmtCr(t.ebitdaCr)}</div><div class="small">${t.ebitdaMarginPct.toFixed(1)}% margin</div></div>
              <div class="card card-muted"><div class="stat-lbl">Revenue growth</div><div class="stat-num" style="color:${t.revGrowthPct >= 0 ? 'var(--green)' : 'var(--red)'}">${t.revGrowthPct >= 0 ? '+' : ''}${t.revGrowthPct.toFixed(1)}%</div></div>
              <div class="card card-muted"><div class="stat-lbl">Synergy/yr</div><div class="stat-num" style="color:var(--green)">${fmtCr(t.synergy.totalCr)}</div></div>
            </div>
          </div>

          ${use('memos') ? `
            <div class="dossier-block">
              <h3>Investment Thesis &amp; Risks</h3>
              <div class="grid grid-2">
                <div>
                  <h4>Thesis</h4>
                  <ul>${t.memo.thesis.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
                </div>
                <div>
                  <h4>Top Risks</h4>
                  <ul>${t.memo.risks.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
                </div>
              </div>
              <div class="grid grid-2" style="margin-top:14px">
                <div>
                  <h4>Integration Plan</h4>
                  <ul>${t.memo.integration.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
                </div>
                <div>
                  <h4>Valuation</h4>
                  <ul>${t.memo.valuation.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
                </div>
              </div>
            </div>
          ` : ''}

          ${use('marketAnalysis') ? `
            <div class="dossier-block">
              <h3>Market Analysis &amp; Advantage</h3>
              <div class="grid grid-3">
                <div><h4>Market sizing</h4><ul>${market.sizing.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
                <div><h4>Market advantage</h4><ul>${market.advantage.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
                <div><h4>Why recommended</h4><ul>${market.whyRecommended.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
              </div>
            </div>
          ` : ''}

          ${use('trajectory') ? `
            <div class="dossier-block">
              <h3>5-Year Value Trajectory</h3>
              <p class="small">Implied revenue CAGR <strong>${traj.revCagrPct.toFixed(1)}%</strong> \u00b7 cumulative value add <strong>${fmtCr(traj.fiveYearValueAddCr)}</strong> \u00b7 discounted NPV <strong>${fmtCr(traj.fiveYearDiscountedCr)}</strong> at 10% WACC.</p>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Year</th><th class="num">Revenue</th><th class="num">EBITDA</th><th class="num">Synergy</th><th class="num">Value Add</th><th class="num">Cumulative</th><th class="num">Discounted</th></tr></thead>
                  <tbody>
                    ${traj.years.map((y) => `<tr><td>Y${y.year}</td><td class="num">${fmtCr(y.revCr)}</td><td class="num">${fmtCr(y.ebitdaCr)}</td><td class="num">${fmtCr(y.synergyCr)}</td><td class="num">${fmtCr(y.valueAddCr)}</td><td class="num">${fmtCr(y.cumulativeValueCr)}</td><td class="num">${fmtCr(y.discountedValueCr)}</td></tr>`).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          ` : ''}

          ${use('geography') ? `
            <div class="dossier-block">
              <h3>Geography &amp; Market Access</h3>
              <p class="small">Country of operations: <strong>${esc(geoBrief.countryOfOperations)}</strong> \u00b7 Hub states: ${esc(geoBrief.hubs.join(', '))}</p>
              <div class="grid grid-2">
                <div><h4>Domestic avenues unlocked</h4><ul>${geoBrief.domesticUnlocks.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
                <div><h4>Export avenues unlocked</h4><ul>${geoBrief.exportUnlocks.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
              </div>
              ${prospective.length > 0 ? `
                <h4 style="margin-top:14px">Prospective corridors to watch</h4>
                <div class="table-wrap">
                  <table>
                    <thead><tr><th>#</th><th>Region</th><th class="num">Score</th><th>Priority</th><th>Top strategic advantages</th></tr></thead>
                    <tbody>
                      ${prospective.map((p, i) => `
                        <tr style="${p.isUserPreferred ? 'background:rgba(14,116,144,0.05)' : ''}">
                          <td>${i + 1}${p.isUserPreferred ? ' \u2605' : ''}</td>
                          <td><span class="pill" style="background:${p.region.color}22;border:1px solid ${p.region.color};color:${p.region.color}">${esc(p.region.label)}</span></td>
                          <td class="num">${p.score.toFixed(1)}</td>
                          <td class="small">${esc(p.rationale)}</td>
                          <td class="small">${p.advantages.slice(0, 2).map((a) => `<div style="margin-bottom:3px"><strong>${esc(a.short)}</strong> \u2014 ${esc(a.detail)}</div>`).join('')}</td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              ` : ''}
            </div>
          ` : ''}

          ${use('strategy') ? `
            <div class="dossier-block">
              <h3>Acquisition Strategy &amp; Legal Path</h3>
              <p class="small"><strong>${esc(t.acquisitionStrategy.label)}</strong> \u00b7 Promoter stake proxy <strong>${t.shareholding.promoterPct}%</strong> \u00b7 Band ${esc(t.shareholding.band)} \u00b7 Public float ${t.shareholding.publicFloatPct}%</p>
              <div class="grid grid-2">
                <div><h4>Execution steps</h4><ol>${t.acquisitionStrategy.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></div>
                <div><h4>Legal considerations</h4><ul>${t.acquisitionStrategy.legal.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></div>
              </div>
              ${t.shareholding.notes.length > 0 ? `<h4>Shareholding notes</h4><ul>${t.shareholding.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
            </div>
          ` : ''}

          ${use('hostile') && t.hostileExposure.exposed ? `
            <div class="dossier-block">
              <h3>Hostile-Takeover Exposure \u2014 Severity: ${esc(t.hostileExposure.severity)}</h3>
              <div class="grid grid-2">
                <div><h4>Exposure triggers</h4><ul>${t.hostileExposure.triggers.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
                <div><h4>SEBI SAST notes</h4><ul>${t.hostileExposure.sastNotes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
              </div>
            </div>
          ` : ''}

          ${(t.overlappingSubSegments.length > 0 || t.policyTailwinds.length > 0) ? `
            <div class="dossier-block">
              <h3>Coverage &amp; Policy Tailwinds</h3>
              <div class="grid grid-2">
                ${t.overlappingSubSegments.length > 0 ? `
                  <div>
                    <h4>Sub-segment overlap (${t.overlappingSubSegments.length})</h4>
                    <div>${t.overlappingSubSegments.map((s) => `<span class="pill pill-gold">${esc(s.label)}</span>`).join('')}</div>
                  </div>
                ` : '<div></div>'}
                ${t.policyTailwinds.length > 0 ? `
                  <div>
                    <h4>Policy tailwinds (${t.policyTailwinds.length})</h4>
                    <div>${t.policyTailwinds.map((p) => `<span class="pill pill-green" title="${esc(p.name)}">${esc(p.short)}</span>`).join('')}</div>
                  </div>
                ` : '<div></div>'}
              </div>
            </div>
          ` : ''}

          <div class="dossier-block">
            <h3>Conviction Score Breakdown</h3>
            <div>
              ${(Object.keys(t.subScores) as Array<keyof typeof t.subScores>).map((k) => {
                const pct = Math.round(t.subScores[k] * 100)
                const pretty = String(k).replace(/Fit$/, '').replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim()
                return `
                  <div class="score-row">
                    <span class="score-label">${esc(pretty)}</span>
                    <div class="score-bar"><div class="score-bar-fill" style="width:${pct}%;background:${pct >= 70 ? 'var(--green)' : pct >= 45 ? 'var(--gold)' : 'var(--muted)'}"></div></div>
                    <span class="score-val">${pct}%</span>
                  </div>`
              }).join('')}
            </div>
          </div>
        </div>

        <div class="value-add">
          <div class="value-add-lbl">Value Addition &amp; Verdict</div>
          <p style="margin:0 0 8px;font-weight:600;color:var(--navy);font-size:12.5px">${esc(verdict.valueAddLine)}</p>
          <ul style="margin:0">${verdict.reasoning.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        </div>
      </article>`
  }

  const dossierEnabled = selected.length > 0 && (
    use('memos') || use('marketAnalysis') || use('trajectory') || use('geography') || use('strategy') || use('hostile')
  )
  const s5 = !dossierEnabled ? '' : `
    <section>
      <div class="eyebrow">SECTION 05</div>
      <h2>Per-Target Dossiers</h2>
      <p class="lede">Each selected target presented as a complete dossier \u2014 thesis, risks, market analysis, 5-year value trajectory, geography, acquisition strategy, hostile exposure, sub-segment overlap, policy tailwinds, synergy breakdown, and a value-addition verdict \u2014 all clubbed together for rapid reading by the investment committee.</p>
      ${selected.map((t, i) => renderDossier(t, i)).join('')}
    </section>`

  const s5b = selected.length === 0 || !use('marketAnalysis') ? '' : `
    <section>
      <div class="eyebrow">SECTION 05B</div>
      <h2>Market Analysis &amp; Competitive Advantage</h2>
      <p class="muted">DealNector institutional-grade market sizing, structural advantage, and recommendation rationale per selected target. All narrative composed deterministically from the 8-factor conviction model, BCG × McKinsey-Horizon classification, policy tailwinds, DealNector sub-segment taxonomy, and synergy economics.</p>
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
  const preferredRegions = (inputs.preferredGeographies || []) as ExportRegionId[]
  const s5e = selected.length === 0 || !use('geography') || !programmeGeo ? '' : `
    <section>
      <div class="eyebrow">SECTION 05E</div>
      <h2>Geographic Footprint &amp; Market Access</h2>
      <p class="muted">Where each target operates domestically, which export corridors the acquisition inherits, and what new market avenues open up. Current DealNector universe is India-only \u2014 once the schema widens to carry non-India targets, cross-border candidates drop in via the same renderer and get validated against DGFT/ITC-HS export-import data to confirm demand patterns.</p>

      ${preferredRegions.length > 0 ? `
        <div class="card" style="border-color:#0aa5b2;background:rgba(10,165,178,0.06);margin-top:8px">
          <div class="stat-lbl" style="color:#0aa5b2">User-preferred geographies (${preferredRegions.length})</div>
          <div style="margin-top:6px">
            ${preferredRegions.map((id) => `<span class="pill pill-cyan" style="margin-right:4px">${esc(REGION_LABELS[id])}</span>`).join('')}
          </div>
          <div class="small" style="margin-top:6px">Targets whose sector exports to these regions were boosted in ranking. Below, each target\u2019s prospective-corridor ranker also weights these.</div>
        </div>
      ` : ''}

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
            <h3>Sector-typical export corridors</h3>
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

          ${(() => {
            const selectedTarget = selected.find((t) => t.ticker === b.ticker)
            if (!selectedTarget) return ''
            const prospective = prospectiveGeographies(selectedTarget, acquirer.sec || '', preferredRegions)
            if (prospective.length === 0) return ''
            return `
              <h3>Prospective corridors to watch \u00b7 with strategic reason</h3>
              <p class="small muted">Ranked by composite attractiveness: sector fit + strategic-advantage stack + user preference. Advantages span cheap labour, raw-material endowments, trade agreements, policy tailwinds, logistics proximity and energy cost.</p>
              <table>
                <thead><tr><th>Rank</th><th>Region</th><th class="num">Score</th><th>Priority</th><th>Strategic advantages</th></tr></thead>
                <tbody>
                  ${prospective.map((p, i) => `
                    <tr style="${p.isUserPreferred ? 'background:rgba(10,165,178,0.06)' : ''}">
                      <td>${i + 1}${p.isUserPreferred ? ' \u2605' : ''}</td>
                      <td><span class="pill" style="background:${p.region.color}22;border:1px solid ${p.region.color};color:${p.region.color}">${esc(p.region.label)}</span></td>
                      <td class="num">${p.score.toFixed(1)}</td>
                      <td class="small">${esc(p.rationale)}</td>
                      <td class="small">${p.advantages.slice(0, 3).map((a) => `<div style="margin-bottom:4px"><strong>${esc(a.short)}</strong> \u2014 ${esc(a.detail)}</div>`).join('') || '<span class="muted">Advantages cataloguing in progress.</span>'}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              <p class="small muted">Evidence will be cross-checked against UN Comtrade + World Bank WITS + DGFT/ITC-HS feeds once ingested. Each advantage row carries an <code>evidenceSource</code> field for that validation layer.</p>
            `
          })()}

          <p class="small muted">${esc(b.validationSource)}</p>
        </div>
      `).join('')}
    </section>`

  // §5F — Programme-level geography: compact radial map + unified corridor table.
  // Stands on its own (compact, map-first) while per-target geography lives
  // inside each dossier. Gated by the same 'geography' toggle.
  const s5f = selected.length === 0 || !use('geography') || !programmeGeo ? '' : `
    <section>
      <div class="eyebrow">SECTION 05F</div>
      <h2>Programme-Level Geography</h2>
      <p class="lede">Radial market-access map: India at the centre, export corridors positioned at approximate compass bearings. Dot size encodes the number of selected targets touching that region; arrow thickness scales with priority. Tabulated corridor detail sits alongside so the map stays uncluttered.</p>

      <div class="grid" style="grid-template-columns: 3fr 4fr; gap: 18px; margin-top: 14px">
        <div class="chart-wrap">${renderRadialMap(programmeGeo)}</div>
        <div class="card">
          <div class="stat-lbl" style="margin-bottom:8px">Corridor summary</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Region</th><th class="num">Targets</th><th>Anchor targets</th></tr></thead>
              <tbody>
                ${programmeGeo.exportMatrix.map((m) => `
                  <tr>
                    <td><span class="pill" style="background:${m.region.color}22;border:1px solid ${m.region.color};color:${m.region.color}">${esc(m.region.label)}</span></td>
                    <td class="num">${m.targets.length}</td>
                    <td class="small">${esc(m.targets.map((t) => t.name).join(', ').slice(0, 80))}${m.targets.map((t) => t.name).join(', ').length > 80 ? '\u2026' : ''}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <div class="small" style="margin-top:10px">Home hubs: ${esc(programmeGeo.acquirerHubs.slice(0, 6).join(', '))}</div>
          ${preferredRegions.length > 0 ? `<div class="small" style="margin-top:6px">User-preferred corridors: ${preferredRegions.map((id) => `<span class="pill pill-cyan">${esc(REGION_LABELS[id])}</span>`).join('')}</div>` : ''}
        </div>
      </div>
    </section>`

  // §1B — Key Themes. Defined late so it can reference stratCounts +
  // programmeGeo + plan; emitted into the HTML immediately after §1.
  const keyThemes: Array<{ title: string; body: string }> = (() => {
    const themes: Array<{ title: string; body: string }> = []
    if (selected.length === 0) return themes
    const byConviction = [...selected].sort((a, b) => b.conviction - a.conviction)
    const top = byConviction[0]
    themes.push({
      title: `Lead bet: ${top.name} (${(top.conviction * 100).toFixed(0)}% conviction)`,
      body: `The ${top.bcg.replace(/_/g, ' ')} / ${top.mckinsey.replace(/_/g, ' ')} classification, ${top.dealStructureLabel} structure, and ${fmtCr(top.synergy.totalCr)}/yr steady-state synergy make this the anchor of the programme.${top.policyTailwinds.length > 0 ? ' Policy tailwinds reinforce the thesis.' : ''}`,
    })
    const deepestSynergy = [...selected].sort((a, b) => b.synergy.totalCr - a.synergy.totalCr)[0]
    if (deepestSynergy && deepestSynergy.ticker !== top.ticker) {
      themes.push({
        title: `Richest synergy pool: ${deepestSynergy.name} \u2014 ${fmtCr(deepestSynergy.synergy.totalCr)}/yr`,
        body: `Combinatorial value of ${((deepestSynergy.synergy.totalCr / Math.max(1, deepestSynergy.revCr)) * 100).toFixed(1)}% of revenue \u2014 top-quartile economics that can fund integration cost inside 24 months.`,
      })
    }
    const highestGrowth = [...selected].sort((a, b) => b.revGrowthPct - a.revGrowthPct)[0]
    if (highestGrowth) {
      themes.push({
        title: `Growth anchor: ${highestGrowth.name} at ${highestGrowth.revGrowthPct.toFixed(1)}% revenue growth`,
        body: 'Sector tailwind visible in the revenue print \u2014 this target delivers compounding optionality beyond the steady-state synergy case and underwrites the programme\u2019s CAGR requirement.',
      })
    }
    if (stratCounts.diversification >= 1 && stratCounts.complementary + stratCounts.forward + stratCounts.backward >= 1) {
      themes.push({
        title: 'Balanced portfolio: consolidation plus optionality',
        body: `${stratCounts.complementary + stratCounts.forward + stratCounts.backward} in-sector integration play${(stratCounts.complementary + stratCounts.forward + stratCounts.backward) === 1 ? '' : 's'} alongside ${stratCounts.diversification} diversification shot${stratCounts.diversification === 1 ? '' : 's'}. Near-term accretion with a long-horizon hedge.`,
      })
    } else if (stratCounts.forward + stratCounts.backward >= 2) {
      themes.push({
        title: 'Vertical thesis dominates',
        body: `${stratCounts.forward} forward + ${stratCounts.backward} backward integration plays \u2014 the portfolio is oriented around owning more of the value chain in the acquirer\u2019s existing sector. Margin capture over market expansion.`,
      })
    } else if (stratCounts.complementary >= 2) {
      themes.push({
        title: 'Bolt-on thesis dominates',
        body: `${stratCounts.complementary} complementary acquisitions \u2014 the portfolio compounds scale and geographic reach inside the same value-chain position. Lowest execution risk of the four integration archetypes.`,
      })
    }
    if (programmeGeo && programmeGeo.exportMatrix.length >= 2) {
      const top2 = programmeGeo.exportMatrix.slice(0, 2).map((x) => x.region.label).join(' and ')
      themes.push({
        title: `Geography unlock: ${top2}`,
        body: `Selected targets together open sector-typical corridors into ${top2}${programmeGeo.exportMatrix.length > 2 ? ` (plus ${programmeGeo.exportMatrix.length - 2} other region${programmeGeo.exportMatrix.length - 2 === 1 ? '' : 's'})` : ''}. Export optionality is a material share of the equity story.`,
      })
    }
    if (exposedTargets.length > 0) {
      themes.push({
        title: `Execution watch: ${exposedTargets.length} hostile-exposure flag${exposedTargets.length === 1 ? '' : 's'}`,
        body: `Promoter-stake configuration at ${exposedTargets.length} target${exposedTargets.length === 1 ? '' : 's'} invites competitive-bid risk. Structure exclusivity + break-fees into LOIs; budget a 10\u201315% price-discipline buffer.`,
      })
    }
    if (plan.isGoalAchievable) {
      themes.push({
        title: 'Revenue goal met inside the horizon',
        body: `Combined entity crosses ${fmtCr(inputs.targetRevenueCr)} by month ${inputs.horizonMonths} \u2014 organic growth pressure lifts off the operating business and IC mandate for inorganic spend is validated.`,
      })
    } else {
      themes.push({
        title: `Goal shortfall: ${fmtCr(Math.abs(plan.gapToGoalCr))} to close`,
        body: `Current selection lands short of the ${fmtCr(inputs.targetRevenueCr)} mandate. Options: (1) relax the deal-size band, (2) extend the horizon, or (3) add a top-up transaction beyond this shortlist.`,
      })
    }
    return themes.slice(0, 6)
  })()

  const s1b = !use('keyThemes') || keyThemes.length === 0 ? '' : `
    <section>
      <div class="eyebrow">SECTION 02 \u00b7 KEY THEMES</div>
      <h2>What You Need to Know</h2>
      <p class="lede">A distilled read of the downstream analysis \u2014 six takeaways the investment committee should retain after closing this document. Every theme is derived from data explored in detail in later sections.</p>
      <div class="grid grid-2" style="margin-top:14px">
        ${keyThemes.map((th, i) => `
          <div class="card" style="border-left:3px solid var(--gold);padding:16px">
            <div class="stat-lbl" style="color:var(--gold);margin-bottom:4px">Theme ${String(i + 1).padStart(2, '0')}</div>
            <div style="font-family:'Source Serif 4',Georgia,serif;font-size:14px;font-weight:700;color:var(--navy);line-height:1.3;margin-bottom:6px">${esc(th.title)}</div>
            <p style="margin:0;font-size:11.5px;line-height:1.6">${esc(th.body)}</p>
          </div>
        `).join('')}
      </div>
    </section>`

  // §5G — Integration Strategy Map (classifications + acquirerPos + stratCounts
  // were computed above so renderDossier's hero chip can reference them).
  const s5g = selected.length === 0 || !use('integrationMap') ? '' : `
    <section>
      <div class="eyebrow">SECTION 05G</div>
      <h2>Integration Strategy Map</h2>
      <p class="lede">Each selected target classified on the four canonical M&amp;A integration strategies: <strong>Backward Integration</strong> (secure supply and capture supplier margin), <strong>Forward Integration</strong> (own the customer and capture downstream margin), <strong>Complementary</strong> (same sector bolt-on for scale or geography), and <strong>Diversification</strong> (enter a new value chain). Two views: a value-chain strip showing each target's position relative to the acquirer, and a 2\u00d72 strategy matrix that counts the programme mix.</p>

      <div class="grid grid-4" style="margin-top:12px">
        <div class="card" style="border-left:3px solid #0e7490"><div class="stat-lbl">Backward</div><div class="stat-num" style="color:#0e7490">${stratCounts.backward}</div><div class="small">Secure supply</div></div>
        <div class="card" style="border-left:3px solid #a47a28"><div class="stat-lbl">Forward</div><div class="stat-num" style="color:#a47a28">${stratCounts.forward}</div><div class="small">Capture customer</div></div>
        <div class="card" style="border-left:3px solid #166534"><div class="stat-lbl">Complementary</div><div class="stat-num" style="color:#166534">${stratCounts.complementary}</div><div class="small">Bolt-on scale</div></div>
        <div class="card" style="border-left:3px solid #7c3aed"><div class="stat-lbl">Diversification</div><div class="stat-num" style="color:#7c3aed">${stratCounts.diversification}</div><div class="small">New value chain</div></div>
      </div>

      <h3>Value-Chain Strip \u2014 acquirer + each target placed on the chain</h3>
      <div class="chart-wrap">${renderValueChainStrip(acquirer, acquirerPos, classifications)}</div>

      <div class="grid" style="grid-template-columns: 5fr 4fr; gap: 18px; margin-top: 6px">
        <div class="chart-wrap">${renderIntegrationMatrix(classifications)}</div>
        <div class="card">
          <div class="stat-lbl" style="margin-bottom:8px">Classification summary</div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Target</th><th>Strategy</th><th>Rationale</th></tr></thead>
              <tbody>
                ${classifications.map(({ target, cls }, i) => `
                  <tr>
                    <td>${i + 1}</td>
                    <td><strong>${esc(target.name)}</strong><br/><span class="small">${esc(target.ticker)} \u00b7 ${esc(target.vcPosition)}</span></td>
                    <td><span class="pill" style="background:${cls.color}18;border:1px solid ${cls.color};color:${cls.color}">${esc(cls.label)}</span></td>
                    <td class="small">${esc(cls.reasoning)}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>`

  // §5H — Where to Play: the move map.
  // Shows the full value-chain strip with three zones coloured:
  //   GREEN  = acquirer's current positions (Company.comp mapped)
  //   RED    = user-excluded stages ("do not acquire here")
  //   GOLD   = stages the framework recommends moving into (from the
  //            recommender's target stages + each selected target's
  //            direction — backward / forward / complementary / diversify)
  // Effect-first: every recommended stage is tagged with what it does
  // ("Secure supply", "Capture customer", "New value chain") and lists
  // which selected targets would land the acquirer there.
  type WhereToPlayStrip = {
    svg: string
    currentStageCount: number
    recommendedStageCount: number
    excludedStageCount: number
    recommendedBreakdown: Array<{
      stage: string
      stageName: string
      targets: Array<{ target: OpTarget; dir: string; color: string }>
    }>
  }
  const whereToPlayStrip: WhereToPlayStrip | null = (() => {
    if (selected.length === 0) return null
    const excludedStages = new Set(inputs.excludedStages || [])
    const currentStages = new Set<string>()
    for (const c of acquirer.comp || []) {
      const stg = COMP_TO_STAGE_CODE[c.toLowerCase()]
      if (stg) currentStages.add(stg)
    }
    // Map each selected target to its VC stage (via its first sub code
    // that maps to a known stage). OpTarget exposes Company.comp as `sub`.
    const targetStageInfo = selected.map((t) => {
      let stage: string | null = null
      for (const c of t.sub || []) {
        const stg = COMP_TO_STAGE_CODE[c.toLowerCase()]
        if (stg) { stage = stg; break }
      }
      const cls = classByTicker.get(t.ticker)
      return { target: t, stage, cls }
    })

    // Map of recommended stages → list of targets that would place the
    // acquirer there, plus their direction + colour.
    const recommended = new Map<string, Array<{ target: OpTarget; dir: string; color: string }>>()
    for (const { target, stage, cls } of targetStageInfo) {
      if (!stage || !cls) continue
      if (currentStages.has(stage)) continue // already covered
      if (excludedStages.has(stage)) continue // excluded
      if (!recommended.has(stage)) recommended.set(stage, [])
      recommended.get(stage)!.push({ target, dir: cls.label, color: cls.color })
    }

    // Gather all stages to display on the strip: union of current +
    // recommended + excluded + all stages in the acquirer's industry.
    const acquirerIndustry = acquirer.sec ? industryCodeFor(acquirer.sec) : null
    const industryStages = acquirerIndustry ? TAXONOMY_STAGES.filter((s) => s.industryCode === acquirerIndustry) : []
    const allRelevantStageCodes = new Set<string>()
    industryStages.forEach((s) => allRelevantStageCodes.add(s.code))
    currentStages.forEach((s) => allRelevantStageCodes.add(s))
    recommended.forEach((_, code) => allRelevantStageCodes.add(code))
    excludedStages.forEach((s) => allRelevantStageCodes.add(s))
    const stagesOrdered = Array.from(allRelevantStageCodes).sort((a, b) => a.localeCompare(b))

    // SVG: stages as coloured blocks, labels + "direction" annotation
    // above any recommended stage.
    const width = 780
    const rowHeight = 78
    const labelY = 32
    const blockY = 42
    const blockH = 26
    const totalH = rowHeight + Math.max(0, recommended.size) * 18 + 60
    const blockW = Math.max(80, (width - 40) / Math.max(1, stagesOrdered.length))
    const xOf = (i: number) => 20 + i * blockW

    const stageSvg = stagesOrdered.map((code, i) => {
      const stage = TAXONOMY_STAGES.find((s) => s.code === code)
      const label = stage?.name || code
      const isCurrent = currentStages.has(code)
      const isExcluded = excludedStages.has(code)
      const isRecommended = recommended.has(code)
      let fill = '#e2e8f0'
      let stroke = '#cbd5e1'
      let textColor = '#475569'
      if (isCurrent && !isExcluded) { fill = 'rgba(22,101,52,0.14)'; stroke = '#166534'; textColor = '#166534' }
      if (isExcluded) { fill = 'rgba(239,68,68,0.12)'; stroke = '#dc2626'; textColor = '#dc2626' }
      if (isRecommended && !isCurrent && !isExcluded) { fill = 'rgba(164,122,40,0.16)'; stroke = '#a47a28'; textColor = '#a47a28' }
      const x = xOf(i)
      const labelPrefix = isExcluded ? '⊘ ' : isCurrent ? '● ' : isRecommended ? '★ ' : ''
      // Truncate stage name if too long for block
      const maxChars = Math.floor((blockW - 8) / 5.5)
      const displayLabel = label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label
      return `
        <g>
          <text x="${x + blockW / 2}" y="${labelY - 4}" text-anchor="middle" font-size="8" fill="${textColor}" font-family="JetBrains Mono, monospace" font-weight="700">${esc(code)}</text>
          <rect x="${x + 2}" y="${blockY}" width="${blockW - 4}" height="${blockH}" fill="${fill}" stroke="${stroke}" stroke-width="1.2" rx="3" ry="3"/>
          <text x="${x + blockW / 2}" y="${blockY + blockH / 2 + 3}" text-anchor="middle" font-size="9" fill="${textColor}" font-weight="700" font-family="Source Serif 4, Georgia, serif">${esc(labelPrefix + displayLabel)}</text>
        </g>`
    }).join('')

    // Direction arrows + target names above each recommended stage.
    const recAnnotations: string[] = []
    let annotIdx = 0
    recommended.forEach((targets, stageCode) => {
      const i = stagesOrdered.indexOf(stageCode)
      if (i < 0) return
      const x = xOf(i) + blockW / 2
      const y = blockY + blockH + 18 + annotIdx * 18
      const names = targets.map((t) => t.target.name.length > 14 ? t.target.name.slice(0, 12) + '…' : t.target.name).join(', ')
      const col = targets[0].color
      const dirLabel = targets[0].dir
      recAnnotations.push(`
        <g>
          <line x1="${x}" y1="${blockY + blockH}" x2="${x}" y2="${y - 6}" stroke="${col}" stroke-width="1.5"/>
          <circle cx="${x}" cy="${y - 4}" r="3" fill="${col}"/>
          <text x="${x + 6}" y="${y}" font-size="9" fill="${col}" font-weight="700" font-family="Source Serif 4, Georgia, serif">${esc(dirLabel)}:</text>
          <text x="${x + 6}" y="${y + 10}" font-size="8.5" fill="#475569" font-family="Source Serif 4, Georgia, serif">${esc(names)}</text>
        </g>`)
      annotIdx++
    })

    // Legend
    const legendY = totalH - 30
    const legend = `
      <g transform="translate(20, ${legendY})">
        <rect x="0" y="-8" width="14" height="10" fill="rgba(22,101,52,0.14)" stroke="#166534" rx="2"/>
        <text x="18" y="1" font-size="9.5" fill="#475569" font-family="Source Serif 4, Georgia, serif">Current posture</text>
        <rect x="140" y="-8" width="14" height="10" fill="rgba(164,122,40,0.16)" stroke="#a47a28" rx="2"/>
        <text x="158" y="1" font-size="9.5" fill="#475569" font-family="Source Serif 4, Georgia, serif">Framework move (★)</text>
        <rect x="310" y="-8" width="14" height="10" fill="rgba(239,68,68,0.12)" stroke="#dc2626" rx="2"/>
        <text x="328" y="1" font-size="9.5" fill="#475569" font-family="Source Serif 4, Georgia, serif">Excluded by user (⊘)</text>
        <rect x="480" y="-8" width="14" height="10" fill="#e2e8f0" stroke="#cbd5e1" rx="2"/>
        <text x="498" y="1" font-size="9.5" fill="#475569" font-family="Source Serif 4, Georgia, serif">Adjacent stage, no target yet</text>
      </g>`

    return {
      svg: `
        <svg viewBox="0 0 ${width} ${totalH}" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">
          <text x="20" y="14" font-size="10" fill="#6b7280" font-family="JetBrains Mono, monospace" letter-spacing="1.4">VALUE CHAIN \u00b7 ${esc(industryLabel(acquirerIndustry || '') || 'acquirer\u2019s industry')}</text>
          ${stageSvg}
          ${recAnnotations.join('')}
          ${legend}
        </svg>`,
      currentStageCount: currentStages.size,
      recommendedStageCount: recommended.size,
      excludedStageCount: excludedStages.size,
      recommendedBreakdown: Array.from(recommended.entries()).map(([stage, targets]) => ({
        stage,
        stageName: TAXONOMY_STAGES.find((s) => s.code === stage)?.name || stage,
        targets,
      })),
    }
  })()

  const s5h = selected.length === 0 || !use('whereToPlay') ? '' : `
    <section>
      <div class="eyebrow">SECTION 05H</div>
      <h2>Where to Play \u2014 Moves Mapped</h2>
      <p class="lede">One chart, three colours, one answer: where the acquirer is, where the framework says to move next, and where the user has told us not to go. Each gold-starred stage is tagged with the move type (backward / forward / complementary / diversification) and the specific selected targets that would land the acquirer there.</p>

      <div class="grid grid-3" style="margin-top:14px">
        <div class="card" style="border-left:3px solid #166534">
          <div class="stat-lbl" style="color:#166534">Current posture</div>
          <div class="stat-num" style="color:#166534">${whereToPlayStrip ? whereToPlayStrip.currentStageCount : 0}</div>
          <div class="small">stages already covered by acquirer</div>
        </div>
        <div class="card" style="border-left:3px solid #a47a28">
          <div class="stat-lbl" style="color:#a47a28">Framework moves</div>
          <div class="stat-num" style="color:#a47a28">${whereToPlayStrip ? whereToPlayStrip.recommendedStageCount : 0}</div>
          <div class="small">new stages selected targets unlock</div>
        </div>
        <div class="card" style="border-left:3px solid #dc2626">
          <div class="stat-lbl" style="color:#dc2626">User-excluded</div>
          <div class="stat-num" style="color:#dc2626">${whereToPlayStrip ? whereToPlayStrip.excludedStageCount : 0}</div>
          <div class="small">stages marked &ldquo;already here, do not acquire&rdquo;</div>
        </div>
      </div>

      <h3>The Move Map</h3>
      <div class="chart-wrap">${whereToPlayStrip ? whereToPlayStrip.svg : ''}</div>
      <p class="small muted">Green blocks are the acquirer&rsquo;s existing stages. Gold blocks are stages that at least one selected target would plant a flag in \u2014 the arrow labels show the direction of that move (forward integration / backward integration / complementary / diversification) and name the target. Red blocks are the stages the analyst has explicitly excluded (scoring penalty \u2014 0.10 cap). Grey blocks are other stages in the same industry that no selected target hits yet \u2014 future hunting ground.</p>

      <h3>Direction \u00b7 Stage \u00b7 Effect</h3>
      <p>Explicit table of every move the selected portfolio makes \u2014 what it adds to the acquirer\u2019s footprint in plain English.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Direction</th><th>New stage entered</th><th>Target(s)</th><th>Immediate effect</th></tr></thead>
          <tbody>
            ${(whereToPlayStrip?.recommendedBreakdown || []).map((r) => {
              const dir = r.targets[0]?.dir || 'Complementary'
              const color = r.targets[0]?.color || '#166534'
              const effect = dir === 'Backward Integration'
                ? `Secures upstream supply of ${esc(r.stageName)}; captures supplier margin + de-risks input cost.`
                : dir === 'Forward Integration'
                  ? `Owns the ${esc(r.stageName)} customer relationship; captures downstream margin + pricing control.`
                  : dir === 'Diversification'
                    ? `Enters a new value chain at ${esc(r.stageName)}; adds optionality + portfolio hedge.`
                    : `Adds scale, geography, or sub-segment breadth at ${esc(r.stageName)}.`
              return `
                <tr>
                  <td><span class="pill" style="background:${color}18;border:1px solid ${color};color:${color}">${esc(dir)}</span></td>
                  <td><strong>${esc(r.stage)} \u00b7 ${esc(r.stageName)}</strong></td>
                  <td class="small">${esc(r.targets.map((t) => t.target.name).join(', '))}</td>
                  <td class="small">${effect}</td>
                </tr>`
            }).join('') || '<tr><td colspan="4" class="small muted">No selected target lands a new stage \u2014 all picks consolidate inside the acquirer\u2019s existing posture.</td></tr>'}
          </tbody>
        </table>
      </div>
      ${(inputs.excludedStages || []).length > 0 ? `
        <h3>Explicit exclusions</h3>
        <p class="small">The analyst has told the framework to avoid these stages \u2014 any target landing here suffers a scoring penalty (max \u22120.10):</p>
        <div>${(inputs.excludedStages || []).map((s) => {
          const stg = TAXONOMY_STAGES.find((x) => x.code === s)
          return `<span class="pill pill-red">\u2298 ${esc(s)} \u00b7 ${esc(stg?.name || 'unknown')}</span>`
        }).join('')}</div>
      ` : ''}
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

  // §14 — Conclusion: the recommendation + 30/60/90-day roadmap.
  // Built deterministically from selected targets, verdicts, timeline
  // buckets, and hostile exposure. Closes the narrative loop: mandate
  // was set in §3, universe was dissected in §5-§9, verdict is delivered here.
  const nearTargets = selected.filter((t) => t.horizon.id === 'near')
  const midTargets = selected.filter((t) => t.horizon.id === 'mid')
  const longTargets = selected.filter((t) => t.horizon.id === 'long')
  const strongBuys = selected.filter((t) => verdictByTicker.get(t.ticker)?.band === 'strong_buy')
  const recommendedBuys = selected.filter((t) => verdictByTicker.get(t.ticker)?.band === 'recommended')

  // ── Unified conclusion key points (shared across all variants) ────
  // Board / IC / Detailed all render these five takeaways so the
  // recommendation line is consistent regardless of which report the
  // reader picks up. IC and Detailed then add the 30/60/90 roadmap.
  const topConvictions = selected.length > 0 ? selected.slice(0, 3) : allRanked.slice(0, 3)
  const conclusionKeyPoints: Array<{ label: string; body: string }> = [
    {
      label: 'Verdict',
      body: `${programmeVerdict.headline} ${verdictCounts.strong_buy > 0 ? `Strong-buy names: ${selected.filter(t => verdictByTicker.get(t.ticker)?.band === 'strong_buy').slice(0, 3).map(t => esc(t.name)).join(', ')}.` : ''}`,
    },
    {
      label: 'Screening criteria',
      body: `${tierMeta.label} tier · ${criteriaActive}/4 hard filters active (${inputs.minEbitdaMarginPct ? `EBITDA ≥ ${inputs.minEbitdaMarginPct}%` : 'no EBITDA floor'}, ${inputs.maxEvEbitdaMultiple ? `EV/EBITDA ≤ ${inputs.maxEvEbitdaMultiple}×` : 'no multiple cap'}, ${inputs.esgRequired ? 'ESG gate ON' : 'ESG gate OFF'}). Pool sized against the tier's reference bands.`,
    },
    {
      label: 'Market intelligence captured',
      body: `${selectedRegimes.length} policy regime${selectedRegimes.length === 1 ? '' : 's'}${avgPolScore !== null ? ` (avg pol score ${avgPolScore})` : ''} · ${selectedCorridors.length} trade-flow corridor${selectedCorridors.length === 1 ? '' : 's'}${bestOppty !== null ? ` (best oppty ${bestOppty})` : ''} · asset-type intent: ${selectedAssetTypes.length > 0 ? selectedAssetTypes.map(a => a.label.toLowerCase()).join(' + ') : 'not directed'}.`,
    },
    {
      label: 'Top convictions',
      body: topConvictions.length > 0
        ? topConvictions.map(t => `${esc(t.name)} (${Math.round(t.conviction * 100)}% · ${t.horizon.id}-horizon · ${classifyAssetType(t.integrationDir, acquirer.sec || '', t.sec || '').replace('_', ' ')})`).join(' · ')
        : 'No targets selected yet.',
    },
    {
      label: 'Capital & goal closure',
      body: `${fmtCr(plan.totalFundRequiredCr)} required across ${selected.length} target${selected.length === 1 ? '' : 's'}. ${plan.isGoalAchievable ? `Programme <strong>clears</strong> the ${fmtCr(inputs.targetRevenueCr)} revenue goal.` : `Programme falls <strong>${fmtCr(Math.abs(plan.gapToGoalCr))} short</strong> — relax the band or extend horizon.`}${exposedTargets.length > 0 ? ` ${exposedTargets.length} hostile-exposure flag${exposedTargets.length === 1 ? '' : 's'} to mitigate.` : ''}`,
    },
  ]

  const conclusionKeyPointsHtml = `
      <h3>Why this recommendation</h3>
      <ol style="margin-top:8px">
        ${conclusionKeyPoints.map(k => `<li style="margin-bottom:6px"><strong>${esc(k.label)}.</strong> ${k.body}</li>`).join('')}
      </ol>`

  const s14 = !use('conclusion') ? '' : `
    <section>
      <div class="eyebrow">SECTION \u00b7 CONCLUSION</div>
      <h2>Recommendation${variant === 'board' ? '' : ' &amp; 30 / 60 / 90-Day Roadmap'}</h2>

      <div class="hero" style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;border-left-color:var(--gold)">
        <span class="verdict ${programmeVerdict.css}" style="font-size:14px;padding:12px 20px">${esc(programmeVerdict.label)}</span>
        <div style="flex:1;min-width:240px">
          <p class="lede" style="margin:0;font-size:14px;font-weight:600;color:var(--navy)">${esc(programmeVerdict.headline)}</p>
        </div>
      </div>

      ${conclusionKeyPointsHtml}

      <h3>Verdict at a glance</h3>
      <div class="grid grid-4" style="margin-top:10px">
        <div class="card" style="border-left:3px solid var(--green)"><div class="stat-lbl" style="color:var(--green)">Strong Buy</div><div class="stat-num" style="color:var(--green)">${strongBuys.length}</div><div class="small">${strongBuys.length > 0 ? strongBuys.slice(0, 2).map((t) => esc(t.name)).join(', ') + (strongBuys.length > 2 ? '\u2026' : '') : 'none'}</div></div>
        <div class="card" style="border-left:3px solid var(--gold)"><div class="stat-lbl" style="color:var(--gold)">Recommended</div><div class="stat-num" style="color:var(--gold)">${recommendedBuys.length}</div><div class="small">${recommendedBuys.length > 0 ? recommendedBuys.slice(0, 2).map((t) => esc(t.name)).join(', ') + (recommendedBuys.length > 2 ? '\u2026' : '') : 'none'}</div></div>
        <div class="card" style="border-left:3px solid var(--gold)"><div class="stat-lbl">Total capital at stake</div><div class="stat-num">${fmtCr(plan.totalFundRequiredCr)}</div><div class="small">across ${selected.length} target${selected.length === 1 ? '' : 's'}</div></div>
        <div class="card" style="border-left:3px solid var(--gold)"><div class="stat-lbl">Revenue to land</div><div class="stat-num">${fmtCr(plan.projectedRevCr - (acquirer.rev || 0))}</div><div class="small">${plan.isGoalAchievable ? '\u2713 clears the ' + fmtCr(inputs.targetRevenueCr) + ' goal' : fmtCr(Math.abs(plan.gapToGoalCr)) + ' short of goal'}</div></div>
      </div>

      ${variant === 'board' ? '' : `
      <h3>30-Day Asks</h3>
      <ol>
        <li><strong>IC mandate.</strong> Seek board + investment committee approval to pursue the ${selected.length}-target programme on the conviction matrix above. Circulate this memo 72 hours ahead of the meeting.</li>
        <li><strong>Lender relationships.</strong> Open indicative-terms conversations with the top three lenders in the capital-stack table (\u00a79). Budget two weeks for term sheets.</li>
        <li><strong>Counsel engagement.</strong> Retain corporate, tax, and antitrust counsel on the ${selected.length > 1 ? 'programme' : 'transaction'}; align on the deal-structure recommendation per target (\u00a75 dossiers).</li>
        ${nearTargets.length > 0 ? `<li><strong>Near-horizon LOI + DD kickoff.</strong> Prepare Letters of Intent for ${nearTargets.map((t) => esc(t.name)).join(', ')} \u2014 commission commercial DD (customer, supplier, operations) in parallel.</li>` : ''}
        ${exposedTargets.length > 0 ? `<li><strong>Defensive posture.</strong> Pre-align legal and PR on SEBI SAST disclosure thresholds for the ${exposedTargets.length} hostile-exposed target${exposedTargets.length === 1 ? '' : 's'}.</li>` : ''}
      </ol>`}

      ${variant === 'board' ? '' : `
      <h3>60-Day Milestones</h3>
      <ol>
        <li><strong>Signed LOIs + exclusivity</strong> on the near-horizon target${nearTargets.length === 1 ? '' : 's'}${nearTargets.length > 0 ? ' (' + nearTargets.map((t) => esc(t.name)).join(', ') + ')' : ''}.</li>
        <li><strong>Committed financing</strong> \u2014 convert indicative lender terms into binding commitments covering ${fmtCr(plan.totalFundRequiredCr)}.</li>
        <li><strong>Commercial DD completion</strong> with a signed quality-of-earnings report backing each near-horizon target.</li>
        <li><strong>Regulatory pre-clearance</strong> \u2014 CCI, SEBI, and RBI (if FDI) filings initiated; clock management built into closing schedule.</li>
      </ol>

      <h3>90-Day Deliverables</h3>
      <ol>
        <li><strong>First close</strong> on the highest-conviction near-horizon target; integration team mobilised on Day-One plan.</li>
        <li><strong>Mid-horizon shortlist locked</strong> \u2014 move ${midTargets.map((t) => esc(t.name)).join(', ') || 'mid-horizon picks'} from screening to active negotiation.</li>
        <li><strong>Post-close 100-day plan</strong> published for the first closed target, covering synergy capture, integration mode (${selected[0]?.integrationMode || 'n/a'} by default), and retention carve-outs.</li>
        <li><strong>Programme dashboard live</strong> \u2014 consolidated tracker linking each target\u2019s dossier, DD status, regulatory clock, financing lines, and synergy realisation vs. plan.</li>
      </ol>

      ${longTargets.length > 0 ? `
        <h3>Beyond 90 Days</h3>
        <p>Long-horizon candidates (${longTargets.map((t) => esc(t.name)).join(', ')}) enter a quarterly re-scoring cadence. Trigger events \u2014 earnings miss, promoter-stake change, sector consolidation move \u2014 should accelerate them into the active pipeline.</p>
      ` : ''}`}

      <div class="hero" style="margin-top:22px;border-left-color:var(--navy);background:#f3f4f6">
        <div class="value-add-lbl" style="color:var(--navy)">Closing statement</div>
        <p class="lede" style="margin:6px 0 0">The combination of deterministic scoring, framework triangulation, and the ${fmtCr(plan.totalFundRequiredCr)} capital commitment outlined here converts <strong>${esc(acquirer.name)}\u2019s</strong> inorganic ambition into an executable programme. ${programmeVerdict.label === 'Programme: Strong Buy' ? 'The IC is invited to approve full mandate.' : programmeVerdict.label === 'Programme: Recommended' ? 'The IC is invited to approve the programme with the financing and regulatory contingencies noted.' : 'The IC is invited to either tighten the shortlist or broaden the search before committing capital.'}</p>
      </div>
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
        ${variant === 'board' ? `
          <!-- Board Pack: compact masthead, no cover page -->
          <div style="border-top:6px solid var(--gold);border-bottom:1px solid var(--rule);padding:18px 0 22px;margin-bottom:18px">
            <div class="eyebrow" style="color:var(--gold);font-size:11px;letter-spacing:3px">DealNector \u00b7 Board Pack</div>
            <h1 style="margin-top:8px">${esc(acquirer.name)} \u2014 <em style="color:var(--gold);font-style:italic;font-weight:400">Inorganic Growth \u00b7 Board Summary</em></h1>
            <p class="lede" style="color:var(--ink);margin:10px 0 0;max-width:640px">${esc(subtitle)}</p>
            <div style="display:flex;gap:14px;margin-top:12px;flex-wrap:wrap;align-items:center">
              <span class="cover-pill" style="background:rgba(164,122,40,0.12);color:var(--gold);border:1px solid var(--gold)">${esc(variantMeta.pageTarget)}</span>
              <span class="small"><strong>Report ID</strong> <span style="font-family:'JetBrains Mono',monospace">${esc(id)}</span></span>
              <span class="small"><strong>Prepared</strong> ${esc(new Date(nowIso).toLocaleString('en-IN'))}</span>
              <span class="small"><strong>Classification</strong> Confidential</span>
            </div>
          </div>
        ` : `
          <!-- IC + Detailed: full navy cover page -->
          <div class="cover">
            <div>
              <div class="cover-eyebrow">DealNector \u00b7 Institutional M&amp;A Intelligence</div>
              <div class="cover-title">${esc(acquirer.name)}<br/><em>Inorganic Growth Programme</em></div>
              <div class="cover-sub">${esc(subtitle)}</div>
              <div style="margin-top:22px"><span class="cover-pill">${esc(variantMeta.label)} \u00b7 ${esc(variantMeta.pageTarget)}</span></div>
            </div>

            <div class="cover-tiles">
              <div class="cover-tile">
                <div class="cover-tile-lbl">Targets</div>
                <div class="cover-tile-val">${selected.length}</div>
                <div class="cover-tile-sub">selected from ${allRanked.length} scored</div>
              </div>
              <div class="cover-tile">
                <div class="cover-tile-lbl">Capital at stake</div>
                <div class="cover-tile-val">${esc(fmtCr(plan.totalFundRequiredCr))}</div>
                <div class="cover-tile-sub">programme total</div>
              </div>
              <div class="cover-tile">
                <div class="cover-tile-lbl">Projected revenue</div>
                <div class="cover-tile-val">${esc(fmtCr(plan.projectedRevCr))}</div>
                <div class="cover-tile-sub">within ${inputs.horizonMonths} months</div>
              </div>
              <div class="cover-tile">
                <div class="cover-tile-lbl">Verdict</div>
                <div class="cover-tile-val" style="color:#e9c676">${esc(programmeVerdict.label.replace('Programme: ', ''))}</div>
                <div class="cover-tile-sub">${plan.isGoalAchievable ? 'goal achievable' : 'shortfall flagged'}</div>
              </div>
            </div>

            <div class="cover-foot">
              <span>Report ID \u00b7 ${esc(id)}</span>
              <span>Prepared ${esc(new Date(nowIso).toLocaleString('en-IN'))}</span>
              <span>Confidential \u00b7 Pre-Decisional</span>
            </div>
          </div>
        `}

        ${selected.length > 0 && variant !== 'board' ? `
          <div class="card" style="background:var(--cream);border:1px solid var(--rule);margin-bottom:24px">
            <div class="stat-lbl" style="color:var(--gold);margin-bottom:8px">Contents</div>
            <div class="grid grid-3" style="font-size:11px;line-height:1.8">
              <div>
                <strong style="color:var(--navy)">Part I &mdash; The Case</strong><br/>
                <span class="muted">1. Executive Summary</span><br/>
                ${use('keyThemes') ? '<span class="muted">2. Key Themes</span><br/>' : ''}
                ${use('acquirer') ? '<span class="muted">3. The Mandate</span><br/>' : ''}
                ${use('framework') ? '<span class="muted">4. Strategic Framework</span>' : ''}
              </div>
              <div>
                <strong style="color:var(--blue)">Part II &mdash; The Analysis</strong><br/>
                ${use('portfolio') ? '<span class="muted">5. Target Universe</span><br/>' : ''}
                <span class="muted">6. Per-Target Dossiers</span><br/>
                ${use('comparison') ? '<span class="muted">7. Cross-Target Comparison</span><br/>' : ''}
                ${use('integrationMap') ? '<span class="muted">8. Integration Strategy Map</span><br/>' : ''}
                ${use('geography') ? '<span class="muted">9. Geographic Footprint</span>' : ''}
              </div>
              <div>
                <strong style="color:var(--gold)">Part III &mdash; The Decision</strong><br/>
                ${use('timeline') ? '<span class="muted">10. Programme Timeline</span><br/>' : ''}
                ${use('fund') ? '<span class="muted">11. Fund &amp; Lender Map</span><br/>' : ''}
                ${use('balance') ? '<span class="muted">12. Balance-Sheet Projection</span><br/>' : ''}
                ${use('placement') ? '<span class="muted">13. Pre/Post Placement</span><br/>' : ''}
                ${use('risks') ? '<span class="muted">14. Risks &amp; Mitigations</span><br/>' : ''}
                ${use('conclusion') ? '<strong style="color:var(--gold)">15. Conclusion &amp; Roadmap</strong>' : ''}
              </div>
            </div>
          </div>
        ` : ''}

        ${variant !== 'board' ? `
          <div class="part-ribbon part-1">
            <div class="part-num">Part I</div>
            <div class="part-title">The Case</div>
            <div class="part-desc">The mandate, the growth ambition, and the strategic posture that anchors the search.</div>
          </div>
        ` : ''}
        ${s1}${s1b}${s2}${s3}${s3b}${s3c}
        ${variant !== 'board' ? `
          <div class="part-ribbon part-2">
            <div class="part-num">Part II</div>
            <div class="part-title">The Analysis</div>
            <div class="part-desc">Ranked universe, per-target dossiers, cross-target comparison, integration map, and geographic footprint.</div>
          </div>
        ` : ''}
        ${s4}${s5}${s5d}${s5h}${s5f}${s5g}
        ${variant !== 'board' ? `
          <div class="part-ribbon part-3">
            <div class="part-num">Part III</div>
            <div class="part-title">The Decision</div>
            <div class="part-desc">Timeline, capital stack, balance-sheet projection, market-position shift, risks, and the recommendation.</div>
          </div>
        ` : ''}
        ${s8}${s9}${s10}${s11}${s12}${s14}${s13}
        ${/* s5b / s5c / s5e per-target / s6 / s7 are now merged into the per-target Dossier section (§5). Their bodies stay defined for backwards compatibility but are no longer emitted into the report. */ ''}
        ${/* keep references so bundlers don't tree-shake */ ''}${s5b ? '' : ''}${s5c ? '' : ''}${s5e ? '' : ''}${s6 ? '' : ''}${s7 ? '' : ''}
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
