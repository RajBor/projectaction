'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Badge } from '@/components/ui/Badge'
import { COMPANIES, type Company } from '@/lib/data/companies'
import { CHAIN } from '@/lib/data/chain'
import { formatInrCr } from '@/lib/format'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'
import type { ScreenerRow, ScreenerRatioRow, ScreenerRatioYear } from '@/app/api/admin/scrape-screener/route'
import type { ExchangeRow } from '@/app/api/admin/scrape-exchange/route'

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

type Tab = 'users' | 'interests' | 'email' | 'password' | 'sources'

export default function AdminDashboardPage() {
  const { data: session, status } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role
  const isAdmin = role === 'admin'
  const isSubadmin = role === 'subadmin'
  const hasAdminAccess = isAdmin || isSubadmin

  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [interests, setInterests] = useState<InterestRow[]>([])
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

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 2800)
  }

  const refreshAll = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Bootstrap schema + seed on first visit
      await fetch('/api/admin/bootstrap').catch(() => undefined)
      const [u, i, e, q] = await Promise.all([
        fetch('/api/admin/users').then((r) => r.json()),
        fetch('/api/admin/interests').then((r) => r.json()),
        fetch('/api/admin/email-log').then((r) => r.json()),
        fetch('/api/admin/api-quota').then((r) => r.json()).catch(() => ({ ok: false })),
      ])
      if (u.ok) setUsers(u.users || [])
      if (i.ok) setInterests(i.interests || [])
      if (e.ok) setEmailLog(e.log || [])
      if (q.ok && q.quota) setApiQuota(q.quota)
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
    const data = await res.json()
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
    const data = await res.json()
    if (!res.ok || !data.ok) {
      showToast(data.error || 'Delete failed')
      return
    }
    showToast('User deleted')
    refreshAll()
  }

  const downloadCsv = () => {
    window.location.href = '/api/admin/users/csv'
  }

  // ── Password change ─────────────────────────────────────
  const requestCode = async () => {
    setPwRequesting(true)
    setPwMsg(null)
    const res = await fetch('/api/admin/password/request', { method: 'POST' })
    const data = await res.json()
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
    const data = await res.json()
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
            ['email', `Email Log (${emailLog.length})`] as [Tab, string],
            ...(isAdmin ? [['password', 'Change Admin Password'] as [Tab, string]] : []),
            ['sources', 'Data Sources'] as [Tab, string],
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
                  <th style={thStyle}>Active</th>
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
                      {u.is_active ? (
                        <span style={{ color: 'var(--green)' }}>● yes</span>
                      ) : (
                        <span style={{ color: 'var(--red)' }}>○ no</span>
                      )}
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
                              const json = await res.json()
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
  } = useLiveSnapshot()
  const { allCompanies, reloadDbCompanies } = useLiveSnapshot()
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
  // DealNector API (NSE direct)
  const [exchangeData, setExchangeData] = useState<Record<string, ExchangeRow>>({})
  const [exchangeLoading, setExchangeLoading] = useState(false)
  const [exchangeTime, setExchangeTime] = useState<string | null>(null)
  const [selectedSource, setSelectedSource] = useState<Record<string, 'baseline' | 'rapidapi' | 'screener' | 'exchange'>>({})
  const [publishMsg, setPublishMsg] = useState<string | null>(null)
  const [publishing, setPublishing] = useState(false)
  // Discovery state
  const [discoverQuery, setDiscoverQuery] = useState('')
  const [discoverResults, setDiscoverResults] = useState<Array<{ id: number; name: string; code: string; exchange: string; screenerUrl: string }>>([])
  const [discoverLoading, setDiscoverLoading] = useState(false)
  // Per-result sector + comp selections (keyed by result id)
  const [discoverSec, setDiscoverSec] = useState<Record<number, 'solar' | 'td'>>({})
  const [discoverComp, setDiscoverComp] = useState<Record<number, string>>({})
  // Build unique segment list from existing CHAIN data
  const chainSegments = useMemo(() => {
    const segs: Array<{ id: string; name: string; sec: string }> = []
    for (const c of CHAIN) {
      segs.push({ id: c.id, name: c.name, sec: c.sec })
    }
    return segs
  }, [])
  // Per-ticker refresh
  const [tickerRefreshing, setTickerRefreshing] = useState<string | null>(null)
  // Sub-tab: 'main' (comparison table) or 'ratios' (working capital table)
  const [subTab, setSubTab] = useState<'main' | 'ratios' | 'discover'>('main')

  // Build comparison rows
  const rows = useMemo(() => {
    return COMPANIES.map((baseCo) => {
      const live = liveTickers[baseCo.ticker]
      const derived = deriveCompany(baseCo)
      const screener = screenerData[baseCo.ticker] || null
      const exchange = exchangeData[baseCo.ticker] || null
      const source = selectedSource[baseCo.ticker] || 'baseline'
      return { baseCo, live, derived, screener, exchange, source }
    })
  }, [liveTickers, deriveCompany, screenerData, exchangeData, selectedSource])

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
      const json = await res.json()
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
      const json = await res.json()
      if (json.ok) {
        if (json.data?.[ticker]) setScreenerData((prev) => ({ ...prev, [ticker]: json.data[ticker] }))
        if (json.ratios?.[ticker]) setScreenerRatios((prev) => ({ ...prev, [ticker]: json.ratios[ticker] }))
      }
    } catch { /* ignore */ }
    finally { setTickerRefreshing(null) }
  }

  // ── Fetch from NSE (DealNector API) ──
  const fetchExchange = async () => {
    setExchangeLoading(true)
    try {
      const res = await fetch('/api/admin/scrape-exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const json = await res.json()
      if (json.ok) {
        setExchangeData(json.data || {})
        setExchangeTime(new Date().toLocaleString('en-IN'))
        try {
          localStorage.setItem('sg4_exchange_data', JSON.stringify(json.data))
          localStorage.setItem('sg4_exchange_time', new Date().toISOString())
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
    finally { setExchangeLoading(false) }
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
      const cachedExchange = localStorage.getItem('sg4_exchange_data')
      const cachedExTime = localStorage.getItem('sg4_exchange_time')
      if (cachedExchange) setExchangeData(JSON.parse(cachedExchange))
      if (cachedExTime) setExchangeTime(new Date(cachedExTime).toLocaleString('en-IN'))
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
        const json = await res.json()
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

      const json = await res.json()
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
        const pubJson = await pubRes.json()
        if (pubJson.ok) {
          if (pubJson.skipped?.length > 0) {
            alert(`⚠ ${name} was NOT added — duplicate detected:\n\n${pubJson.skipped.join('\n')}`)
          } else {
            setAddedTickers((prev) => { const next = new Set(Array.from(prev)); next.add(code); return next })
            reloadDbCompanies()
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
            revg: 0, ebm: screener.ebm ?? 0,
            acqs: 5, acqf: 'MONITOR',
            rea: `Discovered via Screener.in. Sector: ${sec}. Segment: ${selectedComp || 'unclassified'}.`,
          }],
        }),
      })
      const pubJson = await pubRes.json()
      if (pubJson.ok) {
        if (pubJson.skipped?.length > 0) {
          alert(`⚠ ${name} was NOT added — duplicate detected:\n\n${pubJson.skipped.join('\n')}`)
        } else {
          setAddedTickers((prev) => { const next = new Set(Array.from(prev)); next.add(code); return next })
          reloadDbCompanies()
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
    for (const co of COMPANIES) bulk[co.ticker] = src
    setSelectedSource(bulk)
  }

  const handlePublish = async () => {
    setPublishing(true)
    setPublishMsg(null)
    const overrides: Record<string, Partial<Company>> = {}
    for (const { baseCo, derived, screener, exchange, source } of rows) {
      if (source === 'baseline') continue
      if (source === 'rapidapi') {
        const co = derived.company
        overrides[baseCo.ticker] = {
          mktcap: co.mktcap, rev: co.rev, ebitda: co.ebitda, pat: co.pat,
          ev: co.ev, ev_eb: co.ev_eb, pe: co.pe, pb: co.pb,
          dbt_eq: co.dbt_eq, ebm: co.ebm,
        }
      } else if (source === 'screener' && screener) {
        overrides[baseCo.ticker] = {
          mktcap: screener.mktcapCr ?? baseCo.mktcap,
          rev: screener.salesCr ?? baseCo.rev,
          ebitda: screener.ebitdaCr ?? baseCo.ebitda,
          pat: screener.netProfitCr ?? baseCo.pat,
          ev: screener.evCr ?? baseCo.ev,
          ev_eb: screener.evEbitda ?? baseCo.ev_eb,
          pe: screener.pe ?? baseCo.pe,
          pb: screener.pbRatio ?? baseCo.pb,
          dbt_eq: screener.dbtEq ?? baseCo.dbt_eq,
          ebm: screener.ebm ?? baseCo.ebm,
        }
      } else if (source === 'exchange' && exchange) {
        // DealNector API only provides mktcap, EV, EV/EBITDA, PE —
        // revenue / EBITDA / PAT stay from baseline (NSE doesn't have P&L)
        overrides[baseCo.ticker] = {
          mktcap: exchange.mktcapCr ?? baseCo.mktcap,
          ev: exchange.evCr ?? baseCo.ev,
          ev_eb: exchange.evEbitda ?? baseCo.ev_eb,
          pe: exchange.pe ?? baseCo.pe,
        }
      }
    }
    if (Object.keys(overrides).length === 0) {
      setPublishMsg('No changes selected.'); setPublishing(false); return
    }
    try {
      const res = await fetch('/api/admin/publish-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ overrides }),
      })
      const json = await res.json()
      setPublishMsg(json.ok
        ? `✓ Published ${json.updatedCount} companies. Restart dev server to see changes.`
        : `✗ ${json.error}`)
    } catch (err) {
      setPublishMsg(`✗ ${err instanceof Error ? err.message : 'Network error'}`)
    } finally { setPublishing(false) }
  }

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
        <button onClick={fetchExchange} disabled={exchangeLoading}
          style={{ ...srcBtn, background: exchangeLoading ? 'var(--s3)' : 'rgba(0,180,216,0.12)', borderColor: 'var(--cyan2)', color: 'var(--cyan2)' }}>
          {exchangeLoading ? 'Fetching NSE…' : '↻ Refresh DealNector API'}
        </button>
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

      {/* Auto-refresh coverage summary */}
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
          {nseRefreshing ? 'refreshing…' : `${Object.keys(liveNseData).length}/${COMPANIES.length}`}
          {nseLastRefreshed && <span style={{ color: 'var(--txt3)' }}> · {nseLastRefreshed.toLocaleTimeString('en-IN')}</span>}
          <span style={{ color: 'var(--txt3)' }}> · hourly</span>
        </span>
        <span style={{ color: 'var(--br2)' }}>|</span>
        <span>
          <strong style={{ color: 'var(--green)' }}>Screener:</strong>{' '}
          {screenerRefreshing ? 'refreshing…' : `${Object.keys(liveScreenerAuto).length}/${COMPANIES.length}`}
          {screenerLastRefreshed && <span style={{ color: 'var(--txt3)' }}> · {screenerLastRefreshed.toLocaleTimeString('en-IN')}</span>}
          <span style={{ color: 'var(--txt3)' }}> · 3×/day IST</span>
        </span>
        <span style={{ color: 'var(--br2)' }}>|</span>
        <span>
          <strong style={{ color: 'var(--gold2)' }}>RapidAPI:</strong>{' '}
          {Object.keys(liveTickers).length} cached
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

      {/* Sub-tab navigation */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--br)', marginBottom: 10 }}>
        {([['main', 'Comparison Table'], ['ratios', 'Ratios & Working Capital'], ['discover', 'Discover SME Companies']] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setSubTab(k)}
            style={{ ...srcBtn, background: 'none', borderColor: 'transparent',
              borderBottom: subTab === k ? '2px solid var(--gold2)' : '2px solid transparent',
              color: subTab === k ? 'var(--gold2)' : 'var(--txt2)', borderRadius: 0, padding: '8px 14px' }}>
            {lbl}
          </button>
        ))}
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
            <div style={{ flex: 1 }} />
            <button onClick={handlePublish} disabled={publishing}
              style={{ background: 'var(--green)', color: '#fff', border: 'none',
                padding: '7px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '0.4px',
                textTransform: 'uppercase', borderRadius: 4, cursor: publishing ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
              {publishing ? 'Publishing…' : '✓ Publish to Website'}
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
          <div style={{ overflowX: 'auto', border: '1px solid var(--br)', borderRadius: 6, background: 'var(--s2)' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 10, whiteSpace: 'nowrap', minWidth: 2800 }}>
              <thead>
                <tr style={{ background: 'var(--s3)' }}>
                  <th style={sthStyle} rowSpan={2}>Company</th>
                  <th style={sthStyle} rowSpan={2}>↻</th>
                  <th style={sthStyle} rowSpan={2}>Source</th>
                  <th style={{ ...sthStyle, background: 'rgba(100,180,255,0.08)' }} colSpan={6}>Baseline</th>
                  <th style={{ ...sthStyle, background: 'rgba(247,183,49,0.08)' }} colSpan={6}>{'NSE/BSE Live'}</th>
                  <th style={{ ...sthStyle, background: 'rgba(16,185,129,0.08)' }} colSpan={6}>Screener.in</th>
                  <th style={{ ...sthStyle, background: 'rgba(0,180,216,0.08)' }} colSpan={6}>DealNector API (NSE)</th>
                </tr>
                <tr style={{ background: 'var(--s3)' }}>
                  {['MktCap','Rev','EBITDA','EV','EV/EB','P/E'].map((h) => <th key={`b-${h}`} style={sthStyle}>{h}</th>)}
                  {['MktCap','Rev','EBITDA','EV','EV/EB','P/E'].map((h) => <th key={`r-${h}`} style={sthStyle}>{h}</th>)}
                  {['MktCap','Rev','EBITDA','EV','EV/EB','P/E'].map((h) => <th key={`s-${h}`} style={sthStyle}>{h}</th>)}
                  {['MktCap','Rev','EBITDA','EV','EV/EB','P/E'].map((h) => <th key={`e-${h}`} style={sthStyle}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ baseCo, derived, screener, exchange, source }) => {
                  const liveCo = derived.company
                  return (
                    <tr key={baseCo.ticker} style={{ borderBottom: '1px solid var(--br)' }}>
                      <td style={{ ...stdStyle, fontWeight: 600, color: 'var(--txt)', position: 'sticky', left: 0, background: 'var(--s2)', zIndex: 1, minWidth: 160 }}>
                        {baseCo.name}<br />
                        <span style={{ fontSize: 8, color: 'var(--txt3)' }}>
                          {baseCo.ticker}
                          {derived.updatedAt && <> · <span style={{ color: 'var(--gold2)' }}>API {new Date(derived.updatedAt).toLocaleDateString('en-IN')}</span></>}
                          {screener && <> · <span style={{ color: 'var(--green)' }}>Scr {screener.period}</span></>}
                          {exchange && <> · <span style={{ color: 'var(--cyan2)' }}>NSE {new Date(exchange.fetchedAt).toLocaleDateString('en-IN')}</span></>}
                        </span>
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
                      {/* Baseline */}
                      <Cell v={baseCo.mktcap} cr /><Cell v={baseCo.rev} cr /><Cell v={baseCo.ebitda} cr />
                      <Cell v={baseCo.ev} cr /><Cell v={baseCo.ev_eb} suffix="×" /><Cell v={baseCo.pe} suffix="×" />
                      {/* RapidAPI */}
                      <Cell v={liveCo.mktcap} cr diff={baseCo.mktcap} /><Cell v={liveCo.rev} cr diff={baseCo.rev} />
                      <Cell v={liveCo.ebitda} cr diff={baseCo.ebitda} /><Cell v={liveCo.ev} cr diff={baseCo.ev} />
                      <Cell v={liveCo.ev_eb} suffix="×" diff={baseCo.ev_eb} /><Cell v={liveCo.pe} suffix="×" diff={baseCo.pe} />
                      {/* Screener */}
                      <Cell v={screener?.mktcapCr} cr diff={baseCo.mktcap} /><Cell v={screener?.salesCr} cr diff={baseCo.rev} />
                      <Cell v={screener?.ebitdaCr} cr diff={baseCo.ebitda} /><Cell v={screener?.evCr} cr diff={baseCo.ev} />
                      <Cell v={screener?.evEbitda} suffix="×" diff={baseCo.ev_eb} /><Cell v={screener?.pe} suffix="×" diff={baseCo.pe} />
                      {/* DealNector API (NSE) */}
                      <Cell v={exchange?.mktcapCr} cr diff={baseCo.mktcap} /><Cell v={null} cr />
                      <Cell v={null} cr /><Cell v={exchange?.evCr} cr diff={baseCo.ev} />
                      <Cell v={exchange?.evEbitda} suffix="×" diff={baseCo.ev_eb} /><Cell v={exchange?.pe} suffix="×" diff={baseCo.pe} />
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
                {Object.entries(screenerRatios).map(([ticker, ratioRow]) => {
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
                            onChange={(e) => setDiscoverSec((prev) => ({ ...prev, [r.id]: e.target.value as 'solar' | 'td' }))}
                            style={{ background: 'var(--s3)', border: '1px solid var(--br)', color: 'var(--txt)', fontSize: 10, padding: '3px 6px', borderRadius: 3, fontFamily: 'inherit' }}
                          >
                            <option value="solar">Solar</option>
                            <option value="td">T&D</option>
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

function Cell({
  v,
  cr,
  suffix,
  diff,
}: {
  v: number | null | undefined
  cr?: boolean
  suffix?: string
  diff?: number
}) {
  if (v == null || !Number.isFinite(v)) {
    return <td style={{ ...stdStyle, color: 'var(--txt3)' }}>—</td>
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
    <td style={{ ...stdStyle, fontFamily: 'JetBrains Mono, monospace' }}>
      {cr ? formatInrCr(v) : `${v.toFixed(1)}${suffix || ''}`}
      {diffPct != null && Math.abs(diffPct) >= 1 && (
        <span style={{ fontSize: 8, color: diffColor, marginLeft: 3 }}>
          {diffPct > 0 ? '+' : ''}{diffPct.toFixed(0)}%
        </span>
      )}
    </td>
  )
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
