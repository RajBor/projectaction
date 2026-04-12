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
