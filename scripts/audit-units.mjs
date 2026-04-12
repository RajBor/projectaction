/**
 * Unit-consistency audit for the RapidAPI Indian Stock Exchange feed.
 *
 * Probes a spread of tickers (mega-cap, mid-cap, small-cap, PSU,
 * net-cash, highly-levered) and prints the raw values we'd read for:
 *
 *   - keyMetrics.priceandVolume.marketCap
 *   - currentPrice.NSE
 *   - keyMetrics.valuation.netDebtLFY / netDebtLFI
 *   - keyMetrics.persharedata.eBITDPerShareTrailing12Month
 *   - keyMetrics.persharedata.rRevenuePerShareTrailing12onth
 *
 * Then cross-checks:
 *   (a) implied shares outstanding (mktcap / price) against a plausible
 *       range for each ticker (mega-caps: 10 - 2000 Cr shares)
 *   (b) implied revenue (revenue-per-share × shares) against a plausible
 *       range for each ticker
 *   (c) the sign + magnitude of netDebt against the known balance-sheet
 *       position (Waaree: net-cash ~700 Cr, not 67k Cr)
 *
 * The point: determine whether marketCap is ALWAYS in ₹Cr, ALWAYS in
 * ₹Lakh, or VARIES per company. Same question for netDebt.
 *
 *   node scripts/audit-units.mjs
 */

import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1')
}
const host = env.RAPIDAPI_INDIAN_STOCK_HOST
const key = env.RAPIDAPI_INDIAN_STOCK_KEY

function num(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const c = v.replace(/[,₹$%\s]/g, '').trim()
    if (!c || c === '-') return null
    const n = parseFloat(c)
    return Number.isFinite(n) ? n : null
  }
  return null
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
  return null
}

/** Target tickers + the ground-truth reality check for each. */
const TARGETS = [
  {
    ticker: 'WAAREEENS',
    apiName: 'waaree energies',
    // Real market cap ~₹94,000 Cr, net-cash company (~₹500 Cr cash)
    plausibleMktCapCr: [60000, 130000],
    plausibleShareCount: [25, 35], // Cr shares
    expectNetCash: true,
  },
  {
    ticker: 'POLYCAB',
    apiName: 'polycab',
    plausibleMktCapCr: [80000, 150000],
    plausibleShareCount: [14, 17],
    expectNetCash: true,
  },
  {
    ticker: 'NTPC',
    apiName: 'ntpc',
    plausibleMktCapCr: [250000, 500000],
    plausibleShareCount: [900, 1100], // PSU with huge float
    expectNetCash: false,
  },
  {
    ticker: 'PREMIENRG',
    apiName: 'premier energies',
    plausibleMktCapCr: [30000, 70000],
    plausibleShareCount: [40, 50],
    expectNetCash: false,
  },
  {
    ticker: 'BORORENEW',
    apiName: 'borosil renewables',
    plausibleMktCapCr: [3000, 10000],
    plausibleShareCount: [12, 16],
    expectNetCash: false,
  },
  {
    ticker: 'KEI',
    apiName: 'kei industries',
    plausibleMktCapCr: [25000, 60000],
    plausibleShareCount: [9, 11],
    expectNetCash: true,
  },
  {
    ticker: 'BHEL',
    apiName: 'bhel',
    plausibleMktCapCr: [60000, 140000],
    plausibleShareCount: [340, 360],
    expectNetCash: false,
  },
]

console.log(`Probing ${TARGETS.length} tickers for unit consistency…\n`)

const report = []

