'use client'

import { useEffect, useMemo, useState } from 'react'
import { COMPANIES, type Company } from '@/lib/data/companies'
import type { NewsItem } from '@/lib/news/api'
import { relativeDate } from '@/lib/news/api'
import type { NewsImpact } from '@/lib/news/impact'
import {
  PARAM_DEFS,
  PARAM_ORDER,
  autoSignedPct,
  clampAdjustedValue,
  effectiveAdjustmentFactor,
  formatParamValue,
  getBaseValue,
  type ValuationParam,
} from '@/lib/news/params'
import { useNewsAck, newsItemKey } from './NewsAckProvider'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'

/**
 * Full Impact Assessment popup for a single news item.
 *
 * Users can:
 *  - Toggle each valuation parameter ON / OFF independently (checkbox).
 *  - Override the auto-derived magnitude with a signed manual % per
 *    parameter (e.g. +1 for EV/EBITDA, +0.6 for Revenue Growth).
 *  - Add parameters that weren't auto-detected by simply typing a
 *    non-zero manual % — they become active.
 *  - See a LIVE pre/post preview against any affected company so they
 *    can judge the effect on EV/EBITDA, growth, margin, management,
 *    and composite acquisition score before acknowledging.
 *  - Apply (Acknowledge), Reset to auto, or Remove (un-acknowledge).
 *
 * The modal works on a local draft state seeded from the provider. It
 * only commits to the NewsAckProvider on "Apply". "Cancel" discards
 * the draft.
 */

interface NewsImpactModalProps {
  open: boolean
  onClose: () => void
  item: NewsItem
  impact: NewsImpact
}

type DraftEntry = {
  /** null = use auto, number = manual signed %, 0 also valid */
  manual: number | null
  /** true = param is disabled (auto and manual both ignored) */
  disabled: boolean
}

type Draft = Partial<Record<ValuationParam, DraftEntry>>

function buildInitialDraft(
  itemKey: string,
  impact: NewsImpact,
  getManualOverride: (k: string, p: ValuationParam) => number | null,
  isParamDisabled: (k: string, p: ValuationParam) => boolean
): Draft {
  const d: Draft = {}
  for (const p of PARAM_ORDER) {
    const autoDeg = impact.affectedParams[p] || 0
    const m = getManualOverride(itemKey, p)
    const dis = isParamDisabled(itemKey, p)
    // Only store rows that have any signal (auto, manual, or disable).
    if (autoDeg > 0 || m != null || dis) {
      d[p] = { manual: m, disabled: dis }
    }
  }
  return d
}

function draftEntry(draft: Draft, param: ValuationParam): DraftEntry {
  return draft[param] ?? { manual: null, disabled: false }
}

/** Effective signed % for a parameter given draft + auto degree + sentiment. */
function effectivePct(
  impact: NewsImpact,
  draft: Draft,
  param: ValuationParam
): number {
  const row = draftEntry(draft, param)
  if (row.disabled) return 0
  if (row.manual != null) return row.manual
  const autoDeg = impact.affectedParams[param] || 0
  if (autoDeg === 0) return 0
  return autoSignedPct(param, autoDeg, impact.sentiment)
}

/** Effective adjustment factor (0.01 = +1%) for `baseValue * (1 + factor)`. */
function effectiveFactor(
  impact: NewsImpact,
  draft: Draft,
  param: ValuationParam
): number {
  const row = draftEntry(draft, param)
  if (row.disabled) return 0
  const autoDeg = impact.affectedParams[param] || 0
  return effectiveAdjustmentFactor(
    param,
    autoDeg,
    row.manual,
    impact.sentiment
  )
}

/** Preview pre/post values for a specific company based on the draft. */
interface Preview {
  param: ValuationParam
  label: string
  unit: '%' | '×' | '/10'
  pre: number | null
  post: number | null
  deltaPct: number
  active: boolean
}

