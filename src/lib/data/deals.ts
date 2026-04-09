export interface Deal {
  id: string
  company: string
  sector: string
  ev: string
  equity: string
  mw: string
  stage: 'Screening' | 'Diligence' | 'Negotiation' | 'LOI' | 'Closed'
  analyst: string
  priority: 'High' | 'Medium' | 'Low'
  score: number
  notes: string
  updatedAt: string
}

export async function getDeals(): Promise<Deal[]> {
  return [
    {
      id: 'd1',
      company: 'SunPrime Power',
      sector: 'Solar IPP',
      ev: '₹840Cr',
      equity: '₹320Cr',
      mw: '200 MW',
      stage: 'LOI',
      analyst: 'Raj',
      priority: 'High',
      score: 9,
      notes: 'Final negotiation on equity dilution',
      updatedAt: '2 days ago',
    },
    {
      id: 'd2',
      company: 'VayuShakti Energy',
      sector: 'Wind',
      ev: '₹1,240Cr',
      equity: '₹480Cr',
      mw: '300 MW',
      stage: 'Diligence',
      analyst: 'Priya',
      priority: 'High',
      score: 8,
      notes: 'Grid connectivity audit pending',
      updatedAt: '1 day ago',
    },
    {
      id: 'd3',
      company: 'Helios Solar Mfg',
      sector: 'Solar Mfg',
      ev: '₹560Cr',
      equity: '₹200Cr',
      mw: '500 MW capacity',
      stage: 'Screening',
      analyst: 'Arun',
      priority: 'Medium',
      score: 7,
      notes: 'Module efficiency benchmarking',
      updatedAt: '3 days ago',
    },
    {
      id: 'd4',
      company: 'GreenGrid Infra',
      sector: 'T&D',
      ev: '₹2,100Cr',
      equity: '₹840Cr',
      mw: 'N/A',
      stage: 'Negotiation',
      analyst: 'Raj',
      priority: 'High',
      score: 8,
      notes: 'CERC approval timeline critical',
      updatedAt: '5 hours ago',
    },
    {
      id: 'd5',
      company: 'StoreSol Tech',
      sector: 'Storage',
      ev: '₹380Cr',
      equity: '₹140Cr',
      mw: '50 MWh',
      stage: 'Screening',
      analyst: 'Meera',
      priority: 'Low',
      score: 6,
      notes: 'Battery chemistry validation',
      updatedAt: '1 week ago',
    },
    {
      id: 'd6',
      company: 'AquaSun Hybrid',
      sector: 'Hybrid',
      ev: '₹1,680Cr',
      equity: '₹620Cr',
      mw: '400 MW',
      stage: 'Closed',
      analyst: 'Raj',
      priority: 'High',
      score: 9,
      notes: 'Deal closed. Integration ongoing.',
      updatedAt: 'Yesterday',
    },
    {
      id: 'd7',
      company: 'Renewco IPP',
      sector: 'Solar IPP',
      ev: '₹920Cr',
      equity: '₹360Cr',
      mw: '250 MW',
      stage: 'Diligence',
      analyst: 'Priya',
      priority: 'Medium',
      score: 7,
      notes: 'Land title clearance in progress',
      updatedAt: '4 days ago',
    },
    {
      id: 'd8',
      company: 'PowerBridge T&D',
      sector: 'T&D',
      ev: '₹3,400Cr',
      equity: '₹1,200Cr',
      mw: 'N/A',
      stage: 'Screening',
      analyst: 'Arun',
      priority: 'High',
      score: 8,
      notes: 'State utility partnership model',
      updatedAt: '2 days ago',
    },
  ]
}
