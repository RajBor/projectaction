'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Badge } from '@/components/ui/Badge'

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

type Tab = 'users' | 'interests' | 'email' | 'password'

export default function AdminDashboardPage() {
  const { data: session, status } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role
  const isAdmin = role === 'admin'

  const [tab, setTab] = useState<Tab>('users')
  const [users, setUsers] = useState<AdminUserRow[]>([])
  const [interests, setInterests] = useState<InterestRow[]>([])
  const [emailLog, setEmailLog] = useState<EmailLogRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

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
      const [u, i, e] = await Promise.all([
        fetch('/api/admin/users').then((r) => r.json()),
        fetch('/api/admin/interests').then((r) => r.json()),
        fetch('/api/admin/email-log').then((r) => r.json()),
      ])
      if (u.ok) setUsers(u.users || [])
      if (i.ok) setInterests(i.interests || [])
      if (e.ok) setEmailLog(e.log || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (status === 'authenticated' && isAdmin) {
      refreshAll()
    }
  }, [status, isAdmin, refreshAll])

  // ── Guards ──────────────────────────────────────────────
  if (status === 'loading') {
    return <div style={{ padding: 24, color: 'var(--txt3)' }}>Loading…</div>
  }
  if (status !== 'authenticated' || !isAdmin) {
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
            ['users', `Users (${users.length})`],
            ['interests', `Deal Interests (${interests.length})`],
            ['email', `Email Log (${emailLog.length})`],
            ['password', 'Change Admin Password'],
          ] as Array<[Tab, string]>
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
                      <Badge variant={u.role === 'admin' ? 'gold' : 'gray'}>{u.role}</Badge>
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
                      <button
                        onClick={() => toggleActive(u.id, u.is_active)}
                        disabled={u.role === 'admin'}
                        style={{
                          background: u.is_active ? 'var(--reddim)' : 'var(--greendim)',
                          border: `1px solid ${u.is_active ? 'var(--red)' : 'var(--green)'}`,
                          color: u.is_active ? 'var(--red)' : 'var(--green)',
                          padding: '3px 8px',
                          fontSize: 10,
                          fontWeight: 600,
                          borderRadius: 3,
                          cursor: u.role === 'admin' ? 'not-allowed' : 'pointer',
                          marginRight: 4,
                          opacity: u.role === 'admin' ? 0.4 : 1,
                          fontFamily: 'inherit',
                        }}
                      >
                        {u.is_active ? 'Restrict' : 'Enable'}
                      </button>
                      <button
                        onClick={() => deleteUser(u.id, u.email)}
                        disabled={u.role === 'admin'}
                        style={{
                          background: 'transparent',
                          border: '1px solid var(--red)',
                          color: 'var(--red)',
                          padding: '3px 8px',
                          fontSize: 10,
                          fontWeight: 600,
                          borderRadius: 3,
                          cursor: u.role === 'admin' ? 'not-allowed' : 'pointer',
                          opacity: u.role === 'admin' ? 0.4 : 1,
                          fontFamily: 'inherit',
                        }}
                      >
                        Delete
                      </button>
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
    </div>
  )
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
