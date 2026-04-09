'use client'

const tickerData = [
  { ticker: 'ADANIGREEN', price: '₹1,842.50', change: '+1.34%', up: true },
  { ticker: 'TATAPOWER', price: '₹418.75', change: '-0.76%', up: false },
  { ticker: 'SJVN', price: '₹132.40', change: '+2.20%', up: true },
  { ticker: 'WAAREEENER', price: '₹2,940.00', change: '+1.58%', up: true },
  { ticker: 'PREMIERENE', price: '₹1,280.00', change: '-0.96%', up: false },
  { ticker: 'IREDA', price: '₹218.45', change: '+3.12%', up: true },
  { ticker: 'TORNTPOWER', price: '₹1,486.20', change: '+0.84%', up: true },
  { ticker: 'CESC', price: '₹142.80', change: '-0.32%', up: false },
  { ticker: 'NTPC', price: '₹362.15', change: '+1.05%', up: true },
  { ticker: 'POWERGRID', price: '₹314.60', change: '-0.18%', up: false },
  { ticker: 'INOXWIND', price: '₹198.35', change: '+2.44%', up: true },
  { ticker: 'BOROSIL', price: '₹380.90', change: '+0.67%', up: true },
  { ticker: 'KPITTECH', price: '₹1,640.00', change: '-1.20%', up: false },
  { ticker: 'STERPOWER', price: '₹48.25', change: '+4.12%', up: true },
  { ticker: 'SOLARA', price: '₹924.50', change: '+1.88%', up: true },
]

const TickerItem = ({
  ticker,
  price,
  change,
  up,
}: {
  ticker: string
  price: string
  change: string
  up: boolean
}) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      padding: '0 24px',
      borderRight: '1px solid var(--br)',
      whiteSpace: 'nowrap',
    }}
  >
    <span
      style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        color: 'var(--txt2)',
        letterSpacing: '0.5px',
      }}
    >
      {ticker}
    </span>
    <span
      style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        color: 'var(--txt)',
        fontWeight: 500,
      }}
    >
      {price}
    </span>
    <span
      style={{
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        color: up ? 'var(--green)' : 'var(--red)',
        fontWeight: 500,
      }}
    >
      {change}
    </span>
  </div>
)

export function TickerBar() {
  const doubled = [...tickerData, ...tickerData]

  return (
    <div
      style={{
        background: 'var(--s1)',
        borderBottom: '1px solid var(--br)',
        height: 32,
        overflow: 'hidden',
        display: 'flex',
        alignItems: 'center',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 48,
          background: 'linear-gradient(to right, var(--s1), transparent)',
          zIndex: 2,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          width: 48,
          background: 'linear-gradient(to left, var(--s1), transparent)',
          zIndex: 2,
        }}
      />
      <div className="ticker-track" style={{ display: 'flex', alignItems: 'center' }}>
        {doubled.map((item, i) => (
          <TickerItem key={i} {...item} />
        ))}
      </div>
    </div>
  )
}
