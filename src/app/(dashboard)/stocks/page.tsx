'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { COMPANIES } from '@/lib/data/companies'
import type { Company } from '@/lib/data/companies'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { Badge } from '@/components/ui/Badge'
import { SectionTitle } from '@/components/ui/SectionTitle'
import { useWorkingPopup, type WorkingDef } from '@/components/working/WorkingPopup'
import {
  wkMktCap,
  wkEVEBITDA,
  wkAcqScore,
  wkEBITDAMargin,
  wkDebtEquity,
  wkAcqFlag,
} from '@/lib/working'
import {
  stockQuote,
  historicalData,
  parseHistoricalSeries,
  tickerToApiName,
  type StockProfile,
  type HistoricalPoint,
} from '@/lib/stocks/api'
import { Sparkline } from '@/components/charts/Sparkline'

// Normalise messy upstream numeric strings → number | null
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const cleaned = v.replace(/[,₹\s]/g, '')
    const n = parseFloat(cleaned)
    return Number.isFinite(n) ? n : null
  }
  return null
}
function fmt(v: number | null, prefix = '₹', digits = 2): string {
  if (v === null) return '—'
  return prefix + v.toLocaleString('en-IN', { maximumFractionDigits: digits })
}

interface LiveQuote {
  price: number | null
  percentChange: number | null
  yearHigh: number | null
  yearLow: number | null
  companyName: string | null
}

function extractQuote(p: StockProfile | undefined): LiveQuote {
  if (!p) return { price: null, percentChange: null, yearHigh: null, yearLow: null, companyName: null }
  const nse = num(p.currentPrice?.NSE)
  const bse = num(p.currentPrice?.BSE)
  return {
    price: nse ?? bse,
    percentChange: num(p.percentChange),
    yearHigh: num(p.yearHigh),
    yearLow: num(p.yearLow),
    companyName: p.companyName || p.companyProfile?.companyName || null,
  }
}

function evEbColor(v: number): string {
  if (v <= 0) return 'var(--txt3)'
  if (v <= 20) return 'var(--green)'
  if (v <= 35) return 'var(--gold2)'
  return 'var(--red)'
}

function getAcqVariant(score: number): 'green' | 'gold' | 'cyan' {
  if (score >= 8) return 'green'
  if (score >= 6) return 'gold'
  return 'cyan'
}

