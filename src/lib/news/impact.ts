/**
 * Heuristic impact estimator — turns a news item into a structured
 * impact record with sentiment, category, materiality, and an estimated
 * EV/EBITDA multiple delta. The numbers are deliberately conservative;
 * this is a triage helper, not an investment model.
 */

import type { Company } from '@/lib/data/companies'
import type { NewsItem } from './api'
import {
  POSITIVE_KEYWORDS,
  NEGATIVE_KEYWORDS,
  POLICY_KEYWORDS,
  CHAIN_KEYWORDS,
  INDUSTRY_KEYWORDS,
  COMPANY_ALIASES,
} from './keywords'
import {
  computeParamDegrees,
  effectiveAdjustmentFactor,
  type ValuationParam,
} from './params'

export type NewsSentiment = 'positive' | 'negative' | 'neutral'
export type NewsMateriality = 'low' | 'medium' | 'high'
export type NewsCategory =
  | 'regulatory'
  | 'operational'
  | 'financial'
  | 'strategic'
  | 'market'
  | 'other'

export interface NewsImpact {
  sentiment: NewsSentiment
  /** Clamped -5..+5 */
  sentimentScore: number
  materiality: NewsMateriality
  category: NewsCategory
  /** Legacy summary — estimated % change to fair EV/EBITDA multiple. */
  multipleDeltaPct: number
  /** Per-parameter auto degrees (0..100, unsigned magnitudes). Direction
   *  comes from sentiment combined with each parameter's polarity. */
  affectedParams: Partial<Record<ValuationParam, number>>
  affectedCompanies: string[] // tickers
  affectedChainSegments: string[] // CHAIN ids
  affectedIndustries: Array<'solar' | 'td'>
  sentimentKeywords: string[]
  rationale: string
  isPolicy: boolean
}

function searchableText(item: NewsItem): string {
  return `${item.title} ${item.description}`.toLowerCase()
}

function scoreSentiment(text: string): {
  score: number
  matches: string[]
} {
  let score = 0
  const matches: string[] = []
  for (const word of POSITIVE_KEYWORDS) {
    if (text.includes(word)) {
      score += 1
      matches.push(`+${word}`)
    }
  }
  for (const word of NEGATIVE_KEYWORDS) {
    if (text.includes(word)) {
      score -= 1
      matches.push(`-${word}`)
    }
  }
  score = Math.max(-5, Math.min(5, score))
  return { score, matches }
}

function detectCompanies(text: string, companies: Company[]): string[] {
  const matches: string[] = []
  for (const c of companies) {
    const aliases = COMPANY_ALIASES[c.ticker] || []
    // Always try the first word of the company name (e.g. "Polycab") and
    // any explicit aliases. Short tickers (<4 chars) skip the ticker itself
    // to avoid false positives like "KEC" matching "kec" inside other words.
    const firstWord = c.name.split(/\s+/)[0].toLowerCase()
    const candidates = [
      c.name.toLowerCase(),
      firstWord,
      ...aliases.map((a) => a.toLowerCase()),
    ]
    if (c.ticker.length >= 5) {
      candidates.push(c.ticker.toLowerCase())
    }
    for (const cand of candidates) {
      if (cand.length >= 4 && text.includes(cand)) {
        matches.push(c.ticker)
        break
      }
    }
  }
  return Array.from(new Set(matches))
}

function detectChainSegments(text: string): string[] {
  const matches = new Set<string>()
  for (const [id, kws] of Object.entries(CHAIN_KEYWORDS)) {
    for (const kw of kws) {
      if (text.includes(kw)) {
        matches.add(id)
        break
      }
    }
  }
  return Array.from(matches)
}

function detectIndustries(text: string): Array<'solar' | 'td'> {
  const out: Array<'solar' | 'td'> = []
  if (INDUSTRY_KEYWORDS.solar.some((k) => text.includes(k))) out.push('solar')
  if (INDUSTRY_KEYWORDS.td.some((k) => text.includes(k))) out.push('td')
  return out
}

function detectPolicy(text: string): boolean {
  return POLICY_KEYWORDS.some((k) => text.includes(k))
}

function classifyCategory(text: string, isPolicy: boolean): NewsCategory {
  if (isPolicy) return 'regulatory'
  if (
    /\b(acquires|acquisition|merger|stake|joint venture|jv|divest|spinoff|buyout|takeover)\b/i.test(
      text
    )
  )
    return 'strategic'
  if (
    /\b(revenue|profit|ebitda|margin|earnings|results|quarterly|guidance|debt|borrowings|dividend)\b/i.test(
      text
    )
  )
    return 'financial'
  if (
    /\b(capacity|commissioning|plant|factory|ramp-up|production|manufacturing|order|contract)\b/i.test(
      text
    )
  )
    return 'operational'
  if (/\b(stock|share|rally|crash|ipo|listing|market cap|buyback)\b/i.test(text))
    return 'market'
  return 'other'
}

