import { COMPANIES } from '@/lib/data/companies'
import { CHAIN } from '@/lib/data/chain'
import { PRIVATE_COMPANIES } from '@/lib/data/private-companies'
import { Badge } from '@/components/ui/Badge'
import { ScoreBadge } from '@/components/ui/ScoreBadge'

const PHDR_STYLE: React.CSSProperties = {
  padding: '20px 24px',
  borderBottom: '1px solid var(--br)',
  background: 'linear-gradient(180deg, var(--s2) 0%, var(--s1) 100%)',
  marginBottom: 20,
}

const STITLE_STYLE: React.CSSProperties = {
  fontFamily: 'Space Grotesk, sans-serif',
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--txt)',
  textTransform: 'uppercase',
  letterSpacing: '0.6px',
  marginBottom: 12,
  marginTop: 20,
  paddingBottom: 6,
  borderBottom: '1px solid var(--br)',
}

const KPI_STYLE: React.CSSProperties = {
  background: 'var(--s2)',
  border: '1px solid var(--br)',
  borderRadius: 8,
  padding: '14px 16px',
  flex: 1,
  minWidth: 160,
  position: 'relative',
  overflow: 'hidden',
}

const CARD_STYLE: React.CSSProperties = {
  background: 'var(--s2)',
  border: '1px solid var(--br)',
  borderRadius: 8,
  padding: 14,
  marginBottom: 10,
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
          fontFamily: 'Space Grotesk, sans-serif',
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

function tdColor(good: boolean, med: boolean): string {
  if (good) return 'var(--green)'
  if (med) return 'var(--gold2)'
  return 'var(--orange)'
}

function evColor(ev_eb: number): string {
  if (ev_eb <= 0) return 'var(--txt2)'
  if (ev_eb <= 15) return 'var(--green)'
  if (ev_eb <= 25) return 'var(--gold2)'
  if (ev_eb <= 40) return 'var(--orange)'
  return 'var(--red)'
}

export default function MARadarPage() {
  const strongBuy = COMPANIES.filter((c) => c.acqs >= 9).length
  const consider = COMPANIES.filter((c) => c.acqs >= 7 && c.acqs < 9).length
  const monitor = COMPANIES.filter((c) => c.acqs >= 5 && c.acqs < 7).length
  const pass = COMPANIES.filter((c) => c.acqs < 5).length
  const privateTargets = PRIVATE_COMPANIES.length

  const top = COMPANIES.filter((c) => c.acqs >= 8).sort((a, b) => b.acqs - a.acqs)
  const all = [...COMPANIES].sort((a, b) => b.acqs - a.acqs)

  return (
    <div>
      {/* Page header */}
      <div style={PHDR_STYLE}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 6,
          }}
        >
          SolarGrid Pro <span style={{ margin: '0 6px' }}>›</span> M&A Intelligence
        </div>
        <h1
          style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 26,
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
            marginBottom: 10,
          }}
        >
          M&A <em style={{ color: 'var(--gold2)', fontStyle: 'italic' }}>Radar</em> — All Segments
        </h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Badge variant="gray">
            Consolidated acquisition intelligence across entire value chain
          </Badge>
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <KpiTile label="Strong Buy (9–10)" value={strongBuy} sub="Ideal targets" color="green" />
        <KpiTile label="Consider (7–8)" value={consider} sub="Viable with diligence" />
        <KpiTile label="Monitor (5–6)" value={monitor} sub="Watch for entry" color="cyan" />
        <KpiTile label="Pass (1–4)" value={pass} sub="Size/valuation barrier" color="red" />
        <KpiTile
          label="Private Targets"
          value={privateTargets}
          sub="Unlisted acquirable"
          color="orange"
        />
      </div>

      {/* Strong Buy cards */}
      <div style={STITLE_STYLE}>⭐ STRONG BUY — Ranked Acquisition Targets</div>
      {top.map((co) => (
        <div
          key={co.ticker}
          style={{
            ...CARD_STYLE,
            borderLeft: co.acqs >= 9 ? '3px solid var(--gold2)' : '3px solid var(--br2)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
            <ScoreBadge score={co.acqs} size={40} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--txt)' }}>
                {co.name}{' '}
                <span
                  style={{
                    fontSize: 12,
                    color: 'var(--txt3)',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  ({co.ticker})
                </span>
              </div>
              <div
                style={{
                  fontSize: 13,
                  color: 'var(--gold2)',
                  margin: '5px 0',
                  fontFamily: 'JetBrains Mono, monospace',
                }}
              >
                Rev ₹{co.rev.toLocaleString()}Cr · EBITDA {co.ebm}% · EV ₹
                {co.ev > 0 ? co.ev.toLocaleString() + 'Cr' : 'N/A'} · EV/EBITDA{' '}
                {co.ev_eb > 0 ? co.ev_eb + '×' : '—'} · D/E {co.dbt_eq} · RevGr {co.revg}%
              </div>
              <div style={{ fontSize: 13, color: 'var(--txt2)' }}>{co.rea}</div>
              <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 5 }}>
                Components:{' '}
                {co.comp.map((id) => CHAIN.find((c) => c.id === id)?.name || id).join(' · ')}
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
                alignItems: 'flex-end',
                flexShrink: 0,
              }}
            >
              <Badge variant={co.acqs >= 9 ? 'green' : co.acqs >= 7 ? 'gold' : 'cyan'}>
                {co.acqf}
              </Badge>
              <Badge variant={co.sec === 'solar' ? 'gold' : 'cyan'}>
                {co.sec.toUpperCase()}
              </Badge>
            </div>
          </div>
        </div>
      ))}

      {/* All companies table */}
      <div style={STITLE_STYLE}>📋 All Companies — Ranked by Score</div>
      <div
        style={{
          overflowX: 'auto',
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ background: 'var(--s3)' }}>
              {[
                'Score',
                'Company',
                'Sector',
                'Mkt Cap ₹Cr',
                'EV ₹Cr',
                'EV/EBITDA',
                'Rev Gr%',
                'EBITDA%',
                'D/E',
                'Flag',
              ].map((h) => (
                <th
                  key={h}
                  style={{
                    padding: '10px 12px',
                    textAlign: 'left',
                    fontSize: 11,
                    color: 'var(--txt2)',
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    borderBottom: '1px solid var(--br)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {all.map((co) => (
              <tr
                key={co.ticker}
                style={{
                  borderBottom: '1px solid var(--br)',
                  background: co.acqs >= 8 ? 'var(--golddim)' : undefined,
                }}
              >
                <td style={{ padding: '10px 12px' }}>
                  <ScoreBadge score={co.acqs} />
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--txt)', whiteSpace: 'nowrap' }}>
                  {co.acqs >= 8 ? '★ ' : ''}
                  {co.name}
                  <br />
                  <span
                    style={{
                      fontSize: 11,
                      color: 'var(--txt3)',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}
                  >
                    {co.ticker}
                  </span>
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <Badge variant={co.sec === 'solar' ? 'gold' : 'cyan'}>{co.sec}</Badge>
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--txt2)' }}>
                  {co.mktcap > 0 ? '₹' + co.mktcap.toLocaleString() : 'Private'}
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--gold2)' }}>
                  {co.ev > 0 ? '₹' + co.ev.toLocaleString() : '—'}
                </td>
                <td style={{ padding: '10px 12px', color: evColor(co.ev_eb) }}>
                  {co.ev_eb > 0 ? co.ev_eb + '×' : '—'}
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: tdColor(co.revg >= 25, co.revg >= 12),
                  }}
                >
                  {co.revg}%
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: tdColor(co.ebm >= 15, co.ebm >= 10),
                  }}
                >
                  {co.ebm}%
                </td>
                <td
                  style={{
                    padding: '10px 12px',
                    color: tdColor(co.dbt_eq <= 0.3, co.dbt_eq <= 0.7),
                  }}
                >
                  {co.dbt_eq}
                </td>
                <td style={{ padding: '10px 12px' }}>
                  <Badge
                    variant={
                      co.acqs >= 8
                        ? 'green'
                        : co.acqs >= 6
                          ? 'gold'
                          : co.acqs >= 4
                            ? 'cyan'
                            : 'red'
                    }
                  >
                    {co.acqf}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
