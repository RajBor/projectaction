'use client'

import { Fragment, useMemo, useState } from 'react'
import type { ChainNode } from '@/lib/data/chain'
import type {
  MatrixInputCell,
  MatrixInputKey,
  MatrixInputs,
  MatrixTargetInput,
  ScoredTarget,
} from '@/lib/position-matrix/types'
import {
  DEFAULT_CONFIG,
  INDUSTRY_KEYS,
  INPUT_LABELS,
  POSITION_KEYS,
  PRESETS,
  QUADRANTS,
} from '@/lib/position-matrix/config'
import { scoreTarget, summarize } from '@/lib/position-matrix/engine'
import {
  autoFillInputs,
  computePeerAverages,
  rankByMarketCap,
  sectorDefault,
} from '@/lib/position-matrix/auto-fill'
import { formatInrCr, formatPctSigned, formatRatioX } from '@/lib/format'

// ── Props ────────────────────────────────────────────────────────────

export interface PositionMatrixProps {
  /** Pre-coerced targets — caller converts OpTarget | Company → MatrixTargetInput */
  targets: MatrixTargetInput[]
  /** CHAIN lookup by segment id */
  chainLookup: (segmentId: string) => ChainNode | undefined
  /** All known segment ids for the value-chain filter (defaults to union of target.comp). */
  allSegments?: Array<{ id: string; name: string }>
  /** Sub-segment options, keyed by segment. Optional. */
  subSegments?: Array<{ id: string; name: string; parentSegment?: string }>
  /** Pre-filter targets before scoring (e.g., sector filter from parent page). */
  externalFilterLabel?: string
  /** Visual mode — op-identifier uses fuller controls; fsa shows tighter layout. */
  mode?: 'op-identifier' | 'fsa'
  /** Title shown in the header block. */
  title?: string
  /** Subtitle line. */
  subtitle?: string
  /** Optional CSS to apply to the outer container (override PANEL). */
  style?: React.CSSProperties
}

// ── Quadrant sort priority (for roster) ──────────────────────────────

const QUADRANT_PRIORITY: Record<string, number> = {
  rising_star: 1,
  undervalued_leader: 2,
  emerging_challenger: 3,
  cash_cow: 4,
  hold_watch: 5,
  question_mark: 6,
  harvest: 7,
  restructure: 8,
  divest: 9,
}

// ── Layout constants for the SVG ─────────────────────────────────────

const VB_W = 900
const VB_H = 640
const PLOT_X0 = 130
const PLOT_X1 = 870
const PLOT_Y0 = 30
const PLOT_Y1 = 580
const CELL_W = (PLOT_X1 - PLOT_X0) / 3
const CELL_H = (PLOT_Y1 - PLOT_Y0) / 3

function scoreToX(score: number): number {
  return PLOT_X0 + (score / 100) * (PLOT_X1 - PLOT_X0)
}
function scoreToY(score: number): number {
  return PLOT_Y1 - (score / 100) * (PLOT_Y1 - PLOT_Y0)
}

// ── Component ────────────────────────────────────────────────────────

