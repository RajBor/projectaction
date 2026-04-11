/**
 * One-shot repair: ensure the admin row has the intended email, username,
 * role, is_active, full_name AND the documented default password.
 *
 *   username: admin
 *   email:    abhilasharajbordia@gmail.com
 *   password: Adven@1234
 *
 * Run once: `node scripts/repair-admin.mjs`
 */
import pg from 'pg'
import bcrypt from 'bcryptjs'

const { Pool } = pg
const ADMIN_EMAIL = 'abhilasharajbordia@gmail.com'
const ADMIN_USERNAME = 'admin'
const ADMIN_FULL_NAME = 'Platform Admin'
const ADMIN_DEFAULT_PASSWORD = 'Adven@1234'

const pool = new Pool({
  host: '54.209.204.248',
  port: 5432,
  user: 'neondb_owner',
  password: 'npg_xs50zYZcuPCG',
  database: 'neondb',
  ssl: { rejectUnauthorized: false },
  options: 'endpoint=ep-jolly-morning-amjam9ts',
})

const c = await pool.connect()
try {
  const hash = await bcrypt.hash(ADMIN_DEFAULT_PASSWORD, 10)

  const existing = await c.query(
    'SELECT id, username, email FROM users WHERE username = $1 OR email = $2 LIMIT 1',
    [ADMIN_USERNAME, ADMIN_EMAIL]
  )

  if (existing.rows.length === 0) {
    await c.query(
      `INSERT INTO users (username, email, password_hash, full_name, role, is_active)
       VALUES ($1, $2, $3, $4, 'admin', TRUE)`,
      [ADMIN_USERNAME, ADMIN_EMAIL, hash, ADMIN_FULL_NAME]
    )
    console.log('INSERTED admin row')
  } else {
    const id = existing.rows[0].id
    await c.query(
      `UPDATE users
         SET username = $1,
             email = $2,
             password_hash = $3,
             full_name = $4,
             role = 'admin',
             is_active = TRUE
       WHERE id = $5`,
      [ADMIN_USERNAME, ADMIN_EMAIL, hash, ADMIN_FULL_NAME, id]
    )
    console.log(`UPDATED admin row id=${id}`)
  }

  // Verify
  const r = await c.query(
    'SELECT id, username, email, role, is_active, password_hash FROM users WHERE email = $1',
    [ADMIN_EMAIL]
  )
  const row = r.rows[0]
  const valid = await bcrypt.compare(ADMIN_DEFAULT_PASSWORD, row.password_hash)
  console.log('VERIFY:', {
    id: row.id,
    username: row.username,
    email: row.email,
    role: row.role,
    is_active: row.is_active,
    password_valid: valid,
  })
} finally {
  c.release()
  await pool.end()
}
