'use client'

/**
 * CRVI Framework Tab — Corporate Restructuring, Valuation & Insolvency
 * Intelligence Studio inside M&A Strategy.
 *
 * Flow:
 *   1. Pick a subject company (listed or private) → auto-fills inputs
 *      from DealNector's COMPANIES snapshot.
 *   2. Threshold Alerts panel — live SEBI SAST / CCI / SARFAESI /
 *      Buy-back / Capital-Reduction / SICA signals.
 *   3. Decision Wizard — 23-node walk from A1 to an Outcome.
 *   4. Strategy Matrix — 25 strategies, filterable + scored /20.
 *   5. Calculators — swap ratio, open-offer price, buy-back headroom,
 *      slump-sale tax.
 *   6. Case-law reference.
 *   7. AI Reasoning — composes a CRVI-specific prompt using the live
 *      profile and sends to Anthropic via the user-configured key.
 *
 * Every UI block uses DealNector tokens (var(--s1)/(--s2)/(--gold2)
 * /(--txt)/(--txt3)/(--br)) so the tab sits natively beside the
 * existing Strategic Algorithm tabs.
 */

import { useEffect, useMemo, useState } from 'react'
import { COMPANIES, type Company } from '@/lib/data/companies'
import { PRIVATE_COMPANIES, type PrivateCompany } from '@/lib/data/private-companies'
import {
  STRATEGIES,
  ALGO,
  OUTCOMES,
  CASE_LAWS,
  type Strategy,
  type Outcome,
  type CRVIPart,
} from '@/lib/crvi/data'
import {
  sastOpenOfferCheck,
  cciThresholdCheck,
  sarfaesiEligibility,
  sicaSickCheck,
  buybackHeadroom,
  capitalReductionCheck,
  swapRatioCalc,
  slumpSaleTax,
  type CRVIInputs,
} from '@/lib/crvi/thresholds'
import { Badge } from '@/components/ui/Badge'

// ── Types ─────────────────────────────────────────────────

type Section = 'profile' | 'alerts' | 'wizard' | 'matrix' | 'calcs' | 'cases' | 'ai'

const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  { id: 'profile', label: 'Company Profile', icon: '🏢' },
  { id: 'alerts', label: 'Threshold Alerts', icon: '🚨' },
  { id: 'wizard', label: 'Decision Wizard', icon: '🧭' },
  { id: 'matrix', label: 'Strategy Matrix', icon: '📊' },
  { id: 'calcs', label: 'Calculators', icon: '🧮' },
  { id: 'cases', label: 'Case Laws', icon: '⚖️' },
  { id: 'ai', label: 'AI Analysis', icon: '🤖' },
]

// ── Helpers: build default CRVIInputs from a Company ─────

function companyToInputs(co: Company | null): CRVIInputs {
  if (!co) {
    return {
      name: '',
      listed: true,
      pucCr: 0,
      reservesCr: 0,
      secPremiumCr: 0,
      debitPlCr: 0,
      securedDebtCr: 0,
      unsecuredDebtCr: 0,
      netWorthHistoryCr: [],
      revCr: 0,
      ebitdaCr: 0,
      patCr: 0,
      accLossCr: 0,
      totalAssetsCr: 0,
      fixedAssetsCr: 0,
      intangiblesCr: 0,
      indiaTurnoverCr: 0,
      globalAssetsUsdMn: 0,
      globalRevUsdMn: 0,
      promoterPct: 50,
      publicPct: 50,
      totalShares: 0,
      faceVal: 10,
      cmp: 0,
      h52: 0,
      vwap60: 0,
      mcapCr: 0,
    }
  }
  // Heuristic back-of-envelope from Company snapshot.
  const bookValue = co.pb > 0 ? co.mktcap / co.pb : co.mktcap * 0.6
  const debt = Math.max(0, co.ev - co.mktcap)
  const secured = debt * 0.7
  const unsecured = debt * 0.3
  return {
    name: co.name,
    cin: co.ticker,
    listed: true,
    pucCr: Math.max(50, bookValue * 0.1),
    reservesCr: bookValue * 0.9,
    secPremiumCr: bookValue * 0.3,
    debitPlCr: co.pat < 0 ? Math.abs(co.pat) * 2 : 0,
    securedDebtCr: secured,
    unsecuredDebtCr: unsecured,
    netWorthHistoryCr: [bookValue * 0.85, bookValue * 0.9, bookValue * 0.95, bookValue],
    revCr: co.rev,
    ebitdaCr: co.ebitda,
    patCr: co.pat,
    accLossCr: co.pat < 0 ? Math.abs(co.pat) * 3 : 0,
    totalAssetsCr: co.mktcap * 1.2,
    fixedAssetsCr: co.mktcap * 0.6,
    intangiblesCr: co.mktcap * 0.08,
    indiaTurnoverCr: co.rev,
    globalAssetsUsdMn: 0,
    globalRevUsdMn: 0,
    promoterPct: 55,
    publicPct: 45,
    totalShares: Math.max(1e6, (co.mktcap * 1e7) / Math.max(10, co.pb || 100)),
    faceVal: 10,
    cmp: co.pb > 0 ? (co.mktcap * 1e7) / Math.max(1, (co.mktcap * 1e7) / 100) : 100,
    h52: 0,
    vwap60: 0,
    mcapCr: co.mktcap,
  }
}

// ── Main Component ────────────────────────────────────────

