'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Guided Walkthrough section — auto-advancing product tour for the
 * DealNector landing page, inspired by dhanhq.co/algos.
 *
 * Five numbered steps on the left, an animated mock UI on the right.
 * Auto-advances every AUTO_MS, pauses on hover, and can be driven
 * manually via the numbered dots or the side arrows. Progress bar
 * resets on every step change.
 *
 * Every visual inside the mock is pure CSS + DOM — no charting
 * library — so the whole component is <2KB gzipped and works on
 * any theme because it uses the existing .dn-* palette tokens.
 */

interface Step {
  id: string
  eyebrow: string
  title: string
  body: string
  tip: string
  mock: 'map' | 'valuation' | 'news' | 'portfolio' | 'report'
}

const STEPS: Step[] = [
  {
    id: 'map',
    eyebrow: 'Step 1 · Map',
    title: 'Scan the value chain',
    body: 'Every listed and private target mapped into solar + T&D segments. Click any segment on the dashboard to land straight inside its page.',
    tip: 'Try it → Dashboard › any value-chain tile',
    mock: 'map',
  },
  {
    id: 'valuation',
    eyebrow: 'Step 2 · Value',
    title: 'Triangulate the number',
    body: 'DCF with assumption control, peer comparables, and a football field. Every figure auditable, every delta explainable.',
    tip: 'Try it → Valuation › any row › PDF',
    mock: 'valuation',
  },
  {
    id: 'news',
    eyebrow: 'Step 3 · Read',
    title: 'Let the market move your number',
    body: 'Google News + PV Magazine merged, sentiment-scored, and translated into per-parameter valuation deltas. Acknowledge what matters.',
    tip: 'Try it → News Hub › ⚙ Impact on any card',
    mock: 'news',
  },
  {
    id: 'portfolio',
    eyebrow: 'Step 4 · Track',
    title: 'Watch the thesis compound',
    body: 'Bundle public + private targets into portfolios with live trend hydration and news events dropped right on the chart.',
    tip: 'Try it → Portfolios › + New Portfolio',
    mock: 'portfolio',
  },
  {
    id: 'report',
    eyebrow: 'Step 5 · Deliver',
    title: 'Export an institutional-grade memo',
    body: 'One click to generate a 7-page institutional report — DCF, peers, news impact, football field — auto-printed to PDF.',
    tip: 'Try it → M&A Radar › ◈ PDF Report',
    mock: 'report',
  },
]

const AUTO_MS = 6500

