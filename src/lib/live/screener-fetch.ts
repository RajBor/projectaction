/**
 * Shared Screener.in fetch + parse logic.
 *
 * Used by the admin scrape-screener route (full publish flow + ratios)
 * and the non-admin screener-fill route (gap-filling for Tier 2).
 */

export interface ScreenerRow {
  ticker: string
  nse: string
  name: string
  mktcapCr: number | null
  pricePer: number | null
  pe: number | null
  bookValue: number | null
  dividendYield: number | null
  roce: number | null
  roe: number | null
  faceValue: number | null
  salesCr: number | null
  netProfitCr: number | null
  opm: number | null
  ebitdaCr: number | null
  ebm: number | null
  evCr: number | null
  evEbitda: number | null
  dbtEq: number | null
  pbRatio: number | null
  totalAssetsCr: number | null
  totalLiabilitiesCr: number | null
  equityCr: number | null
  period: string
  fetchedAt: string
  source: 'screener.in'
}

export const SCREENER_CODE: Record<string, string> = {
  WAAREEENS: 'WAAREEENER',
  PREMIENRG: 'PREMIERENE',
  BORORENEW: 'BFRENEWABL',
  WEBELSOLAR: 'WESOLENRGY',
  STERLINWIL: 'SWSOLAR',
  CGPOWER: 'CGPOWER',
  VOLTAMP: 'VOLTAMP',
  HITACHIEN: 'POWERINDIA',
  GENUSPAPER: 'GENUSPOWER',
  ADANIENSOL: 'ADANIENSOL',
  GETANDEL: 'GEVERNOVA',
  STRTECH: 'STLTECH',
  HBLPOWER: 'HBLPOWER',
  INSOLATION: 'INSOLATION',
  KPIGREEN: 'KPIGREEN',
  SWELECTES: 'SWELECTES',
  HPL: 'HPLELECTRIC',
  UNIVCABLES: 'UNIVCABLES',
  INOXGREEN: 'INOXGREEN',
  INOXWIND: 'INOXWIND',
  RECLTD: 'RECLTD',
  IREDA: 'IREDA',
  TRITURBINE: 'TRITURBINE',
  BBL: 'BBL',
  KENNAMET: 'KENNAMET',
}

export function screenerCode(ticker: string, nse: string | null): string {
  return SCREENER_CODE[ticker] ?? nse ?? ticker
}

function parseNum(s: string | undefined): number | null {
  if (!s) return null
  const cleaned = s.replace(/[,₹%\s]/g, '').trim()
  if (!cleaned || cleaned === '-') return null
  const n = parseFloat(cleaned)
  return Number.isFinite(n) ? n : null
}

export function parseTopRatios(html: string): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  const block = html.match(/id="top-ratios"([\s\S]*?)(?:<\/ul>|<section)/)
  if (!block) return out
  const lis = block[1].split(/<li\b[^>]*>/)
  for (const li of lis) {
    const nameM = li.match(/<span class="name">\s*([\s\S]*?)<\/span>/)
    if (!nameM) continue
    const label = nameM[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
    const numM = li.match(/<span class="number">([\s\S]*?)<\/span>/)
    if (!numM) continue
    const value = parseNum(numM[1])
    if (label.includes('market cap')) out.mktcap = value
    else if (label.includes('current price')) out.price = value
    else if (label.includes('stock p/e') || label === 'p/e') out.pe = value
    else if (label.includes('book value')) out.bookValue = value
    else if (label.includes('dividend yield')) out.dividendYield = value
    else if (label.includes('roce')) out.roce = value
    else if (label.includes('roe')) out.roe = value
    else if (label.includes('face value')) out.faceValue = value
    else if (label.includes('debt') && !label.includes('/')) out.debt = value
  }
  return out
}

export function parseProfitLoss(html: string): Record<string, number | null> {
  const out: Record<string, number | null> = {}
  const plM = html.match(/id="profit-loss"[\s\S]*?<table[\s\S]*?<\/table>/)
  if (!plM) return out
  const rows = plM[0].match(/<tr[\s\S]*?<\/tr>/g) || []
  for (const row of rows) {
    const header = row.match(/<td[^>]*class="[^"]*text[^"]*"[^>]*>([\s\S]*?)<\/td>/)
    if (!header) continue
    const label = header[1].replace(/<[^>]+>/g, '').trim().toLowerCase()
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []
    const lastCell = cells[cells.length - 1]
    if (!lastCell) continue
    const val = parseNum(lastCell.replace(/<[^>]+>/g, '').trim())
    if (label.includes('sales') || label.includes('revenue')) out.sales = val
    if (label === 'opm %' || label.includes('opm')) out.opm = val
    if (label.includes('net profit') || label === 'profit after tax') out.netProfit = val
  }
  return out
}

