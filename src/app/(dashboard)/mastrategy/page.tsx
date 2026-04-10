'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'

// ── Sherman Framework Data ──

interface ShermanLevel {
  num: string
  id: string
  title: string
  value: string
  valueColor: string
  desc: string
  pwc: string
  questions: string[]
  solarContext: string
  checklist: string[]
}

const SHERMAN_ALGORITHM: ShermanLevel[] = [
  {
    num: '01',
    id: 'objectives',
    title: 'Strategic Objective Definition',
    value: 'Foundation — highest leverage',
    valueColor: 'var(--green)',
    desc: 'Define Why/What/Where/Who before any capital is committed. Unanswered objectives account for most post-closing regret.',
    pwc: 'Access to new markets: 76% · Market share growth: 74%',
    questions: [
      'Why are we doing this acquisition?',
      'Does buy outperform build for this capability?',
      'Will this improve our competitive position in India solar/T&D?',
      'Will this enhance shareholder value?',
      'Have we identified all key value drivers?',
    ],
    solarContext:
      'In the India solar value chain, strategic objectives commonly include: ALMM compliance readiness (domestic cell/module supply), PLI capacity capture, BCD-protected domestic manufacturing, and RDSS smart meter rollout positioning.',
    checklist: [
      'Define primary acquisition rationale (scale/tech/market/talent)',
      'Map to specific India policy tailwinds (PLI, RDSS, ALMM)',
      'Confirm acquisition vs JV vs organic build decision',
      'Quantify minimum acceptable synergy threshold',
      'Set walk-away price before opening negotiations',
    ],
  },
  {
    num: '02',
    id: 'eotb',
    title: 'EOTB Analysis (Eyes of the Buyer)',
    value: 'Validates the premise, finds premium drivers',
    valueColor: 'var(--cyan2)',
    desc: 'No-holds-barred analysis of what buyers actually see when the due diligence veil is removed. Eliminates "Emperor\'s New Clothes" deal-making.',
    pwc: 'Nearly 50% of sellers failed to maximize value — KPMG 2007',
    questions: [
      'How does this acquisition solve a specific problem for us?',
      'What cross-selling opportunities flow in both directions?',
      'What management gaps do their people fill for us?',
      'What value do we add that they cannot generate alone?',
      'Where are the imported and exported synergy channels?',
    ],
    solarContext:
      'In solar module M&A: the buyer typically sees TOPCon cell technology gaps, silver paste supply concentration risk, and ALMM-listed status as the core value levers. In T&D: transformer capacity utilization rates and RDSS tender pipeline are the premium drivers.',
    checklist: [
      'Conduct internal EOTB session with no sacred cows',
      'Map how target strengthens your core capabilities',
      'Identify cross-selling between buyer and seller customer bases',
      'Quantify management depth target adds to buyer team',
      'List all value leakage points that suppress fair price',
    ],
  },
  {
    num: '03',
    id: 'screening',
    title: 'Target Screening & Criteria Application',
    value: 'Eliminates wrong deals before capital is spent',
    valueColor: 'var(--gold2)',
    desc: 'Develop rigorous acquisition criteria. Apply them consistently. The goal is to filter out deals you will regret — not to find reasons to proceed.',
    pwc: 'Sherman: "Be careful not to overlook too many warts"',
    questions: [
      'Does this target meet minimum revenue/EBITDA thresholds?',
      'Is there a history of stable performance across market cycles?',
      'Does management agree to remain post-closing?',
      'Are there regulatory/antitrust hurdles?',
      'Is the target a market leader in its niche?',
    ],
    solarContext:
      'India solar screening criteria: ALMM-listed status, BIS certification track record, PLI allocation or eligibility, SECI tender participation history, promoter holding stability, and absence of NCLT/insolvency proceedings.',
    checklist: [
      'Set minimum EBITDA floor and maximum EV/EBITDA ceiling',
      'Verify target has no pending SEBI/CCI regulatory issues',
      'Confirm management retention feasibility',
      'Screen for customer concentration >30% single buyer',
      'Check for existing PE/strategic investor locked-in positions',
    ],
  },
  {
    num: '04',
    id: 'valuedrivers',
    title: '7 Value Driver Assessment',
    value: 'Determines the achievable multiple',
    valueColor: 'var(--purple)',
    desc: 'Sherman regression analysis: the #1 determinant of deal multiples is revenue growth rate. Systematically score all seven drivers to predict the achievable multiple range.',
    pwc: 'Higher growth rate → higher multiple of cash flow — direct correlation',
    questions: [
      'What is the 3-year revenue CAGR?',
      "What is the target's market share in its segment?",
      'What barriers prevent new competitors from entering?',
      'How deep and stable is the management bench?',
      'How stable and growing is the free cash flow?',
    ],
    solarContext:
      "In India's solar manufacturing sector, barriers to entry (BCD of 40% on modules, 25% on cells, ALMM listing requirements) and PLI allocation create significant moat value. RDSS scheme creates recurring revenue visibility for smart meter players.",
    checklist: [
      'Score all 7 drivers on 1–10 scale',
      'Weight growth rate highest in multiple derivation',
      'Assess customer concentration risk (flag if >30%)',
      'Evaluate tech obsolescence horizon (P-type vs N-type)',
      'Document management succession plan quality',
    ],
  },
  {
    num: '05',
    id: 'valuation',
    title: 'Three-Method Triangulated Valuation',
    value: 'Anchors price range before negotiation',
    valueColor: 'var(--orange)',
    desc: 'No single method is definitive. All three must converge before proceeding. The actual price is always what the market is willing to pay — valuation gives a credible range.',
    pwc: 'Fair market value = what a willing buyer pays a willing seller under no compulsion',
    questions: [
      'What are the comparable transaction multiples in this sector?',
      'What is the DCF value at conservative/base/optimistic growth?',
      'What is the replacement cost of key assets?',
      'What is the private-company discount (20–50%)?',
      'How does strategic value exceed stand-alone fair market value?',
    ],
    solarContext:
      'India solar/T&D sector comparable multiples: Power transformers trade at 8–14× EV/EBITDA; Smart meters 15–22×; Solar modules 6–10×; PV glass 10–14×. DCF WACC should use 12–14% for India mid-cap energy sector.',
    checklist: [
      'Run DCF with 3 scenarios (bear/base/bull)',
      'Pull 5+ comparable transactions from Indian market',
      'Conduct asset replacement cost analysis',
      'Apply 20–30% private company discount',
      'Calculate synergy NPV separately from stand-alone value',
    ],
  },
  {
    num: '06',
    id: 'duediligence',
    title: 'Due Diligence — Legal, Business & Strategic',
    value: 'Uncovers what the offering memo hides',
    valueColor: 'var(--red)',
    desc: 'DD failures cause 80% of post-closing regret. Accountability 2.0 era requires digital forensics, ESG compliance, and regulatory standing — not just financial review.',
    pwc: "Best practice: find the bugs before buyer's counsel finds them for you",
    questions: [
      'Are all IP registrations (patents, trademarks) current and clean?',
      'Are any key customer contracts change-of-control triggered?',
      'What is the status of all regulatory approvals (BIS, ALMM, BEE)?',
      'Are there any undisclosed related-party transactions?',
      'What is the quality of the management information systems?',
    ],
    solarContext:
      'India-specific DD red flags: MSME supplier payment compliance, PLI audit status, PCB environmental compliance for manufacturing, SEBI insider trading disclosures for listed targets, and FEMA compliance for any overseas technology licensing.',
    checklist: [
      'Legal: IP, contracts, litigation, regulatory filings',
      'Business: customer/vendor concentration, MIS quality',
      'Strategic: synergy validation, value leakage scan',
      'Financial: recast 3-year P&L, working capital normalization',
      'HR: key man dependency, retention risk, ESOP structure',
    ],
  },
  {
    num: '07',
    id: 'structure',
    title: 'Deal Structuring — 5 Structural Alternatives',
    value: 'Determines tax outcome and risk allocation',
    valueColor: 'var(--cyan2)',
    desc: 'Structure drives the tax consequence for both sides and determines post-closing liability exposure. The right structure can create or destroy millions in after-tax value.',
    pwc: 'Tax-free vs taxable; one-step vs staged; asset vs stock',
    questions: [
      'Does a stock purchase or asset purchase better serve both parties?',
      'Is a staged transaction appropriate given regulatory approvals needed?',
      'What is the tax basis step-up value vs. tax-free continuity benefit?',
      'Are there change-of-control provisions in key contracts?',
      'Should we consider a minority stake first with option to acquire balance?',
    ],
    solarContext:
      'In India: slump sale (equivalent to US asset purchase) attracts stamp duty but avoids historical liability. Share purchase of ALMM-listed entities preserves the listing, which has significant commercial value under MoP notification.',
    checklist: [
      'Model tax impact of asset vs. share purchase for both parties',
      'Identify all change-of-control clauses in material contracts',
      'Evaluate staged structure if regulatory approvals uncertain',
      'Structure earn-out tied to specific post-closing milestones',
      'Include representations and warranties insurance if deal >₹500Cr',
    ],
  },
  {
    num: '08',
    id: 'financing',
    title: 'Financing Architecture',
    value: 'Makes or breaks deal economics and IRR',
    valueColor: 'var(--green)',
    desc: 'The capital stack determines financial returns. Post-2008 discipline: lenders require earnings capability, conservative leverage, and equity contribution — not just collateral.',
    pwc: 'Key: find ideal debt amount, capital structure for future success, and cost of funds',
    questions: [
      "What is the target's free cash flow coverage of debt service?",
      'What equity contribution is required by senior lenders?',
      'Is seller financing (take-back note) possible to bridge price gap?',
      'Are there earn-out provisions to align interests post-closing?',
      "What is the impact on buyer's own balance sheet post-acquisition?",
    ],
    solarContext:
      'India acquisition financing: PSU banks offer project finance at 9.5–11%; NBFCs 11–14%; PE co-investment at equity level; seller note (deferred consideration) is common in promoter-owned mid-cap deals. Escrow structures are standard for listed acquisitions via open offer.',
    checklist: [
      'Model debt service coverage ratio at conservative EBITDA',
      'Structure senior debt with equity contribution of 30–40%',
      'Evaluate mezzanine layer for bridging valuation gap',
      'Build in earn-out tied to post-closing EBITDA targets',
      'Ensure post-closing working capital is ring-fenced',
    ],
  },
  {
    num: '09',
    id: 'negotiation',
    title: 'Negotiation, LOI & Deal Killer Management',
    value: 'Converts strategy to binding commitment',
    valueColor: 'var(--gold2)',
    desc: 'Deal killers: poor communication, cultural misalignment, regulatory surprises, and valuation disconnect. A well-prepared LOI with clear binding/non-binding demarcation prevents transactional fatigue.',
    pwc: 'Transactional fatigue: momentum loss is the most underestimated deal killer',
    questions: [
      'Which LOI terms are binding (confidentiality, exclusivity) vs non-binding?',
      'How do we maintain momentum without conceding value?',
      'Is there a competing bidder strategy to create urgency?',
      "How do we handle the seller's management team anxiety?",
      'What are the key condition precedents to closing?',
    ],
    solarContext:
      'India-specific deal killers: promoter reluctance to exit, SEBI open offer trigger thresholds (25% acquisition), CCI filing requirements (for deals above notifiable thresholds), minority shareholder NCLT risks, and undisclosed related-party debt.',
    checklist: [
      'Draft LOI with clear binding vs non-binding demarcation',
      'Establish exclusivity window (45–90 days standard)',
      'Define material adverse change (MAC) clause carefully',
      'Manage seller management team with employment offers',
      'Identify all condition precedents and assign owners',
    ],
  },
  {
    num: '10',
    id: 'integration',
    title: 'Post-Closing Integration — 100-Day Plan',
    value: 'Where 80% of deals fail or succeed',
    valueColor: 'var(--red)',
    desc: 'Sherman: "80% failure rate to create post-closing value." Integration is not an afterthought — it must be planned before closing and executed with dedicated ownership.',
    pwc: 'Staffing, customers, vendors, culture, systems, legal — all simultaneously',
    questions: [
      'Do we have a dedicated integration leader assigned before close?',
      "How do we retain the seller's key customer relationships?",
      'What is the cultural integration plan for the combined team?',
      'How do we consolidate ERP/MIS systems without operational disruption?',
      'What are the 30/60/100 day milestones and owners?',
    ],
    solarContext:
      'India solar integration priorities: ALMM listing continuity (any disruption loses domestic supply eligibility), BIS certification transfer, GST registration synchronization, PLI scheme audit continuity, and key promoter retention under 2–3 year lock-in.',
    checklist: [
      'Assign dedicated integration leader before close',
      'Build 100-day plan with 30/60/100 milestones',
      'Retain top 20 employees with retention bonuses',
      'Communicate to customers, vendors within 48 hours of close',
      'Track synergy realization quarterly against acquisition case',
    ],
  },
]

