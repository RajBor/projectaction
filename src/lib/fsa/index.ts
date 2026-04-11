/**
 * CFA Financial Analysis Engine — TypeScript port.
 *
 * Source: CFA Program Curriculum 2025 Level 1 Volume 4 — Financial
 * Statement Analysis. All formulas, benchmarks, and analytical
 * frameworks are extracted directly from the CFA FSA curriculum.
 *
 * Covers: Activity · Liquidity · Solvency · Profitability · DuPont ·
 * Cash Flow · EPS · Common-Size · Quality Indicators · Asset Age ·
 * Tax · Industry-specific metrics.
 *
 * See `types.ts` for interfaces.
 */

import type {
  ActivityInputs,
  ActivityRatiosOutput,
  CashFlowInputs,
  CashFlowOutput,
  DuPontFiveWay,
  FSAInputs,
  FSAResult,
  FSAScore,
  LiquidityInputs,
  LiquidityRatiosOutput,
  ProfitabilityInputs,
  ProfitabilityRatiosOutput,
  RatioResult,
  SolvencyInputs,
  SolvencyRatiosOutput,
  ValuationInputs,
  ValuationOutput,
} from './types'

export type * from './types'

// ─────────────────────────────────────────────────────────
// 1. ACTIVITY RATIOS (Asset utilisation / operating efficiency)
// CFA FSA LM 11 — Activity Ratios
// ─────────────────────────────────────────────────────────

export const ActivityRatios = {
  inventoryTurnover(cogs: number, begin: number, end: number): RatioResult | null {
    const avg = (begin + end) / 2
    if (avg === 0) return null
    return { value: cogs / avg, unit: 'times', better: 'higher' }
  },
  daysInventoryOnHand(invTurnover: number, days = 365): RatioResult | null {
    if (!invTurnover) return null
    return { value: days / invTurnover, unit: 'days', better: 'lower' }
  },
  receivablesTurnover(revenue: number, begin: number, end: number): RatioResult | null {
    const avg = (begin + end) / 2
    if (avg === 0) return null
    return { value: revenue / avg, unit: 'times', better: 'higher' }
  },
  daysSalesOutstanding(recTurnover: number, days = 365): RatioResult | null {
    if (!recTurnover) return null
    return { value: days / recTurnover, unit: 'days', better: 'lower' }
  },
  payablesTurnover(cogs: number, begin: number, end: number): RatioResult | null {
    const avg = (begin + end) / 2
    if (avg === 0) return null
    return { value: cogs / avg, unit: 'times', better: 'context' }
  },
  daysPayables(payTurnover: number, days = 365): RatioResult | null {
    if (!payTurnover) return null
    return { value: days / payTurnover, unit: 'days', better: 'context' }
  },
  cashConversionCycle(doh: number, dso: number, daysPayables: number): RatioResult {
    const ccc = doh + dso - daysPayables
    return {
      value: ccc,
      unit: 'days',
      better: 'lower',
      interpretation:
        ccc < 0
          ? 'Negative CCC: company collects cash before paying suppliers — strong working-capital position'
          : ccc < 30
            ? 'Short CCC (<30 days): efficient working-capital management'
            : ccc < 60
              ? 'Moderate CCC (30–60 days): typical for most industries'
              : 'Long CCC (>60 days): significant working-capital financing needed',
    }
  },
  workingCapitalTurnover(revenue: number, begin: number, end: number): RatioResult | null {
    const avg = (begin + end) / 2
    if (avg === 0) return null
    return { value: revenue / avg, unit: 'times', better: 'higher' }
  },
  fixedAssetTurnover(revenue: number, begin: number, end: number): RatioResult | null {
    const avg = (begin + end) / 2
    if (avg === 0) return null
    return { value: revenue / avg, unit: 'times', better: 'higher' }
  },
  totalAssetTurnover(revenue: number, begin: number, end: number): RatioResult | null {
    const avg = (begin + end) / 2
    if (avg === 0) return null
    return { value: revenue / avg, unit: 'times', better: 'higher' }
  },
  computeAll(d: ActivityInputs): ActivityRatiosOutput {
    const days = d.daysInPeriod ?? 365
    const invTO = this.inventoryTurnover(d.cogs, d.inventoryBegin, d.inventoryEnd)
    const doh = invTO ? this.daysInventoryOnHand(invTO.value, days) : null
    const recTO = this.receivablesTurnover(d.revenue, d.receivablesBegin, d.receivablesEnd)
    const dso = recTO ? this.daysSalesOutstanding(recTO.value, days) : null
    const payTO = this.payablesTurnover(d.cogs, d.payablesBegin, d.payablesEnd)
    const dap = payTO ? this.daysPayables(payTO.value, days) : null
    const ccc = doh && dso && dap ? this.cashConversionCycle(doh.value, dso.value, dap.value) : null
    return {
      inventoryTurnover: invTO,
      daysInventoryOnHand: doh,
      receivablesTurnover: recTO,
      daysSalesOutstanding: dso,
      payablesTurnover: payTO,
      daysPayables: dap,
      cashConversionCycle: ccc,
      workingCapitalTurnover:
        d.workingCapitalBegin != null && d.workingCapitalEnd != null
          ? this.workingCapitalTurnover(d.revenue, d.workingCapitalBegin, d.workingCapitalEnd)
          : null,
      fixedAssetTurnover: this.fixedAssetTurnover(d.revenue, d.fixedAssetsBegin, d.fixedAssetsEnd),
      totalAssetTurnover: this.totalAssetTurnover(d.revenue, d.totalAssetsBegin, d.totalAssetsEnd),
    }
  },
}

// ─────────────────────────────────────────────────────────
// 2. LIQUIDITY RATIOS
// CFA FSA LM 11 — Liquidity Ratios
// ─────────────────────────────────────────────────────────

