'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Badge } from '@/components/ui/Badge'
import { COMPANIES, type Company } from '@/lib/data/companies'
import { CHAIN } from '@/lib/data/chain'
import { getSubSegmentsForComp, getSubSegmentsForIndustry } from '@/lib/data/sub-segments'
import { formatInrCr } from '@/lib/format'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'
import { broadcastIndustryRegistryChange, useIndustryFilter } from '@/hooks/useIndustryFilter'
import { useIndustryAtlas } from '@/hooks/useIndustryAtlas'
import type { ScreenerRow, ScreenerRatioRow, ScreenerRatioYear } from '@/app/api/admin/scrape-screener/route'
import type { ExchangeRow } from '@/app/api/admin/scrape-exchange/route'
import {
  useExchangeSweep,
  patchExchangeSweep,
  setExchangeSweepData,
  mergeExchangeSweepData,
  getExchangeSweepSnapshot,
  getExchangeAbortController,
  setExchangeAbortController,
  cancelExchangeSweep,
} from '@/lib/admin/exchange-sweep'

/**
 * Broadcast a "data pushed to website" signal.
 *
 * The LiveSnapshotProvider listens for `sg4:data-pushed` (same-tab) and
 * for `storage` on the `sg4_data_pushed_at` key (cross-tab). Call this
 * from every push-to-website site so Dashboard / M&A Radar / Valuation
 * / Watchlist / Compare / FSA all re-read user_companies without a
 * hard reload.
 *
 * Pairs with `await reloadDbCompanies()` from useLiveSnapshot — that
 * refreshes the CURRENT component's snapshot, this broadcasts so every
 * OTHER mounted component does the same.
 */
function broadcastDataPushed(tickers: string[], source?: string) {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new CustomEvent('sg4:data-pushed', { detail: { tickers, source } }))
    localStorage.setItem('sg4_data_pushed_at', String(Date.now()))
  } catch { /* ignore */ }
}

/**
 * Broadcast that one or more atlas industries had their chain / company
 * data mutated (seed-atlas, CSV upload, SME Discovery → Add to Platform
 * for an atlas industry, single-row publish into industry_chain_companies,
 * etc.).
 *
 * Pairs with the listener in `useIndustryAtlas` — every mounted hook
 * re-fetches `/api/industries/[id]/chain` + `/api/industries/[id]/companies`
 * for the affected ids, so Value Chain, Dashboard segment dropdowns, and
 * the admin Industries comparison all reflect the change without a hard
 * reload. Pass an empty array (or no arg) to invalidate every selected
 * atlas bundle when the affected industry isn't known up-front.
 *
 * Also bumps `sg4_industry_data_pushed_at` in localStorage so a separate
 * tab listening via the `storage` event refreshes too.
 */
function broadcastIndustryDataChange(industries: string[] = []): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(
      new CustomEvent('sg4:industry-data-change', { detail: { industries } }),
    )
    localStorage.setItem('sg4_industry_data_pushed_at', String(Date.now()))
  } catch { /* ignore */ }
}

/**
 * Safely parse a fetch Response that *should* be JSON but sometimes
 * isn't (Vercel serverless timeouts, upstream Next.js error HTML, nginx
 * 502s, etc.) so the admin UI surfaces a readable error instead of the
 * cryptic "Unexpected token 'A', "An error o"... is not valid JSON"
 * crash when the body starts with `An error occurred…`.
 *
 * Returns a normalised `{ ok, error?, ...body }` shape so callers can do
 * `if (json.ok) { ... } else setPublishMsg(json.error)` without a second
 * try/catch around `res.json()`.
 *
 * Specifically detects:
 *   - Vercel function timeout / gateway HTML (<html> or "An error
 *     occurred" prefix) — cast to `HTTP 504/500 — <title or first line>`.
 *   - 4xx/5xx with non-JSON text — surface the status + first 240 chars.
 *   - 4xx/5xx with valid JSON missing an `error` field — synthesise one.
 *   - Empty body (happens on aborted uploads) — explicit "no body" message.
 */
// Typed as `any` on purpose — this is a drop-in for `res.json()`, which
// TypeScript also types as `any` via `Body.json(): Promise<any>`. Callers
// throughout this file destructure fields like `json.data`, `json.skipped`,
// `json.message`, `json.authCode`, `json.emailSent`, etc., with varied
// shapes per route. A strict generic envelope would force each of ~24
// call sites to add a type parameter; returning `any` preserves the
// zero-friction ergonomics the original `res.json()` had while still
// adding the timeout / non-JSON protection this helper is about.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeJson(res: Response): Promise<any> {
  const status = res.status
  const ct = res.headers.get('content-type') || ''
  let text = ''
  try {
    text = await res.text()
  } catch {
    return { ok: false, error: `HTTP ${status}: could not read response body` }
  }
  if (!text) {
    return { ok: false, error: `HTTP ${status}: empty response` }
  }
  // Happy path: JSON content-type or obvious JSON body.
  const looksJson = ct.includes('application/json') || /^[\s]*[\[{]/.test(text)
  if (looksJson) {
    try {
      const json = JSON.parse(text)
      if (json && typeof json === 'object') {
        if (json.ok === undefined) {
          // Route returned raw data without an envelope; treat 2xx as ok.
          return { ok: res.ok, ...json }
        }
        if (!json.ok && !json.error) json.error = `HTTP ${status}`
      }
      return json
    } catch {
      // Fall through to the HTML / text branch.
    }
  }
  // Non-JSON body — strip HTML tags, keep the first meaningful line so
  // the admin knows which upstream actually failed.
  const stripped = text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240)
  const kind = status === 504
    ? 'gateway timeout'
    : status === 502
      ? 'bad gateway'
      : status >= 500
        ? 'server error'
        : status >= 400
          ? 'request error'
          : 'non-JSON response'
  return { ok: false, error: `HTTP ${status} (${kind}): ${stripped || 'no readable body'}` }
}

// ─── Types mirrored from the API ─────────────────────────

interface AdminUserRow {
  id: number
  username: string
  email: string
  full_name: string | null
  phone: string | null
  organization: string | null
  designation: string | null
  official_email: string | null
  role: string
  is_active: boolean
  signup_ip: string | null
  signup_location: string | null
  last_login_ip: string | null
  last_login_location: string | null
  created_at: string
  last_login: string | null
}

interface InterestRow {
  id: number
  user_id: number | null
  user_email: string | null
  user_name: string | null
  user_phone: string | null
  ticker: string | null
  company_name: string | null
  deal_type: string | null
  sector: string | null
  rationale: string | null
  source_page: string | null
  expressed_at: string
}

interface EmailLogRow {
  id: number
  to_addr: string
  subject: string
  body: string
  category: string | null
  sent_at: string
  delivered: boolean
  error: string | null
}

type Tab = 'users' | 'interests' | 'email' | 'password' | 'sources' | 'pushdata' | 'industries' | 'landing' | 'visitors'

interface VisitorLogRow {
  id: string
  type: 'report' | 'access'
  created_at: string | null
  name: string | null
  email: string | null
  organization: string | null
  designation: string | null
  phone: string | null
  industry_id: string | null
  value_chain_id: string | null
  sub_segment_id: string | null
  company_ticker: string | null
  companies_of_interest: string | null
  purpose: string | null
  ip: string | null
  location: string | null
  user_agent: string | null
  status: string | null
}

