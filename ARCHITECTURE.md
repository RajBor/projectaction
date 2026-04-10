# SolarGrid Pro — Architecture & Developer Guide

## Overview
SolarGrid Pro is a **vanilla JS single-page application** with no framework.
All state lives in module-level variables. DOM is rebuilt on each page navigation.

---

## File Load Order (critical)
```
index.html loads scripts in this exact order:
1. Data layer        → chain.js, policies.js, companies.js, private-companies.js
2. Utilities         → db.js, auth.js, stocks.js, helpers.js
3. Core components   → working-popups.js, hscrollbar.js, add-company.js
4. Navigation        → navigation.js  (defines goPage, renderPage, activePage)
5. Page components   → dashboard.js, value-chain.js, stocks-page.js, ...
6. Entry point       → app.js  (calls init())
```

---

## State Management
All state is in global variables defined in `navigation.js`:

```javascript
let activePage = 'dashboard'    // Current page route
let activeComp = 'solar_modules' // Active value chain component
let activeCompTab = 'overview'   // Active tab within value chain
let sortCol = null               // Valuation matrix sort column
let sortDir = -1                 // Sort direction
let fSec = 'all'                 // Filter: sector
let fScore = 0                   // Filter: minimum acquisition score
let fMaxEV = 999999              // Filter: max enterprise value
let fSearch = ''                 // Filter: text search
let compareList = []             // Companies in compare view
let chartInst = {}               // Active Chart.js instances
let dcfCompareList = []          // DCF comparison queue
let dcfActiveTab = 'single'      // DCF tab
let privFilter = 'all'           // Private companies filter
let privSearch = ''              // Private companies search
let privSort = 'acqs'            // Private companies sort
```

---

## Routing
`goPage(pageId)` is the single routing function. It:
1. Sets `activePage`
2. Updates nav active states
3. Destroys active Chart.js instances
4. Calls `renderPage()`

`renderPage()` maps page IDs to render functions:
```javascript
'dashboard'    → renderDashboard()
'valuechain'   → renderValueChain()
'stocks'       → renderStocksPage() + loadLivePriceBoard()
'maradar'      → renderMARadar()
'private'      → renderPrivatePage() + initPrivatePage()
'valuation'    → renderValuationPage() + renderVMTable()
'watchlist'    → renderWatchlistPage()
'dealtracker'  → renderDealTrackerPage() + renderKanban()
'compare'      → renderComparePage()
'newshub'      → renderNewsHub()
'dcf'          → renderDCFPage() + initDCFPage()
'settings'     → renderSettingsPage()
'mastrategy'   → renderMAStrategyPage() + initMAStrategy()
```

---

## Data Schemas

### COMPANIES (listed, 86 companies)
```javascript
{
  name:   string,      // "Polycab India"
  ticker: string,      // "POLYCAB"
  nse:    string,      // NSE symbol
  sec:    "solar"|"td",
  comp:   string[],    // value chain IDs from CHAIN
  mktcap: number,      // ₹Crore
  rev:    number,      // Revenue ₹Crore
  ebitda: number,      // EBITDA ₹Crore
  pat:    number,      // Profit after tax ₹Crore
  ev:     number,      // Enterprise value ₹Crore
  ev_eb:  number,      // EV/EBITDA multiple
  pe:     number,      // P/E ratio
  pb:     number,      // P/B ratio
  dbt_eq: number,      // Debt/Equity
  revg:   number,      // Revenue growth % (3yr CAGR)
  ebm:    number,      // EBITDA margin %
  acqs:   1-10,        // Acquisition score
  acqf:   string,      // "STRONG BUY"|"CONSIDER"|"MONITOR"|"PASS"|"PREMIUM"
  rea:    string,      // Acquisition rationale
  _userAdded?: bool,   // true for user-added companies
  _addedDate?: string  // ISO date for user-added
}
```

