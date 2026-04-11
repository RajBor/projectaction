'use client'

import { useState } from 'react'
import type { NewsItem } from '@/lib/news/api'
import type { NewsImpact } from '@/lib/news/impact'
import { relativeDate } from '@/lib/news/api'
import { useNewsAck, newsItemKey } from './NewsAckProvider'
import {
  PARAM_DEFS,
  PARAM_ORDER,
  autoSignedPct,
  type ValuationParam,
} from '@/lib/news/params'

interface NewsCardProps {
  item: NewsItem
  impact: NewsImpact
  compact?: boolean
  /**
   * When true, renders an "Acknowledge impact" button. Clicking it toggles
   * whether this item's impact is applied to downstream estimations
   * (e.g. the Valuation page's news-adjusted EV/EBITDA). Off by default so
   * cards used in purely informational contexts stay clean.
   */
  showAcknowledge?: boolean
}

function sentimentColor(sentiment: NewsImpact['sentiment']): string {
  if (sentiment === 'positive') return 'var(--green)'
  if (sentiment === 'negative') return 'var(--red)'
  return 'var(--txt3)'
}
function sentimentDim(sentiment: NewsImpact['sentiment']): string {
  if (sentiment === 'positive') return 'var(--greendim)'
  if (sentiment === 'negative') return 'var(--reddim)'
  return 'var(--s3)'
}
function sentimentArrow(sentiment: NewsImpact['sentiment']): string {
  if (sentiment === 'positive') return '▲'
  if (sentiment === 'negative') return '▼'
  return '●'
}
function materialityColor(m: NewsImpact['materiality']): string {
  if (m === 'high') return 'var(--gold2)'
  if (m === 'medium') return 'var(--cyan2)'
  return 'var(--txt3)'
}
function categoryColor(c: NewsImpact['category']): string {
  switch (c) {
    case 'regulatory':
      return 'var(--purple)'
    case 'strategic':
      return 'var(--gold2)'
    case 'financial':
      return 'var(--cyan2)'
    case 'operational':
      return 'var(--green)'
    case 'market':
      return 'var(--orange)'
    default:
      return 'var(--txt3)'
  }
}

