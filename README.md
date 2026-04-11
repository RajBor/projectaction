# SolarGrid Pro — Institutional India Solar + T&D Intelligence Platform

## Overview
SolarGrid Pro is a single-page institutional intelligence dashboard for India's solar and T&D value chain M&A strategy. Built for Waaree Energies' corporate strategy team.

## Features
- **86 Listed + 28 Private** company database across India solar + T&D value chain
- **Valuation Matrix** — sortable, filterable with EV/EBITDA, P/E, acquisition scores
- **Live Stock Terminal** — multi-source stock data (Stooq + Yahoo Finance via 3 CORS proxies)
- **DCF & Synergy Calculator** — auto-populate from database, up to 5-company comparison
- **Deal Tracker** — Kanban pipeline (Screening → Diligence → Negotiation → LOI → Closed)
- **M&A Radar** — acquisition scoring across full value chain
- **Private Targets Tab** — 28 pre-IPO and private company profiles
- **M&A Strategy Module** — Strategic Analysis framework with AI reasoning
- **Value Chain Navigator** — 28 component segments with policy + competitor mapping
- **AI Intel** — Claude API + web search integration
- **Add Company** — user-defined companies persisted via localStorage

## Tech Stack
- Vanilla JS (ES2020+) — no framework, single HTML file for portability
- Chart.js 4.4.1 for stock charts
- Google Fonts: Inter, Space Grotesk, JetBrains Mono
- Anthropic Claude API (claude-sonnet-4-20250514) for AI features
- Stooq + Yahoo Finance for live stock data
- localStorage for persistence (watchlist, deals, user companies, session)

## Project Structure
```
solargrid-pro/
├── index.html                    # Entry point
├── src/
│   ├── styles/
│   │   └── main.css              # All styles (~52KB)
│   ├── data/
│   │   ├── companies.js          # 86 listed companies database
│   │   ├── private-companies.js  # 28 private/unlisted companies
│   │   ├── chain.js              # 28 value chain segments
│   │   └── policies.js           # India RE policy database
│   ├── utils/
│   │   ├── db.js                 # localStorage persistence layer
│   │   ├── auth.js               # Login + session management
│   │   ├── stocks.js             # Live stock data engine
│   │   └── helpers.js            # Utility functions
│   └── components/
│       ├── navigation.js         # Nav, sidebar, routing
│       ├── dashboard.js          # Executive dashboard
│       ├── value-chain.js        # Value chain component pages
│       ├── stocks.js             # Live stocks terminal
│       ├── valuation-matrix.js   # Sortable valuation table
│       ├── ma-radar.js           # M&A radar + scoring
│       ├── private-targets.js    # Private companies tab
│       ├── watchlist.js          # Watchlist management
│       ├── deal-tracker.js       # Kanban deal pipeline
│       ├── compare.js            # Side-by-side comparison
│       ├── dcf-calculator.js     # DCF + synergy tool
│       ├── ma-strategy.js        # Strategic Analysis M&A framework
│       ├── news-hub.js           # AI news + research
│       ├── settings.js           # Settings page
│       ├── add-company.js        # Add company modal
│       ├── working-popups.js     # Calculation working modals
│       └── hscrollbar.js         # Global horizontal scrollbar
├── public/
│   └── favicon.ico
└── package.json
```

## Setup
```bash
# Clone and install
git clone <repo>
cd solargrid-pro
npm install

# Development server
npm run dev

# Build for production
npm run build
```

## Authentication
- Default email: `rajbordia23@gmail.com`
- Default password: `SolarGrid@2025`
- Change in Settings page

## API Key
Enter your Anthropic API key in the header bar or Settings page to enable AI Intel features.

## Data Sources
- **Company database**: Curated from NSE/BSE filings, SEBI disclosures, company reports
- **Live prices**: Stooq.com (primary) + Yahoo Finance (fallback) via CORS proxies
- **Policy data**: MNRE, MoP, SECI official documents

## License
Private — Waaree Energies internal tool