// ── Deal Structures ──

interface DealStructure {
  id: string
  icon: string
  name: string
  tax: string
  color: string
  pros: string[]
  cons: string[]
  best: string
  taxNote: string
}

const DEAL_STRUCTURES: DealStructure[] = [
  {
    id: 'asset',
    icon: '🏭',
    name: 'Asset Purchase (Slump Sale)',
    tax: 'Taxable',
    color: 'var(--orange)',
    pros: [
      'Buyer selects specific assets to acquire',
      "Avoids assuming seller's historical liabilities",
      'Clean start — no inherited legal risk',
      'Step-up in tax basis to fair market value',
    ],
    cons: [
      'Stamp duty on asset transfer (India: 3–7%)',
      'Individual contract assignment required',
      'No continuity of ALMM/BIS certifications',
      'More operationally complex to execute',
    ],
    best:
      'Best for: Distressed asset acquisition, carve-out of specific division, when seller has unknown liabilities',
    taxNote:
      'Slump sale: stamp duty 3–7% of asset value. Buyer gets step-up in tax basis. Seller pays capital gains tax.',
  },
  {
    id: 'stock',
    icon: '📋',
    name: 'Share Purchase',
    tax: 'Can be tax-free',
    color: 'var(--cyan2)',
    pros: [
      'ALMM listing and all certifications transfer automatically',
      'Simpler execution — entity continuity',
      'PLI allocation and government approvals preserved',
      'Retains all existing customer/vendor relationships',
    ],
    cons: [
      'Buyer assumes all historical liabilities',
      'No step-up in tax basis',
      'Minority shareholders may not cooperate',
      'SEBI open offer triggered at 25% acquisition (listed)',
    ],
    best:
      'Best for: ALMM-listed manufacturers, PLI allocation holders, regulated entities where license transfer is complex',
    taxNote:
      'Share purchase: buyer assumes historical tax liabilities. No stamp duty on shares. Listed: LTCG at 10% for seller.',
  },
  {
    id: 'merger',
    icon: '⚖',
    name: 'Statutory Merger',
    tax: 'Tax-free (Sec 391-394)',
    color: 'var(--green)',
    pros: [
      'Tax-free if NCLT-approved scheme',
      'Complete integration in one step',
      'Shareholders of both entities protected',
      'Courts provide oversight and creditor protection',
    ],
    cons: [
      '6–18 month NCLT process (slow)',
      'Requires shareholder approval (75% majority)',
      'SEBI/CCI approvals for listed/large entities',
      'Public disclosure required — deal leakage risk',
    ],
    best:
      'Best for: Large strategic mergers between equals, listed company combinations, long-term integrations where speed is not critical',
    taxNote:
      'NCLT-approved merger: tax-neutral for both entities under Section 391-394. Goodwill treatment per Ind-AS 103.',
  },
  {
    id: 'stockstock',
    icon: '🔄',
    name: 'Stock-for-Stock (Share Swap)',
    tax: 'Tax-deferred',
    color: 'var(--purple)',
    pros: [
      'Preserves cash for operations/growth',
      'Seller participates in combined company upside',
      'Tax-deferred event for seller shareholders',
      'Aligns incentives post-closing',
    ],
    cons: [
      'Dilutes existing buyer shareholders',
      'Seller bears post-merger integration risk',
      'Complex to value if buyer is also private',
      'Market price volatility affects deal economics',
    ],
    best:
      'Best for: Mergers of equals, when seller wants ongoing equity participation, when buyer wants to preserve cash balance',
    taxNote:
      'Share swap: tax-deferred for seller until disposal of acquired shares. No cash consideration.',
  },
  {
    id: 'staged',
    icon: '📊',
    name: 'Staged/Minority First',
    tax: 'Flexible',
    color: 'var(--gold2)',
    pros: [
      'Reduces initial capital outlay',
      'Allows operational validation before full commitment',
      'Option structure on remaining stake',
      'Seller retains control during transition',
    ],
    cons: [
      'Complex governance during minority period',
      'Valuation lock-in risk for remaining stake',
      'Minority shareholder rights can complicate operations',
      'Longer path to full integration benefits',
    ],
    best:
      "Best for: First acquisition in new segment, when regulatory approvals are pending, when seller wants time to validate buyer's capabilities",
    taxNote:
      'Staged structure: initial tranche taxable; option exercise treated as separate transaction.',
  },
]

