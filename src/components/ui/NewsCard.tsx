'use client'

import { Badge, getCategoryBadgeVariant, getSentimentColor } from '@/components/ui/Badge'
import type { NewsItem } from '@/lib/data/news'

export function NewsCard({ item }: { item: NewsItem }) {
  const sentimentColor = getSentimentColor(item.sentiment)
  const sentimentIcon =
    item.sentiment === 'positive' ? '↑' : item.sentiment === 'negative' ? '↓' : '→'

  return (
    <div
      style={{
        background: 'var(--s2)',
        border: '1px solid var(--br)',
        borderRadius: 8,
        padding: '18px 20px',
        position: 'relative',
        overflow: 'hidden',
        transition: 'border-color 0.2s, background 0.2s',
      }}
    >
      {/* Sentiment indicator bar */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 2,
          background: `linear-gradient(to right, ${sentimentColor}, transparent)`,
        }}
      />

      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 10,
          gap: 12,
        }}
      >
        <div style={{ flex: 1 }}>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--txt)',
              margin: 0,
              marginBottom: 6,
              lineHeight: 1.3,
            }}
          >
            {item.title}
          </h3>
          <p
            style={{
              fontSize: 13,
              color: 'var(--txt2)',
              margin: 0,
              lineHeight: 1.4,
            }}
          >
            {item.summary}
          </p>
        </div>

        {/* Sentiment indicator */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            padding: '8px 12px',
            background: 'var(--s3)',
            borderRadius: 6,
            minWidth: 50,
          }}
        >
          <span
            style={{
              fontSize: 16,
              color: sentimentColor,
              fontWeight: 600,
            }}
          >
            {sentimentIcon}
          </span>
          <span
            style={{
              fontSize: 10,
              color: 'var(--txt3)',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}
          >
            {item.sentiment}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge variant={getCategoryBadgeVariant(item.category)}>{item.category}</Badge>
          <span style={{ fontSize: 11, color: 'var(--txt3)' }}>·</span>
          <span style={{ fontSize: 11, color: 'var(--txt3)', fontWeight: 500 }}>
            {item.source}
          </span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--txt4)' }}>{item.date}</span>
      </div>
    </div>
  )
}