export interface ValuationRow {
  company: string
  ticker: string
  sector: string
  ev: string
  evEbitda: number
  peRatio: number
  pbRatio: number
  roic: number
  debtEquity: number
  score: number
  recommendation: 'Strong Buy' | 'Buy' | 'Hold' | 'Sell'
}

export async function getValuationMatrix(): Promise<ValuationRow[]> {
  return [
    {
      company: 'Adani Green',
      ticker: 'ADANIGREEN',
      sector: 'Solar IPP',
      ev: '₹2.98L Cr',
      evEbitda: 42.3,
      peRatio: 94.2,
      pbRatio: 12.4,
      roic: 8.2,
      debtEquity: 4.8,
      score: 9,
      recommendation: 'Buy',
    },
    {
      company: 'Tata Power',
      ticker: 'TATAPOWER',
      sector: 'Integrated',
      ev: '₹1.42L Cr',
      evEbitda: 18.6,
      peRatio: 38.4,
      pbRatio: 4.1,
      roic: 11.4,
      debtEquity: 2.1,
      score: 8,
      recommendation: 'Strong Buy',
    },
    {
      company: 'SJVN',
      ticker: 'SJVN',
      sector: 'Hydro + Solar',
      ev: '₹54,200Cr',
      evEbitda: 22.1,
      peRatio: 29.8,
      pbRatio: 3.8,
      roic: 13.2,
      debtEquity: 1.4,
      score: 8,
      recommendation: 'Buy',
    },
    {
      company: 'Waaree Energies',
      ticker: 'WAAREEENER',
      sector: 'Solar Mfg',
      ev: '₹86,000Cr',
      evEbitda: 35.8,
      peRatio: 52.4,
      pbRatio: 8.6,
      roic: 18.4,
      debtEquity: 0.8,
      score: 9,
      recommendation: 'Buy',
    },
    {
      company: 'Premier Energies',
      ticker: 'PREMIERENE',
      sector: 'Solar Mfg',
      ev: '₹38,200Cr',
      evEbitda: 28.4,
      peRatio: 44.2,
      pbRatio: 6.2,
      roic: 15.8,
      debtEquity: 1.2,
      score: 7,
      recommendation: 'Hold',
    },
    {
      company: 'IREDA',
      ticker: 'IREDA',
      sector: 'Green Finance',
      ev: '₹48,600Cr',
      evEbitda: 24.2,
      peRatio: 32.6,
      pbRatio: 5.1,
      roic: 12.8,
      debtEquity: 5.2,
      score: 8,
      recommendation: 'Buy',
    },
    {
      company: 'CESC Renewables',
      ticker: 'CESC',
      sector: 'Integrated',
      ev: '₹12,400Cr',
      evEbitda: 14.2,
      peRatio: 22.8,
      pbRatio: 2.4,
      roic: 9.6,
      debtEquity: 1.8,
      score: 7,
      recommendation: 'Hold',
    },
    {
      company: 'Torrent Power',
      ticker: 'TORNTPOWER',
      sector: 'Integrated',
      ev: '₹64,800Cr',
      evEbitda: 16.4,
      peRatio: 31.2,
      pbRatio: 4.8,
      roic: 14.2,
      debtEquity: 1.1,
      score: 8,
      recommendation: 'Strong Buy',
    },
  ]
}