export const LiquidityRatios = {
  currentRatio(currentAssets: number, currentLiabilities: number): RatioResult | null {
    if (currentLiabilities === 0) return null
    const v = currentAssets / currentLiabilities
    return {
      value: v,
      unit: 'x',
      better: 'higher',
      interpretation:
        v >= 2.0
          ? 'Strong liquidity'
          : v >= 1.5
            ? 'Adequate liquidity'
            : v >= 1.0
              ? 'Minimal liquidity buffer — monitor closely'
              : 'Current liabilities exceed current assets — liquidity risk',
    }
  },
  quickRatio(cash: number, sti: number, recv: number, cl: number): RatioResult | null {
    if (cl === 0) return null
    const v = (cash + sti + recv) / cl
    return {
      value: v,
      unit: 'x',
      better: 'higher',
      interpretation:
        v >= 1.0
          ? 'Can meet current obligations from quick assets'
          : v >= 0.7
            ? 'Adequate — but watch receivables quality'
            : 'Below 0.7 — may need to liquidate inventory to meet obligations',
    }
  },
  cashRatio(cash: number, sti: number, cl: number): RatioResult | null {
    if (cl === 0) return null
    return { value: (cash + sti) / cl, unit: 'x', better: 'higher' }
  },
  defensiveIntervalRatio(
    cash: number,
    sti: number,
    recv: number,
    dailyExp: number
  ): RatioResult | null {
    if (dailyExp === 0) return null
    const v = (cash + sti + recv) / dailyExp
    return {
      value: v,
      unit: 'days',
      better: 'higher',
      interpretation: `Company can sustain operations for ${Math.round(v)} days from existing liquid assets alone`,
    }
  },
  dailyExpenditures(cogs: number, sga: number, rnd: number, da: number, days = 365): number {
    return (cogs + sga + rnd - da) / days
  },
  computeAll(d: LiquidityInputs): LiquidityRatiosOutput {
    const days = d.daysInPeriod ?? 365
    const dailyExp = this.dailyExpenditures(
      d.cogs,
      d.sga ?? 0,
      d.rnd ?? 0,
      d.depreciation ?? 0,
      days
    )
    const sti = d.shortTermInvestments ?? 0
    const ccc =
      d.doh != null && d.dso != null && d.daysPayables != null
        ? { value: d.doh + d.dso - d.daysPayables, unit: 'days', better: 'lower' as const }
        : null
    return {
      currentRatio: this.currentRatio(d.currentAssets, d.currentLiabilities),
      quickRatio: this.quickRatio(d.cash, sti, d.receivables, d.currentLiabilities),
      cashRatio: this.cashRatio(d.cash, sti, d.currentLiabilities),
      defensiveIntervalRatio: this.defensiveIntervalRatio(d.cash, sti, d.receivables, dailyExp),
      cashConversionCycle: ccc,
    }
  },
}

// ─────────────────────────────────────────────────────────
// 3. SOLVENCY RATIOS
// CFA FSA LM 11 — Solvency Ratios
// ─────────────────────────────────────────────────────────

export const SolvencyRatios = {
  debtToAssets(totalDebt: number, totalAssets: number): RatioResult | null {
    if (totalAssets === 0) return null
    const v = totalDebt / totalAssets
    return {
      value: v,
      pct: v * 100,
      unit: '%',
      better: 'lower',
      interpretation:
        v < 0.3
          ? 'Conservative leverage — strong asset coverage'
          : v < 0.5
            ? 'Moderate leverage — typical for industrial companies'
            : v < 0.7
              ? 'High leverage — monitor cash flow coverage carefully'
              : 'Very high leverage — significant insolvency risk',
    }
  },
  debtToCapital(totalDebt: number, totalEquity: number): RatioResult | null {
    const cap = totalDebt + totalEquity
    if (cap === 0) return null
    const v = totalDebt / cap
    return { value: v, pct: v * 100, unit: '%', better: 'lower' }
  },
  debtToEquity(totalDebt: number, totalEquity: number): RatioResult | null {
    if (totalEquity === 0) return null
    const v = totalDebt / totalEquity
    return {
      value: v,
      unit: 'x',
      better: 'lower',
      interpretation:
        v < 0.5
          ? 'Low leverage — substantial equity cushion'
          : v < 1.0
            ? 'Moderate leverage — balanced capital structure'
            : v < 2.0
              ? 'High leverage — equity at risk in downturn'
              : 'Very high leverage — distress risk; scrutinize cash flows',
    }
  },
  financialLeverage(avgAssets: number, avgEquity: number): RatioResult | null {
    if (avgEquity === 0) return null
    return {
      value: avgAssets / avgEquity,
      unit: 'x',
      better: 'context',
      note: 'Used in DuPont analysis; higher = more financial leverage',
    }
  },
  debtToEBITDA(totalDebt: number, ebitda: number): RatioResult | null {
    if (ebitda === 0) return null
    const v = totalDebt / ebitda
    return {
      value: v,
      unit: 'x',
      better: 'lower',
      interpretation:
        v < 2.0
          ? 'Very low leverage — could take on more debt'
          : v < 3.0
            ? 'Comfortable — typical investment grade'
            : v < 4.0
              ? 'Elevated — approaching covenant limits for many deals'
              : v < 5.0
                ? 'High — speculative grade territory'
                : 'Very high — distress risk; scrutinize refinancing ability',
    }
  },
  netDebt(totalDebt: number, cash: number, ce = 0, sti = 0): number {
    return totalDebt - cash - ce - sti
  },
  interestCoverage(ebit: number, intExp: number): RatioResult | null {
    if (intExp === 0) return null
    const v = ebit / intExp
    return {
      value: v,
      unit: 'x',
      better: 'higher',
      interpretation:
        v >= 5.0
          ? 'Strong coverage — very comfortable debt service'
          : v >= 3.0
            ? 'Adequate coverage — normal range for investment grade'
            : v >= 1.5
              ? 'Thin coverage — vulnerable to earnings decline'
              : v >= 1.0
                ? 'Barely covering interest — potential default risk'
                : 'Insufficient earnings to cover interest — high default risk',
    }
  },
  fixedChargeCoverage(
    ebit: number,
    leasePayments: number,
    intExp: number
  ): RatioResult | null {
    const fixed = intExp + leasePayments
    if (fixed === 0) return null
    return { value: (ebit + leasePayments) / fixed, unit: 'x', better: 'higher' }
  },
  computeAll(d: SolvencyInputs): SolvencyRatiosOutput {
    const avgA = (d.totalAssetsBegin + d.totalAssetsEnd) / 2
    const avgE = (d.totalEquityBegin + d.totalEquityEnd) / 2
    return {
      debtToAssets: this.debtToAssets(d.totalDebt, d.totalAssets),
      debtToCapital: this.debtToCapital(d.totalDebt, d.totalEquity),
      debtToEquity: this.debtToEquity(d.totalDebt, d.totalEquity),
      financialLeverage: this.financialLeverage(avgA, avgE),
      debtToEBITDA: this.debtToEBITDA(d.totalDebt, d.ebitda),
      netDebt: this.netDebt(
        d.totalDebt,
        d.cash ?? 0,
        d.cashEquivalents ?? 0,
        d.shortTermInvestments ?? 0
      ),
      interestCoverage: this.interestCoverage(d.ebit, d.interestExpense),
      fixedChargeCoverage: this.fixedChargeCoverage(
        d.ebit,
        d.leasePayments ?? 0,
        d.interestExpense
      ),
    }
  },
}

