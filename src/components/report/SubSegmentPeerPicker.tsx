'use client'

/**
 * SubSegmentPeerPicker — customizable peer selection for the report page.
 *
 * Renders as a self-contained light-mode card inside a modal overlay on
 * /report/[ticker]. Uses EXPLICIT hex colors (not CSS variables) because
 * the parent report page defines `--s1`, `--txt`, etc. as dark-navy
 * theme values — inheriting them here made the picker invisible
 * (dark-on-dark) on first screenshots.
 *
 * Flow:
 *   1. User picks Industry (single) → Stage (single) → Sub-segments
 *      (MULTI-select checkbox list, up to 8 at a time).
 *   2. User clicks "Find & verify peers via web".
 *   3. Frontend fans out to /api/peers/verify once per picked sub-segment
 *      in parallel. Backend calls Gemini 2.5 Flash with Google Search
 *      grounding (or serves from its DB / 7-day cache). Candidates from
 *      each sub-segment are unioned, deduped by ticker or normalised name.
 *   4. User checks which to include and clicks "Use in report".
 *   5. /api/peers/confirm persists the pick against EACH picked sub-segment
 *      so next analyst reusing any of them gets instant results.
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

type CacheSource =
  | 'user_confirmed_db'
  | 'recent_cache'
  | 'gemini_live'
  | 'db_partial'
  | 'quota_guard'
  | 'db_fallback'

interface VerifyResponse {
  ok: boolean
  cacheSource: CacheSource
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

/** Per-sub-segment verification result carried in UI state. */
interface VerifyResult {
  subSegmentId: string
  subSegmentCode: string
  subSegmentName: string
  cacheSource: CacheSource
  candidates: PeerCandidate[]
  notice?: string
}

/** Deduped candidate with the sub-segments it was surfaced from. */
interface MergedCandidate extends PeerCandidate {
  fromSubSegments: string[] // list of sub-segment codes (e.g. ["1.2.3", "1.2.6"])
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
  /**
   * Callback with the user's final chosen set.
   * Second arg is the array of sub-segment IDs that produced them —
   * the parent can use this to annotate the report title or banner.
   */
  onConfirm: (peers: ConfirmedPeer[], subSegmentIds: string[]) => void
  /** Callback when user closes without confirming. */
  onCancel?: () => void
}

const MAX_SUB_SEGMENTS = 8

