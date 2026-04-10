'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'

// ── Types ────────────────────────────────────────────

export interface WorkingStep {
  label: string
  calc?: string
  result?: string
}

export interface WorkingTable {
  title?: string
  headers: string[]
  rows: (string | number)[][]
}

export interface WorkingSource {
  name: string
  color?: string
  note?: string
}

export interface WorkingNote {
  type?: 'note' | 'warn'
  k: string
  v: string
}

export interface WorkingAssumption {
  k: string
  v: string
}

export interface WorkingDef {
  icon?: string
  title: string
  subtitle?: string
  result?: string
  resultLabel?: string
  resultNote?: string
  benchmark?: string
  formula?: string
  steps?: WorkingStep[]
  table?: WorkingTable
  assumptions?: WorkingAssumption[]
  sources?: WorkingSource[]
  notes?: WorkingNote[]
}

// ── Context ─────────────────────────────────────────

interface WorkingPopupContextValue {
  showWorking: (def: WorkingDef) => void
  closeWorking: () => void
}

const WorkingPopupContext = createContext<WorkingPopupContextValue | null>(null)

export function useWorkingPopup(): WorkingPopupContextValue {
  const ctx = useContext(WorkingPopupContext)
  if (!ctx) {
    throw new Error('useWorkingPopup must be used within a WorkingPopupProvider')
  }
  return ctx
}

// ── Provider ────────────────────────────────────────

export function WorkingPopupProvider({ children }: { children: React.ReactNode }) {
  const [def, setDef] = useState<WorkingDef | null>(null)

  const showWorking = useCallback((d: WorkingDef) => setDef(d), [])
  const closeWorking = useCallback(() => setDef(null), [])

  return (
    <WorkingPopupContext.Provider value={{ showWorking, closeWorking }}>
      {children}
      {def ? <WorkingPopupModal def={def} onClose={closeWorking} /> : null}
    </WorkingPopupContext.Provider>
  )
}

// ── Modal ───────────────────────────────────────────

function WorkingPopupModal({ def, onClose }: { def: WorkingDef; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === overlayRef.current) onClose()
  }

  return (
    <div
      ref={overlayRef}
      className="wk-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
    >
      <div className="wk-modal">
        <div className="wk-hdr">
          <div className="wk-icon">{def.icon || '📐'}</div>
          <div className="wk-hdr-text">
            <div className="wk-title">{def.title}</div>
            <div className="wk-subtitle">
              {def.subtitle || 'Formula · Calculation Steps · Data Sources'}
            </div>
          </div>
          <button className="wk-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="wk-body">
          <WorkingBody def={def} />
        </div>
      </div>
    </div>
  )
}

function WorkingBody({ def }: { def: WorkingDef }) {
  return (
    <>
      {def.result !== undefined && (
        <div
          style={{
            background: 'linear-gradient(135deg,var(--golddim),transparent)',
            border: '1px solid rgba(247,183,49,.3)',
            borderRadius: 8,
            padding: '14px 18px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--txt3)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '.8px',
                marginBottom: 4,
              }}
            >
              {def.resultLabel || 'Result'}
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                fontFamily: "'Source Serif 4','Source Serif Pro',Georgia,serif",
                color: 'var(--gold2)',
              }}
            >
              {def.result}
            </div>
            {def.resultNote && (
              <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 3 }}>
                {def.resultNote}
              </div>
            )}
          </div>
          {def.benchmark && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 4 }}>
                Benchmark
              </div>
              <div style={{ fontSize: 13, color: 'var(--txt2)' }}>{def.benchmark}</div>
            </div>
          )}
        </div>
      )}

      {def.formula && (
        <div className="wk-section">
          <div className="wk-section-title">
            <span>📐 Formula</span>
          </div>
          <div className="wk-formula">{def.formula}</div>
        </div>
      )}

      {def.steps && def.steps.length > 0 && (
        <div className="wk-section">
          <div className="wk-section-title">
            <span>🔢 Step-by-Step Calculation</span>
          </div>
          {def.steps.map((s, i) => (
            <div className="wk-step" key={i}>
              <div className="wk-step-num">{i + 1}</div>
              <div className="wk-step-content">
                <div className="wk-step-label">{s.label}</div>
                {s.calc && <div className="wk-step-calc">{s.calc}</div>}
                {s.result && <div className="wk-step-result">= {s.result}</div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {def.table && (
        <div className="wk-section">
          <div className="wk-section-title">
            <span>{def.table.title || '📊 Data Table'}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="wk-table">
              <thead>
                <tr>
                  {def.table.headers.map((h, i) => (
                    <th key={i}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {def.table.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, ci) => {
                      const s = c == null ? '' : c.toString()
                      const cls = [
                        ci >= 2 ? 'num' : '',
                        s.startsWith('+') ? 'hi' : '',
                        s.startsWith('-') ? 'lo' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')
                      return (
                        <td key={ci} className={cls || undefined}>
                          {c}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {def.assumptions && def.assumptions.length > 0 && (
        <div className="wk-section">
          <div className="wk-section-title">
            <span>⚙ Assumptions</span>
          </div>
          {def.assumptions.map((a, i) => (
            <div className="wk-assumption" key={i}>
              <strong>{a.k}:</strong> {a.v}
            </div>
          ))}
        </div>
      )}

      {def.sources && def.sources.length > 0 && (
        <div className="wk-section">
          <div className="wk-section-title">
            <span>📚 Data Sources</span>
          </div>
          <div>
            {def.sources.map((s, i) => (
              <span className="wk-source-pill" key={i}>
                <span
                  className="dot"
                  style={{ background: s.color || 'var(--txt3)' }}
                />
                {s.name}
                {s.note && (
                  <>
                    {' — '}
                    <em>{s.note}</em>
                  </>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {def.notes && def.notes.length > 0 && (
        <div className="wk-section">
          <div className="wk-section-title">
            <span>💡 Notes & Caveats</span>
          </div>
          {def.notes.map((n, i) => (
            <div
              key={i}
              className={
                n.type === 'warn'
                  ? 'wk-warn'
                  : n.type === 'note'
                    ? 'wk-note'
                    : 'wk-assumption'
              }
            >
              <strong>{n.k}:</strong> {n.v}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