export default function AdminDashboardPage() {
  const { data: session, status } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role
  const isAdmin = role === 'admin'
  const isSubadmin = role === 'subadmin'
  const hasAdminAccess = isAdmin || isSubadmin

  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [interests, setInterests] = useState<InterestRow[]>([])
  const [visitors, setVisitors] = useState<VisitorLogRow[]>([])
  const [visitorSearch, setVisitorSearch] = useState('')
  const [visitorTypeFilter, setVisitorTypeFilter] = useState<'all' | 'report' | 'access'>('all')
  const [emailLog, setEmailLog] = useState<EmailLogRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [apiQuota, setApiQuota] = useState<{
    requestsLimit: number | null
    requestsRemaining: number | null
    requestsUsed: number | null
    lastUpdated: string
    totalCallsMade: number
  } | null>(null)

  // Password change flow
  const [pwRequesting, setPwRequesting] = useState(false)
  const [pwCode, setPwCode] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwNew2, setPwNew2] = useState('')
  const [pwMsg, setPwMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(
    null
  )

  // Test-email flow — lets the admin verify the Brevo welcome-email
  // pipeline (API key, sender verification, HTML template) without
  // approving a real pending user.
  const [testEmailTo, setTestEmailTo] = useState('')
  const [testEmailSending, setTestEmailSending] = useState(false)
  const [testEmailMsg, setTestEmailMsg] = useState<
    { kind: 'success' | 'error'; text: string } | null
  >(null)

  const showToast = (msg: string, durationMs = 2800) => {
    setToast(msg)
    setTimeout(() => setToast(null), durationMs)
  }

  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Bootstrap schema + seed on first visit
      await fetch('/api/admin/bootstrap').catch(() => undefined)
      const [u, i, e, q, v] = await Promise.all([
        fetch('/api/admin/users').then((r) => r.json()),
        fetch('/api/admin/interests').then((r) => r.json()),
        fetch('/api/admin/email-log').then((r) => r.json()),
        fetch('/api/admin/api-quota').then((r) => r.json()).catch(() => ({ ok: false })),
        fetch('/api/admin/visitors').then((r) => r.json()).catch(() => ({ ok: false })),
      ])
      if (u.ok) setUsers(u.users || [])
      if (i.ok) setInterests(i.interests || [])
      if (e.ok) setEmailLog(e.log || [])
      if (q.ok && q.quota) setApiQuota(q.quota)
      if (v.ok) setVisitors(v.visitors || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (status === 'authenticated' && hasAdminAccess) {
      refreshAll()
    }
  }, [status, hasAdminAccess, refreshAll])

  // ── Guards ──────────────────────────────────────────────
  if (status === 'loading') {
    return <div style={{ padding: 24, color: 'var(--txt3)' }}>Loading…</div>
  }
  if (status !== 'authenticated' || !hasAdminAccess) {
    return (
      <div>
        <div className="phdr">
          <div className="phdr-breadcrumb">
            <span className="dn-wordmark">
              Deal<em>Nector</em>
            </span>{' '}
            › Admin
          </div>
          <div className="phdr-title">Admin</div>
        </div>
        <div className="panel">
          <div style={{ padding: 24, textAlign: 'center' }}>
            <div style={{ fontSize: 14, color: 'var(--red)', marginBottom: 8 }}>
              Admin access required
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
              Only users with the admin role can view this page.
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── User actions ────────────────────────────────────────
  const toggleActive = async (id: number, isActive: boolean) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !isActive }),
    })
    const data = await safeJson(res)
    if (!res.ok || !data.ok) {
      showToast(data.error || 'Update failed')
      return
    }
    showToast(!isActive ? 'User re-enabled' : 'Login restricted')
    refreshAll()
  }

  const deleteUser = async (id: number, email: string) => {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
    const data = await safeJson(res)
    if (!res.ok || !data.ok) {
      showToast(data.error || 'Delete failed')
      return
    }
    showToast('User deleted')
    refreshAll()
  }

  const approveUser = async (id: number, email: string) => {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approve: true }),
    })
    const data = await safeJson(res)
    if (!res.ok || !data.ok) {
      showToast(data.error || 'Approve failed')
      return
    }
    // Differentiate between "email actually sent" and "approved but email
    // failed" — the latter means the admin has to share the auth code
    // with the user through another channel (Slack, SMS, phone).
    if (data.emailSent) {
      showToast(`Approved! Welcome email sent to ${email} with auth code: ${data.authCode}`)
    } else {
      showToast(
        `Approved — but welcome email FAILED (${data.emailError || 'unknown'}). Share this auth code manually: ${data.authCode}`,
        8000
      )
    }
    refreshAll()
  }

  const downloadCsv = () => {
    window.location.href = '/api/admin/users/csv'
  }

  // Dispatch a test welcome email via Brevo. Surface the precise
  // failure reason (missing key, unverified sender, 4xx from Brevo)
  // so the admin can fix infra without trial-and-error.
  const sendTestEmail = async () => {
    const to = testEmailTo.trim()
    if (!to) {
      setTestEmailMsg({ kind: 'error', text: 'Enter a recipient email address.' })
      return
    }
    setTestEmailSending(true)
    setTestEmailMsg(null)
    try {
      const res = await fetch('/api/admin/test-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to }),
      })
      const data = await safeJson(res)
      if (!res.ok || !data.ok) {
        setTestEmailMsg({ kind: 'error', text: data.error || 'Request failed' })
      } else if (data.emailSent) {
        setTestEmailMsg({
          kind: 'success',
          text: `Test welcome email sent to ${data.to}${
            data.messageId ? ` (Brevo id: ${data.messageId})` : ''
          }. Check inbox and spam folder.`,
        })
      } else {
        setTestEmailMsg({
          kind: 'error',
          text: `Brevo rejected the send: ${data.error || 'unknown error'}`,
        })
      }
    } catch (err) {
      setTestEmailMsg({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Network error',
      })
    } finally {
      setTestEmailSending(false)
    }
  }

  // ── Password change ─────────────────────────────────────
  const requestCode = async () => {
    setPwRequesting(true)
    setPwMsg(null)
    const res = await fetch('/api/admin/password/request', { method: 'POST' })
    const data = await safeJson(res)
    setPwRequesting(false)
    if (res.ok && data.ok) {
      setPwMsg({
        kind: 'info',
        text:
          data.message ||
          'Auth code dispatched. Check the admin email (and Email Log tab).',
      })
    } else {
      setPwMsg({ kind: 'error', text: data.error || 'Could not request code.' })
    }
  }

  const confirmPassword = async () => {
    setPwMsg(null)
    if (!pwCode.trim() || !pwNew || !pwNew2) {
      setPwMsg({ kind: 'error', text: 'Code + both password fields are required.' })
      return
    }
    if (pwNew !== pwNew2) {
      setPwMsg({ kind: 'error', text: 'Passwords do not match.' })
      return
    }
    if (pwNew.length < 6) {
      setPwMsg({ kind: 'error', text: 'Password must be at least 6 characters.' })
      return
    }
    const res = await fetch('/api/admin/password/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: pwCode.trim(), newPassword: pwNew }),
    })
    const data = await safeJson(res)
    if (res.ok && data.ok) {
      setPwMsg({ kind: 'success', text: 'Admin password updated successfully.' })
      setPwCode('')
      setPwNew('')
      setPwNew2('')
    } else {
      setPwMsg({ kind: 'error', text: data.error || 'Password change failed.' })
    }
  }

  const tdStyle: React.CSSProperties = {
    padding: '8px 10px',
    fontSize: 11,
    color: 'var(--txt)',
    borderBottom: '1px solid var(--br)',
    whiteSpace: 'nowrap',
  }
  const thStyle: React.CSSProperties = {
    padding: '8px 10px',
    textAlign: 'left',
    fontSize: 9,
    color: 'var(--txt3)',
    letterSpacing: '0.8px',
    textTransform: 'uppercase',
    fontWeight: 700,
    background: 'var(--s3)',
    borderBottom: '1px solid var(--br)',
    whiteSpace: 'nowrap',
  }

  return (
    <div>
      {/* Header */}
      <div className="phdr">
        <div className="phdr-breadcrumb">
          <span className="dn-wordmark">
            Deal<em>Nector</em>
          </span>{' '}
          › Admin
        </div>
        <div className="phdr-title">
          Admin <em>Console</em>
        </div>
        <div className="phdr-meta">
          <Badge variant="gold">Restricted · admin only</Badge>
          <Badge variant="gray">{users.length} users</Badge>
          <Badge variant="cyan">{interests.length} interests</Badge>
          <button
            onClick={refreshAll}
            disabled={loading}
            style={{
              marginLeft: 'auto',
              background: 'var(--s3)',
              border: '1px solid var(--br)',
              color: 'var(--txt2)',
              fontSize: 10,
              padding: '4px 10px',
              borderRadius: 3,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            ↻ {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* RapidAPI Quota Panel */}
      {apiQuota && (
        <div style={{
          display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap',
          padding: '10px 16px', margin: '0 0 12px',
          background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6,
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--txt2)' }} title="RapidAPI quota usage for Indian Stock Exchange data feed">
            📊 RapidAPI Quota
          </span>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <div title="Total API calls made this session">
              <span style={{ fontSize: 10, color: 'var(--txt3)', display: 'block' }}>Calls Made</span>
              <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: 'var(--gold2)' }}>{apiQuota.totalCallsMade}</span>
            </div>
            {apiQuota.requestsUsed !== null && (
              <div title="Calls used this billing period (from RapidAPI headers)">
                <span style={{ fontSize: 10, color: 'var(--txt3)', display: 'block' }}>Used / Limit</span>
                <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: (apiQuota.requestsRemaining ?? 999) < 50 ? 'var(--red)' : 'var(--green)' }}>
                  {apiQuota.requestsUsed?.toLocaleString()} / {apiQuota.requestsLimit?.toLocaleString()}
                </span>
              </div>
            )}
            {apiQuota.requestsRemaining !== null && (
              <div title="Remaining API calls this billing period">
                <span style={{ fontSize: 10, color: 'var(--txt3)', display: 'block' }}>Remaining</span>
                <span style={{ fontSize: 16, fontWeight: 700, fontFamily: "'JetBrains Mono',monospace", color: apiQuota.requestsRemaining < 50 ? 'var(--red)' : apiQuota.requestsRemaining < 200 ? 'var(--gold2)' : 'var(--green)' }}>
                  {apiQuota.requestsRemaining.toLocaleString()}
                </span>
              </div>
            )}
            {apiQuota.requestsLimit !== null && apiQuota.requestsUsed !== null && (
              <div style={{ flex: 1, minWidth: 120 }} title={`${((apiQuota.requestsUsed / apiQuota.requestsLimit) * 100).toFixed(1)}% of monthly quota consumed`}>
                <span style={{ fontSize: 10, color: 'var(--txt3)', display: 'block', marginBottom: 3 }}>Usage</span>
                <div style={{ height: 6, background: 'var(--s3)', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 3, transition: 'width 0.5s',
                    width: `${Math.min(100, (apiQuota.requestsUsed / apiQuota.requestsLimit) * 100)}%`,
                    background: (apiQuota.requestsUsed / apiQuota.requestsLimit) > 0.9 ? 'var(--red)' : (apiQuota.requestsUsed / apiQuota.requestsLimit) > 0.7 ? 'var(--gold2)' : 'var(--green)',
                  }} />
                </div>
              </div>
            )}
          </div>
          {apiQuota.lastUpdated && (
            <span style={{ fontSize: 9, color: 'var(--txt4)', marginLeft: 'auto' }} title="Last time a RapidAPI call was made">
              Last call: {new Date(apiQuota.lastUpdated).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
            </span>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background: 'var(--greendim)',
            border: '1px solid var(--green)',
            color: 'var(--green)',
            padding: '10px 16px',
            borderRadius: 4,
            fontSize: 12,
            zIndex: 9000,
          }}
        >
          {toast}
        </div>
      )}
      {error && (
        <div
          style={{
            background: 'var(--reddim)',
            border: '1px solid var(--red)',
            color: 'var(--red)',
            padding: '10px 14px',
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--br)',
          marginBottom: 12,
          overflowX: 'auto',
        }}
      >
        {(
          [
            ['users', `Users (${users.length})`] as [Tab, string],
            ['interests', `Deal Interests (${interests.length})`] as [Tab, string],
            ['visitors', `Visitor Log (${visitors.length})`] as [Tab, string],
            ['email', `Email Log (${emailLog.length})`] as [Tab, string],
            ...(isAdmin ? [['password', 'Change Admin Password'] as [Tab, string]] : []),
            ['industries', 'Industries'] as [Tab, string],
            ['sources', 'Data Sources'] as [Tab, string],
            ['landing', 'Landing Page'] as [Tab, string],
            // The "Push Data" tab has been folded into Data Sources —
            // per-row and bulk push now live inside the comparison
            // table there. Tab hidden from nav; route kept for
            // backward-compat if anyone has it bookmarked.
          ]
        ).map(([k, lbl]) => {
          const active = tab === k
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: active
                  ? '2px solid var(--gold2)'
                  : '2px solid transparent',
                color: active ? 'var(--gold2)' : 'var(--txt2)',
                padding: '10px 16px',
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                fontFamily: 'inherit',
                whiteSpace: 'nowrap',
              }}
            >
              {lbl}
            </button>
          )
        })}
      </div>

      {/* USERS */}
      {tab === 'users' && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--br)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div>
              <div className="stitle" style={{ margin: 0, border: 'none', padding: 0 }}>
                Registered users
              </div>
              <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
                Toggle login access, delete accounts, or export CSV
              </div>
            </div>
            <button
              onClick={downloadCsv}
              style={{
                background: 'var(--golddim)',
                border: '1px solid var(--gold2)',
                color: 'var(--gold2)',
                padding: '6px 12px',
                fontSize: 11,
                fontWeight: 600,
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              ⬇ Download CSV
            </button>
          </div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th style={thStyle}>ID</th>
                  <th style={thStyle}>Username</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Full name</th>
                  <th style={thStyle}>Phone</th>
                  <th style={thStyle}>Organization</th>
                  <th style={thStyle}>Designation</th>
                  <th style={thStyle}>Official email</th>
                  <th style={thStyle}>Role</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Auth Code</th>
                  <th style={thStyle}>Signup IP</th>
                  <th style={thStyle}>Signup location</th>
                  <th style={thStyle}>Last login IP</th>
                  <th style={thStyle}>Last login location</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Last login</th>
                  <th style={thStyle}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 && (
                  <tr>
                    <td colSpan={17} style={{ ...tdStyle, color: 'var(--txt3)', textAlign: 'center', padding: 18 }}>
                      No users yet.
                    </td>
                  </tr>
                )}
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={tdStyle}>{u.id}</td>
                    <td style={{ ...tdStyle, color: 'var(--gold2)', fontWeight: 600 }}>
                      {u.username}
                    </td>
                    <td style={tdStyle}>{u.email}</td>
                    <td style={tdStyle}>{u.full_name || '—'}</td>
                    <td style={tdStyle}>{u.phone || '—'}</td>
                    <td style={tdStyle}>{u.organization || '—'}</td>
                    <td style={tdStyle}>{u.designation || '—'}</td>
                    <td style={tdStyle}>{u.official_email || '—'}</td>
                    <td style={tdStyle}>
                      <Badge variant={u.role === 'admin' ? 'gold' : u.role === 'subadmin' ? 'purple' : 'gray'}>{u.role}</Badge>
                    </td>
                    <td style={tdStyle}>
                      {u.is_active && (u as unknown as Record<string,unknown>).auth_code_used !== false ? (
                        <Badge variant="green">Active</Badge>
                      ) : u.is_active && (u as unknown as Record<string,unknown>).auth_code_used === false ? (
                        <Badge variant="gold">Approved</Badge>
                      ) : (
                        <Badge variant="red">Pending</Badge>
                      )}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: "'JetBrains Mono',monospace", fontSize: 12, letterSpacing: '2px' }}>
                      {(u as unknown as Record<string,unknown>).auth_code ? String((u as unknown as Record<string,unknown>).auth_code) : '—'}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace' }}>
                      {u.signup_ip || '—'}
                    </td>
                    <td style={tdStyle}>{u.signup_location || '—'}</td>
                    <td style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace' }}>
                      {u.last_login_ip || '—'}
                    </td>
                    <td style={tdStyle}>{u.last_login_location || '—'}</td>
                    <td style={tdStyle}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td style={tdStyle}>
                      {u.last_login ? new Date(u.last_login).toLocaleString('en-IN') : '—'}
                    </td>
                    <td style={{ ...tdStyle, whiteSpace: 'nowrap' }}>
                      {/* Approve — for pending users */}
                      {!u.is_active && u.role !== 'admin' && (
                        <button
                          onClick={() => approveUser(u.id, u.email)}
                          title="Approve user access and send welcome email with authentication code"
                          style={{
                            background: 'var(--golddim)',
                            border: '1px solid var(--gold2)',
                            color: 'var(--gold2)',
                            padding: '3px 8px', fontSize: 10, fontWeight: 700,
                            borderRadius: 3, marginRight: 4, fontFamily: 'inherit',
                            cursor: 'pointer', letterSpacing: '0.3px',
                          }}
                        >
                          ✓ Approve
                        </button>
                      )}
                      {/* Toggle active — admin + subadmin can do this */}
                      <button
                        onClick={() => toggleActive(u.id, u.is_active)}
                        disabled={u.role === 'admin'}
                        style={{
                          background: u.is_active ? 'var(--reddim)' : 'var(--greendim)',
                          border: `1px solid ${u.is_active ? 'var(--red)' : 'var(--green)'}`,
                          color: u.is_active ? 'var(--red)' : 'var(--green)',
                          padding: '3px 8px', fontSize: 10, fontWeight: 600,
                          borderRadius: 3, marginRight: 4, fontFamily: 'inherit',
                          cursor: u.role === 'admin' ? 'not-allowed' : 'pointer',
                          opacity: u.role === 'admin' ? 0.4 : 1,
                        }}
                      >
                        {u.is_active ? 'Restrict' : 'Enable'}
                      </button>
                      {/* Delete — ADMIN ONLY, hidden from subadmins */}
                      {isAdmin && (
                        <button
                          onClick={() => deleteUser(u.id, u.email)}
                          disabled={u.role === 'admin'}
                          style={{
                            background: 'transparent', border: '1px solid var(--red)',
                            color: 'var(--red)', padding: '3px 8px', fontSize: 10,
                            fontWeight: 600, borderRadius: 3, marginRight: 4, fontFamily: 'inherit',
                            cursor: u.role === 'admin' ? 'not-allowed' : 'pointer',
                            opacity: u.role === 'admin' ? 0.4 : 1,
                          }}
                        >
                          Delete
                        </button>
                      )}
                      {/* Promote / Demote — ADMIN ONLY */}
                      {isAdmin && u.role !== 'admin' && (
                        <button
                          onClick={async () => {
                            const newRole = u.role === 'subadmin' ? 'analyst' : 'subadmin'
                            if (!confirm(`${newRole === 'subadmin' ? 'Promote' : 'Demote'} ${u.username} to ${newRole}?`)) return
                            try {
                              const res = await fetch(`/api/admin/users/${u.id}/role`, {
                                method: 'PATCH',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ role: newRole }),
                              })
                              const json = await safeJson(res)
                              if (json.ok) refreshAll()
                              else alert(json.error || 'Failed')
                            } catch { alert('Network error') }
                          }}
                          style={{
                            background: u.role === 'subadmin' ? 'var(--reddim)' : 'var(--cyandim)',
                            border: `1px solid ${u.role === 'subadmin' ? 'var(--red)' : 'var(--cyan2)'}`,
                            color: u.role === 'subadmin' ? 'var(--red)' : 'var(--cyan2)',
                            padding: '3px 8px', fontSize: 10, fontWeight: 600,
                            borderRadius: 3, fontFamily: 'inherit', cursor: 'pointer',
                          }}
                        >
                          {u.role === 'subadmin' ? '↓ Demote' : '↑ Sub-Admin'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* INTERESTS */}
      {tab === 'interests' && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--br)' }}>
            <div className="stitle" style={{ margin: 0, border: 'none', padding: 0 }}>
              Deal interest expressions
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
              Every click of the &quot;Express Interest&quot; button on /maradar or /private
            </div>
          </div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th style={thStyle}>When</th>
                  <th style={thStyle}>User</th>
                  <th style={thStyle}>Email</th>
                  <th style={thStyle}>Phone</th>
                  <th style={thStyle}>Company</th>
                  <th style={thStyle}>Ticker</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Sector</th>
                  <th style={thStyle}>Source</th>
                  <th style={thStyle}>Rationale</th>
                </tr>
              </thead>
              <tbody>
                {interests.length === 0 && (
                  <tr>
                    <td colSpan={10} style={{ ...tdStyle, color: 'var(--txt3)', textAlign: 'center', padding: 18 }}>
                      No deal interests yet.
                    </td>
                  </tr>
                )}
                {interests.map((i) => (
                  <tr key={i.id}>
                    <td style={tdStyle}>
                      {new Date(i.expressed_at).toLocaleString('en-IN')}
                    </td>
                    <td style={tdStyle}>{i.user_name || '—'}</td>
                    <td style={tdStyle}>{i.user_email || '—'}</td>
                    <td style={tdStyle}>{i.user_phone || '—'}</td>
                    <td style={{ ...tdStyle, color: 'var(--gold2)', fontWeight: 600 }}>
                      {i.company_name || '—'}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'JetBrains Mono, monospace' }}>
                      {i.ticker || '—'}
                    </td>
                    <td style={tdStyle}>{i.deal_type || '—'}</td>
                    <td style={tdStyle}>{i.sector || '—'}</td>
                    <td style={tdStyle}>{i.source_page || '—'}</td>
                    <td style={{ ...tdStyle, maxWidth: 280, whiteSpace: 'normal', color: 'var(--txt2)' }}>
                      {i.rationale || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* VISITOR LOG */}
      {tab === 'visitors' && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--br)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div>
              <div className="stitle" style={{ margin: 0, border: 'none', padding: 0 }}>
                Site Visitor Log
              </div>
              <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>
                Every landing-page sample-report submission and customised-access
                request with captured IP, geo-location, and form contact details.
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                value={visitorSearch}
                onChange={(e) => setVisitorSearch(e.target.value)}
                placeholder="Search name / email / firm / IP…"
                style={{
                  background: 'var(--s3)',
                  border: '1px solid var(--br)',
                  color: 'var(--txt)',
                  padding: '6px 10px',
                  borderRadius: 5,
                  fontSize: 12,
                  minWidth: 220,
                  outline: 'none',
                }}
              />
              <select
                value={visitorTypeFilter}
                onChange={(e) => setVisitorTypeFilter(e.target.value as 'all' | 'report' | 'access')}
                style={{
                  background: 'var(--s3)',
                  border: '1px solid var(--br)',
                  color: 'var(--txt)',
                  padding: '6px 10px',
                  borderRadius: 5,
                  fontSize: 12,
                  outline: 'none',
                }}
              >
                <option value="all">All types</option>
                <option value="report">Sample report</option>
                <option value="access">Access request</option>
              </select>
              <button
                onClick={() => {
                  window.location.href = '/api/admin/visitors/csv'
                }}
                style={{
                  background: 'var(--gold2)',
                  color: '#000',
                  border: 'none',
                  padding: '6px 12px',
                  borderRadius: 5,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ⬇ Download CSV
              </button>
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ background: 'var(--s3)', color: 'var(--txt3)' }}>
                  {[
                    'When',
                    'Type',
                    'Name',
                    'Email',
                    'Firm',
                    'Designation',
                    'Phone',
                    'Industry / Stage',
                    'Company',
                    'Purpose',
                    'IP',
                    'Location',
                  ].map((h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: 'left',
                        padding: '8px 10px',
                        borderBottom: '1px solid var(--br)',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const q = visitorSearch.trim().toLowerCase()
                  const filtered = visitors.filter((v) => {
                    if (visitorTypeFilter !== 'all' && v.type !== visitorTypeFilter) return false
                    if (!q) return true
                    const hay = [
                      v.name,
                      v.email,
                      v.organization,
                      v.designation,
                      v.ip,
                      v.location,
                      v.industry_id,
                      v.value_chain_id,
                      v.company_ticker,
                      v.purpose,
                    ]
                      .filter(Boolean)
                      .join(' ')
                      .toLowerCase()
                    return hay.includes(q)
                  })
                  if (filtered.length === 0) {
                    return (
                      <tr>
                        <td
                          colSpan={12}
                          style={{
                            padding: 40,
                            textAlign: 'center',
                            color: 'var(--txt3)',
                            fontSize: 12,
                          }}
                        >
                          {visitors.length === 0
                            ? 'No visitor submissions captured yet.'
                            : 'No visitors match this filter.'}
                        </td>
                      </tr>
                    )
                  }
                  return filtered.map((v) => {
                    const industryStage = [v.industry_id, v.value_chain_id, v.sub_segment_id]
                      .filter(Boolean)
                      .join(' · ')
                    const company =
                      v.company_ticker ||
                      (v.companies_of_interest ? `${v.companies_of_interest.slice(0, 40)}…` : '')
                    const when = v.created_at
                      ? new Date(v.created_at).toLocaleString('en-IN', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })
                      : '—'
                    return (
                      <tr key={v.id} style={{ borderBottom: '1px solid var(--br)' }}>
                        <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', color: 'var(--txt2)' }}>
                          {when}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span
                            style={{
                              background:
                                v.type === 'report' ? 'var(--golddim)' : 'var(--cyandim)',
                              border: `1px solid ${v.type === 'report' ? 'var(--gold2)' : 'var(--cyan2)'}`,
                              color: v.type === 'report' ? 'var(--gold2)' : 'var(--cyan2)',
                              padding: '1px 6px',
                              borderRadius: 3,
                              fontSize: 10,
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              letterSpacing: '0.5px',
                            }}
                          >
                            {v.type === 'report' ? 'Sample' : 'Access'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px', color: 'var(--txt)' }}>{v.name || '—'}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--txt2)' }}>{v.email || '—'}</td>
                        <td style={{ padding: '8px 10px', color: 'var(--txt2)' }}>
                          {v.organization || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: 'var(--txt3)' }}>
                          {v.designation || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: 'var(--txt3)' }}>
                          {v.phone || '—'}
                        </td>
                        <td
                          style={{
                            padding: '8px 10px',
                            color: 'var(--txt3)',
                            maxWidth: 200,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={industryStage || '—'}
                        >
                          {industryStage || '—'}
                        </td>
                        <td
                          style={{
                            padding: '8px 10px',
                            color: 'var(--txt3)',
                            maxWidth: 160,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={company || '—'}
                        >
                          {company || '—'}
                        </td>
                        <td
                          style={{
                            padding: '8px 10px',
                            color: 'var(--txt3)',
                            maxWidth: 220,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={v.purpose || '—'}
                        >
                          {v.purpose || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: 'var(--txt3)', fontFamily: 'JetBrains Mono, monospace' }}>
                          {v.ip || '—'}
                        </td>
                        <td style={{ padding: '8px 10px', color: 'var(--txt3)' }}>
                          {v.location || '—'}
                        </td>
                      </tr>
                    )
                  })
                })()}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EMAIL LOG */}
      {tab === 'email' && (
        <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--br)' }}>
            <div className="stitle" style={{ margin: 0, border: 'none', padding: 0 }}>
              Outbound email log
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
              Admin auth codes, interest alerts, system notifications. If SMTP is not
              configured the messages live here only and are not actually delivered.
            </div>
          </div>

          {/* Test-email dispatcher — verifies Brevo pipeline end-to-end */}
          <div
            style={{
              padding: '12px 14px',
              borderBottom: '1px solid var(--br)',
              background: 'var(--s1)',
            }}
          >
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--gold2)',
                letterSpacing: '0.5px',
                textTransform: 'uppercase',
                marginBottom: 8,
              }}
            >
              Send test welcome email
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 10, lineHeight: 1.5 }}>
              Dispatches the exact welcome email template new users receive on
              approval — with a sample auth code — through Brevo. Use this to
              verify API key, sender verification, and deliverability before
              approving a real signup.
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="email"
                value={testEmailTo}
                onChange={(e) => setTestEmailTo(e.target.value)}
                placeholder="recipient@example.com"
                style={{
                  background: 'var(--s2)',
                  border: '1px solid var(--br)',
                  color: 'var(--txt)',
                  padding: '8px 12px',
                  borderRadius: 4,
                  fontSize: 12,
                  minWidth: 260,
                  fontFamily: 'inherit',
                }}
                disabled={testEmailSending}
              />
              <button
                onClick={sendTestEmail}
                disabled={testEmailSending || !testEmailTo.trim()}
                style={{
                  background: testEmailSending ? 'var(--s3)' : 'var(--gold2)',
                  color: testEmailSending ? 'var(--txt3)' : '#000',
                  border: 'none',
                  padding: '8px 18px',
                  borderRadius: 4,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.4px',
                  textTransform: 'uppercase',
                  cursor: testEmailSending ? 'wait' : 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {testEmailSending ? 'Sending…' : 'Send test email'}
              </button>
            </div>
            {testEmailMsg && (
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  fontSize: 11,
                  lineHeight: 1.5,
                  borderRadius: 4,
                  border: `1px solid ${
                    testEmailMsg.kind === 'success' ? 'var(--green)' : 'var(--red)'
                  }`,
                  background:
                    testEmailMsg.kind === 'success' ? 'var(--greendim)' : 'var(--reddim)',
                  color:
                    testEmailMsg.kind === 'success' ? 'var(--green)' : 'var(--red)',
                }}
              >
                {testEmailMsg.text}
              </div>
            )}
          </div>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {emailLog.length === 0 && (
              <div style={{ color: 'var(--txt3)', fontSize: 12, textAlign: 'center', padding: 18 }}>
                No emails logged yet.
              </div>
            )}
            {emailLog.map((e) => (
              <div
                key={e.id}
                style={{
                  background: 'var(--s1)',
                  border: '1px solid var(--br)',
                  borderLeft: `3px solid ${
                    e.category === 'admin-code'
                      ? 'var(--gold2)'
                      : e.category === 'interest-alert'
                        ? 'var(--cyan2)'
                        : 'var(--txt3)'
                  }`,
                  padding: '12px 14px',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 6,
                    fontSize: 10,
                    color: 'var(--txt3)',
                  }}
                >
                  <span>
                    → {e.to_addr} · {e.category || 'other'}
                  </span>
                  <span>
                    {new Date(e.sent_at).toLocaleString('en-IN')}{' '}
                    {e.delivered ? (
                      <span style={{ color: 'var(--green)' }}>delivered</span>
                    ) : (
                      <span style={{ color: 'var(--orange)' }}>logged</span>
                    )}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: 'var(--txt)',
                    marginBottom: 4,
                  }}
                >
                  {e.subject}
                </div>
                <pre
                  style={{
                    margin: 0,
                    fontSize: 11,
                    color: 'var(--txt2)',
                    fontFamily: 'JetBrains Mono, monospace',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.55,
                  }}
                >
                  {e.body}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PASSWORD CHANGE */}
      {tab === 'password' && (
        <div className="panel">
          <div className="stitle">Change admin password</div>
          <div
            style={{
              background: 'var(--golddim)',
              border: '1px solid var(--gold2)',
              padding: '10px 14px',
              fontSize: 12,
              color: 'var(--txt2)',
              marginBottom: 14,
              lineHeight: 1.6,
            }}
          >
            The admin password can only be changed by the admin and only with a one-time
            auth code. Click <strong>Send auth code</strong> — a 6-character code is
            dispatched to <strong>abhilasharajbordia@gmail.com</strong> (also visible in
            the Email Log tab). Enter the code + new password below to complete the
            change.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 440 }}>
            <button
              onClick={requestCode}
              disabled={pwRequesting}
              style={{
                background: 'var(--gold2)',
                color: '#000',
                border: '1px solid var(--gold2)',
                padding: '10px 16px',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.3px',
                textTransform: 'uppercase',
                borderRadius: 3,
                cursor: pwRequesting ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {pwRequesting ? 'Dispatching…' : 'Send auth code →'}
            </button>
            <label style={{ fontSize: 10, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Auth code
            </label>
            <input
              type="text"
              value={pwCode}
              onChange={(e) => setPwCode(e.target.value.toUpperCase())}
              placeholder="ABCDEF"
              maxLength={6}
              style={inputStyle}
            />
            <label style={{ fontSize: 10, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              New password
            </label>
            <input
              type="password"
              value={pwNew}
              onChange={(e) => setPwNew(e.target.value)}
              style={inputStyle}
            />
            <label style={{ fontSize: 10, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '1px' }}>
              Confirm new password
            </label>
            <input
              type="password"
              value={pwNew2}
              onChange={(e) => setPwNew2(e.target.value)}
              style={inputStyle}
            />
            {pwMsg && (
              <div
                style={{
                  padding: '9px 12px',
                  fontSize: 12,
                  borderRadius: 3,
                  background:
                    pwMsg.kind === 'success'
                      ? 'var(--greendim)'
                      : pwMsg.kind === 'error'
                        ? 'var(--reddim)'
                        : 'var(--cyandim)',
                  border: `1px solid ${
                    pwMsg.kind === 'success'
                      ? 'var(--green)'
                      : pwMsg.kind === 'error'
                        ? 'var(--red)'
                        : 'var(--cyan2)'
                  }`,
                  color:
                    pwMsg.kind === 'success'
                      ? 'var(--green)'
                      : pwMsg.kind === 'error'
                        ? 'var(--red)'
                        : 'var(--cyan2)',
                }}
              >
                {pwMsg.text}
              </div>
            )}
            <button
              onClick={confirmPassword}
              style={{
                background: 'var(--green)',
                color: '#000',
                border: '1px solid var(--green)',
                padding: '10px 16px',
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.3px',
                textTransform: 'uppercase',
                borderRadius: 3,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              Change password →
            </button>
          </div>
        </div>
      )}

      {/* DATA SOURCES */}
      {tab === 'sources' && <DataSourcesTab />}

      {/* PUSH DATA */}
      {tab === 'pushdata' && <PushDataTab />}

      {/* INDUSTRIES */}
      {tab === 'industries' && <IndustriesTab />}

      {/* LANDING PAGE TOGGLES */}
      {tab === 'landing' && <LandingToggleTab />}
    </div>
  )
}

// ── Data Sources tab component ──────────────────────────────

function DataSourcesTab() {
  const {
    tickers: liveTickers,
    nseData: liveNseData,
    screenerAutoData: liveScreenerAuto,
    deriveCompany,
    refreshRapidApi,
    refreshCommodities,
    loading: rapidLoading,
    commodityAsOfDate,
    nseLastRefreshed,
    screenerLastRefreshed,
    nseRefreshing,
    screenerRefreshing,
    missingFields: liveMissingFields,
    patchNseRow,
  } = useLiveSnapshot()
  const { allCompanies, reloadDbCompanies, patchNseBatch } = useLiveSnapshot()
  const [commodityRefreshing, setCommodityRefreshing] = useState(false)
  // Wrap refreshCommodities so we can track a separate loading state
  const handleCommodityRefresh = async () => {
    setCommodityRefreshing(true)
    await refreshCommodities()
    setCommodityRefreshing(false)
  }
  const [screenerData, setScreenerData] = useState<Record<string, ScreenerRow>>({})
  const [screenerRatios, setScreenerRatios] = useState<Record<string, ScreenerRatioRow>>({})
  const [screenerLoading, setScreenerLoading] = useState(false)
  const [screenerError, setScreenerError] = useState<string | null>(null)
  const [screenerTime, setScreenerTime] = useState<string | null>(null)
  // DealNector API (NSE direct) — state lives in `@/lib/admin/exchange-sweep`
  // module scope so a sweep in progress keeps running (and keeps emitting
  // progress) when the admin navigates off this page and back. Local
  // aliases below preserve the original variable names used throughout
  // this file so the render/effect code needs zero further edits.
  const _exchangeSweep = useExchangeSweep()
  const exchangeData = _exchangeSweep.data
  const exchangeLoading = _exchangeSweep.running
  const exchangeProgress = _exchangeSweep.progress
  const exchangeError = _exchangeSweep.error
  const exchangeTime = _exchangeSweep.time
  const setExchangeData = (
    next:
      | Record<string, ExchangeRow>
      | ((prev: Record<string, ExchangeRow>) => Record<string, ExchangeRow>),
  ) => {
    if (typeof next === 'function') {
      // Pass the MODULE snapshot (not the closed-over React render value)
      // so an in-flight batch from a prior render doesn't get its write
      // clobbered by a concurrent per-row update using a stale `prev`.
      // mergeExchangeSweepData is preferred for single-row updates, but
      // this keeps functional setState calls from losing sibling rows.
      const fresh = next(getExchangeSweepSnapshot().data)
      setExchangeSweepData(fresh)
    } else {
      setExchangeSweepData(next)
    }
  }
  const setExchangeLoading = (v: boolean) => patchExchangeSweep({ running: v })
  const setExchangeProgress = (p: typeof _exchangeSweep.progress) => patchExchangeSweep({ progress: p })
  const setExchangeError = (e: string | null) => patchExchangeSweep({ error: e })
  const setExchangeTime = (t: string | null) => patchExchangeSweep({ time: t })
  const [selectedSource, setSelectedSource] = useState<Record<string, 'baseline' | 'rapidapi' | 'screener' | 'exchange'>>({})
  const [publishMsg, setPublishMsg] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  // Discovery state
  const [discoverQuery, setDiscoverQuery] = useState('')
  const [discoverResults, setDiscoverResults] = useState<Array<{ id: number; name: string; code: string; exchange: string; screenerUrl: string }>>([])
  const [discoverLoading, setDiscoverLoading] = useState(false)
  // Per-result sector + comp selections (keyed by result id).
  // `sec` used to be restricted to `'solar' | 'td'` but is now any registered
  // industry id so admins can classify a discovered SME into Wind / Storage /
  // Hydrogen / etc. — previously anything non-core was silently coerced to
  // solar, which is why newly-added non-core SMEs never showed up in the
  // correct industry's Value Chain.
  const [discoverSec, setDiscoverSec] = useState<Record<number, string>>({})
  const [discoverComp, setDiscoverComp] = useState<Record<number, string>>({})
  // Registry of available industries (solar, td, plus whatever admins have
  // added via the Industry Atlas seed / "Add Industry" flow). Drives the
  // sector dropdown in the Discover SME Companies tab.
  const { availableIndustries } = useIndustryFilter()
  // Atlas chain nodes are the segments defined via industry_chain_stages
  // for non-core industries. We merge them with the static CHAIN so the
  // Value Chain dropdown in Discover shows segments for any industry.
  const { atlasChain } = useIndustryAtlas()
  // Build unique segment list from static CHAIN + atlas chain data.
  // For core industries (solar, td) this comes from static CHAIN;
  // for atlas industries (wind, storage, etc.) it comes from atlasChain,
  // which is only populated when those industries are in the current
  // selection. That's fine because admins typically have all industries
  // selected anyway.
  const chainSegments = useMemo(() => {
    const segs: Array<{ id: string; name: string; sec: string }> = []
    const seen = new Set<string>()
    for (const c of CHAIN) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      segs.push({ id: c.id, name: c.name, sec: c.sec })
    }
    for (const c of atlasChain) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      segs.push({ id: c.id, name: c.name, sec: c.sec })
    }
    return segs
  }, [atlasChain])
  // Per-ticker refresh
  const [tickerRefreshing, setTickerRefreshing] = useState<string | null>(null)
  // NSE symbol edit state: which ticker's editor is open + the typed value
  // + per-ticker busy / result / error slots. Keyed by app-internal ticker,
  // not NSE symbol, because the ticker is the stable identity across the
  // static seed and user_companies.
  const [symbolEditTicker, setSymbolEditTicker] = useState<string | null>(null)
  const [symbolInput, setSymbolInput] = useState('')
  const [symbolBusy, setSymbolBusy] = useState(false)
  const [symbolError, setSymbolError] = useState<string | null>(null)
  const [symbolOk, setSymbolOk] = useState<string | null>(null)
  // Classification editor state — mirrors the NSE-symbol editor above
  // but edits the (industry, value-chain) pair instead of the NSE symbol.
  // Used by the per-row ✎ button next to the Industry badge on the
  // Comparison Table so admins can reclassify any company (static seed
  // OR user_companies) into a different industry / segment. Hits
  // /api/admin/update-classification and broadcasts both data-pushed
  // and industry-data-change so Value Chain / Dashboard / Sidebar all
  // update live for the OLD and NEW industries.
  const [classEditTicker, setClassEditTicker] = useState<string | null>(null)
  const [classSec, setClassSec] = useState<string>('solar')
  const [classComp, setClassComp] = useState<string[]>([])
  // Sub-segment multi-select (DealNector VC Taxonomy). One level beneath
  // `classComp` — e.g. a solar_modules company can also be tagged
  // TOPCon / HJT / Bifacial. Persisted to user_companies.subcomp via
  // /api/admin/update-classification. Empty array = "no sub-segments".
  const [classSubcomp, setClassSubcomp] = useState<string[]>([])
  const [classBusy, setClassBusy] = useState(false)
  const [classError, setClassError] = useState<string | null>(null)
  const [classOk, setClassOk] = useState<string | null>(null)

  // Sub-segment bulk upload state (DealNector VC Taxonomy).
  // Admins/subadmins can upload an Excel with two columns — Ticker +
  // Sub-segments — to map hundreds of companies at once instead of
  // clicking ✎ on each row. The panel stays collapsed by default so it
  // doesn't shout on the main Data Sources view; once expanded, the
  // admin picks a file, hits "Upload", and the response summary shows
  // how many rows were updated / seeded / unresolved.
  const [subUploadOpen, setSubUploadOpen] = useState(false)
  const [subUploadBusy, setSubUploadBusy] = useState(false)
  const [subUploadResult, setSubUploadResult] = useState<
    | null
    | {
        summary: { total: number; updated: number; seeded: number; skipped: number; errors: number; unresolvedTokens: number }
        filename?: string
        results?: Array<{ ticker: string; status: string; subcomp: string[]; unresolved?: string[]; error?: string }>
      }
  >(null)
  const [subUploadError, setSubUploadError] = useState<string | null>(null)
  // Sub-tab: 'main' (comparison table) or 'ratios' (working capital table)
  const [subTab, setSubTab] = useState<'main' | 'ratios' | 'discover'>('main')
  // Admin search box — filters the Comparison Table and the Ratios table
  // by ticker / name / sec / value-chain segment. Kept as a single piece
  // of state so both sub-tabs see the same query (switching sub-tabs
  // should not silently drop the filter).
  const [companySearch, setCompanySearch] = useState<string>('')

  // Build comparison rows across the full live universe (static seed ∪
  // user_companies) so admin-added SME tickers also appear in the table
  // — and, critically, so admins can reach the per-row "Edit NSE Symbol"
  // control for rows that only exist in the DB. Previously this iterated
  // COMPANIES directly, which meant discoveries you just inserted were
  // visible in the status bar but not in the table.
  const rows = useMemo(() => {
    return allCompanies.map((baseCo) => {
      const live = liveTickers[baseCo.ticker]
      const derived = deriveCompany(baseCo)
      const screener = screenerData[baseCo.ticker] || null
      const exchange = exchangeData[baseCo.ticker] || null
      const source = selectedSource[baseCo.ticker] || 'baseline'
      return { baseCo, live, derived, screener, exchange, source }
    })
  }, [allCompanies, liveTickers, deriveCompany, screenerData, exchangeData, selectedSource])

  // Apply the admin search box to the comparison-table rows. We match
  // on ticker, name, industry, and any value-chain segment id — so the
  // admin can type "TATA", "solar", "modules", or "TATAPOWER" and get
  // a useful subset without caring which field they're filtering by.
  const filteredRows = useMemo(() => {
    const q = companySearch.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(({ baseCo }) => {
      if (baseCo.ticker.toLowerCase().includes(q)) return true
      if (baseCo.name.toLowerCase().includes(q)) return true
      if ((baseCo.sec || '').toLowerCase().includes(q)) return true
      if (Array.isArray(baseCo.comp) && baseCo.comp.some((s) => s.toLowerCase().includes(q))) return true
      return false
    })
  }, [rows, companySearch])

  // ── Fetch all from Screener ──
  const fetchScreener = async () => {
    setScreenerLoading(true)
    setScreenerError(null)
    try {
      const res = await fetch('/api/admin/scrape-screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await safeJson(res)
      if (!json.ok) { setScreenerError(json.error || 'Failed'); return }
      setScreenerData(json.data || {})
      if (json.ratios) setScreenerRatios(json.ratios)
      setScreenerTime(new Date().toLocaleString('en-IN'))
      try {
        localStorage.setItem('sg4_screener_data', JSON.stringify(json.data))
        localStorage.setItem('sg4_screener_ratios', JSON.stringify(json.ratios || {}))
        localStorage.setItem('sg4_screener_time', new Date().toISOString())
      } catch { /* ignore */ }
    } catch (err) {
      setScreenerError(err instanceof Error ? err.message : 'Network error')
    } finally { setScreenerLoading(false) }
  }

  // ── Per-ticker Screener refresh ──
  const refreshOneTicker = async (ticker: string) => {
    setTickerRefreshing(ticker)
    try {
      const res = await fetch('/api/admin/scrape-screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers: [ticker] }),
      })
      const json = await safeJson(res)
      if (json.ok) {
        if (json.data?.[ticker]) setScreenerData((prev) => ({ ...prev, [ticker]: json.data[ticker] }))
        if (json.ratios?.[ticker]) setScreenerRatios((prev) => ({ ...prev, [ticker]: json.ratios[ticker] }))
      }
    } catch { /* ignore */ }
    finally { setTickerRefreshing(null) }
  }

  // ── NSE symbol edit: test + save ──
  //
  // Posts to /api/admin/update-symbol. With testOnly=true the endpoint
  // just performs a live NSE fetch and returns the preview row without
  // writing anything — used by the "Test" button so admins can verify a
  // symbol is valid before committing. With testOnly omitted the same
  // call also upserts user_companies.nse, after which the NSE refresh
  // uses the corrected symbol on every subsequent tick.
  //
  // On success we patch the provider's nseData so the comparison table
  // reflects the fix instantly — no need to wait for the hourly tick
  // and no full 85-company re-scrape.
  const editSymbol = async (ticker: string, testOnly: boolean) => {
    const candidate = symbolInput.trim().toUpperCase()
    if (!candidate) {
      setSymbolError('Enter a symbol first')
      return
    }
    setSymbolBusy(true)
    setSymbolError(null)
    setSymbolOk(null)
    try {
      const res = await fetch('/api/admin/update-symbol', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, nse: candidate, testOnly }),
      })
      const json = await safeJson(res)
      if (!json.ok) {
        setSymbolError(json.error || 'Failed')
        return
      }
      if (json.row) {
        // Always refresh the admin table's live snapshot when we get a
        // valid fetch back, regardless of whether we persisted. Admin
        // sees the preview numbers from the new symbol for both Test
        // and Save paths — Save also writes to the DB.
        patchNseRow(ticker, json.row)
      }
      if (testOnly) {
        const price = json.row?.lastPrice
        setSymbolOk(`Test OK — NSE returned ₹${price ?? '—'} for "${candidate}". Click Save to persist.`)
      } else {
        setSymbolOk(`Saved. "${ticker}" now maps to "${candidate}" — next auto-refresh will use it.`)
        // After a successful save, fold the DB changes back into
        // allCompanies so the LiveSnapshotProvider's merged universe
        // carries the new nse value (otherwise it keeps the stale
        // static seed value until the user reloads the page).
        await reloadDbCompanies()
        // Close the editor after a save so the success toast stays
        // visible but the inline form collapses back to the pencil icon.
        setTimeout(() => {
          setSymbolEditTicker((curr) => (curr === ticker ? null : curr))
          setSymbolInput('')
        }, 1200)
      }
    } catch (err) {
      setSymbolError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSymbolBusy(false)
    }
  }

  // ── Save industry + value-chain classification ──
  //
  // Called when the admin hits Save in the inline classification editor.
  // POSTs to /api/admin/update-classification which UPDATEs user_companies
  // (seeding from the static seed if the ticker was static-only).
  //
  // On success we broadcast two signals:
  //   - sg4:data-pushed       → LiveSnapshotProvider reloads user_companies
  //     so every mounted page (Dashboard, Value Chain, M&A Radar, Valuation,
  //     Watchlist, Compare, FSA) sees the new sec/comp immediately.
  //   - sg4:industry-data-change for BOTH old and new industries →
  //     useIndustryAtlas refetches bundles so Value Chain clears the
  //     company from the OLD industry and adds it under the NEW one.
  // Without both events, the UI would briefly show the company in both
  // industries until something else kicked a refresh.
  const editClassification = async (ticker: string) => {
    const sec = classSec.trim().toLowerCase()
    if (!sec) {
      setClassError('Pick an industry first')
      return
    }
    // comp can legitimately be empty (company belongs to an industry but
    // isn't tied to a specific value-chain segment) so no validation here.
    setClassBusy(true)
    setClassError(null)
    setClassOk(null)
    try {
      const res = await fetch('/api/admin/update-classification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, sec, comp: classComp, subcomp: classSubcomp }),
      })
      const json = await safeJson(res)
      if (!json.ok) {
        setClassError(json.error || 'Save failed')
        return
      }
      const oldSec: string = typeof json.oldSec === 'string' ? json.oldSec : sec
      const subNote = classSubcomp.length > 0
        ? ` · ${classSubcomp.length} sub-segment${classSubcomp.length > 1 ? 's' : ''}`
        : ''
      setClassOk(
        json.seeded
          ? `Saved — ${ticker} moved to ${sec}${classComp.length > 0 ? ` / ${classComp.join(', ')}` : ''}${subNote} (seeded from baseline).`
          : `Saved — ${ticker} now classified as ${sec}${classComp.length > 0 ? ` / ${classComp.join(', ')}` : ''}${subNote}.`
      )
      // Refresh local snapshot so THIS admin page's comparison row shows
      // the new classification in the NSE column etc.
      await reloadDbCompanies()
      // Broadcast to every other mounted page — same pattern as the
      // Discover flow. Invalidate BOTH industries so the row disappears
      // from its previous Value Chain and shows up under the new one.
      broadcastDataPushed([ticker], 'classification')
      const affected = Array.from(new Set([sec, oldSec].filter(Boolean)))
      broadcastIndustryDataChange(affected)
      // Collapse the editor after a short delay so the success toast
      // remains readable but the form folds back.
      setTimeout(() => {
        setClassEditTicker((curr) => (curr === ticker ? null : curr))
        setClassOk(null)
      }, 1400)
    } catch (err) {
      setClassError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setClassBusy(false)
    }
  }

  // ── Bulk upload: sub-segment mapping Excel ──────────────────────────
  // Admin/subadmin posts an .xlsx/.csv to /api/admin/upload-subcomp-mapping
  // and gets back a per-row summary of updated / seeded / skipped rows.
  // We broadcast `sg4:data-pushed` + `sg4:industry-data-change` on
  // success so every downstream page refetches and filter pickers
  // repopulate without a manual reload.
  const uploadSubcompMapping = async (file: File) => {
    setSubUploadBusy(true)
    setSubUploadError(null)
    setSubUploadResult(null)
    try {
      const form = new FormData()
      form.set('file', file)
      const res = await fetch('/api/admin/upload-subcomp-mapping', {
        method: 'POST',
        body: form,
      })
      const json = await safeJson(res)
      if (!json.ok) {
        setSubUploadError(json.error || 'Upload failed')
        return
      }
      setSubUploadResult({
        summary: json.summary,
        filename: json.filename,
        results: Array.isArray(json.results) ? json.results : [],
      })
      await reloadDbCompanies()
      const changedTickers: string[] = Array.isArray(json.results)
        ? json.results
            .filter((r: { status: string }) => r.status === 'updated' || r.status === 'seeded')
            .map((r: { ticker: string }) => r.ticker)
        : []
      if (changedTickers.length > 0) {
        broadcastDataPushed(changedTickers, 'subcomp-upload')
        // Changes may span many industries — just re-invalidate everything
        // by broadcasting an industry-data-change with no list.
        broadcastIndustryDataChange([])
      }
    } catch (err) {
      setSubUploadError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSubUploadBusy(false)
    }
  }

  // ── Fetch from NSE (DealNector API) ──
  //
  // The server-side sweep takes ~2.8 s per ticker (NSE throttles at
  // ~1 req/sec, plus our retry cushion). Across ~294 pool tickers that
  // adds up to ~13 minutes — well past Vercel's hard 300 s function
  // ceiling. The original empty-body call timed out with HTTP 504
  // FUNCTION_INVOCATION_TIMEOUT.
  //
  // Resilient strategy:
  //   1. Split into batches of 25 tickers (~70 s wall-clock per batch,
  //      safe on every Vercel tier).
  //   2. Per-batch auto-retry: up to 3 attempts with exponential
  //      backoff (2s → 4s → 8s). Handles transient 504s, 429s,
  //      network blips without losing that batch's tickers.
  //   3. Persist incomplete state to localStorage so closing the
  //      tab or reloading mid-sweep doesn't restart from zero — the
  //      admin page checks for a pending sweep on mount and offers
  //      a "Resume sweep (N/M done)" button.
  //   4. At the end, show a completion summary with success /
  //      retry / failure counts so the admin knows exactly what
  //      landed without having to count cells.
  // AbortController lives at module scope so it survives a client-side
  // navigation — closing the admin page no longer orphans the handle
  // that drives the running loop. Read/write via the helpers imported
  // from `@/lib/admin/exchange-sweep`.
  const exchangeAbortRef = {
    get current(): AbortController | null { return getExchangeAbortController() },
    set current(v: AbortController | null) { setExchangeAbortController(v) },
  }
  // Batch size + server-side intra-batch parallelism combine to keep
  // every HTTP call comfortably under Vercel's 60s gateway ceiling:
  //
  //   Per-ticker worst case: ~20s (Screener 2-candidate fallback)
  //   Per-ticker happy path: ~2s  (parallel NSE + Screener)
  //
  //   Server processes tickers with CONCURRENCY=2 inside each batch,
  //   so per-batch time = ceil(CHUNK_SIZE/2) × max_ticker_time
  //
  //   At CHUNK_SIZE=5: 3 sub-chunks × 5s typical = 15s per batch
  //                    3 × 20s worst case         = 60s (at the edge)
  //
  // Previously CHUNK_SIZE was 10 without intra-batch parallelism, so
  // one slow ticker plus a few average ones easily hit 66s → 504.
  // Current combo gives us safe headroom under the gateway on every
  // batch while keeping the sweep's total wall-clock roughly similar
  // (more batches, but each is faster).
  const CHUNK_SIZE = 5
  const MAX_RETRIES_PER_BATCH = 3

  /**
   * Build the publish-data overrides payload for a batch of freshly-
   * fetched ExchangeRows. Mirrors the `source === 'exchange'` branch of
   * `buildOverrideForRow` — NSE primary with Screener/baseline cascade
   * — but operates directly on the batch snapshot rather than the UI
   * rows state (which lags by one render).
   *
   * `screenerMap` and `baselineMap` are precomputed lookups so we don't
   * re-iterate allCompanies per-ticker inside the loop.
   */
  type ScreenerLike = {
    mktcapCr?: number | null; salesCr?: number | null; ebitdaCr?: number | null
    netProfitCr?: number | null; evCr?: number | null; evEbitda?: number | null
    pe?: number | null; pbRatio?: number | null; dbtEq?: number | null
    revgPct?: number | null; ebm?: number | null
  }
  // Per-field source tag — which source the PUBLISHED value came from.
  // 'dealnector' = live NSE sweep (the ExchangeRow), 'screener' = auto
  // screener cron (the ScreenerRow), 'baseline' = static seed + any
  // prior DB override, 'none' = nothing available (field left at 0).
  type FieldSource = 'dealnector' | 'screener' | 'baseline' | 'none'

  /**
   * Compute the SINGLE set of values that will be written to
   * user_companies for a given row, along with the source of each
   * individual field. Shared by buildBatchOverrides (which actually
   * writes the row) and the admin comparison table's PUBLISHED column
   * (which shows the admin exactly what went to the DB). One helper =
   * one cascade rule, so the UI can never disagree with the writer.
   */
  const buildPublishedPreview = (
    ticker: string,
    ex: ExchangeRow | null | undefined,
    sc: ScreenerLike | undefined,
    baseCo: Partial<Company> | undefined
  ): { values: Record<string, number>; sources: Record<string, FieldSource> } => {
    const values: Record<string, number> = {}
    const sources: Record<string, FieldSource> = {}
    // pick(field, exchangeVal, screenerVal, baselineVal) — first non-null wins
    const pick = (field: string, dn: number | null | undefined, scrVal: number | null | undefined, base: number | null | undefined) => {
      if (dn != null && Number.isFinite(dn) && dn !== 0) {
        values[field] = dn; sources[field] = 'dealnector'
      } else if (scrVal != null && Number.isFinite(scrVal) && scrVal !== 0) {
        values[field] = scrVal; sources[field] = 'screener'
      } else if (base != null && Number.isFinite(base) && base !== 0) {
        values[field] = base; sources[field] = 'baseline'
      } else {
        values[field] = 0; sources[field] = 'none'
      }
    }
    pick('mktcap', ex?.mktcapCr,  sc?.mktcapCr,  baseCo?.mktcap)
    pick('rev',    ex?.salesCr,   sc?.salesCr,   baseCo?.rev)
    pick('ebitda', ex?.ebitdaCr,  sc?.ebitdaCr,  baseCo?.ebitda)
    pick('pat',    ex?.patCr,     sc?.netProfitCr, baseCo?.pat)
    pick('ev',     ex?.evCr,      sc?.evCr,      baseCo?.ev)
    pick('ev_eb',  ex?.evEbitda,  sc?.evEbitda,  baseCo?.ev_eb)
    pick('pe',     ex?.pe,        sc?.pe,        baseCo?.pe)
    pick('revg',   ex?.revgPct,   sc?.revgPct,   baseCo?.revg)
    pick('ebm',    ex?.ebm,       sc?.ebm,       baseCo?.ebm)
    void ticker  // reserved for future per-ticker source overrides
    return { values, sources }
  }

  const buildBatchOverrides = (
    batchRows: Record<string, ExchangeRow>,
    screenerMap: Record<string, ScreenerLike | undefined>,
    baselineMap: Record<string, Company>
  ): Record<string, OverridePatch> => {
    const out: Record<string, OverridePatch> = {}
    for (const [ticker, ex] of Object.entries(batchRows)) {
      const sc = screenerMap[ticker]
      const baseCo = baselineMap[ticker]
      const { values: v, sources } = buildPublishedPreview(ticker, ex, sc, baseCo)
      // Skip only when EVERY numeric field would be zero — preserves
      // an existing good DB row when all four sources (exchange +
      // screener + baseline + empty) are empty, rather than writing
      // zeros over it. Previously we gate-kept on rev/ebitda/mktcap;
      // the published-preview helper checks all nine fields.
      const allZero = Object.values(v).every((n) => n === 0)
      if (allZero) continue
      out[ticker] = {
        source: 'exchange',
        mktcap: v.mktcap,
        rev:    v.rev,
        ebitda: v.ebitda,
        pat:    v.pat,
        ev:     v.ev,
        ev_eb:  v.ev_eb,
        pe:     v.pe,
        revg:   v.revg,
        ebm:    v.ebm,
      }
      void sources  // sources are surfaced via the UI helper, not stored here
    }
    return out
  }

  const runExchangeSweep = async (tickers: string[], startingData: Record<string, ExchangeRow> = {}) => {
    if (tickers.length === 0) {
      setExchangeError('No tickers to scrape — pool is empty.')
      return
    }

    // Cancel any previous run still in-flight.
    if (exchangeAbortRef.current) {
      exchangeAbortRef.current.abort()
    }
    const ctl = new AbortController()
    exchangeAbortRef.current = ctl

    setExchangeLoading(true)
    setExchangeError(null)

    const chunks: string[][] = []
    for (let i = 0; i < tickers.length; i += CHUNK_SIZE) {
      chunks.push(tickers.slice(i, i + CHUNK_SIZE))
    }

    const merged: Record<string, ExchangeRow> = { ...startingData }
    let batchesSucceeded = 0
    let batchesRetried = 0
    let dbPublishedCount = 0
    let dbPublishFailed = 0
    const failedTickers: string[] = []

    // Precompute lookups for auto-publish. These never change within a
    // single sweep (allCompanies is a React prop of the admin page),
    // so hoisting the iteration out of the inner loop keeps per-batch
    // work O(batch) instead of O(batch × pool_size).
    const baselineMap: Record<string, Company> = {}
    for (const c of allCompanies) baselineMap[c.ticker] = c
    // Cast into the loose ScreenerLike shape — the real screenerData
    // type has many more fields than buildBatchOverrides reads, and
    // allowing partial keys lets this keep compiling if the scraper
    // output shape evolves.
    const screenerMap: Record<string, ScreenerLike | undefined> = screenerData as unknown as Record<string, ScreenerLike | undefined>

    // Running tallies for the four counters surfaced to the UI.
    // Initialised from `startingData` (so a Resume pick-up doesn't
    // zero-out the sub-counts) and updated per-batch.
    let nseOkCount = 0
    let screenerOkCount = 0
    let dealnectorOkCount = 0
    const countRow = (row: ExchangeRow): { nse: boolean; scr: boolean; dn: boolean } => {
      // NSE-derived = row has the live-spot fields the NSE quote-
      // equity endpoint uniquely carries (lastPrice and a valid
      // changePct, or the issuedSize-derived mktcap). If lastPrice is
      // null, NSE failed for this ticker even if Screener filled in
      // sales.
      const nse = row.lastPrice != null && row.mktcapCr != null
      // Screener-derived = row has the P&L fields that only come from
      // Screener (salesCr, ebitdaCr, revgPct). If all three are null
      // Screener didn't contribute.
      const scr = row.salesCr != null || row.ebitdaCr != null
      // DealNector combined = any of the core comparable fields came
      // through. This is the "row is useful for the comparison table"
      // signal.
      const dn = nse || scr || (row.mktcapCr != null) || (row.patCr != null)
      return { nse, scr, dn }
    }
    // Warm from starting data (for Resume path).
    for (const row of Object.values(merged)) {
      const f = countRow(row)
      if (f.nse) nseOkCount++
      if (f.scr) screenerOkCount++
      if (f.dn) dealnectorOkCount++
    }
    setExchangeProgress({
      done: Object.keys(merged).length,
      total: tickers.length,
      nseOk: nseOkCount,
      screenerOk: screenerOkCount,
      dealnectorOk: dealnectorOkCount,
      dbPublished: 0,
      dbFailed: 0,
    })

    const sleep = (ms: number) => new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms)
      ctl.signal.addEventListener('abort', () => {
        clearTimeout(t)
        resolve()
      }, { once: true })
    })

    try {
      for (let ci = 0; ci < chunks.length; ci++) {
        if (ctl.signal.aborted) break
        const batch = chunks[ci]
        let attempt = 0
        let batchSuccess = false

        while (attempt < MAX_RETRIES_PER_BATCH && !ctl.signal.aborted) {
          attempt++
          try {
            const res = await fetch('/api/admin/scrape-exchange', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tickers: batch }),
              signal: ctl.signal,
            })
            const json = await safeJson(res)
            if (json?.ok && json.data && typeof json.data === 'object') {
              const batchRows = json.data as Record<string, ExchangeRow>
              Object.assign(merged, batchRows)
              batchSuccess = true
              if (attempt > 1) batchesRetried++

              // Push this batch into LiveSnapshotProvider.state.nseData
              // so the status-bar counters ("NSE: 61/521 · 10:36 pm")
              // reflect the manual sweep's progress. Without this call
              // those counters kept showing the stale hourly-cron count
              // even after a full manual refresh completed — which is
              // exactly the "counter shows cache data, not reality"
              // complaint. patchNseBatch also stamps
              // nseLastRefreshed so the timestamp updates live.
              patchNseBatch(batchRows)

              // ── Auto-publish this batch to the DB (user_companies) ──
              //
              // Without this, a ~14-minute sweep would sit entirely in
              // browser memory / localStorage until the admin manually
              // hit "Publish to DB". A tab-close before that button-press
              // meant the whole run was effectively wasted for every
              // other logged-in user. Now every batch persists to the
              // DB the moment it lands, so other admins / the live
              // snapshot provider see the fresh numbers immediately, and
              // a mid-sweep crash only loses un-published batches (and
              // localStorage still has them for Resume to retry).
              //
              // Fire-and-forget: we don't block the next batch on the
              // publish call. A publish failure increments a counter
              // surfaced in the summary so the admin knows to run a
              // manual "Publish" afterwards. The retry loop on the
              // scrape itself handles the important case (data fetched
              // but not persisted); the auto-publish is a convenience
              // layer on top.
              try {
                const overrides = buildBatchOverrides(batchRows, screenerMap, baselineMap)
                if (Object.keys(overrides).length > 0) {
                  const pubRes = await fetch('/api/admin/publish-data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      overrides,
                      source: 'exchange',
                      // deferRevalidate: skip the 14 revalidatePath()
                      // calls on each per-batch publish. With ~12
                      // batches per sweep that saves 12 × (14 × ~100ms)
                      // ≈ 17s of cumulative server time and avoids
                      // tripping Vercel's 60s gateway on slow Neon
                      // connections. The client broadcasts
                      // `sg4:data-pushed` below so other ADMIN tabs
                      // refresh their LiveSnapshotProvider state
                      // anyway; SSR pages will revalidate naturally
                      // on next navigation (or on a cron tick).
                      deferRevalidate: true,
                    }),
                    signal: ctl.signal,
                  })
                  const pubJson = await safeJson(pubRes)
                  if (pubJson?.ok) {
                    dbPublishedCount += Object.keys(overrides).length
                    // Broadcast so other tabs / pages refresh their views
                    // of the live universe without a hard reload.
                    broadcastDataPushed(Object.keys(overrides), 'nse-sweep')
                  } else {
                    dbPublishFailed += Object.keys(overrides).length
                  }
                }
              } catch {
                dbPublishFailed += Object.keys(batchRows).length
              }
              break
            }
            // Server replied with ok=false or malformed — treat as retryable.
            throw new Error(json?.error ? String(json.error) : `HTTP ${res.status}`)
          } catch (err) {
            if ((err as { name?: string })?.name === 'AbortError') break
            const message = (err as Error).message?.slice(0, 160) || 'unknown'
            if (attempt >= MAX_RETRIES_PER_BATCH) {
              // Exhausted retries — bank the tickers for the final
              // summary and move on to the next batch.
              failedTickers.push(...batch)
              setExchangeError(
                `Batch ${ci + 1}/${chunks.length}: ${message} (retried ${attempt - 1}×). Continuing with remaining batches.`
              )
              break
            }
            // Exponential backoff before retry: 2s, 4s, 8s.
            const backoff = 2000 * Math.pow(2, attempt - 1)
            setExchangeError(
              `Batch ${ci + 1}/${chunks.length}: ${message} — retrying in ${Math.round(backoff / 1000)}s (${attempt}/${MAX_RETRIES_PER_BATCH - 1})`
            )
            await sleep(backoff)
            if (ctl.signal.aborted) break
          }
        }
        if (batchSuccess) batchesSucceeded++

        // Persist progress after every batch attempt (success or give-up).
        setExchangeData({ ...merged })
        // Recount per-source coverage from the full merged set. Re-
        // counting (instead of incrementing) means a Resume path or a
        // batch-retry doesn't double-count a ticker that was already
        // seen, and failed batches naturally don't move any counter.
        nseOkCount = 0
        screenerOkCount = 0
        dealnectorOkCount = 0
        for (const row of Object.values(merged)) {
          const f = countRow(row)
          if (f.nse) nseOkCount++
          if (f.scr) screenerOkCount++
          if (f.dn) dealnectorOkCount++
        }
        setExchangeProgress({
          done: Object.keys(merged).length,
          total: tickers.length,
          nseOk: nseOkCount,
          screenerOk: screenerOkCount,
          dealnectorOk: dealnectorOkCount,
          dbPublished: dbPublishedCount,
          dbFailed: dbPublishFailed,
        })
        try {
          localStorage.setItem('sg4_exchange_data', JSON.stringify(merged))
          // Pending-sweep marker so a page reload mid-sweep can resume.
          localStorage.setItem(
            'sg4_exchange_pending',
            JSON.stringify({
              allTickers: tickers,
              completedAt: new Date().toISOString(),
              chunkIndex: ci + 1,
              totalChunks: chunks.length,
            })
          )
        } catch { /* ignore quota */ }
      }

      if (!ctl.signal.aborted) {
        // Sweep finished (successfully or with some failed batches) —
        // record the timestamp and drop the pending marker so we don't
        // keep nagging the admin to "resume" a completed run.
        setExchangeTime(new Date().toLocaleString('en-IN'))
        try {
          localStorage.setItem('sg4_exchange_time', new Date().toISOString())
          localStorage.removeItem('sg4_exchange_pending')
        } catch { /* ignore */ }

        // ── Final bulk-publish pass ──────────────────────────────
        //
        // Per-batch auto-publish above only writes the batches the
        // current sweep FETCHED. When the admin resumed a prior
        // session the bulk of `merged` is loaded from localStorage
        // (prior sweep's data) — those rows were published before,
        // but a prior session that was cancelled mid-run, or a DB
        // reset between sessions, means they might not actually be
        // in user_companies right now.
        //
        // Republishing the full merged set is cheap, idempotent, and
        // eliminates the "I fetched 424 tickers but only 107 landed
        // in the DB" surprise the admin keeps hitting. Chunked at 100
        // with deferRevalidate so the single revalidate call below
        // still flushes every SSR page in one shot.
        try {
          const tickersAll = Object.keys(merged)
          const allOverrides = buildBatchOverrides(merged, screenerMap, baselineMap)
          const overrideTickers = Object.keys(allOverrides)
          void tickersAll
          const PUBLISH_CHUNK = 100
          let finalPublished = 0
          for (let i = 0; i < overrideTickers.length; i += PUBLISH_CHUNK) {
            if (ctl.signal.aborted) break
            const slice = overrideTickers.slice(i, i + PUBLISH_CHUNK)
            const payload: Record<string, OverridePatch> = {}
            for (const t of slice) payload[t] = allOverrides[t]
            try {
              const pubRes = await fetch('/api/admin/publish-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  overrides: payload,
                  source: 'exchange',
                  deferRevalidate: true,
                }),
                signal: ctl.signal,
              })
              const pubJson = await safeJson(pubRes)
              if (pubJson?.ok) {
                finalPublished += slice.length
                broadcastDataPushed(slice, 'nse-sweep-final')
              }
            } catch { /* ignore — the next chunk is independent */ }
          }
          if (finalPublished > 0) {
            dbPublishedCount = Math.max(dbPublishedCount, finalPublished)
            setExchangeProgress({
              done: Object.keys(merged).length,
              total: tickers.length,
              nseOk: nseOkCount,
              screenerOk: screenerOkCount,
              dealnectorOk: dealnectorOkCount,
              dbPublished: dbPublishedCount,
              dbFailed: dbPublishFailed,
            })
          }
        } catch { /* ignore — per-batch publishes already covered the bulk */ }

        // Flush SSR caches in one shot. Every per-batch publish used
        // deferRevalidate=true to skip the 14-path revalidation fan-out
        // (which individually takes ~1-2s and would have pushed each
        // batch past Vercel's 60s gateway ceiling). This final call
        // carries revalidateOnly=true — the server skips all DB work
        // and JUST fires revalidatePath() for every SSR page that
        // depends on user_companies, so /dashboard / /maradar / etc
        // pick up the sweep's accumulated writes on next render.
        fetch('/api/admin/publish-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ revalidateOnly: true }),
        }).catch(() => {})

        // Reload DB-backed company rows so the comparison table shows
        // the freshly-pushed baseline_updated_at / baseline_source
        // audit fields instead of the stale values from before the sweep.
        await reloadDbCompanies().catch(() => {})

        // Final summary — combines fetch + publish outcomes so the
        // admin sees a single clean line instead of guessing whether
        // their data made it to the DB.
        const okCount = Object.keys(merged).length
        const missCount = tickers.length - okCount
        const dbLine = dbPublishFailed > 0
          ? ` · DB: ${dbPublishedCount} pushed, ${dbPublishFailed} publish-failed (run Publish manually to retry)`
          : ` · DB: ${dbPublishedCount} auto-published`
        if (missCount === 0 && failedTickers.length === 0) {
          setExchangeError(
            `Sweep complete: ${okCount}/${tickers.length} tickers fetched${dbLine}.`
          )
        } else if (failedTickers.length > 0) {
          setExchangeError(
            `Sweep complete: ${okCount}/${tickers.length} tickers fetched · ` +
            `${batchesRetried} batches recovered via retry · ` +
            `${failedTickers.length} ticker${failedTickers.length === 1 ? '' : 's'} failed (${failedTickers.slice(0, 3).join(', ')}${failedTickers.length > 3 ? '…' : ''})${dbLine}. ` +
            `Click Refresh to retry missing ones.`
          )
        } else {
          setExchangeError(
            `Sweep complete: ${okCount}/${tickers.length} fetched. Some tickers returned empty (SME / delisted / no NSE filing). ` +
            `${batchesRetried > 0 ? `${batchesRetried} batches recovered via retry.` : ''}${dbLine}`
          )
        }
        void batchesSucceeded
      }
    } finally {
      if (exchangeAbortRef.current === ctl) exchangeAbortRef.current = null
      setExchangeLoading(false)
    }
  }

  const fetchExchange = async (forceFullRefresh = false) => {
    // A sweep is already in flight (possibly started from a prior mount
    // before the admin navigated away and came back). Don't stack a
    // second loop on top — the admin can click Cancel first if they
    // really want to restart.
    if (getExchangeAbortController()) return

    const allTickers = Array.from(
      new Set(allCompanies.map((c) => c.ticker).filter((t): t is string => !!t))
    )

    // Cache-aware sweep. Previously every "Refresh DealNector API"
    // click re-fetched all 521 tickers from scratch, ignoring any
    // work a prior sweep had already done — so aborting mid-sweep
    // and clicking again meant throwing away 20+ minutes of NSE +
    // Screener calls. Now the default behaviour is "resume from
    // cache" — load whatever's in localStorage, filter out tickers
    // already covered, and only fetch the remaining ones.
    //
    // A 24-hour TTL guards against infinitely-stale cache: if the
    // last successful sweep completed more than a day ago, we treat
    // the cache as cold and re-fetch everything. Prevents admins
    // from staring at week-old mktcap numbers after a long weekend.
    // The `forceFullRefresh` flag lets admin bypass the TTL (e.g.
    // after a major NSE corporate action that invalidated every
    // ticker's data).
    const cachedRaw = typeof window !== 'undefined' ? localStorage.getItem('sg4_exchange_data') : null
    const cachedTimeRaw = typeof window !== 'undefined' ? localStorage.getItem('sg4_exchange_time') : null
    const cached: Record<string, ExchangeRow> = (() => {
      if (!cachedRaw) return {}
      try {
        const parsed = JSON.parse(cachedRaw) as Record<string, ExchangeRow>
        // Staleness guard
        if (cachedTimeRaw) {
          const ageMs = Date.now() - new Date(cachedTimeRaw).getTime()
          if (ageMs > 24 * 3600 * 1000) return {} // stale → discard
        }
        return parsed
      } catch { return {} }
    })()

    if (forceFullRefresh) {
      await runExchangeSweep(allTickers, {})
      return
    }

    const missing = allTickers.filter((t) => !cached[t])
    if (missing.length === 0 && Object.keys(cached).length > 0) {
      setExchangeError(
        `All ${allTickers.length} tickers already fetched in this session. Click "⚡ Force Full Refresh" to re-fetch everything.`
      )
      return
    }
    if (missing.length === allTickers.length) {
      // Cold start — no usable cache. Run a full sweep.
      await runExchangeSweep(allTickers, {})
    } else {
      // Warm resume — only fetch the delta, carry forward cached rows.
      setPublishMsg(
        `Resuming sweep — ${Object.keys(cached).length} tickers already cached, fetching remaining ${missing.length}.`
      )
      await runExchangeSweep(missing, cached)
    }
  }

  // Explicit full refresh button — bypasses the cache-aware skip
  // even when cache is still within the 24h TTL.
  const forceFullRefresh = async () => {
    if (typeof window !== 'undefined') {
      if (!confirm(`Force re-fetch all ${allCompanies.length} tickers from NSE + Screener? This discards any cached data and takes ~10-15 min.`)) {
        return
      }
    }
    await fetchExchange(true)
  }

  // Auto-resume — on mount, if a pending-sweep marker is sitting in
  // localStorage the admin can pick up where the previous session
  // stopped. We compute the missing tickers from the cached data set.
  const [pendingSweep, setPendingSweep] = useState<{ missing: string[]; completedAt: string | null; chunkIndex: number; totalChunks: number } | null>(null)
  useEffect(() => {
    try {
      const raw = localStorage.getItem('sg4_exchange_pending')
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        allTickers?: string[]
        completedAt?: string
        chunkIndex?: number
        totalChunks?: number
      }
      if (!Array.isArray(parsed.allTickers) || parsed.allTickers.length === 0) {
        localStorage.removeItem('sg4_exchange_pending')
        return
      }
      const cachedRaw = localStorage.getItem('sg4_exchange_data')
      const cached = cachedRaw ? (JSON.parse(cachedRaw) as Record<string, unknown>) : {}
      const missing = parsed.allTickers.filter((t) => !cached[t])
      if (missing.length === 0) {
        localStorage.removeItem('sg4_exchange_pending')
        return
      }
      setPendingSweep({
        missing,
        completedAt: parsed.completedAt || null,
        chunkIndex: parsed.chunkIndex || 0,
        totalChunks: parsed.totalChunks || 0,
      })
    } catch { /* ignore */ }
  }, [])

  const resumeExchangeFetch = async () => {
    if (!pendingSweep) return
    const cachedRaw = localStorage.getItem('sg4_exchange_data')
    const cached = cachedRaw ? (JSON.parse(cachedRaw) as Record<string, ExchangeRow>) : {}
    setPendingSweep(null)
    await runExchangeSweep(pendingSweep.missing, cached)
  }

  const dismissPendingSweep = () => {
    setPendingSweep(null)
    try { localStorage.removeItem('sg4_exchange_pending') } catch { /* ignore */ }
  }

  const cancelExchangeFetch = () => {
    cancelExchangeSweep()
  }

  // ── Fetch Missing Financials ──────────────────────────────────
  //
  // Targeted sweep that only touches tickers with no financial
  // baseline in user_companies and haven't yet hit the per-ticker
  // retry cap (see /api/admin/fetch-missing). Feeds the list straight
  // into runExchangeSweep so behaviour is identical to the regular
  // "Refresh DealNector API" — module-scope AbortController, per-batch
  // auto-publish, survives navigation. Admin can keep working in other
  // tabs while it runs in the background.
  interface MissingSummary {
    missing: number
    exhausted: number
    filled: number
    total: number
    maxAttempts: number
    nseToday: number
    screenerToday: number
  }
  const [missingSummary, setMissingSummary] = useState<MissingSummary | null>(null)
  const loadMissingSummary = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/fetch-missing', { cache: 'no-store' })
      const j = await r.json()
      if (j?.ok) {
        setMissingSummary({
          missing: Array.isArray(j.missing) ? j.missing.length : 0,
          exhausted: Array.isArray(j.exhausted) ? j.exhausted.length : 0,
          filled: Number(j.filled) || 0,
          total: Number(j.total) || 0,
          maxAttempts: Number(j.maxAttempts) || 3,
          nseToday: Number(j?.budget?.nse) || 0,
          screenerToday: Number(j?.budget?.screener) || 0,
        })
      }
    } catch { /* ignore — summary refreshes on next success */ }
  }, [])
  useEffect(() => { void loadMissingSummary() }, [loadMissingSummary])
  // Refresh summary whenever a sweep completes (loading flips true → false)
  // so the "N missing" count reflects just-published rows.
  const exchangeLoadingRef = useRef(exchangeLoading)
  useEffect(() => {
    if (exchangeLoadingRef.current && !exchangeLoading) {
      void loadMissingSummary()
    }
    exchangeLoadingRef.current = exchangeLoading
  }, [exchangeLoading, loadMissingSummary])

  const fetchMissingFinancials = async () => {
    // Same guard as fetchExchange — avoid stacking a second sweep on
    // top of a running one.
    if (getExchangeAbortController()) return
    // Daily budget guard — hard stop if today's scrape quota is nearly
    // exhausted. Thresholds match typical free-tier limits with headroom.
    const NSE_DAILY_MAX = 5000
    const SCREENER_DAILY_MAX = 2000
    if ((missingSummary?.nseToday || 0) >= NSE_DAILY_MAX) {
      setExchangeError(`Daily NSE call budget reached (${NSE_DAILY_MAX}). Retry tomorrow or raise the cap.`)
      return
    }
    if ((missingSummary?.screenerToday || 0) >= SCREENER_DAILY_MAX) {
      setExchangeError(`Daily Screener call budget reached (${SCREENER_DAILY_MAX}). Retry tomorrow or raise the cap.`)
      return
    }
    let tickers: string[] = []
    try {
      const r = await fetch('/api/admin/fetch-missing', { cache: 'no-store' })
      const j = await r.json()
      if (!j?.ok || !Array.isArray(j.missing)) {
        setExchangeError('Could not load missing ticker list.')
        return
      }
      tickers = j.missing
    } catch {
      setExchangeError('Could not load missing ticker list.')
      return
    }
    if (tickers.length === 0) {
      setExchangeError('Every ticker in the universe already has financials — nothing to fetch.')
      return
    }
    // Reuse the ambient exchangeData as startingData so the cached rows
    // remain visible alongside the new ones. runExchangeSweep handles
    // the rest: chunking, retries, per-batch auto-publish, bulk final
    // publish, and progress events that survive page navigation.
    await runExchangeSweep(tickers, exchangeData)
  }

  // ── Parse-time anomaly log (Phase 2) ─────────────────────────
  //
  // Shows the last 200 validator failures (unit mismatch, header
  // drift, inverted columns, implausible numbers). These rows were
  // BLOCKED from reaching user_companies — the admin sees them here
  // as a "go fix the parser" signal instead of as silently corrupted
  // data on the main site.
  interface AnomalyRow {
    id: number
    ticker: string
    source: string
    check: string
    field: string | null
    raw: string | null
    expected: string | null
    detail: string | null
    detectedAt: string | null
  }
  const [anomalies, setAnomalies] = useState<AnomalyRow[]>([])
  const loadAnomalies = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/anomalies', { cache: 'no-store' })
      const j = await r.json()
      if (j?.ok && Array.isArray(j.anomalies)) setAnomalies(j.anomalies as AnomalyRow[])
    } catch { /* ignore */ }
  }, [])
  useEffect(() => { void loadAnomalies() }, [loadAnomalies])
  // Re-poll whenever a sweep just finished (same trigger as the missing
  // summary) so freshly-logged anomalies appear without a manual reload.
  useEffect(() => {
    if (exchangeLoadingRef.current === false) return
    if (exchangeLoading) return
    void loadAnomalies()
  }, [exchangeLoading, loadAnomalies])

  // Manual escape hatch — push every row currently in the exchangeData
  // cache straight to user_companies without re-fetching NSE. Useful
  // when a sweep was cancelled, when the per-batch auto-publish silently
  // skipped some rows, or when the admin wants to force-republish after
  // a DB reset. Chunked at 100 to stay under the 60s gateway ceiling.
  const [publishingCached, setPublishingCached] = useState(false)
  const publishCachedExchange = async () => {
    const tickers = Object.keys(exchangeData)
    if (tickers.length === 0) {
      setPublishMsg('No cached DealNector data to publish — run Refresh first.')
      return
    }
    setPublishingCached(true)
    setPublishMsg(null)
    try {
      const baselineMap: Record<string, Company> = {}
      for (const c of allCompanies) baselineMap[c.ticker] = c
      const screenerMap = screenerData as unknown as Record<string, ScreenerLike | undefined>
      const allOverrides = buildBatchOverrides(exchangeData, screenerMap, baselineMap)
      const overrideTickers = Object.keys(allOverrides)
      if (overrideTickers.length === 0) {
        setPublishMsg('Cached rows had no publishable fields — every ticker was empty.')
        setPublishingCached(false)
        return
      }
      const CHUNK = 100
      let published = 0
      let failed = 0
      for (let i = 0; i < overrideTickers.length; i += CHUNK) {
        const slice = overrideTickers.slice(i, i + CHUNK)
        const payload: Record<string, OverridePatch> = {}
        for (const t of slice) payload[t] = allOverrides[t]
        try {
          const pubRes = await fetch('/api/admin/publish-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              overrides: payload,
              source: 'exchange',
              deferRevalidate: true,
            }),
          })
          const pubJson = await safeJson(pubRes)
          if (pubJson?.ok) {
            published += slice.length
            broadcastDataPushed(slice, 'nse-cached-republish')
          } else {
            failed += slice.length
          }
        } catch {
          failed += slice.length
        }
      }
      // Revalidate all SSR pages in one shot.
      fetch('/api/admin/publish-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revalidateOnly: true }),
      }).catch(() => {})
      await reloadDbCompanies().catch(() => {})
      setPublishMsg(
        failed > 0
          ? `✓ Published ${published}/${overrideTickers.length} cached tickers · ${failed} failed`
          : `✓ Published all ${published} cached tickers to DB.`,
      )
    } finally {
      setPublishingCached(false)
    }
  }

  // ── Hydrate cached on mount ──
  useEffect(() => {
    try {
      const cached = localStorage.getItem('sg4_screener_data')
      const cachedRatios = localStorage.getItem('sg4_screener_ratios')
      const cachedTime = localStorage.getItem('sg4_screener_time')
      if (cached) setScreenerData(JSON.parse(cached))
      if (cachedRatios) setScreenerRatios(JSON.parse(cachedRatios))
      if (cachedTime) setScreenerTime(new Date(cachedTime).toLocaleString('en-IN'))
      // Skip exchangeData/time hydration here — the sweep module
      // hydrates itself from the same localStorage keys on module load,
      // and overwriting its snapshot during a running sweep would erase
      // fresh batches. If no sweep has ever run the module snapshot is
      // already the cached data, so this page still sees it.
    } catch { /* ignore */ }
  }, [])

  // ── Discovery ──
  const [discoverError, setDiscoverError] = useState<string | null>(null)

  const handleDiscover = async () => {
    const q = discoverQuery.trim()
    if (!q || q.length < 2) return
    setDiscoverLoading(true)
    setDiscoverError(null)
    setDiscoverResults([])

    // Screener search treats multi-word as AND (all must match).
    // Split into individual words and search each, then dedupe.
    const words = q.split(/\s+/).filter((w) => w.length >= 2)
    const queries = words.length > 1 ? words : [q]

    try {
      const allResults: typeof discoverResults = []
      const seenIds = new Set<number>()

      for (const word of queries) {
        const res = await fetch(`/api/admin/discover-companies?q=${encodeURIComponent(word)}&limit=20`)
        const json = await safeJson(res)
        if (json.ok && Array.isArray(json.results)) {
          for (const r of json.results) {
            if (!seenIds.has(r.id)) {
              seenIds.add(r.id)
              allResults.push(r)
            }
          }
        } else if (!json.ok) {
          setDiscoverError(json.error || 'Search failed')
        }
      }

      setDiscoverResults(allResults)
      if (allResults.length === 0 && !discoverError) {
        setDiscoverError(`No companies found for "${q}". Try a shorter or different keyword.`)
      }
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setDiscoverLoading(false)
    }
  }

  // Track which companies were added this session
  const [addedTickers, setAddedTickers] = useState<Set<string>>(new Set())
  // Per-row loading state for the Add button
  const [addingCode, setAddingCode] = useState<string | null>(null)

  const addDiscoveredCompany = async (name: string, code: string, resultId: number) => {
    const sec = discoverSec[resultId] || 'solar'
    const selectedComp = discoverComp[resultId] || ''
    const compArr = selectedComp ? [selectedComp] : []

    setAddingCode(code) // Show loading on THIS row's button

    try {
      // Step 1: Scrape from Screener to get baseline financials.
      // The Screener URL uses the code directly: /company/<code>/
      // Some codes come with /consolidated/ suffix from discovery —
      // the scraper handles both.
      console.log(`[discover] Scraping ${code} from Screener...`)
      const res = await fetch('/api/admin/scrape-screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codes: [{ ticker: code, code, name }] }),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        alert(`Screener scrape failed (HTTP ${res.status}).\n${errText.slice(0, 200)}`)
        setAddingCode(null)
        return
      }

      const json = await safeJson(res)
      console.log(`[discover] Scrape response:`, json)

      // Look up the result — try exact key first, then any first value
      const screener = (json.data?.[code] || (json.data ? Object.values(json.data)[0] : null)) as ScreenerRow | undefined

      if (!screener || !screener.mktcapCr) {
        // Screener didn't return usable data — add with zero financials
        // so the company is at least in the DB and admin can fill later
        console.warn(`[discover] No screener data for ${code}, adding with baseline zeros`)
        const pubRes = await fetch('/api/admin/publish-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            newCompanies: [{
              name, ticker: code, nse: code, sec, comp: compArr,
              mktcap: 0, rev: 0, ebitda: 0, pat: 0, ev: 0, ev_eb: 0,
              pe: 0, pb: 0, dbt_eq: 0, revg: 0, ebm: 0,
              acqs: 5, acqf: 'MONITOR',
              rea: `Added from Screener.in discovery. Financials pending. Sector: ${sec}.`,
            }],
          }),
        })
        const pubJson = await safeJson(pubRes)
        if (pubJson.ok) {
          if (pubJson.skipped?.length > 0) {
            alert(`⚠ ${name} was NOT added — duplicate detected:\n\n${pubJson.skipped.join('\n')}`)
          } else {
            setAddedTickers((prev) => { const next = new Set(Array.from(prev)); next.add(code); return next })
            reloadDbCompanies()
            broadcastDataPushed([code], 'discovery')
            alert(`✓ Added ${name} (${code}) with baseline zeros.\n\nFinancials were not available from Screener — use the Comparison Table to refresh data.`)
          }
        } else {
          alert(`✗ Publish failed: ${pubJson.error}`)
        }
        setAddingCode(null)
        return
      }

      // Step 2: Publish with scraped financials
      const pubRes = await fetch('/api/admin/publish-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newCompanies: [{
            name, ticker: code, nse: code, sec, comp: compArr,
            mktcap: screener.mktcapCr ?? 0,
            rev: screener.salesCr ?? 0,
            ebitda: screener.ebitdaCr ?? 0,
            pat: screener.netProfitCr ?? 0,
            ev: screener.evCr ?? 0,
            ev_eb: screener.evEbitda ?? 0,
            pe: screener.pe ?? 0,
            pb: screener.pbRatio ?? 0,
            dbt_eq: screener.dbtEq ?? 0,
            // revg derived live from the last two P&L columns by the
            // Screener parser (see deriveScreenerRow). Zero is a safe
            // fallback when the prior-year column is missing (common
            // for newly-listed SME rows on Screener).
            revg: screener.revgPct ?? 0, ebm: screener.ebm ?? 0,
            acqs: 5, acqf: 'MONITOR',
            rea: `Discovered via Screener.in. Sector: ${sec}. Segment: ${selectedComp || 'unclassified'}.`,
          }],
        }),
      })
      const pubJson = await safeJson(pubRes)
      if (pubJson.ok) {
        if (pubJson.skipped?.length > 0) {
          alert(`⚠ ${name} was NOT added — duplicate detected:\n\n${pubJson.skipped.join('\n')}`)
        } else {
          setAddedTickers((prev) => { const next = new Set(Array.from(prev)); next.add(code); return next })
          reloadDbCompanies()
          broadcastDataPushed([code], 'discovery')
          // If this SME's sector is an atlas industry (e.g. wind / hydrogen
          // / storage rather than the hardcoded solar/td seed), invalidate
          // its bundle so Value Chain shows it under the chosen segment.
          broadcastIndustryDataChange([sec])
          alert(`✓ Added ${name} (${code}) as ${sec.toUpperCase()} / ${selectedComp || 'unclassified'}.\n\nMkt Cap: ₹${(screener.mktcapCr ?? 0).toLocaleString('en-IN')} Cr\nRevenue: ₹${(screener.salesCr ?? 0).toLocaleString('en-IN')} Cr\nP/E: ${screener.pe ?? '—'}\n\nThe company is now live across all pages.`)
        }
      } else {
        alert(`✗ Publish failed: ${pubJson.error}`)
      }
    } catch (err) {
      console.error('[discover] Add failed:', err)
      alert(`Failed to add ${name}: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setAddingCode(null)
    }
  }

  const setBulkSource = (src: 'baseline' | 'rapidapi' | 'screener' | 'exchange') => {
    const bulk: Record<string, 'baseline' | 'rapidapi' | 'screener' | 'exchange'> = {}
    // Flip EVERY row in the live universe (static seed ∪ user_companies),
    // not just static COMPANIES — admin-added SME tickers need their
    // dropdowns to follow the bulk selection too, otherwise "All Baseline"
    // skips exactly the rows where baseline seeding is most useful.
    for (const co of allCompanies) bulk[co.ticker] = src
    setSelectedSource(bulk)
  }

  // Build the override payload for a single ticker row given the selected source.
  // Keyed by the 'source' field on the row (not `Company`'s Partial).
  // Returns null when the picked source has no data yet (e.g., Screener /
  // DealNector not refreshed yet). "Baseline" is always pushable —
  // pushing baseline writes baseCo's current values back into
  // user_companies with source='manual', which is the natural way to
  // seed a static-only ticker into the DB (so audit timestamps exist and
  // auto-refresh schedulers find it) or to reset a DB row back to seed.
  type BaselineSource = 'exchange' | 'screener' | 'rapidapi' | 'manual'
  interface OverridePatch extends Partial<Company> { source?: BaselineSource }
  function buildOverrideForRow(row: typeof rows[number]): OverridePatch | null {
    const { baseCo, derived, screener, exchange, source } = row
    if (source === 'baseline') {
      // Push baseCo's already-merged values (DB row if any, else static seed)
      // back into user_companies as source='manual'. Covers two use cases:
      //   1. Seeding a static-only ticker into the DB for the first time.
      //   2. "Reset to baseline" — overwriting a prior Screener/NSE push
      //      with the hand-curated seed values.
      // We send the full financial vector so recomputeAcqScore on the
      // server produces a fresh acqs reflecting any seed edits since
      // the last push.
      return {
        source: 'manual',
        mktcap: baseCo.mktcap, rev: baseCo.rev, ebitda: baseCo.ebitda, pat: baseCo.pat,
        ev: baseCo.ev, ev_eb: baseCo.ev_eb, pe: baseCo.pe, pb: baseCo.pb,
        dbt_eq: baseCo.dbt_eq, revg: baseCo.revg, ebm: baseCo.ebm,
      }
    }
    if (source === 'rapidapi') {
      const co = derived.company
      return {
        source: 'rapidapi',
        mktcap: co.mktcap, rev: co.rev, ebitda: co.ebitda, pat: co.pat,
        ev: co.ev, ev_eb: co.ev_eb, pe: co.pe, pb: co.pb,
        dbt_eq: co.dbt_eq, ebm: co.ebm,
      }
    }
    if (source === 'screener' && screener) {
      return {
        source: 'screener',
        mktcap: screener.mktcapCr ?? baseCo.mktcap,
        rev: screener.salesCr ?? baseCo.rev,
        ebitda: screener.ebitdaCr ?? baseCo.ebitda,
        pat: screener.netProfitCr ?? baseCo.pat,
        ev: screener.evCr ?? baseCo.ev,
        ev_eb: screener.evEbitda ?? baseCo.ev_eb,
        pe: screener.pe ?? baseCo.pe,
        pb: screener.pbRatio ?? baseCo.pb,
        dbt_eq: screener.dbtEq ?? baseCo.dbt_eq,
        // revg (revenue growth %) is derived from the last two P&L
        // columns by the screener-fetch parser. Fall back to the baseline
        // seed only when the derivation failed (missing / non-positive
        // prev-year) — otherwise the acqs recompute on the server would
        // score the push with the hand-curated value instead of live
        // data, which was the silent bug before this line existed.
        revg: screener.revgPct ?? baseCo.revg,
        ebm: screener.ebm ?? baseCo.ebm,
      }
    }
    if (source === 'exchange') {
      // DealNector pipeline cascades exchange → screener → baseline
      // per field. Previously we required exchange!==null to emit the
      // override at all, which meant "Push All from DealNector" only
      // published the subset of tickers the most recent NSE sweep had
      // reached — surfacing as "66 updated" when the user expected
      // hundreds. Now we emit the override as long as AT LEAST ONE
      // source has data for each field; tickers with nothing in any
      // source still skip. This lets a partial sweep still push live
      // values to the DB for the tickers it covered, while tickers
      // the sweep hasn't touched yet get seeded from their curated
      // COMPANIES[] baseline (better than leaving them as ₹0 in the DB).
      const ex = exchange
      const sc = screener
      const mktcap = ex?.mktcapCr ?? sc?.mktcapCr ?? baseCo.mktcap ?? 0
      const rev    = ex?.salesCr   ?? sc?.salesCr   ?? baseCo.rev    ?? 0
      const ebitda = ex?.ebitdaCr  ?? sc?.ebitdaCr  ?? baseCo.ebitda ?? 0
      // Skip only when absolutely nothing is known — same guard
      // buildBatchOverrides uses so we never write a row of pure zeros
      // that would overwrite a good existing DB value with nothing.
      if (mktcap === 0 && rev === 0 && ebitda === 0) return null
      return {
        source: 'exchange',
        mktcap,
        rev,
        ebitda,
        pat:    ex?.patCr     ?? sc?.netProfitCr ?? baseCo.pat   ?? 0,
        ev:     ex?.evCr      ?? sc?.evCr        ?? baseCo.ev    ?? 0,
        ev_eb:  ex?.evEbitda  ?? sc?.evEbitda    ?? baseCo.ev_eb ?? 0,
        pe:     ex?.pe        ?? sc?.pe          ?? baseCo.pe    ?? 0,
        revg:   ex?.revgPct   ?? sc?.revgPct     ?? baseCo.revg  ?? 0,
        ebm:    ex?.ebm       ?? sc?.ebm         ?? baseCo.ebm   ?? 0,
      }
    }
    return null
  }

  const handlePublish = async () => {
    setPublishing(true)
    setPublishMsg(null)
    const overrides: Record<string, OverridePatch> = {}
    for (const row of rows) {
      const patch = buildOverrideForRow(row)
      if (patch) overrides[row.baseCo.ticker] = patch
    }
    if (Object.keys(overrides).length === 0) {
      setPublishMsg('Nothing to publish — check that the rows you selected actually have data in their chosen source.')
      setPublishing(false); return
    }
    try {
      const res = await fetch('/api/admin/publish-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      })
      const json = await safeJson(res)
      if (json.ok) {
        setPublishMsg(`✓ ${json.message || 'Published.'}`)
        // Reload DB rows so the comparison table picks up the new
        // baseline_updated_at / baseline_source audit fields.
        await reloadDbCompanies()
        broadcastDataPushed(Object.keys(overrides))
      } else {
        setPublishMsg(`✗ ${json.error}`)
      }
    } catch (err) {
      setPublishMsg(`✗ ${err instanceof Error ? err.message : 'Network error'}`)
    } finally { setPublishing(false) }
  }

  // Bulk-push helper: apply a single source to EVERY ticker that has
  // data in that source, then publish. Saves admin 86 clicks vs. the
  // per-row dropdown. Use "⇧ Push All from Screener" / NSE / DealNector /
  // Baseline. Baseline means "seed the hand-curated COMPANIES[] values
  // (or whatever the DB currently holds) into user_companies as
  // source='manual'" — useful for first-time DB seeding or wholesale
  // reset after a bad live refresh.
  const handleBulkPush = async (src: 'rapidapi' | 'screener' | 'exchange' | 'baseline') => {
    setPublishing(true)
    setPublishMsg(null)
    // First flip every row to the chosen source (for the visual indicator)
    setBulkSource(src)

    // "Push All from DealNector" auto-triggers the sweep when exchange
    // coverage is low. Previously the button only re-published what
    // was already in memory — for a fresh admin session with no cached
    // exchange data, that meant only the curated COMPANIES[] baseline
    // (~86 tickers) got pushed. Users kept seeing "87 updated" and
    // expected hundreds.
    //
    // Threshold: if exchangeData covers < 50% of the universe, run the
    // full sweep first. The sweep itself auto-publishes per batch, so
    // by the time it finishes there's nothing left to bulk-push — the
    // bulk push becomes effectively a "finalise / revalidate" step.
    if (src === 'exchange') {
      const covered = Object.keys(exchangeData).length
      const total = allCompanies.length
      if (covered < total * 0.5) {
        setPublishMsg(
          `Only ${covered}/${total} tickers have fresh DealNector data cached. Running the full NSE + Screener sweep first — this publishes every batch as it lands (~10-15 min). You can keep working in other tabs.`
        )
        setPublishing(false)
        // fetchExchange is the full-universe sweep. It auto-publishes
        // per batch AND broadcasts sg4:data-pushed after every chunk,
        // so /dashboard / /reports / /valuation refresh live as the
        // sweep progresses.
        await fetchExchange()
        return
      }
    }

    // Build overrides using the just-picked source directly (don't wait
    // for state — the comparison rows are still usable this render).
    const overrides: Record<string, OverridePatch> = {}
    for (const row of rows) {
      const rowWithSource = { ...row, source: src as typeof row.source }
      const patch = buildOverrideForRow(rowWithSource)
      if (patch) overrides[row.baseCo.ticker] = patch
    }
    if (Object.keys(overrides).length === 0) {
      setPublishMsg(`No data in ${src} — refresh that source first.`)
      setPublishing(false); return
    }
    // Server's BaselineSource enum is 'exchange'|'screener'|'rapidapi'|'manual'
    // — the UI's 'baseline' choice maps to 'manual' for audit stamping.
    const apiSource: BaselineSource = src === 'baseline' ? 'manual' : src
    try {
      const res = await fetch('/api/admin/publish-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides, source: apiSource }),
      })
      const json = await safeJson(res)
      if (json.ok) {
        setPublishMsg(`✓ ${json.message || 'Published.'}`)
        await reloadDbCompanies()
        broadcastDataPushed(Object.keys(overrides), src)
      } else {
        setPublishMsg(`✗ ${json.error}`)
      }
    } catch (err) {
      setPublishMsg(`✗ ${err instanceof Error ? err.message : 'Network error'}`)
    } finally { setPublishing(false) }
  }

  // Escape hatch: delete every user_companies row that has a hand-curated
  // static seed counterpart, so the LiveSnapshotProvider merge falls back
  // to the curated numbers. Useful when a bad Screener / NSE push poisoned
  // the DB (e.g. Premier Energies writing salesCr=658 when the real TTM is
  // 7,215 Cr because the parser was mis-reading a Sales& label). Admin-added
  // SME / Atlas rows (no static seed) are left untouched — nuking them
  // would orphan the company from the universe entirely.
  const handleResetToSeed = async () => {
    if (!confirm(
      'Reset DB override rows to the hand-curated baseline?\n\n' +
      'This deletes every user_companies row that has a static seed counterpart ' +
      'in COMPANIES[], so the curated numbers resurface on the dashboard. ' +
      'Admin-added SME / Atlas rows (no seed) are left alone.\n\n' +
      'Use this to recover from a bad push that poisoned live data. You can ' +
      're-push Screener / NSE / Exchange data on top after the reset.'
    )) return
    setPublishing(true)
    setPublishMsg(null)
    try {
      const res = await fetch('/api/admin/reset-to-seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await safeJson(res)
      if (json.ok) {
        setPublishMsg(`✓ ${json.message}`)
        await reloadDbCompanies()
        // Notify every mounted snapshot consumer that these tickers now
        // resolve through the static seed again, not the (deleted) DB row.
        broadcastDataPushed(json.deletedTickers || [], 'reset')
      } else {
        setPublishMsg(`✗ ${json.error}`)
      }
    } catch (err) {
      setPublishMsg(`✗ ${err instanceof Error ? err.message : 'Network error'}`)
    } finally { setPublishing(false) }
  }

  // Free-source qualitative sweep: fetch Annual Report PDF links, credit-
  // rating doc links, and shareholding % breakdown from Screener's public
  // HTML for every ticker in the 294-company pool. Populates ar_url,
  // ar_year, ar_fetched_at, credit_rating, shareholding columns — the
  // paid/PDF-parsing-heavy columns (ar_parsed, mda_extract, facilities,
  // customers, nclt_cases) stay null by design. See
  // `/api/admin/fetch-qualitative/route.ts` for the full omission rationale.
  const handleFetchQualitative = async () => {
    if (!confirm(
      'Fetch Annual Reports + Credit Ratings + Shareholding from Screener?\n\n' +
      'This sweeps every eligible ticker in the live universe (~294 rows) ' +
      'via free Screener.in HTML scraping — no paid APIs. ' +
      'Takes ~4 minutes due to 800ms rate limiting.\n\n' +
      'Populates ar_url / ar_year / credit_rating / shareholding JSONB columns. ' +
      'Paid-only columns (ar_parsed, mda_extract, etc.) stay null.'
    )) return
    setPublishing(true)
    setPublishMsg(null)
    try {
      const res = await fetch('/api/admin/fetch-qualitative', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await safeJson(res)
      if (json.ok) {
        setPublishMsg(`✓ ${json.message}`)
        await reloadDbCompanies()
      } else {
        setPublishMsg(`✗ ${json.error}`)
      }
    } catch (err) {
      setPublishMsg(`✗ ${err instanceof Error ? err.message : 'Network error'}`)
    } finally { setPublishing(false) }
  }

  // Per-ticker push: push the currently selected source for ONE ticker.
  // Wired up to the per-row ↑ Push button in the comparison table.
  const [pushingTicker, setPushingTicker] = useState<string | null>(null)
  const handlePushOne = async (ticker: string) => {
    const row = rows.find((r) => r.baseCo.ticker === ticker)
    if (!row) return
    const patch = buildOverrideForRow(row)
    if (!patch) {
      setPublishMsg(`⚠ ${ticker}: nothing to push — chosen source has no data for this ticker yet. Refresh that source first.`)
      return
    }
    setPushingTicker(ticker)
    setPublishMsg(null)
    try {
      const res = await fetch('/api/admin/publish-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: { [ticker]: patch } }),
      })
      const json = await safeJson(res)
      if (json.ok) {
        setPublishMsg(`✓ ${ticker}: ${json.message || 'Published.'}`)
        await reloadDbCompanies()
        broadcastDataPushed([ticker])
      } else {
        setPublishMsg(`✗ ${ticker}: ${json.error}`)
      }
    } catch (err) {
      setPublishMsg(`✗ ${err instanceof Error ? err.message : 'Network error'}`)
    } finally { setPushingTicker(null) }
  }

  // Per-ticker, per-source fetch. Wired up to the "⟳ Fetch ▾" button
  // next to each company name. Hits only ONE upstream source for ONE
  // ticker, so the admin can refresh a stale row without re-running
  // the full 521-ticker sweep.
  //
  // Source routing:
  //   'nse'        → scrape-exchange with skipScreener=true (~1-2 s)
  //   'screener'   → scrape-screener with tickers=[t] (~1-3 s)
  //   'dealnector' → scrape-exchange (both NSE + Screener) (~3-4 s)
  //
  // Result lands in the matching state slice (liveNseData /
  // screenerData / exchangeData), which feeds the comparison table
  // AND the PUBLISHED column via the shared buildPublishedPreview
  // helper. So a successful fetch updates all four visible columns
  // for that row instantly.
  const [fetchingTicker, setFetchingTicker] = useState<{ ticker: string; source: 'nse' | 'screener' | 'dealnector' } | null>(null)
  const [fetchMenuTicker, setFetchMenuTicker] = useState<string | null>(null)
  const handleFetchOne = async (ticker: string, source: 'nse' | 'screener' | 'dealnector') => {
    setFetchingTicker({ ticker, source })
    setFetchMenuTicker(null)
    try {
      let fetchedSummary = ''
      if (source === 'screener') {
        const res = await fetch('/api/admin/scrape-screener', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers: [ticker] }),
        })
        const json = await safeJson(res)
        if (json?.ok && json.data && json.data[ticker]) {
          setScreenerData((prev) => ({ ...prev, [ticker]: json.data[ticker] }))
          const sr = json.data[ticker] as ScreenerRow
          fetchedSummary = [
            sr.mktcapCr ? `MktCap ₹${Math.round(sr.mktcapCr).toLocaleString('en-IN')} Cr` : null,
            sr.salesCr  ? `Rev ₹${Math.round(sr.salesCr).toLocaleString('en-IN')} Cr`     : null,
            sr.ebitdaCr ? `EBITDA ₹${Math.round(sr.ebitdaCr).toLocaleString('en-IN')} Cr` : null,
          ].filter(Boolean).join(' · ')
        } else {
          setPublishMsg(`✗ ${ticker}: Screener returned no data (${json?.error || 'check ticker'}).`)
          return
        }
      } else {
        const skipScreener = source === 'nse'
        const res = await fetch('/api/admin/scrape-exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tickers: [ticker], skipScreener }),
        })
        const json = await safeJson(res)
        if (json?.ok && json.data && json.data[ticker]) {
          const row = json.data[ticker] as ExchangeRow
          mergeExchangeSweepData({ [ticker]: row })
          patchNseRow(ticker, row)
          fetchedSummary = [
            row.mktcapCr ? `MktCap ₹${Math.round(row.mktcapCr).toLocaleString('en-IN')} Cr` : null,
            row.salesCr  ? `Rev ₹${Math.round(row.salesCr).toLocaleString('en-IN')} Cr`     : null,
            row.ebitdaCr ? `EBITDA ₹${Math.round(row.ebitdaCr).toLocaleString('en-IN')} Cr` : null,
            row.pe       ? `P/E ${row.pe.toFixed(1)}×` : null,
          ].filter(Boolean).join(' · ')
        } else {
          setPublishMsg(`✗ ${ticker}: fetch returned no data (${json?.error || 'ticker not in pool'}).`)
          return
        }
      }

      // Auto-publish the fetched data straight to DB so it flows to
      // every page that consumes `useLiveSnapshot` (/reports,
      // /dashboard, /valuation, /maradar, /compare, /report/[ticker],
      // /crvi, ...). Uses the SAME `buildBatchOverrides` helper the
      // full-universe sweep uses, so:
      //   1. It doesn't depend on the ticker being in the admin's
      //      active filtered `rows` view (previously handlePushOne
      //      required a matching row in `rows` and would silently
      //      no-op for atlas-only tickers like KAMDHENU that the
      //      user's industry filter had excluded).
      //   2. It applies the same exchange → screener → baseline
      //      cascade with per-field source-tagging the PUBLISHED
      //      column on the admin page uses.
      //   3. Broadcasts `sg4:data-pushed` at the end so all other
      //      tabs + LiveSnapshotProvider reload within ~1 second.
      const fetchedExchange = source === 'screener'
        ? (exchangeData[ticker] as ExchangeRow | undefined)
        : undefined  // 'nse' / 'dealnector' path already set exchangeData above
      const overridesMap = buildBatchOverrides(
        fetchedExchange ? { [ticker]: fetchedExchange } : exchangeData[ticker] ? { [ticker]: exchangeData[ticker] } : {},
        screenerData as unknown as Record<string, ScreenerLike | undefined>,
        (() => { const m: Record<string, Company> = {}; for (const c of allCompanies) m[c.ticker] = c; return m })()
      )
      if (Object.keys(overridesMap).length === 0) {
        setPublishMsg(`⚠ ${ticker}: fetched OK but nothing to publish — all fields came back zero.`)
        return
      }
      const pubRes = await fetch('/api/admin/publish-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: overridesMap, source: 'exchange' }),
      })
      const pubJson = await safeJson(pubRes)
      if (pubJson?.ok) {
        // Fan out the "data changed" signal so every tab + consumer
        // refreshes state.dbCompanies on the next animation frame.
        broadcastDataPushed([ticker], source)
        await reloadDbCompanies()
        setPublishMsg(
          source === 'nse'
            ? `✓ ${ticker}: NSE refreshed & published website-wide — ${fetchedSummary}.`
            : source === 'screener'
              ? `✓ ${ticker}: Screener refreshed & published website-wide — ${fetchedSummary}.`
              : `✓ ${ticker}: DealNector refreshed & published website-wide — ${fetchedSummary}.`
        )
      } else {
        setPublishMsg(`⚠ ${ticker}: fetch succeeded but publish failed: ${pubJson?.error || 'check DB connection'}.`)
      }
    } catch (err) {
      setPublishMsg(`✗ ${ticker}: ${err instanceof Error ? err.message : 'Network error'}`)
    } finally {
      setFetchingTicker(null)
    }
  }

  // Look up the "last pushed" metadata for a ticker from the DB rows so
  // the comparison table can show "Screener · 2m ago" badges.
  const baselineAuditByTicker = useMemo(() => {
    const map: Record<string, { updatedAt: string | null; source: string | null }> = {}
    for (const c of allCompanies) {
      const at = (c as Company & { _baselineUpdatedAt?: string | null })._baselineUpdatedAt ?? null
      const src = (c as Company & { _baselineSource?: string | null })._baselineSource ?? null
      if (at || src) map[c.ticker] = { updatedAt: at, source: src }
    }
    return map
  }, [allCompanies])

  return (
    <div>
      {/* Header + per-source refresh buttons */}
      <div style={{ marginBottom: 14, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--gold2)' }}>
            Data Sources — Admin Only
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)', marginTop: 2 }}>
            Compare, refresh, and publish data from multiple sources
          </div>
        </div>
        <button onClick={() => refreshRapidApi()} disabled={rapidLoading}
          style={{ ...srcBtn, background: rapidLoading ? 'var(--s3)' : 'rgba(247,183,49,0.12)', borderColor: 'var(--gold2)', color: 'var(--gold2)' }}>
          {rapidLoading ? 'Refreshing NSE/BSE…' : '↻ Refresh NSE/BSE'}
        </button>
        <button onClick={fetchScreener} disabled={screenerLoading}
          style={{ ...srcBtn, background: screenerLoading ? 'var(--s3)' : 'rgba(16,185,129,0.12)', borderColor: 'var(--green)', color: 'var(--green)' }}>
          {screenerLoading ? 'Scraping Screener…' : '↻ Refresh Screener'}
        </button>
        <button onClick={() => fetchExchange()} disabled={exchangeLoading}
          title="Resume-friendly: reuses any tickers already fetched in this session (24h TTL) and only hits NSE/Screener for the missing ones"
          style={{ ...srcBtn, background: exchangeLoading ? 'var(--s3)' : 'rgba(0,180,216,0.12)', borderColor: 'var(--cyan2)', color: 'var(--cyan2)' }}>
          {exchangeLoading
            ? exchangeProgress
              ? `Fetching NSE… ${exchangeProgress.done}/${exchangeProgress.total}`
              : 'Fetching NSE…'
            : '↻ Refresh DealNector API'}
        </button>
        {!exchangeLoading && (
          <button onClick={forceFullRefresh}
            title="Discards the 24h cache and re-fetches EVERY ticker from scratch. Use only after a major corporate action or NSE schema change."
            style={{ ...srcBtn, background: 'transparent', borderColor: 'var(--br)', color: 'var(--txt3)', fontSize: 9 }}>
            ⚡ Force Full Refresh
          </button>
        )}
        {!exchangeLoading && Object.keys(exchangeData).length > 0 && (
          <button onClick={publishCachedExchange} disabled={publishingCached}
            title="Push every ticker currently in the DealNector cache to user_companies — use when a sweep was cancelled or when the per-batch auto-publish missed rows."
            style={{ ...srcBtn, background: publishingCached ? 'var(--s3)' : 'rgba(200,162,75,0.18)', borderColor: 'var(--gold2, #C8A24B)', color: 'var(--gold2, #C8A24B)' }}>
            {publishingCached ? 'Publishing cached…' : `⇧ Publish Cached (${Object.keys(exchangeData).length})`}
          </button>
        )}
        {!exchangeLoading && missingSummary && missingSummary.missing > 0 && (
          <button onClick={fetchMissingFinancials}
            title={`Target only the ${missingSummary.missing} ticker${missingSummary.missing === 1 ? '' : 's'} without financials — up to ${missingSummary.maxAttempts} fetch attempts each, then banked as exhausted. Runs in the background, per-batch auto-publish. ${missingSummary.exhausted} previously banked · ${missingSummary.filled}/${missingSummary.total} filled · today: NSE ${missingSummary.nseToday} · Screener ${missingSummary.screenerToday}`}
            style={{ ...srcBtn, background: 'rgba(16,185,129,0.15)', borderColor: 'var(--green)', color: 'var(--green)' }}>
            ⚡ Fetch Missing Financials ({missingSummary.missing})
          </button>
        )}
        {!exchangeLoading && missingSummary && missingSummary.missing === 0 && missingSummary.total > 0 && (
          <span
            title={`All ${missingSummary.filled}/${missingSummary.total} tickers have financials. ${missingSummary.exhausted} banked as exhausted after ${missingSummary.maxAttempts} failed attempts.`}
            style={{ fontSize: 10, color: 'var(--green)', fontFamily: 'JetBrains Mono, monospace', padding: '4px 8px' }}>
            ✓ All {missingSummary.filled}/{missingSummary.total} filled
          </span>
        )}
        {pendingSweep && !exchangeLoading && (
          <>
            <button onClick={resumeExchangeFetch}
              style={{ ...srcBtn, background: 'rgba(200,162,75,0.18)', borderColor: 'var(--gold2, #C8A24B)', color: 'var(--gold2, #C8A24B)' }}
              title={`Previous sweep stopped at batch ${pendingSweep.chunkIndex}/${pendingSweep.totalChunks}. Click to resume the ${pendingSweep.missing.length} remaining ticker${pendingSweep.missing.length === 1 ? '' : 's'}.`}>
              ▶ Resume sweep ({pendingSweep.missing.length} left)
            </button>
            <button onClick={dismissPendingSweep}
              style={{ ...srcBtn, background: 'transparent', borderColor: 'var(--br)', color: 'var(--txt3)', fontSize: 9 }}
              title="Discard the pending sweep marker">
              ✕ Dismiss
            </button>
          </>
        )}
        {exchangeLoading && (
          <button onClick={cancelExchangeFetch}
            style={{ ...srcBtn, background: 'rgba(239,68,68,0.12)', borderColor: 'var(--red)', color: 'var(--red)' }}>
            ⨯ Cancel
          </button>
        )}
        {exchangeError && !exchangeLoading && (
          <span style={{ fontSize: 10, color: 'var(--red)', alignSelf: 'center', maxWidth: 640 }}>
            ⚠ {exchangeError}
          </span>
        )}

        {/*
          Per-source sweep progress — visible during an active sweep OR
          immediately after completion (until the next sweep starts, at
          which point it resets). Shows four independent tallies so the
          admin can see exactly where data is coming from:
            NSE         — tickers where NSE quote-equity returned a price+mktcap
            Screener    — tickers where Screener returned a P&L row
            DealNector  — tickers with a usable combined row (any source)
            Published   — tickers the per-batch auto-publish wrote to DB
          A failed-publish count appears only when non-zero so the common
          all-green case stays visually clean.
        */}
        {exchangeProgress && (
          <div style={{
            flexBasis: '100%',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px 12px',
            alignItems: 'center',
            fontSize: 10,
            color: 'var(--txt3)',
            padding: '4px 2px 0',
          }}>
            <span style={{ fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', fontSize: 9, color: 'var(--txt3)' }}>
              Sweep Progress
            </span>
            <span>
              Processed: <strong style={{ color: 'var(--txt)' }}>{exchangeProgress.done}/{exchangeProgress.total}</strong>
            </span>
            <span style={{ color: 'var(--br2)' }}>·</span>
            <span>
              <span style={{ color: 'var(--cyan2)', fontWeight: 700 }}>NSE:</span>{' '}
              <strong style={{ color: 'var(--txt)' }}>{exchangeProgress.nseOk}</strong>
              <span style={{ color: 'var(--txt3)' }}>/{exchangeProgress.done}</span>
            </span>
            <span style={{ color: 'var(--br2)' }}>·</span>
            <span>
              <span style={{ color: 'var(--green)', fontWeight: 700 }}>Screener:</span>{' '}
              <strong style={{ color: 'var(--txt)' }}>{exchangeProgress.screenerOk}</strong>
              <span style={{ color: 'var(--txt3)' }}>/{exchangeProgress.done}</span>
            </span>
            <span style={{ color: 'var(--br2)' }}>·</span>
            <span>
              <span style={{ color: 'var(--gold2)', fontWeight: 700 }}>DealNector:</span>{' '}
              <strong style={{ color: 'var(--txt)' }}>{exchangeProgress.dealnectorOk}</strong>
              <span style={{ color: 'var(--txt3)' }}>/{exchangeProgress.done}</span>
            </span>
            <span style={{ color: 'var(--br2)' }}>·</span>
            <span>
              <span style={{ color: 'var(--orange)', fontWeight: 700 }}>Published to DB:</span>{' '}
              <strong style={{ color: 'var(--txt)' }}>{exchangeProgress.dbPublished}</strong>
              <span style={{ color: 'var(--txt3)' }}>/{exchangeProgress.done}</span>
              {exchangeProgress.dbFailed > 0 && (
                <span style={{ color: 'var(--red)', marginLeft: 4 }} title="Rows auto-publish tried and failed on. Run a manual Publish to retry.">
                  · {exchangeProgress.dbFailed} failed
                </span>
              )}
            </span>
          </div>
        )}

        <button onClick={handleCommodityRefresh} disabled={commodityRefreshing}
          style={{ ...srcBtn, background: commodityRefreshing ? 'var(--s3)' : 'rgba(200,120,50,0.12)', borderColor: 'var(--orange)', color: 'var(--orange)' }}>
          {commodityRefreshing ? 'Fetching MCX/NCDEX…' : '↻ Refresh Commodities'}
        </button>
        {commodityAsOfDate && (
          <span style={{ fontSize: 9, color: 'var(--txt3)', alignSelf: 'center' }}>
            Commodity prices as of <strong style={{ color: 'var(--orange)' }}>{commodityAsOfDate}</strong>
          </span>
        )}
      </div>

      {/* Parse-time anomaly log (Phase 2).
          Shows the most recent validator failures — any row that hit a
          unit / header / orientation / plausibility gate was BLOCKED
          from publish-data, so these are a "parser schema drift" early-
          warning list, not a list of real errors on the main site. */}
      {anomalies.length > 0 && (
        <div style={{
          marginBottom: 10, padding: '10px 14px',
          background: 'var(--s2)', border: '1px solid var(--red)', borderRadius: 6,
        }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontWeight: 700, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: '1px', fontSize: 10 }}>
              ⚠ Scrape Anomalies
            </span>
            <span style={{ fontSize: 10, color: 'var(--txt3)' }}>
              {anomalies.length} blocked from publish · last 200 shown · these tickers kept their prior baseline
            </span>
            <button
              onClick={() => void loadAnomalies()}
              style={{
                background: 'transparent', border: '1px solid var(--br)', color: 'var(--txt3)',
                padding: '3px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer',
                marginLeft: 'auto', fontFamily: 'inherit',
              }}
              title="Refetch the anomaly tail"
            >
              ↻ Reload
            </button>
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--txt3)', background: 'var(--s3)' }}>
                  <th style={{ padding: '5px 8px' }}>When</th>
                  <th style={{ padding: '5px 8px' }}>Ticker</th>
                  <th style={{ padding: '5px 8px' }}>Source</th>
                  <th style={{ padding: '5px 8px' }}>Check</th>
                  <th style={{ padding: '5px 8px' }}>Field</th>
                  <th style={{ padding: '5px 8px' }}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {anomalies.slice(0, 50).map((a) => {
                  const when = a.detectedAt
                    ? new Date(a.detectedAt).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' })
                    : '—'
                  return (
                    <tr key={a.id} style={{ borderBottom: '1px solid var(--br)' }}>
                      <td style={{ padding: '4px 8px', whiteSpace: 'nowrap', color: 'var(--txt3)' }}>{when}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--txt)' }}>{a.ticker}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--cyan2)' }}>{a.source}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--red)' }}>{a.check}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--txt2)' }}>{a.field || '—'}</td>
                      <td
                        style={{
                          padding: '4px 8px', color: 'var(--txt3)',
                          maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                        title={[a.raw, a.expected, a.detail].filter(Boolean).join(' · ') || undefined}
                      >
                        {a.detail || a.raw || a.expected || '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Auto-refresh coverage summary.
          Denominator = allCompanies (static seed ∪ user_companies) so the
          count is truly dynamic — adding a company to the DB instantly
          pushes the total up from e.g. 85 to 86, and the next auto-refresh
          tick fills it in. Tickers without an NSE symbol are shown as a
          parenthetical so the "why isn't it 85/85?" question has a visible
          answer instead of looking like silent drops. */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 10, padding: '10px 14px',
        background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6,
        alignItems: 'center', flexWrap: 'wrap', fontSize: 11,
      }}>
        <span style={{ fontWeight: 700, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: '1px', fontSize: 9 }}>
          Auto-Refresh Status
        </span>
        <span>
          <strong style={{ color: 'var(--cyan2)' }}>NSE:</strong>{' '}
          {nseRefreshing ? 'refreshing…' : `${Object.keys(liveNseData).length}/${allCompanies.length}`}
          {(() => {
            const noNse = allCompanies.filter((c) => !c.nse).length
            return noNse > 0 ? (
              <span style={{ color: 'var(--txt3)' }} title="These companies have no NSE symbol (private / unlisted) and cannot be fetched from NSE Direct.">
                {' '}({noNse} no symbol)
              </span>
            ) : null
          })()}
          {nseLastRefreshed && <span style={{ color: 'var(--txt3)' }}> · {nseLastRefreshed.toLocaleTimeString('en-IN')}</span>}
          <span style={{ color: 'var(--txt3)' }}> · hourly</span>
        </span>
        <span style={{ color: 'var(--br2)' }}>|</span>
        <span>
          <strong style={{ color: 'var(--green)' }}>Screener:</strong>{' '}
          {screenerRefreshing ? 'refreshing…' : `${Object.keys(liveScreenerAuto).length}/${allCompanies.length}`}
          {screenerLastRefreshed && <span style={{ color: 'var(--txt3)' }}> · {screenerLastRefreshed.toLocaleTimeString('en-IN')}</span>}
          <span style={{ color: 'var(--txt3)' }}> · 3×/day IST</span>
        </span>
        <span style={{ color: 'var(--br2)' }}>|</span>
        <span>
          <strong style={{ color: 'var(--gold2)' }}>RapidAPI:</strong>{' '}
          {Object.keys(liveTickers).length}/{allCompanies.length} cached
          <span style={{ color: 'var(--txt3)' }}> · admin manual</span>
        </span>
        {Object.keys(liveMissingFields).length > 0 && (
          <>
            <span style={{ color: 'var(--br2)' }}>|</span>
            <span style={{ color: 'var(--orange)', fontWeight: 700 }}>
              ⚠ {Object.keys(liveMissingFields).length} companies have missing fields — use RapidAPI
            </span>
          </>
        )}
      </div>

      {screenerError && (
        <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--reddim)', border: '1px solid var(--red)', borderRadius: 4, color: 'var(--red)', fontSize: 11 }}>
          {screenerError}
        </div>
      )}

      {/* ── Sub-Segment Mapping (DealNector VC Taxonomy) ───────────────
          Bulk tool for admin + subadmin. Collapsed by default; expands
          inline with a file picker + result summary. Used instead of
          clicking ✎ on each row when you have hundreds of tickers to
          re-classify at once. */}
      <div
        style={{
          marginBottom: 12,
          padding: '10px 14px',
          background: 'var(--cyandim)',
          border: '1px solid var(--cyan2)',
          borderRadius: 6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase', color: 'var(--cyan2)' }}>
            🗂 Sub-Segment Mapping
          </span>
          <span style={{ fontSize: 11, color: 'var(--txt2)' }}>
            Upload Excel to bulk-tag companies with DealNector VC-Taxonomy sub-segments (Ticker + Sub-segments columns).
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={() => setSubUploadOpen((v) => !v)}
            style={{
              background: subUploadOpen ? 'var(--s3)' : 'var(--cyandim)',
              border: '1px solid var(--cyan2)',
              color: 'var(--cyan2)',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.4px',
              textTransform: 'uppercase',
              padding: '4px 10px',
              borderRadius: 3,
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {subUploadOpen ? '− Collapse' : '+ Upload Mapping'}
          </button>
        </div>
        {subUploadOpen && (
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Format hint */}
            <div
              style={{
                fontSize: 10,
                lineHeight: 1.5,
                color: 'var(--txt3)',
                background: 'var(--s1)',
                border: '1px dashed var(--br2)',
                borderRadius: 3,
                padding: '6px 10px',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              <strong style={{ color: 'var(--cyan2)' }}>Expected format:</strong> First sheet, headers
              <em> Ticker </em> + <em> Sub-segments </em> (synonyms accepted: Symbol, NSE, Code, Subcomp, Tags, SS).<br />
              <strong style={{ color: 'var(--gold2)' }}>Cell values</strong> accept dotted codes (<em>1.2.3</em>),
              sub-segment ids (<em>ss_1_2_3</em>), names (<em>TOPCon Cell</em>), or the literal <em>all</em> /
              <em> *</em> to select every sub-segment in the company&apos;s stage. Multiple values per cell
              are separated by <em>, ; |</em>. A blank cell resets to default (&quot;all&quot;).
            </div>

            {/* File picker + upload button */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                disabled={subUploadBusy}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) uploadSubcompMapping(f)
                  // Reset so re-uploading the same file re-fires onChange.
                  e.target.value = ''
                }}
                style={{
                  fontSize: 11,
                  color: 'var(--txt2)',
                  fontFamily: 'inherit',
                }}
              />
              {subUploadBusy && (
                <span style={{ fontSize: 11, color: 'var(--cyan2)', fontStyle: 'italic' }}>
                  Uploading &amp; applying…
                </span>
              )}
            </div>

            {/* Error banner */}
            {subUploadError && (
              <div
                style={{
                  padding: '6px 10px',
                  background: 'var(--reddim)',
                  border: '1px solid var(--red)',
                  borderRadius: 3,
                  color: 'var(--red)',
                  fontSize: 11,
                }}
              >
                ⚠ {subUploadError}
              </div>
            )}

            {/* Result summary */}
            {subUploadResult && (
              <div
                style={{
                  padding: '8px 10px',
                  background: 'var(--s1)',
                  border: '1px solid var(--green)',
                  borderRadius: 3,
                  fontSize: 11,
                  color: 'var(--txt2)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                <div>
                  <strong style={{ color: 'var(--green)' }}>✓ {subUploadResult.filename} applied.</strong>
                  {' '}Total: {subUploadResult.summary.total} ·{' '}
                  Updated: <strong style={{ color: 'var(--cyan2)' }}>{subUploadResult.summary.updated}</strong> ·{' '}
                  Seeded: <strong style={{ color: 'var(--gold2)' }}>{subUploadResult.summary.seeded}</strong> ·{' '}
                  Skipped: <strong style={{ color: 'var(--orange)' }}>{subUploadResult.summary.skipped}</strong> ·{' '}
                  Errors: <strong style={{ color: 'var(--red)' }}>{subUploadResult.summary.errors}</strong>
                  {subUploadResult.summary.unresolvedTokens > 0 && (
                    <>
                      {' · '}
                      <strong style={{ color: 'var(--orange)' }}>
                        Unresolved tokens: {subUploadResult.summary.unresolvedTokens}
                      </strong>
                    </>
                  )}
                </div>
                {/* Per-row detail, limited to issues so the admin can fix the Excel */}
                {Array.isArray(subUploadResult.results) && (() => {
                  const issues = subUploadResult.results!.filter(
                    (r) => r.status === 'skipped_not_found' || r.status === 'error' || (r.unresolved && r.unresolved.length > 0)
                  )
                  if (issues.length === 0) return null
                  return (
                    <div style={{ maxHeight: 180, overflowY: 'auto', marginTop: 4 }}>
                      <div style={{ fontSize: 9, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                        Issues needing attention
                      </div>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                        <thead>
                          <tr style={{ background: 'var(--s2)' }}>
                            <th style={{ padding: '4px 6px', textAlign: 'left', color: 'var(--txt3)' }}>Ticker</th>
                            <th style={{ padding: '4px 6px', textAlign: 'left', color: 'var(--txt3)' }}>Status</th>
                            <th style={{ padding: '4px 6px', textAlign: 'left', color: 'var(--txt3)' }}>Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {issues.map((r, i) => (
                            <tr key={`${r.ticker}-${i}`} style={{ borderTop: '1px solid var(--br)' }}>
                              <td style={{ padding: '3px 6px', color: 'var(--txt)', fontFamily: 'JetBrains Mono, monospace' }}>
                                {r.ticker}
                              </td>
                              <td style={{ padding: '3px 6px', color: r.status === 'error' ? 'var(--red)' : r.status === 'skipped_not_found' ? 'var(--orange)' : 'var(--gold2)' }}>
                                {r.status}
                              </td>
                              <td style={{ padding: '3px 6px', color: 'var(--txt3)' }}>
                                {r.error || (r.unresolved && r.unresolved.length > 0 ? `Unresolved: ${r.unresolved.join(', ')}` : '—')}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sub-tab navigation + company search.
          The search box sits on the right of the sub-tab bar so it's
          visible whether the admin is on the Comparison Table or the
          Ratios table — both honour the same query. On the Discover
          sub-tab the box is hidden because that view has its own
          Screener-query box. */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--br)', marginBottom: 10, alignItems: 'center' }}>
        {([['main', 'Comparison Table'], ['ratios', 'Ratios & Working Capital'], ['discover', 'Discover SME Companies']] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setSubTab(k)}
            style={{ ...srcBtn, background: 'none', borderColor: 'transparent',
              borderBottom: subTab === k ? '2px solid var(--gold2)' : '2px solid transparent',
              color: subTab === k ? 'var(--gold2)' : 'var(--txt2)', borderRadius: 0, padding: '8px 14px' }}>
            {lbl}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {subTab !== 'discover' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingBottom: 6 }}>
            {companySearch.trim() && (
              <span style={{ fontSize: 10, color: 'var(--txt3)', fontFamily: 'JetBrains Mono, monospace' }}>
                {subTab === 'main'
                  ? `${filteredRows.length} of ${rows.length}`
                  : (() => {
                      const q = companySearch.trim().toLowerCase()
                      const entries = Object.entries(screenerRatios)
                      const matched = entries.filter(([t, r]) =>
                        t.toLowerCase().includes(q) || (r.name || '').toLowerCase().includes(q),
                      ).length
                      return `${matched} of ${entries.length}`
                    })()}
              </span>
            )}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <span style={{ position: 'absolute', left: 8, fontSize: 11, color: 'var(--txt3)', pointerEvents: 'none' }}>🔍</span>
              <input
                type="text"
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="Search ticker, name, industry, segment…"
                style={{
                  background: 'var(--s2)',
                  border: '1px solid var(--br)',
                  color: 'var(--txt)',
                  padding: '5px 26px 5px 26px',
                  fontSize: 11,
                  borderRadius: 3,
                  fontFamily: 'inherit',
                  width: 280,
                }}
              />
              {companySearch && (
                <button
                  onClick={() => setCompanySearch('')}
                  title="Clear search"
                  style={{
                    position: 'absolute', right: 4, background: 'none', border: 'none',
                    color: 'var(--txt3)', cursor: 'pointer', fontSize: 12, padding: '2px 6px',
                    lineHeight: 1,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ─── SUB-TAB: COMPARISON TABLE ─── */}
      {subTab === 'main' && (
        <>
          {/* Bulk source + publish */}
          <div style={{ marginBottom: 10, display: 'flex', gap: 6, alignItems: 'center', fontSize: 10, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--txt3)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginRight: 4 }}>
              Bulk:
            </span>
            {(['baseline', 'rapidapi', 'screener', 'exchange'] as const).map((s) => (
              <button key={s} onClick={() => setBulkSource(s)} style={{ ...srcBtn, fontSize: 9, padding: '3px 8px' }}>
                {s === 'baseline' ? 'All Baseline' : s === 'rapidapi' ? 'All NSE/BSE' : s === 'screener' ? 'All Screener' : 'All DealNector'}
              </button>
            ))}
            <span style={{ color: 'var(--br2)', margin: '0 4px' }}>|</span>
            {/* One-click: pick a source AND push every ticker from it.
                Saves admin 86 individual clicks. Recomputes acqs live.
                "Baseline" publishes the hand-curated seed values (or the
                DB row if the ticker's already been overridden) — use it
                to seed static-only tickers into the DB for the first
                time, or to reset after a bad live refresh. */}
            <span style={{ color: 'var(--txt3)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase', marginRight: 2 }}>
              Push All from:
            </span>
            <button onClick={() => handleBulkPush('baseline')} disabled={publishing}
              title="Seed every ticker's baseline values into user_companies (or reset an already-overridden row back to seed)"
              style={{ ...srcBtn, fontSize: 9, padding: '3px 10px', background: 'rgba(100,180,255,0.12)', borderColor: 'var(--br2)', color: 'var(--txt2)' }}>
              ⇧ Baseline
            </button>
            <button onClick={() => handleBulkPush('rapidapi')} disabled={publishing}
              style={{ ...srcBtn, fontSize: 9, padding: '3px 10px', background: 'rgba(247,183,49,0.12)', borderColor: 'var(--gold2)', color: 'var(--gold2)' }}>
              ⇧ NSE/BSE
            </button>
            <button onClick={() => handleBulkPush('screener')} disabled={publishing}
              style={{ ...srcBtn, fontSize: 9, padding: '3px 10px', background: 'rgba(16,185,129,0.12)', borderColor: 'var(--green)', color: 'var(--green)' }}>
              ⇧ Screener
            </button>
            <button onClick={() => handleBulkPush('exchange')} disabled={publishing}
              title="Fetch FRESH NSE + Screener data for EVERY ticker in the universe AND publish to DB. When less than half the universe has cached exchange data, auto-runs a full sweep first (~10-15 min). Safe to click mid-sweep — it resumes."
              style={{ ...srcBtn, fontSize: 9, padding: '3px 10px', background: 'rgba(0,180,216,0.12)', borderColor: 'var(--cyan2)', color: 'var(--cyan2)' }}>
              ⇧ DealNector (fetch + publish all)
            </button>
            {/* Escape hatch: when a bad push poisoned DB rows, this deletes
                the user_companies overrides so the hand-curated static seed
                surfaces again through the LiveSnapshotProvider merge. Only
                touches tickers that HAVE a static seed; admin-added SME /
                Atlas rows are left alone (they have no seed to fall back
                to, deleting them would orphan the company). */}
            <span style={{ color: 'var(--br2)', margin: '0 4px' }}>|</span>
            <button onClick={handleResetToSeed} disabled={publishing}
              title="Delete DB override rows so the hand-curated COMPANIES[] seed resurfaces. Useful after a bad Screener/NSE push poisoned the DB."
              style={{ ...srcBtn, fontSize: 9, padding: '3px 10px', background: 'rgba(239,68,68,0.12)', borderColor: 'var(--red)', color: 'var(--red)' }}>
              ↺ Reset to Seed
            </button>
            {/* Free-source qualitative sweep. Separate from the financial
                push buttons above because it fills a different column set
                (ar_url / credit_rating / shareholding) and takes ~4 min to
                complete across the full 294-ticker universe. Uses Screener
                HTML only — zero paid API cost. */}
            <span style={{ color: 'var(--br2)', margin: '0 4px' }}>|</span>
            <button onClick={handleFetchQualitative} disabled={publishing}
              title="Scrape Screener.in for Annual Reports, Credit Ratings, and Shareholding % across all 294 tickers. Free source only; ~4 min runtime."
              style={{ ...srcBtn, fontSize: 9, padding: '3px 10px', background: 'rgba(160,100,230,0.12)', borderColor: 'var(--purple, #a855f7)', color: 'var(--purple, #a855f7)' }}>
              ⤓ Fetch Qualitative (AR · Rating · SH)
            </button>
            <div style={{ flex: 1 }} />
            <button onClick={handlePublish} disabled={publishing}
              style={{ background: 'var(--green)', color: '#fff', border: 'none',
                padding: '7px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
                textTransform: 'uppercase', borderRadius: 4, cursor: publishing ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {publishing ? 'Publishing…' : '✓ Publish Selected'}
            </button>
          </div>
          {publishMsg && (
            <div style={{ marginBottom: 10, padding: '8px 12px', borderRadius: 4, fontSize: 11,
              background: publishMsg.startsWith('✓') ? 'var(--greendim)' : 'var(--reddim)',
              color: publishMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)',
              border: `1px solid ${publishMsg.startsWith('✓') ? 'var(--green)' : 'var(--red)'}` }}>
              {publishMsg}
            </div>
          )}
          {/* Sticky-header scroll container. maxHeight caps the visible
              rows at ~12 so the thead stays anchored while the admin
              scrolls through the full company list. overflow is now
              BOTH axes (was just X) — the vertical scroll is what
              gives `position: sticky` on thead a scroll context to
              latch onto. */}
          <div style={{
            overflow: 'auto',
            maxHeight: 'calc(100vh - 260px)',
            border: '1px solid var(--br)',
            borderRadius: 6,
            background: 'var(--s2)',
          }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 10, whiteSpace: 'nowrap', minWidth: 3000 }}>
              <thead>
                {/*
                 * position: sticky locks both header rows to the top
                 * while the tbody scrolls underneath. z-index 3 beats
                 * the z=1 sticky first-column on each data row so the
                 * top-left corner doesn't get painted over when the
                 * admin scrolls diagonally. The explicit background
                 * on each cell (not just the row) is required because
                 * sticky cells render out-of-flow and inherit
                 * transparent by default.
                 */}
                <tr>
                  <th style={{ ...sthStyle, position: 'sticky', top: 0, left: 0, background: 'var(--s3)', zIndex: 4 }} rowSpan={2}>Company</th>
                  <th style={{ ...sthStyle, position: 'sticky', top: 0, background: 'var(--s3)', zIndex: 3 }} rowSpan={2}>↻</th>
                  <th style={{ ...sthStyle, position: 'sticky', top: 0, background: 'var(--s3)', zIndex: 3 }} rowSpan={2}>Source</th>
                  <th style={{ ...sthStyle, position: 'sticky', top: 0, background: 'var(--s3)', zIndex: 3 }} rowSpan={2}>Last Pushed</th>
                  <th style={{ ...sthStyle, position: 'sticky', top: 0, background: 'var(--s3)', zIndex: 3 }} rowSpan={2}>Push</th>
                  <th style={{ ...sthStyle, position: 'sticky', top: 0, background: GROUP_HEADER_BG.baseline,   zIndex: 3 }} colSpan={6}>Baseline</th>
                  <th style={{ ...sthStyle, position: 'sticky', top: 0, background: GROUP_HEADER_BG.nseLive,    zIndex: 3 }} colSpan={6}>{'NSE/BSE Live'}</th>
                  <th style={{ ...sthStyle, position: 'sticky', top: 0, background: GROUP_HEADER_BG.screener,   zIndex: 3 }} colSpan={6}>Screener.in</th>
                  <th style={{ ...sthStyle, position: 'sticky', top: 0, background: GROUP_HEADER_BG.dealnector, zIndex: 3 }} colSpan={6}>DealNector API (NSE)</th>
                  {/*
                    PUBLISHED column group — the ACTUAL values currently
                    living in user_companies (what the rest of the site
                    reads on every page load). Computed from the exchange
                    → screener → baseline cascade so every row shows a
                    complete picture even when only one source has data
                    for a given ticker. A small src-tag on each cell
                    indicates which source contributed that specific
                    field, so the admin can audit at a glance which
                    columns came from NSE vs Screener vs seed.
                  */}
                  <th style={{ ...sthStyle, position: 'sticky', top: 0, background: GROUP_HEADER_BG.published,  zIndex: 3 }} colSpan={6}>Published (→ website)</th>
                </tr>
                <tr>
                  {['MktCap','Rev','EBITDA','EV','EV/EB','P/E'].map((h) => (
                    <th key={`b-${h}`} style={{ ...sthStyle, position: 'sticky', top: 29, background: GROUP_HEADER_BG.baseline, zIndex: 3 }}>{h}</th>
                  ))}
                  {['MktCap','Rev','EBITDA','EV','EV/EB','P/E'].map((h) => (
                    <th key={`r-${h}`} style={{ ...sthStyle, position: 'sticky', top: 29, background: GROUP_HEADER_BG.nseLive, zIndex: 3 }}>{h}</th>
                  ))}
                  {['MktCap','Rev','EBITDA','EV','EV/EB','P/E'].map((h) => (
                    <th key={`s-${h}`} style={{ ...sthStyle, position: 'sticky', top: 29, background: GROUP_HEADER_BG.screener, zIndex: 3 }}>{h}</th>
                  ))}
                  {['MktCap','Rev','EBITDA','EV','EV/EB','P/E'].map((h) => (
                    <th key={`e-${h}`} style={{ ...sthStyle, position: 'sticky', top: 29, background: GROUP_HEADER_BG.dealnector, zIndex: 3 }}>{h}</th>
                  ))}
                  {['MktCap','Rev','EBITDA','EV','EV/EB','P/E'].map((h) => (
                    <th key={`p-${h}`} style={{ ...sthStyle, position: 'sticky', top: 29, background: GROUP_HEADER_BG.published, zIndex: 3 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRows.length === 0 && companySearch.trim() && (
                  <tr>
                    <td colSpan={35} style={{ ...stdStyle, textAlign: 'center', padding: 24, color: 'var(--txt3)', fontStyle: 'italic' }}>
                      No companies match &ldquo;{companySearch}&rdquo;. Try ticker, name, industry (solar / td), or a value-chain segment.
                    </td>
                  </tr>
                )}
                {filteredRows.map(({ baseCo, derived, screener, exchange, source }) => {
                  const liveCo = derived.company
                  return (
                    <tr key={baseCo.ticker} style={{ borderBottom: '1px solid var(--br)' }}>
                      <td style={{ ...stdStyle, fontWeight: 600, color: 'var(--txt)', position: 'sticky', left: 0, background: 'var(--s2)', zIndex: 1, minWidth: 220 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                          <span style={{ flex: 1 }}>{baseCo.name}</span>
                          {/* Per-row Fetch — picks ONE source to refresh
                              without running the full sweep. Opens a small
                              dropdown with three choices; click one and
                              only that upstream gets hit for this ticker.
                              Closes on outside click (wired via shared
                              setFetchMenuTicker null). */}
                          <div style={{ position: 'relative', flexShrink: 0 }}>
                            <button
                              onClick={() => setFetchMenuTicker(
                                fetchMenuTicker === baseCo.ticker ? null : baseCo.ticker
                              )}
                              disabled={fetchingTicker?.ticker === baseCo.ticker}
                              title="Fetch latest data for this ticker from a specific source"
                              style={{
                                background: 'var(--s3)',
                                border: '1px solid var(--br)',
                                borderRadius: 3,
                                color: 'var(--gold2, #C8A24B)',
                                fontSize: 9,
                                padding: '2px 6px',
                                cursor: fetchingTicker?.ticker === baseCo.ticker ? 'wait' : 'pointer',
                                fontWeight: 600,
                                lineHeight: 1.3,
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {fetchingTicker?.ticker === baseCo.ticker
                                ? `⟳ ${fetchingTicker.source === 'nse' ? 'NSE' : fetchingTicker.source === 'screener' ? 'SCR' : 'DN'}…`
                                : '⟳ Fetch ▾'}
                            </button>
                            {fetchMenuTicker === baseCo.ticker && (
                              <div style={{
                                position: 'absolute',
                                top: '100%',
                                right: 0,
                                marginTop: 2,
                                background: 'var(--s2)',
                                border: '1px solid var(--br)',
                                borderRadius: 4,
                                boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                                zIndex: 10,
                                minWidth: 120,
                                fontSize: 9,
                              }}>
                                <button
                                  onClick={() => handleFetchOne(baseCo.ticker, 'nse')}
                                  style={menuItemStyle('var(--cyan2)')}
                                  title="Fetch NSE quote-equity only (live price, mktcap, P/E, 52-week). Skips Screener. ~1-2s."
                                >
                                  <span style={{ fontWeight: 700 }}>NSE</span> · live spot
                                </button>
                                <button
                                  onClick={() => handleFetchOne(baseCo.ticker, 'screener')}
                                  style={menuItemStyle('var(--green)')}
                                  title="Fetch Screener.in P&L + balance sheet only. Skips NSE. ~1-3s."
                                >
                                  <span style={{ fontWeight: 700 }}>Screener</span> · P&L + BS
                                </button>
                                <button
                                  onClick={() => handleFetchOne(baseCo.ticker, 'dealnector')}
                                  style={menuItemStyle('var(--gold2, #C8A24B)')}
                                  title="Run the full DealNector pipeline (NSE + Screener combined, with fallbacks + sanity clamp). ~3-4s."
                                >
                                  <span style={{ fontWeight: 700 }}>DealNector</span> · NSE+SCR
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                        <span style={{ fontSize: 8, color: 'var(--txt3)' }}>
                          {baseCo.ticker}
                          {derived.updatedAt && <> · <span style={{ color: 'var(--gold2)' }}>API {new Date(derived.updatedAt).toLocaleDateString('en-IN')}</span></>}
                          {screener && <> · <span style={{ color: 'var(--green)' }}>Scr {screener.period}</span></>}
                          {exchange && <> · <span style={{ color: 'var(--cyan2)' }}>NSE {new Date(exchange.fetchedAt).toLocaleDateString('en-IN')}</span></>}
                        </span>
                        {/* NSE symbol row — shows the current live symbol with
                            a pencil to edit. Resolves via the same precedence
                            the server uses (admin-edited DB > static map > ticker),
                            so what's shown here is what the scheduler will hit.
                            Missing NSE data is highlighted so the admin knows
                            this is a row that needs a correction. */}
                        <div style={{ fontSize: 8, color: 'var(--txt3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span>NSE:</span>
                          <span style={{
                            color: liveNseData[baseCo.ticker] ? 'var(--cyan2)' : 'var(--orange)',
                            fontWeight: 700,
                            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                          }}>
                            {liveNseData[baseCo.ticker]?.nse || baseCo.nse || baseCo.ticker}
                          </span>
                          {!liveNseData[baseCo.ticker] && (
                            <span style={{ color: 'var(--orange)', fontWeight: 700 }} title="No NSE quote currently cached for this ticker — probably wrong symbol.">
                              ✗
                            </span>
                          )}
                          <button
                            onClick={() => {
                              setSymbolEditTicker((curr) => (curr === baseCo.ticker ? null : baseCo.ticker))
                              setSymbolInput(liveNseData[baseCo.ticker]?.nse || baseCo.nse || baseCo.ticker)
                              setSymbolError(null)
                              setSymbolOk(null)
                            }}
                            title="Edit NSE symbol"
                            style={{
                              background: 'none', border: 'none', color: 'var(--gold2)',
                              cursor: 'pointer', fontSize: 10, padding: 0, marginLeft: 'auto',
                            }}
                          >
                            ✎
                          </button>
                        </div>
                        {symbolEditTicker === baseCo.ticker && (
                          <div style={{
                            marginTop: 4, padding: 6, background: 'var(--s3)',
                            border: '1px solid var(--br)', borderRadius: 3,
                            display: 'flex', flexDirection: 'column', gap: 4,
                          }}>
                            <input
                              type="text"
                              value={symbolInput}
                              onChange={(e) => setSymbolInput(e.target.value.toUpperCase())}
                              placeholder="e.g. PREMIERENE"
                              disabled={symbolBusy}
                              style={{
                                background: 'var(--s2)', border: '1px solid var(--br)',
                                color: 'var(--txt)', padding: '3px 6px', fontSize: 10,
                                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                                borderRadius: 2, textTransform: 'uppercase',
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') editSymbol(baseCo.ticker, true)
                                if (e.key === 'Escape') setSymbolEditTicker(null)
                              }}
                            />
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                onClick={() => editSymbol(baseCo.ticker, true)}
                                disabled={symbolBusy || !symbolInput.trim()}
                                style={{
                                  flex: 1, background: 'var(--s2)', border: '1px solid var(--br)',
                                  color: 'var(--cyan2)', fontSize: 9, padding: '3px 6px',
                                  borderRadius: 2, cursor: symbolBusy ? 'wait' : 'pointer',
                                  fontWeight: 700,
                                }}
                              >
                                {symbolBusy ? '…' : 'Test'}
                              </button>
                              <button
                                onClick={() => editSymbol(baseCo.ticker, false)}
                                disabled={symbolBusy || !symbolInput.trim()}
                                style={{
                                  flex: 1, background: 'var(--golddim)', border: '1px solid var(--gold2)',
                                  color: 'var(--gold2)', fontSize: 9, padding: '3px 6px',
                                  borderRadius: 2, cursor: symbolBusy ? 'wait' : 'pointer',
                                  fontWeight: 700,
                                }}
                              >
                                {symbolBusy ? '…' : 'Save'}
                              </button>
                              <button
                                onClick={() => {
                                  setSymbolEditTicker(null)
                                  setSymbolInput('')
                                  setSymbolError(null)
                                  setSymbolOk(null)
                                }}
                                disabled={symbolBusy}
                                style={{
                                  background: 'none', border: '1px solid var(--br)',
                                  color: 'var(--txt3)', fontSize: 9, padding: '3px 6px',
                                  borderRadius: 2, cursor: 'pointer',
                                }}
                              >
                                ✕
                              </button>
                            </div>
                            {symbolError && (
                              <div style={{ color: 'var(--red)', fontSize: 9, fontWeight: 600 }}>
                                {symbolError}
                              </div>
                            )}
                            {symbolOk && (
                              <div style={{ color: 'var(--green)', fontSize: 9, fontWeight: 600 }}>
                                {symbolOk}
                              </div>
                            )}
                          </div>
                        )}
                        {/* ── Industry + Value-Chain pill with ✎ editor ──
                            Shows the current (sec, comp) and opens an inline
                            form so the admin can reclassify the company. The
                            classification lives in user_companies; if the row
                            is currently static-only the Save handler seeds a
                            DB row cloning every other field. */}
                        <div style={{ fontSize: 8, color: 'var(--txt3)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span>IND:</span>
                          <span style={{ color: 'var(--gold2)', fontWeight: 700, textTransform: 'uppercase' }}>
                            {baseCo.sec}
                          </span>
                          {baseCo.comp && baseCo.comp.length > 0 && (
                            <span style={{ color: 'var(--txt3)' }} title={baseCo.comp.join(', ')}>
                              · {baseCo.comp.length === 1 ? baseCo.comp[0] : `${baseCo.comp.length} segs`}
                            </span>
                          )}
                          {Array.isArray(baseCo.subcomp) && baseCo.subcomp.length > 0 ? (
                            <span style={{ color: 'var(--cyan2)', fontWeight: 600 }} title={baseCo.subcomp.join(', ')}>
                              · {baseCo.subcomp.length} sub{baseCo.subcomp.length > 1 ? 's' : ''}
                            </span>
                          ) : (
                            <span
                              style={{ color: 'var(--gold2)', fontWeight: 500, fontStyle: 'italic' }}
                              title="No sub-segment tags set — company is treated as covering all sub-segments in its stage (default / generalist)."
                            >
                              · sub: all (default)
                            </span>
                          )}
                          <button
                            onClick={() => {
                              // Open the editor seeded with the current values
                              // so the admin only types the diff. If the same
                              // row is already open, this acts as a toggle.
                              setClassEditTicker((curr) => (curr === baseCo.ticker ? null : baseCo.ticker))
                              setClassSec(baseCo.sec || 'solar')
                              setClassComp(Array.isArray(baseCo.comp) ? [...baseCo.comp] : [])
                              setClassSubcomp(Array.isArray(baseCo.subcomp) ? [...baseCo.subcomp] : [])
                              setClassError(null)
                              setClassOk(null)
                            }}
                            title="Edit industry / value-chain classification"
                            style={{
                              background: 'none', border: 'none', color: 'var(--gold2)',
                              cursor: 'pointer', fontSize: 10, padding: 0, marginLeft: 'auto',
                            }}
                          >
                            ✎
                          </button>
                        </div>
                        {classEditTicker === baseCo.ticker && (
                          <div style={{
                            marginTop: 4, padding: 6, background: 'var(--s3)',
                            border: '1px solid var(--br)', borderRadius: 3,
                            display: 'flex', flexDirection: 'column', gap: 4,
                          }}>
                            {/* Industry dropdown — pulls from the live registry
                                (availableIndustries), so any atlas-added
                                industry shows up alongside the core
                                Solar / T&D options. */}
                            <label style={{ fontSize: 8, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>
                              Industry
                            </label>
                            <select
                              value={classSec}
                              onChange={(e) => {
                                setClassSec(e.target.value)
                                // Swapping industries clears the current
                                // segment selection — the list of valid
                                // segments is industry-specific, so keeping
                                // the old comp would produce an invalid pair.
                                // Likewise clear the sub-segments — they
                                // belong to the old industry's taxonomy.
                                setClassComp([])
                                setClassSubcomp([])
                              }}
                              disabled={classBusy}
                              style={{
                                background: 'var(--s2)', border: '1px solid var(--br)',
                                color: 'var(--txt)', padding: '3px 6px', fontSize: 10,
                                borderRadius: 2, fontFamily: 'inherit',
                              }}
                            >
                              {availableIndustries.length === 0 ? (
                                <>
                                  <option value="solar">Solar</option>
                                  <option value="td">T&D</option>
                                </>
                              ) : (
                                availableIndustries.map((ind) => (
                                  <option key={ind.id} value={ind.id}>{ind.label}</option>
                                ))
                              )}
                            </select>
                            {/* Value-chain segment — multi-select via a second
                                dropdown + chip list. For most companies
                                comp[] is a single segment; this UI supports
                                multiple so we don't silently drop the
                                second/third entry when a company spans the
                                chain (e.g., integrated players). */}
                            <label style={{ fontSize: 8, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>
                              Value-chain segment{classComp.length > 1 ? 's' : ''}
                            </label>
                            {classComp.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                {classComp.map((segId) => {
                                  const seg = chainSegments.find((s) => s.id === segId)
                                  const label = seg ? seg.name : segId
                                  return (
                                    <span key={segId} style={{
                                      background: 'var(--golddim)', border: '1px solid var(--gold2)',
                                      color: 'var(--gold2)', fontSize: 9, padding: '2px 6px',
                                      borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 4,
                                    }}>
                                      {label}
                                      <button
                                        onClick={() => setClassComp((prev) => prev.filter((x) => x !== segId))}
                                        disabled={classBusy}
                                        title={`Remove ${label}`}
                                        style={{
                                          background: 'none', border: 'none', color: 'var(--gold2)',
                                          cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1,
                                        }}
                                      >
                                        ×
                                      </button>
                                    </span>
                                  )
                                })}
                              </div>
                            )}
                            <select
                              value=""
                              onChange={(e) => {
                                const v = e.target.value
                                if (!v) return
                                if (!classComp.includes(v)) {
                                  setClassComp((prev) => [...prev, v])
                                }
                                // Reset to the placeholder so the same segment
                                // can be re-picked after a remove.
                                e.target.value = ''
                              }}
                              disabled={classBusy}
                              style={{
                                background: 'var(--s2)', border: '1px solid var(--br)',
                                color: 'var(--txt)', padding: '3px 6px', fontSize: 10,
                                borderRadius: 2, fontFamily: 'inherit',
                              }}
                            >
                              <option value="">+ Add segment…</option>
                              {chainSegments
                                .filter((s) => s.sec === classSec && !classComp.includes(s.id))
                                .map((s) => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>

                            {/* ── Sub-segment multi-select (DealNector VC
                                Taxonomy — 668 products across 79 stages).
                                We pull the pool from the FIRST selected
                                value-chain segment; if the admin has picked
                                multiple segments we fall back to the full
                                industry pool so they aren't boxed in. When
                                the industry has no taxonomy mapping (rare),
                                the whole block collapses away — no picker,
                                no visual noise, no empty dropdown.
                                ─────────────────────────────────────────
                                Default semantics (platform-wide): an EMPTY
                                subcomp array is interpreted as "participates
                                in every sub-segment" (generalist). Admins
                                only need to narrow when they want peer-
                                group filtering to exclude a company. The
                                banner below surfaces this so admins don't
                                mistake the empty state for "no coverage". */}
                            {(() => {
                              const pool = classComp.length > 0
                                ? getSubSegmentsForComp(classSec, classComp[0])
                                : getSubSegmentsForIndustry(classSec)
                              if (pool.length === 0) return null
                              const allSelected = pool.length > 0 && pool.every((p) => classSubcomp.includes(p.id))
                              const isDefaultAll = classSubcomp.length === 0
                              const stageLabel = classComp.length > 0 && pool[0]
                                ? `${pool[0].stageCode} · ${pool[0].stageName}`
                                : `Industry pool · ${pool.length} products`
                              return (
                                <>
                                  <label style={{ fontSize: 8, color: 'var(--txt3)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <span>Sub-segment{classSubcomp.length !== 1 ? 's' : ''}</span>
                                    <span style={{ color: 'var(--txt3)', fontWeight: 500, textTransform: 'none', letterSpacing: 0 }}>
                                      · {stageLabel}
                                    </span>
                                    <span style={{ flex: 1 }} />
                                    {/* "All" — company covers every product in
                                        the stage (integrated player). Toggles
                                        between select-all and clear. */}
                                    <button
                                      onClick={() => {
                                        if (allSelected) setClassSubcomp([])
                                        else setClassSubcomp(pool.map((p) => p.id))
                                      }}
                                      disabled={classBusy}
                                      title={allSelected ? 'Clear all sub-segments' : 'Select every sub-segment (integrated player)'}
                                      style={{
                                        background: allSelected ? 'var(--cyandim)' : 'none',
                                        border: '1px solid var(--cyan2)',
                                        color: 'var(--cyan2)', fontSize: 8, padding: '1px 6px',
                                        borderRadius: 8, cursor: classBusy ? 'wait' : 'pointer',
                                        fontWeight: 700, textTransform: 'uppercase',
                                      }}
                                    >
                                      {allSelected ? 'Clear' : `All (${pool.length})`}
                                    </button>
                                  </label>

                                  {/* "Default: all" banner. Surfaces only
                                      when the admin hasn't narrowed yet, so
                                      they realise the platform is already
                                      treating this company as a generalist
                                      (matches every sub-segment filter). */}
                                  {isDefaultAll && (
                                    <div
                                      style={{
                                        background: 'var(--golddim)',
                                        border: '1px dashed var(--gold2)',
                                        color: 'var(--gold2)',
                                        padding: '4px 8px',
                                        borderRadius: 3,
                                        fontSize: 9,
                                        lineHeight: 1.35,
                                        fontStyle: 'italic',
                                      }}
                                      title="Default behavior: a company with no specific sub-segment tags is treated as covering all sub-segments in its stage for peer-group filtering."
                                    >
                                      ℹ Default: treated as <strong>all {pool.length} sub-segments</strong>. Add specific tags below to narrow peer-group comparison.
                                    </div>
                                  )}

                                  {/* Selected sub-segment chips */}
                                  {classSubcomp.length > 0 && (
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                      {classSubcomp.map((subId) => {
                                        const sub = pool.find((p) => p.id === subId)
                                        const label = sub ? sub.name : subId
                                        return (
                                          <span key={subId} style={{
                                            background: 'var(--cyandim)', border: '1px solid var(--cyan2)',
                                            color: 'var(--cyan2)', fontSize: 9, padding: '2px 6px',
                                            borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 4,
                                          }} title={sub ? `${sub.code} — ${sub.stageName}` : subId}>
                                            {label}
                                            <button
                                              onClick={() => setClassSubcomp((prev) => prev.filter((x) => x !== subId))}
                                              disabled={classBusy}
                                              title={`Remove ${label}`}
                                              style={{
                                                background: 'none', border: 'none', color: 'var(--cyan2)',
                                                cursor: 'pointer', fontSize: 11, padding: 0, lineHeight: 1,
                                              }}
                                            >
                                              ×
                                            </button>
                                          </span>
                                        )
                                      })}
                                    </div>
                                  )}

                                  {/* "+ Add sub-segment" dropdown. Hides subs
                                      already picked so the admin can't
                                      double-select. Label shows taxonomy
                                      code in parens for precision. */}
                                  <select
                                    value=""
                                    onChange={(e) => {
                                      const v = e.target.value
                                      if (!v) return
                                      if (!classSubcomp.includes(v)) {
                                        setClassSubcomp((prev) => [...prev, v])
                                      }
                                      e.target.value = ''
                                    }}
                                    disabled={classBusy}
                                    style={{
                                      background: 'var(--s2)', border: '1px solid var(--br)',
                                      color: 'var(--txt)', padding: '3px 6px', fontSize: 10,
                                      borderRadius: 2, fontFamily: 'inherit',
                                    }}
                                  >
                                    <option value="">+ Add sub-segment…</option>
                                    {pool
                                      .filter((s) => !classSubcomp.includes(s.id))
                                      .map((s) => (
                                        <option key={s.id} value={s.id}>
                                          {s.code} · {s.name}
                                        </option>
                                      ))}
                                  </select>
                                </>
                              )
                            })()}

                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                onClick={() => editClassification(baseCo.ticker)}
                                disabled={classBusy || !classSec}
                                style={{
                                  flex: 1, background: 'var(--golddim)', border: '1px solid var(--gold2)',
                                  color: 'var(--gold2)', fontSize: 9, padding: '3px 6px',
                                  borderRadius: 2, cursor: classBusy ? 'wait' : 'pointer',
                                  fontWeight: 700,
                                }}
                              >
                                {classBusy ? '…' : 'Save'}
                              </button>
                              <button
                                onClick={() => {
                                  setClassEditTicker(null)
                                  setClassError(null)
                                  setClassOk(null)
                                }}
                                disabled={classBusy}
                                style={{
                                  background: 'none', border: '1px solid var(--br)',
                                  color: 'var(--txt3)', fontSize: 9, padding: '3px 6px',
                                  borderRadius: 2, cursor: 'pointer',
                                }}
                              >
                                ✕
                              </button>
                            </div>
                            {classError && (
                              <div style={{ color: 'var(--red)', fontSize: 9, fontWeight: 600 }}>
                                {classError}
                              </div>
                            )}
                            {classOk && (
                              <div style={{ color: 'var(--green)', fontSize: 9, fontWeight: 600 }}>
                                {classOk}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td style={stdStyle}>
                        <button onClick={() => refreshOneTicker(baseCo.ticker)}
                          disabled={tickerRefreshing === baseCo.ticker}
                          title={`Refresh ${baseCo.ticker} from Screener.in`}
                          style={{ background: 'none', border: '1px solid var(--br)', color: tickerRefreshing === baseCo.ticker ? 'var(--gold2)' : 'var(--txt3)',
                            width: 22, height: 22, borderRadius: 3, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
                            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          ↻
                        </button>
                      </td>
                      <td style={stdStyle}>
                        <select value={source}
                          onChange={(e) => setSelectedSource((prev) => ({ ...prev, [baseCo.ticker]: e.target.value as typeof source }))}
                          style={{ background: source === 'rapidapi' ? 'var(--golddim)' : source === 'screener' ? 'var(--greendim)' : source === 'exchange' ? 'var(--cyandim)' : 'var(--s3)',
                            border: '1px solid var(--br)', color: 'var(--txt)', fontSize: 9, padding: '3px 4px', borderRadius: 3, fontFamily: 'inherit' }}>
                          <option value="baseline">Baseline</option>
                          <option value="rapidapi">NSE/BSE</option>
                          <option value="screener" disabled={!screener}>Screener</option>
                          <option value="exchange" disabled={!exchange}>DealNector</option>
                        </select>
                      </td>
                      {/* Last Pushed — shows last admin refresh timestamp + source badge */}
                      <td style={{ ...stdStyle, minWidth: 110, fontSize: 9 }}>
                        {(() => {
                          const audit = baselineAuditByTicker[baseCo.ticker]
                          if (!audit?.updatedAt) {
                            return <span style={{ color: 'var(--txt3)', fontStyle: 'italic' }}>never</span>
                          }
                          const at = new Date(audit.updatedAt)
                          const srcLabel = audit.source === 'screener' ? 'Scr'
                            : audit.source === 'exchange' ? 'NSE'
                            : audit.source === 'rapidapi' ? 'API'
                            : (audit.source || 'manual')
                          const srcColor = audit.source === 'screener' ? 'var(--green)'
                            : audit.source === 'exchange' ? 'var(--cyan2)'
                            : audit.source === 'rapidapi' ? 'var(--gold2)'
                            : 'var(--txt2)'
                          return (
                            <div>
                              <span style={{ color: srcColor, fontWeight: 700 }}>{srcLabel}</span>
                              <br />
                              <span style={{ color: 'var(--txt3)', fontSize: 8 }}>
                                {at.toLocaleDateString('en-IN')}<br />{at.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            </div>
                          )
                        })()}
                      </td>
                      {/* Per-row Push button — publishes THIS ticker from the
                          currently selected source (including Baseline, which
                          is treated as source='manual' on the server and is
                          useful for seeding static-only rows into the DB). */}
                      <td style={stdStyle}>
                        <button
                          onClick={() => handlePushOne(baseCo.ticker)}
                          disabled={pushingTicker === baseCo.ticker || publishing}
                          title={source === 'baseline'
                            ? `Push ${baseCo.ticker} baseline to website (seeds or resets the DB row)`
                            : `Push ${baseCo.ticker} from ${source}`}
                          style={{
                            background: source === 'baseline' ? 'rgba(100,180,255,0.14)' : 'var(--golddim)',
                            border: `1px solid ${source === 'baseline' ? 'var(--br2)' : 'var(--gold2)'}`,
                            color: source === 'baseline' ? 'var(--txt2)' : 'var(--gold2)',
                            fontSize: 9, padding: '3px 8px', borderRadius: 3, fontFamily: 'inherit',
                            cursor: 'pointer', fontWeight: 700,
                          }}>
                          {pushingTicker === baseCo.ticker ? '…' : '⇧ Push'}
                        </button>
                      </td>
                      {/* Baseline */}
                      <Cell v={baseCo.mktcap} cr bg={GROUP_BG.baseline} />
                      <Cell v={baseCo.rev} cr bg={GROUP_BG.baseline} />
                      <Cell v={baseCo.ebitda} cr bg={GROUP_BG.baseline} />
                      <Cell v={baseCo.ev} cr bg={GROUP_BG.baseline} />
                      <Cell v={baseCo.ev_eb} suffix="×" bg={GROUP_BG.baseline} />
                      <Cell v={baseCo.pe} suffix="×" bg={GROUP_BG.baseline} />
                      {/* RapidAPI (NSE/BSE Live) */}
                      <Cell v={liveCo.mktcap} cr diff={baseCo.mktcap} bg={GROUP_BG.nseLive} />
                      <Cell v={liveCo.rev} cr diff={baseCo.rev} bg={GROUP_BG.nseLive} />
                      <Cell v={liveCo.ebitda} cr diff={baseCo.ebitda} bg={GROUP_BG.nseLive} />
                      <Cell v={liveCo.ev} cr diff={baseCo.ev} bg={GROUP_BG.nseLive} />
                      <Cell v={liveCo.ev_eb} suffix="×" diff={baseCo.ev_eb} bg={GROUP_BG.nseLive} />
                      <Cell v={liveCo.pe} suffix="×" diff={baseCo.pe} bg={GROUP_BG.nseLive} />
                      {/* Screener */}
                      <Cell v={screener?.mktcapCr} cr diff={baseCo.mktcap} bg={GROUP_BG.screener} />
                      <Cell v={screener?.salesCr} cr diff={baseCo.rev} bg={GROUP_BG.screener} />
                      <Cell v={screener?.ebitdaCr} cr diff={baseCo.ebitda} bg={GROUP_BG.screener} />
                      <Cell v={screener?.evCr} cr diff={baseCo.ev} bg={GROUP_BG.screener} />
                      <Cell v={screener?.evEbitda} suffix="×" diff={baseCo.ev_eb} bg={GROUP_BG.screener} />
                      <Cell v={screener?.pe} suffix="×" diff={baseCo.pe} bg={GROUP_BG.screener} />
                      {/* DealNector API (NSE). Revenue/EBITDA/PAT now come
                          from Screener (NSE dropped the inline flat P&L
                          fields mid-2025); mktcap/PE still come from NSE
                          quote-equity. Every cell falls back through:
                          exchange → screener → null. The full cascade
                          keeps the "DealNector column" populated even
                          for SME tickers where the scrape-exchange SME
                          short-circuit skips the NSE endpoints. */}
                      <Cell v={exchange?.mktcapCr ?? screener?.mktcapCr ?? null} cr diff={baseCo.mktcap} bg={GROUP_BG.dealnector} />
                      <Cell v={exchange?.salesCr ?? screener?.salesCr ?? null} cr diff={baseCo.rev} bg={GROUP_BG.dealnector} />
                      <Cell v={exchange?.ebitdaCr ?? screener?.ebitdaCr ?? null} cr diff={baseCo.ebitda} bg={GROUP_BG.dealnector} />
                      <Cell v={exchange?.evCr ?? screener?.evCr ?? null} cr diff={baseCo.ev} bg={GROUP_BG.dealnector} />
                      <Cell v={exchange?.evEbitda ?? screener?.evEbitda ?? null} suffix="×" diff={baseCo.ev_eb} bg={GROUP_BG.dealnector} />
                      <Cell v={exchange?.pe ?? screener?.pe ?? null} suffix="×" diff={baseCo.pe} bg={GROUP_BG.dealnector} />

                      {/* PUBLISHED (goes to website) — single source of
                          truth merging exchange → screener → baseline
                          per field. Each cell tagged with the source
                          that contributed the number so the admin can
                          see at a glance whether a row is fresh (DN /
                          SCR) or relying on the curated seed (BASE).
                          The helper buildPublishedPreview is the SAME
                          cascade used by buildBatchOverrides when
                          auto-publishing, so the UI preview can never
                          disagree with the actual DB write. */}
                      {(() => {
                        const screenerAsLike = screener as unknown as ScreenerLike | undefined
                        const pub = buildPublishedPreview(baseCo.ticker, exchange ?? null, screenerAsLike, baseCo)
                        return <>
                          <PublishedCell v={pub.values.mktcap} cr source={pub.sources.mktcap as 'dealnector' | 'screener' | 'baseline' | 'none'} />
                          <PublishedCell v={pub.values.rev}    cr source={pub.sources.rev    as 'dealnector' | 'screener' | 'baseline' | 'none'} />
                          <PublishedCell v={pub.values.ebitda} cr source={pub.sources.ebitda as 'dealnector' | 'screener' | 'baseline' | 'none'} />
                          <PublishedCell v={pub.values.ev}     cr source={pub.sources.ev     as 'dealnector' | 'screener' | 'baseline' | 'none'} />
                          <PublishedCell v={pub.values.ev_eb}  suffix="×" source={pub.sources.ev_eb as 'dealnector' | 'screener' | 'baseline' | 'none'} />
                          <PublishedCell v={pub.values.pe}     suffix="×" source={pub.sources.pe    as 'dealnector' | 'screener' | 'baseline' | 'none'} />
                        </>
                      })()}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ─── SUB-TAB: RATIOS & WORKING CAPITAL ─── */}
      {subTab === 'ratios' && (
        <>
          <div style={{ marginBottom: 10, fontSize: 11, color: 'var(--txt3)' }}>
            Multi-year ratio data from Screener.in — Debtor Days (DSO), Inventory Days (DIO), Days Payable (DPO),
            Cash Conversion Cycle, Working Capital Days, ROCE%. {Object.keys(screenerRatios).length === 0 && 'Click "Refresh Screener" above to fetch.'}
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid var(--br)', borderRadius: 6, background: 'var(--s2)' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 10, whiteSpace: 'nowrap', minWidth: 1600 }}>
              <thead>
                <tr style={{ background: 'var(--s3)' }}>
                  <th style={{ ...sthStyle, position: 'sticky', left: 0, background: 'var(--s3)', zIndex: 2 }}>Company</th>
                  <th style={sthStyle}>Metric</th>
                  {/* Dynamic year columns from the first available company */}
                  {(Object.values(screenerRatios)[0]?.years || []).map((y) => (
                    <th key={y.year} style={sthStyle}>{y.year}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(screenerRatios)
                  .filter(([ticker, ratioRow]) => {
                    const q = companySearch.trim().toLowerCase()
                    if (!q) return true
                    if (ticker.toLowerCase().includes(q)) return true
                    if ((ratioRow.name || '').toLowerCase().includes(q)) return true
                    return false
                  })
                  .map(([ticker, ratioRow]) => {
                  type RatioNumKey = 'debtorDays' | 'inventoryDays' | 'daysPayable' | 'cashConversionCycle' | 'workingCapitalDays' | 'rocePct'
                  const metrics: Array<{ label: string; key: RatioNumKey }> = [
                    { label: 'Debtor Days (DSO)', key: 'debtorDays' },
                    { label: 'Inventory Days (DIO)', key: 'inventoryDays' },
                    { label: 'Days Payable (DPO)', key: 'daysPayable' },
                    { label: 'Cash Conv. Cycle', key: 'cashConversionCycle' },
                    { label: 'Working Cap. Days', key: 'workingCapitalDays' },
                    { label: 'ROCE %', key: 'rocePct' },
                  ]
                  return metrics.map((m, mi) => (
                    <tr key={`${ticker}-${m.key}`} style={{
                      borderBottom: mi === metrics.length - 1 ? '2px solid var(--br)' : '1px solid var(--br)',
                      background: mi === metrics.length - 1 ? 'rgba(247,183,49,0.03)' : undefined,
                    }}>
                      {mi === 0 && (
                        <td rowSpan={metrics.length} style={{ ...stdStyle, fontWeight: 600, color: 'var(--txt)', position: 'sticky', left: 0, background: 'var(--s2)', zIndex: 1, verticalAlign: 'top', borderRight: '1px solid var(--br)' }}>
                          {ratioRow.name}<br /><span style={{ fontSize: 8, color: 'var(--txt3)' }}>{ticker}</span>
                        </td>
                      )}
                      <td style={{ ...stdStyle, color: 'var(--txt2)', fontWeight: 500 }}>{m.label}</td>
                      {ratioRow.years.map((y) => {
                        const val: number | null = y[m.key]
                        return (
                          <td key={y.year} style={{ ...stdStyle, fontFamily: 'JetBrains Mono, monospace', textAlign: 'right' }}>
                            {val != null ? (m.key === 'rocePct' ? `${val.toFixed(1)}%` : String(Math.round(val))) : '—'}
                          </td>
                        )
                      })}
                    </tr>
                  ))
                })}
                {Object.keys(screenerRatios).length === 0 && (
                  <tr><td colSpan={20} style={{ ...stdStyle, textAlign: 'center', padding: 24, color: 'var(--txt3)', fontStyle: 'italic' }}>
                    No ratio data yet. Click "↻ Refresh Screener" above to fetch multi-year ratios for all companies.
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ─── SUB-TAB: DISCOVER SME ─── */}
      {subTab === 'discover' && (
        <>
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 10 }}>
              Search Screener.in for companies by keyword (works for NSE, BSE, and SME-listed).
              Use the value chain filter below to narrow by segment, or type any keyword.
            </div>

            {/* Value chain quick-filter row */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 9, color: 'var(--txt3)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
                Quick filter:
              </span>
              {(['all', 'solar', 'td'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    if (s === 'solar') setDiscoverQuery('solar')
                    else if (s === 'td') setDiscoverQuery('transformer cable power')
                    else setDiscoverQuery('')
                  }}
                  style={{
                    ...srcBtn, fontSize: 9, padding: '3px 10px',
                    background: (s === 'solar' && discoverQuery.includes('solar')) || (s === 'td' && discoverQuery.includes('transformer'))
                      ? 'var(--golddim)' : 'var(--s3)',
                    borderColor: (s === 'solar' && discoverQuery.includes('solar')) || (s === 'td' && discoverQuery.includes('transformer'))
                      ? 'var(--gold2)' : 'var(--br2)',
                    color: (s === 'solar' && discoverQuery.includes('solar')) || (s === 'td' && discoverQuery.includes('transformer'))
                      ? 'var(--gold2)' : 'var(--txt2)',
                  }}
                >
                  {s === 'all' ? 'All' : s === 'solar' ? '☀ Solar' : '⚡ T&D'}
                </button>
              ))}
              <select
                onChange={(e) => {
                  if (e.target.value) setDiscoverQuery(e.target.value)
                }}
                value=""
                style={{
                  background: 'var(--s3)', border: '1px solid var(--br)', color: 'var(--txt)',
                  fontSize: 10, padding: '4px 8px', borderRadius: 4, fontFamily: 'inherit', cursor: 'pointer',
                }}
              >
                <option value="">— Value chain segment —</option>
                {chainSegments.map((s) => (
                  <option key={s.id} value={s.name.toLowerCase().replace(/[^a-z0-9\s]/g, '')}>
                    {s.sec === 'solar' ? '☀' : '⚡'} {s.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Search bar */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input value={discoverQuery} onChange={(e) => setDiscoverQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleDiscover()}
                placeholder="Search: solar module, transformer, cable, inverter, meter…"
                style={{ flex: 1, maxWidth: 500, background: 'var(--s3)', border: '1px solid var(--br)',
                  color: 'var(--txt)', padding: '8px 12px', fontSize: 12, borderRadius: 4, outline: 'none', fontFamily: 'inherit' }} />
              <button onClick={handleDiscover} disabled={discoverLoading}
                style={{ ...srcBtn, background: discoverLoading ? 'var(--s3)' : 'var(--golddim)', borderColor: 'var(--gold2)', color: 'var(--gold2)' }}>
                {discoverLoading ? 'Searching…' : '🔍 Search'}
              </button>
            </div>
          </div>
          {discoverError && (
            <div style={{ marginBottom: 10, padding: '10px 14px', background: 'var(--reddim)', border: '1px solid var(--red)', borderRadius: 4, color: 'var(--red)', fontSize: 12 }}>
              {discoverError}
            </div>
          )}
          {discoverResults.length > 0 && (
            <div style={{ overflowX: 'auto', border: '1px solid var(--br)', borderRadius: 6, background: 'var(--s2)' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%' }}>
                <thead>
                  <tr style={{ background: 'var(--s3)' }}>
                    <th style={sthStyle}>Company</th>
                    <th style={sthStyle}>Code</th>
                    <th style={sthStyle}>Exchange</th>
                    <th style={sthStyle}>Sector</th>
                    <th style={sthStyle}>Value Chain</th>
                    <th style={sthStyle}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {discoverResults.map((r) => {
                    // Match by ticker, NSE code, OR company name (fuzzy — first two words)
                    const rNameLower = r.name.toLowerCase()
                    const rNameWords = rNameLower.split(/\s+/).slice(0, 2).join(' ')
                    const alreadyTracked = allCompanies.some((c) => {
                      if (c.ticker === r.code || c.nse === r.code) return true
                      // Fuzzy name match: if the first 2 words of both names match
                      const cNameWords = c.name.toLowerCase().split(/\s+/).slice(0, 2).join(' ')
                      return cNameWords === rNameWords
                    }) || addedTickers.has(r.code)
                    return (
                      <tr key={r.id} style={{ borderBottom: '1px solid var(--br)' }}>
                        <td style={{ ...stdStyle, fontWeight: 600, color: 'var(--txt)' }}>
                          {r.name}
                          <br />
                          <a href={r.screenerUrl} target="_blank" rel="noopener noreferrer"
                            style={{ color: 'var(--cyan2)', fontSize: 9, textDecoration: 'underline' }}>
                            Screener ↗
                          </a>
                        </td>
                        <td style={{ ...stdStyle, fontFamily: 'JetBrains Mono, monospace', color: 'var(--gold2)' }}>{r.code}</td>
                        <td style={stdStyle}>{r.exchange}</td>
                        <td style={stdStyle}>
                          <select
                            value={discoverSec[r.id] || 'solar'}
                            onChange={(e) => setDiscoverSec((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            style={{ background: 'var(--s3)', border: '1px solid var(--br)', color: 'var(--txt)', fontSize: 10, padding: '3px 6px', borderRadius: 3, fontFamily: 'inherit' }}
                          >
                            {/* Core industries first, then every registered
                                industry from the registry. `availableIndustries`
                                already includes solar/td, so we just render it. */}
                            {availableIndustries.length === 0 ? (
                              <>
                                <option value="solar">Solar</option>
                                <option value="td">T&D</option>
                              </>
                            ) : (
                              availableIndustries.map((ind) => (
                                <option key={ind.id} value={ind.id}>{ind.label}</option>
                              ))
                            )}
                          </select>
                        </td>
                        <td style={stdStyle}>
                          <select
                            value={discoverComp[r.id] || ''}
                            onChange={(e) => setDiscoverComp((prev) => ({ ...prev, [r.id]: e.target.value }))}
                            style={{ background: 'var(--s3)', border: '1px solid var(--br)', color: 'var(--txt)', fontSize: 10, padding: '3px 6px', borderRadius: 3, fontFamily: 'inherit', maxWidth: 150 }}
                          >
                            <option value="">— Select segment —</option>
                            {chainSegments
                              .filter((s) => s.sec === (discoverSec[r.id] || 'solar'))
                              .map((s) => (
                                <option key={s.id} value={s.id}>{s.name}</option>
                              ))}
                          </select>
                        </td>
                        <td style={stdStyle}>
                          {alreadyTracked ? (
                            <span style={{
                              color: addedTickers.has(r.code) ? 'var(--cyan2)' : 'var(--green)',
                              fontSize: 10, fontWeight: 600,
                            }}>
                              {addedTickers.has(r.code) ? '✓ Just added' : '✓ Tracked'}
                            </span>
                          ) : (
                            <button
                              onClick={() => addDiscoveredCompany(r.name, r.code, r.id)}
                              disabled={addingCode === r.code}
                              title={addingCode === r.code ? 'Adding…' : `Add ${r.name} to the platform`}
                              style={{
                                ...srcBtn, fontSize: 9, padding: '4px 12px',
                                background: addingCode === r.code ? 'var(--s3)' : 'var(--golddim)',
                                borderColor: 'var(--gold2)',
                                color: addingCode === r.code ? 'var(--txt3)' : 'var(--gold2)',
                                cursor: addingCode === r.code ? 'wait' : 'pointer',
                              }}>
                              {addingCode === r.code ? '⏳ Adding…' : '+ Add to Platform'}
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <div style={{ marginTop: 8, fontSize: 9, color: 'var(--txt3)' }}>
        Screener: {Object.keys(screenerData).length} companies · {Object.keys(screenerRatios).length} with ratios
        {screenerTime && ` · last ${screenerTime}`}
        {' · '}NSE/BSE: {Object.keys(liveTickers).length} tickers
        {' · '}DealNector API (NSE): {Object.keys(exchangeData).length} tickers
        {exchangeTime && ` · last ${exchangeTime}`}
        {' · '}All ₹ in Crores (Indian commas).
      </div>
    </div>
  )
}

// ── Push Data tab component ──────────────────────────────────
// Source-focused admin workflow: pick ONE source (NSE/BSE · Screener · RapidAPI),
// fetch data for all companies, then push individually per-row or all at once.

type PushSource = 'exchange' | 'screener' | 'rapidapi'

function PushDataTab() {
  const {
    tickers: liveTickers,
    deriveCompany,
    refreshRapidApi,
    loading: rapidLoading,
    // allCompanies = static seed + DB-added (admin discovery, SME etc.).
    // We filter from this so SME / admin-added companies actually show
    // up in the Push Data tab grid and can be pushed.
    allCompanies,
    // After every push we hit this + fire the sg4:data-pushed event so
    // every mounted page's useLiveSnapshot reads the fresh DB row.
    reloadDbCompanies,
  } = useLiveSnapshot()

  const [pushSource, setPushSource] = useState<PushSource>('exchange')
  const [sectorFilter, setSectorFilter] = useState<'all' | 'solar' | 'td'>('all')
  const [search, setSearch] = useState('')

  // Per-source fetched data (shares cache with DataSourcesTab via localStorage keys)
  const [exchangeData, setExchangeData] = useState<Record<string, ExchangeRow>>({})
  const [screenerData, setScreenerData] = useState<Record<string, ScreenerRow>>({})

  const [fetching, setFetching] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [fetchTime, setFetchTime] = useState<Record<PushSource, string | null>>({
    exchange: null,
    screener: null,
    rapidapi: null,
  })

  const [pushingTicker, setPushingTicker] = useState<string | null>(null)
  const [pushingAll, setPushingAll] = useState(false)
  const [pushedTickers, setPushedTickers] = useState<Set<string>>(new Set())
  const [statusMsg, setStatusMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)

  // Hydrate cached data from localStorage on mount (shared with DataSourcesTab)
  useEffect(() => {
    try {
      const cachedScr = localStorage.getItem('sg4_screener_data')
      const cachedScrTime = localStorage.getItem('sg4_screener_time')
      if (cachedScr) setScreenerData(JSON.parse(cachedScr))
      if (cachedScrTime) {
        setFetchTime((prev) => ({ ...prev, screener: new Date(cachedScrTime).toLocaleString('en-IN') }))
      }
      const cachedEx = localStorage.getItem('sg4_exchange_data')
      const cachedExTime = localStorage.getItem('sg4_exchange_time')
      if (cachedEx) setExchangeData(JSON.parse(cachedEx))
      if (cachedExTime) {
        setFetchTime((prev) => ({ ...prev, exchange: new Date(cachedExTime).toLocaleString('en-IN') }))
      }
    } catch { /* ignore */ }
  }, [])

  // Filter companies by sector + search.
  //
  // Previously this filtered from the static COMPANIES array only,
  // which meant admin-added SME/discovery rows (live in user_companies)
  // could never be pushed from this tab. Now we source from
  // allCompanies = static seed merged with DB rows, so every company
  // that exists in the platform — including SMEs added via the
  // Industries/Discovery flow — is available for refresh.
  const filteredCompanies = useMemo(() => {
    const q = search.trim().toLowerCase()
    return allCompanies.filter((co) => {
      if (sectorFilter !== 'all' && co.sec !== sectorFilter) return false
      if (q && !co.name.toLowerCase().includes(q) && !co.ticker.toLowerCase().includes(q)) return false
      return true
    })
  }, [allCompanies, sectorFilter, search])

  // Build the override patch for a ticker from the currently selected source
  const buildPatch = (co: Company): Partial<Company> | null => {
    if (pushSource === 'exchange') {
      const ex = exchangeData[co.ticker]
      if (!ex) return null
      // DealNector (NSE) now fetches quote-equity + corporates-financial-results.
      // salesCr/patCr come from the annual filing; ebitdaCr/ebm/revgPct are
      // derived from that revenue × baseline margin. When NSE has no filing
      // (fresh IPO / quarterly-only history), fall back onto the already-fetched
      // Screener row so no column ends up empty.
      const scr = screenerData[co.ticker]
      const patch: Partial<Company> = {}
      if (ex.mktcapCr != null) patch.mktcap = ex.mktcapCr
      if ((ex.salesCr ?? scr?.salesCr) != null) patch.rev = (ex.salesCr ?? scr?.salesCr) as number
      if ((ex.ebitdaCr ?? scr?.ebitdaCr) != null) patch.ebitda = (ex.ebitdaCr ?? scr?.ebitdaCr) as number
      if ((ex.patCr ?? scr?.netProfitCr) != null) patch.pat = (ex.patCr ?? scr?.netProfitCr) as number
      if (ex.evCr != null) patch.ev = ex.evCr
      if (ex.evEbitda != null) patch.ev_eb = ex.evEbitda
      if ((ex.pe ?? scr?.pe) != null) patch.pe = (ex.pe ?? scr?.pe) as number
      if ((ex.revgPct ?? scr?.revgPct) != null) patch.revg = (ex.revgPct ?? scr?.revgPct) as number
      if ((ex.ebm ?? scr?.ebm) != null) patch.ebm = (ex.ebm ?? scr?.ebm) as number
      return Object.keys(patch).length > 0 ? patch : null
    }
    if (pushSource === 'screener') {
      const scr = screenerData[co.ticker]
      if (!scr) return null
      const patch: Partial<Company> = {}
      if (scr.mktcapCr != null) patch.mktcap = scr.mktcapCr
      if (scr.salesCr != null) patch.rev = scr.salesCr
      if (scr.ebitdaCr != null) patch.ebitda = scr.ebitdaCr
      if (scr.netProfitCr != null) patch.pat = scr.netProfitCr
      if (scr.evCr != null) patch.ev = scr.evCr
      if (scr.evEbitda != null) patch.ev_eb = scr.evEbitda
      if (scr.pe != null) patch.pe = scr.pe
      if (scr.pbRatio != null) patch.pb = scr.pbRatio
      if (scr.dbtEq != null) patch.dbt_eq = scr.dbtEq
      if (scr.ebm != null) patch.ebm = scr.ebm
      return Object.keys(patch).length > 0 ? patch : null
    }
    if (pushSource === 'rapidapi') {
      const live = liveTickers[co.ticker]
      if (!live) return null
      const derived = deriveCompany(co).company
      // Only include fields that differ from the baseline — means RapidAPI actually provided them
      const patch: Partial<Company> = {
        mktcap: derived.mktcap, rev: derived.rev, ebitda: derived.ebitda, pat: derived.pat,
        ev: derived.ev, ev_eb: derived.ev_eb, pe: derived.pe, pb: derived.pb,
        dbt_eq: derived.dbt_eq, ebm: derived.ebm,
      }
      return patch
    }
    return null
  }

  // Count companies that have fetched data from the selected source
  const availableCount = useMemo(() => {
    return filteredCompanies.filter((co) => buildPatch(co) !== null).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pushSource, exchangeData, screenerData, liveTickers, filteredCompanies])

  // ── Fetch from selected source ──
  const fetchFromSource = async () => {
    setFetchError(null)
    setStatusMsg(null)
    setFetching(true)
    try {
      if (pushSource === 'exchange') {
        const res = await fetch('/api/admin/scrape-exchange', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
        })
        const json = await safeJson(res)
        if (!json.ok) throw new Error(json.error || 'Fetch failed')
        setExchangeData(json.data || {})
        const t = new Date().toLocaleString('en-IN')
        setFetchTime((prev) => ({ ...prev, exchange: t }))
        try {
          localStorage.setItem('sg4_exchange_data', JSON.stringify(json.data))
          localStorage.setItem('sg4_exchange_time', new Date().toISOString())
        } catch { /* ignore */ }
        setStatusMsg({ kind: 'success', text: `Fetched ${Object.keys(json.data || {}).length} tickers from NSE/BSE.` })
      } else if (pushSource === 'screener') {
        const res = await fetch('/api/admin/scrape-screener', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}),
        })
        const json = await safeJson(res)
        if (!json.ok) throw new Error(json.error || 'Fetch failed')
        setScreenerData(json.data || {})
        const t = new Date().toLocaleString('en-IN')
        setFetchTime((prev) => ({ ...prev, screener: t }))
        try {
          localStorage.setItem('sg4_screener_data', JSON.stringify(json.data))
          localStorage.setItem('sg4_screener_time', new Date().toISOString())
        } catch { /* ignore */ }
        setStatusMsg({ kind: 'success', text: `Fetched ${Object.keys(json.data || {}).length} tickers from Screener.in.` })
      } else if (pushSource === 'rapidapi') {
        await refreshRapidApi()
        const t = new Date().toLocaleString('en-IN')
        setFetchTime((prev) => ({ ...prev, rapidapi: t }))
        setStatusMsg({ kind: 'success', text: `Refreshed RapidAPI cache.` })
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setFetching(false)
    }
  }

  // ── Push a single ticker ──
  const pushOne = async (co: Company) => {
    const patch = buildPatch(co)
    if (!patch) {
      setStatusMsg({ kind: 'error', text: `No ${sourceLabel(pushSource)} data available for ${co.ticker}. Fetch first.` })
      return
    }
    setPushingTicker(co.ticker)
    setStatusMsg(null)
    try {
      const res = await fetch('/api/admin/publish-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides: { [co.ticker]: patch } }),
      })
      const json = await safeJson(res)
      if (!res.ok || !json.ok) throw new Error(json.error || 'Push failed')
      setPushedTickers((prev) => { const next = new Set(Array.from(prev)); next.add(co.ticker); return next })
      // Critical: refresh the in-memory user_companies list AND broadcast
      // to every mounted page so Dashboard / M&A Radar / Valuation /
      // Watchlist / Compare all pull the new row. Without this step the
      // DB is updated but the UI shows stale numbers until a full reload.
      await reloadDbCompanies()
      broadcastDataPushed([co.ticker], pushSource)
      setStatusMsg({
        kind: 'success',
        text: `✓ Pushed ${co.name} (${co.ticker}) — ${json.updatedCount || 0} updated${json.insertedCount ? `, ${json.insertedCount} inserted` : ''}. Live across all pages.`,
      })
    } catch (err) {
      setStatusMsg({ kind: 'error', text: `Push failed for ${co.ticker}: ${err instanceof Error ? err.message : 'Network error'}` })
    } finally {
      setPushingTicker(null)
    }
  }

  // ── Push all filtered tickers that have data ──
  const pushAll = async () => {
    setPushingAll(true)
    setStatusMsg(null)
    const overrides: Record<string, Partial<Company>> = {}
    for (const co of filteredCompanies) {
      const patch = buildPatch(co)
      if (patch) overrides[co.ticker] = patch
    }
    const tickerList = Object.keys(overrides)
    if (tickerList.length === 0) {
      setStatusMsg({ kind: 'error', text: `No data to push. Fetch from ${sourceLabel(pushSource)} first.` })
      setPushingAll(false)
      return
    }
    try {
      const res = await fetch('/api/admin/publish-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      })
      const json = await safeJson(res)
      if (!res.ok || !json.ok) throw new Error(json.error || 'Push all failed')
      setPushedTickers((prev) => {
        const next = new Set(Array.from(prev))
        for (const t of tickerList) next.add(t)
        return next
      })
      // Same story as pushOne — refresh + broadcast so every page picks
      // up the batch without a hard reload.
      await reloadDbCompanies()
      broadcastDataPushed(tickerList, pushSource)
      setStatusMsg({
        kind: 'success',
        text: `✓ Pushed ${json.updatedCount || 0} companies from ${sourceLabel(pushSource)}${json.skipped?.length ? ` · ${json.skipped.length} skipped` : ''}. Live across all pages.`,
      })
    } catch (err) {
      setStatusMsg({ kind: 'error', text: `Push all failed: ${err instanceof Error ? err.message : 'Network error'}` })
    } finally {
      setPushingAll(false)
    }
  }

  // When source changes, clear the "just pushed" indicators so stale ticks don't mislead
  useEffect(() => {
    setPushedTickers(new Set())
    setStatusMsg(null)
  }, [pushSource])

  const sourceColor = pushSource === 'exchange' ? 'var(--cyan2)'
    : pushSource === 'screener' ? 'var(--green)' : 'var(--gold2)'

  const isFetching = pushSource === 'rapidapi' ? rapidLoading : fetching

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.4px', textTransform: 'uppercase', color: 'var(--gold2)' }}>
          Push Data — Admin Only
        </div>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)', marginTop: 2 }}>
          Fetch from a single source, then push individual or all tickers to the website
        </div>
      </div>

      {/* Source selector */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        padding: '12px 14px', marginBottom: 10,
        background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6,
      }}>
        <span style={{ fontSize: 9, color: 'var(--txt3)', fontWeight: 700, letterSpacing: '1.2px', textTransform: 'uppercase' }}>
          Source:
        </span>
        {([
          ['exchange', 'NSE/BSE', 'var(--cyan2)', 'rgba(0,180,216,0.12)'],
          ['screener', 'Screener.in', 'var(--green)', 'rgba(16,185,129,0.12)'],
          ['rapidapi', 'RapidAPI', 'var(--gold2)', 'rgba(247,183,49,0.12)'],
        ] as Array<[PushSource, string, string, string]>).map(([val, label, color, bg]) => {
          const active = pushSource === val
          return (
            <button key={val} onClick={() => setPushSource(val)}
              style={{
                ...srcBtn,
                background: active ? bg : 'var(--s3)',
                borderColor: active ? color : 'var(--br2)',
                color: active ? color : 'var(--txt2)',
                fontWeight: active ? 700 : 500,
              }}>
              {label}
            </button>
          )
        })}
        <div style={{ flex: 1 }} />
        <button onClick={fetchFromSource} disabled={isFetching}
          style={{
            ...srcBtn,
            background: isFetching ? 'var(--s3)' : sourceColor === 'var(--gold2)' ? 'rgba(247,183,49,0.12)'
              : sourceColor === 'var(--green)' ? 'rgba(16,185,129,0.12)' : 'rgba(0,180,216,0.12)',
            borderColor: sourceColor, color: sourceColor, cursor: isFetching ? 'wait' : 'pointer',
          }}>
          {isFetching ? 'Fetching…' : `↻ Fetch from ${sourceLabel(pushSource)}`}
        </button>
        {fetchTime[pushSource] && (
          <span style={{ fontSize: 9, color: 'var(--txt3)' }}>
            Last fetched: <strong style={{ color: sourceColor }}>{fetchTime[pushSource]}</strong>
          </span>
        )}
      </div>

      {/* Filters + push-all bar */}
      <div style={{
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
        marginBottom: 10, fontSize: 10,
      }}>
        <span style={{ color: 'var(--txt3)', fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase' }}>
          Filter:
        </span>
        {(['all', 'solar', 'td'] as const).map((s) => (
          <button key={s} onClick={() => setSectorFilter(s)}
            style={{
              ...srcBtn, fontSize: 9, padding: '3px 10px',
              background: sectorFilter === s ? 'var(--golddim)' : 'var(--s3)',
              borderColor: sectorFilter === s ? 'var(--gold2)' : 'var(--br2)',
              color: sectorFilter === s ? 'var(--gold2)' : 'var(--txt2)',
            }}>
            {s === 'all' ? 'All' : s === 'solar' ? '☀ Solar' : '⚡ T&D'}
          </button>
        ))}
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or ticker…"
          style={{
            background: 'var(--s3)', border: '1px solid var(--br)', color: 'var(--txt)',
            padding: '5px 10px', fontSize: 11, borderRadius: 3, fontFamily: 'inherit',
            outline: 'none', minWidth: 220,
          }} />
        <span style={{ color: 'var(--txt3)', fontSize: 10 }}>
          {filteredCompanies.length} companies · <strong style={{ color: sourceColor }}>{availableCount}</strong> with {sourceLabel(pushSource)} data
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={pushAll} disabled={pushingAll || availableCount === 0}
          title={availableCount === 0 ? `Fetch from ${sourceLabel(pushSource)} first` : `Push all ${availableCount} companies`}
          style={{
            background: pushingAll || availableCount === 0 ? 'var(--s3)' : 'var(--green)',
            color: pushingAll || availableCount === 0 ? 'var(--txt3)' : '#fff',
            border: 'none', padding: '7px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
            textTransform: 'uppercase', borderRadius: 4,
            cursor: pushingAll ? 'wait' : availableCount === 0 ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
          }}>
          {pushingAll ? 'Pushing all…' : `✓ Push All (${availableCount})`}
        </button>
      </div>

      {/* Status messages */}
      {fetchError && (
        <div style={{ marginBottom: 10, padding: '8px 12px', background: 'var(--reddim)', border: '1px solid var(--red)', borderRadius: 4, color: 'var(--red)', fontSize: 11 }}>
          ✗ Fetch error: {fetchError}
        </div>
      )}
      {statusMsg && (
        <div style={{
          marginBottom: 10, padding: '8px 12px', borderRadius: 4, fontSize: 11,
          background: statusMsg.kind === 'success' ? 'var(--greendim)' : statusMsg.kind === 'error' ? 'var(--reddim)' : 'var(--s3)',
          color: statusMsg.kind === 'success' ? 'var(--green)' : statusMsg.kind === 'error' ? 'var(--red)' : 'var(--txt2)',
          border: `1px solid ${statusMsg.kind === 'success' ? 'var(--green)' : statusMsg.kind === 'error' ? 'var(--red)' : 'var(--br)'}`,
        }}>
          {statusMsg.text}
        </div>
      )}

      {/* Data table */}
      <div style={{ overflowX: 'auto', border: '1px solid var(--br)', borderRadius: 6, background: 'var(--s2)' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 10, whiteSpace: 'nowrap', minWidth: 1400, width: '100%' }}>
          <thead>
            <tr style={{ background: 'var(--s3)' }}>
              <th style={{ ...sthStyle, position: 'sticky', left: 0, background: 'var(--s3)', zIndex: 2 }}>Company</th>
              <th style={sthStyle}>Sector</th>
              <th style={{ ...sthStyle, background: 'rgba(100,180,255,0.06)' }} colSpan={2}>Current Baseline</th>
              <th style={{ ...sthStyle, background: `${sourceColor === 'var(--cyan2)' ? 'rgba(0,180,216,0.08)' : sourceColor === 'var(--green)' ? 'rgba(16,185,129,0.08)' : 'rgba(247,183,49,0.08)'}` }} colSpan={4}>
                {sourceLabel(pushSource)} (fetched)
              </th>
              <th style={sthStyle}>Action</th>
            </tr>
            <tr style={{ background: 'var(--s3)' }}>
              <th style={{ ...sthStyle, position: 'sticky', left: 0, background: 'var(--s3)', zIndex: 2 }}></th>
              <th style={sthStyle}></th>
              <th style={sthStyle}>MktCap</th>
              <th style={sthStyle}>EV</th>
              <th style={sthStyle}>MktCap</th>
              <th style={sthStyle}>EV</th>
              <th style={sthStyle}>EV/EB</th>
              <th style={sthStyle}>P/E</th>
              <th style={sthStyle}></th>
            </tr>
          </thead>
          <tbody>
            {filteredCompanies.map((co) => {
              const patch = buildPatch(co)
              const hasData = patch !== null
              const fetchedMktcap = patch?.mktcap ?? null
              const fetchedEv = patch?.ev ?? null
              const fetchedEvEb = patch?.ev_eb ?? null
              const fetchedPe = patch?.pe ?? null
              const justPushed = pushedTickers.has(co.ticker)
              const isPushing = pushingTicker === co.ticker
              return (
                <tr key={co.ticker} style={{ borderBottom: '1px solid var(--br)' }}>
                  <td style={{ ...stdStyle, fontWeight: 600, color: 'var(--txt)', position: 'sticky', left: 0, background: 'var(--s2)', zIndex: 1, minWidth: 180 }}>
                    {co.name}<br />
                    <span style={{ fontSize: 8, color: 'var(--txt3)' }}>{co.ticker}</span>
                  </td>
                  <td style={stdStyle}>
                    <span style={{ fontSize: 9, color: co.sec === 'solar' ? 'var(--gold2)' : 'var(--cyan2)' }}>
                      {co.sec === 'solar' ? '☀ Solar' : '⚡ T&D'}
                    </span>
                  </td>
                  <Cell v={co.mktcap} cr />
                  <Cell v={co.ev} cr />
                  <Cell v={fetchedMktcap} cr diff={co.mktcap} />
                  <Cell v={fetchedEv} cr diff={co.ev} />
                  <Cell v={fetchedEvEb} suffix="×" diff={co.ev_eb} />
                  <Cell v={fetchedPe} suffix="×" diff={co.pe} />
                  <td style={stdStyle}>
                    {justPushed ? (
                      <span style={{ color: 'var(--green)', fontSize: 10, fontWeight: 600 }}>✓ Pushed</span>
                    ) : (
                      <button onClick={() => pushOne(co)} disabled={!hasData || isPushing}
                        title={!hasData ? `No ${sourceLabel(pushSource)} data — fetch first` : `Push ${co.ticker} from ${sourceLabel(pushSource)}`}
                        style={{
                          ...srcBtn, fontSize: 9, padding: '3px 10px',
                          background: !hasData ? 'var(--s3)' : isPushing ? 'var(--s3)' : 'rgba(16,185,129,0.12)',
                          borderColor: !hasData ? 'var(--br)' : 'var(--green)',
                          color: !hasData ? 'var(--txt3)' : isPushing ? 'var(--txt3)' : 'var(--green)',
                          cursor: !hasData ? 'not-allowed' : isPushing ? 'wait' : 'pointer',
                        }}>
                        {isPushing ? '⏳ Pushing…' : '→ Push'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {filteredCompanies.length === 0 && (
              <tr>
                <td colSpan={9} style={{ ...stdStyle, textAlign: 'center', padding: 24, color: 'var(--txt3)', fontStyle: 'italic' }}>
                  No companies match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, fontSize: 9, color: 'var(--txt3)' }}>
        Source: <strong style={{ color: sourceColor }}>{sourceLabel(pushSource)}</strong>
        {' · '}Pushes upsert to <code>user_companies</code> DB table.
        {' · '}DealNector (NSE) pulls quote + annual filings; if filings are missing it falls back to Screener so every column is populated. Screener &amp; RapidAPI push full P&amp;L including P/B + D/E.
        {' · '}All ₹ in Crores.
      </div>
    </div>
  )
}

function sourceLabel(s: PushSource): string {
  return s === 'exchange' ? 'NSE/BSE' : s === 'screener' ? 'Screener.in' : 'RapidAPI'
}

function Cell({
  v,
  cr,
  suffix,
  diff,
  bg,
}: {
  v: number | null | undefined
  cr?: boolean
  suffix?: string
  diff?: number
  /**
   * Optional source-group background tint. Passed from each group of
   * six data cells (Baseline / NSE-BSE / Screener / DealNector) so
   * the column vertical stripe lines up with the corresponding
   * header-group pastel. Makes the 25-column table legible at a glance.
   */
  bg?: string
}) {
  if (v == null || !Number.isFinite(v)) {
    return <td style={{ ...stdStyle, color: 'var(--txt3)', background: bg }}>—</td>
  }
  const diffPct = diff != null && diff > 0 ? ((v - diff) / diff) * 100 : null
  const diffColor = diffPct != null
    ? Math.abs(diffPct) < 1
      ? 'var(--txt3)'
      : diffPct > 0
        ? 'var(--green)'
        : 'var(--red)'
    : undefined
  return (
    <td style={{ ...stdStyle, fontFamily: 'JetBrains Mono, monospace', background: bg }}>
      {cr ? formatInrCr(v) : `${v.toFixed(1)}${suffix || ''}`}
      {diffPct != null && Math.abs(diffPct) >= 1 && (
        <span style={{ fontSize: 8, color: diffColor, marginLeft: 3 }}>
          {diffPct > 0 ? '+' : ''}{diffPct.toFixed(0)}%
        </span>
      )}
    </td>
  )
}

/**
 * Table cell that renders a published value alongside a small source
 * tag indicating which upstream source (DealNector / Screener /
 * Baseline / none) contributed the number. Used in the PUBLISHED
 * column group of the admin comparison table so the admin can audit
 * at a glance which columns each row's live values came from.
 *
 * Colour maps to the same source-group palette used elsewhere in the
 * table header so the visual association is consistent.
 */
function PublishedCell({
  v,
  cr,
  suffix,
  source,
}: {
  v: number | null | undefined
  cr?: boolean
  suffix?: string
  source: 'dealnector' | 'screener' | 'baseline' | 'none'
}) {
  const tag = source === 'dealnector' ? 'DN'
            : source === 'screener'   ? 'SCR'
            : source === 'baseline'   ? 'BASE'
            : '—'
  const tagColor = source === 'dealnector' ? 'var(--cyan2, #00b4d8)'
                 : source === 'screener'   ? 'var(--green, #10b981)'
                 : source === 'baseline'   ? 'rgb(100,180,255)'
                 : 'var(--txt3)'
  if (v == null || !Number.isFinite(v) || v === 0) {
    return (
      <td style={{ ...stdStyle, color: 'var(--txt3)', background: 'rgba(200,162,75,0.14)' }}>
        —
      </td>
    )
  }
  return (
    <td style={{
      ...stdStyle,
      fontFamily: 'JetBrains Mono, monospace',
      background: 'rgba(200,162,75,0.14)',
      fontWeight: 600,
      color: 'var(--txt)',
    }}>
      {cr ? formatInrCr(v) : `${v.toFixed(1)}${suffix || ''}`}
      <span title={`Source: ${source === 'dealnector' ? 'DealNector (NSE sweep)' : source === 'screener' ? 'Screener auto-cron' : source === 'baseline' ? 'Curated baseline / prior DB row' : 'no source'}`}
        style={{
          fontSize: 7, fontWeight: 700, color: tagColor, marginLeft: 4,
          padding: '1px 3px', borderRadius: 2,
          background: 'rgba(255,255,255,0.08)',
          border: `1px solid ${tagColor}`,
          lineHeight: 1,
          verticalAlign: 'middle',
          letterSpacing: 0.4,
        }}>
        {tag}
      </span>
    </td>
  )
}

// Source-group background tints used for the BODY (data) cells.
// Translucent on purpose — the page background shows through which
// keeps the table from looking like a wall of solid color on long
// scrolls. Kept as a module-level constant so the header and body
// references share one source of truth (no drift if we add a column).
const GROUP_BG = {
  baseline:   'rgba(100,180,255,0.08)',
  nseLive:    'rgba(247,183,49,0.08)',
  screener:   'rgba(16,185,129,0.08)',
  dealnector: 'rgba(0,180,216,0.08)',
} as const

// Source-group backgrounds used for the STICKY HEADER cells.
// Critical difference vs GROUP_BG: these must be OPAQUE, otherwise
// table-body rows are visible THROUGH the header as the admin scrolls
// down — exactly the "data passing underneath header label" bug we're
// fixing.
//
// The trick is a two-layer background: a repeated-color linear-gradient
// on top of an opaque `var(--s3)` base. The gradient paints a flat
// tinted overlay (both stops are the same color so there's no actual
// gradient — just a uniform tint layer), and the opaque base stops
// anything behind from bleeding through. This works in both light and
// dark themes because `var(--s3)` adapts to the current theme, while
// the tints are subtle enough to look the same on either background.
//
// Why not just `rgba(r,g,b, 1)`? That would drop the tint entirely.
// Why not `color-mix()`? Works, but the gradient trick has wider
// browser support and the same visual output.
const GROUP_HEADER_BG = {
  baseline:   'linear-gradient(rgba(100,180,255,0.35), rgba(100,180,255,0.35)), var(--s3)',
  nseLive:    'linear-gradient(rgba(247,183,49,0.35),  rgba(247,183,49,0.35)),  var(--s3)',
  screener:   'linear-gradient(rgba(16,185,129,0.35),  rgba(16,185,129,0.35)),  var(--s3)',
  dealnector: 'linear-gradient(rgba(0,180,216,0.35),   rgba(0,180,216,0.35)),   var(--s3)',
  published:  'linear-gradient(rgba(200,162,75,0.45),  rgba(200,162,75,0.45)),  var(--s3)',
} as const

// Matching body tint for the PUBLISHED column — strong gold so the
// "this is what went to DB" column visually dominates the comparison
// sources to its left. Subtle enough not to bully the table, but
// distinct from the four pastel source groups.
const PUBLISHED_BODY_BG = 'rgba(200,162,75,0.14)'

/**
 * Dropdown item style factory for the per-row Fetch menu. Takes a
 * source-accent colour (cyan for NSE, green for Screener, gold for
 * DealNector) and produces a row that's easy to target in a dense
 * admin table. Kept as a factory so each item can carry its own
 * accent without repeating the rest of the style.
 */
function menuItemStyle(accent: string): React.CSSProperties {
  return {
    display: 'block',
    width: '100%',
    textAlign: 'left',
    padding: '6px 10px',
    fontSize: 10,
    background: 'transparent',
    border: 'none',
    borderBottom: '1px solid var(--br)',
    color: accent,
    cursor: 'pointer',
    fontFamily: 'inherit',
  }
}

const srcBtn: React.CSSProperties = {
  background: 'var(--s3)',
  border: '1px solid var(--br2)',
  color: 'var(--txt2)',
  padding: '6px 12px',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.4px',
  textTransform: 'uppercase',
  borderRadius: 4,
  cursor: 'pointer',
  fontFamily: 'inherit',
  whiteSpace: 'nowrap',
}

const sthStyle: React.CSSProperties = {
  padding: '8px 8px',
  textAlign: 'left',
  fontSize: 8,
  color: 'var(--txt3)',
  fontWeight: 700,
  letterSpacing: '0.6px',
  textTransform: 'uppercase',
  borderBottom: '1px solid var(--br)',
  whiteSpace: 'nowrap',
}

const stdStyle: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 10,
  color: 'var(--txt2)',
  whiteSpace: 'nowrap',
}

const inputStyle: React.CSSProperties = {
  background: 'var(--s3)',
  border: '1px solid var(--br)',
  color: 'var(--txt)',
  padding: '9px 12px',
  borderRadius: 3,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
}

// Shared header styles for the Industries-tab inner tables
const thStyleSmall: React.CSSProperties = {
  padding: '6px 8px',
  textAlign: 'left',
  fontSize: 9,
  color: 'var(--txt3)',
  fontWeight: 700,
  letterSpacing: '0.4px',
  textTransform: 'uppercase',
}
const thStyleSmallRight: React.CSSProperties = {
  ...thStyleSmall,
  textAlign: 'right',
}

// ── Industries tab component ──────────────────────────────

interface IndustryRegistryRow {
  id: string
  label: string
  icon: string | null
  description: string | null
  is_builtin: boolean
  added_by: string | null
  created_at: string
}

interface IndustryChainNodeRow {
  id: string
  industry_id: string
  name: string
  cat: string
  flag: string
  description?: string | null
}

interface AtlasCompanyRow {
  id: number
  stage_id: string
  name: string
  status: string
  exchange: string | null
  ticker: string | null
  role: string | null
  market_data: null | {
    lastPrice?: number | null
    mktcapCr?: number | null
    pe?: number | null
    changePct?: number | null
    source?: string
    fetchedAt?: string
  }
  market_data_fetched_at: string | null
}

interface MarketStats {
  total: number
  main_listed: number
  sme_listed: number
  private_co: number
  subsidiary: number
  govt: number
  with_market_data: number
  last_fetched_at: string | null
}

interface AtlasSummaryItem {
  id: string
  code: string
  label: string
  icon: string
  stages: number
  companies: number
}

function IndustriesTab() {
  const [industries, setIndustries] = useState<IndustryRegistryRow[]>([])
  const [nodeCounts, setNodeCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)

  // Add-industry form
  const [newId, setNewId] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [newIcon, setNewIcon] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [creating, setCreating] = useState(false)

  // Per-industry upload state
  const [uploadingFor, setUploadingFor] = useState<string | null>(null)

  // Atlas seed + market data
  const [atlasSummary, setAtlasSummary] = useState<AtlasSummaryItem[] | null>(null)
  const [atlasTotal, setAtlasTotal] = useState<number>(0)
  const [seeding, setSeeding] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)
  const [fetchingFor, setFetchingFor] = useState<string | null>(null)

  // Expanded industry drawer state
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedStages, setExpandedStages] = useState<IndustryChainNodeRow[]>([])
  const [expandedCompanies, setExpandedCompanies] = useState<AtlasCompanyRow[]>([])
  const [expandedStats, setExpandedStats] = useState<MarketStats | null>(null)
  const [expandedOpenStage, setExpandedOpenStage] = useState<string | null>(null)
  const [expandLoading, setExpandLoading] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/industries', { credentials: 'same-origin' })
      const json = await safeJson(res)
      if (!json.ok) throw new Error(json.error || 'Failed to load industries')
      const rows: IndustryRegistryRow[] = json.industries || []
      setIndustries(rows)
      // Fetch chain-node counts in parallel
      const counts: Record<string, number> = {}
      await Promise.all(
        rows.map(async (ind) => {
          try {
            const r = await fetch(`/api/industries/${ind.id}/chain`, { credentials: 'same-origin' })
            const j = await r.json()
            if (j.ok) counts[ind.id] = (j.nodes || []).length
          } catch { counts[ind.id] = 0 }
        })
      )
      setNodeCounts(counts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const createIndustry = async () => {
    setStatusMsg(null)
    if (!newId.trim() || !newLabel.trim()) {
      setStatusMsg({ kind: 'error', text: 'ID and label are required.' })
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/industries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          id: newId.trim(),
          label: newLabel.trim(),
          icon: newIcon.trim() || null,
          description: newDesc.trim() || null,
        }),
      })
      const json = await safeJson(res)
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to create')
      setStatusMsg({ kind: 'success', text: `✓ Industry "${newLabel}" created.` })
      setNewId(''); setNewLabel(''); setNewIcon(''); setNewDesc('')
      await loadAll()
      // Live-propagate: every mounted useIndustryFilter refetches the
      // registry, so the sidebar multi-select / dashboard picker shows
      // the new industry without a page reload.
      broadcastIndustryRegistryChange()
    } catch (err) {
      setStatusMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Network error' })
    } finally {
      setCreating(false)
    }
  }

  const deleteIndustry = async (id: string, label: string) => {
    if (!confirm(`Delete industry "${label}"? This removes its value-chain nodes too. This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/industries?id=${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'same-origin',
      })
      const json = await safeJson(res)
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed')
      setStatusMsg({ kind: 'success', text: `✓ Industry "${label}" deleted.` })
      await loadAll()
      broadcastIndustryRegistryChange()
    } catch (err) {
      setStatusMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Network error' })
    }
  }

  const uploadChain = async (industryId: string, file: File) => {
    setUploadingFor(industryId)
    setStatusMsg(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res = await fetch(`/api/industries/${encodeURIComponent(industryId)}/upload`, {
        method: 'POST', credentials: 'same-origin', body: fd,
      })
      const json = await safeJson(res)
      if (!res.ok || !json.ok) throw new Error(json.error || 'Upload failed')
      setStatusMsg({
        kind: 'success',
        text: `✓ Parsed ${json.parsed} of ${json.total} rows from "${json.filename}"; upserted ${json.inserted} chain nodes.`,
      })
      await loadAll()
      // Atlas chain rows for this industry just changed — invalidate the
      // useIndustryAtlas cache for it so Value Chain & Dashboard re-fetch.
      broadcastIndustryDataChange([industryId])
    } catch (err) {
      setStatusMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Network error' })
    } finally {
      setUploadingFor(null)
    }
  }

  // Atlas-seed preview + run
  useEffect(() => {
    fetch('/api/admin/seed-atlas', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setAtlasSummary(j.industries || [])
          setAtlasTotal(j.totalCompanies || 0)
        }
      })
      .catch(() => { /* non-fatal */ })
  }, [])

  const seedAtlas = async () => {
    if (!confirm(
      `Seed the full Waaree Industry Value Chain Atlas?\n\n` +
      `${atlasSummary?.length || 15} industries · ` +
      `${atlasSummary?.reduce((a, x) => a + x.stages, 0) || 80}+ stages · ` +
      `${atlasTotal || 1690}+ companies.\n\n` +
      `This upserts into the industries, industry_chain_nodes and ` +
      `industry_chain_companies tables. It is idempotent — running twice is safe.`
    )) return
    setSeeding(true)
    setStatusMsg({ kind: 'info', text: 'Seeding atlas… this can take ~20s for the full set.' })
    try {
      const res = await fetch('/api/admin/seed-atlas', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await safeJson(res)
      if (!res.ok || !json.ok) throw new Error(json.error || 'Seed failed')
      setStatusMsg({
        kind: 'success',
        text: `✓ Seeded ${json.industries} industries · ${json.stages} stages · ${json.companies} companies.`,
      })
      await loadAll()
      // Full atlas re-seed — registry changed AND every industry's chain
      // / company data may have shifted. Fire both events so all open
      // surfaces (sidebar, value chain, dashboard, atlas hook) refresh.
      broadcastIndustryRegistryChange()
      broadcastIndustryDataChange([])
    } catch (err) {
      setStatusMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Seed failed' })
    } finally {
      setSeeding(false)
    }
  }

  const fetchMarketData = async (industryId: string, industryLabel: string) => {
    const capStr = prompt(
      `Fetch live market data from NSE + Screener for listed companies in "${industryLabel}"?\n\n` +
      `Set a cap on the number of companies (0 = no cap). Each fetch is ~1s due to NSE rate limit.`,
      '25'
    )
    if (capStr === null) return
    const cap = parseInt(capStr, 10) || 0
    setFetchingFor(industryId)
    setStatusMsg({ kind: 'info', text: `Fetching market data for "${industryLabel}"… (~${cap || '∞'}s)` })
    try {
      const res = await fetch(
        `/api/industries/${encodeURIComponent(industryId)}/fetch-market-data`,
        {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maxCompanies: cap }),
        }
      )
      const json = await safeJson(res)
      if (!res.ok || !json.ok) throw new Error(json.error || 'Fetch failed')
      setStatusMsg({
        kind: 'success',
        text: `✓ Fetched live data for ${json.fetched} of ${json.capped} targets (total listed: ${json.total}).`,
      })
      if (expandedId === industryId) await openIndustry(industryId, true)
      // Atlas company market_data for this industry just refreshed —
      // invalidate the client atlas cache so Dashboard / Value Chain
      // pick up the new mktcap / pe values without a hard reload.
      broadcastIndustryDataChange([industryId])
    } catch (err) {
      setStatusMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Fetch failed' })
    } finally {
      setFetchingFor(null)
    }
  }

  /**
   * Seed a single industry from the atlas — writes the industries row plus
   * all its stages and companies in one call. After success the industry
   * appears in /api/industries (visible to users in the first-login
   * picker and the sidebar filter).
   */
  const addIndustryFromAtlas = async (id: string, label: string) => {
    setTogglingId(id)
    setStatusMsg({ kind: 'info', text: `Adding "${label}"… seeding stages & companies.` })
    try {
      const res = await fetch('/api/admin/seed-atlas', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industries: [id] }),
      })
      const json = await safeJson(res)
      if (!res.ok || !json.ok) throw new Error(json.error || 'Seed failed')
      setStatusMsg({
        kind: 'success',
        text: `✓ Added "${label}" — ${json.stages} stages · ${json.companies} companies. Now visible to users.`,
      })
      await loadAll()
      broadcastIndustryRegistryChange()
      // The newly-added industry has fresh chain + company rows — make
      // sure useIndustryAtlas drops any stale empty bundle for `id`
      // (which it would have cached if the user had this industry
      // selected BEFORE the seed completed).
      broadcastIndustryDataChange([id])
    } catch (err) {
      setStatusMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Add failed' })
    } finally {
      setTogglingId(null)
    }
  }

  /**
   * Remove an atlas industry — cascades to its stages and companies via FK.
   * The industry disappears from /api/industries, so users can no longer
   * pick it. Refuses on built-in ids ('solar', 'td').
   */
  const removeIndustryFromAtlas = async (id: string, label: string) => {
    if (!confirm(
      `Remove "${label}" from the platform?\n\n` +
      `This deletes the industry row along with all its value-chain stages ` +
      `and companies from the database. Users will no longer be able to ` +
      `select it. You can re-add it any time from the Atlas Catalog below.`
    )) return
    setTogglingId(id)
    setStatusMsg({ kind: 'info', text: `Removing "${label}"…` })
    try {
      const res = await fetch(`/api/industries?id=${encodeURIComponent(id)}`, {
        method: 'DELETE', credentials: 'same-origin',
      })
      const json = await safeJson(res)
      if (!res.ok || !json.ok) throw new Error(json.error || 'Remove failed')
      setStatusMsg({ kind: 'success', text: `✓ Removed "${label}" — users can no longer select it.` })
      if (expandedId === id) setExpandedId(null)
      await loadAll()
      broadcastIndustryRegistryChange()
    } catch (err) {
      setStatusMsg({ kind: 'error', text: err instanceof Error ? err.message : 'Remove failed' })
    } finally {
      setTogglingId(null)
    }
  }

  const openIndustry = async (industryId: string, force = false) => {
    if (!force && expandedId === industryId) {
      setExpandedId(null)
      return
    }
    setExpandedId(industryId)
    setExpandedOpenStage(null)
    setExpandLoading(true)
    try {
      const [chainRes, coRes, statsRes] = await Promise.all([
        fetch(`/api/industries/${encodeURIComponent(industryId)}/chain`, { credentials: 'same-origin' }).then((r) => r.json()),
        fetch(`/api/industries/${encodeURIComponent(industryId)}/companies`, { credentials: 'same-origin' }).then((r) => r.json()),
        fetch(`/api/industries/${encodeURIComponent(industryId)}/fetch-market-data`, { credentials: 'same-origin' }).then((r) => r.json()),
      ])
      setExpandedStages(chainRes.ok ? chainRes.nodes || [] : [])
      setExpandedCompanies(coRes.ok ? coRes.companies || [] : [])
      setExpandedStats(statsRes.ok ? statsRes.stats : null)
    } finally {
      setExpandLoading(false)
    }
  }

  const statusBadgeVariant = (status: string): 'green' | 'cyan' | 'purple' | 'orange' | 'gray' | 'gold' => {
    if (status === 'MAIN') return 'green'
    if (status === 'SME') return 'cyan'
    if (status === 'SUBSIDIARY') return 'purple'
    if (status === 'GOVT/PSU') return 'gold'
    if (status === 'PRIVATE') return 'gray'
    return 'gray'
  }

  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 14, lineHeight: 1.55 }}>
        Register industries that appear in the sidebar filter and drive the Value Chain page. Each
        industry can have its value-chain loaded via an <strong>Excel upload</strong> (.xlsx / .xls /
        .csv) — required columns <code>name</code>, <code>cat</code>; optional <code>description,
        flag, market_india, market_india_cagr, market_global, market_global_cagr,
        market_global_leaders, market_india_status, fin_gross_margin, fin_ebit_margin, fin_capex,
        fin_moat, str_forward, str_backward, str_organic, str_inorganic</code> — or seeded all-at-once
        from the bundled Waaree Atlas below.
      </div>

      {/* Atlas seed banner */}
      {atlasSummary && (
        <div style={{
          background: 'linear-gradient(135deg, var(--golddim), var(--cyandim))',
          border: '1px solid var(--gold2)', borderRadius: 4,
          padding: 14, marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
        }}>
          <div style={{ flex: '1 1 260px', minWidth: 0 }}>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.6px',
              textTransform: 'uppercase', color: 'var(--gold2)', marginBottom: 4,
            }}>Waaree Industry Value Chain Atlas · April 2026</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', lineHeight: 1.4 }}>
              Seed the full atlas in one click:{' '}
              <span style={{ color: 'var(--gold2)' }}>{atlasSummary.length} industries</span>,{' '}
              <span style={{ color: 'var(--gold2)' }}>
                {atlasSummary.reduce((a, x) => a + x.stages, 0)} value-chain stages
              </span>,{' '}
              <span style={{ color: 'var(--gold2)' }}>{atlasTotal.toLocaleString()} companies</span>{' '}
              classified as Main-Listed / SME / Subsidiary / Private / Govt-PSU.
            </div>
            <div style={{ fontSize: 10, color: 'var(--txt2)', marginTop: 4 }}>
              Idempotent — safe to re-run. Each industry is tagged built-in after seeding.
            </div>
          </div>
          <button
            onClick={seedAtlas} disabled={seeding}
            style={{
              background: seeding ? 'var(--s3)' : 'var(--gold2)',
              color: seeding ? 'var(--txt3)' : '#000',
              border: '1px solid var(--gold2)',
              padding: '10px 18px', fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
              textTransform: 'uppercase', borderRadius: 3,
              cursor: seeding ? 'wait' : 'pointer', fontFamily: 'inherit',
            }}
          >{seeding ? 'Seeding…' : '⚡ Seed Full Atlas'}</button>
        </div>
      )}

      {/* Per-industry Atlas Catalog — Add / Remove toggle for every
          industry the atlas knows about. Added industries become visible
          to users in the first-login picker and the sidebar filter.
          Removing cascades to stages + companies (and is blocked on the
          two truly built-in industries, solar + td). */}
      {atlasSummary && atlasSummary.length > 0 && (
        <div style={{
          background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 4,
          padding: 14, marginBottom: 16,
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10,
            flexWrap: 'wrap',
          }}>
            <div style={{
              fontSize: 9, fontWeight: 700, letterSpacing: '0.6px',
              textTransform: 'uppercase', color: 'var(--txt3)',
            }}>Atlas Industry Catalog — Add / Remove</div>
            <span style={{ fontSize: 10, color: 'var(--txt3)' }}>
              · {atlasSummary.filter((a) => industries.some((i) => i.id === a.id)).length} of {atlasSummary.length} currently active
            </span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--txt2)', marginBottom: 10, lineHeight: 1.5 }}>
            Added industries appear in the user&apos;s first-login picker and the sidebar filter, with
            their value chain + companies available across Dashboard, M&amp;A Radar, Compare, Report and Watchlist.
            Removing an industry detaches its data from the platform; you can re-add any time.
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
            gap: 8,
          }}>
            {atlasSummary.map((item) => {
              const activeRow = industries.find((x) => x.id === item.id)
              const isActive = Boolean(activeRow)
              const isBuiltin = Boolean(activeRow?.is_builtin)
              const isBusy = togglingId === item.id
              return (
                <div
                  key={item.id}
                  style={{
                    background: isActive ? 'var(--greendim)' : 'var(--s3)',
                    border: `1px solid ${isActive ? 'var(--green)' : 'var(--br)'}`,
                    borderRadius: 4, padding: 10,
                    display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0,
                  }}
                  title={isActive ? 'Currently active · users can select this industry' : 'Not yet added'}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 18, lineHeight: 1 }}>{item.icon || '📁'}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 12, fontWeight: 700, color: 'var(--txt)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>{item.label}</div>
                      <code style={{ fontSize: 9, color: 'var(--txt3)' }}>{item.id}</code>
                    </div>
                    {isActive && (
                      <span
                        title={isBuiltin ? 'Built-in (cannot be removed)' : 'Active'}
                        style={{
                          fontSize: 10, fontWeight: 700, color: 'var(--green)',
                          background: 'var(--s1)', padding: '1px 6px', borderRadius: 3,
                          border: '1px solid var(--green)', letterSpacing: '0.3px',
                        }}
                      >{isBuiltin ? '★ BUILT-IN' : '✓ ACTIVE'}</span>
                    )}
                  </div>
                  <div style={{
                    fontSize: 10, color: 'var(--txt3)',
                    display: 'flex', gap: 8, flexWrap: 'wrap',
                  }}>
                    <span>📊 {item.stages} stages</span>
                    <span>🏢 {item.companies} companies</span>
                  </div>
                  {isActive ? (
                    <button
                      onClick={() => removeIndustryFromAtlas(item.id, item.label)}
                      disabled={isBusy || isBuiltin}
                      style={{
                        background: isBuiltin ? 'var(--s2)' : isBusy ? 'var(--s2)' : 'var(--reddim)',
                        border: `1px solid ${isBuiltin ? 'var(--br)' : 'var(--red)'}`,
                        color: isBuiltin ? 'var(--txt3)' : isBusy ? 'var(--txt3)' : 'var(--red)',
                        padding: '5px 8px', fontSize: 10, fontWeight: 700,
                        letterSpacing: '0.4px', textTransform: 'uppercase', borderRadius: 3,
                        cursor: isBuiltin || isBusy ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                      }}
                    >{isBusy ? 'Removing…' : isBuiltin ? 'Protected' : '✕ Remove'}</button>
                  ) : (
                    <button
                      onClick={() => addIndustryFromAtlas(item.id, item.label)}
                      disabled={isBusy}
                      style={{
                        background: isBusy ? 'var(--s2)' : 'var(--green)',
                        border: '1px solid var(--green)',
                        color: isBusy ? 'var(--txt3)' : '#000',
                        padding: '5px 8px', fontSize: 10, fontWeight: 700,
                        letterSpacing: '0.4px', textTransform: 'uppercase', borderRadius: 3,
                        cursor: isBusy ? 'wait' : 'pointer', fontFamily: 'inherit',
                      }}
                    >{isBusy ? 'Adding…' : '+ Add to Platform'}</button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Add industry form */}
      <div style={{
        background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 4,
        padding: 14, marginBottom: 16,
      }}>
        <div style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '0.6px',
          textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 10,
        }}>+ Add Industry</div>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr 80px', gap: 8, marginBottom: 8 }}>
          <input
            type="text" value={newId} onChange={(e) => setNewId(e.target.value)}
            placeholder="id (e.g. wind)" style={{ ...inputStyle, fontSize: 12 }}
          />
          <input
            type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (e.g. Wind Energy)" style={{ ...inputStyle, fontSize: 12 }}
          />
          <input
            type="text" value={newIcon} onChange={(e) => setNewIcon(e.target.value)}
            placeholder="Icon" maxLength={4} style={{ ...inputStyle, fontSize: 12, textAlign: 'center' }}
          />
        </div>
        <textarea
          value={newDesc} onChange={(e) => setNewDesc(e.target.value)}
          placeholder="Short description (optional)"
          style={{ ...inputStyle, width: '100%', minHeight: 52, fontSize: 11, resize: 'vertical', marginBottom: 8 }}
        />
        <button
          onClick={createIndustry} disabled={creating}
          style={{
            background: creating ? 'var(--s3)' : 'var(--green)',
            color: creating ? 'var(--txt3)' : '#000',
            border: `1px solid ${creating ? 'var(--br)' : 'var(--green)'}`,
            padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
            textTransform: 'uppercase', borderRadius: 3,
            cursor: creating ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}
        >{creating ? 'Creating…' : 'Create Industry'}</button>
      </div>

      {/* Status message */}
      {statusMsg && (
        <div style={{
          marginBottom: 12, padding: '8px 12px', borderRadius: 3, fontSize: 11,
          background: statusMsg.kind === 'success' ? 'var(--greendim)' :
            statusMsg.kind === 'error' ? 'var(--reddim)' : 'var(--cyandim)',
          color: statusMsg.kind === 'success' ? 'var(--green)' :
            statusMsg.kind === 'error' ? 'var(--red)' : 'var(--cyan2)',
          border: `1px solid ${statusMsg.kind === 'success' ? 'var(--green)' :
            statusMsg.kind === 'error' ? 'var(--red)' : 'var(--cyan2)'}`,
        }}>{statusMsg.text}</div>
      )}

      {loading && <div style={{ color: 'var(--txt3)', fontSize: 11, padding: 20, textAlign: 'center' }}>Loading…</div>}
      {error && <div style={{ color: 'var(--red)', fontSize: 11, padding: 10 }}>Error: {error}</div>}

      {/* Industry list */}
      {!loading && !error && (
        <div style={{ display: 'grid', gap: 10 }}>
          {industries.map((ind) => (
            <div key={ind.id} style={{
              background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 4, padding: 14,
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
                <div style={{ fontSize: 24, lineHeight: 1, width: 28, textAlign: 'center' }}>
                  {ind.icon || '📁'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--txt)' }}>{ind.label}</span>
                    <code style={{ fontSize: 10, color: 'var(--txt3)' }}>{ind.id}</code>
                    {ind.is_builtin && <Badge variant="cyan">built-in</Badge>}
                    <Badge variant="gray">{nodeCounts[ind.id] ?? 0} chain nodes</Badge>
                  </div>
                  {ind.description && (
                    <div style={{ fontSize: 11, color: 'var(--txt2)', marginTop: 4, lineHeight: 1.5 }}>
                      {ind.description}
                    </div>
                  )}
                </div>
                {!ind.is_builtin && (
                  <button
                    onClick={() => deleteIndustry(ind.id, ind.label)}
                    style={{
                      ...srcBtn, fontSize: 9, padding: '4px 10px',
                      background: 'var(--reddim)', borderColor: 'var(--red)', color: 'var(--red)',
                    }}
                  >Delete</button>
                )}
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 10, paddingTop: 8,
                borderTop: '1px dashed var(--br)', flexWrap: 'wrap',
              }}>
                <span style={{
                  fontSize: 9, color: 'var(--txt3)', fontWeight: 700,
                  letterSpacing: '0.4px', textTransform: 'uppercase',
                }}>Upload Value Chain:</span>
                <input
                  type="file" accept=".xlsx,.xls,.csv"
                  disabled={uploadingFor === ind.id}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) uploadChain(ind.id, f)
                    e.target.value = ''
                  }}
                  style={{ fontSize: 10, color: 'var(--txt2)', flex: '1 1 120px', minWidth: 0 }}
                />
                {uploadingFor === ind.id && (
                  <span style={{ fontSize: 10, color: 'var(--cyan2)' }}>Uploading…</span>
                )}
                <button
                  onClick={() => openIndustry(ind.id)}
                  style={{
                    background: expandedId === ind.id ? 'var(--golddim)' : 'var(--s3)',
                    border: `1px solid ${expandedId === ind.id ? 'var(--gold2)' : 'var(--br)'}`,
                    color: expandedId === ind.id ? 'var(--gold2)' : 'var(--txt2)',
                    padding: '5px 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.3px',
                    textTransform: 'uppercase', borderRadius: 3, cursor: 'pointer', fontFamily: 'inherit',
                  }}
                >{expandedId === ind.id ? '▾ Stages & Companies' : '▸ Stages & Companies'}</button>
                <button
                  onClick={() => fetchMarketData(ind.id, ind.label)}
                  disabled={fetchingFor === ind.id}
                  style={{
                    background: fetchingFor === ind.id ? 'var(--s3)' : 'var(--cyandim)',
                    border: '1px solid var(--cyan2)',
                    color: fetchingFor === ind.id ? 'var(--txt3)' : 'var(--cyan2)',
                    padding: '5px 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.3px',
                    textTransform: 'uppercase', borderRadius: 3,
                    cursor: fetchingFor === ind.id ? 'wait' : 'pointer', fontFamily: 'inherit',
                  }}
                >{fetchingFor === ind.id ? 'Fetching…' : '$ Fetch Market Data'}</button>
              </div>

              {/* Expandable drawer: stages + companies */}
              {expandedId === ind.id && (
                <div style={{
                  marginTop: 10, paddingTop: 10,
                  borderTop: '1px solid var(--br)',
                }}>
                  {expandLoading ? (
                    <div style={{ color: 'var(--txt3)', fontSize: 10, padding: 10, textAlign: 'center' }}>
                      Loading stages & companies…
                    </div>
                  ) : (
                    <>
                      {/* Market-data summary */}
                      {expandedStats && (
                        <div style={{
                          display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10,
                          fontSize: 10, color: 'var(--txt2)',
                        }}>
                          <Badge variant="green">{expandedStats.main_listed} Main</Badge>
                          <Badge variant="cyan">{expandedStats.sme_listed} SME</Badge>
                          <Badge variant="purple">{expandedStats.subsidiary} Subsidiary</Badge>
                          <Badge variant="gold">{expandedStats.govt} Govt/PSU</Badge>
                          <Badge variant="gray">{expandedStats.private_co} Private</Badge>
                          <span style={{ color: 'var(--txt3)' }}>
                            · {expandedStats.with_market_data} with live market data
                            {expandedStats.last_fetched_at && (
                              <span> · last fetch {new Date(expandedStats.last_fetched_at).toLocaleString('en-IN')}</span>
                            )}
                          </span>
                        </div>
                      )}

                      {/* Stage table with description column */}
                      <div style={{ overflowX: 'auto', marginBottom: 8 }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                          <thead>
                            <tr style={{ borderBottom: '1px solid var(--br)' }}>
                              <th style={thStyleSmall}>Stage</th>
                              <th style={{ ...thStyleSmall, minWidth: 280 }}>Description</th>
                              <th style={thStyleSmallRight}>Companies</th>
                              <th style={thStyleSmallRight}>Listed</th>
                            </tr>
                          </thead>
                          <tbody>
                            {expandedStages.length === 0 && (
                              <tr><td colSpan={4} style={{ padding: 10, color: 'var(--txt3)', textAlign: 'center', fontStyle: 'italic' }}>
                                No stages yet — seed the atlas or upload an Excel above.
                              </td></tr>
                            )}
                            {expandedStages.map((stg) => {
                              const inStage = expandedCompanies.filter((c) => c.stage_id === stg.id)
                              const listed = inStage.filter((c) => c.status === 'MAIN' || c.status === 'SME').length
                              const isOpen = expandedOpenStage === stg.id
                              return (
                                <Fragment key={stg.id}>
                                  <tr
                                    onClick={() => setExpandedOpenStage(isOpen ? null : stg.id)}
                                    style={{
                                      borderBottom: '1px solid var(--br)',
                                      cursor: 'pointer',
                                      background: isOpen ? 'var(--golddim)' : 'transparent',
                                    }}
                                  >
                                    <td style={{ padding: '6px 8px', color: 'var(--txt)', fontWeight: 600 }}>
                                      <span style={{ color: 'var(--gold2)', marginRight: 4 }}>
                                        {isOpen ? '▾' : '▸'}
                                      </span>
                                      {stg.name}
                                    </td>
                                    <td style={{ padding: '6px 8px', color: 'var(--txt2)', lineHeight: 1.45 }}>
                                      {stg.description || <em style={{ color: 'var(--txt3)' }}>No description yet</em>}
                                    </td>
                                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--txt2)', fontVariantNumeric: 'tabular-nums' }}>
                                      {inStage.length}
                                    </td>
                                    <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--green)', fontVariantNumeric: 'tabular-nums' }}>
                                      {listed}
                                    </td>
                                  </tr>
                                  {isOpen && (
                                    <tr>
                                      <td colSpan={4} style={{ padding: 0, background: 'var(--s1)' }}>
                                        <div style={{ padding: 8, borderTop: '1px dashed var(--br)' }}>
                                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                                            <thead>
                                              <tr style={{ color: 'var(--txt3)' }}>
                                                <th style={thStyleSmall}>Company</th>
                                                <th style={thStyleSmall}>Status</th>
                                                <th style={thStyleSmall}>Exchange</th>
                                                <th style={thStyleSmall}>Ticker</th>
                                                <th style={thStyleSmall}>Role</th>
                                                <th style={thStyleSmallRight}>Mkt Cap (Cr)</th>
                                                <th style={thStyleSmallRight}>P/E</th>
                                              </tr>
                                            </thead>
                                            <tbody>
                                              {inStage.map((c) => (
                                                <tr key={c.id} style={{ borderTop: '1px dashed var(--br)' }}>
                                                  <td style={{ padding: '4px 8px', color: 'var(--txt)' }}>{c.name}</td>
                                                  <td style={{ padding: '4px 8px' }}>
                                                    <Badge variant={statusBadgeVariant(c.status)}>{c.status}</Badge>
                                                  </td>
                                                  <td style={{ padding: '4px 8px', color: 'var(--txt3)' }}>{c.exchange || '—'}</td>
                                                  <td style={{ padding: '4px 8px', fontFamily: 'JetBrains Mono, monospace', color: 'var(--cyan2)' }}>{c.ticker || '—'}</td>
                                                  <td style={{ padding: '4px 8px', color: 'var(--txt2)', lineHeight: 1.4 }}>{c.role || '—'}</td>
                                                  <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--txt2)', fontVariantNumeric: 'tabular-nums' }}>
                                                    {c.market_data?.mktcapCr != null ? c.market_data.mktcapCr.toLocaleString('en-IN') : '—'}
                                                  </td>
                                                  <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--txt2)', fontVariantNumeric: 'tabular-nums' }}>
                                                    {c.market_data?.pe != null ? c.market_data.pe.toFixed(1) : '—'}
                                                  </td>
                                                </tr>
                                              ))}
                                              {inStage.length === 0 && (
                                                <tr><td colSpan={7} style={{ padding: 8, color: 'var(--txt3)', textAlign: 'center', fontStyle: 'italic' }}>
                                                  No companies seeded in this stage.
                                                </td></tr>
                                              )}
                                            </tbody>
                                          </table>
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                </Fragment>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
          {industries.length === 0 && (
            <div style={{ color: 'var(--txt3)', fontSize: 11, padding: 24, textAlign: 'center', fontStyle: 'italic' }}>
              No industries yet.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Landing page feature toggles ────────────────────────────
//
// Single-purpose tab for now: enable / disable the hero sample-report
// picker on the public landing page. When the flag flips off the
// dashboard restores the original "What you get" rail design and the
// public catalog / report APIs also return 403 so the UI can't be
// forced back on from the client. Adding a new landing-page toggle
// later means dropping another card into this grid — no new tab.

interface LandingFeatureFlags {
  landingSampleReportEnabled: boolean
}

function LandingToggleTab() {
  const [flags, setFlags] = useState<LandingFeatureFlags | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [statusMsg, setStatusMsg] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/feature-flags', { credentials: 'same-origin' })
      const json = await safeJson(res)
      if (!json.ok) throw new Error(json.error || 'Failed to load feature flags')
      setFlags(json.flags as LandingFeatureFlags)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggleSampleReport = async () => {
    if (!flags || saving) return
    setSaving(true)
    setStatusMsg(null)
    const nextValue = !flags.landingSampleReportEnabled
    try {
      const res = await fetch('/api/admin/feature-flags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          key: 'landing.sampleReportEnabled',
          value: nextValue,
        }),
      })
      const json = await safeJson(res)
      if (!json.ok) throw new Error(json.error || 'Failed to update flag')
      setFlags(json.flags as LandingFeatureFlags)
      setStatusMsg({
        kind: 'success',
        text: nextValue
          ? 'Sample report picker is now LIVE on the landing page.'
          : 'Sample report picker is now HIDDEN. Legacy rail will show instead.',
      })
    } catch (err) {
      setStatusMsg({
        kind: 'error',
        text: err instanceof Error ? err.message : 'Network error',
      })
    } finally {
      setSaving(false)
    }
  }

  const enabled = flags?.landingSampleReportEnabled ?? false

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: 'var(--txt)', margin: 0 }}>
          Landing Page Controls
        </h2>
        <p style={{ fontSize: 12, color: 'var(--txt3)', margin: '4px 0 0' }}>
          Toggle public-facing landing-page features. Changes propagate to
          visitors within ~30 seconds (public flag cache).
        </p>
      </div>

      {error && (
        <div style={{
          padding: 10, background: 'var(--reddim)', color: 'var(--red)',
          border: '1px solid var(--red)', borderRadius: 6, fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {statusMsg && (
        <div style={{
          padding: 10,
          background:
            statusMsg.kind === 'success' ? 'var(--greendim)' :
            statusMsg.kind === 'error' ? 'var(--reddim)' :
            'var(--cyandim)',
          color:
            statusMsg.kind === 'success' ? 'var(--green)' :
            statusMsg.kind === 'error' ? 'var(--red)' :
            'var(--cyan2)',
          border: `1px solid ${
            statusMsg.kind === 'success' ? 'var(--green)' :
            statusMsg.kind === 'error' ? 'var(--red)' :
            'var(--cyan2)'
          }`,
          borderRadius: 6, fontSize: 12,
        }}>
          {statusMsg.text}
        </div>
      )}

      {loading ? (
        <div style={{ color: 'var(--txt3)', fontSize: 12, padding: 24, textAlign: 'center' }}>
          Loading…
        </div>
      ) : flags ? (
        <div style={{
          border: '1px solid var(--br)', borderRadius: 8,
          background: 'var(--s1)', padding: 20,
          display: 'flex', flexDirection: 'column', gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>
                  Sample Report Picker
                </span>
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  padding: '2px 8px', borderRadius: 4,
                  background: enabled ? 'var(--greendim)' : 'var(--reddim)',
                  color: enabled ? 'var(--green)' : 'var(--red)',
                  border: `1px solid ${enabled ? 'var(--green)' : 'var(--red)'}`,
                }}>
                  {enabled ? 'LIVE' : 'DISABLED'}
                </span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--txt3)', margin: 0, lineHeight: 1.5 }}>
                When ON, landing-page visitors see the three-level industry
                / value-chain / sub-segment dropdowns and can download a
                free auto-generated sample report. When OFF, the hero
                reverts to the original "What you get" rail and the
                public catalog / report endpoints return 403.
              </p>
            </div>
            <button
              type="button"
              onClick={toggleSampleReport}
              disabled={saving}
              aria-pressed={enabled}
              style={{
                position: 'relative',
                width: 56, height: 28, flexShrink: 0,
                borderRadius: 999,
                border: `1px solid ${enabled ? 'var(--green)' : 'var(--br2)'}`,
                background: enabled ? 'var(--green)' : 'var(--s3)',
                cursor: saving ? 'wait' : 'pointer',
                opacity: saving ? 0.6 : 1,
                transition: 'background 0.2s, border-color 0.2s',
                padding: 0,
              }}
            >
              <span style={{
                position: 'absolute', top: 2,
                left: enabled ? 30 : 2,
                width: 22, height: 22, borderRadius: '50%',
                background: '#fff',
                boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                transition: 'left 0.2s',
              }} />
            </button>
          </div>

          <div style={{
            borderTop: '1px solid var(--br)', paddingTop: 12,
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
          }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                When enabled
              </div>
              <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 11, color: 'var(--txt3)', lineHeight: 1.7 }}>
                <li>Hero shows industry / chain / segment dropdowns</li>
                <li>Visitors can download sample PDF/HTML reports</li>
                <li>IP + email captured into <code>public_report_requests</code></li>
                <li>Rate-limited: 10/hr per IP, 3 concurrent renders</li>
              </ul>
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt2)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                When disabled
              </div>
              <ul style={{ margin: 0, padding: '0 0 0 16px', fontSize: 11, color: 'var(--txt3)', lineHeight: 1.7 }}>
                <li>Legacy "What you get" rail restored on hero</li>
                <li>Dropdowns and CAPTCHA fully hidden</li>
                <li><code>/api/public/catalog</code> returns 403</li>
                <li><code>/api/public/report</code> returns 403</li>
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
