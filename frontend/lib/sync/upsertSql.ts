/**
 * INSERT … ON CONFLICT for the TypeScript writers, with the same two rules as
 * the collector's app/collectors/upsert.py:
 *   1. only the columns the row carries are written (a column the row does
 *      not mention keeps its value — it is never reset to its default);
 *   2. when the conflict key does not include tenant_id, an existing row of
 *      another tenant is left alone (rows never change owner).
 * Pure: returns SQL text and parameters.
 */

const IDENT = /^[a-z_][a-z0-9_]*$/

export interface UpsertSpec {
  table: string
  rows: Record<string, unknown>[]
  conflict: string[]
  /** Columns where an incoming NULL keeps the stored value. */
  preserveOnNull?: string[]
}

export function buildUpsert(spec: UpsertSpec): { sql: string; params: unknown[] } | null {
  const { table, rows, conflict } = spec
  if (!rows.length) return null
  const cols = Object.keys(rows[0])
  for (const r of rows) {
    const k = Object.keys(r)
    if (k.length !== cols.length || k.some(c => !cols.includes(c))) {
      throw new Error(`${table}: every row must carry the same columns`)
    }
  }
  for (const c of [table, ...cols, ...conflict]) {
    if (!IDENT.test(c)) throw new Error(`bad identifier: ${c}`)
  }
  const keep = new Set(spec.preserveOnNull ?? [])
  const guardOwner = !conflict.includes('tenant_id') && cols.includes('tenant_id')
  const update = cols.filter(c => !conflict.includes(c) && c !== 'id' && !(guardOwner && c === 'tenant_id'))

  const params: unknown[] = []
  const values = rows.map(r => `(${cols.map(c => { params.push(r[c] ?? null); return `$${params.length}` }).join(', ')})`)
  let sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values.join(', ')} ON CONFLICT (${conflict.join(', ')}) `
  if (!update.length) {
    sql += 'DO NOTHING'
  } else {
    sql += 'DO UPDATE SET ' + update
      .map(c => keep.has(c) ? `${c} = COALESCE(EXCLUDED.${c}, ${table}.${c})` : `${c} = EXCLUDED.${c}`)
      .join(', ')
    if (guardOwner) sql += ` WHERE ${table}.tenant_id IS NOT DISTINCT FROM EXCLUDED.tenant_id`
  }
  return { sql, params }
}