export default function StocksPage() {
  const { showWorking } = useWorkingPopup()
  const listed = useMemo(
    () => COMPANIES.filter((c) => c.mktcap > 0).sort((a, b) => b.acqs - a.acqs),
    []
  )

  const [selected, setSelected] = useState<Company | null>(null)
  const [liveProfile, setLiveProfile] = useState<StockProfile | null>(null)
  const [liveLoading, setLiveLoading] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)

  // Historical price series for the selected company
  const [history, setHistory] = useState<HistoricalPoint[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyPeriod, setHistoryPeriod] = useState<
    '1m' | '6m' | '1yr' | '3yr' | '5yr'
  >('1yr')

  // Staggered price board
  const [boardPrices, setBoardPrices] = useState<Record<string, LiveQuote>>({})
  const [boardLoading, setBoardLoading] = useState(false)
  const [boardProgress, setBoardProgress] = useState({ done: 0, total: 0 })
  const [boardError, setBoardError] = useState<string | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const boardAbortRef = useRef<AbortController | null>(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const scrollRef = useRef<HTMLDivElement>(null)

  // ── Fetch live quote when the selected company changes OR refresh fires ──
  useEffect(() => {
    if (!selected) {
      setLiveProfile(null)
      setLiveError(null)
      return
    }
    let cancelled = false
    setLiveLoading(true)
    setLiveError(null)
    setLiveProfile(null)
    const apiName = tickerToApiName(selected.ticker, selected.name)
    stockQuote(apiName, { fresh: refreshTick > 0 })
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setLiveError(res.error || 'Failed to fetch live data')
          setLiveProfile(null)
        } else {
          setLiveProfile((res.data as StockProfile) || null)
        }
      })
      .finally(() => {
        if (!cancelled) setLiveLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, refreshTick])

  // ── Fetch historical series for the selected company / period ──
  useEffect(() => {
    if (!selected) {
      setHistory([])
      setHistoryError(null)
      return
    }
    let cancelled = false
    setHistoryLoading(true)
    setHistoryError(null)
    const apiName = tickerToApiName(selected.ticker, selected.name)
    historicalData(apiName, historyPeriod, 'price', { fresh: refreshTick > 0 })
      .then((res) => {
        if (cancelled) return
        if (!res.ok) {
          setHistoryError(res.error || 'Failed to fetch history')
          setHistory([])
          return
        }
        const parsed = parseHistoricalSeries(res.data)
        setHistory(parsed)
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, historyPeriod, refreshTick])

  const quote = extractQuote(liveProfile || undefined)

  // ── Staggered price board loader ──
  // Loads N companies at a time with a short delay between batches so we
  // don't hammer the RapidAPI rate limit. Aborts in-flight batches on
  // re-trigger or component unmount.
  const loadBoard = async (force = false) => {
    if (boardAbortRef.current) boardAbortRef.current.abort()
    const ctrl = new AbortController()
    boardAbortRef.current = ctrl

    setBoardLoading(true)
    setBoardError(null)
    setBoardProgress({ done: 0, total: listed.length })

    const BATCH = 3
    const DELAY_MS = 250
    let done = 0

    for (let i = 0; i < listed.length; i += BATCH) {
      if (ctrl.signal.aborted) break
      const slice = listed.slice(i, i + BATCH)
      await Promise.all(
        slice.map(async (co) => {
          if (ctrl.signal.aborted) return
          const apiName = tickerToApiName(co.ticker, co.name)
          const res = await stockQuote(apiName, {
            fresh: force,
            signal: ctrl.signal,
          })
          if (ctrl.signal.aborted) return
          if (res.ok && res.data) {
            const q = extractQuote(res.data as StockProfile)
            setBoardPrices((prev) => ({ ...prev, [co.ticker]: q }))
          }
        })
      )
      done += slice.length
      if (!ctrl.signal.aborted) {
        setBoardProgress({ done, total: listed.length })
      }
      if (i + BATCH < listed.length && !ctrl.signal.aborted) {
        await new Promise((r) => setTimeout(r, DELAY_MS))
      }
    }

    if (!ctrl.signal.aborted) {
      setBoardLoading(false)
      setLastRefresh(new Date())
    }
  }

  // Cleanup any in-flight batch on unmount
  useEffect(() => {
    return () => {
      if (boardAbortRef.current) boardAbortRef.current.abort()
    }
  }, [])

  // Global refresh — forces selected stock + history + board
  const handleRefresh = () => {
    setRefreshTick((t) => t + 1) // triggers selected + history effects with fresh=true
    if (Object.keys(boardPrices).length > 0) {
      loadBoard(true)
    }
  }

  const hScroll = (dir: -1 | 1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * 240, behavior: 'smooth' })
  }

  return (
    <div>
      {/* Page Header (phdr) */}
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
          SolarGrid Pro <span style={{ margin: '0 6px' }}>›</span> Live Market Data
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
          Live <em style={{ color: 'var(--gold2)', fontStyle: 'normal' }}>Stock Terminal</em>
        </h1>
        <div
          style={{
            display: 'flex',
            gap: 8,
            marginTop: 10,
            flexWrap: 'wrap',
            alignItems: 'center',
          }}
        >
          <Badge variant="green">Live · RapidAPI Indian Stock Exchange</Badge>
          <Badge variant="gray">NSE &amp; BSE · 5 min cache</Badge>
          {lastRefresh && (
            <Badge variant="cyan">
              Last refresh:{' '}
              {lastRefresh.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </Badge>
          )}
          <button
            onClick={handleRefresh}
            disabled={liveLoading || historyLoading || boardLoading}
            title="Force-refresh selected stock, historical chart, and board"
            style={{
              marginLeft: 'auto',
              background: 'var(--golddim)',
              border: '1px solid var(--gold2)',
              color: 'var(--gold2)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
              padding: '5px 12px',
              borderRadius: 4,
              cursor:
                liveLoading || historyLoading || boardLoading
                  ? 'not-allowed'
                  : 'pointer',
              opacity: liveLoading || historyLoading || boardLoading ? 0.6 : 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s',
            }}
            onMouseEnter={(e) => {
              if (!(liveLoading || historyLoading || boardLoading))
                (e.currentTarget as HTMLElement).style.background =
                  'rgba(247,183,49,0.2)'
            }}
            onMouseLeave={(e) =>
              ((e.currentTarget as HTMLElement).style.background = 'var(--golddim)')
            }
          >
            <span
              style={{
                display: 'inline-block',
                transform:
                  liveLoading || historyLoading || boardLoading
                    ? 'rotate(180deg)'
                    : 'none',
                transition: 'transform 0.4s',
              }}
            >
              ↻
            </span>
            Refresh
          </button>
        </div>
      </div>

      {/* Info alert */}
      <div
        style={{
          background: 'var(--cyandim)',
          border: '1px solid rgba(0,180,216,0.3)',
          borderRadius: 6,
          padding: '10px 14px',
          fontSize: 12,
          color: 'var(--txt2)',
          marginBottom: 16,
        }}
      >
        Prices pulled from the RapidAPI Indian Stock Exchange feed (NSE/BSE consolidated). All requests
        route through our authenticated server proxy with a 5-minute cache — your API key never touches
        the browser. Prices may be delayed up to 15 minutes and are for reference only, not investment advice.
      </div>

      {/* Select Company */}
      <div style={{ marginBottom: 16 }}>
        <SectionTitle title="Select Company" subtitle="Horizontal Scroll" />
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 20,
        }}
      >
        <button
          onClick={() => hScroll(-1)}
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            color: 'var(--txt2)',
            width: 28,
            height: 32,
            borderRadius: 4,
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 16,
          }}
        >
          ‹
        </button>
        <div
          ref={scrollRef}
          style={{
            display: 'flex',
            gap: 8,
            overflowX: 'auto',
            padding: '4px 0',
            flex: 1,
            scrollbarWidth: 'thin',
          }}
        >
          {listed.map((co) => {
            const active = selected?.ticker === co.ticker
            return (
              <button
                key={co.ticker}
                onClick={() => setSelected(co)}
                style={{
                  background: active ? 'var(--golddim)' : 'var(--s2)',
                  border: `1px solid ${active ? 'var(--gold2)' : 'var(--br)'}`,
                  color: active ? 'var(--gold2)' : 'var(--txt2)',
                  whiteSpace: 'nowrap',
                  fontSize: 13,
                  padding: '7px 14px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: active ? 600 : 400,
                }}
              >
                {co.name.split(' ')[0]}
              </button>
            )
          })}
        </div>
        <button
          onClick={() => hScroll(1)}
          style={{
            background: 'var(--s2)',
            border: '1px solid var(--br)',
            color: 'var(--txt2)',
            width: 28,
            height: 32,
            borderRadius: 4,
            cursor: 'pointer',
            flexShrink: 0,
            fontSize: 16,
          }}
        >
          ›
        </button>
      </div>

      {/* Stock Detail */}
      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 20,
          marginBottom: 20,
        }}
      >
        {selected ? (
          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <div
                  style={{
                    fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                    fontSize: 18,
                    fontWeight: 700,
                    color: 'var(--txt)',
                  }}
                >
                  {selected.name}{' '}
                  <span
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 12,
                      color: 'var(--txt3)',
                      fontWeight: 400,
                    }}
                  >
                    {selected.ticker} · NSE
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginTop: 6,
                    flexWrap: 'wrap',
                  }}
                >
                  <div
                    style={{
                      fontFamily: 'JetBrains Mono, monospace',
                      fontSize: 28,
                      fontWeight: 700,
                      color: 'var(--gold2)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {liveLoading ? '…' : fmt(quote.price)}
                  </div>
                  {quote.percentChange !== null && !liveLoading && (
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 14,
                        fontWeight: 600,
                        color:
                          quote.percentChange >= 0 ? 'var(--green)' : 'var(--red)',
                        background:
                          quote.percentChange >= 0 ? 'var(--greendim)' : 'var(--reddim)',
                        padding: '3px 9px',
                        borderRadius: 4,
                      }}
                    >
                      {quote.percentChange >= 0 ? '▲' : '▼'}{' '}
                      {Math.abs(quote.percentChange).toFixed(2)}%
                    </div>
                  )}
                  {liveError && (
                    <div style={{ fontSize: 11, color: 'var(--red)' }}>
                      Live: {liveError}
                    </div>
                  )}
                  {!liveLoading && !liveError && quote.price === null && (
                    <div style={{ fontSize: 11, color: 'var(--txt3)' }}>
                      No live price returned
                    </div>
                  )}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <div
                  onClick={() => showWorking(wkAcqFlag(selected.acqf, selected.rea))}
                  title="Click for flag methodology"
                  style={{ cursor: 'pointer' }}
                >
                  <Badge variant={getAcqVariant(selected.acqs)}>{selected.acqf || '—'}</Badge>
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                gap: 10,
                marginBottom: 14,
              }}
            >
              {(
                [
                  { lbl: '52W High', val: fmt(quote.yearHigh) },
                  { lbl: '52W Low', val: fmt(quote.yearLow) },
                  {
                    lbl: 'Market Cap',
                    val:
                      selected.mktcap > 0
                        ? '₹' + selected.mktcap.toLocaleString() + 'Cr'
                        : '—',
                    wk: selected.mktcap > 0 ? (): WorkingDef => wkMktCap(selected) : null,
                  },
                  { lbl: 'Revenue FY24', val: '₹' + selected.rev.toLocaleString() + 'Cr' },
                  {
                    lbl: 'EBITDA Margin',
                    val: selected.ebm + '%',
                    wk: (): WorkingDef => wkEBITDAMargin(selected),
                  },
                  {
                    lbl: 'EV/EBITDA (SG)',
                    val: selected.ev_eb > 0 ? selected.ev_eb + '×' : '—',
                    wk: selected.ev_eb > 0 ? (): WorkingDef => wkEVEBITDA(selected) : null,
                  },
                  {
                    lbl: 'D/E Ratio',
                    val: String(selected.dbt_eq),
                    wk: (): WorkingDef => wkDebtEquity(selected),
                  },
                ] as { lbl: string; val: string; wk?: (() => WorkingDef) | null }[]
              ).map((s) => {
                const clickable = !!s.wk
                return (
                  <div
                    key={s.lbl}
                    onClick={clickable ? () => showWorking(s.wk!()) : undefined}
                    title={clickable ? 'Click to see calculation' : undefined}
                    style={{
                      background: 'var(--s1)',
                      border: '1px solid var(--br)',
                      borderRadius: 6,
                      padding: '10px 12px',
                      cursor: clickable ? 'pointer' : 'default',
                      transition: 'border-color 0.15s',
                    }}
                    onMouseEnter={
                      clickable
                        ? (e) => (e.currentTarget.style.borderColor = 'var(--gold2)')
                        : undefined
                    }
                    onMouseLeave={
                      clickable
                        ? (e) => (e.currentTarget.style.borderColor = 'var(--br)')
                        : undefined
                    }
                  >
                    <div
                      style={{
                        fontSize: 10,
                        color: 'var(--txt3)',
                        letterSpacing: '1px',
                        textTransform: 'uppercase',
                        marginBottom: 4,
                        borderBottom: clickable ? '1px dotted var(--txt3)' : undefined,
                        display: 'inline-block',
                      }}
                    >
                      {s.lbl}
                    </div>
                    <div
                      style={{
                        fontFamily: 'JetBrains Mono, monospace',
                        fontSize: 14,
                        fontWeight: 600,
                        color: 'var(--txt)',
                      }}
                    >
                      {s.val}
                    </div>
                  </div>
                )
              })}
              <div
                onClick={() => showWorking(wkAcqScore(selected))}
                title="Click for Sherman score breakdown"
                style={{
                  background: 'var(--s1)',
                  border: '1px solid var(--br)',
                  borderRadius: 6,
                  padding: '10px 12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  cursor: 'pointer',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--gold2)')}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--br)')}
              >
                <div
                  style={{
                    fontSize: 10,
                    color: 'var(--txt3)',
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                    borderBottom: '1px dotted var(--txt3)',
                    display: 'inline-block',
                  }}
                >
                  Acq Score
                </div>
                <ScoreBadge score={selected.acqs} size={28} />
              </div>
            </div>

            {/* Historical price mini-chart */}
            <div
              style={{
                background: 'var(--s1)',
                border: '1px solid var(--br)',
                borderRadius: 6,
                padding: '12px 14px',
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 8,
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div
                  style={{
                    fontSize: 11,
                    color: 'var(--txt3)',
                    letterSpacing: '1px',
                    textTransform: 'uppercase',
                  }}
                >
                  Price History · {historyPeriod.toUpperCase()}
                </div>
                <div style={{ display: 'flex', gap: 2 }}>
                  {(['1m', '6m', '1yr', '3yr', '5yr'] as const).map((p) => {
                    const active = p === historyPeriod
                    return (
                      <button
                        key={p}
                        onClick={() => setHistoryPeriod(p)}
                        style={{
                          background: active ? 'var(--golddim)' : 'transparent',
                          border: `1px solid ${active ? 'var(--gold2)' : 'var(--br)'}`,
                          color: active ? 'var(--gold2)' : 'var(--txt3)',
                          fontSize: 10,
                          fontWeight: active ? 600 : 500,
                          padding: '3px 9px',
                          borderRadius: 3,
                          cursor: 'pointer',
                          fontFamily: 'JetBrains Mono, monospace',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                        }}
                      >
                        {p}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div style={{ minHeight: 128 }}>
                {historyLoading ? (
                  <div
                    style={{
                      height: 128,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--txt3)',
                      fontSize: 11,
                      fontStyle: 'italic',
                    }}
                  >
                    Loading price history…
                  </div>
                ) : historyError ? (
                  <div
                    style={{
                      height: 128,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--red)',
                      fontSize: 11,
                    }}
                  >
                    {historyError}
                  </div>
                ) : history.length >= 2 ? (
                  <Sparkline data={history} height={128} />
                ) : (
                  <div
                    style={{
                      height: 128,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: 'var(--txt3)',
                      fontSize: 11,
                      fontStyle: 'italic',
                    }}
                  >
                    No historical data returned
                  </div>
                )}
              </div>
              {history.length >= 2 && (
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    marginTop: 8,
                    fontSize: 10,
                    color: 'var(--txt3)',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  <span>{history.length} data points</span>
                  <span>
                    First ₹{history[0].price.toFixed(2)} · Last ₹
                    {history[history.length - 1].price.toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            <div
              style={{
                background: 'var(--s1)',
                border: '1px solid var(--br)',
                borderRadius: 6,
                padding: '12px 14px',
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: 'var(--txt3)',
                  letterSpacing: '1px',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                Strategic Assessment
              </div>
              <p style={{ fontSize: 13, color: 'var(--txt2)', lineHeight: 1.6, margin: 0 }}>
                {selected.rea || 'No strategic notes available for this company.'}
              </p>
            </div>

            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--txt3)' }}>
              Live feed · RapidAPI Indian Stock Exchange · cached 5 min · For reference only, not investment advice
              {liveProfile?.companyProfile?.mgIndustry && (
                <span style={{ color: 'var(--txt2)' }}>
                  {' '}· Sector: {String(liveProfile.companyProfile.mgIndustry)}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 32 }}>
            <div style={{ fontSize: 15, color: 'var(--txt3)' }}>
              Select a company above to load live price chart and data
            </div>
          </div>
        )}
      </div>

      {/* Live Price Board */}
      <div
        style={{
          marginBottom: 12,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <SectionTitle title="Live Price Board" subtitle="All Tracked Companies" />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {boardLoading && (
            <div
              style={{
                fontSize: 11,
                color: 'var(--txt2)',
                fontFamily: 'JetBrains Mono, monospace',
              }}
            >
              Loading {boardProgress.done}/{boardProgress.total}…
            </div>
          )}
          {boardError && (
            <div style={{ fontSize: 11, color: 'var(--red)' }}>{boardError}</div>
          )}
          <button
            onClick={() => loadBoard(Object.keys(boardPrices).length > 0)}
            disabled={boardLoading}
            style={{
              background: boardLoading ? 'var(--s3)' : 'var(--golddim)',
              border: `1px solid ${boardLoading ? 'var(--br)' : 'var(--gold2)'}`,
              color: boardLoading ? 'var(--txt3)' : 'var(--gold2)',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.3px',
              textTransform: 'uppercase',
              padding: '5px 12px',
              borderRadius: 4,
              cursor: boardLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span
              style={{
                display: 'inline-block',
                transform: boardLoading ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.4s',
              }}
            >
              ↻
            </span>
            {Object.keys(boardPrices).length === 0 ? 'Load prices' : 'Refresh board'}
          </button>
        </div>
      </div>

      {boardLoading && (
        <div
          style={{
            height: 3,
            background: 'var(--s2)',
            borderRadius: 2,
            overflow: 'hidden',
            marginBottom: 10,
          }}
        >
          <div
            style={{
              height: '100%',
              background: 'var(--gold2)',
              width: `${(boardProgress.done / Math.max(boardProgress.total, 1)) * 100}%`,
              transition: 'width 0.25s ease',
            }}
          />
        </div>
      )}

      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
            }}
          >
            <thead>
              <tr
                style={{
                  background: 'var(--s1)',
                  borderBottom: '1px solid var(--br)',
                }}
              >
                {[
                  'Company',
                  'Last Price (₹)',
                  'Change %',
                  '52W High',
                  '52W Low',
                  'Our EV/EBITDA',
                  'Acq Score',
                  'Actions',
                ].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: '12px 14px',
                      textAlign: 'left',
                      fontSize: 10,
                      color: 'var(--txt3)',
                      fontWeight: 600,
                      letterSpacing: '1px',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {listed.map((co) => {
                const live = boardPrices[co.ticker]
                const pctColor =
                  live?.percentChange !== null && live?.percentChange !== undefined
                    ? live.percentChange >= 0
                      ? 'var(--green)'
                      : 'var(--red)'
                    : 'var(--txt3)'
                return (
                <tr
                  key={co.ticker}
                  style={{
                    borderBottom: '1px solid var(--br)',
                    background: co.acqs >= 8 ? 'rgba(247,183,49,0.03)' : 'transparent',
                  }}
                >
                  <td style={{ padding: '12px 14px', minWidth: 180 }}>
                    <div
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--txt)',
                      }}
                    >
                      {co.acqs >= 8 ? '★ ' : ''}
                      {co.name}
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: 'var(--txt3)',
                        fontFamily: 'JetBrains Mono, monospace',
                      }}
                    >
                      {co.ticker}
                    </div>
                  </td>
                  <td
                    style={{
                      padding: '12px 14px',
                      minWidth: 110,
                      fontFamily: 'JetBrains Mono, monospace',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {live?.price !== null && live?.price !== undefined ? (
                      <div style={{ color: 'var(--txt)', fontSize: 13, fontWeight: 600 }}>
                        {fmt(live.price)}
                      </div>
                    ) : (
                      <>
                        <span style={{ color: 'var(--txt3)', fontSize: 12 }}>—</span>
                        <div style={{ fontSize: 9, color: 'var(--txt3)' }}>
                          {boardLoading ? 'loading…' : 'not loaded'}
                        </div>
                      </>
                    )}
                  </td>
                  <td
                    style={{
                      padding: '12px 14px',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontVariantNumeric: 'tabular-nums',
                      color: pctColor,
                      fontWeight: 600,
                    }}
                  >
                    {live?.percentChange !== null && live?.percentChange !== undefined
                      ? `${live.percentChange >= 0 ? '▲' : '▼'} ${Math.abs(
                          live.percentChange
                        ).toFixed(2)}%`
                      : '—'}
                  </td>
                  <td
                    style={{
                      padding: '12px 14px',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontVariantNumeric: 'tabular-nums',
                      color: live?.yearHigh !== null && live?.yearHigh !== undefined ? 'var(--txt2)' : 'var(--txt3)',
                    }}
                  >
                    {live?.yearHigh !== null && live?.yearHigh !== undefined
                      ? fmt(live.yearHigh)
                      : '—'}
                  </td>
                  <td
                    style={{
                      padding: '12px 14px',
                      fontFamily: 'JetBrains Mono, monospace',
                      fontVariantNumeric: 'tabular-nums',
                      color: live?.yearLow !== null && live?.yearLow !== undefined ? 'var(--txt2)' : 'var(--txt3)',
                    }}
                  >
                    {live?.yearLow !== null && live?.yearLow !== undefined
                      ? fmt(live.yearLow)
                      : '—'}
                  </td>
                  <td
                    onClick={co.ev_eb > 0 ? () => showWorking(wkEVEBITDA(co)) : undefined}
                    title={co.ev_eb > 0 ? 'Click to see calculation' : undefined}
                    style={{
                      padding: '12px 14px',
                      fontFamily: 'JetBrains Mono, monospace',
                      color: evEbColor(co.ev_eb),
                      fontWeight: 600,
                      cursor: co.ev_eb > 0 ? 'pointer' : 'default',
                      borderBottom: co.ev_eb > 0 ? '1px dotted var(--br2)' : undefined,
                    }}
                  >
                    {co.ev_eb > 0 ? co.ev_eb + '×' : '—'}
                  </td>
                  <td
                    onClick={() => showWorking(wkAcqScore(co))}
                    title="Click for Sherman score breakdown"
                    style={{ padding: '12px 14px', cursor: 'pointer' }}
                  >
                    <ScoreBadge score={co.acqs} size={26} />
                  </td>
                  <td style={{ padding: '12px 14px', whiteSpace: 'nowrap' }}>
                    <button
                      onClick={() => setSelected(co)}
                      style={{
                        background: 'var(--s3)',
                        border: '1px solid var(--br2)',
                        color: 'var(--txt2)',
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 3,
                        cursor: 'pointer',
                        marginRight: 4,
                      }}
                    >
                      Details
                    </button>
                    <button
                      style={{
                        background: 'var(--s3)',
                        border: '1px solid var(--br2)',
                        color: 'var(--txt2)',
                        fontSize: 11,
                        padding: '3px 8px',
                        borderRadius: 3,
                        cursor: 'pointer',
                      }}
                    >
                      +WL
                    </button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div
        style={{
          marginTop: 10,
          fontSize: 11,
          color: 'var(--txt3)',
          display: 'flex',
          gap: 14,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <span style={{ color: 'var(--green)' }}>
          ● Live · RapidAPI Indian Stock Exchange
        </span>
        <span>{listed.length} companies tracked</span>
        <span>Select a company above to pull the full live profile</span>
      </div>
    </div>
  )
}