function estimateMultipleDelta(
  sentimentScore: number,
  materiality: NewsMateriality,
  category: NewsCategory
): number {
  // Each sentiment point ≈ 0.4% multiple delta at HIGH materiality,
  // modulated by category weight.
  const matMult =
    materiality === 'high' ? 1.0 : materiality === 'medium' ? 0.5 : 0.2
  const catMult =
    category === 'regulatory'
      ? 1.2
      : category === 'strategic'
        ? 1.1
        : category === 'financial'
          ? 1.0
          : category === 'operational'
            ? 0.7
            : category === 'market'
              ? 0.5
              : 0.3
  const delta = sentimentScore * 0.4 * matMult * catMult
  return Math.round(delta * 100) / 100
}

export function estimateNewsImpact(
  item: NewsItem,
  companies: Company[]
): NewsImpact {
  const text = searchableText(item)
  const { score: sentimentScore, matches: sentimentKeywords } = scoreSentiment(text)
  const affectedCompanies = detectCompanies(text, companies)
  const affectedChainSegments = detectChainSegments(text)
  const affectedIndustries = detectIndustries(text)
  const isPolicy = detectPolicy(text)
  const category = classifyCategory(text, isPolicy)

  // Materiality heuristic:
  // - HIGH   — named company + financial/regulatory/strategic
  // - MEDIUM — either a named company, a value-chain segment, or a policy kw
  // - LOW    — industry match only, or no clear linkage
  let materiality: NewsMateriality = 'low'
  if (
    affectedCompanies.length > 0 &&
    ['financial', 'regulatory', 'strategic'].includes(category)
  ) {
    materiality = 'high'
  } else if (
    affectedCompanies.length > 0 ||
    affectedChainSegments.length > 0 ||
    isPolicy
  ) {
    materiality = 'medium'
  }

  const sentiment: NewsSentiment =
    sentimentScore > 0 ? 'positive' : sentimentScore < 0 ? 'negative' : 'neutral'

  const multipleDeltaPct = estimateMultipleDelta(
    sentimentScore,
    materiality,
    category
  )

  const affectedParams = computeParamDegrees(text, sentimentScore, category)

  const parts: string[] = []
  parts.push(
    `${category.charAt(0).toUpperCase() + category.slice(1)} item · ${materiality} materiality`
  )
  if (affectedCompanies.length) {
    parts.push(
      `Names ${affectedCompanies.length} tracked compan${affectedCompanies.length === 1 ? 'y' : 'ies'}`
    )
  }
  if (affectedChainSegments.length) {
    parts.push(
      `${affectedChainSegments.length} value-chain segment${affectedChainSegments.length === 1 ? '' : 's'}`
    )
  }
  if (isPolicy) {
    parts.push('Policy/regulatory signal')
  }
  if (multipleDeltaPct !== 0) {
    parts.push(
      `Est. ${multipleDeltaPct > 0 ? '+' : ''}${multipleDeltaPct.toFixed(2)}% EV/EBITDA delta`
    )
  }

  return {
    sentiment,
    sentimentScore,
    materiality,
    category,
    multipleDeltaPct,
    affectedParams,
    affectedCompanies,
    affectedChainSegments,
    affectedIndustries,
    sentimentKeywords,
    rationale: parts.join(' · '),
    isPolicy,
  }
}

/**
 * Aggregate per-company impact — used by the Valuation page to show a
 * composite "news drift" on top of the baseline parameters.
 *
 * - `signalMultipleDeltaPct`: legacy preview for every matched item
 *   (shown in the Δ News column when nothing is acknowledged).
 * - `appliedMultipleDeltaPct`: sum across acknowledged items only.
 * - `paramAdjustments`: per-parameter applied adjustments (acked items
 *   only). Each value is a signed `adjustmentFactor` (e.g. 0.15 = +15%)
 *   suitable for `baseValue × (1 + factor)`. Manual overrides take
 *   precedence over auto-degrees.
 */

export interface AppliedParamDelta {
  /** Net signed adjustment factor across acked items, e.g. 0.15 = +15% */
  adjustmentFactor: number
  /** How many acked items contributed */
  count: number
  /** Sum of auto degrees (unsigned magnitudes) for disclosure */
  totalAutoDegree: number
  /** Number of items with a manual override contributing */
  manualCount: number
}

export interface CompanyNewsAggregate {
  ticker: string
  count: number
  avgSentimentScore: number
  /** Sum of multipleDeltaPct across every matched item. Preview only. */
  signalMultipleDeltaPct: number
  /** Sum of multipleDeltaPct across acknowledged items only. */
  appliedMultipleDeltaPct: number
  /** Count of acknowledged items contributing to the applied delta. */
  acknowledgedCount: number
  latestDate: string | null
  items: Array<{ item: NewsItem; impact: NewsImpact }>
  /** Per-parameter signed adjustments from acked items only */
  paramAdjustments: Partial<Record<ValuationParam, AppliedParamDelta>>
}

export interface AckAccessors {
  isAcknowledged: (itemKey: string) => boolean
  getManualOverride?: (itemKey: string, param: ValuationParam) => number | null
  /** When provided and returns true, the parameter is skipped entirely
   *  in the aggregate loop — neither auto nor manual values contribute.
   *  Used by the Impact modal's per-param checkbox. */
  isParamDisabled?: (itemKey: string, param: ValuationParam) => boolean
}

