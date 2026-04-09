'use client'

interface SectionTitleProps {
  title: string
  subtitle?: string
  action?: React.ReactNode
}

export function SectionTitle({ title, subtitle, action }: SectionTitleProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        marginBottom: 16,
      }}
    >
      <div>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          {subtitle || '\u00a0'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h2
            style={{
              fontFamily: 'Space Grotesk, sans-serif',
              fontSize: 17,
              fontWeight: 600,
              color: 'var(--txt)',
              margin: 0,
            }}
          >
            {title}
          </h2>
          <div
            style={{
              flex: 1,
              height: 1,
              background: 'linear-gradient(to right, var(--br2), transparent)',
              width: 80,
            }}
          />
        </div>
      </div>
      {action && <div>{action}</div>}
    </div>
  )
}
