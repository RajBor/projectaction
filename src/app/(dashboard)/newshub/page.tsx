'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { COMPANIES } from '@/lib/data/companies'
import {
  fetchNews,
  decorateNews,
  filterRelevant,
  sortByDate,
  DOMAIN_CATEGORIES,
  DOMAIN_QUERIES,
  type NewsItem,
  type DomainCategoryId,
} from '@/lib/news/api'
import { fetchPvMagazine } from '@/lib/news/pv-magazine'
import type { NewsImpact } from '@/lib/news/impact'
import { NewsCard } from '@/components/news/NewsCard'
import { Badge } from '@/components/ui/Badge'
import { useIndustryFilter } from '@/hooks/useIndustryFilter'
import { useIndustryAtlas } from '@/hooks/useIndustryAtlas'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'

type Origin = 'google' | 'pv'
type Decorated = { item: NewsItem; impact: NewsImpact; origin: Origin }
type IndustryFilter = 'all' | 'solar' | 'td' | 'policy'
type SentimentFilter = 'all' | 'positive' | 'negative' | 'neutral'
type MaterialityFilter = 'all' | 'high' | 'medium'
type SourceFilter = 'all' | 'google' | 'pv'

// Auto-refresh cadence (ms) — silently re-fetches the merged feed so
// the freshest headlines stay on top without the user clicking Refresh.
const AUTO_REFRESH_MS = 10 * 60 * 1000

/** Dedupe tagged items by canonical link, keeping the newer pubDate. */
function dedupeTagged(list: Decorated[]): Decorated[] {
  const byKey = new Map<string, Decorated>()
  for (const entry of list) {
    const key = (entry.item.link || entry.item.guid || entry.item.title).replace(
      /\/$/,
      ''
    )
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, entry)
      continue
    }
    // Prefer the item with the newer pubDate; on a tie, prefer PV Magazine
    // (richer description from content:encoded).
    const a = entry.item.pubDate || ''
    const b = existing.item.pubDate || ''
    if (a > b || (a === b && entry.origin === 'pv')) {
      byKey.set(key, entry)
    }
  }
  return Array.from(byKey.values())
}

