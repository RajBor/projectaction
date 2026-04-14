'use client'

import { useState } from 'react'
import {
  addUserPrivateCompany,
  USER_PRIVATE_UPLOAD_LIMITS,
  type UserPrivateCompany,
} from '@/lib/private/user-private-companies'
import { CHAIN } from '@/lib/data/chain'

export interface AddPrivateCompanyModalProps {
  open: boolean
  onClose: () => void
  onAdded?: (record: UserPrivateCompany) => void
}

const ACCEPT_FILES =
  '.pdf,.xlsx,.xls,.csv,.doc,.docx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export function AddPrivateCompanyModal({
  open,
  onClose,
  onAdded,
}: AddPrivateCompanyModalProps) {
  const [name, setName] = useState('')
  const [sec, setSec] = useState<'solar' | 'td'>('solar')
  const [stage, setStage] = useState('Private')
  const [founded, setFounded] = useState<number>(new Date().getFullYear() - 5)
  const [hq, setHq] = useState('')
  const [comp, setComp] = useState<string[]>([])
  const [cap, setCap] = useState('')
  const [revEst, setRevEst] = useState<number>(0)
  const [evEst, setEvEst] = useState<number>(0)
  const [ebmEst, setEbmEst] = useState<number>(0)
  const [revgEst, setRevgEst] = useState<number>(0)
  const [tech, setTech] = useState('')
  const [pli, setPli] = useState('')
  const [almm, setAlmm] = useState('')
  const [ipo, setIpo] = useState('')
  const [acqs, setAcqs] = useState<number>(5)
  const [acqf, setAcqf] = useState('CONSIDER')
  const [rea, setRea] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) return null

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files || [])
    setFiles((prev) => [...prev, ...picked])
    // Allow re-selecting the same file
    e.target.value = ''
  }

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx))
  }

  const toggleComp = (id: string) => {
    setComp((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const handleSubmit = async () => {
    setError(null)
    if (!name.trim()) {
      setError('Company name is required.')
      return
    }
    setSubmitting(true)
    const result = await addUserPrivateCompany({
      name,
      stage,
      founded,
      hq,
      sec,
      comp,
      cap,
      rev_est: revEst,
      ev_est: evEst,
      ebm_est: ebmEst,
      revg_est: revgEst,
      tech,
      pli,
      almm,
      ipo,
      acqs,
      acqf,
      rea,
      files,
    })
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error || 'Failed to save.')
      return
    }
    if (result.record) onAdded?.(result.record)
    // Reset and close
    setName('')
    setHq('')
    setCap('')
    setRea('')
    setFiles([])
    onClose()
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--s1)',
    border: '1px solid var(--br)',
    color: 'var(--txt)',
    padding: '6px 10px',
    borderRadius: 4,
    fontSize: 12,
    fontFamily: 'Inter, sans-serif',
    width: '100%',
  }
  const labelStyle: React.CSSProperties = {
    fontSize: 10,
    color: 'var(--txt3)',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
    fontWeight: 600,
    marginBottom: 4,
    display: 'block',
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.55)',
        backdropFilter: 'blur(3px)',
        zIndex: 9000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(680px, 94vw)',
          maxHeight: '92vh',
          background: 'var(--s2)',
          border: '1px solid var(--br2)',
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid var(--br)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--s1)',
          }}
        >
          <div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--txt3)',
                letterSpacing: '1.2px',
                textTransform: 'uppercase',
                marginBottom: 2,
              }}
            >
              Private Targets
            </div>
            <div
              style={{
                fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                fontSize: 17,
                fontWeight: 700,
                color: 'var(--txt)',
                letterSpacing: '-0.01em',
              }}
            >
              Add Private Company
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'var(--s3)',
              border: '1px solid var(--br)',
              color: 'var(--txt2)',
              fontSize: 14,
              padding: '4px 10px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 18, overflowY: 'auto', flex: 1 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={labelStyle}>Company Name *</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme Solar Pvt Ltd"
                style={inputStyle}
              />
            </div>
            <div>
              <span style={labelStyle}>Sector</span>
              <select
                value={sec}
                onChange={(e) => setSec(e.target.value as 'solar' | 'td')}
                style={inputStyle}
              >
                <option value="solar">Solar</option>
                <option value="td">T&amp;D</option>
              </select>
            </div>
            <div>
              <span style={labelStyle}>Stage</span>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                style={inputStyle}
              >
                <option value="Private">Private</option>
                <option value="Pre-IPO">Pre-IPO</option>
                <option value="Startup">Startup</option>
                <option value="PE-Backed">PE-Backed</option>
                <option value="Family-Owned">Family-Owned</option>
              </select>
            </div>
            <div>
              <span style={labelStyle}>Founded</span>
              <input
                type="number"
                value={founded}
                onChange={(e) => setFounded(parseInt(e.target.value) || 0)}
                style={inputStyle}
              />
            </div>
            <div>
              <span style={labelStyle}>HQ</span>
              <input
                value={hq}
                onChange={(e) => setHq(e.target.value)}
                placeholder="e.g. Mumbai"
                style={inputStyle}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={labelStyle}>Capacity / Capability</span>
              <input
                value={cap}
                onChange={(e) => setCap(e.target.value)}
                placeholder="e.g. 2 GW modules · 500 MW cells"
                style={inputStyle}
              />
            </div>
            <div>
              <span style={labelStyle}>Revenue Est (₹Cr)</span>
              <input
                type="number"
                value={revEst}
                onChange={(e) => setRevEst(parseFloat(e.target.value) || 0)}
                style={inputStyle}
              />
            </div>
            <div>
              <span style={labelStyle}>EV Est (₹Cr)</span>
              <input
                type="number"
                value={evEst}
                onChange={(e) => setEvEst(parseFloat(e.target.value) || 0)}
                style={inputStyle}
              />
            </div>
            <div>
              <span style={labelStyle}>EBITDA Margin %</span>
              <input
                type="number"
                value={ebmEst}
                onChange={(e) => setEbmEst(parseFloat(e.target.value) || 0)}
                style={inputStyle}
              />
            </div>
            <div>
              <span style={labelStyle}>Revenue Growth %</span>
              <input
                type="number"
                value={revgEst}
                onChange={(e) => setRevgEst(parseFloat(e.target.value) || 0)}
                style={inputStyle}
              />
            </div>
            <div>
              <span style={labelStyle}>Acq Score (1-10)</span>
              <input
                type="number"
                min={1}
                max={10}
                value={acqs}
                onChange={(e) => setAcqs(parseInt(e.target.value) || 5)}
                style={inputStyle}
              />
            </div>
            <div>
              <span style={labelStyle}>Flag</span>
              <select
                value={acqf}
                onChange={(e) => setAcqf(e.target.value)}
                style={inputStyle}
              >
                <option value="STRONG BUY">STRONG BUY</option>
                <option value="CONSIDER">CONSIDER</option>
                <option value="MONITOR">MONITOR</option>
                <option value="PASS">PASS</option>
              </select>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={labelStyle}>Technology Notes</span>
              <input
                value={tech}
                onChange={(e) => setTech(e.target.value)}
                placeholder="e.g. TOPCon N-type bifacial"
                style={inputStyle}
              />
            </div>
            <div>
              <span style={labelStyle}>PLI Status</span>
              <input
                value={pli}
                onChange={(e) => setPli(e.target.value)}
                placeholder="e.g. PLI applicant"
                style={inputStyle}
              />
            </div>
            <div>
              <span style={labelStyle}>ALMM Status</span>
              <input
                value={almm}
                onChange={(e) => setAlmm(e.target.value)}
                placeholder="e.g. ALMM listed"
                style={inputStyle}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={labelStyle}>IPO Plans / Ownership</span>
              <input
                value={ipo}
                onChange={(e) => setIpo(e.target.value)}
                placeholder="e.g. IPO planned FY26"
                style={inputStyle}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={labelStyle}>Rationale</span>
              <textarea
                value={rea}
                onChange={(e) => setRea(e.target.value)}
                rows={3}
                placeholder="Why this target matters"
                style={{ ...inputStyle, resize: 'vertical', fontFamily: 'Inter, sans-serif' }}
              />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={labelStyle}>
                Value-Chain Components{' '}
                <span style={{ color: 'var(--txt3)', fontWeight: 400 }}>
                  (tick all that apply)
                </span>
              </span>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                  background: 'var(--s1)',
                  border: '1px solid var(--br)',
                  borderRadius: 4,
                  padding: 8,
                  maxHeight: 140,
                  overflowY: 'auto',
                }}
              >
                {CHAIN.filter((n) => n.sec === sec).map((n) => {
                  const on = comp.includes(n.id)
                  return (
                    <label
                      key={n.id}
                      style={{
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 3,
                        border: `1px solid ${on ? 'var(--gold2)' : 'var(--br)'}`,
                        background: on ? 'var(--golddim)' : 'var(--s2)',
                        color: on ? 'var(--gold2)' : 'var(--txt2)',
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => toggleComp(n.id)}
                        style={{ display: 'none' }}
                      />
                      {n.name}
                    </label>
                  )
                })}
              </div>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <span style={labelStyle}>
                Source Documents{' '}
                <span style={{ color: 'var(--txt3)', fontWeight: 400 }}>
                  (PDF, Excel, Word, CSV — max {USER_PRIVATE_UPLOAD_LIMITS.maxFileBytes / 1024 / 1024} MB each)
                </span>
              </span>
              <label
                style={{
                  display: 'block',
                  padding: '16px 18px',
                  border: '2px dashed var(--br2)',
                  borderRadius: 6,
                  textAlign: 'center',
                  cursor: 'pointer',
                  background: 'var(--s1)',
                  color: 'var(--txt2)',
                  fontSize: 12,
                }}
              >
                <input
                  type="file"
                  accept={ACCEPT_FILES}
                  onChange={handleFileChange}
                  multiple
                  style={{ display: 'none' }}
                />
                <div style={{ fontSize: 20, marginBottom: 4 }}>📎</div>
                Click to upload pitch decks, annual reports, financial statements, or other source docs
                <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4 }}>
                  Accepted: .pdf · .xlsx · .xls · .csv · .doc · .docx
                </div>
              </label>
              {files.length > 0 && (
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                  }}
                >
                  {files.map((f, idx) => (
                    <div
                      key={idx}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        fontSize: 11,
                        padding: '5px 10px',
                        background: 'var(--s1)',
                        border: '1px solid var(--br)',
                        borderRadius: 4,
                      }}
                    >
                      <span style={{ color: 'var(--txt2)', fontFamily: 'JetBrains Mono, monospace' }}>
                        {f.name}{' '}
                        <span style={{ color: 'var(--txt3)' }}>
                          ({(f.size / 1024).toFixed(0)} KB)
                        </span>
                      </span>
                      <button
                        onClick={() => removeFile(idx)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'var(--red)',
                          fontSize: 13,
                          cursor: 'pointer',
                          padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: '8px 12px',
                background: 'var(--reddim)',
                border: '1px solid var(--red)',
                color: 'var(--red)',
                fontSize: 11,
                borderRadius: 4,
              }}
            >
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '12px 18px',
            borderTop: '1px solid var(--br)',
            background: 'var(--s1)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
          }}
        >
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              background: 'var(--s3)',
              border: '1px solid var(--br)',
              color: 'var(--txt2)',
              fontSize: 12,
              padding: '6px 14px',
              borderRadius: 4,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
            style={{
              background: submitting ? 'var(--s3)' : 'var(--green)',
              border: '1px solid var(--green)',
              color: '#fff',
              fontSize: 12,
              padding: '6px 18px',
              borderRadius: 4,
              cursor: submitting || !name.trim() ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              opacity: submitting || !name.trim() ? 0.6 : 1,
            }}
          >
            {submitting ? 'Saving…' : 'Save Company'}
          </button>
        </div>
      </div>
    </div>
  )
}