// ─────────────────────────────────────────────────────────
// 4. PROFITABILITY RATIOS
// CFA FSA LM 11 — Profitability Ratios
// ─────────────────────────────────────────────────────────

export const ProfitabilityRatios = {
  grossMargin(gp: number, rev: number): RatioResult | null {
    if (rev === 0) return null
    const v = gp / rev
    return {
      value: v * 100,
      unit: '%',
      better: 'higher',
      interpretation:
        v >= 0.5
          ? 'High gross margin — strong pricing/cost advantage'
          : v >= 0.3
            ? 'Healthy gross margin — typical for manufacturing/industrial'
            : v >= 0.15
              ? 'Thin gross margin — commodity/capital-intensive business'
              : 'Very thin gross margin — scrutinize pricing and input costs',
    }
  },
  operatingMargin(oi: number, rev: number): RatioResult | null {
    if (rev === 0) return null
    return { value: (oi / rev) * 100, unit: '%', better: 'higher' }
  },
  pretaxMargin(ebt: number, rev: number): RatioResult | null {
    if (rev === 0) return null
    return { value: (ebt / rev) * 100, unit: '%', better: 'higher' }
  },
  netProfitMargin(ni: number, rev: number): RatioResult | null {
    if (rev === 0) return null
    const v = ni / rev
    return {
      value: v * 100,
      unit: '%',
      better: 'higher',
      interpretation:
        v >= 0.2
          ? 'Excellent net margin — premium business'
          : v >= 0.1
            ? 'Good net margin — efficient operations'
            : v >= 0.05
              ? 'Adequate margin — typical for capital-intensive sectors'
              : v >= 0
                ? 'Thin margin — vulnerable to cost shocks'
                : 'Negative margin — loss-making; assess path to profitability',
    }
  },
  ebitdaMargin(ebitda: number, rev: number): RatioResult | null {
    if (rev === 0) return null
    return { value: (ebitda / rev) * 100, unit: '%', better: 'higher' }
  },
  roa(ni: number, avgAssets: number): RatioResult | null {
    if (avgAssets === 0) return null
    return { value: (ni / avgAssets) * 100, unit: '%', better: 'higher' }
  },
  roaAdjusted(
    ni: number,
    intExp: number,
    taxRate: number,
    avgAssets: number
  ): RatioResult | null {
    if (avgAssets === 0) return null
    const adjusted = ni + intExp * (1 - taxRate)
    return { value: (adjusted / avgAssets) * 100, unit: '%', better: 'higher' }
  },
  operatingROA(ebit: number, avgAssets: number): RatioResult | null {
    if (avgAssets === 0) return null
    return { value: (ebit / avgAssets) * 100, unit: '%', better: 'higher' }
  },
  roe(ni: number, begin: number, end: number): RatioResult | null {
    const avg = (begin + end) / 2
    if (avg === 0) return null
    const v = (ni / avg) * 100
    return {
      value: v,
      unit: '%',
      better: 'higher',
      interpretation:
        v >= 20
          ? 'Excellent ROE — exceptional shareholder returns'
          : v >= 15
            ? 'Good ROE — strong returns for shareholders'
            : v >= 10
              ? 'Adequate ROE — meets typical cost of equity'
              : v >= 0
                ? 'Below-average ROE — may not cover cost of equity'
                : 'Negative ROE — destroying shareholder value',
    }
  },
  returnOnCommonEquity(
    ni: number,
    pfd: number,
    begin: number,
    end: number
  ): RatioResult | null {
    const avg = (begin + end) / 2
    if (avg === 0) return null
    return { value: ((ni - pfd) / avg) * 100, unit: '%', better: 'higher' }
  },
  roic(
    ebit: number,
    taxRate: number,
    begin: number,
    end: number
  ): RatioResult | null {
    const avg = (begin + end) / 2
    if (avg === 0) return null
    const nopat = ebit * (1 - taxRate)
    return {
      value: (nopat / avg) * 100,
      unit: '%',
      better: 'higher',
      note: 'ROIC > WACC indicates value creation; ROIC < WACC destroys value',
    }
  },
  computeAll(d: ProfitabilityInputs): ProfitabilityRatiosOutput {
    const avgA = (d.totalAssetsBegin + d.totalAssetsEnd) / 2
    const taxRate = d.taxRate ?? 0.25
    return {
      grossMargin: this.grossMargin(d.grossProfit, d.revenue),
      operatingMargin: this.operatingMargin(d.operatingIncome, d.revenue),
      pretaxMargin: this.pretaxMargin(d.ebt, d.revenue),
      netProfitMargin: this.netProfitMargin(d.netIncome, d.revenue),
      ebitdaMargin: this.ebitdaMargin(d.ebitda, d.revenue),
      roa: this.roa(d.netIncome, avgA),
      roaAdjusted: this.roaAdjusted(d.netIncome, d.interestExpense ?? 0, taxRate, avgA),
      operatingROA: this.operatingROA(d.ebit, avgA),
      roe: this.roe(d.netIncome, d.totalEquityBegin, d.totalEquityEnd),
      returnOnCommonEquity: this.returnOnCommonEquity(
        d.netIncome,
        d.preferredDividends ?? 0,
        d.commonEquityBegin ?? d.totalEquityBegin,
        d.commonEquityEnd ?? d.totalEquityEnd
      ),
      roic:
        d.investedCapitalBegin != null && d.investedCapitalEnd != null
          ? this.roic(d.ebit, taxRate, d.investedCapitalBegin, d.investedCapitalEnd)
          : null,
    }
  },
}