export function parseBalanceSheet(
  html: string
): { totalAssetsCr: number | null; totalLiabilitiesCr: number | null; equityCr: number | null } {
  const out = { totalAssetsCr: null as number | null, totalLiabilitiesCr: null as number | null, equityCr: null as number | null }
  const bsM = html.match(/id="balance-sheet"[\s\S]*?<table[\s\S]*?<\/table>/)
  if (!bsM) return out
  const rows = bsM[0].match(/<tr[\s\S]*?<\/tr>/g) || []
  for (const row of rows) {
    const labelM = row.match(/<td[^>]*class="[^"]*text[^"]*"[^>]*>([\s\S]*?)<\/td>/)
    if (!labelM) continue
    const label = labelM[1].replace(/<[^>]+>/g, '').trim().toLowerCase()
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []
    const lastCell = cells[cells.length - 1]
    if (!lastCell) continue
    const val = parseNum(lastCell.replace(/<[^>]+>/g, '').trim())
    if (label.includes('total assets')) out.totalAssetsCr = val
    else if (label.includes('total liabilities')) out.totalLiabilitiesCr = val
    else if (label.includes('equity capital')) out.equityCr = val
  }
  return out
}

export function deriveScreenerRow(
  ticker: string,
  nse: string,
  name: string,
  raw: Record<string, number | null>,
  bs: ReturnType<typeof parseBalanceSheet>
): ScreenerRow {
  const mktcapCr = raw.mktcap ?? null
  const salesCr = raw.sales ?? null
  const opm = raw.opm ?? null
  const netProfitCr = raw.netProfit ?? null
  const ebitdaCr = salesCr != null && opm != null ? Math.round((salesCr * opm) / 100) : null
  const ebm = ebitdaCr != null && salesCr != null && salesCr > 0
    ? Math.round((ebitdaCr / salesCr) * 1000) / 10 : null
  const debt = raw.debt ?? null
  const evCr = mktcapCr != null ? mktcapCr + (debt ?? 0) : null
  const evEbitda = evCr != null && ebitdaCr != null && ebitdaCr > 0
    ? Math.round((evCr / ebitdaCr) * 10) / 10 : null
  const pbRatio = raw.price != null && raw.bookValue != null && raw.bookValue > 0
    ? Math.round((raw.price / raw.bookValue) * 100) / 100 : null
  const equity = pbRatio != null && mktcapCr != null && pbRatio > 0 ? mktcapCr / pbRatio : null
  const dbtEq = debt != null && equity != null && equity > 0
    ? Math.round((debt / equity) * 100) / 100 : null

  return {
    ticker, nse, name, mktcapCr,
    pricePer: raw.price ?? null,
    pe: raw.pe ?? null,
    bookValue: raw.bookValue ?? null,
    dividendYield: raw.dividendYield ?? null,
    roce: raw.roce ?? null,
    roe: raw.roe ?? null,
    faceValue: raw.faceValue ?? null,
    salesCr, netProfitCr, opm, ebitdaCr, ebm, evCr, evEbitda, dbtEq, pbRatio,
    totalAssetsCr: bs.totalAssetsCr,
    totalLiabilitiesCr: bs.totalLiabilitiesCr,
    equityCr: bs.equityCr,
    period: 'TTM / Latest Annual',
    fetchedAt: new Date().toISOString(),
    source: 'screener.in',
  }
}

export async function fetchOneScreener(
  ticker: string,
  code: string,
  name: string
): Promise<{ row: ScreenerRow | null; error?: string }> {
  const url = `https://www.screener.in/company/${code}/`
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html',
      },
    })
    if (!res.ok) return { row: null, error: `HTTP ${res.status}` }
    const html = await res.text()
    const topRatios = parseTopRatios(html)
    const pl = parseProfitLoss(html)
    const bs = parseBalanceSheet(html)
    const combined = { ...topRatios, ...pl }
    const row = deriveScreenerRow(ticker, code, name, combined, bs)
    return { row }
  } catch (err) {
    return { row: null, error: err instanceof Error ? err.message : 'fetch failed' }
  }
}
