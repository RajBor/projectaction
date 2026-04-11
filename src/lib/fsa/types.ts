/**
 * Shared types for the CFA Financial Analysis Engine.
 *
 * All inputs are ₹Cr unless otherwise stated. The engine is a direct
 * TypeScript port of the vanilla-JS reference implementation based on
 * CFA Program Curriculum 2025 Level 1 Volume 4 (FSA).
 */

// ── Ratio result envelope ─────────────────────────────────

export interface RatioResult {
  value: number
  unit?: string
  pct?: number
  better?: 'higher' | 'lower' | 'context' | 'near 1.0' | 'near 0' | '>1.0'
  interpretation?: string
  note?: string
  label?: string
}

// ── Input bundles ─────────────────────────────────────────

export interface FSAInputs {
  // Income statement
  revenue: number
  cogs?: number
  grossProfit?: number
  operatingExpenses?: number
  ebit?: number
  ebitda?: number
  interestExpense?: number
  ebt?: number
  taxExpense?: number
  netIncome?: number
  da?: number
  preferredDividends?: number
  leasePayments?: number

  // Balance sheet
  cash?: number
  shortTermInvestments?: number
  receivables?: number
  inventory?: number
  currentAssets?: number
  currentLiabilities?: number
  totalAssetsBegin?: number
  totalAssetsEnd?: number
  totalEquityBegin?: number
  totalEquityEnd?: number
  totalDebt?: number
  grossPPE?: number
  accumulatedDepreciation?: number

  // Prior-period balances (for averaging)
  receivablesBegin?: number
  receivablesEnd?: number
  inventoryBegin?: number
  inventoryEnd?: number
  payablesBegin?: number
  payablesEnd?: number
  fixedAssetsBegin?: number
  fixedAssetsEnd?: number
  investedCapitalBegin?: number
  investedCapitalEnd?: number

  // Cash flow
  cfo?: number
  cfi?: number
  cff?: number
  capex?: number

  // Market data
  pricePerShare?: number
  sharesOutstanding?: number
  eps?: number
  bvps?: number
  epsGrowthRate?: number

  // Other
  taxRate?: number
  daysInPeriod?: number
  installedCapacityMW?: number | null
}

// ── Subset bundles used by the individual engines ────────

export interface ActivityInputs {
  revenue: number
  cogs: number
  inventoryBegin: number
  inventoryEnd: number
  receivablesBegin: number
  receivablesEnd: number
  payablesBegin: number
  payablesEnd: number
  fixedAssetsBegin: number
  fixedAssetsEnd: number
  totalAssetsBegin: number
  totalAssetsEnd: number
  workingCapitalBegin?: number
  workingCapitalEnd?: number
  daysInPeriod?: number
}

export interface LiquidityInputs {
  cash: number
  shortTermInvestments?: number
  receivables: number
  inventory: number
  currentAssets: number
  currentLiabilities: number
  cogs: number
  sga?: number
  rnd?: number
  depreciation?: number
  daysInPeriod?: number
  doh?: number | null
  dso?: number | null
  daysPayables?: number | null
}

export interface SolvencyInputs {
  totalDebt: number
  totalAssets: number
  totalEquity: number
  netIncome?: number
  totalAssetsBegin: number
  totalAssetsEnd: number
  totalEquityBegin: number
  totalEquityEnd: number
  ebit: number
  ebitda: number
  interestExpense: number
  leasePayments?: number
  cash?: number
  cashEquivalents?: number
  shortTermInvestments?: number
}

export interface ProfitabilityInputs {
  revenue: number
  grossProfit: number
  operatingIncome: number
  ebt: number
  netIncome: number
  ebitda: number
  ebit: number
  preferredDividends?: number
  interestExpense?: number
  taxRate?: number
  totalAssetsBegin: number
  totalAssetsEnd: number
  totalEquityBegin: number
  totalEquityEnd: number
  commonEquityBegin?: number
  commonEquityEnd?: number
  investedCapitalBegin?: number
  investedCapitalEnd?: number
}

export interface CashFlowInputs {
  cfo: number
  cfi?: number
  cff?: number
  capex: number
  netBorrowing?: number
  netIncome: number
  ebit: number
  taxRate?: number
  interestExpense?: number
  totalDebt: number
  da?: number
  changeInNWC?: number
  noaBegin?: number
  noaEnd?: number
}

export interface ValuationInputs {
  pricePerShare: number
  eps: number
  bvps: number
  revenue: number
  marketCap: number
  ebitda: number
  ebit: number
  totalDebt: number
  cash?: number
  cashEquivalents?: number
  dps?: number
  epsGrowthRate?: number
  sharesOutstanding?: number
}