// ── Value Drivers ──

interface ValueDriver {
  name: string
  weight: string // star string e.g. '★★★★★'
  desc: string
  items: string[]
  threshold: string
}

const VALUE_DRIVERS: ValueDriver[] = [
  {
    name: 'Revenue Growth Rate (3-yr CAGR)',
    weight: '★★★★★',
    desc: 'Sherman: #1 determinant of deal multiples per regression analysis',
    items: [
      'India solar module demand growing 35%+ YoY through 2027',
      'RDSS scheme driving ₹3.03L Cr smart meter rollout through 2025',
      'PLI-backed domestic cell/module capacity addition accelerating',
    ],
    threshold: '<10% = 6–8× · 15–25% = 10–14× · >30% = 15–22×',
  },
  {
    name: 'Market Share / Niche Strength',
    weight: '★★★★☆',
    desc: 'A recognized market leader commands significant multiple premium',
    items: [
      'India PV glass: Borosil Renewables is near-monopoly (80%+ share)',
      'Smart meters: Genus, HPL, AESL dominate top-3 positions',
      'Power transformers: Crompton, TRIL, Indo Tech in top tier',
    ],
    threshold: 'Niche leader = +2–4× premium on EBITDA multiple',
  },
  {
    name: 'Barriers to Entry',
    weight: '★★★★☆',
    desc: 'Structural barriers that competitors cannot easily replicate',
    items: [
      'BCD 40% on modules + 25% on cells → meaningful import barrier',
      'ALMM listing process: 12–18 months to achieve → incumbency moat',
      'RDSS allocation: PSU-led distribution, not open market competition',
    ],
    threshold: 'Regulatory moat = most durable barrier in India energy',
  },
  {
    name: 'Management Team Depth',
    weight: '★★★☆☆',
    desc: 'Bench strength that survives promoter exit is rare and valuable',
    items: [
      'Most Indian mid-cap manufacturers are promoter-led single-person shows',
      'Institutional management (ex-Waaree, RenewSys) commands premium',
      'Key account relationships with SECI/DISCOMs must be transferable',
    ],
    threshold: 'Institutional management = +15–20% on acquisition valuation',
  },
  {
    name: 'Cash Flow Stability',
    weight: '★★★★☆',
    desc: 'Predictable, growing, low-capital-intensity cash flow commands highest multiples',
    items: [
      'Smart meter manufacturers: RDSS-backed government offtake is near-certain',
      'Module makers: spot market exposure creates cash flow volatility',
      'Transformer makers: order book visibility 12–18 months ahead',
    ],
    threshold: 'Contracted CF >80% = DCF certainty premium',
  },
  {
    name: 'Customer Concentration Risk',
    weight: '★★★☆☆',
    desc: 'No customer >30% revenue. No supplier >40% of key inputs.',
    items: [
      'Silver paste: 2 Chinese suppliers control 80% of global supply',
      'Polysilicon: Daqo/Tongwei control 45%+ → supply concentration risk',
      'Domestic transformer buyers: SEB orders can be cancelled/deferred',
    ],
    threshold: '>30% single customer = negative 1–2× multiple adjustment',
  },
  {
    name: 'Technology Obsolescence Risk',
    weight: '★★★★☆',
    desc: 'Current technology must have at least 7–10 year commercial horizon',
    items: [
      'P-type PERC: peak demand reached, TOPCon market share accelerating past 70%',
      'Smart meters: AMI 2.0 (NB-IoT) replacing older GPRS-based systems',
      'Power transformers: EV grid and RE integration driving new tech specs',
    ],
    threshold: 'Technology behind market = 20–30% DCF haircut',
  },
]

// ── Finance Stack ──

const FINANCE_STACK = [
  {
    name: 'Senior Secured Debt',
    pct: '40–50%',
    cost: '9.5–11%',
    provider: 'PSU Banks, large NBFCs',
    txt: 'var(--cyan2)',
  },
  {
    name: 'Mezzanine / Sub Debt',
    pct: '10–15%',
    cost: '13–16% + equity',
    provider: 'PE Credit Funds, AIFs',
    txt: 'var(--purple)',
  },
  {
    name: 'Seller Note (Deferred)',
    pct: '10–20%',
    cost: '6–9% (negotiated)',
    provider: 'Promoter / Selling entity',
    txt: 'var(--gold2)',
  },
  {
    name: 'Equity (Buyer)',
    pct: '25–35%',
    cost: 'IRR hurdle 20–25%',
    provider: 'Acquirer balance sheet / PE co-invest',
    txt: 'var(--green)',
  },
]

// ── Risk Items ──

const RISK_ITEMS = [
  {
    icon: '💬',
    title: 'Communication Failure',
    sev: 'HIGH',
    items: [
      'Seller management team not informed early enough',
      'Deal leak before regulatory approvals',
      'Inconsistent messaging to stakeholders',
      'No joint communication plan drafted',
    ],
  },
  {
    icon: '🎭',
    title: 'Cultural Misalignment',
    sev: 'HIGH',
    items: [
      'Promoter-driven vs. institutional governance clash',
      'Decision-making speed differential',
      'Compensation structure incompatibility',
      'Regional / language barriers in execution',
    ],
  },
  {
    icon: '📊',
    title: 'Valuation Disconnect',
    sev: 'MED',
    items: [
      'Promoter anchors to peak multiple',
      'Synergy projections are overstated',
      'Hidden liabilities discovered post-LOI',
      'Working capital adjustment disputes at close',
    ],
  },
  {
    icon: '⚖',
    title: 'Regulatory Risk',
    sev: 'MED',
    items: [
      'CCI merger notification if above threshold',
      'SEBI open offer obligations (25% trigger)',
      'FEMA approvals for cross-border elements',
      'PLI audit pending — affects post-close claims',
    ],
  },
  {
    icon: '🔬',
    title: 'Due Diligence Gaps',
    sev: 'MED',
    items: [
      'ALMM certification status undisclosed',
      'Related-party receivables misclassified',
      'Promoter pledge not in public records',
      'Environmental liability not in books',
    ],
  },
  {
    icon: '👥',
    title: 'Key Talent Retention',
    sev: 'LOW',
    items: [
      'Technical leads with proprietary process knowledge',
      'Key account managers with customer relationships',
      'R&D team critical for technology roadmap',
      'Promoter family members in operational roles',
    ],
  },
]

// ── DD Checklist ──

