import { Pool } from 'pg'

/**
 * One connection pool per process.
 *
 * DATABASE_READ_ONLY=1 makes every transaction read-only at the server, so a
 * local copy of the app pointed at production cannot write by accident — the
 * database refuses, whatever the code tries.
 */

const globalForPg = globalThis as unknown as { pool?: Pool }

const readOnly = process.env.DATABASE_READ_ONLY === '1'

export const pool =
  globalForPg.pool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    // The engine prices every store in a handful of queries, so a request
    // holds few connections; the extra headroom is for the scheduler and
    // concurrent page loads, which used to queue behind a pool of five.
    max: Number(process.env.PG_POOL_MAX ?? 12),
    connectionTimeoutMillis: 15_000,
    idleTimeoutMillis: 30_000,
    // A hung query must not hold a page forever.
    options: `-c statement_timeout=30000${readOnly ? ' -c default_transaction_read_only=on' : ''}`,
  })

globalForPg.pool = pool

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const { rows } = await pool.query(sql, params)
  return rows as T[]
}
