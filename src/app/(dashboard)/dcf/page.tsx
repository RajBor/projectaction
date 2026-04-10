'use client'

import { Fragment, useMemo, useState } from 'react'
import { COMPANIES } from '@/lib/data/companies'
import { PRIVATE_COMPANIES } from '@/lib/data/private-companies'
import { useWorkingPopup } from '@/components/working/WorkingPopup'
import {
  wkDCFOutput,
  wkWACC,
  wkTerminalValue,
  wkSynergyNPV,
  wkAcqScore,
} from '@/lib/working'

const FragmentWithKey = Fragment

// ──────────────────────────────────────────────
// Types + math
// ──────────────────────────────────────────────
interface DCFInputs {
  rev: number
  ebm: number
  gr: number
  wacc: number
  tgr: number
  yrs: number
  debt: number
  rs: number
  cs: number
  ic: number
}

interface DCFResults {
  evBase: number
  evSyn: number
  equity: number
  eqSyn: number
  synPV: number
  termPV: number
  pv: number
  ebitda: number
  eveb: number
  evebSyn: number
  bidLow: number
  bidHigh: number
  walkAway: number
}

interface CompareEntry {
  name: string
  inputs: DCFInputs
  results: DCFResults
}

function computeDCF(inputs: DCFInputs): DCFResults {
  const { rev, ebm, gr, wacc, tgr, yrs, debt, rs, cs, ic } = inputs
  let pv = 0
  let curRev = rev
  for (let i = 1; i <= yrs; i++) {
    curRev *= 1 + gr / 100
    const fcf = curRev * (ebm / 100) * 0.6
    const df = Math.pow(1 + wacc / 100, i)
    pv += fcf / df
  }
  const termEBITDA = curRev * (ebm / 100)
  const termPV =
    (termEBITDA * 0.6 * (1 + tgr / 100)) /
    ((wacc - tgr) / 100) /
    Math.pow(1 + wacc / 100, yrs)
  const evBase = pv + termPV
  const synPV = (rs * 0.3 + cs) * 7 - ic
  const evSyn = evBase + synPV
  const equity = evBase - debt
  const eqSyn = evSyn - debt
  const ebitda = rev * (ebm / 100)
  const eveb = ebitda > 0 ? evBase / ebitda : 0
  const evebSyn = ebitda > 0 ? evSyn / ebitda : 0
  return {
    evBase,
    evSyn,
    equity,
    eqSyn,
    synPV,
    termPV,
    pv,
    ebitda,
    eveb,
    evebSyn,
    bidLow: evBase * 0.9,
    bidHigh: evSyn * 0.95,
    walkAway: evSyn * 1.1,
  }
}

const DEFAULT_INPUTS: DCFInputs = {
  rev: 584,
  ebm: 13,
  gr: 22,
  wacc: 12,
  tgr: 4,
  yrs: 7,
  debt: 80,
  rs: 80,
  cs: 40,
  ic: 50,
}

