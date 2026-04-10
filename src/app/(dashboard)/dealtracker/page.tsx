'use client'

import { useEffect, useMemo, useState } from 'react'
import { COMPANIES } from '@/lib/data/companies'
import { PRIVATE_COMPANIES } from '@/lib/data/private-companies'

// ──────────────────────────────────────────────
// Deal type + localStorage helper (mirrors HTML Deals)
// ──────────────────────────────────────────────
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

function loadDeals(): Deal[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Deal[]) : []
  } catch {
    return []
  }
}

function saveDeals(deals: Deal[]) {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(deals))
}

const STAGES: Deal['stage'][] = ['Screening', 'Diligence', 'Negotiation', 'LOI', 'Closed']

const stageColors: Record<Deal['stage'], string> = {
  Screening: 'var(--txt3)',
  Diligence: 'var(--cyan2)',
  Negotiation: 'var(--orange)',
  LOI: 'var(--gold2)',
  Closed: 'var(--green)',
}

// ──────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────
export default function DealTrackerPage() {
  const [deals, setDeals] = useState<Deal[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editDeal, setEditDeal] = useState<Deal | null>(null)
  const [initialStage, setInitialStage] = useState<Deal['stage']>('Screening')

  useEffect(() => {
    setDeals(loadDeals())
  }, [])

  function persist(next: Deal[]) {
    setDeals(next)
    saveDeals(next)
  }

  function addDeal(payload: Omit<Deal, 'id' | 'created'>) {
    const next: Deal[] = [
      ...deals,
      {
        ...payload,
        id: Date.now(),
        created: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
      },
    ]
    persist(next)
  }

  function updateDeal(id: number, patch: Partial<Deal>) {
    persist(deals.map((d) => (d.id === id ? { ...d, ...patch } : d)))
  }

  function removeDeal(id: number) {
    persist(deals.filter((d) => d.id !== id))
  }

  function openAdd(stage: Deal['stage'] = 'Screening') {
    setEditDeal(null)
    setInitialStage(stage)
    setModalOpen(true)
  }

  function openEdit(deal: Deal) {
    setEditDeal(deal)
    setModalOpen(true)
  }

  return (
    <div>
      {/* phdr */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          SolarGrid Pro <span style={{ opacity: 0.5 }}>›</span> Pipeline
        </div>
        <h1
          style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
          }}
        >
          Deal <em style={{ color: 'var(--gold2)', fontStyle: 'normal' }}>Tracker</em>
        </h1>
        <div style={{ marginTop: 6 }}>
          <span
            style={{
              display: 'inline-block',
              background: 'rgba(85,104,128,0.2)',
              color: 'var(--txt2)',
              border: '1px solid rgba(85,104,128,0.3)',
              borderRadius: 4,
              padding: '2px 8px',
              fontSize: 11,
            }}
          >
            Kanban pipeline · {deals.length} active deals · Persists across sessions
          </span>
        </div>
      </div>

      {/* Action bar */}
      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: 10,
            marginBottom: 16,
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => openAdd('Screening')}
              style={{
                background: 'var(--green)',
                color: '#000',
                border: 'none',
                padding: '8px 16px',
                borderRadius: 5,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              + New Deal
            </button>
            <button
              onClick={() => exportCSV(deals)}
              style={{
                background: 'var(--s3)',
                color: 'var(--txt)',
                border: '1px solid var(--br2)',
                padding: '8px 14px',
                borderRadius: 5,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              ⬇ Export Pipeline CSV
            </button>
          </div>
          <span style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Pipeline value: ₹
            {deals
              .reduce((s, d) => s + (parseInt(d.ev) || 0), 0)
              .toLocaleString('en-IN')}
            Cr
          </span>
        </div>

        {/* Kanban */}
        <div style={{ overflowX: 'auto' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(5, minmax(220px, 1fr))',
              gap: 12,
              minWidth: 1100,
            }}
          >
            {STAGES.map((stage) => {
              const stageDeals = deals.filter((d) => d.stage === stage)
              return (
                <div
                  key={stage}
                  style={{
                    background: 'var(--s3)',
                    border: '1px solid var(--br)',
                    borderRadius: 7,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 400,
                  }}
                >
                  <div
                    style={{
                      padding: '10px 12px',
                      borderBottom: `2px solid ${stageColors[stage]}`,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        fontSize: 12,
                        fontWeight: 700,
                        color: 'var(--txt)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.6px',
                      }}
                    >
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: stageColors[stage],
                        }}
                      />
                      {stage}
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        color: 'var(--txt3)',
                        background: 'var(--s2)',
                        padding: '1px 7px',
                        borderRadius: 3,
                      }}
                    >
                      {stageDeals.length}
                    </span>
                  </div>
                  <div style={{ padding: 10, flex: 1 }}>
                    {stageDeals.map((d) => (
                      <div
                        key={d.id}
                        onClick={() => openEdit(d)}
                        style={{
                          background: 'var(--s2)',
                          border: '1px solid var(--br)',
                          borderRadius: 6,
                          padding: 10,
                          marginBottom: 8,
                          cursor: 'pointer',
                          position: 'relative',
                        }}
                      >
                        <div
                          onClick={(e) => {
                            e.stopPropagation()
                            removeDeal(d.id)
                          }}
                          style={{
                            position: 'absolute',
                            top: 6,
                            right: 8,
                            fontSize: 12,
                            color: 'var(--txt3)',
                            cursor: 'pointer',
                          }}
                          title="Remove"
                        >
                          ✕
                        </div>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            color: 'var(--txt)',
                            marginBottom: 4,
                            paddingRight: 16,
                          }}
                        >
                          {d.name}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: 'var(--gold2)',
                            fontFamily: 'JetBrains Mono, monospace',
                            fontWeight: 500,
                          }}
                        >
                          {d.ev ? `₹${parseInt(d.ev).toLocaleString('en-IN')}Cr` : ''}
                        </div>
                        <div
                          style={{
                            fontSize: 10,
                            color: 'var(--txt3)',
                            marginTop: 3,
                          }}
                        >
                          {d.type || ''} · {d.created}
                        </div>
                        {d.notes && (
                          <div
                            style={{
                              fontSize: 11,
                              color: 'var(--txt3)',
                              marginTop: 4,
                              lineHeight: 1.4,
                            }}
                          >
                            {d.notes.substring(0, 60)}
                            {d.notes.length > 60 ? '…' : ''}
                          </div>
                        )}
                      </div>
                    ))}
                    <div
                      onClick={() => openAdd(stage)}
                      style={{
                        fontSize: 12,
                        color: 'var(--txt3)',
                        padding: '6px 0',
                        cursor: 'pointer',
                        textAlign: 'center',
                        opacity: 0.7,
                      }}
                    >
                      + Add deal
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {modalOpen && (
        <DealModal
          existing={editDeal}
          initialStage={initialStage}
          onClose={() => setModalOpen(false)}
          onSave={(payload) => {
            if (editDeal) {
              updateDeal(editDeal.id, payload)
            } else {
              addDeal(payload)
            }
            setModalOpen(false)
          }}
          onRemove={() => {
            if (editDeal) removeDeal(editDeal.id)
            setModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ──────────────────────────────────────────────
// Modal
// ──────────────────────────────────────────────
function DealModal({
  existing,
  initialStage,
  onClose,
  onSave,
  onRemove,
}: {
  existing: Deal | null
  initialStage: Deal['stage']
  onClose: () => void
  onSave: (payload: Omit<Deal, 'id' | 'created'>) => void
  onRemove: () => void
}) {
  const [name, setName] = useState(existing?.name || '')
  const [ev, setEv] = useState(existing?.ev || '')
  const [type, setType] = useState(existing?.type || 'Acquisition')
  const [stage, setStage] = useState<Deal['stage']>(existing?.stage || initialStage)
  const [sector, setSector] = useState(existing?.sector || '')
  const [notes, setNotes] = useState(existing?.notes || '')
  const [selectedKey, setSelectedKey] = useState('')

  const listedOpts = useMemo(
    () =>
      [...(COMPANIES as any[])].sort(
        (a, b) => (b.acqs || 0) - (a.acqs || 0)
      ),
    []
  )
  const privateOpts = useMemo(
    () =>
      [...(PRIVATE_COMPANIES as any[])].sort(
        (a, b) => (b.acqs || 0) - (a.acqs || 0)
      ),
    []
  )

  function onCompanySelect(val: string) {
    setSelectedKey(val)
    if (!val || val === '__custom__') {
      if (val === '__custom__') setName('')
      return
    }
    const listed = listedOpts.find((c: any) => c.name === val)
    const priv = privateOpts.find((c: any) => c.name === val)
    const src: any = listed || priv
    if (!src) return
    setName(src.name)
    setEv(String(listed ? src.ev || '' : src.ev_est || ''))
    setSector(
      (src.sec === 'solar' ? 'Solar' : 'T&D') +
        (src.comp && src.comp.length ? ' · ' + (src.comp[0] || '') : '')
    )
  }

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br2)',
          borderRadius: 10,
          maxWidth: 560,
          width: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--br)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--txt)' }}>
            {existing ? `Edit: ${existing.name}` : '+ Add Deal to Pipeline'}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--txt3)',
              fontSize: 22,
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: 18 }}>
          {!existing && (
            <div style={{ marginBottom: 14 }}>
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--txt3)',
                  marginBottom: 5,
                  display: 'flex',
                  justifyContent: 'space-between',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                }}
              >
                <span>Target Company</span>
                <span style={{ textTransform: 'none', fontWeight: 400 }}>
                  Select from database or type custom name below
                </span>
              </div>
              <select
                value={selectedKey}
                onChange={(e) => onCompanySelect(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--s3)',
                  border: '1px solid var(--br)',
                  color: 'var(--txt)',
                  padding: '8px 10px',
                  borderRadius: 5,
                  fontSize: 13,
                  marginBottom: 8,
                }}
              >
                <option value="">— Select from full company database —</option>
                <optgroup label={`⭐ Listed Companies (${listedOpts.length})`}>
                  {listedOpts.map((c: any) => (
                    <option key={`l-${c.ticker}`} value={c.name}>
                      {c.name} ({c.ticker}) — EV ₹
                      {c.ev > 0 ? c.ev.toLocaleString('en-IN') : 'N/A'}Cr · Score{' '}
                      {c.acqs}/10
                    </option>
                  ))}
                </optgroup>
                <optgroup label={`🔒 Private / Unlisted (${privateOpts.length})`}>
                  {privateOpts.map((c: any) => (
                    <option key={`p-${c.name}`} value={c.name}>
                      🔒 {c.name} [{c.stage}] — Est. EV ₹
                      {c.ev_est > 0 ? c.ev_est.toLocaleString('en-IN') : 'N/A'}Cr ·
                      Score {c.acqs}/10
                    </option>
                  ))}
                </optgroup>
                <optgroup label="✏ Other">
                  <option value="__custom__">+ Enter custom company name below</option>
                </optgroup>
              </select>
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setSelectedKey('')
                }}
                placeholder="Company name (auto-filled from dropdown or type manually)"
                style={inputStyle}
              />
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Enterprise Value (₹Cr)">
              <input
                value={ev}
                onChange={(e) => setEv(e.target.value)}
                type="number"
                placeholder="e.g. 1000"
                style={inputStyle}
              />
            </Field>
            <Field label="Deal Type">
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                style={inputStyle}
              >
                {[
                  'Acquisition',
                  'Strategic Stake',
                  'Minority Stake',
                  'JV',
                  'Asset Purchase',
                  'Merger',
                  'Technology License',
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
            <Field label="Pipeline Stage">
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value as Deal['stage'])}
                style={inputStyle}
              >
                {STAGES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Sector">
              <input
                value={sector}
                onChange={(e) => setSector(e.target.value)}
                placeholder="e.g. Smart Meters, Solar Modules"
                style={inputStyle}
              />
            </Field>
          </div>

          <Field label="Notes / Rationale">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Strategic rationale, diligence status, key risks, next steps..."
              style={{ ...inputStyle, minHeight: 90, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() =>
                onSave({
                  name: name || 'Unnamed',
                  ev,
                  type,
                  stage,
                  sector,
                  notes,
                })
              }
              style={{
                flex: 1,
                background: 'var(--gold2)',
                color: '#000',
                border: 'none',
                padding: 10,
                borderRadius: 5,
                fontSize: 14,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {existing ? 'Update Deal' : '➕ Add to Pipeline'}
            </button>
            {existing && (
              <button
                onClick={onRemove}
                style={{
                  background: 'var(--red)',
                  color: '#fff',
                  border: 'none',
                  padding: '10px 16px',
                  borderRadius: 5,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Remove
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--s3)',
  border: '1px solid var(--br)',
  color: 'var(--txt)',
  padding: '8px 10px',
  borderRadius: 5,
  fontSize: 13,
  outline: 'none',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div
        style={{
          fontSize: 11,
          color: 'var(--txt3)',
          marginBottom: 5,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function exportCSV(deals: Deal[]) {
  if (typeof window === 'undefined') return
  const header = ['Name', 'EV (₹Cr)', 'Type', 'Stage', 'Sector', 'Notes', 'Created']
  const rows = deals.map((d) => [d.name, d.ev, d.type, d.stage, d.sector, d.notes, d.created])
  const csv = [header, ...rows]
    .map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'deal_pipeline.csv'
  a.click()
  URL.revokeObjectURL(url)
}