// ── Ratio output bundles ─────────────────────────────────

export interface ActivityRatiosOutput {
  inventoryTurnover: RatioResult | null
  daysInventoryOnHand: RatioResult | null
  receivablesTurnover: RatioResult | null
  daysSalesOutstanding: RatioResult | null
  payablesTurnover: RatioResult | null
  daysPayables: RatioResult | null
  cashConversionCycle: RatioResult | null
  workingCapitalTurnover: RatioResult | null
  fixedAssetTurnover: RatioResult | null
  totalAssetTurnover: RatioResult | null
}

export interface LiquidityRatiosOutput {
  currentRatio: RatioResult | null
  quickRatio: RatioResult | null
  cashRatio: RatioResult | null
  defensiveIntervalRatio: RatioResult | null
  cashConversionCycle: RatioResult | null
}

export interface SolvencyRatiosOutput {
  debtToAssets: RatioResult | null
  debtToCapital: RatioResult | null
  debtToEquity: RatioResult | null
  financialLeverage: RatioResult | null
  debtToEBITDA: RatioResult | null
  netDebt: number
  interestCoverage: RatioResult | null
  fixedChargeCoverage: RatioResult | null
}

export interface ProfitabilityRatiosOutput {
  grossMargin: RatioResult | null
  operatingMargin: RatioResult | null
  pretaxMargin: RatioResult | null
  netProfitMargin: RatioResult | null
  ebitdaMargin: RatioResult | null
  roa: RatioResult | null
  roaAdjusted: RatioResult | null
  operatingROA: RatioResult | null
  roe: RatioResult | null
  returnOnCommonEquity: RatioResult | null
  roic: RatioResult | null
}

export interface CashFlowOutput {
  fcfe: RatioResult | null
  fcff_fromCFO: RatioResult | null
  fcff_fromEBIT: RatioResult | null
  cashFlowCoverage: RatioResult | null
  cfoToNetIncome: RatioResult | null
  accrualsBSRatio: RatioResult | null
  capexCoverage: RatioResult | null
}

export interface ValuationOutput {
  peRatio: RatioResult | null
  pbRatio: RatioResult | null
  psRatio: RatioResult | null
  evToEBITDA: RatioResult | null
  evToEBIT: RatioResult | null
  evToRevenue: RatioResult | null
  pegRatio: RatioResult | null
  dividendYield: RatioResult | null
  enterpriseValue: number
}

// ── DuPont decomposition ────────────────────────────────

export interface DuPontComponent {
  value: number
  pct?: number
  label: string
  formula?: string
  driver?: string
  interpretation?: string
}

export interface DuPontFiveWay {
  roe: number
  components: {
    taxBurden: DuPontComponent
    interestBurden: DuPontComponent
    ebitMargin: DuPontComponent
    assetTurnover: DuPontComponent
    leverage: DuPontComponent
  }
  roa: number
  check: boolean
  narrative: string[]
}

// ── Scoring + final result ───────────────────────────────

export interface FSAScoreBreakdown {
  profitability: number
  solvency: number
  liquidity: number
  efficiency: number
  cashFlowQuality: number
}

export interface FSAScore {
  total: number
  breakdown: FSAScoreBreakdown
  grade: string
}

export interface FSASummary {
  revenue: number
  ebitda: number
  ebit: number
  netIncome: number
  cfo: number
  marketCap: number
  ebitdaMargin?: number
  netMargin?: number
  roe?: number
  debtToEBITDA?: number
  currentRatio?: number
  score: number
  scoreBreakdown: FSAScore
}

export interface FSAResult {
  company: string
  analysisDate: string
  summary: FSASummary
  ratios: {
    activity: ActivityRatiosOutput
    liquidity: LiquidityRatiosOutput
    solvency: SolvencyRatiosOutput
    profitability: ProfitabilityRatiosOutput
  }
  dupont: DuPontFiveWay
  cashflow: CashFlowOutput
  valuation: ValuationOutput
  assetAnalysis: {
    averageAge: RatioResult | null
    remainingLife: RatioResult | null
    totalEstimatedLife: RatioResult | null
    relativeAge: RatioResult | null
    capexToDep: RatioResult | null
  }
  quality: {
    cfoQuality: {
      ratio: number
      qualitySignal: 'HIGH_QUALITY' | 'MODERATE' | 'CONCERN'
      redFlag: boolean
      note: string
    } | null
    accrualsRatio: RatioResult | null
    effectiveTaxRate: number | null
  }
  narrative: string
}