const DD_CHECKLIST: Record<string, { g: string; items: string[] }[]> = {
  legal: [
    {
      g: 'Corporate & Governance',
      items: [
        'Articles of Association and MOA review',
        'Board minutes for last 5 years',
        'Shareholder agreements and voting rights',
        'Promoter pledging status and encumbrances',
        'Any pending NCLT/insolvency proceedings',
        'Related-party transaction disclosures',
      ],
    },
    {
      g: 'Intellectual Property',
      items: [
        'Patent registrations and validity',
        'Trademark filings (India + key export markets)',
        'Trade secrets and NDA coverage',
        'Technology licensing agreements (inbound/outbound)',
        'BIS certification status and renewal dates',
        'ALMM listing documentation',
      ],
    },
    {
      g: 'Contracts & Commitments',
      items: [
        'All material customer contracts (change-of-control clauses)',
        'Key supplier/vendor agreements',
        'Long-term purchase obligations',
        'Government/SECI/DISCOM contracts',
        'EPC/O&M agreements',
        'Lease and property agreements',
      ],
    },
    {
      g: 'Regulatory & Compliance',
      items: [
        'SEBI filings and disclosures (listed entities)',
        'FEMA/RBI compliance for foreign transactions',
        'Environmental clearances (PCB, MOEF)',
        'Factory licenses and MSME registration',
        'GST compliance and pending notices',
        'Income tax assessments and demands',
      ],
    },
  ],
  business: [
    {
      g: 'Financial Quality',
      items: [
        '3-year recast P&L (normalized for promoter expenses)',
        'Working capital cycle analysis',
        'Debtors aging and bad debt provisioning',
        'Inventory valuation and obsolescence risk',
        'Capex cycle and maintenance backlog',
        'Off-balance-sheet liabilities',
      ],
    },
    {
      g: 'Customers & Revenue',
      items: [
        'Top 10 customer concentration (flag if >30% single)',
        'Customer contracts and renewal status',
        'Revenue by product line (growth quality)',
        'Order book quality and conversion rates',
        'Receivables from government/PSU entities',
        'Export revenue and forex risk',
      ],
    },
    {
      g: 'Operations & Supply Chain',
      items: [
        'Capacity utilization rates (actual vs installed)',
        'Key supplier dependency and alternatives',
        'Production quality metrics (rejection rate, yield)',
        'Technology vintage vs. competition (P-type vs N-type)',
        'Energy costs and PLI incentive realization',
        'Workforce composition and union status',
      ],
    },
    {
      g: 'Management & People',
      items: [
        'Key man dependency analysis',
        'Management team depth and succession',
        'Employee retention history (last 3 years)',
        'ESOP structure and vesting schedule',
        'Compensation benchmarking',
        'HR liabilities (gratuity, PF, ESIC)',
      ],
    },
  ],
  strategic: [
    {
      g: 'Synergy Validation',
      items: [
        'Revenue synergy: cross-sell to combined customer base',
        'Cost synergy: procurement consolidation opportunities',
        'Technology synergy: shared R&D/IP leverage',
        'Distribution synergy: channel overlap and efficiency',
        'Management synergy: elimination of duplicate roles',
        'Capital synergy: shared balance sheet optimization',
      ],
    },
    {
      g: 'Value Leakage Scan',
      items: [
        'Gap between stated and sustainable EBITDA margin',
        'Customer concentration creating leverage risk',
        'Technology obsolescence horizon (3–5 years)',
        'Regulatory dependency (PLI, ALMM) duration risk',
        "Promoter-specific relationships that won't transfer",
        'Environmental liability and remediation costs',
      ],
    },
  ],
}

// ── Integration Phases ──

const INTEGRATION_PHASES = [
  {
    phase: 'Pre-Close (T-30 to T=0)',
    dot: 'var(--cyan2)',
    tasks: [
      'Appoint dedicated integration leader (not the deal team)',
      'Complete 100-day integration plan with milestones and owners',
      'Prepare communication scripts for all stakeholder groups',
      'Identify and negotiate retention packages for top 20 employees',
      'Model Day 1 operational continuity requirements in detail',
      'Draft joint announcement press release for close day',
    ],
  },
  {
    phase: 'Day 1–30: Stabilize & Signal',
    dot: 'var(--green)',
    tasks: [
      'Announce close to all customers, vendors within 48 hours',
      'Execute key employee retention bonuses and new contracts',
      'Maintain all existing customer service level agreements',
      'Hold all-hands meetings at target facilities — no secrets',
      'Freeze major vendor/contract changes for 30 days',
      'Confirm regulatory continuity: ALMM, BIS, PLI audit status',
    ],
  },
  {
    phase: 'Day 31–60: Integrate & Harmonize',
    dot: 'var(--gold2)',
    tasks: [
      'Begin phased ERP/MIS consolidation — no big bang migration',
      'Renegotiate supply contracts on combined volume basis',
      "Begin cross-selling introductions to each other's customer bases",
      'Harmonize HR policies, compensation bands, ESOP structures',
      'Transfer or re-issue all regulatory certifications jointly',
      'Monthly synergy tracking report vs. acquisition business case',
    ],
  },
  {
    phase: 'Day 61–100: Optimize & Realize',
    dot: 'var(--purple)',
    tasks: [
      'Complete organizational restructuring announcement',
      'Realize first quantifiable cost synergies (procurement, SG&A)',
      'Launch joint go-to-market for new customer segments',
      'Complete brand and corporate identity integration',
      'Present first post-close synergy update to board',
      'Set combined entity Year 1 operating budget and targets',
    ],
  },
]

// ── Tabs ──

type TabId =
  | 'algorithm'
  | 'eotb'
  | 'valuedrivers'
  | 'structure'
  | 'financing'
  | 'duediligence'
  | 'riskreview'
  | 'integration'
  | 'aireasoning'

const TABS: { id: TabId; label: string }[] = [
  { id: 'algorithm', label: 'Strategic Algorithm' },
  { id: 'eotb', label: 'EOTB Analyzer' },
  { id: 'valuedrivers', label: 'Value Drivers' },
  { id: 'structure', label: 'Deal Structures' },
  { id: 'financing', label: 'Financing Stack' },
  { id: 'duediligence', label: 'Due Diligence' },
  { id: 'riskreview', label: 'Risk Monitor' },
  { id: 'integration', label: 'Integration Plan' },
  { id: 'aireasoning', label: '🤖 AI Reasoning' },
]

// ─────────────────────────────────────────────────────────────
// Sub-component: Algorithm Tab
// ─────────────────────────────────────────────────────────────

