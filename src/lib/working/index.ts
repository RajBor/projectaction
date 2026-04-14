import type { Company } from '@/lib/data/companies'
import type { ChainNode } from '@/lib/data/chain'
import type {
  WorkingDef,
  WorkingStep,
  WorkingSource,
  WorkingNote,
} from '@/components/working/WorkingPopup'
import type { CompanyAdjustedMetrics } from '@/lib/news/adjustments'
import type { DerivedMetrics } from '@/lib/valuation/live-metrics'
import { formatInrCr } from '@/lib/format'

// Helper for number formatting — uses Indian comma grouping (1,23,456)
const fmt = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? 'N/A' : n.toLocaleString('en-IN')

// Helper: format a ₹Cr value with Indian commas + Cr suffix
const fmtCr = (n: number | null | undefined): string =>
  n == null || Number.isNaN(n) ? '—' : formatInrCr(n)

// ── EV/EBITDA ──────────────────────────────────────
export function wkEVEBITDA(co: Company): WorkingDef {
  const ebitda = co.ebitda || Math.round((co.rev * co.ebm) / 100)
  const notes: WorkingNote[] = (
    [
      {
        type: 'note' as const,
        k: 'Limitation',
        v: 'EV/EBITDA does not capture capex intensity. A 12× EV/EBITDA for a capital-light service business is very different from 12× for a capital-intensive manufacturing plant.',
      },
      {
        type: 'warn' as const,
        k: 'Private Company',
        v: co.mktcap
          ? ''
          : 'This is a private entity — EV is estimated. Actual valuation requires a formal DCF and independent third-party appraisal.',
      },
    ] satisfies WorkingNote[]
  ).filter((n) => n.v)

  return {
    icon: '📊',
    title: `EV/EBITDA — ${co.name}`,
    subtitle:
      'Enterprise Value to EBITDA multiple — primary acquisition valuation metric',
    result: `${co.ev_eb}×`,
    resultLabel: 'EV/EBITDA Multiple',
    resultNote:
      co.ev_eb <= 15
        ? '✅ Attractive zone (≤15×)'
        : co.ev_eb <= 25
          ? '🟡 Fair value zone (15–25×)'
          : co.ev_eb <= 35
            ? '🟠 Elevated (25–35×)'
            : '🔴 Expensive (>35×)',
    benchmark:
      'India energy sector: 10–40×  |  Ideal acquisition: ≤15×  |  Market avg: ~22×',
    formula: `EV / EBITDA\n\nwhere:\n  EV (Enterprise Value)    = Market Cap + Net Debt\n  EBITDA                   = Revenue × EBITDA Margin %\n  Net Debt                 = Total Debt − Cash`,
    steps: [
      {
        label: 'Revenue',
        calc: `Sourced from latest annual filing (BSE/NSE)`,
        result: `₹${fmt(co.rev)}Cr`,
      },
      {
        label: 'EBITDA Margin',
        calc: `Operating profit before interest, tax, D&A as % of revenue`,
        result: `${co.ebm}%`,
      },
      {
        label: 'EBITDA',
        calc: `₹${fmt(co.rev)}Cr × ${co.ebm}% = ₹${co.rev}Cr × 0.${co.ebm < 10 ? '0' + co.ebm : co.ebm}`,
        result: `₹${fmt(ebitda)}Cr`,
      },
      {
        label: 'Enterprise Value (EV)',
        calc: `Market Cap (₹${fmt(co.mktcap)}Cr) + Net Debt (est. from D/E ratio ${co.dbt_eq})`,
        result: `₹${fmt(co.ev)}Cr`,
      },
      {
        label: 'EV/EBITDA Multiple',
        calc: `₹${fmt(co.ev)}Cr ÷ ₹${fmt(ebitda)}Cr`,
        result: `${co.ev_eb}×`,
      },
    ],
    assumptions: [
      {
        k: 'EV',
        v: `Computed as: Market Cap + (Equity × D/E ratio). For listed entities, market cap is trailing 3-month average from NSE. For private entities, estimated from last funding round or peer multiple.`,
      },
      {
        k: 'EBITDA',
        v: `Uses reported EBITDA from latest full-year annual results. For promoter-owned private entities, recast EBITDA (removing personal expenses) should be 10–20% higher.`,
      },
      {
        k: 'Comparables',
        v: `India solar/T&D peer EV/EBITDA range: Power transformers 8–18×, Smart meters 15–25×, Solar modules 6–12×, PV glass 10–14×, Cable manufacturers 12–22×`,
      },
    ],
    sources: [
      {
        name: 'BSE/NSE Annual Reports',
        color: 'var(--blue)',
        note: 'latest full-year financials',
      },
      {
        name: 'Screener.in',
        color: 'var(--cyan2)',
        note: 'consolidated P&L and balance sheet',
      },
      {
        name: 'Moneycontrol',
        color: 'var(--green)',
        note: 'real-time market cap',
      },
      {
        name: 'Peer Benchmarking',
        color: 'var(--gold2)',
        note: 'India listed energy sector comparables',
      },
    ],
    notes,
  }
}

// ── P/E Ratio ──────────────────────────────────────
export function wkPE(co: Company): WorkingDef {
  return {
    icon: '💰',
    title: `P/E Ratio — ${co.name}`,
    subtitle: 'Price-to-Earnings — market valuation relative to net profit',
    result: co.pe ? `${co.pe}×` : 'N/A',
    resultLabel: 'P/E Multiple',
    resultNote: co.pe
      ? co.pe <= 20
        ? '✅ Value zone (≤20×)'
        : co.pe <= 40
          ? '🟡 Fair (20–40×)'
          : '🔴 Growth premium (>40×)'
      : 'Not applicable (no listed P&L)',
    benchmark:
      'India energy sector: 18–70×  |  Value: <25×  |  Growth: 40–80×',
    formula: `P/E = Market Price per Share / Earnings per Share\n\nor equivalently:\nP/E = Market Capitalisation / Profit After Tax (PAT)`,
    steps: [
      {
        label: 'Market Capitalisation',
        calc: 'Latest trailing 3-month average from NSE/BSE',
        result: `₹${fmt(co.mktcap)}Cr`,
      },
      {
        label: 'Profit After Tax (PAT)',
        calc: 'From latest audited annual report',
        result: `₹${fmt(co.pat)}Cr`,
      },
      {
        label: 'P/E Ratio',
        calc: `₹${fmt(co.mktcap)}Cr ÷ ₹${fmt(co.pat)}Cr`,
        result: `${co.pe || 'N/A'}×`,
      },
    ],
    assumptions: [
      {
        k: 'PAT used',
        v: 'Standalone or consolidated — whichever is the primary reporting entity. Exceptional items (one-time gains/losses) are included in reported PAT unless explicitly adjusted.',
      },
      {
        k: 'Market Cap',
        v: 'Trailing average — point-in-time market cap fluctuates with daily share price moves. A ±20% market cap swing changes P/E by the same magnitude.',
      },
    ],
    sources: [
      {
        name: 'NSE/BSE Filings',
        color: 'var(--blue)',
        note: 'audited annual PAT',
      },
      { name: 'Screener.in', color: 'var(--cyan2)', note: 'live P/E tracking' },
    ],
    notes: [
      {
        type: 'note',
        k: 'For M&A',
        v: 'P/E is a secondary metric for acquisition analysis. EV/EBITDA is preferred because it is capital-structure neutral (debt level does not distort the multiple).',
      },
      {
        type: 'warn',
        k: 'Cyclicality',
        v: 'In high-growth periods, P/E appears expensive but is justified by forward earnings. Always complement trailing P/E with forward P/E using analyst estimates.',
      },
    ],
  }
}

// ── Revenue Growth ─────────────────────────────────
export function wkRevGrowth(co: Company): WorkingDef {
  return {
    icon: '📈',
    title: `Revenue Growth — ${co.name}`,
    subtitle:
      'Year-on-year revenue growth rate — #1 determinant of deal multiple (Strategic Analysis)',
    result: `${co.revg}%`,
    resultLabel: 'Revenue CAGR (3-yr)',
    resultNote:
      co.revg >= 30
        ? '🚀 High growth (>30%) — commands 15–22× EV/EBITDA'
        : co.revg >= 15
          ? '✅ Solid growth (15–30%) — 10–15× range'
          : co.revg >= 8
            ? '🟡 Moderate growth (8–15%) — 7–10× range'
            : '⚠ Slow growth (<8%) — 5–8× range',
    benchmark:
      'India solar manufacturing: 30–85% YoY  |  T&D: 15–35% YoY  |  Smart meters: 28–45% YoY',
    formula: `Revenue CAGR = (Revenue_Year_N / Revenue_Year_0)^(1/N) − 1\n\nwhere N = number of years (typically 3)`,
    steps: [
      {
        label: 'Sourcing',
        calc: '3-year revenue series from audited annual reports (MCA/ROC filings for private, BSE/NSE for listed)',
      },
      {
        label: '3-Year CAGR',
        calc: 'Computed over FY21→FY24 or latest available 3-year window',
        result: `${co.revg}% per year`,
      },
      {
        label: 'Strategic Multiple Impact',
        calc: `Per regression analysis: ${co.revg}% growth → ${co.revg >= 30 ? '15–22×' : co.revg >= 15 ? '10–15×' : co.revg >= 8 ? '7–10×' : '5–8×'} EV/EBITDA is market-supported`,
        result: `${co.revg >= 30 ? 'HIGH' : co.revg >= 15 ? 'MEDIUM-HIGH' : 'MEDIUM'} multiple zone`,
      },
    ],
    assumptions: [
      {
        k: 'Data source',
        v: 'Screener.in consolidated revenue, cross-checked against MCA annual filing. Growth rates for private entities estimated from CRISIL/ICRA ratings or industry surveys.',
      },
      {
        k: 'Strategic Analysis principle',
        v: '"Regression analysis demonstrates that the #1 determinant of deal multiples is the growth rate of the business. The higher the growth rate, the higher the multiple of cash flow that the business is worth." — Strategic Analysis',
      },
    ],
    sources: [
      {
        name: 'MCA/ROC Annual Filings',
        color: 'var(--blue)',
        note: 'audited revenue figures',
      },
      {
        name: 'Screener.in',
        color: 'var(--cyan2)',
        note: 'consolidated 5-year revenue history',
      },
      {
        name: 'CMIE / Bloomberg',
        color: 'var(--green)',
        note: 'sector revenue benchmarks',
      },
    ],
  }
}

