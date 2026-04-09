import { getNews } from '@/lib/data/news'
import { KpiCard } from '@/components/ui/KpiCard'
import { SectionTitle } from '@/components/ui/SectionTitle'
import { NewsCard } from '@/components/ui/NewsCard'

export default async function NewsPage() {
  const news = await getNews()

  const positive = news.filter((n) => n.sentiment === 'positive').length
  const negative = news.filter((n) => n.sentiment === 'negative').length
  const policyCount = news.filter((n) => n.category === 'Policy').length
  const maCount = news.filter((n) => n.category === 'M&A').length

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          Intelligence
        </div>
        <h1
          style={{
            fontFamily: 'Space Grotesk, sans-serif',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
          }}
        >
          News Hub
        </h1>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 24 }}>
        <KpiCard
          label="Total Articles"
          value={String(news.length)}
          sub="Last 7 days"
          color="cyan"
          delay={0}
        />
        <KpiCard
          label="Positive Signals"
          value={String(positive)}
          sub={`${Math.round((positive / news.length) * 100)}% bullish`}
          color="green"
          delay={0.07}
        />
        <KpiCard
          label="Negative Flags"
          value={String(negative)}
          sub="Risk items"
          color="red"
          delay={0.14}
        />
        <KpiCard
          label="Policy Updates"
          value={String(policyCount)}
          sub={`${maCount} M&A stories`}
          color="gold"
          delay={0.21}
        />
      </div>

      {/* Category filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {['All', 'Policy', 'M&A', 'Funding', 'Operations', 'Market'].map((cat) => (
          <button
            key={cat}
            style={{
              background: cat === 'All' ? 'var(--s3)' : 'transparent',
              border: `1px solid ${cat === 'All' ? 'var(--br2)' : 'var(--br)'}`,
              color: cat === 'All' ? 'var(--txt)' : 'var(--txt3)',
              padding: '5px 14px',
              borderRadius: 4,
              fontSize: 12,
              cursor: 'pointer',
            }}
          >
            {cat}
          </button>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span
            style={{
              fontSize: 11,
              color: 'var(--green)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ fontSize: 9 }}>●</span> Positive
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--txt3)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ fontSize: 9 }}>●</span> Neutral
          </span>
          <span
            style={{
              fontSize: 11,
              color: 'var(--red)',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span style={{ fontSize: 9 }}>●</span> Negative
          </span>
        </div>
      </div>

      <div style={{ marginBottom: 16 }}>
        <SectionTitle title="Latest Intelligence" subtitle="Renewable Energy News" />
      </div>

      {/* News grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {news.map((item) => (
          <NewsCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  )
}
