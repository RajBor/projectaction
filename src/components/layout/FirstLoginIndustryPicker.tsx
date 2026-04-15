'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IndustryRow } from '@/app/api/industries/route'

/**
 * First-login industry picker — shown to analyst users who haven't yet saved
 * a selection (users.industries_chosen_at is NULL in the DB).
 *
 * Admins/subadmins are never shown this modal: they see everything by default
 * and pick via the sidebar's customise control.
 *
 * Max 5 industries for analysts. Writes to both the DB (so the choice
 * persists across devices) and localStorage (so other tabs update instantly).
 */

const STORAGE_KEY = 'sg4_industries'
const AVAILABLE_KEY = 'sg4_industries_available'
const EVENT_NAME = 'sg4:industry-change'
const MAX_PICK = 5

export function FirstLoginIndustryPicker({ role }: { role?: string }) {
  const router = useRouter()
  const [show, setShow] = useState(false)
  const [industries, setIndustries] = useState<IndustryRow[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Only analyst users ever see this modal. Admin/subadmin skip entirely.
  const isAnalyst = role !== 'admin' && role !== 'subadmin'

  useEffect(() => {
    if (!isAnalyst) return
    let cancelled = false
    ;(async () => {
      try {
        const [userRes, indRes] = await Promise.all([
          fetch('/api/user/industries', { credentials: 'same-origin' }),
          fetch('/api/industries', { credentials: 'same-origin' }),
        ])
        const userJson = await userRes.json()
        const indJson = await indRes.json()
        if (cancelled) return
        if (indJson?.ok && Array.isArray(indJson.industries)) {
          setIndustries(indJson.industries)
          try { localStorage.setItem(AVAILABLE_KEY, JSON.stringify(indJson.industries)) } catch { /* ignore */ }
        }
        // Open modal only if user hasn't chosen yet
        if (userJson?.ok && userJson.chosen === false) {
          setShow(true)
        } else if (userJson?.ok && Array.isArray(userJson.industries)) {
          // User has chosen — sync their saved list into localStorage so the
          // global filter picks it up even after a fresh login.
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(userJson.industries))
            window.dispatchEvent(
              new CustomEvent(EVENT_NAME, { detail: { industries: userJson.industries } })
            )
          } catch { /* ignore */ }
        }
      } catch { /* offline — stay silent */ }
    })()
    return () => { cancelled = true }
  }, [isAnalyst])

  if (!isAnalyst || !show) return null

  const toggle = (id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id)
      if (prev.length >= MAX_PICK) return prev
      return [...prev, id]
    })
  }

  const submit = async () => {
    if (selected.length === 0) {
      setError('Pick at least one industry.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/user/industries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ industries: selected }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to save')
      // Persist to localStorage + broadcast so every mounted page refilters.
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(json.industries))
        window.dispatchEvent(
          new CustomEvent(EVENT_NAME, { detail: { industries: json.industries } })
        )
      } catch { /* ignore */ }
      setShow(false)
      // Route the newly-onboarded user to the Deal Board so they land
      // directly inside the product value loop (dealtracker) with
      // their chosen industries already wired up via the filter hook.
      router.push('/dealtracker')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(4px)',
      zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 8,
        maxWidth: 640, width: '100%', maxHeight: '90vh', overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          padding: '20px 24px', borderBottom: '1px solid var(--br)',
          background: 'linear-gradient(135deg, rgba(247,183,49,0.08), rgba(0,180,216,0.06))',
        }}>
          <div style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '1.2px',
            textTransform: 'uppercase', color: 'var(--gold2)', marginBottom: 6,
          }}>Welcome to DealNector</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--txt)', marginBottom: 6 }}>
            Pick up to 5 industries to follow
          </div>
          <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.5 }}>
            Your dashboard, M&amp;A Radar, Value Chain and Watchlist will be filtered to the
            industries you select. You can change this anytime from Settings.
          </div>
        </div>

        {/* Body — industry grid */}
        <div style={{ padding: 20, overflowY: 'auto', flex: 1 }}>
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 10,
          }}>
            {industries.map((ind) => {
              const isSel = selected.includes(ind.id)
              const atCap = !isSel && selected.length >= MAX_PICK
              return (
                <button
                  key={ind.id}
                  onClick={() => toggle(ind.id)}
                  disabled={atCap}
                  style={{
                    background: isSel ? 'rgba(247,183,49,0.12)' : 'var(--s2)',
                    border: `2px solid ${isSel ? 'var(--gold2)' : 'var(--br)'}`,
                    color: atCap ? 'var(--txt3)' : 'var(--txt)',
                    padding: '14px 12px', borderRadius: 6, textAlign: 'left',
                    cursor: atCap ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                    opacity: atCap ? 0.5 : 1, transition: 'all 0.15s',
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                  }}
                >
                  <span style={{ fontSize: 22, lineHeight: 1 }}>{ind.icon || '📁'}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
                      {ind.label}
                    </span>
                    {ind.description && (
                      <span style={{
                        display: 'block', fontSize: 10, color: 'var(--txt3)',
                        lineHeight: 1.4, whiteSpace: 'nowrap', overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}>{ind.description}</span>
                    )}
                  </span>
                  {isSel && (
                    <span style={{
                      fontSize: 14, color: 'var(--gold2)', fontWeight: 700, lineHeight: 1,
                    }}>✓</span>
                  )}
                </button>
              )
            })}
            {industries.length === 0 && (
              <div style={{ color: 'var(--txt3)', fontSize: 12, padding: 20 }}>
                No industries registered yet. Please contact an admin.
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 24px', borderTop: '1px solid var(--br)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
        }}>
          <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
            {selected.length} of {MAX_PICK} selected
            {error && <span style={{ color: 'var(--red)', marginLeft: 10 }}>{error}</span>}
          </div>
          <button
            onClick={submit}
            disabled={saving || selected.length === 0}
            style={{
              background: saving || selected.length === 0 ? 'var(--s3)' : 'var(--gold2)',
              color: saving || selected.length === 0 ? 'var(--txt3)' : '#000',
              border: `1px solid ${saving || selected.length === 0 ? 'var(--br)' : 'var(--gold2)'}`,
              padding: '10px 20px', fontSize: 12, fontWeight: 700, letterSpacing: '0.4px',
              textTransform: 'uppercase', borderRadius: 4, fontFamily: 'inherit',
              cursor: saving || selected.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >{saving ? 'Saving…' : 'Continue →'}</button>
        </div>
      </div>
    </div>
  )
}
