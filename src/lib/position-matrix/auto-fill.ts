import type { ChainNode } from '@/lib/data/chain'
import type { MatrixInputCell, MatrixInputs, MatrixTargetInput } from './types'

/**
 * Parse leading numeric out of CHAIN narrative strings.
 *   "$110B"      → 110          (USD bn)
 *   "~$4.8B"     → 4.8
 *   "$820M"      → 0.82         (converted to bn)
 *   "~$2.4B FY24-28" → 2.4
 *   "22%"        → 22
 *   "~28%"       → 28
 * Returns null if no number found.
 */
export function parseMoneyUsdBn(raw: string | undefined | null): number | null {
  if (!raw) return null
  const match = raw.match(/\$?\s*([\d.]+)\s*([BMK]?)/i)
  if (!match) return null
  const num = parseFloat(match[1])
  if (!Number.isFinite(num)) return null
  const unit = (match[2] || 'B').toUpperCase()
  if (unit === 'B') return num
  if (unit === 'M') return num / 1000
  if (unit === 'K') return num / 1_000_000
  return num
}

export function parsePercent(raw: string | undefined | null): number | null {
  if (!raw) return null
  const match = raw.match(/(-?[\d.]+)\s*%/)
  if (!match) return null
  const num = parseFloat(match[1])
  return Number.isFinite(num) ? num : null
}

/**
 * Sector default guidance — shown as opt-in "apply default" on manual inputs.
 * These are conservative heuristics. Users can override or leave blank.
 */
export function sectorDefault(
  key: 'competitive_intensity' | 'cyclicality' | 'moat_score' | 'management_quality' | 'customer_concentration' | 'market_share_rank',
  sec: string,
  chain: ChainNode | null,
  target: MatrixTargetInput,
): { value: number; rationale: string } | null {
  switch (key) {
    case 'competitive_intensity': {
      // Parse CHAIN.mkt.gc for concentration hints
      const gc = (chain?.mkt.gc || '').toLowerCase()
      if (/china\s*(8[5-9]|9\d|100)%/.test(gc)) return { value: 85, rationale: 'CHAIN notes >85% global concentration → high intensity' }
      if (/china\s*(7[0-9]|8[0-4])%/.test(gc)) return { value: 72, rationale: 'CHAIN notes 70–84% global concentration → elevated intensity' }
      if (/china\s*[5-6]\d%/.test(gc)) return { value: 60, rationale: 'CHAIN notes 50–69% global concentration' }
      if (/fragmented/.test(gc)) return { value: 55, rationale: 'CHAIN describes the segment as fragmented' }
      return { value: 55, rationale: 'Neutral default (no concentration signal in CHAIN)' }
    }
    case 'cyclicality': {
      if (sec === 'solar') return { value: 40, rationale: 'Solar value chain — moderate cyclicality, policy-driven' }
      if (sec === 'td') return { value: 50, rationale: 'T&D — CapEx-linked, moderate cyclicality' }
      return { value: 50, rationale: 'Neutral default — unknown sector' }
    }
    case 'moat_score': {
      // Use DealNector acqs score (0-10) as a moat proxy, scaled to 0-100
      if (target.acqsScore != null) {
        return {
          value: Math.round(target.acqsScore * 10),
          rationale: `Proxied from DealNector acquisition score (${target.acqsScore}/10 × 10)`,
        }
      }
      const moatTxt = (chain?.fin.moat || '').toLowerCase()
      if (/ip|patent|proprietary/.test(moatTxt)) return { value: 65, rationale: 'CHAIN flags IP/patent-based moat' }
      if (/scale/.test(moatTxt)) return { value: 55, rationale: 'CHAIN flags scale-based moat' }
      return { value: 50, rationale: 'Neutral default' }
    }
    case 'management_quality': {
      return { value: 60, rationale: 'Neutral default — edit to reflect diligence view' }
    }
    case 'customer_concentration': {
      // Larger companies tend to have diversified books. Weak proxy.
      if (target.mktcapCr > 50000) return { value: 30, rationale: 'Large cap — typically diversified customer base' }
      if (target.mktcapCr > 10000) return { value: 40, rationale: 'Mid cap — moderate diversification' }
      return { value: 55, rationale: 'Small/mid cap — tends toward concentration' }
    }
    case 'market_share_rank': {
      // Default to 3 if unknown (neutral). Real rank should come from ranking across peer set.
      return { value: 3, rationale: 'Neutral default — override with actual rank in domestic segment' }
    }
  }
}

/**
 * Derive the full set of matrix inputs for a target, using:
 *   - the target's own financials                (derived)
 *   - CHAIN[] narrative for its value-chain segment(s)  (chain)
 *   - peer-set averages for growth / margin delta       (derived)
 * Inputs that cannot be derived come back as `missing` — users can
 * override them via the manual input panel or apply a sector default.
 */
