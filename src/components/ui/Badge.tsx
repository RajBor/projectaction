'use client'

type BadgeVariant = 'gold' | 'cyan' | 'green' | 'red' | 'orange' | 'purple' | 'gray'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  size?: 'sm' | 'md'
}

const variantStyles: Record<BadgeVariant, { bg: string; color: string; border: string }> = {
  gold: {
    bg: 'rgba(247,183,49,0.12)',
    color: '#F7B731',
    border: 'rgba(247,183,49,0.3)',
  },
  cyan: {
    bg: 'rgba(0,180,216,0.12)',
    color: '#00B4D8',
    border: 'rgba(0,180,216,0.3)',
  },
  green: {
    bg: 'rgba(16,185,129,0.12)',
    color: '#10B981',
    border: 'rgba(16,185,129,0.3)',
  },
  red: {
    bg: 'rgba(239,68,68,0.12)',
    color: '#EF4444',
    border: 'rgba(239,68,68,0.3)',
  },
  orange: {
    bg: 'rgba(245,158,11,0.12)',
    color: '#F59E0B',
    border: 'rgba(245,158,11,0.3)',
  },
  purple: {
    bg: 'rgba(139,92,246,0.12)',
    color: '#8B5CF6',
    border: 'rgba(139,92,246,0.3)',
  },
  gray: {
    bg: 'rgba(85,104,128,0.2)',
    color: '#9AAFC8',
    border: 'rgba(85,104,128,0.3)',
  },
}

export function Badge({ children, variant = 'gray', size = 'sm' }: BadgeProps) {
  const s = variantStyles[variant]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
        borderRadius: 4,
        padding: size === 'sm' ? '1px 7px' : '3px 10px',
        fontSize: size === 'sm' ? 11 : 12,
        fontWeight: 500,
        letterSpacing: '0.3px',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

// Convenience function to get badge variant for deal stage
export function getStageBadgeVariant(
  stage: string
): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    Screening: 'gray',
    Diligence: 'cyan',
    Negotiation: 'orange',
    LOI: 'gold',
    Closed: 'green',
  }
  return map[stage] || 'gray'
}

// Convenience function to get badge variant for priority
export function getPriorityBadgeVariant(priority: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    High: 'red',
    Medium: 'orange',
    Low: 'gray',
  }
  return map[priority] || 'gray'
}

// Convenience function for category
export function getCategoryBadgeVariant(category: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    Policy: 'purple',
    'M&A': 'cyan',
    Funding: 'gold',
    Operations: 'orange',
    Market: 'green',
  }
  return map[category] || 'gray'
}

// Sentiment colors
export function getSentimentColor(sentiment: string): string {
  const map: Record<string, string> = {
    positive: '#10B981',
    negative: '#EF4444',
    neutral: '#9AAFC8',
  }
  return map[sentiment] || '#9AAFC8'
}

// Recommendation variant
export function getRecommendationVariant(rec: string): BadgeVariant {
  const map: Record<string, BadgeVariant> = {
    'Strong Buy': 'green',
    Buy: 'cyan',
    Hold: 'orange',
    Sell: 'red',
  }
  return map[rec] || 'gray'
}
