'use client'

/**
 * CRVI Framework — Corporate Restructuring, Valuation & Insolvency
 * Intelligence Studio.
 *
 * Promoted from a sub-tab inside M&A Strategy to a top-level route so
 * analysts can jump straight into SEBI SAST / CCI / SARFAESI / Buy-back
 * workflows without first landing on the strategic-algorithm page.
 *
 * The actual UI lives in `@/components/mastrategy/CRVITab` — this page
 * is a thin wrapper that adds a DealNector phdr breadcrumb and renders
 * the component inside the usual dashboard panel.
 */

import { CRVITab } from '@/components/mastrategy/CRVITab'

export default function CRVIPage() {
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
          <span className="dn-wordmark">
            Deal<em>Nector</em>
          </span>{' '}
          <span style={{ opacity: 0.5 }}>›</span> Restructuring &amp; Valuation
        </div>
        <h1
          style={{
            fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
          }}
        >
          CRVI{' '}
          <em style={{ color: 'var(--gold2)', fontStyle: 'normal' }}>Framework</em>
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
            SEBI SAST · CCI · SARFAESI · Buy-back · Capital Reduction · SICA · 25 strategies
          </span>
        </div>
      </div>

      {/* Panel */}
      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 20,
        }}
      >
        <CRVITab />
      </div>
    </div>
  )
}
