/**
 * Op Identifier report generator — deterministic HTML output.
 *
 * Given the acquirer, scored/ranked targets, selected targets, plan
 * roll-up, lender match, balance-sheet projection, and placement
 * narrative, compose a multi-section institutional memo in plain HTML
 * that can be previewed in a modal and downloaded as a standalone file.
 *
 * Sections (mirror the existing /reports builder pattern):
 *   1.  Executive Summary
 *   2.  Acquirer Profile
 *   3.  Strategic Framework
 *   4.  Target Portfolio (ranked)
 *   5.  Per-Target Memos (Thesis / Risks / Integration / Valuation)
 *   6.  Acquisition Strategy & Legal Path (per selected target)
 *   7.  Hostile-Takeover Exposure
 *   8.  Acquisition Timeline (3 horizons)
 *   9.  Fund Requirement & Lender Map
 *   10. Balance-Sheet Projection
 *   11. Pre vs Post Firm Placement
 *   12. Risks & Next Steps
 *   13. Methodology appendix
 *
 * Zero external calls. All narrative composed from the scored output.
 */

import type { Company } from '@/lib/data/companies'
import type {
  OpTarget,
  PlanOutput,
  LenderMatch,
  BalanceSheetProjection,
  PlacementNarrative,
  OpInputs,
} from './algorithm'
import { ANSOFF, PORTER, HORIZONS } from './frameworks'

export interface ReportBundle {
  id: string
  title: string
  subtitle: string
  generatedAt: string
  acquirerTicker: string
  html: string
}