export default function PositionMatrix({
  targets,
  chainLookup,
  allSegments,
  externalFilterLabel,
  mode = 'op-identifier',
  title = 'Position Matrix',
  subtitle = 'Industry attractiveness × competitive position — 9-box plot.',
  style,
}: PositionMatrixProps) {
  // ── Local state ───────────────────────────────────────────────
  const [presetId, setPresetId] = useState<string>('default')
  const [segmentFilter, setSegmentFilter] = useState<string>('all')
  const [groupFilter, setGroupFilter] = useState<'all' | 'core' | 'opportunistic'>('all')
  const [overrides, setOverrides] = useState<Record<string, Partial<MatrixInputs>>>({})
  const [expandedTicker, setExpandedTicker] = useState<string | null>(null)
  const [hoverTicker, setHoverTicker] = useState<string | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  const [showMethodology, setShowMethodology] = useState(false)

  // ── Derived filter & config ───────────────────────────────────
  const config = useMemo(() => {
    const p = PRESETS.find(x => x.id === presetId)
    return p ? p.config : DEFAULT_CONFIG
  }, [presetId])

  const availableSegments = useMemo(() => {
    if (allSegments && allSegments.length) return allSegments
    const ids = new Set<string>()
    for (const t of targets) for (const c of t.comp || []) ids.add(c)
    return Array.from(ids).map(id => {
      const node = chainLookup(id)
      return { id, name: node?.name || id }
    })
  }, [allSegments, targets, chainLookup])

  // Cohort filter only surfaces if the caller actually tagged targets
  // with a group (op-identifier does; FSA peers don't).
  const hasGroups = useMemo(() => targets.some(t => t.group), [targets])
  const coreCount = useMemo(() => targets.filter(t => t.group === 'core').length, [targets])
  const opportunisticCount = useMemo(() => targets.filter(t => t.group === 'opportunistic').length, [targets])

  const filteredTargets = useMemo(() => {
    let pool = targets
    if (hasGroups && groupFilter !== 'all') {
      pool = pool.filter(t => t.group === groupFilter)
    }
    if (segmentFilter !== 'all') {
      pool = pool.filter(t => (t.comp || []).includes(segmentFilter))
    }
    return pool
  }, [targets, segmentFilter, hasGroups, groupFilter])

  // ── Peer averages + market-cap rank (computed once per filter) ─
  const peerAvgs = useMemo(() => computePeerAverages(filteredTargets), [filteredTargets])
  const rankMap = useMemo(() => rankByMarketCap(filteredTargets), [filteredTargets])

  // ── Score every filtered target ───────────────────────────────
  const scored: ScoredTarget[] = useMemo(() => {
    return filteredTargets.map(t => {
      const segIds = t.comp || []
      const chainNodes = segIds.map(id => chainLookup(id)).filter((x): x is ChainNode => !!x)
      const rank = rankMap.get(t.ticker) ?? null
      const baseInputs = autoFillInputs(t, chainNodes, {
        revGrowthPct: peerAvgs.revGrowthPct,
        ebitdaMarginPct: peerAvgs.ebitdaMarginPct,
        marketCapRank: rank,
      })
      // Apply user overrides
      const userOv = overrides[t.ticker]
      const merged: MatrixInputs = userOv
        ? ({ ...baseInputs, ...userOv } as MatrixInputs)
        : baseInputs
      return scoreTarget(t, merged, config)
    })
  }, [filteredTargets, chainLookup, peerAvgs, rankMap, overrides, config])

  const summary = useMemo(() => summarize(scored), [scored])

  // ── Roster ────────────────────────────────────────────────────
  const roster = useMemo(() => {
    return [...scored].sort((a, b) => {
      const ap = a.quadrant ? QUADRANT_PRIORITY[a.quadrant.code] : 99
      const bp = b.quadrant ? QUADRANT_PRIORITY[b.quadrant.code] : 99
      if (ap !== bp) return ap - bp
      return (b.input.evCr || 0) - (a.input.evCr || 0)
    })
  }, [scored])

  // ── Override helpers ──────────────────────────────────────────
  const setInputValue = (ticker: string, key: MatrixInputKey, value: number | null, note?: string) => {
    setOverrides(prev => {
      const cur = prev[ticker] || {}
      const cell: MatrixInputCell = value === null
        ? { value: null, provenance: 'missing', note }
        : { value, provenance: 'manual', note }
      return { ...prev, [ticker]: { ...cur, [key]: cell } }
    })
  }

  const applySectorDefault = (scoredTarget: ScoredTarget, key: MatrixInputKey) => {
    if (
      key !== 'competitive_intensity' &&
      key !== 'cyclicality' &&
      key !== 'moat_score' &&
      key !== 'management_quality' &&
      key !== 'customer_concentration' &&
      key !== 'market_share_rank'
    ) return
    const chainNode = chainLookup(scoredTarget.input.comp?.[0] || '') || null
    const g = sectorDefault(key as any, scoredTarget.input.sec, chainNode, scoredTarget.input)
    if (!g) return
    setOverrides(prev => {
      const cur = prev[scoredTarget.input.ticker] || {}
      const cell: MatrixInputCell = { value: g.value, provenance: 'default', note: g.rationale }
      return { ...prev, [scoredTarget.input.ticker]: { ...cur, [key]: cell } }
    })
  }

  const clearOverride = (ticker: string, key: MatrixInputKey) => {
    setOverrides(prev => {
      const cur = prev[ticker] || {}
      const next = { ...cur }
      delete next[key]
      return { ...prev, [ticker]: next }
    })
  }

  // ── Styles shared across the block ────────────────────────────
  const panelStyle: React.CSSProperties = {
    background: 'var(--s2)',
    border: '1px solid var(--br)',
    borderRadius: 12,
    padding: '26px 30px',
    marginBottom: 22,
    boxShadow: '0 1px 0 rgba(255,255,255,0.02), 0 8px 28px rgba(0,0,0,0.18)',
    position: 'relative',
    ...style,
  }

  const hovered = hoverTicker ? scored.find(s => s.input.ticker === hoverTicker) : null
  const expanded = expandedTicker ? scored.find(s => s.input.ticker === expandedTicker) : null

  return (
    <div style={panelStyle} data-position-matrix>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, paddingBottom: 14, marginBottom: 18, borderBottom: '1px solid var(--br)' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--gold2)' }}>
            {mode === 'op-identifier' ? 'Chapter 03-b' : 'Peer Positioning'}
          </div>
          <h2 style={{ fontFamily: 'Source Serif 4, Georgia, serif', fontSize: 17, fontWeight: 700, margin: 0, color: 'var(--txt)' }}>
            {title}
          </h2>
          <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 4 }}>
            {subtitle}
            {externalFilterLabel ? ` · ${externalFilterLabel}` : ''}
          </div>
        </div>
        <div style={{ flex: 1 }} />

        {/* Preset + segment filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {hasGroups && (
            <>
              <label style={{ fontSize: 10, color: 'var(--txt3)', letterSpacing: '.15em', textTransform: 'uppercase' }}>Cohort</label>
              <div style={{ display: 'flex', border: '1px solid var(--br)', borderRadius: 4, overflow: 'hidden' }}>
                {([
                  { id: 'all', label: `All (${coreCount + opportunisticCount})`, color: 'var(--txt2)' },
                  { id: 'core', label: `Goal achievers (${coreCount})`, color: '#6b9bc4' },
                  { id: 'opportunistic', label: `Beyond goal (${opportunisticCount})`, color: '#d4a574' },
                ] as const).map(opt => {
                  const active = groupFilter === opt.id
                  return (
                    <button
                      key={opt.id}
                      onClick={() => setGroupFilter(opt.id)}
                      style={{
                        background: active ? opt.color : 'transparent',
                        color: active ? '#0a1222' : opt.color,
                        border: 'none',
                        padding: '5px 10px',
                        fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                        cursor: 'pointer', fontFamily: 'inherit',
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </>
          )}
          <label style={{ fontSize: 10, color: 'var(--txt3)', letterSpacing: '.15em', textTransform: 'uppercase', marginLeft: hasGroups ? 8 : 0 }}>Lens</label>
          <select
            value={presetId}
            onChange={e => setPresetId(e.target.value)}
            style={inputStyle()}
            title={PRESETS.find(p => p.id === presetId)?.description}
          >
            {PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <label style={{ fontSize: 10, color: 'var(--txt3)', letterSpacing: '.15em', textTransform: 'uppercase', marginLeft: 8 }}>Segment</label>
          <select
            value={segmentFilter}
            onChange={e => setSegmentFilter(e.target.value)}
            style={{ ...inputStyle(), maxWidth: 220 }}
          >
            <option value="all">All segments ({targets.length})</option>
            {availableSegments.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 18 }}>
        <KpiCell label="Targets" value={`${summary.nTargets}`} sub={`${summary.nPlotted} plotted`} />
        <KpiCell label="Aggregate EV" value={formatInrCr(summary.totalEvCr)} />
        <KpiCell
          label="Undervalued Leaders"
          value={`${summary.undervaluedLeaders.length}`}
          sub={summary.undervaluedLeaders.length > 0 ? 'Strong position · Discount to peer multiple' : 'None in current filter'}
          hero
        />
        <KpiCell label="Rising Stars" value={`${summary.risingStars.length}`} sub="High growth × strong position" />
        <KpiCell label="Median EV/EBITDA" value={summary.medianEvEbitda === null ? '—' : formatRatioX(summary.medianEvEbitda)} />
      </div>

      {/* Matrix + insights panel */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2.2fr) minmax(0, 1fr)', gap: 16 }}>
        <MatrixSVG
          scored={scored}
          hoverTicker={hoverTicker}
          onHover={(ticker, pos) => { setHoverTicker(ticker); setTooltipPos(pos) }}
          onClick={t => setExpandedTicker(t)}
        />
        <InsightsPanel
          summary={summary}
          scored={scored}
          onPickTarget={t => setExpandedTicker(t)}
        />
      </div>

      {/* Hover tooltip overlay */}
      {hovered && tooltipPos && (
        <TooltipCard scored={hovered} x={tooltipPos.x} y={tooltipPos.y} />
      )}

      {/* Roster table */}
      <div style={{ marginTop: 22 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: 'var(--txt3)' }}>Target Roster</div>
          <div style={{ fontSize: 10, color: 'var(--txt4)' }}>Sorted by quadrant priority, then EV desc · click a row for manual inputs</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ color: 'var(--txt3)', textAlign: 'left', letterSpacing: '.1em', textTransform: 'uppercase', fontSize: 10 }}>
                <th style={thStyle()}>Company</th>
                <th style={thStyle()}>Quadrant</th>
                <th style={thStyleRight()}>Industry</th>
                <th style={thStyleRight()}>Position</th>
                <th style={thStyleRight()}>EV</th>
                <th style={thStyleRight()}>EV/EBITDA</th>
                <th style={thStyleRight()}>Rev gr Δ</th>
                <th style={thStyleRight()}>EBITDA m Δ</th>
                <th style={thStyle()}>Thesis</th>
              </tr>
            </thead>
            <tbody>
              {roster.map(s => {
                const isExp = expandedTicker === s.input.ticker
                const qColor = s.quadrant?.color || 'var(--txt4)'
                return (
                  <Fragment key={s.input.ticker}>
                    <tr
                      onClick={() => setExpandedTicker(isExp ? null : s.input.ticker)}
                      style={{
                        borderTop: '1px solid var(--br)',
                        cursor: 'pointer',
                        background: isExp ? 'var(--s3)' : undefined,
                      }}
                    >
                      <td style={tdStyle()}>
                        <div style={{ fontWeight: 600, color: 'var(--txt)' }}>{s.input.name}</div>
                        <div style={{ fontSize: 9, color: 'var(--txt4)' }}>{s.input.ticker} · {s.input.sec}</div>
                      </td>
                      <td style={tdStyle()}>
                        <span style={{
                          display: 'inline-block', padding: '2px 7px', borderRadius: 3,
                          fontSize: 9, fontWeight: 700, letterSpacing: '.4px',
                          background: s.quadrant ? `${qColor}22` : 'var(--s3)',
                          color: qColor, border: `1px solid ${qColor}55`,
                        }}>
                          {s.quadrant?.shortLabel || 'UNSCORED'}
                          {s.valuationOverrideApplied ? ' ★' : ''}
                        </span>
                      </td>
                      <td style={tdStyleRight()}>{s.industryScore === null ? '—' : s.industryScore.toFixed(1)}</td>
                      <td style={tdStyleRight()}>{s.positionScore === null ? '—' : s.positionScore.toFixed(1)}</td>
                      <td style={tdStyleRight()}>{formatInrCr(s.input.evCr)}</td>
                      <td style={tdStyleRight()}>{s.input.ev_ebitda === null ? '—' : formatRatioX(s.input.ev_ebitda)}</td>
                      <td style={tdStyleRight()}>{formatPctSigned(s.inputs.revenue_growth_vs_peer.value)}</td>
                      <td style={tdStyleRight()}>{formatPctSigned(s.inputs.ebitda_margin_vs_peer.value)}</td>
                      <td style={tdStyle()}><span style={{ color: 'var(--txt2)' }}>{s.thesis}</span></td>
                    </tr>
                    {isExp && (
                      <tr style={{ background: 'var(--s3)' }}>
                        <td colSpan={9} style={{ padding: '12px 14px' }}>
                          <ManualInputEditor
                            scored={s}
                            onSet={(key, val, note) => setInputValue(s.input.ticker, key, val, note)}
                            onApplyDefault={(key) => applySectorDefault(s, key)}
                            onClear={(key) => clearOverride(s.input.ticker, key)}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
              {roster.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 16, textAlign: 'center', color: 'var(--txt3)', fontSize: 11 }}>
                  No targets in the current filter.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Methodology footer */}
      <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--br)', display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          onClick={() => setShowMethodology(v => !v)}
          style={{
            background: 'transparent', border: '1px solid var(--br)', color: 'var(--txt2)',
            padding: '4px 10px', borderRadius: 4, fontSize: 10, fontWeight: 700,
            letterSpacing: '.15em', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit',
          }}
        >
          {showMethodology ? 'Hide methodology' : 'Methodology'}
        </button>
        <div style={{ fontSize: 10, color: 'var(--txt4)' }}>
          Derived inputs ← live financials · CHAIN narrative · peer-set averages · Manual inputs ← your diligence view.
        </div>
      </div>
      {showMethodology && (
        <MethodologyBlock config={config} />
      )}
    </div>
  )
}

// ── Subcomponents ────────────────────────────────────────────────────

function KpiCell({ label, value, sub, hero }: { label: string; value: string; sub?: string; hero?: boolean }) {
  return (
    <div style={{
      background: hero ? 'linear-gradient(180deg, rgba(212,165,116,0.16), rgba(212,165,116,0.04))' : 'var(--s3)',
      borderTop: hero ? '2px solid #d4a574' : '1px solid var(--br)',
      border: hero ? '1px solid rgba(212,165,116,0.4)' : '1px solid var(--br)',
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.2em', textTransform: 'uppercase', color: hero ? '#d4a574' : 'var(--txt3)' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: 'var(--txt)', fontFamily: "'JetBrains Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

function MatrixSVG({
  scored,
  hoverTicker,
  onHover,
  onClick,
}: {
  scored: ScoredTarget[]
  hoverTicker: string | null
  onHover: (ticker: string | null, pos: { x: number; y: number } | null) => void
  onClick: (ticker: string) => void
}) {
  // Cells layout: (col i ∈ [0,1,2] for x = weak/medium/strong; row j for y = low/medium/high)
  const cells: Array<{ col: number; row: number; industry: 'low' | 'medium' | 'high'; position: 'weak' | 'medium' | 'strong' }> = []
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      cells.push({
        col, row,
        industry: (['low', 'medium', 'high'] as const)[row],
        position: (['weak', 'medium', 'strong'] as const)[col],
      })
    }
  }
  return (
    <div style={{ position: 'relative', background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 10, padding: 8 }}>
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {/* Cell backgrounds */}
        {cells.map(({ col, row, industry, position }) => {
          const quadCode = pickQuadrantInline(industry, position)
          const quad = QUADRANTS[quadCode]
          const cellX = PLOT_X0 + col * CELL_W
          const cellY = PLOT_Y0 + (2 - row) * CELL_H
          // Label tucked into each cell's top-right corner with a
          // translucent shield — keeps it readable even if a bubble
          // crosses it, and stays consistently placed across cells.
          const labelText = quad.shortLabel
          const labelW = labelText.length * 5.5 + 12
          return (
            <g key={`${col}-${row}`}>
              <rect
                x={cellX} y={cellY}
                width={CELL_W} height={CELL_H}
                fill={quad.tintBg} stroke="rgba(255,255,255,0.05)" strokeWidth={0.5}
              />
              <rect
                x={cellX + CELL_W - labelW - 6}
                y={cellY + 6}
                width={labelW} height={14}
                rx={2} ry={2}
                fill="rgba(10,18,34,0.72)"
              />
              <text
                x={cellX + CELL_W - 12}
                y={cellY + 16}
                fontSize={9} fill={quad.color}
                textAnchor="end"
                style={{ letterSpacing: '0.2em', fontWeight: 700 }}
              >
                {labelText}
              </text>
            </g>
          )
        })}

        {/* Dashed grid */}
        {[1, 2].map(i => (
          <line key={`v${i}`}
            x1={PLOT_X0 + i * CELL_W} y1={PLOT_Y0}
            x2={PLOT_X0 + i * CELL_W} y2={PLOT_Y1}
            stroke="var(--br)" strokeDasharray="3 3" strokeWidth={1}
          />
        ))}
        {[1, 2].map(i => (
          <line key={`h${i}`}
            x1={PLOT_X0} y1={PLOT_Y0 + i * CELL_H}
            x2={PLOT_X1} y2={PLOT_Y0 + i * CELL_H}
            stroke="var(--br)" strokeDasharray="3 3" strokeWidth={1}
          />
        ))}
        {/* Outer plot frame */}
        <rect x={PLOT_X0} y={PLOT_Y0} width={PLOT_X1 - PLOT_X0} height={PLOT_Y1 - PLOT_Y0}
              fill="none" stroke="var(--br)" strokeWidth={1} />

        {/* Axis labels */}
        <text x={(PLOT_X0 + PLOT_X1) / 2} y={VB_H - 10} fontSize={10} fill="var(--txt3)"
              textAnchor="middle" style={{ letterSpacing: '.25em', fontWeight: 700 }}>
          COMPETITIVE POSITION →
        </text>
        <text x={20} y={(PLOT_Y0 + PLOT_Y1) / 2} fontSize={10} fill="var(--txt3)"
              textAnchor="middle" style={{ letterSpacing: '.25em', fontWeight: 700 }}
              transform={`rotate(-90 20 ${(PLOT_Y0 + PLOT_Y1) / 2})`}>
          INDUSTRY ATTRACTIVENESS →
        </text>

        {/* Tier tick labels on axes */}
        {(['Weak', 'Medium', 'Strong'] as const).map((label, i) => (
          <text key={label} x={PLOT_X0 + i * CELL_W + CELL_W / 2} y={PLOT_Y1 + 18}
                fontSize={9} fill="var(--txt4)" textAnchor="middle" style={{ letterSpacing: '.2em' }}>
            {label.toUpperCase()}
          </text>
        ))}
        {(['High', 'Medium', 'Low'] as const).map((label, i) => (
          <text key={label} x={PLOT_X0 - 10} y={PLOT_Y0 + i * CELL_H + CELL_H / 2 + 3}
                fontSize={9} fill="var(--txt4)" textAnchor="end" style={{ letterSpacing: '.2em' }}>
            {label.toUpperCase()}
          </text>
        ))}

        {/* Bubbles — radius tuned so ₹500Cr≈8px and ₹1,00,000Cr≈21px,
            small enough that quadrant labels in the top-right corner
            stay readable even when a bubble drifts near them. */}
        {scored.filter(s => s.industryScore !== null && s.positionScore !== null).map(s => {
          const x = scoreToX(s.positionScore!)
          const y = scoreToY(s.industryScore!)
          const ev = s.input.evCr || 0
          const r = Math.max(6, Math.min(22, Math.sqrt(Math.max(ev, 1)) * 0.08 + 5))
          const col = s.quadrant?.color || '#888'
          const isHover = hoverTicker === s.input.ticker
          return (
            <g
              key={s.input.ticker}
              onMouseEnter={e => {
                const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
                const parentRect = (e.currentTarget.ownerSVGElement!.parentElement!.getBoundingClientRect())
                const px = rect.left - parentRect.left + (x / VB_W) * rect.width
                const py = rect.top - parentRect.top + (y / VB_H) * rect.height
                onHover(s.input.ticker, { x: px, y: py })
              }}
              onMouseLeave={() => onHover(null, null)}
              onClick={() => onClick(s.input.ticker)}
              style={{ cursor: 'pointer' }}
            >
              {/* halo */}
              <circle cx={x} cy={y} r={r + 6} fill={col} opacity={isHover ? 0.25 : 0.12} />
              {/* body */}
              <circle cx={x} cy={y} r={r} fill={col} opacity={0.82} stroke="#0a1222" strokeWidth={1.5} />
              {/* inner highlight */}
              <circle cx={x - r * 0.25} cy={y - r * 0.25} r={r * 0.4} fill="rgba(255,255,255,0.10)" />
              {/* label */}
              <text x={x} y={y + r + 12} fontSize={9} fill="var(--txt2)" textAnchor="middle"
                    style={{ fontWeight: 600 }}>{s.input.name.length > 22 ? s.input.name.slice(0, 20) + '…' : s.input.name}</text>
              <text x={x} y={y + r + 22} fontSize={8} fill="var(--txt4)" textAnchor="middle"
                    style={{ fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
                {s.input.ev_ebitda === null ? '—' : formatRatioX(s.input.ev_ebitda)}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function pickQuadrantInline(industry: 'low' | 'medium' | 'high', position: 'weak' | 'medium' | 'strong') {
  if (industry === 'high' && position === 'strong') return 'rising_star'
  if (industry === 'high' && position === 'medium') return 'emerging_challenger'
  if (industry === 'high' && position === 'weak') return 'question_mark'
  if (industry === 'medium' && position === 'strong') return 'undervalued_leader'
  if (industry === 'medium' && position === 'medium') return 'hold_watch'
  if (industry === 'medium' && position === 'weak') return 'restructure'
  if (industry === 'low' && position === 'strong') return 'cash_cow'
  if (industry === 'low' && position === 'medium') return 'harvest'
  return 'divest'
}

function TooltipCard({ scored, x, y }: { scored: ScoredTarget; x: number; y: number }) {
  const qColor = scored.quadrant?.color || 'var(--txt4)'
  // Clamp to keep tooltip inside the panel
  const left = Math.max(10, Math.min(x + 14, 9999))
  const top = Math.max(10, y - 30)
  return (
    <div style={{
      position: 'absolute', left, top, zIndex: 40, pointerEvents: 'none',
      width: 340, background: 'var(--s1)', border: `1px solid ${qColor}`,
      borderRadius: 8, padding: '10px 12px',
      boxShadow: '0 10px 30px rgba(0,0,0,0.35)', fontSize: 11,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, borderBottom: '1px solid var(--br)', paddingBottom: 6, marginBottom: 8 }}>
        <div style={{ fontWeight: 700, color: 'var(--txt)' }}>{scored.input.name}</div>
        <div style={{ fontSize: 9, color: 'var(--txt4)' }}>{scored.input.ticker}</div>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.3px', color: qColor }}>
          {scored.quadrant?.label || 'UNSCORED'}
          {scored.valuationOverrideApplied ? ' ★' : ''}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '.12em', textTransform: 'uppercase' }}>Industry Y</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--txt)', fontFamily: "'JetBrains Mono', monospace" }}>
            {scored.industryScore === null ? '—' : scored.industryScore.toFixed(1)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '.12em', textTransform: 'uppercase' }}>Position X</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--txt)', fontFamily: "'JetBrains Mono', monospace" }}>
            {scored.positionScore === null ? '—' : scored.positionScore.toFixed(1)}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 10, color: 'var(--txt2)', marginBottom: 6 }}>
        <span style={{ color: qColor, fontWeight: 700 }}>◆</span> {scored.thesis}
      </div>

      <BreakdownTable rows={scored.breakdown.industry} title="Industry breakdown (weighted)" />
      <div style={{ height: 6 }} />
      <BreakdownTable rows={scored.breakdown.position} title="Position breakdown (weighted)" />

      <div style={{ fontSize: 9, color: 'var(--txt4)', marginTop: 6, fontStyle: 'italic' }}>
        EV {formatInrCr(scored.input.evCr)} · EV/EBITDA {scored.input.ev_ebitda === null ? '—' : formatRatioX(scored.input.ev_ebitda)}
        {scored.valuationOverrideApplied ? ' · ★ promoted by valuation override' : ''}
      </div>
    </div>
  )
}

function BreakdownTable({ rows, title }: { rows: ScoredTarget['breakdown']['industry'] | ScoredTarget['breakdown']['position']; title: string }) {
  if (!rows.length) {
    return (
      <div>
        <div style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 10, color: 'var(--txt4)', fontStyle: 'italic' }}>No scorable inputs — axis excluded.</div>
      </div>
    )
  }
  return (
    <div>
      <div style={{ fontSize: 9, color: 'var(--txt3)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 4 }}>{title}</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td style={{ color: 'var(--txt3)', padding: '1px 0' }}>
                {INPUT_LABELS[r.key].label}
                <span style={{ marginLeft: 6, padding: '1px 4px', borderRadius: 3, fontSize: 8, background: provenanceBg(r.provenance), color: provenanceFg(r.provenance) }}>
                  {provenanceShort(r.provenance)}
                </span>
              </td>
              <td style={{ textAlign: 'right', color: 'var(--txt2)', fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }}>
                {formatRaw(r.key, r.raw)}
              </td>
              <td style={{ textAlign: 'right', color: 'var(--txt4)', fontFamily: "'JetBrains Mono', monospace" }}>
                × {(r.weight * 100).toFixed(0)}%
              </td>
              <td style={{ textAlign: 'right', color: 'var(--txt)', fontFamily: "'JetBrains Mono', monospace", fontWeight: 600 }}>
                {r.contribution.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function formatRaw(key: MatrixInputKey, raw: number): string {
  const l = INPUT_LABELS[key]
  if (l.unit === '%') return `${raw.toFixed(1)}%`
  if (l.unit === 'pp') return `${raw > 0 ? '+' : ''}${raw.toFixed(1)}pp`
  if (l.unit === '$bn') return `$${raw.toFixed(1)}bn`
  if (l.unit === '#') return `#${raw.toFixed(0)}`
  if (l.unit === 'score' || l.unit === '0-100') return raw.toFixed(0)
  return raw.toFixed(1)
}

function provenanceBg(p: string): string {
  if (p === 'derived') return 'rgba(79,179,137,0.18)'
  if (p === 'chain') return 'rgba(107,155,196,0.18)'
  if (p === 'manual') return 'rgba(212,165,116,0.18)'
  if (p === 'default') return 'rgba(155,127,184,0.18)'
  return 'rgba(177,101,102,0.18)'
}
function provenanceFg(p: string): string {
  if (p === 'derived') return '#4fb389'
  if (p === 'chain') return '#6b9bc4'
  if (p === 'manual') return '#d4a574'
  if (p === 'default') return '#9b7fb8'
  return '#b16566'
}
function provenanceShort(p: string): string {
  if (p === 'derived') return 'auto'
  if (p === 'chain') return 'chain'
  if (p === 'manual') return 'manual'
  if (p === 'default') return 'default'
  return 'n/a'
}

function InsightsPanel({ summary, scored, onPickTarget }: {
  summary: ReturnType<typeof summarize>
  scored: ScoredTarget[]
  onPickTarget: (ticker: string) => void
}) {
  const top3 = [...scored]
    .filter(s => s.quadrant)
    .sort((a, b) => {
      // Prefer Undervalued Leader, then Rising Star, then Emerging Challenger, then score
      const rank = (c: string) => QUADRANT_PRIORITY[c] ?? 99
      const ar = rank(a.quadrant!.code), br = rank(b.quadrant!.code)
      if (ar !== br) return ar - br
      return (b.industryScore! + b.positionScore!) - (a.industryScore! + a.positionScore!)
    })
    .slice(0, 3)

  return (
    <div style={{ background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 10, padding: 14 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.25em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 8 }}>Editorial Callouts</div>
      {top3.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--txt3)' }}>No plottable targets yet. Fill manual inputs or relax filters.</div>
      )}
      {top3.map((s, i) => {
        const q = s.quadrant!
        return (
          <div key={s.input.ticker} style={{ marginBottom: 12, paddingBottom: 10, borderBottom: i < top3.length - 1 ? '1px solid var(--br)' : 'none' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 4 }}>
              <div style={{ fontFamily: 'Source Serif 4, Georgia, serif', fontSize: 20, fontWeight: 700, color: q.color, lineHeight: 1 }}>0{i + 1}</div>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.3em', color: q.color, textTransform: 'uppercase' }}>{q.shortLabel}</span>
              {s.valuationOverrideApplied && (
                <span style={{ fontSize: 9, color: '#d4a574', marginLeft: 4 }}>★ valuation override</span>
              )}
            </div>
            <div style={{ fontFamily: 'Source Serif 4, Georgia, serif', fontSize: 14, fontWeight: 600, color: 'var(--txt)', marginBottom: 2, cursor: 'pointer' }}
                 onClick={() => onPickTarget(s.input.ticker)}>
              {s.input.name}
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt2)', lineHeight: 1.4 }}>
              {q.thesis} <span style={{ color: 'var(--txt4)' }}>·
                Industry {s.industryScore?.toFixed(0)} · Position {s.positionScore?.toFixed(0)}
                {s.input.ev_ebitda !== null ? ` · ${formatRatioX(s.input.ev_ebitda)}` : ''}</span>
            </div>
          </div>
        )
      })}
      <div style={{ marginTop: 6, padding: '8px 10px', background: 'rgba(212,165,116,0.06)', border: '1px dashed rgba(212,165,116,0.4)', borderRadius: 6, fontSize: 10, color: 'var(--txt2)', lineHeight: 1.5 }}>
        <span style={{ color: '#d4a574', fontWeight: 700 }}>Undervalued Leaders</span> surface when a strong-position target trades below {(DEFAULT_CONFIG.peerBenchmarkMultiple * DEFAULT_CONFIG.valuationDiscount).toFixed(1)}× EV/EBITDA (at the active lens).
      </div>
    </div>
  )
}

function ManualInputEditor({
  scored,
  onSet,
  onApplyDefault,
  onClear,
}: {
  scored: ScoredTarget
  onSet: (key: MatrixInputKey, value: number | null, note?: string) => void
  onApplyDefault: (key: MatrixInputKey) => void
  onClear: (key: MatrixInputKey) => void
}) {
  const allKeys = [...INDUSTRY_KEYS, ...POSITION_KEYS] as MatrixInputKey[]
  const hasDefault = new Set<MatrixInputKey>([
    'competitive_intensity', 'cyclicality', 'moat_score', 'management_quality', 'customer_concentration', 'market_share_rank',
  ])
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt)' }}>{scored.input.name} — Inputs</div>
        <div style={{ fontSize: 9, color: 'var(--txt4)' }}>auto = derived · chain = parsed from value-chain narrative · manual = your view · default = sector guidance</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
        {allKeys.map(key => {
          const cell = scored.inputs[key]
          const l = INPUT_LABELS[key]
          return (
            <div key={key} style={{ border: '1px solid var(--br)', borderRadius: 6, padding: '8px 10px', background: 'var(--s2)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--txt2)' }}>{l.label}</div>
                <div style={{ flex: 1 }} />
                <span style={{ padding: '1px 5px', borderRadius: 3, fontSize: 8, background: provenanceBg(cell.provenance), color: provenanceFg(cell.provenance) }}>{provenanceShort(cell.provenance)}</span>
              </div>
              <div style={{ fontSize: 9, color: 'var(--txt4)', marginTop: 2 }}>{l.hint}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <input
                  type="number"
                  value={cell.value === null ? '' : cell.value}
                  placeholder="—"
                  onChange={e => {
                    const raw = e.target.value
                    if (raw === '') onSet(key, null, 'Cleared by user')
                    else {
                      const n = parseFloat(raw)
                      if (Number.isFinite(n)) onSet(key, n, 'Manual input')
                    }
                  }}
                  style={inputStyle(110)}
                />
                <span style={{ fontSize: 10, color: 'var(--txt4)' }}>{l.unit}</span>
                <div style={{ flex: 1 }} />
                {hasDefault.has(key) && (
                  <button
                    onClick={() => onApplyDefault(key)}
                    title="Apply sector / segment default"
                    style={smallBtn()}
                  >
                    default
                  </button>
                )}
                <button onClick={() => onClear(key)} style={smallBtn()}>clear</button>
              </div>
              {cell.note && (
                <div style={{ fontSize: 9, color: 'var(--txt4)', marginTop: 4, fontStyle: 'italic' }}>{cell.note}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function MethodologyBlock({ config }: { config: typeof DEFAULT_CONFIG }) {
  return (
    <div style={{ marginTop: 10, padding: 12, background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 8, fontSize: 10, color: 'var(--txt2)', lineHeight: 1.55 }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.25em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 6 }}>Methodology</div>
      <div>
        Each target is scored on two axes. Raw inputs are normalized to 0–100, multiplied by their weight, and summed. Missing inputs are dropped and their weight redistributed proportionally across the remaining inputs on that axis — so a partial fill still gives a tier, but with narrower confidence.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 4 }}>Industry (Y)</div>
          {(Object.keys(config.industryWeights) as (keyof typeof config.industryWeights)[]).map(k => (
            <div key={k} style={{ display: 'flex', gap: 8, fontSize: 10 }}>
              <div style={{ flex: 1, color: 'var(--txt2)' }}>{INPUT_LABELS[k].label}</div>
              <div style={{ color: 'var(--txt3)', fontFamily: "'JetBrains Mono', monospace" }}>{(config.industryWeights[k] * 100).toFixed(0)}%</div>
            </div>
          ))}
        </div>
        <div>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.15em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 4 }}>Position (X)</div>
          {(Object.keys(config.positionWeights) as (keyof typeof config.positionWeights)[]).map(k => (
            <div key={k} style={{ display: 'flex', gap: 8, fontSize: 10 }}>
              <div style={{ flex: 1, color: 'var(--txt2)' }}>{INPUT_LABELS[k].label}</div>
              <div style={{ color: 'var(--txt3)', fontFamily: "'JetBrains Mono', monospace" }}>{(config.positionWeights[k] * 100).toFixed(0)}%</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <span style={{ color: '#d4a574', fontWeight: 700 }}>★ Valuation override:</span> when a strong-position target has EV/EBITDA below{' '}
        {(config.peerBenchmarkMultiple * config.valuationDiscount).toFixed(1)}× it is promoted to Undervalued Leader. Rising Stars are not demoted by this rule.
      </div>
    </div>
  )
}

// ── Style helpers ────────────────────────────────────────────────────

function inputStyle(width?: number): React.CSSProperties {
  return {
    background: 'var(--s3)', border: '1px solid var(--br)', color: 'var(--txt)',
    padding: '5px 8px', borderRadius: 4, fontSize: 11, fontFamily: 'inherit',
    width,
  }
}

function smallBtn(): React.CSSProperties {
  return {
    background: 'transparent', border: '1px solid var(--br)', color: 'var(--txt3)',
    padding: '2px 6px', borderRadius: 3, fontSize: 9, fontFamily: 'inherit',
    cursor: 'pointer', letterSpacing: '.1em', textTransform: 'uppercase',
  }
}

function thStyle(): React.CSSProperties {
  return { padding: '6px 8px', borderBottom: '1px solid var(--br)' }
}
function thStyleRight(): React.CSSProperties {
  return { ...thStyle(), textAlign: 'right' }
}
function tdStyle(): React.CSSProperties {
  return { padding: '8px', color: 'var(--txt2)', verticalAlign: 'top' }
}
function tdStyleRight(): React.CSSProperties {
  return { ...tdStyle(), textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontVariantNumeric: 'tabular-nums' }
}