// ── Debt/Equity ────────────────────────────────────
export function wkDebtEquity(co: Company): WorkingDef {
  const netDebt = co.mktcap
    ? Math.round((co.mktcap * co.dbt_eq) / (1 + co.dbt_eq))
    : null
  const equityEst =
    netDebt != null && co.dbt_eq > 0 ? Math.round(netDebt / co.dbt_eq) : null
  return {
    icon: '⚖',
    title: `Debt/Equity Ratio — ${co.name}`,
    subtitle:
      'Financial leverage — impacts acquisition feasibility and lender appetite',
    result: `${co.dbt_eq}×`,
    resultLabel: 'D/E Ratio',
    resultNote:
      co.dbt_eq === 0
        ? '🟢 Debt-free — ideal acquisition target'
        : co.dbt_eq <= 0.3
          ? '✅ Conservative leverage (<0.3×)'
          : co.dbt_eq <= 0.7
            ? '🟡 Moderate leverage (0.3–0.7×)'
            : co.dbt_eq <= 1.2
              ? '🟠 Elevated leverage (0.7–1.2×)'
              : '🔴 High leverage (>1.2×) — acquisition risk',
    benchmark:
      'Ideal acquisition target: D/E ≤ 0.5  |  India mid-cap average: 0.4–0.8',
    formula: `D/E Ratio = Total Financial Debt / Total Shareholders' Equity\n\nNet Debt = Total Debt − Cash & Equivalents\nDebt/EBITDA = Net Debt / EBITDA (alternate leverage measure)`,
    steps: [
      {
        label: 'Total Debt',
        calc: 'Short-term borrowings + Long-term debt from balance sheet',
        result: `Est. ₹${fmt(netDebt)}Cr`,
      },
      {
        label: 'Equity',
        calc: 'Paid-up capital + Reserves & Surplus (Book Value)',
        result: `Est. ₹${fmt(equityEst)}Cr`,
      },
      {
        label: 'D/E Ratio',
        calc: `Total Debt ÷ Total Equity`,
        result: `${co.dbt_eq}×`,
      },
      {
        label: 'Acquisition Impact',
        calc: 'Buyer inherits all debt in a share purchase. At D/E > 1.0, senior lenders require buyer to refinance immediately at close.',
      },
    ],
    assumptions: [
      {
        k: 'Debt figure',
        v: 'Sourced from latest balance sheet. Off-balance-sheet items (operating leases, contingent liabilities) are NOT included but should be reviewed in full DD.',
      },
      {
        k: 'Strategic Analysis caution',
        v: '"A company with poor cash flow, existing debt, and encumbered assets severely limits financing options." High D/E targets require buyers to use more equity in the capital stack.',
      },
    ],
    sources: [
      {
        name: 'BSE/NSE Balance Sheet',
        color: 'var(--blue)',
        note: 'short-term + long-term borrowings',
      },
      { name: 'Screener.in', color: 'var(--cyan2)', note: 'live D/E ratio' },
    ],
    notes: [
      {
        type: 'warn',
        k: 'Acquisition Warning',
        v:
          co.dbt_eq > 1
            ? `D/E of ${co.dbt_eq}× is elevated. Senior lenders will require meaningful debt reduction before providing acquisition finance. Budget for debt repayment in deal sizing.`
            : 'D/E is manageable. Include debt in EV calculation to arrive at true total acquisition cost.',
      },
    ],
  }
}

// ── Acquisition Score ──────────────────────────────
export function wkAcqScore(co: Company): WorkingDef {
  const drivers = [
    {
      name: 'Revenue Growth Rate (Strategic #1 driver)',
      val: co.revg >= 30 ? 9 : co.revg >= 20 ? 7 : co.revg >= 12 ? 5 : 3,
      note: `${co.revg}% CAGR → ${co.revg >= 30 ? 'High' : 'Moderate'} growth premium`,
    },
    {
      name: 'Market Share / Niche Strength',
      val: co.acqs >= 9 ? 9 : co.acqs >= 7 ? 7 : co.acqs >= 5 ? 5 : 3,
      note: `Assessed from sector positioning and market presence`,
    },
    {
      name: 'Barriers to Entry (ALMM/BIS/regulatory)',
      val: co.sec === 'solar' ? 8 : co.sec === 'td' ? 6 : 5,
      note: `${co.sec === 'solar' ? 'BCD + ALMM listing moat' : 'T&D regulatory approvals + RDSS empanelment'}`,
    },
    {
      name: 'Management Depth',
      val: co.acqf === 'STRONG BUY' ? 8 : co.acqf === 'CONSIDER' ? 6 : 4,
      note: 'Inferred from acquisition flag and deal feasibility',
    },
    {
      name: 'Cash Flow Stability (EBITDA Margin)',
      val: co.ebm >= 20 ? 9 : co.ebm >= 14 ? 7 : co.ebm >= 9 ? 5 : 3,
      note: `EBITDA margin ${co.ebm}%`,
    },
    {
      name: 'Concentration Risk (inverted)',
      val: co.acqs >= 8 ? 7 : co.acqs >= 5 ? 5 : 3,
      note: 'Estimated from revenue diversification and customer base',
    },
    {
      name: 'Technology Obsolescence Risk (inverted)',
      val:
        co.sec === 'solar'
          ? co.comp?.includes('solar_cells')
            ? 8
            : 6
          : 7,
      note: 'Technology vintage vs. market direction',
    },
  ]
  const weights = [25, 20, 15, 15, 10, 10, 5]
  const rawScore = drivers.reduce((s, d) => s + d.val, 0)
  const maxScore = drivers.length * 10
  const normalised = Math.round((rawScore / maxScore) * 10)
  const weightedSum = drivers
    .reduce((s, d, i) => s + (d.val * weights[i]) / 100, 0)
    .toFixed(1)

  return {
    icon: '🎯',
    title: `Acquisition Score — ${co.name}`,
    subtitle: "Multi-factor score (1–10) based on 7 strategic value drivers",
    result: `${co.acqs}/10`,
    resultLabel: 'Acquisition Attractiveness Score',
    resultNote:
      co.acqs >= 9
        ? '⭐ STRONG BUY — Immediate acquisition priority'
        : co.acqs >= 7
          ? '✅ STRONG BUY / CONSIDER — Compelling target'
          : co.acqs >= 5
            ? '🟡 MONITOR — Opportunity at right valuation'
            : '⚪ PASS — Not an acquisition priority',
    benchmark:
      'Score ≥8 = institutional acquisition target  |  Score 5–7 = monitor/minority stake  |  Score <5 = pass',
    formula: `Acquisition Score (1–10) = Weighted average of Strategic Analysis 7 Value Drivers\n\nDrivers:\n1. Revenue Growth Rate (weight: 25%)\n2. Market Share / Niche (weight: 20%)\n3. Barriers to Entry (weight: 15%)\n4. Management Depth (weight: 15%)\n5. Cash Flow Stability (weight: 10%)\n6. Customer Concentration Risk (weight: 10%)\n7. Technology Obsolescence Risk (weight: 5%)`,
    table: {
      title: '📋 Driver-by-Driver Scoring',
      headers: ['Strategic Value Driver', 'Raw Score', 'Weight', 'Weighted'],
      rows: [
        ...drivers.map((d, i) => [
          d.name,
          `${d.val}/10`,
          `${weights[i]}%`,
          `${((d.val * weights[i]) / 100).toFixed(2)}`,
        ]),
        ['TOTAL WEIGHTED SCORE', '—', '100%', String(weightedSum)],
      ],
    },
    steps: [
      {
        label: 'Score each of 7 Strategic Analysis value drivers 1–10',
        calc: 'Based on quantitative data (revenue growth, EBITDA margin) + qualitative assessment (management depth, barriers)',
      },
      {
        label: 'Apply weights',
        calc: "Growth and market share carry the highest weights (25% + 20%) as per Strategic Analysis regression findings",
      },
      {
        label: 'Normalise to 1–10 scale',
        calc: `Raw weighted sum → normalised 1–10: ${normalised} (reported as ${co.acqs} with strategic adjustment for acquirability)`,
      },
      {
        label: 'Acquirability adjustment',
        calc: 'Final score also penalises targets that score high on drivers but are effectively unacquirable (PSUs, foreign MNCs, size-prohibitive)',
        result: `Final: ${co.acqs}/10 — ${co.acqf}`,
      },
    ],
    assumptions: [
      { k: 'Strategic rationale', v: co.rea },
      {
        k: 'Acquirability',
        v: 'Score is penalised for: government ownership >51%, foreign parent that will not divest, market cap > ₹50,000Cr (beyond typical India mid-market deal), or pending SEBI/regulatory issues.',
      },
    ],
    sources: [
      {
        name: 'Strategic Analysis Framework',
        color: 'var(--gold2)',
        note: '7 value driver scoring model',
      },
      {
        name: 'DealNector Sector Analysis',
        color: 'var(--cyan2)',
        note: 'India energy sector context',
      },
      {
        name: 'BSE/NSE Financials',
        color: 'var(--blue)',
        note: 'quantitative inputs',
      },
    ],
    notes: [
      {
        type: 'note',
        k: 'Score interpretation',
        v: 'This is a relative ranking tool within the India solar/T&D universe — not an absolute investment rating. A score of 8 means this is one of the most compelling acquisition targets in the coverage universe.',
      },
    ],
  }
}

// ── EBITDA Margin ──────────────────────────────────
export function wkEBITDAMargin(co: Company): WorkingDef {
  const ebitda = co.ebitda || Math.round((co.rev * co.ebm) / 100)
  return {
    icon: '💹',
    title: `EBITDA Margin — ${co.name}`,
    subtitle:
      'Core profitability metric — earnings before interest, tax, depreciation & amortisation',
    result: `${co.ebm}%`,
    resultLabel: 'EBITDA Margin',
    resultNote:
      co.ebm >= 20
        ? '🟢 Premium margin (≥20%) — category leader'
        : co.ebm >= 14
          ? '✅ Strong margin (14–20%)'
          : co.ebm >= 9
            ? '🟡 Average margin (9–14%)'
            : '⚠ Below-average margin (<9%)',
    benchmark:
      'Solar modules: 10–16%  |  Solar cells: 8–18%  |  PV Glass: 12–20%  |  Power transformers: 10–18%  |  Smart meters: 14–20%',
    formula: `EBITDA Margin = EBITDA / Revenue × 100\n\nEBITDA = Revenue − COGS − SG&A expenses\n       (before: Interest, Tax, Depreciation, Amortisation)`,
    steps: [
      { label: 'Revenue', result: `₹${fmt(co.rev)}Cr` },
      {
        label: 'EBITDA (reported)',
        calc: 'From P&L: Operating Profit + Depreciation (added back)',
        result: `₹${fmt(ebitda)}Cr`,
      },
      {
        label: 'EBITDA Margin',
        calc: `₹${fmt(ebitda)}Cr ÷ ₹${fmt(co.rev)}Cr × 100`,
        result: `${co.ebm}%`,
      },
    ],
    assumptions: [
      {
        k: 'Add-back items',
        v: 'Depreciation and amortisation are added back to operating profit to arrive at EBITDA. Stock compensation, restructuring charges, and one-time impairments are included unless separately disclosed.',
      },
      {
        k: 'Industry context',
        v:
          co.ebm >= 16
            ? `${co.ebm}% margin places ${co.name} in the top quartile of India ${co.sec === 'solar' ? 'solar' : 'T&D'} manufacturers.`
            : co.ebm < 10
              ? `${co.ebm}% is below sector average — review raw material pass-through capability and operating leverage potential.`
              : `${co.ebm}% is in line with sector median.`,
      },
    ],
    sources: [
      {
        name: 'Annual Report',
        color: 'var(--blue)',
        note: 'audited P&L statement',
      },
      {
        name: 'Screener.in',
        color: 'var(--cyan2)',
        note: '5-year margin history',
      },
    ],
  }
}