// ─────────────────────────────────────────────────────────
// 5. DUPONT 5-WAY ROE DECOMPOSITION
// CFA FSA LM 11
// ─────────────────────────────────────────────────────────

function fiveWayNarrative(
  taxBurden: number,
  interestBurden: number,
  ebitMargin: number,
  assetTurnover: number,
  leverage: number
): string[] {
  const insights: string[] = []
  if (ebitMargin < 0.05)
    insights.push('⚠ EBIT margin is very thin (<5%) — operating profitability is the primary concern')
  else if (ebitMargin > 0.2)
    insights.push('✓ Strong EBIT margin (>20%) — operating profitability is a competitive advantage')
  if (interestBurden < 0.8)
    insights.push(
      `⚠ Significant interest burden — only ${(interestBurden * 100).toFixed(0)}% of EBIT flows to EBT; high leverage cost`
    )
  else if (interestBurden > 0.95)
    insights.push('✓ Low interest burden — minimal debt costs relative to operating earnings')
  if (taxBurden < 0.65)
    insights.push(
      `⚠ High effective tax rate — only keeping ${(taxBurden * 100).toFixed(0)}% of pretax profit`
    )
  else if (taxBurden > 0.8)
    insights.push('✓ Low effective tax rate — favorable tax position')
  if (assetTurnover < 0.5)
    insights.push('⚠ Low asset turnover (<0.5×) — capital-intensive model or underutilized assets')
  else if (assetTurnover > 1.5)
    insights.push('✓ High asset turnover (>1.5×) — efficient asset utilization')
  if (leverage > 3.0)
    insights.push(
      `⚠ High leverage (${leverage.toFixed(1)}×) — ROE is significantly amplified by debt; higher financial risk`
    )
  else if (leverage < 1.5)
    insights.push(
      '✓ Conservative leverage — equity-financed balance sheet; may indicate under-leveraging'
    )
  return insights
}

export const DuPontAnalysis = {
  fiveWay(
    netIncome: number,
    ebt: number,
    ebit: number,
    revenue: number,
    avgAssets: number,
    avgEquity: number
  ): DuPontFiveWay {
    // Guard against div-by-zero — return a sensible zeroed record instead
    const safe = (n: number, d: number) => (d === 0 ? 0 : n / d)
    const taxBurden = safe(netIncome, ebt) // NI / EBT
    const interestBurden = safe(ebt, ebit) // EBT / EBIT
    const ebitMargin = safe(ebit, revenue)
    const assetTurnover = safe(revenue, avgAssets)
    const leverage = safe(avgAssets, avgEquity)

    const roe = taxBurden * interestBurden * ebitMargin * assetTurnover * leverage
    const effTaxRate = (1 - taxBurden) * 100

    return {
      roe: roe * 100,
      components: {
        taxBurden: {
          value: taxBurden,
          pct: taxBurden * 100,
          label: 'Tax Burden',
          formula: 'Net Income / EBT',
          interpretation: `Effective tax rate: ${effTaxRate.toFixed(1)}%. Company keeps ${(
            taxBurden * 100
          ).toFixed(1)}% of pretax profits.`,
        },
        interestBurden: {
          value: interestBurden,
          pct: interestBurden * 100,
          label: 'Interest Burden',
          formula: 'EBT / EBIT',
          interpretation: `${(interestBurden * 100).toFixed(
            1
          )}% of EBIT reaches EBT after interest. ${(
            (1 - interestBurden) *
            100
          ).toFixed(1)}% consumed by interest.`,
        },
        ebitMargin: {
          value: ebitMargin * 100,
          label: 'EBIT Margin',
          formula: 'EBIT / Revenue',
          interpretation: `Operating profitability: ${(ebitMargin * 100).toFixed(
            2
          )}% of revenue reaches EBIT.`,
        },
        assetTurnover: {
          value: assetTurnover,
          label: 'Total Asset Turnover',
          formula: 'Revenue / Avg Total Assets',
          interpretation: `Asset efficiency: ₹${assetTurnover.toFixed(
            2
          )} revenue per ₹1 of assets.`,
        },
        leverage: {
          value: leverage,
          label: 'Financial Leverage',
          formula: 'Avg Total Assets / Avg Total Equity',
          interpretation: `Each ₹1 of equity supports ₹${leverage.toFixed(2)} of assets.`,
        },
      },
      roa: ebitMargin * assetTurnover * 100,
      check: Math.abs(roe - safe(netIncome, avgEquity)) < 0.01,
      narrative: fiveWayNarrative(taxBurden, interestBurden, ebitMargin, assetTurnover, leverage),
    }
  },
}

// ─────────────────────────────────────────────────────────
// 6. CASH FLOW RATIOS
// CFA FSA LM 5
// ─────────────────────────────────────────────────────────