export function NewsCard({
  item,
  impact,
  compact = false,
  showAcknowledge = false,
}: NewsCardProps) {
  const sColor = sentimentColor(impact.sentiment)
  const sBg = sentimentDim(impact.sentiment)

  const { isAcknowledged, toggle, getManualOverride, setManualOverride } =
    useNewsAck()
  const itemKey = newsItemKey(item)
  const acked = isAcknowledged(itemKey)
  const canAck =
    showAcknowledge &&
    (impact.multipleDeltaPct !== 0 ||
      impact.affectedCompanies.length > 0 ||
      impact.isPolicy)

  const affectedParamEntries = PARAM_ORDER.filter(
    (p) => (impact.affectedParams[p] || 0) > 0
  ).map((p) => [p, impact.affectedParams[p] as number] as const)
  const hasParams = affectedParamEntries.length > 0

  const [paramExpanded, setParamExpanded] = useState(false)

  return (
    <article
      style={{
        display: 'flex',
        gap: 10,
        background: acked ? 'var(--golddim)' : 'var(--s1)',
        border: `1px solid ${acked ? 'var(--gold2)' : 'var(--br)'}`,
        borderLeft: `3px solid ${sColor}`,
        borderRadius: 5,
        padding: compact ? '9px 11px' : '12px 14px',
        transition: 'border-color 0.15s, background 0.15s',
      }}
      onMouseEnter={(e) => {
        if (!acked) e.currentTarget.style.borderColor = 'var(--br2)'
        e.currentTarget.style.borderLeftColor = sColor
      }}
      onMouseLeave={(e) => {
        if (!acked) e.currentTarget.style.borderColor = 'var(--br)'
        e.currentTarget.style.borderLeftColor = sColor
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Meta row: source + date + category + materiality */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 5,
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '0.3px',
          }}
        >
          {item.source && (
            <span style={{ color: 'var(--txt2)', fontWeight: 600 }}>
              {item.source}
            </span>
          )}
          {item.source && item.pubDate && <span>·</span>}
          {item.pubDate && (
            <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {relativeDate(item.pubDate)}
            </span>
          )}
          <span
            style={{
              color: categoryColor(impact.category),
              textTransform: 'uppercase',
              fontWeight: 700,
              letterSpacing: '0.8px',
            }}
          >
            ◆ {impact.category}
          </span>
          <span
            style={{
              color: materialityColor(impact.materiality),
              textTransform: 'uppercase',
              fontWeight: 700,
              letterSpacing: '0.8px',
            }}
          >
            {impact.materiality}
          </span>
        </div>

        {/* Title — external link opens in new tab */}
        <a
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: 'var(--txt)',
            textDecoration: 'none',
            display: 'block',
            lineHeight: 1.35,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--gold2)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--txt)')}
        >
          <h3
            style={{
              fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
              fontSize: compact ? 13 : 14,
              fontWeight: 600,
              margin: 0,
              letterSpacing: '-0.005em',
            }}
          >
            {item.title}{' '}
            <span
              style={{
                fontSize: 10,
                color: 'var(--txt3)',
                verticalAlign: 'middle',
                marginLeft: 2,
              }}
            >
              ↗
            </span>
          </h3>
        </a>

        {!compact && item.description && (
          <p
            style={{
              fontSize: 12,
              color: 'var(--txt2)',
              lineHeight: 1.5,
              margin: '6px 0 8px',
              // Clamp to 2 lines
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {item.description}
          </p>
        )}

        {/* Impact pill row */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            flexWrap: 'wrap',
            marginTop: compact ? 6 : 4,
          }}
        >
          {impact.sentimentScore !== 0 && (
            <span
              title={`Sentiment ${impact.sentimentScore > 0 ? '+' : ''}${impact.sentimentScore}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'JetBrains Mono, monospace',
                color: sColor,
                background: sBg,
                border: `1px solid ${sColor}`,
                padding: '2px 7px',
                borderRadius: 3,
                letterSpacing: '0.3px',
              }}
            >
              {sentimentArrow(impact.sentiment)}{' '}
              {impact.sentimentScore > 0 ? '+' : ''}
              {impact.sentimentScore}
            </span>
          )}
          {impact.multipleDeltaPct !== 0 && (
            <span
              title="Estimated impact on EV/EBITDA multiple"
              style={{
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'JetBrains Mono, monospace',
                color:
                  impact.multipleDeltaPct >= 0 ? 'var(--green)' : 'var(--red)',
                background:
                  impact.multipleDeltaPct >= 0 ? 'var(--greendim)' : 'var(--reddim)',
                border: `1px solid ${
                  impact.multipleDeltaPct >= 0 ? 'var(--green)' : 'var(--red)'
                }`,
                padding: '2px 7px',
                borderRadius: 3,
                letterSpacing: '0.3px',
              }}
            >
              {impact.multipleDeltaPct >= 0 ? '+' : ''}
              {impact.multipleDeltaPct.toFixed(2)}% EV/EBITDA
            </span>
          )}
          {impact.affectedCompanies.slice(0, 3).map((t) => (
            <span
              key={t}
              style={{
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'JetBrains Mono, monospace',
                color: 'var(--gold2)',
                background: 'var(--golddim)',
                border: '1px solid var(--gold2)',
                padding: '2px 7px',
                borderRadius: 3,
              }}
            >
              {t}
            </span>
          ))}
          {impact.affectedCompanies.length > 3 && (
            <span style={{ fontSize: 10, color: 'var(--txt3)' }}>
              +{impact.affectedCompanies.length - 3} more
            </span>
          )}
          {impact.isPolicy && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                color: 'var(--purple)',
                background: 'var(--purpledim)',
                border: '1px solid var(--purple)',
                padding: '2px 7px',
                borderRadius: 3,
                letterSpacing: '0.3px',
                textTransform: 'uppercase',
              }}
            >
              POLICY
            </span>
          )}

          {showAcknowledge && hasParams && (
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setParamExpanded(!paramExpanded)
              }}
              title="Adjust per-parameter impact"
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: paramExpanded ? 'var(--gold2)' : 'var(--txt3)',
                background: 'transparent',
                border: `1px solid ${paramExpanded ? 'var(--gold2)' : 'var(--br)'}`,
                padding: '2px 8px',
                borderRadius: 3,
                cursor: 'pointer',
                letterSpacing: '0.3px',
                fontFamily: 'inherit',
              }}
            >
              {paramExpanded ? '▲' : '▼'} Params ({affectedParamEntries.length})
            </button>
          )}

          {canAck && (
            <button
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                toggle(itemKey)
              }}
              title={
                acked
                  ? 'Click to ignore this item in valuation estimates'
                  : 'Click to apply this item to valuation estimates'
              }
              style={{
                marginLeft: 'auto',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.4px',
                textTransform: 'uppercase',
                padding: '3px 10px',
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: 'inherit',
                background: acked ? 'var(--gold2)' : 'transparent',
                color: acked ? '#000' : 'var(--gold2)',
                border: '1px solid var(--gold2)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                transition: 'all 0.15s',
              }}
              onMouseEnter={(e) => {
                if (!acked)
                  (e.currentTarget as HTMLElement).style.background = 'var(--golddim)'
              }}
              onMouseLeave={(e) => {
                if (!acked)
                  (e.currentTarget as HTMLElement).style.background = 'transparent'
              }}
            >
              {acked ? '✓ Acknowledged' : '+ Acknowledge'}
            </button>
          )}
        </div>

        {/* Parameter Impact panel — expands on demand */}
        {showAcknowledge && hasParams && paramExpanded && (
          <ParamImpactPanel
            itemKey={itemKey}
            impact={impact}
            acked={acked}
            getManualOverride={getManualOverride}
            setManualOverride={setManualOverride}
            entries={affectedParamEntries}
          />
        )}
      </div>
    </article>
  )
}

// ── Parameter Impact sub-panel ─────────────────────────────────────

interface ParamPanelProps {
  itemKey: string
  impact: NewsImpact
  acked: boolean
  getManualOverride: (key: string, param: ValuationParam) => number | null
  setManualOverride: (
    key: string,
    param: ValuationParam,
    value: number | null
  ) => void
  entries: ReadonlyArray<readonly [ValuationParam, number]>
}

function ParamImpactPanel({
  itemKey,
  impact,
  acked,
  getManualOverride,
  setManualOverride,
  entries,
}: ParamPanelProps) {
  return (
    <div
      style={{
        marginTop: 10,
        background: 'var(--s2)',
        border: '1px solid var(--br)',
        borderRadius: 4,
        padding: '8px 10px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontSize: 9,
          color: 'var(--txt3)',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          fontWeight: 700,
          marginBottom: 6,
          paddingBottom: 5,
          borderBottom: '1px solid var(--br)',
        }}
      >
        <span>Parameter Impact</span>
        <span style={{ fontSize: 8, color: acked ? 'var(--gold2)' : 'var(--txt3)' }}>
          {acked ? '✓ ACTIVE · APPLIED TO VALUATION' : 'INACTIVE · ACKNOWLEDGE TO APPLY'}
        </span>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.6fr 0.9fr 0.9fr 0.9fr',
          gap: 4,
          alignItems: 'center',
          fontSize: 10,
        }}
      >
        <div
          style={{
            fontSize: 8,
            color: 'var(--txt3)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontWeight: 700,
          }}
        >
          Parameter
        </div>
        <div
          style={{
            fontSize: 8,
            color: 'var(--txt3)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontWeight: 700,
            textAlign: 'right',
          }}
          title="Auto-derived degree (0..100) for this parameter from the news text and sentiment. Signed by polarity."
        >
          Auto
        </div>
        <div
          style={{
            fontSize: 8,
            color: 'var(--txt3)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontWeight: 700,
            textAlign: 'center',
          }}
          title="Manual override. Signed percentage, blank = use auto. Precedence: manual > auto."
        >
          Manual %
        </div>
        <div
          style={{
            fontSize: 8,
            color: 'var(--txt3)',
            textTransform: 'uppercase',
            letterSpacing: '0.5px',
            fontWeight: 700,
            textAlign: 'right',
          }}
          title="Effective signed adjustment (manual if present, else auto)."
        >
          Effective
        </div>

        {entries.map(([param, autoDegree]) => {
          const def = PARAM_DEFS[param]
          const autoPct = autoSignedPct(param, autoDegree, impact.sentiment)
          const manual = getManualOverride(itemKey, param)
          const effective = manual != null ? manual : autoPct
          const effColor =
            effective > 0
              ? 'var(--green)'
              : effective < 0
                ? 'var(--red)'
                : 'var(--txt3)'
          return (
            <ParamRow
              key={param}
              label={def.label}
              short={def.short}
              autoPct={autoPct}
              manual={manual}
              effective={effective}
              effColor={effColor}
              onManualChange={(v) => setManualOverride(itemKey, param, v)}
              acked={acked}
            />
          )
        })}
      </div>

      {!acked && (
        <div
          style={{
            marginTop: 6,
            fontSize: 9,
            color: 'var(--txt3)',
            fontStyle: 'italic',
            lineHeight: 1.4,
          }}
        >
          ℹ Manual values are stored only after you click{' '}
          <strong style={{ color: 'var(--gold2)' }}>+ Acknowledge</strong>. Auto values
          shown for preview.
        </div>
      )}
    </div>
  )
}

function ParamRow({
  label,
  short,
  autoPct,
  manual,
  effective,
  effColor,
  onManualChange,
  acked,
}: {
  label: string
  short: string
  autoPct: number
  manual: number | null
  effective: number
  effColor: string
  onManualChange: (value: number | null) => void
  acked: boolean
}) {
  const [draft, setDraft] = useState<string>(manual != null ? String(manual) : '')

  // Sync if the context value changes externally
  const currentDraft = manual != null ? String(manual) : draft
  void currentDraft

  const autoColor =
    autoPct > 0 ? 'var(--green)' : autoPct < 0 ? 'var(--red)' : 'var(--txt3)'

  return (
    <>
      <div
        style={{
          fontSize: 10,
          color: 'var(--txt)',
          fontWeight: 500,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
        title={label}
      >
        <span>{short}</span>
      </div>
      <div
        style={{
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace',
          fontWeight: 600,
          color: autoColor,
          textAlign: 'right',
        }}
      >
        {autoPct > 0 ? '+' : ''}
        {autoPct.toFixed(1)}%
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <input
          type="number"
          value={draft}
          placeholder="auto"
          disabled={!acked}
          step={5}
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
          onClick={(e) => e.stopPropagation()}
          style={{
            width: '100%',
            maxWidth: 70,
            background: 'var(--s3)',
            border: `1px solid ${manual != null ? 'var(--gold2)' : 'var(--br)'}`,
            color: 'var(--txt)',
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 10,
            padding: '3px 6px',
            borderRadius: 3,
            outline: 'none',
            textAlign: 'center',
            cursor: acked ? 'text' : 'not-allowed',
            opacity: acked ? 1 : 0.5,
          }}
        />
      </div>
      <div
        style={{
          fontSize: 10,
          fontFamily: 'JetBrains Mono, monospace',
          fontWeight: 700,
          color: effColor,
          textAlign: 'right',
        }}
      >
        {manual != null && (
          <span
            style={{
              fontSize: 8,
              color: 'var(--gold2)',
              marginRight: 3,
              fontWeight: 600,
            }}
            title="Manual override active"
          >
            M
          </span>
        )}
        {effective > 0 ? '+' : ''}
        {effective.toFixed(1)}%
      </div>
    </>
  )
}
