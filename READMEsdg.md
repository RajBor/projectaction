# Dealnector Website Integration

A production-ready Next.js 14 app that embeds the **Dealnector Inorganic Growth Strategy Engine** and powers it with admin-managed, API-served trade-flow, policy-regime, and target-company intelligence.

## Quickstart with Claude Code

This project is designed to be extended and maintained using [Claude Code](https://docs.claude.com/en/docs/claude-code). A `CLAUDE.md` file at the repo root teaches Claude how the architecture fits together — open it before your first Claude Code session.

```bash
# 1. Clone and enter
git clone <your-repo-url> dealnector-integration
cd dealnector-integration

# 2. Install dependencies
npm install

# 3. Copy .env.example → .env.local, fill in secrets
cp .env.example .env.local
#   Required values:
#     ANTHROPIC_API_KEY         (for /api/ai-analyst)
#     DEALNECTOR_API_KEY        (random bearer token for engine → API calls)
#     DEALNECTOR_ADMIN_PASSWORD (for the /admin panel)

# 4. Seed default data (idempotent)
npm run seed

# 5. Copy the engine HTML into public/
# Download dealnector-strategy-engine.html from the output folder
# and place it at: public/dealnector-strategy-engine.html

# 6. Run
npm run dev
# → http://localhost:3000          (engine embed)
# → http://localhost:3000/login    (admin login)
# → http://localhost:3000/admin    (data management after login)

# 7. Start Claude Code in this directory
claude
```

When you start Claude Code, it reads `CLAUDE.md` automatically and understands the architecture, data flow, security posture, and extension points.

## What this project does

**Three data flow paths into the engine — all unified:**

1. **Host injection** — this Next.js app fetches all four data stores server-side, serialises them into `window.DEALNECTOR_DATA`, and the engine reads them before its first render. Zero round-trips from the browser.
2. **API fallback** — if host injection is not possible (e.g., when serving the engine from a CDN), the engine calls this app's `/api/*` endpoints with `Authorization: Bearer $DEALNECTOR_API_KEY`.
3. **Excel upload** — users can still upload their own multi-sheet xlsx at runtime to override any store — this is handled entirely inside the engine and does not touch this app.

**AI-powered deal memo generation** — the `/api/ai-analyst` route uses Anthropic's Claude Sonnet 4.5 to produce boardroom-grade investment thesis for any target company, streaming results back to the client with full context from the Dealnector data stores.

## Project layout

```
app/
  page.tsx                    Main embed page
  layout.tsx                  Root layout
  login/page.tsx              Admin login form
  admin/page.tsx              JSON editor for all 4 data stores
  api/
    value-chain/route.ts      GET industries → VC → sub-segments
    trade-flows/route.ts      GET trade-flow matrix (with filters)
    policy-regime/route.ts    GET policy scores per country
    companies/route.ts        GET filtered target company universe
    ai-analyst/route.ts       POST streaming AI deal memo
    admin/
      login/route.ts          POST sets session cookie
      data/route.ts           GET/POST per-store CRUD
components/
  DealnectorEngine.tsx        React wrapper — iframe + data injection
lib/
  data-store.ts               File-backed JSON store (swappable)
  auth.ts                     Bearer + admin session helpers
  anthropic-client.ts         Anthropic SDK wrapper
data/
  value-chain.json            Industry × VC × sub-segment tree
  trade-flows.json            Sub-segment × country matrix
  policy-regime.json          Country policy scores + incentives
  companies.json              Target company universe
public/
  dealnector-strategy-engine.html   (copy this file from the engine repo)
scripts/
  seed.ts                     Populates data/ with defaults
CLAUDE.md                     Architecture guide for Claude Code
```

## Extending

**Swap the file-backed store for Postgres:**
Replace `lib/data-store.ts` — its contract is three functions: `read(store)`, `write(store, data)`, `patch(store, id, patch)`. Swap the `fs` implementation for a DB client — nothing else changes.

**Add a live third-party feed (e.g., S&P Capital IQ):**
1. Create `lib/capital-iq.ts` with a client that returns data in the Dealnector schema.
2. Modify `app/api/companies/route.ts` to call the live source, falling back to the file store on error.
3. Wrap with `unstable_cache` or `revalidateTag` to control refresh cadence.

**Swap the AI model for heavier memos:**
In `app/api/ai-analyst/route.ts`, import `MODEL_DEEP` from `lib/anthropic-client.ts` and pass it to `anthropic.messages.stream` for Claude Opus 4.5.

## Security

- All `/api/*` GET routes require `Authorization: Bearer $DEALNECTOR_API_KEY`.
- `/admin` and `/api/admin/*` require a session cookie set by `/api/admin/login`.
- The engine iframe runs with `sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"` — it cannot navigate the parent or touch parent cookies.
- Never commit `.env.local`.

## Deployment

Works out of the box on Vercel, Railway, Fly.io, or any Node host.
For Vercel: connect the repo, add the env vars in project settings, deploy.
For self-host with file-backed data: ensure the runtime can write to `./data/` (use a volume mount in Docker).

## License

Proprietary — all rights reserved.
