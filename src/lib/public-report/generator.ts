/**
 * Renders a self-contained institutional-style HTML report for the
 * public landing-page flow. Output is a single string of HTML5 that
 * can be:
 *
 *   • embedded in the preview modal's <iframe srcDoc=...>
 *   • saved to disk as a .html file via the download endpoint
 *   • printed to PDF by the browser (File → Print → Save as PDF)
 *
 * The report is purely illustrative and derives from the static
 * snapshot we ship (CHAIN, COMPANIES, sub-segments taxonomy,
 * atlas-seed). We deliberately don't route it through the paid-tier
 * /report/[ticker] page — that one requires auth, RapidAPI keys, and
 * hits live pricing endpoints. The landing-page sample is faster,
 * always renders, and shows qualitative + numeric context for the
 * selected industry / value-chain / sub-value-chain.
 *
 * Every report carries a bold DISCLAIMER banner at the top and
 * bottom as required by the product brief:
 *   "This report may not be an accurate representation of reality
 *    and should not be used for any financial transaction or
 *    investment decision."
 */

import { CHAIN, type ChainNode } from '@/lib/data/chain'
import { COMPANIES, type Company } from '@/lib/data/companies'
import { findIndustry, findValueChain, findSubSegment } from './catalog'

const DISCLAIMER_FULL =
  'This report may not be an accurate representation of reality and should not be used for any financial transaction or investment decision. DealNector sample report — for illustrative purposes only.'
const DISCLAIMER_SHORT =
  'Illustrative only — not investment advice. See full disclaimer on the cover page.'

export interface ReportInput {
  reportId: string
  generatedAt: Date
  industryId: string
  valueChainId?: string | null
  subSegmentId?: string | null
  companyTicker?: string | null
  user: {
    name: string
    email: string
    organization?: string | null
    purpose?: string | null
  }
  requesterIp?: string | null
  requesterLocation?: string | null
}

export interface ReportBundle {
  html: string
  title: string
  industryLabel: string
  subjectLabel: string // most specific scope picked (sub-seg > vc > industry)
}

