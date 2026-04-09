export interface KpiMetric {
  label: string
  value: string
  sub: string
  color: 'gold' | 'cyan' | 'green' | 'red' | 'orange' | 'purple'
  trend?: number
}

export interface DealStage {
  id: string
  name: string
  company: string
  ev: string
  status: 'Screening' | 'Diligence' | 'Negotiation' | 'LOI' | 'Closed'
  sector: string
  mw: string
  notes: string
}

export interface Company {
  id: string
  name: string
  ticker: string
  price: number
  change: number
  changePct: number
  sector: string
  marketCap: string
  score: number
}

export interface NewsItem {
  id: string
  title: string
  summary: string
  source: string
  date: string
  category: 'Policy' | 'M&A' | 'Funding' | 'Operations' | 'Market'
  sentiment: 'positive' | 'negative' | 'neutral'
}

export async function getDashboardKpis(): Promise<KpiMetric[]> {
  return [
    { label: 'Total AUM', value: '₹4,820Cr', sub: 'Across 12 deals', color: 'gold', trend: 8.4 },
    { label: 'Active Deals', value: '18', sub: '6 in final stage', color: 'cyan', trend: 2 },
    { label: 'Portfolio IRR', value: '22.4%', sub: 'Blended avg', color: 'green', trend: 1.2 },
    { label: 'Pipeline Value', value: '₹12,340Cr', sub: '34 companies tracked', color: 'purple', trend: 15 },
    { label: 'Closed FY25', value: '₹1,940Cr', sub: '7 transactions', color: 'orange', trend: 32 },
    { label: 'Watchlist', value: '47', sub: 'Companies monitored', color: 'cyan' },
  ]
}

export async function getRevenueChartData() {
  return [
    { month: 'Apr', revenue: 320, ebitda: 180, capex: 95 },
    { month: 'May', revenue: 380, ebitda: 210, capex: 110 },
    { month: 'Jun', revenue: 420, ebitda: 240, capex: 130 },
    { month: 'Jul', revenue: 390, ebitda: 225, capex: 120 },
    { month: 'Aug', revenue: 460, ebitda: 270, capex: 140 },
    { month: 'Sep', revenue: 510, ebitda: 295, capex: 155 },
    { month: 'Oct', revenue: 490, ebitda: 280, capex: 148 },
    { month: 'Nov', revenue: 540, ebitda: 315, capex: 162 },
    { month: 'Dec', revenue: 580, ebitda: 340, capex: 175 },
    { month: 'Jan', revenue: 620, ebitda: 365, capex: 188 },
    { month: 'Feb', revenue: 590, ebitda: 345, capex: 180 },
    { month: 'Mar', revenue: 680, ebitda: 402, capex: 205 },
  ]
}

export async function getSectorBreakdown() {
  return [
    { name: 'Solar IPP', value: 35, color: '#F7B731' },
    { name: 'Solar Mfg', value: 22, color: '#00B4D8' },
    { name: 'Wind', value: 18, color: '#10B981' },
    { name: 'T&D', value: 15, color: '#8B5CF6' },
    { name: 'Storage', value: 10, color: '#F59E0B' },
  ]
}

export async function getTopCompanies(): Promise<Company[]> {
  return [
    {
      id: '1',
      name: 'Adani Green Energy',
      ticker: 'ADANIGREEN',
      price: 1842.5,
      change: 24.3,
      changePct: 1.34,
      sector: 'Solar IPP',
      marketCap: '₹2.92L Cr',
      score: 9,
    },
    {
      id: '2',
      name: 'Tata Power',
      ticker: 'TATAPOWER',
      price: 418.75,
      change: -3.2,
      changePct: -0.76,
      sector: 'Integrated',
      marketCap: '₹1.34L Cr',
      score: 8,
    },
    {
      id: '3',
      name: 'SJVN Ltd',
      ticker: 'SJVN',
      price: 132.4,
      change: 2.85,
      changePct: 2.2,
      sector: 'Hydro + Solar',
      marketCap: '₹52,400Cr',
      score: 8,
    },
    {
      id: '4',
      name: 'Waaree Energies',
      ticker: 'WAAREEENER',
      price: 2940.0,
      change: 45.6,
      changePct: 1.58,
      sector: 'Solar Mfg',
      marketCap: '₹84,200Cr',
      score: 9,
    },
    {
      id: '5',
      name: 'Premier Energies',
      ticker: 'PREMIERENE',
      price: 1280.0,
      change: -12.4,
      changePct: -0.96,
      sector: 'Solar Mfg',
      marketCap: '₹36,800Cr',
      score: 7,
    },
    {
      id: '6',
      name: 'Greenko Energy',
      ticker: 'PRIVATE',
      price: 0,
      change: 0,
      changePct: 0,
      sector: 'Renewable IPP',
      marketCap: '$7.4B',
      score: 9,
    },
  ]
}

export async function getPipelineTrend() {
  return [
    { quarter: 'Q1 FY24', screening: 12, diligence: 6, loi: 2, closed: 1 },
    { quarter: 'Q2 FY24', screening: 15, diligence: 8, loi: 3, closed: 2 },
    { quarter: 'Q3 FY24', screening: 18, diligence: 10, loi: 4, closed: 2 },
    { quarter: 'Q4 FY24', screening: 22, diligence: 12, loi: 5, closed: 3 },
    { quarter: 'Q1 FY25', screening: 20, diligence: 14, loi: 6, closed: 3 },
    { quarter: 'Q2 FY25', screening: 25, diligence: 15, loi: 7, closed: 4 },
  ]
}
