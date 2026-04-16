'use client'

/**
 * Big full-screen modal that shows the freshly-generated sample
 * report inside a scrollable iframe. The user can:
 *
 *   • Expand/collapse between "card size" and "near full-screen"
 *   • Click Download to save the HTML file (server sets the
 *     Content-Disposition header).
 *   • Click "Print to PDF" to invoke the browser print dialog on the
 *     rendered iframe — the report CSS has @media print rules so the
 *     output is clean.
 *   • Click "Request customised access" to open the access-request
 *     modal (handled by the parent via onRequestAccess).
 *
 * The modal is purely presentational — generation, CAPTCHA and
 * persistence are handled by HeroReportPicker.
 */

import { useEffect, useRef, useState } from 'react'

export interface PreviewResult {
  reportId: string
  title: string
  subjectLabel: string
  industryLabel: string
  previewHtml: string
  downloadUrl: string
  viewUrl: string
  disclaimer: string
}

interface Props {
  open: boolean
  result: PreviewResult | null
  onClose: () => void
  onRequestAccess: () => void
  accentColor?: string
}

export function ReportPreviewModal({ open, result, onClose, onRequestAccess, accentColor = '#C25E10' }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [maximised, setMaximised] = useState(false)

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  // Lock body scroll while modal is open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open || !result) return null

  const print = () => {
    try {
      iframeRef.current?.contentWindow?.focus()
      iframeRef.current?.contentWindow?.print()
    } catch {
      // ignore
    }
  }

  return (
    <div className="dn-prev-overlay" onClick={onClose}>
      <div
        className={`dn-prev-modal ${maximised ? 'dn-prev-max' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dn-prev-title"
      >
        <header className="dn-prev-head">
          <div className="dn-prev-head-left">
            <div className="dn-prev-kicker">Sample Report · Report ID {result.reportId}</div>
            <h3 id="dn-prev-title" className="dn-prev-title">
              {result.title}
            </h3>
            <div className="dn-prev-sub">
              {result.industryLabel} · {result.subjectLabel}
            </div>
          </div>
          <div className="dn-prev-head-right">
            <button
              className="dn-prev-btn dn-prev-btn-ghost"
              onClick={() => setMaximised((v) => !v)}
              title={maximised ? 'Shrink' : 'Expand'}
            >
              {maximised ? '⇲ Shrink' : '⇱ Expand'}
            </button>
            <button className="dn-prev-btn dn-prev-btn-ghost" onClick={onClose} aria-label="Close">
              ✕ Close
            </button>
          </div>
        </header>

        <div className="dn-prev-disclaimer">
          <strong>DISCLAIMER.</strong> {result.disclaimer}
        </div>

        <div className="dn-prev-body">
          <iframe
            ref={iframeRef}
            title="Sample report preview"
            srcDoc={result.previewHtml}
            className="dn-prev-frame"
          />
        </div>

        <footer className="dn-prev-foot">
          <div className="dn-prev-foot-left">
            Scroll inside the preview to read the full document. Want numbers tailored to your thesis?
            &nbsp;
            <button className="dn-prev-linkbtn" onClick={onRequestAccess}>
              Request customised access →
            </button>
          </div>
          <div className="dn-prev-foot-right">
            <button className="dn-prev-btn dn-prev-btn-ghost" onClick={print}>
              🖨 Print / Save PDF
            </button>
            <a
              className="dn-prev-btn dn-prev-btn-primary"
              href={result.downloadUrl}
              target="_blank"
              rel="noopener"
              download
            >
              ⬇ Download report
            </a>
          </div>
        </footer>
      </div>

      <style jsx>{`
        .dn-prev-overlay {
          position: fixed;
          inset: 0;
          background: rgba(5, 28, 44, 0.72);
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 32px 16px;
          backdrop-filter: blur(2px);
        }
        .dn-prev-modal {
          width: 100%;
          max-width: 980px;
          max-height: 92vh;
          background: #fff;
          border-radius: 10px;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          border: 1px solid rgba(255, 255, 255, 0.25);
        }
        .dn-prev-max {
          max-width: 1380px;
          max-height: 96vh;
        }
        .dn-prev-head {
          display: flex;
          justify-content: space-between;
          gap: 16px;
          padding: 16px 22px;
          border-bottom: 1px solid #E4DFD2;
          background: #F7F4EC;
        }
        .dn-prev-head-left {
          flex: 1;
          min-width: 0;
        }
        .dn-prev-kicker {
          font-size: 11px;
          letter-spacing: 1.4px;
          text-transform: uppercase;
          color: ${accentColor};
          font-weight: 700;
        }
        .dn-prev-title {
          margin: 4px 0 2px;
          font-family: Georgia, serif;
          color: #051C2C;
          font-size: 19px;
          line-height: 1.25;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .dn-prev-sub {
          font-size: 12.5px;
          color: #5B6676;
        }
        .dn-prev-head-right {
          display: flex;
          gap: 8px;
          align-items: flex-start;
          flex-shrink: 0;
        }
        .dn-prev-btn {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 8px 14px;
          border-radius: 6px;
          font-size: 12.5px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid #E4DFD2;
          background: #fff;
          color: #051C2C;
          text-decoration: none;
          line-height: 1;
        }
        .dn-prev-btn:hover {
          border-color: ${accentColor};
          color: ${accentColor};
        }
        .dn-prev-btn-primary {
          background: ${accentColor};
          color: #fff;
          border-color: ${accentColor};
        }
        .dn-prev-btn-primary:hover {
          background: #051C2C;
          border-color: #051C2C;
          color: #fff;
        }
        .dn-prev-btn-ghost {
          background: transparent;
        }
        .dn-prev-disclaimer {
          background: #FCE9EA;
          color: #B4252B;
          border-bottom: 1px solid rgba(180, 37, 43, 0.3);
          padding: 10px 22px;
          font-size: 12px;
          font-weight: 600;
          letter-spacing: 0.3px;
        }
        .dn-prev-body {
          flex: 1;
          min-height: 400px;
          background: #F2EEE4;
          overflow: hidden;
        }
        .dn-prev-frame {
          width: 100%;
          height: 100%;
          border: 0;
          background: transparent;
        }
        .dn-prev-foot {
          display: flex;
          gap: 16px;
          justify-content: space-between;
          padding: 14px 22px;
          border-top: 1px solid #E4DFD2;
          background: #F7F4EC;
          font-size: 12.5px;
          color: #5B6676;
          align-items: center;
          flex-wrap: wrap;
        }
        .dn-prev-foot-left {
          flex: 1;
          min-width: 240px;
        }
        .dn-prev-foot-right {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-shrink: 0;
        }
        .dn-prev-linkbtn {
          background: none;
          border: 0;
          color: ${accentColor};
          text-decoration: underline;
          font-weight: 600;
          font-size: 12.5px;
          cursor: pointer;
          padding: 0;
        }
        .dn-prev-linkbtn:hover {
          color: #051C2C;
        }
        @media (max-width: 640px) {
          .dn-prev-head {
            flex-direction: column;
            align-items: stretch;
          }
          .dn-prev-head-right {
            align-self: flex-end;
          }
        }
      `}</style>
    </div>
  )
}
