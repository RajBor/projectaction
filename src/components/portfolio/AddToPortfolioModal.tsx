'use client'

import { useEffect, useState } from 'react'
import type { Company } from '@/lib/data/companies'
import type { PrivateCompany } from '@/lib/data/private-companies'
import {
  addHolding,
  createPortfolio,
  holdingFromCompany,
  holdingFromPrivate,
  loadPortfolios,
  type Portfolio,
} from '@/lib/portfolio/store'

/**
 * Modal that adds a Company or PrivateCompany to a Portfolio (existing
 * or freshly created). Used by the Value Chain + Valuation + M&A Radar
 * pages as a drop-in picker.
 */
interface AddToPortfolioModalProps {
  target:
    | { kind: 'listed'; co: Company }
    | { kind: 'private'; co: PrivateCompany }
    | null
  onClose: () => void
}

export function AddToPortfolioModal({ target, onClose }: AddToPortfolioModalProps) {
  const [portfolios, setPortfolios] = useState<Portfolio[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [newName, setNewName] = useState('')
  const [weight, setWeight] = useState<string>('')
  const [mode, setMode] = useState<'existing' | 'new'>('existing')
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    if (!target) return
    const list = loadPortfolios()
    setPortfolios(list)
    if (list.length > 0) {
      setMode('existing')
      setSelectedId(list[0].id)
    } else {
      setMode('new')
    }
    setNewName('')
    setWeight('')
    setDone(null)
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

  const companyName =
    target.kind === 'listed' ? target.co.name : target.co.name
  const sector = target.co.sec
  const holdingEntryCr =
    target.kind === 'listed' ? target.co.mktcap || target.co.ev : target.co.ev_est

  const handleAdd = () => {
    let portfolio: Portfolio | null = null
    if (mode === 'new') {
      const name = newName.trim() || `${companyName} Portfolio`
      portfolio = createPortfolio(name, `Started with ${companyName}`)
    } else {
      portfolio = portfolios.find((p) => p.id === selectedId) ?? null
    }
    if (!portfolio) return

    const w = parseFloat(weight)
    const holding =
      target.kind === 'listed'
        ? holdingFromCompany(target.co, Number.isFinite(w) ? w : 0)
        : holdingFromPrivate(target.co, Number.isFinite(w) ? w : 0)

    addHolding(portfolio.id, holding)
    setDone(portfolio.id)
    setTimeout(() => {
      onClose()
    }, 900)
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
            color: 'var(--gold2)',
            marginBottom: 4,
          }}
        >
          Add to Portfolio
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
          {companyName}
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
          {target.kind === 'private' ? 'Private · ' : 'Listed · '}
          {sector.toUpperCase()} · Entry ₹{holdingEntryCr.toLocaleString('en-IN')}Cr
        </div>

        {portfolios.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginBottom: 14,
              background: 'var(--s2)',
              padding: 4,
              borderRadius: 5,
            }}
          >
            {(['existing', 'new'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  flex: 1,
                  background: mode === m ? 'var(--gold2)' : 'transparent',
                  color: mode === m ? '#000' : 'var(--txt2)',
                  border: 'none',
                  padding: '7px 10px',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  borderRadius: 3,
                  fontFamily: 'inherit',
                }}
              >
                {m === 'existing' ? 'Existing' : '+ New'}
              </button>
            ))}
          </div>
        )}

        {mode === 'existing' && portfolios.length > 0 ? (
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>Portfolio</label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              style={inputStyle}
            >
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.holdings.length} holdings)
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>New portfolio name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Solar Module Majors"
              style={inputStyle}
            />
          </div>
        )}

        <div style={{ marginBottom: 18 }}>
          <label style={labelStyle}>Weight (optional, 0–100)</label>
          <input
            type="number"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="Leave blank for equal weight"
            style={inputStyle}
            step="5"
            min="0"
            max="100"
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
            ✓ Added to portfolio. Redirecting…
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnStyle('ghost')}>
            Cancel
          </button>
          <button onClick={handleAdd} style={btnStyle('primary')} disabled={!!done}>
            ✓ Add
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
    return { ...base, background: 'var(--gold2)', color: '#000', borderColor: 'var(--gold2)' }
  return {
    ...base,
    background: 'transparent',
    color: 'var(--txt2)',
    borderColor: 'var(--br2)',
  }
}
