# SolarGrid Pro — Claude Code Guide

## What This Project Is
A single-page institutional intelligence dashboard for India's solar and T&D value chain M&A strategy. Built for Waaree Energies' corporate strategy team. Vanilla JS, no framework. All logic runs in the browser from a single `index.html` entry point.

## Essential Commands
```bash
# Run locally (no build needed)
python3 -m http.server 3000
# OR
npx serve .
# Then open http://localhost:3000

# With Vite (hot reload)
npm install && npm run dev

# Build for production
npm run build
```

## Architecture in One Paragraph
All JS is global scope — no modules/imports. Scripts load in order via `<script>` tags in `index.html`. Data files define global arrays (`COMPANIES`, `CHAIN`, `POLICIES`, `PRIVATE_COMPANIES`). Utility files define helper objects (`DB`, `WL`, `Deals`, `UDB`). Component files define render functions like `renderDashboard()`. `navigation.js` owns `goPage(page)` and `renderPage()`. `app.js` runs last and calls `init()`.

## File Load Order (NEVER change this order)
1. `src/data/chain.js` → CHAIN[], GROUPS{}
2. `src/data/policies.js` → POLICIES[]
3. `src/data/companies.js` → COMPANIES[] (86 listed)
4. `src/data/private-companies.js` → PRIVATE_COMPANIES[] (28 private)
5. `src/utils/db.js` → DB, WL, Deals objects
6. `src/utils/auth.js` → doLogin(), bootApp()
7. `src/utils/stocks.js` → fetchStock(), clearStockCache()
8. `src/utils/helpers.js` → toast(), closeModal(), exportCSV()
9. `src/components/working-popups.js` → showWorking(), wkByTicker()
10. `src/components/hscrollbar.js` → hBarScroll(), hBarTrackClick()
11. `src/components/add-company.js` → UDB, mergeUserCompanies(), openAddCompanyModal()
12. `src/components/navigation.js` → goPage(), renderPage(), all state vars
13. `src/components/dashboard.js` → renderDashboard()
14. `src/components/value-chain.js` → renderValueChain()
15. `src/components/stocks-page.js` → renderStocksPage(), loadLivePriceBoard()
16. `src/components/ma-radar.js` → renderMARadar()
17. `src/components/valuation-matrix.js` → renderValuationPage(), renderVMTable()
18. `src/components/private-targets.js` → renderPrivatePage(), initPrivatePage()
19. `src/components/watchlist.js` → renderWatchlistPage()
20. `src/components/deal-tracker.js` → renderDealTrackerPage(), renderKanban()
21. `src/components/compare.js` → renderComparePage()
22. `src/components/news-hub.js` → renderNewsHub(), sendAI(), sendQ()
23. `src/components/dcf-calculator.js` → renderDCFPage(), computeDCF()
24. `src/components/ma-strategy.js` → renderMAStrategyPage(), generateAIReasoning()
25. `src/components/settings.js` → renderSettingsPage()
26. `src/app.js` → mergeUserCompanies() + init()

## Key Global State (all in navigation.js)
```js
let activePage = 'dashboard'     // current route
let activeComp = 'solar_modules' // active value chain segment
let compareList = []             // compare page queue
let dcfCompareList = []          // DCF comparison queue
let sortCol, sortDir             // valuation matrix sort
let fSec, fScore, fMaxEV, fSearch // valuation filters
```

## Routing
```js
goPage('dashboard')    // navigate to any page
// Valid IDs: dashboard, valuechain, stocks, maradar, private,
//            valuation, watchlist, dealtracker, compare,
//            newshub, dcf, settings, mastrategy
```

## Adding a New Page
1. Create `src/components/my-page.js`:
   ```js
   function renderMyPage() { return `<div class="phdr">...</div><div class="panel">...</div>`; }
   ```
2. Add nav item in `index.html` body inside `.nav-bar`:
   ```html
   <div class="pn" id="pn-mypage" onclick="goPage('mypage')">My Page</div>
   ```
3. Add route in `navigation.js` → `renderPage()`:
   ```js
   else if(activePage==='mypage') main.innerHTML=renderMyPage();
   ```
4. Add `<script src="./src/components/my-page.js"></script>` in `index.html` before `app.js`

## Adding a Company
**Listed company** — add object to `COMPANIES` array in `src/data/companies.js`:
```js
{name:"Company Name", ticker:"TICKER", nse:"TICKER", sec:"solar",
 comp:["solar_modules"], mktcap:1000, rev:500, ebitda:60, pat:40,
 ev:1200, ev_eb:20, pe:25, pb:3.2, dbt_eq:0.35, revg:22, ebm:12,
 acqs:7, acqf:"CONSIDER", rea:"Rationale text here"}
```

**Private company** — add to `PRIVATE_COMPANIES` in `src/data/private-companies.js`:
```js
{name:"Company Name", stage:"Pre-IPO", founded:2018, hq:"Mumbai",
 sec:"solar", comp:["solar_modules"], cap:"500 MW modules",
 rev_est:400, ev_est:2000, ebm_est:12, revg_est:35,
 tech:"TOPCon N-type bifacial", pli:"PLI applicant", almm:"ALMM listed",
 ipo:"IPO planned FY26", acqs:7, acqf:"CONSIDER",
 rea:"Rationale text here"}
```