export function aggregateImpactByCompany(
  items: Array<{ item: NewsItem; impact: NewsImpact }>,
  ack?: AckAccessors
): Record<string, CompanyNewsAggregate> {
  const out: Record<string, CompanyNewsAggregate> = {}

  // Dedupe guard — ensure every (ticker, itemKey) pair contributes at
  // most once to a company's aggregate, even if the same item arrived
  // through multiple upstream queries or was decorated more than once.
  const counted = new Set<string>()

  for (const entry of items) {
    const itemKey = entry.item.link || entry.item.guid || entry.item.title
    const acked = ack ? ack.isAcknowledged(itemKey) : false

    // Dedupe tickers within a single item too (Set guard inside
    // detectCompanies already does this, but belt & braces).
    const uniqueTickers = Array.from(new Set(entry.impact.affectedCompanies))

    for (const ticker of uniqueTickers) {
      const dedupeKey = `${ticker}::${itemKey}`
      if (counted.has(dedupeKey)) continue
      counted.add(dedupeKey)

      if (!out[ticker]) {
        out[ticker] = {
          ticker,
          count: 0,
          avgSentimentScore: 0,
          signalMultipleDeltaPct: 0,
          appliedMultipleDeltaPct: 0,
          acknowledgedCount: 0,
          latestDate: null,
          items: [],
          paramAdjustments: {},
        }
      }
      const agg = out[ticker]
      agg.count += 1
      agg.avgSentimentScore += entry.impact.sentimentScore
      agg.signalMultipleDeltaPct += entry.impact.multipleDeltaPct
      if (acked) {
        agg.appliedMultipleDeltaPct += entry.impact.multipleDeltaPct
        agg.acknowledgedCount += 1

        // Walk each affected parameter and apply either the manual
        // override (if set) or the auto degree. Parameters explicitly
        // disabled by the user are skipped. Parameters added by the
        // user via a manual override (not in the auto set) are also
        // picked up below.
        const autoEntries = Object.entries(
          entry.impact.affectedParams
        ) as Array<[ValuationParam, number]>

        // Pull in user-added params (manual override set on a param
        // that wasn't auto-detected).
        const autoKeys = new Set(autoEntries.map(([p]) => p))
        const manualOnlyEntries: Array<[ValuationParam, number]> = []
        if (ack?.getManualOverride) {
          // We can't iterate storage from here, but we can probe each
          // valuation param — the list is small (7) so this is cheap.
          const allParams: ValuationParam[] = [
            'revenue_growth',
            'ebitda_margin',
            'management',
            'barriers_to_entry',
            'concentration_risk',
            'wacc',
            'ev_ebitda_multiple',
          ]
          for (const p of allParams) {
            if (autoKeys.has(p)) continue
            const m = ack.getManualOverride(itemKey, p)
            if (m != null && m !== 0) {
              manualOnlyEntries.push([p, 0])
            }
          }
        }

        for (const [param, autoDegree] of [...autoEntries, ...manualOnlyEntries]) {
          if (ack?.isParamDisabled?.(itemKey, param)) continue
          const manual =
            ack?.getManualOverride?.(itemKey, param) ?? null
          const factor = effectiveAdjustmentFactor(
            param,
            autoDegree,
            manual,
            entry.impact.sentiment
          )
          if (factor === 0) continue
          const current = agg.paramAdjustments[param] || {
            adjustmentFactor: 0,
            count: 0,
            totalAutoDegree: 0,
            manualCount: 0,
          }
          current.adjustmentFactor += factor
          current.count += 1
          current.totalAutoDegree += autoDegree
          if (manual != null) current.manualCount += 1
          agg.paramAdjustments[param] = current
        }
      }
      agg.items.push(entry)
      if (
        entry.item.pubDate &&
        (!agg.latestDate || entry.item.pubDate > agg.latestDate)
      ) {
        agg.latestDate = entry.item.pubDate
      }
    }
  }
  for (const agg of Object.values(out)) {
    agg.avgSentimentScore = agg.count ? agg.avgSentimentScore / agg.count : 0
    agg.signalMultipleDeltaPct =
      Math.round(agg.signalMultipleDeltaPct * 100) / 100
    agg.appliedMultipleDeltaPct =
      Math.round(agg.appliedMultipleDeltaPct * 100) / 100
    // Clamp cumulative per-param factors so a stack of bullish items
    // can't multiply a value to infinity (cap at ±80%).
    for (const p of Object.keys(agg.paramAdjustments) as ValuationParam[]) {
      const entry = agg.paramAdjustments[p]!
      entry.adjustmentFactor = Math.max(-0.8, Math.min(0.8, entry.adjustmentFactor))
    }
    // Keep only the 6 most recent per company
    agg.items.sort((a, b) => (b.item.pubDate || '').localeCompare(a.item.pubDate || ''))
    agg.items = agg.items.slice(0, 6)
  }
  return out
}