// ── Market Size (chain node) ───────────────────────
export function wkMarketSize(chain: ChainNode): WorkingDef {
  return {
    icon: '🌍',
    title: `Market Size — ${chain.name}`,
    subtitle: 'India addressable market and global market sizing',
    result: chain.mkt?.ig || 'N/A',
    resultLabel: 'India Market Size (Est.)',
    resultNote: `CAGR: ${chain.mkt?.icagr || 'N/A'} · ${chain.mkt?.ist || ''}`,
    benchmark: `Global market: ${chain.mkt?.gg || 'N/A'} at ${chain.mkt?.gcagr || 'N/A'} CAGR`,
    formula: `India TAM = Installed capacity target (GW) × Unit value (₹/MW)\n\nor: DISCOM/PSU annual procurement × unit price × market share\n\nCAGR = (End Value / Start Value)^(1/years) − 1`,
    steps: [
      {
        label: 'India market sizing basis',
        calc:
          chain.mkt?.ist ||
          'Based on government policy targets and current procurement data',
      },
      {
        label: 'Global market context',
        calc: chain.mkt?.gc || 'Key global players and their India market share',
      },
      {
        label: 'Growth rate',
        calc: `India CAGR ${chain.mkt?.icagr || '—'} driven by policy targets (NSM 500GW, RDSS, GEC, NEP-2032)`,
      },
    ],
    assumptions: [
      {
        k: 'India market',
        v: 'Estimated from MNRE capacity addition targets, SECI tender pipeline, RDSS scheme rollout, and analyst consensus (CRISIL, Bridge to India, BNEF, JMK Research)',
      },
      {
        k: 'Global market',
        v: 'Based on BNEF Global Market Outlook, IEA World Energy Investment Report, and GlobalData sector reports',
      },
      {
        k: 'Margin for error',
        v: 'Market size estimates for India are notoriously volatile — ±25–30% variance is common due to policy timing uncertainty and execution risk',
      },
    ],
    sources: [
      {
        name: 'MNRE Annual Report',
        color: 'var(--green)',
        note: 'India capacity targets',
      },
      {
        name: 'SECI Tender Database',
        color: 'var(--blue)',
        note: 'live project pipeline',
      },
      {
        name: 'RDSS MIS Dashboard',
        color: 'var(--cyan2)',
        note: 'smart meter rollout',
      },
      {
        name: 'BNEF / Wood Mackenzie',
        color: 'var(--gold2)',
        note: 'global market sizing',
      },
      {
        name: 'JMK Research / Bridge to India',
        color: 'var(--orange)',
        note: 'India solar estimates',
      },
      {
        name: 'CRISIL / ICRA Reports',
        color: 'var(--purple)',
        note: 'T&D sector sizing',
      },
    ],
    notes: [
      {
        type: 'warn',
        k: 'Disclaimer',
        v: 'All market size figures are estimates from third-party industry sources as of FY2024–25. Actual market development is subject to policy implementation timing, DISCOM payment risk, and commodity price movements.',
      },
    ],
  }
}

// ── DCF Output ─────────────────────────────────────
export interface DCFOutputParams {
  name?: string
  rev: number
  ebm: number
  gr: number
  wacc: number
  tgr: number
  yrs: number
  debt: number
  rs: number
  cs: number
  ic: number
  evBase: number
  termPV: number
  pv: number
  evSyn: number
  synPV: number
}

export function wkDCFOutput(params: DCFOutputParams): WorkingDef {
  const { rev, ebm, gr, wacc, tgr, yrs, debt, rs, cs, ic, evBase, termPV, pv, evSyn, synPV } =
    params
  const ebitda = (rev * ebm) / 100
  const tableRows: (string | number)[][] = []
  let curRevY = rev
  for (let i = 1; i <= yrs; i++) {
    curRevY *= 1 + gr / 100
    const fcf = curRevY * (ebm / 100) * 0.6
    const df = Math.pow(1 + wacc / 100, i)
    const pv_i = fcf / df
    tableRows.push([
      `Year ${i}`,
      `₹${Math.round(curRevY).toLocaleString('en-IN')} Cr`,
      `${ebm}%`,
      `₹${Math.round(fcf).toLocaleString('en-IN')} Cr`,
      `${df.toFixed(3)}×`,
      `₹${Math.round(pv_i).toLocaleString('en-IN')} Cr`,
    ])
  }

  return {
    icon: '📐',
    title: 'DCF Valuation — Full Working',
    subtitle:
      'Discounted Cash Flow model — step-by-step enterprise value derivation',
    result: `₹${Math.round(evBase).toLocaleString('en-IN')} Cr`,
    resultLabel: 'DCF Enterprise Value',
    resultNote: `With synergies: ₹${Math.round(evSyn).toLocaleString('en-IN')} Cr`,
    benchmark: `Implied EV/EBITDA: ${ebitda > 0 ? (evBase / ebitda).toFixed(1) : '—'}× vs sector range 8–22×`,
    formula: `EV = Σ (FCF_t / (1 + WACC)^t) + Terminal Value / (1 + WACC)^n\n\nFCF_t = EBITDA_t × (1 − Tax Rate approx)\n      = Revenue_t × EBITDA% × 0.60\n\nTerminal Value = FCF_n+1 / (WACC − TGR)\n             = FCF_n × (1+TGR) / (WACC−TGR)\n\nSynergy NPV = (Rev Synergy × realisation% + Cost Synergy) × multiple − Integration Cost`,
    steps: [
      {
        label: 'Base Revenue & EBITDA',
        calc: `Revenue: ₹${rev.toLocaleString('en-IN')} Cr  |  EBITDA Margin: ${ebm}%  |  EBITDA: ₹${Math.round(ebitda).toLocaleString('en-IN')} Cr`,
      },
      {
        label: 'Revenue growth projection',
        calc: `${gr}% per year for ${yrs} years → Year ${yrs} Revenue: ₹${Math.round(rev * Math.pow(1 + gr / 100, yrs)).toLocaleString('en-IN')} Cr`,
      },
      {
        label: 'Free Cash Flow conversion',
        calc: `EBITDA × (1 − effective tax rate) = EBITDA × 60%\n(Uses simplified FCF = EBITDA × 0.6 to approximate post-tax, post-capex free cash flow)`,
      },
      {
        label: 'Discount rate (WACC)',
        calc: `${wacc}% — India mid-cap energy sector WACC\n(Risk-free rate ~7% + equity risk premium ~5% + size premium ~2–4%)`,
      },
      {
        label: 'Sum of PV of cash flows (Yrs 1–' + yrs + ')',
        calc: `ΣPV = FCF₁/(1+r)¹ + ... + FCF${yrs}/(1+r)${yrs}`,
        result: `₹${Math.round(pv).toLocaleString('en-IN')} Cr`,
      },
      {
        label: 'Terminal Value (Gordon Growth)',
        calc: `TV = FCF_${yrs + 1} / (WACC − TGR) = FCF_${yrs} × (1+${tgr}%) / (${wacc}%−${tgr}%) / (1+${wacc}%)^${yrs}`,
        result: `PV of TV: ₹${Math.round(termPV).toLocaleString('en-IN')} Cr`,
      },
      {
        label: 'DCF Enterprise Value',
        calc: `ΣPV + PV(Terminal Value) = ₹${Math.round(pv).toLocaleString('en-IN')} Cr + ₹${Math.round(termPV).toLocaleString('en-IN')} Cr`,
        result: `₹${Math.round(evBase).toLocaleString('en-IN')} Cr`,
      },
      {
        label: 'Synergy NPV',
        calc: `Rev Synergy: ₹${rs}Cr × 30% realisation × 7× mult = ₹${Math.round(rs * 0.3 * 7).toLocaleString('en-IN')} Cr\nCost Synergy: ₹${cs}Cr × 7× mult = ₹${Math.round(cs * 7).toLocaleString('en-IN')} Cr\nIntegration Cost: −₹${ic}Cr\nNet Synergy NPV = ₹${Math.round(rs * 0.3 * 7 + cs * 7 - ic).toLocaleString('en-IN')} Cr`,
        result: `₹${Math.round(synPV).toLocaleString('en-IN')} Cr`,
      },
      {
        label: 'EV with Synergies',
        calc: `₹${Math.round(evBase).toLocaleString('en-IN')} Cr + ₹${Math.round(synPV).toLocaleString('en-IN')} Cr`,
        result: `₹${Math.round(evSyn).toLocaleString('en-IN')} Cr`,
      },
      {
        label: 'Equity Value',
        calc: `EV − Net Debt (₹${debt.toLocaleString('en-IN')} Cr)`,
        result: `₹${Math.round(evBase - debt).toLocaleString('en-IN')} Cr (standalone) / ₹${Math.round(evSyn - debt).toLocaleString('en-IN')} Cr (with synergies)`,
      },
      {
        label: 'Bid Range logic',
        calc: `Floor = Standalone EV × 90% (conservative)\nCeiling = EV incl. synergies × 95% (leaving synergy upside for buyer)`,
        result: `₹${Math.round(evBase * 0.9).toLocaleString('en-IN')} Cr – ₹${Math.round(evSyn * 0.95).toLocaleString('en-IN')} Cr`,
      },
      {
        label: 'Max Walk-Away Price',
        calc: `EV incl. synergies × 110% — any higher and synergies cannot justify the premium`,
        result: `₹${Math.round(evSyn * 1.1).toLocaleString('en-IN')} Cr`,
      },
    ],
    table: {
      title: '📅 Year-by-Year Cash Flow Projection',
      headers: [
        'Year',
        'Revenue',
        'EBITDA%',
        'FCF (approx)',
        'Discount Factor',
        'PV of FCF',
      ],
      rows: tableRows,
    },
    assumptions: [
      {
        k: 'FCF conversion factor',
        v: '0.60 approximates: ~30% tax rate → 70% net income, ~85–90% EBITDA-to-cash-conversion, minus normalised maintenance capex. A full DCF would use explicit capex and working capital schedules.',
      },
      {
        k: 'Terminal growth rate',
        v: `${tgr}% — approximates long-run India nominal GDP growth. Should not exceed WACC; using TGR > 6% for India mid-cap creates unrealistic terminal values.`,
      },
      {
        k: 'WACC',
        v: `${wacc}% — typical India mid-cap energy sector cost of capital. Adjust upward for smaller/unlisted companies (+2–3%) or higher regulatory risk (+1–2%).`,
      },
      {
        k: 'Synergy realisation',
        v: 'Revenue synergies: only 30% realised in NPV calculation (conservative; synergies rarely fully materialise). Cost synergies: 100% (procurement savings are more predictable).',
      },
    ],
    sources: [
      {
        name: 'DCF Model (Internal)',
        color: 'var(--gold2)',
        note: 'DealNector calculator',
      },
      {
        name: 'WACC Benchmark',
        color: 'var(--cyan2)',
        note: 'India energy sector cost of capital — Damodaran Country Risk Premium',
      },
      {
        name: 'Strategic Synergy Framework',
        color: 'var(--purple)',
        note: 'Synergy NPV methodology from M&A from A to Z',
      },
    ],
    notes: [
      {
        type: 'warn',
        k: 'Sensitivity',
        v: 'DCF is highly sensitive to WACC and TGR. A 1% change in WACC changes EV by ~10–15%. Always run bear/base/bull scenarios before committing to a bid.',
      },
      {
        type: 'note',
        k: 'Complement with',
        v: 'Always triangulate DCF with: (1) Comparable transaction multiples, (2) Listed peer EV/EBITDA, (3) Asset replacement cost. No single method should drive the bid price.',
      },
    ],
  }
}

// ── Dashboard KPI ──────────────────────────────────
export function wkDashboardKPI(
  title: string,
  value: string,
  formula: string,
  steps: WorkingStep[],
  sources: WorkingSource[],
  notes?: WorkingNote[]
): WorkingDef {
  return {
    icon: '📊',
    title,
    subtitle: 'Dashboard metric — formula and data source',
    result: value,
    resultLabel: title,
    formula,
    steps,
    sources,
    notes,
  }
}