function esc(s: string | number | null | undefined): string {
  if (s == null) return ''
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function fmtCr(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '\u20B90 Cr'
  if (Math.abs(n) >= 1_00_000) return `\u20B9${(n / 1_00_000).toFixed(2)} L Cr`
  return `\u20B9${Math.round(n).toLocaleString('en-IN')} Cr`
}

const CSS = `
  :root {
    --ink: #0b1220;
    --muted: #5c6477;
    --gold: #C8A24B;
    --green: #0f9e6e;
    --red: #c7334f;
    --cyan: #0aa5b2;
    --rule: #d9dde3;
    --bg: #ffffff;
    --soft: #f6f7f9;
  }
  * { box-sizing: border-box; }
  body { font-family: 'Source Serif 4', 'Source Serif Pro', Georgia, serif; color: var(--ink); background: var(--bg); margin: 0; padding: 0; }
  .page { max-width: 980px; margin: 0 auto; padding: 28px 36px 80px; }
  .eyebrow { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--muted); font-family: 'JetBrains Mono', monospace; }
  h1, h2, h3 { font-family: 'Source Serif 4', Georgia, serif; font-weight: 700; margin: 0 0 8px; color: var(--ink); }
  h1 { font-size: 28px; letter-spacing: -0.01em; }
  h2 { font-size: 18px; margin-top: 22px; border-top: 2px solid var(--gold); padding-top: 10px; }
  h3 { font-size: 13px; letter-spacing: 0.5px; text-transform: uppercase; color: var(--gold); margin-top: 18px; }
  p { line-height: 1.6; margin: 0 0 10px; color: var(--ink); }
  .muted { color: var(--muted); }
  .grid { display: grid; gap: 10px; }
  .grid-2 { grid-template-columns: 1fr 1fr; }
  .grid-3 { grid-template-columns: repeat(3, 1fr); }
  .grid-4 { grid-template-columns: repeat(4, 1fr); }
  .card { background: var(--soft); border: 1px solid var(--rule); border-radius: 8px; padding: 14px 16px; }
  .stat { font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 18px; color: var(--ink); }
  .stat-lbl { font-size: 9px; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); margin-bottom: 2px; }
  ul { margin: 0 0 10px; padding-left: 20px; line-height: 1.6; }
  li { margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0; }
  th, td { padding: 7px 10px; border-bottom: 1px solid var(--rule); text-align: left; }
  th { background: var(--soft); color: var(--muted); font-size: 10px; letter-spacing: 0.5px; text-transform: uppercase; font-weight: 700; }
  td.num { font-family: 'JetBrains Mono', monospace; text-align: right; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 3px; font-size: 10px; font-weight: 700; letter-spacing: 0.3px; text-transform: uppercase; }
  .pill-gold { background: rgba(200,162,75,0.12); border: 1px solid var(--gold); color: var(--gold); }
  .pill-green { background: rgba(15,158,110,0.12); border: 1px solid var(--green); color: var(--green); }
  .pill-red { background: rgba(199,51,79,0.12); border: 1px solid var(--red); color: var(--red); }
  .pill-cyan { background: rgba(10,165,178,0.12); border: 1px solid var(--cyan); color: var(--cyan); }
  .hero { border-left: 4px solid var(--gold); padding: 10px 14px; background: var(--soft); border-radius: 0 6px 6px 0; }
  .hero em { font-style: italic; color: var(--gold); font-weight: 700; }
  .small { font-size: 10px; color: var(--muted); }
  .rule { height: 1px; background: var(--rule); margin: 18px 0; }
  .section-tag { display: inline-block; padding: 2px 8px; background: var(--ink); color: #fff; border-radius: 3px; font-size: 9px; letter-spacing: 1px; text-transform: uppercase; font-family: 'JetBrains Mono', monospace; font-weight: 700; }
  .tgt { border: 1px solid var(--rule); border-radius: 8px; padding: 14px; margin-top: 12px; background: #fff; }
  .tgt-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; border-bottom: 1px solid var(--rule); padding-bottom: 8px; margin-bottom: 10px; }
  .tgt-name { font-family: 'Source Serif 4', Georgia, serif; font-size: 16px; font-weight: 700; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid var(--gold); font-size: 10px; color: var(--muted); }
`

export interface GenerateReportInput {
  acquirer: Company
  inputs: OpInputs
  selected: OpTarget[]
  /** Entire ranked list (so we can show a compact top-10 overview). */
  allRanked: OpTarget[]
  plan: PlanOutput
  lenders: LenderMatch[]
  balance: BalanceSheetProjection
  placement: PlacementNarrative
  postMktCapEstimate: number
}

export function generateOpReport(input: GenerateReportInput): ReportBundle {
  const { acquirer, inputs, selected, allRanked, plan, lenders, balance, placement } = input
  const nowIso = new Date().toISOString()
  const id = `OPID-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
  const title = `${acquirer.name} \u2014 Inorganic Growth Opportunity Identifier`
  const subtitle = `Target portfolio, acquisition strategy, fund plan, and balance-sheet projection`

  const ansoffMeta = ANSOFF.find((a) => a.id === inputs.ansoff)
  const porterMeta = PORTER.find((p) => p.id === inputs.porter)
  const exposedTargets = selected.filter((s) => s.hostileExposure.exposed)
  const highSeverity = selected.filter((s) => s.hostileExposure.severity === 'high')

  const s1 = `
    <section>
      <div class="eyebrow">SECTION 01</div>
      <h2>Executive Summary</h2>
      <div class="hero">
        <p><strong>${esc(acquirer.name)}</strong> is targeting a revenue goal of <em>${fmtCr(inputs.targetRevenueCr)}</em>
           within <em>${inputs.horizonMonths} months</em> via an inorganic growth programme anchored on a
           <em>${esc(ansoffMeta?.label || inputs.ansoff)}</em> / <em>${esc(porterMeta?.label || inputs.porter)}</em> strategic posture.</p>
      </div>
      <div class="grid grid-4" style="margin-top:12px">
        <div class="card"><div class="stat-lbl">Targets selected</div><div class="stat">${selected.length}</div></div>
        <div class="card"><div class="stat-lbl">Total fund required</div><div class="stat">${fmtCr(plan.totalFundRequiredCr)}</div></div>
        <div class="card"><div class="stat-lbl">Projected revenue</div><div class="stat">${fmtCr(plan.projectedRevCr)}</div></div>
        <div class="card"><div class="stat-lbl">Goal verdict</div><div class="stat">${plan.isGoalAchievable ? '\u2713 Met' : `${fmtCr(Math.abs(plan.gapToGoalCr))} short`}</div></div>
      </div>
      <p style="margin-top:14px">
        Universe scored: <strong>${allRanked.length}</strong> companies against 8 deterministic sub-scores (sector fit,
        deal-size fit, growth, margin, Ansoff fit, Porter fit, policy tailwind, DealNector VC-Taxonomy sub-segment overlap).
        ${plan.isGoalAchievable
          ? `Selected portfolio <strong>reaches</strong> the revenue target inside the horizon.`
          : `Portfolio falls short by <strong>${fmtCr(Math.abs(plan.gapToGoalCr))}</strong>; either relax the deal-size band, extend the horizon, or pick additional targets flagged below.`}
        ${exposedTargets.length > 0 ? `<span class="pill pill-red">${exposedTargets.length} targets flagged for hostile-takeover exposure</span>` : ''}
      </p>
    </section>`

  const s2 = `
    <section>
      <div class="eyebrow">SECTION 02</div>
      <h2>Acquirer Profile</h2>
      <div class="grid grid-3">
        <div class="card"><div class="stat-lbl">Name</div><div class="stat">${esc(acquirer.name)}</div></div>
        <div class="card"><div class="stat-lbl">Ticker</div><div class="stat">${esc(acquirer.ticker)}</div></div>
        <div class="card"><div class="stat-lbl">Sector</div><div class="stat">${esc(acquirer.sec || 'unclassified')}</div></div>
        <div class="card"><div class="stat-lbl">Revenue</div><div class="stat">${fmtCr(acquirer.rev || 0)}</div></div>
        <div class="card"><div class="stat-lbl">EBITDA</div><div class="stat">${fmtCr(acquirer.ebitda || 0)} (${(acquirer.ebm || 0).toFixed(1)}%)</div></div>
        <div class="card"><div class="stat-lbl">Mkt Cap</div><div class="stat">${fmtCr(acquirer.mktcap || 0)}</div></div>
        <div class="card"><div class="stat-lbl">Enterprise Value</div><div class="stat">${fmtCr(acquirer.ev || 0)}</div></div>
        <div class="card"><div class="stat-lbl">Debt / Equity</div><div class="stat">${(acquirer.dbt_eq || 0).toFixed(2)}</div></div>
        <div class="card"><div class="stat-lbl">DealNector Acq Score</div><div class="stat">${acquirer.acqs}/10 \u00b7 ${esc(acquirer.acqf || 'MONITOR')}</div></div>
      </div>
    </section>`

  const s3 = `
    <section>
      <div class="eyebrow">SECTION 03</div>
      <h2>Strategic Framework</h2>
      <h3>Ansoff Matrix Vector</h3>
      <p><strong>${esc(ansoffMeta?.label || inputs.ansoff)}</strong> (risk: ${esc(ansoffMeta?.risk || 'medium')}) \u2014 ${esc(ansoffMeta?.thesis || '')}</p>
      <h3>Porter Generic Strategy</h3>
      <p><strong>${esc(porterMeta?.label || inputs.porter)}</strong> \u2014 ${esc(porterMeta?.thesis || '')}</p>
      <p class="muted" style="margin-top:6px">Target profile: ${esc(porterMeta?.targetProfile || '')}</p>
      <h3>Deal-Size Band</h3>
      <p>${fmtCr(inputs.dealSizeMinCr)} \u2013 ${fmtCr(inputs.dealSizeMaxCr)}; ownership preference per deal: ${esc(inputs.ownership.join(', ') || 'any')}.</p>
    </section>`

  const top10 = allRanked.slice(0, 10)
  const s4 = `
    <section>
      <div class="eyebrow">SECTION 04</div>
      <h2>Target Portfolio \u2014 Top 10 of ${allRanked.length} Scored</h2>
      <table>
        <thead><tr><th>#</th><th>Target</th><th>Conviction</th><th>Structure</th><th>Horizon</th><th class="num">Deal size</th><th class="num">Synergy/yr</th></tr></thead>
        <tbody>
          ${top10.map((t, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${esc(t.name)}</strong> <span class="muted">(${esc(t.ticker)} \u00b7 ${esc(t.sec)})</span></td>
              <td><span class="pill ${t.conviction >= 0.7 ? 'pill-green' : t.conviction >= 0.5 ? 'pill-gold' : ''}">${(t.conviction * 100).toFixed(0)}%</span></td>
              <td>${esc(t.dealStructureLabel)}</td>
              <td class="small">${esc(t.horizon.label)}</td>
              <td class="num">${fmtCr(t.dealSizeCr)}</td>
              <td class="num">${fmtCr(t.synergy.totalCr)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </section>`

  const renderTarget = (t: OpTarget, idx: number) => `
    <div class="tgt">
      <div class="tgt-head">
        <div>
          <span class="section-tag">Target ${idx + 1}</span>
          <div class="tgt-name">${esc(t.name)} <span class="muted" style="font-size:12px;font-weight:400">(${esc(t.ticker)})</span></div>
          <div class="small">${esc(t.sec)} \u00b7 Conviction <strong>${(t.conviction * 100).toFixed(0)}%</strong> \u00b7 Horizon ${esc(t.horizon.label)}</div>
        </div>
        <div>
          <span class="pill pill-gold">BCG ${esc(t.bcg)}</span>
          <span class="pill pill-cyan">McK ${esc(t.mckinsey.replace(/_/g, ' '))}</span>
          <span class="pill pill-green">${esc(t.dealStructureLabel)}</span>
          ${t.hostileExposure.exposed ? `<span class="pill pill-red">\u26a0 Hostile \u00b7 ${esc(t.hostileExposure.severity)}</span>` : ''}
        </div>
      </div>
      <div class="grid grid-2">
        <div>
          <h3>Thesis</h3>
          <ul>${t.memo.thesis.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          <h3>Top Risks</h3>
          <ul>${t.memo.risks.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        </div>
        <div>
          <h3>Integration Plan</h3>
          <ul>${t.memo.integration.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          <h3>Valuation</h3>
          <ul>${t.memo.valuation.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
        </div>
      </div>
      ${t.overlappingSubSegments.length > 0 ? `
        <h3>Sub-segment overlap</h3>
        <div>${t.overlappingSubSegments.map((s) => `<span class="pill pill-gold" style="margin-right:4px;margin-bottom:4px">${esc(s.label)}</span>`).join('')}</div>
      ` : ''}
      ${t.policyTailwinds.length > 0 ? `
        <h3>Policy tailwinds</h3>
        <div>${t.policyTailwinds.map((p) => `<span class="pill pill-green" style="margin-right:4px;margin-bottom:4px" title="${esc(p.name)}">${esc(p.short)}</span>`).join('')}</div>
      ` : ''}
    </div>`

  const s5 = selected.length === 0 ? '' : `
    <section>
      <div class="eyebrow">SECTION 05</div>
      <h2>Selected-Target Memos</h2>
      ${selected.map((t, i) => renderTarget(t, i)).join('')}
    </section>`

  const s6 = selected.length === 0 ? '' : `
    <section>
      <div class="eyebrow">SECTION 06</div>
      <h2>Acquisition Strategy &amp; Legal Path</h2>
      ${selected.map((t) => `
        <div class="tgt">
          <div class="tgt-head">
            <div>
              <div class="tgt-name">${esc(t.name)}</div>
              <div class="small">Promoter stake (proxy): <strong>${t.shareholding.promoterPct}%</strong> \u2014 band: <strong>${esc(t.shareholding.band)}</strong>. Public float: ${t.shareholding.publicFloatPct}%.</div>
            </div>
            <div>
              <span class="pill pill-gold">${esc(t.acquisitionStrategy.label)}</span>
            </div>
          </div>
          <h3>Execution Steps</h3>
          <ol>${t.acquisitionStrategy.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
          <h3>Legal Considerations</h3>
          <ul>${t.acquisitionStrategy.legal.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
          <h3>Shareholding Notes</h3>
          <ul>${t.shareholding.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
        </div>
      `).join('')}
    </section>`

  const s7 = selected.length === 0 ? '' : `
    <section>
      <div class="eyebrow">SECTION 07</div>
      <h2>Hostile-Takeover Exposure</h2>
      ${exposedTargets.length === 0 ? '<p class="muted">None of the selected targets show material hostile-takeover exposure \u2014 promoter stakes are tight enough to require negotiated consent.</p>' : `
        <p>${exposedTargets.length} of ${selected.length} selected targets are exposed to hostile accumulation.
           ${highSeverity.length > 0 ? `<strong>${highSeverity.length}</strong> show <span class="pill pill-red">high severity</span>.` : ''}
           Below is the per-target assessment and SEBI SAST implication summary.</p>
        ${exposedTargets.map((t) => `
          <div class="tgt">
            <div class="tgt-head">
              <div>
                <div class="tgt-name">${esc(t.name)}</div>
                <div class="small">Promoter ${t.shareholding.promoterPct}% \u00b7 float ${t.shareholding.publicFloatPct}% \u00b7 severity <strong>${esc(t.hostileExposure.severity)}</strong></div>
              </div>
              <div><span class="pill pill-red">EXPOSED</span></div>
            </div>
            <h3>Exposure Triggers</h3>
            <ul>${t.hostileExposure.triggers.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
            <h3>SEBI SAST Notes</h3>
            <ul>${t.hostileExposure.sastNotes.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
          </div>
        `).join('')}
      `}
    </section>`

  const s8 = `
    <section>
      <div class="eyebrow">SECTION 08</div>
      <h2>Acquisition Timeline</h2>
      <div class="grid grid-3">
        ${HORIZONS.map((h) => {
          const inBand = selected.filter((s) => s.horizon.id === h.id)
          const fund = inBand.reduce((s, t) => s + t.dealSizeCr, 0)
          const rev = inBand.reduce((s, t) => s + t.revCr, 0)
          return `
            <div class="card">
              <div class="stat-lbl">${esc(h.label)}</div>
              <div class="stat">${inBand.length} deals</div>
              <div class="small">${fmtCr(fund)} deployed \u00b7 +${fmtCr(rev)} revenue</div>
              ${inBand.length > 0 ? `<ul style="margin-top:6px">${inBand.map((t) => `<li>${esc(t.name)}</li>`).join('')}</ul>` : ''}
            </div>`
        }).join('')}
      </div>
    </section>`

  const topLenders = lenders.slice(0, 4)
  const s9 = `
    <section>
      <div class="eyebrow">SECTION 09</div>
      <h2>Fund Requirement &amp; Lender Map</h2>
      <p>Aggregate fund requirement across selected targets: <strong>${fmtCr(plan.totalFundRequiredCr)}</strong>.
         Recommended capital stack below orders lenders by deterministic fit scoring against deal size, structure mix,
         and acquirer leverage profile.</p>
      <table>
        <thead><tr><th>Rank</th><th>Lender / Source</th><th class="num">Fit</th><th>Thesis</th></tr></thead>
        <tbody>
          ${topLenders.map((l, i) => `
            <tr>
              <td>${i + 1}</td>
              <td><strong>${esc(l.label)}</strong></td>
              <td class="num">${l.fitPct}%</td>
              <td class="small">${esc(l.thesis)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
      <p class="small muted">Typical blended cost of capital: 9.5\u201311% depending on lender mix and acquirer IG rating.</p>
    </section>`

  const coverageNote = balance.interestCoverageX == null
    ? 'Interest coverage not computable (EBITDA baseline missing).'
    : `Interest coverage post-close: <strong>${balance.interestCoverageX.toFixed(1)}\u00d7</strong> \u2014 ${balance.interestCoverageX >= 3 ? 'comfortable' : balance.interestCoverageX >= 1.8 ? 'manageable' : 'tight; renegotiate covenants'}.`
  const s10 = `
    <section>
      <div class="eyebrow">SECTION 10</div>
      <h2>Balance-Sheet Projection</h2>
      <div class="grid grid-4">
        <div class="card"><div class="stat-lbl">Pre-deal D/E</div><div class="stat">${balance.preDebtToEquity.toFixed(2)}\u00d7</div></div>
        <div class="card"><div class="stat-lbl">Post-deal D/E</div><div class="stat">${balance.postDebtToEquity.toFixed(2)}\u00d7</div></div>
        <div class="card"><div class="stat-lbl">Interest coverage</div><div class="stat">${balance.interestCoverageX != null ? balance.interestCoverageX.toFixed(1) + '\u00d7' : '\u2014'}</div></div>
        <div class="card"><div class="stat-lbl">Cash gap</div><div class="stat">${fmtCr(balance.cashGapCr)}</div></div>
      </div>
      <p style="margin-top:12px">${coverageNote}</p>
      <p><strong>Verdict:</strong> ${esc(balance.verdict)}</p>
      <p class="small muted">Assumption: 70% debt / 30% equity financing mix for the deal stack. Target EBITDA fully consolidated from closing date.</p>
    </section>`

  const s11 = `
    <section>
      <div class="eyebrow">SECTION 11</div>
      <h2>Pre vs Post Firm Placement</h2>
      <div class="grid grid-2">
        <div class="card">
          <div class="stat-lbl">Pre-deal</div>
          <div class="stat">${esc(placement.preMktCapBand)}</div>
          <div class="small" style="margin-top:6px">${esc(placement.preRevRankApprox)}</div>
        </div>
        <div class="card">
          <div class="stat-lbl">Post-deal (estimate)</div>
          <div class="stat">${esc(placement.postMktCapBand)}</div>
          <div class="small" style="margin-top:6px">${esc(placement.postRevRankApprox)}</div>
        </div>
      </div>
      <div style="margin-top:12px">
        ${placement.narrative.map((n) => `<p>${esc(n)}</p>`).join('')}
      </div>
    </section>`

  const s12 = `
    <section>
      <div class="eyebrow">SECTION 12</div>
      <h2>Risks &amp; Next Steps</h2>
      <h3>Programme-level risks</h3>
      <ul>
        <li>Integration execution risk compounds across simultaneous deals \u2014 stagger closings by at least 60 days.</li>
        <li>Interest-rate cycle exposure given ${(balance.postDebtToEquity).toFixed(1)}\u00d7 D/E post-close.</li>
        <li>Regulatory clock: CCI filings add 30\u201390 days per deal above the thresholds.</li>
        ${exposedTargets.length > 0 ? `<li>${exposedTargets.length} hostile-exposed targets \u2014 competing bidder risk; consider SPA exclusivity + break fees.</li>` : ''}
      </ul>
      <h3>30-day next steps</h3>
      <ol>
        <li>Board memo + IC approval for the shortlist of ${selected.length} targets.</li>
        <li>Outreach to top-3 lender relationships to lock indicative term sheets.</li>
        <li>Engage counsel (corporate, tax, antitrust) on the structure recommendation per target.</li>
        <li>Commission commercial DD (customer, supplier, operations) on the near-horizon target(s).</li>
        <li>Pre-alert SEBI and RBI on any inbound FDI involvement for the programme.</li>
      </ol>
    </section>`

  const s13 = `
    <section>
      <div class="eyebrow">APPENDIX</div>
      <h2>Methodology</h2>
      <p class="small muted">Scoring is deterministic: 8 sub-axes (sector fit 0.18, size fit 0.16, growth 0.14, margin 0.12, Ansoff 0.10, Porter 0.08, policy tailwind 0.10, sub-segment overlap 0.12). BCG quadrant via growth \u00d7 margin split at 15%/12%. McKinsey horizon via sector + comp overlap. Haspeslagh\u2013Jemison integration via size ratio + interdependence proxy. Deal structure recommended per integration mode + Focus tilt + distressed signal. Synergy estimate: 3% of target revenue + 1% of acquirer revenue (revenue synergy) + 2% of target EBITDA + 0.5% of target revenue (cost synergy). Valuation triangulation against live sector-median EV/EBITDA computed from the universe at report time. All framework data sourced from the DealNector company database \u2014 no external calls. Report ID: ${esc(id)}.</p>
    </section>`

  const html = `
    <!DOCTYPE html>
    <html lang="en"><head>
      <meta charset="utf-8" />
      <title>${esc(title)}</title>
      <style>${CSS}</style>
    </head><body>
      <div class="page">
        <div class="eyebrow">DealNector \u00b7 Institutional Report</div>
        <h1>${esc(acquirer.name)} \u2014 <em>Op Identifier</em> Report</h1>
        <p class="muted">${esc(subtitle)}</p>
        <p class="small muted">Generated ${esc(new Date(nowIso).toLocaleString('en-IN'))} \u00b7 Report ID ${esc(id)}</p>
        <div class="rule"></div>
        ${s1}${s2}${s3}${s4}${s5}${s6}${s7}${s8}${s9}${s10}${s11}${s12}${s13}
        <div class="footer">
          <strong>Confidential \u00b7 DealNector Institutional Intelligence.</strong>
          This report is an illustrative analytical artefact generated from
          the DealNector company database and rule-based frameworks. It is
          not investment advice and must not be the sole basis for any
          transaction decision.
        </div>
      </div>
    </body></html>`

  return {
    id,
    title,
    subtitle,
    generatedAt: nowIso,
    acquirerTicker: acquirer.ticker,
    html,
  }
}
