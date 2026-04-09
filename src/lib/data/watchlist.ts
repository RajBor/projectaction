export interface WatchlistItem {
  id: string
  company: string
  ticker: string
  sector: string
  score: number
  rationale: string
  targetEV: string
  currentStatus: string
  addedOn: string
  starred: boolean
}

export async function getWatchlist(): Promise<WatchlistItem[]> {
  return [
    {
      id: 'w1',
      company: 'NTPC Renewable Energy',
      ticker: 'NTPCGREEN',
      sector: 'Solar + Wind IPP',
      score: 9,
      rationale:
        'Strong sovereign backing, 50 GW target by 2032, PSU premium valuation justified given lower cost of capital and AAA-rated balance sheet.',
      targetEV: '₹8,000Cr',
      currentStatus: 'Monitoring',
      addedOn: '15 Feb 2025',
      starred: true,
    },
    {
      id: 'w2',
      company: 'Avaada Energy',
      ticker: 'PRIVATE',
      sector: 'Solar IPP',
      score: 8,
      rationale:
        'Fastest growing pure-play solar IPP, IPO expected FY26, strong PPA book covering 8 GW contracted capacity across multiple states.',
      targetEV: '₹4,200Cr',
      currentStatus: 'Pre-IPO Watch',
      addedOn: '2 Mar 2025',
      starred: true,
    },
    {
      id: 'w3',
      company: 'Solarika Tech',
      ticker: 'PRIVATE',
      sector: 'Solar Mfg',
      score: 7,
      rationale:
        'Emerging TOPCon player, cost structure competitive with Tier-1 Chinese peers. Strong domestic demand via PM-KUSUM and rooftop segment.',
      targetEV: '₹680Cr',
      currentStatus: 'Deep Dive',
      addedOn: '10 Mar 2025',
      starred: false,
    },
    {
      id: 'w4',
      company: 'Sterlite Power Grid',
      ticker: 'PRIVATE',
      sector: 'T&D',
      score: 8,
      rationale:
        'InvIT monetization play with strong TBCB pipeline worth ₹18,000 Cr. Key beneficiary of green energy corridor expansion.',
      targetEV: '₹6,500Cr',
      currentStatus: 'Monitoring',
      addedOn: '1 Apr 2025',
      starred: false,
    },
    {
      id: 'w5',
      company: 'Edelweiss Green Infra',
      ticker: 'PRIVATE',
      sector: 'Green Infrastructure',
      score: 7,
      rationale:
        'InvIT structure with 800 MW operational assets. Attractive yield play at 8–9% distribution yield. Watching regulatory overhang.',
      targetEV: '₹2,800Cr',
      currentStatus: 'Monitoring',
      addedOn: '20 Mar 2025',
      starred: false,
    },
    {
      id: 'w6',
      company: 'ReNew Power',
      ticker: 'PRIVATE',
      sector: 'Renewable IPP',
      score: 9,
      rationale:
        'Market leader in India IPP space with 13+ GW operational and contracted. Potential re-listing post delisting from Nasdaq — strong secondary buyout candidate.',
      targetEV: '₹18,000Cr',
      currentStatus: 'Strategic Watch',
      addedOn: '5 Jan 2025',
      starred: true,
    },
  ]
}