// ── Value Driver ───────────────────────────────────
export function wkValueDriver(
  name: string,
  score: number,
  desc: string,
  context: string,
  method: string
): WorkingDef {
  return {
    icon: '⭐',
    title: `Value Driver: ${name}`,
    subtitle:
      'Strategic Analysis value driver scoring methodology',
    result: `${score}/10`,
    resultLabel: 'Driver Score',
    resultNote:
      score >= 8
        ? '🟢 Strong driver — supports premium multiple'
        : score >= 6
          ? '🟡 Moderate — market-rate multiple'
          : score >= 4
            ? '🟠 Below average — discount to market'
            : '🔴 Weak driver — significant multiple headwind',
    formula: `Score 1–10 based on:\n• Quantitative inputs (where available)\n• Sector benchmarking vs. India energy peers\n• Strategic Analysis framework weighting`,
    steps: [
      { label: 'Driver description', calc: desc },
      { label: 'India sector context', calc: context },
      { label: 'Scoring method', calc: method },
    ],
    sources: [
      {
        name: 'Strategic Analysis Framework',
        color: 'var(--gold2)',
        note: 'theoretical framework',
      },
      {
        name: 'India sector data',
        color: 'var(--cyan2)',
        note: 'MNRE, CRISIL, BNEF, JMK Research',
      },
    ],
    notes: [
      {
        type: 'note',
        k: 'Relative score',
        v: 'Score is relative within the India solar/T&D universe covered by DealNector. A score of 8 means this driver is strong relative to Indian mid-cap energy sector peers.',
      },
    ],
  }
}

// ── Acquisition Flag ───────────────────────────────
export function wkAcqFlag(flag: string, rea: string): WorkingDef {
  const meanings: Record<string, string> = {
    'STRONG BUY':
      'Score ≥8: Immediate acquisition priority. Initiate EOTB analysis, engage advisors, approach management.',
    CONSIDER:
      'Score 6–7: Compelling at right valuation. Monitor for price correction entry or minority stake opportunity.',
    MONITOR:
      'Score 4–5: Watch for strategic development. Not immediately actionable but could become so.',
    PASS: 'Score <4 or structurally unacquirable (PSU, foreign MNC, size-prohibitive).',
    PREMIUM:
      'Strategically valuable but currently too expensive. Consider small stake only; await market correction.',
  }
  return {
    icon: '🚦',
    title: `Acquisition Flag: ${flag}`,
    subtitle:
      'DealNector acquisition recommendation — based on Strategic Analysis score + India sector context',
    result: flag,
    resultLabel: 'Acquisition Status',
    formula: `Flag = f(Acquisition Score, Acquirability, Current Valuation)\n\nSTRONG BUY: Score ≥8 AND EV/EBITDA ≤20× AND acquirable\nCONSIDER:   Score 6–7 AND reasonable valuation\nMONITOR:    Score 4–5 OR elevated valuation\nPASS:        Score <4 OR PSU/MNC/size-prohibitive\nPREMIUM:    High score but expensive — strategic stake only`,
    steps: [
      { label: 'Flag meaning', calc: meanings[flag] || flag },
      {
        label: 'Strategic rationale',
        calc: rea || 'See acquisition rationale in company profile',
      },
      {
        label: 'Action implication',
        calc:
          flag === 'STRONG BUY'
            ? 'Initiate formal acquisition process: assemble team, conduct EOTB analysis, engage financial advisor, approach management discreetly'
            : flag === 'CONSIDER'
              ? 'Initiate strategic monitoring. Commission preliminary valuation. Explore 5–15% strategic stake at current market price.'
              : flag === 'MONITOR'
                ? 'Add to watchlist. Review quarterly. Trigger point: valuation dips to <15× EV/EBITDA or strategic event.'
                : 'No immediate action. Review annually or if strategic landscape changes significantly.',
      },
    ],
    sources: [
      {
        name: 'DealNector Scoring Model',
        color: 'var(--gold2)',
        note: 'Strategic 7-driver framework',
      },
      {
        name: 'NSE/BSE Valuation Data',
        color: 'var(--blue)',
        note: 'live multiples',
      },
      {
        name: 'Sector Analysis',
        color: 'var(--cyan2)',
        note: 'India energy M&A context',
      },
    ],
  }
}

// ── Market Cap ─────────────────────────────────────
export function wkMktCap(co: Company): WorkingDef {
  return {
    icon: '🏛',
    title: `Market Capitalisation — ${co.name}`,
    subtitle:
      'Total equity value of outstanding shares at current market price',
    result:
      co.mktcap > 0 ? `₹${co.mktcap.toLocaleString('en-IN')} Cr` : 'Private (Unlisted)',
    resultLabel: 'Market Cap',
    resultNote:
      co.mktcap > 0
        ? co.mktcap >= 50000
          ? '⚠ Large-cap — size prohibitive for full acquisition'
          : co.mktcap >= 10000
            ? '🟡 Mid-cap — strategic stake acquisition feasible'
            : co.mktcap >= 2000
              ? '✅ Small-cap — full buyout realistically achievable'
              : '✅ Micro-cap — optimal acquisition target size'
        : 'Private entity — valuation requires independent appraisal',
    benchmark:
      'India mid-cap buyout sweet spot: ₹500Cr – ₹10,000Cr  |  Mega-cap (>₹50,000Cr): partnership/JV only',
    formula: `Market Cap = Current Share Price × Total Shares Outstanding\n\nFor acquisition sizing:\n  Acquisition Premium  = Market Cap × (1 + Premium%)\n  Typical premium      = 20–40% over trailing 3-month avg\n  Minimum offer price  = SEBI: highest of (i) 60-day VWAP, (ii) highest acquisition price paid`,
    steps: [
      {
        label: 'Exchange data',
        calc: `Listed on: ${co.nse ? 'NSE (' + co.nse + ')' : ''} — trailing 3-month average used`,
        result: `₹${co.mktcap > 0 ? co.mktcap.toLocaleString('en-IN') : 'N/A'}Cr`,
      },
      {
        label: 'Acquisition premium estimate',
        calc: `At 25% premium: ₹${co.mktcap > 0 ? Math.round(co.mktcap * 1.25).toLocaleString('en-IN') : 'N/A'}Cr\nAt 35% premium: ₹${co.mktcap > 0 ? Math.round(co.mktcap * 1.35).toLocaleString('en-IN') : 'N/A'}Cr`,
      },
      {
        label: 'SEBI open offer rule',
        calc: `Acquisition of ≥25% shares triggers mandatory open offer at SEBI-prescribed minimum price. At current market cap, a 26% stake costs ~₹${co.mktcap > 0 ? Math.round(co.mktcap * 0.26).toLocaleString('en-IN') : 'N/A'}Cr`,
        result: 'Plan around open offer threshold',
      },
      {
        label: 'Total acquisition cost',
        calc: `EV (₹${co.ev > 0 ? co.ev.toLocaleString('en-IN') : 'N/A'}Cr) = Market Cap + Net Debt — this is the true total cost`,
        result: `₹${co.ev > 0 ? co.ev.toLocaleString('en-IN') : 'N/A'}Cr`,
      },
    ],
    sources: [
      {
        name: 'NSE/BSE Market Data',
        color: 'var(--blue)',
        note: 'live share price × shares outstanding',
      },
      {
        name: 'SEBI LODR Regulations',
        color: 'var(--red)',
        note: 'open offer threshold rules',
      },
      {
        name: 'Screener.in',
        color: 'var(--cyan2)',
        note: 'market cap history',
      },
    ],
    notes: [
      {
        type: 'warn',
        k: 'SEBI Takeover Code',
        v: `Under SEBI (Substantial Acquisition of Shares and Takeovers) Regulations 2011, acquiring ≥25% in a listed company triggers a mandatory open offer for an additional 26% at a SEBI-prescribed minimum price. Budget for the open offer cost in total deal sizing.`,
      },
      {
        type: 'note',
        k: 'Float vs total',
        v: 'Market cap = total shares × price. Free-float market cap (only publicly traded shares) can be significantly lower for promoter-heavy companies. Check promoter holding % before estimating acquisition cost.',
      },
    ],
  }
}

// ── EBITDA (absolute) ──────────────────────────────
export function wkEBITDA(co: Company): WorkingDef {
  const ebitda = co.ebitda
  return {
    icon: '💹',
    title: `EBITDA — ${co.name}`,
    subtitle:
      'Earnings before interest, tax, depreciation & amortisation — core cash flow proxy',
    result: `₹${ebitda.toLocaleString('en-IN')} Cr`,
    resultLabel: 'EBITDA',
    resultNote: `Margin: ${co.ebm}% — ${co.ebm >= 16 ? 'Premium' : co.ebm >= 11 ? 'Strong' : 'Below average'} vs India ${co.sec} sector`,
    benchmark: `India sector EBITDA medians — Solar modules: 10–14% · Power transformers: 12–18% · Smart meters: 14–20% · Cables: 8–13%`,
    formula: `EBITDA = Revenue − Cost of Goods Sold − SG&A Expenses\n       = Operating Profit + Depreciation + Amortisation\n\nEBITDA Margin = EBITDA / Revenue × 100`,
    steps: [
      { label: 'Revenue', result: `₹${co.rev.toLocaleString('en-IN')} Cr` },
      { label: 'EBITDA Margin (from P&L)', result: `${co.ebm}%` },
      {
        label: 'EBITDA = Revenue × Margin',
        calc: `₹${co.rev.toLocaleString('en-IN')} Cr × ${co.ebm}%`,
        result: `₹${ebitda.toLocaleString('en-IN')} Cr`,
      },
      {
        label: 'EV/EBITDA multiple at current EV',
        calc: `₹${co.ev > 0 ? co.ev.toLocaleString('en-IN') : 'N/A'}Cr ÷ ₹${ebitda.toLocaleString('en-IN')} Cr`,
        result: `${co.ev_eb > 0 ? co.ev_eb + '×' : 'N/A'}`,
      },
      {
        label: 'EBITDA @ acquisition bid (est)',
        calc: `If acquired at ₹${co.ev > 0 ? Math.round(co.ev * 1.25).toLocaleString('en-IN') : 'N/A'}Cr (25% premium) → EV/EBITDA = ${co.ev_eb > 0 ? (co.ev_eb * 1.25).toFixed(1) + '×' : 'N/A'}`,
        result: 'Ensure bid ≤ 20× EBITDA for accretive deal',
      },
    ],
    assumptions: [
      {
        k: 'Reported vs normalised',
        v: `This uses reported EBITDA. For promoter-owned private companies, normalised EBITDA (removing personal expenses, family payroll) can be 10–25% higher. Strategic Analysis recommends "recasting" financials for 3 years before presenting to buyers.`,
      },
      {
        k: 'Maintenance capex',
        v: 'EBITDA overstates free cash flow — subtract estimated maintenance capex (~5–8% of revenue for manufacturing) to arrive at true free cash flow for DCF.',
      },
    ],
    sources: [
      { name: 'Annual Report P&L', color: 'var(--blue)', note: 'reported EBITDA' },
      {
        name: 'Screener.in',
        color: 'var(--cyan2)',
        note: '5-year EBITDA trend',
      },
    ],
  }
}