export function CRVITab() {
  const [section, setSection] = useState<Section>('profile')

  // Company picker state — supports listed + private
  const allCompanies = useMemo(() => {
    const listed = COMPANIES.map((c) => ({
      key: c.ticker,
      label: `${c.name} (${c.ticker})`,
      co: c,
      listed: true,
    }))
    const priv = PRIVATE_COMPANIES.map((p: PrivateCompany, i: number) => ({
      key: `P-${p.name}-${i}`,
      label: `${p.name} · private`,
      co: {
        name: p.name,
        ticker: p.name.replace(/\s+/g, '').toUpperCase().slice(0, 10),
        nse: null,
        sec: p.sec,
        comp: p.comp,
        mktcap: p.ev_est,
        rev: p.rev_est,
        ebitda: Math.round((p.rev_est * p.ebm_est) / 100),
        pat: 0,
        ev: p.ev_est,
        ev_eb: 0,
        pe: 0,
        pb: 0,
        dbt_eq: 0,
        revg: p.revg_est,
        ebm: p.ebm_est,
        acqs: p.acqs,
        acqf: p.acqf,
        rea: p.rea,
      } as Company,
      listed: false,
    }))
    return [...listed, ...priv].sort((a, b) => a.label.localeCompare(b.label))
  }, [])

  const [subjectKey, setSubjectKey] = useState<string>(allCompanies[0]?.key || '')
  const subject = allCompanies.find((c) => c.key === subjectKey)
  const [inputs, setInputs] = useState<CRVIInputs>(() => companyToInputs(subject?.co || null))

  useEffect(() => {
    if (subject) setInputs(companyToInputs(subject.co))
  }, [subjectKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Live-computed threshold alerts (re-runs as inputs change)
  const alerts = useMemo(() => {
    return {
      sast: sastOpenOfferCheck(inputs),
      cci: cciThresholdCheck(inputs),
      sarfaesi: sarfaesiEligibility(inputs),
      sica: sicaSickCheck(inputs),
      buyback: buybackHeadroom(inputs, 0),
      capred: capitalReductionCheck(inputs),
    }
  }, [inputs])

  return (
    <div>
      {/* Intro copy */}
      <div
        style={{
          marginBottom: 16,
          fontSize: 13,
          color: 'var(--txt3)',
          lineHeight: 1.6,
        }}
      >
        <strong style={{ color: 'var(--txt)' }}>CRVI Intelligence Studio</strong> — a live-law
        advisor that walks from company profile to recommended restructuring, valuation or
        insolvency path. Anchored in the ICSI <em>PP-CRVI-2014</em> framework and current
        Indian statutes (Companies Act 2013, SEBI SAST 2011, IBC 2016, Competition Act 2002,
        SARFAESI 2002, FEMA 1999, Income-Tax Act 1961). Pick a company, verify the
        auto-filled inputs, then use the Decision Wizard for the recommended strategy.
      </div>

      {/* Company picker */}
      <div
        style={{
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 14,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
          }}
        >
          Subject
        </div>
        <select
          value={subjectKey}
          onChange={(e) => setSubjectKey(e.target.value)}
          style={{
            background: 'var(--s2)',
            color: 'var(--txt)',
            border: '1px solid var(--br2)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 13,
            minWidth: 260,
          }}
        >
          {allCompanies.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        {subject && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Badge variant={subject.listed ? 'green' : 'gold'}>
              {subject.listed ? 'Listed' : 'Private'}
            </Badge>
            <Badge variant="gray">{subject.co.sec === 'solar' ? 'Solar' : 'T&D'}</Badge>
            {subject.co.mktcap > 0 && (
              <Badge variant="cyan">
                ₹{Math.round(subject.co.mktcap).toLocaleString('en-IN')} Cr mcap
              </Badge>
            )}
          </div>
        )}
      </div>

      {/* Section tabs (inner) */}
      <div
        style={{
          display: 'flex',
          gap: 2,
          marginBottom: 16,
          flexWrap: 'wrap',
          background: 'var(--s1)',
          padding: 4,
          borderRadius: 8,
          border: '1px solid var(--br)',
        }}
      >
        {SECTIONS.map((s) => {
          const active = section === s.id
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              style={{
                background: active ? 'var(--s3)' : 'transparent',
                border: 'none',
                color: active ? 'var(--gold2)' : 'var(--txt2)',
                padding: '7px 12px',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: active ? 600 : 500,
                transition: 'all .15s',
              }}
            >
              <span style={{ marginRight: 6 }}>{s.icon}</span>
              {s.label}
            </button>
          )
        })}
      </div>

      {section === 'profile' && (
        <ProfileSection inputs={inputs} setInputs={setInputs} />
      )}
      {section === 'alerts' && <AlertsSection alerts={alerts} />}
      {section === 'wizard' && <WizardSection inputs={inputs} />}
      {section === 'matrix' && <MatrixSection />}
      {section === 'calcs' && <CalcsSection inputs={inputs} setInputs={setInputs} />}
      {section === 'cases' && <CasesSection />}
      {section === 'ai' && <AISection inputs={inputs} alerts={alerts} />}
    </div>
  )
}

// ── Section: Profile inputs ────────────────────────────────

function ProfileSection({
  inputs,
  setInputs,
}: {
  inputs: CRVIInputs
  setInputs: (v: CRVIInputs) => void
}) {
  const num = (k: keyof CRVIInputs, label: string, unit = '₹ Cr') => (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontSize: 11,
        color: 'var(--txt3)',
      }}
    >
      <span>{label} <span style={{ color: 'var(--txt3)' }}>({unit})</span></span>
      <input
        type="number"
        value={(inputs[k] as number) ?? 0}
        onChange={(e) =>
          setInputs({ ...inputs, [k]: parseFloat(e.target.value || '0') })
        }
        style={{
          background: 'var(--s2)',
          color: 'var(--txt)',
          border: '1px solid var(--br)',
          borderRadius: 4,
          padding: '5px 8px',
          fontSize: 12,
        }}
      />
    </label>
  )

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 14, lineHeight: 1.6 }}>
        Figures are auto-filled from the company snapshot with reasonable estimates.
        Refine any field before running the Decision Wizard — all threshold tests
        downstream recompute live.
      </div>

      <Card title="Identity">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--txt3)' }}>
            <span>Name</span>
            <input
              type="text"
              value={inputs.name}
              onChange={(e) => setInputs({ ...inputs, name: e.target.value })}
              style={{
                background: 'var(--s2)',
                color: 'var(--txt)',
                border: '1px solid var(--br)',
                borderRadius: 4,
                padding: '5px 8px',
                fontSize: 12,
              }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--txt3)' }}>
            <span>CIN / Ticker</span>
            <input
              type="text"
              value={inputs.cin || ''}
              onChange={(e) => setInputs({ ...inputs, cin: e.target.value })}
              style={{
                background: 'var(--s2)',
                color: 'var(--txt)',
                border: '1px solid var(--br)',
                borderRadius: 4,
                padding: '5px 8px',
                fontSize: 12,
              }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 11, color: 'var(--txt3)' }}>
            <span>Listed?</span>
            <select
              value={inputs.listed ? 'yes' : 'no'}
              onChange={(e) => setInputs({ ...inputs, listed: e.target.value === 'yes' })}
              style={{
                background: 'var(--s2)',
                color: 'var(--txt)',
                border: '1px solid var(--br)',
                borderRadius: 4,
                padding: '5px 8px',
                fontSize: 12,
              }}
            >
              <option value="yes">Listed</option>
              <option value="no">Unlisted</option>
            </select>
          </label>
        </div>
      </Card>

      <Card title="Capital Structure">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {num('pucCr', 'Paid-Up Capital')}
          {num('reservesCr', 'Reserves')}
          {num('secPremiumCr', 'Securities Premium')}
          {num('debitPlCr', 'Debit P&L')}
          {num('securedDebtCr', 'Secured Debt')}
          {num('unsecuredDebtCr', 'Unsecured Debt')}
          {num('accLossCr', 'Accumulated Loss')}
          {num('totalAssetsCr', 'Total Assets')}
        </div>
      </Card>

      <Card title="P&L & Size">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {num('revCr', 'Revenue')}
          {num('ebitdaCr', 'EBITDA')}
          {num('patCr', 'PAT')}
          {num('indiaTurnoverCr', 'India Turnover')}
          {num('fixedAssetsCr', 'Fixed Assets')}
          {num('intangiblesCr', 'Intangibles')}
          {num('globalAssetsUsdMn', 'Global Assets', 'US$ Mn')}
          {num('globalRevUsdMn', 'Global Revenue', 'US$ Mn')}
        </div>
      </Card>

      <Card title="Shareholding & Market">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {num('promoterPct', 'Promoter Holding', '%')}
          {num('publicPct', 'Public Holding', '%')}
          {num('totalShares', 'Total Shares', '#')}
          {num('faceVal', 'Face Value', '₹')}
          {num('cmp', 'CMP', '₹')}
          {num('h52', '52-Week High', '₹')}
          {num('vwap60', '60-Day VWAP', '₹')}
          {num('mcapCr', 'Market Cap')}
        </div>
      </Card>

      <Card title="Distress Indicators">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
          {num('npaPrincipalCr', 'NPA Principal')}
          {num('overdueDays', 'Overdue Days', 'days')}
        </div>
      </Card>
    </div>
  )
}

