'use client'

import { useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { ScoreBadge } from '@/components/ui/ScoreBadge'
import { useIndustryFilter } from '@/hooks/useIndustryFilter'
import { useIndustryAtlas } from '@/hooks/useIndustryAtlas'
import {
  loadWatchlist,
  saveWatchlist,
  WL_EVENT,
  WL_STATUSES,
  type WLItem,
  type WLStatus,
} from '@/lib/watchlist'
import { PortfolioManager } from '@/components/portfolio/PortfolioManager'
import { CHAIN, GROUPS } from '@/lib/data/chain'
import { COMPANIES } from '@/lib/data/companies'

// ── Stage colors (analogous to Deal Board stageColors) ──────
const statusColors: Record<WLStatus, string> = {
  Monitoring: 'var(--txt3)',
  'Active Diligence': 'var(--cyan2)',
  'In Negotiation': 'var(--orange)',
  'LOI Signed': 'var(--gold2)',
  Paused: 'var(--txt3)',
  Rejected: 'var(--red)',
}

// ── KpiTile — mirrors the Deal Board tile design ────────────
const KPI_STYLE: React.CSSProperties = {
  background: 'var(--s2)',
  border: '1px solid var(--br)',
  borderRadius: 8,
  padding: '14px 16px',
  flex: 1,
  minWidth: 140,
  position: 'relative',
  overflow: 'hidden',
}

function KpiTile({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string | number
  sub: string
  color?: 'gold' | 'red' | 'green' | 'cyan' | 'orange' | 'purple'
}) {
  const colorMap: Record<string, string> = {
    gold: 'var(--gold2)',
    red: 'var(--red)',
    green: 'var(--green)',
    cyan: 'var(--cyan2)',
    orange: 'var(--orange)',
    purple: 'var(--purple)',
  }
  const main = color ? colorMap[color] : 'var(--gold2)'
  return (
    <div style={KPI_STYLE}>
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(to right, ${main}, transparent)`,
        }}
      />
      <div
        style={{
          fontSize: 10,
          color: 'var(--txt3)',
          letterSpacing: '1.5px',
          textTransform: 'uppercase',
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
          fontSize: 24,
          fontWeight: 700,
          color: main,
          lineHeight: 1,
          marginBottom: 6,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: 'var(--txt3)' }}>{sub}</div>
    </div>
  )
}

interface WatchModalProps {
  existing: WLItem | null
  initialStatus: WLStatus
  onClose: () => void
  onSave: (item: WLItem) => void
  onRemove: () => void
}

export default function WatchlistPage() {
  const { selectedIndustries, availableIndustries, isSelected } = useIndustryFilter()
  const { atlasChain, atlasListed } = useIndustryAtlas()
  // Merged datasets so atlas-seeded industries appear in the Watch Board.
  const mergedChain = useMemo(() => [...CHAIN, ...atlasChain], [atlasChain])
  const mergedListed = useMemo(() => [...COMPANIES, ...atlasListed], [atlasListed])
  const [items, setItems] = useState<WLItem[]>([])
  const [loaded, setLoaded] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editItem, setEditItem] = useState<WLItem | null>(null)
  const [initialStatus, setInitialStatus] = useState<WLStatus>('Monitoring')

  useEffect(() => {
    setItems(loadWatchlist())
    setLoaded(true)
    const handler = () => setItems(loadWatchlist())
    window.addEventListener(WL_EVENT, handler)
    return () => window.removeEventListener(WL_EVENT, handler)
  }, [])

  function persist(next: WLItem[]) {
    setItems(next)
    saveWatchlist(next)
  }

  function addItem(payload: WLItem) {
    persist([...items, payload])
  }

  function updateItem(ticker: string, patch: Partial<WLItem>) {
    persist(items.map((it) => (it.ticker === ticker ? { ...it, ...patch } : it)))
  }

  function removeItem(ticker: string) {
    persist(items.filter((it) => it.ticker !== ticker))
  }

  function openAdd(status: WLStatus = 'Monitoring') {
    setEditItem(null)
    setInitialStatus(status)
    setModalOpen(true)
  }

  function openEdit(it: WLItem) {
    setEditItem(it)
    setModalOpen(true)
  }

  // Industry filter — each WLItem has industry (or fall back to sec)
  const filtered = useMemo(() => {
    return items.filter((it) => {
      const ind = it.industry || it.sec || ''
      if (!ind) return true // unclassified item — always show
      return isSelected(ind)
    })
  }, [items, isSelected])

  // Pipeline summary
  const totalEV = useMemo(
    () => filtered.reduce((s, i) => s + (i.ev || 0), 0),
    [filtered]
  )
  const starred = useMemo(() => filtered.filter((i) => i.acqs >= 8).length, [filtered])
  const avgScore = useMemo(() => {
    if (filtered.length === 0) return 0
    const total = filtered.reduce((s, i) => s + (i.acqs || 0), 0)
    return Math.round((total / filtered.length) * 10) / 10
  }, [filtered])
  const activeDeals = useMemo(
    () => filtered.filter((i) => i.status && i.status !== 'Monitoring' && i.status !== 'Paused' && i.status !== 'Rejected').length,
    [filtered]
  )
  const industryLabel = useMemo(() => {
    if (selectedIndustries.length === 0) return 'All'
    if (selectedIndustries.length === availableIndustries.length) return 'All'
    return selectedIndustries
      .map((id) => availableIndustries.find((i) => i.id === id)?.label || id)
      .join(' + ')
  }, [selectedIndustries, availableIndustries])

  // Chain nodes filtered by selected industries — feeds the "Value Chain
  // Focus" strip at the bottom of the board.
  const relevantChainNodes = useMemo(() => {
    if (selectedIndustries.length === 0) return mergedChain
    return mergedChain.filter((n) => isSelected(n.sec || ''))
  }, [selectedIndustries, isSelected, mergedChain])

  return (
    <div>
      {/* phdr — mirrors the Deal Board header */}
      <div style={{
        padding: '20px 24px',
        borderBottom: '1px solid var(--br)',
        background: 'linear-gradient(180deg, var(--s2) 0%, var(--s1) 100%)',
        marginBottom: 20,
      }}>
        <div style={{
          fontSize: 10, color: 'var(--txt3)', letterSpacing: '1.5px',
          textTransform: 'uppercase', marginBottom: 6,
        }}>
          <span className="dn-wordmark">Deal<em>Nector</em></span>{' '}
          <span style={{ margin: '0 6px' }}>›</span> Watch Board
        </div>
        <h1 style={{
          fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
          fontSize: 26, fontWeight: 700, color: 'var(--txt)', margin: 0, marginBottom: 10,
        }}>
          Watch <em style={{ color: 'var(--gold2)', fontStyle: 'italic' }}>Board</em>
        </h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge variant="gold">Kanban watch board</Badge>
          <Badge variant="gray">{items.length} total tracked</Badge>
          <Badge variant="green">★ {starred} starred</Badge>
          {selectedIndustries.length > 0 && selectedIndustries.length < availableIndustries.length && (
            <Badge variant="cyan">
              Filtered to{' '}
              {selectedIndustries
                .map((id) => availableIndustries.find((i) => i.id === id)?.label || id)
                .join(' + ')}
            </Badge>
          )}
        </div>
      </div>

      {/* KPI Row — mirrors the Deal Board KPI tiles */}
      <div style={{ padding: '0 20px' }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <KpiTile
            label="Tracked (filtered)"
            value={filtered.length}
            sub={`of ${items.length} total · ${industryLabel}`}
          />
          <KpiTile
            label="Pipeline EV"
            value={totalEV > 0 ? `₹${totalEV.toLocaleString('en-IN')}Cr` : '—'}
            sub="Sum of EV across filtered"
            color="gold"
          />
          <KpiTile
            label="Starred"
            value={starred}
            sub="Score ≥ 8 acquisition fit"
            color="green"
          />
          <KpiTile
            label="Active Deals"
            value={activeDeals}
            sub="Beyond Monitoring stage"
            color="orange"
          />
          <KpiTile
            label="Avg Score"
            value={avgScore > 0 ? `${avgScore}/10` : '—'}
            sub="Acquisition-fit across filtered"
            color="cyan"
          />
          <KpiTile
            label="Industries"
            value={selectedIndustries.length || availableIndustries.length}
            sub={`of ${availableIndustries.length} available`}
            color="purple"
          />
        </div>
      </div>

      {/* Action bar */}
      <div style={{ padding: '0 16px' }}>
        <div style={{
          background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 8, padding: 16,
        }}>
          <div style={{
            display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center',
            justifyContent: 'space-between', flexWrap: 'wrap',
          }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => openAdd('Monitoring')}
                style={{
                  background: 'var(--green)', color: '#000', border: 'none',
                  padding: '8px 16px', borderRadius: 5, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                }}
              >+ Add to Watchlist</button>
              <button
                onClick={() => exportCSV(filtered)}
                style={{
                  background: 'var(--s3)', color: 'var(--txt)',
                  border: '1px solid var(--br2)', padding: '8px 14px', borderRadius: 5,
                  fontSize: 13, cursor: 'pointer',
                }}
              >⬇ Export Watchlist CSV</button>
            </div>
            <span style={{ fontSize: 11, color: 'var(--txt3)' }}>
              Persists locally · {filtered.length} cards visible after industry filter
            </span>
          </div>

          {/* Empty state */}
          {loaded && items.length === 0 && (
            <div style={{
              background: 'var(--s3)', border: '1px dashed var(--br)', borderRadius: 8,
              padding: 40, textAlign: 'center',
            }}>
              <div style={{ fontSize: 15, color: 'var(--txt3)' }}>No companies on your watchlist yet.</div>
              <div style={{ fontSize: 13, color: 'var(--txt3)', marginTop: 6 }}>
                Click + Watchlist on any M&amp;A Radar card to start tracking.
              </div>
            </div>
          )}

          {/* Kanban */}
          {items.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <div style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${WL_STATUSES.length}, minmax(230px, 1fr))`,
                gap: 12,
                minWidth: 230 * WL_STATUSES.length,
              }}>
                {WL_STATUSES.map((status) => {
                  const statusItems = filtered.filter(
                    (it) => (it.status || 'Monitoring') === status
                  )
                  return (
                    <div
                      key={status}
                      style={{
                        background: 'var(--s3)', border: '1px solid var(--br)', borderRadius: 7,
                        display: 'flex', flexDirection: 'column', minHeight: 400,
                      }}
                    >
                      <div style={{
                        padding: '10px 12px',
                        borderBottom: `2px solid ${statusColors[status]}`,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}>
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: 7,
                          fontSize: 12, fontWeight: 700, color: 'var(--txt)',
                          textTransform: 'uppercase', letterSpacing: '0.6px',
                        }}>
                          <span style={{
                            width: 7, height: 7, borderRadius: '50%',
                            background: statusColors[status],
                          }} />
                          {status}
                        </div>
                        <span style={{
                          fontSize: 11, color: 'var(--txt3)',
                          background: 'var(--s2)', padding: '1px 7px', borderRadius: 3,
                        }}>{statusItems.length}</span>
                      </div>
                      <div style={{ padding: 10, flex: 1 }}>
                        {statusItems.map((it) => (
                          <WatchCard
                            key={it.ticker}
                            item={it}
                            onClick={() => openEdit(it)}
                            onRemove={() => removeItem(it.ticker)}
                            availableIndustries={availableIndustries.map((i) => ({
                              id: i.id, label: i.label,
                            }))}
                          />
                        ))}
                        <div
                          onClick={() => openAdd(status)}
                          style={{
                            fontSize: 12, color: 'var(--txt3)', padding: '6px 0',
                            cursor: 'pointer', textAlign: 'center', opacity: 0.7,
                          }}
                        >+ Add to {status}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Value Chain Focus — filtered to selected industries */}
      <div style={{ padding: '20px 16px 32px' }}>
        <div style={{
          fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
          fontSize: 15, fontWeight: 600, color: 'var(--txt)',
          textTransform: 'uppercase', letterSpacing: '0.6px',
          marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid var(--br)',
        }}>
          ◇ Value Chain Focus — {selectedIndustries.length
            ? selectedIndustries
                .map((id) => availableIndustries.find((i) => i.id === id)?.label || id)
                .join(' + ')
            : 'All Industries'}
        </div>
        <ValueChainFocus nodes={relevantChainNodes} universe={mergedListed} />
      </div>

      {/* Portfolios — moved to the bottom so the Kanban board is the
          primary focus, same as the Deal Board layout. */}
      <div style={{ padding: '0 16px 32px' }}>
        <div style={{
          fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
          fontSize: 15, fontWeight: 600, color: 'var(--txt)',
          textTransform: 'uppercase', letterSpacing: '0.6px',
          marginBottom: 12, paddingBottom: 6, borderBottom: '1px solid var(--br)',
        }}>
          ◇ Portfolios
        </div>
        <PortfolioManager />
      </div>

      {modalOpen && (
        <WatchModal
          existing={editItem}
          initialStatus={initialStatus}
          availableIndustries={availableIndustries.map((i) => ({
            id: i.id, label: i.label,
          }))}
          onClose={() => setModalOpen(false)}
          onSave={(payload) => {
            if (editItem) {
              updateItem(editItem.ticker, payload)
            } else {
              addItem(payload)
            }
            setModalOpen(false)
          }}
          onRemove={() => {
            if (editItem) removeItem(editItem.ticker)
            setModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

// ── Card ────────────────────────────────────────────────────

function WatchCard({
  item,
  onClick,
  onRemove,
  availableIndustries,
}: {
  item: WLItem
  onClick: () => void
  onRemove: () => void
  availableIndustries: { id: string; label: string }[]
}) {
  const indLabel = availableIndustries.find(
    (i) => i.id === (item.industry || item.sec || '')
  )?.label
  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 6,
        padding: 10, marginBottom: 8, cursor: 'pointer', position: 'relative',
      }}
    >
      <div
        onClick={(e) => { e.stopPropagation(); onRemove() }}
        style={{
          position: 'absolute', top: 6, right: 8,
          fontSize: 12, color: 'var(--txt3)', cursor: 'pointer',
        }}
        title="Remove"
      >✕</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, paddingRight: 16 }}>
        <ScoreBadge score={item.acqs || 0} size={22} />
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)' }}>
          {(item.acqs ?? 0) >= 8 ? '★ ' : ''}{item.name}
        </span>
      </div>
      <div style={{
        fontSize: 12, color: 'var(--gold2)',
        fontFamily: 'JetBrains Mono, monospace', fontWeight: 500,
      }}>
        {item.ev && item.ev > 0 ? `EV ₹${item.ev.toLocaleString('en-IN')}Cr` : ''}
        {item.ev_eb && item.ev_eb > 0 ? ` · ${item.ev_eb}×` : ''}
      </div>
      <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 3 }}>
        {item.ticker}{indLabel ? ` · ${indLabel}` : ''}
        {item.addedDate ? ` · ${item.addedDate}` : ''}
      </div>
      {item.notes && (
        <div style={{
          fontSize: 11, color: 'var(--txt3)', marginTop: 4, lineHeight: 1.4,
        }}>
          {item.notes.substring(0, 80)}{item.notes.length > 80 ? '…' : ''}
        </div>
      )}
    </div>
  )
}