// ── Chain Market Size ──────────────────────────────
export function wkChainMarketSize(c: ChainNode): WorkingDef {
  return {
    icon: '🌍',
    title: `Market Size — ${c.name}`,
    subtitle: `India + Global addressable market sizing for ${c.cat}`,
    result: c.mkt.ig,
    resultLabel: 'India Market Size (FY2024 est.)',
    resultNote: `India CAGR: ${c.mkt.icagr} · Status: ${c.mkt.ist?.substring(0, 80)}`,
    benchmark: `Global market: ${c.mkt.gg} at ${c.mkt.gcagr} CAGR · Dominant suppliers: ${c.mkt.gc}`,
    formula: `India TAM (Top-Down):\n  Policy target capacity × ₹/MW unit value\n  e.g. 50GW/yr module demand × ₹20Cr/MW = ₹1,00,000Cr\n\nIndia TAM (Bottom-Up):\n  SECI/DISCOM annual tender volume × avg unit price × domestic content %\n\nGlobal TAM:\n  IEA/BNEF total installed capacity additions × ₹/MW blended global ASP`,
    steps: [
      {
        label: 'India market basis',
        calc:
          c.mkt.ist ||
          'Based on government policy targets and current procurement data',
      },
      {
        label: 'India sizing',
        calc: `₹ estimate derived from: MNRE capacity addition targets + SECI tender pipeline + RDSS scheme rollout (for T&D)`,
        result: c.mkt.ig,
      },
      {
        label: 'India CAGR drivers',
        calc: `${c.mkt.icagr} growth driven by NSM 500GW target, RDSS ₹3.03L Cr scheme, BCD protection, PLI incentives, PM Surya Ghar rooftop push`,
        result: `${c.mkt.icagr} CAGR to 2030`,
      },
      {
        label: 'Global market sizing',
        calc: c.mkt.gc,
        result: c.mkt.gg,
      },
      {
        label: 'India vs Global share',
        calc: `India currently ~${c.mkt.ig} of ${c.mkt.gg} global → India share growing as domestic manufacturing scales up`,
      },
    ],
    assumptions: [
      {
        k: 'India market figures',
        v: `Estimated from: MNRE annual report, SECI empanelment data, RDSS MIS dashboard, and analyst consensus (CRISIL, Bridge to India, JMK Research, IEEFA). ±25–30% error range is standard for India energy market sizing.`,
      },
      {
        k: 'Global figures',
        v: 'Sourced from BNEF New Energy Outlook, IEA World Energy Investment Report, Wood Mackenzie, and GlobalData sector reports. Global figures use USD converted at ₹84/USD.',
      },
      {
        k: 'Growth assumptions',
        v: `CAGR assumes policy targets are met. India's track record shows 60–80% target achievement. Bear case: apply 20–30% downward revision to stated CAGR.`,
      },
    ],
    sources: [
      {
        name: 'MNRE Annual Report',
        color: 'var(--green)',
        note: 'India capacity targets & installation data',
      },
      {
        name: 'SECI Tender Database',
        color: 'var(--blue)',
        note: 'live project pipeline',
      },
      {
        name: 'RDSS MIS Portal',
        color: 'var(--cyan2)',
        note: 'smart meter rollout progress',
      },
      {
        name: 'BNEF New Energy Outlook',
        color: 'var(--gold2)',
        note: 'global market sizing',
      },
      {
        name: 'JMK Research',
        color: 'var(--orange)',
        note: 'India solar sector estimates',
      },
      {
        name: 'CRISIL / ICRA',
        color: 'var(--purple)',
        note: 'India T&D sector sizing',
      },
    ],
    notes: [
      {
        type: 'warn',
        k: 'Disclaimer',
        v: 'All market size figures are third-party estimates as of FY2024–25. Actual development subject to: DISCOM payment risks, policy implementation timing, raw material price volatility, and financing availability for projects.',
      },
      {
        type: 'note',
        k: 'Competitive dynamics',
        v: `Global leaders: ${c.mkt.gc}. India domestic industry faces import competition despite BCD protection. Chinese players can still compete at 40% BCD + 25% cell BCD due to cost structures 30–40% below India domestic manufacturing.`,
      },
    ],
  }
}

// ── Compare Metric ─────────────────────────────────
interface CompareMetricDef {
  icon: string
  title: string
  desc: string
  formula: string
  benchmark: string
  note: string
}

export function wkCompareMetric(metric: string): WorkingDef | null {
  const metricDefs: Record<string, CompareMetricDef> = {
    'EV/EBITDA': {
      icon: '📊',
      title: 'EV/EBITDA — Comparison Metric',
      desc: 'Enterprise Value to EBITDA multiple. Lower = cheaper acquisition. Best-in-column is highlighted.',
      formula: 'EV / EBITDA = (Market Cap + Net Debt) / (Revenue × EBITDA%)',
      benchmark:
        'Ideal: ≤15× · Fair: 15–25× · Expensive: >25× · India energy avg: ~22×',
      note: "This metric is capital-structure neutral — preferred over P/E for acquisition analysis because it is not affected by the target's existing debt level.",
    },
    'EBITDA%': {
      icon: '💹',
      title: 'EBITDA Margin — Comparison Metric',
      desc: 'EBITDA as % of revenue. Higher = more profitable, less pricing pressure.',
      formula: 'EBITDA Margin = EBITDA / Revenue × 100',
      benchmark:
        'Solar modules: 10–16% · Smart meters: 14–20% · Power transformers: 12–18% · Cables: 8–13%',
      note: 'Best-in-column highlighted green. A 5% margin difference compounds significantly at acquisition scale — e.g. on ₹2,000Cr revenue, 15% vs 10% margin = ₹100Cr annual EBITDA difference → ₹1,500Cr EV difference at 15× multiple.',
    },
    'Revenue Growth%': {
      icon: '📈',
      title: 'Revenue Growth — Comparison Metric',
      desc: '3-year revenue CAGR. Strategic Analysis: #1 determinant of deal multiples.',
      formula: 'CAGR = (Revenue_n / Revenue_0)^(1/n) − 1 × 100',
      benchmark: `High growth (>25%): 15–22× multiple · Medium (12–25%): 10–15× · Low (<12%): 7–10×`,
      note: 'The best-in-column winner here commands the highest acquisition premium. A target growing at 35%+ can justify paying 18–22× EV/EBITDA even if current absolute margins are only moderate.',
    },
    'D/E Ratio': {
      icon: '⚖',
      title: 'Debt/Equity — Comparison Metric',
      desc: 'Financial leverage. Lower = better acquisition quality. Debt is inherited by buyer in share purchase.',
      formula: 'D/E = Total Financial Debt / Total Shareholders Equity',
      benchmark:
        'Debt-free: 0 (ideal) · Conservative: ≤0.3 · Moderate: 0.3–0.7 · Elevated: >1.0',
      note: 'Best-in-column = lowest D/E = least leverage risk. In a share purchase, the buyer inherits all debt. At D/E > 1.0, senior lenders demand immediate refinancing at close — adds cost and execution risk.',
    },
    'Acq Score': {
      icon: '🎯',
      title: 'Acquisition Score — Comparison Metric',
      desc: "DealNector multi-factor score (1–10) based on 7 strategic value drivers.",
      formula:
        'Weighted average of: Growth (25%) + Market Share (20%) + Barriers (15%) + Management (15%) + Cash Flow (10%) + Concentration risk (10%) + Tech risk (5%)',
      benchmark:
        'Score 9–10: STRONG BUY · 7–8: STRONG BUY/CONSIDER · 5–6: MONITOR · <5: PASS',
      note: 'Best-in-column = highest score = most compelling acquisition target in this comparison. This is a relative ranking within the India solar/T&D universe.',
    },
    'P/E Ratio': {
      icon: '💰',
      title: 'P/E Ratio — Comparison Metric',
      desc: 'Market price / earnings per share. Lower = cheaper on earnings basis.',
      formula: 'P/E = Market Cap / PAT (Profit After Tax)',
      benchmark:
        'India energy sector: 18–80× · Value zone: <25× · Growth premium: 40–80×',
      note: 'P/E is sensitive to debt structure and tax rates. EV/EBITDA is more reliable for acquisition comparison. Use P/E as a secondary confirmation metric only.',
    },
  }
  const def = metricDefs[metric]
  if (!def) return null
  return {
    icon: def.icon,
    title: def.title,
    subtitle: 'Compare table — understanding this metric for acquisition analysis',
    formula: `${def.formula}\n\nBenchmark: ${def.benchmark}`,
    steps: [
      { label: 'What this measures', calc: def.desc },
      {
        label: 'How to read the table',
        calc: 'Green highlight = best-in-column for this metric. Best is defined as: lowest for EV metrics (cheaper valuation), highest for growth/margin/score metrics.',
      },
      { label: 'Acquisition implication', calc: def.note },
    ],
    sources: [
      {
        name: 'NSE/BSE Financials',
        color: 'var(--blue)',
        note: 'source data for all metrics',
      },
      {
        name: 'Screener.in',
        color: 'var(--cyan2)',
        note: 'ratio calculations',
      },
      {
        name: 'Strategic Analysis Framework',
        color: 'var(--gold2)',
        note: 'acquisition scoring methodology',
      },
    ],
  }
}

// ── WACC ───────────────────────────────────────────
export function wkWACC(wacc: number = 12): WorkingDef {
  const betaVal = wacc <= 11 ? 0.85 : 1.05
  const costEquity = 7.2 + betaVal * 5.5 + 1.8
  const blendedWacc = 0.7 * costEquity + 0.3 * 7.9
  return {
    icon: '📉',
    title: 'WACC — Weighted Average Cost of Capital',
    subtitle:
      'The discount rate applied to future cash flows — most sensitive DCF input',
    result: `${wacc}%`,
    resultLabel: 'WACC (Discount Rate)',
    resultNote:
      wacc <= 10
        ? '🟢 Aggressive (≤10%) — inflates DCF value'
        : wacc <= 13
          ? '✅ Base case (10–13%) — India mid-cap energy sector norm'
          : wacc <= 16
            ? '🟡 Conservative (13–16%) — reflects additional risk premium'
            : '🔴 High (>16%) — for distressed or high-risk targets',
    benchmark:
      'India risk-free rate: ~7.2% (10yr G-Sec)  |  Equity risk premium: ~5.5%  |  Size premium: 1.5–3%  |  Total WACC: 10–14% typical',
    formula: `WACC = (E/V × Re) + (D/V × Rd × (1 − Tc))\n\nwhere:\n  E = Equity market value\n  D = Debt market value  \n  V = E + D (Total capital)\n  Re = Cost of equity (CAPM)\n  Rd = Pre-tax cost of debt\n  Tc = Corporate tax rate (~25% India)\n\nCost of Equity (CAPM):\n  Re = Rf + β × (Rm − Rf) + Country Risk Premium\n     = Risk-free rate + Beta × Market risk premium + CRP`,
    steps: [
      {
        label: 'Risk-free rate (Rf)',
        calc: 'India 10-year Government Securities yield',
        result: '~7.2%',
      },
      {
        label: 'Equity risk premium (Rm−Rf)',
        calc: 'Historical India market premium over G-Sec (Damodaran Country Risk model)',
        result: '~5.5%',
      },
      {
        label: 'Beta (β)',
        calc: `Industry beta for India energy/manufacturing sector. Unlevered beta ~0.75, relevered for target capital structure. For ${wacc <= 11 ? 'low leverage' : 'moderate leverage'} target: β ≈ ${betaVal}`,
        result: `β ≈ ${betaVal}`,
      },
      {
        label: 'Country Risk Premium (CRP)',
        calc: 'India-specific sovereign risk premium (Damodaran)',
        result: '~1.5–2.0%',
      },
      {
        label: 'Cost of Equity',
        calc: `7.2% + ${betaVal} × 5.5% + 1.8% = ${costEquity.toFixed(1)}%`,
        result: `${costEquity.toFixed(1)}%`,
      },
      {
        label: 'Cost of Debt (post-tax)',
        calc: `India acquisition debt: 10.5% pre-tax × (1 − 25% tax) = 7.9%`,
        result: '~7.9%',
      },
      {
        label: 'Blended WACC',
        calc: `At 70/30 equity/debt split: (70% × ${costEquity.toFixed(1)}%) + (30% × 7.9%) = ${blendedWacc.toFixed(1)}%`,
        result: `~${blendedWacc.toFixed(0)}%`,
      },
    ],
    table: {
      title: '📊 WACC Sensitivity — Impact on DCF Enterprise Value',
      headers: ['WACC', 'EV Impact vs Base', 'Interpretation'],
      rows: [
        ['8%', '+35–45% vs base', 'Over-optimistic — use only for best-case scenario'],
        ['10%', '+15–20% vs base', 'Aggressive — low interest rate assumption'],
        ['12%', 'Base case', '✅ India mid-cap energy sector norm'],
        ['14%', '−12–15% vs base', 'Conservative — appropriate for elevated risk targets'],
        ['16%', '−20–25% vs base', 'High risk — distressed or highly leveraged target'],
        ['18%', '−30–35% vs base', 'Turnaround — use for PASS/heavy restructuring cases'],
      ],
    },
    assumptions: [
      {
        k: 'Sensitivity warning',
        v: `A 1% change in WACC changes DCF enterprise value by ~8–12%. This is the single most important assumption in the entire DCF model. Always run at least 3 scenarios (bear/base/bull WACC).`,
      },
      {
        k: 'India vs global',
        v: 'India WACC is higher than developed market equivalents (US: 7–9%) due to higher inflation, sovereign risk, and FX risk. Using a developed-market WACC for India acquisitions will significantly overvalue the target.',
      },
    ],
    sources: [
      {
        name: 'Damodaran Country Risk Premium',
        color: 'var(--gold2)',
        note: 'annual.update. India ERP + CRP',
      },
      {
        name: 'RBI 10-yr G-Sec yield',
        color: 'var(--blue)',
        note: 'risk-free rate',
      },
      {
        name: 'NSE Sector Beta Database',
        color: 'var(--cyan2)',
        note: 'industry beta estimates',
      },
    ],
  }
}