function AlgorithmTab() {
  const [openId, setOpenId] = useState<string | null>(null)

  return (
    <div>
      <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--txt3)', lineHeight: 1.6 }}>
        Andrew Sherman&apos;s definitive M&amp;A framework — 10 strategic levels ordered by the value they add to a transaction.
        The earlier levels have the highest leverage: a flawed objective definition at Level 1 cannot be fixed by perfect execution at Levels 7–10.
        Click any level for the full strategic detail, India solar context, and actionable checklist.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {SHERMAN_ALGORITHM.map((a) => {
          const isOpen = openId === a.id
          return (
            <div
              key={a.id}
              onClick={() => setOpenId(isOpen ? null : a.id)}
              style={{
                background: 'var(--s1)',
                border: `1px solid ${isOpen ? a.valueColor : 'var(--br)'}`,
                borderRadius: 8,
                padding: 14,
                cursor: 'pointer',
                transition: 'all .2s',
                gridColumn: isOpen ? '1 / -1' : undefined,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: 'var(--txt3)',
                  letterSpacing: '1.5px',
                  textTransform: 'uppercase',
                }}
              >
                LEVEL {a.num}
              </div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  color: 'var(--txt)',
                  fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                  marginTop: 4,
                }}
              >
                {a.title}
              </div>
              <div
                style={{
                  display: 'inline-block',
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 4,
                  background: 'rgba(255,255,255,.05)',
                  color: a.valueColor,
                  marginTop: 8,
                }}
              >
                {a.value}
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--txt3)',
                  marginTop: 8,
                  lineHeight: 1.5,
                }}
              >
                {a.desc}
              </div>

              {isOpen && (
                <div
                  style={{
                    marginTop: 14,
                    paddingTop: 14,
                    borderTop: '1px solid var(--br)',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--txt3)',
                          textTransform: 'uppercase',
                          letterSpacing: '.8px',
                          marginBottom: 8,
                        }}
                      >
                        Key Questions to Answer
                      </div>
                      {a.questions.map((q, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'flex-start',
                            fontSize: 12,
                            color: 'var(--txt2)',
                            marginBottom: 4,
                            lineHeight: 1.5,
                          }}
                        >
                          <span style={{ flexShrink: 0 }}>❓</span>
                          <span>{q}</span>
                        </div>
                      ))}
                      <div
                        style={{
                          marginTop: 12,
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--txt3)',
                          textTransform: 'uppercase',
                          letterSpacing: '.8px',
                          marginBottom: 6,
                        }}
                      >
                        Industry Data Point
                      </div>
                      <div
                        style={{
                          background: 'var(--s3)',
                          borderRadius: 6,
                          padding: 10,
                          fontSize: 12,
                          color: 'var(--txt2)',
                          fontStyle: 'italic',
                        }}
                      >
                        &quot;{a.pwc}&quot;
                      </div>
                    </div>
                    <div>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--txt3)',
                          textTransform: 'uppercase',
                          letterSpacing: '.8px',
                          marginBottom: 8,
                        }}
                      >
                        India Solar/T&amp;D Context
                      </div>
                      <div
                        style={{
                          background: 'var(--s3)',
                          borderRadius: 6,
                          padding: 10,
                          fontSize: 12,
                          color: 'var(--txt2)',
                          lineHeight: 1.5,
                          borderLeft: `3px solid ${a.valueColor}`,
                        }}
                      >
                        <strong style={{ color: 'var(--txt)' }}>Sector Application:</strong> {a.solarContext}
                      </div>
                      <div
                        style={{
                          marginTop: 12,
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--txt3)',
                          textTransform: 'uppercase',
                          letterSpacing: '.8px',
                          marginBottom: 8,
                        }}
                      >
                        Action Checklist
                      </div>
                      {a.checklist.map((c, i) => (
                        <div
                          key={i}
                          style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'flex-start',
                            fontSize: 12,
                            color: 'var(--txt2)',
                            marginBottom: 4,
                            lineHeight: 1.5,
                          }}
                        >
                          <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span>
                          <span>{c}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sub-component: EOTB Tab
// ─────────────────────────────────────────────────────────────

function EOTBTab() {
  const valueQuestions: [string, string][] = [
    ['🎯', 'How does this acquisition solve a specific strategic problem for us that we cannot solve organically in 3 years?'],
    ['💰', 'How do we strengthen their core revenue streams, and how do they strengthen ours?'],
    ['🔄', 'What cross-selling opportunities flow in both directions between our respective customer bases?'],
    ['👥', 'What holes in our management team or organizational structure do their people fill?'],
    ['🛡', 'What barriers to entry does their position create that we could not independently build?'],
    ['📡', 'What regulatory approvals, certifications, or government relationships transfer with this entity?'],
  ]
  const redFlags: [string, string][] = [
    ['🔴', 'Management team is founder-dependent — key relationships and knowledge do not transfer'],
    ['🔴', 'Top 3 customers represent >50% of revenue — loss of one is existential'],
    ['🟡', 'Technology is 2 generations behind the market leader (P-type in a TOPCon world)'],
    ['🟡', 'PLI allocation or ALMM listing is under audit review — continuity at risk'],
    ['🟡', 'Working capital cycle is 120+ days — hidden cash drain post-acquisition'],
    ['⚪', 'Related-party transactions mask true standalone profitability margin'],
  ]
  const matrix: [string, string, string, string][] = [
    ['ALMM Status', 'Are you listed under MoP ALMM notification?', 'ALMM-listed cells, modules → domestic supply eligibility', 'Not listed; audit pending'],
    ['PLI Allocation', 'What is your PLI tranche and realization timeline?', '₹X Cr committed PLI over 5 years with performance targets met', 'Allocation at risk due to capex delay'],
    ['Customer Quality', 'Who are your top 5 customers by revenue?', 'PSU/SECI backed long-term PPAs; DISCOM framework agreements', 'Single IPP >40% revenue'],
    ['Technology Node', 'What cell technology are you producing (P-type/TOPCon/HJT)?', 'TOPCon N-type bifacial — industry demand shift is irreversible', 'Mono PERC/P-type only, no upgrade capex'],
    ['Management Depth', 'Does the second tier run the business independently?', 'Proven COO/CFO/CTO separate from promoter', 'Promoter controls all commercial relationships'],
    ['Regulatory Standing', 'Any pending CBI/SEBI/PCB/Tax authority notices?', 'Clean regulatory record with all certifications current', 'Open SEBI investigation or PCB enforcement notice'],
  ]

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 20, lineHeight: 1.6 }}>
        <strong style={{ color: 'var(--txt)' }}>EOTB = Eyes of the Buyer.</strong> Sherman&apos;s most powerful pre-deal tool: conduct a no-holds-barred analysis of exactly what a prospective buyer sees when the due diligence veil is removed.
        This must be done with &quot;candor and integrity as guiding principles&quot; — no sacred cows, no Emperor&apos;s New Clothes.
        A thorough EOTB process uncovers key value drivers, strengthens the offering memorandum, and surfaces non-obvious buyers.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', marginBottom: 12 }}>
            🔍 Value Addition Questions
          </div>
          {valueQuestions.map(([icon, q], i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '8px 0',
                borderBottom: i < valueQuestions.length - 1 ? '1px solid var(--br)' : 'none',
                fontSize: 12,
                color: 'var(--txt2)',
                lineHeight: 1.5,
              }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
              <span>{q}</span>
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', marginBottom: 12 }}>
            ⚠ Value Leakage Red Flags
          </div>
          {redFlags.map(([icon, q], i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                padding: '8px 0',
                borderBottom: i < redFlags.length - 1 ? '1px solid var(--br)' : 'none',
                fontSize: 12,
                color: 'var(--txt2)',
                lineHeight: 1.5,
              }}
            >
              <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>
              <span>{q}</span>
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          marginTop: 20,
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', marginBottom: 12 }}>
          EOTB Score Matrix — India Solar/T&amp;D Sector
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--txt3)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.6px' }}>
                <th style={{ padding: '10px 8px', borderBottom: '1px solid var(--br)' }}>Value Driver</th>
                <th style={{ padding: '10px 8px', borderBottom: '1px solid var(--br)' }}>Questions to Ask Target</th>
                <th style={{ padding: '10px 8px', borderBottom: '1px solid var(--br)' }}>What Buyer Pays Premium For</th>
                <th style={{ padding: '10px 8px', borderBottom: '1px solid var(--br)' }}>Red Flag</th>
              </tr>
            </thead>
            <tbody>
              {matrix.map(([d, q, p, r], i) => (
                <tr key={i}>
                  <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--br)', fontWeight: 600, color: 'var(--txt)' }}>
                    {d}
                  </td>
                  <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--br)', color: 'var(--txt3)' }}>
                    {q}
                  </td>
                  <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--br)', color: 'var(--green)' }}>
                    {p}
                  </td>
                  <td style={{ padding: '10px 8px', borderBottom: '1px solid var(--br)', color: 'var(--red)' }}>
                    {r}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sub-component: Value Drivers Tab
// ─────────────────────────────────────────────────────────────

function ValueDriversTab() {
  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 16, lineHeight: 1.6 }}>
        Sherman&apos;s regression analysis proves: <strong style={{ color: 'var(--txt)' }}>the #1 determinant of deal multiples is revenue growth rate.</strong>
        Score each of the 7 value drivers systematically. The combined score directly predicts the achievable EBITDA multiple range.
        Higher scores justify walking away from deals — or paying a meaningful premium for exceptional targets.
      </div>
      {VALUE_DRIVERS.map((d, i) => {
        const stars = d.weight.split('').filter((c) => c === '★').length
        const pct = (stars / 5) * 100
        const color = pct >= 80 ? 'var(--green)' : pct >= 60 ? 'var(--gold2)' : 'var(--orange)'
        return (
          <div
            key={i}
            style={{
              background: 'var(--s1)',
              border: '1px solid var(--br)',
              borderRadius: 8,
              padding: 16,
              marginBottom: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)', fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif' }}>
                  {i + 1}. {d.name}
                </div>
                <div style={{ fontSize: 12, color: 'var(--txt3)', marginTop: 2 }}>{d.desc}</div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 16, color }}>{d.weight}</div>
                <div style={{ fontSize: 10, color: 'var(--txt3)', marginTop: 2 }}>WEIGHTING</div>
              </div>
            </div>
            <div
              style={{
                background: 'var(--s3)',
                height: 6,
                borderRadius: 3,
                overflow: 'hidden',
                marginBottom: 10,
              }}
            >
              <div style={{ width: `${pct}%`, height: '100%', background: color }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, alignItems: 'start' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {d.items.map((item, j) => (
                  <div
                    key={j}
                    style={{
                      fontSize: 12,
                      color: 'var(--txt2)',
                      display: 'flex',
                      gap: 8,
                      alignItems: 'flex-start',
                      lineHeight: 1.5,
                    }}
                  >
                    <span style={{ color, flexShrink: 0 }}>▸</span>
                    {item}
                  </div>
                ))}
              </div>
              <div
                style={{
                  background: 'var(--s3)',
                  borderRadius: 6,
                  padding: '8px 12px',
                  fontSize: 11,
                  color: 'var(--txt3)',
                  maxWidth: 220,
                  flexShrink: 0,
                  borderLeft: `3px solid ${color}`,
                }}
              >
                <strong style={{ color }}>Multiple Impact:</strong>
                <br />
                {d.threshold}
              </div>
            </div>
          </div>
        )
      })}
      <div
        style={{
          background: 'linear-gradient(135deg,var(--golddim),transparent)',
          border: '1px solid rgba(247,183,49,.3)',
          borderRadius: 8,
          padding: 16,
          marginTop: 4,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--gold2)', marginBottom: 8 }}>
          📊 Combined Score → EBITDA Multiple Guide (India Energy Sector)
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, fontSize: 12, textAlign: 'center' }}>
          {([
            ['All 7 Drivers Strong', 'Category Leader', '15–22× EV/EBITDA', 'var(--green)'],
            ['5–6 Drivers Strong', 'Solid Target', '10–15× EV/EBITDA', 'var(--cyan2)'],
            ['3–4 Drivers Strong', 'Average Target', '7–10× EV/EBITDA', 'var(--gold2)'],
            ['<3 Drivers Strong', 'Value Play / Turnaround', '4–7× EV/EBITDA', 'var(--orange)'],
          ] as [string, string, string, string][]).map(([t, s, m, c], i) => (
            <div
              key={i}
              style={{
                background: 'var(--s1)',
                border: '1px solid var(--br)',
                borderRadius: 6,
                padding: 12,
              }}
            >
              <div style={{ color: c, fontWeight: 700, fontSize: 14 }}>{m}</div>
              <div style={{ color: 'var(--txt)', fontWeight: 600, margin: '4px 0' }}>{t}</div>
              <div style={{ color: 'var(--txt3)' }}>{s}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sub-component: Structure Tab
// ─────────────────────────────────────────────────────────────

function StructureTab() {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = DEAL_STRUCTURES.find((s) => s.id === selectedId)

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 16, lineHeight: 1.6 }}>
        Sherman&apos;s 5 structural alternatives — each creates a fundamentally different tax outcome, liability profile, and post-closing integration reality.
        The right structure can create or destroy ₹50–200Cr in after-tax value on a mid-size India transaction.
        Click any structure card for the full India-specific analysis.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
        {DEAL_STRUCTURES.map((s) => {
          const isSel = selectedId === s.id
          return (
            <div
              key={s.id}
              onClick={() => setSelectedId(s.id)}
              style={{
                background: 'var(--s1)',
                border: `1px solid ${isSel ? s.color : 'var(--br)'}`,
                borderRadius: 8,
                padding: 14,
                cursor: 'pointer',
                transition: 'all .2s',
                boxShadow: isSel ? `0 0 0 1px ${s.color}` : 'none',
              }}
            >
              <div style={{ fontSize: 24 }}>{s.icon}</div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: 'var(--txt)',
                  marginTop: 6,
                  fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                }}
              >
                {s.name}
              </div>
              <div
                style={{
                  display: 'inline-block',
                  fontSize: 10,
                  padding: '2px 7px',
                  borderRadius: 3,
                  background: 'rgba(255,255,255,.05)',
                  color: s.color,
                  marginTop: 6,
                }}
              >
                {s.tax}
              </div>
              <div style={{ fontSize: 11, color: 'var(--txt3)', marginTop: 8, lineHeight: 1.45 }}>
                {s.best}
              </div>
            </div>
          )
        })}
      </div>
      <div
        style={{
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        {!selected && (
          <div style={{ textAlign: 'center', color: 'var(--txt3)', fontSize: 13, padding: 20 }}>
            Select a deal structure above to see the full India-context analysis.
          </div>
        )}
        {selected && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--green)',
                  textTransform: 'uppercase',
                  letterSpacing: '.8px',
                  marginBottom: 8,
                }}
              >
                ✅ Advantages
              </div>
              {selected.pros.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 8,
                    fontSize: 12,
                    color: 'var(--txt2)',
                    marginBottom: 4,
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span>
                  {p}
                </div>
              ))}
            </div>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--red)',
                  textTransform: 'uppercase',
                  letterSpacing: '.8px',
                  marginBottom: 8,
                }}
              >
                ⚠ Disadvantages
              </div>
              {selected.cons.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 8,
                    fontSize: 12,
                    color: 'var(--txt2)',
                    marginBottom: 4,
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ color: 'var(--red)', flexShrink: 0 }}>✗</span>
                  {c}
                </div>
              ))}
            </div>
            <div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--gold2)',
                  textTransform: 'uppercase',
                  letterSpacing: '.8px',
                  marginBottom: 8,
                }}
              >
                🎯 India Use Cases
              </div>
              <div
                style={{
                  background: 'var(--s3)',
                  borderRadius: 6,
                  padding: 10,
                  fontSize: 12,
                  color: 'var(--txt2)',
                  lineHeight: 1.5,
                  borderLeft: `3px solid ${selected.color}`,
                }}
              >
                {selected.best}
              </div>
              <div
                style={{
                  marginTop: 12,
                  background: 'var(--s3)',
                  borderRadius: 6,
                  padding: 10,
                  fontSize: 12,
                  color: 'var(--txt2)',
                  lineHeight: 1.5,
                }}
              >
                <strong style={{ color: selected.color }}>Tax Treatment:</strong>
                <br />
                {selected.taxNote}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sub-component: Financing Tab
