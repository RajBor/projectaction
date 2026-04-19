/**
 * News channels — the industry/topic buckets exposed to the mobile
 * companion app (and, later, a refactored web news hub).
 *
 * Each channel maps a user-facing label to a Google News RSS search
 * query. The mobile endpoint fetches the selected channels in parallel,
 * merges + dedupes the results, and ships a flat flip-card schema.
 *
 * Order matters — this is the order chips render in the industry picker.
 */
export interface NewsChannel {
  id: string
  label: string
  /** Short tagline shown under the chip in the picker. */
  tagline: string
  /** Google News RSS search query (use OR / quoted phrases). */
  query: string
  /** Accent colour for UI chrome (RN compatible hex). */
  color: string
}

export const NEWS_CHANNELS: NewsChannel[] = [
  {
    id: 'solar',
    label: 'Solar Value Chain',
    tagline: 'Modules, cells, wafers, polysilicon, ALMM, TOPCon, bifacial',
    query: '(solar OR photovoltaic OR "PV module" OR polysilicon OR TOPCon OR ALMM OR "solar cell") India',
    color: '#d4a43b',
  },
  {
    id: 'pv',
    label: 'PV Manufacturing',
    tagline: 'Cell + module manufacturing, HJT, PERC, bifacial, efficiency',
    query: '("PV module" OR "solar cell" OR TOPCon OR HJT OR PERC OR bifacial OR "heterojunction") manufacturing',
    color: '#f59e0b',
  },
  {
    id: 'td',
    label: 'T&D Infrastructure',
    tagline: 'Transmission, distribution, transformers, smart meters, HVDC',
    query: '(transmission OR distribution OR transformer OR "smart meter" OR HVDC OR switchgear OR discom) India',
    color: '#1e5aa8',
  },
  {
    id: 'wind',
    label: 'Wind Energy',
    tagline: 'Turbines, blades, towers, offshore, repowering',
    query: '(wind OR turbine OR "wind energy" OR offshore OR "wind farm" OR repowering) India',
    color: '#0e7490',
  },
  {
    id: 'ev',
    label: 'EV & Battery Storage',
    tagline: 'Electric vehicles, BESS, lithium-ion, charging infra',
    query: '("electric vehicle" OR EV OR battery OR BESS OR "lithium-ion" OR "charging station") India',
    color: '#166534',
  },
  {
    id: 'ma',
    label: 'M&A & Investment',
    tagline: 'Acquisitions, PE deals, strategic stakes, IPOs',
    query: '(acquisition OR merger OR "private equity" OR IPO OR "strategic stake") (solar OR renewable OR "power sector") India',
    color: '#a47a28',
  },
  {
    id: 'policy',
    label: 'Policy & Regulation',
    tagline: 'PLI, ALMM, RDSS, MNRE, BCD, PM Surya Ghar',
    query: '("PLI scheme" OR ALMM OR RDSS OR MNRE OR SECI OR "basic customs duty" OR "PM Surya Ghar")',
    color: '#7c3aed',
  },
  {
    id: 'market',
    label: 'Market & Tenders',
    tagline: 'SECI auctions, state tenders, PPA, capacity adds',
    query: '("SECI tender" OR "solar auction" OR PPA OR "capacity addition" OR "reverse auction") India',
    color: '#0e7490',
  },
  {
    id: 'financial',
    label: 'Financial Results',
    tagline: 'Quarterly earnings, order book, capex, management commentary',
    query: '("quarterly results" OR earnings OR "order book" OR capex) (solar OR power OR renewable) India',
    color: '#be185d',
  },
  {
    id: 'supply',
    label: 'Supply Chain',
    tagline: 'Polysilicon price, wafer supply, raw materials, trade flows',
    query: '(polysilicon OR wafer OR "silver paste" OR "EVA encapsulant" OR "solar glass" OR "supply chain") India',
    color: '#991b1b',
  },
]

export const NEWS_CHANNEL_BY_ID: Record<string, NewsChannel> = Object.fromEntries(
  NEWS_CHANNELS.map((c) => [c.id, c])
)

/** Flat schema shipped to the mobile app — one card per news item. */
export interface NewsFlipCard {
  id: string
  title: string
  /** Short summary — first 280 characters of the RSS description, HTML stripped. */
  summary: string
  /** Original publisher (e.g. "Reuters", "Mint", "Moneycontrol"). */
  source: string
  /** URL to open in the external browser. */
  sourceUrl: string
  /** ISO timestamp. */
  publishedAt: string
  /** Channel ids that matched this card. */
  channels: string[]
  /** Optional thumbnail URL if the feed item carried a media enclosure. */
  imageUrl?: string
}
