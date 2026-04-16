'use client'

/**
 * SubSegmentPeerPicker — customizable peer selection for the report page.
 *
 * Shown only in "customised report" mode (authenticated users whose reports
 * aren't public snapshots). Public visitors see a disclaimer instead — their
 * peer set is derived broadly from the value-chain segment (Company.comp) and
 * may not be precise enough for a tight sub-segment peer benchmark.
 *
 * Flow:
 *   1. User picks Industry → Stage → Sub-segment (3 cascading dropdowns).
 *   2. User clicks "Find & verify peers via web".
 *   3. Backend calls Gemini 2.5 Flash w/ Google Search grounding, returns
 *      up to 8 candidates with citation URLs.
 *   4. User checks which to include and clicks "Use in report".
 *   5. The parent report component receives the chosen tickers/names via
 *      onConfirm(). Parent is responsible for rebuilding the report
 *      peer set with these.
 *
 * Zero direct Gemini access — all calls go through /api/peers/verify
 * and /api/peers/confirm. Key never reaches the browser.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { TAXONOMY_STAGES, type TaxonomyStage } from '@/lib/data/sub-segments'

interface PeerCandidate {
  name: string
  ticker: string | null
  isPrivate: boolean
  productLine: string
  evidence: Array<{ url: string; title?: string }>
}

interface VerifyResponse {
  ok: boolean
  cacheSource:
    | 'user_confirmed_db'
    | 'recent_cache'
    | 'gemini_live'
    | 'db_partial'
    | 'quota_guard'
    | 'db_fallback'
  subSegment?: {
    id: string
    code: string
    name: string
    stageCode: string
    stageName: string
    industryCode: string
    industryName: string
  }
  candidates?: PeerCandidate[]
  notice?: string
  quotaGuarded?: boolean
  error?: string
  detail?: string
}

export interface ConfirmedPeer {
  name: string
  ticker: string | null
  productLine?: string
}

interface Props {
  /** Subject ticker so backend can contextualise the peer query. */
  subjectTicker?: string
  /** Default industry code (matches Industry code 1..15); optional pre-select. */
  defaultIndustryCode?: string
  /** Default stage code e.g. "1.2"; optional pre-select. */
  defaultStageCode?: string
  /** Callback with the user's final chosen set. Parent rebuilds the report. */
  onConfirm: (peers: ConfirmedPeer[], subSegmentId: string) => void
  /** Callback when user closes without confirming. */
  onCancel?: () => void
}

