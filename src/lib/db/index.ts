import { Pool } from 'pg'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
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
