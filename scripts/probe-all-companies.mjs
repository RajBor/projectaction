/**
 * Verify the refresh pipeline end-to-end by hitting RapidAPI for EVERY
 * tracked ticker in COMPANIES[] and reporting which ones successfully
 * extract market cap + P/E via the adapter. Any row with an empty
 * marketCapCr would silently fall back to the stale baseline in the
 * UI, so this script tells us whether the fix actually reaches every
 * company or only a subset.
 *
 *   node scripts/probe-all-companies.mjs
 */

import { readFileSync } from 'node:fs'

// Load env
const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1')
}
const host = env.RAPIDAPI_INDIAN_STOCK_HOST
const key = env.RAPIDAPI_INDIAN_STOCK_KEY

// Inline helper — same as src/lib/stocks/profile-adapter.ts
function num(v) {
  if (v == null) return undefined
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') {
    const c = v.replace(/[,₹$%\s]/g, '').trim()
    if (!c || c === '-') return undefined
    const n = parseFloat(c)
    return Number.isFinite(n) ? n : undefined
  }
}
const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
function bucketLookup(bucket, cands) {
  if (!bucket || typeof bucket !== 'object') return undefined
  const m = new Map()
  for (const r of Object.values(bucket)) {
    if (!r || typeof r !== 'object') continue
    const k = typeof r.key === 'string' ? r.key : null
    if (!k) continue
    const n = num(r.value)
    if (n == null) continue
    m.set(canon(k), n)
  }
  for (const c of cands) {
    const h = m.get(canon(c))
    if (h != null) return h
  }
}

function adapt(profile) {
  const out = {}
  out.lastPrice =
    num(profile.currentPrice?.NSE) ?? num(profile.currentPrice?.BSE)
  const km = profile.keyMetrics || {}
  out.marketCapCr = bucketLookup(km.priceandVolume, ['marketCap'])
  out.pe = bucketLookup(km.valuation, [
    'pPerEBasicExcludingExtraordinaryItemsTTM',
    'pPerEIncludingExtraordinaryItemsTTM',
    'pPerEExcludingExtraordinaryItemsMostRecentFiscalYear',
  ])
  const netDebt = bucketLookup(km.valuation, ['netDebtLFY', 'netDebtLFI'])
  if (out.marketCapCr != null) {
    out.evCr = out.marketCapCr + (netDebt ?? 0)
  }
  const ebps = bucketLookup(km.persharedata, ['eBITDPerShareTrailing12Month'])
  let sharesCr
  if (out.marketCapCr != null && out.lastPrice > 0) {
    sharesCr = out.marketCapCr / out.lastPrice
  }
  if (ebps != null && sharesCr != null && out.evCr != null) {
    const ebitdaCr = ebps * sharesCr
    if (ebitdaCr > 0) out.evEbitda = out.evCr / ebitdaCr
  }
  return out
}

// Import COMPANIES from source
const companiesSrc = readFileSync('src/lib/data/companies.ts', 'utf8')
// Extract every {name:"...",ticker:"..."} pair — quick regex parse
const companies = []
const re = /\{name:"([^"]+)",ticker:"([^"]+)"/g
let mm
while ((mm = re.exec(companiesSrc))) {
  companies.push({ name: mm[1], ticker: mm[2] })
}

// Parse NAME_OVERRIDES straight out of src/lib/stocks/api.ts so we
// always stay in sync with the real library.
const apiSrc = readFileSync('src/lib/stocks/api.ts', 'utf8')
const overridesMatch = apiSrc.match(/const NAME_OVERRIDES[^{]*\{([\s\S]*?)\n\}/)
const OVERRIDES = {}
if (overridesMatch) {
  const body = overridesMatch[1]
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9]+):\s*'([^']+)'/)
    if (m) OVERRIDES[m[1]] = m[2]
  }
}
const apiName = (ticker, name) =>
  OVERRIDES[ticker] || name.split(' ')[0].toLowerCase()

async function probe(co) {
  const name = apiName(co.ticker, co.name)
  const url = `https://${host}/stock?name=${encodeURIComponent(name)}`
  try {
    const res = await fetch(url, {
      headers: { 'x-rapidapi-host': host, 'x-rapidapi-key': key },
    })
    if (!res.ok) return { co, ok: false, reason: `HTTP ${res.status}` }
    const json = await res.json()
    const live = adapt(json)
    if (live.marketCapCr == null) {
      return { co, ok: false, reason: 'no marketCap extracted', live }
    }
    return { co, ok: true, live }
  } catch (e) {
    return { co, ok: false, reason: e.message }
  }
}

console.log(`Probing ${companies.length} tickers (batch size 6)…\n`)

const results = []
let done = 0
const BATCH = 6
for (let i = 0; i < companies.length; i += BATCH) {
  const batch = companies.slice(i, i + BATCH)
  const batchResults = await Promise.all(batch.map(probe))
  results.push(...batchResults)
  done += batch.length
  process.stdout.write(`  ${done}/${companies.length}\r`)
}
console.log()

// Report
const successes = results.filter((r) => r.ok)
const failures = results.filter((r) => !r.ok)

console.log(`\n✓ SUCCESS:  ${successes.length}/${companies.length}`)
console.log(`✗ FAILURE:  ${failures.length}/${companies.length}\n`)

if (successes.length > 0) {
  console.log('── Top 10 by fresh market cap ──')
  successes
    .sort((a, b) => (b.live.marketCapCr || 0) - (a.live.marketCapCr || 0))
    .slice(0, 10)
    .forEach((r) => {
      console.log(
        `  ${r.co.ticker.padEnd(12)} ${r.co.name.padEnd(30)} ` +
          `₹${r.live.marketCapCr.toFixed(0).padStart(8)} Cr · ` +
          `P/E ${(r.live.pe ?? 0).toFixed(1)}× · ` +
          `EV/EBITDA ${(r.live.evEbitda ?? 0).toFixed(1)}×`
      )
    })
}

if (failures.length > 0) {
  console.log('\n── Failures ──')
  for (const f of failures) {
    console.log(`  ${f.co.ticker.padEnd(12)} ${f.co.name.padEnd(30)} → ${f.reason}`)
  }
}