// ── Section: Alerts ───────────────────────────────────────

type AlertsBundle = {
  sast: ReturnType<typeof sastOpenOfferCheck>
  cci: ReturnType<typeof cciThresholdCheck>
  sarfaesi: ReturnType<typeof sarfaesiEligibility>
  sica: ReturnType<typeof sicaSickCheck>
  buyback: ReturnType<typeof buybackHeadroom>
  capred: ReturnType<typeof capitalReductionCheck>
}

function AlertsSection({ alerts }: { alerts: AlertsBundle }) {
  const tiles = [
    {
      key: 'sast',
      label: 'SEBI SAST — Open Offer',
      active: alerts.sast.triggered,
      summary: alerts.sast.basis,
      detail: `Minimum open-offer price ₹${alerts.sast.minOpenOfferPrice.toFixed(2)} × ${alerts.sast.openOfferSize.toLocaleString(
        'en-IN'
      )} shares (26% of capital)`,
      law: alerts.sast.law,
    },
    {
      key: 'cci',
      label: 'CCI — Combination Filing',
      active: alerts.cci.filingRequired,
      summary: alerts.cci.basis,
      detail:
        alerts.cci.formType !== 'none'
          ? `Form ${alerts.cci.formType} filing — fee ₹${alerts.cci.feeLakh} lakh`
          : 'No filing required',
      law: alerts.cci.law,
    },
    {
      key: 'sarfaesi',
      label: 'SARFAESI — Enforcement Path',
      active: alerts.sarfaesi.eligible,
      summary: alerts.sarfaesi.basis,
      detail: `§13(2) notice → ${alerts.sarfaesi.minNoticeDays}-day window before §13(4) possession`,
      law: alerts.sarfaesi.law,
    },
    {
      key: 'sica',
      label: 'Sick-Company Signal (SICA test)',
      active: alerts.sica.sick,
      summary: alerts.sica.basis,
      detail: `Net worth erosion: ${alerts.sica.erosionPct.toFixed(1)}% from peak`,
      law: alerts.sica.law,
    },
    {
      key: 'buyback',
      label: 'Buy-back Headroom',
      active: alerts.buyback.maxBuybackCr > 0,
      summary: alerts.buyback.basis,
      detail: `Max via SR: ₹${alerts.buyback.maxBuybackCr.toFixed(0)} Cr; post-D/E ${alerts.buyback.postDe.toFixed(
        2
      )}`,
      law: alerts.buyback.law,
    },
    {
      key: 'capred',
      label: 'Capital Reduction',
      active: alerts.capred.recommended,
      summary: alerts.capred.basis,
      detail: `Absorbable: ₹${alerts.capred.absorbableCr.toFixed(0)} Cr against paid-up + premium`,
      law: alerts.capred.law,
    },
  ]

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 14, lineHeight: 1.6 }}>
        Live statutory thresholds computed from the current profile inputs.
        A <strong style={{ color: 'var(--red)' }}>red</strong> tile means an obligation or
        path is triggered; <strong style={{ color: 'var(--green)' }}>green</strong> means
        clear. Each tile cites the governing section.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
        {tiles.map((t) => (
          <div
            key={t.key}
            style={{
              background: 'var(--s1)',
              border: `1px solid ${t.active ? 'rgba(239,68,68,.4)' : 'var(--br)'}`,
              borderLeft: `4px solid ${t.active ? 'var(--red)' : 'var(--green)'}`,
              borderRadius: 8,
              padding: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--txt)',
                  fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                }}
              >
                {t.label}
              </div>
              <Badge variant={t.active ? 'red' : 'green'}>
                {t.active ? 'TRIGGERED' : 'CLEAR'}
              </Badge>
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.5, marginBottom: 6 }}>
              {t.summary}
            </div>
            <div style={{ fontSize: 11, color: 'var(--txt3)', marginBottom: 8, lineHeight: 1.5 }}>
              {t.detail}
            </div>
            <div
              style={{
                fontSize: 10,
                color: 'var(--gold2)',
                borderTop: '1px dashed var(--br)',
                paddingTop: 6,
                letterSpacing: '.3px',
              }}
            >
              ⚖ {t.law}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Section: Decision Wizard ──────────────────────────────

