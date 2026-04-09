const { Pool } = require('pg')
const fs = require('fs')
const path = require('path')

// Parse .env.local manually (no dotenv dependency needed)
const envPath = path.join(__dirname, '..', '.env.local')
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  for (const line of lines) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) process.env[match[1].trim()] = match[2].trim()
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
})

async function migrate() {
  const client = await pool.connect()
  try {
    console.log('Running migrations...')

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        full_name VARCHAR(100),
        role VARCHAR(20) DEFAULT 'analyst',
        created_at TIMESTAMP DEFAULT NOW(),
        last_login TIMESTAMP,
        is_active BOOLEAN DEFAULT true
      )
    `)

    console.log('✓ Migration complete: users table created/verified.')

    const bcrypt = require('bcryptjs')
    const passwordHash = await bcrypt.hash('admin123', 10)

    await client.query(`
      INSERT INTO users (username, email, password_hash, full_name, role)
      VALUES ('admin', 'admin@dealnector.com', $1, 'Admin User', 'admin')
      ON CONFLICT (username) DO NOTHING
    `, [passwordHash])

    console.log('✓ Seed complete: default admin user created (if not exists).')
    console.log('  Username: admin')
    console.log('  Password: admin123')
  } finally {
    client.release()
    await pool.end()
  }
  process.exit(0)
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message)
  process.exit(1)
})
