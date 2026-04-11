'use client'

/**
 * DealNector landing page.
 *
 * Ported from the vanilla HTML reference (dealnector_landing.html) into
 * a single React client component. Colors, spacing, fonts and animations
 * are all pinned via an inline <style> block so nothing leaks into the
 * dashboard design system. The only external dependency is Next-Auth's
 * client signIn() + the existing /api/auth/signup endpoint, wired up to
 * the Sign Up / Login buttons through an in-page AuthModal.
 */

import { useState } from 'react'
import { signIn } from 'next-auth/react'

type ModalMode = null | 'login' | 'signup'

export function LandingPage() {
  const [modal, setModal] = useState<ModalMode>(null)

  return (
    <>
      <style>{LANDING_CSS}</style>
      <div className="dn-landing">
        {/* NAV */}
        <nav className="dn-nav">
          <div className="dn-nav-inner">
            <div className="dn-brand">DealNector</div>
            <div className="dn-nav-links">
              <a href="#sourcing">Analysis</a>
              <a href="#industries">Industries</a>
              <a href="#clusters">Value Chain</a>
              <a href="#advisory">Targeting</a>
              <a href="#pipeline">Insights</a>
            </div>
            <div className="dn-nav-cta">
              <button className="dn-btn-ghost" onClick={() => setModal('login')}>
                Login
              </button>
              <button className="dn-btn-primary" onClick={() => setModal('signup')}>
                Executive Briefing
              </button>
            </div>
          </div>
        </nav>

        {/* HERO */}
        <section className="dn-hero">
          <div className="dn-glow dn-glow-1" />
          <div className="dn-glow dn-glow-2" />
          <div className="dn-hero-grid">
            <div className="dn-hero-left fade-up">
              <div className="dn-chip-row">
                <span className="dn-chip dn-chip-amber pulse">AI Insight Active</span>
                <span className="dn-chip-label">M&amp;A Intelligence Terminal</span>
              </div>
              <h1 className="dn-hero-title">
                <span className="dn-hero-title-main">Architecting</span>
                <br />
                <span className="dn-hero-title-accent">Inorganic Growth</span>
                <br />
                <span className="dn-hero-title-italic">through Predictive</span>
                <br />
                <span className="dn-hero-title-italic">Intelligence.</span>
                <span className="dn-cursor">|</span>
              </h1>
              <p className="dn-hero-lead">
                The definitive terminal for multi-sector asset targeting, value chain
                analysis, and strategic growth planning.
              </p>
              <p className="dn-hero-sub">
                Traditional M&amp;A is reactive. DealNector utilizes predictive neural
                networks to map the market before the mandate even exists.
              </p>
              <div className="dn-hero-cta">
                <button className="dn-btn-primary dn-btn-lg" onClick={() => setModal('signup')}>
                  Initialize Pipeline
                </button>
                <button
                  className="dn-btn-outline dn-btn-lg"
                  onClick={() => setModal('login')}
                >
                  Explore Assets
                </button>
              </div>
            </div>

            {/* Live Analysis Panel */}
            <div className="dn-hero-right fade-up delay-2">
              <div className="dn-glass dn-glow-strong">
                <div className="dn-panel-header">
                  <span className="dn-label">Live Analysis</span>
                  <div className="dn-processing">
                    <span className="dn-live-dot" />
                    <span>Processing</span>
                  </div>
                </div>
                <div className="dn-score-block">
                  <div className="dn-label dn-primary">Target Score · Alpha</div>
                  <div className="dn-score">94.2</div>
                  <div className="dn-score-sub">Confidence interval: 98.3%</div>
                </div>
                <div className="dn-bars">
                  {[
                    { label: 'Strategic Fit', pct: 98, color: 'amber' },
                    { label: 'Synergy Capture', pct: 82, color: 'blue' },
                    { label: 'Regulatory Risk', pct: 22, color: 'grey', value: 'Low' },
                  ].map((b) => (
                    <div key={b.label} className="dn-bar">
                      <div className="dn-bar-head">
                        <span>{b.label}</span>
                        <span className={`dn-bar-val dn-${b.color}`}>
                          {b.value ?? `${b.pct}%`}
                        </span>
                      </div>
                      <div className="dn-bar-track">
                        <div
                          className={`dn-bar-fill dn-bg-${b.color}`}
                          style={{ width: `${b.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="dn-bottom-stats">
                  <div>
                    <div className="dn-stat-val dn-amber">28.4%</div>
                    <div className="dn-stat-lbl">IRR Projection</div>
                  </div>
                  <div className="dn-stat-mid">
                    <div className="dn-stat-val dn-blue">+$142M</div>
                    <div className="dn-stat-lbl">Synergy Alpha</div>
                  </div>
                  <div>
                    <div className="dn-stat-val">Low</div>
                    <div className="dn-stat-lbl">Risk Score</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="dn-scroll-hint">
            <span>Scroll</span>
            <div className="dn-scroll-line" />
          </div>
        </section>

        {/* TICKER */}
        <div className="dn-ticker">
          <div className="dn-ticker-track">
            {[0, 1].map((k) => (
              <div key={k} className="dn-ticker-group" aria-hidden={k === 1}>
                <span className="dn-amber">$4.7T Deal Flow Monitored</span>
                <span className="dn-dim">—</span>
                <span>1,240 Active Neural Signals</span>
                <span className="dn-dim">—</span>
                <span className="dn-amber">342 Assets Tracked</span>
                <span className="dn-dim">—</span>
                <span>6 Sector Clusters</span>
                <span className="dn-dim">—</span>
                <span className="dn-amber">System Online · 99.8% Uptime</span>
                <span className="dn-dim">—</span>
                <span>Last Intelligence Update: 2m ago</span>
                <span className="dn-dim">—</span>
              </div>
            ))}
          </div>
        </div>

        {/* SOURCING */}
        <section id="sourcing" className="dn-section dn-section-low">
          <div className="dn-section-inner">
            <div className="dn-section-head">
              <div className="dn-section-title-box">
                <span className="dn-eyebrow dn-amber">How It Works</span>
                <h2 className="dn-h2">Neural Asset Sourcing</h2>
              </div>
              <p className="dn-section-lede">
                Identifying undervalued targets through proprietary neural-network
                clusters that analyze 150+ non-traditional growth signals — before they
                reach sell-side mandates.
              </p>
            </div>
            <div className="dn-grid-3">
              {[
                {
                  icon: 'hub',
                  title: 'Pattern Recognition',
                  desc: 'Detecting consolidation opportunities by mapping R&D spend against regional market fragmentation. Surfaces mandates 6–18 months before public announcement.',
                  stat: '1,240',
                  lbl: 'Active Signals',
                  pill: 'Active',
                  pillColor: 'blue',
                  glow: false,
                },
                {
                  icon: 'language',
                  title: 'Sentiment Mapping',
                  desc: 'Processing global boardroom chatter and executive movement to predict upcoming divestitures. NLP-driven analysis across 47 languages and 12,000 data sources.',
                  stat: 'High',
                  lbl: 'Boardroom Flux',
                  pill: 'Real-Time',
                  pillColor: 'amber',
                  glow: true,
                },
                {
                  icon: 'analytics',
                  title: 'Value Anomalies',
                  desc: 'Pinpointing EBITDA disconnects in secondary markets before public reporting cycles. AI-scored anomalies ranked by confidence interval and acquisition viability.',
                  stat: '42',
                  lbl: 'Targets Found',
                  pill: 'Verified',
                  pillColor: 'grey',
                  glow: false,
                },
              ].map((c) => (
                <div
                  key={c.title}
                  className={`dn-card ${c.glow ? 'dn-card-glow' : ''}`}
                >
                  <div className="dn-card-head">
                    <div className={`dn-card-icon dn-bg-${c.pillColor}-dim`}>
                      <span className="material-symbols-outlined">{c.icon}</span>
                    </div>
                    <span className={`dn-card-pill dn-${c.pillColor}`}>{c.pill}</span>
                  </div>
                  <h3 className="dn-card-title">{c.title}</h3>
                  <p className="dn-card-body">{c.desc}</p>
                  <div className="dn-card-foot">
                    <div>
                      <div className="dn-lbl-mini">{c.lbl}</div>
                      <div className={`dn-card-stat dn-${c.pillColor}`}>{c.stat}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* INDUSTRIES */}
        <section id="industries" className="dn-section">
          <div className="dn-section-inner">
            <div className="dn-section-head">
              <div className="dn-section-title-box">
                <span className="dn-eyebrow dn-blue">Coverage Universe</span>
                <h2 className="dn-h2">Multi-Sector Intelligence</h2>
                <p className="dn-h2-sub">
                  Mapping the global economic landscape through proprietary graph
                  databases and real-time news sentiment analysis.
                </p>
              </div>
              <a className="dn-link-arrow" href="#clusters">
                View All Sectors →
              </a>
            </div>
            <div className="dn-grid-4">
              <div className="dn-card">
                <span className="material-symbols-outlined dn-card-icon-plain dn-blue">
                  memory
                </span>
                <h3 className="dn-card-title">Tech &amp; AI</h3>
                <p className="dn-card-body">
                  Infrastructure plays and high-growth SaaS assets identified via patent
                  velocity and talent migration patterns.
                </p>
                <div className="dn-card-foot">
                  <div className="dn-lbl-mini">Active Mandates</div>
                  <div className="dn-card-stat">142</div>
                </div>
              </div>

              <div className="dn-card dn-card-wide dn-card-glow">
                <div className="dn-card-wide-body">
                  <div className="dn-chip-row">
                    <span className="dn-chip dn-chip-amber">Case Study</span>
                    <span className="dn-chip-label">Value Chain Analysis</span>
                  </div>
                  <h3 className="dn-card-title-lg">
                    Solar Energy
                    <br />
                    Ecosystem
                  </h3>
                  <p className="dn-card-body">
                    Deep-dive analysis into the photovoltaic manufacturing supply chain,
                    revealing critical consolidation opportunities in silicon refinement
                    and smart grid integration.
                  </p>
                  <div className="dn-inline-stats">
                    <div>
                      <div className="dn-lbl-mini">Transaction Vol</div>
                      <div className="dn-card-stat dn-amber">$14.2B</div>
                    </div>
                    <div>
                      <div className="dn-lbl-mini">Active Mandates</div>
                      <div className="dn-card-stat">124</div>
                    </div>
                  </div>
                  <button className="dn-link-amber">
                    Review Insights →
                  </button>
                </div>
              </div>

              <div className="dn-card">
                <span className="material-symbols-outlined dn-card-icon-plain dn-blue">
                  health_and_safety
                </span>
                <h3 className="dn-card-title">Healthcare</h3>
                <p className="dn-card-body">
                  Biotech and medical technology scouting focused on FDA pipeline
                  progress and diagnostic automation breakthroughs.
                </p>
                <div className="dn-card-foot">
                  <div className="dn-lbl-mini">Active Mandates</div>
                  <div className="dn-card-stat">87</div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="dn-gradient-line" />

        {/* CLUSTERS */}
        <section id="clusters" className="dn-section dn-section-low">
          <div className="dn-section-inner">
            <span className="dn-eyebrow dn-amber">Sector Intelligence</span>
            <h2 className="dn-h2" style={{ marginBottom: 40 }}>
              Vertical Intelligence Clusters
            </h2>
            <div className="dn-grid-2">
              <div className="dn-card dn-card-lg">
                <div className="dn-card-glow-orb" />
                <h3 className="dn-card-title-lg dn-blue">Technology &amp; SaaS</h3>
                <p className="dn-card-body">
                  Aggressive consolidation in the AI middleware space. Multiples
                  stabilizing at 8.4x as private equity re-enters the market.
                </p>
                <div className="dn-inline-stats">
                  <div>
                    <div className="dn-lbl-mini">Active Mandates</div>
                    <div className="dn-card-stat-xl">124</div>
                  </div>
                  <div>
                    <div className="dn-lbl-mini">Transaction Vol</div>
                    <div className="dn-card-stat-xl dn-amber">$14.2B</div>
                  </div>
                </div>
              </div>

              <div className="dn-card dn-card-lg">
                <h3 className="dn-card-title-lg">Infrastructure</h3>
                <p className="dn-card-body">
                  Sovereign wealth pivot towards renewable-logistics hubs. REIT
                  restructuring creates entry windows across 14 geographies.
                </p>
                <div className="dn-lbl-mini">Yield Avg</div>
                <div className="dn-card-stat-xl dn-blue">6.2%</div>
              </div>

              <div className="dn-card dn-card-lg">
                <h3 className="dn-card-title-lg">Biotech</h3>
                <p className="dn-card-body">
                  Early-stage oncology startups seeing increased pre-IPO acquisition
                  interest from Big Pharma amid patent cliff pressures.
                </p>
                <div className="dn-lbl-mini">Active Mandates</div>
                <div className="dn-card-stat-xl">89</div>
              </div>

              <div className="dn-card dn-card-lg dn-card-outlined">
                <h3 className="dn-card-title-lg">Logistics &amp; Supply</h3>
                <p className="dn-card-body">
                  Last-mile optimization targets showing 22% margin improvement
                  potential via DealNector synergies and AI route optimization.
                </p>
                <div className="dn-inline-stats">
                  <div>
                    <div className="dn-lbl-mini">Global Flow</div>
                    <div className="dn-card-stat-xl dn-blue">UP 12%</div>
                  </div>
                  <div>
                    <div className="dn-lbl-mini">Deal Velocity</div>
                    <div className="dn-card-stat-xl dn-amber">Accelerating</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ADVISORY */}
        <section id="advisory" className="dn-section">
          <div className="dn-section-inner dn-grid-split">
            <div className="dn-advisory-visual">
              <div className="dn-advisory-orb" />
              <div className="dn-advisory-card">
                <div className="dn-advisory-card-row">
                  <div>
                    <div className="dn-lbl-mini dn-amber">Growth Strategy Active</div>
                    <div className="dn-advisory-card-body">
                      Simulating 14,000 LBO scenarios based on current Fed projections.
                    </div>
                  </div>
                  <button className="dn-btn-primary dn-btn-sm">Simulate</button>
                </div>
              </div>
            </div>
            <div className="dn-advisory-right">
              <span className="dn-eyebrow dn-amber">Our Method</span>
              <h2 className="dn-h2">
                Strategic Growth
                <br />
                Advisory
              </h2>
              <p className="dn-h2-sub">
                Move beyond spreadsheet models. Our platform simulates LBO sensitivity
                in real-time, factoring in micro-economic shifts and latent synergy
                values that traditional audits miss.
              </p>
              <div className="dn-pillars">
                {[
                  {
                    icon: 'radar',
                    color: 'blue',
                    title: 'Asset Targeting',
                    desc: 'Utilizing neural networks to identify undervalued assets and strategic gaps within competitor portfolios before they reach the public market.',
                  },
                  {
                    icon: 'query_stats',
                    color: 'amber',
                    title: 'Financial Analysis',
                    desc: 'Dynamic DCF modeling and synergy quantification powered by real-time macroeconomic data streams and policy impact simulations. We don\u2019t just calculate value — we engineer it.',
                  },
                  {
                    icon: 'map',
                    color: 'grey',
                    title: 'Growth Planning',
                    desc: 'Customized inorganic roadmaps that align acquisition strategies with long-term institutional objectives and risk appetite.',
                  },
                ].map((p, i, arr) => (
                  <div key={p.title}>
                    <div className="dn-pillar">
                      <div className={`dn-pillar-icon dn-bg-${p.color}-dim`}>
                        <span className="material-symbols-outlined">{p.icon}</span>
                      </div>
                      <div>
                        <h4 className="dn-pillar-title">{p.title}</h4>
                        <p className="dn-pillar-body">{p.desc}</p>
                      </div>
                    </div>
                    {i < arr.length - 1 && <div className="dn-pillar-divider" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className="dn-gradient-line" />

        {/* PIPELINE */}
        <section id="pipeline" className="dn-section dn-section-lowest">
          <div className="dn-section-inner">
            <div className="dn-section-head">
              <div className="dn-section-title-box">
                <span className="dn-eyebrow dn-blue">Live Intelligence Feed</span>
                <h2 className="dn-h2">Global Pipeline Live</h2>
                <p className="dn-h2-sub">
                  Continuous monitoring of the global deal flow and regulatory
                  landscape.
                </p>
              </div>
              <div className="dn-pipeline-chips">
                <div className="dn-pipeline-chip">
                  <span className="dn-live-dot dn-green" />
                  <span>System Online</span>
                </div>
                <div className="dn-pipeline-chip">
                  <span>Update: 2m Ago</span>
                </div>
              </div>
            </div>
            <div className="dn-pipeline-grid">
              <div className="dn-pipeline-feed">
                <div className="dn-alert">
                  <div className="dn-alert-head">
                    <span className="dn-alert-tag dn-amber">Policy Impact Alert</span>
                    <span className="dn-lbl-mini">14:02 GMT</span>
                  </div>
                  <h4 className="dn-alert-title">
                    EU Regulatory Shift in Semi-Conductor Exports
                  </h4>
                  <p className="dn-alert-body">
                    Potential headwind for cross-border tech acquisitions. Probability
                    of deal blockage increased by 22% for targeted Tier-1 assets.
                  </p>
                  <div className="dn-alert-bar">
                    <div className="dn-alert-bar-track">
                      <div className="dn-alert-bar-fill dn-bg-amber" style={{ width: '22%' }} />
                    </div>
                    <span className="dn-amber">+22% Risk</span>
                  </div>
                </div>

                <div className="dn-alert">
                  <div className="dn-alert-head">
                    <span className="dn-alert-tag dn-blue">Deal Tracking</span>
                    <span className="dn-lbl-mini">12:45 GMT</span>
                  </div>
                  <h4 className="dn-alert-title">
                    Merger Announcement: Finovate &amp; CoreStream
                  </h4>
                  <p className="dn-alert-body">
                    Strategic consolidation in the Latin American Fintech space.
                    Estimated deal value: $4.2B. Post-merger market share: 12%.
                  </p>
                  <div className="dn-alert-grid">
                    <div>
                      <div className="dn-lbl-mini">Deal Value</div>
                      <div className="dn-alert-stat dn-blue">$4.2B</div>
                    </div>
                    <div>
                      <div className="dn-lbl-mini">Mkt Share</div>
                      <div className="dn-alert-stat">12%</div>
                    </div>
                    <div>
                      <div className="dn-lbl-mini">Region</div>
                      <div className="dn-alert-stat">LATAM</div>
                    </div>
                  </div>
                </div>

                <div className="dn-alert">
                  <div className="dn-alert-head">
                    <span className="dn-alert-tag dn-amber">Intelligence Pulse</span>
                    <span className="dn-lbl-mini">09:15 GMT</span>
                  </div>
                  <h4 className="dn-alert-title">
                    Inbound Interest Spike: Rare Earth Mining
                  </h4>
                  <p className="dn-alert-body">
                    AI detection of unusual buyout modeling activity centered on
                    Australian exploration firms. Anomaly score: 0.88.
                  </p>
                  <div className="dn-alert-foot">
                    <div className="dn-processing">
                      <span className="dn-live-dot" />
                      <span className="dn-amber">High Confidence</span>
                    </div>
                    <span className="dn-lbl-mini">Anomaly Score: 0.88</span>
                  </div>
                </div>
              </div>

              <div className="dn-deal-map">
                <h4 className="dn-deal-map-title">Active Deal Map</h4>
                <div className="dn-deal-map-viz">
                  <div className="dn-deal-map-grid" />
                  <div className="dn-deal-map-center">
                    <span className="material-symbols-outlined">public</span>
                    <div>Heatmap Active</div>
                  </div>
                  <div className="dn-map-dot dn-map-dot-1" />
                  <div className="dn-map-dot dn-map-dot-2" />
                  <div className="dn-map-dot dn-map-dot-3" />
                </div>
                <div className="dn-region-list">
                  {[
                    { name: 'North America', label: 'Active', color: 'blue', pct: 85 },
                    { name: 'APAC', label: 'Surging', color: 'amber', pct: 92 },
                    { name: 'EMEA', label: 'Monitoring', color: 'grey', pct: 55 },
                  ].map((r) => (
                    <div key={r.name} className="dn-region">
                      <div className="dn-region-head">
                        <span>{r.name}</span>
                        <span className={`dn-${r.color}`}>{r.label}</span>
                      </div>
                      <div className="dn-region-bar">
                        <div
                          className={`dn-region-fill dn-bg-${r.color}`}
                          style={{ width: `${r.pct}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* CTA */}
        <section className="dn-cta">
          <div className="dn-cta-glow" />
          <div className="dn-cta-inner">
            <div>
              <span className="dn-eyebrow dn-amber">Exclusive Access</span>
              <h2 className="dn-h2">
                Secure Your
                <br />
                <em className="dn-blue">Command.</em>
              </h2>
              <p className="dn-h2-sub">
                Join the inner circle of M&amp;A leaders utilizing the world&apos;s
                most advanced growth engine. Institutional access. No sell-side noise.
              </p>
              <div className="dn-hero-cta">
                <button
                  className="dn-btn-primary dn-btn-lg"
                  onClick={() => setModal('signup')}
                >
                  Sign Up
                </button>
                <button
                  className="dn-btn-outline dn-btn-lg"
                  onClick={() => setModal('login')}
                >
                  Login
                </button>
              </div>
            </div>
            <div className="dn-cta-features">
              {[
                {
                  icon: 'bolt',
                  color: 'amber',
                  title: 'Real-Time Intelligence',
                  desc: 'Continuous neural-network monitoring across 12,000 data sources, updated every 2 minutes.',
                },
                {
                  icon: 'security',
                  color: 'blue',
                  title: 'Institutional Grade',
                  desc: 'SOC 2 Type II certified. Data never leaves your jurisdiction. GDPR and CCPA compliant.',
                },
                {
                  icon: 'group',
                  color: 'grey',
                  title: 'Exclusive Network',
                  desc: 'Access to 340+ institutional M&A advisors and deal-makers across 48 countries.',
                },
              ].map((f) => (
                <div key={f.title} className="dn-glass dn-feature">
                  <div className={`dn-feature-icon dn-bg-${f.color}-dim`}>
                    <span className="material-symbols-outlined">{f.icon}</span>
                  </div>
                  <div>
                    <h4 className="dn-feature-title">{f.title}</h4>
                    <p className="dn-feature-body">{f.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="dn-footer">
          <div className="dn-footer-inner">
            <div className="dn-footer-grid">
              <div className="dn-footer-brand">
                <div className="dn-brand dn-amber">DealNector</div>
                <p className="dn-footer-blurb">
                  The definitive M&amp;A intelligence terminal for inorganic growth
                  strategy, powered by predictive AI.
                </p>
                <div className="dn-processing">
                  <span className="dn-live-dot dn-green" />
                  <span>All Systems Operational</span>
                </div>
              </div>
              <div>
                <div className="dn-lbl-mini dn-footer-heading">Platform</div>
                <div className="dn-footer-links">
                  <a href="#sourcing">Analysis Terminal</a>
                  <a href="#industries">Industries</a>
                  <a href="#clusters">Value Chain</a>
                  <a href="#advisory">Targeting Engine</a>
                </div>
              </div>
              <div>
                <div className="dn-lbl-mini dn-footer-heading">Legal</div>
                <div className="dn-footer-links">
                  <a href="#">Privacy Charter</a>
                  <a href="#">Methodology</a>
                  <a href="#">Institutional Access</a>
                  <a href="#">Contact</a>
                </div>
              </div>
            </div>
            <div className="dn-footer-bottom">
              <div>© 2025 DealNector. High-Stakes M&amp;A Intelligence of Choice.</div>
              <div>Intelligence Terminal · Build 2025.04</div>
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

// ─── Auth modal ─────────────────────────────────────────

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
  const [password, setPassword] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (mode === 'login') {
        const res = await signIn('credentials', {
          username: username.trim(),
          password,
          redirect: false,
        })
        if (res?.error || !res?.ok) {
          setError('Invalid credentials. Please check your username and password.')
        } else {
          window.location.href = '/dashboard'
        }
      } else {
        if (password !== confirmPw) {
          setError('Passwords do not match.')
          setLoading(false)
          return
        }
        const res = await fetch('/api/auth/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: username.trim(),
            email: email.trim(),
            fullName: fullName.trim(),
            password,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          setError(data.error || 'Signup failed. Try a different username or email.')
          setLoading(false)
          return
        }
        // Auto-login after successful signup
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
        <div className="dn-modal-brand">DealNector</div>
        <div className="dn-modal-eyebrow">
          {mode === 'login' ? 'Executive Access' : 'Request Briefing'}
        </div>
        <h2 className="dn-modal-title">
          {mode === 'login' ? (
            <>
              Welcome <em>back.</em>
            </>
          ) : (
            <>
              Request <em>credentials.</em>
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

          {error && <div className="dn-modal-error">{error}</div>}

          <button type="submit" disabled={loading} className="dn-btn-primary dn-btn-full">
            {loading
              ? 'Authenticating…'
              : mode === 'login'
                ? 'Access Terminal →'
                : 'Create Access →'}
          </button>

          <div className="dn-modal-switch">
            {mode === 'login' ? (
              <>
                New to DealNector?{' '}
                <button type="button" onClick={() => onSwitch('signup')}>
                  Request Briefing
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

// ─── Scoped stylesheet ──────────────────────────────────
//
// Every class is prefixed with `dn-` so it can never collide with the
// dashboard design system. Color tokens are declared on `.dn-landing`
// so the whole subtree is self-contained.

const LANDING_CSS = `
.dn-landing {
  --bg: #131313;
  --surface: #131313;
  --surface-dim: #131313;
  --surface-container-lowest: #0e0e0e;
  --surface-container-low: #1c1b1b;
  --surface-container: #201f1f;
  --surface-container-high: #2a2a2a;
  --surface-container-highest: #353534;
  --surface-bright: #393939;
  --on-surface: #e5e2e1;
  --on-surface-variant: #c5c6d1;
  --on-surface-variant-dim: #8f909b;
  --outline-variant: #444650;
  --primary: #b2c5ff;
  --primary-container: #00205b;
  --on-primary-container: #738aca;
  --tertiary: #ffba2c;
  --tertiary-container: #332100;
  --on-tertiary: #422c00;
  --green: #4ade80;
  font-family: 'Manrope', 'Inter', sans-serif;
  background: var(--surface);
  color: var(--on-surface);
  min-height: 100vh;
  overflow-x: hidden;
  -webkit-font-smoothing: antialiased;
  font-size: 16px;
  line-height: 1.5;
  letter-spacing: 0;
}
.dn-landing * { box-sizing: border-box; }
.dn-landing h1, .dn-landing h2, .dn-landing h3, .dn-landing h4 {
  font-family: 'Newsreader', Georgia, serif;
  font-weight: 700;
  color: var(--on-surface);
  margin: 0;
  letter-spacing: -0.015em;
}
.dn-landing p { margin: 0; }
.dn-landing a { color: inherit; text-decoration: none; }
.dn-landing ::selection { background: var(--tertiary); color: var(--on-tertiary); }
.dn-landing button { font-family: inherit; cursor: pointer; }

/* NAV */
.dn-nav {
  position: fixed;
  top: 0; left: 0; right: 0; z-index: 50;
  border-bottom: 1px solid rgba(68, 70, 80, 0.1);
  background: rgba(19,19,19,0.92);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.dn-nav-inner {
  max-width: 1440px;
  margin: 0 auto;
  padding: 20px 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dn-brand {
  font-family: 'Newsreader', serif;
  font-style: italic;
  font-size: 24px;
  color: var(--primary);
  letter-spacing: -0.03em;
}
.dn-nav-links {
  display: none;
  gap: 32px;
  align-items: center;
}
@media (min-width: 768px) { .dn-nav-links { display: flex; } }
.dn-nav-links a {
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: var(--on-surface-variant-dim);
  transition: color .15s;
}
.dn-nav-links a:hover { color: var(--on-surface); }
.dn-nav-cta {
  display: flex;
  align-items: center;
  gap: 14px;
}

/* BUTTONS */
.dn-btn-ghost, .dn-btn-primary, .dn-btn-outline {
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;
  border-radius: 2px;
  transition: all .15s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
  padding: 10px 20px;
  border: 1px solid transparent;
}
.dn-btn-ghost {
  display: none;
  background: transparent;
  border-color: rgba(68,70,80,.4);
  color: var(--on-surface-variant-dim);
}
@media (min-width: 768px) { .dn-btn-ghost { display: inline-flex; } }
.dn-btn-ghost:hover {
  color: var(--primary);
  border-color: rgba(178,197,255,.4);
}
.dn-btn-primary {
  background: var(--tertiary);
  color: var(--on-tertiary);
  padding: 10px 24px;
}
.dn-btn-primary:hover { filter: brightness(1.1); }
.dn-btn-outline {
  background: transparent;
  border-color: rgba(68,70,80,.4);
  color: var(--primary);
}
.dn-btn-outline:hover {
  background: rgba(178,197,255,.05);
  border-color: rgba(178,197,255,.4);
}
.dn-btn-lg { padding: 16px 40px; font-size: 12px; }
.dn-btn-sm { padding: 7px 14px; font-size: 10px; letter-spacing: 0.1em; }
.dn-btn-full { width: 100%; padding: 14px; }

/* HERO */
.dn-hero {
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 110px 48px 60px;
  background: linear-gradient(160deg, rgba(178,197,255,.04) 0%, rgba(0,32,91,.06) 60%, transparent 100%);
  overflow: hidden;
}
.dn-glow {
  position: absolute;
  border-radius: 50%;
  pointer-events: none;
  filter: blur(180px);
}
.dn-glow-1 {
  top: 25%;
  left: -130px;
  width: 600px;
  height: 600px;
  background: rgba(178,197,255,.05);
}
.dn-glow-2 {
  bottom: 0;
  right: 0;
  width: 400px;
  height: 400px;
  background: rgba(255,186,44,.05);
  filter: blur(140px);
}
.dn-hero-grid {
  position: relative;
  max-width: 1440px;
  width: 100%;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr;
  gap: 64px;
  align-items: center;
}
@media (min-width: 1024px) {
  .dn-hero-grid { grid-template-columns: 7fr 5fr; }
}
.dn-hero-left { min-width: 0; }
.dn-hero-right { display: none; }
@media (min-width: 1024px) { .dn-hero-right { display: block; } }

.dn-chip-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 32px;
  flex-wrap: wrap;
}
.dn-chip {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  padding: 6px 12px;
  border-radius: 2px;
}
.dn-chip-amber {
  background: var(--tertiary-container);
  border: 1px solid rgba(255,186,44,.2);
  color: var(--tertiary);
}
.dn-chip-label {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--on-surface-variant-dim);
}

.dn-hero-title {
  font-family: 'Newsreader', serif;
  font-size: clamp(2.6rem, 6.5vw, 5rem);
  line-height: 1.05;
  font-weight: 700;
  letter-spacing: -0.025em;
  margin: 0 0 32px;
}
.dn-hero-title-main { color: var(--on-surface); }
.dn-hero-title-accent { color: var(--primary); }
.dn-hero-title-italic {
  font-style: italic;
  color: var(--on-surface-variant);
}
.dn-cursor { color: var(--tertiary); animation: dnBlink 1.1s step-end infinite; }
@keyframes dnBlink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }

.dn-hero-lead {
  font-size: 17px;
  line-height: 1.6;
  color: var(--on-surface-variant);
  max-width: 540px;
  margin-bottom: 14px;
}
.dn-hero-sub {
  font-size: 13px;
  line-height: 1.6;
  color: rgba(197,198,209,.7);
  max-width: 540px;
  margin-bottom: 40px;
}
.dn-hero-cta { display: flex; gap: 14px; flex-wrap: wrap; }

/* Live Analysis Panel */
.dn-glass {
  background: rgba(53,53,52,.6);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(68,70,80,.2);
  border-radius: 12px;
  padding: 30px;
}
.dn-glow-strong { box-shadow: 0 0 40px rgba(255,186,44,.15); }
.dn-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 30px;
}
.dn-label {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--on-surface-variant-dim);
  font-weight: 600;
}
.dn-processing {
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--tertiary);
  font-weight: 700;
}
.dn-live-dot {
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--tertiary);
  animation: dnLiveDot 1.8s ease-in-out infinite;
}
.dn-live-dot.dn-green { background: var(--green); }
@keyframes dnLiveDot {
  0%,100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.5); opacity: 0.6; }
}
.dn-score-block {
  background: var(--surface-container-highest);
  border-radius: 6px;
  padding: 18px;
  margin-bottom: 22px;
}
.dn-primary { color: var(--primary); }
.dn-score {
  font-family: 'Newsreader', serif;
  font-size: 52px;
  font-weight: 700;
  margin: 2px 0;
  font-variant-numeric: tabular-nums;
}
.dn-score-sub { font-size: 10px; color: rgba(197,198,209,.6); }

.dn-bars { display: flex; flex-direction: column; gap: 18px; }
.dn-bar-head {
  display: flex;
  justify-content: space-between;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  margin-bottom: 8px;
  color: var(--on-surface-variant-dim);
}
.dn-bar-val { font-weight: 700; }
.dn-bar-track {
  width: 100%;
  height: 1px;
  background: var(--surface-container);
}
.dn-bar-fill { height: 1px; transition: width 1.5s cubic-bezier(.4,0,.2,1); }
.dn-bg-amber { background: var(--tertiary); }
.dn-bg-blue { background: var(--primary); }
.dn-bg-grey { background: var(--on-surface-variant-dim); }
.dn-bg-green { background: var(--green); }
.dn-bg-amber-dim { background: var(--tertiary-container); }
.dn-bg-blue-dim { background: var(--primary-container); }
.dn-bg-grey-dim { background: var(--surface-container-highest); }

.dn-amber { color: var(--tertiary); }
.dn-blue { color: var(--primary); }
.dn-grey { color: var(--on-surface-variant-dim); }
.dn-green { color: var(--green); }

.dn-bottom-stats {
  margin-top: 30px;
  padding-top: 22px;
  border-top: 1px solid rgba(68,70,80,.2);
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  text-align: center;
}
.dn-bottom-stats .dn-stat-mid { border-left: 1px solid rgba(68,70,80,.2); border-right: 1px solid rgba(68,70,80,.2); }
.dn-stat-val {
  font-family: 'Newsreader', serif;
  font-size: 20px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.dn-stat-lbl {
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  color: var(--on-surface-variant-dim);
  text-transform: uppercase;
  letter-spacing: 0.12em;
  margin-top: 4px;
}

.dn-scroll-hint {
  position: absolute;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  opacity: .4;
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--on-surface-variant-dim);
}
.dn-scroll-line {
  width: 1px;
  height: 40px;
  background: linear-gradient(to bottom, var(--on-surface-variant-dim), transparent);
}

/* TICKER */
.dn-ticker {
  background: var(--surface-container-lowest);
  border-top: 1px solid rgba(68,70,80,.1);
  border-bottom: 1px solid rgba(68,70,80,.1);
  padding: 22px 0;
  overflow: hidden;
}
.dn-ticker-track {
  display: flex;
  width: max-content;
  animation: dnTicker 30s linear infinite;
}
.dn-ticker-track:hover { animation-play-state: paused; }
@keyframes dnTicker {
  0% { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
.dn-ticker-group {
  display: flex;
  gap: 64px;
  padding: 0 32px;
  white-space: nowrap;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--on-surface-variant-dim);
  font-weight: 600;
}
.dn-dim { color: rgba(68,70,80,.4); }

/* SECTIONS */
.dn-section { padding: 130px 48px; }
.dn-section-low { background: var(--surface-container-low); }
.dn-section-lowest { background: var(--surface-container-lowest); }
.dn-section-inner { max-width: 1440px; margin: 0 auto; }

.dn-section-head {
  display: flex;
  flex-direction: column;
  gap: 24px;
  margin-bottom: 60px;
}
@media (min-width: 1024px) {
  .dn-section-head {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
    gap: 48px;
  }
}
.dn-section-title-box { max-width: 640px; }
.dn-section-lede {
  font-size: 15px;
  line-height: 1.65;
  color: var(--on-surface-variant);
  max-width: 520px;
}
.dn-eyebrow {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  letter-spacing: 0.3em;
  text-transform: uppercase;
  margin-bottom: 14px;
  display: block;
  font-weight: 700;
}
.dn-h2 {
  font-size: clamp(2.2rem, 5vw, 3.4rem);
  line-height: 1.1;
}
.dn-h2-sub {
  font-size: 15px;
  line-height: 1.65;
  color: var(--on-surface-variant);
  margin-top: 14px;
  max-width: 520px;
}
.dn-link-arrow {
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--primary);
  border-bottom: 1px solid rgba(178,197,255,.3);
  padding-bottom: 4px;
  transition: all .2s;
  white-space: nowrap;
  flex-shrink: 0;
}
.dn-link-arrow:hover { border-color: var(--primary); padding-bottom: 8px; }

.dn-link-amber {
  background: none;
  border: none;
  padding: 0;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--tertiary);
  text-align: left;
}

/* GRIDS */
.dn-grid-3 { display: grid; grid-template-columns: 1fr; gap: 24px; }
@media (min-width: 768px) { .dn-grid-3 { grid-template-columns: repeat(3, 1fr); } }
.dn-grid-4 { display: grid; grid-template-columns: 1fr; gap: 24px; }
@media (min-width: 768px) { .dn-grid-4 { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1200px) { .dn-grid-4 { grid-template-columns: repeat(4, 1fr); } }
.dn-grid-2 { display: grid; grid-template-columns: 1fr; gap: 24px; }
@media (min-width: 768px) { .dn-grid-2 { grid-template-columns: repeat(2, 1fr); } }
.dn-grid-split { display: grid; grid-template-columns: 1fr; gap: 72px; align-items: center; }
@media (min-width: 1024px) { .dn-grid-split { grid-template-columns: 5fr 7fr; } }

/* CARDS */
.dn-card {
  background: var(--surface-container-highest);
  border-radius: 8px;
  padding: 32px;
  transition: all .3s;
  position: relative;
}
.dn-card:hover {
  background: var(--surface-bright);
  box-shadow: 0 0 32px rgba(255,186,44,.08);
}
.dn-card-glow {
  border: 1px solid rgba(255,186,44,.1);
  box-shadow: 0 0 32px rgba(255,186,44,.08);
}
.dn-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 32px;
}
.dn-card-icon {
  width: 40px; height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dn-card-icon .material-symbols-outlined { font-size: 20px; }
.dn-card-icon-plain {
  display: block;
  margin-bottom: 24px;
  font-size: 28px;
}
.dn-card-pill {
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.dn-card-pill.dn-amber { padding: 4px 10px; background: var(--tertiary-container); border: 1px solid rgba(255,186,44,.2); border-radius: 2px; }
.dn-card-pill.dn-blue::before { content: '●'; color: var(--primary); animation: dnLiveDot 1.8s ease-in-out infinite; }
.dn-card-pill.dn-grey::after { content: '✓'; margin-left: 4px; color: var(--on-surface-variant-dim); }
.dn-card-title {
  font-size: 24px;
  margin-bottom: 14px;
}
.dn-card-title-lg { font-size: 28px; line-height: 1.15; margin-bottom: 14px; }
.dn-card-body {
  font-size: 13px;
  line-height: 1.65;
  color: var(--on-surface-variant);
  margin-bottom: 32px;
}
.dn-card-foot {
  padding-top: 22px;
  border-top: 1px solid rgba(68,70,80,.2);
}
.dn-lbl-mini {
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--on-surface-variant-dim);
  font-weight: 600;
  margin-bottom: 4px;
}
.dn-card-stat {
  font-family: 'Newsreader', serif;
  font-size: 26px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--on-surface);
}
.dn-card-stat-xl {
  font-family: 'Newsreader', serif;
  font-size: 32px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  color: var(--on-surface);
}
.dn-card-wide {
  grid-column: span 1;
  display: flex;
  flex-direction: column;
  gap: 32px;
}
@media (min-width: 1200px) { .dn-card-wide { grid-column: span 2; } }
.dn-card-wide-body { flex: 1; display: flex; flex-direction: column; }
.dn-inline-stats { display: flex; gap: 32px; margin: 16px 0; }
.dn-card-lg { padding: 44px; }
.dn-card-outlined { border: 1px solid rgba(255,186,44,.1); }
.dn-card-glow-orb {
  position: absolute;
  top: 0; right: 0;
  width: 200px; height: 200px;
  background: rgba(178,197,255,.05);
  filter: blur(60px);
  border-radius: 50%;
  pointer-events: none;
}

/* GRADIENT LINE */
.dn-gradient-line {
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(178,197,255,.2), rgba(255,186,44,.25), rgba(178,197,255,.2), transparent);
}

/* ADVISORY */
.dn-advisory-visual {
  position: relative;
  order: 2;
}
@media (min-width: 1024px) { .dn-advisory-visual { order: 1; } }
.dn-advisory-orb {
  position: absolute;
  inset: -20px;
  background: rgba(178,197,255,.05);
  filter: blur(60px);
  border-radius: 50%;
  pointer-events: none;
}
.dn-advisory-card {
  position: relative;
  height: 500px;
  border-radius: 12px;
  overflow: hidden;
  background:
    linear-gradient(135deg, rgba(178,197,255,.1), transparent 60%),
    linear-gradient(to bottom, var(--surface-container), var(--surface-container-low));
  display: flex;
  align-items: flex-end;
  padding: 30px;
}
.dn-advisory-card-row {
  background: rgba(53,53,52,.6);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid rgba(68,70,80,.2);
  border-radius: 12px;
  padding: 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: 100%;
  box-shadow: 0 0 32px rgba(255,186,44,.08);
}
.dn-advisory-card-body {
  font-size: 13px;
  line-height: 1.5;
  color: var(--on-surface);
  margin-top: 2px;
}

.dn-advisory-right { order: 1; }
@media (min-width: 1024px) { .dn-advisory-right { order: 2; } }

.dn-pillars { display: flex; flex-direction: column; gap: 32px; margin-top: 48px; }
.dn-pillar { display: flex; gap: 22px; }
.dn-pillar-icon {
  flex-shrink: 0;
  width: 48px; height: 48px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dn-pillar-icon .material-symbols-outlined { font-size: 22px; color: var(--primary); }
.dn-pillar-icon.dn-bg-amber-dim .material-symbols-outlined { color: var(--tertiary); }
.dn-pillar-icon.dn-bg-grey-dim .material-symbols-outlined { color: var(--on-surface); }
.dn-pillar-title {
  font-family: 'Manrope', sans-serif;
  font-size: 17px;
  font-weight: 700;
  margin-bottom: 8px;
}
.dn-pillar-body {
  font-size: 13px;
  line-height: 1.65;
  color: var(--on-surface-variant);
}
.dn-pillar-divider {
  height: 1px;
  background: rgba(68,70,80,.15);
  margin-left: 70px;
}

/* PIPELINE */
.dn-pipeline-chips { display: flex; gap: 10px; }
.dn-pipeline-chip {
  background: var(--surface-container);
  padding: 8px 14px;
  border-radius: 2px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--on-surface-variant-dim);
  font-weight: 600;
}
.dn-pipeline-grid { display: grid; grid-template-columns: 1fr; gap: 32px; }
@media (min-width: 1024px) { .dn-pipeline-grid { grid-template-columns: 2fr 1fr; } }

.dn-pipeline-feed { display: flex; flex-direction: column; gap: 16px; }
.dn-alert {
  background: var(--surface-container-low);
  border-radius: 8px;
  padding: 24px;
  transition: all .3s;
}
.dn-alert:hover {
  background: var(--surface-bright);
  box-shadow: 0 0 32px rgba(255,186,44,.08);
}
.dn-alert-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 14px;
}
.dn-alert-tag {
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  text-transform: uppercase;
  font-weight: 700;
  letter-spacing: 0.18em;
}
.dn-alert-title {
  font-size: 19px;
  margin-bottom: 8px;
}
.dn-alert-body {
  font-size: 13px;
  line-height: 1.65;
  color: var(--on-surface-variant);
}
.dn-alert-bar { margin-top: 14px; display: flex; align-items: center; gap: 10px; }
.dn-alert-bar-track { flex: 1; height: 4px; background: var(--surface-container-high); }
.dn-alert-bar-fill { height: 4px; }
.dn-alert-grid { margin-top: 14px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.dn-alert-stat {
  font-family: 'Newsreader', serif;
  font-size: 16px;
  font-weight: 700;
}
.dn-alert-foot {
  margin-top: 14px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dn-deal-map {
  background: var(--surface-container-high);
  border-radius: 8px;
  padding: 30px;
}
.dn-deal-map-title {
  font-size: 22px;
  margin-bottom: 28px;
}
.dn-deal-map-viz {
  aspect-ratio: 1/1;
  background: var(--surface-container-lowest);
  border-radius: 8px;
  position: relative;
  overflow: hidden;
  margin-bottom: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dn-deal-map-grid {
  position: absolute; inset: 0;
  opacity: .1;
  background-image: linear-gradient(rgba(178,197,255,.3) 1px, transparent 1px), linear-gradient(90deg, rgba(178,197,255,.3) 1px, transparent 1px);
  background-size: 20px 20px;
}
.dn-deal-map-center {
  position: relative;
  z-index: 2;
  text-align: center;
}
.dn-deal-map-center .material-symbols-outlined {
  color: var(--tertiary);
  font-size: 46px;
  display: block;
  margin-bottom: 6px;
}
.dn-deal-map-center div {
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--on-surface-variant-dim);
}
.dn-map-dot {
  position: absolute;
  border-radius: 50%;
  animation: dnLiveDot 1.8s ease-in-out infinite;
}
.dn-map-dot-1 {
  top: 25%; left: 33%;
  width: 8px; height: 8px;
  background: var(--primary);
  box-shadow: 0 0 8px rgba(178,197,255,.8);
}
.dn-map-dot-2 {
  top: 50%; right: 25%;
  width: 8px; height: 8px;
  background: var(--tertiary);
  box-shadow: 0 0 8px rgba(255,186,44,.8);
  animation-delay: .5s;
}
.dn-map-dot-3 {
  bottom: 33%; left: 25%;
  width: 6px; height: 6px;
  background: rgba(178,197,255,.7);
  box-shadow: 0 0 6px rgba(178,197,255,.6);
  animation-delay: 1s;
}
.dn-region-list { display: flex; flex-direction: column; gap: 18px; }
.dn-region-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
  font-family: 'Inter', sans-serif;
  font-size: 12px;
  color: var(--on-surface-variant-dim);
}
.dn-region-head > span:last-child { font-weight: 700; font-size: 11px; }
.dn-region-bar {
  width: 100%; height: 1px;
  background: var(--surface-container-low);
}
.dn-region-fill { height: 1px; transition: width 1.5s cubic-bezier(.4,0,.2,1); }

/* CTA */
.dn-cta {
  padding: 130px 48px;
  position: relative;
  overflow: hidden;
  background: linear-gradient(135deg, #00205b 0%, #131313 50%, #332100 100%);
}
.dn-cta-glow {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 800px; height: 400px;
  background: rgba(178,197,255,.05);
  filter: blur(120px);
  border-radius: 50%;
  pointer-events: none;
}
.dn-cta-inner {
  position: relative;
  max-width: 1440px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1fr;
  gap: 64px;
  align-items: center;
}
@media (min-width: 1024px) { .dn-cta-inner { grid-template-columns: 1fr 1fr; } }
.dn-cta-features { display: flex; flex-direction: column; gap: 22px; }
.dn-feature {
  padding: 22px;
  display: flex;
  gap: 20px;
  align-items: flex-start;
  border-radius: 12px;
}
.dn-feature-icon {
  width: 32px; height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 2px;
}
.dn-feature-icon .material-symbols-outlined { font-size: 18px; color: var(--primary); }
.dn-feature-icon.dn-bg-amber-dim .material-symbols-outlined { color: var(--tertiary); }
.dn-feature-icon.dn-bg-grey-dim .material-symbols-outlined { color: var(--on-surface); }
.dn-feature-title {
  font-family: 'Manrope', sans-serif;
  font-size: 14px;
  font-weight: 700;
  margin-bottom: 3px;
}
.dn-feature-body {
  font-size: 12px;
  line-height: 1.65;
  color: var(--on-surface-variant);
}

/* FOOTER */
.dn-footer {
  background: var(--surface-container-lowest);
  padding: 64px 0;
  border-top: 1px solid rgba(68,70,80,.1);
}
.dn-footer-inner {
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 48px;
}
.dn-footer-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 48px;
  margin-bottom: 56px;
}
@media (min-width: 768px) { .dn-footer-grid { grid-template-columns: 2fr 1fr 1fr; } }
.dn-footer-brand { max-width: 340px; }
.dn-footer-blurb {
  font-size: 13px;
  line-height: 1.65;
  color: var(--on-surface-variant);
  margin: 16px 0;
}
.dn-footer-heading { margin-bottom: 18px; }
.dn-footer-links { display: flex; flex-direction: column; gap: 14px; }
.dn-footer-links a {
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: var(--on-surface-variant-dim);
  transition: color .15s;
}
.dn-footer-links a:hover { color: var(--primary); }
.dn-footer-bottom {
  padding-top: 30px;
  border-top: 1px solid rgba(68,70,80,.1);
  display: flex;
  flex-direction: column;
  gap: 12px;
  font-family: 'Inter', sans-serif;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: rgba(143,144,155,.5);
}
@media (min-width: 768px) {
  .dn-footer-bottom {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
}

/* FADE ANIMATIONS */
@keyframes dnFadeUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
.fade-up { animation: dnFadeUp 0.7s ease forwards; }
.delay-2 { animation-delay: 0.25s; opacity: 0; }
.pulse { animation: dnPulse 2.5s ease-in-out infinite; }
@keyframes dnPulse { 0%,100% { opacity: .8; } 50% { opacity: 1; } }

/* MODAL */
.dn-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(8,10,14,.75);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  padding: 24px;
  font-family: 'Manrope', 'Inter', sans-serif;
  color: #e5e2e1;
  animation: dnFadeIn .2s ease;
}
@keyframes dnFadeIn { from { opacity: 0; } to { opacity: 1; } }
.dn-modal {
  background: linear-gradient(155deg, rgba(53,53,52,.95) 0%, rgba(19,19,19,.95) 100%);
  backdrop-filter: blur(20px);
  border: 1px solid rgba(68,70,80,.4);
  border-radius: 12px;
  padding: 36px 36px 28px;
  width: 100%;
  max-width: 460px;
  position: relative;
  box-shadow: 0 32px 80px rgba(0,0,0,.6), 0 0 60px rgba(178,197,255,.08);
}
.dn-modal-close {
  position: absolute;
  top: 14px; right: 14px;
  width: 32px; height: 32px;
  border: 1px solid rgba(68,70,80,.4);
  background: transparent;
  color: #c5c6d1;
  font-size: 20px;
  line-height: 1;
  border-radius: 4px;
  cursor: pointer;
  transition: all .15s;
}
.dn-modal-close:hover { color: #ffba2c; border-color: #ffba2c; }
.dn-modal-brand {
  font-family: 'Newsreader', serif;
  font-style: italic;
  font-size: 20px;
  color: #b2c5ff;
  letter-spacing: -0.03em;
  margin-bottom: 6px;
}
.dn-modal-eyebrow {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: #ffba2c;
  font-weight: 700;
  margin-bottom: 10px;
}
.dn-modal-title {
  font-family: 'Newsreader', serif;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.15;
  margin: 0 0 26px;
}
.dn-modal-title em { font-style: italic; color: #b2c5ff; }
.dn-modal-form { display: flex; flex-direction: column; gap: 16px; }
.dn-field { display: flex; flex-direction: column; gap: 6px; }
.dn-field label {
  font-family: 'Inter', sans-serif;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  color: #8f909b;
  font-weight: 600;
}
.dn-field input {
  background: rgba(14,14,14,.6);
  border: 1px solid rgba(68,70,80,.4);
  color: #e5e2e1;
  padding: 12px 14px;
  font-family: inherit;
  font-size: 13px;
  border-radius: 4px;
  outline: none;
  transition: border-color .15s;
}
.dn-field input::placeholder { color: rgba(143,144,155,.5); }
.dn-field input:focus { border-color: #b2c5ff; }
.dn-modal-error {
  background: rgba(255,100,90,.08);
  border: 1px solid rgba(255,100,90,.3);
  color: #ffb4ab;
  padding: 10px 14px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}
.dn-modal-switch {
  text-align: center;
  margin-top: 10px;
  font-family: 'Inter', sans-serif;
  font-size: 11px;
  color: #8f909b;
  letter-spacing: 0.05em;
}
.dn-modal-switch button {
  background: none;
  border: none;
  color: #ffba2c;
  font-family: inherit;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  cursor: pointer;
  padding: 0 0 0 4px;
}
.dn-modal-switch button:hover { text-decoration: underline; }
`
