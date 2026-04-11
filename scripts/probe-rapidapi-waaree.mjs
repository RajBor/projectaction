/**
 * Probe the RapidAPI Indian Stock Exchange /stock endpoint for Waaree
 * Energies so we can see the exact shape of the response and tell why
 * the profile adapter isn't picking up the market cap / EV / EV/EBITDA.
 *
 *   node scripts/probe-rapidapi-waaree.mjs
 */

import { readFileSync } from 'node:fs'

// Quick .env.local loader
const env = {}
try {
  const raw = readFileSync('.env.local', 'utf8')
  for (const line of raw.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
    if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1')
  }
} catch {
  // ignore
}

const host = env.RAPIDAPI_INDIAN_STOCK_HOST
const key = env.RAPIDAPI_INDIAN_STOCK_KEY
if (!host || !key) {
  console.error('Missing RapidAPI env in .env.local')
  process.exit(1)
}

const url = `https://${host}/stock?name=${encodeURIComponent('waaree energies')}`
console.log('GET', url, '\n')

const res = await fetch(url, {
  headers: {
    'x-rapidapi-host': host,
    'x-rapidapi-key': key,
  },
})
console.log('status:', res.status)
if (!res.ok) {
  console.error(await res.text())
  process.exit(1)
}
const json = await res.json()

// Summary view — show the likely value-carrying paths
const keys = Object.keys(json)
console.log('\ntop-level keys:', keys.slice(0, 40))

const show = (label, obj) => {
  if (obj == null) return
  console.log(`\n── ${label} ──`)
  if (typeof obj !== 'object') {
    console.log(obj)
    return
  }
  for (const [k, v] of Object.entries(obj)) {
    if (v == null) continue
    if (typeof v === 'object') {
      console.log(`  ${k}: (object, keys: ${Object.keys(v).slice(0, 10).join(', ')})`)
    } else {
      console.log(`  ${k}: ${v}`)
    }
  }
}

show('currentPrice', json.currentPrice)
show('percentChange', json.percentChange)
show('yearHigh / yearLow', { yearHigh: json.yearHigh, yearLow: json.yearLow })
show('keyMetrics (truncated)', json.keyMetrics)
// Try common nested buckets
if (json.keyMetrics && typeof json.keyMetrics === 'object') {
  show('keyMetrics.valuation', json.keyMetrics.valuation)
  show('keyMetrics.ratios', json.keyMetrics.ratios)
  show('keyMetrics.marketCap', json.keyMetrics.marketCap)
}
show('companyProfile', json.companyProfile)
show('stockTechnicalData (first 3)', (json.stockTechnicalData || []).slice(0, 3))
show('recosBar', json.recosBar)
show('riskMeter', json.riskMeter)

// Grep every key-value pair in the entire tree for "market" / "ev" / "cap" / "pe"
console.log('\n── Interesting key hits (substring match) ──')
const want = ['market', 'cap', 'ev', 'pe', 'ebitda', 'enterprise']
const seen = new Set()
function walk(node, path = '') {
  if (!node || typeof node !== 'object') return
  if (seen.has(node)) return
  seen.add(node)
  for (const [k, v] of Object.entries(node)) {
    const p = path ? `${path}.${k}` : k
    const lower = k.toLowerCase()
    if (want.some((w) => lower.includes(w))) {
      const display = typeof v === 'object' ? `(${Array.isArray(v) ? 'array' : 'object'})` : v
      console.log(`  ${p}: ${display}`)
    }
    if (typeof v === 'object') walk(v, p)
  }
}
walk(json)
