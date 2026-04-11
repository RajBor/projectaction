'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Badge } from '@/components/ui/Badge'

type ToastKind = 'success' | 'error' | 'info'

interface ToastMsg {
  kind: ToastKind
  text: string
}

function getLS(key: string, fallback = ''): string {
  if (typeof window === 'undefined') return fallback
  return localStorage.getItem(`sg4_${key}`) || fallback
}

function setLS(key: string, value: string) {
  if (typeof window === 'undefined') return
  localStorage.setItem(`sg4_${key}`, value)
}

function countLS(prefix: string): number {
  if (typeof window === 'undefined') return 0
  try {
    const raw = localStorage.getItem(`sg4_${prefix}`)
    if (!raw) return 0
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

// Simple deterministic hash for password (matches sg4 style)
function hashPw(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return (h >>> 0).toString(16)
}

function valPw(pw: string): { ok: boolean; msg: string } {
  if (pw.length < 8) return { ok: false, msg: 'Password must be at least 8 characters.' }
  if (!/[0-9]/.test(pw)) return { ok: false, msg: 'Password must contain at least 1 number.' }
  if (!/[^A-Za-z0-9]/.test(pw)) return { ok: false, msg: 'Password must contain at least 1 special character.' }
  return { ok: true, msg: 'OK' }
}

export default function SettingsPage() {
  const { data: session } = useSession()
  const [toast, setToast] = useState<ToastMsg | null>(null)

  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confPw, setConfPw] = useState('')
  const [pwMsg, setPwMsg] = useState<ToastMsg | null>(null)

  const [wlCount, setWlCount] = useState(0)
  const [dealsCount, setDealsCount] = useState(0)
  const [sessionAge, setSessionAge] = useState(0)

  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  // Reset confirmation modal state
  const [resetOpen, setResetOpen] = useState(false)
  const [resetPw, setResetPw] = useState('')
  const [resetErr, setResetErr] = useState('')
  const [resetBusy, setResetBusy] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    setWlCount(countLS('wl'))
    setDealsCount(countLS('deals'))
    const th = (getLS('theme', 'dark') || 'dark') as 'dark' | 'light'
    setTheme(th)
    try {
      const rawSession = localStorage.getItem('sg4_session')
      if (rawSession) {
        const parsed = JSON.parse(rawSession)
        if (parsed?.ts) setSessionAge(Math.round((Date.now() - parsed.ts) / 60000))
      }
    } catch {
      // ignore
    }
  }, [])

  const showToast = (kind: ToastKind, text: string) => {
    setToast({ kind, text })
    setTimeout(() => setToast(null), 2500)
  }

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    setLS('theme', next)
    if (typeof document !== 'undefined') {
      document.documentElement.setAttribute('data-theme', next)
    }
  }

  const handleChangePassword = () => {
    setPwMsg(null)
    const storedHash = getLS('pwHash', '')
    if (storedHash && hashPw(curPw) !== storedHash) {
      setPwMsg({ kind: 'error', text: 'Current password incorrect.' })
      return
    }
    const v = valPw(newPw)
    if (!v.ok) {
      setPwMsg({ kind: 'error', text: v.msg })
      return
    }
    if (newPw !== confPw) {
      setPwMsg({ kind: 'error', text: 'Passwords do not match.' })
      return
    }
    // NOTE: real auth is handled elsewhere. We only store the hash in localStorage
    // as a display-only placeholder. We do NOT touch src/lib/auth.ts or the NextAuth session.
    setLS('pwHash', hashPw(newPw))
    setCurPw('')
    setNewPw('')
    setConfPw('')
    setPwMsg({ kind: 'success', text: '✓ Password updated successfully (local only)' })
    setTimeout(() => setPwMsg(null), 3000)
  }

  const exportCSV = (filename: string, rows: string[][]) => {
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const exportValuation = () => {
    exportCSV('valuation.csv', [
      ['Name', 'Ticker', 'Sector', 'EV/EBITDA', 'P/E'],
      ['(Valuation matrix export — populated from live data in full app)', '', '', '', ''],
    ])
    showToast('success', 'Valuation matrix exported')
  }
  const exportDeals = () => {
    try {
      const raw = localStorage.getItem('sg4_deals')
      const deals = raw ? JSON.parse(raw) : []
      const rows: string[][] = [['Target', 'Stage', 'EV', 'Owner', 'Sector']]
      if (Array.isArray(deals) && deals.length) {
        deals.forEach((d: Record<string, unknown>) => {
          rows.push([
            String(d.name || ''),
            String(d.stage || ''),
            String(d.ev || ''),
            String(d.owner || ''),
            String(d.sec || ''),
          ])
        })
      }
      exportCSV('deals.csv', rows)
      showToast('success', 'Deal pipeline exported')
    } catch {
      showToast('error', 'No deal data found')
    }
  }
  const exportWatchlist = () => {
    try {
      const raw = localStorage.getItem('sg4_wl')
      const wl = raw ? JSON.parse(raw) : []
      const rows: string[][] = [['Name', 'Ticker', 'Sector']]
      if (Array.isArray(wl) && wl.length) {
        wl.forEach((w: Record<string, unknown>) => {
          rows.push([String(w.name || ''), String(w.ticker || ''), String(w.sec || '')])
        })
      }
      exportCSV('watchlist.csv', rows)
      showToast('success', 'Watchlist exported')
    } catch {
      showToast('error', 'No watchlist data found')
    }
  }

  const openResetModal = () => {
    setResetPw('')
    setResetErr('')
    setResetOpen(true)
  }

  const confirmReset = async () => {
    if (!resetPw) {
      setResetErr('Enter your password to confirm.')
      return
    }
    setResetBusy(true)
    setResetErr('')
    try {
      const res = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: resetPw }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) {
        setResetErr(data.error || 'Verification failed.')
        setResetBusy(false)
        return
      }
      const keys = ['wl', 'deals', 'theme', 'session', 'pwHash', 'industry']
      keys.forEach((k) => localStorage.removeItem(`sg4_${k}`))
      setResetOpen(false)
      showToast('success', 'Reset complete — reloading…')
      setTimeout(() => window.location.reload(), 1200)
    } catch {
      setResetErr('Network error. Please try again.')
      setResetBusy(false)
    }
  }

  const userEmail = session?.user?.email || 'rajbordia23@gmail.com'
  const userName = session?.user?.name || (session?.user as { username?: string })?.username || 'Raj Bordia'
  const initial = userName.charAt(0).toUpperCase()

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          <span className="dn-wordmark">Deal<em>Nector</em></span> <span style={{ margin: '0 6px' }}>›</span> Account
        </div>
        <h1
          style={{
            fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
            marginBottom: 10,
          }}
        >
          Account <em style={{ color: 'var(--gold2)', fontStyle: 'normal' }}>Settings</em>
        </h1>
        <Badge variant="gray">Profile · Security · Preferences · Data Management</Badge>
      </div>

      {/* Toast */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            background:
              toast.kind === 'success' ? 'var(--greendim)' : toast.kind === 'error' ? 'var(--reddim)' : 'var(--cyandim)',
            border: `1px solid ${
              toast.kind === 'success' ? 'var(--green)' : toast.kind === 'error' ? 'var(--red)' : 'var(--cyan2)'
            }`,
            color:
              toast.kind === 'success' ? 'var(--green)' : toast.kind === 'error' ? 'var(--red)' : 'var(--cyan2)',
            padding: '10px 16px',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 500,
            zIndex: 1000,
          }}
        >
          {toast.text}
        </div>
      )}

      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 20,
        }}
      >
        {/* 1. Account Profile */}
        <SettingsSection title="👤 Account Profile">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 18 }}>
                <div
                  style={{
                    width: 58,
                    height: 58,
                    borderRadius: '50%',
                    background: 'linear-gradient(135deg,var(--gold2),var(--orange))',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                    fontSize: 22,
                    fontWeight: 700,
                    color: '#000',
                  }}
                >
                  {initial}
                </div>
                <div>
                  <div
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: 'var(--txt)',
                      fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                    }}
                  >
                    {userName}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--txt3)', marginTop: 3 }}>{userEmail}</div>
                  <div style={{ marginTop: 6 }}>
                    <Badge variant="green">Admin · Full Access</Badge>
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                <KpiCell color="var(--green)" label="Watchlist" value={String(wlCount)} />
                <KpiCell color="var(--orange)" label="Deals" value={String(dealsCount)} />
                <KpiCell
                  color="var(--cyan2)"
                  label="Session"
                  value={`${sessionAge}m`}
                  sub="active"
                />
              </div>
            </div>
            <div
              style={{
                background: 'var(--s1)',
                border: '1px solid var(--br)',
                borderRadius: 8,
                padding: 16,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--txt)',
                  marginBottom: 10,
                  fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                }}
              >
                Session Information
              </div>
              <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.7, margin: 0 }}>
                Signed in as: <strong style={{ color: 'var(--gold2)' }}>{userEmail}</strong>
                <br />
                Session expires: <strong>8h after last activity</strong>
                <br />
                Auth backend: <strong>NextAuth (secure)</strong>
              </p>
              <div
                style={{
                  marginTop: 14,
                  fontSize: 11,
                  color: 'var(--txt3)',
                  fontStyle: 'italic',
                }}
              >
                Use Sign Out in the top nav to end your session.
              </div>
            </div>
          </div>
        </SettingsSection>

        {/* 2. Change Password */}
        <SettingsSection title="🔐 Change Password">
          <div style={{ maxWidth: 460 }}>
            <div
              style={{
                fontSize: 11,
                color: 'var(--orange)',
                marginBottom: 12,
                fontStyle: 'italic',
              }}
            >
              Note: Real auth is handled by NextAuth. This form stores a local hash only — it does not change your server-side login credentials.
            </div>
            {pwMsg && (
              <div
                style={{
                  marginBottom: 12,
                  padding: '10px 14px',
                  borderRadius: 6,
                  background:
                    pwMsg.kind === 'success' ? 'var(--greendim)' : 'var(--reddim)',
                  border: `1px solid ${pwMsg.kind === 'success' ? 'var(--green)' : 'var(--red)'}`,
                  color: pwMsg.kind === 'success' ? 'var(--green)' : 'var(--red)',
                  fontSize: 13,
                }}
              >
                {pwMsg.text}
              </div>
            )}
            <FormField label="Current Password">
              <input
                type="password"
                placeholder="Current password"
                value={curPw}
                onChange={(e) => setCurPw(e.target.value)}
                style={inputStyle}
              />
            </FormField>
            <FormField label="New Password">
              <input
                type="password"
                placeholder="Min 8 chars, 1 number, 1 special"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                style={inputStyle}
              />
            </FormField>
            <FormField label="Confirm New Password">
              <input
                type="password"
                placeholder="Repeat new password"
                value={confPw}
                onChange={(e) => setConfPw(e.target.value)}
                style={inputStyle}
              />
            </FormField>
            <button
              onClick={handleChangePassword}
              style={{
                width: '100%',
                padding: '10px',
                background: 'var(--green)',
                color: '#000',
                border: 'none',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                marginTop: 6,
              }}
            >
              Update Password →
            </button>
          </div>
        </SettingsSection>

        {/* 3. Display Preferences */}
        <SettingsSection title="🎨 Display Preferences">
          <div style={{ maxWidth: 460 }}>
            <Card title="Theme">
              <p style={{ margin: 0, marginBottom: 12, color: 'var(--txt2)', fontSize: 13 }}>
                Current: <strong style={{ color: 'var(--gold2)' }}>{theme === 'dark' ? 'Dark Mode' : 'Light Mode'}</strong>
              </p>
              <button onClick={toggleTheme} style={btnStyle}>
                Toggle Dark / Light Mode
              </button>
              <p
                style={{
                  margin: 0,
                  marginTop: 10,
                  fontSize: 11,
                  color: 'var(--txt3)',
                  fontStyle: 'italic',
                }}
              >
                Tip: you can also toggle the theme from the ☀ / ☾ button in the top nav.
              </p>
            </Card>
          </div>
        </SettingsSection>

        {/* Reset Confirmation Modal */}
        {resetOpen && (
          <div
            onClick={() => !resetBusy && setResetOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.7)',
              backdropFilter: 'blur(4px)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: 'var(--s1)',
                border: '1px solid var(--br2)',
                borderRadius: 12,
                width: 'min(440px, 92vw)',
                padding: 24,
                boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: 'var(--reddim)',
                    border: '1px solid var(--red)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 18,
                  }}
                >
                  ⚠
                </div>
                <div>
                  <div
                    style={{
                      fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                      fontSize: 18,
                      fontWeight: 600,
                      color: 'var(--txt)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    Confirm Reset
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 2 }}>
                    Enter your password to permanently erase all local data.
                  </div>
                </div>
              </div>

              <div
                style={{
                  background: 'var(--reddim)',
                  border: '1px solid rgba(239,68,68,0.3)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  fontSize: 12,
                  color: 'var(--txt2)',
                  lineHeight: 1.5,
                  marginBottom: 14,
                }}
              >
                <strong style={{ color: 'var(--red)' }}>This will delete:</strong> watchlist,
                deal pipeline, theme preference, industry preference, and any local session data.
                Your account itself is unaffected.
              </div>

              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--txt3)',
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                  }}
                >
                  Password
                </div>
                <input
                  type="password"
                  value={resetPw}
                  autoFocus
                  disabled={resetBusy}
                  onChange={(e) => {
                    setResetPw(e.target.value)
                    if (resetErr) setResetErr('')
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmReset()
                  }}
                  placeholder="Enter your account password"
                  style={inputStyle}
                />
                {resetErr && (
                  <div
                    style={{
                      marginTop: 8,
                      fontSize: 12,
                      color: 'var(--red)',
                    }}
                  >
                    {resetErr}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button
                  onClick={() => setResetOpen(false)}
                  disabled={resetBusy}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: 'var(--s3)',
                    border: '1px solid var(--br)',
                    color: 'var(--txt2)',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: resetBusy ? 'not-allowed' : 'pointer',
                    opacity: resetBusy ? 0.6 : 1,
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={confirmReset}
                  disabled={resetBusy || !resetPw}
                  style={{
                    flex: 1,
                    padding: '10px',
                    background: resetBusy || !resetPw ? 'var(--reddim)' : 'var(--red)',
                    border: '1px solid var(--red)',
                    color: resetBusy || !resetPw ? 'var(--red)' : '#fff',
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: resetBusy || !resetPw ? 'not-allowed' : 'pointer',
                  }}
                >
                  {resetBusy ? 'Verifying…' : 'Confirm Reset'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 4. Data Management */}
        <SettingsSection title="💾 Data Management" last>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
            <Card title="Export Data">
              <button onClick={exportValuation} style={{ ...btnStyle, width: '100%', marginBottom: 8 }}>
                ⬇ Valuation Matrix CSV
              </button>
              <button onClick={exportDeals} style={{ ...btnStyle, width: '100%', marginBottom: 8 }}>
                ⬇ Deal Pipeline CSV
              </button>
              <button onClick={exportWatchlist} style={{ ...btnStyle, width: '100%' }}>
                ⬇ Watchlist CSV
              </button>
            </Card>
            <Card title="Sharing">
              <p style={{ margin: 0, marginBottom: 12, fontSize: 13, color: 'var(--txt3)' }}>
                Get a shareable public URL for this dashboard.
              </p>
              <button
                onClick={() => showToast('info', 'Share feature — coming soon')}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: 'var(--green)',
                  color: '#000',
                  border: 'none',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ⟁ Share Dashboard
              </button>
            </Card>
            <Card title="Reset Data">
              <p style={{ margin: 0, marginBottom: 12, fontSize: 13, color: 'var(--red)' }}>
                Permanently clears watchlist, deals, and settings. Cannot be undone. Requires password confirmation.
              </p>
              <button
                onClick={openResetModal}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  background: 'var(--reddim)',
                  color: 'var(--red)',
                  border: '1px solid var(--red)',
                  borderRadius: 6,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ⚠ Reset All Data
              </button>
            </Card>
          </div>
        </SettingsSection>
      </div>
    </div>
  )
}

