'use client'

import { useState } from 'react'

/**
 * Forgot Password modal — 3 steps:
 *   1. Enter email + solve captcha → sends reset code
 *   2. Enter code + new password → resets password
 *   3. Success confirmation
 *
 * Captcha: simple math (a + b = ?), same pattern as the auth modal.
 * Rate limit: 2× per day per email (enforced server-side).
 * Background: solid dark to ensure visibility (user requirement).
 */

interface Props {
  open: boolean
  onClose: () => void
}

function genCaptcha() {
  const a = Math.floor(Math.random() * 8) + 2
  const b = Math.floor(Math.random() * 8) + 2
  return { a, b, answer: a + b }
}

export function ForgotPasswordModal({ open, onClose }: Props) {
  const [step, setStep] = useState<'email' | 'code' | 'done'>('email')
  const [email, setEmail] = useState('')
  const [captcha, setCaptcha] = useState(() => genCaptcha())
  const [captchaInput, setCaptchaInput] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const refreshCaptcha = () => {
    setCaptcha(genCaptcha())
    setCaptchaInput('')
  }

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    // Validate captcha
    const typed = parseInt(captchaInput.trim(), 10)
    if (!Number.isFinite(typed) || typed !== captcha.answer) {
      setError('Captcha answer is incorrect.')
      refreshCaptcha()
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          captchaAnswer: typed,
          captchaExpected: captcha.answer,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Request failed')
        refreshCaptcha()
      } else {
        setMessage(data.message || 'Code sent to your email.')
        setStep('code')
      }
    } catch {
      setError('Network error')
      refreshCaptcha()
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (newPassword !== confirmPw) {
      setError('Passwords do not match.')
      return
    }
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters.')
      return
    }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          code: code.trim(),
          newPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Reset failed')
      } else {
        setStep('done')
        setMessage(data.message || 'Password reset successfully.')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} style={modalStyle}>
        {/* Close button */}
        <button onClick={onClose} style={closeBtnStyle} aria-label="Close">×</button>

        {/* Brand */}
        <div style={{ marginBottom: 4 }}>
          <span style={{ fontFamily: "'Newsreader',Georgia,serif", fontSize: 20, fontWeight: 700, color: '#E8EDF5' }}>
            Deal
          </span>
          <span style={{ fontFamily: "'Newsreader',Georgia,serif", fontSize: 20, fontWeight: 700, fontStyle: 'italic', color: '#F7B731' }}>
            Nector
          </span>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase' as const, color: '#F7B731', marginBottom: 12 }}>
          — Password Reset
        </div>

        {/* Step 1: Email + Captcha */}
        {step === 'email' && (
          <form onSubmit={handleRequestCode}>
            <h2 style={titleStyle}>Forgot your password?</h2>
            <p style={{ fontSize: 13, color: '#9AAFC8', lineHeight: 1.6, margin: '0 0 18px' }}>
              Enter your registered email. We&apos;ll send a 6-character code to reset your password.
              <br />
              <span style={{ fontSize: 11, color: '#7388A6' }}>Limited to 2 requests per day.</span>
            </p>

            <div style={fieldStyle}>
              <label style={labelStyle}>Email address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="analyst@firm.com"
                required
                style={inputStyle}
              />
            </div>

            {/* Captcha — solid dark background */}
            <div style={captchaContainerStyle}>
              <label style={{ ...labelStyle, color: '#F7B731', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                Human verification
                <button type="button" onClick={refreshCaptcha} style={captchaRefreshStyle} title="New challenge">↻</button>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 10, alignItems: 'center' }}>
                <div style={captchaQStyle}>
                  {captcha.a} + {captcha.b} =
                </div>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="?"
                  value={captchaInput}
                  onChange={(e) => setCaptchaInput(e.target.value.replace(/\D/g, '').slice(0, 3))}
                  required
                  autoComplete="off"
                  style={captchaInputStyle}
                />
              </div>
            </div>

            {error && <div style={errorStyle}>{error}</div>}

            <button type="submit" disabled={loading} style={btnPrimaryStyle}>
              {loading ? 'Sending…' : 'Send Reset Code →'}
            </button>
          </form>
        )}

        {/* Step 2: Code + New Password */}
        {step === 'code' && (
          <form onSubmit={handleResetPassword}>
            <h2 style={titleStyle}>Enter your reset code</h2>
            {message && <p style={{ fontSize: 12, color: '#10B981', margin: '0 0 14px', fontWeight: 600 }}>{message}</p>}
            <p style={{ fontSize: 13, color: '#9AAFC8', lineHeight: 1.6, margin: '0 0 18px' }}>
              Check your email for the 6-character code. It expires in 15 minutes.
            </p>

            <div style={fieldStyle}>
              <label style={labelStyle}>Reset code</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
                placeholder="ABC123"
                required
                autoComplete="off"
                style={{ ...inputStyle, fontFamily: "'JetBrains Mono', monospace", fontSize: 18, fontWeight: 700, textAlign: 'center' as const, letterSpacing: '0.3em' }}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                style={inputStyle}
              />
            </div>

            <div style={fieldStyle}>
              <label style={labelStyle}>Confirm new password</label>
              <input
                type="password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                placeholder="••••••••"
                required
                style={inputStyle}
              />
            </div>

            {error && <div style={errorStyle}>{error}</div>}

            <button type="submit" disabled={loading} style={btnPrimaryStyle}>
              {loading ? 'Resetting…' : 'Reset Password →'}
            </button>

            <button type="button" onClick={() => { setStep('email'); setError(''); refreshCaptcha() }} style={btnGhostStyle}>
              ← Back to email
            </button>
          </form>
        )}

        {/* Step 3: Success */}
        {step === 'done' && (
          <div style={{ textAlign: 'center' as const }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <h2 style={{ ...titleStyle, textAlign: 'center' as const }}>Password Reset</h2>
            <p style={{ fontSize: 13, color: '#10B981', fontWeight: 600, margin: '0 0 20px' }}>{message}</p>
            <button onClick={onClose} style={btnPrimaryStyle}>Sign In →</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Styles (solid dark background matching the auth modal) ──

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(4, 8, 20, 0.88)',
  backdropFilter: 'blur(10px)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 200,
  padding: 16,
}

const modalStyle: React.CSSProperties = {
  background: '#0D1424',
  border: '1px solid #25324F',
  borderTop: '3px solid #F7B731',
  borderRadius: 10,
  padding: '32px 34px 28px',
  width: '100%',
  maxWidth: 440,
  maxHeight: 'calc(100vh - 48px)',
  overflowY: 'auto',
  position: 'relative',
  boxShadow: '0 24px 60px rgba(0,0,0,0.55), 0 0 60px rgba(247,183,49,0.06)',
  color: '#E8EDF5',
  fontFamily: "'Inter', -apple-system, sans-serif",
}

const closeBtnStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  width: 28,
  height: 28,
  border: '1.5px solid #3A4D7A',
  borderRadius: 5,
  background: '#121B31',
  color: '#9AAFC8',
  fontSize: 18,
  cursor: 'pointer',
}

const titleStyle: React.CSSProperties = {
  fontFamily: "'Newsreader', Georgia, serif",
  fontSize: 24,
  fontWeight: 600,
  color: '#E8EDF5',
  margin: '0 0 10px',
  letterSpacing: '-0.02em',
}

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 5,
  marginBottom: 14,
}