// ── Terminal Value ─────────────────────────────────
export function wkTerminalValue(
  tgr: number = 4,
  wacc: number = 12,
  yrs: number = 7
): WorkingDef {
  return {
    icon: '♾',
    title: 'Terminal Value — Gordon Growth Model',
    subtitle:
      'Value of all cash flows beyond the explicit forecast period — typically 60–80% of total DCF',
    result: `TGR: ${tgr}%`,
    resultLabel: 'Terminal Growth Rate',
    resultNote:
      tgr <= 3
        ? '🟢 Conservative (≤3%) — in line with long-run India CPI'
        : tgr <= 5
          ? '✅ Moderate (3–5%) — India nominal GDP growth'
          : tgr >= 7
            ? '🔴 Aggressive (≥7%) — unsustainable, inflates valuation'
            : '🟡 Acceptable (5–7%) — high-growth phase tapering assumption',
    benchmark: `India long-run nominal GDP growth: 6–7%  |  India CPI inflation: 4–5%  |  Terminal growth should NOT exceed WACC (${wacc}%)`,
    formula: `Terminal Value (Gordon Growth):\n  TV = FCF_{n+1} / (WACC − TGR)\n     = FCF_n × (1 + TGR) / (WACC − TGR)\n\nPV of Terminal Value:\n  PV(TV) = TV / (1 + WACC)^n\n\nShare of total DCF:\n  Typically 60–80% of enterprise value\n  (the lower the TGR, the less the terminal value dominates)`,
    steps: [
      {
        label: `Terminal year (Year ${yrs}) FCF`,
        calc: `FCF_${yrs} from projection (based on revenue × EBITDA margin × 0.60 conversion)`,
      },
      {
        label: 'Terminal FCF (Year n+1)',
        calc: `FCF_${yrs} × (1 + ${tgr}%) — one more year of growth before perpetuity`,
        result: `FCF_${yrs} × ${(1 + tgr / 100).toFixed(3)}`,
      },
      {
        label: 'Capitalisation rate',
        calc: `WACC − TGR = ${wacc}% − ${tgr}% = ${(wacc - tgr).toFixed(1)}%`,
        result: `${(wacc - tgr).toFixed(1)}%`,
      },
      {
        label: 'Terminal Value (at Year n)',
        calc: `FCF_{${yrs}+1} ÷ ${(wacc - tgr).toFixed(1)}%`,
        result: `= FCF_{n+1} × ${(100 / (wacc - tgr)).toFixed(1)}×`,
      },
      {
        label: 'PV of Terminal Value',
        calc: `Terminal Value ÷ (1 + ${wacc}%)^${yrs}`,
        result: 'Discounted back to today',
      },
    ],
    table: {
      title: '📊 Terminal Growth Rate Sensitivity',
      headers: ['TGR', 'Cap Rate (WACC−TGR)', 'TV Multiple', 'Risk Level'],
      rows: [
        ['2%', `${wacc - 2}%`, `${(100 / (wacc - 2)).toFixed(1)}×`, '🟢 Conservative'],
        ['3%', `${wacc - 3}%`, `${(100 / (wacc - 3)).toFixed(1)}×`, '🟢 Conservative'],
        [
          `${tgr}% (current)`,
          `${(wacc - tgr).toFixed(1)}%`,
          `${(100 / (wacc - tgr)).toFixed(1)}×`,
          '✅ Base case',
        ],
        [
          '5%',
          `${wacc - 5}%`,
          `${(100 / (wacc - 5)).toFixed(1)}×`,
          wacc - 5 <= 6 ? '🟠 Elevated' : '🟡 Acceptable',
        ],
        [
          '7%',
          `${wacc - 7}%`,
          `${(100 / (wacc - 7)).toFixed(1)}×`,
          wacc - 7 <= 3 ? '🔴 Dangerous' : '🟠 Elevated',
        ],
      ],
    },
    assumptions: [
      {
        k: 'Rule of thumb',
        v: `Terminal growth rate should always be ≤ long-run nominal GDP growth of the economy. For India: ≤7% nominal. Using TGR > WACC causes the formula to break (division by zero or negative).`,
      },
      {
        k: 'Strategic guidance',
        v: `"Internet bubble entrepreneurs assumed their company's growth rate would forever exceed that of the U.S. economy — yielding sizable yet unrealistic valuations." Use conservative TGR; challenge any assumption above 5% for a manufacturing company.`,
      },
    ],
    sources: [
      {
        name: 'Strategic Analysis Framework',
        color: 'var(--gold2)',
        note: 'DCF methodology',
      },
      {
        name: 'Damodaran Valuation',
        color: 'var(--blue)',
        note: 'terminal value best practices',
      },
      {
        name: 'RBI Inflation Data',
        color: 'var(--green)',
        note: 'India inflation baseline',
      },
    ],
  }
}

// ── Synergy NPV ────────────────────────────────────
export function wkSynergyNPV(
  rs: number = 0,
  cs: number = 0,
  ic: number = 0
): WorkingDef {
  const synNPV = (rs * 0.3 + cs) * 7 - ic
  return {
    icon: '🔗',
    title: 'Synergy NPV — Post-Closing Value Creation',
    subtitle:
      'Net present value of post-acquisition synergies minus integration costs',
    result: `₹${Math.round(synNPV).toLocaleString('en-IN')} Cr`,
    resultLabel: 'Synergy NPV',
    resultNote:
      synNPV > 0
        ? `✅ Positive synergy NPV — acquisition creates incremental value beyond standalone`
        : `⚠ Negative synergy NPV — integration costs exceed synergy benefits at these estimates`,
    benchmark:
      'Industry benchmark: good acquisitions generate synergy NPV = 15–25% of deal EV  |  Poor deals: synergies never materialise (80% failure rate — Strategic Analysis)',
    formula: `Synergy NPV = Revenue Synergy Value + Cost Synergy Value − Integration Costs\n\nRevenue Synergy Value  = Annual Rev Synergy × Realisation% × Multiple\nCost Synergy Value     = Annual Cost Synergy × Multiple\nIntegration Cost       = One-time investment to achieve synergies\n\nMultiple (7×) approximates PV of perpetual annuity at 14% discount rate\nRealisation rate (30%) reflects typical actual vs projected revenue synergy capture`,
    steps: [
      {
        label: 'Revenue Synergy Input',
        calc: `₹${rs}Cr per year (cross-sell, combined distribution, new markets)`,
        result: `₹${rs}Cr/yr stated`,
      },
      {
        label: 'Revenue Synergy realisation',
        calc: `Apply 30% realisation rate — Strategic Analysis: revenue synergies are notoriously hard to capture. 70% typically never materialise. ₹${rs}Cr × 30% = ₹${Math.round(rs * 0.3)}Cr/yr realised`,
        result: `₹${Math.round(rs * 0.3)}Cr/yr`,
      },
      {
        label: 'Revenue Synergy NPV',
        calc: `₹${Math.round(rs * 0.3)}Cr/yr × 7× perpetuity multiple = ₹${Math.round(rs * 0.3 * 7)}Cr`,
        result: `₹${Math.round(rs * 0.3 * 7)}Cr`,
      },
      {
        label: 'Cost Synergy Input',
        calc: `₹${cs}Cr per year (procurement consolidation, SG&A, headcount)`,
        result: `₹${cs}Cr/yr`,
      },
      {
        label: 'Cost Synergy — 100% realisation',
        calc: `Cost synergies are more predictable than revenue. Apply 100% realisation. ₹${cs}Cr/yr × 7× = ₹${Math.round(cs * 7)}Cr`,
        result: `₹${Math.round(cs * 7)}Cr`,
      },
      {
        label: 'Integration Cost (one-time)',
        calc: `Systems migration, redundancy costs, rebranding, legal, advisor fees`,
        result: `−₹${ic}Cr`,
      },
      {
        label: 'Net Synergy NPV',
        calc: `₹${Math.round(rs * 0.3 * 7)}Cr + ₹${Math.round(cs * 7)}Cr − ₹${ic}Cr`,
        result: `₹${Math.round(synNPV)}Cr`,
      },
    ],
    assumptions: [
      {
        k: 'Revenue synergy realisation: 30%',
        v: `Strategic Analysis: "The quest for synergy can be deceptive, especially if there is inadequate communication between buyer and seller." Industry data shows revenue synergies realise at 25–40% of projected. Cost synergies are more reliable at 70–90% realisation.`,
      },
      {
        k: '7× perpetuity multiple',
        v: `Approximates PV of a £1/yr annuity at 14.3% discount rate (= 1/0.143 = 7.0×). For a more rigorous calculation, use the company-specific WACC from the DCF model.`,
      },
      {
        k: 'Integration costs',
        v: `Typically 3–8% of deal EV for a well-planned integration. For India mid-market deals: expect ₹20–60Cr for a ₹500–1,000Cr acquisition. Includes: IT systems, HR alignment, legal/compliance, external advisors, and one-time restructuring.`,
      },
    ],
    sources: [
      {
        name: 'Strategic Analysis Framework',
        color: 'var(--gold2)',
        note: 'synergy NPV methodology',
      },
      {
        name: 'Institutional M&A Research',
        color: 'var(--blue)',
        note: 'synergy realisation rates',
      },
      {
        name: 'PricewaterhouseCoopers',
        color: 'var(--cyan2)',
        note: 'integration cost benchmarks',
      },
    ],
    notes: [
      {
        type: 'warn',
        k: '80% failure rate',
        v: `Strategic research cites that M&A transactions fail to create post-closing value at an estimated 80% rate. The primary reason: synergies are projected optimistically pre-deal and then poorly managed post-close. Never pay more than standalone value based on synergy projections alone.`,
      },
      {
        type: 'note',
        k: 'Synergy bridge',
        v: 'The gap between your standalone bid and synergy-adjusted bid (i.e. this NPV figure) represents value that will only be created if integration is well executed. Plan integration before close, not after.',
      },
    ],
  }
}