function WizardSection({ inputs }: { inputs: CRVIInputs }) {
  const [path, setPath] = useState<string[]>(['A1'])
  const [outcomeId, setOutcomeId] = useState<string | null>(null)

  const currentNodeId = path[path.length - 1]
  const currentNode = ALGO[currentNodeId]
  const currentOutcome = outcomeId ? OUTCOMES[outcomeId] : null
  const strategy = currentOutcome
    ? STRATEGIES.find((s) => s.id === currentOutcome.strategy)
    : null

  const answer = (yes: boolean) => {
    if (!currentNode) return
    const next = yes ? currentNode.yes : currentNode.no
    if (next.startsWith('OUT:')) {
      setOutcomeId(next.slice(4))
    } else {
      setPath([...path, next])
    }
  }

  const back = () => {
    if (outcomeId) {
      setOutcomeId(null)
      return
    }
    if (path.length > 1) setPath(path.slice(0, -1))
  }

  const reset = () => {
    setPath(['A1'])
    setOutcomeId(null)
  }

  const progressPct = Math.min(
    100,
    outcomeId ? 100 : Math.round((path.length / 7) * 100)
  )

  return (
    <div style={{ maxWidth: 820 }}>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 14, lineHeight: 1.6 }}>
        A 23-node decision tree that maps listing status, combination type, distress signals
        and cross-border flags to a single terminal <strong style={{ color: 'var(--txt)' }}>recommendation</strong>.
        Each question cites the governing law; your subject&apos;s current inputs (
        <span style={{ color: 'var(--gold2)' }}>{inputs.name || 'no company'}</span>) are used
        to pre-hint obvious answers where possible.
      </div>

      {/* Progress */}
      <div
        style={{
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          borderRadius: 6,
          height: 6,
          marginBottom: 16,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: 'var(--gold2)',
            height: '100%',
            width: `${progressPct}%`,
            transition: 'width .3s',
          }}
        />
      </div>

      {currentOutcome && strategy ? (
        <OutcomeCard outcome={currentOutcome} strategy={strategy} reset={reset} back={back} />
      ) : currentNode ? (
        <div
          style={{
            background: 'var(--s1)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: 20,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: 'var(--txt3)',
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            Node {currentNode.id} · Step {path.length}
          </div>
          <div
            style={{
              fontSize: 16,
              color: 'var(--txt)',
              fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
              lineHeight: 1.5,
              marginBottom: 12,
            }}
          >
            {currentNode.q}
          </div>
          {currentNode.hint && (
            <div
              style={{
                fontSize: 12,
                color: 'var(--txt3)',
                background: 'var(--s2)',
                borderLeft: '3px solid var(--cyan2)',
                padding: '8px 10px',
                borderRadius: 4,
                marginBottom: 14,
                lineHeight: 1.5,
              }}
            >
              💡 {currentNode.hint}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <button
              onClick={() => answer(true)}
              style={{
                flex: 1,
                background: 'var(--greendim)',
                border: '1px solid var(--green)',
                color: 'var(--green)',
                padding: '10px 16px',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              ✓ Yes
            </button>
            <button
              onClick={() => answer(false)}
              style={{
                flex: 1,
                background: 'var(--reddim)',
                border: '1px solid var(--red)',
                color: 'var(--red)',
                padding: '10px 16px',
                borderRadius: 6,
                cursor: 'pointer',
                fontWeight: 600,
                fontSize: 13,
              }}
            >
              ✗ No
            </button>
          </div>
          <div
            style={{
              fontSize: 11,
              color: 'var(--gold2)',
              borderTop: '1px dashed var(--br)',
              paddingTop: 10,
            }}
          >
            ⚖ {currentNode.law}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={back}
              disabled={path.length <= 1}
              style={{
                background: 'var(--s2)',
                border: '1px solid var(--br2)',
                color: 'var(--txt2)',
                padding: '6px 12px',
                borderRadius: 4,
                cursor: path.length > 1 ? 'pointer' : 'not-allowed',
                opacity: path.length > 1 ? 1 : 0.5,
                fontSize: 11,
              }}
            >
              ← Back
            </button>
            <button
              onClick={reset}
              style={{
                background: 'var(--s2)',
                border: '1px solid var(--br2)',
                color: 'var(--txt2)',
                padding: '6px 12px',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 11,
              }}
            >
              ↺ Reset
            </button>
          </div>
        </div>
      ) : (
        <div style={{ color: 'var(--txt3)' }}>Invalid node.</div>
      )}
    </div>
  )
}

function OutcomeCard({
  outcome,
  strategy,
  reset,
  back,
}: {
  outcome: Outcome
  strategy: Strategy
  reset: () => void
  back: () => void
}) {
  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(184,134,11,.08), transparent)',
        border: '1px solid var(--gold2)',
        borderRadius: 10,
        padding: 20,
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: 'var(--gold2)',
          letterSpacing: '2px',
          textTransform: 'uppercase',
          marginBottom: 6,
        }}
      >
        Recommended Path
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          color: 'var(--txt)',
          fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
          marginBottom: 8,
        }}
      >
        {outcome.label}
      </div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <Badge variant="gold">Score {outcome.score}/20</Badge>
        <Badge variant="cyan">
          Part {strategy.part === 'A' ? 'A · Restructuring' : strategy.part === 'B' ? 'B · Valuation' : 'C · Insolvency'}
        </Badge>
      </div>
      <div style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.6, marginBottom: 14 }}>
        {outcome.rationale}
      </div>
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'var(--txt)',
          marginBottom: 8,
          fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
        }}
      >
        Execution Checklist
      </div>
      <ol style={{ margin: 0, paddingLeft: 20, color: 'var(--txt2)', fontSize: 12, lineHeight: 1.7 }}>
        {outcome.action.map((step, i) => (
          <li key={i} style={{ marginBottom: 4 }}>
            {step}
          </li>
        ))}
      </ol>
      <div
        style={{
          marginTop: 14,
          fontSize: 11,
          color: 'var(--gold2)',
          borderTop: '1px dashed var(--br)',
          paddingTop: 10,
        }}
      >
        ⚖ {outcome.law}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        <button
          onClick={back}
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br2)',
            color: 'var(--txt2)',
            padding: '6px 12px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 11,
          }}
        >
          ← Back
        </button>
        <button
          onClick={reset}
          style={{
            background: 'var(--gold2)',
            border: '1px solid var(--gold2)',
            color: '#000',
            padding: '6px 14px',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          ↺ Re-run Wizard
        </button>
      </div>
    </div>
  )
}

