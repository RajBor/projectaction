'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'

/**
 * Content protection layer — prevents casual copying/scraping.
 *
 * Restrictions (regular users):
 *   - Right-click disabled (no "View Source" / "Inspect Element")
 *   - Text selection disabled via CSS user-select: none
 *   - Copy/cut keyboard shortcuts blocked (Ctrl+C, Ctrl+X)
 *   - Dev tools shortcuts blocked (F12, Ctrl+Shift+I/J/C, Ctrl+U)
 *   - PrintScreen key blocked (browser-level, not OS-level)
 *   - Drag disabled on all elements
 *   - Invisible watermark with user email (deters screenshot sharing)
 *
 * Admin bypass:
 *   - Admin users (role === 'admin') bypass ALL restrictions
 *   - Admin can right-click, copy, use dev tools, take screenshots
 *
 * Limitations (honest):
 *   - OS-level screenshots (Snipping Tool, phone camera) CANNOT be
 *     blocked by any website — this is a browser security boundary
 *   - A determined technical user can always bypass client-side
 *     protections by disabling JS or using browser extensions
 *   - This layer deters casual copying, not professional attackers
 */

export function ContentProtection() {
  const { data: session } = useSession()
  const role = (session?.user as { role?: string } | undefined)?.role
  const isAdmin = role === 'admin'
  const userEmail = session?.user?.email || 'anonymous'

  useEffect(() => {
    if (isAdmin) return // Admin bypasses everything

    // ── Disable right-click ──
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault()
      return false
    }

    // ── Block keyboard shortcuts ──
    const onKeyDown = (e: KeyboardEvent) => {
      // F12 — dev tools
      if (e.key === 'F12') { e.preventDefault(); return }
      // Ctrl+Shift+I/J/C — dev tools panels
      if (e.ctrlKey && e.shiftKey && ['I', 'J', 'C'].includes(e.key.toUpperCase())) {
        e.preventDefault(); return
      }
      // Ctrl+U — view source
      if (e.ctrlKey && e.key.toUpperCase() === 'U') { e.preventDefault(); return }
      // Ctrl+S — save page
      if (e.ctrlKey && e.key.toUpperCase() === 'S') { e.preventDefault(); return }
      // Ctrl+C / Ctrl+X — copy / cut
      if (e.ctrlKey && (e.key.toUpperCase() === 'C' || e.key.toUpperCase() === 'X')) {
        e.preventDefault(); return
      }
      // Ctrl+A — select all
      if (e.ctrlKey && e.key.toUpperCase() === 'A') { e.preventDefault(); return }
      // PrintScreen
      if (e.key === 'PrintScreen') { e.preventDefault(); return }
    }

    // ── Block drag ──
    const onDragStart = (e: DragEvent) => { e.preventDefault() }

    // ── Block copy event ──
    const onCopy = (e: ClipboardEvent) => { e.preventDefault() }

    document.addEventListener('contextmenu', onContextMenu)
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('dragstart', onDragStart)
    document.addEventListener('copy', onCopy)

    // ── CSS: disable text selection + hide scrollbar for cleaner look ──
    const style = document.createElement('style')
    style.id = 'dn-content-protection'
    style.textContent = `
      body, body * {
        -webkit-user-select: none !important;
        -moz-user-select: none !important;
        -ms-user-select: none !important;
        user-select: none !important;
      }
      /* Allow selection in input/textarea fields so users can type */
      input, textarea, [contenteditable="true"] {
        -webkit-user-select: text !important;
        -moz-user-select: text !important;
        -ms-user-select: text !important;
        user-select: text !important;
      }
    `
    document.head.appendChild(style)

    return () => {
      document.removeEventListener('contextmenu', onContextMenu)
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('dragstart', onDragStart)
      document.removeEventListener('copy', onCopy)
      const el = document.getElementById('dn-content-protection')
      if (el) el.remove()
    }
  }, [isAdmin])

  // ── Invisible watermark — renders the user's email as a
  //    semi-transparent overlay so any screenshot carries the
  //    user's identity. Admin sees no watermark. ──
  if (isAdmin || !session?.user) return null

  // Minimal forensic watermark — only 6 instances spread very wide,
  // at 1% opacity. Invisible to the naked eye but recoverable by
  // adjusting levels/curves on a captured screenshot.
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        overflow: 'hidden',
        opacity: 0.01,
      }}
    >
      {[
        { top: '8%', left: '5%' },
        { top: '35%', left: '55%' },
        { top: '62%', left: '15%' },
        { top: '85%', left: '60%' },
        { top: '20%', left: '75%' },
        { top: '50%', left: '30%' },
      ].map((pos, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            top: pos.top,
            left: pos.left,
            fontFamily: 'Inter, sans-serif',
            fontSize: 11,
            fontWeight: 500,
            color: 'var(--txt)',
            whiteSpace: 'nowrap',
            transform: 'rotate(-20deg)',
          }}
        >
          {userEmail}
        </span>
      ))}
    </div>
  )
}
