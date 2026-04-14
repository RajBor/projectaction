/**
 * Calculation-trace library — produces an auditable list of every
 * number the report displays, with its formula, inputs, source and
 * conceptual explanation.
 *
 * Design: this file does NOT re-compute anything from scratch. It
 * takes the already-computed valuation outputs (DcfResult, PeerStats,
 * ComparableResult[], BookValueResult, FootballFieldBar[], the news
 * aggregate, and the raw Company object) and returns a flat list of
 * CalcTraceEntry objects. The Report Builder's Calculations tab
 * renders this list as an audit table so analysts can verify every
 * figure that appears in the HTML report or PDF.
 */

import type { Company } from '@/lib/data/companies'
import type {
  DcfResult,
  ComparableResult,
  BookValueResult,
  FootballFieldBar,
} from './methods'
import type { PeerStats, PeerSet } from './peers'
import type { FinancialHistory } from './history'
import type { CompanyNewsAggregate } from '@/lib/news/impact'
import type { CompanyAdjustedMetrics } from '@/lib/news/adjustments'
import { formatInrCr } from '@/lib/format'

// ─── Types ────────────────────────────────────────────────────

export type TraceSection =
  | 'Inputs'
  | 'Financial History'
  | 'DCF'
  | 'Comparables'
  | 'Book Value'
  | 'Peers'
  | 'Football Field'
  | 'News Impact'
  | 'Synergy'
  | 'Sensitivity'
  | 'Concentration'
  | 'Conclusion'

export type TraceSource =
  | 'Company snapshot (COMPANIES array)'
  | 'Live NSE/BSE'
  | 'Screener.in multi-year'
  | 'RapidAPI multi-year'
  | 'Peer median (computed)'
  | 'Computed (formula applied)'
  | 'User assumption'
  | 'Default assumption'
  | 'News aggregation'

export interface CalcInput {
  name: string
  value: string
}

export interface CalcTraceEntry {
  id: string
  section: TraceSection
  metric: string
  /** Display-formatted value ("₹5,210 Cr", "14.7×", "7.0%"). */
  value: string
  /** Raw numeric value — for sortable/filterable audit. */
  valueRaw: number | null
  /** The formula as text. Multi-line allowed. */
  formula: string
  /** Named inputs with their values. */
  inputs: CalcInput[]
  /** Where the numbers came from. */
  source: TraceSource
  /** Short conceptual explanation (1–2 sentences). */
  concept: string
  /** Optional caveats or methodology notes. */
  notes?: string
}

// ─── Formatters ───────────────────────────────────────────────

const cr = (n: number | null | undefined): string =>
  n == null || !Number.isFinite(n) ? '—' : formatInrCr(n)
const pct = (n: number | null | undefined, d = 1): string =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(d)}%`
const mult = (n: number | null | undefined, d = 1): string =>
  n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(d)}×`
const ratio = (n: number | null | undefined, d = 2): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toFixed(d)
const num = (n: number | null | undefined, d = 0): string =>
  n == null || !Number.isFinite(n) ? '—' : n.toLocaleString('en-IN', {
    maximumFractionDigits: d,
  })

// ─── Builder ──────────────────────────────────────────────────

export interface TraceBuilderInput {
  subject: Company
  history: FinancialHistory
  peerSet: PeerSet
  peers: PeerStats
  dcf: DcfResult
  comps: ComparableResult[]
  bv: BookValueResult
  football: FootballFieldBar[]
  newsAgg: CompanyNewsAggregate | null
  adjusted: CompanyAdjustedMetrics
  synergyInputs: {
    synRevPct: number
    synCostPct: number
    integrationCostPct: number
  }
  hhi: { hhi: number; risk: string; totalMktcapCr: number; topShare: number | null }
}

