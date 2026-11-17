import { query } from '../db'

/**
 * Which columns a table has right now. Writers drop keys the table does not
 * have yet, so code that ships with a migration keeps working on the few
 * minutes (or the failed deploy) where the migration has not run.
 */
const cache = new Map<string, { at: number; cols: Set<string> }>()
const TTL_MS = 10 * 60_000

export async function tableColumns(table: string): Promise<Set<string>> {
  const hit = cache.get(table)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.cols
  const rows = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  )
  const cols = new Set(rows.map(r => r.column_name))
  cache.set(table, { at: Date.now(), cols })
  return cols
}

export function pick<T extends object>(row: T, cols: Set<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) if (cols.has(k)) out[k] = v
  return out
}
