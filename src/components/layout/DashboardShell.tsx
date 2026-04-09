'use client'

import { useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { motion, AnimatePresence } from 'framer-motion'
import { TickerBar } from './TickerBar'
import { Sidebar } from './Sidebar'

const navItems = [
  { label: 'Dashboard', path: '/dashboard', icon: '⬡' },
  { label: 'Deal Tracker', path: '/deal-tracker', icon: '◈' },
  { label: 'Valuation', path: '/valuation', icon: '◉' },
  { label: 'Watchlist', path: '/watchlist', icon: '◎' },
  { label: 'News Hub', path: '/news', icon: '◆' },
  { label: 'Settings', path: '/settings', icon: '⚙' },
]

interface DashboardShellProps {
  children: React.ReactNode
  user?: {
    name?: string | null
    email?: string | null
    username?: string
    role?: string
  }
}

function LiveClock() {
  const [time, setTime] = useState(new Date())
  if (typeof window !== 'undefined') {
    // Only run in browser
  }
  return (
    <span
      style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 12,
        color: 'var(--txt3)',
      }}
    >
      {time.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}{' '}
      {time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
    </span>
  )
}

export function DashboardShell({ children, user }: DashboardShellProps) {
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const now = new Date()
  const dateStr = now.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
  const timeStr = now.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  })

  const initials = (user?.name || user?.username || 'U')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        background: 'var(--bg)',
        overflow: 'hidden',
      }}
    >
      {/* Ticker Bar */}
      <TickerBar />

      {/* Top Nav */}
      <div
        style={{
          background: 'var(--s1)',
          borderBottom: '1px solid var(--br)',
          padding: '0 20px',
          height: 52,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}
      >
        {/* Left: Logo + hamburger */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--txt3)',
              cursor: 'pointer',
              fontSize: 16,
              padding: 4,
            }}
          >
            ☰
          </button>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
            onClick={() => router.push('/dashboard')}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: 'linear-gradient(135deg, var(--gold) 0%, var(--cyan) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 14,
                fontWeight: 700,
                color: '#000',
              }}
            >
              D
            </div>
            <span
              style={{
                fontFamily: 'Space Grotesk, sans-serif',
                fontWeight: 700,
                fontSize: 16,
                color: 'var(--txt)',
              }}
            >
              Deal<span style={{ color: 'var(--gold2)' }}>Nector</span>
            </span>
          </div>

          {/* Live indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div
              className="live-dot"
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: 'var(--green)',
              }}
            />
            <span style={{ fontSize: 10, color: 'var(--green)', letterSpacing: '1px' }}>
              LIVE
            </span>
          </div>
        </div>

        {/* Center: Page Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          {navItems.map(({ label, path }) => {
            const isActive = pathname === path || pathname.startsWith(path + '/')
            return (
              <button
                key={path}
                onClick={() => router.push(path)}
                style={{
                  background: 'none',
                  border: 'none',
                  borderBottom: isActive ? '2px solid var(--gold2)' : '2px solid transparent',
                  color: isActive ? 'var(--gold2)' : 'var(--txt3)',
                  padding: '14px 14px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 400,
                  transition: 'all 0.15s',
                  letterSpacing: '0.3px',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.color = 'var(--txt)'
                }}
                onMouseLeave={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.color = 'var(--txt3)'
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Right: Date/time + user */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11,
              color: 'var(--txt3)',
            }}
          >
            {dateStr} · {timeStr}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--gold2), var(--orange))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 12,
                fontWeight: 700,
                color: '#000',
              }}
            >
              {initials}
            </div>
            <div>
              <div style={{ fontSize: 12, color: 'var(--txt)', fontWeight: 500 }}>
                {user?.name || user?.username || 'User'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--txt3)', textTransform: 'capitalize' }}>
                {user?.role || 'analyst'}
              </div>
            </div>
          </div>

          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            style={{
              background: 'var(--reddim)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: 'var(--red)',
              padding: '4px 12px',
              borderRadius: 4,
              fontSize: 11,
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.background = 'rgba(239,68,68,0.2)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = 'var(--reddim)')
            }
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Sidebar */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 220, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeInOut' }}
              style={{ overflow: 'hidden', flexShrink: 0 }}
            >
              <Sidebar />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            background: 'var(--bg)',
          }}
        >
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            style={{ minHeight: '100%', padding: 24 }}
          >
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  )
}
