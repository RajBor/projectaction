# Dealnector Website Integration

This is a **Next.js 14 App Router** project that embeds the Dealnector M&A Strategy Engine into a host website with admin-managed data sources.

## Architecture in one page

```
┌─ Host website (this Next.js app) ──────────────────────────────────────┐
│                                                                         │
│  ┌─ / (embed)              ┌─ /admin                                   │
│  │  <DealnectorEngine />   │  Edit Trade / Policy / Company records    │
│  │  injects data via       │  Writes to ./data/*.json                  │
│  │  window.DEALNECTOR_DATA │                                            │
│  └──────────┬──────────────┴──────────┬─────────────────────────────── │
│             │                         │                                 │
│             ▼                         ▼                                 │
│  /api/value-chain   /api/trade-flows   /api/policy-regime   /api/companies
│             │                         │                                 │
│             └──────────┬──────────────┘                                 │
│                        ▼                                                │
│               ./data/*.json (file-backed store)                         │
│                                                                         │
│  /api/ai-analyst  →  Anthropic API  (Claude Sonnet 4.5)                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data flow priority (handled by Dealnector engine itself)

1. **Host injection** — this app injects `window.DEALNECTOR_DATA` with server-fetched data before the iframe/script loads the engine. **Highest priority.**
2. **Excel upload** — user uploads a multi-sheet xlsx to override any store at runtime.
3. **API fallback** — engine polls `DEALNECTOR_CONFIG.apiEndpoint` if host injection didn't populate a store.
4. **Default seeded data** — baked into the engine HTML as last resort.

This project exercises paths 1 and 3 simultaneously: admin-managed JSON → API route → injected into the page.

## Commands

```bash
npm install                  # install deps
npm run dev                  # local dev server on :3000
npm run build && npm start   # production build
npm run seed                 # seed ./data/ with defaults from the Dealnector engine
```

## Environment variables

Create `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...       # for the /api/ai-analyst route
DEALNECTOR_ADMIN_PASSWORD=...      # protects /admin
DEALNECTOR_API_KEY=...             # Bearer token required on GET /api/*
NEXT_PUBLIC_ENGINE_URL=/dealnector-strategy-engine.html
```

## File layout

```
app/
  page.tsx                    Home / embed page
  admin/page.tsx              CRUD UI for all 4 data stores
  api/value-chain/route.ts    GET returns industries → VC → sub-segments
  api/trade-flows/route.ts    GET returns subsegment × country matrix
  api/policy-regime/route.ts  GET returns country policy scores
  api/companies/route.ts      GET returns filterable target universe
  api/ai-analyst/route.ts     POST returns AI-generated deal memo
components/
  DealnectorEngine.tsx        React wrapper that hosts the engine iframe + injects data
  AdminPanel.tsx              Tabbed CRUD UI
lib/
  data-store.ts               File-backed JSON store (swap for Postgres/Supabase easily)
  anthropic-client.ts         Wrapped Anthropic SDK client
public/
  dealnector-strategy-engine.html   The engine — copy here from output
data/
  value-chain.json
  trade-flows.json
  policy-regime.json
  companies.json
```

## How Claude Code should approach changes

**When modifying the engine:**
- The engine is a standalone HTML file at `public/dealnector-strategy-engine.html`. Treat it as a black box — changes to the engine should be made in the source repo, then copied into `public/` as a build artefact.
- Do not edit the engine HTML directly in this project.

**When adding data fields:**
1. Add the field to the JSON schema in `data/*.json`.
2. Add it to the return type in the corresponding `app/api/*/route.ts` handler.
3. Add it to the `AdminPanel.tsx` form.
4. Coordinate with the engine team so the engine's scoring functions consume it.

**When adding a new data source (e.g., live S&P CapitalIQ feed):**
1. Add a new adapter in `lib/` (e.g., `lib/capital-iq.ts`).
2. Modify the corresponding route handler to fetch from the adapter, falling back to the file store on error.
3. Cache aggressively — rate-limit external APIs via `unstable_cache` or `revalidateTag`.

**When adding AI-powered features:**
- Use `lib/anthropic-client.ts`. Use `claude-sonnet-4-5` for fast interactive analysis, `claude-opus-4-5` for heavyweight deal memos.
- Stream responses for anything over 500 tokens — users should never stare at a blank screen.
- Always include the relevant subset of Dealnector data (target company, trade flows, policy regime) in the system prompt so Claude has context.

## Security posture

- All `/api/*` GET endpoints require `Authorization: Bearer $DEALNECTOR_API_KEY`.
- `/admin` requires session cookie set by logging in with `DEALNECTOR_ADMIN_PASSWORD`.
- `/api/ai-analyst` enforces the admin session — it is not user-facing.
- The engine iframe runs `sandbox="allow-scripts allow-same-origin"` — it cannot navigate the parent window or access parent cookies.

## Extending to Postgres / Supabase

Replace `lib/data-store.ts` — its interface is `read(store)`, `write(store, data)`, `patch(store, id, patch)`. Swap the fs implementation for a DB client and keep the rest of the app unchanged.
