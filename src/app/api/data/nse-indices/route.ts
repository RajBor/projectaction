import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { ensureNseCookies } from '@/lib/live/nse-fetch'

/**
 * GET /api/data/nse-indices — live market-pulse indices for the sidebar.
 *
 * Auth required (same as /api/data/nse-quote). Cached upstream by the
 * LiveSnapshotProvider / sidebar hook at hourly cadence.
 *
 * Returns the five indices shown in the left sidebar:
 *   NIFTY 50, NIFTY ENERGY, NIFTY POWER, NIFTY METAL
 * plus USD→INR from open.er-api.com (free, no key).
 */

export interface IndexTick {
  label: string
  symbol: string
  value: number
  change: number
  changePct: number
  up: boolean
}

export interface IndicesResponse {
  ok: boolean
  indices: IndexTick[]
  fetchedAt: string
  errors?: string[]
}

// The NSE `allIndices` response shape we care about
interface AllIndicesRow {
  index?: string
  indexSymbol?: string
  last?: number
  variation?: number
  percentChange?: number
}
interface AllIndicesResponse {
  data?: AllIndicesRow[]
}

// Indices to surface in the sidebar, in display order
const TARGET_INDICES: Array<{ label: string; match: string }> = [
  { label: 'NIFTY 50', match: 'NIFTY 50' },
  { label: 'NIFTY ENERGY', match: 'NIFTY ENERGY' },
  { label: 'NIFTY POWER', match: 'NIFTY POWER' },
  { label: 'NIFTY METAL', match: 'NIFTY METAL' },
]

async function fetchNseAllIndices(): Promise<AllIndicesResponse | null> {
  await ensureNseCookies()
  // `ensureNseCookies` primes an internal module-level cookie jar that
  // `fetchNseQuote` uses — replicate the same request surface here.
  try {
    const res = await fetch('https://www.nseindia.com/api/allIndices', {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
        Referer: 'https://www.nseindia.com/market-data/live-market-indices',
      },
    })
    if (!res.ok) return null
    return (await res.json()) as AllIndicesResponse
  } catch {
    return null
  }
}

async function fetchUsdInr(): Promise<number | null> {
  // Free, keyless USD→INR quote. If this fails we simply omit the row.
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const json = (await res.json()) as { rates?: { INR?: number } }
    const inr = json?.rates?.INR
    return typeof inr === 'number' && isFinite(inr) ? inr : null
  } catch {
    return null
  }
}

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: 'Not signed in' }, { status: 401 })
  }

  const indices: IndexTick[] = []
  const errors: string[] = []

  const all = await fetchNseAllIndices()
  if (!all?.data) {
    errors.push('NSE allIndices: no data')
  } else {
    for (const target of TARGET_INDICES) {
      const row = all.data.find(
        (r) =>
          (r.index || '').toUpperCase() === target.match.toUpperCase() ||
          (r.indexSymbol || '').toUpperCase() === target.match.toUpperCase()
      )
      if (!row || typeof row.last !== 'number') {
        errors.push(`${target.label}: not found`)
        continue
      }
      const change = typeof row.variation === 'number' ? row.variation : 0
      const pct = typeof row.percentChange === 'number' ? row.percentChange : 0
      indices.push({
        label: target.label,
        symbol: row.indexSymbol || target.match,
        value: row.last,
        change,
        changePct: pct,
        up: change >= 0,
      })
    }
  }

  // USD→INR — separate provider
  const usdInr = await fetchUsdInr()
  if (usdInr != null) {
    indices.push({
      label: 'USD/INR',
      symbol: 'USDINR',
      value: usdInr,
      change: 0,
      changePct: 0,
      up: true,
    })
  } else {
    errors.push('USD/INR: fetch failed')
  }

  const body: IndicesResponse = {
    ok: indices.length > 0,
    indices,
    fetchedAt: new Date().toISOString(),
    errors: errors.length > 0 ? errors : undefined,
  }
  return NextResponse.json(body)
}
