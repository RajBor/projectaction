'use client'

/**
 * Hero-section Sample Report picker.
 *
 * Three cascading selectors (Industry → Value chain → Sub-value-chain)
 * plus an optional company pick, a compact user-information form, an
 * in-house HMAC-signed CAPTCHA, and three display states:
 *
 *   • idle     — show the form
 *   • working  — loading card with "thank you for your patience" copy,
 *                used while POST /api/public/report is running
 *   • done     — open the ReportPreviewModal with the generated HTML
 *                (industry-level flow only; company flow redirects)
 *
 * ── Two-mode response ──────────────────────────────────────────
 * The backend returns one of two shapes:
 *
 *   1. { mode: 'redirect', redirectUrl }
 *      Sent when the visitor picked a company. We navigate straight
 *      to the live /report/[ticker]?public=1 page which mirrors the
 *      authenticated analyst experience (BACK / SECTIONS / SHARE /
 *      DOWNLOAD PDF toolbar) without touching RapidAPI.
 *
 *   2. { mode: 'preview', previewHtml, downloadUrl }
 *      Sent when the visitor only picked industry / stage. We open
 *      the ReportPreviewModal with the qualitative HTML brief since
 *      there's no single ticker to route to.
 *
 * When the form is incomplete we show inline hints rather than
 * blocking the button, so the user always understands what's missing.
 *
 * If the server returns 503 (busy) we surface a gentle retry card
 * instead of an error toast — matches the brief's "manage excess
 * traffic" requirement.
 *
 * For customised / numeric reports the user clicks a secondary
 * "Request customised access" link — that's a separate modal which
 * POSTs to /api/public/request-access.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ReportPreviewModal, type PreviewResult } from './ReportPreviewModal'

interface Sub {
  id: string
  code: string
  name: string
}
interface CompanyLite {
  name: string
  ticker: string | null
  role?: string | null
  status?: string | null
  hasNumbers: boolean
}
interface Vc {
  id: string
  name: string
  subSegments: Sub[]
  companies: CompanyLite[]
}
interface Ind {
  id: string
  label: string
  description: string
  hasRichData: boolean
  valueChains: Vc[]
}
interface CatalogResponse {
  industries: Ind[]
}

interface Captcha {
  token: string
  question: string
}

interface Props {
  accent?: string
  accentSoft?: string
  ink?: string
  body?: string
  muted?: string
  cream?: string
  rule?: string
}

type Phase = 'idle' | 'working' | 'done' | 'busy' | 'redirecting'

export function HeroReportPicker({
  accent = '#C25E10',
  accentSoft = '#E27625',
  ink = '#051C2C',
  body = '#1E2B3D',
  muted = '#5B6676',
  cream = '#F7F4EC',
  rule = '#E4DFD2',
}: Props) {
  const router = useRouter()
  const [catalog, setCatalog] = useState<Ind[] | null>(null)
  const [catalogError, setCatalogError] = useState<string | null>(null)

  const [industryId, setIndustryId] = useState<string>('')
  const [vcId, setVcId] = useState<string>('')
  const [subId, setSubId] = useState<string>('')
  const [companyTicker, setCompanyTicker] = useState<string>('')

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [organization, setOrganization] = useState('')
  const [purpose, setPurpose] = useState('')
  const [consent, setConsent] = useState(false)

  const [captcha, setCaptcha] = useState<Captcha | null>(null)
  const [captchaAnswer, setCaptchaAnswer] = useState('')

  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PreviewResult | null>(null)
  const [queueHint, setQueueHint] = useState<string>('')

  const [showAccessModal, setShowAccessModal] = useState(false)
  const [accessSubmitted, setAccessSubmitted] = useState<string | null>(null)
  const [accessSubmitting, setAccessSubmitting] = useState(false)
  const [accessError, setAccessError] = useState<string | null>(null)
  const [accessPhone, setAccessPhone] = useState('')
  const [accessDesignation, setAccessDesignation] = useState('')
  const [accessCompanies, setAccessCompanies] = useState('')

  // ── Load catalog once ─────────────────────────────────
  //
  // The `?v=` cache-buster is paired with CATALOG_VERSION in
  // `/api/public/catalog/route.ts`. Bump both together when the catalog
  // builder changes so visitors with a stale browser cache immediately
  // get the new shape rather than waiting out the old `max-age` window.
  useEffect(() => {
    let cancelled = false
    fetch('/api/public/catalog?v=4')
      .then((r) => r.json())
      .then((j: CatalogResponse) => {
        if (cancelled) return
        // Only surface industries that have at least one company with
        // published/numeric data — so the dropdown never advertises an
        // industry we can't actually generate a report for. An industry
        // qualifies when EITHER (a) a curated COMPANIES[] row exists
        // OR (b) user_companies carries non-zero financials (the catalog
        // API flips hasNumbers for both cases via /api/public/catalog).
        const published = (j.industries || []).filter((ind) =>
          ind.hasRichData ||
          ind.valueChains.some((vc) => vc.companies.some((c) => c.hasNumbers))
        )
        setCatalog(published)
        // Default to first published industry for the best first impression.
        const first = published[0]
        if (first) setIndustryId(first.id)
      })
      .catch((err: Error) => {
        if (!cancelled) setCatalogError(err.message || 'Failed to load catalog')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ── Load / refresh captcha ────────────────────────────
  const refreshCaptcha = useCallback(async () => {
    try {
      const r = await fetch('/api/public/captcha', { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const c = (await r.json()) as Captcha
      setCaptcha(c)
      setCaptchaAnswer('')
    } catch {
      setCaptcha({ token: '', question: 'unavailable' })
    }
  }, [])
  useEffect(() => {
    refreshCaptcha()
  }, [refreshCaptcha])

  // Reset downstream when parent changes
  useEffect(() => {
    setVcId('')
    setSubId('')
    setCompanyTicker('')
  }, [industryId])
  useEffect(() => {
    setSubId('')
    setCompanyTicker('')
  }, [vcId])

  const currentInd = useMemo(
    () => catalog?.find((i) => i.id === industryId) || null,
    [catalog, industryId]
  )
  const currentVc = useMemo(
    () => currentInd?.valueChains.find((v) => v.id === vcId) || null,
    [currentInd, vcId]
  )

  const canSubmit =
    !!industryId &&
    name.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) &&
    consent &&
    !!captcha &&
    !!captcha.token &&
    captchaAnswer.trim().length > 0 &&
    phase !== 'working'

  // ── Generate ──────────────────────────────────────────
  const genStartRef = useRef<number>(0)
  const handleGenerate = async () => {
    if (!canSubmit || !captcha) return
    setPhase('working')
    setError(null)
    setQueueHint('')
    genStartRef.current = Date.now()
    try {
      const r = await fetch('/api/public/report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          industryId,
          valueChainId: vcId || null,
          subSegmentId: subId || null,
          companyTicker: companyTicker || null,
          name: name.trim(),
          email: email.trim(),
          organization: organization.trim() || null,
          purpose: purpose.trim() || null,
          captchaToken: captcha.token,
          captchaAnswer: captchaAnswer.trim(),
        }),
      })
      const j = await r.json()
      if (r.status === 503) {
        setPhase('busy')
        setQueueHint(
          j?.message ||
            'We are generating a few reports right now — please try again shortly.'
        )
        return
      }
      if (!r.ok) {
        setPhase('idle')
        setError(prettyError(j?.error, j?.reason) || 'Something went wrong.')
        await refreshCaptcha()
        return
      }

      // Company-picked flow — server returns a redirectUrl pointing at
      // /report/[ticker]?public=1. Full-page navigate (not router.push)
      // because the report route lives outside (dashboard)/ and has
      // its own layout.css cascade; staying inside Next's client-side
      // router can occasionally defer layout swaps long enough to
      // flash the landing page's dark theme behind the report.
      if (j?.mode === 'redirect' && typeof j.redirectUrl === 'string') {
        setPhase('redirecting')
        // Tiny delay so the "redirecting" card gets a visible tick —
        // otherwise the form appears to freeze for a split second.
        setTimeout(() => {
          window.location.assign(j.redirectUrl)
        }, 120)
        return
      }

      // Industry-only flow — show HTML preview in the modal.
      setResult(j as PreviewResult)
      setPhase('done')
    } catch (err) {
      setPhase('idle')
      setError((err as Error).message || 'Network error')
      await refreshCaptcha()
    }
  }

  const handleAccessSubmit = async () => {
    if (!captcha) return
    setAccessSubmitting(true)
    setAccessError(null)
    try {
      const r = await fetch('/api/public/request-access', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          organization: organization.trim() || null,
          designation: accessDesignation.trim() || null,
          phone: accessPhone.trim() || null,
          industryId: industryId || null,
          valueChainId: vcId || null,
          subSegmentId: subId || null,
          companies: accessCompanies.trim() || null,
          purpose: purpose.trim() || null,
          captchaToken: captcha.token,
          captchaAnswer: captchaAnswer.trim(),
        }),
      })
      const j = await r.json()
      if (!r.ok) {
        setAccessError(prettyError(j?.error, j?.reason) || 'Please try again.')
        await refreshCaptcha()
        return
      }
      setAccessSubmitted(
        j.message ||
          'Thank you. Our team will reach out within one business day.'
      )
    } catch (err) {
      setAccessError((err as Error).message || 'Network error')
    } finally {
      setAccessSubmitting(false)
    }
  }

  const resetAll = () => {
    setPhase('idle')
    setResult(null)
    setError(null)
    refreshCaptcha()
  }

  if (catalogError) {
    return (
      <div
        className="dn-picker-shell"
        style={{ ['--pk-accent' as any]: accent, ['--pk-rule' as any]: rule }}
      >
        <div className="dn-picker-err">
          Couldn&apos;t load the catalog. Please refresh the page.
          <div className="dn-picker-err-sub">{catalogError}</div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="dn-picker-shell"
      style={
        {
          ['--pk-accent' as any]: accent,
          ['--pk-accent2' as any]: accentSoft,
          ['--pk-ink' as any]: ink,
          ['--pk-body' as any]: body,
          ['--pk-muted' as any]: muted,
          ['--pk-cream' as any]: cream,
          ['--pk-rule' as any]: rule,
        } as React.CSSProperties
      }
    >
      {phase === 'idle' && (
        <>
          <header className="dn-pk-head">
            <div className="dn-pk-eyebrow">Instant sample report</div>
            <h3 className="dn-pk-title">Generate a report in under a minute.</h3>
            <p className="dn-pk-lede">
              Pick an industry, drill into its value chain, and download a sample intelligence
              report. Everything any visitor can see — for free.
            </p>
          </header>

          <div className="dn-pk-form">
            {/* Row 1: Industry */}
            <label className="dn-pk-field">
              <span className="dn-pk-label">
                1 · Industry<span className="dn-pk-req">*</span>
              </span>
              <select
                className="dn-pk-select"
                value={industryId}
                onChange={(e) => setIndustryId(e.target.value)}
                disabled={!catalog}
              >
                {!catalog && <option>Loading…</option>}
                {catalog?.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.label}
                  </option>
                ))}
              </select>
              {currentInd?.description && (
                <span className="dn-pk-hint">{currentInd.description}</span>
              )}
            </label>

            {/* Row 2: Value chain */}
            <label className="dn-pk-field">
              <span className="dn-pk-label">2 · Value chain</span>
              <select
                className="dn-pk-select"
                value={vcId}
                onChange={(e) => setVcId(e.target.value)}
                disabled={!currentInd}
              >
                <option value="">— All stages in this industry —</option>
                {currentInd?.valueChains.map((v) => {
                  // Count ONLY reportable companies (hasNumbers = true
                  // in the catalog, which the server sets when the
                  // ticker has a COMPANIES[] curated profile OR a
                  // user_companies row with non-zero financials).
                  // This keeps the "N co" count in sync with the
                  // filtered Row-4 dropdown below.
                  const reportable = v.companies.filter((c) => c.hasNumbers).length
                  return (
                    <option key={v.id} value={v.id}>
                      {v.name} ({v.subSegments.length.toLocaleString()} sub ·{' '}
                      {reportable.toLocaleString()} co)
                    </option>
                  )
                })}
              </select>
            </label>

            {/* Row 3: Sub value chain */}
            <label className="dn-pk-field">
              <span className="dn-pk-label">3 · Sub value chain</span>
              <select
                className="dn-pk-select"
                value={subId}
                onChange={(e) => setSubId(e.target.value)}
                disabled={!currentVc || currentVc.subSegments.length === 0}
              >
                <option value="">
                  {currentVc && currentVc.subSegments.length === 0
                    ? '— No sub-segments mapped for this stage yet —'
                    : '— All sub-segments —'}
                </option>
                {currentVc?.subSegments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>

            {/* Row 4: Company (optional)
                Only lists companies with enough data to generate a
                report. `hasNumbers = true` means the ticker either has
                a curated profile in COMPANIES[] OR has been fetched +
                pushed by an admin into user_companies with non-zero
                financials. Atlas-only tickers with no data yet are
                hidden entirely — selecting them would produce a
                report with blank MktCap / Revenue / EBITDA across
                every section. */}
            {currentVc && currentVc.companies.some((c) => c.hasNumbers) && (
              <label className="dn-pk-field">
                <span className="dn-pk-label">
                  4 · Company <span className="dn-pk-optional">(optional)</span>
                </span>
                <select
                  className="dn-pk-select"
                  value={companyTicker}
                  onChange={(e) => setCompanyTicker(e.target.value)}
                >
                  <option value="">— Industry / stage overview only —</option>
                  {currentVc.companies
                    .filter((c) => c.hasNumbers)
                    .map((c) => (
                      <option
                        key={(c.ticker || c.name) + c.name}
                        value={c.ticker || ''}
                      >
                        ★ {c.name}
                        {c.ticker ? ` (${c.ticker})` : ''}
                      </option>
                    ))}
                </select>
                <span className="dn-pk-hint">
                  Only companies with enough data to generate a report are listed.
                </span>
              </label>
            )}

            {/* User info */}
            <div className="dn-pk-row2">
              <label className="dn-pk-field">
                <span className="dn-pk-label">
                  Name<span className="dn-pk-req">*</span>
                </span>
                <input
                  className="dn-pk-input"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Jane Analyst"
                  maxLength={120}
                />
              </label>
              <label className="dn-pk-field">
                <span className="dn-pk-label">
                  Work email<span className="dn-pk-req">*</span>
                </span>
                <input
                  className="dn-pk-input"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jane@firm.com"
                  maxLength={160}
                />
              </label>
            </div>
            <div className="dn-pk-row2">
              <label className="dn-pk-field">
                <span className="dn-pk-label">Organization</span>
                <input
                  className="dn-pk-input"
                  type="text"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="Firm / company / fund"
                  maxLength={160}
                />
              </label>
              <label className="dn-pk-field">
                <span className="dn-pk-label">Purpose</span>
                <input
                  className="dn-pk-input"
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder="e.g. thesis review, mandate brief"
                  maxLength={200}
                />
              </label>
            </div>

            {/* CAPTCHA */}
            <div className="dn-pk-captcha">
              <div className="dn-pk-captcha-q">
                <span className="dn-pk-label">
                  Verify you&apos;re human<span className="dn-pk-req">*</span>
                </span>
                <div className="dn-pk-captcha-qrow">
                  <span className="dn-pk-captcha-eq">{captcha?.question || '…'}</span>
                  <input
                    className="dn-pk-input dn-pk-captcha-input"
                    type="text"
                    inputMode="numeric"
                    value={captchaAnswer}
                    onChange={(e) => setCaptchaAnswer(e.target.value)}
                    placeholder="answer"
                    maxLength={8}
                  />
                  <button
                    type="button"
                    className="dn-pk-captcha-refresh"
                    onClick={refreshCaptcha}
                    title="New challenge"
                  >
                    ↻
                  </button>
                </div>
              </div>
            </div>

            <label className="dn-pk-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                I understand this report is illustrative only and{' '}
                <strong>not investment advice</strong>. I agree DealNector may record my IP and
                contact details for this request.
              </span>
            </label>

            {error && <div className="dn-pk-err">{error}</div>}

            <div className="dn-pk-cta-row">
              <button
                type="button"
                className="dn-pk-btn dn-pk-btn-primary"
                onClick={handleGenerate}
                disabled={!canSubmit}
                title={!canSubmit ? 'Complete the required fields first' : 'Generate sample report'}
              >
                Generate sample report →
              </button>
              <button
                type="button"
                className="dn-pk-btn dn-pk-btn-ghost"
                onClick={() => setShowAccessModal(true)}
              >
                Need a customised report? Request access →
              </button>
            </div>

            <div className="dn-pk-fine">
              <strong>Disclaimer.</strong> Sample reports may not accurately represent reality and
              must not be used for any financial transaction or investment decision.
            </div>
          </div>
        </>
      )}

      {phase === 'working' && <WorkingCard accent={accent} cream={cream} rule={rule} muted={muted} ink={ink} />}

      {phase === 'redirecting' && (
        <div className="dn-pk-done">
          <div className="dn-pk-done-badge">Opening report</div>
          <h3 className="dn-pk-title">Taking you to the valuation report…</h3>
          <p className="dn-pk-lede">
            You&apos;ll arrive on the full DealNector report page in a moment. Use the{' '}
            <strong>Download PDF</strong> button in the top-right toolbar to save it, or{' '}
            <strong>Share</strong> to copy a link. Use <strong>← Back to home</strong> to return
            here.
          </p>
          <div className="dn-pk-fine">
            <strong>Disclaimer.</strong> Sample report — illustrative only, not investment advice.
          </div>
        </div>
      )}

      {phase === 'busy' && (
        <div className="dn-pk-busy">
          <div className="dn-pk-busy-badge">High traffic</div>
          <h3 className="dn-pk-title">Thank you for your patience.</h3>
          <p className="dn-pk-lede">{queueHint}</p>
          <div className="dn-pk-cta-row">
            <button className="dn-pk-btn dn-pk-btn-primary" onClick={handleGenerate}>
              Try again
            </button>
            <button className="dn-pk-btn dn-pk-btn-ghost" onClick={resetAll}>
              Start over
            </button>
          </div>
        </div>
      )}

      {phase === 'done' && result && (
        <div className="dn-pk-done">
          <div className="dn-pk-done-badge">Ready</div>
          <h3 className="dn-pk-title">{result.title}</h3>
          <p className="dn-pk-lede">Your sample report is ready. Preview or download below.</p>
          <div className="dn-pk-cta-row">
            <button
              className="dn-pk-btn dn-pk-btn-primary"
              onClick={() => {
                /* modal is already open once result exists via <ReportPreviewModal/> below */
              }}
            >
              Preview opened in popup
            </button>
            <a className="dn-pk-btn dn-pk-btn-ghost" href={result.downloadUrl} download>
              ⬇ Download now
            </a>
            <button className="dn-pk-btn dn-pk-btn-ghost" onClick={resetAll}>
              Generate another
            </button>
          </div>
          <div className="dn-pk-fine">
            Report ID <span className="mono">{result.reportId}</span>. Stored for 90 days.
            <br />
            <strong>Disclaimer.</strong> Illustrative only — not investment advice.
          </div>
        </div>
      )}

      <ReportPreviewModal
        open={phase === 'done' && !!result}
        result={result}
        onClose={resetAll}
        onRequestAccess={() => {
          setShowAccessModal(true)
        }}
        accentColor={accent}
      />

      {showAccessModal && (
        <div
          className="dn-acc-overlay"
          onClick={() => {
            if (!accessSubmitting) {
              setShowAccessModal(false)
              setAccessSubmitted(null)
              setAccessError(null)
            }
          }}
        >
          <div className="dn-acc-modal" onClick={(e) => e.stopPropagation()}>
            <header className="dn-acc-head">
              <div>
                <div className="dn-pk-eyebrow">Request customised access</div>
                <h3 className="dn-pk-title" style={{ margin: 0 }}>
                  Tell us what you need.
                </h3>
              </div>
              <button
                type="button"
                className="dn-pk-btn dn-pk-btn-ghost"
                onClick={() => {
                  if (!accessSubmitting) {
                    setShowAccessModal(false)
                    setAccessSubmitted(null)
                    setAccessError(null)
                  }
                }}
                aria-label="Close"
              >
                ✕
              </button>
            </header>

            {accessSubmitted ? (
              <div className="dn-acc-ok">
                <div className="dn-pk-done-badge">Received</div>
                <p>{accessSubmitted}</p>
                <button
                  className="dn-pk-btn dn-pk-btn-primary"
                  onClick={() => {
                    setShowAccessModal(false)
                    setAccessSubmitted(null)
                  }}
                >
                  Close
                </button>
              </div>
            ) : (
              <div className="dn-pk-form">
                <p className="dn-pk-lede" style={{ marginTop: 0 }}>
                  Customised reports include company-specific DCF, CRVI scoring, peer
                  benchmarking, and news-adjusted intrinsic value. Our team builds them on
                  request — share a few details and we&apos;ll reach out within one business
                  day.
                </p>
                <div className="dn-pk-row2">
                  <label className="dn-pk-field">
                    <span className="dn-pk-label">
                      Name<span className="dn-pk-req">*</span>
                    </span>
                    <input
                      className="dn-pk-input"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Analyst"
                    />
                  </label>
                  <label className="dn-pk-field">
                    <span className="dn-pk-label">
                      Work email<span className="dn-pk-req">*</span>
                    </span>
                    <input
                      className="dn-pk-input"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="jane@firm.com"
                    />
                  </label>
                </div>
                <div className="dn-pk-row2">
                  <label className="dn-pk-field">
                    <span className="dn-pk-label">Organization</span>
                    <input
                      className="dn-pk-input"
                      type="text"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      placeholder="Firm / company / fund"
                    />
                  </label>
                  <label className="dn-pk-field">
                    <span className="dn-pk-label">Designation</span>
                    <input
                      className="dn-pk-input"
                      type="text"
                      value={accessDesignation}
                      onChange={(e) => setAccessDesignation(e.target.value)}
                      placeholder="e.g. VP Corporate Development"
                    />
                  </label>
                </div>
                <div className="dn-pk-row2">
                  <label className="dn-pk-field">
                    <span className="dn-pk-label">Phone</span>
                    <input
                      className="dn-pk-input"
                      type="tel"
                      value={accessPhone}
                      onChange={(e) => setAccessPhone(e.target.value)}
                      placeholder="+91 …"
                    />
                  </label>
                  <label className="dn-pk-field">
                    <span className="dn-pk-label">Companies / tickers of interest</span>
                    <input
                      className="dn-pk-input"
                      type="text"
                      value={accessCompanies}
                      onChange={(e) => setAccessCompanies(e.target.value)}
                      placeholder="e.g. WAAREEENS, POLYCAB, private pre-IPO modules"
                    />
                  </label>
                </div>
                <label className="dn-pk-field">
                  <span className="dn-pk-label">What are you trying to evaluate?</span>
                  <textarea
                    className="dn-pk-input"
                    value={purpose}
                    onChange={(e) => setPurpose(e.target.value)}
                    rows={3}
                    placeholder="Thesis, target profile, or specific questions"
                    maxLength={1000}
                  />
                </label>
                <div className="dn-pk-captcha">
                  <div className="dn-pk-captcha-q">
                    <span className="dn-pk-label">
                      Verify you&apos;re human<span className="dn-pk-req">*</span>
                    </span>
                    <div className="dn-pk-captcha-qrow">
                      <span className="dn-pk-captcha-eq">{captcha?.question || '…'}</span>
                      <input
                        className="dn-pk-input dn-pk-captcha-input"
                        type="text"
                        inputMode="numeric"
                        value={captchaAnswer}
                        onChange={(e) => setCaptchaAnswer(e.target.value)}
                        placeholder="answer"
                        maxLength={8}
                      />
                      <button
                        type="button"
                        className="dn-pk-captcha-refresh"
                        onClick={refreshCaptcha}
                      >
                        ↻
                      </button>
                    </div>
                  </div>
                </div>

                {accessError && <div className="dn-pk-err">{accessError}</div>}

                <div className="dn-pk-cta-row">
                  <button
                    type="button"
                    className="dn-pk-btn dn-pk-btn-primary"
                    onClick={handleAccessSubmit}
                    disabled={
                      accessSubmitting ||
                      !name.trim() ||
                      !email.trim() ||
                      !captcha ||
                      !captchaAnswer.trim()
                    }
                  >
                    {accessSubmitting ? 'Submitting…' : 'Submit request →'}
                  </button>
                  <button
                    type="button"
                    className="dn-pk-btn dn-pk-btn-ghost"
                    disabled={accessSubmitting}
                    onClick={() => {
                      setShowAccessModal(false)
                      setAccessError(null)
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .dn-picker-shell {
          --pk-accent: ${accent};
          --pk-accent2: ${accentSoft};
          --pk-ink: ${ink};
          --pk-body: ${body};
          --pk-muted: ${muted};
          --pk-cream: ${cream};
          --pk-rule: ${rule};
          background: #fff;
          border: 1px solid var(--pk-rule);
          border-radius: 10px;
          padding: 22px 22px 20px;
          box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
          width: 100%;
          max-width: 520px;
        }
        .dn-pk-head {
          margin-bottom: 14px;
        }
        .dn-pk-eyebrow {
          font-size: 11px;
          letter-spacing: 1.6px;
          text-transform: uppercase;
          color: var(--pk-accent);
          font-weight: 700;
        }
        .dn-pk-title {
          font-family: Georgia, serif;
          color: var(--pk-ink);
          font-size: 22px;
          line-height: 1.15;
          margin: 4px 0 4px;
        }
        .dn-pk-lede {
          font-size: 13.5px;
          color: var(--pk-body);
          line-height: 1.5;
          margin: 0;
        }
        .dn-pk-form {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .dn-pk-row2 {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .dn-pk-field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .dn-pk-label {
          font-size: 11px;
          letter-spacing: 0.3px;
          text-transform: uppercase;
          color: var(--pk-muted);
          font-weight: 700;
        }
        .dn-pk-req {
          color: var(--pk-accent);
          margin-left: 3px;
        }
        .dn-pk-optional {
          color: var(--pk-muted);
          font-weight: 500;
          text-transform: none;
          letter-spacing: 0;
        }
        .dn-pk-select,
        .dn-pk-input {
          border: 1px solid var(--pk-rule);
          border-radius: 6px;
          padding: 9px 10px;
          font-size: 13.5px;
          color: var(--pk-ink);
          background: #fff;
          font-family: inherit;
          width: 100%;
          outline: none;
        }
        .dn-pk-select:focus,
        .dn-pk-input:focus {
          border-color: var(--pk-accent);
          box-shadow: 0 0 0 2px rgba(194, 94, 16, 0.15);
        }
        textarea.dn-pk-input {
          resize: vertical;
          min-height: 64px;
        }
        .dn-pk-hint {
          font-size: 11.5px;
          color: var(--pk-muted);
          line-height: 1.4;
        }
        .dn-pk-captcha {
          border: 1px dashed var(--pk-rule);
          border-radius: 6px;
          background: var(--pk-cream);
          padding: 10px 12px;
        }
        .dn-pk-captcha-qrow {
          display: flex;
          gap: 8px;
          align-items: center;
          margin-top: 4px;
        }
        .dn-pk-captcha-eq {
          font-family: 'SF Mono', Menlo, Consolas, monospace;
          font-size: 16px;
          font-weight: 700;
          color: var(--pk-ink);
          background: #fff;
          border: 1px solid var(--pk-rule);
          border-radius: 4px;
          padding: 6px 12px;
          min-width: 110px;
          text-align: center;
          letter-spacing: 1px;
        }
        .dn-pk-captcha-input {
          max-width: 120px;
        }
        .dn-pk-captcha-refresh {
          background: #fff;
          border: 1px solid var(--pk-rule);
          border-radius: 4px;
          padding: 6px 10px;
          cursor: pointer;
          font-size: 14px;
          color: var(--pk-muted);
        }
        .dn-pk-captcha-refresh:hover {
          color: var(--pk-accent);
          border-color: var(--pk-accent);
        }
        .dn-pk-consent {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          font-size: 11.5px;
          color: var(--pk-muted);
          line-height: 1.4;
        }
        .dn-pk-consent input {
          margin-top: 2px;
          accent-color: var(--pk-accent);
        }
        .dn-pk-err {
          background: #FCE9EA;
          color: #B4252B;
          border: 1px solid rgba(180, 37, 43, 0.3);
          padding: 8px 10px;
          border-radius: 4px;
          font-size: 12.5px;
          font-weight: 600;
        }
        .dn-pk-cta-row {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 4px;
        }
        .dn-pk-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 10px 14px;
          border-radius: 6px;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid var(--pk-rule);
          background: #fff;
          color: var(--pk-ink);
          text-decoration: none;
          line-height: 1;
          font-family: inherit;
        }
        .dn-pk-btn:hover:not(:disabled) {
          border-color: var(--pk-accent);
          color: var(--pk-accent);
        }
        .dn-pk-btn-primary {
          background: var(--pk-accent);
          color: #fff;
          border-color: var(--pk-accent);
        }
        .dn-pk-btn-primary:hover:not(:disabled) {
          background: var(--pk-ink);
          border-color: var(--pk-ink);
          color: #fff;
        }
        .dn-pk-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .dn-pk-btn-ghost {
          background: transparent;
        }
        .dn-pk-fine {
          font-size: 11px;
          color: var(--pk-muted);
          line-height: 1.45;
          border-top: 1px solid var(--pk-rule);
          padding-top: 8px;
          margin-top: 4px;
        }
        .dn-pk-busy,
        .dn-pk-done {
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: flex-start;
          padding: 12px 4px;
        }
        .dn-pk-busy-badge,
        .dn-pk-done-badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          background: var(--pk-cream);
          color: var(--pk-accent);
          border: 1px solid var(--pk-accent);
        }
        .dn-pk-done-badge {
          background: #DEF3E5;
          color: #0B6B3A;
          border-color: #0B6B3A;
        }
        .dn-pk-err-sub {
          display: block;
          font-weight: 400;
          margin-top: 4px;
          color: var(--pk-muted);
        }
        .mono {
          font-family: 'SF Mono', Menlo, Consolas, monospace;
        }

        .dn-acc-overlay {
          position: fixed;
          inset: 0;
          background: rgba(5, 28, 44, 0.72);
          z-index: 9998;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 16px;
          backdrop-filter: blur(2px);
        }
        .dn-acc-modal {
          width: 100%;
          max-width: 640px;
          max-height: 92vh;
          overflow-y: auto;
          background: #fff;
          border-radius: 10px;
          padding: 22px;
          border: 1px solid var(--pk-rule);
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
        }
        .dn-acc-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 14px;
          gap: 12px;
        }
        .dn-acc-ok {
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 12px 0;
          font-size: 14px;
          color: var(--pk-body);
        }

        @media (max-width: 520px) {
          .dn-pk-row2 {
            grid-template-columns: 1fr;
          }
          .dn-picker-shell {
            padding: 18px;
          }
        }
      `}</style>
    </div>
  )
}

function WorkingCard({
  accent,
  cream,
  rule,
  muted,
  ink,
}: {
  accent: string
  cream: string
  rule: string
  muted: string
  ink: string
}) {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const lines = [
    'Loading taxonomy…',
    'Resolving value-chain scope…',
    'Querying peer snapshot…',
    'Rendering report HTML…',
    'Finalising disclaimer banners…',
  ]
  return (
    <div className="dn-working">
      <div className="dn-working-spinner" aria-hidden />
      <div className="dn-working-badge">Generating</div>
      <h3 style={{ margin: 0, fontFamily: 'Georgia, serif', color: ink, fontSize: '22px' }}>
        Building your sample report…
      </h3>
      <p style={{ margin: 0, color: muted, fontSize: '13.5px', lineHeight: 1.5 }}>
        Thank you for your patience — this usually takes under 5 seconds. We&apos;re assembling the
        taxonomy, peer snapshot, and disclaimer pages in the background.
      </p>
      <ul className="dn-working-log">
        {lines.map((l, i) => (
          <li key={i} className={i <= Math.min(tick, lines.length - 1) ? 'on' : ''}>
            {l}
          </li>
        ))}
      </ul>
      <style jsx>{`
        .dn-working {
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: flex-start;
          padding: 12px 4px;
        }
        .dn-working-badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 700;
          letter-spacing: 1.2px;
          text-transform: uppercase;
          background: ${cream};
          color: ${accent};
          border: 1px solid ${accent};
        }
        .dn-working-spinner {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          border: 3px solid ${rule};
          border-top-color: ${accent};
          animation: dn-spin 0.9s linear infinite;
        }
        @keyframes dn-spin {
          to {
            transform: rotate(360deg);
          }
        }
        .dn-working-log {
          list-style: none;
          margin: 4px 0 0;
          padding: 0;
          font-size: 12.5px;
          color: ${muted};
          line-height: 1.7;
        }
        .dn-working-log li::before {
          content: '○ ';
          color: ${rule};
        }
        .dn-working-log li.on::before {
          content: '● ';
          color: ${accent};
        }
      `}</style>
    </div>
  )
}

function prettyError(code?: string, reason?: string): string {
  switch (code) {
    case 'name_required':
      return 'Please enter your name.'
    case 'email_invalid':
      return 'Please enter a valid email address.'
    case 'industry_required':
    case 'industry_unknown':
      return 'Please choose an industry.'
    case 'captcha_failed':
      if (reason === 'expired') return 'Verification expired — please try the new question.'
      if (reason === 'wrong_answer') return 'Wrong answer — please try again.'
      return 'Verification failed — please try again.'
    case 'rate_limited':
      return 'Hourly limit reached from your IP — please try again later.'
    case 'busy':
      return 'We are generating a few reports right now — please try again in about a minute. Thank you for your patience.'
    default:
      return ''
  }
}