// ── Value chain focus strip ─────────────────────────────────

function ValueChainFocus({ nodes, universe }: { nodes: typeof CHAIN; universe: typeof COMPANIES }) {
  // Group nodes by cat so we can render a mini chain visualisation
  const byCat = useMemo(() => {
    const map = new Map<string, typeof CHAIN>()
    for (const n of nodes) {
      const arr = map.get(n.cat) || []
      arr.push(n)
      map.set(n.cat, arr as typeof CHAIN)
    }
    return map
  }, [nodes])

  // Count companies per node — uses the merged universe (hardcoded + atlas)
  const countFor = (nodeId: string) =>
    universe.filter((c) => c.comp?.includes(nodeId)).length

  if (nodes.length === 0) {
    return (
      <div style={{
        color: 'var(--txt3)', fontSize: 12, padding: 20, textAlign: 'center', fontStyle: 'italic',
      }}>
        No value-chain segments match the current industry filter.
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      {Array.from(byCat.entries()).map(([cat, group]) => (
        <div key={cat} style={{
          background: 'var(--s2)', border: '1px solid var(--br)', borderRadius: 7, padding: 12,
        }}>
          <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.8px',
            textTransform: 'uppercase', color: 'var(--gold2)', marginBottom: 8,
          }}>{cat}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {group.map((n) => {
              const n_count = countFor(n.id)
              return (
                <a
                  key={n.id}
                  href={`/valuechain?seg=${n.id}`}
                  title={`${n.name} — ${n_count} tracked companies`}
                  style={{
                    background: 'var(--s3)', border: '1px solid var(--br)', borderRadius: 4,
                    padding: '6px 10px', fontSize: 11, color: 'var(--txt)',
                    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span>{n.name}</span>
                  <span style={{
                    fontSize: 9, color: 'var(--txt3)',
                    background: 'var(--s2)', padding: '0px 5px', borderRadius: 3,
                  }}>{n_count}</span>
                </a>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Modal ───────────────────────────────────────────────────

function WatchModal({
  existing,
  initialStatus,
  availableIndustries,
  onClose,
  onSave,
  onRemove,
}: WatchModalProps & { availableIndustries: { id: string; label: string }[] }) {
  const [name, setName] = useState(existing?.name || '')
  const [ticker, setTicker] = useState(existing?.ticker || '')
  const [industry, setIndustry] = useState(existing?.industry || existing?.sec || '')
  const [acqs, setAcqs] = useState(existing?.acqs ?? 5)
  const [ev, setEv] = useState(existing?.ev ?? 0)
  const [ev_eb, setEvEb] = useState(existing?.ev_eb ?? 0)
  const [rev, setRev] = useState(existing?.rev ?? 0)
  const [ebm, setEbm] = useState(existing?.ebm ?? 0)
  const [notes, setNotes] = useState(existing?.notes || '')
  const [status, setStatus] = useState<WLStatus>(existing?.status || initialStatus)
  const [selectedCompany, setSelectedCompany] = useState('')

  function onCompanySelect(value: string) {
    setSelectedCompany(value)
    if (!value) return
    const co = COMPANIES.find((c) => c.name === value)
    if (!co) return
    setName(co.name); setTicker(co.ticker); setIndustry(co.sec)
    setAcqs(co.acqs); setEv(co.ev); setEvEb(co.ev_eb)
    setRev(co.rev); setEbm(co.ebm); setNotes(co.rea)
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000, padding: 20,
      }}
    >
      <div style={{
        background: 'var(--s2)', border: '1px solid var(--br2)', borderRadius: 10,
        maxWidth: 560, width: '100%', maxHeight: '90vh', overflowY: 'auto',
      }}>
        <div style={{
          padding: '14px 18px', borderBottom: '1px solid var(--br)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--txt)' }}>
            {existing ? `Edit: ${existing.name}` : '+ Add to Watchlist'}
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', color: 'var(--txt3)',
              fontSize: 22, cursor: 'pointer', lineHeight: 1,
            }}
          >×</button>
        </div>
        <div style={{ padding: 18 }}>
          {!existing && (
            <Field label="Target Company (autofill from database)">
              <select
                value={selectedCompany}
                onChange={(e) => onCompanySelect(e.target.value)}
                style={inputStyle}
              >
                <option value="">— Pick a listed company or enter manually below —</option>
                {COMPANIES.map((c) => (
                  <option key={c.ticker} value={c.name}>
                    {c.name} ({c.ticker}) · Score {c.acqs}/10
                  </option>
                ))}
              </select>
            </Field>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
            <Field label="Company Name">
              <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Ticker">
              <input value={ticker} onChange={(e) => setTicker(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Industry">
              <select value={industry} onChange={(e) => setIndustry(e.target.value)} style={inputStyle}>
                <option value="">— Select —</option>
                {availableIndustries.map((i) => (
                  <option key={i.id} value={i.id}>{i.label}</option>
                ))}
              </select>
            </Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value as WLStatus)} style={inputStyle}>
                {WL_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
            <Field label="Score (0–10)">
              <input
                type="number" min={0} max={10}
                value={acqs} onChange={(e) => setAcqs(Number(e.target.value))}
                style={inputStyle}
              />
            </Field>
            <Field label="EV (₹Cr)">
              <input
                type="number" value={ev}
                onChange={(e) => setEv(Number(e.target.value))}
                style={inputStyle}
              />
            </Field>
            <Field label="EV/EBITDA (×)">
              <input
                type="number" step="0.1" value={ev_eb}
                onChange={(e) => setEvEb(Number(e.target.value))}
                style={inputStyle}
              />
            </Field>
            <Field label="Revenue (₹Cr)">
              <input
                type="number" value={rev}
                onChange={(e) => setRev(Number(e.target.value))}
                style={inputStyle}
              />
            </Field>
          </div>

          <Field label="EBITDA Margin (%)">
            <input
              type="number" value={ebm}
              onChange={(e) => setEbm(Number(e.target.value))}
              style={inputStyle}
            />
          </Field>

          <Field label="Notes / Rationale">
            <textarea
              value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Why is this on the watchlist? Catalysts, risks, next steps…"
              style={{ ...inputStyle, minHeight: 90, resize: 'vertical', fontFamily: 'inherit' }}
            />
          </Field>

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => {
                if (!ticker.trim()) { alert('Ticker is required'); return }
                onSave({
                  ticker: ticker.trim().toUpperCase(),
                  name: name || 'Unnamed',
                  sec: industry || undefined,
                  industry: industry || undefined,
                  acqs,
                  ev,
                  ev_eb,
                  rev,
                  ebm,
                  notes,
                  status,
                  addedDate: existing?.addedDate || new Date().toLocaleDateString('en-GB', {
                    day: '2-digit', month: 'short', year: 'numeric',
                  }),
                })
              }}
              style={{
                flex: 1, background: 'var(--gold2)', color: '#000', border: 'none',
                padding: 10, borderRadius: 5, fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >{existing ? 'Update' : '★ Add to Watchlist'}</button>
            {existing && (
              <button
                onClick={onRemove}
                style={{
                  background: 'var(--red)', color: '#fff', border: 'none',
                  padding: '10px 16px', borderRadius: 5, fontSize: 13, cursor: 'pointer',
                }}
              >Remove</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'var(--s3)',
  border: '1px solid var(--br)',
  color: 'var(--txt)',
  padding: '8px 10px',
  borderRadius: 5,
  fontSize: 13,
  outline: 'none',
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{
        fontSize: 11, color: 'var(--txt3)', marginBottom: 5,
        textTransform: 'uppercase', letterSpacing: '0.5px',
      }}>{label}</div>
      {children}
    </div>
  )
}

function exportCSV(items: WLItem[]) {
  if (typeof window === 'undefined' || items.length === 0) return
  const headers = [
    'Name', 'Ticker', 'Industry', 'AddedDate', 'Score', 'Revenue',
    'EV', 'EV/EBITDA', 'EBITDA%', 'Status', 'Notes',
  ]
  const body = items
    .map((i) =>
      [
        i.name, i.ticker, i.industry || i.sec || '',
        i.addedDate || '', i.acqs, i.rev ?? '',
        i.ev ?? '', i.ev_eb ?? '', i.ebm ?? '',
        i.status ?? 'Monitoring', i.notes ?? '',
      ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
    ).join('\n')
  const csv = headers.join(',') + '\n' + body
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'watch_board.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// Silence unused-import warning for GROUPS (left imported so future
// sub-grouping by GROUPS keys is a one-line change).
void GROUPS
