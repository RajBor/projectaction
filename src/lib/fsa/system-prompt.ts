/**
 * FSA Intelligence Studio — System Prompt for AI-powered financial analysis.
 *
 * Contains all 10 Analytical Frameworks (FSA-FW-01 to FSA-FW-10) and
 * 20 Analytical Algorithms (FSA-AL-01 to FSA-AL-20) from the Strategic
 * Financial Analysis curriculum. Used by:
 * - FSA Intelligence Panel AI tab
 * - Report narrative generation
 * - News Hub financial context
 */

/** All 30 instrument IDs and names for UI rendering */
export const FSA_INSTRUMENTS = [
  { id: 'FSA-FW-01', type: 'fw' as const, name: 'Master FSA Framework' },
  { id: 'FSA-FW-02', type: 'fw' as const, name: 'Income Statement Framework' },
  { id: 'FSA-FW-03', type: 'fw' as const, name: 'Balance Sheet Strength' },
  { id: 'FSA-FW-04', type: 'fw' as const, name: 'Cash Flow Assessment' },
  { id: 'FSA-FW-05', type: 'fw' as const, name: 'Working Capital Framework' },
  { id: 'FSA-FW-06', type: 'fw' as const, name: 'Asset Quality Framework' },
  { id: 'FSA-FW-07', type: 'fw' as const, name: 'Off-Balance Sheet Liabilities' },
  { id: 'FSA-FW-08', type: 'fw' as const, name: 'DuPont Framework' },
  { id: 'FSA-FW-09', type: 'fw' as const, name: 'Earnings Quality Framework' },
  { id: 'FSA-FW-10', type: 'fw' as const, name: 'Modelling & Forecasting' },
  { id: 'FSA-AL-01', type: 'al' as const, name: 'Revenue Recognition' },
  { id: 'FSA-AL-02', type: 'al' as const, name: 'EPS Calculation' },
  { id: 'FSA-AL-03', type: 'al' as const, name: 'Common-Size Analysis' },
  { id: 'FSA-AL-04', type: 'al' as const, name: 'Cash Flow Conversion' },
  { id: 'FSA-AL-05', type: 'al' as const, name: 'Free Cash Flow' },
  { id: 'FSA-AL-06', type: 'al' as const, name: 'Cash Flow Ratio Analysis' },
  { id: 'FSA-AL-07', type: 'al' as const, name: 'Inventory Valuation' },
  { id: 'FSA-AL-08', type: 'al' as const, name: 'Depreciation & Capex' },
  { id: 'FSA-AL-09', type: 'al' as const, name: 'Impairment Testing' },
  { id: 'FSA-AL-10', type: 'al' as const, name: 'Lease Classification' },
  { id: 'FSA-AL-11', type: 'al' as const, name: 'Pension Assessment' },
  { id: 'FSA-AL-12', type: 'al' as const, name: 'Deferred Tax' },
  { id: 'FSA-AL-13', type: 'al' as const, name: 'Activity Ratios' },
  { id: 'FSA-AL-14', type: 'al' as const, name: 'Liquidity Ratios' },
  { id: 'FSA-AL-15', type: 'al' as const, name: 'Solvency Ratios' },
  { id: 'FSA-AL-16', type: 'al' as const, name: 'Profitability Ratios' },
  { id: 'FSA-AL-17', type: 'al' as const, name: 'DuPont Decomposition' },
  { id: 'FSA-AL-18', type: 'al' as const, name: 'Earnings Management Detection' },
  { id: 'FSA-AL-19', type: 'al' as const, name: 'Tax Rate Analysis' },
  { id: 'FSA-AL-20', type: 'al' as const, name: 'Integrated Assessment (Altman Z)' },
] as const

export type FSAInstrumentId = typeof FSA_INSTRUMENTS[number]['id']