// ── Section: Strategy Matrix ──────────────────────────────

function MatrixSection() {
  const [partFilter, setPartFilter] = useState<CRVIPart | 'ALL'>('ALL')
  const [minScore, setMinScore] = useState(0)

  const rows = useMemo(() => {
    return STRATEGIES.filter(
      (s) => (partFilter === 'ALL' || s.part === partFilter) && s.score >= minScore
    ).sort((a, b) => b.score - a.score)
  }, [partFilter, minScore])

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 14, lineHeight: 1.6 }}>
        All 25 CRVI strategies scored on the <strong style={{ color: 'var(--txt)' }}>four-lens model</strong> —
        Strategic (S) · Tactical (T) · Economic (E) · Compliance (C) — each /5, rolled up to /20.
        Filter by syllabus Part and minimum score to shortlist the strategies relevant to your subject.
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <select
          value={partFilter}
          onChange={(e) => setPartFilter(e.target.value as CRVIPart | 'ALL')}
          style={{
            background: 'var(--s2)',
            color: 'var(--txt)',
            border: '1px solid var(--br2)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12,
          }}
        >
          <option value="ALL">All Parts</option>
          <option value="A">Part A · Restructuring</option>
          <option value="B">Part B · Valuation</option>
          <option value="C">Part C · Insolvency</option>
        </select>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--txt3)', fontSize: 12 }}>
          Min Score:
          <input
            type="range"
            min={0}
            max={20}
            value={minScore}
            onChange={(e) => setMinScore(parseInt(e.target.value))}
            style={{ width: 120 }}
          />
          <span style={{ color: 'var(--gold2)', fontWeight: 600 }}>{minScore}</span>
        </label>
        <span style={{ color: 'var(--txt3)', fontSize: 11, alignSelf: 'center' }}>
          {rows.length} of {STRATEGIES.length} strategies
        </span>
      </div>
      <div
        style={{
          overflowX: 'auto',
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          borderRadius: 8,
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--s3)', color: 'var(--txt3)', fontSize: 10, letterSpacing: '1px', textTransform: 'uppercase' }}>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>Strategy</th>
              <th style={{ textAlign: 'center', padding: '10px 12px' }}>Part</th>
              <th style={{ textAlign: 'right', padding: '10px 12px' }}>S</th>
              <th style={{ textAlign: 'right', padding: '10px 12px' }}>T</th>
              <th style={{ textAlign: 'right', padding: '10px 12px' }}>E</th>
              <th style={{ textAlign: 'right', padding: '10px 12px' }}>C</th>
              <th style={{ textAlign: 'right', padding: '10px 12px' }}>Total</th>
              <th style={{ textAlign: 'left', padding: '10px 12px' }}>Governing Law</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} style={{ borderTop: '1px solid var(--br)' }}>
                <td style={{ padding: '10px 12px', color: 'var(--txt)' }}>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 2 }}>{s.trigger}</div>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                  <Badge variant={s.part === 'A' ? 'cyan' : s.part === 'B' ? 'gold' : 'red'}>{s.part}</Badge>
                </td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--txt2)' }}>{s.s}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--txt2)' }}>{s.t}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--txt2)' }}>{s.e}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', color: 'var(--txt2)' }}>{s.c}</td>
                <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: 'var(--gold2)' }}>
                  {s.score}
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--txt3)', fontSize: 11 }}>{s.law}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Section: Calculators ──────────────────────────────────