// ──────────────────────────────────────────────
// Page
// ──────────────────────────────────────────────
export default function DCFPage() {
  const { showWorking } = useWorkingPopup()
  const [name, setName] = useState('Target')
  const [inputs, setInputs] = useState<DCFInputs>(DEFAULT_INPUTS)
  const [tab, setTab] = useState<'single' | 'compare'>('single')
  const [compareList, setCompareList] = useState<CompareEntry[]>([])
  const [coSelected, setCoSelected] = useState('')

  const results = useMemo(() => computeDCF(inputs), [inputs])

  const listed = useMemo(
    () => [...(COMPANIES as any[])].sort((a, b) => (b.acqs || 0) - (a.acqs || 0)),
    []
  )
  const priv = useMemo(
    () => [...(PRIVATE_COMPANIES as any[])].sort((a, b) => (b.acqs || 0) - (a.acqs || 0)),
    []
  )

  const selectedListedCo = useMemo(
    () => listed.find((c: any) => c.ticker === coSelected),
    [listed, coSelected]
  )

  function openDCFWorking() {
    showWorking(
      wkDCFOutput({
        name,
        rev: inputs.rev,
        ebm: inputs.ebm,
        gr: inputs.gr,
        wacc: inputs.wacc,
        tgr: inputs.tgr,
        yrs: inputs.yrs,
        debt: inputs.debt,
        rs: inputs.rs,
        cs: inputs.cs,
        ic: inputs.ic,
        evBase: results.evBase,
        evSyn: results.evSyn,
        termPV: results.termPV,
        pv: results.pv,
        synPV: results.synPV,
      })
    )
  }

  function loadCompany(key: string) {
    setCoSelected(key)
    if (!key) return
    const co = listed.find((c: any) => c.ticker === key)
    if (co) {
      const debt = co.dbt_eq
        ? Math.round((co.mktcap * co.dbt_eq) / (1 + co.dbt_eq))
        : 80
      setName(co.name)
      setInputs((prev) => ({
        ...prev,
        rev: co.rev || 0,
        ebm: co.ebm || 12,
        gr: co.revg || 20,
        debt,
        rs: Math.round((co.rev || 0) * 0.05),
        cs: Math.round((co.rev || 0) * 0.03),
        ic: Math.round((co.rev || 0) * 0.04),
      }))
      return
    }
    const pco = priv.find((c: any) => c.name === key)
    if (pco) {
      const rev = pco.rev_est || 0
      setName(pco.name)
      setInputs((prev) => ({
        ...prev,
        rev,
        ebm: pco.ebm_est || 12,
        gr: pco.revg_est || 20,
        debt: 0,
        rs: Math.round(rev * 0.05),
        cs: Math.round(rev * 0.03),
        ic: Math.round(rev * 0.04),
      }))
    }
  }

  function addToCompare() {
    if (!name.trim()) return
    if (compareList.length >= 5) return
    if (compareList.find((x) => x.name === name)) return
    if (!inputs.rev) return
    setCompareList([...compareList, { name, inputs, results }])
    if (compareList.length + 1 >= 2) setTab('compare')
  }

  function removeFromCompare(n: string) {
    const next = compareList.filter((x) => x.name !== n)
    setCompareList(next)
    if (next.length < 2) setTab('single')
  }

  function clearCompare() {
    setCompareList([])
    setTab('single')
  }

  function setField<K extends keyof DCFInputs>(key: K, value: number) {
    setInputs({ ...inputs, [key]: value })
  }

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
          SolarGrid Pro <span style={{ opacity: 0.5 }}>›</span> Analytics
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
          DCF & Synergy{' '}
          <em style={{ color: 'var(--gold2)', fontStyle: 'normal' }}>Calculator</em>
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
            Multi-company comparison · Auto-populate from database · Up to 5 companies
          </span>
        </div>
      </div>

      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        {/* Company picker */}
        <div
          style={{
            background: 'var(--s3)',
            border: '1px solid var(--br)',
            borderRadius: 7,
            padding: 14,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--txt)',
              marginBottom: 10,
              textTransform: 'uppercase',
              letterSpacing: '0.6px',
            }}
          >
            🏢 Load Company from Database
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <select
              value={coSelected}
              onChange={(e) => loadCompany(e.target.value)}
              style={{
                flex: 1,
                minWidth: 260,
                background: 'var(--s2)',
                color: 'var(--txt)',
                border: '1px solid var(--br)',
                padding: '8px 10px',
                borderRadius: 5,
                fontSize: 13,
              }}
            >
              <option value="">— Select a company to auto-populate —</option>
              <optgroup label={`⭐ Listed Companies (${listed.length})`}>
                {listed.map((c: any) => (
                  <option key={c.ticker} value={c.ticker}>
                    {c.name} ({c.ticker}) — ₹{(c.rev || 0).toLocaleString('en-IN')}Cr rev
                  </option>
                ))}
              </optgroup>
              <optgroup label={`🔒 Private / Unlisted (${priv.length})`}>
                {priv.map((c: any) => (
                  <option key={c.name} value={c.name}>
                    {c.name} [{c.stage}] — ₹{(c.rev_est || 0).toLocaleString('en-IN')}Cr est.
                  </option>
                ))}
              </optgroup>
            </select>
            <button
              onClick={addToCompare}
              style={{
                background: 'var(--green)',
                color: '#000',
                border: 'none',
                padding: '8px 14px',
                borderRadius: 5,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              + Add to Comparison
            </button>
            <button
              onClick={() => setTab('compare')}
              style={{
                background: 'var(--s2)',
                color: 'var(--txt)',
                border: '1px solid var(--br2)',
                padding: '8px 12px',
                borderRadius: 5,
                fontSize: 12,
                cursor: 'pointer',
              }}
              title="View comparison table"
            >
              📊 Compare ({compareList.length})
            </button>
          </div>
          {selectedListedCo && (
            <div style={{ marginTop: 8 }}>
              <span
                onClick={() => showWorking(wkAcqScore(selectedListedCo as any))}
                style={{
                  fontSize: 11,
                  color: 'var(--gold2)',
                  cursor: 'pointer',
                  borderBottom: '1px dotted var(--gold2)',
                }}
                title="How was this company's acquisition score calculated?"
              >
                🎯 How was {selectedListedCo.name} scored? (Acq Score: {selectedListedCo.acqs}/10)
              </span>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div
              style={{
                fontSize: 11,
                color: 'var(--txt3)',
                marginBottom: 6,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.6px',
              }}
            >
              In Comparison Queue:
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {compareList.length === 0 ? (
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--txt3)',
                    fontStyle: 'italic',
                  }}
                >
                  No companies added yet.
                </span>
              ) : (
                compareList.map((x) => (
                  <div
                    key={x.name}
                    style={{
                      background: 'var(--s2)',
                      border: '1px solid var(--br)',
                      borderRadius: 20,
                      padding: '4px 10px',
                      fontSize: 12,
                      color: 'var(--txt)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <span style={{ color: 'var(--gold2)', fontSize: 10 }}>●</span>
                    {x.name}
                    <span
                      onClick={() => removeFromCompare(x.name)}
                      style={{ cursor: 'pointer', color: 'var(--txt3)' }}
                    >
                      ×
                    </span>
                  </div>
                ))
              )}
              {compareList.length > 0 && (
                <button
                  onClick={clearCompare}
                  style={{
                    background: 'var(--s2)',
                    border: '1px solid var(--br2)',
                    color: 'var(--txt)',
                    padding: '2px 8px',
                    borderRadius: 4,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  ✕ Clear All
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            borderBottom: '1px solid var(--br)',
            marginBottom: 16,
          }}
        >
          <TabBtn
            active={tab === 'single'}
            onClick={() => setTab('single')}
            label="📐 Single Company DCF"
          />
          <TabBtn
            active={tab === 'compare'}
            onClick={() => setTab('compare')}
            label={`📊 Multi-Company Comparison (${compareList.length})`}
          />
        </div>

        {/* Single tab */}
        {tab === 'single' && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 16,
            }}
          >
            <div>
              <SectionLabel>Target Financials</SectionLabel>
              <Card>
                <Field label="Target Company Name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Indo Tech Transformers"
                    style={inputStyle}
                  />
                </Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                  <NumField
                    label="Revenue (₹Cr)"
                    value={inputs.rev}
                    onChange={(v) => setField('rev', v)}
                  />
                  <NumField
                    label="EBITDA Margin %"
                    value={inputs.ebm}
                    onChange={(v) => setField('ebm', v)}
                  />
                  <NumField
                    label="Revenue Growth % / yr"
                    value={inputs.gr}
                    onChange={(v) => setField('gr', v)}
                  />
                  <NumField
                    label="WACC %"
                    value={inputs.wacc}
                    onChange={(v) => setField('wacc', v)}
                    onLabelClick={() => showWorking(wkWACC(inputs.wacc))}
                  />
                  <NumField
                    label="Terminal Growth Rate %"
                    value={inputs.tgr}
                    onChange={(v) => setField('tgr', v)}
                    onLabelClick={() =>
                      showWorking(wkTerminalValue(inputs.tgr, inputs.wacc, inputs.yrs))
                    }
                  />
                  <NumField
                    label="Forecast Years"
                    value={inputs.yrs}
                    onChange={(v) => setField('yrs', v)}
                  />
                  <NumField
                    label="Net Debt ₹Cr"
                    value={inputs.debt}
                    onChange={(v) => setField('debt', v)}
                  />
                </div>
              </Card>

              <SectionLabel>Synergy Assumptions</SectionLabel>
              <Card>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 12px' }}>
                  <NumField
                    label="Revenue Synergy ₹Cr/yr"
                    value={inputs.rs}
                    onChange={(v) => setField('rs', v)}
                  />
                  <NumField
                    label="Cost Synergy ₹Cr/yr"
                    value={inputs.cs}
                    onChange={(v) => setField('cs', v)}
                  />
                  <NumField
                    label="Integration Cost ₹Cr"
                    value={inputs.ic}
                    onChange={(v) => setField('ic', v)}
                  />
                </div>
              </Card>
            </div>

            <div>
              <SectionLabel>Valuation Output</SectionLabel>
              <div
                style={{
                  background: 'var(--s3)',
                  border: '1px solid var(--br)',
                  borderRadius: 7,
                  padding: 14,
                  marginBottom: 14,
                }}
              >
                <DcfLine label="Target" value={name} />
                <DcfLine
                  label="DCF — Enterprise Value"
                  value={`₹${Math.round(results.evBase).toLocaleString('en-IN')}Cr`}
                  onClick={openDCFWorking}
                />
                <DcfLine
                  label="EV incl. Synergies"
                  value={`₹${Math.round(results.evSyn).toLocaleString('en-IN')}Cr`}
                  highlight
                />
                <DcfLine
                  label="Equity Value (ex-synergies)"
                  value={`₹${Math.round(results.equity).toLocaleString('en-IN')}Cr`}
                />
                <DcfLine
                  label="Equity Value (with synergies)"
                  value={`₹${Math.round(results.eqSyn).toLocaleString('en-IN')}Cr`}
                  color="var(--green)"
                />
                <DcfLine
                  label="Implied EV/EBITDA"
                  value={results.eveb > 0 ? `${results.eveb.toFixed(1)}×` : '—'}
                />
                <DcfLine
                  label="Synergy NPV"
                  value={`₹${Math.round(results.synPV).toLocaleString('en-IN')}Cr`}
                  color="var(--cyan2)"
                  onClick={() =>
                    showWorking(wkSynergyNPV(inputs.rs, inputs.cs, inputs.ic))
                  }
                />
                <DcfLine
                  label="Suggested Bid Range"
                  value={`₹${Math.round(results.bidLow).toLocaleString('en-IN')}–${Math.round(
                    results.bidHigh
                  ).toLocaleString('en-IN')}Cr`}
                  color="var(--gold2)"
                />
                <DcfLine
                  label="Max Walk-Away (EV)"
                  value={`₹${Math.round(results.walkAway).toLocaleString('en-IN')}Cr`}
                  color="var(--red)"
                />
              </div>

              <SectionLabel>EV/EBITDA Comparables</SectionLabel>
              <Card>
                <p style={{ fontSize: 13, lineHeight: 2, margin: 0, color: 'var(--txt2)' }}>
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>≤10×</span> —
                  Distressed / value buy
                  <br />
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>10–15×</span> —
                  Attractive (Indo Tech, Amara Raja range)
                  <br />
                  <span style={{ color: 'var(--gold2)', fontWeight: 700 }}>15–25×</span> — Fair
                  value for quality assets
                  <br />
                  <span style={{ color: 'var(--orange)', fontWeight: 700 }}>25–35×</span> —
                  Premium growth (Genus, Premier Energies)
                  <br />
                  <span style={{ color: 'var(--red)', fontWeight: 700 }}>35×+</span> — Very
                  expensive (Waaree, ABB, Siemens)
                </p>
              </Card>

              <SectionLabel>Deal Structure Guide</SectionLabel>
              <Card>
                <p style={{ fontSize: 13, lineHeight: 2, margin: 0, color: 'var(--txt2)' }}>
                  <strong style={{ color: 'var(--gold2)' }}>₹0–500Cr:</strong> All-cash or
                  convertible note
                  <br />
                  <strong style={{ color: 'var(--gold2)' }}>₹500–3,000Cr:</strong> Cash +
                  PLI/ALMM earnout
                  <br />
                  <strong style={{ color: 'var(--gold2)' }}>₹3,000Cr+:</strong> Staged
                  20%→51%→100%
                  <br />
                  <strong style={{ color: 'var(--gold2)' }}>International:</strong> Cash + equity
                  + tech transfer
                </p>
              </Card>
            </div>
          </div>
        )}

        {/* Compare tab */}
        {tab === 'compare' && (
          <div>
            <div
              style={{
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 8,
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)' }}>
                  Side-by-Side DCF Comparison
                </div>
                <div style={{ fontSize: 12, color: 'var(--txt3)' }}>
                  Up to 5 companies · Green = best in group · Red = most expensive
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setTab('single')}
                  style={{
                    background: 'var(--s3)',
                    color: 'var(--txt)',
                    border: '1px solid var(--br2)',
                    padding: '6px 12px',
                    borderRadius: 5,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  ← Back to Single
                </button>
                <button
                  onClick={clearCompare}
                  style={{
                    background: 'var(--s3)',
                    color: 'var(--txt)',
                    border: '1px solid var(--br2)',
                    padding: '6px 12px',
                    borderRadius: 5,
                    fontSize: 12,
                    cursor: 'pointer',
                  }}
                >
                  ✕ Clear All
                </button>
              </div>
            </div>
            <CompareTable list={compareList} />
          </div>
        )}
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Compare table
// ──────────────────────────────────────────────
function CompareTable({ list }: { list: CompareEntry[] }) {
  if (list.length < 2) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: 32,
          color: 'var(--txt3)',
          fontSize: 13,
          background: 'var(--s3)',
          border: '1px solid var(--br)',
          borderRadius: 6,
        }}
      >
        Add at least 2 companies to see the comparison table.
        <br />
        <span style={{ fontSize: 12, marginTop: 6, display: 'block' }}>
          Select from dropdown → Fill fields → Click "+ Add to Comparison"
        </span>
      </div>
    )
  }

  const fmt = (v: number) => (v > 0 ? `₹${Math.round(v).toLocaleString('en-IN')}Cr` : '—')
  const fmtX = (v: number) => (v > 0 ? `${v.toFixed(1)}×` : '—')
  const fmtPct = (v: number) => (v > 0 ? `${v.toFixed(1)}%` : '—')

  type Row = [string, string[], boolean, string?]

  const sections: { title: string; rows: Row[]; highlight?: boolean }[] = [
    {
      title: '📊 Input Assumptions',
      rows: [
        ['Revenue (₹Cr)', list.map((c) => fmt(c.inputs.rev)), true],
        ['EBITDA Margin', list.map((c) => fmtPct(c.inputs.ebm)), true],
        ['Revenue Growth', list.map((c) => fmtPct(c.inputs.gr)), true],
        ['Net Debt (₹Cr)', list.map((c) => fmt(c.inputs.debt)), false],
        ['WACC', list.map((c) => fmtPct(c.inputs.wacc)), false],
        ['Terminal Growth', list.map((c) => fmtPct(c.inputs.tgr)), true],
      ],
    },
    {
      title: '💰 Valuation Results',
      highlight: true,
      rows: [
        ['DCF Enterprise Value', list.map((c) => fmt(c.results.evBase)), false, 'primary'],
        ['EV incl. Synergies', list.map((c) => fmt(c.results.evSyn)), false, 'hero'],
        ['Equity Value (standalone)', list.map((c) => fmt(c.results.equity)), false],
        ['Equity Value (synergies)', list.map((c) => fmt(c.results.eqSyn)), false, 'primary'],
        ['Implied EV/EBITDA', list.map((c) => fmtX(c.results.eveb)), false],
      ],
    },
    {
      title: '🔗 Synergy Analysis',
      rows: [
        ['Revenue Synergy Input', list.map((c) => fmt(c.inputs.rs)), true],
        ['Cost Synergy Input', list.map((c) => fmt(c.inputs.cs)), true],
        ['Integration Cost', list.map((c) => fmt(c.inputs.ic)), false],
        ['Synergy NPV', list.map((c) => fmt(c.results.synPV)), true],
      ],
    },
    {
      title: '🎯 Acquisition Guidance',
      rows: [
        ['Bid Floor', list.map((c) => fmt(c.results.bidLow)), false, 'bid'],
        ['Bid Ceiling', list.map((c) => fmt(c.results.bidHigh)), false, 'bid'],
        ['Max Walk-Away Price', list.map((c) => fmt(c.results.walkAway)), false],
        ['EV/EBITDA (w/ syn.)', list.map((c) => fmtX(c.results.evebSyn)), false],
      ],
    },
  ]

  const n = list.length
  const maxEV = Math.max(...list.map((c) => c.results.evSyn))

  return (
    <div style={{ overflowX: 'auto' }}>
      <table
        style={{
          width: '100%',
          borderCollapse: 'collapse',
          fontSize: 13,
          background: 'var(--s3)',
          border: '1px solid var(--br)',
          borderRadius: 6,
        }}
      >
        <thead>
          <tr>
            <th
              style={{
                textAlign: 'left',
                padding: '10px 12px',
                minWidth: 180,
                borderBottom: '1px solid var(--br)',
                color: 'var(--txt3)',
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}
            >
              Metric
            </th>
            {list.map((c) => (
              <th
                key={c.name}
                style={{
                  textAlign: 'left',
                  padding: '10px 12px',
                  borderBottom: '1px solid var(--br)',
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)' }}>{c.name}</div>
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--txt3)',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  ₹{c.inputs.rev.toLocaleString('en-IN')}Cr rev
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* EV bar */}
          <tr>
            <td
              colSpan={n + 1}
              style={{
                background: 'var(--s2)',
                padding: '6px 12px',
                fontSize: 11,
                color: 'var(--txt3)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                borderBottom: '1px solid var(--br)',
              }}
            >
              📊 Enterprise Value Bar (proportional to EV incl. synergies)
            </td>
          </tr>
          <tr>
            <td
              style={{
                padding: '8px 12px',
                color: 'var(--txt3)',
                fontSize: 12,
                borderBottom: '1px solid var(--br)',
              }}
            >
              EV Bar
            </td>
            {list.map((c) => {
              const pct = maxEV > 0 ? Math.round((c.results.evSyn / maxEV) * 180) : 0
              return (
                <td
                  key={c.name}
                  style={{
                    padding: '8px 12px',
                    borderBottom: '1px solid var(--br)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: pct,
                        height: 8,
                        background: 'var(--gold2)',
                        borderRadius: 2,
                      }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--txt3)' }}>
                      ₹{Math.round(c.results.evSyn / 1000)}K Cr
                    </span>
                  </div>
                </td>
              )
            })}
          </tr>

          {sections.map((sec) => (
            <FragmentWithKey key={sec.title}>
              <tr>
                <td
                  colSpan={n + 1}
                  style={{
                    background: 'var(--s2)',
                    padding: '8px 12px',
                    fontSize: 11,
                    color: 'var(--gold2)',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.6px',
                    borderBottom: '1px solid var(--br)',
                  }}
                >
                  {sec.title}
                </td>
              </tr>
              {sec.rows.map(([lbl, vals, higherIsBetter, style]) => {
                const nums = vals.map((v) => parseFloat(v.replace(/[₹,Cr×%]/g, '')) || 0)
                const validNums = nums.filter((x) => x > 0)
                const bestVal = validNums.length
                  ? higherIsBetter
                    ? Math.max(...validNums)
                    : Math.min(...validNums)
                  : null
                const worstVal =
                  validNums.length >= 2
                    ? higherIsBetter
                      ? Math.min(...validNums)
                      : Math.max(...validNums)
                    : null
                const isHero = style === 'hero'
                const isBid = style === 'bid'
                const isPrimary = style === 'primary'
                const rowBg = isHero
                  ? 'rgba(16,185,129,0.08)'
                  : isPrimary
                  ? 'var(--golddim, rgba(247,183,49,0.08))'
                  : isBid
                  ? 'var(--cyandim, rgba(0,180,216,0.08))'
                  : 'transparent'
                return (
                  <tr key={lbl} style={{ background: rowBg }}>
                    <td
                      style={{
                        padding: '8px 12px',
                        color: 'var(--txt3)',
                        fontSize: 12,
                        borderBottom: '1px solid var(--br)',
                      }}
                    >
                      {lbl}
                    </td>
                    {vals.map((v, i) => {
                      const num = nums[i]
                      const isBest = bestVal !== null && num === bestVal
                      const isWorst =
                        worstVal !== null && num === worstVal && num !== bestVal
                      const color = isBest
                        ? 'var(--green)'
                        : isWorst
                        ? 'var(--red)'
                        : isBid
                        ? 'var(--cyan2)'
                        : 'var(--txt)'
                      return (
                        <td
                          key={i}
                          style={{
                            padding: '8px 12px',
                            color,
                            fontSize: isHero ? 14 : 13,
                            fontWeight: isHero ? 800 : isBest ? 700 : 500,
                            fontFamily: 'JetBrains Mono, monospace',
                            borderBottom: '1px solid var(--br)',
                          }}
                        >
                          {v}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </FragmentWithKey>
          ))}
        </tbody>
      </table>

      <div
        style={{
          marginTop: 10,
          fontSize: 11,
          color: 'var(--txt3)',
          display: 'flex',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <span>
          <span
            style={{
              background: 'rgba(16,185,129,0.12)',
              color: 'var(--green)',
              padding: '2px 6px',
              borderRadius: 3,
            }}
          >
            Green
          </span>{' '}
          = Best in group for this metric
        </span>
        <span>
          <span
            style={{
              background: 'rgba(239,68,68,0.12)',
              color: 'var(--red)',
              padding: '2px 6px',
              borderRadius: 3,
            }}
          >
            Red
          </span>{' '}
          = Highest cost / least attractive
        </span>
        <span>EV/EBITDA lower = cheaper acquisition · Bid range = 90% EV to 95% EV+Syn</span>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────
// Small helpers
// ──────────────────────────────────────────────
function TabBtn({
  active,
  onClick,
  label,
}: {
  active: boolean
  onClick: () => void
  label: string
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? 'var(--s3)' : 'transparent',
        color: active ? 'var(--gold2)' : 'var(--txt3)',
        border: 'none',
        borderBottom: active ? '2px solid var(--gold2)' : '2px solid transparent',
        padding: '10px 14px',
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        color: 'var(--txt3)',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.8px',
        marginBottom: 8,
        marginTop: 4,
      }}
    >
      {children}
    </div>
  )
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--s3)',
        border: '1px solid var(--br)',
        borderRadius: 7,
        padding: 14,
        marginBottom: 14,
      }}
    >
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--s2)',
  border: '1px solid var(--br)',
  color: 'var(--txt)',
  padding: '7px 10px',
  borderRadius: 5,
  fontSize: 13,
  outline: 'none',
  fontFamily: 'JetBrains Mono, monospace',
}

function Field({
  label,
  children,
  onLabelClick,
}: {
  label: string
  children: React.ReactNode
  onLabelClick?: () => void
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div
        onClick={onLabelClick}
        title={onLabelClick ? 'Click to see how this is calculated' : undefined}
        style={{
          fontSize: 10,
          color: onLabelClick ? 'var(--gold2)' : 'var(--txt3)',
          marginBottom: 4,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          cursor: onLabelClick ? 'pointer' : 'default',
          borderBottom: onLabelClick ? '1px dotted var(--gold2)' : undefined,
          display: 'inline-block',
        }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
  onLabelClick,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  onLabelClick?: () => void
}) {
  return (
    <Field label={label} onLabelClick={onLabelClick}>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        style={inputStyle}
      />
    </Field>
  )
}

function DcfLine({
  label,
  value,
  highlight,
  color,
  onClick,
}: {
  label: string
  value: string
  highlight?: boolean
  color?: string
  onClick?: () => void
}) {
  return (
    <div
      onClick={onClick}
      title={onClick ? 'Click to see full calculation breakdown' : undefined}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 0',
        borderBottom: '1px solid var(--br)',
        background: highlight ? 'rgba(247,183,49,0.08)' : 'transparent',
        marginLeft: highlight ? -14 : 0,
        marginRight: highlight ? -14 : 0,
        paddingLeft: highlight ? 14 : 0,
        paddingRight: highlight ? 14 : 0,
        cursor: onClick ? 'pointer' : 'default',
        transition: 'background 0.15s',
      }}
      onMouseEnter={
        onClick
          ? (e) =>
              (e.currentTarget.style.background = highlight
                ? 'rgba(247,183,49,0.16)'
                : 'rgba(212,175,55,0.06)')
          : undefined
      }
      onMouseLeave={
        onClick
          ? (e) =>
              (e.currentTarget.style.background = highlight
                ? 'rgba(247,183,49,0.08)'
                : 'transparent')
          : undefined
      }
    >
      <span
        style={{
          fontSize: 12,
          color: 'var(--txt3)',
          borderBottom: onClick ? '1px dotted var(--txt3)' : undefined,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: highlight ? 15 : 13,
          fontWeight: highlight ? 700 : 600,
          color: color || (highlight ? 'var(--gold2)' : 'var(--txt)'),
          fontFamily: 'JetBrains Mono, monospace',
        }}
      >
        {value}
      </span>
    </div>
  )
}
