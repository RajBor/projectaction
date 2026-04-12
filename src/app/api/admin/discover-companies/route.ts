import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

/**
 * GET /api/admin/discover-companies?q=solar&limit=20
 *
 * Admin-only. Uses the Screener.in search API to discover companies
 * (including SME-listed) by keyword. Returns an array of matches
 * with name, NSE/BSE code, and Screener URL.
 */

interface ScreenerSearchResult {
  id: number
  name: string
  url: string // e.g. "/company/WAAREEENER/consolidated/"
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions)
  const role = (session?.user as { role?: string } | undefined)?.role
  if (!session?.user || role !== 'admin') {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const q = (url.searchParams.get('q') || '').trim()
  const limit = Math.min(
    Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20),
    50
  )

  if (!q || q.length < 2) {
    return NextResponse.json(
      { ok: false, error: 'Query must be at least 2 characters' },
      { status: 400 }
    )
  }

  try {
    const upstream = await fetch(
      `https://www.screener.in/api/company/search/?q=${encodeURIComponent(q)}&limit=${limit}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/json',
        },
      }
    )

    if (!upstream.ok) {
      return NextResponse.json(
        { ok: false, error: `Screener search returned ${upstream.status}` },
        { status: 502 }
      )
    }

    const raw: ScreenerSearchResult[] = await upstream.json()
    if (!Array.isArray(raw)) {
      return NextResponse.json(
        { ok: false, error: 'Unexpected response shape' },
        { status: 502 }
      )
    }

    // Extract the NSE/BSE code from the URL path
    const results = raw.map((r) => {
      // URL is like "/company/WAAREEENER/consolidated/" or "/company/544354/"
      const codeMatch = r.url.match(/\/company\/([^/]+)\//)
      const code = codeMatch ? codeMatch[1] : ''
      // Detect if it's a numeric BSE code or an alphanumeric NSE code
      const isNumeric = /^\d+$/.test(code)
      return {
        id: r.id,
        name: r.name,
        code,
        exchange: isNumeric ? 'BSE' : 'NSE',
        screenerUrl: `https://www.screener.in${r.url}`,
      }
    })

    return NextResponse.json({ ok: true, results, total: results.length })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Network error',
      },
      { status: 502 }
    )
  }
}