export default function NewsHubPage() {
  const [category, setCategory] = useState<DomainCategoryId>('solar_value_chain')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [industry, setIndustry] = useState<IndustryFilter>('all')
  const [sentiment, setSentiment] = useState<SentimentFilter>('all')
  const [materiality, setMateriality] = useState<MaterialityFilter>('all')
  const [companyFilter, setCompanyFilter] = useState<string>('')
  const [search, setSearch] = useState<string>('')
  const [onlyRelevant, setOnlyRelevant] = useState<boolean>(true)

  const [items, setItems] = useState<Decorated[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const [cached, setCached] = useState<boolean>(false)
  const [sourceCounts, setSourceCounts] = useState<{ google: number; pv: number }>(
    { google: 0, pv: 0 }
  )
  const abortRef = useRef<AbortController | null>(null)

  // Pull the live universe so news-impact tagging covers admin-pushed
  // SMEs (user_companies) and atlas industries — not just the static
  // 85-row seed. We use a ref so the long-lived `load` closure always
  // sees the freshest snapshot without re-binding the interval.
  const { allCompanies } = useLiveSnapshot()
  const universeRef = useRef(allCompanies)
  useEffect(() => { universeRef.current = allCompanies }, [allCompanies])

  const load = async (fresh = false) => {
    if (abortRef.current) abortRef.current.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setLoading(true)
    setError(null)

    const query = DOMAIN_QUERIES[category]

    // Parallel fetch — Google News (filtered by selected category query)
    // and PV Magazine (both India + Global editions merged server-side).
    // Resilient: if one side fails, we still render the other.
    const [googleRes, pvRes] = await Promise.all([
      fetchNews({ q: query, limit: 40, fresh, signal: ctrl.signal }),
      fetchPvMagazine({ region: 'all', limit: 60, fresh, signal: ctrl.signal }),
    ])
    if (ctrl.signal.aborted) return

    const googleRaw: NewsItem[] = googleRes.ok ? googleRes.data || [] : []
    const pvRaw: NewsItem[] = pvRes.ok ? (pvRes.data as NewsItem[]) || [] : []

    // Tag every item with its origin BEFORE decorating + merging so the
    // source filter and per-source counts stay accurate after dedupe.
    const tagUniverse = universeRef.current.length ? universeRef.current : COMPANIES
    const googleTagged: Decorated[] = decorateNews(googleRaw, tagUniverse).map(
      (d) => ({ ...d, origin: 'google' as const })
    )
    const pvTagged: Decorated[] = decorateNews(pvRaw, tagUniverse).map((d) => ({
      ...d,
      origin: 'pv' as const,
    }))

    // Merge → dedupe across both feeds by canonical link → sort latest on top.
    const merged = sortByDate(dedupeTagged([...googleTagged, ...pvTagged]))

    // Pre-dedupe per-source counts drive the header badges.
    setSourceCounts({ google: googleRaw.length, pv: pvRaw.length })
    setItems(merged)
    setCached(!!(googleRes.cached && pvRes.cached))
    setLastRefresh(new Date())

    if (!googleRes.ok && !pvRes.ok) {
      setError(
        googleRes.error || pvRes.error || 'Failed to load news from any source'
      )
    } else if (!googleRes.ok) {
      setError(`Google News partial: ${googleRes.error}`)
    } else if (!pvRes.ok) {
      setError(`PV Magazine partial: ${pvRes.error}`)
    }

    setLoading(false)
  }

  // Reload whenever the selected domain category changes (or on mount).
  useEffect(() => {
    load(false)
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

  // Auto-refresh scroller — silently re-fetches the merged feed so the
  // freshest headlines stay on top without the user clicking Refresh.
  useEffect(() => {
    const id = setInterval(() => {
      load(true)
    }, AUTO_REFRESH_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

  // Apply client-side filters
  const visible = useMemo(() => {
    let list = items
    if (sourceFilter !== 'all') {
      list = list.filter((d) => d.origin === sourceFilter)
    }
    if (onlyRelevant) list = filterRelevant(list)
    if (industry === 'solar' || industry === 'td') {
      list = list.filter(({ impact }) =>
        impact.affectedIndustries.includes(industry)
      )
    } else if (industry === 'policy') {
      list = list.filter(({ impact }) => impact.isPolicy)
    }
    if (sentiment !== 'all') {
      list = list.filter(({ impact }) => impact.sentiment === sentiment)
    }
    if (materiality !== 'all') {
      list = list.filter(({ impact }) => impact.materiality === materiality)
    }
    if (companyFilter) {
      list = list.filter(({ impact }) =>
        impact.affectedCompanies.includes(companyFilter)
      )
    }
    if (search.trim()) {
      const needle = search.trim().toLowerCase()
      list = list.filter(
        ({ item }) =>
          item.title.toLowerCase().includes(needle) ||
          item.description.toLowerCase().includes(needle)
      )
    }
    return list
  }, [
    items,
    sourceFilter,
    onlyRelevant,
    industry,
    sentiment,
    materiality,
    companyFilter,
    search,
  ])

  const summary = useMemo(() => {
    let positive = 0
    let negative = 0
    let neutral = 0
    let policy = 0
    let high = 0
    let medium = 0
    let fromGoogle = 0
    let fromPv = 0
    for (const { impact, origin } of visible) {
      if (impact.sentiment === 'positive') positive++
      else if (impact.sentiment === 'negative') negative++
      else neutral++
      if (impact.isPolicy) policy++
      if (impact.materiality === 'high') high++
      else if (impact.materiality === 'medium') medium++
      if (origin === 'google') fromGoogle++
      else fromPv++
    }
    return { positive, negative, neutral, policy, high, medium, fromGoogle, fromPv }
  }, [visible])

  const { isSelected } = useIndustryFilter()
  const { atlasListed } = useIndustryAtlas()
  // Merged universe so atlas-seeded industries surface in the tracked-company
  // list, then apply the sidebar industry filter.
  const tracked = useMemo(() => {
    // Dedupe the live universe ∪ atlas by ticker so admin-pushed SMEs
    // (user_companies → Eppeltone & friends) flow into the per-company
    // news cards without duplicating any rows that already exist in the
    // live snapshot.
    const seen = new Set<string>()
    const out: typeof allCompanies = []
    for (const c of allCompanies) {
      if (seen.has(c.ticker)) continue
      seen.add(c.ticker); out.push(c)
    }
    for (const c of atlasListed) {
      if (seen.has(c.ticker)) continue
      seen.add(c.ticker); out.push(c)
    }
    // Keep every in-scope ticker — no mktcap gate — so freshly-registered
    // atlas companies still surface in per-company news tagging before
    // their financials land. Cap at 80 (up from 40) to keep the tag list
    // responsive while widening coverage as the universe grows.
    return out
      .filter((c) => isSelected(c.sec))
      .sort((a, b) => b.acqs - a.acqs)
      .slice(0, 80)
  }, [allCompanies, atlasListed, isSelected])

  return (
    <div>
      {/* Page header */}
      <div className="phdr">
        <div className="phdr-breadcrumb">
          <span className="dn-wordmark">Deal<em>Nector</em></span> › News Intelligence
        </div>
        <div className="phdr-title">
          News <em>Hub</em>
        </div>
        <div className="phdr-meta">
          <Badge variant="green">
            Google News + PV Magazine · merged · latest first
          </Badge>
          <Badge variant="gold">Google: {sourceCounts.google}</Badge>
          <Badge variant="orange">PV: {sourceCounts.pv}</Badge>
          <Badge variant="gray">auto-refresh · dedupe · 10 min</Badge>
          {cached && <Badge variant="cyan">served from cache</Badge>}
          {lastRefresh && (
            <Badge variant="gold">
              Last:{' '}
              {lastRefresh.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </Badge>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            style={{
              marginLeft: 'auto',
              background: 'var(--golddim)',
              border: '1px solid var(--gold2)',
              color: 'var(--gold2)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.4px',
              textTransform: 'uppercase',
              padding: '4px 11px',
              borderRadius: 4,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 5,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                transform: loading ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.4s',
              }}
            >
              ↻
            </span>
            Refresh
          </button>
        </div>
      </div>

      {/* Summary KPIs — counted from the merged, visible (post-filter) list */}
      <div className="krow">
        <div className="kpi">
          <div className="kpi-lbl">Total Items</div>
          <div className="kpi-val">{visible.length}</div>
          <div className="kpi-sub">
            of {items.length} merged · {summary.fromGoogle} Google + {summary.fromPv} PV
          </div>
        </div>
        <div className="kpi" style={{ borderLeft: '3px solid var(--green)' }}>
          <div className="kpi-lbl">Positive</div>
          <div className="kpi-val" style={{ color: 'var(--green)' }}>
            {summary.positive}
          </div>
          <div className="kpi-sub">bullish signals</div>
        </div>
        <div className="kpi" style={{ borderLeft: '3px solid var(--red)' }}>
          <div className="kpi-lbl">Negative</div>
          <div className="kpi-val" style={{ color: 'var(--red)' }}>
            {summary.negative}
          </div>
          <div className="kpi-sub">bearish signals</div>
        </div>
        <div className="kpi" style={{ borderLeft: '3px solid var(--gold2)' }}>
          <div className="kpi-lbl">High Materiality</div>
          <div className="kpi-val" style={{ color: 'var(--gold2)' }}>
            {summary.high}
          </div>
          <div className="kpi-sub">deal-relevant</div>
        </div>
        <div className="kpi" style={{ borderLeft: '3px solid var(--purple)' }}>
          <div className="kpi-lbl">Policy</div>
          <div className="kpi-val" style={{ color: 'var(--purple)' }}>
            {summary.policy}
          </div>
          <div className="kpi-sub">regulatory items</div>
        </div>
      </div>

      {/* Merged feed — one unified tab row, categories drive the Google News
          query; PV Magazine is always mixed in. Latest items on top. */}
      <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
        {/* Category tabs (Google News domain queries) */}
        <div
          style={{
            display: 'flex',
            overflowX: 'auto',
            borderBottom: '1px solid var(--br)',
          }}
        >
          {DOMAIN_CATEGORIES.map((c) => {
            const active = c.id === category
            return (
              <button
                key={c.id}
                onClick={() => setCategory(c.id)}
                style={{
                  background: active ? 'var(--s3)' : 'transparent',
                  border: 'none',
                  borderBottom: active
                    ? '2px solid var(--gold2)'
                    : '2px solid transparent',
                  color: active ? 'var(--gold2)' : 'var(--txt2)',
                  padding: '10px 14px',
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ fontSize: 13 }}>{c.icon}</span> {c.label}
              </button>
            )
          })}
        </div>

        {/* Filter rail */}
        <div
          style={{
            padding: '10px 14px',
            borderBottom: '1px solid var(--br)',
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <FilterGroup label="Source">
            {(
              [
                ['all', 'All'],
                ['google', 'Google'],
                ['pv', 'PV Mag'],
              ] as Array<[SourceFilter, string]>
            ).map(([v, lbl]) => (
              <PillButton
                key={v}
                active={sourceFilter === v}
                onClick={() => setSourceFilter(v)}
              >
                {lbl}
              </PillButton>
            ))}
          </FilterGroup>
          <FilterGroup label="Industry">
            {(
              [
                ['all', 'All'],
                ['solar', 'Solar'],
                ['td', 'T&D'],
                ['policy', 'Policy'],
              ] as Array<[IndustryFilter, string]>
            ).map(([v, lbl]) => (
              <PillButton
                key={v}
                active={industry === v}
                onClick={() => setIndustry(v)}
              >
                {lbl}
              </PillButton>
            ))}
          </FilterGroup>
          <FilterGroup label="Sentiment">
            {(
              [
                ['all', 'All'],
                ['positive', 'Positive'],
                ['negative', 'Negative'],
                ['neutral', 'Neutral'],
              ] as Array<[SentimentFilter, string]>
            ).map(([v, lbl]) => (
              <PillButton
                key={v}
                active={sentiment === v}
                onClick={() => setSentiment(v)}
              >
                {lbl}
              </PillButton>
            ))}
          </FilterGroup>
          <FilterGroup label="Materiality">
            {(
              [
                ['all', 'All'],
                ['high', 'High'],
                ['medium', 'Medium'],
              ] as Array<[MaterialityFilter, string]>
            ).map(([v, lbl]) => (
              <PillButton
                key={v}
                active={materiality === v}
                onClick={() => setMateriality(v)}
              >
                {lbl}
              </PillButton>
            ))}
          </FilterGroup>

          <div
            style={{
              display: 'flex',
              gap: 6,
              alignItems: 'center',
              marginLeft: 'auto',
              flexWrap: 'wrap',
            }}
          >
            <select
              value={companyFilter}
              onChange={(e) => setCompanyFilter(e.target.value)}
              style={selectStyle}
            >
              <option value="">All companies</option>
              {tracked.map((c) => (
                <option key={c.ticker} value={c.ticker}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Search title…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={inputStyle}
            />
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: 'var(--txt2)',
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={onlyRelevant}
                onChange={(e) => setOnlyRelevant(e.target.checked)}
              />
              Relevant only
            </label>
          </div>
        </div>

        {/* Items */}
        <div
          style={{
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            maxHeight: 'calc(100vh - 380px)',
            overflowY: 'auto',
          }}
        >
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--txt3)' }}>
              Loading latest news…
            </div>
          )}
          {error && !loading && (
            <div
              style={{
                padding: 14,
                background: 'var(--reddim)',
                border: '1px solid var(--red)',
                borderRadius: 5,
                color: 'var(--red)',
                fontSize: 12,
              }}
            >
              {error}
            </div>
          )}
          {!loading && !error && visible.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--txt3)' }}>
              No news matching current filters. Try loosening filters or switching category.
            </div>
          )}
          {!loading &&
            visible.map(({ item, impact }) => (
              <NewsCard
                key={item.link || item.guid || item.title}
                item={item}
                impact={impact}
                showAcknowledge
              />
            ))}
        </div>
      </div>

      <div style={{ marginTop: 10, fontSize: 10, color: 'var(--txt3)' }}>
        News · Merged feed: Google News RSS (India edition) + PV Magazine RSS
        (pv-magazine.com + pv-magazine-india.com) · deduped by canonical link,
        sorted latest-first, auto-refreshed every 10 minutes ·
        Sentiment/materiality/EV-EBITDA impact are{' '}
        <strong>optional heuristic signals</strong>, not investment advice. Click{' '}
        <strong style={{ color: 'var(--gold2)' }}>+ Acknowledge</strong> on an item to apply its
        estimated impact in the Valuation page. Every article opens in a new tab to its
        original publisher.
      </div>
    </div>
  )
}

// ── Helpers ──

const pillBase: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.3px',
  textTransform: 'uppercase',
  padding: '4px 9px',
  borderRadius: 3,
  cursor: 'pointer',
  border: '1px solid var(--br)',
  background: 'transparent',
  color: 'var(--txt2)',
  fontFamily: 'inherit',
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        ...pillBase,
        background: active ? 'var(--golddim)' : 'transparent',
        border: `1px solid ${active ? 'var(--gold2)' : 'var(--br)'}`,
        color: active ? 'var(--gold2)' : 'var(--txt2)',
      }}
    >
      {children}
    </button>
  )
}

function FilterGroup({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <span
        style={{
          fontSize: 9,
          color: 'var(--txt3)',
          textTransform: 'uppercase',
          letterSpacing: '0.8px',
          marginRight: 3,
        }}
      >
        {label}
      </span>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  background: 'var(--s3)',
  border: '1px solid var(--br)',
  color: 'var(--txt)',
  padding: '5px 9px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'inherit',
  outline: 'none',
  width: 160,
}

const selectStyle: React.CSSProperties = {
  background: 'var(--s3)',
  border: '1px solid var(--br)',
  color: 'var(--txt)',
  padding: '5px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontFamily: 'inherit',
  outline: 'none',
  cursor: 'pointer',
  maxWidth: 180,
}
