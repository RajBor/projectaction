'use client'

/**
 * DealNector landing page — global multi-industry strategic edition.
 *
 * Editorial treatment with runtime palette and light/dark switching.
 * Four palette presets live at the very top of the page; each can be
 * flipped to dark mode via the ☾/☀ toggle next to the swatches.
 * Selections persist to localStorage under `dn_landing_palette` and
 * `dn_landing_mode` so returning visitors keep their preference.
 *
 * Content is framed as a global, multi-industry M&A intelligence
 * terminal. Strategic disciplines and frameworks lead; Solar and T&D
 * appear only as illustrative case examples further down the page.
 *
 * Auth entry points open an in-page AuthModal that calls
 * signIn('credentials') or POSTs to /api/auth/signup.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import { signIn } from 'next-auth/react'
import { FlickeringGrid } from '@/components/ui/flickering-grid-hero'
import { GuidedWalkthrough } from '@/components/landing/GuidedWalkthrough'
import { MetricsStrip } from '@/components/landing/MetricsStrip'

type ModalMode = null | 'login' | 'signup'
type Mode = 'light' | 'dark'
type PaletteId = 'mercury' | 'crimson' | 'forest' | 'ink'

// ─── Palette system ───────────────────────────────────────

interface ThemeTokens {
  white: string
  cream: string
  rule: string
  ruleSoft: string
  ruleStrong: string
  ink: string
  ink2: string
  body: string
  bodySoft: string
  muted: string
  mutedDim: string
  accent: string
  accentSoft: string
  accentBg: string
  accentDim: string
  navy: string
  overlay: string
  snippetBg: string
}

interface Palette {
  id: PaletteId
  name: string
  kicker: string
  swatch: string
  light: ThemeTokens
  dark: ThemeTokens
}

const PALETTES: Palette[] = [
  {
    id: 'mercury',
    name: 'Mercury',
    kicker: 'Navy · Cream · Copper',
    swatch: '#C25E10',
    light: {
      white: '#FFFFFF',
      cream: '#F7F4EC',
      rule: '#E4DFD2',
      ruleSoft: '#ECE7DB',
      ruleStrong: '#C9C2AE',
      ink: '#051C2C',
      ink2: '#0A2340',
      body: '#1E2B3D',
      bodySoft: '#3A475A',
      muted: '#5B6676',
      mutedDim: '#8A94A1',
      accent: '#C25E10',
      accentSoft: '#E27625',
      accentBg: '#FBE9D3',
      accentDim: 'rgba(194,94,16,0.12)',
      navy: '#051C2C',
      overlay: 'rgba(5,28,44,0.62)',
      snippetBg: '#FFFFFF',
    },
    dark: {
      white: '#0A1320',
      cream: '#121D2E',
      rule: '#233244',
      ruleSoft: '#1A2636',
      ruleStrong: '#3A4A60',
      ink: '#F4F1E8',
      ink2: '#EAE5D6',
      body: '#D6D2C4',
      bodySoft: '#B3AEA0',
      muted: '#8B8778',
      mutedDim: '#5E5A4E',
      accent: '#E88A3C',
      accentSoft: '#F4A258',
      accentBg: 'rgba(232,138,60,0.12)',
      accentDim: 'rgba(232,138,60,0.18)',
      navy: '#020812',
      overlay: 'rgba(0,0,0,0.72)',
      snippetBg: '#0E1829',
    },
  },
  {
    id: 'crimson',
    name: 'Crimson',
    kicker: 'Charcoal · Stone · Red',
    swatch: '#C0272D',
    light: {
      white: '#FFFFFF',
      cream: '#F5F2EC',
      rule: '#E2DED6',
      ruleSoft: '#EBE7DE',
      ruleStrong: '#C9C3B5',
      ink: '#1A1A1A',
      ink2: '#2A2A2A',
      body: '#2A2A2A',
      bodySoft: '#404040',
      muted: '#666666',
      mutedDim: '#8F8F8F',
      accent: '#C0272D',
      accentSoft: '#D63F44',
      accentBg: '#FCE8E9',
      accentDim: 'rgba(192,39,45,0.12)',
      navy: '#1A1A1A',
      overlay: 'rgba(26,26,26,0.62)',
      snippetBg: '#FFFFFF',
    },
    dark: {
      white: '#0E0E0E',
      cream: '#1A1A1A',
      rule: '#2A2A2A',
      ruleSoft: '#202020',
      ruleStrong: '#3E3E3E',
      ink: '#F5F2EC',
      ink2: '#E8E5DF',
      body: '#D0CDC7',
      bodySoft: '#A8A59F',
      muted: '#7A7772',
      mutedDim: '#555250',
      accent: '#E85056',
      accentSoft: '#EF6770',
      accentBg: 'rgba(232,80,86,0.12)',
      accentDim: 'rgba(232,80,86,0.18)',
      navy: '#000000',
      overlay: 'rgba(0,0,0,0.72)',
      snippetBg: '#151515',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    kicker: 'Pine · Ivory · Gold',
    swatch: '#0E3D2F',
    light: {
      white: '#FEFDF9',
      cream: '#F2EFE3',
      rule: '#DDD8C9',
      ruleSoft: '#E7E2D3',
      ruleStrong: '#BEB8A7',
      ink: '#0E3D2F',
      ink2: '#154737',
      body: '#1F2F27',
      bodySoft: '#3A4A42',
      muted: '#5B6B63',
      mutedDim: '#8A9A92',
      accent: '#B8860B',
      accentSoft: '#D4A010',
      accentBg: '#F7EFD4',
      accentDim: 'rgba(184,134,11,0.12)',
      navy: '#0E3D2F',
      overlay: 'rgba(14,61,47,0.62)',
      snippetBg: '#FEFDF9',
    },
    dark: {
      white: '#0A1A14',
      cream: '#0E2218',
      rule: '#1F3628',
      ruleSoft: '#152B1F',
      ruleStrong: '#355445',
      ink: '#F2EFE3',
      ink2: '#E3DFCE',
      body: '#CEC9B4',
      bodySoft: '#A9A591',
      muted: '#7E7A66',
      mutedDim: '#595648',
      accent: '#E5B93A',
      accentSoft: '#F0CB5A',
      accentBg: 'rgba(229,185,58,0.12)',
      accentDim: 'rgba(229,185,58,0.2)',
      navy: '#031208',
      overlay: 'rgba(0,0,0,0.72)',
      snippetBg: '#0D1E15',
    },
  },
  {
    id: 'ink',
    name: 'Ink',
    kicker: 'Black · White · Amber',
    swatch: '#000000',
    light: {
      white: '#FFFFFF',
      cream: '#F5F5F5',
      rule: '#D8D8D8',
      ruleSoft: '#E8E8E8',
      ruleStrong: '#B5B5B5',
      ink: '#000000',
      ink2: '#1A1A1A',
      body: '#1A1A1A',
      bodySoft: '#333333',
      muted: '#555555',
      mutedDim: '#888888',
      accent: '#D97706',
      accentSoft: '#F59E0B',
      accentBg: '#FEF3C7',
      accentDim: 'rgba(217,119,6,0.12)',
      navy: '#000000',
      overlay: 'rgba(0,0,0,0.62)',
      snippetBg: '#FFFFFF',
    },
    dark: {
      white: '#000000',
      cream: '#0B0B0B',
      rule: '#1F1F1F',
      ruleSoft: '#171717',
      ruleStrong: '#333333',
      ink: '#FFFFFF',
      ink2: '#EDEDED',
      body: '#D4D4D4',
      bodySoft: '#A3A3A3',
      muted: '#737373',
      mutedDim: '#525252',
      accent: '#FBBF24',
      accentSoft: '#FCD34D',
      accentBg: 'rgba(251,191,36,0.12)',
      accentDim: 'rgba(251,191,36,0.2)',
      navy: '#000000',
      overlay: 'rgba(0,0,0,0.8)',
      snippetBg: '#121212',
    },
  },
]

function paletteById(id: PaletteId): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0]
}

function tokensToVars(t: ThemeTokens): CSSProperties {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ['--white' as any]: t.white,
    ['--cream' as any]: t.cream,
    ['--rule' as any]: t.rule,
    ['--rule-soft' as any]: t.ruleSoft,
    ['--rule-strong' as any]: t.ruleStrong,
    ['--ink' as any]: t.ink,
    ['--ink-2' as any]: t.ink2,
    ['--body' as any]: t.body,
    ['--body-soft' as any]: t.bodySoft,
    ['--muted' as any]: t.muted,
    ['--muted-2' as any]: t.mutedDim,
    ['--accent' as any]: t.accent,
    ['--accent-soft' as any]: t.accentSoft,
    ['--accent-bg' as any]: t.accentBg,
    ['--accent-dim' as any]: t.accentDim,
    ['--navy' as any]: t.navy,
    ['--overlay' as any]: t.overlay,
    ['--snippet-bg' as any]: t.snippetBg,
  }
}

// ─── Main component ───────────────────────────────────────

export function LandingPage() {
  const [modal, setModal] = useState<ModalMode>(null)
  const [paletteId, setPaletteId] = useState<PaletteId>('mercury')
  const [mode, setMode] = useState<Mode>('light')

  // Hydrate preferences from localStorage
  useEffect(() => {
    try {
      const p = localStorage.getItem('dn_landing_palette') as PaletteId | null
      const m = localStorage.getItem('dn_landing_mode') as Mode | null
      if (p && PALETTES.some((x) => x.id === p)) setPaletteId(p)
      if (m === 'light' || m === 'dark') setMode(m)
    } catch {
      /* ignore */
    }
  }, [])

  const selectPalette = (id: PaletteId) => {
    setPaletteId(id)
    try {
      localStorage.setItem('dn_landing_palette', id)
    } catch {
      /* ignore */
    }
  }
  const toggleMode = () => {
    const next: Mode = mode === 'light' ? 'dark' : 'light'
    setMode(next)
    try {
      localStorage.setItem('dn_landing_mode', next)
    } catch {
      /* ignore */
    }
  }

  const palette = paletteById(paletteId)
  const tokens = palette[mode]
  const cssVars = tokensToVars(tokens)

  return (
    <>
      <style>{LANDING_CSS}</style>
      <div className="dn-landing" style={cssVars}>
        {/* THEME TOOLBAR */}
        <div className="dn-theme-bar">
          <div className="dn-theme-bar-inner">
            <div className="dn-theme-left">
              <span className="dn-theme-label">Theme</span>
              <div className="dn-theme-swatches">
                {PALETTES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => selectPalette(p.id)}
                    className={`dn-swatch ${paletteId === p.id ? 'dn-swatch-active' : ''}`}
                    style={{ background: p.swatch }}
                    aria-label={`${p.name} — ${p.kicker}`}
                    title={`${p.name} · ${p.kicker}`}
                  />
                ))}
              </div>
              <span className="dn-theme-name">
                {palette.name} · {palette.kicker}
              </span>
            </div>
            <button
              type="button"
              className="dn-mode-toggle"
              onClick={toggleMode}
              aria-label={mode === 'light' ? 'Switch to dark mode' : 'Switch to light mode'}
              title={mode === 'light' ? 'Dark mode' : 'Light mode'}
            >
              {mode === 'light' ? '☾ Dark' : '☀ Light'}
            </button>
          </div>
        </div>

        {/* NAV */}
        <nav className="dn-nav">
          <div className="dn-nav-inner">
            <div className="dn-brand">
              Deal<span className="dn-brand-accent">Nector</span>
            </div>
            <div className="dn-nav-links">
              <a href="#thesis">Thesis</a>
              <a href="#features">Features</a>
              <a href="#walkthrough">Walkthrough</a>
              <a href="#disciplines">Disciplines</a>
              <a href="#frameworks">Frameworks</a>
              <a href="#coverage">Coverage</a>
            </div>
            <div className="dn-nav-cta">
              <button className="dn-btn-ghost" onClick={() => setModal('login')}>
                Sign in
              </button>
              <button className="dn-btn-primary" onClick={() => setModal('signup')}>
                Request access →
              </button>
            </div>
          </div>
        </nav>

        {/* MARQUEE / STRATEGIC STATEMENTS */}
        <div className="dn-marquee">
          <div className="dn-marquee-inner">
            <span className="dn-marquee-kicker">
              <span className="dn-dot" />
              Think ahead
            </span>
            <div className="dn-marquee-items">
              <span>Move before the mandate</span>
              <span className="dn-sep" />
              <span>Price before the auction</span>
              <span className="dn-sep" />
              <span>Read the policy before the press release</span>
              <span className="dn-sep" />
              <span>See consolidation before the peer group</span>
            </div>
          </div>
        </div>

        {/* HERO */}
        <section id="thesis" className="dn-hero">
          {/* Animated canvas flicker — sits behind everything but the
              content, picks up the accent colour from the palette. */}
          <div className="dn-hero-flicker" aria-hidden>
            <FlickeringGrid
              className="dn-hero-flicker-grid"
              color={tokens.accent}
              squareSize={4}
              gridGap={5}
              flickerChance={0.28}
              maxOpacity={mode === 'dark' ? 0.35 : 0.22}
            />
          </div>
          <div className="dn-hero-grid-bg" />
          <div className="dn-hero-inner">
            <div className="dn-hero-left">
              <div className="dn-hero-eyebrow">
                <span className="dn-rule" />
                <span>Global M&amp;A Intelligence · Multi-Industry Terminal</span>
              </div>
              <h1 className="dn-hero-title">
                See the deal
                <br />
                <em>before it moves.</em>
              </h1>
              <p className="dn-hero-lede">
                DealNector is the institutional terminal for thesis-driven
                buyers. Corporate development, private equity, and strategy
                teams use it to map entire industries, diagnose strategic
                value, and move on assets before competitors see the signal.
              </p>
              <div className="dn-hero-cta">
                <button
                  className="dn-btn-primary dn-btn-lg"
                  onClick={() => setModal('signup')}
                >
                  Request access →
                </button>
                <button
                  className="dn-btn-outline dn-btn-lg"
                  onClick={() => setModal('login')}
                >
                  Sign in to the terminal
                </button>
              </div>
            </div>

            <aside className="dn-hero-rail">
              <div className="dn-rail-head">Why buyers choose it</div>
              <div className="dn-rail-rows">
                <RailRow k="Strategic mapping" v="01" />
                <RailRow k="Target identification" v="02" />
                <RailRow k="Growth diagnostics" v="03" />
                <RailRow k="Valuation engine" v="04" />
                <RailRow k="Decision intelligence" v="05" last />
              </div>
              <div className="dn-rail-foot">
                Multi-industry by design. Built for buyers who read the market
                forwards — not the deal sheet backwards.
              </div>
            </aside>
          </div>
        </section>

        {/* PULL QUOTE */}
        <section className="dn-quote-strip">
          <div className="dn-quote-inner">
            <span className="dn-quote-mark">“</span>
            <p className="dn-quote-text">
              The best deals aren&apos;t sold.{' '}
              <em>They&apos;re seen early.</em>
            </p>
            <div className="dn-quote-attr">
              A terminal for strategic buyers — not auction bidders.
            </div>
          </div>
        </section>

        {/* STRATEGIC DISCIPLINES */}
        <section id="disciplines" className="dn-section dn-section-cream">
          <div className="dn-section-inner">
            <div className="dn-section-head">
              <div className="dn-section-head-meta">
                <span className="dn-num-tag">01 — 05</span>
                <span className="dn-rule" />
                <span className="dn-eyebrow">Strategic disciplines</span>
              </div>
              <h2 className="dn-h2">
                Five disciplines. <em>One strategic advantage.</em>
              </h2>
              <p className="dn-section-lede">
                Every discipline shares the same underlying intelligence layer.
                A single shift in news, policy, or management cascades across
                the entire workflow — so your thesis stays consistent and your
                audit trail stays intact.
              </p>
            </div>

            <div className="dn-services">
              {DISCIPLINES.map((s, i) => (
                <article key={s.title} className="dn-service">
                  <div className="dn-service-index">
                    <span className="dn-service-num">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="dn-service-kicker">{s.kicker}</span>
                  </div>
                  <div className="dn-service-body">
                    <h3 className="dn-service-title">{s.title}</h3>
                    <p className="dn-service-lede">{s.lede}</p>
                    <ul className="dn-service-bullets">
                      {s.points.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* STRATEGIC FRAMEWORKS */}
        <section id="frameworks" className="dn-section">
          <div className="dn-section-inner">
            <div className="dn-section-head-centered">
              <div className="dn-section-head-meta dn-section-head-meta-center">
                <span className="dn-num-tag">Method</span>
                <span className="dn-rule" />
                <span className="dn-eyebrow">Strategic frameworks</span>
              </div>
              <h2 className="dn-h2">
                Six lenses. <em>One composite view.</em>
              </h2>
              <p className="dn-section-lede">
                DealNector synthesises the discipline of the world&apos;s top
                strategy practices into a single composite read on every
                target. Each framework diagnoses a different lever of strategic
                value — and every asset in your universe is scored against all
                six.
              </p>
            </div>
            <div className="dn-frameworks">
              {FRAMEWORKS.map((f, i) => (
                <div key={f.title} className="dn-framework">
                  <div className="dn-framework-num">
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <div className="dn-framework-title">{f.title}</div>
                  <div className="dn-framework-sub">{f.sub}</div>
                  <p className="dn-framework-body">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* MULTI-INDUSTRY COVERAGE */}
        <section id="coverage" className="dn-section dn-section-cream">
          <div className="dn-section-inner">
            <div className="dn-section-head">
              <div className="dn-section-head-meta">
                <span className="dn-num-tag">Scope</span>
                <span className="dn-rule" />
                <span className="dn-eyebrow">Where the terminal operates</span>
              </div>
              <h2 className="dn-h2">
                Global. <em>Multi-industry. By design.</em>
              </h2>
              <p className="dn-section-lede">
                The disciplines and frameworks are industry-agnostic. We begin
                where the data is richest and the consolidation clock is
                loudest — then extend the same strategic lens to every sector
                where thesis-driven buyers compete.
              </p>
            </div>
            <div className="dn-coverage-grid">
              {COVERAGE.map((c) => (
                <div
                  key={c.title}
                  className={`dn-coverage-tile ${c.state === 'live' ? 'dn-coverage-live' : ''}`}
                >
                  <div className="dn-coverage-state">
                    {c.state === 'live' ? '● Live' : '○ Roadmap'}
                  </div>
                  <div className="dn-coverage-title">{c.title}</div>
                  <div className="dn-coverage-body">{c.body}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CASE EXAMPLES */}
        <section id="cases" className="dn-section">
          <div className="dn-section-inner">
            <div className="dn-section-head">
              <div className="dn-section-head-meta">
                <span className="dn-num-tag">Applied</span>
                <span className="dn-rule" />
                <span className="dn-eyebrow">Case examples</span>
              </div>
              <h2 className="dn-h2">
                The framework, <em>applied.</em>
              </h2>
              <p className="dn-section-lede">
                Two live industry workspaces show how the disciplines come
                together on real assets — every node mapped, scored, and
                valued against the strategic framework in real time.
              </p>
            </div>

            {/* Case example 1 — Solar */}
            <div className="dn-case">
              <div className="dn-case-tag">
                <span>Case example · 01</span>
                <span className="dn-case-rule" />
                <span className="dn-case-kicker">Renewable manufacturing value chain</span>
              </div>
              <div className="dn-split">
                <div className="dn-split-left">
                  <h3 className="dn-case-title">
                    Polysilicon to power purchase —{' '}
                    <em>the full integrated stack.</em>
                  </h3>
                  <p className="dn-section-lede">
                    Every node in the solar value chain, mapped and scored.
                    Where policy builds structural moats. Where upstream
                    integration is still open. Where the next consolidation
                    print is being set up. The framework applies end-to-end.
                  </p>
                  <ul className="dn-key-list">
                    <li>
                      <strong>Manufacturing core</strong>
                      Module and cell makers · technology transition cycles ·
                      policy-protected players
                    </li>
                    <li>
                      <strong>Upstream integration</strong>
                      Wafer · polysilicon · speciality glass · encapsulants
                    </li>
                    <li>
                      <strong>Balance of system</strong>
                      Inverters · mounting · tracking · junction-level
                      components
                    </li>
                    <li>
                      <strong>Downstream capacity</strong>
                      Operating IPPs · contracted offtake · BESS-linked
                      storage
                    </li>
                  </ul>
                </div>
                <div className="dn-split-right">
                  <div className="dn-snippet">
                    <div className="dn-snippet-head">
                      <span className="dn-snippet-tag">Strategic read</span>
                    </div>
                    <SnippetRow
                      code="CORE"
                      label="Manufacturing"
                      detail="Policy-protected structural moat · technology inflection phase"
                    />
                    <SnippetRow
                      code="UPSTRM"
                      label="Upstream integration"
                      detail="Backward integration open · limited domestic supply"
                    />
                    <SnippetRow
                      code="ADJ"
                      label="Storage & BESS"
                      detail="Utility-scale tenders accelerating · adjacent wave"
                    />
                    <SnippetRow
                      code="DOWN"
                      label="Operating assets"
                      detail="Contracted cash flows · long-duration offtake"
                    />
                    <SnippetRow
                      code="VALN"
                      label="Valuation band"
                      detail="Wide spread · policy-sensitive re-rating risk"
                      last
                    />
                    <div className="dn-snippet-foot">
                      Illustrative of how the discipline applies to a full
                      renewable manufacturing value chain. The same lens applies
                      to every other industry on the coverage grid.
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Case example 2 — T&D */}
            <div className="dn-case dn-case-offset">
              <div className="dn-case-tag">
                <span>Case example · 02</span>
                <span className="dn-case-rule" />
                <span className="dn-case-kicker">Grid modernisation demand cycle</span>
              </div>
              <div className="dn-split dn-split-reverse">
                <div className="dn-split-left">
                  <h3 className="dn-case-title">
                    A policy-forced demand cycle, <em>mapped to suppliers.</em>
                  </h3>
                  <p className="dn-section-lede">
                    Public-capex-led modernisation collapses a decade of
                    distribution-side demand into a short window. DealNector
                    tracks which equipment suppliers, service platforms, and
                    software players catch the flow — and where the
                    consolidation economics actually work.
                  </p>
                  <ul className="dn-key-list">
                    <li>
                      <strong>Grid equipment</strong>
                      Transformers · cables · conductors · switchgear
                    </li>
                    <li>
                      <strong>Metering &amp; AMI</strong>
                      Smart meters · communications · MDM platforms
                    </li>
                    <li>
                      <strong>Automation &amp; control</strong>
                      Substation automation · SCADA · EMS · grid software
                    </li>
                    <li>
                      <strong>Adjacencies</strong>
                      BESS · EV infrastructure · microgrid platforms
                    </li>
                  </ul>
                </div>
                <div className="dn-split-right">
                  <div className="dn-snippet">
                    <div className="dn-snippet-head">
                      <span className="dn-snippet-tag dn-tag-orange">
                        Demand read
                      </span>
                    </div>
                    <SnippetRow
                      code="EQP"
                      label="Grid equipment"
                      detail="Multi-year order-book visibility · capacity-constrained winners"
                    />
                    <SnippetRow
                      code="AMI"
                      label="Smart metering"
                      detail="Policy-locked rollout · winner-take-most economics"
                    />
                    <SnippetRow
                      code="AUTO"
                      label="Automation"
                      detail="Software margin uplift · platform consolidation"
                    />
                    <SnippetRow
                      code="ADJ"
                      label="Adjacencies"
                      detail="BESS · EV charging · microgrid — fast wave"
                    />
                    <SnippetRow
                      code="VALN"
                      label="Deal timing"
                      detail="Mid-cycle · consolidation window open"
                      last
                    />
                    <div className="dn-snippet-foot">
                      The same strategic lens maps to any public-capex-led
                      industrial wave — whether it&apos;s grid, rail,
                      defence, water, or telecom infrastructure.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* POLICY / NEWS INTELLIGENCE (navy break) */}
        <section id="policy" className="dn-section dn-section-navy">
          <div className="dn-section-inner">
            <div className="dn-split">
              <div className="dn-split-left">
                <div className="dn-section-head-meta dn-section-head-meta-left dn-section-head-meta-dark">
                  <span className="dn-num-tag dn-num-tag-dark">Method</span>
                  <span className="dn-rule dn-rule-dark" />
                  <span className="dn-eyebrow dn-eyebrow-dark">Decision intelligence</span>
                </div>
                <h2 className="dn-h2 dn-h2-light">
                  Model the shift — <em>before the market does.</em>
                </h2>
                <p className="dn-section-lede dn-section-lede-light">
                  Every tracked asset has a live news and policy feed. Each
                  item is classified, sentiment-scored, and translated into a
                  per-parameter impact on the strategic model. You acknowledge
                  what matters. You override where you disagree. And every
                  metric across the platform shows both pre- and
                  post-acknowledgement values — so the audit trail is never
                  silent.
                </p>
                <ul className="dn-key-list dn-key-list-light">
                  <li>
                    <strong>Regulatory shifts</strong>
                    Scheme-level changes · tariffs · protectionist moves
                  </li>
                  <li>
                    <strong>Strategic signals</strong>
                    Management changes · stake transactions · JV formations
                  </li>
                  <li>
                    <strong>Financial events</strong>
                    Rating actions · earnings surprises · refinancing moves
                  </li>
                  <li>
                    <strong>Parameters affected</strong>
                    Growth · margin · cost of capital · moat · management ·
                    concentration · multiple
                  </li>
                </ul>
              </div>
              <div className="dn-split-right">
                <div className="dn-impact-card">
                  <div className="dn-impact-head">Impact modelling</div>
                  <div className="dn-impact-panel">
                    <div className="dn-impact-row">
                      <span className="dn-impact-label">Baseline multiple</span>
                      <span className="dn-impact-value">14.7×</span>
                    </div>
                    <div className="dn-impact-arrow">↓ news acknowledged</div>
                    <div className="dn-impact-row dn-impact-row-alt">
                      <span className="dn-impact-label">Adjusted multiple</span>
                      <span className="dn-impact-value dn-impact-orange">
                        15.1×
                      </span>
                    </div>
                  </div>
                  <div className="dn-impact-divider" />
                  <div className="dn-impact-panel">
                    <div className="dn-impact-row">
                      <span className="dn-impact-label">Baseline strategic score</span>
                      <span className="dn-impact-value">8.0 / 10</span>
                    </div>
                    <div className="dn-impact-arrow">↓ news acknowledged</div>
                    <div className="dn-impact-row dn-impact-row-alt">
                      <span className="dn-impact-label">Adjusted strategic score</span>
                      <span className="dn-impact-value dn-impact-orange">
                        7.6 / 10
                      </span>
                    </div>
                  </div>
                  <div className="dn-impact-footnote">
                    Pre- and post-acknowledgement values remain visible across
                    the entire platform. Nothing is silently adjusted.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ─────────────────────────────────────────────────────
           FEATURE SHOWCASE — animated carousel with glow + hover
           card effects, inspired by dhanhq.co/algos but scoped to
           DealNector's palette tokens so every theme (Mercury /
           Crimson / Forest / Ink, light+dark) stays consistent.
           ───────────────────────────────────────────────────── */}
        <section id="features" className="dn-section dn-features-section">
          <div className="dn-features-glow dn-features-glow-a" aria-hidden />
          <div className="dn-features-glow dn-features-glow-b" aria-hidden />
          <div className="dn-section-inner">
            <div className="dn-section-head">
              <div className="dn-section-head-meta">
                <span className="dn-num-tag">Features</span>
                <span className="dn-rule" />
                <span className="dn-eyebrow">The institutional toolkit</span>
              </div>
              <h2 className="dn-h2">
                Seven modules that work <em>as one terminal.</em>
              </h2>
              <p className="dn-section-lede">
                Every feature speaks to the others — news flows into valuation,
                valuations flow into portfolios, portfolios flow into PDF
                reports. Hover any card to see what&apos;s under the hood.
              </p>
            </div>

            {/* Loader bar — animates horizontally across the section */}
            <div className="dn-features-loader">
              <span className="dn-features-loader-fill" />
            </div>

            {/* Feature cards — responsive grid + staggered fade-in */}
            <div className="dn-feature-grid">
              {FEATURES.map((f, i) => (
                <article
                  key={f.id}
                  className="dn-feature-card"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="dn-feature-card-sheen" aria-hidden />
                  <div className="dn-feature-card-index">
                    {String(i + 1).padStart(2, '0')}
                  </div>
                  <div className="dn-feature-card-icon" aria-hidden>
                    {f.icon}
                  </div>
                  <h3 className="dn-feature-card-title">{f.title}</h3>
                  <p className="dn-feature-card-body">{f.body}</p>
                  <div className="dn-feature-card-tags">
                    {f.tags.map((t) => (
                      <span key={t} className="dn-feature-tag">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="dn-feature-card-cta">
                    <span>Explore</span>
                    <span className="dn-feature-card-arrow">→</span>
                  </div>
                </article>
              ))}
            </div>

            {/* Horizontal ticker — always-on scrolling badges */}
            <div className="dn-feature-ticker" aria-hidden>
              <div className="dn-feature-ticker-track">
                {[...TICKER_ITEMS, ...TICKER_ITEMS].map((t, i) => (
                  <span className="dn-feature-ticker-item" key={i}>
                    <span className="dn-feature-ticker-dot" /> {t}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ─────────────────────────────────────────────────────
           GUIDED WALKTHROUGH — auto-advancing 5-step product
           tour with animated mock UIs on the right, progress
           bar at the top, pause-on-hover. Gives new visitors
           a concrete guided path through the platform before
           they even sign up.
           ───────────────────────────────────────────────────── */}
        <section id="walkthrough" className="dn-section dn-section-cream">
          <div className="dn-section-inner">
            <div className="dn-section-head">
              <div className="dn-section-head-meta">
                <span className="dn-num-tag">Walkthrough</span>
                <span className="dn-rule" />
                <span className="dn-eyebrow">See it before you sign up</span>
              </div>
              <h2 className="dn-h2">
                Five steps from target <em>to signed memo.</em>
              </h2>
              <p className="dn-section-lede">
                A narrated tour of the DealNector workflow, with live mini
                previews. Hover to pause. Use ← → to navigate manually.
              </p>
            </div>
            <GuidedWalkthrough />
          </div>
        </section>

        {/* ─────────────────────────────────────────────────────
           LIVE METRICS STRIP — count-up KPI row that only
           animates once the strip scrolls into view.
           ───────────────────────────────────────────────────── */}
        <section className="dn-section dn-metrics-section">
          <div className="dn-section-inner">
            <MetricsStrip />
          </div>
        </section>

        {/* AHEAD-OF-PEERS WORKFLOW */}
        <section className="dn-section">
          <div className="dn-section-inner">
            <div className="dn-section-head">
              <div className="dn-section-head-meta">
                <span className="dn-num-tag">Workflow</span>
                <span className="dn-rule" />
                <span className="dn-eyebrow">How buyers stay ahead</span>
              </div>
              <h2 className="dn-h2">
                Read the market forwards — <em>one clean pass.</em>
              </h2>
            </div>
            <div className="dn-pillars">
              {PILLARS.map((p, i, arr) => (
                <div key={p.title}>
                  <div className="dn-pillar">
                    <div className="dn-pillar-step">
                      {String(i + 1).padStart(2, '0')}
                    </div>
                    <div className="dn-pillar-content">
                      <h4 className="dn-pillar-title">{p.title}</h4>
                      <p className="dn-pillar-body">{p.body}</p>
                    </div>
                  </div>
                  {i < arr.length - 1 && <div className="dn-pillar-divider" />}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="dn-cta">
          <div className="dn-cta-inner">
            <span className="dn-eyebrow">Request access</span>
            <h2 className="dn-h2">
              The terminal for buyers who <em>think ahead.</em>
            </h2>
            <p className="dn-section-lede">
              DealNector is a closed institutional platform. Request an account
              and we&apos;ll configure coverage, frameworks, and strategic
              parameters for your mandate.
            </p>
            <div className="dn-hero-cta dn-hero-cta-center">
              <button
                className="dn-btn-primary dn-btn-lg"
                onClick={() => setModal('signup')}
              >
                Request access →
              </button>
              <button
                className="dn-btn-outline dn-btn-lg"
                onClick={() => setModal('login')}
              >
                Sign in
              </button>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="dn-footer">
          <div className="dn-footer-inner">
            <div className="dn-footer-grid">
              <div className="dn-footer-brand">
                <div className="dn-brand">
                  Deal<span className="dn-brand-accent">Nector</span>
                </div>
                <p className="dn-footer-blurb">
                  Global M&amp;A intelligence for thesis-driven buyers.
                  Strategic mapping, target identification, growth diagnostics,
                  valuation, and decision intelligence — in one terminal.
                </p>
              </div>
              <div>
                <div className="dn-footer-heading">Platform</div>
                <div className="dn-footer-links">
                  <a href="#disciplines">Disciplines</a>
                  <a href="#frameworks">Frameworks</a>
                  <a href="#coverage">Coverage</a>
                  <a href="#cases">Case Examples</a>
                  <a href="#policy">Decision Intelligence</a>
                </div>
              </div>
              <div>
                <div className="dn-footer-heading">Access</div>
                <div className="dn-footer-links">
                  <button type="button" onClick={() => setModal('login')}>
                    Sign in
                  </button>
                  <button type="button" onClick={() => setModal('signup')}>
                    Request access
                  </button>
                </div>
              </div>
            </div>
            <div className="dn-footer-bottom">
              <div>© 2025 DealNector</div>
              <div>Global multi-industry M&amp;A intelligence terminal</div>
            </div>
          </div>
        </footer>
      </div>

      {modal && (
        <AuthModal
          mode={modal}
          onClose={() => setModal(null)}
          onSwitch={(m) => setModal(m)}
        />
      )}
    </>
  )
}

// ─── Content tables ───────────────────────────────────────

const DISCIPLINES: Array<{
  kicker: string
  title: string
  lede: string
  points: string[]
}> = [
  {
    kicker: 'See the chessboard',
    title: 'Strategic Mapping',
    lede: 'Read the industry forwards — not the deal sheet backwards.',
    points: [
      'Every player, every segment, every strategic control point',
      'Consolidation patterns and wave timing visible at a glance',
      'Policy, technology, and demand signals overlaid on the map',
    ],
  },
  {
    kicker: 'Move first',
    title: 'Target Identification',
    lede: 'Find the asset your competitors haven\u2019t priced yet.',
    points: [
      'Pre-emptive target discovery from composite strategic screens',
      'Ownership structure, deal feasibility, and timing diagnostics',
      'Watchlist, pipeline, and pre-mandate tracking',
    ],
  },
  {
    kicker: 'Diagnose value',
    title: 'Strategic Growth Diagnostics',
    lede: 'Understand what drives value — before the auction.',
    points: [
      'Growth drivers decomposed across seven strategic levers',
      'Management, moat, and market-position diagnostics',
      'Inflection-potential scoring with interpretive context',
    ],
  },
  {
    kicker: 'Price with conviction',
    title: 'Valuation Engine',
    lede: 'Sensitised deal pricing across strategic scenarios.',
    points: [
      'Composite valuation across multiples, DCF, and comparables',
      'Synergy modelling with walk-away and bid-range guardrails',
      'Every number with pre- and post-adjustment provenance',
    ],
  },
  {
    kicker: 'Stay ahead',
    title: 'Decision Intelligence',
    lede: 'Model how policy, news, and macro shifts reshape the thesis.',
    points: [
      'Live classified feed per tracked asset',
      'Per-parameter impact estimation with manual override',
      'Full audit trail — nothing silently adjusted',
    ],
  },
]

const FRAMEWORKS: Array<{ title: string; sub: string; body: string }> = [
  {
    title: 'Growth Horizons',
    sub: 'Core · Adjacent · Transformational',
    body: 'Diagnose where an asset sits on the growth curve. Defend the core, extend into the adjacent, underwrite the transformational — and know which horizon the market is paying for.',
  },
  {
    title: 'Portfolio Position Matrix',
    sub: 'Growth rate × competitive strength',
    body: 'Plot every target against industry growth and relative position. Identifies question marks that are about to re-rate and cash generators that the market has under-priced.',
  },
  {
    title: 'Strategic Control Points',
    sub: 'Where the value actually lives',
    body: 'Identify the choke points in the value chain that capture disproportionate economics. These are where structural moats form, where consolidation pays, and where buyers should act first.',
  },
  {
    title: 'Competitive Moat Scan',
    sub: 'Seven levers, one composite',
    body: 'Score every asset against scale, network, switching, regulatory, IP, distribution, and brand moats. The composite drives both valuation multiple and deal-flow priority.',
  },
  {
    title: 'Consolidation Wave Analysis',
    sub: 'Early · mid · late cycle',
    body: 'Every industry consolidates in waves. DealNector maps where each sub-segment sits in its wave — so you buy in phases the market has not yet priced as consolidating.',
  },
  {
    title: 'Deal Feasibility Screen',
    sub: 'Can you actually buy it',
    body: 'Ownership structure, leverage capacity, regulatory exposure, cultural fit, and timing window. A brilliant target that cannot be bought is a waste of analyst hours.',
  },
]

const COVERAGE: Array<{ title: string; body: string; state: 'live' | 'roadmap' }> = [
  {
    title: 'Renewable energy & grid',
    body: 'Solar, wind, BESS, transmission, distribution, smart metering. Full framework coverage.',
    state: 'live',
  },
  {
    title: 'Industrial technology',
    body: 'Automation, robotics, process control, factory software. Mid-cycle consolidation.',
    state: 'roadmap',
  },
  {
    title: 'Infrastructure',
    body: 'Transport, logistics hubs, specialised real assets, public-capex exposed names.',
    state: 'roadmap',
  },
  {
    title: 'Healthcare & life sciences',
    body: 'Devices, diagnostics, speciality pharma, services roll-ups, digital health.',
    state: 'roadmap',
  },
  {
    title: 'Financial services',
    body: 'Fintech, specialty lending, wealth platforms, insurance roll-ups, capital markets.',
    state: 'roadmap',
  },
  {
    title: 'Software & digital',
    body: 'Vertical SaaS, data platforms, developer tools, cyber, AI infrastructure.',
    state: 'roadmap',
  },
  {
    title: 'Materials & chemicals',
    body: 'Specialty chemicals, advanced materials, circular-economy plays, battery supply chain.',
    state: 'roadmap',
  },
  {
    title: 'Consumer & retail',
    body: 'Direct-to-consumer, premium brands, food tech, organised retail platforms.',
    state: 'roadmap',
  },
]

const FEATURES: Array<{
  id: string
  title: string
  body: string
  icon: string
  tags: string[]
}> = [
  {
    id: 'value-chain',
    title: 'Value Chain Intelligence',
    body: 'Every listed and private target mapped across the solar and T&D chain — segment-level financials, acquisition feasibility, ALMM / PLI status, and one-click portfolio + deal pipeline actions.',
    icon: '⛓',
    tags: ['Public + Private', 'Segments', 'One-click'],
  },
  {
    id: 'valuation',
    title: 'Institutional Valuation',
    body: 'Multi-method triangulation — DCF with full assumption control, comparable multiples, precedent transactions, and a live peer football-field. Every number auditable.',
    icon: '₹',
    tags: ['DCF', 'Comparables', 'Football field'],
  },
  {
    id: 'ma-radar',
    title: 'M&A Radar',
    body: 'Acquisition scores across 80+ tracked names, live news-adjusted deltas, Express Interest routing, and side-by-side peer deep dives — presented as a working deal desk.',
    icon: '◈',
    tags: ['Scoring', 'Live adjust', 'Deal desk'],
  },
  {
    id: 'news-hub',
    title: 'News Hub with Impact',
    body: 'Google News + PV Magazine India/Global merged into one deduped feed, each item scored for sentiment, materiality, and per-parameter valuation impact. Acknowledge or override.',
    icon: '⊡',
    tags: ['Google News', 'PV Magazine', 'Sentiment'],
  },
  {
    id: 'portfolio',
    title: 'Portfolio Tracker',
    body: 'Group listed + private targets into named portfolios, blend by weight, watch the trend hydrate from RapidAPI, and see material news events dropped right on the chart.',
    icon: '◐',
    tags: ['Portfolios', 'Live trend', 'Event overlay'],
  },
  {
    id: 'fsa',
    title: 'Strategic Financial Analysis',
    body: 'Full ratio engine — activity, liquidity, solvency, profitability, cash flow quality — with DuPont decomposition and multi-year annual report parsing from the RapidAPI feed.',
    icon: '∑',
    tags: ['Ratios', 'DuPont', 'Multi-year'],
  },
  {
    id: 'reports',
    title: 'McKinsey-Grade PDF Reports',
    body: 'Per-company and per-portfolio institutional reports with DCF tables, peer benchmarks, news impact, and a football field — printable directly from the browser.',
    icon: '◧',
    tags: ['Company', 'Portfolio', 'Print-first'],
  },
]

const TICKER_ITEMS: string[] = [
  'Live news → valuation delta',
  'DCF with assumption panel',
  'Peer football field',
  'Portfolio trend with event overlay',
  'Multi-year annual report parsing',
  'Acquisition score explainer',
  'Pre / post-news audit trail',
  'Private + listed targets',
  'Sentiment + materiality scoring',
  'One-click PDF export',
]

const PILLARS: Array<{ title: string; body: string }> = [
  {
    title: 'Map the chessboard',
    body: 'Filter the universe by sector, segment, wave stage, strategic score, or deal feasibility. See the pattern before the pattern is priced.',
  },
  {
    title: 'Diagnose the target',
    body: 'Auto-load statements and strategic context, run the framework suite, and read the composite score with interpretive narrative — not just numbers.',
  },
  {
    title: 'Price with confidence',
    body: 'Run multiples, DCF, and comparables against live and news-adjusted scenarios. Every number with pre- and post-adjustment provenance.',
  },
  {
    title: 'Decide — and move',
    body: 'Acknowledge the news that matters, override the automated calls where you disagree, export the memo. Every parameter has an audit trail.',
  },
]

function RailRow({ k, v, last = false }: { k: string; v: string; last?: boolean }) {
  return (
    <div className={`dn-rail-row ${last ? 'dn-rail-row-last' : ''}`}>
      <span className="dn-rail-k">{k}</span>
      <span className="dn-rail-v">{v}</span>
    </div>
  )
}

function SnippetRow({
  code,
  label,
  detail,
  last = false,
}: {
  code: string
  label: string
  detail: string
  last?: boolean
}) {
  return (
    <div className={`dn-snippet-row ${last ? 'dn-snippet-row-last' : ''}`}>
      <div className="dn-snippet-code">{code}</div>
      <div className="dn-snippet-text">
        <div className="dn-snippet-label">{label}</div>
        <div className="dn-snippet-detail">{detail}</div>
      </div>
    </div>
  )
}

// ─── Auth modal ───────────────────────────────────────────

function genCaptcha(): { a: number; b: number; answer: number } {
  const a = Math.floor(Math.random() * 8) + 2 // 2..9
  const b = Math.floor(Math.random() * 8) + 2
  return { a, b, answer: a + b }
}

function AuthModal({
  mode,
  onClose,
  onSwitch,
}: {
  mode: 'login' | 'signup'
  onClose: () => void
  onSwitch: (m: 'login' | 'signup') => void
}) {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [organization, setOrganization] = useState('')
  const [designation, setDesignation] = useState('')
  const [officialEmail, setOfficialEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Captcha
  const [captcha, setCaptcha] = useState(() => genCaptcha())
  const [captchaInput, setCaptchaInput] = useState('')
  const refreshCaptcha = () => {
    setCaptcha(genCaptcha())
    setCaptchaInput('')
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    // Captcha check — always enforced
    const typed = parseInt(captchaInput.trim(), 10)
    if (!Number.isFinite(typed) || typed !== captcha.answer) {
      setError('Captcha answer is incorrect.')
      refreshCaptcha()
      return
    }
    setLoading(true)
    try {
      if (mode === 'login') {
        const res = await signIn('credentials', {
          username: username.trim(),
          password,
          redirect: false,
        })
        if (res?.error || !res?.ok) {
          setError('Invalid credentials. Please check your username and password.')
          refreshCaptcha()
        } else {
          window.location.href = '/dashboard'
        }
      } else {
        if (password !== confirmPw) {
          setError('Passwords do not match.')
          setLoading(false)
          refreshCaptcha()
          return
        }
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username.trim(),
            email: email.trim(),
            fullName: fullName.trim(),
            phone: phone.trim(),
            organization: organization.trim(),
            designation: designation.trim(),
            officialEmail: officialEmail.trim() || undefined,
            password,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error || 'Signup failed. Try a different username or email.')
          setLoading(false)
          refreshCaptcha()
          return
        }
        const signedIn = await signIn('credentials', {
          username: username.trim(),
          password,
          redirect: false,
        })
        if (signedIn?.ok) {
          window.location.href = '/dashboard'
        } else {
          onSwitch('login')
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unexpected error')
      refreshCaptcha()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="dn-modal-overlay" onClick={onClose}>
      <div className="dn-modal" onClick={(e) => e.stopPropagation()}>
        <button className="dn-modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="dn-modal-brand">
          Deal<span className="dn-brand-accent">Nector</span>
        </div>
        <div className="dn-modal-eyebrow">
          {mode === 'login' ? '— Sign in' : '— Request access'}
        </div>
        <h2 className="dn-modal-title">
          {mode === 'login' ? (
            <>
              Welcome <em>back.</em>
            </>
          ) : (
            <>
              Institutional <em>access.</em>
            </>
          )}
        </h2>

        <form className="dn-modal-form" onSubmit={onSubmit}>
          {mode === 'signup' && (
            <div className="dn-field">
              <label>Full name</label>
              <input
                type="text"
                placeholder="Jane Doe"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                autoComplete="name"
              />
            </div>
          )}
          <div className="dn-field">
            <label>{mode === 'login' ? 'Username or email' : 'Username'}</label>
            <input
              type="text"
              placeholder={mode === 'login' ? 'analyst@firm.com' : 'janedoe'}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </div>
          {mode === 'signup' && (
            <div className="dn-field">
              <label>Email</label>
              <input
                type="email"
                placeholder="jane@firm.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
          )}
          {mode === 'signup' && (
            <div className="dn-field">
              <label>Phone number</label>
              <input
                type="tel"
                placeholder="+91 98xxx xxxxx"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                autoComplete="tel"
              />
            </div>
          )}
          {mode === 'signup' && (
            <div className="dn-two-col-row">
              <div className="dn-field">
                <label>Organization / Company</label>
                <input
                  type="text"
                  placeholder="e.g. Waaree Capital"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  required
                  autoComplete="organization"
                />
              </div>
              <div className="dn-field">
                <label>Designation</label>
                <input
                  type="text"
                  placeholder="e.g. VP · Strategy"
                  value={designation}
                  onChange={(e) => setDesignation(e.target.value)}
                  required
                  autoComplete="organization-title"
                />
              </div>
            </div>
          )}
          {mode === 'signup' && (
            <div className="dn-field">
              <label>
                Official email <span className="dn-field-optional">(optional)</span>
              </label>
              <input
                type="email"
                placeholder="jane@firm.com"
                value={officialEmail}
                onChange={(e) => setOfficialEmail(e.target.value)}
                autoComplete="work email"
              />
            </div>
          )}
          <div className="dn-field">
            <label>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>
          {mode === 'signup' && (
            <div className="dn-field">
              <label>Confirm password</label>
              <input
                type="password"
                placeholder="••••••••"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
                required
                autoComplete="new-password"
              />
            </div>
          )}

          <div className="dn-field dn-captcha-field">
            <label>
              Human check
              <button
                type="button"
                onClick={refreshCaptcha}
                className="dn-captcha-refresh"
                title="Get a new challenge"
              >
                ↻
              </button>
            </label>
            <div className="dn-captcha-row">
              <div className="dn-captcha-q">
                {captcha.a} + {captcha.b} =
              </div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="?"
                value={captchaInput}
                onChange={(e) =>
                  setCaptchaInput(e.target.value.replace(/\D/g, '').slice(0, 3))
                }
                required
                autoComplete="off"
              />
            </div>
          </div>

          {error && <div className="dn-modal-error">{error}</div>}

          <button type="submit" disabled={loading} className="dn-btn-primary dn-btn-full">
            {loading
              ? 'Authenticating…'
              : mode === 'login'
                ? 'Sign in →'
                : 'Request access →'}
          </button>

          <div className="dn-modal-switch">
            {mode === 'login' ? (
              <>
                No account yet?{' '}
                <button type="button" onClick={() => onSwitch('signup')}>
                  Request access
                </button>
              </>
            ) : (
              <>
                Already have access?{' '}
                <button type="button" onClick={() => onSwitch('login')}>
                  Sign in
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Scoped stylesheet ────────────────────────────────────
// All colour values come from CSS variables that are set via React
// inline style on `.dn-landing` based on the active palette + mode.

const LANDING_CSS = `
.dn-landing {
  font-family: 'Inter', 'Manrope', -apple-system, 'Helvetica Neue', Arial, sans-serif;
  background: var(--white);
  color: var(--body);
  min-height: 100vh;
  -webkit-font-smoothing: antialiased;
  font-size: 16px;
  line-height: 1.6;
  letter-spacing: -0.003em;
  overflow-x: hidden;
  font-feature-settings: 'kern', 'liga', 'cv11';
  transition: background-color .25s ease, color .25s ease;
}
.dn-landing * { box-sizing: border-box; }
.dn-landing h1, .dn-landing h2, .dn-landing h3, .dn-landing h4 {
  font-family: 'Newsreader', 'Source Serif 4', Georgia, serif;
  font-weight: 600;
  color: var(--ink);
  margin: 0;
  letter-spacing: -0.022em;
}
.dn-landing em { font-style: italic; color: var(--accent); }
.dn-landing p { margin: 0; }
.dn-landing a { color: inherit; text-decoration: none; }
.dn-landing ::selection { background: var(--accent-bg); color: var(--ink); }
.dn-landing button { font-family: inherit; cursor: pointer; }

/* THEME BAR */
.dn-theme-bar {
  background: var(--cream);
  border-bottom: 1px solid var(--rule);
  padding: 8px 0;
}
.dn-theme-bar-inner {
  max-width: 1320px;
  margin: 0 auto;
  padding: 0 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 28px;
}
.dn-theme-left {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 600;
  flex-wrap: wrap;
}
.dn-theme-label { color: var(--ink); }
.dn-theme-swatches { display: flex; gap: 6px; align-items: center; }
.dn-swatch {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 1px solid var(--rule-strong);
  cursor: pointer;
  padding: 0;
  transition: transform .12s ease, box-shadow .12s ease;
}
.dn-swatch:hover { transform: scale(1.12); }
.dn-swatch-active {
  transform: scale(1.15);
  box-shadow: 0 0 0 2px var(--cream), 0 0 0 3px var(--ink);
}
.dn-theme-name {
  font-size: 10px;
  color: var(--muted-2);
  font-weight: 500;
  letter-spacing: 0.12em;
}
.dn-mode-toggle {
  background: transparent;
  border: 1px solid var(--rule);
  color: var(--ink);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 5px 12px;
  font-family: inherit;
  transition: all .15s ease;
}
.dn-mode-toggle:hover {
  background: var(--ink);
  color: var(--white);
  border-color: var(--ink);
}

/* NAV */
.dn-nav {
  position: sticky;
  top: 0;
  z-index: 50;
  background: color-mix(in srgb, var(--white) 96%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border-bottom: 1px solid var(--rule);
}
.dn-nav-inner {
  max-width: 1320px;
  margin: 0 auto;
  padding: 18px 40px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
}
.dn-brand {
  font-family: 'Newsreader', 'Source Serif 4', Georgia, serif;
  font-size: 23px;
  font-weight: 700;
  color: var(--ink);
  letter-spacing: -0.025em;
}
.dn-brand-accent { color: var(--accent); font-style: italic; }
.dn-nav-links {
  display: none;
  gap: 30px;
  align-items: center;
}
@media (min-width: 960px) { .dn-nav-links { display: flex; } }
.dn-nav-links a {
  font-size: 12px;
  letter-spacing: 0.04em;
  color: var(--body-soft);
  font-weight: 500;
  transition: color .15s;
  position: relative;
  padding: 4px 0;
}
.dn-nav-links a::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  width: 0;
  height: 1px;
  background: var(--accent);
  transition: width .2s ease;
}
.dn-nav-links a:hover { color: var(--ink); }
.dn-nav-links a:hover::after { width: 100%; }
.dn-nav-cta { display: flex; align-items: center; gap: 8px; }

/* BUTTONS */
.dn-btn-ghost, .dn-btn-primary, .dn-btn-outline {
  font-size: 12.5px;
  letter-spacing: 0.01em;
  font-weight: 600;
  padding: 10px 18px;
  border-radius: 0;
  border: 1px solid transparent;
  transition: all .18s ease;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: inherit;
}
.dn-btn-ghost { background: transparent; color: var(--ink); }
.dn-btn-ghost:hover { color: var(--accent); }
.dn-btn-primary {
  background: var(--accent);
  color: var(--white);
  border-color: var(--accent);
}
.dn-btn-primary:hover {
  background: var(--accent-soft);
  border-color: var(--accent-soft);
}
.dn-btn-outline {
  background: transparent;
  color: var(--ink);
  border-color: var(--ink);
}
.dn-btn-outline:hover {
  background: var(--ink);
  color: var(--white);
}
.dn-btn-lg { padding: 15px 28px; font-size: 13px; }
.dn-btn-full { width: 100%; padding: 13px; }

/* EYEBROW + NUM TAG */
.dn-eyebrow {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent);
  display: inline-block;
}
.dn-eyebrow-dark { color: var(--accent-soft); }
.dn-num-tag {
  font-family: 'Newsreader', serif;
  font-size: 13px;
  font-weight: 600;
  font-style: italic;
  color: var(--accent);
}
.dn-num-tag-dark { color: var(--accent-soft); }
.dn-rule {
  flex: 0 0 46px;
  height: 1px;
  background: var(--accent);
}
.dn-rule-dark { background: var(--accent-soft); }
.dn-section-head-meta {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 28px;
}
.dn-section-head-meta-left { justify-content: flex-start; }
.dn-section-head-meta-center { justify-content: center; }

/* MARQUEE / STRATEGIC STATEMENTS */
.dn-marquee {
  background: var(--navy);
  color: color-mix(in srgb, var(--white) 84%, var(--accent) 16%);
  border-bottom: 1px solid color-mix(in srgb, var(--white) 12%, transparent);
}
.dn-marquee-inner {
  max-width: 1320px;
  margin: 0 auto;
  padding: 12px 40px;
  display: flex;
  align-items: center;
  gap: 28px;
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  overflow-x: auto;
}
.dn-marquee-inner::-webkit-scrollbar { display: none; }
.dn-marquee-kicker {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--accent-soft);
  font-weight: 700;
  flex-shrink: 0;
}
.dn-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent-soft);
  box-shadow: 0 0 8px color-mix(in srgb, var(--accent-soft) 60%, transparent);
  animation: dnDot 1.8s ease-in-out infinite;
}
@keyframes dnDot { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
.dn-marquee-items {
  display: flex;
  align-items: center;
  gap: 22px;
  color: color-mix(in srgb, var(--white) 72%, transparent);
  font-weight: 500;
}
.dn-marquee-items .dn-sep {
  width: 1px;
  height: 10px;
  background: color-mix(in srgb, var(--white) 22%, transparent);
}

/* HERO */
.dn-hero {
  position: relative;
  background: var(--white);
  padding: 100px 40px 140px;
  overflow: hidden;
  border-bottom: 1px solid var(--rule);
}
.dn-hero-grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(color-mix(in srgb, var(--ink) 5%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--ink) 5%, transparent) 1px, transparent 1px);
  background-size: 68px 68px;
  background-position: -1px -1px;
  pointer-events: none;
  mask-image: radial-gradient(ellipse 90% 70% at 30% 40%, #000 30%, transparent 75%);
  -webkit-mask-image: radial-gradient(ellipse 90% 70% at 30% 40%, #000 30%, transparent 75%);
}
.dn-hero-inner {
  position: relative;
  max-width: 1320px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr;
  gap: 72px;
  align-items: start;
}
@media (min-width: 1024px) {
  .dn-hero-inner { grid-template-columns: 7fr 4fr; }
}
.dn-hero-left { max-width: 840px; }
.dn-hero-eyebrow {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 36px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
}
.dn-hero-eyebrow .dn-rule { flex: 0 0 52px; }
.dn-hero-title {
  font-size: clamp(3rem, 6.8vw, 5.6rem);
  line-height: 1.02;
  margin-bottom: 36px;
}
.dn-hero-lede {
  font-size: 19px;
  line-height: 1.6;
  color: var(--body-soft);
  max-width: 680px;
  margin-bottom: 44px;
}
.dn-hero-cta { display: flex; gap: 12px; flex-wrap: wrap; }
.dn-hero-cta-center { justify-content: center; }

/* HERO RAIL */
.dn-hero-rail {
  background: var(--snippet-bg);
  border: 1px solid var(--rule);
  position: relative;
}
.dn-hero-rail::before {
  content: '';
  position: absolute;
  top: -1px; left: -1px;
  width: 44px;
  height: 3px;
  background: var(--accent);
}
.dn-rail-head {
  padding: 22px 26px 16px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
}
.dn-rail-rows { padding: 6px 26px; }
.dn-rail-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 14px 0;
  border-bottom: 1px solid var(--rule-soft);
}
.dn-rail-row-last { border-bottom: none; }
.dn-rail-k {
  font-size: 11.5px;
  letter-spacing: 0.02em;
  color: var(--muted);
  text-transform: uppercase;
  font-weight: 600;
}
.dn-rail-v {
  font-family: 'Newsreader', serif;
  font-size: 22px;
  font-weight: 600;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.dn-rail-foot {
  padding: 18px 26px 22px;
  border-top: 1px solid var(--rule);
  background: var(--cream);
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.55;
  font-style: italic;
}

/* PULL QUOTE */
.dn-quote-strip {
  background: var(--cream);
  padding: 90px 40px;
  border-bottom: 1px solid var(--rule);
  text-align: center;
}
.dn-quote-inner {
  max-width: 880px;
  margin: 0 auto;
  position: relative;
}
.dn-quote-mark {
  position: absolute;
  top: -46px;
  left: -26px;
  font-family: 'Newsreader', serif;
  font-size: 120px;
  line-height: 1;
  color: var(--accent-dim);
  user-select: none;
}
.dn-quote-text {
  font-family: 'Newsreader', serif;
  font-size: clamp(2rem, 3.6vw, 2.8rem);
  line-height: 1.25;
  color: var(--ink);
  font-weight: 500;
  letter-spacing: -0.018em;
  margin-bottom: 20px;
  position: relative;
}
.dn-quote-text em { font-style: italic; color: var(--accent); }
.dn-quote-attr {
  font-size: 12px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
  font-weight: 600;
}

/* SECTIONS */
.dn-section {
  padding: 140px 40px;
  background: var(--white);
  border-bottom: 1px solid var(--rule);
}
.dn-section-cream { background: var(--cream); }
.dn-section-navy {
  background: var(--navy);
  border-bottom: none;
  color: color-mix(in srgb, var(--white) 82%, transparent);
}
.dn-section-inner { max-width: 1320px; margin: 0 auto; }
.dn-section-head { max-width: 820px; margin-bottom: 80px; }
.dn-section-head-centered {
  max-width: 820px;
  margin: 0 auto 80px;
  text-align: center;
}
.dn-section-head-centered .dn-section-lede { margin: 0 auto; }
.dn-h2 {
  font-size: clamp(2.2rem, 4.6vw, 3.4rem);
  line-height: 1.08;
  margin-bottom: 22px;
}
.dn-h2-light { color: var(--white); }
.dn-section-lede {
  font-size: 18px;
  line-height: 1.65;
  color: var(--muted);
  max-width: 680px;
}
.dn-section-lede-light { color: color-mix(in srgb, var(--white) 72%, transparent); }

/* SERVICES / DISCIPLINES */
.dn-services {
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--rule);
}
.dn-service {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
  padding: 44px 0;
  border-bottom: 1px solid var(--rule);
  transition: background-color .2s ease;
}
@media (min-width: 960px) {
  .dn-service {
    grid-template-columns: 280px 1fr;
    gap: 40px;
    padding: 56px 0;
  }
}
.dn-service:hover .dn-service-num { color: var(--accent); }
.dn-service-index {
  display: flex;
  align-items: baseline;
  gap: 16px;
}
@media (min-width: 960px) {
  .dn-service-index { flex-direction: column; align-items: flex-start; gap: 10px; }
}
.dn-service-num {
  font-family: 'Newsreader', serif;
  font-size: 72px;
  font-weight: 500;
  color: var(--ink);
  line-height: 0.9;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  transition: color .2s ease;
}
@media (min-width: 960px) { .dn-service-num { font-size: 96px; } }
.dn-service-kicker {
  font-size: 10.5px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}
.dn-service-body { max-width: 720px; }
.dn-service-title {
  font-size: clamp(1.6rem, 2.6vw, 2.1rem);
  line-height: 1.15;
  margin-bottom: 14px;
}
.dn-service-lede {
  font-family: 'Newsreader', serif;
  font-size: 19px;
  line-height: 1.5;
  color: var(--body);
  font-style: italic;
  margin-bottom: 22px;
  max-width: 640px;
}
.dn-service-bullets {
  list-style: none;
  padding: 0;
  margin: 0;
}
.dn-service-bullets li {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 10px 0;
  font-size: 14px;
  color: var(--body-soft);
  line-height: 1.55;
  border-top: 1px solid var(--rule-soft);
}
.dn-service-bullets li:first-child { border-top: none; padding-top: 4px; }
.dn-service-bullets li::before {
  content: '';
  flex: 0 0 12px;
  height: 1px;
  background: var(--accent);
  margin-top: 11px;
}

/* FRAMEWORKS */
.dn-frameworks {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1px;
  background: var(--rule);
  border: 1px solid var(--rule);
}
@media (min-width: 720px) { .dn-frameworks { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1080px) { .dn-frameworks { grid-template-columns: repeat(3, 1fr); } }
.dn-framework {
  background: var(--white);
  padding: 36px 32px;
  transition: background-color .2s ease;
}
.dn-framework:hover { background: var(--cream); }
.dn-framework-num {
  font-family: 'Newsreader', serif;
  font-size: 13px;
  font-style: italic;
  color: var(--accent);
  margin-bottom: 12px;
}
.dn-framework-title {
  font-family: 'Newsreader', serif;
  font-size: 22px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: -0.015em;
  margin-bottom: 4px;
}
.dn-framework-sub {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 18px;
}
.dn-framework-body {
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--muted);
}

/* MULTI-INDUSTRY COVERAGE */
.dn-coverage-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 1px;
  background: var(--rule);
  border: 1px solid var(--rule);
}
@media (min-width: 720px) { .dn-coverage-grid { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1080px) { .dn-coverage-grid { grid-template-columns: repeat(4, 1fr); } }
.dn-coverage-tile {
  background: var(--snippet-bg);
  padding: 28px 26px;
  position: relative;
  transition: background-color .2s ease;
}
.dn-coverage-tile:hover { background: var(--cream); }
.dn-coverage-live {
  background: var(--white);
}
.dn-coverage-live::before {
  content: '';
  position: absolute;
  top: 0; left: 0;
  width: 40px;
  height: 3px;
  background: var(--accent);
}
.dn-coverage-state {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--muted-2);
  margin-bottom: 14px;
}
.dn-coverage-live .dn-coverage-state { color: var(--accent); }
.dn-coverage-title {
  font-family: 'Newsreader', serif;
  font-size: 19px;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 8px;
  letter-spacing: -0.012em;
}
.dn-coverage-body {
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--muted);
}

/* CASE EXAMPLES */
.dn-case {
  margin-top: 60px;
  padding-top: 60px;
  border-top: 1px solid var(--rule);
}
.dn-case:first-of-type { margin-top: 40px; border-top: none; padding-top: 0; }
.dn-case-offset { margin-top: 100px; }
.dn-case-tag {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 36px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
}
.dn-case-rule {
  flex: 0 0 52px;
  height: 1px;
  background: var(--accent);
}
.dn-case-kicker {
  color: var(--muted);
  font-weight: 600;
}
.dn-case-title {
  font-size: clamp(1.8rem, 3vw, 2.4rem);
  line-height: 1.12;
  margin-bottom: 22px;
}

/* SPLIT */
.dn-split {
  display: grid;
  grid-template-columns: 1fr;
  gap: 64px;
  align-items: start;
}
@media (min-width: 1024px) {
  .dn-split { grid-template-columns: 7fr 5fr; gap: 88px; }
  .dn-split-reverse .dn-split-left { order: 2; }
  .dn-split-reverse .dn-split-right { order: 1; }
}
.dn-split-left, .dn-split-right { min-width: 0; }

.dn-key-list {
  list-style: none;
  margin: 36px 0 0;
  padding: 0;
  border-top: 1px solid var(--rule);
}
.dn-key-list li {
  padding: 18px 0;
  border-bottom: 1px solid var(--rule-soft);
  font-size: 14px;
  color: var(--muted);
  line-height: 1.55;
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 20px;
  align-items: baseline;
}
@media (max-width: 720px) {
  .dn-key-list li { grid-template-columns: 1fr; gap: 4px; }
}
.dn-key-list li strong {
  color: var(--ink);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.01em;
  text-transform: uppercase;
}
.dn-key-list-light { border-top-color: color-mix(in srgb, var(--white) 16%, transparent); }
.dn-key-list-light li {
  border-bottom-color: color-mix(in srgb, var(--white) 10%, transparent);
  color: color-mix(in srgb, var(--white) 72%, transparent);
}
.dn-key-list-light li strong { color: var(--white); }

/* SNIPPET */
.dn-snippet {
  background: var(--snippet-bg);
  border: 1px solid var(--rule);
  position: relative;
}
.dn-snippet::before {
  content: '';
  position: absolute;
  top: -1px; left: -1px;
  width: 52px;
  height: 3px;
  background: var(--accent);
}
.dn-snippet-head {
  padding: 24px 26px 16px;
  border-bottom: 1px solid var(--rule);
}
.dn-snippet-tag {
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--ink);
}
.dn-tag-orange { color: var(--accent); }
.dn-snippet-row {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 16px;
  padding: 18px 26px;
  border-bottom: 1px solid var(--rule-soft);
  align-items: baseline;
}
.dn-snippet-row-last { border-bottom: 1px solid var(--rule); }
.dn-snippet-code {
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: var(--accent);
  padding-top: 2px;
}
.dn-snippet-label {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 3px;
}
.dn-snippet-detail {
  font-size: 12.5px;
  color: var(--muted);
  line-height: 1.5;
}
.dn-snippet-foot {
  padding: 18px 26px 22px;
  font-size: 11.5px;
  color: var(--muted);
  line-height: 1.55;
  font-style: italic;
  background: var(--cream);
}

/* IMPACT CARD */
.dn-impact-card {
  background: color-mix(in srgb, var(--white) 3%, transparent);
  border: 1px solid color-mix(in srgb, var(--white) 14%, transparent);
  padding: 32px;
  position: relative;
}
.dn-impact-card::before {
  content: '';
  position: absolute;
  top: -1px; left: -1px;
  width: 52px;
  height: 3px;
  background: var(--accent-soft);
}
.dn-impact-head {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent-soft);
  margin-bottom: 24px;
}
.dn-impact-panel { padding: 6px 0; }
.dn-impact-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 12px 0;
}
.dn-impact-label {
  font-size: 11.5px;
  color: color-mix(in srgb, var(--white) 60%, transparent);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  font-weight: 600;
}
.dn-impact-value {
  font-family: 'Newsreader', serif;
  font-size: 28px;
  font-weight: 600;
  color: var(--white);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.015em;
}
.dn-impact-orange { color: var(--accent-soft); }
.dn-impact-arrow {
  font-size: 9.5px;
  color: color-mix(in srgb, var(--white) 38%, transparent);
  text-align: right;
  padding: 2px 0;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  font-weight: 600;
}
.dn-impact-divider {
  height: 1px;
  background: color-mix(in srgb, var(--white) 14%, transparent);
  margin: 18px 0;
}
.dn-impact-footnote {
  margin-top: 24px;
  font-size: 11.5px;
  color: color-mix(in srgb, var(--white) 50%, transparent);
  line-height: 1.55;
  padding-top: 20px;
  border-top: 1px solid color-mix(in srgb, var(--white) 10%, transparent);
  font-style: italic;
}

/* PILLARS */
.dn-pillars { display: flex; flex-direction: column; }
.dn-pillar {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 32px;
  align-items: baseline;
  padding: 34px 0;
}
.dn-pillar-step {
  font-family: 'Newsreader', serif;
  font-size: 38px;
  font-weight: 600;
  color: var(--accent);
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.dn-pillar-content { max-width: 780px; }
.dn-pillar-title {
  font-size: 24px;
  color: var(--ink);
  margin-bottom: 12px;
  line-height: 1.2;
}
.dn-pillar-body {
  font-size: 15px;
  line-height: 1.65;
  color: var(--muted);
}
.dn-pillar-divider {
  height: 1px;
  background: var(--rule);
}

/* CTA */
.dn-cta {
  background: var(--cream);
  padding: 160px 40px;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  text-align: center;
}
.dn-cta-inner { max-width: 820px; margin: 0 auto; }
.dn-cta-inner .dn-eyebrow { display: block; margin-bottom: 22px; }
.dn-cta-inner .dn-section-lede { margin: 0 auto 40px; }

/* FOOTER */
.dn-footer {
  background: var(--navy);
  color: color-mix(in srgb, var(--white) 65%, transparent);
  padding: 80px 40px 44px;
}
.dn-footer-inner { max-width: 1320px; margin: 0 auto; }
.dn-footer-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 48px;
  margin-bottom: 56px;
  padding-bottom: 56px;
  border-bottom: 1px solid color-mix(in srgb, var(--white) 12%, transparent);
}
@media (min-width: 720px) {
  .dn-footer-grid { grid-template-columns: 2fr 1fr 1fr; }
}
.dn-footer-brand { max-width: 440px; }
.dn-footer-brand .dn-brand { color: var(--white); margin-bottom: 20px; font-size: 26px; }
.dn-footer-brand .dn-brand-accent { color: var(--accent-soft); }
.dn-footer-blurb {
  font-size: 14px;
  line-height: 1.7;
  color: color-mix(in srgb, var(--white) 60%, transparent);
}
.dn-footer-heading {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent-soft);
  margin-bottom: 20px;
}
.dn-footer-links { display: flex; flex-direction: column; gap: 12px; }
.dn-footer-links a,
.dn-footer-links button {
  font-size: 13px;
  color: color-mix(in srgb, var(--white) 68%, transparent);
  transition: color .15s;
  background: none;
  border: none;
  padding: 0;
  text-align: left;
  font-family: inherit;
  cursor: pointer;
}
.dn-footer-links a:hover,
.dn-footer-links button:hover { color: var(--accent-soft); }
.dn-footer-bottom {
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--white) 40%, transparent);
  font-family: 'JetBrains Mono', 'SF Mono', monospace;
}
@media (min-width: 720px) {
  .dn-footer-bottom {
    flex-direction: row;
    justify-content: space-between;
    align-items: center;
  }
}

/* MODAL */
/* ─────────────────────────────────────────────────────
   AUTH MODAL — solid dark surface (overrides the light
   palette) with clearly highlighted borders on every
   field and a gold glow on the primary button. The modal
   keeps the site's accent tokens, but pins its own
   local ink + surface colours to the DealNector navy so
   the dialog reads the same in every theme preset.
   ───────────────────────────────────────────────────── */
.dn-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(4, 8, 20, 0.86);
  backdrop-filter: blur(10px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
  font-family: 'Inter', sans-serif;
  color: #E8EDF5;
  --m-surface: #0D1424;
  --m-surface-2: #121B31;
  --m-surface-3: #182443;
  --m-border: #25324F;
  --m-border-soft: #1A2338;
  --m-border-strong: #3A4D7A;
  --m-text: #E8EDF5;
  --m-text-2: #9AAFC8;
  --m-text-3: #7388A6;
  --m-gold: #F7B731;
  --m-gold-dim: rgba(247, 183, 49, 0.12);
  --m-red: #EF4444;
  --m-red-dim: rgba(239, 68, 68, 0.12);
}
.dn-modal {
  background: var(--m-surface);
  border: 1px solid var(--m-border);
  border-top: 3px solid var(--m-gold);
  border-radius: 10px;
  padding: 36px 38px 30px;
  width: 100%;
  max-width: 500px;
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  position: relative;
  box-shadow:
    0 24px 60px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(247, 183, 49, 0.08),
    0 0 60px rgba(247, 183, 49, 0.06);
}
.dn-modal::-webkit-scrollbar { width: 6px; }
.dn-modal::-webkit-scrollbar-track { background: transparent; }
.dn-modal::-webkit-scrollbar-thumb { background: var(--m-border-strong); border-radius: 3px; }
.dn-modal-close {
  position: absolute;
  top: 14px; right: 14px;
  width: 30px; height: 30px;
  border: 1.5px solid var(--m-border-strong);
  border-radius: 5px;
  background: var(--m-surface-2);
  color: var(--m-text-2);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  transition: all .15s;
}
.dn-modal-close:hover {
  color: var(--m-gold);
  border-color: var(--m-gold);
  background: var(--m-gold-dim);
}
.dn-modal-brand {
  font-family: 'Newsreader', serif;
  font-size: 20px;
  font-weight: 700;
  color: var(--m-text);
  letter-spacing: -0.025em;
  margin-bottom: 4px;
}
.dn-modal-brand .dn-brand-accent {
  color: var(--m-gold);
  font-style: italic;
}
.dn-modal-eyebrow {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--m-gold);
  margin-bottom: 12px;
}
.dn-modal-title {
  font-family: 'Newsreader', serif;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.022em;
  line-height: 1.12;
  margin: 0 0 22px;
  color: var(--m-text);
}
.dn-modal-title em { font-style: italic; color: var(--m-gold); }
.dn-modal-form { display: flex; flex-direction: column; gap: 13px; }
.dn-field { display: flex; flex-direction: column; gap: 5px; }
.dn-field label {
  font-size: 9.5px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  color: var(--m-text-3);
  font-weight: 700;
}
.dn-field label .dn-field-optional {
  text-transform: none;
  letter-spacing: 0.02em;
  color: var(--m-text-3);
  font-weight: 500;
  font-size: 10px;
  margin-left: 4px;
  font-style: italic;
}
.dn-field input {
  background: var(--m-surface-2);
  border: 1.5px solid var(--m-border-strong);
  border-radius: 6px;
  color: var(--m-text);
  padding: 11px 13px;
  font-family: inherit;
  font-size: 13px;
  outline: none;
  transition: border-color .15s, box-shadow .15s, background .15s;
}
.dn-field input::placeholder { color: var(--m-text-3); }
.dn-field input:hover {
  border-color: #4A5E8B;
  background: var(--m-surface-3);
}
.dn-field input:focus {
  border-color: var(--m-gold);
  background: var(--m-surface-3);
  box-shadow: 0 0 0 3px rgba(247, 183, 49, 0.18);
}
.dn-two-col-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
@media (max-width: 520px) {
  .dn-two-col-row { grid-template-columns: 1fr; }
}
.dn-modal-error {
  background: var(--m-red-dim);
  border: 1.5px solid var(--m-red);
  border-radius: 6px;
  color: var(--m-red);
  padding: 10px 13px;
  font-size: 12px;
  font-weight: 600;
}
.dn-modal-switch {
  text-align: center;
  margin-top: 8px;
  font-size: 12px;
  color: var(--m-text-3);
}
.dn-modal-switch button {
  background: none;
  border: none;
  color: var(--m-gold);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  cursor: pointer;
  padding: 0 0 0 4px;
}
.dn-modal-switch button:hover { text-decoration: underline; }
/* Primary button inside the dark modal — thicker border + gold glow */
.dn-modal .dn-btn-primary,
.dn-modal .dn-btn-full {
  background: linear-gradient(180deg, #F7B731 0%, #E6A523 100%);
  color: #0A2340;
  border: 1.5px solid #F7B731;
  box-shadow: 0 0 0 0 rgba(247, 183, 49, 0);
  transition: box-shadow .2s, transform .05s;
}
.dn-modal .dn-btn-primary:hover,
.dn-modal .dn-btn-full:hover {
  box-shadow: 0 0 0 3px rgba(247, 183, 49, 0.25);
}
.dn-modal .dn-btn-primary:active,
.dn-modal .dn-btn-full:active { transform: translateY(1px); }
.dn-modal .dn-btn-full:disabled { opacity: 0.55; cursor: wait; }

/* CAPTCHA — clearly outlined challenge block so the user knows
   exactly where to type their answer. Uses a dashed accent border
   to differentiate it from normal text fields. */
.dn-captcha-field {
  background: color-mix(in srgb, var(--accent) 5%, var(--cream));
  border: 1.5px dashed color-mix(in srgb, var(--accent) 55%, var(--rule-strong));
  border-radius: 8px;
  padding: 12px 14px 14px;
  gap: 10px;
}
/* Captcha inside the dark modal — override the light-palette
   defaults so borders remain visible against the navy surface. */
.dn-modal .dn-captcha-field {
  background: rgba(247, 183, 49, 0.05);
  border: 1.5px dashed rgba(247, 183, 49, 0.55);
}
.dn-modal .dn-captcha-field label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--m-gold);
  font-weight: 700;
}
.dn-modal .dn-captcha-refresh {
  background: var(--m-surface-2);
  border: 1px solid var(--m-gold);
  border-radius: 50%;
  color: var(--m-gold);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dn-modal .dn-captcha-refresh:hover {
  transform: rotate(90deg);
  transition: transform .2s ease;
}
.dn-modal .dn-captcha-row {
  display: grid;
  grid-template-columns: 1fr 110px;
  gap: 10px;
  align-items: center;
}
.dn-modal .dn-captcha-q {
  background: var(--m-surface-3);
  border: 1.5px solid var(--m-border-strong);
  border-radius: 6px;
  padding: 11px 14px;
  font-family: 'Newsreader', 'Source Serif 4', Georgia, serif;
  font-size: 20px;
  font-weight: 700;
  color: var(--m-text);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.04em;
  text-align: center;
  user-select: none;
}
.dn-modal .dn-captcha-row input {
  text-align: center;
  font-family: 'Newsreader', 'Source Serif 4', Georgia, serif;
  font-size: 20px;
  font-weight: 700;
  border-width: 1.5px;
  border-color: var(--m-gold);
  background: var(--m-surface-3);
  color: var(--m-text);
}
.dn-modal .dn-captcha-row input::placeholder {
  font-weight: 400;
  font-size: 16px;
  color: var(--m-text-3);
}

/* ─────────────────────────────────────────────────────
   HERO FLICKER BACKDROP
   The FlickeringGrid canvas sits absolutely behind the
   hero's content column. It inherits the accent colour
   from the active palette so every theme looks coherent.
   ───────────────────────────────────────────────────── */
.dn-hero-flicker {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  mask-image: radial-gradient(1200px circle at 50% 35%, #000 20%, transparent 72%);
  -webkit-mask-image: radial-gradient(1200px circle at 50% 35%, #000 20%, transparent 72%);
}
.dn-hero-flicker-grid {
  position: absolute;
  inset: 0;
}
.dn-hero-inner { position: relative; z-index: 1; }
.dn-hero-grid-bg { z-index: 0; }

/* ─────────────────────────────────────────────────────
   FEATURES SECTION
   Dhan-style carousel+glow treatment but using the
   DealNector palette tokens so every theme preset and
   light/dark switch remains coherent.
   ───────────────────────────────────────────────────── */
.dn-features-section {
  position: relative;
  overflow: hidden;
}
.dn-features-glow {
  position: absolute;
  border-radius: 999px;
  filter: blur(110px);
  opacity: 0.55;
  pointer-events: none;
  z-index: 0;
  animation: dn-glow-float 14s ease-in-out infinite;
}
.dn-features-glow-a {
  width: 520px; height: 520px;
  top: -180px; left: -140px;
  background: radial-gradient(circle, color-mix(in srgb, var(--accent) 55%, transparent) 0%, transparent 70%);
}
.dn-features-glow-b {
  width: 480px; height: 480px;
  bottom: -160px; right: -120px;
  background: radial-gradient(circle, color-mix(in srgb, var(--accent) 40%, transparent) 0%, transparent 70%);
  animation-delay: -7s;
}
.dn-features-section .dn-section-inner { position: relative; z-index: 1; }

/* Animated loader bar — single strip across the section. */
.dn-features-loader {
  position: relative;
  height: 2px;
  margin: 28px 0 34px;
  background: color-mix(in srgb, var(--rule-strong) 70%, transparent);
  overflow: hidden;
  border-radius: 2px;
}
.dn-features-loader-fill {
  position: absolute;
  top: 0;
  left: -35%;
  width: 35%;
  height: 100%;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  animation: dn-loader-slide 3.2s linear infinite;
}

/* Feature card grid */
.dn-feature-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 18px;
  margin-top: 4px;
}
@media (min-width: 720px) {
  .dn-feature-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 1080px) {
  .dn-feature-grid { grid-template-columns: repeat(3, 1fr); }
}

.dn-feature-card {
  position: relative;
  background: var(--white);
  border: 1px solid var(--rule-strong);
  border-radius: 10px;
  padding: 22px 22px 20px;
  overflow: hidden;
  cursor: default;
  opacity: 0;
  transform: translateY(18px);
  animation: dn-feature-in 0.7s ease-out forwards;
  transition:
    transform 0.35s ease,
    border-color 0.3s ease,
    box-shadow 0.3s ease,
    background 0.3s ease;
  display: flex;
  flex-direction: column;
  min-height: 220px;
}
.dn-feature-card:hover {
  transform: translateY(-4px) scale(1.015);
  border-color: var(--accent);
  box-shadow:
    0 18px 44px color-mix(in srgb, var(--accent) 22%, transparent),
    0 0 0 1px color-mix(in srgb, var(--accent) 50%, transparent);
}
.dn-feature-card-sheen {
  position: absolute;
  top: -40%;
  left: -40%;
  width: 60%;
  height: 180%;
  background: linear-gradient(
    110deg,
    transparent 25%,
    color-mix(in srgb, var(--accent) 10%, transparent) 50%,
    transparent 75%
  );
  transform: translateX(-100%);
  transition: transform 0.9s ease;
  pointer-events: none;
}
.dn-feature-card:hover .dn-feature-card-sheen {
  transform: translateX(260%);
}
.dn-feature-card-index {
  font-family: 'Source Serif 4', 'Newsreader', serif;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.3em;
  color: color-mix(in srgb, var(--accent) 80%, var(--muted));
  margin-bottom: 10px;
}
.dn-feature-card-icon {
  font-size: 30px;
  line-height: 1;
  color: var(--accent);
  margin-bottom: 12px;
  font-family: 'Newsreader', 'Source Serif 4', Georgia, serif;
  font-weight: 400;
  transition: transform 0.4s ease;
}
.dn-feature-card:hover .dn-feature-card-icon {
  transform: rotate(-6deg) scale(1.08);
}
.dn-feature-card-title {
  font-family: 'Newsreader', 'Source Serif 4', Georgia, serif;
  font-size: 18px;
  font-weight: 600;
  color: var(--ink);
  margin: 0 0 8px;
  letter-spacing: -0.012em;
  line-height: 1.25;
}
.dn-feature-card-body {
  font-size: 12.5px;
  color: var(--body-soft);
  line-height: 1.55;
  margin: 0 0 14px;
  flex: 1;
}
.dn-feature-card-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.dn-feature-tag {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--accent) 80%, var(--muted));
  background: color-mix(in srgb, var(--accent) 8%, var(--cream));
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--rule-strong));
  padding: 3px 8px;
  border-radius: 999px;
}
.dn-feature-card-cta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--accent);
}
.dn-feature-card-arrow {
  display: inline-block;
  transition: transform 0.3s ease;
}
.dn-feature-card:hover .dn-feature-card-arrow {
  transform: translateX(5px);
}

/* Always-on scrolling ticker */
.dn-feature-ticker {
  margin-top: 36px;
  padding: 14px 0;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  overflow: hidden;
  position: relative;
}
.dn-feature-ticker::before,
.dn-feature-ticker::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 80px;
  z-index: 2;
  pointer-events: none;
}
.dn-feature-ticker::before {
  left: 0;
  background: linear-gradient(90deg, var(--white), transparent);
}
.dn-feature-ticker::after {
  right: 0;
  background: linear-gradient(-90deg, var(--white), transparent);
}
.dn-feature-ticker-track {
  display: flex;
  gap: 48px;
  width: max-content;
  animation: dn-ticker-scroll 40s linear infinite;
  white-space: nowrap;
}
.dn-feature-ticker-item {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.dn-feature-ticker-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 25%, transparent);
}

/* Keyframes */
@keyframes dn-feature-in {
  0% { opacity: 0; transform: translateY(18px); }
  100% { opacity: 1; transform: translateY(0); }
}
@keyframes dn-loader-slide {
  0% { left: -35%; }
  100% { left: 100%; }
}
@keyframes dn-ticker-scroll {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
@keyframes dn-glow-float {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(30px, -20px) scale(1.06); }
}

/* ─────────────────────────────────────────────────────
   GUIDED WALKTHROUGH
   ───────────────────────────────────────────────────── */
.dn-walkthrough {
  background: var(--white);
  border: 1px solid var(--rule-strong);
  border-radius: 12px;
  padding: 0;
  overflow: hidden;
  box-shadow: 0 20px 60px color-mix(in srgb, var(--navy) 8%, transparent);
  margin-top: 24px;
}
.dn-walk-progress {
  height: 3px;
  background: color-mix(in srgb, var(--rule-strong) 70%, transparent);
  position: relative;
  overflow: hidden;
}
.dn-walk-progress-fill {
  position: absolute;
  inset: 0 auto 0 0;
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 65%, transparent));
  transition: width 0.08s linear;
}
.dn-walk-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0;
}
@media (min-width: 960px) {
  .dn-walk-grid { grid-template-columns: 0.95fr 1fr; }
}
.dn-walk-left {
  padding: 32px 30px 26px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dn-walk-eyebrow {
  font-size: 9.5px;
  font-weight: 700;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
}
.dn-walk-title {
  font-family: 'Newsreader', 'Source Serif 4', Georgia, serif;
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.018em;
  line-height: 1.12;
  color: var(--ink);
  margin: 0;
}
.dn-walk-body {
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--body-soft);
  margin: 0;
  max-width: 44ch;
}
.dn-walk-tip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 600;
  color: color-mix(in srgb, var(--accent) 80%, var(--muted));
  background: color-mix(in srgb, var(--accent) 7%, var(--cream));
  border: 1px dashed color-mix(in srgb, var(--accent) 45%, var(--rule-strong));
  padding: 8px 12px;
  border-radius: 6px;
  font-family: 'JetBrains Mono', Menlo, monospace;
  align-self: flex-start;
}
.dn-walk-tip-arrow {
  color: var(--accent);
  font-weight: 700;
}
.dn-walk-nav {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
}
.dn-walk-arrow {
  width: 32px;
  height: 32px;
  border: 1px solid var(--rule-strong);
  background: var(--white);
  color: var(--muted);
  border-radius: 6px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
}
.dn-walk-arrow:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--white));
}
.dn-walk-dots {
  display: flex;
  gap: 6px;
  flex: 1;
}
.dn-walk-dot {
  flex: 1;
  padding: 6px 0;
  background: color-mix(in srgb, var(--rule-strong) 35%, var(--cream));
  border: 1px solid var(--rule-strong);
  border-radius: 6px;
  color: var(--muted);
  font-family: 'JetBrains Mono', Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}
.dn-walk-dot:hover {
  border-color: color-mix(in srgb, var(--accent) 55%, var(--rule-strong));
  color: var(--ink);
}
.dn-walk-dot.active {
  background: var(--accent);
  color: var(--white);
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}
.dn-walk-dot-num { display: inline-block; }
.dn-walk-hint {
  font-size: 10px;
  color: var(--muted);
  font-style: italic;
  letter-spacing: 0.02em;
}

/* RIGHT — browser mock frame */
.dn-walk-right {
  background: linear-gradient(180deg,
    color-mix(in srgb, var(--ink) 95%, transparent) 0%,
    color-mix(in srgb, var(--ink) 88%, transparent) 100%);
  padding: 28px 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-left: 1px solid var(--rule-strong);
  min-height: 380px;
}
@media (max-width: 959px) {
  .dn-walk-right { border-left: none; border-top: 1px solid var(--rule-strong); }
}
.dn-walk-mock-frame {
  width: 100%;
  max-width: 520px;
  background: var(--white);
  border: 1px solid color-mix(in srgb, var(--ink) 40%, var(--rule-strong));
  border-radius: 8px;
  overflow: hidden;
  box-shadow:
    0 18px 40px rgba(0, 0, 0, 0.35),
    0 0 0 1px color-mix(in srgb, var(--accent) 14%, transparent);
}
.dn-walk-mock-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 9px 14px;
  background: color-mix(in srgb, var(--ink) 92%, transparent);
  border-bottom: 1px solid var(--rule);
}
.dn-walk-mock-tab-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--accent) 55%, var(--muted));
  display: inline-block;
  opacity: 0.8;
}
.dn-walk-mock-tab-dot:nth-child(2) { opacity: 0.55; }
.dn-walk-mock-tab-dot:nth-child(3) { opacity: 0.35; }
.dn-walk-mock-tab-label {
  margin-left: auto;
  font-size: 9px;
  color: color-mix(in srgb, var(--cream) 80%, transparent);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-family: 'JetBrains Mono', monospace;
}
.dn-walk-mock-body {
  padding: 18px 18px 20px;
  min-height: 280px;
  position: relative;
  animation: dn-mock-in 0.45s ease-out;
}
@keyframes dn-mock-in {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* Mock base */
.dn-mock {
  font-family: 'Inter', sans-serif;
  color: var(--ink);
}
.dn-mock-title {
  font-family: 'Newsreader', 'Source Serif 4', Georgia, serif;
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
  margin-bottom: 12px;
  letter-spacing: -0.005em;
}
.dn-mock-title::before {
  content: '◆';
  margin-right: 6px;
  color: var(--accent);
}
.dn-mock-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}
.dn-mock-metric {
  flex: 1;
  background: var(--cream);
  border: 1px solid var(--rule);
  border-radius: 5px;
  padding: 8px 10px;
}
.dn-mock-k {
  display: block;
  font-size: 8px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--muted);
  font-weight: 700;
  margin-bottom: 2px;
}
.dn-mock-v {
  font-family: 'Newsreader', 'Source Serif 4', Georgia, serif;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.dn-mock-v.pos { color: #2E6B3A; }
.dn-mock-v.neg { color: #A9232B; }

/* Mock: MAP */
.dn-mock-map { position: relative; }
.dn-mock-map-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
  position: relative;
}
.dn-mock-chip {
  background: var(--cream);
  border: 1px solid var(--rule);
  border-radius: 5px;
  padding: 10px 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--ink);
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  transform: translateY(6px);
  animation: dn-chip-in 0.45s ease-out forwards;
}
.dn-mock-chip-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--muted);
  display: inline-block;
}
.dn-mock-chip.hot {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--cream));
  color: var(--ink);
}
.dn-mock-chip.hot .dn-mock-chip-dot {
  background: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 20%, transparent);
  animation: dn-pulse 1.8s ease-in-out infinite;
}
@keyframes dn-chip-in {
  to { opacity: 1; transform: translateY(0); }
}
@keyframes dn-pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.25); }
}
.dn-mock-cursor {
  position: absolute;
  top: 62px;
  left: 42%;
  width: 16px;
  height: 16px;
  border-radius: 2px;
  background: transparent;
  pointer-events: none;
  animation: dn-cursor-fly 3.2s ease-in-out infinite;
}
.dn-mock-cursor::before {
  content: '';
  position: absolute;
  inset: 0;
  background: var(--ink);
  clip-path: polygon(0 0, 100% 45%, 45% 60%, 65% 100%, 0 75%);
  opacity: 0.85;
}
@keyframes dn-cursor-fly {
  0% { transform: translate(0, 0); }
  30% { transform: translate(12px, 20px); }
  60% { transform: translate(-8px, 40px); }
  100% { transform: translate(0, 0); }
}

/* Mock: VALUATION */
.dn-mock-bars {
  display: flex;
  align-items: flex-end;
  gap: 10px;
  height: 130px;
  padding: 0 6px;
  border-bottom: 1.5px solid var(--rule-strong);
  margin-bottom: 6px;
}
.dn-mock-bar {
  flex: 1;
  background: linear-gradient(180deg, var(--accent), color-mix(in srgb, var(--accent) 50%, var(--cream)));
  border-radius: 3px 3px 0 0;
  transform-origin: bottom;
  animation: dn-bar-rise 1s cubic-bezier(0.3, 0.8, 0.3, 1) forwards;
  transform: scaleY(0);
}
@keyframes dn-bar-rise {
  to { transform: scaleY(1); }
}

/* Mock: NEWS */
.dn-mock-news-card {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--cream);
  border: 1px solid var(--rule);
  border-left: 3px solid var(--muted);
  border-radius: 5px;
  padding: 8px 10px;
  margin-bottom: 6px;
  font-size: 11px;
  opacity: 0;
  transform: translateX(-10px);
  animation: dn-news-in 0.5s ease-out forwards;
}
.dn-mock-news-card.pos { border-left-color: #2E6B3A; }
.dn-mock-news-card.neg { border-left-color: #A9232B; }
@keyframes dn-news-in {
  to { opacity: 1; transform: translateX(0); }
}
.dn-mock-pill {
  font-size: 7.5px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 2px;
  flex-shrink: 0;
}
.dn-mock-news-card.pos .dn-mock-pill { background: #DCEFE0; color: #2E6B3A; }
.dn-mock-news-card.neg .dn-mock-pill { background: #F5DEE0; color: #A9232B; }
.dn-mock-headline {
  flex: 1;
  color: var(--ink);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dn-mock-delta {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}
.dn-mock-news-card.pos .dn-mock-delta { color: #2E6B3A; }
.dn-mock-news-card.neg .dn-mock-delta { color: #A9232B; }
.dn-mock-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: color-mix(in srgb, var(--accent) 6%, var(--cream));
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--rule-strong));
  border-radius: 5px;
  padding: 8px 10px;
  margin-top: 6px;
}
.dn-mock-foot .dn-mock-v .pos { color: #2E6B3A; }
.dn-mock-foot .dn-mock-arrow {
  margin: 0 4px;
  color: var(--muted);
  font-weight: 400;
}

/* Mock: PORTFOLIO */
.dn-mock-portfolio { color: var(--accent); }
.dn-mock-chart {
  width: 100%;
  height: 140px;
  display: block;
}
.dn-mock-area { animation: dn-fade-in 0.8s ease-out; }
.dn-mock-line {
  stroke-dasharray: 1000;
  stroke-dashoffset: 1000;
  animation: dn-draw 1.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
@keyframes dn-draw {
  to { stroke-dashoffset: 0; }
}
@keyframes dn-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* Mock: REPORT */
.dn-mock-report {
  position: relative;
  display: flex;
  justify-content: center;
  padding-top: 6px;
}
.dn-mock-report-page {
  width: 80%;
  max-width: 340px;
  background: var(--white);
  border: 1px solid var(--rule-strong);
  border-top: 4px solid var(--accent);
  border-radius: 3px;
  padding: 18px 22px;
  box-shadow: 0 18px 40px rgba(10, 35, 64, 0.15);
  transform: rotate(-0.6deg);
  animation: dn-paper-slide 0.8s cubic-bezier(0.3, 0, 0, 1) forwards;
  opacity: 0;
}
@keyframes dn-paper-slide {
  from { opacity: 0; transform: rotate(-3deg) translateY(30px); }
  to { opacity: 1; transform: rotate(-0.6deg) translateY(0); }
}
.dn-mock-report-brand {
  font-family: 'Newsreader', 'Source Serif 4', Georgia, serif;
  font-size: 14px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 3px;
}
.dn-mock-report-brand em { font-style: italic; color: var(--accent); }
.dn-mock-report-rule {
  height: 2px;
  background: var(--accent);
  margin-bottom: 10px;
  width: 50%;
}
.dn-mock-report-eyebrow {
  font-size: 7px;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--muted);
  margin-bottom: 4px;
}
.dn-mock-report-title {
  font-family: 'Newsreader', 'Source Serif 4', Georgia, serif;
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
  letter-spacing: -0.012em;
  margin-bottom: 3px;
}
.dn-mock-em {
  font-style: italic;
  color: var(--accent);
  font-size: 13px;
}
.dn-mock-report-meta {
  font-size: 8px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--muted);
  display: flex;
  gap: 4px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.dn-mock-report-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dn-mock-report-line {
  height: 3px;
  background: var(--rule-strong);
  border-radius: 1px;
  opacity: 0;
  animation: dn-fade-in 0.3s ease-out forwards;
}
.dn-mock-report-line:nth-child(1) { animation-delay: 0.6s; }
.dn-mock-report-line:nth-child(2) { animation-delay: 0.7s; }
.dn-mock-report-line:nth-child(3) { animation-delay: 0.8s; }
.dn-mock-report-line:nth-child(4) { animation-delay: 0.9s; }
.dn-mock-report-line:nth-child(5) { animation-delay: 1s; }
.dn-mock-report-line:nth-child(6) { animation-delay: 1.1s; }
.dn-mock-report-line:nth-child(7) { animation-delay: 1.2s; }
.dn-mock-report-stamp {
  position: absolute;
  top: 6px;
  right: 22px;
  background: var(--accent);
  color: var(--white);
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.14em;
  padding: 5px 10px;
  border-radius: 2px;
  transform: rotate(8deg);
  animation: dn-stamp 0.6s cubic-bezier(0.3, 1.6, 0.3, 1) forwards;
  opacity: 0;
}
@keyframes dn-stamp {
  from { opacity: 0; transform: rotate(16deg) scale(2.5); }
  to { opacity: 1; transform: rotate(8deg) scale(1); }
}

/* ─────────────────────────────────────────────────────
   METRICS STRIP — animated counters
   ───────────────────────────────────────────────────── */
.dn-metrics-section { padding-top: 40px; padding-bottom: 40px; }
.dn-metrics-strip {
  display: grid;
  grid-template-columns: 1fr;
  gap: 14px;
  border-top: 1px solid var(--rule-strong);
  border-bottom: 1px solid var(--rule-strong);
  padding: 24px 0;
}
@media (min-width: 600px) {
  .dn-metrics-strip { grid-template-columns: repeat(2, 1fr); }
}
@media (min-width: 960px) {
  .dn-metrics-strip { grid-template-columns: repeat(5, 1fr); }
}
.dn-metric-cell {
  text-align: left;
  padding: 0 14px;
  border-right: 1px solid var(--rule);
  position: relative;
}
.dn-metric-cell:last-child { border-right: none; }
@media (max-width: 959px) {
  .dn-metric-cell { border-right: none; }
}
.dn-metric-value {
  font-family: 'Newsreader', 'Source Serif 4', Georgia, serif;
  font-size: clamp(40px, 5vw, 60px);
  font-weight: 600;
  color: var(--ink);
  line-height: 1;
  letter-spacing: -0.024em;
  font-variant-numeric: tabular-nums;
}
.dn-metric-label {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--accent) 80%, var(--ink));
  margin-top: 8px;
}
.dn-metric-sub {
  font-size: 10.5px;
  color: var(--muted);
  margin-top: 2px;
}

@media (prefers-reduced-motion: reduce) {
  .dn-feature-card { animation: none; opacity: 1; transform: none; }
  .dn-features-loader-fill,
  .dn-feature-ticker-track,
  .dn-features-glow { animation: none !important; }
  .dn-walk-mock-body,
  .dn-mock-chip,
  .dn-mock-bar,
  .dn-mock-news-card,
  .dn-mock-line,
  .dn-mock-area,
  .dn-mock-report-page,
  .dn-mock-report-line,
  .dn-mock-report-stamp,
  .dn-mock-chip.hot .dn-mock-chip-dot,
  .dn-mock-cursor {
    animation: none !important;
    opacity: 1 !important;
    transform: none !important;
    stroke-dashoffset: 0 !important;
  }
  .dn-walk-progress-fill { transition: none; }
}

/* ─────────────────────────────────────────────────────
   MOBILE ADAPTATIONS (landing page scoped)
   Only active below 720px. Desktop is untouched.
   ───────────────────────────────────────────────────── */
@media (max-width: 720px) {
  .dn-landing { font-size: 15px; }

  /* Theme toolbar — wrap swatches + compress padding */
  .dn-theme-bar-inner {
    padding: 0 16px;
    gap: 10px;
    flex-wrap: wrap;
  }
  .dn-theme-name { display: none; }

  /* Nav — compress padding, hide the link row (already hidden
     under 960px), keep brand + CTAs */
  .dn-nav-inner {
    padding: 12px 16px;
    gap: 10px;
  }
  .dn-brand { font-size: 19px; }
  .dn-btn-ghost, .dn-btn-primary, .dn-btn-outline {
    padding: 8px 12px;
    font-size: 11px;
  }
  .dn-btn-lg { padding: 12px 18px; font-size: 12px; }
  .dn-btn-ghost { display: none; }

  /* Marquee */
  .dn-marquee-inner { padding: 10px 16px; gap: 14px; font-size: 10px; }

  /* Hero */
  .dn-hero { padding: 54px 16px 72px; }
  .dn-hero-inner { gap: 40px; }
  .dn-hero-title {
    font-size: clamp(2.2rem, 9vw, 3.4rem) !important;
    margin-bottom: 24px;
  }
  .dn-hero-lede { font-size: 16px; margin-bottom: 28px; }
  .dn-hero-eyebrow { margin-bottom: 22px; font-size: 9.5px; }
  .dn-hero-eyebrow .dn-rule { flex: 0 0 32px; }
  .dn-hero-rail { margin-top: 8px; }
  .dn-rail-head, .dn-rail-foot { padding: 16px 18px; }
  .dn-rail-rows { padding: 4px 18px; }
  .dn-rail-row { padding: 12px 0; }
  .dn-rail-v { font-size: 18px; }

  /* Pull quote */
  .dn-quote-strip { padding: 60px 16px; }
  .dn-quote-mark {
    font-size: 80px;
    top: -30px;
    left: -8px;
  }
  .dn-quote-text { font-size: clamp(1.5rem, 6vw, 2rem); }

  /* Sections — reduce vertical padding drastically */
  .dn-section { padding: 72px 16px; }
  .dn-section-head { margin-bottom: 44px; }
  .dn-section-head-centered { margin-bottom: 44px; }
  .dn-h2 { font-size: clamp(1.8rem, 6.5vw, 2.4rem); margin-bottom: 16px; }
  .dn-section-lede { font-size: 15px; }

  /* Services */
  .dn-service { padding: 32px 0; gap: 18px; }
  .dn-service-num { font-size: 60px; }
  .dn-service-kicker { font-size: 9.5px; }
  .dn-service-title { font-size: 1.5rem; }
  .dn-service-lede { font-size: 16px; margin-bottom: 16px; }
  .dn-service-bullets li { font-size: 13px; }

  /* Frameworks + coverage */
  .dn-framework { padding: 26px 22px; }
  .dn-framework-title { font-size: 19px; }
  .dn-framework-body { font-size: 13px; }
  .dn-coverage-tile { padding: 22px 20px; }
  .dn-coverage-title { font-size: 17px; }
  .dn-coverage-body { font-size: 12px; }

  /* Case examples */
  .dn-case { margin-top: 40px; padding-top: 40px; }
  .dn-case-offset { margin-top: 60px; }
  .dn-case-title { font-size: 1.6rem; }
  .dn-case-tag { margin-bottom: 24px; font-size: 9.5px; flex-wrap: wrap; gap: 10px; }
  .dn-case-rule { flex: 0 0 28px; }

  /* Split layouts already stack at 1024px; reduce gap */
  .dn-split { gap: 40px !important; }

  /* Snippet cards */
  .dn-snippet-head { padding: 18px 18px 12px; }
  .dn-snippet-row { padding: 14px 18px; grid-template-columns: 56px 1fr; gap: 12px; }
  .dn-snippet-code { font-size: 9.5px; }
  .dn-snippet-label { font-size: 13px; }
  .dn-snippet-detail { font-size: 11.5px; }
  .dn-snippet-foot { padding: 14px 18px 18px; }

  /* Policy / navy section */
  .dn-impact-card { padding: 24px; }
  .dn-impact-value { font-size: 22px; }
  .dn-impact-footnote { font-size: 11px; margin-top: 18px; }

  /* Pillars */
  .dn-pillar { grid-template-columns: 54px 1fr; gap: 18px; padding: 26px 0; }
  .dn-pillar-step { font-size: 30px; }
  .dn-pillar-title { font-size: 19px; }
  .dn-pillar-body { font-size: 13.5px; }

  /* CTA */
  .dn-cta { padding: 80px 16px; }

  /* Footer */
  .dn-footer { padding: 56px 16px 28px; }
  .dn-footer-grid { gap: 32px; margin-bottom: 32px; padding-bottom: 32px; }
  .dn-footer-brand .dn-brand { font-size: 22px; }

  /* Key list grid collapses to single column */
  .dn-key-list li {
    grid-template-columns: 1fr;
    gap: 4px;
    padding: 14px 0;
  }

  /* Modal */
  .dn-modal {
    padding: 32px 24px 24px;
    max-width: 100%;
  }
  .dn-modal-title { font-size: 26px; margin-bottom: 22px; }
}

@media (max-width: 480px) {
  .dn-theme-swatches { gap: 5px; }
  .dn-swatch { width: 12px; height: 12px; }
  .dn-theme-label { font-size: 9px; }
  .dn-nav-inner { padding: 10px 14px; }
  .dn-hero-title { font-size: clamp(1.9rem, 10vw, 2.8rem) !important; }
  .dn-h2 { font-size: clamp(1.5rem, 7.5vw, 2rem); }
  .dn-marquee-inner { padding: 8px 14px; font-size: 9.5px; gap: 12px; }
  .dn-marquee-kicker { display: none; }
  .dn-section { padding: 60px 14px; }
  .dn-hero { padding: 40px 14px 56px; }
}
`