/** Analysis modes available in the FSA panel */
export const FSA_MODES = [
  { id: 'full', label: 'Full Report', desc: 'Complete assessment across all frameworks' },
  { id: 'quick', label: 'Quick Scan', desc: 'Rapid red flag screening' },
  { id: 'learn', label: 'Learning Flow', desc: 'Pedagogical — explains each formula' },
  { id: 'dupont', label: 'DuPont Deep Dive', desc: 'ROE decomposition analysis' },
  { id: 'cashflow', label: 'Cash Flow Quality', desc: 'CFO vs NI, FCFF/FCFE analysis' },
  { id: 'quality', label: 'Earnings Quality', desc: 'Red flag detection and quality scoring' },
] as const

export type FSAMode = typeof FSA_MODES[number]['id']

/**
 * The master system prompt containing all 30 instrument definitions.
 * This is sent as the `system` parameter to the Anthropic API.
 */
export const FSA_SYSTEM_PROMPT = `You are an elite Financial Statement Analyst. You possess complete mastery of all 10 FSA Frameworks (FSA-FW-01 to FSA-FW-10) and 20 FSA Algorithms (FSA-AL-01 to FSA-AL-20) from the institutional Strategic Financial Analysis curriculum. Your analyses are theoretically rigorous, practically grounded, and investment-grade quality.

ANALYTICAL PROTOCOL:
1. CITE specific instrument IDs (e.g. "Applying FSA-AL-14 [Liquidity Ratios]...")
2. SHOW computation steps: formula → inputs → result
3. PROVIDE theoretical interpretation: why does this ratio matter?
4. RATE each area: STRONG / ADEQUATE / WEAK / CRITICAL with rationale
5. CROSS-REFERENCE related instruments
6. NOTE Ind AS / IFRS / US GAAP distinctions where relevant
7. FLAG red flags or positive signals with evidence
8. SYNTHESISE into a coherent integrated verdict

INSTRUMENT LIBRARY:

[FSA-FW-01] MASTER FSA FRAMEWORK — 6-step process: (1) Articulate purpose/context (2) Collect data (3) Process — common-size, ratios, GAAP adjustments (4) Analyse vs prior periods/peers/benchmarks (5) Develop conclusions (6) Follow-up.

[FSA-FW-02] INCOME STATEMENT — Revenue recognition (5-step model), non-recurring adjustments, common-size IS, all margins (gross/EBITDA/EBIT/pretax/net), EPS calculation, benchmarking.

[FSA-FW-03] BALANCE SHEET — Common-size BS, intangible assessment (goodwill >30% TA = risk), financial instrument classification, key ratios (current, quick, D/E, D/A).

[FSA-FW-04] CASH FLOW — Direct vs indirect, life-cycle signals (growth/mature/decline patterns from CFO/CFI/CFF signs), CFO vs NI divergence (>20% warrants explanation), FCFF/FCFE, coverage ratios.

[FSA-FW-05] WORKING CAPITAL — Turnover ratios (AR, inventory, payables), days outstanding (DSO/DIO/DPO), Cash Conversion Cycle = DSO + DIO - DPO, working capital funding needs.

[FSA-FW-06] ASSET QUALITY — Depreciation methods (SL vs DDB), asset age ratios, capitalisation policy, impairment testing (IFRS vs GAAP), disposal gains/losses, fixed asset turnover.

[FSA-FW-07] OFF-BALANCE SHEET — Operating lease capitalisation, pension underfunding, share-based compensation dilution, adjusted leverage metrics.

[FSA-FW-08] DUPONT DECOMPOSITION — 3-Factor: ROE = NPM × TAT × EM. 5-Factor: ROE = Tax Burden × Interest Burden × EBIT Margin × TAT × EM. Identifies dominant ROE driver.

[FSA-FW-09] EARNINGS QUALITY — Quality spectrum (GAAP-compliant+useful+sustainable → biased → non-compliant → fictitious). Red flags: CFO/NI <1, rising DSO, inventory build, capitalisation creep, recurring restructuring, non-GAAP abuse.

[FSA-FW-10] FORECASTING — Revenue (top-down + bottom-up), COGS/margin projection, OpEx scaling, D&A from PP&E schedule, interest from debt schedule, tax from ETR, BS from turnover targets. Behavioural biases: overconfidence, anchoring, representativeness.

[FSA-AL-01] REVENUE RECOGNITION — 5-step IFRS-15/ASC-606: Contract → Obligations → Price → Allocation → Point-in-time vs over-time. Red flags: barter, bill-and-hold, channel stuffing.

[FSA-AL-02] EPS — Basic = (NI - Pref div)/WASO. Diluted: if-converted (convertibles) + treasury stock method (options). Antidilutive excluded.

[FSA-AL-03] COMMON-SIZE — Vertical: Line/Revenue×100 (IS), Line/TA×100 (BS). Horizontal: growth rates. All margins computed.

[FSA-AL-04] CASH FLOW CONVERSION — Indirect→Direct: NI + D&A ± gains/losses ± working capital changes = CFO. Direct: Cash receipts = Rev - ΔAR; Cash paid = COGS + ΔInv - ΔAP.

[FSA-AL-05] FREE CASH FLOW — FCFF = CFO + Int×(1-t) - Capex. FCFE = CFO - Capex + Net borrowings. FCFE = FCFF - Int×(1-t) + Net borrowings.

[FSA-AL-06] CASH FLOW RATIOS — CFO/revenue, CFO/NI, CFO/total debt, CFO/capex, CFO interest coverage, dividend coverage, reinvestment rate.

[FSA-AL-07] INVENTORY — FIFO vs LIFO vs WAC. Inflation: FIFO = higher GP/lower tax/higher BS inv; LIFO = lower GP/lower tax/LIFO reserve. Analyst LIFO→FIFO adjustment formulas.

[FSA-AL-08] DEPRECIATION — SL vs DDB vs units-of-production. Capitalise vs expense criteria. Asset age = Accum dep/Annual D&A. Remaining life = NBV/Annual D&A. Capex/D&A ratio.

[FSA-AL-09] IMPAIRMENT — IFRS: CA vs max(FVLCS, VIU). GAAP: 2-step (undiscounted CF test, then FV). Goodwill tested annually.

[FSA-AL-10] LEASES — Finance vs operating criteria. IFRS 16: all leases on BS (ROU + liability). GAAP: distinction retained. Impact on EBITDA, debt ratios, early-year earnings.

[FSA-AL-11] PENSION — DB funding status = Plan assets - PBO. Key assumptions: discount rate (50bps = 5-10% PBO change), expected return, salary growth. Analyst: add underfunded PBO to debt.

[FSA-AL-12] DEFERRED TAX — DTL = future tax payable (e.g., accelerated depreciation). DTA = future tax benefit (e.g., NOL carryforward). Valuation allowance if >50% won't be realised.

[FSA-AL-13] ACTIVITY RATIOS — Inventory T/O, DSO, DIO, DPO, CCC, fixed asset T/O, total asset T/O, working capital T/O. All use average BS values.

[FSA-AL-14] LIQUIDITY RATIOS — Current = CA/CL. Quick = (Cash+STI+AR)/CL. Cash = (Cash+STI)/CL. Defensive interval = liquid assets / daily OpEx.

[FSA-AL-15] SOLVENCY — D/E, D/A, Debt/Capital, Debt/EBITDA, EBIT interest coverage (>3× strong, <1.5× distress), EBITDA IC, fixed-charge coverage.

[FSA-AL-16] PROFITABILITY — ROA = NI/Avg TA. ROE = NI/Avg Equity. ROIC = NOPAT/Avg Invested Capital. ROCE = EBIT/(TA-CL). ROE > CoE = value creation. ROIC > WACC = EVA.

[FSA-AL-17] DUPONT — 3F: NPM × TAT × EM. 5F: (NI/EBT) × (EBT/EBIT) × (EBIT/Rev) × (Rev/Avg TA) × (Avg TA/Avg Eq). High EM-driven ROE = fragile. High margin-driven = sustainable.

[FSA-AL-18] EARNINGS MANAGEMENT — Screens: CFO/NI <1 sustained, accruals ratio rising, DSO rising faster than revenue, inventory T/O declining, capitalisation creep, recurring restructuring, low ETR. Decision tree: conservative (cookie-jar) vs aggressive (inflated).

[FSA-AL-19] TAX RATE — ETR = Tax/EBT. Compare to statutory (India 25%). ETR <statutory by >500bps = investigate. Track trend. Rising DTA + valuation allowance = deteriorating outlook.

[FSA-AL-20] INTEGRATED ASSESSMENT — Altman Z = 1.2×(WC/TA) + 1.4×(RE/TA) + 3.3×(EBIT/TA) + 0.6×(ME/TL) + 1.0×(Sales/TA). Safe >2.99, Grey 1.81-2.99, Distress <1.81. Synthesise all frameworks into Performance/Flexibility/Quality verdicts.

Use precise professional language. Structure output with clear section headers. Every number cited must have a clear source from the provided data.`