for (const t of TARGETS) {
  const url = `https://${host}/stock?name=${encodeURIComponent(t.apiName)}`
  try {
    const res = await fetch(url, {
      headers: { 'x-rapidapi-host': host, 'x-rapidapi-key': key },
    })
    if (!res.ok) {
      report.push({ ticker: t.ticker, err: `HTTP ${res.status}` })
      continue
    }
    const json = await res.json()
    const km = json.keyMetrics || {}
    const rawMcap = lookup(km.priceandVolume, ['marketCap'])
    const rawPrice =
      num(json.currentPrice?.NSE) ?? num(json.currentPrice?.BSE)
    const netDebt = lookup(km.valuation, ['netDebtLFY', 'netDebtLFI'])
    const ebitdaPerShare = lookup(km.persharedata, [
      'eBITDPerShareTrailing12Month',
    ])
    const revenuePerShare = lookup(km.persharedata, [
      'rRevenuePerShareTrailing12onth',
    ])

    const impliedShares =
      rawMcap != null && rawPrice != null && rawPrice > 0
        ? rawMcap / rawPrice
        : null
    // If mktcap is in ₹Cr and shares in Cr, then shares × price should
    // equal mktcap (in ₹Cr). Cross-check impliedShares against a
    // plausible range for this ticker.
    const mcapInCr =
      impliedShares != null &&
      impliedShares >= t.plausibleShareCount[0] &&
      impliedShares <= t.plausibleShareCount[1]
    // Revenue = revenuePerShare × shares. Implied revenue should be
    // in the plausible Cr range for a company of this size.
    const impliedRevenue =
      revenuePerShare != null && impliedShares != null
        ? revenuePerShare * impliedShares
        : null
    const impliedEbitda =
      ebitdaPerShare != null && impliedShares != null
        ? ebitdaPerShare * impliedShares
        : null
    const netDebtPct =
      netDebt != null && rawMcap != null && rawMcap > 0
        ? (netDebt / rawMcap) * 100
        : null

    report.push({
      ticker: t.ticker,
      rawMcap,
      rawPrice,
      impliedShares,
      expectedShares: t.plausibleShareCount.join('–'),
      mcapInCr,
      netDebt,
      netDebtPctOfMcap: netDebtPct,
      expectNetCash: t.expectNetCash,
      impliedRevenue,
      impliedEbitda,
      ebitdaPerShare,
      revenuePerShare,
    })
  } catch (e) {
    report.push({ ticker: t.ticker, err: e.message })
  }
  // rate-limit spacing
  await new Promise((r) => setTimeout(r, 500))
}

console.log('────────────────────────────────────────────────────')
for (const r of report) {
  console.log(`\n${r.ticker}`)
  if (r.err) {
    console.log(`  ERROR: ${r.err}`)
    continue
  }
  console.log(`  rawMcap            ${r.rawMcap?.toFixed(2)}`)
  console.log(`  rawPrice           ₹${r.rawPrice}`)
  console.log(`  implied shares Cr  ${r.impliedShares?.toFixed(2)}  (expect ${r.expectedShares})`)
  console.log(`  mcap interpreted   ${r.mcapInCr ? '✓ ₹Cr' : '✗ NOT IN ₹Cr'}`)
  console.log(`  netDebt raw        ${r.netDebt?.toFixed(2)}  (${r.netDebtPctOfMcap?.toFixed(1)}% of mktcap)`)
  console.log(
    `  netDebt sanity     ${r.expectNetCash ? 'expected NEGATIVE (net cash)' : 'expected POSITIVE'} — ${r.netDebt == null ? 'n/a' : r.netDebt < 0 ? '-' : '+'}${Math.abs(r.netDebt ?? 0).toFixed(0)}`
  )
  console.log(`  revenue per share  ${r.revenuePerShare?.toFixed(2) ?? 'n/a'}`)
  console.log(`  implied revenue    ₹${r.impliedRevenue?.toFixed(0) ?? 'n/a'} Cr`)
  console.log(`  ebitda per share   ${r.ebitdaPerShare?.toFixed(2) ?? 'n/a'}`)
  console.log(`  implied ebitda     ₹${r.impliedEbitda?.toFixed(0) ?? 'n/a'} Cr`)
}

// ── Summary verdict ──
console.log('\n────────────────────────────────────────────────────')
console.log('VERDICT\n')
const mcapCrConsistent = report
  .filter((r) => !r.err)
  .every((r) => r.mcapInCr === true)
console.log(
  `marketCap unit — ${mcapCrConsistent ? '✓ consistently ₹Cr across all probes' : '✗ NOT consistent — see rows above'}`
)
const netDebtDrift = report
  .filter((r) => !r.err && r.netDebt != null)
  .map((r) => ({ ticker: r.ticker, pct: r.netDebtPctOfMcap, expectNc: r.expectNetCash }))
console.log(`\nnetDebt vs market cap (% of mcap):`)
for (const d of netDebtDrift) {
  console.log(`  ${d.ticker.padEnd(12)} ${d.pct?.toFixed(1)}%  (expected net-cash: ${d.expectNc})`)
}
