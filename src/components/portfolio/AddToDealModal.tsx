'use client'

import { useEffect, useState } from 'react'

/**
 * Lightweight Add-to-Deal-Pipeline modal. Writes directly into the
 * `sg4_deals` localStorage key that the DealTracker page already
 * reads from, so deals added from anywhere appear instantly in the
 * pipeline without any provider plumbing.
 */

interface AddToDealModalProps {
  target: { name: string; ev: string; sector: string } | null
  onClose: () => void
}

interface Deal {
  id: number
  name: string
  ev: string
  type: string
  stage: 'Screening' | 'Diligence' | 'Negotiation' | 'LOI' | 'Closed'
  sector: string
  notes: string
  created: string
}

const STORAGE_KEY = 'sg4_deals'
const STAGES: Deal['stage'][] = ['Screening', 'Diligence', 'Negotiation', 'LOI', 'Closed']
const TYPES = [
  'Acquisition',
  'Strategic Stake',
  'Minority Stake',
  'Joint Venture',
  'Asset Purchase',
  'Merger',
  'Technology License',
]

function loadDeals(): Deal[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Deal[]) : []
  } catch {
    return []
  }
}

function saveDeals(deals: Deal[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(deals))
  } catch {
    /* ignore */
  }
}

export function AddToDealModal({ target, onClose }: AddToDealModalProps) {
  const [stage, setStage] = useState<Deal['stage']>('Screening')
  const [type, setType] = useState<string>('Strategic Stake')
  const [notes, setNotes] = useState<string>('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!target) return
    setStage('Screening')
    setType('Strategic Stake')
    setNotes('')
    setDone(false)
  }, [target])

  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target, onClose])

  if (!target) return null

  const handleAdd = () => {
    const list = loadDeals()
    const next: Deal = {
      id: Date.now(),
      name: target.name,
      ev: target.ev,
      type,
      stage,
      sector: target.sector,
      notes: notes.trim(),
      created: new Date().toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
      }),
    }
    saveDeals([...list, next])
    setDone(true)
    setTimeout(() => onClose(), 900)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(2px)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--s1)',
          border: '1px solid var(--br2)',
          borderRadius: 8,
          width: 'min(480px, 100%)',
          padding: 22,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '1.6px',
            textTransform: 'uppercase',
            color: 'var(--cyan2)',
            marginBottom: 4,
          }}
        >
          Add to Deal Pipeline
        </div>
        <div
          style={{
            fontFamily: 'Source Serif 4, Georgia, serif',
            fontSize: 20,
            fontWeight: 600,
            color: 'var(--txt)',
            letterSpacing: '-0.01em',
            marginBottom: 4,
          }}
        >
          {target.name}
        </div>
        <div
          style={{
            fontSize: 11,
            color: 'var(--txt3)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            marginBottom: 18,
          }}
        >
          {target.ev} · {target.sector.toUpperCase()}
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Deal Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)} style={inputStyle}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle}>Initial Stage</label>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as Deal['stage'])}
            style={inputStyle}
          >
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Preliminary rationale, anchor rationale, etc."
            style={{
              ...inputStyle,
              minHeight: 70,
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
        </div>
        {done && (
          <div
            style={{
              marginBottom: 12,
              padding: '9px 12px',
              background: 'var(--greendim)',
              color: 'var(--green)',
              borderRadius: 4,
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            ✓ Deal added. Available in Deal Tracker.
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnStyle('ghost')}>
            Cancel
          </button>
          <button onClick={handleAdd} style={btnStyle('primary')} disabled={done}>
            ✓ Add to Pipeline
          </button>
        </div>
      </div>
    </div>
  )
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 9,
  color: 'var(--txt3)',
  letterSpacing: '1px',
  textTransform: 'uppercase',
  fontWeight: 700,
  marginBottom: 5,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--s2)',
  border: '1.5px solid var(--br)',
  color: 'var(--txt)',
  padding: '9px 12px',
  fontSize: 12,
  borderRadius: 4,
  outline: 'none',
  fontFamily: 'inherit',
}

function btnStyle(variant: 'primary' | 'ghost'): React.CSSProperties {
  const base: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.4px',
    textTransform: 'uppercase',
    padding: '8px 16px',
    borderRadius: 4,
    cursor: 'pointer',
    fontFamily: 'inherit',
    border: '1px solid',
  }
  if (variant === 'primary')
    return { ...base, background: 'var(--cyan2)', color: '#000', borderColor: 'var(--cyan2)' }
  return {
    ...base,
    background: 'transparent',
    color: 'var(--txt2)',
    borderColor: 'var(--br2)',
  }
}