export function autoFillInputs(
  t: MatrixTargetInput,
  chainNodes: ChainNode[],              // CHAIN entries matched via t.comp[]
  peerAvgs: { revGrowthPct: number | null; ebitdaMarginPct: number | null; marketCapRank: number | null },
): MatrixInputs {
  // Aggregate CHAIN market narrative — take max where multiple segments match
  const cagrs = chainNodes.map(n => parsePercent(n.mkt.icagr)).filter((x): x is number => x !== null)
  const tams = chainNodes.map(n => parseMoneyUsdBn(n.mkt.gg)).filter((x): x is number => x !== null)
  const gcagrs = chainNodes.map(n => parsePercent(n.mkt.gcagr)).filter((x): x is number => x !== null)

  const cagr = cagrs.length ? Math.max(...cagrs) : null
  const tam = tams.length ? Math.max(...tams) : null
  const gcagr = gcagrs.length ? Math.max(...gcagrs) : null

  // Regulatory tailwind: each policy code = +15, cap at +90. No policy = 0 (neutral).
  const polCount = chainNodes.reduce((s, n) => s + (n.pol?.length || 0), 0)
    + (t.policyTailwindCount || 0)
  const regulatory: number | null = polCount > 0 ? Math.min(90, polCount * 15) : null

  // Peer deltas
  const revDelta = (t.revGrowthPct != null && peerAvgs.revGrowthPct != null)
    ? t.revGrowthPct - peerAvgs.revGrowthPct
    : null
  const ebmDelta = (t.ebitdaMarginPct != null && peerAvgs.ebitdaMarginPct != null)
    ? t.ebitdaMarginPct - peerAvgs.ebitdaMarginPct
    : null

  const chainSummary = chainNodes.map(n => n.name).join(' + ') || '—'

  const cell = (value: number | null, provenance: MatrixInputCell['provenance'], note?: string): MatrixInputCell =>
    value === null ? { value: null, provenance: 'missing', note } : { value, provenance, note }

  const inputs: MatrixInputs = {
    industry_cagr_3y: cell(cagr, 'chain', cagr !== null ? `CHAIN › ${chainSummary} › icagr` : 'CHAIN missing CAGR'),
    tam_usd_bn: cell(tam, 'chain', tam !== null ? `CHAIN › ${chainSummary} › gg` : 'CHAIN missing TAM'),
    tam_expansion_rate: cell(gcagr, 'chain', gcagr !== null ? `CHAIN › ${chainSummary} › gcagr` : 'CHAIN missing gcagr'),
    regulatory_tailwind: cell(regulatory, 'derived', regulatory !== null ? `${polCount} applicable policy code(s) → +${Math.min(90, polCount * 15)}` : 'No policy codes detected'),
    competitive_intensity: cell(null, 'manual', 'Manual — apply sector default or enter a view'),
    cyclicality: cell(null, 'manual', 'Manual — apply sector default or enter a view'),
    market_share_rank: cell(peerAvgs.marketCapRank, 'derived', peerAvgs.marketCapRank !== null ? `Rank by market cap within filtered peer set` : 'Insufficient peers to rank'),
    revenue_growth_vs_peer: cell(revDelta !== null ? Math.round(revDelta * 10) / 10 : null, 'derived', revDelta !== null ? `Δ vs peer-set avg (${peerAvgs.revGrowthPct!.toFixed(1)}%)` : 'Peer growth unavailable'),
    ebitda_margin_vs_peer: cell(ebmDelta !== null ? Math.round(ebmDelta * 10) / 10 : null, 'derived', ebmDelta !== null ? `Δ vs peer-set avg (${peerAvgs.ebitdaMarginPct!.toFixed(1)}%)` : 'Peer margin unavailable'),
    roic: cell(t.roce != null ? t.roce : null, 'derived', t.roce != null ? 'ROCE from company profile' : 'ROCE not available — enter manually'),
    moat_score: cell(null, 'manual', 'Manual — apply sector/CHAIN default or enter a view'),
    management_quality: cell(null, 'manual', 'Manual — reflect diligence view'),
    customer_concentration: cell(null, 'manual', 'Manual — apply size-based default or enter a view'),
  }

  // Apply any seed overrides passed in with the target
  if (t.overrides) {
    for (const k of Object.keys(t.overrides) as Array<keyof typeof t.overrides>) {
      const cellOverride = t.overrides[k]
      if (cellOverride) inputs[k as keyof MatrixInputs] = cellOverride
    }
  }

  return inputs
}

/**
 * Compute peer aggregates from a set of target inputs. Caller is
 * responsible for passing only peers (not the subject itself).
 */
export function computePeerAverages(peers: MatrixTargetInput[]): {
  revGrowthPct: number | null; ebitdaMarginPct: number | null
} {
  const growths = peers.map(p => p.revGrowthPct).filter((x): x is number => x != null && Number.isFinite(x))
  const margins = peers.map(p => p.ebitdaMarginPct).filter((x): x is number => x != null && Number.isFinite(x))
  return {
    revGrowthPct: growths.length ? growths.reduce((s, x) => s + x, 0) / growths.length : null,
    ebitdaMarginPct: margins.length ? margins.reduce((s, x) => s + x, 0) / margins.length : null,
  }
}

/** Rank market cap within a set — returns a ticker→rank map (1 = largest). */
export function rankByMarketCap(all: MatrixTargetInput[]): Map<string, number> {
  const sorted = [...all].sort((a, b) => (b.mktcapCr || 0) - (a.mktcapCr || 0))
  const map = new Map<string, number>()
  sorted.forEach((t, i) => map.set(t.ticker, i + 1))
  return map
}

/** Convert a `Company` shape (FSA) into a MatrixTargetInput. */
export function fromCompany(c: {
  ticker: string; name: string; sec: string; comp: string[]
  mktcap: number; rev: number; ebitda: number; ev: number
  ev_eb?: number | null; revg?: number | null; ebm?: number | null
  acqs?: number | null; roce?: number | null
}): MatrixTargetInput {
  return {
    ticker: c.ticker, name: c.name, sec: c.sec, comp: c.comp,
    mktcapCr: c.mktcap, revCr: c.rev, ebitdaCr: c.ebitda, evCr: c.ev,
    ev_ebitda: c.ev_eb != null && Number.isFinite(c.ev_eb) ? c.ev_eb : null,
    revGrowthPct: c.revg != null && Number.isFinite(c.revg) ? c.revg : null,
    ebitdaMarginPct: c.ebm != null && Number.isFinite(c.ebm) ? c.ebm : null,
    roce: c.roce ?? null,
    acqsScore: c.acqs ?? null,
  }
}
