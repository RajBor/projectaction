export interface NewsItem {
  id: string
  title: string
  summary: string
  source: string
  date: string
  category: 'Policy' | 'M&A' | 'Funding' | 'Operations' | 'Market'
  sentiment: 'positive' | 'negative' | 'neutral'
}

export async function getNews(): Promise<NewsItem[]> {
  return [
    {
      id: 'n1',
      title: 'MNRE extends PM-KUSUM deadline by 6 months',
      summary:
        'Ministry of New & Renewable Energy extends PM-KUSUM scheme deadline to March 2026, adding ₹12,000 Cr to the solar agriculture segment.',
      source: 'Economic Times',
      date: 'Today, 9:30 AM',
      category: 'Policy',
      sentiment: 'positive',
    },
    {
      id: 'n2',
      title: 'Adani Green secures 1500 MW hybrid project in Rajasthan',
      summary:
        'Adani Green Energy wins NTPC tender for 1500 MW wind-solar hybrid project in Rajasthan at ₹3.12/unit — lowest ever hybrid tariff.',
      source: 'Mint',
      date: 'Today, 7:15 AM',
      category: 'Market',
      sentiment: 'positive',
    },
    {
      id: 'n3',
      title: 'Waaree Energies eyes ₹3,000 Cr capacity expansion',
      summary:
        'Waaree Energies plans to raise ₹3,000 Cr via QIP to fund 5 GW additional module manufacturing capacity at Mundra, Gujarat.',
      source: 'Business Standard',
      date: 'Yesterday, 4:45 PM',
      category: 'Funding',
      sentiment: 'positive',
    },
    {
      id: 'n4',
      title: 'CERC approves revised grid code for storage integration',
      summary:
        'Central Electricity Regulatory Commission publishes revised grid code mandating storage integration guidelines effective Q3 FY26.',
      source: 'PV Magazine India',
      date: 'Yesterday, 2:00 PM',
      category: 'Policy',
      sentiment: 'neutral',
    },
    {
      id: 'n5',
      title: 'Greenko raises $500M green bond at 6.25%',
      summary:
        'Greenko Energy successfully prices $500M green bond — oversubscribed 4x. Proceeds for refinancing and project development.',
      source: 'Bloomberg',
      date: '2 days ago',
      category: 'Funding',
      sentiment: 'positive',
    },
    {
      id: 'n6',
      title: 'SECI faces land acquisition delays in MP solar park',
      summary:
        'Solar Energy Corporation of India reports 8-month delay in 2GW Rewa extension due to land acquisition hurdles, impacting tariff timelines.',
      source: 'Mercom India',
      date: '2 days ago',
      category: 'Operations',
      sentiment: 'negative',
    },
    {
      id: 'n7',
      title: 'CLP India acquires 300 MW wind portfolio from Inox',
      summary:
        'CLP India acquires 300 MW wind portfolio from Inox Wind for an enterprise value of ₹2,100 Cr — 7x EBITDA multiple.',
      source: 'Reuters',
      date: '3 days ago',
      category: 'M&A',
      sentiment: 'neutral',
    },
    {
      id: 'n8',
      title: 'India sets 500 GW renewable target for 2030',
      summary:
        'Government of India reaffirms 500 GW non-fossil fuel capacity target by 2030. MNRE to accelerate ISTS waiver extension to boost interstate solar trade.',
      source: 'The Hindu',
      date: '4 days ago',
      category: 'Policy',
      sentiment: 'positive',
    },
    {
      id: 'n9',
      title: 'IREDA NPA ratio improves to 0.81% in Q3 FY25',
      summary:
        'Indian Renewable Energy Development Agency reports NPA ratio declining to 0.81% for Q3 FY25, aided by improved collections and strong disbursement growth of 38% YoY.',
      source: 'Financial Express',
      date: '5 days ago',
      category: 'Market',
      sentiment: 'positive',
    },
  ]
}
