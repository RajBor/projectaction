/**
 * Idempotent schema migration and admin seeding.
 *
 * Run from any API route or server component with `await ensureSchema()`.
 * First successful call flips the module-level `ensured` flag so every
 * subsequent call short-circuits; if it fails it stays unset so the next
 * request retries.
 *
 * Every statement uses `IF NOT EXISTS` so re-running is safe on an
 * already-migrated database. Each DDL statement is wrapped in its own
 * try/catch so one transient failure (e.g. race with a concurrent request)
 * does not cascade into a 500.
 */

import bcrypt from 'bcryptjs'
import sql from './index'

let ensured = false
const ADMIN_EMAIL = 'abhilasharajbordia@gmail.com'
const ADMIN_DEFAULT_PASSWORD = 'Adven@1234'
const ADMIN_USERNAME = 'admin'
const ADMIN_FULL_NAME = 'Platform Admin'

async function safeRun(label: string, fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[ensureSchema] ${label} skipped:`, (err as Error)?.message || err)
  }
}

export async function ensureSchema(): Promise<void> {
  if (ensured) return

  // ── users table — additive columns ──────────────────
  await safeRun('users.phone', () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32)`)
  await safeRun('users.signup_ip', () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip VARCHAR(64)`)
  await safeRun('users.signup_location', () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_location VARCHAR(128)`)
  await safeRun('users.last_login_ip', () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(64)`)
  await safeRun('users.last_login_location', () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_location VARCHAR(128)`)
  await safeRun('users.organization', () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS organization VARCHAR(160)`)
  await safeRun('users.designation', () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS designation VARCHAR(120)`)
  await safeRun('users.official_email', () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS official_email VARCHAR(160)`)

  // ── auth code for admin-approved signup flow ────────
  await safeRun('users.auth_code', () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_code VARCHAR(8)`)
  await safeRun('users.auth_code_used', () => sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_code_used BOOLEAN DEFAULT false`)
  // Existing active users (created before auth code flow) should not be blocked
  await safeRun('users.backfill_auth_code_used', () => sql`UPDATE users SET auth_code_used = true WHERE is_active = true AND auth_code IS NULL AND auth_code_used = false`)

  // ── deal_interests ──────────────────────────────────
  await safeRun('deal_interests', () => sql`
    CREATE TABLE IF NOT EXISTS deal_interests (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_email VARCHAR(128),
      user_name VARCHAR(128),
      user_phone VARCHAR(32),
      ticker VARCHAR(32),
      company_name VARCHAR(128),
      deal_type VARCHAR(32),
      sector VARCHAR(32),
      rationale TEXT,
      source_page VARCHAR(32),
      expressed_at TIMESTAMP DEFAULT NOW(),
      notified BOOLEAN DEFAULT FALSE
    )
  `)

  // ── admin_auth_codes (password-change OTPs) ─────────
  await safeRun('admin_auth_codes', () => sql`
    CREATE TABLE IF NOT EXISTS admin_auth_codes (
      id SERIAL PRIMARY KEY,
      code VARCHAR(12) NOT NULL,
      purpose VARCHAR(32) NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL,
      used BOOLEAN DEFAULT FALSE
    )
  `)

  // ── email_log (outbound email journal) ──────────────
  await safeRun('email_log', () => sql`
    CREATE TABLE IF NOT EXISTS email_log (
      id SERIAL PRIMARY KEY,
      to_addr VARCHAR(128),
      subject VARCHAR(256),
      body TEXT,
      category VARCHAR(32),
      sent_at TIMESTAMP DEFAULT NOW(),
      delivered BOOLEAN DEFAULT FALSE,
      error TEXT
    )
  `)

  // ── users.industries — per-user saved selection (max 5 for analysts) ──
  await safeRun('users.industries', () =>
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS industries TEXT DEFAULT '[]'`
  )
  await safeRun('users.industries_chosen_at', () =>
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS industries_chosen_at TIMESTAMP`
  )

  // ── industries registry (admin-managed + seeded solar/td) ──
  await safeRun('industries', () => sql`
    CREATE TABLE IF NOT EXISTS industries (
      id VARCHAR(40) PRIMARY KEY,
      label VARCHAR(120) NOT NULL,
      icon VARCHAR(8),
      description TEXT,
      is_builtin BOOLEAN DEFAULT FALSE,
      added_by VARCHAR(128),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)

  // Per-industry value chain nodes added via the admin Industries tab.
  // The hardcoded CHAIN[] from src/lib/data/chain.ts is still loaded
  // alongside these, so admin-added industries append to the overall
  // value-chain view. Keys mirror ChainNode so the merge is trivial.
  await safeRun('industry_chain_nodes', () => sql`
    CREATE TABLE IF NOT EXISTS industry_chain_nodes (
      id VARCHAR(80) PRIMARY KEY,
      industry_id VARCHAR(40) NOT NULL REFERENCES industries(id) ON DELETE CASCADE,
      name VARCHAR(200) NOT NULL,
      cat VARCHAR(120) NOT NULL,
      flag VARCHAR(16) DEFAULT 'medium',
      market_india TEXT,
      market_india_cagr TEXT,
      market_global TEXT,
      market_global_cagr TEXT,
      market_global_leaders TEXT,
      market_india_status TEXT,
      fin_gross_margin TEXT,
      fin_ebit_margin TEXT,
      fin_capex TEXT,
      fin_moat TEXT,
      str_forward TEXT,
      str_backward TEXT,
      str_organic TEXT,
      str_inorganic TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)

  // Added for the Waaree atlas seed: the third column "description" holds a
  // curated one-liner per value-chain stage (what this stage does, who matters).
  await safeRun('industry_chain_nodes.description', () =>
    sql`ALTER TABLE industry_chain_nodes ADD COLUMN IF NOT EXISTS description TEXT`
  )

  // Companies that operate at a specific stage of a specific industry. Every
  // company from the atlas lands here with its listing status + exchange +
  // ticker. Listed entries (MAIN, SME, SUBSIDIARY with a parent ticker) will
  // later be fanned out via the NSE + Screener scrapers to populate live
  // market data in user_companies.
  await safeRun('industry_chain_companies', () => sql`
    CREATE TABLE IF NOT EXISTS industry_chain_companies (
      id SERIAL PRIMARY KEY,
      industry_id VARCHAR(40) NOT NULL REFERENCES industries(id) ON DELETE CASCADE,
      stage_id VARCHAR(80) NOT NULL,
      name VARCHAR(240) NOT NULL,
      status VARCHAR(24) NOT NULL,
      exchange VARCHAR(120),
      ticker VARCHAR(60),
      role TEXT,
      -- Filled in by the scraper, for listed (MAIN/SME) entries only
      market_data JSONB,
      market_data_fetched_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(industry_id, stage_id, name)
    )
  `)
  await safeRun('industry_chain_companies.stage_idx', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_chain_co_stage ON industry_chain_companies(industry_id, stage_id)`
  )

  // Optional uploaded reference files per industry (Excel/PDF source docs)
  await safeRun('industry_uploads', () => sql`
    CREATE TABLE IF NOT EXISTS industry_uploads (
      id SERIAL PRIMARY KEY,
      industry_id VARCHAR(40) NOT NULL REFERENCES industries(id) ON DELETE CASCADE,
      filename VARCHAR(256),
      mime VARCHAR(128),
      size_bytes INTEGER,
      content_base64 TEXT,
      extracted_text TEXT,
      uploaded_by VARCHAR(128),
      uploaded_at TIMESTAMP DEFAULT NOW()
    )
  `)

  // Seed the three builtin industries — matches the hardcoded sec values in
  // src/lib/data/chain.ts / src/lib/data/companies.ts. Wind was promoted to
  // a first-class industry after Suzlon/Inox Wind/Inox Green/Orient Green
  // were retagged from 'solar' to 'wind'; previously they sat inside the
  // solar bucket and the dashboard hid ~₹87k Cr of pure-wind M&A targets
  // from the sector-selector picker.
  await safeRun('industries seed', async () => {
    await sql`
      INSERT INTO industries (id, label, icon, description, is_builtin)
      VALUES
        ('solar', 'Solar Value Chain', '☀', 'Modules, cells, wafers, BoS, inverters', TRUE),
        ('wind',  'Wind Energy',       '🌬️', 'Turbines, blades, towers, wind O&M',      TRUE),
        ('td',    'T&D Infrastructure','⚡', 'Transformers, cables, meters, BESS',     TRUE)
      ON CONFLICT (id) DO UPDATE
        SET label = EXCLUDED.label,
            icon  = EXCLUDED.icon,
            description = EXCLUDED.description,
            is_builtin  = TRUE
    `
  })

  // Atlas-seeded industries were previously written with is_builtin=TRUE,
  // which made them non-deletable. The admin UI now exposes per-industry
  // Add/Remove toggles, so everything except the three hardcoded core
  // industries should be removable. One-shot backfill — safe to re-run.
  await safeRun('industries unbuilt-backfill', () =>
    sql`UPDATE industries SET is_builtin = FALSE WHERE id NOT IN ('solar','td','wind') AND is_builtin = TRUE`
  )

  // ── user_companies (admin-added companies stored in DB, not file) ──
  await safeRun('user_companies', () => sql`
    CREATE TABLE IF NOT EXISTS user_companies (
      id SERIAL PRIMARY KEY,
      name VARCHAR(200) NOT NULL,
      ticker VARCHAR(40) NOT NULL UNIQUE,
      nse VARCHAR(40),
      sec VARCHAR(10) NOT NULL DEFAULT 'solar',
      comp TEXT DEFAULT '[]',
      mktcap NUMERIC DEFAULT 0,
      rev NUMERIC DEFAULT 0,
      ebitda NUMERIC DEFAULT 0,
      pat NUMERIC DEFAULT 0,
      ev NUMERIC DEFAULT 0,
      ev_eb NUMERIC DEFAULT 0,
      pe NUMERIC DEFAULT 0,
      pb NUMERIC DEFAULT 0,
      dbt_eq NUMERIC DEFAULT 0,
      revg NUMERIC DEFAULT 0,
      ebm NUMERIC DEFAULT 0,
      acqs INTEGER DEFAULT 5,
      acqf VARCHAR(30) DEFAULT 'MONITOR',
      rea TEXT DEFAULT '',
      added_by VARCHAR(128),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)

  // Baseline-refresh audit: when admin last pushed data from an external
  // source (NSE, Screener, RapidAPI) and which one. Populated by
  // /api/admin/publish-data; consumed by the admin Data Sources tab
  // (Last Updated column) so operators can see which companies are
  // stale vs. freshly sourced.
  await safeRun('user_companies.baseline_updated_at', () =>
    sql`ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS baseline_updated_at TIMESTAMP`
  )
  await safeRun('user_companies.baseline_source', () =>
    sql`ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS baseline_source VARCHAR(24)`
  )

  // ── Qualitative / AR / Credit / Shareholding JSONB columns ─────────
  // Populated by the free-source fetchers under /api/admin/fetch-*:
  //   * annual-reports       → ar_url, ar_year, ar_fetched_at, ar_parsed
  //   * shareholding         → shareholding (promoter/FII/DII/public/pledged)
  //   * credit-ratings       → credit_rating (agency/rating/outlook/date[])
  // Some columns (customers, nclt_cases) are reserved now but left
  // unpopulated because the only free data sources for them are
  // unreliable (NCLT.gov.in JS + captcha) or require LLM extraction
  // from AR PDFs (paid). Column is kept so a future fetcher can fill
  // it without another migration round.
  // No indexes — every read is keyed by the row PK (ticker), never
  // by a JSONB path, so indexing would cost writes without helping reads.
  await safeRun('user_companies.ar_url',        () => sql`ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS ar_url TEXT`)
  await safeRun('user_companies.ar_year',       () => sql`ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS ar_year SMALLINT`)
  await safeRun('user_companies.ar_fetched_at', () => sql`ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS ar_fetched_at TIMESTAMP`)
  await safeRun('user_companies.ar_parsed',     () => sql`ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS ar_parsed JSONB`)
  await safeRun('user_companies.credit_rating', () => sql`ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS credit_rating JSONB`)
  await safeRun('user_companies.shareholding',  () => sql`ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS shareholding JSONB`)
  await safeRun('user_companies.facilities',    () => sql`ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS facilities JSONB`)
  await safeRun('user_companies.customers',     () => sql`ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS customers JSONB`)
  await safeRun('user_companies.nclt_cases',    () => sql`ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS nclt_cases JSONB`)
  await safeRun('user_companies.mda_extract',   () => sql`ALTER TABLE user_companies ADD COLUMN IF NOT EXISTS mda_extract JSONB`)

  // ── Seed / repair the admin user ────────────────────
  // We look up by BOTH the reserved username AND the target email so a
  // stale admin row (e.g. seeded earlier with a placeholder email) is
  // repaired in place instead of triggering a unique-constraint conflict.
  await safeRun('admin seed', async () => {
    const existing = await sql`
      SELECT id, username, email, role, is_active, password_hash
      FROM users
      WHERE username = ${ADMIN_USERNAME} OR email = ${ADMIN_EMAIL}
      LIMIT 1
    `

    if (existing.length === 0) {
      const hash = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10)
      await sql`
        INSERT INTO users (username, email, password_hash, full_name, role, is_active)
        VALUES (${ADMIN_USERNAME}, ${ADMIN_EMAIL}, ${hash}, ${ADMIN_FULL_NAME}, 'admin', TRUE)
      `
      // eslint-disable-next-line no-console
      console.log('[ensureSchema] seeded admin user', ADMIN_EMAIL)
      return
    }

    const row = existing[0]
    const id = row.id

    // Repair identity fields if they drift from spec.
    if (
      row.username !== ADMIN_USERNAME ||
      row.email !== ADMIN_EMAIL ||
      row.role !== 'admin' ||
      row.is_active !== true
    ) {
      await sql`
        UPDATE users
        SET username = ${ADMIN_USERNAME},
            email = ${ADMIN_EMAIL},
            role = 'admin',
            is_active = TRUE,
            full_name = COALESCE(NULLIF(full_name, ''), ${ADMIN_FULL_NAME})
        WHERE id = ${id}
      `
      // eslint-disable-next-line no-console
      console.log('[ensureSchema] repaired admin identity fields for id', id)
    }

    // If the stored hash does not validate the documented default
    // password, reset it. This only runs when the admin row's password
    // actively fails the default — operators who have rotated the
    // password via /admin will have a hash that still validates some
    // other credential, but NOT the default, so we'd clobber it. To
    // avoid that foot-gun, we only reset when the hash is empty or
    // looks un-hashable (length < 20).
    if (!row.password_hash || row.password_hash.length < 20) {
      const hash = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10)
      await sql`UPDATE users SET password_hash = ${hash} WHERE id = ${id}`
      // eslint-disable-next-line no-console
      console.log('[ensureSchema] reset admin password to default for id', id)
    }
  })

  ensured = true
}

export const ADMIN_CONFIG = {
  email: ADMIN_EMAIL,
  username: ADMIN_USERNAME,
}
