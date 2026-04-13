'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Form, Input, Button, Checkbox } from 'antd'
import { EyeInvisibleOutlined, EyeTwoTone, ThunderboltFilled, LockOutlined, UserOutlined } from '@ant-design/icons'
import Link from 'next/link'
import { ForgotPasswordModal } from '@/components/auth/ForgotPasswordModal'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [forgotOpen, setForgotOpen] = useState(false)
  const [showCodePrompt, setShowCodePrompt] = useState(false)
  const [codeEmail, setCodeEmail] = useState('')
  const [authCode, setAuthCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [codeLoading, setCodeLoading] = useState(false)
  const [savedCredentials, setSavedCredentials] = useState<{ username: string; password: string } | null>(null)

  const onFinish = async (values: { username: string; password: string; remember: boolean }) => {
    setLoading(true)
    setError('')
    try {
      const result = await signIn('credentials', {
        username: values.username,
        password: values.password,
        redirect: false,
      })
      if (result?.error) {
        // Check for special error states from NextAuth authorize()
        if (result.error.includes('PENDING_APPROVAL')) {
          setError('Your account is pending admin approval. You will receive a welcome email once approved.')
        } else if (result.error.includes('AUTH_CODE_REQUIRED')) {
          // Extract email from error message
          const email = result.error.split(':')[1] || values.username
          setCodeEmail(email)
          setSavedCredentials({ username: values.username, password: values.password })
          setShowCodePrompt(true)
          setError('')
        } else {
          setError('Invalid credentials. Please check your username and password.')
        }
      } else if (result?.ok) {
        window.location.href = '/dashboard'
      }
    } catch {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const verifyCode = async () => {
    setCodeLoading(true)
    setCodeError('')
    try {
      const res = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: codeEmail, code: authCode.toUpperCase().trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) {
        setCodeError(data.error || 'Invalid authentication code')
        setCodeLoading(false)
        return
      }
      // Code verified — now log in normally
      if (savedCredentials) {
        const result = await signIn('credentials', {
          username: savedCredentials.username,
          password: savedCredentials.password,
          redirect: false,
        })
        if (result?.ok) {
          window.location.href = '/dashboard'
          return
        }
      }
      setCodeError('Code verified but login failed. Please try again.')
    } catch {
      setCodeError('An error occurred. Please try again.')
    } finally {
      setCodeLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Background grid */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(var(--br) 1px, transparent 1px), linear-gradient(90deg, var(--br) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          opacity: 0.15,
        }}
      />

      {/* Background glow orbs */}
      <div
        style={{
          position: 'absolute',
          top: '15%',
          left: '20%',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(247,183,49,0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '20%',
          right: '15%',
          width: 360,
          height: 360,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,180,216,0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        style={{
          width: 460,
          position: 'relative',
          zIndex: 1,
        }}
      >
        {/* Card */}
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 12,
            padding: '40px 40px 36px',
            boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
          }}
        >
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.4 }}
            style={{ textAlign: 'center', marginBottom: 28 }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 52,
                height: 52,
                borderRadius: 12,
                background: 'linear-gradient(135deg, var(--gold) 0%, var(--cyan) 100%)',
                marginBottom: 14,
              }}
            >
              <ThunderboltFilled style={{ fontSize: 24, color: '#000' }} />
            </div>
            <h1
              style={{
                fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                fontSize: 26,
                fontWeight: 700,
                color: 'var(--txt)',
                margin: '0 0 4px',
              }}
            >
              Deal<span style={{ color: 'var(--gold2)' }}>Nector</span>
            </h1>
            <p
              style={{
                fontSize: 12,
                color: 'var(--txt3)',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                margin: 0,
              }}
            >
              Institutional Intelligence Platform
            </p>
          </motion.div>

          {/* Divider */}
          <div
            style={{
              height: 1,
              background: 'linear-gradient(to right, transparent, var(--br2), transparent)',
              marginBottom: 28,
            }}
          />

          {/* Form */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.4 }}
          >
            <Form onFinish={onFinish} layout="vertical" requiredMark={false}>
              <Form.Item
                name="username"
                rules={[{ required: true, message: 'Please enter your username or email' }]}
                style={{ marginBottom: 16 }}
              >
                <Input
                  prefix={<UserOutlined style={{ color: 'var(--txt4)', marginRight: 4 }} />}
                  placeholder="Username or email"
                  size="large"
                  style={{
                    background: 'var(--s3)',
                    border: '1px solid var(--br)',
                    color: 'var(--txt)',
                    borderRadius: 6,
                    height: 44,
                  }}
                  autoComplete="username"
                />
              </Form.Item>

              <Form.Item
                name="password"
                rules={[{ required: true, message: 'Please enter your password' }]}
                style={{ marginBottom: 16 }}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: 'var(--txt4)', marginRight: 4 }} />}
                  placeholder="Password"
                  size="large"
                  iconRender={(visible) =>
                    visible ? (
                      <EyeTwoTone twoToneColor="#556880" />
                    ) : (
                      <EyeInvisibleOutlined style={{ color: 'var(--txt4)' }} />
                    )
                  }
                  style={{
                    background: 'var(--s3)',
                    border: '1px solid var(--br)',
                    color: 'var(--txt)',
                    borderRadius: 6,
                    height: 44,
                  }}
                  autoComplete="current-password"
                />
              </Form.Item>

              <Form.Item style={{ marginBottom: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Form.Item name="remember" valuePropName="checked" noStyle>
                    <Checkbox style={{ fontSize: 12, color: 'var(--txt3)' }}>
                      Remember me
                    </Checkbox>
                  </Form.Item>
                  <button
                    type="button"
                    onClick={() => setForgotOpen(true)}
                    style={{
                      fontSize: 12,
                      color: 'var(--cyan)',
                      textDecoration: 'none',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      padding: 0,
                    }}
                  >
                    Forgot password?
                  </button>
                </div>
              </Form.Item>

              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  style={{
                    background: 'var(--reddim)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderRadius: 6,
                    padding: '10px 14px',
                    fontSize: 12,
                    color: 'var(--red)',
                    marginBottom: 16,
                  }}
                >
                  {error}
                </motion.div>
              )}

              <Form.Item style={{ marginBottom: 16 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  size="large"
                  block
                  style={{
                    height: 46,
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                    background: 'linear-gradient(135deg, var(--gold) 0%, var(--gold2) 100%)',
                    border: 'none',
                    color: '#000',
                    borderRadius: 6,
                    letterSpacing: '0.5px',
                  }}
                >
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
              </Form.Item>
            </Form>

            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--txt3)' }}>
              Don&apos;t have an account?{' '}
              <Link
                href="/signup"
                style={{ color: 'var(--gold2)', fontWeight: 500, textDecoration: 'none' }}
              >
                Create account
              </Link>
            </div>
          </motion.div>
        </div>

        {/* Footer */}
        <div
          style={{
            textAlign: 'center',
            marginTop: 20,
            fontSize: 11,
            color: 'var(--txt4)',
          }}
        >
          Institutional access only · Secured by 256-bit encryption
        </div>
      </motion.div>
      <ForgotPasswordModal open={forgotOpen} onClose={() => setForgotOpen(false)} />

      {/* Auth Code Verification Prompt */}
      {showCodePrompt && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
          backdropFilter: 'blur(4px)',
        }}>
          <div style={{
            background: 'var(--s1, #0d1117)', border: '1px solid var(--br, #2a3a52)',
            borderRadius: 12, padding: '32px 28px', maxWidth: 420, width: '90%',
            textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🔐</div>
            <h3 style={{ fontSize: 17, fontWeight: 700, color: 'var(--txt, #d1dce8)', marginBottom: 8, fontFamily: "'Source Serif 4', Georgia, serif" }}>
              Authentication Code Required
            </h3>
            <p style={{ fontSize: 12, color: 'var(--txt2, #a0aec0)', lineHeight: 1.6, marginBottom: 16 }}>
              Enter the 6-character authentication code from your welcome email to activate your account.
            </p>
            <input
              type="text"
              value={authCode}
              onChange={e => setAuthCode(e.target.value.toUpperCase().slice(0, 6))}
              placeholder="e.g. DN7K2P"
              maxLength={6}
              style={{
                width: '100%', padding: '12px 16px', fontSize: 22, fontWeight: 700,
                fontFamily: "'JetBrains Mono', monospace", letterSpacing: '6px',
                textAlign: 'center', background: 'var(--s2, #131c2e)',
                border: '2px solid var(--gold2, #D4A43B)', borderRadius: 8,
                color: 'var(--gold2, #D4A43B)', outline: 'none',
              }}
            />
            {codeError && (
              <p style={{ fontSize: 11, color: 'var(--red, #f87171)', marginTop: 8 }}>{codeError}</p>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                onClick={() => { setShowCodePrompt(false); setSavedCredentials(null) }}
                style={{
                  flex: 1, padding: '10px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  background: 'transparent', border: '1px solid var(--br, #2a3a52)',
                  color: 'var(--txt3, #6b7a92)', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                onClick={verifyCode}
                disabled={authCode.length < 6 || codeLoading}
                style={{
                  flex: 2, padding: '10px', borderRadius: 6, fontSize: 12, fontWeight: 700,
                  background: authCode.length >= 6 ? 'var(--gold2, #D4A43B)' : 'var(--s3, #1a2640)',
                  border: 'none', color: authCode.length >= 6 ? '#000' : 'var(--txt4)',
                  cursor: authCode.length >= 6 ? 'pointer' : 'not-allowed',
                  letterSpacing: '0.5px',
                }}
              >
                {codeLoading ? 'Verifying...' : 'Verify & Sign In'}
              </button>
            </div>
            <p style={{ fontSize: 10, color: 'var(--txt4, #4a5a6e)', marginTop: 12, lineHeight: 1.5 }}>
              Check your email inbox and spam folder for the welcome email with your authentication code.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