function CalcsSection({
  inputs,
  setInputs,
}: {
  inputs: CRVIInputs
  setInputs: (v: CRVIInputs) => void
}) {
  // Buy-back proposed amount (local state)
  const [bbProposedCr, setBbProposedCr] = useState(0)
  // Slump sale
  const [ssLumpSumCr, setSsLumpSumCr] = useState(0)
  const [ssNwCr, setSsNwCr] = useState(0)
  const [ssMonths, setSsMonths] = useState(60)

  const sast = useMemo(() => sastOpenOfferCheck(inputs), [inputs])
  const cci = useMemo(() => cciThresholdCheck(inputs), [inputs])
  const bb = useMemo(() => buybackHeadroom(inputs, bbProposedCr), [inputs, bbProposedCr])
  const swap = useMemo(() => swapRatioCalc(inputs), [inputs])
  const slump = useMemo(
    () => slumpSaleTax(ssLumpSumCr, ssNwCr, ssMonths),
    [ssLumpSumCr, ssNwCr, ssMonths]
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 14 }}>
      {/* SAST Open Offer */}
      <CalcCard title="SEBI SAST — Open Offer Price" law={sast.law}>
        <KV k="Triggered?" v={sast.triggered ? 'Yes' : 'No'} highlight={sast.triggered} />
        <KV k="Basis" v={sast.basis} />
        <KV k="Min Offer Price" v={`₹${sast.minOpenOfferPrice.toFixed(2)}`} />
        <KV
          k="Open Offer Size"
          v={`${sast.openOfferSize.toLocaleString('en-IN')} shares (26%)`}
        />
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Target Post-hold %
            <input
              type="number"
              value={inputs.tPostHoldPct || ''}
              onChange={(e) =>
                setInputs({ ...inputs, tPostHoldPct: parseFloat(e.target.value || '0') })
              }
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Negotiated Price (₹)
            <input
              type="number"
              value={inputs.tNegotiatedPrice || ''}
              onChange={(e) =>
                setInputs({ ...inputs, tNegotiatedPrice: parseFloat(e.target.value || '0') })
              }
              style={inputStyle}
            />
          </label>
        </div>
      </CalcCard>

      {/* CCI Threshold */}
      <CalcCard title="CCI — Combination Filing" law={cci.law}>
        <KV k="Filing Required?" v={cci.filingRequired ? 'Yes' : 'No'} highlight={cci.filingRequired} />
        <KV k="Form Type" v={cci.formType === 'none' ? '—' : `Form ${cci.formType}`} />
        <KV k="Fee" v={cci.feeLakh > 0 ? `₹${cci.feeLakh} lakh` : '—'} />
        <KV k="Basis" v={cci.basis} />
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Target India Assets (₹ Cr)
            <input
              type="number"
              value={inputs.tAssetsCr || ''}
              onChange={(e) =>
                setInputs({ ...inputs, tAssetsCr: parseFloat(e.target.value || '0') })
              }
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Target India Turnover (₹ Cr)
            <input
              type="number"
              value={inputs.tTurnoverCr || ''}
              onChange={(e) =>
                setInputs({ ...inputs, tTurnoverCr: parseFloat(e.target.value || '0') })
              }
              style={inputStyle}
            />
          </label>
        </div>
      </CalcCard>

      {/* Buy-back Headroom */}
      <CalcCard title="Buy-back Headroom (§68)" law={bb.law}>
        <KV k="Eligible?" v={bb.eligible ? 'Yes' : 'No'} highlight={bb.eligible} />
        <KV k="Max Headroom" v={`₹${bb.maxBuybackCr.toFixed(0)} Cr (25% cap via SR)`} />
        <KV
          k="Post-Buyback D/E"
          v={Number.isFinite(bb.postDe) ? bb.postDe.toFixed(2) : '—'}
        />
        <KV k="Basis" v={bb.basis} />
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Proposed Buy-back (₹ Cr)
            <input
              type="number"
              value={bbProposedCr}
              onChange={(e) => setBbProposedCr(parseFloat(e.target.value || '0'))}
              style={inputStyle}
            />
          </label>
        </div>
      </CalcCard>

      {/* Swap Ratio */}
      <CalcCard title="Swap Ratio (Miheer Mafatlal)" law={swap.law}>
        <KV k="Ratio" v={swap.ratio > 0 ? `${swap.ratio.toFixed(3)} : 1` : '—'} />
        <KV k="Acquirer Value/Share" v={`₹${swap.acquirerPerShare.toFixed(2)}`} />
        <KV k="Target Value/Share" v={`₹${swap.targetPerShare.toFixed(2)}`} />
        <KV k="Basis" v={swap.basis} />
        <div style={{ marginTop: 10 }}>
          <label style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Target CMP (₹)
            <input
              type="number"
              value={inputs.tCmp || ''}
              onChange={(e) =>
                setInputs({ ...inputs, tCmp: parseFloat(e.target.value || '0') })
              }
              style={inputStyle}
            />
          </label>
        </div>
      </CalcCard>

      {/* Slump Sale Tax */}
      <CalcCard title="Slump Sale Tax (§50B)" law={slump.law}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Lump-sum Consideration (₹ Cr)
            <input
              type="number"
              value={ssLumpSumCr}
              onChange={(e) => setSsLumpSumCr(parseFloat(e.target.value || '0'))}
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Undertaking Net Worth (₹ Cr)
            <input
              type="number"
              value={ssNwCr}
              onChange={(e) => setSsNwCr(parseFloat(e.target.value || '0'))}
              style={inputStyle}
            />
          </label>
          <label style={{ fontSize: 11, color: 'var(--txt3)' }}>
            Holding Period (months)
            <input
              type="number"
              value={ssMonths}
              onChange={(e) => setSsMonths(parseFloat(e.target.value || '0'))}
              style={inputStyle}
            />
          </label>
        </div>
        <KV k="Capital Gain" v={`₹${slump.capitalGainCr.toFixed(1)} Cr`} />
        <KV k="Classification" v={slump.isLTCG ? 'LTCG' : 'STCG'} />
        <KV k="Tax" v={`₹${slump.taxCr.toFixed(1)} Cr`} />
      </CalcCard>
    </div>
  )
}

