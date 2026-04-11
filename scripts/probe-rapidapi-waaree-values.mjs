import { readFileSync } from 'node:fs'

const env = {}
for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1')
}

const host = env.RAPIDAPI_INDIAN_STOCK_HOST
const key = env.RAPIDAPI_INDIAN_STOCK_KEY

const url = `https://${host}/stock?name=${encodeURIComponent('waaree energies')}`
const res = await fetch(url, {
  headers: { 'x-rapidapi-host': host, 'x-rapidapi-key': key },
})
const json = await res.json()

const dump = (label, arr) => {
  if (!arr || typeof arr !== 'object') return
  console.log(`\n── ${label} ──`)
  for (const v of Object.values(arr)) {
    if (v && typeof v === 'object' && 'key' in v) {
      console.log(`  ${v.key}  →  ${v.value}`)
    }
  }
}

dump('keyMetrics.valuation', json.keyMetrics?.valuation)
dump('keyMetrics.margins', json.keyMetrics?.margins)
dump('keyMetrics.priceandVolume', json.keyMetrics?.priceandVolume)
dump('keyMetrics.financialstrength', json.keyMetrics?.financialstrength)
dump('keyMetrics.persharedata', json.keyMetrics?.persharedata)
