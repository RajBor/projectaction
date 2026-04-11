'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Animated metrics strip — shows 5 hero-level product stats that
 * count up from 0 once the strip scrolls into view. Used on the
 * landing page to give visual proof that DealNector is a live,
 * data-heavy platform (80+ targets, 7 valuation methods, etc.).
 *
 * Uses IntersectionObserver so the count-up only fires once when
 * the strip first becomes visible, honouring reduced-motion.
 */

interface Metric {
  value: number
  suffix: string
  label: string
  sub: string
}

const METRICS: Metric[] = [
  { value: 83, suffix: '+', label: 'Listed Targets', sub: 'Solar + T&D coverage' },
  { value: 28, suffix: '', label: 'Private Targets', sub: 'Pre-IPO + PE-backed' },
  { value: 7, suffix: '', label: 'Valuation Methods', sub: 'DCF · Comps · Book' },
  { value: 21, suffix: '', label: 'Chain Segments', sub: 'End-to-end mapped' },
  { value: 6, suffix: '', label: 'News Feeds', sub: 'Dedup + sentiment' },
]

export function MetricsStrip() {
  const ref = useRef<HTMLDivElement>(null)
  const [started, setStarted] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setStarted(true)
      return
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStarted(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={ref} className="dn-metrics-strip">
      {METRICS.map((m, i) => (
        <div className="dn-metric-cell" key={m.label}>
          <CounterValue target={m.value} suffix={m.suffix} started={started} delayMs={i * 120} />
          <div className="dn-metric-label">{m.label}</div>
          <div className="dn-metric-sub">{m.sub}</div>
        </div>
      ))}
    </div>
  )
}

/**
 * Eased count-up from 0 → target over ~1.4s after an optional
 * per-cell delay, then holds. Uses requestAnimationFrame so it
 * stays smooth on every refresh rate.
 */
function CounterValue({
  target,
  suffix,
  started,
  delayMs,
}: {
  target: number
  suffix: string
  started: boolean
  delayMs: number
}) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    if (!started) return
    let rafId = 0
    let startT = 0
    const duration = 1400
    const start = () => {
      const tick = (t: number) => {
        if (!startT) startT = t
        const elapsed = t - startT
        const p = Math.min(1, elapsed / duration)
        // ease-out cubic
        const eased = 1 - Math.pow(1 - p, 3)
        setDisplay(Math.round(target * eased))
        if (p < 1) rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    }
    const timeout = window.setTimeout(start, delayMs)
    return () => {
      window.clearTimeout(timeout)
      if (rafId) cancelAnimationFrame(rafId)
    }
  }, [started, target, delayMs])

  return (
    <div className="dn-metric-value">
      {display}
      {suffix}
    </div>
  )
}