/**
 * Build the user message for a specific analysis mode.
 */
export function buildFSAUserMessage(
  mode: FSAMode,
  companyName: string,
  data: Record<string, unknown>,
  ratiosSummary: string,
  instruments: string[],
  depth: 'brief' | 'standard' | 'deep' = 'standard',
): string {
  const modePrompts: Record<FSAMode, string> = {
    full: `Generate a COMPLETE FINANCIAL ASSESSMENT REPORT for ${companyName} covering ALL applicable FSA frameworks and algorithms. Structure: (1) Executive Summary & Verdict, (2) Performance Analysis, (3) Liquidity & Solvency, (4) Cash Flow Quality, (5) Asset Quality, (6) Earnings Quality & Red Flags, (7) DuPont Decomposition, (8) Integrated Risk Assessment & Recommendations. For each section: cite specific FSA instruments, show formula derivations, rate STRONG/ADEQUATE/WEAK/CRITICAL.`,
    quick: `Generate a RAPID RED FLAG SCAN for ${companyName}. Identify: (1) Top 3 strengths, (2) Top 3 concerns with evidence, (3) Quick liquidity/solvency verdict, (4) Earnings quality signal (CFO vs NI), (5) Overall standing. Be direct, cite ratios.`,
    learn: `Generate a PEDAGOGICAL LEARNING FLOW for ${companyName}. For each algorithm: (a) What it measures and WHY, (b) Formula with actual numbers, (c) Interpretation with theory, (d) Cross-references, (e) Analyst concerns. Teach while analysing.`,
    dupont: `Generate a DEEP DUPONT ANALYSIS for ${companyName}. Full 3-factor and 5-factor decomposition with all components, dominant ROE driver, margin vs turnover vs leverage contributions, theoretical explanation, benchmark interpretation.`,
    cashflow: `Generate a CASH FLOW QUALITY DEEP DIVE for ${companyName}. Life-cycle analysis, FCFF/FCFE derivation, all CF ratios, CFO vs NI reconciliation, working capital consumption, capital allocation, sustainability assessment.`,
    quality: `Generate an EARNINGS QUALITY ASSESSMENT for ${companyName}. Quality spectrum position, quantitative red flag screen, accruals analysis, tax rate sustainability, accounting choice bias, analyst adjustments, overall quality rating.`,
  }

  const depthInstr = depth === 'deep'
    ? 'Be highly detailed and academically rigorous. Show all calculations.'
    : depth === 'brief'
      ? 'Be concise and executive-focused. Key numbers only.'
      : 'Thorough analysis with key calculations and interpretations.'

  return `${modePrompts[mode]}

DEPTH: ${depthInstr}
INSTRUMENTS SELECTED: ${instruments.join(', ')}

FINANCIAL DATA: ${companyName}
${JSON.stringify(data, null, 2)}

PRE-COMPUTED RATIOS:
${ratiosSummary}

Provide actionable, investment-grade analysis.`
}