export const CashFlowRatios = {
  fcfe(cfo: number, capex: number, netBorrowing: number): RatioResult {
    return { value: cfo - capex + netBorrowing, unit: '₹', better: 'higher' }
  },
  fcff_fromCFO(cfo: number, intExp: number, taxRate: number, capex: number): RatioResult {
    return {
      value: cfo + intExp * (1 - taxRate) - capex,
      unit: '₹',
      better: 'higher',
    }
  },
  fcff_fromEBIT(
    ebit: number,
    taxRate: number,
    da: number,
    dnwc: number,
    capex: number
  ): RatioResult {
    return { value: ebit * (1 - taxRate) + da - dnwc - capex, unit: '₹', better: 'higher' }
  },
  cashFlowCoverage(cfo: number, totalDebt: number): RatioResult | null {
    if (totalDebt === 0) return null
    const v = cfo / totalDebt
    return {
      value: v * 100,
      unit: '%',
      better: 'higher',
      interpretation:
        v >= 0.3
          ? 'Strong cash coverage of debt'
          : v >= 0.15
            ? 'Adequate cash coverage'
            : 'Weak cash coverage — debt service dependent on non-operating inflows',
    }
  },
  cfoToNetIncome(cfo: number, netIncome: number): RatioResult | null {
    if (netIncome === 0) return null
    const v = cfo / netIncome
    return {
      value: v,
      better: 'near 1.0',
      interpretation:
        v > 1.2
          ? 'CFO > Net income: cash-backed earnings — positive quality signal'
          : v >= 0.8
            ? 'Near 1.0: earnings well-backed by cash flows — normal quality'
            : v >= 0.5
              ? 'CFO significantly below net income: investigate accruals'
              : 'Large divergence: high accruals — potential earnings quality concern',
    }
  },
  accrualsRatioBS(
    netIncome: number,
    cfo: number,
    cfi: number,
    noaBegin: number,
    noaEnd: number
  ): RatioResult | null {
    const avgNOA = (noaBegin + noaEnd) / 2
    if (avgNOA === 0) return null
    const accruals = netIncome - cfo - cfi
    const v = accruals / avgNOA
    return {
      value: v * 100,
      unit: '%',
      better: 'near 0',
      note: 'Near-zero or negative = cash-backed earnings (higher quality)',
      interpretation:
        Math.abs(v) < 0.05
          ? 'Low accruals — high earnings quality'
          : v > 0.1
            ? 'High positive accruals — investigate non-cash earnings drivers'
            : v < -0.1
              ? 'High negative accruals — may indicate conservative accounting'
              : 'Moderate accruals — review year-over-year trend',
    }
  },
  capexCoverage(cfo: number, capex: number): RatioResult | null {
    if (capex === 0) return null
    const v = cfo / capex
    return {
      value: v,
      unit: 'x',
      better: 'higher',
      interpretation:
        v >= 2.0
          ? 'Comfortably self-funding CapEx from operations'
          : v >= 1.0
            ? 'CFO covers CapEx — no external financing needed'
            : 'CFO insufficient to fund CapEx — requires external financing',
    }
  },
  computeAll(d: CashFlowInputs): CashFlowOutput {
    const taxRate = d.taxRate ?? 0.25
    const da = d.da ?? 0
    const dnwc = d.changeInNWC ?? 0
    return {
      fcfe: this.fcfe(d.cfo, d.capex, d.netBorrowing ?? 0),
      fcff_fromCFO: this.fcff_fromCFO(d.cfo, d.interestExpense ?? 0, taxRate, d.capex),
      fcff_fromEBIT: this.fcff_fromEBIT(d.ebit, taxRate, da, dnwc, d.capex),
      cashFlowCoverage: this.cashFlowCoverage(d.cfo, d.totalDebt),
      cfoToNetIncome: this.cfoToNetIncome(d.cfo, d.netIncome),
      accrualsBSRatio:
        d.noaBegin != null && d.noaEnd != null
          ? this.accrualsRatioBS(d.netIncome, d.cfo, d.cfi ?? 0, d.noaBegin, d.noaEnd)
          : null,
      capexCoverage: this.capexCoverage(d.cfo, d.capex),
    }
  },
}

// ─────────────────────────────────────────────────────────
// 7. VALUATION RATIOS (market-based)
// CFA FSA LM 12
// ─────────────────────────────────────────────────────────

export const ValuationRatios = {
  peRatio(price: number, eps: number): RatioResult | null {
    if (eps <= 0) return null
    const v = price / eps
    return {
      value: v,
      unit: 'x',
      better: 'context',
      interpretation:
        v < 10
          ? 'Low P/E — value territory; assess earnings quality'
          : v < 20
            ? 'Moderate P/E — typical for mature/slower growth'
            : v < 35
              ? 'High P/E — growth expectations priced in'
              : 'Very high P/E — hyper-growth or overvalued; compare to PEG',
    }
  },
  pbRatio(price: number, bvps: number): RatioResult | null {
    if (bvps <= 0) return null
    return { value: price / bvps, unit: 'x', better: 'context' }
  },
  psRatio(mktCap: number, rev: number): RatioResult | null {
    if (rev === 0) return null
    return { value: mktCap / rev, unit: 'x', better: 'context' }
  },
  evToEBITDA(ev: number, ebitda: number): RatioResult | null {
    if (ebitda <= 0) return null
    const v = ev / ebitda
    return {
      value: v,
      unit: 'x',
      better: 'context',
      interpretation:
        v < 8
          ? 'Cheap/distressed'
          : v < 12
            ? 'Value to fair value range'
            : v < 20
              ? 'Fair to somewhat expensive'
              : v < 30
                ? 'Growth premium'
                : 'Very expensive or distorted earnings',
    }
  },
  evToEBIT(ev: number, ebit: number): RatioResult | null {
    if (ebit <= 0) return null
    return { value: ev / ebit, unit: 'x', better: 'context' }
  },
  evToRevenue(ev: number, rev: number): RatioResult | null {
    if (rev === 0) return null
    return { value: ev / rev, unit: 'x', better: 'context' }
  },
  enterpriseValue(mktCap: number, debt: number, cash: number, ce = 0): number {
    return mktCap + debt - cash - ce
  },
  pegRatio(pe: number | undefined | null, epsGrowthPct: number): RatioResult | null {
    if (!pe || epsGrowthPct <= 0) return null
    const v = pe / epsGrowthPct
    return {
      value: v,
      better: 'lower',
      interpretation:
        v < 0.5
          ? 'Potentially significantly undervalued vs growth'
          : v < 1.0
            ? 'Attractively priced relative to growth'
            : v < 1.5
              ? 'Fairly valued relative to growth'
              : 'Expensive relative to growth rate',
    }
  },
  dividendYield(dps: number, price: number): RatioResult | null {
    if (price === 0) return null
    return { value: (dps / price) * 100, unit: '%' }
  },
  computeAll(d: ValuationInputs): ValuationOutput {
    const ev = this.enterpriseValue(
      d.marketCap,
      d.totalDebt,
      d.cash ?? 0,
      d.cashEquivalents ?? 0
    )
    const pe = this.peRatio(d.pricePerShare, d.eps)
    return {
      peRatio: pe,
      pbRatio: this.pbRatio(d.pricePerShare, d.bvps),
      psRatio: this.psRatio(d.marketCap, d.revenue),
      evToEBITDA: this.evToEBITDA(ev, d.ebitda),
      evToEBIT: this.evToEBIT(ev, d.ebit),
      evToRevenue: this.evToRevenue(ev, d.revenue),
      pegRatio: this.pegRatio(pe?.value, d.epsGrowthRate ?? 0),
      dividendYield: this.dividendYield(d.dps ?? 0, d.pricePerShare),
      enterpriseValue: ev,
    }
  },
}