export function buildCalcTrace(input: TraceBuilderInput): CalcTraceEntry[] {
  const entries: CalcTraceEntry[] = []
  const { subject: s, peers, dcf, comps, bv, football, newsAgg, adjusted, synergyInputs, hhi, history } = input

  // ── Inputs (raw subject snapshot) ────────────────────────────
  entries.push({
    id: 'inp.rev',
    section: 'Inputs',
    metric: 'TTM Revenue',
    value: cr(s.rev),
    valueRaw: s.rev,
    formula: 'Company.rev (trailing-twelve-month sales, ₹Cr)',
    inputs: [{ name: 'Company.rev', value: cr(s.rev) }],
    source: 'Company snapshot (COMPANIES array)',
    concept:
      'Top-line revenue over the last twelve months — base for DCF revenue projection and comparable EV/Sales.',
  })

  entries.push({
    id: 'inp.ebitda',
    section: 'Inputs',
    metric: 'TTM EBITDA',
    value: cr(s.ebitda),
    valueRaw: s.ebitda,
    formula: s.ebitda > 0 ? 'Company.ebitda' : 'Revenue × EBITDA Margin %',
    inputs: [
      { name: 'Company.ebitda', value: cr(s.ebitda) },
      { name: 'Revenue', value: cr(s.rev) },
      { name: 'EBITDA Margin %', value: pct(s.ebm) },
    ],
    source: 'Company snapshot (COMPANIES array)',
    concept:
      'Earnings before interest, tax, depreciation and amortization — proxy for cash-generating operating profitability.',
    notes: s.ebitda <= 0 ? 'Snapshot EBITDA was missing — derived from rev × ebm%.' : undefined,
  })

  entries.push({
    id: 'inp.mktcap',
    section: 'Inputs',
    metric: 'Market Cap',
    value: cr(s.mktcap),
    valueRaw: s.mktcap,
    formula: 'Last close price × Shares outstanding',
    inputs: [{ name: 'Company.mktcap', value: cr(s.mktcap) }],
    source: 'Live NSE/BSE',
    concept: 'Market value of equity — the benchmark vs. intrinsic value.',
  })

  entries.push({
    id: 'inp.ev',
    section: 'Inputs',
    metric: 'Enterprise Value',
    value: cr(s.ev),
    valueRaw: s.ev,
    formula: 'MktCap + Total Debt − Cash',
    inputs: [
      { name: 'MktCap', value: cr(s.mktcap) },
      { name: 'Company.ev', value: cr(s.ev) },
    ],
    source: 'Company snapshot (COMPANIES array)',
    concept:
      'Theoretical takeover price — the amount needed to acquire the whole company free of existing net debt.',
  })

  const netDebt = s.ev > 0 && s.mktcap > 0 ? s.ev - s.mktcap : 0
  entries.push({
    id: 'inp.netdebt',
    section: 'Inputs',
    metric: 'Net Debt',
    value: cr(netDebt),
    valueRaw: netDebt,
    formula: 'EV − Market Cap',
    inputs: [
      { name: 'EV', value: cr(s.ev) },
      { name: 'MktCap', value: cr(s.mktcap) },
    ],
    source: 'Computed (formula applied)',
    concept:
      'Debt minus cash. Negative means the company is net cash-rich, which adds to equity value in DCF / comparables.',
    notes:
      netDebt < 0
        ? 'Net-cash position detected — equity value = EV − (negative net debt) adds cash back.'
        : undefined,
  })

  entries.push({
    id: 'inp.evebitda',
    section: 'Inputs',
    metric: 'Current EV / EBITDA',
    value: mult(s.ev_eb),
    valueRaw: s.ev_eb,
    formula: 'EV ÷ EBITDA',
    inputs: [
      { name: 'EV', value: cr(s.ev) },
      { name: 'EBITDA', value: cr(s.ebitda) },
    ],
    source: 'Company snapshot (COMPANIES array)',
    concept:
      'Primary acquisition valuation multiple — how many years of EBITDA a buyer would be paying for the company.',
  })

  entries.push({
    id: 'inp.pe',
    section: 'Inputs',
    metric: 'Current P/E',
    value: mult(s.pe),
    valueRaw: s.pe,
    formula: 'MktCap ÷ Net Profit',
    inputs: [
      { name: 'MktCap', value: cr(s.mktcap) },
      { name: 'PAT', value: cr(s.pat) },
    ],
    source: 'Company snapshot (COMPANIES array)',
    concept: 'Years of earnings required to pay back the equity investment.',
  })

  // ── Financial history CAGRs ──────────────────────────────────
  entries.push({
    id: 'hist.revcagr',
    section: 'Financial History',
    metric: 'Revenue CAGR',
    value: pct(history.cagrs.revenueCagrPct),
    valueRaw: history.cagrs.revenueCagrPct,
    formula: '(Revenue(newest) ÷ Revenue(oldest)) ^ (1/n) − 1',
    inputs: [
      { name: 'Years in history', value: String(history.yearsOfHistory) },
      { name: 'Source', value: history.source },
    ],
    source:
      history.source === 'rapidapi'
        ? 'RapidAPI multi-year'
        : history.source === 'manual'
          ? 'User assumption'
          : 'Company snapshot (COMPANIES array)',
    concept:
      'Compound annual growth rate of revenue across the full history window — used as the DEFAULT starting growth input for DCF when available.',
    notes:
      history.yearsOfHistory < 3
        ? 'Fewer than 3 years of history — CAGR may be noisy; DCF falls back to Company.revg.'
        : undefined,
  })

  entries.push({
    id: 'hist.ebitdacagr',
    section: 'Financial History',
    metric: 'EBITDA CAGR',
    value: pct(history.cagrs.ebitdaCagrPct),
    valueRaw: history.cagrs.ebitdaCagrPct,
    formula: '(EBITDA(newest) ÷ EBITDA(oldest)) ^ (1/n) − 1',
    inputs: [{ name: 'Years in history', value: String(history.yearsOfHistory) }],
    source:
      history.source === 'rapidapi'
        ? 'RapidAPI multi-year'
        : 'Company snapshot (COMPANIES array)',
    concept: 'Compound annual growth rate of operating profit — operating leverage check vs. revenue CAGR.',
  })

  entries.push({
    id: 'hist.nicagr',
    section: 'Financial History',
    metric: 'Net Income CAGR',
    value: pct(history.cagrs.netIncomeCagrPct),
    valueRaw: history.cagrs.netIncomeCagrPct,
    formula: '(NetIncome(newest) ÷ NetIncome(oldest)) ^ (1/n) − 1',
    inputs: [{ name: 'Years in history', value: String(history.yearsOfHistory) }],
    source:
      history.source === 'rapidapi'
        ? 'RapidAPI multi-year'
        : 'Company snapshot (COMPANIES array)',
    concept: 'Compound annual growth rate of bottom-line profits.',
  })

  // ── DCF assumptions & outputs ────────────────────────────────
  const a = dcf.assumptions
  entries.push({
    id: 'dcf.wacc',
    section: 'DCF',
    metric: 'WACC',
    value: pct(a.wacc * 100, 2),
    valueRaw: a.wacc * 100,
    formula: 'Default: 11.5% for solar, 12.0% for T&D (sector proxy)',
    inputs: [{ name: 'Sector', value: s.sec }],
    source: 'Default assumption',
    concept:
      'Weighted average cost of capital — blended required return of equity and debt providers. Discount rate for all future free cash flows.',
    notes:
      'User can override in FSA page → DCF tab. Range for Indian industrials: 10–14%.',
  })

  entries.push({
    id: 'dcf.startg',
    section: 'DCF',
    metric: 'Starting Revenue Growth',
    value: pct(a.startingGrowth * 100),
    valueRaw: a.startingGrowth * 100,
    formula: 'min(35%, max(3%, historical CAGR or Company.revg))',
    inputs: [
      { name: 'Revenue CAGR', value: pct(history.cagrs.revenueCagrPct) },
      { name: 'Company.revg', value: pct(s.revg) },
    ],
    source: 'Default assumption',
    concept:
      'Year-1 revenue growth — decays linearly to Ending Growth over the forecast horizon.',
  })

  entries.push({
    id: 'dcf.endg',
    section: 'DCF',
    metric: 'Ending Revenue Growth',
    value: pct(a.endingGrowth * 100),
    valueRaw: a.endingGrowth * 100,
    formula: 'min(startingGrowth, 8%)',
    inputs: [
      { name: 'startingGrowth', value: pct(a.startingGrowth * 100) },
    ],
    source: 'Default assumption',
    concept:
      'Terminal-year revenue growth — caps at 8% to enforce mature-stage fade.',
  })

  entries.push({
    id: 'dcf.tgr',
    section: 'DCF',
    metric: 'Terminal Growth Rate',
    value: pct(a.terminalGrowth * 100, 2),
    valueRaw: a.terminalGrowth * 100,
    formula: 'Default 4.5% (clamped to WACC − 0.5% if higher)',
    inputs: [{ name: 'WACC', value: pct(a.wacc * 100, 2) }],
    source: 'Default assumption',
    concept:
      'Perpetuity growth for terminal-value calculation — must be strictly below WACC to avoid divergent Gordon growth.',
  })

  entries.push({
    id: 'dcf.startm',
    section: 'DCF',
    metric: 'Starting EBITDA Margin',
    value: pct(a.startingEbitdaMargin * 100),
    valueRaw: a.startingEbitdaMargin * 100,
    formula: 'min(40%, max(4%, Company.ebm))',
    inputs: [{ name: 'Company.ebm', value: pct(s.ebm) }],
    source: 'Default assumption',
    concept: 'Year-1 EBITDA margin — decays to Terminal Margin.',
  })

  entries.push({
    id: 'dcf.sumpv',
    section: 'DCF',
    metric: 'Σ PV of explicit FCFs (Yr 1-5)',
    value: cr(dcf.sumPvFcf),
    valueRaw: dcf.sumPvFcf,
    formula: 'Σ [ FCFₜ ÷ (1 + WACC)ᵗ ]  for t = 1…N',
    inputs: dcf.rows.map((r) => ({
      name: `Y${r.year} FCF / df=${r.discountFactor}`,
      value: `${cr(r.fcf)} / ${r.discountFactor} = ${cr(r.pvFcf)}`,
    })),
    source: 'Computed (formula applied)',
    concept:
      'Present value of explicit forecast-period free cash flows. Each year-t FCF is discounted back to today at (1 + WACC)^t.',
  })

  entries.push({
    id: 'dcf.tv',
    section: 'DCF',
    metric: 'Terminal Value (Gordon growth)',
    value: cr(dcf.terminalValue),
    valueRaw: dcf.terminalValue,
    formula: 'FCF_N × (1 + g) ÷ (WACC − g)',
    inputs: [
      { name: 'FCF at Y-N', value: cr(dcf.rows[dcf.rows.length - 1]?.fcf ?? null) },
      { name: 'Terminal growth (g)', value: pct(a.terminalGrowth * 100, 2) },
      { name: 'WACC', value: pct(a.wacc * 100, 2) },
    ],
    source: 'Computed (formula applied)',
    concept:
      'Gordon growth model — value of all cash flows beyond the explicit forecast horizon, assumed to grow at g forever.',
  })

  entries.push({
    id: 'dcf.pvtv',
    section: 'DCF',
    metric: 'PV of Terminal Value',
    value: cr(dcf.pvTerminalValue),
    valueRaw: dcf.pvTerminalValue,
    formula: 'TV ÷ (1 + WACC)^N',
    inputs: [
      { name: 'Terminal Value', value: cr(dcf.terminalValue) },
      { name: 'N (years)', value: String(a.years) },
      { name: 'WACC', value: pct(a.wacc * 100, 2) },
    ],
    source: 'Computed (formula applied)',
    concept: 'Terminal value discounted back to today.',
    notes:
      dcf.enterpriseValue > 0
        ? `TV is ${((dcf.pvTerminalValue / dcf.enterpriseValue) * 100).toFixed(0)}% of Enterprise Value — above 80% means valuation hinges heavily on terminal assumptions.`
        : undefined,
  })

  entries.push({
    id: 'dcf.ev',
    section: 'DCF',
    metric: 'DCF Enterprise Value',
    value: cr(dcf.enterpriseValue),
    valueRaw: dcf.enterpriseValue,
    formula: 'ΣPV(FCFs) + PV(Terminal)',
    inputs: [
      { name: 'ΣPV of FCFs', value: cr(dcf.sumPvFcf) },
      { name: 'PV of Terminal', value: cr(dcf.pvTerminalValue) },
    ],
    source: 'Computed (formula applied)',
    concept: 'Total enterprise value implied by the DCF — all operating cash flows in present value.',
  })

  entries.push({
    id: 'dcf.equity',
    section: 'DCF',
    metric: 'DCF Equity Value',
    value: cr(dcf.equityValue),
    valueRaw: dcf.equityValue,
    formula: 'DCF EV − Net Debt  (Net Debt can be negative for net-cash cos.)',
    inputs: [
      { name: 'DCF EV', value: cr(dcf.enterpriseValue) },
      { name: 'Net Debt', value: cr(dcf.netDebt) },
    ],
    source: 'Computed (formula applied)',
    concept:
      'Equity value — what the common shareholders are worth. Subtracts debt; net-cash positions are added back.',
  })

  entries.push({
    id: 'dcf.upside',
    section: 'DCF',
    metric: 'DCF Upside vs. MktCap',
    value: pct(dcf.upsideVsMarketCap),
    valueRaw: dcf.upsideVsMarketCap,
    formula: '(DCF Equity − MktCap) ÷ MktCap × 100',
    inputs: [
      { name: 'DCF Equity', value: cr(dcf.equityValue) },
      { name: 'Current MktCap', value: cr(s.mktcap) },
    ],
    source: 'Computed (formula applied)',
    concept: 'Gap between intrinsic DCF value and current market price.',
  })

  entries.push({
    id: 'dcf.impliedeveb',
    section: 'DCF',
    metric: 'Implied EV/EBITDA (from DCF)',
    value: mult(dcf.impliedEvEbitda),
    valueRaw: dcf.impliedEvEbitda,
    formula: 'DCF EV ÷ TTM EBITDA',
    inputs: [
      { name: 'DCF EV', value: cr(dcf.enterpriseValue) },
      { name: 'TTM EBITDA', value: cr(s.ebitda) },
    ],
    source: 'Computed (formula applied)',
    concept:
      'Multiple the DCF implicitly places on current EBITDA. Compare vs. current trading multiple to sanity-check.',
  })

  // ── Comparables ──────────────────────────────────────────────
  for (const c of comps) {
    entries.push({
      id: `cmp.${c.method.replace(/[^a-z0-9]/gi, '').toLowerCase()}`,
      section: 'Comparables',
      metric: `${c.label} — Equity (median)`,
      value: cr(c.equityMedian),
      valueRaw: c.equityMedian,
      formula:
        c.method === 'P/E'
          ? 'Peer Median P/E × Subject PAT'
          : c.method === 'P/B'
            ? 'Peer Median P/B × (MktCap ÷ P/B)'
            : c.method === 'EV/Sales'
              ? '(Peer Median EV/EBITDA × Peer Median EBITDA%) ÷ 100 × Revenue − Net Debt'
              : 'Peer Median EV/EBITDA × Subject EBITDA − Net Debt',
      inputs: [
        { name: 'Peer Median', value: mult(c.peerMedian) },
        { name: 'Q1 / Q3', value: `${mult(c.peerLow)} / ${mult(c.peerHigh)}` },
        { name: 'Subject base', value: cr(c.subjectBase) },
      ],
      source: 'Peer median (computed)',
      concept: `Apply peer-group median ${c.method} multiple to subject's base metric, bridge from EV to equity via net debt.`,
      notes:
        c.method === 'EV/Sales'
          ? 'EV/Sales is a PROXY, not a direct observation — derived from peer EV/EBITDA × peer EBITDA margin.'
          : c.method === 'P/B'
            ? 'Book value is derived from Subject.mktcap ÷ Subject.pb (no balance-sheet book value in snapshot).'
            : undefined,
    })
  }

  // ── Book Value ───────────────────────────────────────────────
  entries.push({
    id: 'bv.book',
    section: 'Book Value',
    metric: 'Derived Book Value',
    value: cr(bv.bookValue),
    valueRaw: bv.bookValue,
    formula: 'MktCap ÷ P/B',
    inputs: [
      { name: 'MktCap', value: cr(s.mktcap) },
      { name: 'P/B', value: mult(s.pb, 2) },
    ],
    source: 'Computed (formula applied)',
    concept:
      'Proxy for shareholders\u2019 equity — derived from current P/B because the snapshot doesn\u2019t store book value directly.',
    notes:
      'For a more rigorous book value, connect the Screener multi-year balance sheet (totalEquity line).',
  })

  entries.push({
    id: 'bv.equity',
    section: 'Book Value',
    metric: 'Book-Value Equity (with premium)',
    value: cr(bv.equityValue),
    valueRaw: bv.equityValue,
    formula: 'Book × Strategic Premium',
    inputs: [
      { name: 'Book', value: cr(bv.bookValue) },
      { name: 'Premium', value: `${bv.strategicPremium.toFixed(2)}×` },
    ],
    source: 'Computed (formula applied)',
    concept:
      'Liquidation-plus-premium value. Floor valuation for strategic acquirers, not a standalone recommendation.',
  })

  // ── Peers ────────────────────────────────────────────────────
  entries.push({
    id: 'peer.count',
    section: 'Peers',
    metric: 'Peer Set Size',
    value: String(input.peerSet.peers.length),
    valueRaw: input.peerSet.peers.length,
    formula: 'Top-N companies ranked by value-chain segment overlap',
    inputs: input.peerSet.peers.map((p) => ({
      name: p.ticker,
      value: `${p.name} (overlap ${input.peerSet.scores[p.ticker] ?? 0})`,
    })),
    source: 'Computed (formula applied)',
    concept:
      'Peers selected by: (i) # shared value-chain segments × 10, (ii) same sector tiebreaker, (iii) closest market-cap tiebreaker.',
  })

  entries.push({
    id: 'peer.evebitdamedian',
    section: 'Peers',
    metric: 'Peer Median EV/EBITDA',
    value: mult(peers.ev_eb.median),
    valueRaw: peers.ev_eb.median,
    formula: 'Median of peers\u2019 EV/EBITDA (n=' + peers.ev_eb.values.length + ')',
    inputs: peers.ev_eb.values.map((v, i) => ({
      name: `peer[${i + 1}]`,
      value: mult(v),
    })),
    source: 'Peer median (computed)',
    concept:
      'Median used instead of mean because the peer universe is small and long-tailed.',
  })

  entries.push({
    id: 'peer.pemedian',
    section: 'Peers',
    metric: 'Peer Median P/E',
    value: mult(peers.pe.median),
    valueRaw: peers.pe.median,
    formula: 'Median of peers\u2019 P/E',
    inputs: peers.pe.values.map((v, i) => ({
      name: `peer[${i + 1}]`,
      value: mult(v),
    })),
    source: 'Peer median (computed)',
    concept: 'Used for P/E comparable — equity-value lens.',
  })

  entries.push({
    id: 'peer.pctile',
    section: 'Peers',
    metric: 'Subject EV/EBITDA Percentile',
    value: `${peers.ev_eb.subjectPercentile}th`,
    valueRaw: peers.ev_eb.subjectPercentile,
    formula: '# peers with EV/EBITDA ≤ Subject ÷ N × 100',
    inputs: [
      { name: 'Subject EV/EBITDA', value: mult(peers.ev_eb.subject) },
      { name: 'Peer count', value: String(peers.ev_eb.values.length) },
    ],
    source: 'Peer median (computed)',
    concept:
      'Rank within peers: lower percentile = cheaper vs peers (EV/EBITDA is a cost-of-acquisition metric, so low = good).',
  })

  // ── Football Field ───────────────────────────────────────────
  for (const bar of football) {
    entries.push({
      id: `ff.${bar.label.replace(/[^a-z0-9]/gi, '').toLowerCase()}`,
      section: 'Football Field',
      metric: `${bar.label}`,
      value: `${cr(bar.low)} — ${cr(bar.high)}`,
      valueRaw: bar.medianOrMid,
      formula:
        bar.label === 'Current Market Cap'
          ? 'Observed market cap (point estimate)'
          : bar.label.startsWith('DCF')
            ? 'DCF re-run at WACC ±100bps for low/high; base at midpoint'
            : bar.label.startsWith('Book')
              ? 'Book equity × 0.9 / 1.1 for ±10% range'
              : 'Comparable low = Q1 × base; high = Q3 × base; mid = median × base',
      inputs: [
        { name: 'Low', value: cr(bar.low) },
        { name: 'Mid / Median', value: cr(bar.medianOrMid) },
        { name: 'High', value: cr(bar.high) },
      ],
      source: 'Computed (formula applied)',
      concept:
        'Visual range of what the business is worth under different methods. Overlap of ranges = high-confidence value zone.',
    })
  }

  // ── Synergy NPV ──────────────────────────────────────────────
  const rs = s.rev * synergyInputs.synRevPct
  const cs = s.ebitda * synergyInputs.synCostPct
  const ic = s.mktcap * synergyInputs.integrationCostPct
  const synNpv = (rs * 0.3 + cs) * 7 - ic

  entries.push({
    id: 'syn.revsyn',
    section: 'Synergy',
    metric: 'Annual Revenue Synergy (gross)',
    value: cr(rs),
    valueRaw: rs,
    formula: 'Revenue × Revenue Synergy %',
    inputs: [
      { name: 'Revenue', value: cr(s.rev) },
      { name: 'Rev Synergy %', value: pct(synergyInputs.synRevPct * 100) },
    ],
    source: 'User assumption',
    concept: 'Gross annual incremental revenue expected from cross-sell + combined distribution + new markets.',
  })

  entries.push({
    id: 'syn.costsyn',
    section: 'Synergy',
    metric: 'Annual Cost Synergy',
    value: cr(cs),
    valueRaw: cs,
    formula: 'EBITDA × Cost Synergy %',
    inputs: [
      { name: 'EBITDA', value: cr(s.ebitda) },
      { name: 'Cost Synergy %', value: pct(synergyInputs.synCostPct * 100) },
    ],
    source: 'User assumption',
    concept: 'Cost savings from procurement consolidation, headcount reduction, shared services.',
  })

  entries.push({
    id: 'syn.integcost',
    section: 'Synergy',
    metric: 'One-time Integration Cost',
    value: cr(ic),
    valueRaw: ic,
    formula: 'MktCap × Integration Cost %',
    inputs: [
      { name: 'MktCap', value: cr(s.mktcap) },
      { name: 'Integration %', value: pct(synergyInputs.integrationCostPct * 100) },
    ],
    source: 'User assumption',
    concept: 'Upfront cost to achieve synergies: IT systems, legal, severance, advisory fees.',
  })

  entries.push({
    id: 'syn.npv',
    section: 'Synergy',
    metric: 'Synergy NPV',
    value: cr(synNpv),
    valueRaw: synNpv,
    formula: '(Rev Syn × 0.30 + Cost Syn) × 7 − Integration Cost',
    inputs: [
      { name: 'Rev Syn realized (30%)', value: cr(rs * 0.3) },
      { name: 'Cost Syn (100%)', value: cr(cs) },
      { name: '7× perpetuity mult.', value: '7.0' },
      { name: '− Integration', value: cr(-ic) },
    ],
    source: 'Computed (formula applied)',
    concept:
      'Net value created beyond standalone. 30% revenue realisation reflects historical M&A research; 7× ≈ 1 / 14.3% perpetuity discount.',
    notes: 'Industry failure rate: 80% of deals fail to realise projected synergies. Treat as upper-bound.',
  })

  // ── News Impact ──────────────────────────────────────────────
  if (newsAgg && newsAgg.items.length > 0) {
    const revDelta = adjusted.deltaPct?.revg ?? 0
    const ebmDelta = adjusted.deltaPct?.ebm ?? 0
    const multDelta = adjusted.deltaPct?.ev_eb ?? 0
    entries.push({
      id: 'news.items',
      section: 'News Impact',
      metric: 'News items analysed',
      value: String(newsAgg.items.length),
      valueRaw: newsAgg.items.length,
      formula: 'Google News + PV Magazine (last 60 days, company + segment matches)',
      inputs: [
        { name: 'Positive', value: String(newsAgg.items.filter((i) => i.impact.sentiment === 'positive').length) },
        { name: 'Negative', value: String(newsAgg.items.filter((i) => i.impact.sentiment === 'negative').length) },
        { name: 'Neutral', value: String(newsAgg.items.filter((i) => i.impact.sentiment === 'neutral').length) },
      ],
      source: 'News aggregation',
      concept: 'Headlines matched to subject and its value-chain segments; each scored for sentiment, materiality, affected parameters.',
    })

    entries.push({
      id: 'news.revdelta',
      section: 'News Impact',
      metric: 'Revenue Growth — Δ% (news-adjusted)',
      value: `${pct(adjusted.pre.revg)} → ${pct(adjusted.post.revg)}  (${pct(revDelta, 2)})`,
      valueRaw: revDelta,
      formula: 'post = pre × (1 + paramFactor);  Δ% = (post − pre) ÷ pre × 100',
      inputs: [
        { name: 'pre', value: pct(adjusted.pre.revg) },
        { name: 'post', value: pct(adjusted.post.revg) },
        { name: 'Items', value: String(newsAgg.items.length) },
      ],
      source: 'News aggregation',
      concept:
        'Baseline growth re-rated by acknowledged news — signed Σ of paramDegree × polarity × sentiment for "revenue_growth"-tagged items, applied multiplicatively.',
    })

    entries.push({
      id: 'news.ebmdelta',
      section: 'News Impact',
      metric: 'EBITDA Margin — Δ% (news-adjusted)',
      value: `${pct(adjusted.pre.ebm)} → ${pct(adjusted.post.ebm)}  (${pct(ebmDelta, 2)})`,
      valueRaw: ebmDelta,
      formula: 'post = pre × (1 + paramFactor)',
      inputs: [
        { name: 'pre', value: pct(adjusted.pre.ebm) },
        { name: 'post', value: pct(adjusted.post.ebm) },
      ],
      source: 'News aggregation',
      concept: 'Margin re-rating from "ebitda_margin"-tagged news items.',
    })

    entries.push({
      id: 'news.multdelta',
      section: 'News Impact',
      metric: 'EV/EBITDA Multiple — Δ% (news-adjusted)',
      value: `${mult(adjusted.pre.ev_eb)} → ${mult(adjusted.post.ev_eb)}  (${pct(multDelta, 2)})`,
      valueRaw: multDelta,
      formula: 'post = pre × (1 + paramFactor)',
      inputs: [
        { name: 'pre', value: mult(adjusted.pre.ev_eb) },
        { name: 'post', value: mult(adjusted.post.ev_eb) },
      ],
      source: 'News aggregation',
      concept:
        'Re-rating / de-rating of the trading multiple from "ev_ebitda_multiple"-tagged news. Typically the most visible sentiment channel.',
    })
  }

  // ── Concentration (HHI) ──────────────────────────────────────
  entries.push({
    id: 'hhi.val',
    section: 'Concentration',
    metric: 'HHI (Herfindahl-Hirschman Index)',
    value: num(hhi.hhi),
    valueRaw: hhi.hhi,
    formula: 'Σ (mktcap_share% )²  across segment companies',
    inputs: [
      { name: 'Segment total MktCap', value: cr(hhi.totalMktcapCr) },
      { name: 'Risk band', value: hhi.risk },
      { name: 'Top share', value: hhi.topShare != null ? pct(hhi.topShare) : '—' },
    ],
    source: 'Computed (formula applied)',
    concept:
      'Market concentration: < 1500 = low, 1500-2500 = moderate, > 2500 = high. Drives CCI regulatory risk for M&A.',
  })

  // ── Conclusion (valuation range across methods) ──────────────
  const allEquity = [
    dcf.equityValue,
    ...comps.map((c) => c.equityMedian),
    bv.equityValue,
  ].filter((v) => v > 0)

  if (allEquity.length > 0) {
    const low = Math.min(...allEquity)
    const high = Math.max(...allEquity)
    const mid = allEquity.reduce((a, b) => a + b, 0) / allEquity.length
    entries.push({
      id: 'conc.range',
      section: 'Conclusion',
      metric: 'Blended Valuation Range',
      value: `${cr(low)} — ${cr(high)}`,
      valueRaw: mid,
      formula: 'min/mean/max of { DCF, EV/EBITDA, P/E, P/B, EV/Sales, Book }',
      inputs: [
        { name: 'DCF', value: cr(dcf.equityValue) },
        ...comps.map((c) => ({ name: c.method, value: cr(c.equityMedian) })),
        { name: 'Book × Premium', value: cr(bv.equityValue) },
      ],
      source: 'Computed (formula applied)',
      concept: 'Aggregated range of equity values across all valuation methods — the football-field summary.',
    })

    entries.push({
      id: 'conc.midupside',
      section: 'Conclusion',
      metric: 'Blended Mid vs. MktCap',
      value: pct(s.mktcap > 0 ? ((mid - s.mktcap) / s.mktcap) * 100 : 0),
      valueRaw: s.mktcap > 0 ? ((mid - s.mktcap) / s.mktcap) * 100 : 0,
      formula: '(avg equity across methods − MktCap) ÷ MktCap × 100',
      inputs: [
        { name: 'Blended mid', value: cr(mid) },
        { name: 'MktCap', value: cr(s.mktcap) },
      ],
      source: 'Computed (formula applied)',
      concept:
        'Recommendation anchor: > +20% → Strong Buy, +5–20% → Buy, -5–+5% → Hold, < -5% → Monitor/Pass.',
    })
  }

  // void silences "unused" warnings when news is null
  void ratio

  return entries
}

/** Group entries by section for tabbed display. */
export function groupBySection(
  entries: CalcTraceEntry[]
): Record<TraceSection, CalcTraceEntry[]> {
  const out = {} as Record<TraceSection, CalcTraceEntry[]>
  for (const e of entries) {
    if (!out[e.section]) out[e.section] = []
    out[e.section].push(e)
  }
  return out
}