function buildPreviews(
  co: Company,
  impact: NewsImpact,
  draft: Draft
): Preview[] {
  return PARAM_ORDER.map<Preview>((param) => {
    const def = PARAM_DEFS[param]
    const pre = getBaseValue(param, co)
    const factor = effectiveFactor(impact, draft, param)
    const row = draftEntry(draft, param)
    const active =
      !row.disabled &&
      (row.manual != null || (impact.affectedParams[param] || 0) > 0)
    if (pre == null) {
      return {
        param,
        label: def.label,
        unit: def.unit,
        pre: null,
        post: null,
        deltaPct: 0,
        active,
      }
    }
    const post = clampAdjustedValue(param, pre * (1 + factor))
    const deltaPct = pre !== 0 ? ((post - pre) / pre) * 100 : 0
    return {
      param,
      label: def.label,
      unit: def.unit,
      pre,
      post,
      deltaPct,
      active,
    }
  })
}

// ── Modal component ──────────────────────────────────────────────

export function NewsImpactModal({ open, onClose, item, impact }: NewsImpactModalProps) {
  const {
    isAcknowledged,
    acknowledge,
    unacknowledge,
    setManualOverride,
    getManualOverride,
    isParamDisabled,
    setParamDisabled,
    resetOverrides,
  } = useNewsAck()

  const itemKey = newsItemKey(item)
  const acked = isAcknowledged(itemKey)

  // Live universe so admin-pushed SMEs (user_companies → e.g. Eppeltone)
  // can be picked as candidate / preview companies for impact analysis.
  // Falls back to static COMPANIES when the provider hasn't loaded yet.
  const { allCompanies } = useLiveSnapshot()
  const universe: Company[] = allCompanies.length ? allCompanies : COMPANIES

  // Local draft state — only flushed to provider on Apply.
  const [draft, setDraft] = useState<Draft>(() =>
    buildInitialDraft(itemKey, impact, getManualOverride, isParamDisabled)
  )

  // Re-seed the draft every time the modal re-opens so external
  // changes to the provider are reflected.
  useEffect(() => {
    if (!open) return
    setDraft(buildInitialDraft(itemKey, impact, getManualOverride, isParamDisabled))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemKey])

  // Esc to close.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Preview target company — pick the first auto-affected company as
  // default. If there are none, fall back to a broad-market proxy.
  const candidateCompanies = useMemo<Company[]>(() => {
    const found: Company[] = []
    for (const t of impact.affectedCompanies) {
      const co = universe.find((c) => c.ticker === t)
      if (co) found.push(co)
    }
    return found
  }, [impact.affectedCompanies, universe])

  const [previewTicker, setPreviewTicker] = useState<string>(
    () => candidateCompanies[0]?.ticker ?? ''
  )

  useEffect(() => {
    if (!open) return
    if (!previewTicker && candidateCompanies[0]) {
      setPreviewTicker(candidateCompanies[0].ticker)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, candidateCompanies.length])

  const previewCo = useMemo(
    () => universe.find((c) => c.ticker === previewTicker) ?? null,
    [previewTicker, universe]
  )

  const previews = useMemo<Preview[]>(
    () => (previewCo ? buildPreviews(previewCo, impact, draft) : []),
    [previewCo, impact, draft]
  )

  // Composite preview — shown for the selected preview company.
  const compositeAcqs = useMemo(() => {
    if (!previewCo) return null
    const weights: Partial<Record<ValuationParam, number>> = {
      revenue_growth: 0.25,
      management: 0.15,
      barriers_to_entry: 0.15,
      ebitda_margin: 0.1,
      concentration_risk: 0.1,
    }
    let weighted = 0
    let total = 0
    for (const [p, w] of Object.entries(weights) as Array<[ValuationParam, number]>) {
      const f = effectiveFactor(impact, draft, p)
      if (f !== 0) {
        weighted += f * w
        total += w
      }
    }
    const factor = total > 0 ? (weighted / total) * 0.5 : 0
    const pre = previewCo.acqs
    const post = Math.max(0, Math.min(10, pre * (1 + factor)))
    return {
      pre,
      post,
      deltaPct: pre !== 0 ? ((post - pre) / pre) * 100 : 0,
    }
  }, [previewCo, impact, draft])

  // ── Draft mutators ──
  const updateRow = (param: ValuationParam, patch: Partial<DraftEntry>) => {
    setDraft((prev) => {
      const current = draftEntry(prev, param)
      const next: DraftEntry = { ...current, ...patch }
      // If the row is now a full no-op (not disabled, no manual, no auto),
      // drop it from the draft to keep storage compact.
      const autoDeg = impact.affectedParams[param] || 0
      if (!next.disabled && next.manual == null && autoDeg === 0) {
        const clone = { ...prev }
        delete clone[param]
        return clone
      }
      return { ...prev, [param]: next }
    })
  }

  // ── Actions ──
  const applyAndAck = () => {
    // Ensure the item is acked BEFORE writing manual/disabled so the
    // provider retains them (it drops overrides on un-acked items).
    if (!acked) acknowledge(itemKey)
    // Flush every param in the draft to the provider.
    for (const p of PARAM_ORDER) {
      const row = draft[p]
      if (row) {
        setManualOverride(itemKey, p, row.manual)
        setParamDisabled(itemKey, p, row.disabled)
      } else {
        // Make sure any stale provider state is cleared for un-drafted rows.
        setManualOverride(itemKey, p, null)
        setParamDisabled(itemKey, p, false)
      }
    }
    onClose()
  }

  const resetDraft = () => {
    const fresh: Draft = {}
    for (const p of PARAM_ORDER) {
      const autoDeg = impact.affectedParams[p] || 0
      if (autoDeg > 0) {
        fresh[p] = { manual: null, disabled: false }
      }
    }
    setDraft(fresh)
  }

  const removeAck = () => {
    resetOverrides(itemKey)
    unacknowledge(itemKey)
    // Also reset the draft so if the user re-opens the modal it shows
    // the auto defaults again.
    resetDraft()
    onClose()
  }

  if (!open) return null

  const activeCount = PARAM_ORDER.filter(
    (p) => draftEntry(draft, p).disabled === false && (draftEntry(draft, p).manual != null || (impact.affectedParams[p] || 0) > 0)
  ).length

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(2px)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--s1)',
          border: '1px solid var(--br2)',
          borderRadius: 8,
          width: 'min(820px, 100%)',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px 12px',
            borderBottom: '1px solid var(--br)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: '1.4px',
                textTransform: 'uppercase',
                color: 'var(--gold2)',
                marginBottom: 4,
              }}
            >
              Impact Assessment
            </div>
            <div
              style={{
                fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--txt)',
                lineHeight: 1.35,
                letterSpacing: '-0.005em',
              }}
            >
              {item.title}
            </div>
            <div
              style={{
                marginTop: 6,
                display: 'flex',
                flexWrap: 'wrap',
                gap: 10,
                fontSize: 10,
                color: 'var(--txt3)',
              }}
            >
              {item.source && (
                <span style={{ color: 'var(--txt2)', fontWeight: 600 }}>
                  {item.source}
                </span>
              )}
              {item.pubDate && (
                <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {relativeDate(item.pubDate)}
                </span>
              )}
              <span
                style={{
                  color:
                    impact.sentiment === 'positive'
                      ? 'var(--green)'
                      : impact.sentiment === 'negative'
                        ? 'var(--red)'
                        : 'var(--txt3)',
                  fontWeight: 700,
                  letterSpacing: '0.4px',
                }}
              >
                {impact.sentiment === 'positive'
                  ? '▲'
                  : impact.sentiment === 'negative'
                    ? '▼'
                    : '●'}{' '}
                {impact.sentiment.toUpperCase()} ({impact.sentimentScore > 0 ? '+' : ''}
                {impact.sentimentScore})
              </span>
              <span
                style={{
                  color: 'var(--txt2)',
                  textTransform: 'uppercase',
                  fontWeight: 600,
                  letterSpacing: '0.4px',
                }}
              >
                ◆ {impact.category} · {impact.materiality}
              </span>
              {impact.multipleDeltaPct !== 0 && (
                <span
                  style={{
                    color:
                      impact.multipleDeltaPct >= 0
                        ? 'var(--green)'
                        : 'var(--red)',
                    fontFamily: 'JetBrains Mono, monospace',
                    fontWeight: 700,
                  }}
                >
                  {impact.multipleDeltaPct >= 0 ? '+' : ''}
                  {impact.multipleDeltaPct.toFixed(2)}% est. EV/EBITDA
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: '1px solid var(--br)',
              borderRadius: 4,
              color: 'var(--txt2)',
              fontSize: 16,
              width: 28,
              height: 28,
              cursor: 'pointer',
              flexShrink: 0,
              fontFamily: 'inherit',
            }}
          >
            ×
          </button>
        </div>

        {/* Affected companies row — select preview target */}
        <div
          style={{
            padding: '10px 18px',
            borderBottom: '1px solid var(--br)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              fontSize: 9,
              color: 'var(--txt3)',
              fontWeight: 700,
              letterSpacing: '1px',
              textTransform: 'uppercase',
              marginRight: 4,
            }}
          >
            Preview on
          </span>
          {candidateCompanies.length === 0 ? (
            <span style={{ fontSize: 11, color: 'var(--txt3)', fontStyle: 'italic' }}>
              No tracked company detected in this article. Adjustments will
              still apply to any company matched later via the aggregator.
            </span>
          ) : (
            candidateCompanies.map((c) => {
              const sel = previewTicker === c.ticker
              return (
                <button
                  key={c.ticker}
                  onClick={() => setPreviewTicker(c.ticker)}
                  style={{
                    background: sel ? 'var(--golddim)' : 'transparent',
                    border: `1px solid ${sel ? 'var(--gold2)' : 'var(--br)'}`,
                    color: sel ? 'var(--gold2)' : 'var(--txt2)',
                    padding: '4px 10px',
                    fontSize: 10,
                    fontWeight: sel ? 700 : 500,
                    letterSpacing: '0.3px',
                    borderRadius: 3,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {c.ticker} · {c.name.split(' ').slice(0, 2).join(' ')}
                </button>
              )
            })
          )}
        </div>

        {/* Parameters table */}
        <div style={{ padding: '14px 18px' }}>
          <div
            style={{
              fontSize: 9,
              color: 'var(--txt3)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              fontWeight: 700,
              marginBottom: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>Parameters ({activeCount} active)</span>
            <span style={{ fontSize: 9, color: 'var(--txt3)' }}>
              Tick to enable · Manual % overrides Auto
            </span>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '24px 1.6fr 0.9fr 1fr 0.9fr',
              gap: 6,
              alignItems: 'center',
              fontSize: 11,
              background: 'var(--s2)',
              border: '1px solid var(--br)',
              borderRadius: 5,
              padding: '8px 10px',
            }}
          >
            <div />
            <ParamHeader label="Parameter" />
            <ParamHeader label="Auto" align="right" />
            <ParamHeader label="Manual %" align="center" />
            <ParamHeader label="Effective" align="right" />

            {PARAM_ORDER.map((param) => {
              const def = PARAM_DEFS[param]
              const autoDeg = impact.affectedParams[param] || 0
              const row = draftEntry(draft, param)
              const autoPct = autoSignedPct(param, autoDeg, impact.sentiment)
              const eff = effectivePct(impact, draft, param)
              const active =
                !row.disabled && (row.manual != null || autoDeg > 0)
              return (
                <ParamModalRow
                  key={param}
                  label={def.label}
                  short={def.short}
                  autoPct={autoDeg > 0 ? autoPct : null}
                  manual={row.manual}
                  effective={eff}
                  active={active}
                  disabled={row.disabled}
                  onToggleEnabled={(enabled) =>
                    updateRow(param, { disabled: !enabled })
                  }
                  onManualChange={(v) => updateRow(param, { manual: v })}
                />
              )
            })}
          </div>
        </div>

        {/* Pre/post preview panel */}
        {previewCo && (
          <div
            style={{
              padding: '0 18px 14px',
            }}
          >
            <div
              style={{
                fontSize: 9,
                color: 'var(--txt3)',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                fontWeight: 700,
                marginBottom: 6,
              }}
            >
              Impact preview — {previewCo.name}
            </div>
            <div
              style={{
                background: 'var(--s2)',
                border: '1px solid var(--br)',
                borderRadius: 5,
                padding: '10px 12px',
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 6,
                fontSize: 11,
              }}
            >
              {previews
                .filter((p) => p.active && p.pre != null)
                .map((p) => (
                  <PrePostRow key={p.param} preview={p} />
                ))}
              {compositeAcqs && (
                <PrePostRow
                  preview={{
                    param: 'revenue_growth',
                    label: 'Composite Acq Score',
                    unit: '/10',
                    pre: compositeAcqs.pre,
                    post: compositeAcqs.post,
                    deltaPct: compositeAcqs.deltaPct,
                    active: true,
                  }}
                  accent
                />
              )}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--br)',
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <button
            onClick={resetDraft}
            style={footerBtn('ghost')}
            title="Revert all rows to the auto-derived defaults"
          >
            ↺ Reset to Auto
          </button>
          {acked && (
            <button
              onClick={removeAck}
              style={footerBtn('danger')}
              title="Remove this item from valuation — go back to baseline"
            >
              ✕ Remove / Revert
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={footerBtn('ghost')}>
            Cancel
          </button>
          <button
            onClick={applyAndAck}
            style={footerBtn('primary')}
            title="Acknowledge and apply the current adjustments to valuation"
          >
            {acked ? '✓ Save changes' : '✓ Apply & Acknowledge'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Subcomponents ─────────────────────────────────────────────

function ParamHeader({
  label,
  align,
}: {
  label: string
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <div
      style={{
        fontSize: 8,
        color: 'var(--txt3)',
        textTransform: 'uppercase',
        letterSpacing: '0.6px',
        fontWeight: 700,
        textAlign: align ?? 'left',
      }}
    >
      {label}
    </div>
  )
}

function ParamModalRow({
  label,
  short,
  autoPct,
  manual,
  effective,
  active,
  disabled,
  onToggleEnabled,
  onManualChange,
}: {
  label: string
  short: string
  autoPct: number | null
  manual: number | null
  effective: number
  active: boolean
  disabled: boolean
  onToggleEnabled: (enabled: boolean) => void
  onManualChange: (value: number | null) => void
}) {
  const [draft, setDraft] = useState<string>(
    manual != null ? String(manual) : ''
  )

  // Keep draft in sync if the parent resets the manual value externally.
  useEffect(() => {
    setDraft(manual != null ? String(manual) : '')
  }, [manual])

  const effColor =
    effective > 0
      ? 'var(--green)'
      : effective < 0
        ? 'var(--red)'
        : 'var(--txt3)'
  const autoColor =
    autoPct == null
      ? 'var(--txt3)'
      : autoPct > 0
        ? 'var(--green)'
        : autoPct < 0
          ? 'var(--red)'
          : 'var(--txt3)'

  return (
    <>
      <input
        type="checkbox"
        checked={active && !disabled}
        onChange={(e) => onToggleEnabled(e.target.checked)}
        style={{
          cursor: 'pointer',
          accentColor: 'var(--gold2)',
          width: 14,
          height: 14,
        }}
        title={active ? 'Disable this parameter for this item' : 'Enable this parameter'}
      />
      <div
        style={{
          fontSize: 11,
          color: disabled ? 'var(--txt3)' : 'var(--txt)',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          textDecoration: disabled ? 'line-through' : 'none',
        }}
        title={label}
      >
        <span>{label}</span>
        <span style={{ fontSize: 9, color: 'var(--txt3)' }}>· {short}</span>
      </div>
      <div
        style={{
          fontSize: 11,
          fontFamily: 'JetBrains Mono, monospace',
          fontWeight: 600,
          color: autoColor,
          textAlign: 'right',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {autoPct == null
          ? '—'
          : `${autoPct > 0 ? '+' : ''}${autoPct.toFixed(1)}%`}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <input
          type="number"
          step={0.1}
          value={draft}
          placeholder={autoPct == null ? 'e.g. +1' : 'auto'}
          disabled={disabled}
          onChange={(e) => {
            const v = e.target.value
            setDraft(v)
            if (v === '' || v === '-') {
              onManualChange(null)
              return
            }
            const n = parseFloat(v)
            if (Number.isFinite(n)) onManualChange(n)
          }}
          onBlur={() => {
            if (draft === '' || draft === '-') {
              onManualChange(null)
              setDraft('')
            }
          }}
          style={{
            width: '100%',
            maxWidth: 78,
            background: 'var(--s3)',
            border: `1px solid ${
              manual != null ? 'var(--gold2)' : 'var(--br)'
            }`,
            color: 'var(--txt)',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 11,
            padding: '4px 6px',
            borderRadius: 3,
            outline: 'none',
            textAlign: 'center',
            opacity: disabled ? 0.4 : 1,
            cursor: disabled ? 'not-allowed' : 'text',
          }}
        />
      </div>
      <div
        style={{
          fontSize: 11,
          fontFamily: 'JetBrains Mono, monospace',
          fontWeight: 700,
          color: effColor,
          textAlign: 'right',
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {disabled ? 'off' : `${effective > 0 ? '+' : ''}${effective.toFixed(1)}%`}
        {manual != null && !disabled && (
          <span
            style={{
              fontSize: 8,
              color: 'var(--gold2)',
              marginLeft: 3,
              fontWeight: 600,
            }}
            title="Manual override"
          >
            M
          </span>
        )}
      </div>
    </>
  )
}

function PrePostRow({
  preview,
  accent,
}: {
  preview: Preview
  accent?: boolean
}) {
  const { label, unit, pre, post, deltaPct } = preview
  if (pre == null || post == null) return null
  const fmt = (v: number): string => {
    if (unit === '×') return v.toFixed(2) + '×'
    if (unit === '/10') return v.toFixed(1) + '/10'
    return v.toFixed(1) + '%'
  }
  const color =
    deltaPct > 0 ? 'var(--green)' : deltaPct < 0 ? 'var(--red)' : 'var(--txt3)'
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        background: accent ? 'var(--golddim)' : 'transparent',
        border: accent ? '1px solid var(--gold2)' : 'none',
        borderRadius: 4,
        padding: accent ? '6px 8px' : '4px 0',
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: 'var(--txt3)',
          textTransform: 'uppercase',
          letterSpacing: '0.6px',
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--txt)',
        }}
      >
        {fmt(pre)} <span style={{ color: 'var(--txt3)' }}>→</span>{' '}
        <span style={{ color }}>{fmt(post)}</span>
        <span
          style={{
            marginLeft: 6,
            fontSize: 10,
            color,
            fontWeight: 700,
          }}
        >
          ({deltaPct > 0 ? '+' : ''}
          {deltaPct.toFixed(2)}%)
        </span>
      </div>
    </div>
  )
}

// Small style helper for footer buttons.
function footerBtn(variant: 'primary' | 'ghost' | 'danger'): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
    padding: '7px 14px',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    border: '1px solid',
  }
  if (variant === 'primary') {
    return {
      ...base,
      background: 'var(--gold2)',
      color: '#000',
      borderColor: 'var(--gold2)',
    }
  }
  if (variant === 'danger') {
    return {
      ...base,
      background: 'var(--reddim)',
      color: 'var(--red)',
      borderColor: 'var(--red)',
    }
  }
  return {
    ...base,
    background: 'transparent',
    color: 'var(--txt2)',
    borderColor: 'var(--br)',
  }
}

// Avoid an unused-import warning from the formatter.
void formatParamValue