// ─────────────────────────────────────────────────────────
// 8. ASSET AGE / DEPRECIATION ANALYSIS
// CFA FSA LM 6
// ─────────────────────────────────────────────────────────

export const AssetAnalysis = {
  averageAssetAge(accumDep: number, annualDep: number): RatioResult | null {
    if (annualDep === 0) return null
    return { value: accumDep / annualDep, unit: 'years' }
  },
  estimatedRemainingLife(netPPE: number, annualDep: number): RatioResult | null {
    if (annualDep === 0) return null
    return { value: netPPE / annualDep, unit: 'years' }
  },
  estimatedTotalLife(grossPPE: number, annualDep: number): RatioResult | null {
    if (annualDep === 0) return null
    return { value: grossPPE / annualDep, unit: 'years' }
  },
  relativeAge(accumDep: number, grossPPE: number): RatioResult | null {
    if (grossPPE === 0) return null
    const pct = (accumDep / grossPPE) * 100
    return {
      value: pct,
      unit: '%',
      interpretation:
        pct < 25
          ? 'Young asset base — recent capital investment'
          : pct < 50
            ? 'Mid-life assets — moderate reinvestment cycle'
            : pct < 75
              ? 'Aging asset base — significant reinvestment likely soon'
              : 'Very old asset base — near end of useful life',
    }
  },
  capexToDepreciation(capex: number, da: number): RatioResult | null {
    if (da === 0) return null
    const v = capex / da
    return {
      value: v,
      better: '>1.0',
      interpretation:
        v >= 2.0
          ? 'Aggressive growth capex — expanding capacity'
          : v >= 1.0
            ? 'Maintenance + moderate growth capex'
            : v >= 0.7
              ? 'Possible underinvestment — monitor'
              : 'Underinvesting — asset base likely deteriorating',
    }
  },
}

// ─────────────────────────────────────────────────────────
// 9. EARNINGS QUALITY INDICATORS
// CFA FSA LM 11
// ─────────────────────────────────────────────────────────

export const EarningsQuality = {
  cfoQualityCheck(cfo: number, netIncome: number) {
    if (netIncome === 0) return null
    const ratio = cfo / netIncome
    return {
      ratio,
      qualitySignal: (ratio >= 0.8
        ? 'HIGH_QUALITY'
        : ratio >= 0.5
          ? 'MODERATE'
          : 'CONCERN') as 'HIGH_QUALITY' | 'MODERATE' | 'CONCERN',
      redFlag: ratio < 0.5,
      note:
        ratio < 0.5
          ? 'Warning: CFO is less than half of net income — investigate receivables, inventory, and revenue timing'
          : ratio > 1.5
            ? 'Note: CFO significantly exceeds net income — possibly conservative accounting; verify D&A levels'
            : 'Normal range — earnings appear cash-backed',
    }
  },
}

// ─────────────────────────────────────────────────────────
// 10. TAX ANALYSIS
// ─────────────────────────────────────────────────────────

export const TaxAnalysis = {
  effectiveTaxRate(taxExp: number, pretaxIncome: number): number | null {
    if (pretaxIncome === 0) return null
    return (taxExp / pretaxIncome) * 100
  },
}

// ─────────────────────────────────────────────────────────
// 11. SCORING ENGINE
// Mirrors the reference implementation's acquisition-style FSA score
// ─────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function scoreCompany(
  profitability: ProfitabilityRatiosOutput,
  solvency: SolvencyRatiosOutput,
  liquidity: LiquidityRatiosOutput,
  activity: ActivityRatiosOutput,
  cashflow: CashFlowOutput
): FSAScore {
  const breakdown = {
    profitability: 0,
    solvency: 0,
    liquidity: 0,
    efficiency: 0,
    cashFlowQuality: 0,
  }

  const ebm = profitability.ebitdaMargin?.value ?? 0
  const roe = profitability.roe?.value ?? 0
  const npm = profitability.netProfitMargin?.value ?? 0
  breakdown.profitability = Math.min(
    25,
    Math.round(((ebm / 20 + roe / 20 + npm / 10) * 25) / 3)
  )

  const de = solvency.debtToEquity?.value
  const ic = solvency.interestCoverage?.value
  const deScore = de != null ? Math.max(0, 10 - de * 2) : 5
  const icScore = ic != null ? Math.min(10, ic) : 5
  breakdown.solvency = Math.min(20, Math.round(deScore + icScore))

  const cr = liquidity.currentRatio?.value ?? 0
  const qr = liquidity.quickRatio?.value ?? 0
  breakdown.liquidity = Math.min(
    15,
    Math.round((Math.min(cr, 3) / 3 + Math.min(qr, 2) / 2) * 7.5)
  )

  const tat = activity.totalAssetTurnover?.value ?? 0
  const ccc = activity.cashConversionCycle?.value
  const tatScore = Math.min(10, tat * 5)
  const cccScore =
    ccc == null ? 5 : ccc < 0 ? 10 : ccc < 30 ? 8 : ccc < 60 ? 6 : ccc < 90 ? 4 : 2
  breakdown.efficiency = Math.min(20, Math.round(tatScore + cccScore))

  const cfoRatio = cashflow.cfoToNetIncome?.value ?? 1
  const fcff = cashflow.fcff_fromCFO?.value ?? 0
  const cfoScore = cfoRatio >= 0.8 ? 10 : cfoRatio >= 0.5 ? 7 : 4
  const fcffScore = fcff > 0 ? 10 : fcff > -500 ? 5 : 2
  breakdown.cashFlowQuality = Math.min(20, Math.round(cfoScore + fcffScore))

  const total = clamp(
    breakdown.profitability +
      breakdown.solvency +
      breakdown.liquidity +
      breakdown.efficiency +
      breakdown.cashFlowQuality,
    0,
    100
  )

  return {
    total,
    breakdown,
    grade:
      total >= 80
        ? 'A — Strong'
        : total >= 65
          ? 'B — Good'
          : total >= 50
            ? 'C — Adequate'
            : total >= 35
              ? 'D — Weak'
              : 'F — Distressed',
  }
}

