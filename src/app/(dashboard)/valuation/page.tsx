'use client'

/**
 * /valuation has been consolidated into /maradar. This stub exists
 * only so existing bookmarks keep working — it immediately redirects.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function ValuationRedirectPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/maradar')
  }, [router])
  return (
    <div
      style={{
        padding: 40,
        color: 'var(--txt3)',
        fontSize: 13,
        fontFamily: 'Inter, sans-serif',
      }}
    >
      Redirecting to M&amp;A Radar…
    </div>
  )
}