### PRIVATE_COMPANIES (28 companies)
```javascript
{
  name:     string,
  stage:    string,    // "Pre-IPO"|"Private"|"BSE SME Listed"|...
  founded:  number,
  hq:       string,
  sec:      "solar"|"td",
  comp:     string[],
  cap:      string,    // capacity description
  rev_est:  number,
  ev_est:   number,
  ebm_est:  number,
  revg_est: number,
  tech:     string,
  pli:      string,
  almm:     string,
  ipo:      string,
  acqs:     1-10,
  acqf:     string,
  rea:      string
}
```

### CHAIN (28 value chain segments)
```javascript
{
  id:   string,         // "solar_modules", "smart_meters", ...
  name: string,
  cat:  string,         // Category path
  sec:  "solar"|"td",
  flag: "critical"|"high"|"medium",
  mkt:  {
    ig:    string,      // India market size
    icagr: string,      // India CAGR
    gg:    string,      // Global market size
    gcagr: string,      // Global CAGR
    gc:    string,      // Global competitive context
    ist:   string,      // India status description
  },
  fin:  {
    gm:    string,      // Gross margin range
    eb:    string,      // EBITDA margin range
    capex: string,      // Capex intensity
    moat:  string,      // Competitive moat
  },
  str:  {
    fwd:   string,      // Forward integration path
    bwd:   string,      // Backward integration path
    org:   string,      // Organic growth path
    inorg: string,      // Inorganic/M&A path
  }
}
```

---

## Persistence (localStorage)
All data is stored under the `sg4_` prefix via `DB` in `db.js`:
```
sg4_wl           → Watchlist array
sg4_deals        → Deal pipeline array
sg4_session      → Auth session {email, exp, remember}
sg4_pwHash       → Hashed password
sg4_user_listed  → User-added listed companies
sg4_user_private → User-added private companies
sg4_apikey       → Anthropic API key (encrypted)
```

---

## Authentication
- Login form validates against hashed password in localStorage
- Default: `rajbordia23@gmail.com` / `SolarGrid@2025`
- Session: 8h normal, 30-day remember-me
- Change password in Settings page
- `doLogin()` in `auth.js`

---

## Stock Data Engine (`stocks.js`)
Multi-source with 3-proxy fallback:
1. **Stooq CSV** via allorigins proxy (primary)
2. **Yahoo Finance v8** via codetabs proxy
3. **Yahoo Finance v7** via corsproxy
Falls back to static COMPANIES database values if all sources fail.
Batch fetching: 5 companies per batch to avoid proxy rate limits.

---

## Adding a New Page
1. Create `src/components/my-page.js` with `function renderMyPage(){ return \`<div>...</div>\`; }`
2. Add nav item in `index.html` body: `<div class="pn" id="pn-mypage" onclick="goPage('mypage')">My Page</div>`
3. Add route in `navigation.js` → `renderPage()`: `else if(activePage==='mypage') main.innerHTML=renderMyPage();`
4. Add script tag in `index.html` before `app.js`

---

## Adding a New Company
**Via UI:** Valuation Matrix → "➕ Add Listed Company" button
**Via code:** Push to `COMPANIES` array in `companies.js` (follow the schema above)

---

## Working Popup System
Every calculated number is clickable. Call `showWorking({...})` with:
```javascript
showWorking({
  icon:        string,   // emoji
  title:       string,
  subtitle:    string,
  result:      string,   // headline value
  resultLabel: string,
  formula:     string,   // formula text
  steps:       [{label, calc, result}],
  sources:     [{name, color, note}],
  notes:       [{type, k, v}]
})
```

---

## AI Integration
- Model: `claude-sonnet-4-20250514`
- Tool: `web_search` (for live intelligence)
- API calls made client-side from browser
- API key stored in localStorage (Settings page or header input)
- `sendAI()` in `news-hub.js`, `generateAIReasoning()` in `ma-strategy.js`

---

## CSS Design System
All design tokens are CSS variables in `:root` (dark) and `[data-theme="light"]`:
```css
--bg, --s1, --s2, --s3    /* backgrounds */
--txt, --txt2, --txt3     /* text */
--br, --br2               /* borders */
--gold2, --green, --red   /* brand colours */
--cyan2, --orange         /* accent colours */
--greendim, --reddim, --golddim, --cyandim  /* tinted backgrounds */
```