// ─────────────────────────────────────────────────────────
// 12. NARRATIVE GENERATOR
// ─────────────────────────────────────────────────────────

function generateNarrative(
  company: string,
  profitability: ProfitabilityRatiosOutput,
  solvency: SolvencyRatiosOutput,
  liquidity: LiquidityRatiosOutput,
  activity: ActivityRatiosOutput,
  quality: { cfoQuality: { redFlag: boolean; note: string } | null },
  dupont: DuPontFiveWay,
  scores: FSAScore
): string {
  const lines: string[] = []
  lines.push(`## Financial Analysis: ${company}`)
  lines.push(`**Overall Score: ${scores.total}/100 — ${scores.grade}**\n`)

  const ebm = profitability.ebitdaMargin?.value
  const npm = profitability.netProfitMargin?.value
  if (ebm != null && npm != null) {
    lines.push('### Profitability')
    lines.push(
      `EBITDA margin of ${ebm.toFixed(1)}% and net margin of ${npm.toFixed(
        1
      )}% indicate ${
        ebm > 25
          ? 'strong pricing power and cost control, above typical industrial benchmarks'
          : ebm > 15
            ? 'adequate profitability — in line with mid-tier industrial peers'
            : 'thin margins characteristic of capital-intensive or commodity businesses'
      }.`
    )
    lines.push(
      `**DuPont Analysis:** ROE of ${dupont.roe.toFixed(2)}% is primarily driven by ${
        dupont.components.ebitMargin.value > 10
          ? 'solid operating margins'
          : 'leverage rather than operational strength'
      }. ${dupont.narrative.join(' ')}`
    )
  }

  const de = solvency.debtToEquity?.value
  const ic = solvency.interestCoverage?.value
  if (de != null) {
    lines.push('\n### Leverage & Solvency')
    lines.push(
      `${de < 1 ? 'Conservative balance sheet' : de < 2 ? 'Moderate leverage' : 'High leverage'} with D/E of ${de.toFixed(
        2
      )}×.${
        ic != null
          ? ` Interest coverage of ${ic.toFixed(1)}× ${
              ic >= 3
                ? 'is comfortable'
                : ic >= 1.5
                  ? 'is adequate but warrants monitoring'
                  : 'is dangerously thin'
            }.`
          : ''
      }`
    )
  }

  const cr = liquidity.currentRatio?.value
  const ccc = activity.cashConversionCycle?.value
  if (cr != null) {
    lines.push('\n### Liquidity')
    lines.push(
      `Current ratio of ${cr.toFixed(2)}× ${
        cr >= 1.5
          ? 'provides a comfortable liquidity buffer'
          : cr >= 1.0
            ? 'is minimal — monitor working capital closely'
            : 'is below 1.0 — potential short-term liquidity stress'
      }.${
        ccc != null
          ? ` Cash conversion cycle of ${Math.round(ccc)} days ${
              ccc < 0
                ? '(negative — company collects before paying)'
                : ccc < 40
                  ? '(efficient working capital management)'
                  : '(relatively long — capital tied up in operations)'
            }.`
          : ''
      }`
    )
  }

  const cfoQ = quality.cfoQuality
  if (cfoQ) {
    lines.push('\n### Earnings Quality')
    lines.push(cfoQ.note)
    if (cfoQ.redFlag) {
      lines.push(
        `⚠ **Red Flag:** Significant divergence between CFO and net income — review accruals and receivables aging.`
      )
    }
  }

  lines.push(
    `\n*Analysis based on CFA FSA Framework (LM 11 & 12). Ratios should be compared to industry peers and prior-year trend for full context.*`
  )
  return lines.join('\n')
}

// ─────────────────────────────────────────────────────────
// 13. FULL ORCHESTRATOR
// ─────────────────────────────────────────────────────────

