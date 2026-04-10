'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Form, Input, Button, Checkbox } from 'antd'
import { EyeInvisibleOutlined, EyeTwoTone, ThunderboltFilled, LockOutlined, UserOutlined } from '@ant-design/icons'
import Link from 'next/link'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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
        setError('Invalid credentials. Please check your username and password.')
      } else if (result?.ok) {
     window.location.href = '/dashboard'


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
                fontFamily: 'Space Grotesk, sans-serif',
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
                  <a
                    href="#"
                    style={{
                      fontSize: 12,
                      color: 'var(--cyan)',
                      textDecoration: 'none',
                    }}
                  >
                    Forgot password?
                  </a>
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
                    fontFamily: 'Space Grotesk, sans-serif',
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
    </div>
  )
}