export function generateReportHtml(input: ReportInput): ReportBundle {
  const industry = findIndustry(input.industryId)
  if (!industry) {
    throw new Error(`Unknown industry: ${input.industryId}`)
  }
  const vcHit = input.valueChainId ? findValueChain(input.industryId, input.valueChainId) : null
  const vc = vcHit?.vc ?? null
  const sub =
    input.subSegmentId && input.valueChainId
      ? findSubSegment(input.industryId, input.valueChainId, input.subSegmentId)
      : null

  const subjectLabel = sub?.name || vc?.name || industry.label
  const title = `${industry.label} — ${subjectLabel} Sample Report`

  const company =
    input.companyTicker
      ? COMPANIES.find((c) => c.ticker.toUpperCase() === input.companyTicker!.toUpperCase()) || null
      : null

  // Collect CHAIN nodes relevant to the scope so we can cite numeric
  // market size / margins even when the user hasn't picked a company.
  const relevantChain = pickRelevantChain(industry.id, vc?.name || '')

  // Relevant companies pool: scope down to the selected value chain
  // first, then fall back to the whole industry.
  const vcCompanies = vc?.companies || []
  const industryCompanies = industry.valueChains.flatMap((v) => v.companies)
  const companyPool = (vcCompanies.length > 0 ? vcCompanies : industryCompanies).slice(0, 8)

  const numericPeers = COMPANIES.filter((c) => c.sec === industry.id).slice(0, 6)

  const generatedAtStr = input.generatedAt.toISOString()
  const generatedPretty = formatDate(input.generatedAt)

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="report-id" content="${escapeHtml(input.reportId)}"/>
<meta name="generated-at" content="${escapeHtml(generatedAtStr)}"/>
<style>${reportCss()}</style>
</head>
<body>
<main class="rpt">

  ${disclaimerBanner('top')}

  <header class="cover">
    <div class="cover-kicker">DealNector · Sample Intelligence Report</div>
    <h1 class="cover-title">${escapeHtml(industry.label)}</h1>
    <div class="cover-sub">${escapeHtml(subjectLabel)}${company ? ` · ${escapeHtml(company.name)}` : ''}</div>
    <div class="cover-meta">
      <div><span class="k">Report ID</span><span class="v mono">${escapeHtml(input.reportId)}</span></div>
      <div><span class="k">Generated</span><span class="v">${escapeHtml(generatedPretty)}</span></div>
      <div><span class="k">Prepared for</span><span class="v">${escapeHtml(input.user.name)}${input.user.organization ? ` · ${escapeHtml(input.user.organization)}` : ''}</span></div>
      <div><span class="k">Requester IP</span><span class="v mono">${escapeHtml(input.requesterIp || '—')}${input.requesterLocation ? ' · ' + escapeHtml(input.requesterLocation) : ''}</span></div>
    </div>
    <div class="cover-disclaimer">
      <strong>DISCLAIMER.</strong> ${escapeHtml(DISCLAIMER_FULL)}
    </div>
  </header>

  <section class="sec">
    <h2>1 · Executive Summary</h2>
    <p>${escapeHtml(industry.description || 'Industry overview unavailable.')}</p>
    ${vc ? `<p><strong>Value-chain focus.</strong> ${escapeHtml(vc.name)} — ${vc.subSegments.length.toLocaleString()} mapped sub-segments, ${vc.companies.length.toLocaleString()} tracked companies.</p>` : ''}
    ${sub ? `<p><strong>Sub-segment.</strong> ${escapeHtml(sub.name)} (taxonomy code ${escapeHtml(sub.code)}).</p>` : ''}
    ${company ? companyHeadlineBlock(company) : ''}
  </section>

  ${relevantChain.length > 0 ? marketSizingSection(relevantChain) : ''}

  ${vc ? valueChainSection(vc) : ''}

  ${companyPool.length > 0 ? companyLandscapeSection(companyPool) : ''}

  ${numericPeers.length > 0 ? peerNumbersSection(numericPeers, industry.label) : ''}

  ${company ? companyDeepDiveSection(company) : ''}

  <section class="sec">
    <h2>7 · Methodology &amp; Data Sources</h2>
    <ul class="meth">
      <li>Value-chain + sub-segment taxonomy — DealNector VC-Taxonomy (Apr 2026 release, 15 industries · 668 sub-segments).</li>
      <li>Industry coverage seed — internal atlas with ${industryCompanies.length.toLocaleString()} companies mapped to this industry's stages.</li>
      <li>Numeric metrics (mkt cap, revenue, EBITDA, EV/EBITDA, debt/equity, margins, acquisition score) — curated snapshot from NSE / Screener.in, last refreshed by the platform admin.</li>
      <li>Market size &amp; CAGR estimates — blended view from IEA/BNEF (global), CEA/CEA-NEP, MNRE/SECI (India) and industry association data.</li>
      <li>Acquisition fit score (0–10) — DealNector heuristic combining size, margin profile, shareholding structure, and strategic fit.</li>
    </ul>
    <p class="fineprint">Everything above is a <em>snapshot</em>. Numbers drift daily — for live peer pricing, DCF, CRVI scoring, news-adjusted intrinsic value and synergy NPV, request full access to the DealNector platform.</p>
  </section>

  ${disclaimerBanner('bottom')}

  <footer class="footer">
    <div class="footer-left">
      <div class="footer-brand">DealNector</div>
      <div>dealnector.com · M&amp;A Intelligence Platform</div>
    </div>
    <div class="footer-right">
      <div>Report ID <span class="mono">${escapeHtml(input.reportId)}</span></div>
      <div>${escapeHtml(generatedPretty)}</div>
    </div>
  </footer>

</main>
</body>
</html>`

  return {
    html,
    title,
    industryLabel: industry.label,
    subjectLabel,
  }
}

// ── Sub-sections ────────────────────────────────────────────────────

function companyHeadlineBlock(c: Company): string {
  return `
    <div class="ch-card">
      <div class="ch-head">
        <div class="ch-name">${escapeHtml(c.name)}</div>
        <div class="ch-tkr mono">${escapeHtml(c.ticker)}</div>
      </div>
      <div class="ch-grid">
        ${kpi('Market Cap', formatCr(c.mktcap))}
        ${kpi('Revenue (FY)', formatCr(c.rev))}
        ${kpi('EBITDA', formatCr(c.ebitda))}
        ${kpi('EV / EBITDA', c.ev_eb ? c.ev_eb.toFixed(1) + 'x' : '—')}
        ${kpi('P/E', c.pe ? c.pe.toFixed(1) + 'x' : '—')}
        ${kpi('Debt / Equity', c.dbt_eq?.toFixed(2) ?? '—')}
        ${kpi('Revenue Growth', c.revg != null ? c.revg.toFixed(0) + '%' : '—')}
        ${kpi('EBITDA Margin', c.ebm != null ? c.ebm.toFixed(1) + '%' : '—')}
        ${kpi('Acq. Score', c.acqs != null ? c.acqs + ' / 10' : '—')}
        ${kpi('Signal', c.acqf || '—')}
      </div>
    </div>`
}

function marketSizingSection(chain: ChainNode[]): string {
  const rows = chain
    .map(
      (n) => `<tr>
        <td>${escapeHtml(n.name)}</td>
        <td>${escapeHtml(n.mkt.ig)}</td>
        <td>${escapeHtml(n.mkt.icagr)}</td>
        <td>${escapeHtml(n.mkt.gg)}</td>
        <td>${escapeHtml(n.mkt.gcagr)}</td>
        <td>${escapeHtml(n.fin.gm)}</td>
        <td>${escapeHtml(n.fin.eb)}</td>
      </tr>`
    )
    .join('')
  return `
  <section class="sec">
    <h2>2 · Market Sizing &amp; Margins</h2>
    <p>Bottom-up India &amp; global TAM estimates for each stage in scope. Figures are representative — source mix on p.7.</p>
    <div class="tw"><table>
      <thead><tr>
        <th>Stage</th>
        <th>India TAM</th><th>India CAGR</th>
        <th>Global TAM</th><th>Global CAGR</th>
        <th>Gross Margin</th><th>EBITDA Margin</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="insight-row">
      ${chain
        .slice(0, 4)
        .map(
          (n) => `<div class="insight">
          <div class="in-head">${escapeHtml(n.name)}</div>
          <div class="in-body"><strong>India status.</strong> ${escapeHtml(n.mkt.ist)}</div>
          <div class="in-body"><strong>Global concentration.</strong> ${escapeHtml(n.mkt.gc)}</div>
          <div class="in-body"><strong>Moat.</strong> ${escapeHtml(n.fin.moat)}</div>
        </div>`
        )
        .join('')}
    </div>
  </section>`
}

function valueChainSection(vc: import('./catalog').CatalogValueChain): string {
  return `
  <section class="sec">
    <h2>3 · Value-Chain &amp; Sub-Segment Map</h2>
    <p>Sub-segments in <strong>${escapeHtml(vc.name)}</strong> from the DealNector VC-Taxonomy. Each row is a
    distinct product or service line that can anchor an acquisition thesis or organic capex plan.</p>
    ${
      vc.subSegments.length > 0
        ? `<div class="tw"><table>
        <thead><tr><th>Code</th><th>Sub-segment</th></tr></thead>
        <tbody>
          ${vc.subSegments
            .map(
              (s) =>
                `<tr><td class="mono">${escapeHtml(s.code)}</td><td>${escapeHtml(s.name)}</td></tr>`
            )
            .join('')}
        </tbody>
      </table></div>`
        : `<p class="fineprint">No formal sub-segment taxonomy shipped for this stage yet — request full access to see the DealNector analyst's working list.</p>`
    }
  </section>`
}

function companyLandscapeSection(list: import('./catalog').CatalogCompany[]): string {
  return `
  <section class="sec">
    <h2>4 · Competitive Landscape</h2>
    <p>Representative set of companies we track at this stage. Entries marked with a ★ have curated numeric profiles
    available inside the DealNector platform.</p>
    <div class="tw"><table>
      <thead><tr><th>Company</th><th>Ticker</th><th>Role</th><th>Status</th></tr></thead>
      <tbody>
        ${list
          .map(
            (c) => `<tr>
            <td>${c.hasNumbers ? '★ ' : ''}${escapeHtml(c.name)}</td>
            <td class="mono">${escapeHtml(c.ticker || '—')}</td>
            <td>${escapeHtml(c.role || '—')}</td>
            <td>${escapeHtml(c.status || '—')}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table></div>
  </section>`
}

function peerNumbersSection(peers: Company[], industryLabel: string): string {
  return `
  <section class="sec">
    <h2>5 · Peer Financials Snapshot</h2>
    <p>Curated peer set for ${escapeHtml(industryLabel)}. Figures are the platform's last-published snapshot.</p>
    <div class="tw"><table class="tbl-num">
      <thead><tr>
        <th>Company</th><th>Mkt Cap</th><th>Revenue</th><th>EBITDA</th>
        <th>EV/EBITDA</th><th>P/E</th><th>Rev Gr</th><th>EBITDA %</th><th>Acq</th>
      </tr></thead>
      <tbody>
        ${peers
          .map(
            (c) => `<tr>
            <td><strong>${escapeHtml(c.name)}</strong><br><span class="muted mono">${escapeHtml(c.ticker)}</span></td>
            <td>${formatCr(c.mktcap)}</td>
            <td>${formatCr(c.rev)}</td>
            <td>${formatCr(c.ebitda)}</td>
            <td>${c.ev_eb ? c.ev_eb.toFixed(1) + 'x' : '—'}</td>
            <td>${c.pe ? c.pe.toFixed(1) + 'x' : '—'}</td>
            <td>${c.revg != null ? c.revg.toFixed(0) + '%' : '—'}</td>
            <td>${c.ebm != null ? c.ebm.toFixed(1) + '%' : '—'}</td>
            <td>${c.acqs}/10 ${badge(c.acqf)}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table></div>
  </section>`
}

function companyDeepDiveSection(c: Company): string {
  return `
  <section class="sec">
    <h2>6 · Deep Dive — ${escapeHtml(c.name)}</h2>
    <p><strong>Thesis.</strong> ${escapeHtml(c.rea || '—')}</p>
    <div class="insight-row">
      <div class="insight">
        <div class="in-head">Size &amp; liquidity</div>
        <div class="in-body">Market cap <strong>${formatCr(c.mktcap)}</strong>, revenue <strong>${formatCr(c.rev)}</strong>, EV/EBITDA <strong>${c.ev_eb.toFixed(1)}x</strong>.</div>
      </div>
      <div class="insight">
        <div class="in-head">Profitability</div>
        <div class="in-body">EBITDA margin <strong>${c.ebm.toFixed(1)}%</strong>, P/E <strong>${c.pe.toFixed(1)}x</strong>, P/B <strong>${c.pb.toFixed(1)}x</strong>.</div>
      </div>
      <div class="insight">
        <div class="in-head">Balance sheet</div>
        <div class="in-body">Debt / Equity <strong>${c.dbt_eq.toFixed(2)}</strong>. Revenue growth <strong>${c.revg.toFixed(0)}%</strong> YoY.</div>
      </div>
      <div class="insight">
        <div class="in-head">Acquisition fit</div>
        <div class="in-body">DealNector score <strong>${c.acqs}/10</strong> — signal <strong>${escapeHtml(c.acqf)}</strong>.</div>
      </div>
    </div>
    <p class="fineprint">Full DCF, comparables football-field, CRVI score, news-adjusted intrinsic value and synergy NPV are available to authenticated users on the platform's <code>/report/${escapeHtml(c.ticker)}</code> page.</p>
  </section>`
}

// ── Utilities ──────────────────────────────────────────────────────

function pickRelevantChain(industryId: string, vcName: string): ChainNode[] {
  const norm = (s: string) => s.toLowerCase().replace(/[\s,_&\-/]+/g, '')
  const target = norm(vcName)
  const forIndustry = CHAIN.filter((n) => n.sec === industryId)
  if (forIndustry.length === 0) return []
  if (!vcName) return forIndustry.slice(0, 6)
  const matched = forIndustry.filter((n) => {
    const cat = norm(n.cat)
    return cat.includes(target) || target.includes(cat)
  })
  return (matched.length > 0 ? matched : forIndustry).slice(0, 6)
}

function kpi(label: string, value: string): string {
  return `<div class="kpi"><div class="kl">${escapeHtml(label)}</div><div class="kv">${escapeHtml(value)}</div></div>`
}

function badge(signal: string | null | undefined): string {
  if (!signal) return ''
  const s = signal.toUpperCase()
  let cls = 'bd-gray'
  if (s.includes('STRONG')) cls = 'bd-green'
  else if (s.includes('CONSIDER')) cls = 'bd-gold'
  else if (s.includes('MONITOR')) cls = 'bd-blue'
  else if (s.includes('PASS') || s.includes('PREMIUM')) cls = 'bd-red'
  return ` <span class="bd ${cls}">${escapeHtml(s)}</span>`
}

function formatCr(cr: number | null | undefined): string {
  if (cr == null || isNaN(cr)) return '—'
  if (cr >= 100000) return `₹${(cr / 100000).toFixed(2)} L.Cr`
  if (cr >= 1000) return `₹${(cr / 1000).toFixed(1)}k Cr`
  return `₹${cr.toFixed(0)} Cr`
}

function formatDate(d: Date): string {
  return d.toLocaleString('en-IN', {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  })
}

function escapeHtml(s: string | null | undefined): string {
  if (s == null) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function disclaimerBanner(pos: 'top' | 'bottom'): string {
  const msg = pos === 'top' ? DISCLAIMER_FULL : DISCLAIMER_SHORT
  return `<div class="disc disc-${pos}">${escapeHtml(msg)}</div>`
}

// ── Report CSS (kept inline so the output is fully portable) ───────

function reportCss(): string {
  return `
  :root{
    --ink:#051C2C; --ink2:#0A2340; --body:#1E2B3D; --muted:#5B6676;
    --accent:#C25E10; --accent2:#E27625; --accentBg:#FBE9D3;
    --red:#B4252B; --red-bg:#FCE9EA; --green:#0B6B3A; --green-bg:#DEF3E5;
    --blue:#15456E; --blue-bg:#E1ECF5; --gold:#8A6A0A; --gold-bg:#FBEFCC;
    --rule:#E4DFD2; --cream:#F7F4EC;
  }
  *{box-sizing:border-box}
  body{margin:0;padding:0;background:#F2EEE4;color:var(--body);font:14px/1.55 'Helvetica Neue',Arial,sans-serif}
  .rpt{max-width:920px;margin:0 auto;padding:24px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
  .mono{font-family:'SF Mono','Roboto Mono',Menlo,Consolas,monospace}
  .muted{color:var(--muted)}
  h1,h2,h3{font-family:Georgia,serif;color:var(--ink);margin:0}
  /* Disclaimer banners */
  .disc{border:1px solid var(--red);background:var(--red-bg);color:var(--red);
        padding:10px 14px;border-radius:4px;font-weight:600;font-size:12px;letter-spacing:0.3px;
        text-transform:uppercase;margin:12px 0}
  .disc-top{font-size:11.5px}
  .disc-bottom{margin-top:32px}
  /* Cover */
  .cover{border:1px solid var(--rule);padding:24px;border-radius:4px;background:var(--cream)}
  .cover-kicker{font-size:11px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);font-weight:700}
  .cover-title{font-size:28px;margin-top:8px;line-height:1.1}
  .cover-sub{font-size:16px;color:var(--ink2);margin-top:6px}
  .cover-meta{margin-top:18px;display:grid;grid-template-columns:repeat(2,1fr);gap:8px 18px;font-size:13px}
  .cover-meta .k{color:var(--muted);display:block;font-size:11px;letter-spacing:0.5px;text-transform:uppercase}
  .cover-meta .v{font-weight:600}
  .cover-disclaimer{margin-top:16px;padding:10px 12px;border-left:3px solid var(--red);background:#fff;font-size:12px;color:var(--ink2)}
  /* Sections */
  .sec{margin-top:26px;padding:18px 0;border-top:1px solid var(--rule)}
  .sec h2{font-size:18px;color:var(--ink);margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--accent);display:inline-block}
  .sec p{margin:10px 0}
  /* Company headline card */
  .ch-card{border:1px solid var(--rule);border-radius:4px;padding:14px;margin-top:10px;background:#fff}
  .ch-head{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid var(--rule);padding-bottom:8px}
  .ch-name{font-size:18px;font-weight:700;color:var(--ink)}
  .ch-tkr{color:var(--accent);font-weight:700}
  .ch-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:10px}
  .kpi{border:1px solid var(--rule);padding:8px;border-radius:3px;background:#fafaf6}
  .kpi .kl{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.5px}
  .kpi .kv{font-size:14px;font-weight:700;color:var(--ink);margin-top:2px}
  /* Tables */
  .tw{overflow-x:auto;border:1px solid var(--rule);border-radius:3px}
  table{width:100%;border-collapse:collapse;font-size:13px;background:#fff}
  th,td{padding:8px 10px;text-align:left;border-bottom:1px solid var(--rule);vertical-align:top}
  th{background:var(--cream);font-weight:700;color:var(--ink);text-transform:uppercase;font-size:11px;letter-spacing:0.4px}
  .tbl-num td:not(:first-child){text-align:right;font-variant-numeric:tabular-nums}
  /* Insight tiles */
  .insight-row{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:12px}
  .insight{border:1px solid var(--rule);padding:10px;border-radius:3px;background:#fff}
  .insight .in-head{font-size:12px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:0.3px;margin-bottom:4px}
  .insight .in-body{font-size:13px;color:var(--ink2);margin-top:4px}
  /* Badges */
  .bd{display:inline-block;padding:1px 6px;border-radius:10px;font-size:10px;font-weight:700;letter-spacing:0.3px}
  .bd-green{background:var(--green-bg);color:var(--green)}
  .bd-red{background:var(--red-bg);color:var(--red)}
  .bd-gold{background:var(--gold-bg);color:var(--gold)}
  .bd-blue{background:var(--blue-bg);color:var(--blue)}
  .bd-gray{background:#EDEDED;color:#555}
  /* Methodology bullets */
  .meth{margin:10px 0 10px 22px}
  .meth li{margin:6px 0}
  .fineprint{font-size:12px;color:var(--muted);margin-top:12px}
  /* Footer */
  .footer{margin-top:24px;padding-top:14px;border-top:1px solid var(--rule);
          display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}
  .footer-brand{font-weight:700;color:var(--accent);letter-spacing:0.5px}
  .footer-right{text-align:right}
  @media print {
    body{background:#fff}
    .rpt{box-shadow:none;max-width:100%;padding:0}
  }
  @media (max-width:640px){
    .ch-grid{grid-template-columns:repeat(2,1fr)}
    .insight-row{grid-template-columns:1fr}
    .cover-meta{grid-template-columns:1fr}
  }
  `
}
