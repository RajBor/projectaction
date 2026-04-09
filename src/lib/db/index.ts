import { Pool } from 'pg'
import dns from 'dns'

// Set custom DNS servers to resolve DNS issues
dns.setServers(['8.8.8.8', '8.8.4.4'])

const pool = new Pool({
  host: '54.209.204.248',
  port: 5432,
  user: 'neondb_owner',
  password: 'npg_xs50zYZcuPCG',
  database: 'neondb',
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  options: 'endpoint=ep-jolly-morning-amjam9ts',
})

/** Tagged template literal helper — same API as @neondatabase/serverless neon() */
async function sql(strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]> {
  const text = strings.reduce((acc, str, i) => acc + str + (i < values.length ? `$${i + 1}` : ''), '')
  const client = await pool.connect()
  try {
    const result = await client.query(text, values as any[])
    return result.rows
  } finally {
    client.release()
  }
}

export { sql, pool }
export default sql