// ── helpers ──

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--s3)',
  border: '1px solid var(--br)',
  color: 'var(--txt)',
  padding: '8px 12px',
  borderRadius: 6,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
}

const btnStyle: React.CSSProperties = {
  background: 'var(--s3)',
  border: '1px solid var(--br2)',
  color: 'var(--txt2)',
  padding: '8px 10px',
  borderRadius: 6,
  fontSize: 13,
  cursor: 'pointer',
  fontFamily: 'inherit',
}

function SettingsSection({
  title,
  children,
  last,
}: {
  title: string
  children: React.ReactNode
  last?: boolean
}) {
  return (
    <div
      style={{
        paddingBottom: 20,
        marginBottom: last ? 0 : 20,
        borderBottom: last ? 'none' : '1px solid var(--br)',
      }}
    >
      <div
        style={{
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--txt)',
          marginBottom: 14,
          fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
          letterSpacing: '.3px',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--txt3)',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          marginBottom: 5,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--s1)',
        border: '1px solid var(--br)',
        borderRadius: 8,
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 700,
          color: 'var(--txt)',
          textTransform: 'uppercase',
          letterSpacing: '.8px',
          marginBottom: 10,
          fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function KpiCell({
  color,
  label,
  value,
  sub,
}: {
  color: string
  label: string
  value: string
  sub?: string
}) {
  return (
    <div
      style={{
        background: 'var(--s1)',
        border: '1px solid var(--br)',
        borderLeft: `3px solid ${color}`,
        borderRadius: 6,
        padding: '10px 12px',
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--txt3)',
          letterSpacing: '1px',
          textTransform: 'uppercase',
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color,
          fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4 }}>{sub}</div>
      )}
    </div>
  )
}
