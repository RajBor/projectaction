'use client'

import { useMemo } from 'react'
import { useLiveSnapshot } from '@/components/live/LiveSnapshotProvider'
import { COMPANIES } from '@/lib/data/companies'

/**
 * Live stock ticker bar — scrolls across the top of the dashboard.
 *
 * Data source: NSE exchange data from LiveSnapshotProvider (auto-refreshes
 * hourly during market hours 9:15am–3:30pm IST). Falls back to static
 * company snapshot data when NSE data is unavailable.
 *
 * Shows last update timestamp at the left edge.
 */

// Tickers to display in the bar (curated list of key energy/infra stocks)
const TICKER_LIST = [
  'ADANIGREEN', 'TATAPOWER', 'SJVN', 'WAAREEENS', 'PREMIENRG',
  'IREDA', 'TORNTPOWER', 'CESC', 'NTPC', 'POWERGRID',
  'INOXWIND', 'BOROSIL', 'KPITTECH', 'STERLINWIL', 'SOLARA',
  'POLYCAB', 'KEI', 'CGPOWER', 'VOLTAMP', 'SUZLON',
]

interface TickerItem {
  ticker: string
  price: string
  change: string
  up: boolean
}

/** Check if Indian stock market is currently open (9:15 AM – 3:30 PM IST, Mon–Fri) */
function isMarketOpen(): boolean {
  const now = new Date()
  // Convert to IST (UTC+5:30)
  const utc = now.getTime() + now.getTimezoneOffset() * 60000
  const ist = new Date(utc + 5.5 * 3600000)
  const day = ist.getDay() // 0=Sun, 6=Sat
  if (day === 0 || day === 6) return false
  const h = ist.getHours()
  const m = ist.getMinutes()
  const totalMin = h * 60 + m
  return totalMin >= 555 && totalMin <= 930 // 9:15 to 15:30
}

function formatTime(date: Date | null): string {
  if (!date) return ''
  return date.toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).replace(',', ' ·') + ' IST'
}

export function TickerBar() {
  const { nseData, nseLastRefreshed } = useLiveSnapshot()
  const marketOpen = isMarketOpen()

  // Build ticker items from live NSE data, falling back to company snapshot
  const items = useMemo<TickerItem[]>(() => {
    return TICKER_LIST.map(ticker => {
      const nse = nseData[ticker]
      const co = COMPANIES.find(c => c.ticker === ticker || c.nse === ticker)
      if (nse && nse.lastPrice) {
        const price = nse.lastPrice
        const chg = nse.changePct ?? 0
        return {
          ticker: co?.nse || ticker,
          price: `₹${price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          change: `${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%`,
          up: chg >= 0,
        }
      }
      // Fallback to static company data
      if (co) {
        return {
          ticker: co.nse || co.ticker,
          price: co.mktcap > 0 ? `₹${(co.mktcap * 10000000 / ((co.mktcap / (co.pe > 0 ? co.pe : 20)) * 10000000 / co.pat || 1)).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : '—',
          change: `${co.revg >= 0 ? '+' : ''}${co.revg.toFixed(2)}%`,
          up: co.revg >= 0,
        }
      }
      return { ticker, price: '—', change: '—', up: true }
    }).filter(t => t.price !== '—')
  }, [nseData])

  const doubled = [...items, ...items]
  const lastUpdate = nseLastRefreshed ? formatTime(nseLastRefreshed) : null

  return (
    <div
      style={{
        background: 'var(--s1)',
        borderBottom: '1px solid var(--br)',
        height: 32,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
      }}
    >
      {/* Last update timestamp — fixed at left */}
      <div
        style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '0 12px', zIndex: 3,
          background: 'var(--s1)',
          borderRight: '1px solid var(--br)',
        }}
      >
        <span
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: marketOpen ? 'var(--green)' : 'var(--txt4)',
            boxShadow: marketOpen ? '0 0 6px var(--green)' : 'none',
            flexShrink: 0,
          }}
          title={marketOpen ? 'Market open (NSE 9:15 AM – 3:30 PM IST)' : 'Market closed — prices from last session'}
        />
        <span
          style={{
            fontFamily: 'JetBrains Mono, monospace',
            fontSize: 9,
            color: 'var(--txt3)',
            whiteSpace: 'nowrap',
            letterSpacing: '0.3px',
          }}
          title={`NSE data refreshes every hour during market hours. ${lastUpdate ? 'Last: ' + lastUpdate : 'No data yet'}`}
        >
          {lastUpdate || 'Loading...'}
        </span>
      </div>

      {/* Gradient fade edges */}
      <div
        style={{
          position: 'absolute', left: 160, top: 0, bottom: 0, width: 48,
          background: 'linear-gradient(to right, var(--s1), transparent)',
          zIndex: 2,
        }}
      />
      <div
        style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 48,
          background: 'linear-gradient(to left, var(--s1), transparent)',
          zIndex: 2,
        }}
      />

      {/* Scrolling ticker track */}
      <div
        className="ticker-track"
        style={{ display: 'flex', alignItems: 'center', marginLeft: 170 }}
      >
        {doubled.map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0 24px', borderRight: '1px solid var(--br)',
              whiteSpace: 'nowrap',
            }}
          >
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--txt2)', letterSpacing: '0.5px' }}>
              {item.ticker}
            </span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--txt)', fontWeight: 500 }}>
              {item.price}
            </span>
            <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: item.up ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}>
              {item.change}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