// ── Section: Case Laws ────────────────────────────────────

function CasesSection() {
  const [areaFilter, setAreaFilter] = useState('ALL')
  const areas = useMemo(() => {
    const s = new Set<string>()
    CASE_LAWS.forEach((c) => s.add(c.applies))
    return ['ALL', ...Array.from(s).sort()]
  }, [])
  const rows = useMemo(() => {
    return CASE_LAWS.filter((c) => areaFilter === 'ALL' || c.applies === areaFilter).sort(
      (a, b) => b.year - a.year
    )
  }, [areaFilter])

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 14, lineHeight: 1.6 }}>
        Fifteen landmark Indian judgements that define how the CRVI framework plays out in
        practice. Each case is a precedent a scheme / resolution plan / SAST filing must
        respect.
      </div>
      <div style={{ marginBottom: 14 }}>
        <select
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          style={{
            background: 'var(--s2)',
            color: 'var(--txt)',
            border: '1px solid var(--br2)',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 12,
          }}
        >
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {rows.map((c) => (
          <div
            key={c.id}
            style={{
              background: 'var(--s1)',
              border: '1px solid var(--br)',
              borderLeft: '3px solid var(--gold2)',
              borderRadius: 6,
              padding: 12,
            }}
          >
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--txt)',
                fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                marginBottom: 4,
              }}
            >
              {c.title}
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
              <Badge variant="gray">
                {c.court} · {c.year}
              </Badge>
              <Badge variant="cyan">{c.applies}</Badge>
            </div>
            <div style={{ fontSize: 12, color: 'var(--txt2)', lineHeight: 1.5 }}>
              {c.principle}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Section: AI Analysis ──────────────────────────────────

function AISection({
  inputs,
  alerts,
}: {
  inputs: CRVIInputs
  alerts: AlertsBundle
}) {
  const [hasKey, setHasKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const k =
      localStorage.getItem('anthropic_key') || localStorage.getItem('sg4_apikey') || ''
    setHasKey(!!k)
  }, [])

  const run = async () => {
    if (typeof window === 'undefined') return
    const key =
      localStorage.getItem('anthropic_key') || localStorage.getItem('sg4_apikey') || ''
    if (!key) {
      setError('No Anthropic API key configured. Add one in Settings.')
      return
    }
    setLoading(true)
    setError(null)
    setResponse(null)

    const prompt = buildCRVIPrompt(inputs, alerts)
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-opus-4-5',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      })
      if (!r.ok) {
        const txt = await r.text()
        throw new Error(`API ${r.status}: ${txt.slice(0, 200)}`)
      }
      const json = await r.json()
      const text = json?.content?.[0]?.text || '(no content)'
      setResponse(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 14, lineHeight: 1.6 }}>
        Synthesises the live profile + live threshold alerts into a CRVI advisory memo covering
        <strong style={{ color: 'var(--txt)' }}> strategy recommendations, legal compliance,
        four-lens significance, peer benchmarking, critical warnings and data gaps</strong>.
      </div>
      {!hasKey && (
        <div
          style={{
            background: 'var(--reddim)',
            border: '1px solid rgba(239,68,68,.3)',
            borderRadius: 8,
            padding: 14,
            marginBottom: 14,
            fontSize: 12,
            color: 'var(--txt2)',
            lineHeight: 1.6,
          }}
        >
          ⚠ No Anthropic API key detected. Add one in Settings
          (<code>localStorage.sg4_apikey</code> or <code>anthropic_key</code>).
        </div>
      )}
      <button
        onClick={run}
        disabled={loading || !hasKey}
        style={{
          background: loading ? 'var(--s3)' : 'var(--gold2)',
          border: 'none',
          color: loading ? 'var(--txt3)' : '#000',
          padding: '10px 20px',
          borderRadius: 6,
          cursor: loading || !hasKey ? 'not-allowed' : 'pointer',
          fontSize: 13,
          fontWeight: 600,
          opacity: !hasKey ? 0.5 : 1,
          marginBottom: 14,
        }}
      >
        {loading ? '⏳ Analysing…' : '🚀 Run CRVI AI Analysis'}
      </button>
      {error && (
        <div
          style={{
            background: 'var(--reddim)',
            border: '1px solid var(--red)',
            borderRadius: 6,
            padding: 12,
            fontSize: 12,
            color: 'var(--red)',
            marginBottom: 14,
          }}
        >
          Error: {error}
        </div>
      )}
      {response && (
        <div
          style={{
            background: 'var(--s1)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: 18,
            fontSize: 13,
            color: 'var(--txt2)',
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
          }}
        >
          {response}
        </div>
      )}
    </div>
  )
}