export function SubSegmentPeerPicker({
  subjectTicker,
  defaultIndustryCode,
  defaultStageCode,
  onConfirm,
  onCancel,
}: Props) {
  // ── Cascading state ─────────────────────────────
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
  useEffect(() => {
    if (!stages.some((s) => s.code === stageCode)) {
      setStageCode(stages[0]?.code || '')
    }
  }, [stages, stageCode])

  const subs = useMemo(() => {
    const stage = stages.find((s) => s.code === stageCode)
    return stage?.subs || []
  }, [stages, stageCode])

  // MULTI-select sub-segments — held as a Set of sub-segment ids.
  const [selectedSubIds, setSelectedSubIds] = useState<Set<string>>(new Set())
  useEffect(() => {
    // Reset selection when the stage changes (different set of sub-segments).
    setSelectedSubIds(new Set())
  }, [stageCode])

  const toggleSub = (id: string) => {
    setSelectedSubIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        if (next.size >= MAX_SUB_SEGMENTS) return prev // cap at 8 to keep Gemini quota sane
        next.add(id)
      }
      return next
    })
  }

  // ── Verification state ──────────────────────────
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<VerifyResult[]>([])
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set())

  // Merge candidates across every verified sub-segment, deduping on
  // (ticker or normalisedName) so the same company surfaced by two
  // sub-segments doesn't appear twice. Track which sub-segments each
  // candidate came from so we can attribute the confirm write back
  // to all of them.
  const mergedCandidates = useMemo<MergedCandidate[]>(() => {
    const out: MergedCandidate[] = []
    const byKey = new Map<string, MergedCandidate>()
    for (const r of results) {
      for (const c of r.candidates) {
        const key = (c.ticker && c.ticker.trim().length > 0)
          ? `t:${c.ticker.toUpperCase()}`
          : `n:${c.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`
        const existing = byKey.get(key)
        if (existing) {
          if (!existing.fromSubSegments.includes(r.subSegmentCode)) {
            existing.fromSubSegments.push(r.subSegmentCode)
          }
          // Prefer longer productLine + union of evidence
          if (c.productLine.length > existing.productLine.length) {
            existing.productLine = c.productLine
          }
          for (const ev of c.evidence) {
            if (!existing.evidence.some((e) => e.url === ev.url)) {
              existing.evidence.push(ev)
            }
          }
        } else {
          const merged: MergedCandidate = {
            ...c,
            evidence: [...c.evidence],
            fromSubSegments: [r.subSegmentCode],
          }
          byKey.set(key, merged)
          out.push(merged)
        }
      }
    }
    return out
  }, [results])

  const candidateKey = (c: MergedCandidate) =>
    (c.ticker && c.ticker.trim().length > 0)
      ? `t:${c.ticker.toUpperCase()}`
      : `n:${c.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`

  const runVerify = useCallback(async () => {
    const ids = Array.from(selectedSubIds)
    if (ids.length === 0) return
    setLoading(true)
    setErrorMsg(null)
    setResults([])
    setCheckedKeys(new Set())

    try {
      // Fan out — one POST per sub-segment, in parallel.
      const responses: VerifyResponse[] = await Promise.all(
        ids.map((subSegmentId) =>
          fetch('/api/peers/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subSegmentId, subjectTicker }),
          })
            .then((r) => r.json() as Promise<VerifyResponse>)
            .catch((e: Error): VerifyResponse => ({
              ok: false,
              cacheSource: 'db_fallback',
              error: e?.message || 'Network error',
              candidates: [],
            }))
        )
      )

      const collected: VerifyResult[] = []
      const noticeSet = new Set<string>()
      let firstError: string | null = null

      for (const j of responses) {
        if (!j.ok && !j.candidates?.length && !firstError) {
          firstError = j.detail || j.error || null
        }
        const sub = j.subSegment
        collected.push({
          subSegmentId: sub?.id ?? '',
          subSegmentCode: sub?.code ?? '',
          subSegmentName: sub?.name ?? '',
          cacheSource: j.cacheSource,
          candidates: j.candidates ?? [],
          notice: j.notice,
        })
        if (j.notice) noticeSet.add(j.notice)
      }

      setResults(collected)
      if (firstError && collected.every((r) => r.candidates.length === 0)) {
        setErrorMsg(firstError)
      }

      // Pre-check up to the first 5 merged candidates as a sensible default.
      const preset = new Set<string>()
      // Need to merge inline since state won't be updated yet.
      const byKey = new Map<string, MergedCandidate>()
      const merged: MergedCandidate[] = []
      for (const r of collected) {
        for (const c of r.candidates) {
          const key = (c.ticker && c.ticker.trim().length > 0)
            ? `t:${c.ticker.toUpperCase()}`
            : `n:${c.name.toLowerCase().replace(/[^a-z0-9]/g, '')}`
          if (byKey.has(key)) continue
          const mc: MergedCandidate = { ...c, evidence: [...c.evidence], fromSubSegments: [r.subSegmentCode] }
          byKey.set(key, mc)
          merged.push(mc)
        }
      }
      for (let i = 0; i < Math.min(5, merged.length); i++) {
        preset.add(candidateKey(merged[i]))
      }
      setCheckedKeys(preset)
    } catch (e) {
      setErrorMsg((e as Error).message || 'Network error')
    } finally {
      setLoading(false)
    }
  }, [selectedSubIds, subjectTicker])

  const toggleCandidate = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const handleConfirm = useCallback(() => {
    const chosen = mergedCandidates.filter((c) => checkedKeys.has(candidateKey(c)))
    if (chosen.length === 0) return

    // Persist against EVERY sub-segment the candidate was surfaced from,
    // so each picked sub-segment's future analysts get this candidate.
    const confirmPayloadBySub = new Map<string, ConfirmedPeer[]>()
    for (const c of chosen) {
      for (const code of c.fromSubSegments) {
        // Map back sub-segment code → id from results
        const res = results.find((r) => r.subSegmentCode === code)
        const id = res?.subSegmentId
        if (!id) continue
        const arr = confirmPayloadBySub.get(id) ?? []
        arr.push({
          name: c.name,
          ticker: c.ticker,
          productLine: c.productLine,
        })
        confirmPayloadBySub.set(id, arr)
      }
    }

    // Fire-and-forget — parent rebuilds immediately, DB writes settle async.
    for (const [subSegmentId, confirmed] of Array.from(confirmPayloadBySub.entries())) {
      fetch('/api/peers/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          subSegmentId,
          confirmed: chosen
            .filter((c) => c.fromSubSegments.includes(results.find((r) => r.subSegmentId === subSegmentId)?.subSegmentCode || ''))
            .map((c) => ({
              name: c.name,
              ticker: c.ticker,
              isPrivate: c.isPrivate,
              productLine: c.productLine,
              evidence: c.evidence,
            })),
        }),
      }).catch(() => {})
      void confirmed // array is already encoded in the filter above
    }

    onConfirm(
      chosen.map((c) => ({
        name: c.name,
        ticker: c.ticker,
        productLine: c.productLine,
      })),
      Array.from(selectedSubIds)
    )
  }, [mergedCandidates, checkedKeys, results, selectedSubIds, onConfirm])

  const aggregatedNotice = useMemo(() => {
    const set = new Set<string>()
    for (const r of results) if (r.notice) set.add(r.notice)
    return Array.from(set)
  }, [results])

  const totalCandidates = mergedCandidates.length
  const selectedCount = checkedKeys.size

  return (
    <div className="ssp-root">
      <div className="ssp-title">Customize peers by sub-segment</div>
      <div className="ssp-sub">
        Pick a precise sub-segment (or up to {MAX_SUB_SEGMENTS}) from the
        668-entry value-chain taxonomy and verify peers from the live web
        via Gemini. Your confirmation is saved so the next analyst reusing
        this sub-segment gets instant results.
      </div>

      {/* Single-select dropdowns — Industry and Stage */}
      <div className="ssp-pickers">
        <label className="ssp-field">
          <span className="ssp-field-label">Industry</span>
          <select
            className="ssp-select"
            value={industryCode}
            onChange={(e) => setIndustryCode(e.target.value)}
          >
            {industries.map((i) => (
              <option key={i.code} value={i.code}>
                {i.name}
              </option>
            ))}
          </select>
        </label>

        <label className="ssp-field">
          <span className="ssp-field-label">Stage</span>
          <select
            className="ssp-select"
            value={stageCode}
            onChange={(e) => setStageCode(e.target.value)}
            disabled={stages.length === 0}
          >
            {stages.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name} ({s.subs.length})
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Multi-select sub-segment checkbox list */}
      <div className="ssp-sub-picker">
        <div className="ssp-field-label ssp-sub-picker-head">
          <span>
            Sub-segments
            <span className="ssp-hint">
              &nbsp;·&nbsp;tick one or more (up to {MAX_SUB_SEGMENTS})
            </span>
          </span>
          <span className="ssp-sub-count">
            {selectedSubIds.size} selected
          </span>
        </div>
        <div className="ssp-sub-list" role="listbox">
          {subs.length === 0 && (
            <div className="ssp-sub-empty">
              No sub-segments in this stage — pick a different stage.
            </div>
          )}
          {subs.map((s) => {
            const isChecked = selectedSubIds.has(s.id)
            const atCap = !isChecked && selectedSubIds.size >= MAX_SUB_SEGMENTS
            return (
              <label
                key={s.id}
                className={`ssp-sub-row ${isChecked ? 'is-checked' : ''} ${atCap ? 'is-disabled' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={atCap}
                  onChange={() => toggleSub(s.id)}
                />
                <span className="ssp-sub-code">{s.code}</span>
                <span className="ssp-sub-name">{s.name}</span>
              </label>
            )
          })}
        </div>
      </div>

      <div className="ssp-actions">
        <button
          type="button"
          className="ssp-primary"
          onClick={runVerify}
          disabled={loading || selectedSubIds.size === 0}
        >
          {loading
            ? `Verifying ${selectedSubIds.size} sub-segment${selectedSubIds.size === 1 ? '' : 's'}…`
            : `🔍 Find & verify peers${selectedSubIds.size > 0 ? ` (${selectedSubIds.size})` : ''}`}
        </button>
        {onCancel && (
          <button type="button" className="ssp-ghost" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>

      {errorMsg && <div className="ssp-error">⚠ {errorMsg}</div>}

      {aggregatedNotice.map((n, i) => (
        <div key={i} className="ssp-notice">{n}</div>
      ))}

      {totalCandidates > 0 && (
        <div className="ssp-results">
          <div className="ssp-results-head">
            <span className="ssp-results-title">
              {totalCandidates} unique peer{totalCandidates === 1 ? '' : 's'} found across {results.length} sub-segment{results.length === 1 ? '' : 's'}
            </span>
          </div>
          <ul className="ssp-list">
            {mergedCandidates.map((c) => {
              const key = candidateKey(c)
              const checked = checkedKeys.has(key)
              return (
                <li key={key} className="ssp-item">
                  <label className="ssp-check">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleCandidate(key)}
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
                  <div className="ssp-meta-row">
                    <span className="ssp-from">
                      From: {c.fromSubSegments.join(', ')}
                    </span>
                    <span className="ssp-source-tag">
                      {CACHE_LABELS[firstSubCacheSource(results, c.fromSubSegments) || 'db_fallback']}
                    </span>
                  </div>
                  {c.productLine && <div className="ssp-pl">{c.productLine}</div>}
                  {c.evidence.length > 0 && (
                    <div className="ssp-ev">
                      {c.evidence.slice(0, 4).map((e, j) => (
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
              )
            })}
          </ul>
          <div className="ssp-actions">
            <button
              type="button"
              className="ssp-primary"
              disabled={selectedCount === 0}
              onClick={handleConfirm}
            >
              Use {selectedCount} peer{selectedCount === 1 ? '' : 's'} in report
            </button>
          </div>
        </div>
      )}

      {!loading && !errorMsg && results.length > 0 && totalCandidates === 0 && (
        <div className="ssp-empty">
          No verified peers found for the selected sub-segment(s). Try a
          broader stage or different sub-segments.
        </div>
      )}

      <style jsx>{`
        /* Explicit light-mode palette — we are rendered inside a white
           modal card that sits on top of the report's dark navy bar,
           so inheriting the page's CSS variables (which resolve to
           dark-theme colors) would make every label invisible. */
        .ssp-root {
          background: #ffffff;
          color: #0f2540;
          border-radius: 10px;
          padding: 22px 24px 20px;
          font-family: 'Inter', system-ui, sans-serif;
          /* Prevent <select> + checkbox labels from pushing content out. */
          max-width: 100%;
          box-sizing: border-box;
          overflow: hidden;
        }
        .ssp-title {
          font-size: 17px;
          font-weight: 700;
          color: #0f2540;
          margin-bottom: 4px;
        }
        .ssp-sub {
          font-size: 13px;
          line-height: 1.55;
          color: #52627a;
          margin-bottom: 18px;
        }

        /* 2-column row for Industry + Stage. Sub-segments get their own
           full-width multi-select below. min-width: 0 on the grid
           children is critical — without it, long <option> text forces
           each column wider than 1fr and the last select overflows
           the modal right edge. */
        .ssp-pickers {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          margin-bottom: 14px;
        }
        @media (max-width: 640px) {
          .ssp-pickers { grid-template-columns: 1fr; }
        }
        .ssp-field {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 0;
        }
        .ssp-field-label {
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.5px;
          color: #52627a;
          text-transform: uppercase;
        }
        .ssp-select {
          width: 100%;
          min-width: 0;
          padding: 10px 12px;
          border: 1px solid #d4d9e1;
          border-radius: 7px;
          font-size: 13.5px;
          background: #ffffff;
          color: #0f2540;
          /* truncate long option text so it never overflows */
          text-overflow: ellipsis;
          appearance: auto;
          cursor: pointer;
        }
        .ssp-select:disabled {
          opacity: 0.55;
          cursor: not-allowed;
          background: #f7f8fa;
        }
        .ssp-select:focus {
          outline: 2px solid #C8A24B;
          outline-offset: 1px;
        }

        /* Multi-select sub-segment list */
        .ssp-sub-picker {
          background: #f7f9fc;
          border: 1px solid #dfe4ec;
          border-radius: 8px;
          padding: 10px 12px;
          margin-bottom: 14px;
        }
        .ssp-sub-picker-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 8px;
        }
        .ssp-hint {
          font-weight: 400;
          text-transform: none;
          letter-spacing: 0;
          color: #6b7a94;
          font-size: 11px;
        }
        .ssp-sub-count {
          font-size: 11px;
          font-weight: 600;
          color: #0f2540;
          background: #ffffff;
          border: 1px solid #dfe4ec;
          border-radius: 999px;
          padding: 2px 9px;
          text-transform: none;
          letter-spacing: 0;
        }
        .ssp-sub-list {
          max-height: 220px;
          overflow-y: auto;
          background: #ffffff;
          border: 1px solid #e6eaf0;
          border-radius: 6px;
        }
        .ssp-sub-empty {
          padding: 16px;
          text-align: center;
          font-size: 13px;
          color: #6b7a94;
        }
        .ssp-sub-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 7px 12px;
          cursor: pointer;
          font-size: 13px;
          color: #0f2540;
          border-bottom: 1px solid #f0f2f6;
        }
        .ssp-sub-row:last-child { border-bottom: none; }
        .ssp-sub-row:hover { background: #f7f9fc; }
        .ssp-sub-row.is-checked {
          background: #fef8ea;
        }
        .ssp-sub-row.is-disabled {
          opacity: 0.45;
          cursor: not-allowed;
        }
        .ssp-sub-row input[type='checkbox'] {
          width: 15px;
          height: 15px;
          accent-color: #C8A24B;
          flex-shrink: 0;
        }
        .ssp-sub-code {
          font-family: ui-monospace, 'SF Mono', Menlo, monospace;
          font-size: 11.5px;
          color: #7a6020;
          background: #fff1d6;
          padding: 2px 6px;
          border-radius: 4px;
          font-weight: 600;
          flex-shrink: 0;
        }
        .ssp-sub-name {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .ssp-actions {
          display: flex;
          gap: 10px;
          margin-top: 14px;
          flex-wrap: wrap;
        }
        .ssp-primary {
          padding: 10px 20px;
          border: 0;
          border-radius: 7px;
          background: #C8A24B;
          color: #0b1628;
          font-weight: 600;
          font-size: 13.5px;
          cursor: pointer;
          font-family: inherit;
        }
        .ssp-primary:hover:not(:disabled) { background: #b89136; }
        .ssp-primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .ssp-ghost {
          padding: 10px 18px;
          border: 1px solid #d4d9e1;
          border-radius: 7px;
          background: #ffffff;
          color: #0f2540;
          font-size: 13.5px;
          cursor: pointer;
          font-family: inherit;
        }
        .ssp-ghost:hover { background: #f7f9fc; }

        .ssp-error {
          margin-top: 14px;
          padding: 10px 14px;
          background: #fff1f1;
          border: 1px solid #ffc9c9;
          border-radius: 7px;
          color: #9a1d1d;
          font-size: 13px;
        }
        .ssp-notice {
          margin-top: 10px;
          padding: 10px 14px;
          background: #fff8e4;
          border: 1px solid #f3d88f;
          border-radius: 7px;
          color: #684b09;
          font-size: 13px;
        }

        .ssp-results {
          margin-top: 18px;
          border-top: 1px solid #e6eaf0;
          padding-top: 14px;
        }
        .ssp-results-head {
          margin-bottom: 10px;
        }
        .ssp-results-title {
          font-weight: 600;
          color: #0f2540;
          font-size: 14px;
        }
        .ssp-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
          max-height: 360px;
          overflow-y: auto;
        }
        .ssp-item {
          border: 1px solid #e6eaf0;
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
          color: #0f2540;
        }
        .ssp-check input[type='checkbox'] {
          width: 16px;
          height: 16px;
          accent-color: #C8A24B;
          flex-shrink: 0;
        }
        .ssp-name {
          font-weight: 600;
          color: #0f2540;
        }
        .ssp-ticker {
          margin-left: 8px;
          font-weight: 500;
          color: #52627a;
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
        .ssp-meta-row {
          margin-top: 4px;
          margin-left: 28px;
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          font-size: 11.5px;
          color: #6b7a94;
        }
        .ssp-from {
          font-family: ui-monospace, 'SF Mono', Menlo, monospace;
        }
        .ssp-source-tag {
          padding: 1px 7px;
          background: #e8efff;
          color: #2850a0;
          border-radius: 999px;
          border: 1px solid #bcd0f7;
        }
        .ssp-pl {
          margin-top: 4px;
          margin-left: 28px;
          font-size: 12.5px;
          line-height: 1.45;
          color: #52627a;
        }
        .ssp-ev {
          margin-top: 6px;
          margin-left: 28px;
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
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
        .ssp-ev a:hover { background: #dde7ff; }
        .ssp-empty {
          margin-top: 14px;
          padding: 18px;
          text-align: center;
          color: #52627a;
          font-size: 13px;
          background: #f7f8fa;
          border-radius: 7px;
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

function firstSubCacheSource(
  results: VerifyResult[],
  codes: string[]
): CacheSource | null {
  for (const code of codes) {
    const r = results.find((x) => x.subSegmentCode === code)
    if (r) return r.cacheSource
  }
  return null
}

const CACHE_LABELS: Record<CacheSource, string> = {
  user_confirmed_db: '✓ verified by analysts',
  recent_cache: '✓ cached (< 7 days)',
  gemini_live: '🔍 live web verified',
  db_partial: '⚠ partial — sign-in for live verify',
  quota_guard: '⚠ quota guard',
  db_fallback: '⚠ database fallback',
}
