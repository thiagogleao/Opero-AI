/**
 * "último gasto em …" in Ajustes · Contas de anúncio must be the last day the
 * account actually spent. The collector writes rows with spend 0.00 for days
 * an ad ran without spending (Glooty: 16 and 17 nov at $0 after $75.77 on
 * 15 nov), so a plain MAX(date) said the ads were still spending two days
 * after they stopped — and contradicted the Resumo ("o último gasto foi em
 * 15 nov").
 *
 * listStoreAdAccounts runs its real SQL on Postgres (READ-ONLY session), but
 * over fixture rows: every query gets CTEs prepended that shadow tenants,
 * tenant_fb_accounts and fb_ad_daily_metrics, so no production row is read
 * and the result does not drift with the data. Credentials are mocked.
 *
 * Skipped when ../.env has no DATABASE_URL.
 */
import { afterAll, describe, expect, it, vi } from 'vitest'
import { shiftDate, todayInTz } from '@/lib/engine/dates'

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })

const env = await vi.hoisted(async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  let url: string | null = null
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), '..', '.env'), 'utf8')
    const m = text.match(/^DATABASE_URL=(.*)$/m)
    url = m ? m[1].trim().replace(/^["']|["']$/g, '') : null
  } catch { /* no .env */ }
  if (url) process.env.DATABASE_URL = url
  process.env.DATABASE_READ_ONLY = '1'
  return { hasDb: !!url }
})

const TZ = 'America/Sao_Paulo'
const today = todayInTz(TZ)
const d = (n: number) => shiftDate(today, -n)

/** [account (null = untagged main rows), date, spend] */
const ROWS: [string | null, string, number][] = [
  // Main account, untagged: spent on d5, then two $0 rows.
  [null, d(5), 75.77], [null, d(4), 0], [null, d(3), 0],
  // Main account, tagged with its own id: older spend, same account.
  ['act_main', d(6), 20],
  // Extra account: spent on d10, a $0 row on d2.
  ['act_extra', d(10), 10.5], ['act_extra', d(2), 0],
  // An account no longer linked that only ever wrote $0 rows.
  ['act_old', d(8), 0],
]

const lit = (v: string | null) => (v === null ? 'NULL::text' : `'${v.replace(/'/g, "''")}'::text`)
const FIXTURE =
  `WITH tenants (id, timezone) AS (VALUES ('fx'::text, '${TZ}'::text)),
   tenant_fb_accounts (id, tenant_id, fb_ad_account_id, nickname, is_active, fb_access_token, created_at) AS (
     VALUES (1::int, 'fx'::text, 'act_extra'::text, NULL::text, true, 'tok'::text, now())),
   fb_ad_daily_metrics (tenant_id, fb_ad_account_id, date, spend) AS (
     VALUES ${ROWS.map(([a, day, sp]) => `('fx'::text, ${lit(a)}, '${day}'::date, ${sp}::numeric)`).join(', ')})
  `

vi.mock('../credentials', () => ({
  storeCredentials: async (id: string) => ({
    id, shopifyDomain: null, shopifyToken: null, devDashboard: false, shopifyTokenExpiresAt: null,
    fbToken: 'tok', fbAdAccountId: 'act_main',
  }),
  extraAccountCredentials: async () => [],
}))

vi.mock('../../db', async (orig) => {
  const m = await orig<typeof import('../../db')>()
  return { ...m, query: (sql: string, params?: unknown[]) => m.query(FIXTURE + sql.trimStart(), params) }
})

const { listStoreAdAccounts } = await import('../adAccounts')
const { pool } = await import('../../db')

afterAll(async () => { if (env.hasDb) await pool.end() })

describe.skipIf(!env.hasDb)('listStoreAdAccounts · último gasto', () => {
  it('ignores $0 rows: the last spend is the last day with spend above zero', async () => {
    const rows = await listStoreAdAccounts('fx')
    const by = Object.fromEntries(rows.map(r => [r.adAccountId, r]))

    expect(by.act_main).toMatchObject({ role: 'main', lastSpendDate: d(5), spend30d: 95.77 })
    expect(by.act_extra).toMatchObject({ role: 'extra', lastSpendDate: d(10), spend30d: 10.5 })
    // Never spent: no "último gasto" line at all, rather than the date of a $0 row.
    expect(by.act_old).toMatchObject({ role: 'historical', lastSpendDate: null, spend30d: 0 })
  })
})
