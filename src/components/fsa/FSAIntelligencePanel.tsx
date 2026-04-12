'use client'

/**
 * FSA Intelligence Panel — Reusable slide-out drawer for financial analysis.
 *
 * Embeddable on any dashboard page (Valuation, M&A Radar, Compare, etc.)
 * Contains tabs: Ratios, DuPont, Z-Score, Formulas, Charts, AI Analysis.
 * Each section has an "Add to Report" toggle for custom report building.
 */

import { useState, useMemo, useCallback, type CSSProperties } from 'react'
import type { Company } from '@/lib/data/companies'
import type { FinancialHistory, FinancialYear } from '@/lib/valuation/history'
import { BarChart, barChartInference } from './charts/BarChart'
import { WaterfallChart, buildIncomeWaterfall, waterfallInference } from './charts/WaterfallChart'
import { RadarChart, normaliseRatio, radarInference } from './charts/RadarChart'
import { DuPontTree, dupontInference, type DuPontData } from './charts/DuPontTree'
import { ZScoreGauge, zScoreInference, type ZScoreData } from './charts/ZScoreGauge'
import { FSA_SYSTEM_PROMPT, FSA_MODES, FSA_INSTRUMENTS, buildFSAUserMessage, type FSAMode } from '@/lib/fsa/system-prompt'

// ── Types ─────────────────────────────────────────────────────

interface FSAIntelligencePanelProps {
  company: Company
  history?: FinancialHistory
  peers?: Company[]
  onClose: () => void
  /** If true, panel appears from the right as a drawer */
  drawer?: boolean
}

type TabId = 'ratios' | 'dupont' | 'zscore' | 'formulas' | 'charts' | 'ai'

interface ReportSections {
  ratios: boolean
  dupont: boolean
  zscore: boolean
  charts: boolean
  aiNarrative: boolean
}

// ── Helpers ───────────────────────────────────────────────────

const fmt = (v: number | null | undefined, decimals = 1, suffix = '') => {
  if (v === null || v === undefined || !isFinite(v)) return '—'
  return `${v.toFixed(decimals)}${suffix}`
}