// ─────────────────────────────────────────────────────────────

function FinancingTab() {
  const lenderChecklist = [
    'Buyer must have strong balance sheet — not highly leveraged',
    'Earnings capability must withstand further economic slowdown',
    'Bank requires greater equity contribution than pre-2008',
    'Cash flow coverage of debt service at conservative EBITDA',
    'Asset collateral alone is no longer sufficient — CF equally important',
    'Inventory finance very difficult; receivables remain primary collateral',
  ]
  const indiaNotes = [
    'PSU banks (SBI, PNB) most competitive for acquisition finance in energy sector',
    'NBFC credit funds (IIFL, Piramal) flexible on mezzanine structures',
    'Seller note (deferred consideration) very common in promoter-led deals',
    'Open offer financing must be pre-committed before SEBI public announcement',
    'PE co-investment can bridge equity gap for strategic acquirers',
    'Escrow-based earn-out structures provide alignment without full upfront payment',
  ]
  const indicative: [string, string, string, string][] = [
    ['Senior Debt', '₹225Cr', '45%', 'var(--cyan2)'],
    ['Mezz Debt', '₹75Cr', '15%', 'var(--purple)'],
    ['Seller Note', '₹75Cr', '15%', 'var(--gold2)'],
    ['Equity', '₹125Cr', '25%', 'var(--green)'],
    ['Total', '₹500Cr', '100%', 'var(--txt)'],
  ]
  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 20, lineHeight: 1.6 }}>
        Sherman&apos;s post-2008 financing doctrine: lenders now behave like investors — conducting competitive analysis, evaluating cash flow coverage, and demanding meaningful equity contribution.
        The capital stack below represents the typical India mid-market acquisition financing architecture for a ₹200–1,000Cr deal.
      </div>
      <div
        style={{
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          borderRadius: 10,
          overflow: 'hidden',
          marginBottom: 20,
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--br)',
            display: 'grid',
            gridTemplateColumns: '2fr 1fr 1.5fr 2fr 1fr',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--txt3)',
            textTransform: 'uppercase',
            letterSpacing: '.8px',
          }}
        >
          <span>Layer</span>
          <span>% of Deal</span>
          <span>Cost</span>
          <span>Provider (India)</span>
          <span>Priority</span>
        </div>
        {FINANCE_STACK.map((l, i) => (
          <div
            key={i}
            style={{
              padding: '14px 16px',
              borderBottom: i < FINANCE_STACK.length - 1 ? '1px solid var(--br)' : 'none',
              display: 'grid',
              gridTemplateColumns: '2fr 1fr 1.5fr 2fr 1fr',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: l.txt }}>{l.name}</span>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace', color: 'var(--txt)' }}>
              {l.pct}
            </span>
            <span style={{ fontSize: 13, fontFamily: 'JetBrains Mono, monospace', color: l.txt }}>
              {l.cost}
            </span>
            <span style={{ fontSize: 12, color: 'var(--txt3)' }}>{l.provider}</span>
            <span
              style={{
                fontSize: 11,
                padding: '2px 8px',
                borderRadius: 3,
                fontWeight: 700,
                background: 'var(--s3)',
                color: 'var(--txt3)',
                justifySelf: 'start',
              }}
            >
              #{i + 1}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div style={{ background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', marginBottom: 12 }}>
            🏦 Lender&apos;s Checklist (Post-2008 Sherman)
          </div>
          {lenderChecklist.map((item, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                fontSize: 12,
                color: 'var(--txt2)',
                marginBottom: 5,
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: 'var(--gold2)', flexShrink: 0 }}>!</span>
              {item}
            </div>
          ))}
        </div>
        <div style={{ background: 'var(--s1)', border: '1px solid var(--br)', borderRadius: 8, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', marginBottom: 12 }}>
            💡 India-Specific Financing Notes
          </div>
          {indiaNotes.map((item, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                fontSize: 12,
                color: 'var(--txt2)',
                marginBottom: 5,
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: 'var(--cyan2)', flexShrink: 0 }}>▸</span>
              {item}
            </div>
          ))}
        </div>
      </div>
      <div
        style={{
          background: 'linear-gradient(135deg,var(--cyandim),transparent)',
          border: '1px solid rgba(0,180,216,.2)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--cyan2)', marginBottom: 8 }}>
          📐 Indicative Financing Model — ₹500Cr Acquisition
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, textAlign: 'center', fontSize: 12 }}>
          {indicative.map(([n, a, p, c], i) => (
            <div
              key={i}
              style={{
                background: 'var(--s1)',
                border: '1px solid var(--br)',
                borderRadius: 6,
                padding: 10,
              }}
            >
              <div style={{ color: c, fontWeight: 700, fontSize: 16, fontFamily: 'JetBrains Mono, monospace' }}>{a}</div>
              <div style={{ color: 'var(--txt)', fontWeight: 500, margin: '3px 0' }}>{n}</div>
              <div style={{ color: 'var(--txt3)' }}>{p}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sub-component: DD Tab
// ─────────────────────────────────────────────────────────────

type DDState = Record<string, 'done' | 'warn' | 'flag' | ''>

function DDTab() {
  const [activeCat, setActiveCat] = useState<'legal' | 'business' | 'strategic'>('legal')
  const [state, setState] = useState<DDState>({})

  const cats: ('legal' | 'business' | 'strategic')[] = ['legal', 'business', 'strategic']
  const catLabel = (c: string) =>
    c === 'legal' ? '⚖ Legal & Regulatory' : c === 'business' ? '📊 Business & Financial' : '🎯 Strategic Validation'

  const groups = DD_CHECKLIST[activeCat]
  const total = groups.reduce((s, g) => s + g.items.length, 0)
  const done = groups.reduce(
    (s, g) => s + g.items.filter((_, i) => state[`dd_${activeCat}_${g.g}_${i}`] === 'done').length,
    0
  )
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  const setDD = (key: string, val: 'done' | 'warn' | 'flag') => {
    setState((prev) => ({ ...prev, [key]: prev[key] === val ? '' : val }))
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 12, lineHeight: 1.6 }}>
        Sherman&apos;s Accountability 2.0 due diligence framework — comprehensive checklist across Legal, Business, and Strategic dimensions.
        Track completion status for each item. Flag items that require escalation or represent deal breakers.
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 14 }}>
        {cats.map((c) => {
          const isActive = c === activeCat
          return (
            <button
              key={c}
              onClick={() => setActiveCat(c)}
              style={{
                background: isActive ? 'var(--s3)' : 'var(--s1)',
                border: `1px solid ${isActive ? 'var(--gold2)' : 'var(--br)'}`,
                color: isActive ? 'var(--gold2)' : 'var(--txt3)',
                padding: '8px 14px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {catLabel(c)}
            </button>
          )
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: 12, color: 'var(--txt3)' }}>
          {done}/{total} items reviewed
        </span>
        <div style={{ flex: 1, background: 'var(--s3)', borderRadius: 3, height: 6, overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              background: 'var(--green)',
              borderRadius: 3,
              transition: 'width .3s',
              width: `${pct}%`,
            }}
          />
        </div>
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--green)' }}>{pct}%</span>
      </div>
      {groups.map((g) => (
        <div
          key={g.g}
          style={{
            background: 'var(--s1)',
            border: '1px solid var(--br)',
            borderRadius: 8,
            padding: 14,
            marginBottom: 10,
          }}
        >
          <div
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: 'var(--txt)',
              marginBottom: 10,
              fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
            }}
          >
            📁 {g.g}
          </div>
          {g.items.map((item, i) => {
            const key = `dd_${activeCat}_${g.g}_${i}`
            const st = state[key] || ''
            return (
              <div
                key={i}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 0',
                  borderBottom: i < g.items.length - 1 ? '1px solid var(--br)' : 'none',
                }}
              >
                <div
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 4,
                    border: `1px solid ${
                      st === 'done' ? 'var(--green)' : st === 'warn' ? 'var(--gold2)' : st === 'flag' ? 'var(--red)' : 'var(--br2)'
                    }`,
                    background:
                      st === 'done' ? 'var(--green)' : st === 'warn' ? 'var(--gold2)' : st === 'flag' ? 'var(--red)' : 'transparent',
                    color: st === 'done' || st === 'flag' ? '#fff' : st === 'warn' ? '#000' : 'transparent',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {st === 'done' ? '✓' : st === 'warn' ? '!' : st === 'flag' ? '✗' : ''}
                </div>
                <div
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: st === 'done' ? 'var(--txt3)' : 'var(--txt2)',
                    textDecoration: st === 'done' ? 'line-through' : 'none',
                    lineHeight: 1.4,
                  }}
                >
                  {item}
                </div>
                <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                  {(['done', 'warn', 'flag'] as const).map((v) => {
                    const labels = { done: 'OK', warn: '?', flag: '✗' } as const
                    const borders = { done: 'var(--green)', warn: 'var(--gold2)', flag: 'var(--red)' }
                    const isActive = st === v
                    return (
                      <button
                        key={v}
                        onClick={() => setDD(key, v)}
                        style={{
                          fontSize: 10,
                          padding: '2px 6px',
                          borderRadius: 3,
                          border: `1px solid ${borders[v]}`,
                          background: isActive ? borders[v] : 'transparent',
                          color: isActive ? (v === 'warn' ? '#000' : '#fff') : borders[v],
                          cursor: 'pointer',
                        }}
                      >
                        {labels[v]}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sub-component: Risk Tab
// ─────────────────────────────────────────────────────────────

function RiskTab() {
  const killerPrinciples: [string, string][] = [
    [
      'Communication',
      'Develop joint communication plan before LOI is signed. WHO KNOWS WHAT WHEN analysis — seller, employees, customers, regulators — each with defined timing.',
    ],
    [
      'Valuation Disconnect',
      'Neither party should anchor to unrealistic multiples. Pre-negotiate the valuation framework (DCF vs. EV/EBITDA) to reduce post-LOI renegotiation risk.',
    ],
    [
      'Due Diligence',
      "Find the bugs before buyer's counsel does. Pre-LOI disclosure is better than post-LOI price cut. Build extra DD time into the schedule.",
    ],
    [
      'Cultural Alignment',
      'Assess promoter vs. institutional governance compatibility before deal. Cultural misalignment is the #1 cause of post-close value destruction.',
    ],
    [
      'Integration Planning',
      'Begin 100-day integration planning before the close — not after. Assign an integration leader before signing.',
    ],
    [
      'Regulatory Sequencing',
      "Map all approvals (SEBI, CCI, NCLT, RBI) and their timelines before LOI. Don't close deals that are conditioned on approvals with uncertain timelines.",
    ],
  ]
  const sevColor = (sev: string) => (sev === 'HIGH' ? 'var(--red)' : sev === 'MED' ? 'var(--gold2)' : 'var(--green)')

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 16, lineHeight: 1.6 }}>
        Sherman: <em>&quot;Nobody ever plans to enter into a bad deal — but classic mistakes include poor planning, aggressive timelines, ignoring integration problems, and projecting illusory synergies.&quot;</em>
        Monitor these six deal-killer risk categories throughout the transaction lifecycle.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px,1fr))', gap: 12 }}>
        {RISK_ITEMS.map((r, i) => (
          <div
            key={i}
            style={{
              background: 'var(--s1)',
              border: '1px solid var(--br)',
              borderRadius: 8,
              padding: 14,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span style={{ fontSize: 18 }}>{r.icon}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', flex: 1, fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif' }}>
                {r.title}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 3,
                  background: 'rgba(255,255,255,.05)',
                  color: sevColor(r.sev),
                  border: `1px solid ${sevColor(r.sev)}`,
                }}
              >
                {r.sev}
              </span>
            </div>
            {r.items.map((item, j) => (
              <div
                key={j}
                style={{
                  fontSize: 12,
                  color: 'var(--txt3)',
                  marginBottom: 4,
                  lineHeight: 1.5,
                }}
              >
                ▸ {item}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div
        style={{
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 16,
          marginTop: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--txt)', marginBottom: 12 }}>
          🛡 Deal Killer Prevention — Sherman&apos;s Principles
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
          {killerPrinciples.map(([t, d], i) => (
            <div
              key={i}
              style={{
                background: 'var(--s2)',
                borderRadius: 6,
                padding: 12,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold2)', marginBottom: 6 }}>{t}</div>
              <div style={{ fontSize: 12, color: 'var(--txt3)', lineHeight: 1.5 }}>{d}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sub-component: Integration Tab
// ─────────────────────────────────────────────────────────────

function IntegrationTab() {
  const indiaRisks = [
    'ALMM listing continuity — any disruption loses domestic supply eligibility immediately',
    'PLI audit trail — scheme requires continuous reporting; break in continuity = penalty',
    'GST registration synchronization — dual entity billing creates working capital lock-up',
    'SEBI compliance for listed entities — any delay in disclosures is a regulatory violation',
    'Promoter non-compete enforcement — Indian courts have limited track record on enforcement',
    'PCB/environmental clearance transfer — manufacturing units require fresh inspection post-change of ownership',
  ]
  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 20, lineHeight: 1.6 }}>
        Sherman: <strong style={{ color: 'var(--txt)' }}>&quot;80% of M&amp;A transactions fail to create post-closing value.&quot;</strong>
        The most common causes: poor communication, ignoring culture, and assuming integration will figure itself out.
        Integration planning must begin BEFORE close — assign an integration leader, build the 100-day plan, and identify retention-critical employees while you still have leverage.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 }}>
        {INTEGRATION_PHASES.map((p, i) => (
          <div
            key={i}
            style={{
              background: 'var(--s1)',
              border: '1px solid var(--br)',
              borderRadius: 8,
              padding: 16,
              borderLeft: `4px solid ${p.dot}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div
                style={{
                  width: 26,
                  height: 26,
                  borderRadius: '50%',
                  background: p.dot,
                  color: '#000',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                ▶
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--txt)', fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif' }}>
                {p.phase}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {p.tasks.map((t, j) => (
                <div
                  key={j}
                  style={{
                    fontSize: 12,
                    color: 'var(--txt2)',
                    lineHeight: 1.5,
                  }}
                >
                  ▸ {t}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div
        style={{
          background: 'linear-gradient(135deg,var(--reddim),transparent)',
          border: '1px solid rgba(239,68,68,.2)',
          borderRadius: 8,
          padding: 16,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>
          ⚠ India-Specific Integration Risks
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {indiaRisks.map((r, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'flex-start',
                fontSize: 12,
                color: 'var(--txt2)',
                lineHeight: 1.5,
              }}
            >
              <span style={{ color: 'var(--red)', flexShrink: 0 }}>!</span>
              {r}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Sub-component: AI Reasoning Tab
// ─────────────────────────────────────────────────────────────

function AIReasoningTab() {
  const [hasKey, setHasKey] = useState<boolean>(false)

  if (typeof window !== 'undefined' && !hasKey) {
    const k = localStorage.getItem('sg4_apikey') || ''
    if (k) setHasKey(true)
  }

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ fontSize: 13, color: 'var(--txt3)', marginBottom: 16, lineHeight: 1.6 }}>
        AI-powered M&amp;A reasoning using <strong style={{ color: 'var(--txt)' }}>Sherman&apos;s complete framework</strong> applied to specific acquisition targets in the India solar/T&amp;D sector.
        The AI synthesizes all 10 strategic levels — objectives, EOTB analysis, value driver scoring, valuation, structure, due diligence, financing, risks, and integration — into a single acquisition brief.
      </div>
      {!hasKey && (
        <div
          style={{
            background: 'var(--reddim)',
            border: '1px solid rgba(239,68,68,.3)',
            borderRadius: 8,
            padding: 16,
            marginBottom: 16,
            fontSize: 13,
            color: 'var(--txt2)',
            lineHeight: 1.6,
          }}
        >
          ⚠ No Anthropic API key detected. Configure API key in Settings to enable AI reasoning.
          Get a free key at <strong>console.anthropic.com</strong> — ~$5 free credit on signup.
        </div>
      )}
      <div
        style={{
          background: 'var(--s1)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 40,
          textAlign: 'center',
          color: 'var(--txt3)',
        }}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>🧠</div>
        <div style={{ fontSize: 14, color: 'var(--txt2)' }}>
          Configure API key in Settings to generate Sherman analysis for acquisition targets
        </div>
        <div style={{ fontSize: 12, marginTop: 6, color: 'var(--txt3)' }}>
          The AI will apply all 10 levels of Sherman&apos;s framework to generate an acquisition-specific strategic brief
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────

export default function MAStrategyPage() {
  const [tab, setTab] = useState<TabId>('algorithm')

  const heroKpis: [string, string][] = [
    ['10', 'Strategic Levels'],
    ['80%', 'Post-Close Failure Rate (industry avg)'],
    ['3', 'Valuation Methods'],
    ['5', 'Deal Structures'],
  ]

  return (
    <div>
      {/* Page Header */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 10,
            color: 'var(--txt3)',
            letterSpacing: '1.5px',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          SolarGrid Pro <span style={{ margin: '0 6px' }}>›</span> M&amp;A Strategic Intelligence
        </div>
        <h1
          style={{
            fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
            fontSize: 22,
            fontWeight: 700,
            color: 'var(--txt)',
            margin: 0,
            marginBottom: 10,
          }}
        >
          M&amp;A Strategic <em style={{ color: 'var(--gold2)', fontStyle: 'normal' }}>Intelligence Engine</em>
        </h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Badge variant="cyan">📖 Sherman Framework (A to Z, 3rd Ed.)</Badge>
          <Badge variant="gray">10 Strategic Levels · Ordered by Value Added</Badge>
          <Badge variant="green">India Solar + T&amp;D Context Applied</Badge>
        </div>
      </div>

      {/* Hero KPIs */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 20,
        }}
      >
        {heroKpis.map(([val, lbl], i) => (
          <div
            key={i}
            style={{
              background: 'var(--s2)',
              border: '1px solid var(--br)',
              borderRadius: 8,
              padding: 18,
              textAlign: 'center',
            }}
          >
            <div
              style={{
                fontFamily: 'Source Serif 4, Source Serif Pro, Georgia, serif',
                fontSize: 28,
                fontWeight: 700,
                color: 'var(--gold2)',
                lineHeight: 1,
              }}
            >
              {val}
            </div>
            <div
              style={{
                fontSize: 11,
                color: 'var(--txt3)',
                marginTop: 6,
                letterSpacing: '.3px',
              }}
            >
              {lbl}
            </div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--br)',
          marginBottom: 20,
          overflowX: 'auto',
        }}
      >
        {TABS.map((t) => {
          const isActive = tab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                background: 'none',
                border: 'none',
                borderBottom: isActive ? '2px solid var(--gold2)' : '2px solid transparent',
                color: isActive ? 'var(--gold2)' : 'var(--txt3)',
                padding: '10px 14px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: isActive ? 600 : 400,
                whiteSpace: 'nowrap',
                transition: 'all .15s',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Panel */}
      <div
        style={{
          background: 'var(--s2)',
          border: '1px solid var(--br)',
          borderRadius: 8,
          padding: 20,
        }}
      >
        {tab === 'algorithm' && <AlgorithmTab />}
        {tab === 'eotb' && <EOTBTab />}
        {tab === 'valuedrivers' && <ValueDriversTab />}
        {tab === 'structure' && <StructureTab />}
        {tab === 'financing' && <FinancingTab />}
        {tab === 'duediligence' && <DDTab />}
        {tab === 'riskreview' && <RiskTab />}
        {tab === 'integration' && <IntegrationTab />}
        {tab === 'aireasoning' && <AIReasoningTab />}
      </div>
    </div>
  )
}