// ── Critical Priority ──────────────────────────────
export function wkCriticalPriority(chain: ChainNode[]): WorkingDef {
  const crits = chain.filter((c) => c.flag === 'critical')
  return {
    icon: '🔴',
    title: 'Critical Priority Nodes — Flag Methodology',
    subtitle:
      'How DealNector determines which value chain segments require urgent attention',
    result: crits.length + ' nodes',
    resultLabel: 'Critical Priority Count',
    resultNote:
      'These segments represent the highest strategic acquisition priority in the India solar/T&D value chain',
    benchmark:
      'Critical = supply concentrated + domestic gap + direct policy mandate — all three conditions must be met',
    formula: `A value chain node receives CRITICAL flag when ALL of:
  1. Global supply concentration > 70% (single country or 2 players)
  2. India domestic production < 20% of demand
  3. Direct government policy mandate (PLI, ALMM, RDSS, BCD protection)

HIGH = 2 of 3 conditions · MEDIUM = 1 of 3 · CRITICAL drives highest acquisition urgency`,
    steps: crits.map((c) => ({
      label: c.name,
      calc: `Cat: ${c.cat} | Global leader: ${c.mkt?.gc?.substring(0, 60) || 'N/A'} | India status: ${c.mkt?.ist?.substring(0, 80) || 'N/A'}`,
      result: 'CRITICAL',
    })),
    sources: [
      {
        name: 'MNRE/MoP Policy Documents',
        color: 'var(--green)',
        note: 'PLI, ALMM, RDSS mandates',
      },
      {
        name: 'DealNector Component Analysis',
        color: 'var(--cyan2)',
        note: 'supply concentration assessment',
      },
      {
        name: 'BNEF / JMK Research',
        color: 'var(--gold2)',
        note: 'domestic vs import market share data',
      },
    ],
    notes: [
      {
        type: 'note',
        k: 'Action implication',
        v: "CRITICAL nodes are where India's energy security is most exposed. An acquirer who owns a CRITICAL node has structural advantage in the domestic supply chain — these are the highest-value strategic acquisition targets.",
      },
    ],
  }
}

// ── Value Driver by Index ──────────────────────────
interface ValueDriverInfo {
  name: string
  weight: number
  desc: string
  context: string
  method: string
  threshold: string
}

const VALUE_DRIVERS: ValueDriverInfo[] = [
  {
    name: 'Revenue Growth Rate (3-yr CAGR)',
    weight: 5,
    desc: 'Strategic Analysis: #1 determinant of deal multiples per regression analysis',
    context:
      'India solar module demand growing 35%+ YoY through 2027. RDSS scheme driving ₹3.03L Cr smart meter rollout. PLI-backed domestic cell/module capacity addition accelerating.',
    method:
      'Score 1–10 based on: <10% CAGR=3, 10–20%=5, 20–30%=7, >30%=9. Adjusted up for acceleration trend, down for declining markets.',
    threshold: '<10% = 6–8× · 15–25% = 10–14× · >30% = 15–22× EV/EBITDA',
  },
  {
    name: 'Market Share / Niche Strength',
    weight: 4,
    desc: 'A recognized market leader commands significant multiple premium',
    context:
      'India PV glass: Borosil near-monopoly (80%+ share). Smart meters: Genus, HPL, AESL dominate. Power transformers: Crompton, TRIL, Indo Tech in top tier.',
    method:
      'Score 1–10: Clear market leader=9, Top-3 position=7, Niche player=5, Commodity supplier=3.',
    threshold: 'Niche leader = +2–4× premium on EBITDA multiple',
  },
  {
    name: 'Barriers to Entry',
    weight: 4,
    desc: 'Structural barriers that competitors cannot easily replicate',
    context:
      'BCD 40% on modules + 25% on cells creates import barrier. ALMM listing takes 12–18 months. RDSS allocation is PSU-led, not open market.',
    method:
      'Score 1–10: Regulatory moat (ALMM/PLI)=9, Capital intensity=7, Brand/relationships=5, Low barriers=3.',
    threshold: 'Regulatory moat = most durable barrier in India energy',
  },
  {
    name: 'Management Team Depth',
    weight: 4,
    desc: 'Bench strength that survives promoter exit is rare and valuable',
    context:
      'Most Indian mid-cap manufacturers are promoter-led. Institutional management (ex-Waaree, RenewSys) commands premium. Key account relationships with SECI/DISCOMs must be transferable.',
    method:
      'Score 1–10: Institutional management team=9, Mixed=6, Fully promoter-dependent=3.',
    threshold: 'Institutional management = +15–20% on acquisition valuation',
  },
  {
    name: 'Cash Flow Stability',
    weight: 3,
    desc: 'Predictable, growing, low-capital-intensity cash flow commands highest multiples',
    context:
      'Smart meter manufacturers: RDSS-backed government offtake is near-certain. Module makers: spot market exposure creates volatility. Transformer makers: 12–18 month order book visibility.',
    method:
      'Score 1–10: >80% contracted revenue=9, 50–80% contracted=7, Spot market dependent=4.',
    threshold: 'Contracted CF >80% = DCF certainty premium',
  },
  {
    name: 'Customer Concentration Risk (inverted)',
    weight: 3,
    desc: 'No customer >30% revenue. No supplier >40% of key inputs.',
    context:
      'Silver paste: 2 Chinese suppliers control 80% of global supply. Polysilicon: Daqo/Tongwei control 45%+. Domestic transformer buyers: SEB orders can be cancelled/deferred.',
    method:
      'Score 1–10: No single customer >15%=9, Largest customer 15–30%=6, Single customer >40%=2.',
    threshold: '>30% single customer = negative 1–2× multiple adjustment',
  },
  {
    name: 'Technology Obsolescence Risk (inverted)',
    weight: 2,
    desc: 'Current technology must have at least 7–10 year commercial horizon',
    context:
      'P-type PERC: peak demand reached, TOPCon market share accelerating past 70%. Smart meters: AMI 2.0 replacing older GPRS systems. Power transformers: EV grid driving new specs.',
    method:
      'Score 1–10: Current-gen technology (TOPCon/AMI 2.0)=9, Transitional=6, Obsolete (P-type PERC only)=3.',
    threshold: 'Technology behind market = 20–30% DCF haircut',
  },
]

export function wkValueDriverByIndex(idx: number): WorkingDef | null {
  const d = VALUE_DRIVERS[idx]
  if (!d) return null
  return {
    icon: '⭐',
    title: 'Value Driver: ' + d.name,
    subtitle:
      'Strategic Analysis value driver scoring methodology (weight: ' +
      d.weight +
      '/5 stars)',
    result: '★'.repeat(d.weight) + '☆'.repeat(5 - d.weight),
    resultLabel: 'Weighting',
    resultNote: d.threshold,
    benchmark:
      'Strategic Analysis: "The #1 determinant of deal multiples is the growth rate of the business"',
    formula:
      'Score 1–10 per driver × Weight → Weighted sum → Normalise to 1–10 acquisition score\n\nWeights: Growth 25% · Market Share 20% · Barriers 15% · Management 15% · Cash Flow 10% · Concentration 10% · Tech Risk 5%',
    steps: [
      { label: 'What this driver measures', calc: d.desc },
      { label: 'India sector context', calc: d.context },
      { label: 'Scoring method', calc: d.method },
      { label: 'Multiple impact', calc: d.threshold },
    ],
    sources: [
      {
        name: 'Strategic Analysis Framework',
        color: 'var(--gold2)',
        note: 'theoretical 7-driver framework',
      },
      {
        name: 'India sector data',
        color: 'var(--cyan2)',
        note: 'MNRE, CRISIL, BNEF, JMK Research',
      },
      {
        name: 'DealNector analysis',
        color: 'var(--green)',
        note: 'India solar/T&D sector application',
      },
    ],
  }
}

// ── Convenience: wkByMetric ────────────────────────
export type WkMetric =
  | 'ev_eb'
  | 'pe'
  | 'revg'
  | 'dbt_eq'
  | 'acqs'
  | 'ebm'
  | 'mktcap'
  | 'ebitda'

export function wkByMetric(co: Company, metric: WkMetric): WorkingDef {
  switch (metric) {
    case 'ev_eb':
      return wkEVEBITDA(co)
    case 'pe':
      return wkPE(co)
    case 'revg':
      return wkRevGrowth(co)
    case 'dbt_eq':
      return wkDebtEquity(co)
    case 'acqs':
      return wkAcqScore(co)
    case 'ebm':
      return wkEBITDAMargin(co)
    case 'mktcap':
      return wkMktCap(co)
    case 'ebitda':
      return wkEBITDA(co)
  }
}

// ── News-adjusted wrappers ────────────────────────────
//
// Thin wrappers around wkEVEBITDA / wkAcqScore that accept a pre/post
// metrics snapshot (from `computeAdjustedMetrics`) and rewrite the
// popup to show both values side-by-side. Use these whenever the
// calling page has news acknowledgments in play for the company.

function prePostBanner(
  pre: number,
  post: number,
  unit: '×' | '/10' | '%',
  ackedCount: number
): string {
  const fmtV = (v: number) =>
    unit === '×'
      ? v.toFixed(2) + '×'
      : unit === '/10'
        ? v.toFixed(1) + '/10'
        : v.toFixed(1) + '%'
  const delta = pre === 0 ? 0 : ((post - pre) / pre) * 100
  const sign = delta > 0 ? '+' : ''
  if (delta === 0) return `Pre-news: ${fmtV(pre)} (no acknowledged news)`
  return `Pre-news ${fmtV(pre)} → Post-news ${fmtV(post)} (${sign}${delta.toFixed(2)}% · ${ackedCount} acknowledged)`
}

function injectPrePostBanner(
  def: WorkingDef,
  pre: number,
  post: number,
  unit: '×' | '/10' | '%',
  ackedCount: number,
  metricLabel: string
): WorkingDef {
  const bannerNote: WorkingNote = {
    type: 'note',
    k: `News impact on ${metricLabel}`,
    v: prePostBanner(pre, post, unit, ackedCount),
  }
  // Keep the headline showing the POST-news value when any news is acked,
  // with the pre value echoed in resultNote so the user sees both.
  if (ackedCount > 0 && post !== pre) {
    const fmtV = (v: number) =>
      unit === '×'
        ? v.toFixed(2) + '×'
        : unit === '/10'
          ? v.toFixed(1) + '/10'
          : v.toFixed(1) + '%'
    const delta = pre === 0 ? 0 : ((post - pre) / pre) * 100
    const sign = delta > 0 ? '+' : ''
    return {
      ...def,
      result: fmtV(post),
      resultLabel: `${def.resultLabel || metricLabel} (news-adjusted)`,
      resultNote: `Pre-news baseline: ${fmtV(pre)} · Δ ${sign}${delta.toFixed(2)}% from ${ackedCount} acknowledged ${ackedCount === 1 ? 'item' : 'items'}`,
      notes: [bannerNote, ...(def.notes || [])],
    }
  }
  // No acked news — render the plain pre value but still surface the
  // banner so the user knows the news system is inactive for this company.
  return {
    ...def,
    notes: [bannerNote, ...(def.notes || [])],
  }
}

/**
 * EV/EBITDA popup with optional news adjustment. Falls back to the
 * base popup when no adjustment is supplied.
 */
export function wkEVEBITDAWithNews(
  co: Company,
  adjusted: CompanyAdjustedMetrics
): WorkingDef {
  const def = wkEVEBITDA(co)
  return injectPrePostBanner(
    def,
    adjusted.pre.ev_eb,
    adjusted.post.ev_eb,
    '×',
    adjusted.acknowledgedCount,
    'EV/EBITDA'
  )
}

/**
 * Acquisition Score popup with optional news adjustment.
 */
