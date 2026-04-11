import pg from 'pg'
import bcrypt from 'bcryptjs'
const { Pool } = pg
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
  const r = await c.query(
    "SELECT id, username, email, role, is_active, password_hash FROM users WHERE email='abhilasharajbordia@gmail.com' OR username='admin'"
  )
  console.log('ROWS:', r.rows.length)
  for (const row of r.rows) {
    const valid = await bcrypt.compare('Adven@1234', row.password_hash || '')
    console.log({
      id: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
      is_active: row.is_active,
      hash_len: (row.password_hash || '').length,
      'Adven@1234_valid': valid,
    })
  }
} finally {
  c.release()
  await pool.end()
}