## Adding a Value Chain Segment
Add to `CHAIN` array in `src/data/chain.js`, then add to the appropriate `GROUPS` object.
```js
{id:"new_segment", name:"Segment Name", cat:"Solar → Category",
 sec:"solar", flag:"high",
 mkt:{ig:"₹2,000Cr",icagr:"25%",gg:"$8B",gcagr:"18%",
      gc:"Global leaders description",ist:"India status description"},
 fin:{gm:"30-40%",eb:"15-20%",capex:"Moderate",moat:"Moat description"},
 str:{fwd:"Forward integration path",bwd:"Backward integration path",
      org:"Organic growth",inorg:"M&A strategy"}}
```

## CSS Design System
All colours are CSS variables. Use these in new components:
```css
/* Backgrounds */ var(--bg) var(--s1) var(--s2) var(--s3)
/* Text */       var(--txt) var(--txt2) var(--txt3)
/* Borders */    var(--br) var(--br2)
/* Brand */      var(--gold2) var(--green) var(--red)
/* Accents */    var(--cyan2) var(--orange)
/* Tinted bg */  var(--greendim) var(--reddim) var(--golddim) var(--cyandim)
```

Standard layout blocks:
```html
<div class="phdr">        <!-- page header with breadcrumb + title + meta -->
  <div class="phdr-breadcrumb">X <span>›</span> Y</div>
  <div class="phdr-title">Title <em>Styled</em></div>
  <div class="phdr-meta"><span class="badge b-gold">Tag</span></div>
</div>
<div class="panel">       <!-- main content area -->
  <div class="stitle">Section Title</div>
  <div class="card">...</div>      <!-- white card -->
  <div class="g2">...</div>        <!-- 2-col grid -->
  <div class="g3">...</div>        <!-- 3-col grid -->
  <div class="krow">               <!-- KPI row -->
    <div class="kpi">...</div>
  </div>
  <div class="tw"><table>...</table></div>  <!-- scrollable table wrapper -->
</div>
```

Badge classes: `b-green b-red b-gold b-blue b-cyan b-orange b-gray b-purple`

Score circle: `<div class="score s8">8</div>` (s1-s10, colours auto)

## Persistence
```js
DB.get('key', default)   // read from localStorage (sg4_ prefix auto-added)
DB.set('key', value)     // write to localStorage
WL.add(co)               // add company to watchlist
WL.all()                 // get all watchlist items
Deals.add({...})         // add deal to pipeline
UDB.addListed(co)        // persist user-added listed company
UDB.addPrivate(co)       // persist user-added private company
```

## Auth
Login: `rajbordia23@gmail.com` / `SolarGrid@2025`  
Change in Settings page → saves hashed to localStorage `sg4_pwHash`

## AI Features
Enter Anthropic API key in header input or Settings page.  
Model: `claude-sonnet-4-20250514` with `web_search` tool.  
Used in: M&A Strategy → AI Reasoning tab, Value Chain → AI Intel tab, News Hub.

## Working Popup (calculation methodology)
To make any number clickable with a "how was this calculated" modal:
```js
// In HTML template:
onclick="showWorking({icon:'📊', title:'Metric Name', subtitle:'What it measures',
  result:'42×', resultLabel:'EV/EBITDA',
  formula:'Enterprise Value ÷ EBITDA',
  steps:[{label:'Step 1', calc:'Revenue × EBITDA%', result:'₹84Cr'}],
  sources:[{name:'Source', color:'var(--gold2)', note:'description'}]})"

// Or use the safe ticker-based helper:
onclick="wkByTicker('POLYCAB', 'ev_eb')"
```

## Stock Data
```js
const result = await fetchStock('POLYCAB', '.NS');
// Returns: {price, chg, chgPct, high52, low52, vol, mktcap, closes[], ok, source}
// source: 'stooq' | 'yahoo_v8' | 'yahoo_v7' | 'static'

clearStockCache();  // force fresh fetch
```

## Common Gotchas
- **Template literals**: Nested template literals must use `\`` inside outer template literals
- **onclick attributes**: Never put complex objects in onclick — use `wkByTicker(ticker, metric)` pattern
- **Single quotes in strings**: Escape apostrophes in JS strings: `India\\'s` not `India's`
- **Multiline strings**: Use `\n` not actual newlines inside single-quoted strings
- **DOM timing**: Page HTML is set via `innerHTML`. Use `setTimeout(fn, 50)` for post-render init

## Running Tests Manually
There are no automated tests. To verify a page renders correctly:
1. Open `index.html` via `npx serve .` or `python3 -m http.server 3000`
2. Login with credentials above
3. Click through all nav items and verify no console errors
4. Use browser DevTools → Console to check for JS errors
5. Use the 🔧 Diagnose button on the Live Stocks page to test data sources

## Git Workflow
```bash
git add src/components/my-page.js
git add index.html   # if you added a new script tag
git commit -m "feat: add new page description"
git push
```
