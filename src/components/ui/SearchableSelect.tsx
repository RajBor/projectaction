'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * SearchableSelect — a dropdown with a type-to-filter search box.
 *
 * Why this exists: native <select> stops being usable past ~30 items.
 * The Compare page ships every listed company (~280+ including atlas
 * rows) and the DCF loader ships listed + private (~320+). A plain
 * scroll list means the user has to eyeball alphabet order; that's
 * a real friction point in demos. This component:
 *
 *   - Opens on focus / click with a filter input already focused
 *   - Filters case-insensitively across label AND a user-supplied
 *     `searchText` (so we can also match on ticker, sector, etc.)
 *   - Supports optgroup-style section headers
 *   - Closes on Escape / outside click / Enter-select
 *   - Keyboard navigation: ArrowUp/Down + Enter
 *   - Controlled: pass `value` (string) + `onChange(value)`
 *
 * It's intentionally NOT a headless combobox library import — the
 * rest of the app uses only inline CSS variables and React state,
 * adding a dep for this one control isn't worth the bundle bloat.
 *
 * Styling uses the project's CSS variables (var(--s2), var(--br),
 * etc.) so it inherits dark/light theming automatically.
 */

export interface SearchableSelectOption {
  /** The stable value passed to onChange — ticker, company name, id, etc. */
  value: string
  /** The main label rendered in the dropdown (usually "Company Name (TICKER)"). */
  label: string
  /**
   * Optional extra text that the search filter also considers —
   * useful when you want to match on sector / aliases / numeric
   * attributes that aren't part of the visible label.
   */
  searchText?: string
  /** Optional muted sub-line under the label (e.g. "₹14,200Cr rev"). */
  sub?: string
  /**
   * Optional group label. All consecutive options with the same
   * `group` are rendered under one header — same effect as
   * <optgroup> in a native select.
   */
  group?: string
  /** If true, option appears in the list but cannot be picked. */
  disabled?: boolean
}

export interface SearchableSelectProps {
  value: string
  onChange: (value: string) => void
  options: SearchableSelectOption[]
  /** Shown when nothing is selected. */
  placeholder?: string
  /** Shown inside the search box. */
  searchPlaceholder?: string
  /** Inline style overrides for the visible trigger button. */
  style?: React.CSSProperties
  /** Width of the dropdown panel (CSS size). Falls back to trigger width. */
  menuWidth?: number | string
  disabled?: boolean
  /** Optional suffix content rendered inside the trigger, e.g. a count. */
  hint?: string
  /** Max dropdown height before scrolling kicks in. */
  maxMenuHeight?: number
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = '— Select —',
  searchPlaceholder = 'Search…',
  style,
  menuWidth,
  disabled,
  hint,
  maxMenuHeight = 320,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset query when closed so reopening starts fresh.
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

