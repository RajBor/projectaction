'use client'

import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { motion, AnimatePresence } from 'framer-motion'
import { TickerBar } from './TickerBar'
import { Sidebar } from './Sidebar'
import { FirstLoginIndustryPicker } from './FirstLoginIndustryPicker'

const baseNavItems = [
  { label: 'Dashboard',  path: '/dashboard',   icon: '⬡' },
  { label: 'Value Chain', path: '/valuechain', icon: '◇' },
  { label: 'Stocks',     path: '/stocks',      icon: '$' },
  { label: 'M&A Radar',  path: '/maradar',     icon: '◉' },
  { label: 'Private',    path: '/private',     icon: '◈' },
  { label: 'FSA',        path: '/fsa',         icon: '📊' },
  { label: 'Report',     path: '/reports',     icon: '📄' },
  { label: 'Watchlist',  path: '/watchlist',   icon: '★' },
  { label: 'Deals',      path: '/dealtracker', icon: '▣' },
  { label: 'Compare',    path: '/compare',     icon: '⇄' },
  { label: 'News',       path: '/newshub',     icon: '◆' },
  { label: 'M&A Strategy', path: '/mastrategy', icon: '⚔' },
  { label: 'Settings',   path: '/settings',    icon: '⚙' },
]
const adminNavItem = { label: 'Admin', path: '/admin', icon: '🔒' }

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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark'>('dark')

  const isAdmin = user?.role === 'admin' || user?.role === 'subadmin'
  const navItems = isAdmin ? [...baseNavItems, adminNavItem] : baseNavItems

  useEffect(() => {
    const stored = (localStorage.getItem('sg4_theme') as 'light' | 'dark' | null) || 'dark'
    setTheme(stored)
    document.documentElement.setAttribute('data-theme', stored)
  }, [])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('sg4_theme', next)
  }

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
      {/* First-login industry picker (analyst role only, auto-hides when done) */}
      <FirstLoginIndustryPicker role={user?.role} />

      {/* Ticker Bar */}
      <TickerBar />

      {/* Top Nav */}
      <div
        data-dn-topbar
        style={{
          background: 'var(--s1)',
          borderBottom: '1px solid var(--br)',
          padding: '0 16px',
          height: 48,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexShrink: 0,
        }}
      >
        {/* Left: Logo + hamburger */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle workspace sidebar"
            style={{
              background: 'var(--s3)',
              border: '1px solid var(--br)',
              borderRadius: 4,
              color: 'var(--txt2)',
              cursor: 'pointer',
              fontSize: 14,
              width: 28,
              height: 28,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--gold2)'
            }}
            onMouseLeave={(e) => {
              ;(e.currentTarget as HTMLElement).style.color = 'var(--txt2)'
            }}
          >
            ☰
          </button>
          <div
            style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}
            onClick={() => router.push('/dashboard')}
          >
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: 4,
                background: 'linear-gradient(135deg, var(--gold) 0%, var(--cyan) 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 13,
                fontWeight: 700,
                color: '#000',
              }}
            >
              D
            </div>
            <span
              data-dn-mobile="hide"
              style={{
                fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                fontWeight: 700,
                fontSize: 16,
                letterSpacing: '-0.015em',
                color: 'var(--txt)',
              }}
            >
              Deal<span style={{ color: 'var(--gold2)' }}>Nector</span>
            </span>
          </div>

          {/* Live indicator */}
          <div data-dn-mobile="hide" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div
              className="live-dot"
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'var(--green)',
              }}
            />
            <span
              style={{
                fontSize: 9,
                fontWeight: 700,
                color: 'var(--green)',
                letterSpacing: '1.2px',
              }}
            >
              LIVE
            </span>
          </div>
        </div>

        {/* Center: Page Navigation — single row, scrolls only if overflow */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flex: '1 1 auto',
            minWidth: 0,
            overflowX: 'auto',
            overflowY: 'hidden',
            justifyContent: 'center',
            scrollbarWidth: 'none',
          }}
          className="no-scrollbar"
        >
          {navItems.map(({ label, path }) => {
            const isActive = pathname === path || pathname.startsWith(path + '/')
            return (
              <button
                key={path}
                onClick={() => router.push(path)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  borderBottom: isActive
                    ? '2px solid var(--gold2)'
                    : '2px solid transparent',
                  color: isActive ? 'var(--gold2)' : 'var(--txt2)',
                  padding: '14px 10px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: isActive ? 600 : 500,
                  fontFamily: 'inherit',
                  transition: 'color 0.15s',
                  letterSpacing: '-0.003em',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.color = 'var(--txt)'
                }}
                onMouseLeave={(e) => {
                  if (!isActive)
                    (e.currentTarget as HTMLElement).style.color = 'var(--txt2)'
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Right: Theme toggle + date/time + user */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            style={{
              background: 'var(--s3)',
              border: '1px solid var(--br)',
              color: 'var(--txt2)',
              width: 26,
              height: 26,
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'color 0.15s',
            }}
            onMouseEnter={(e) =>
              ((e.currentTarget as HTMLElement).style.color = 'var(--gold2)')
            }
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.color = 'var(--txt2)')
            }
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>

          <span
            data-dn-mobile="hide"
            style={{
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 10,
              color: 'var(--txt3)',
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {dateStr} · {timeStr}
          </span>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--gold2), var(--orange))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 11,
                fontWeight: 700,
                color: '#000',
                flexShrink: 0,
              }}
            >
              {initials}
            </div>
            <div data-dn-mobile="hide" style={{ lineHeight: 1.1 }}>
              <div style={{ fontSize: 11, color: 'var(--txt)', fontWeight: 500 }}>
                {user?.name || user?.username || 'User'}
              </div>
              <div style={{ fontSize: 9, color: 'var(--txt3)', textTransform: 'capitalize' }}>
                {user?.role || 'analyst'}
              </div>
            </div>
          </div>

          <button
            onClick={() => signOut({ callbackUrl: '/' })}
            data-dn-mobile-xs="hide"
            style={{
              background: 'var(--reddim)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: 'var(--red)',
              padding: '4px 10px',
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'all 0.15s',
              flexShrink: 0,
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
      <div style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        {/* Floating Sidebar overlay */}
        <AnimatePresence initial={false}>
          {sidebarOpen && (
            <>
              <motion.div
                key="sidebar-backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                onClick={() => setSidebarOpen(false)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.45)',
                  backdropFilter: 'blur(2px)',
                  zIndex: 40,
                }}
              />
              <motion.div
                key="sidebar-panel"
                initial={{ x: -280, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                exit={{ x: -280, opacity: 0 }}
                transition={{ duration: 0.22, ease: 'easeOut' }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  bottom: 0,
                  zIndex: 50,
                }}
              >
                <Sidebar onClose={() => setSidebarOpen(false)} />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Main content */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
            background: 'var(--bg)',
          }}
        >
          <motion.div
            key={pathname}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.2 }}
            className="page-main"
            style={{
              minHeight: '100%',
              width: '100%',
            }}
          >
            {children}
          </motion.div>
        </div>
      </div>
    </div>
  )
}
