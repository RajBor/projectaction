/**
 * End-to-end verification: given a live RapidAPI response, run the
 * same derivation the UI will use (mktcap-scaled EV) and compare
 * against the stale baseline + against known market reality.
 *
 * Mirrors src/lib/valuation/live-metrics.ts deriveLiveMetrics().
 *
 *   node scripts/verify-live-metrics.mjs
 */

import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1')
}
const host = env.RAPIDAPI_INDIAN_STOCK_HOST
const key = env.RAPIDAPI_INDIAN_STOCK_KEY

// Parse the baseline COMPANIES[] rows we care about
const src = readFileSync('src/lib/data/companies.ts', 'utf8')
const pick = (ticker) => {
  const re = new RegExp(
    `\\{name:"[^"]+",ticker:"${ticker}",[^}]*mktcap:(\\d+)[^}]*ev:(\\d+)[^}]*ev_eb:([\\d.]+)[^}]*\\}`
  )
  const m = src.match(re)
  return m ? { mktcap: +m[1], ev: +m[2], ev_eb: +m[3] } : null
}

function num(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const c = v.replace(/[,₹$%\s]/g, '').trim()
    if (!c || c === '-') return null
    const n = parseFloat(c)
    return Number.isFinite(n) ? n : null
  }
}
const canon = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
function lookup(bucket, keys) {
  if (!bucket || typeof bucket !== 'object') return null
  const map = new Map()
  for (const r of Object.values(bucket)) {
    if (!r || typeof r !== 'object') continue
    const k = typeof r.key === 'string' ? r.key : null
    if (!k) continue
    const n = num(r.value)
    if (n == null) continue
    map.set(canon(k), n)
  }
  for (const k of keys) {
    const h = map.get(canon(k))
    if (h != null) return h
  }
}

/** Mirror of deriveLiveMetrics() EV path. */
function deriveLiveEv(baseCo, liveMcapCr) {
  const baselineEvRatio =
    baseCo.mktcap > 0 ? baseCo.ev / baseCo.mktcap : 1
  const liveEv = Math.round(liveMcapCr * baselineEvRatio)
  return { liveEv, ratio: baselineEvRatio }
}

const TARGETS = [
  { ticker: 'WAAREEENS', apiName: 'waaree energies' },
  { ticker: 'POLYCAB', apiName: 'polycab' },
  { ticker: 'PREMIENRG', apiName: 'premier energies' },
  { ticker: 'BORORENEW', apiName: 'borosil renewables' },
  { ticker: 'KEI', apiName: 'kei industries' },
  { ticker: 'BHEL', apiName: 'bhel' },
  { ticker: 'NTPC', apiName: 'ntpc' },
]

console.log('Verifying mktcap-scaled EV derivation end-to-end…\n')
console.log(
  'ticker'.padEnd(12) +
    'baseline mkt'.padStart(14) +
    'live mkt'.padStart(14) +
    'ratio'.padStart(10) +
    'baseline ev'.padStart(14) +
    'live ev'.padStart(14) +
    'delta'.padStart(10)
)
console.log('─'.repeat(88))

for (const t of TARGETS) {
  const baseline = pick(t.ticker)
  if (!baseline) {
    console.log(`${t.ticker.padEnd(12)}  (not in COMPANIES[])`)
    continue
  }
  const url = `https://${host}/stock?name=${encodeURIComponent(t.apiName)}`
  try {
    const res = await fetch(url, {
      headers: { 'x-rapidapi-host': host, 'x-rapidapi-key': key },
    })
    if (!res.ok) {
      console.log(`${t.ticker.padEnd(12)}  HTTP ${res.status}`)
      continue
    }
    const json = await res.json()
    const liveMcap = lookup(json.keyMetrics?.priceandVolume, ['marketCap'])
    if (liveMcap == null) {
      console.log(`${t.ticker.padEnd(12)}  no live mktcap`)
      continue
    }
    const { liveEv, ratio } = deriveLiveEv(baseline, liveMcap)
    const deltaPct = ((liveEv - baseline.ev) / baseline.ev) * 100
    console.log(
      t.ticker.padEnd(12) +
        ('₹' + baseline.mktcap.toLocaleString()).padStart(14) +
        ('₹' + Math.round(liveMcap).toLocaleString()).padStart(14) +
        ratio.toFixed(3).padStart(10) +
        ('₹' + baseline.ev.toLocaleString()).padStart(14) +
        ('₹' + liveEv.toLocaleString()).padStart(14) +
        ((deltaPct >= 0 ? '+' : '') + deltaPct.toFixed(1) + '%').padStart(10)
    )
  } catch (e) {
    console.log(`${t.ticker.padEnd(12)}  ${e.message}`)
  }
  await new Promise((r) => setTimeout(r, 400))
}