export function SubSegmentPeerPicker({
  subjectTicker,
  defaultIndustryCode,
  defaultStageCode,
  onConfirm,
  onCancel,
}: Props) {
  // ── Cascading dropdown state ────────────────────
  const industries = useMemo(() => industriesList(), [])
  const [industryCode, setIndustryCode] = useState<string>(
    defaultIndustryCode || industries[0]?.code || '1'
  )
  const stages = useMemo<TaxonomyStage[]>(
    () => TAXONOMY_STAGES.filter((s) => s.industryCode === industryCode),
    [industryCode]
  )
  const [stageCode, setStageCode] = useState<string>(
    defaultStageCode || stages[0]?.code || ''
  )
  // When industry changes, reset stage to first.
  useEffect(() => {
    if (!stages.some((s) => s.code === stageCode)) {
      setStageCode(stages[0]?.code || '')
    }
  }, [stages, stageCode])

  const subs = useMemo(() => {
    const stage = stages.find((s) => s.code === stageCode)
    return stage?.subs || []
  }, [stages, stageCode])
  const [subSegmentId, setSubSegmentId] = useState<string>('')
  useEffect(() => {
    // Reset sub-segment when stage changes.
    if (!subs.some((x) => x.id === subSegmentId)) {
      setSubSegmentId(subs[0]?.id || '')
    }
  }, [subs, subSegmentId])

  // ── Verification state ──────────────────────────
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<VerifyResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())

  const runVerify = useCallback(async () => {
    if (!subSegmentId) return
    setLoading(true)
    setErrorMsg(null)
    setResult(null)
    setSelected(new Set())
    try {
      const r = await fetch('/api/peers/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subSegmentId, subjectTicker }),
      })
      const j = (await r.json()) as VerifyResponse
      if (!j.ok && !j.candidates) {
        setErrorMsg(j.detail || j.error || 'Verification failed')
      }
      setResult(j)
      // Pre-check the first 5 candidates as a sensible default.
      const preset = new Set<number>()
      const cs = j.candidates || []
      for (let i = 0; i < Math.min(5, cs.length); i++) preset.add(i)
      setSelected(preset)
    } catch (e) {
      setErrorMsg((e as Error).message || 'Network error')
    } finally {
      setLoading(false)
    }
  }, [subSegmentId, subjectTicker])

  const toggle = (i: number) => {
    const next = new Set(selected)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setSelected(next)
  }

  const handleConfirm = useCallback(async () => {
    if (!result?.candidates || !result.subSegment) return
    const confirmed = Array.from(selected)
      .map((i) => result.candidates![i])
      .filter(Boolean)
    if (confirmed.length === 0) return

    // Fire-and-forget DB persistence; don't block the UI.
    fetch('/api/peers/confirm', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subSegmentId: result.subSegment.id,
        confirmed: confirmed.map((c) => ({
          name: c.name,
          ticker: c.ticker,
          isPrivate: c.isPrivate,
          productLine: c.productLine,
          evidence: c.evidence,
        })),
      }),
    }).catch(() => {})

    onConfirm(
      confirmed.map((c) => ({
        name: c.name,
        ticker: c.ticker,
        productLine: c.productLine,
      })),
      result.subSegment.id
    )
  }, [result, selected, onConfirm])

  const cacheLabel = result ? CACHE_LABELS[result.cacheSource] : null

  return (
    <div className="ssp-root">
      <div className="ssp-title">Customize peers by sub-segment</div>
      <div className="ssp-sub">
        Pick a precise sub-segment from the 668-entry value-chain taxonomy and
        verify peers from the live web via Gemini. Your confirmation is saved
        so the next analyst reusing this sub-segment gets instant results.
      </div>

      <div className="ssp-pickers">
        <label className="ssp-field">
          <span>Industry</span>
          <select value={industryCode} onChange={(e) => setIndustryCode(e.target.value)}>
            {industries.map((i) => (
              <option key={i.code} value={i.code}>
                {i.name}
              </option>
            ))}
          </select>
        </label>

        <label className="ssp-field">
          <span>Stage</span>
          <select
            value={stageCode}
            onChange={(e) => setStageCode(e.target.value)}
            disabled={stages.length === 0}
          >
            {stages.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name} ({s.subs.length} sub)
              </option>
            ))}
          </select>
        </label>

        <label className="ssp-field">
          <span>Sub-segment</span>
          <select
            value={subSegmentId}
            onChange={(e) => setSubSegmentId(e.target.value)}
            disabled={subs.length === 0}
          >
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="ssp-actions">
        <button
          type="button"
          className="ssp-primary"
          onClick={runVerify}
          disabled={loading || !subSegmentId}
        >
          {loading ? 'Verifying from web…' : '🔍 Find & verify peers via web'}
        </button>
        {onCancel && (
          <button type="button" className="ssp-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {errorMsg && <div className="ssp-error">⚠ {errorMsg}</div>}

      {result?.notice && <div className="ssp-notice">{result.notice}</div>}

      {result?.candidates && result.candidates.length > 0 && (
        <div className="ssp-results">
          <div className="ssp-results-head">
            <span className="ssp-results-title">
              {result.candidates.length} peer{result.candidates.length === 1 ? '' : 's'} found
              {result.subSegment ? ` for ${result.subSegment.name}` : ''}
            </span>
            {cacheLabel && <span className="ssp-badge">{cacheLabel}</span>}
          </div>
          <ul className="ssp-list">
            {result.candidates.map((c, i) => (
              <li key={`${c.name}-${i}`} className="ssp-item">
                <label className="ssp-check">
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggle(i)}
                  />
                  <span className="ssp-name">
                    {c.name}
                    {c.ticker ? (
                      <span className="ssp-ticker">({c.ticker})</span>
                    ) : (
                      <span className="ssp-private">private</span>
                    )}
                  </span>
                </label>
                {c.productLine && <div className="ssp-pl">{c.productLine}</div>}
                {c.evidence?.length > 0 && (
                  <div className="ssp-ev">
                    {c.evidence.slice(0, 3).map((e, j) => (
                      <a
                        key={j}
                        href={e.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={e.title || e.url}
                      >
                        🔗 {shortDomain(e.url)}
                      </a>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <div className="ssp-actions">
            <button
              type="button"
              className="ssp-primary"
              disabled={selected.size === 0}
              onClick={handleConfirm}
            >
              Use {selected.size} peer{selected.size === 1 ? '' : 's'} in report
            </button>
          </div>
        </div>
      )}

      {result && !result.candidates?.length && !loading && !errorMsg && (
        <div className="ssp-empty">
          No verified peers found for this sub-segment yet. Try a related
          sub-segment, or contact support to add a manual curation.
        </div>
      )}

      <style jsx>{`
        .ssp-root {
          background: var(--s1, #fff);
          border: 1px solid var(--br, #e0e4eb);
          border-radius: 10px;
          padding: 20px 22px;
          margin-top: 16px;
          font-family: 'Inter', system-ui, sans-serif;
        }
        .ssp-title {
          font-size: 16px;
          font-weight: 700;
          color: var(--txt, #0f2540);
          margin-bottom: 4px;
        }
        .ssp-sub {
          font-size: 13px;
          line-height: 1.5;
          color: var(--txt2, #52627a);
          margin-bottom: 14px;
        }
        .ssp-pickers {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 12px;
          margin-bottom: 12px;
        }
        @media (max-width: 720px) {
          .ssp-pickers {
            grid-template-columns: 1fr;
          }
        }
        .ssp-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 12px;
          color: var(--txt2, #52627a);
        }
        .ssp-field select {
          padding: 8px 10px;
          border: 1px solid var(--br, #d4d9e1);
          border-radius: 6px;
          font-size: 13px;
          background: #fff;
          color: var(--txt, #0f2540);
        }
        .ssp-actions {
          display: flex;
          gap: 10px;
          margin-top: 12px;
        }
        .ssp-primary {
          padding: 9px 18px;
          border: 0;
          border-radius: 6px;
          background: var(--gold2, #C8A24B);
          color: #0b1628;
          font-weight: 600;
          font-size: 13.5px;
          cursor: pointer;
        }
        .ssp-primary:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .ssp-ghost {
          padding: 9px 16px;
          border: 1px solid var(--br, #d4d9e1);
          border-radius: 6px;
          background: #fff;
          color: var(--txt, #0f2540);
          font-size: 13.5px;
          cursor: pointer;
        }
        .ssp-error {
          margin-top: 12px;
          padding: 10px 12px;
          background: #fff1f1;
          border: 1px solid #ffc9c9;
          border-radius: 6px;
          color: #9a1d1d;
          font-size: 13px;
        }
        .ssp-notice {
          margin-top: 12px;
          padding: 10px 12px;
          background: #fff8e4;
          border: 1px solid #f3d88f;
          border-radius: 6px;
          color: #684b09;
          font-size: 13px;
        }
        .ssp-results {
          margin-top: 16px;
          border-top: 1px solid var(--br, #e0e4eb);
          padding-top: 14px;
        }
        .ssp-results-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 10px;
        }
        .ssp-results-title {
          font-weight: 600;
          color: var(--txt, #0f2540);
          font-size: 14px;
        }
        .ssp-badge {
          font-size: 11px;
          padding: 3px 8px;
          background: #e8efff;
          color: #2850a0;
          border-radius: 999px;
          border: 1px solid #bcd0f7;
        }
        .ssp-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .ssp-item {
          border: 1px solid var(--br, #e0e4eb);
          border-radius: 8px;
          padding: 10px 12px;
          background: #fcfcfd;
        }
        .ssp-check {
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          font-size: 14px;
        }
        .ssp-name {
          font-weight: 600;
          color: var(--txt, #0f2540);
        }
        .ssp-ticker {
          margin-left: 8px;
          font-weight: 500;
          color: var(--txt2, #52627a);
          font-size: 12.5px;
        }
        .ssp-private {
          margin-left: 8px;
          font-size: 11px;
          font-weight: 500;
          color: #7a5511;
          background: #fff1d6;
          padding: 2px 6px;
          border-radius: 4px;
        }
        .ssp-pl {
          margin-top: 6px;
          margin-left: 28px;
          font-size: 12.5px;
          line-height: 1.4;
          color: var(--txt2, #52627a);
        }
        .ssp-ev {
          margin-top: 4px;
          margin-left: 28px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .ssp-ev a {
          font-size: 11.5px;
          color: #2850a0;
          text-decoration: none;
          background: #eef3ff;
          padding: 2px 8px;
          border-radius: 999px;
          border: 1px solid #cfdbf5;
        }
        .ssp-ev a:hover {
          background: #dde7ff;
        }
        .ssp-empty {
          margin-top: 14px;
          padding: 16px;
          text-align: center;
          color: var(--txt2, #52627a);
          font-size: 13px;
          background: #f7f8fa;
          border-radius: 6px;
        }
      `}</style>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────

function industriesList(): Array<{ code: string; name: string }> {
  const INDUSTRY_NAMES: Record<string, string> = {
    '1': 'Solar PV & Renewable Energy',
    '2': 'Wind Energy',
    '3': 'EV & Battery Storage',
    '4': 'Steel & Metals',
    '5': 'Pharmaceuticals & Healthcare',
    '6': 'Specialty Chemicals',
    '7': 'Semiconductors & Electronics',
    '8': 'Textiles & Apparel',
    '9': 'FMCG & Consumer',
    '10': 'Infrastructure & Construction',
    '11': 'Defence & Aerospace',
    '12': 'IT & Technology Services',
    '13': 'Agribusiness & Food',
    '14': 'Cement & Building Materials',
    '15': 'Shipping & Maritime',
  }
  const seen = new Set<string>()
  for (const s of TAXONOMY_STAGES) seen.add(s.industryCode)
  return Array.from(seen)
    .sort((a, b) => Number(a) - Number(b))
    .map((code) => ({ code, name: INDUSTRY_NAMES[code] || `Industry ${code}` }))
}

function shortDomain(url: string): string {
  try {
    const u = new URL(url)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 30)
  }
}

const CACHE_LABELS: Record<VerifyResponse['cacheSource'], string> = {
  user_confirmed_db: '✓ verified by analysts',
  recent_cache: '✓ cached (< 7 days)',
  gemini_live: '🔍 live web verified',
  db_partial: '⚠ partial — sign-in for live verify',
  quota_guard: '⚠ quota guard',
  db_fallback: '⚠ database fallback',
}
