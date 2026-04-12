/**
 * Pull TTM financials from RapidAPI for every tracked company and
 * print updated baseline rows for COMPANIES[]. The output is a
 * ready-to-paste TypeScript array that replaces the curated snapshot.
 *
 * Fields updated from live data:
 *   mktcap, rev (TTM), ebitda (TTM), pat (TTM), ev (derived),
 *   ev_eb (derived), pe (TTM), pb, dbt_eq
 *
 * Fields preserved from the editorial baseline:
 *   name, ticker, nse, sec, comp[], revg, ebm, acqs, acqf, rea
 *
 * Approach:
 *   - mktcap from keyMetrics.priceandVolume.marketCap (₹Cr confirmed)
 *   - revenue TTM = revenuePerShare × (mktcap / price)  [shares in Cr]
 *   - ebitda TTM = ebitdaPerShare × shares
 *   - pat TTM = epsExcludingExtraordinary × shares
 *   - ev = mktcap × (baseline_ev / baseline_mktcap) [unit-safe scaling]
 *   - ev_eb = ev / ebitda_ttm
 *   - pe from keyMetrics.valuation (direct)
 *   - pb from keyMetrics.valuation (direct)
 *   - ebm = ebitda_ttm / revenue_ttm × 100
 *   - revg: keep editorial (we don't have prior-year TTM to compute YoY)
 *   - dbt_eq from keyMetrics.financialstrength (direct)
 *
 *   node scripts/update-baselines.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1')
}
const host = env.RAPIDAPI_INDIAN_STOCK_HOST
const key = env.RAPIDAPI_INDIAN_STOCK_KEY

// ── helpers ──
function num(v) {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const c = v.replace(/[,₹$%\s]/g, '').trim()
    if (!c || c === '-' || c.toLowerCase() === 'n/a') return null
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

// ── Parse existing COMPANIES[] ──
const src = readFileSync('src/lib/data/companies.ts', 'utf8')
// Parse NAME_OVERRIDES from api.ts
const apiSrc = readFileSync('src/lib/stocks/api.ts', 'utf8')
const overridesMatch = apiSrc.match(/const NAME_OVERRIDES[^{]*\{([\s\S]*?)\n\}/)
const OVERRIDES = {}
if (overridesMatch) {
  for (const line of overridesMatch[1].split('\n')) {
    const m = line.match(/^\s*([A-Z0-9]+):\s*'([^']+)'/)
    if (m) OVERRIDES[m[1]] = m[2]
  }
}
const apiName = (ticker, name) =>
  OVERRIDES[ticker] || name.split(' ')[0].toLowerCase()

// Extract every company row
const companies = []
const rowRe = /\{name:"([^"]+)",ticker:"([^"]+)",nse:("?[^,"]*"?),sec:"([^"]+)",comp:(\[[^\]]*\]),mktcap:(\d+),rev:(\d+),ebitda:(\d+),pat:(\d+),ev:(\d+),ev_eb:([\d.]+),pe:([\d.]+),pb:([\d.]+),dbt_eq:([\d.]+),revg:([\d.]+),ebm:([\d.]+),acqs:(\d+),acqf:"([^"]+)",rea:"([^"]+)"\}/g
let rm
while ((rm = rowRe.exec(src))) {
  companies.push({
    name: rm[1], ticker: rm[2], nse: rm[3], sec: rm[4], comp: rm[5],
    mktcap: +rm[6], rev: +rm[7], ebitda: +rm[8], pat: +rm[9],
    ev: +rm[10], ev_eb: +rm[11], pe: +rm[12], pb: +rm[13],
    dbt_eq: +rm[14], revg: +rm[15], ebm: +rm[16],
    acqs: +rm[17], acqf: rm[18], rea: rm[19],
  })
}
console.log(`Parsed ${companies.length} companies from baseline.\n`)

// ── Fetch + update ──
const BATCH = 6
let updated = 0
let failed = 0
let quotaHit = false

for (let i = 0; i < companies.length && !quotaHit; i += BATCH) {
  const batch = companies.slice(i, i + BATCH)
  await Promise.all(batch.map(async (co) => {
    if (quotaHit) return
    const name = apiName(co.ticker, co.name)
    try {
      const res = await fetch(
        `https://${host}/stock?name=${encodeURIComponent(name)}`,
        { headers: { 'x-rapidapi-host': host, 'x-rapidapi-key': key } }
      )
      if (res.status === 429) {
        quotaHit = true
        console.error(`QUOTA HIT at ${co.ticker} — stopping`)
        return
      }
      if (!res.ok) {
        console.error(`  ${co.ticker}: HTTP ${res.status}`)
        failed++
        return
      }
      const json = await res.json()
      const km = json.keyMetrics || {}

      const liveMcap = lookup(km.priceandVolume, ['marketCap'])
      const price = num(json.currentPrice?.NSE) ?? num(json.currentPrice?.BSE)
      if (!liveMcap || !price || price <= 0) {
        console.error(`  ${co.ticker}: no mktcap/price`)
        failed++
        return
      }
      const sharesCr = liveMcap / price

      // TTM revenue
      const revPerShare = lookup(km.persharedata, [
        'rRevenuePerShareTrailing12onth',
        'revenuePerShareTrailing12Month',
      ])
      const ttmRev = revPerShare != null ? Math.round(revPerShare * sharesCr) : null

      // TTM EBITDA
      const ebPerShare = lookup(km.persharedata, [
        'eBITDPerShareTrailing12Month',
      ])
      const ttmEbitda = ebPerShare != null ? Math.round(ebPerShare * sharesCr) : null

      // TTM PAT (EPS × shares)
      const epsExcl = lookup(km.persharedata, [
        'eEPSExcludingExtraordinaryIitemsTrailing12onth',
        'ePSIncludingExtraOrdinaryItemsTrailing12Month',
        'ePSBasicExcludingExtraordinaryItemsItrailing12Month',
      ])
      const ttmPat = epsExcl != null ? Math.round(epsExcl * sharesCr) : null

      // EV — unit-safe scaling from baseline ratio
      const evRatio = co.mktcap > 0 ? co.ev / co.mktcap : 1
      const liveEv = Math.round(liveMcap * evRatio)

      // EV/EBITDA
      const liveEvEb = ttmEbitda && ttmEbitda > 0
        ? Math.round((liveEv / ttmEbitda) * 10) / 10
        : co.ev_eb

      // P/E
      const livePe = lookup(km.valuation, [
        'pPerEBasicExcludingExtraordinaryItemsTTM',
        'pPerEIncludingExtraordinaryItemsTTM',
        'pPerEExcludingExtraordinaryItemsMostRecentFiscalYear',
      ])

      // P/B
      const livePb = lookup(km.valuation, [
        'priceToBookMostRecentFiscalYear',
        'priceToBookMostRecentQuarter',
      ])

      // D/E
      const liveDe = lookup(km.financialstrength, [
        'totalDebtPerTotalEquityMostRecentFiscalYear',
        'totalDebtPerTotalEquityMostRecentQuarter',
      ])

      // EBITDA margin
      const liveEbm = ttmRev && ttmEbitda
        ? Math.round((ttmEbitda / ttmRev) * 1000) / 10
        : co.ebm

      // Apply
      co.mktcap = Math.round(liveMcap)
      if (ttmRev != null && ttmRev > 0) co.rev = ttmRev
      if (ttmEbitda != null && ttmEbitda > 0) co.ebitda = ttmEbitda
      if (ttmPat != null) co.pat = ttmPat
      co.ev = liveEv
      co.ev_eb = liveEvEb
      if (livePe != null && livePe > 0 && livePe < 500) co.pe = Math.round(livePe * 10) / 10
      if (livePb != null && livePb > 0) co.pb = Math.round(livePb * 100) / 100
      if (liveDe != null && liveDe >= 0) co.dbt_eq = Math.round(liveDe * 100) / 100
      co.ebm = liveEbm

      updated++
      process.stdout.write(`  ${updated}/${companies.length} ${co.ticker}\r`)
    } catch (e) {
      console.error(`  ${co.ticker}: ${e.message}`)
      failed++
    }
  }))
}

console.log(`\nUpdated: ${updated}  Failed: ${failed}  Quota: ${quotaHit}\n`)

// ── Write output ──
const lines = companies.map((co) => {
  return `  {name:"${co.name}",ticker:"${co.ticker}",nse:${co.nse},sec:"${co.sec}",comp:${co.comp},mktcap:${co.mktcap},rev:${co.rev},ebitda:${co.ebitda},pat:${co.pat},ev:${co.ev},ev_eb:${co.ev_eb},pe:${co.pe},pb:${co.pb},dbt_eq:${co.dbt_eq},revg:${co.revg},ebm:${co.ebm},acqs:${co.acqs},acqf:"${co.acqf}",rea:"${co.rea}"},`
})

// Read the original file and replace just the array body
const header = src.slice(0, src.indexOf('export const COMPANIES'))
const arrayStart = 'export const COMPANIES: Company[] = [\n'
const footer = '\n]\n'
const output = header + arrayStart + lines.join('\n') + footer
writeFileSync('src/lib/data/companies.ts', output, 'utf8')
console.log(`Written ${companies.length} rows to src/lib/data/companies.ts`)

// Quick spot-check
const waaree = companies.find((c) => c.ticker === 'WAAREEENS')
if (waaree) {
  console.log(`\nWaaree Energies spot-check:`)
  console.log(`  mktcap: ₹${waaree.mktcap.toLocaleString('en-IN')} Cr`)
  console.log(`  rev:    ₹${waaree.rev.toLocaleString('en-IN')} Cr`)
  console.log(`  ebitda: ₹${waaree.ebitda.toLocaleString('en-IN')} Cr`)
  console.log(`  ev:     ₹${waaree.ev.toLocaleString('en-IN')} Cr`)
  console.log(`  ev_eb:  ${waaree.ev_eb}×`)
  console.log(`  pe:     ${waaree.pe}×`)
  console.log(`  ebm:    ${waaree.ebm}%`)
}