export function GuidedWalkthrough() {
  const [idx, setIdx] = useState(0)
  const [paused, setPaused] = useState(false)
  const [progress, setProgress] = useState(0)
  const startedAtRef = useRef<number>(Date.now())

  const go = useCallback((next: number) => {
    const n = ((next % STEPS.length) + STEPS.length) % STEPS.length
    setIdx(n)
    startedAtRef.current = Date.now()
    setProgress(0)
  }, [])

  // Auto-advance + progress-bar tick
  useEffect(() => {
    if (paused) return
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current
      const pct = Math.min(100, (elapsed / AUTO_MS) * 100)
      setProgress(pct)
      if (elapsed >= AUTO_MS) {
        go(idx + 1)
      }
    }, 60)
    return () => window.clearInterval(interval)
  }, [idx, paused, go])

  // Arrow key navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowRight') go(idx + 1)
      if (e.key === 'ArrowLeft') go(idx - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [idx, go])

  const step = STEPS[idx]

  return (
    <div
      className="dn-walkthrough"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Progress bar */}
      <div className="dn-walk-progress">
        <div className="dn-walk-progress-fill" style={{ width: `${progress}%` }} />
      </div>

      <div className="dn-walk-grid">
        {/* LEFT — text + steps */}
        <div className="dn-walk-left">
          <div className="dn-walk-eyebrow">{step.eyebrow}</div>
          <h3 className="dn-walk-title">{step.title}</h3>
          <p className="dn-walk-body">{step.body}</p>
          <div className="dn-walk-tip">
            <span className="dn-walk-tip-arrow">↳</span>
            {step.tip}
          </div>

          {/* Step dots + arrows */}
          <div className="dn-walk-nav">
            <button
              className="dn-walk-arrow"
              onClick={() => go(idx - 1)}
              aria-label="Previous step"
            >
              ←
            </button>
            <div className="dn-walk-dots">
              {STEPS.map((s, i) => (
                <button
                  key={s.id}
                  onClick={() => go(i)}
                  className={`dn-walk-dot ${i === idx ? 'active' : ''}`}
                  aria-label={`Go to step ${i + 1}`}
                  aria-current={i === idx ? 'step' : undefined}
                >
                  <span className="dn-walk-dot-num">{String(i + 1).padStart(2, '0')}</span>
                </button>
              ))}
            </div>
            <button
              className="dn-walk-arrow"
              onClick={() => go(idx + 1)}
              aria-label="Next step"
            >
              →
            </button>
          </div>

          <div className="dn-walk-hint">
            {paused ? 'Paused · move away to resume' : 'Auto-advances every 6s · hover to pause · use ← →'}
          </div>
        </div>

        {/* RIGHT — animated mock UI, one per step */}
        <div className="dn-walk-right">
          <div className="dn-walk-mock-frame">
            <div className="dn-walk-mock-tabs">
              <span className="dn-walk-mock-tab-dot" />
              <span className="dn-walk-mock-tab-dot" />
              <span className="dn-walk-mock-tab-dot" />
              <span className="dn-walk-mock-tab-label">dealnector.app</span>
            </div>
            <div className="dn-walk-mock-body" key={step.id}>
              {step.mock === 'map' && <MockMap />}
              {step.mock === 'valuation' && <MockValuation />}
              {step.mock === 'news' && <MockNews />}
              {step.mock === 'portfolio' && <MockPortfolio />}
              {step.mock === 'report' && <MockReport />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Mock UI primitives ──────────────────────────────────────────

function MockMap() {
  return (
    <div className="dn-mock dn-mock-map">
      <div className="dn-mock-title">Solar Value Chain</div>
      <div className="dn-mock-map-grid">
        {[
          { label: 'Polysilicon', hot: false },
          { label: 'Wafers', hot: false },
          { label: 'Solar Cells', hot: true },
          { label: 'Modules', hot: true },
          { label: 'Inverters', hot: false },
          { label: 'Trackers', hot: false },
          { label: 'EPC', hot: false },
          { label: 'HV Cables', hot: true },
          { label: 'ACSR', hot: false },
        ].map((t, i) => (
          <div
            key={t.label}
            className={`dn-mock-chip ${t.hot ? 'hot' : ''}`}
            style={{ animationDelay: `${i * 70}ms` }}
          >
            <span className="dn-mock-chip-dot" /> {t.label}
          </div>
        ))}
      </div>
      <div className="dn-mock-cursor" />
    </div>
  )
}

function MockValuation() {
  return (
    <div className="dn-mock dn-mock-valuation">
      <div className="dn-mock-title">EV/EBITDA · 14.7× → 15.1×</div>
      <div className="dn-mock-bars">
        {[62, 74, 81, 89, 95].map((h, i) => (
          <div
            key={i}
            className="dn-mock-bar"
            style={{
              height: `${h}%`,
              animationDelay: `${i * 120}ms`,
            }}
          />
        ))}
      </div>
      <div className="dn-mock-row">
        <div className="dn-mock-metric">
          <span className="dn-mock-k">DCF</span>
          <span className="dn-mock-v">₹52,100 Cr</span>
        </div>
        <div className="dn-mock-metric">
          <span className="dn-mock-k">Peer median</span>
          <span className="dn-mock-v">₹48,700 Cr</span>
        </div>
        <div className="dn-mock-metric">
          <span className="dn-mock-k">Upside</span>
          <span className="dn-mock-v pos">+7.0%</span>
        </div>
      </div>
    </div>
  )
}

function MockNews() {
  const items = [
    { sent: 'pos', title: 'India installs record 45 GW solar capacity in FY26', delta: '+1.20%' },
    { sent: 'neg', title: 'Module glut pushes polysilicon prices to 18-month low', delta: '-0.45%' },
    { sent: 'pos', title: 'PLI Phase 2 notified for 20 GW additional cell capacity', delta: '+0.85%' },
  ]
  return (
    <div className="dn-mock dn-mock-news">
      <div className="dn-mock-title">Impact on Waaree Energies</div>
      {items.map((n, i) => (
        <div key={i} className={`dn-mock-news-card ${n.sent}`} style={{ animationDelay: `${i * 250}ms` }}>
          <span className="dn-mock-pill">{n.sent === 'pos' ? 'POS' : 'NEG'}</span>
          <span className="dn-mock-headline">{n.title}</span>
          <span className="dn-mock-delta">{n.delta}</span>
        </div>
      ))}
      <div className="dn-mock-foot">
        <span className="dn-mock-k">Acq Score</span>
        <span className="dn-mock-v">7.8 <span className="dn-mock-arrow">→</span> <span className="pos">8.1</span></span>
      </div>
    </div>
  )
}

function MockPortfolio() {
  return (
    <div className="dn-mock dn-mock-portfolio">
      <div className="dn-mock-title">Solar Majors · 6 holdings</div>
      <svg
        className="dn-mock-chart"
        viewBox="0 0 320 120"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="dn-mock-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.45" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path
          d="M 0 90 L 30 82 L 60 88 L 90 74 L 120 78 L 150 60 L 180 48 L 210 56 L 240 38 L 270 30 L 300 22 L 320 18 L 320 120 L 0 120 Z"
          fill="url(#dn-mock-grad)"
          className="dn-mock-area"
        />
        <path
          d="M 0 90 L 30 82 L 60 88 L 90 74 L 120 78 L 150 60 L 180 48 L 210 56 L 240 38 L 270 30 L 300 22 L 320 18"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="dn-mock-line"
        />
        {/* Event markers */}
        <line x1="120" y1="10" x2="120" y2="110" stroke="#2E6B3A" strokeDasharray="3 3" opacity="0.7" />
        <line x1="210" y1="10" x2="210" y2="110" stroke="#A9232B" strokeDasharray="3 3" opacity="0.7" />
      </svg>
      <div className="dn-mock-row">
        <div className="dn-mock-metric">
          <span className="dn-mock-k">Return</span>
          <span className="dn-mock-v pos">+18.4%</span>
        </div>
        <div className="dn-mock-metric">
          <span className="dn-mock-k">Events</span>
          <span className="dn-mock-v">2 material</span>
        </div>
      </div>
    </div>
  )
}

function MockReport() {
  return (
    <div className="dn-mock dn-mock-report">
      <div className="dn-mock-report-page">
        <div className="dn-mock-report-brand">
          Deal<em>Nector</em>
        </div>
        <div className="dn-mock-report-rule" />
        <div className="dn-mock-report-eyebrow">Valuation Report · Confidential</div>
        <div className="dn-mock-report-title">
          Waaree Energies <span className="dn-mock-em">Strong Buy</span>
        </div>
        <div className="dn-mock-report-meta">
          <span>DCF: ₹52,100 Cr</span>
          <span>·</span>
          <span>Peer: 15.1×</span>
          <span>·</span>
          <span>Upside +7.0%</span>
        </div>
        <div className="dn-mock-report-lines">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="dn-mock-report-line" style={{ width: `${80 - i * 6}%` }} />
          ))}
        </div>
      </div>
      <div className="dn-mock-report-stamp">PDF</div>
    </div>
  )
}