  // Focus the search input when the menu opens.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Outside-click closes the menu.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Filtering: case-insensitive match against label + searchText + value.
  // Multi-word queries are AND'd (every word must match somewhere) — same
  // pattern as the admin discover search so the feel is consistent.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    const words = q.split(/\s+/).filter(Boolean)
    return options.filter((opt) => {
      const hay = `${opt.label} ${opt.searchText || ''} ${opt.value}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
  }, [options, query])

  // Reset keyboard cursor when filter changes.
  useEffect(() => {
    setActiveIdx(0)
  }, [query])

  // Selected option label for the trigger button.
  const selected = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  )

  const pick = (opt: SearchableSelectOption) => {
    if (opt.disabled) return
    onChange(opt.value)
    setOpen(false)
  }

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const opt = filtered[activeIdx]
      if (opt) pick(opt)
    }
  }

  // Auto-scroll the active row into view while keyboard navigating.
  useEffect(() => {
    if (!open || !listRef.current) return
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`)
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  // Group consecutive options that share a `group` value. Options with
  // no group render directly under the previous header (or the top).
  const grouped = useMemo(() => {
    const sections: Array<{ group: string | null; items: SearchableSelectOption[] }> = []
    for (const opt of filtered) {
      const g = opt.group || null
      const last = sections[sections.length - 1]
      if (last && last.group === g) last.items.push(opt)
      else sections.push({ group: g, items: [opt] })
    }
    return sections
  }, [filtered])

  // Running offset so keyboard cursor indexes line up with the flat
  // `filtered` array even when we render multiple sections.
  let flatIdx = 0

  return (
    <div ref={wrapperRef} style={{ position: 'relative', display: 'inline-block', ...style }}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'var(--s3)',
          color: 'var(--txt)',
          border: '1px solid var(--br)',
          padding: '7px 28px 7px 10px',
          borderRadius: 5,
          fontSize: 13,
          cursor: disabled ? 'not-allowed' : 'pointer',
          fontFamily: 'inherit',
          position: 'relative',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ color: selected ? 'var(--txt)' : 'var(--txt3)' }}>
          {selected ? selected.label : placeholder}
        </span>
        {hint && (
          <span style={{ color: 'var(--txt3)', fontSize: 11, marginLeft: 6 }}>{hint}</span>
        )}
        <span
          aria-hidden
          style={{
            position: 'absolute',
            right: 10,
            top: '50%',
            transform: `translateY(-50%) rotate(${open ? 180 : 0}deg)`,
            transition: 'transform 120ms ease',
            fontSize: 10,
            color: 'var(--txt3)',
          }}
        >
          ▼
        </span>
      </button>

      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            width: menuWidth ?? '100%',
            minWidth: 260,
            background: 'var(--s2)',
            border: '1px solid var(--br2)',
            borderRadius: 5,
            boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
            zIndex: 1000,
            overflow: 'hidden',
          }}
          onKeyDown={handleKey}
        >
          <div
            style={{
              padding: 8,
              borderBottom: '1px solid var(--br)',
              background: 'var(--s3)',
            }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              onKeyDown={handleKey}
              style={{
                width: '100%',
                background: 'var(--bg)',
                color: 'var(--txt)',
                border: '1px solid var(--br)',
                padding: '6px 10px',
                borderRadius: 4,
                fontSize: 12,
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>
          <div
            ref={listRef}
            style={{
              maxHeight: maxMenuHeight,
              overflowY: 'auto',
              padding: '4px 0',
            }}
          >
            {filtered.length === 0 && (
              <div style={{ padding: '12px 14px', color: 'var(--txt3)', fontSize: 12 }}>
                No matches for &ldquo;{query}&rdquo;
              </div>
            )}
            {grouped.map((sec, sIdx) => (
              <div key={`${sec.group ?? 'none'}-${sIdx}`}>
                {sec.group && (
                  <div
                    style={{
                      padding: '6px 12px 4px',
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: '0.8px',
                      textTransform: 'uppercase',
                      color: 'var(--txt3)',
                      background: 'var(--s3)',
                    }}
                  >
                    {sec.group}
                  </div>
                )}
                {sec.items.map((opt) => {
                  const thisIdx = flatIdx++
                  const isActive = thisIdx === activeIdx
                  const isSelected = opt.value === value
                  return (
                    <div
                      key={`${opt.value}-${thisIdx}`}
                      data-idx={thisIdx}
                      onClick={() => pick(opt)}
                      onMouseEnter={() => setActiveIdx(thisIdx)}
                      style={{
                        padding: '7px 12px',
                        fontSize: 12,
                        cursor: opt.disabled ? 'not-allowed' : 'pointer',
                        background: isActive
                          ? 'var(--s3)'
                          : isSelected
                          ? 'rgba(247,183,49,0.08)'
                          : 'transparent',
                        color: opt.disabled ? 'var(--txt3)' : 'var(--txt)',
                        borderLeft: isSelected ? '2px solid var(--gold2)' : '2px solid transparent',
                        opacity: opt.disabled ? 0.5 : 1,
                      }}
                    >
                      <div style={{ fontWeight: isSelected ? 600 : 400 }}>{opt.label}</div>
                      {opt.sub && (
                        <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 1 }}>
                          {opt.sub}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