export function wkAcqScoreWithNews(
  co: Company,
  adjusted: CompanyAdjustedMetrics
): WorkingDef {
  const def = wkAcqScore(co)
  return injectPrePostBanner(
    def,
    adjusted.pre.acqs,
    adjusted.post.acqs,
    '/10',
    adjusted.acknowledgedCount,
    'Acquisition Score'
  )
}

// ─────────────────────────────────────────────────────
//  LIVE-CALCULATION AUDIT POPUPS
//  These take a full DerivedMetrics bundle so every
//  displayed number comes with its provenance
//  (baseline vs live, formula, scaling factor, refresh
//  timestamp). Use these from tables / cards where the
//  click should open a full audit trail instead of the
//  legacy "show the static co.ev_eb" popup.
// ─────────────────────────────────────────────────────

function fmtTimestamp(iso: string | null): string {
  if (!iso) return 'never refreshed — showing curated baseline'
  try {
    return new Date(iso).toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

/** EV audit — shows baseline, live, and the mktcap-scaling step. */
export function wkEVAudit(metrics: DerivedMetrics): WorkingDef {
  const { audit, hasLiveData, scalingFactor, company: co, updatedAt } = metrics
  const ev = audit.ev
  const mc = audit.mktcap
  const changePct =
    mc.baseline > 0 && mc.live != null
      ? ((mc.live - mc.baseline) / mc.baseline) * 100
      : 0

  const steps: WorkingStep[] = [
    {
      label: 'Baseline Market Cap (curated snapshot)',
      calc: 'From src/lib/data/companies.ts — editorial baseline used before any live refresh',
      result: `₹${fmt(mc.baseline)}Cr`,
    },
    {
      label: 'Live Market Cap (RapidAPI)',
      calc:
        mc.source === 'live'
          ? 'keyMetrics.priceandVolume → marketCap · in ₹Cr'
          : 'no live snapshot yet',
      result: mc.live != null ? `₹${fmt(mc.live)}Cr` : '—',
    },
    {
      label: 'Market Cap Scaling Factor',
      calc: `Live ÷ Baseline = ${mc.live != null ? mc.live.toLocaleString('en-IN') : '—'} ÷ ${mc.baseline.toLocaleString('en-IN')}`,
      result: `${scalingFactor.toFixed(3)}× (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)`,
    },
    {
      label: 'Baseline EV / Market Cap Ratio',
      calc: `${co.ev > 0 && co.mktcap > 0 ? (audit.ev.baseline / audit.mktcap.baseline).toFixed(3) : '—'} — captures the baseline net-debt relationship (editorial)`,
      result: audit.mktcap.baseline > 0
        ? `${(audit.ev.baseline / audit.mktcap.baseline).toFixed(3)}`
        : '—',
    },
    {
      label: 'Derived Live EV',
      calc: `Live Market Cap × Baseline EV/MktCap Ratio = ₹${fmt(mc.live ?? 0)}Cr × ${audit.mktcap.baseline > 0 ? (audit.ev.baseline / audit.mktcap.baseline).toFixed(3) : '—'}`,
      result: `₹${fmt(ev.live)}Cr`,
    },
  ]

  const notes: WorkingNote[] = [
    {
      type: 'note',
      k: 'Why we scale instead of using the live netDebt field',
      v: 'The RapidAPI netDebtLFY field ships in inconsistent units across companies — some in ₹Cr, some in ₹Lakhs, some nullable. Scaling the baseline EV by the live market-cap change preserves the editorially-correct net-debt relationship without trusting a field whose unit we cannot verify per-company.',
    },
    {
      type: 'note',
      k: 'Refresh status',
      v: `${hasLiveData ? '✓ Live data applied' : '○ No live snapshot — showing baseline'} · ${fmtTimestamp(updatedAt)}`,
    },
  ]

  return {
    icon: '💼',
    title: `Enterprise Value — ${co.name}`,
    subtitle: 'Full calculation audit with live-data provenance',
    result: `₹${fmt(ev.live)}Cr`,
    resultLabel: 'Enterprise Value',
    resultNote: hasLiveData
      ? `Derived from live RapidAPI market cap (${fmtTimestamp(updatedAt)})`
      : 'Curated baseline — click Refresh Live Data to pull fresh figures',
    benchmark: `Baseline was ₹${fmt(ev.baseline)}Cr · now ₹${fmt(ev.live)}Cr (${ev.live >= ev.baseline ? '+' : ''}${(((ev.live - ev.baseline) / Math.max(1, ev.baseline)) * 100).toFixed(1)}%)`,
    formula:
      'Live EV = Live Market Cap × (Baseline EV ÷ Baseline Market Cap)\n\nThe ratio captures the baseline net-debt relationship. We deliberately do NOT derive EV from Live Market Cap + Live Net Debt because the upstream netDebt field has inconsistent units across companies.',
    steps,
    notes,
    sources: [
      { name: 'RapidAPI Indian Stock Exchange', color: 'var(--gold2)', note: 'live market cap' },
      { name: 'Curated baseline', color: 'var(--cyan2)', note: 'src/lib/data/companies.ts' },
    ],
  }
}

/** EV/EBITDA audit — derives from live EV and curated EBITDA. */
export function wkEVEBITDAAudit(metrics: DerivedMetrics): WorkingDef {
  const { audit, hasLiveData, company: co, updatedAt } = metrics
  const ev = audit.ev
  const evEb = audit.ev_eb
  const ebitdaCr = evEb.ebitdaCr

  const steps: WorkingStep[] = [
    {
      label: 'Revenue (curated annual report)',
      calc: 'Trailing 12m / most recent annual filing',
      result: `₹${fmt(co.rev)}Cr`,
    },
    {
      label: 'EBITDA Margin (curated)',
      calc: 'From annual report consolidated P&L',
      result: `${co.ebm}%`,
    },
    {
      label: 'Implied EBITDA',
      calc: `Revenue × EBITDA Margin = ₹${fmt(co.rev)}Cr × ${co.ebm}%`,
      result: `₹${fmt(ebitdaCr)}Cr`,
    },
    {
      label: 'Live EV (from EV audit)',
      calc: `Live Market Cap scaled by baseline EV/MktCap ratio`,
      result: `₹${fmt(ev.live)}Cr`,
    },
    {
      label: 'Live EV/EBITDA Multiple',
      calc: `₹${fmt(ev.live)}Cr ÷ ₹${fmt(ebitdaCr)}Cr`,
      result: `${evEb.live.toFixed(1)}×`,
    },
  ]

  const notes: WorkingNote[] = [
    {
      type: 'note',
      k: 'EBITDA source',
      v: 'We deliberately use the curated annual-report EBITDA (not the RapidAPI eBITDPerShareTrailing12Month) because the upstream value was inconsistent in unit testing. Once the API schema is stable we will switch to a live-reported TTM EBITDA for companies that have it.',
    },
    {
      type: 'note',
      k: 'Refresh status',
      v: `${hasLiveData ? '✓ Live EV applied' : '○ No live snapshot'} · ${fmtTimestamp(updatedAt)}`,
    },
  ]

  return {
    icon: '📊',
    title: `EV/EBITDA — ${co.name}`,
    subtitle: 'Full calculation audit',
    result: `${evEb.live.toFixed(1)}×`,
    resultLabel: 'EV / EBITDA Multiple',
    resultNote:
      evEb.live <= 15
        ? '✅ Attractive (≤15×)'
        : evEb.live <= 25
          ? '🟡 Fair value (15–25×)'
          : evEb.live <= 35
            ? '🟠 Elevated (25–35×)'
            : '🔴 Expensive (>35×)',
    benchmark: `Baseline was ${evEb.baseline.toFixed(1)}× · now ${evEb.live.toFixed(1)}×`,
    formula: 'Live EV / Curated EBITDA\n\nwhere:\n  Live EV     = Live Market Cap × (Baseline EV ÷ Baseline Market Cap)\n  EBITDA      = Revenue × EBITDA Margin % (from annual report)',
    steps,
    notes,
    sources: [
      { name: 'RapidAPI Indian Stock Exchange', color: 'var(--gold2)', note: 'live market cap' },
      { name: 'Annual Reports (BSE/NSE)', color: 'var(--cyan2)', note: 'revenue + margin' },
    ],
  }
}

/** Acquisition Score audit — shows every driver + weight + contribution. */
export function wkAcqScoreAudit(metrics: DerivedMetrics): WorkingDef {
  const { audit, hasLiveData, company: co, updatedAt } = metrics
  const score = audit.acqs

  const driverRows = score.drivers.map((d) => [
    d.name,
    `${d.rawScore}/10`,
    `${(d.weight * 100).toFixed(0)}%`,
    d.contribution.toFixed(2),
    d.rationale,
  ])
  driverRows.push([
    'TOTAL WEIGHTED SCORE',
    '—',
    '100%',
    score.weightedTotal.toFixed(2),
    `Normalised to ${score.live}/10`,
  ])

  return {
    icon: '🎯',
    title: `Acquisition Score — ${co.name}`,
    subtitle: 'Recomputed from the 7 Strategic Analysis drivers on post-refresh metrics',
    result: `${score.live}/10`,
    resultLabel: 'Post-Refresh Acquisition Score',
    resultNote:
      score.live >= 9
        ? '⭐ STRONG BUY'
        : score.live >= 7
          ? '✅ CONSIDER'
          : score.live >= 5
            ? '🟡 MONITOR'
            : '⚪ PASS',
    benchmark: `Baseline (curated) was ${score.baseline}/10 · now ${score.live}/10`,
    formula:
      'Weighted sum of seven drivers, each scored 1–10 from objective thresholds on the post-refresh Company row:\n\n  25% Revenue Growth\n  20% EBITDA Margin\n  15% Valuation (EV/EBITDA, inverted)\n  15% Balance Sheet (D/E, inverted)\n  10% Sector Tailwind\n  10% Acquirability / Size (inverted)\n   5% P/E Attractiveness (inverted)\n\nNo driver self-references the score — the breakdown is truly analytical.',
    table: {
      title: '📋 Driver-by-Driver (live metrics)',
      headers: ['Driver', 'Raw', 'Weight', 'Contribution', 'Basis'],
      rows: driverRows,
    },
    steps: [
      {
        label: 'Pull post-refresh Company row',
        calc: hasLiveData
          ? 'Uses live market cap + derived EV + derived EV/EBITDA'
          : 'No live data yet — uses curated baseline metrics',
      },
      {
        label: 'Score each driver from objective thresholds',
        calc: 'Revenue growth, margin, D/E, EV/EBITDA, sector, size, P/E — no circular self-reference',
      },
      {
        label: 'Weighted sum',
        calc: `Σ (raw_i × weight_i) = ${score.weightedTotal.toFixed(2)}`,
        result: `${score.weightedTotal.toFixed(2)} / 10`,
      },
      {
        label: 'Round and clamp to [1, 10]',
        calc: `round(${score.weightedTotal.toFixed(2)}) → ${score.live}`,
        result: `${score.live}/10`,
      },
    ],
    notes: [
      {
        type: 'note',
        k: 'Refresh status',
        v: `${hasLiveData ? '✓ Live metrics applied' : '○ Baseline only'} · ${fmtTimestamp(updatedAt)}`,
      },
      {
        type: 'note',
        k: 'Why this differs from the curated score',
        v: `The curated baseline score (${score.baseline}/10) was hand-assigned at onboarding for strategic readability. The live score (${score.live}/10) is mechanically derived from the current metrics and will move as the market moves.`,
      },
    ],
    sources: [
      { name: 'Live-derived metrics', color: 'var(--gold2)', note: 'from deriveLiveMetrics()' },
      { name: 'Strategic Analysis framework', color: 'var(--cyan2)', note: '7-driver weighted model' },
    ],
  }
}
