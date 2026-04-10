'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Form, Input, Button, Progress } from 'antd'
import {
  EyeInvisibleOutlined,
  EyeTwoTone,
  ThunderboltFilled,
  LockOutlined,
  UserOutlined,
  MailOutlined,
  IdcardOutlined,
} from '@ant-design/icons'
import Link from 'next/link'

function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  if (!password) return { score: 0, label: '', color: '#EF4444' }
  let score = 0
  if (password.length >= 8) score += 25
  if (password.length >= 12) score += 10
  if (/[A-Z]/.test(password)) score += 20
  if (/[0-9]/.test(password)) score += 20
  if (/[^A-Za-z0-9]/.test(password)) score += 25

  if (score < 35) return { score, label: 'Weak', color: '#EF4444' }
  if (score < 60) return { score, label: 'Fair', color: '#F59E0B' }
  if (score < 80) return { score, label: 'Good', color: '#F7B731' }
  return { score, label: 'Strong', color: '#10B981' }
}

export default function SignupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const strength = getPasswordStrength(password)

  const onFinish = async (values: {
    fullName: string
    username: string
    email: string
    password: string
    confirmPassword: string
  }) => {
    setLoading(true)
    setError('')

    if (values.password !== values.confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: values.username,
          email: values.email,
          password: values.password,
          fullName: values.fullName,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Registration failed')
      } else {
        router.push('/login?registered=true')
      }
    } catch {
      setError('An unexpected error occurred. Please try again.')
    } finally {
      setLoading(false)
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
        padding: '24px 0',
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

      {/* Glow orbs */}
      <div
        style={{
          position: 'absolute',
          top: '10%',
          right: '20%',
          width: 400,
          height: 400,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(0,180,216,0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />
      <div
        style={{
          position: 'absolute',
          bottom: '10%',
          left: '15%',
          width: 360,
          height: 360,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(247,183,49,0.06) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        style={{ width: 460, position: 'relative', zIndex: 1 }}
      >
        <div
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            borderRadius: 12,
            padding: '36px 40px 32px',
            boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
          }}
        >
          {/* Logo */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.1 }}
            style={{ textAlign: 'center', marginBottom: 24 }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 46,
                height: 46,
                borderRadius: 10,
                background: 'linear-gradient(135deg, var(--gold) 0%, var(--cyan) 100%)',
                marginBottom: 12,
              }}
            >
              <ThunderboltFilled style={{ fontSize: 22, color: '#000' }} />
            </div>
            <h1
              style={{
                fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                fontSize: 24,
                fontWeight: 700,
                color: 'var(--txt)',
                margin: '0 0 4px',
              }}
            >
              Create Account
            </h1>
            <p style={{ fontSize: 12, color: 'var(--txt3)', margin: 0 }}>
              Join{' '}
              <span style={{ color: 'var(--gold2)', fontWeight: 600 }}>DealNector</span>{' '}
              — Solar Intelligence Platform
            </p>
          </motion.div>

          <div
            style={{
              height: 1,
              background: 'linear-gradient(to right, transparent, var(--br2), transparent)',
              marginBottom: 24,
            }}
          />

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
          >
            <Form onFinish={onFinish} layout="vertical" requiredMark={false}>
              <Form.Item
                name="fullName"
                rules={[{ required: true, message: 'Please enter your full name' }]}
                style={{ marginBottom: 14 }}
              >
                <Input
                  prefix={<IdcardOutlined style={{ color: 'var(--txt4)', marginRight: 4 }} />}
                  placeholder="Full Name"
                  size="large"
                  style={{
                    background: 'var(--s3)',
                    border: '1px solid var(--br)',
                    color: 'var(--txt)',
                    borderRadius: 6,
                    height: 42,
                  }}
                />
              </Form.Item>

              <Form.Item
                name="username"
                rules={[
                  { required: true, message: 'Please enter a username' },
                  { min: 3, message: 'Username must be at least 3 characters' },
                ]}
                style={{ marginBottom: 14 }}
              >
                <Input
                  prefix={<UserOutlined style={{ color: 'var(--txt4)', marginRight: 4 }} />}
                  placeholder="Username"
                  size="large"
                  style={{
                    background: 'var(--s3)',
                    border: '1px solid var(--br)',
                    color: 'var(--txt)',
                    borderRadius: 6,
                    height: 42,
                  }}
                />
              </Form.Item>

              <Form.Item
                name="email"
                rules={[
                  { required: true, message: 'Please enter your email' },
                  { type: 'email', message: 'Please enter a valid email' },
                ]}
                style={{ marginBottom: 14 }}
              >
                <Input
                  prefix={<MailOutlined style={{ color: 'var(--txt4)', marginRight: 4 }} />}
                  placeholder="Email address"
                  size="large"
                  style={{
                    background: 'var(--s3)',
                    border: '1px solid var(--br)',
                    color: 'var(--txt)',
                    borderRadius: 6,
                    height: 42,
                  }}
                />
              </Form.Item>

              <Form.Item
                name="password"
                rules={[
                  { required: true, message: 'Please enter a password' },
                  { min: 6, message: 'Password must be at least 6 characters' },
                ]}
                style={{ marginBottom: 8 }}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: 'var(--txt4)', marginRight: 4 }} />}
                  placeholder="Password"
                  size="large"
                  onChange={(e) => setPassword(e.target.value)}
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
                    height: 42,
                  }}
                />
              </Form.Item>

              {/* Password strength indicator */}
              {password && (
                <div style={{ marginBottom: 14 }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      marginBottom: 4,
                    }}
                  >
                    <span style={{ fontSize: 10, color: 'var(--txt3)' }}>
                      Password strength
                    </span>
                    <span style={{ fontSize: 10, color: strength.color, fontWeight: 600 }}>
                      {strength.label}
                    </span>
                  </div>
                  <Progress
                    percent={strength.score}
                    showInfo={false}
                    strokeColor={strength.color}
                    trailColor="var(--s4)"
                    size="small"
                    style={{ margin: 0 }}
                  />
                </div>
              )}

              <Form.Item
                name="confirmPassword"
                rules={[{ required: true, message: 'Please confirm your password' }]}
                style={{ marginBottom: 16 }}
              >
                <Input.Password
                  prefix={<LockOutlined style={{ color: 'var(--txt4)', marginRight: 4 }} />}
                  placeholder="Confirm password"
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
                    height: 42,
                  }}
                />
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
                    height: 44,
                    fontSize: 14,
                    fontWeight: 600,
                    fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                    background: 'linear-gradient(135deg, var(--cyan) 0%, var(--blue) 100%)',
                    border: 'none',
                    color: '#fff',
                    borderRadius: 6,
                  }}
                >
                  {loading ? 'Creating account...' : 'Create Account'}
                </Button>
              </Form.Item>
            </Form>

            <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--txt3)' }}>
              Already have an account?{' '}
              <Link
                href="/login"
                style={{ color: 'var(--gold2)', fontWeight: 500, textDecoration: 'none' }}
              >
                Sign in
              </Link>
            </div>
          </motion.div>
        </div>

        <div
          style={{
            textAlign: 'center',
            marginTop: 20,
            fontSize: 11,
            color: 'var(--txt4)',
          }}
        >
          By creating an account, you agree to our Terms of Service
        </div>
      </motion.div>
    </div>
  )
}