function buildCRVIPrompt(inp: CRVIInputs, alerts: AlertsBundle): string {
  const alertStr = Object.entries(alerts)
    .map(
      ([k, v]) =>
        `  • ${k.toUpperCase()}: ${
          'triggered' in v ? (v.triggered ? 'TRIGGERED' : 'clear') :
          'filingRequired' in v ? (v.filingRequired ? 'TRIGGERED' : 'clear') :
          'eligible' in v ? (v.eligible ? 'TRIGGERED' : 'clear') :
          'sick' in v ? (v.sick ? 'TRIGGERED' : 'clear') :
          'recommended' in v ? (v.recommended ? 'TRIGGERED' : 'clear') :
          '—'
        } — ${v.basis}`
    )
    .join('\n')

  return `You are a Corporate Restructuring, Valuation & Insolvency (CRVI) advisor applying the ICSI PP-CRVI-2014 framework and current Indian statutes (Companies Act 2013, SEBI SAST 2011, IBC 2016, Competition Act 2002, SARFAESI 2002, FEMA 1999, IT Act 1961).

SUBJECT COMPANY PROFILE:
- Name: ${inp.name} (${inp.listed ? 'listed' : 'unlisted'})
- Paid-up capital: ₹${inp.pucCr.toFixed(0)} Cr · Reserves: ₹${inp.reservesCr.toFixed(0)} Cr
- Revenue: ₹${inp.revCr.toFixed(0)} Cr · EBITDA: ₹${inp.ebitdaCr.toFixed(0)} Cr · PAT: ₹${inp.patCr.toFixed(0)} Cr
- Total debt: ₹${(inp.securedDebtCr + inp.unsecuredDebtCr).toFixed(0)} Cr (secured ₹${inp.securedDebtCr.toFixed(0)} Cr)
- Debit P&L: ₹${inp.debitPlCr.toFixed(0)} Cr · Accumulated loss: ₹${inp.accLossCr.toFixed(0)} Cr
- Promoter holding: ${inp.promoterPct.toFixed(1)}% · Market cap: ₹${inp.mcapCr.toFixed(0)} Cr
- India turnover: ₹${inp.indiaTurnoverCr.toFixed(0)} Cr

LIVE THRESHOLD ALERTS:
${alertStr}

Deliver a structured CRVI advisory memo with these six sections, in this order:

1. STRATEGY RECOMMENDATIONS — Top 3 restructuring / valuation / insolvency strategies, each with (a) score /20 using the Strategic-Tactical-Economic-Compliance four-lens model, (b) one-line rationale, (c) governing statute, (d) 3-step execution outline.

2. LEGAL COMPLIANCE — Specific statutory obligations triggered (SAST filing, CCI approval, NCLT sanction, RBI / FEMA reporting). Cite section numbers and timelines.

3. FOUR-LENS SIGNIFICANCE — For the top strategy, score Strategic, Tactical, Economic, Compliance /5 each and explain each score in one sentence.

4. PEER BENCHMARKING — How does this company compare (multiple, growth, leverage) with Indian sector peers; which benchmark multiple set is most relevant.

5. CRITICAL WARNINGS — 3–5 hard stops / deal-killers (e.g., promoter eligibility under IBC §29A, Press Note 3 blocking, GST / tax-residency traps).

6. DATA GAPS — Fields currently missing or uncertain that change the recommendation.

Use clear markdown, keep the memo under 1,800 words, cite every section of law by exact reference (e.g., "IBC §7", "Companies Act 2013 §232(2)(iii)", "SEBI SAST Reg 3(1)"). Do NOT invent facts beyond the inputs — flag unknowns in Section 6.`
}

// ── Shared small components ───────────────────────────────

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: 'var(--s1)',
        border: '1px solid var(--br)',
        borderRadius: 8,
        padding: 14,
        marginBottom: 12,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--txt3)',
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  )
}

function CalcCard({
  title,
  law,
  children,
}: {
  title: string
  law: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        background: 'var(--s1)',
        border: '1px solid var(--br)',
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: 'var(--txt)',
          fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
          marginBottom: 10,
        }}
      >
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
      <div
        style={{
          marginTop: 10,
          fontSize: 10,
          color: 'var(--gold2)',
          borderTop: '1px dashed var(--br)',
          paddingTop: 8,
        }}
      >
        ⚖ {law}
      </div>
    </div>
  )
}

function KV({
  k,
  v,
  highlight,
}: {
  k: string
  v: string
  highlight?: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10,
        fontSize: 12,
        padding: '4px 0',
        borderBottom: '1px dashed var(--br)',
      }}
    >
      <span style={{ color: 'var(--txt3)' }}>{k}</span>
      <span
        style={{
          color: highlight ? 'var(--red)' : 'var(--txt)',
          fontWeight: highlight ? 600 : 400,
          textAlign: 'right',
          maxWidth: '60%',
          wordBreak: 'break-word',
        }}
      >
        {v}
      </span>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 3,
  background: 'var(--s2)',
  color: 'var(--txt)',
  border: '1px solid var(--br)',
  borderRadius: 4,
  padding: '5px 8px',
  fontSize: 12,
}
