/**
 * Idempotent schema migration and admin seeding.
 *
 * Run from any API route or server component with `await ensureSchema()`.
 * First call performs the DDL + seeds the admin user if missing; every
 * subsequent call short-circuits via an in-process flag.
 *
 * Every statement uses `IF NOT EXISTS` so re-running is safe on an
 * already-migrated database.
 */

import bcrypt from 'bcryptjs'
import sql from './index'

let ensured = false
const ADMIN_EMAIL = 'abhilasharajbordia@gmail.com'
const ADMIN_DEFAULT_PASSWORD = 'Adven@1234'
const ADMIN_USERNAME = 'admin'
const ADMIN_FULL_NAME = 'Platform Admin'

export async function ensureSchema(): Promise<void> {
  if (ensured) return
  try {
    // ── users table — additive columns ──────────────────
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(32)`
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_ip VARCHAR(64)`
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_location VARCHAR(128)`
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip VARCHAR(64)`
    await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_location VARCHAR(128)`

    // ── deal_interests ──────────────────────────────────
    await sql`
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
    `

    // ── admin_auth_codes (password-change OTPs) ─────────
    await sql`
      CREATE TABLE IF NOT EXISTS admin_auth_codes (
        id SERIAL PRIMARY KEY,
        code VARCHAR(12) NOT NULL,
        purpose VARCHAR(32) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        used BOOLEAN DEFAULT FALSE
      )
    `

    // ── email_log (outbound email journal) ──────────────
    await sql`
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
    `

    // ── Seed the admin user if missing ──────────────────
    const existing = await sql`
      SELECT id, role FROM users WHERE email = ${ADMIN_EMAIL} LIMIT 1
    `
    if (existing.length === 0) {
      const hash = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10)
      await sql`
        INSERT INTO users (username, email, password_hash, full_name, role, is_active)
        VALUES (${ADMIN_USERNAME}, ${ADMIN_EMAIL}, ${hash}, ${ADMIN_FULL_NAME}, 'admin', TRUE)
      `
      // eslint-disable-next-line no-console
      console.log('[ensureSchema] seeded admin user', ADMIN_EMAIL)
    } else if (existing[0].role !== 'admin') {
      // Promote the existing email holder if role drifted
      await sql`UPDATE users SET role = 'admin' WHERE email = ${ADMIN_EMAIL}`
    }

    ensured = true
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[ensureSchema] failed:', err)
    throw err
  }
}

export const ADMIN_CONFIG = {
  email: ADMIN_EMAIL,
  username: ADMIN_USERNAME,
}