const fmtCr = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })} Cr`

const ratioColor = (v: number | null, good: number, warn: number, invert = false): string => {
  if (v === null) return 'var(--txt3)'
  if (invert) return v <= good ? 'var(--green)' : v <= warn ? 'var(--gold2)' : 'var(--red)'
  return v >= good ? 'var(--green)' : v >= warn ? 'var(--gold2)' : 'var(--red)'
}

const signalBadge = (rating: string) => {
  const colors: Record<string, { bg: string; fg: string }> = {
    STRONG: { bg: 'rgba(34,197,94,0.12)', fg: 'var(--green)' },
    ADEQUATE: { bg: 'rgba(212,164,59,0.12)', fg: 'var(--gold2)' },
    WEAK: { bg: 'rgba(248,113,113,0.12)', fg: 'var(--red)' },
    CRITICAL: { bg: 'rgba(248,113,113,0.2)', fg: 'var(--red)' },
  }
  const c = colors[rating] || colors.ADEQUATE
  return { background: c.bg, color: c.fg, border: `1px solid ${c.fg}33`, borderRadius: 10, padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '0.5px' }
}

// ── Component ─────────────────────────────────────────────────

export function FSAIntelligencePanel({
  company,
  history,
  peers = [],
  onClose,
  drawer = true,
}: FSAIntelligencePanelProps) {
  const [activeTab, setActiveTab] = useState<TabId>('ratios')
  const [reportSections, setReportSections] = useState<ReportSections>({
    ratios: true, dupont: true, zscore: true, charts: false, aiNarrative: false,
  })
  const [aiMode, setAiMode] = useState<FSAMode>('full')
  const [aiOutput, setAiOutput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [selectedInstruments, setSelectedInstruments] = useState<Set<string>>(
    new Set(FSA_INSTRUMENTS.map(i => i.id))
  )

  const co = company
  const years = useMemo(() => history?.history?.slice(0, 6) ?? [], [history])
  const latest = years[0]

  // ── Compute ratios ──────────────────────────────────────────

  const ratios = useMemo(() => {
    const r = (num: number | null, den: number | null) =>
      num !== null && den !== null && den !== 0 ? num / den : null
    const pct = (num: number | null, den: number | null) => {
      const v = r(num, den)
      return v !== null ? v * 100 : null
    }

    return {
      // Profitability
      grossMargin: pct(latest?.grossProfit, latest?.revenue),
      ebitdaMargin: co.ebm,
      ebitMargin: pct(latest?.ebit, latest?.revenue),
      netMargin: pct(latest?.netIncome, latest?.revenue),
      roe: latest?.roePct ?? null,
      roa: latest?.roaPct ?? null,
      // Liquidity
      currentRatio: r(latest?.currentAssets, latest?.currentLiabilities),
      // Leverage
      debtEquity: co.dbt_eq,
      debtEbitda: latest?.totalDebt && co.ebitda ? (latest.totalDebt / co.ebitda) : null,
      // Efficiency
      assetTurnover: r(latest?.revenue, latest?.totalAssets),
      dso: latest?.receivables && latest?.revenue ? ((latest.receivables / latest.revenue) * 365) : null,
      ccc: latest?.cashConversionCycle ?? null,
      // Valuation
      evEbitda: co.ev_eb,
      pe: co.pe,
      pb: co.pb,
      revGrowth: co.revg,
      // Cash Flow
      cfoNi: latest?.cfo && latest?.netIncome ? (latest.cfo / latest.netIncome) : null,
      fcf: latest?.fcf ?? null,
    }
  }, [co, latest])

  // ── DuPont ──────────────────────────────────────────────────

  const dupontData = useMemo<DuPontData>(() => {
    const avgTA = years.length >= 2 ? ((years[0]?.totalAssets ?? 0) + (years[1]?.totalAssets ?? 0)) / 2 : (latest?.totalAssets ?? 0)
    const avgEq = years.length >= 2 ? ((years[0]?.totalEquity ?? 0) + (years[1]?.totalEquity ?? 0)) / 2 : (latest?.totalEquity ?? 0)
    const ni = latest?.netIncome ?? 0
    const ebt = latest?.ebt ?? 0
    const ebit = latest?.ebit ?? 0
    const rev = latest?.revenue ?? 0
    return {
      roe: latest?.roePct ?? null,
      taxBurden: ebt !== 0 ? ni / ebt : null,
      interestBurden: ebit !== 0 ? ebt / ebit : null,
      ebitMargin: rev !== 0 ? ebit / rev : null,
      assetTurnover: avgTA > 0 ? rev / avgTA : null,
      equityMultiplier: avgEq > 0 ? avgTA / avgEq : null,
    }
  }, [latest, years])

  // ── Z-Score ─────────────────────────────────────────────────

  const zScoreData = useMemo<ZScoreData>(() => {
    const ta = latest?.totalAssets ?? 1
    const eq = latest?.totalEquity ?? 0
    const tl = ta - eq
    const wc = (latest?.currentAssets ?? 0) - (latest?.currentLiabilities ?? 0)
    const ebit = latest?.ebit ?? 0
    const rev = latest?.revenue ?? 0
    const c = {
      wcTa: ta > 0 ? wc / ta : null,
      reTa: null as number | null,
      ebitTa: ta > 0 ? ebit / ta : null,
      meTl: tl > 0 ? co.mktcap / tl : null,
      sTa: ta > 0 ? rev / ta : null,
    }
    let z: number | null = null
    if (c.wcTa !== null && c.ebitTa !== null && c.sTa !== null) {
      z = 1.2 * c.wcTa + 1.4 * (c.reTa ?? 0) + 3.3 * c.ebitTa + 0.6 * (c.meTl ?? 0.5) + 1.0 * c.sTa
    }
    return { zScore: z !== null ? Math.round(z * 100) / 100 : null, components: c }
  }, [co, latest])

  // ── Chart data ──────────────────────────────────────────────

  const revChartData = useMemo(() =>
    years.filter(y => (y.revenue ?? 0) > 0).reverse().map(y => ({
      label: y.label?.slice(0, 6) || y.fiscalYear, value: y.revenue ?? 0, color: '#D4A43B',
    })), [years])

  const ebitdaChartData = useMemo(() =>
    years.filter(y => (y.ebitda ?? 0) > 0).reverse().map(y => ({
      label: y.label?.slice(0, 6) || y.fiscalYear, value: y.ebitda ?? 0, color: '#22c55e',
    })), [years])

  const marginChartData = useMemo(() =>
    years.filter(y => y.ebitdaMarginPct !== null).reverse().map(y => ({
      label: y.label?.slice(0, 6) || y.fiscalYear, value: y.ebitdaMarginPct ?? 0, color: '#4a90d9',
    })), [years])

  const waterfallSteps = useMemo(() =>
    latest ? buildIncomeWaterfall({
      revenue: latest.revenue ?? 0, cogs: latest.cogs ?? 0,
      grossProfit: latest.grossProfit ?? 0,
      opex: (latest.grossProfit ?? 0) - (latest.ebit ?? 0),
      ebit: latest.ebit ?? 0, interest: latest.interestExpense ?? 0,
      tax: latest.taxExpense ?? 0, netIncome: latest.netIncome ?? 0,
    }) : [], [latest])

  const radarDimensions = useMemo(() => {
    const pm = (vals: number[]) => {
      const s = vals.filter(v => v > 0).sort((a, b) => a - b)
      if (!s.length) return 0
      return s.length % 2 ? s[Math.floor(s.length / 2)] : (s[Math.floor(s.length / 2) - 1] + s[Math.floor(s.length / 2)]) / 2
    }
    return [
      { label: 'Growth', subject: normaliseRatio(co.revg, 0, 50, true), peer: normaliseRatio(pm(peers.map(p => p.revg)), 0, 50, true) },
      { label: 'Margin', subject: normaliseRatio(co.ebm, 0, 30, true), peer: normaliseRatio(pm(peers.map(p => p.ebm)), 0, 30, true) },
      { label: 'Valuation', subject: normaliseRatio(co.ev_eb, 5, 50, false), peer: normaliseRatio(pm(peers.map(p => p.ev_eb)), 5, 50, false) },
      { label: 'Leverage', subject: normaliseRatio(co.dbt_eq, 0, 2, false), peer: normaliseRatio(pm(peers.map(p => p.dbt_eq)), 0, 2, false) },
      { label: 'Acq Score', subject: normaliseRatio(co.acqs, 0, 10, true), peer: normaliseRatio(pm(peers.map(p => p.acqs)), 0, 10, true) },
    ]
  }, [co, peers])

  // ── Toggle report section ───────────────────────────────────

  const toggleReport = useCallback((key: keyof ReportSections) => {
    setReportSections(prev => {
      const next = { ...prev, [key]: !prev[key] }
      localStorage.setItem(`fsa_report_${co.ticker}`, JSON.stringify(next))
      return next
    })
  }, [co.ticker])

  const selectedCount = Object.values(reportSections).filter(Boolean).length

  // ── AI Analysis ─────────────────────────────────────────────

  const runAI = useCallback(async () => {
    const key = localStorage.getItem('anthropic_key') || localStorage.getItem('sg4_apiKey') || ''
    if (!key) {
      setAiOutput('Please enter your Anthropic API key in the Settings page or header bar to use AI analysis.')
      return
    }
    setAiLoading(true)
    setAiOutput('')
    const data = {
      name: co.name, ticker: co.ticker, sector: co.sec,
      mktcap: co.mktcap, revenue: co.rev, ebitda: co.ebitda, pat: co.pat,
      ev: co.ev, ev_eb: co.ev_eb, pe: co.pe, pb: co.pb, dbt_eq: co.dbt_eq,
      revg: co.revg, ebm: co.ebm, acqs: co.acqs, acqf: co.acqf,
    }
    const ratiosSummary = `Gross margin: ${fmt(ratios.grossMargin, 1, '%')}, EBITDA margin: ${co.ebm}%, Net margin: ${fmt(ratios.netMargin, 1, '%')}, ROE: ${fmt(ratios.roe, 1, '%')}, ROA: ${fmt(ratios.roa, 1, '%')}, D/E: ${co.dbt_eq}, EV/EBITDA: ${co.ev_eb}x, P/E: ${co.pe}x, CFO/NI: ${fmt(ratios.cfoNi, 2, 'x')}, Z-Score: ${fmt(zScoreData.zScore, 2)}`
    const instruments = Array.from(selectedInstruments)
    const msg = buildFSAUserMessage(aiMode, co.name, data, ratiosSummary, instruments, 'standard')

    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514', max_tokens: 3000,
          system: FSA_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: msg }],
          stream: true,
        }),
      })
      if (!resp.ok) { const e = await resp.json(); throw new Error(e.error?.message || resp.statusText) }
      const reader = resp.body!.getReader()
      const dec = new TextDecoder()
      let buf = '', full = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const d = line.slice(5).trim()
          if (d === '[DONE]') break
          try {
            const ev = JSON.parse(d)
            if (ev.type === 'content_block_delta' && ev.delta?.text) {
              full += ev.delta.text
              setAiOutput(full)
            }
          } catch { /* skip */ }
        }
      }
    } catch (err: unknown) {
      setAiOutput(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setAiLoading(false)
    }
  }, [co, ratios, zScoreData, aiMode, selectedInstruments])

  // ── Styles ──────────────────────────────────────────────────

  const panelStyle: CSSProperties = drawer
    ? { position: 'fixed', top: 0, right: 0, width: 520, height: '100vh', background: 'var(--s1)', borderLeft: '1px solid var(--br)', zIndex: 1000, display: 'flex', flexDirection: 'column', boxShadow: '-8px 0 30px rgba(0,0,0,0.3)', overflow: 'hidden' }
    : { background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 8, display: 'flex', flexDirection: 'column', overflow: 'hidden', height: '100%' }

  const headerStyle: CSSProperties = { padding: '12px 16px', borderBottom: '1px solid var(--br)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, background: 'var(--s2)' }

  const tabBarStyle: CSSProperties = { display: 'flex', gap: 0, borderBottom: '1px solid var(--br)', flexShrink: 0, overflowX: 'auto', background: 'var(--s1)' }

  const tabStyle = (active: boolean): CSSProperties => ({
    padding: '9px 12px', fontSize: 11, color: active ? 'var(--gold2)' : 'var(--txt3)', cursor: 'pointer',
    borderBottom: active ? '2px solid var(--gold2)' : '2px solid transparent', whiteSpace: 'nowrap',
    fontWeight: active ? 600 : 400, transition: 'all 0.15s',
  })

  const contentStyle: CSSProperties = { flex: 1, overflowY: 'auto', padding: 16, minHeight: 0 }

  const sectionHeader = (title: string, reportKey?: keyof ReportSections) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--br)' }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>{title}</span>
      {reportKey && (
        <button
          onClick={() => toggleReport(reportKey)}
          style={{
            background: reportSections[reportKey] ? 'rgba(212,164,59,0.15)' : 'transparent',
            border: `1px solid ${reportSections[reportKey] ? 'var(--gold2)' : 'var(--br2)'}`,
            borderRadius: 10, padding: '2px 8px', fontSize: 9, cursor: 'pointer',
            color: reportSections[reportKey] ? 'var(--gold2)' : 'var(--txt3)',
            fontWeight: 600, letterSpacing: 0.3,
          }}
        >
          {reportSections[reportKey] ? '📎 In Report' : '+ Add to Report'}
        </button>
      )}
    </div>
  )

  const ratioRow = (label: string, value: number | null, suffix: string, color: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--br)', fontSize: 11.5 }}>
      <span style={{ color: 'var(--txt3)' }}>{label}</span>
      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color }}>{fmt(value, 1, suffix)}</span>
    </div>
  )

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'ratios', label: 'Ratios' },
    { id: 'dupont', label: 'DuPont' },
    { id: 'zscore', label: 'Z-Score' },
    { id: 'charts', label: 'Charts' },
    { id: 'formulas', label: 'Formulas' },
    { id: 'ai', label: 'AI Analysis' },
  ]

  // ── Render ──────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop for drawer mode */}
      {drawer && <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999 }} />}

      <div style={panelStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)' }}>
            FSA Intelligence — <span style={{ color: 'var(--gold2)' }}>{co.name}</span>
          </span>
          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: 'rgba(74,144,217,0.1)', color: 'var(--cyan)', border: '1px solid rgba(74,144,217,0.25)', marginLeft: 'auto' }}>
            {selectedCount} in report
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--txt3)', fontSize: 18, cursor: 'pointer', padding: '0 4px' }}>×</button>
        </div>

        {/* Tabs */}
        <div style={tabBarStyle}>
          {tabs.map(t => (
            <div key={t.id} style={tabStyle(activeTab === t.id)} onClick={() => setActiveTab(t.id)}>
              {t.label}
            </div>
          ))}
        </div>

        {/* Content */}
        <div style={contentStyle}>

          {/* ── RATIOS TAB ── */}
          {activeTab === 'ratios' && (
            <div>
              {sectionHeader('Profitability', 'ratios')}
              {ratioRow('EBITDA Margin', co.ebm, '%', ratioColor(co.ebm, 15, 8))}
              {ratioRow('Net Margin', ratios.netMargin, '%', ratioColor(ratios.netMargin, 10, 5))}
              {ratioRow('ROE', ratios.roe, '%', ratioColor(ratios.roe, 15, 8))}
              {ratioRow('ROA', ratios.roa, '%', ratioColor(ratios.roa, 8, 4))}

              <div style={{ marginTop: 14 }}>{sectionHeader('Liquidity & Leverage')}</div>
              {ratioRow('Current Ratio', ratios.currentRatio, '×', ratioColor(ratios.currentRatio, 1.5, 1.0))}
              {ratioRow('Debt / Equity', co.dbt_eq, '×', ratioColor(co.dbt_eq, 0.5, 1.0, true))}
              {ratioRow('Debt / EBITDA', ratios.debtEbitda, '×', ratioColor(ratios.debtEbitda, 3, 5, true))}

              <div style={{ marginTop: 14 }}>{sectionHeader('Efficiency')}</div>
              {ratioRow('Asset Turnover', ratios.assetTurnover, '×', 'var(--txt)')}
              {ratioRow('DSO', ratios.dso, ' days', ratioColor(ratios.dso, 45, 90, true))}
              {ratioRow('Cash Conv. Cycle', ratios.ccc, ' days', ratioColor(ratios.ccc, 30, 90, true))}

              <div style={{ marginTop: 14 }}>{sectionHeader('Valuation')}</div>
              {ratioRow('EV / EBITDA', co.ev_eb, '×', 'var(--txt)')}
              {ratioRow('P / E', co.pe, '×', 'var(--txt)')}
              {ratioRow('P / B', co.pb, '×', 'var(--txt)')}
              {ratioRow('Revenue Growth', co.revg, '%', ratioColor(co.revg, 15, 5))}

              <div style={{ marginTop: 14 }}>{sectionHeader('Cash Flow Quality')}</div>
              {ratioRow('CFO / Net Income', ratios.cfoNi, '×', ratioColor(ratios.cfoNi, 1.0, 0.7))}
              {ratioRow('Free Cash Flow', ratios.fcf, ' Cr', (ratios.fcf ?? 0) >= 0 ? 'var(--green)' : 'var(--red)')}
            </div>
          )}

          {/* ── DUPONT TAB ── */}
          {activeTab === 'dupont' && (
            <div>
              {sectionHeader('5-Factor DuPont Decomposition', 'dupont')}
              <DuPontTree data={dupontData} width={480} height={180} />
              <div style={{ marginTop: 12, padding: 12, background: 'var(--s2)', borderRadius: 6, border: '1px solid var(--br)', fontSize: 12, lineHeight: 1.7, color: 'var(--txt2)' }}>
                {dupontInference(dupontData)}
              </div>

              {/* Factor detail table */}
              <div style={{ marginTop: 14 }}>{sectionHeader('Component Detail')}</div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--br2)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>Factor</th>
                    <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600 }}>Value</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600 }}>Formula</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600 }}>Signal</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { name: 'Tax Burden', val: dupontData.taxBurden, formula: 'NI / EBT', good: 0.8, warn: 0.7 },
                    { name: 'Interest Burden', val: dupontData.interestBurden, formula: 'EBT / EBIT', good: 0.85, warn: 0.7 },
                    { name: 'EBIT Margin', val: dupontData.ebitMargin ? dupontData.ebitMargin * 100 : null, formula: 'EBIT / Revenue', good: 15, warn: 8 },
                    { name: 'Asset Turnover', val: dupontData.assetTurnover, formula: 'Rev / Avg TA', good: 1.0, warn: 0.5 },
                    { name: 'Equity Multiplier', val: dupontData.equityMultiplier, formula: 'Avg TA / Avg Eq', good: 2, warn: 3 },
                  ].map(f => (
                    <tr key={f.name} style={{ borderBottom: '1px solid var(--br)' }}>
                      <td style={{ padding: '5px 8px', fontWeight: 500, color: 'var(--txt)' }}>{f.name}</td>
                      <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: 'var(--gold2)' }}>
                        {f.name === 'EBIT Margin' ? fmt(f.val, 1, '%') : fmt(f.val, 2, f.name.includes('Turnover') || f.name.includes('Multiplier') ? '×' : '')}
                      </td>
                      <td style={{ padding: '5px 8px', fontSize: 10, color: 'var(--txt3)' }}>{f.formula}</td>
                      <td style={{ padding: '5px 8px' }}>
                        <span style={signalBadge(
                          f.val === null ? 'ADEQUATE' :
                          f.name === 'Equity Multiplier' ? (f.val <= 2 ? 'STRONG' : f.val <= 3 ? 'ADEQUATE' : 'WEAK') :
                          f.val >= f.good ? 'STRONG' : f.val >= f.warn ? 'ADEQUATE' : 'WEAK'
                        )}>
                          {f.val === null ? '—' :
                            f.name === 'Equity Multiplier' ? (f.val <= 2 ? 'STRONG' : f.val <= 3 ? 'ADEQUATE' : 'WEAK') :
                            f.val >= f.good ? 'STRONG' : f.val >= f.warn ? 'ADEQUATE' : 'WEAK'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Z-SCORE TAB ── */}
          {activeTab === 'zscore' && (
            <div>
              {sectionHeader('Altman Z-Score', 'zscore')}
              {zScoreData.zScore !== null ? (
                <>
                  <ZScoreGauge data={zScoreData} width={480} height={90} />
                  <div style={{ marginTop: 12, padding: 12, background: 'var(--s2)', borderRadius: 6, border: '1px solid var(--br)', fontSize: 12, lineHeight: 1.7, color: 'var(--txt2)' }}>
                    {zScoreInference(zScoreData)}
                  </div>

                  {/* Component breakdown */}
                  <div style={{ marginTop: 14 }}>{sectionHeader('Component Breakdown')}</div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11.5 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--br2)' }}>
                        <th style={{ textAlign: 'left', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600, textTransform: 'uppercase' }}>Component</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600 }}>Weight</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600 }}>Value</th>
                        <th style={{ textAlign: 'right', padding: '6px 8px', color: 'var(--txt3)', fontSize: 10, fontWeight: 600 }}>Weighted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { name: 'WC / Total Assets', w: 1.2, v: zScoreData.components.wcTa },
                        { name: 'Retained Earnings / TA', w: 1.4, v: zScoreData.components.reTa },
                        { name: 'EBIT / Total Assets', w: 3.3, v: zScoreData.components.ebitTa },
                        { name: 'Market Equity / TL', w: 0.6, v: zScoreData.components.meTl },
                        { name: 'Sales / Total Assets', w: 1.0, v: zScoreData.components.sTa },
                      ].map(c => (
                        <tr key={c.name} style={{ borderBottom: '1px solid var(--br)' }}>
                          <td style={{ padding: '5px 8px', color: 'var(--txt2)' }}>{c.name}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', color: 'var(--txt3)' }}>{c.w}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: 'var(--gold2)' }}>{fmt(c.v, 3)}</td>
                          <td style={{ padding: '5px 8px', textAlign: 'right', fontFamily: "'JetBrains Mono',monospace", fontWeight: 600, color: 'var(--txt)' }}>{c.v !== null ? fmt(c.w * c.v, 3) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              ) : (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--txt3)' }}>
                  <p style={{ fontSize: 13 }}>Insufficient balance sheet data to compute Z-Score.</p>
                  <p style={{ fontSize: 11, marginTop: 6 }}>Total Assets, Current Assets/Liabilities, and EBIT are required.</p>
                </div>
              )}
            </div>
          )}

          {/* ── CHARTS TAB ── */}
          {activeTab === 'charts' && (
            <div>
              {sectionHeader('Revenue & EBITDA Trend', 'charts')}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                <div>
                  <BarChart data={revChartData} width={230} height={140} title="Revenue" fmt={v => `${Math.round(v)}`} />
                  {revChartData.length >= 2 && <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>{barChartInference(revChartData, 'Revenue')}</p>}
                </div>
                <div>
                  <BarChart data={ebitdaChartData} width={230} height={140} title="EBITDA" fmt={v => `${Math.round(v)}`} />
                  {ebitdaChartData.length >= 2 && <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>{barChartInference(ebitdaChartData, 'EBITDA')}</p>}
                </div>
              </div>

              {sectionHeader('Income Waterfall')}
              {waterfallSteps.length > 0 && (
                <>
                  <WaterfallChart steps={waterfallSteps} width={480} height={170} title="Revenue to Net Income Bridge" fmt={v => `${Math.round(v)}`} />
                  <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                    {waterfallInference(latest?.revenue ?? 0, latest?.netIncome ?? 0, co.ebm)}
                  </p>
                </>
              )}

              <div style={{ marginTop: 14 }}>{sectionHeader('Ratio Profile vs Peers')}</div>
              <RadarChart dimensions={radarDimensions} width={300} height={260} title={`${co.ticker} vs Peer Median`} />
              <p style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.5 }}>
                {radarInference(radarDimensions)}
              </p>

              {marginChartData.length >= 2 && (
                <>
                  <div style={{ marginTop: 14 }}>{sectionHeader('EBITDA Margin Trend')}</div>
                  <BarChart data={marginChartData} width={480} height={130} title="EBITDA Margin %" fmt={v => `${v.toFixed(1)}`} unit="%" />
                </>
              )}
            </div>
          )}

          {/* ── FORMULAS TAB ── */}
          {activeTab === 'formulas' && (
            <div>
              {sectionHeader('Calculation Workings')}
              <p style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 12, lineHeight: 1.6 }}>
                Step-by-step derivation of key metrics. Every number is transparent and auditable.
              </p>

              {[
                { title: 'EBITDA Margin', formula: 'EBITDA / Revenue × 100', inputs: `${fmtCr(co.ebitda)} / ${fmtCr(co.rev)} × 100`, result: `${co.ebm}%`, interpretation: co.ebm > 15 ? 'Strong operating profitability — above 15% indicates pricing power and cost efficiency.' : co.ebm > 8 ? 'Adequate operating margin — monitor for cost pressure.' : 'Thin margin — vulnerable to input cost escalation.' },
                { title: 'Return on Equity (ROE)', formula: 'Net Income / Average Equity × 100', inputs: `${fmtCr(co.pat)} / Avg Equity`, result: fmt(ratios.roe, 1, '%'), interpretation: (ratios.roe ?? 0) > 15 ? 'Strong ROE — company generates attractive returns for shareholders.' : 'ROE is moderate — investigate via DuPont decomposition to identify drivers.' },
                { title: 'Debt / Equity', formula: 'Total Debt / Total Equity', inputs: `Total Debt / Total Equity`, result: `${co.dbt_eq}×`, interpretation: co.dbt_eq < 0.5 ? 'Conservative leverage — strong balance sheet with low refinancing risk.' : co.dbt_eq < 1.0 ? 'Moderate leverage — within acceptable range for the sector.' : 'Elevated leverage — monitor interest coverage and refinancing timeline.' },
                { title: 'EV / EBITDA', formula: 'Enterprise Value / EBITDA', inputs: `${fmtCr(co.ev)} / ${fmtCr(co.ebitda)}`, result: `${co.ev_eb}×`, interpretation: co.ev_eb < 15 ? 'Reasonable valuation — market is not pricing in excessive growth expectations.' : co.ev_eb < 25 ? 'Moderate premium — reflects growth expectations. Verify with DCF.' : 'Premium valuation — high expectations embedded. Downside risk if growth disappoints.' },
                { title: 'Free Cash Flow', formula: 'CFO − CapEx', inputs: `CFO − CapEx`, result: fmt(ratios.fcf, 0, ' Cr'), interpretation: (ratios.fcf ?? 0) > 0 ? 'Positive FCF — company generates cash after capital investment. Self-funding capacity confirmed.' : 'Negative FCF — company requires external funding for growth. Verify if this is a temporary growth-phase investment or structural cash drain.' },
              ].map(f => (
                <div key={f.title} style={{ marginBottom: 14, background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, overflow: 'hidden' }}>
                  <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--br)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)' }}>{f.title}</span>
                    <span style={{ fontSize: 16, fontWeight: 700, color: 'var(--gold2)', fontFamily: "'JetBrains Mono',monospace", marginLeft: 'auto' }}>{f.result}</span>
                  </div>
                  <div style={{ padding: '8px 12px', borderLeft: '3px solid var(--cyan)', margin: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 2 }}>Formula</div>
                    <div style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace", color: 'var(--cyan)' }}>{f.formula}</div>
                  </div>
                  <div style={{ padding: '8px 12px', borderLeft: '3px solid var(--gold2)', margin: 0 }}>
                    <div style={{ fontSize: 10, color: 'var(--txt3)', marginBottom: 2 }}>Inputs</div>
                    <div style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: 'var(--txt2)' }}>{f.inputs}</div>
                  </div>
                  <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--txt2)', lineHeight: 1.6 }}>
                    {f.interpretation}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── AI ANALYSIS TAB ── */}
          {activeTab === 'ai' && (
            <div>
              {sectionHeader('AI-Powered Analysis', 'aiNarrative')}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {FSA_MODES.map(m => (
                  <button key={m.id} onClick={() => setAiMode(m.id)}
                    style={{
                      background: aiMode === m.id ? 'rgba(212,164,59,0.15)' : 'transparent',
                      border: `1px solid ${aiMode === m.id ? 'var(--gold2)' : 'var(--br2)'}`,
                      borderRadius: 6, padding: '5px 10px', fontSize: 10, cursor: 'pointer',
                      color: aiMode === m.id ? 'var(--gold2)' : 'var(--txt3)', fontWeight: 500,
                    }}
                    title={m.desc}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              {/* Instrument chips */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: 'var(--txt3)', fontWeight: 500 }}>Instruments:</span>
                  <span onClick={() => setSelectedInstruments(new Set(FSA_INSTRUMENTS.map(i => i.id)))} style={{ fontSize: 9, color: 'var(--cyan)', cursor: 'pointer', textDecoration: 'underline' }}>All</span>
                  <span onClick={() => setSelectedInstruments(new Set())} style={{ fontSize: 9, color: 'var(--txt3)', cursor: 'pointer', textDecoration: 'underline' }}>None</span>
                </div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {FSA_INSTRUMENTS.map(i => (
                    <span key={i.id} onClick={() => {
                      const next = new Set(selectedInstruments)
                      next.has(i.id) ? next.delete(i.id) : next.add(i.id)
                      setSelectedInstruments(next)
                    }}
                      style={{
                        padding: '2px 6px', borderRadius: 8, fontSize: 8, cursor: 'pointer',
                        background: selectedInstruments.has(i.id) ? (i.type === 'fw' ? 'rgba(167,139,250,0.12)' : 'rgba(74,144,217,0.1)') : 'transparent',
                        border: `1px solid ${selectedInstruments.has(i.id) ? (i.type === 'fw' ? 'rgba(167,139,250,0.35)' : 'rgba(74,144,217,0.25)') : 'var(--br)'}`,
                        color: selectedInstruments.has(i.id) ? (i.type === 'fw' ? '#a78bfa' : 'var(--cyan)') : 'var(--txt4)',
                        fontWeight: selectedInstruments.has(i.id) ? 600 : 400,
                      }}
                      title={i.name}
                    >
                      {i.id.slice(-5)}
                    </span>
                  ))}
                </div>
              </div>

              <button onClick={runAI} disabled={aiLoading}
                style={{
                  width: '100%', padding: '8px 16px', borderRadius: 6, border: 'none', cursor: aiLoading ? 'not-allowed' : 'pointer',
                  background: aiLoading ? 'var(--br2)' : 'var(--cyan)', color: '#fff', fontWeight: 600, fontSize: 12,
                  transition: 'all 0.15s', marginBottom: 12,
                }}
              >
                {aiLoading ? 'Analysing...' : '▶ Run AI Analysis'}
              </button>

              {aiOutput && (
                <div style={{ background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6, padding: 14, fontSize: 12, lineHeight: 1.75, color: 'var(--txt2)', whiteSpace: 'pre-wrap', maxHeight: 500, overflowY: 'auto' }}>
                  {aiOutput}
                </div>
              )}
              {!aiOutput && !aiLoading && (
                <div style={{ textAlign: 'center', padding: 30, color: 'var(--txt3)' }}>
                  <p style={{ fontSize: 12 }}>Select analysis mode and instruments, then click Run.</p>
                  <p style={{ fontSize: 10, marginTop: 6 }}>Requires Anthropic API key (set in Settings page).</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer — report selection summary */}
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--br)', background: 'var(--s2)', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 10, color: 'var(--txt3)' }}>
            {selectedCount} section{selectedCount !== 1 ? 's' : ''} selected for report
          </span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {Object.entries(reportSections).filter(([, v]) => v).map(([k]) => (
              <span key={k} style={{ fontSize: 8, padding: '1px 6px', borderRadius: 8, background: 'rgba(212,164,59,0.12)', color: 'var(--gold2)', border: '1px solid rgba(212,164,59,0.3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.3 }}>
                {k}
              </span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