const labelStyle: React.CSSProperties = {
  fontSize: 9.5,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  color: '#7388A6',
  fontWeight: 700,
}

const inputStyle: React.CSSProperties = {
  background: '#121B31',
  border: '1.5px solid #3A4D7A',
  borderRadius: 6,
  color: '#E8EDF5',
  padding: '11px 13px',
  fontSize: 13,
  outline: 'none',
  fontFamily: 'inherit',
  transition: 'border-color .15s',
}

const captchaContainerStyle: React.CSSProperties = {
  background: '#1A2233',
  border: '1.5px dashed rgba(247, 183, 49, 0.65)',
  borderRadius: 8,
  padding: '12px 14px 14px',
  marginBottom: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}

const captchaQStyle: React.CSSProperties = {
  background: '#182443',
  border: '1.5px solid #3A4D7A',
  borderRadius: 6,
  padding: '11px 14px',
  fontFamily: "'Newsreader', Georgia, serif",
  fontSize: 20,
  fontWeight: 700,
  color: '#E8EDF5',
  textAlign: 'center',
  userSelect: 'none',
}

const captchaInputStyle: React.CSSProperties = {
  ...inputStyle,
  textAlign: 'center',
  fontFamily: "'Newsreader', Georgia, serif",
  fontSize: 20,
  fontWeight: 700,
  borderColor: '#F7B731',
  background: '#182443',
}

const captchaRefreshStyle: React.CSSProperties = {
  background: '#121B31',
  border: '1px solid #F7B731',
  borderRadius: '50%',
  color: '#F7B731',
  fontSize: 13,
  cursor: 'pointer',
  width: 22,
  height: 22,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0,
  lineHeight: 1,
}

const errorStyle: React.CSSProperties = {
  background: 'rgba(239,68,68,0.12)',
  border: '1.5px solid #EF4444',
  borderRadius: 6,
  color: '#EF4444',
  padding: '10px 13px',
  fontSize: 12,
  fontWeight: 600,
  marginBottom: 14,
}

const btnPrimaryStyle: React.CSSProperties = {
  width: '100%',
  background: 'linear-gradient(180deg, #F7B731 0%, #E6A523 100%)',
  color: '#0A2340',
  border: '1.5px solid #F7B731',
  padding: '12px 24px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
  marginBottom: 10,
}

const btnGhostStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  color: '#9AAFC8',
  border: '1px solid #25324F',
  padding: '10px 24px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  borderRadius: 6,
  cursor: 'pointer',
  fontFamily: 'inherit',
}