export function runFullFinancialAnalysis(company: string, inputs: FSAInputs): FSAResult {
  const taxRate = inputs.taxRate ?? 0.25
  const days = inputs.daysInPeriod ?? 365

  // Defensive defaults so partial data still produces a result
  const revenue = inputs.revenue
  const cogs = inputs.cogs ?? 0
  const grossProfit = inputs.grossProfit ?? (revenue - cogs)
  const opex = inputs.operatingExpenses ?? 0
  const ebitda = inputs.ebitda ?? 0
  const da = inputs.da ?? 0
  const ebit = inputs.ebit ?? Math.max(0, ebitda - da)
  const intExp = inputs.interestExpense ?? 0
  const ebt = inputs.ebt ?? (ebit - intExp)
  const taxExp = inputs.taxExpense ?? ebt * taxRate
  const netIncome = inputs.netIncome ?? (ebt - taxExp)

  const taEnd = inputs.totalAssetsEnd ?? 0
  const taBegin = inputs.totalAssetsBegin ?? taEnd * 0.9
  const eqEnd = inputs.totalEquityEnd ?? 0
  const eqBegin = inputs.totalEquityBegin ?? eqEnd * 0.9
  const avgAssets = (taBegin + taEnd) / 2
  const avgEquity = (eqBegin + eqEnd) / 2

  const cash = inputs.cash ?? 0
  const sti = inputs.shortTermInvestments ?? 0
  const receivables = inputs.receivables ?? 0
  const inventory = inputs.inventory ?? 0
  const currentAssets = inputs.currentAssets ?? 0
  const currentLiabilities = inputs.currentLiabilities ?? 0
  const totalDebt = inputs.totalDebt ?? 0
  const grossPPE = inputs.grossPPE ?? 0
  const accumDep = inputs.accumulatedDepreciation ?? 0
  const netPPE = grossPPE - accumDep

  const activity = ActivityRatios.computeAll({
    revenue,
    cogs,
    inventoryBegin: inputs.inventoryBegin ?? 0,
    inventoryEnd: inputs.inventoryEnd ?? inventory,
    receivablesBegin: inputs.receivablesBegin ?? 0,
    receivablesEnd: inputs.receivablesEnd ?? receivables,
    payablesBegin: inputs.payablesBegin ?? 0,
    payablesEnd: inputs.payablesEnd ?? 0,
    fixedAssetsBegin: inputs.fixedAssetsBegin ?? 0,
    fixedAssetsEnd: inputs.fixedAssetsEnd ?? 0,
    totalAssetsBegin: taBegin,
    totalAssetsEnd: taEnd,
    daysInPeriod: days,
  })

  const liquidity = LiquidityRatios.computeAll({
    cash,
    shortTermInvestments: sti,
    receivables,
    inventory,
    currentAssets,
    currentLiabilities,
    cogs,
    sga: opex,
    rnd: 0,
    depreciation: da,
    daysInPeriod: days,
    doh: activity.daysInventoryOnHand?.value,
    dso: activity.daysSalesOutstanding?.value,
    daysPayables: activity.daysPayables?.value,
  })

  const solvency = SolvencyRatios.computeAll({
    totalDebt,
    totalAssets: taEnd,
    totalEquity: eqEnd,
    netIncome,
    totalAssetsBegin: taBegin,
    totalAssetsEnd: taEnd,
    totalEquityBegin: eqBegin,
    totalEquityEnd: eqEnd,
    ebit,
    ebitda,
    interestExpense: intExp,
    leasePayments: inputs.leasePayments ?? 0,
    cash,
    shortTermInvestments: sti,
  })

  const profitability = ProfitabilityRatios.computeAll({
    revenue,
    grossProfit,
    operatingIncome: ebit,
    ebt,
    netIncome,
    ebitda,
    ebit,
    interestExpense: intExp,
    taxRate,
    preferredDividends: inputs.preferredDividends ?? 0,
    totalAssetsBegin: taBegin,
    totalAssetsEnd: taEnd,
    totalEquityBegin: eqBegin,
    totalEquityEnd: eqEnd,
    commonEquityBegin: eqBegin,
    commonEquityEnd: eqEnd,
    investedCapitalBegin: inputs.investedCapitalBegin,
    investedCapitalEnd: inputs.investedCapitalEnd,
  })

  const dupont = DuPontAnalysis.fiveWay(netIncome, ebt, ebit, revenue, avgAssets, avgEquity)

  const cfo = inputs.cfo ?? netIncome + da
  const capex = inputs.capex ?? da * 1.2
  const cashflow = CashFlowRatios.computeAll({
    cfo,
    cfi: inputs.cfi ?? 0,
    cff: inputs.cff ?? 0,
    capex,
    netBorrowing: 0,
    netIncome,
    ebit,
    taxRate,
    interestExpense: intExp,
    totalDebt,
    da,
  })

  const marketCap = (inputs.pricePerShare ?? 0) * (inputs.sharesOutstanding ?? 0)
  const valuation = ValuationRatios.computeAll({
    pricePerShare: inputs.pricePerShare ?? 0,
    eps: inputs.eps ?? 0,
    bvps: inputs.bvps ?? 0,
    revenue,
    marketCap,
    ebitda,
    ebit,
    totalDebt,
    cash,
    cashEquivalents: sti,
    dps: 0,
    epsGrowthRate: inputs.epsGrowthRate ?? 0,
    sharesOutstanding: inputs.sharesOutstanding,
  })

  const assetAnalysis = {
    averageAge: AssetAnalysis.averageAssetAge(accumDep, da),
    remainingLife: AssetAnalysis.estimatedRemainingLife(netPPE, da),
    totalEstimatedLife: AssetAnalysis.estimatedTotalLife(grossPPE, da),
    relativeAge: AssetAnalysis.relativeAge(accumDep, grossPPE),
    capexToDep: AssetAnalysis.capexToDepreciation(capex, da),
  }

  const quality = {
    cfoQuality: EarningsQuality.cfoQualityCheck(cfo, netIncome),
    accrualsRatio: cashflow.accrualsBSRatio,
    effectiveTaxRate: TaxAnalysis.effectiveTaxRate(taxExp, ebt),
  }

  const scores = scoreCompany(profitability, solvency, liquidity, activity, cashflow)

  const narrative = generateNarrative(
    company,
    profitability,
    solvency,
    liquidity,
    activity,
    quality,
    dupont,
    scores
  )

  return {
    company,
    analysisDate: new Date().toLocaleDateString('en-IN'),
    summary: {
      revenue,
      ebitda,
      ebit,
      netIncome,
      cfo,
      marketCap,
      ebitdaMargin: profitability.ebitdaMargin?.value,
      netMargin: profitability.netProfitMargin?.value,
      roe: dupont.roe,
      debtToEBITDA: solvency.debtToEBITDA?.value,
      currentRatio: liquidity.currentRatio?.value,
      score: scores.total,
      scoreBreakdown: scores,
    },
    ratios: { activity, liquidity, solvency, profitability },
    dupont,
    cashflow,
    valuation,
    assetAnalysis,
    quality,
    narrative,
  }
}
