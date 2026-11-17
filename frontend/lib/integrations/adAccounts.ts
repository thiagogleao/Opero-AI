import { query } from '../db'
import { AccessError, listStores, requireStore, type StoreRef, type Viewer } from '../access'
import { shiftDate, todayInTz } from '../engine/dates'
import { storeCredentials, extraAccountCredentials } from './credentials'
import { inspectToken, readAdAccount, type GraphAdAccount } from './facebook'
import { HttpError } from './http'
import { withTransaction } from './stores'
import type { ExtraFbAccount, PickerAdAccount, StoreAdAccount } from './types'
import { isoSql } from './sql'

/**
 * A store's Meta ad accounts: the "main" one (tenants.fb_ad_account_id, rows
 * collected untagged) and the "extra" ones (tenant_fb_accounts, rows tagged
 * with the account id).
 *
 * Rules enforced here:
 *  - An ad account belongs to one store. The collector upserts ad rows on
 *    (ad_id, date) alone, so an account linked to two stores — or as main and
 *    extra of the same store — makes its spend hop to whichever synced last.
 *  - Pausing an extra account stops collecting it. Its history stays in the
 *    books (the engine counts every row of the store), and so does the history
 *    of an account that is removed; it is then listed as "historical".
 *  - A permanent (system-user) token is never silently replaced by a 60-day
 *    user token: the caller must confirm, knowing when it will expire.
 */

interface AttachmentRow { store_id: string; role: 'main' | 'extra' }

async function attachments(adAccountId: string, run: (sql: string, p: unknown[]) => Promise<AttachmentRow[]>): Promise<AttachmentRow[]> {
  return run(
    `SELECT id AS store_id, 'main' AS role FROM tenants WHERE fb_ad_account_id = $1
     UNION ALL
     SELECT tenant_id AS store_id, 'extra' AS role FROM tenant_fb_accounts WHERE fb_ad_account_id = $1`,
    [adAccountId],
  )
}

export async function listStoreAdAccounts(storeId: string): Promise<StoreAdAccount[]> {
  const creds = await storeCredentials(storeId)
  if (!creds) return []
  const extras = await query<{ id: number; fb_ad_account_id: string; nickname: string | null; is_active: boolean; has_token: boolean }>(
    `SELECT id, fb_ad_account_id, nickname, is_active, (COALESCE(fb_access_token, '') <> '') AS has_token
       FROM tenant_fb_accounts WHERE tenant_id = $1 ORDER BY created_at, id`,
    [storeId],
  )
  // Untagged rows are the main account's (current or past); tagged rows name
  // their account.
  // "30 dias" = the 30 complete days ending yesterday in the store's own
  // timezone, the same window the rest of the app calls "30 dias".
  const spend = await query<{ acct: string | null; spend30d: number; last: string | null }>(
    `SELECT m.fb_ad_account_id AS acct,
            COALESCE(SUM(m.spend) FILTER (
              WHERE m.date BETWEEN (now() AT TIME ZONE t.timezone)::date - 30
                               AND (now() AT TIME ZONE t.timezone)::date - 1), 0)::float8 AS spend30d,
            MAX(m.date)::text AS last
       FROM fb_ad_daily_metrics m JOIN tenants t ON t.id = m.tenant_id
      WHERE m.tenant_id = $1
      GROUP BY 1`,
    [storeId],
  )
  const spendOf = new Map(spend.map(s => [s.acct ?? '', s]))
  const out: StoreAdAccount[] = []
  const listed = new Set<string>()
  if (creds.fbAdAccountId) {
    const parts = [spendOf.get(''), spendOf.get(creds.fbAdAccountId)].filter(Boolean) as { spend30d: number; last: string | null }[]
    const last = parts.map(p => p.last).filter((d): d is string => !!d).sort().pop() ?? null
    out.push({
      id: null, adAccountId: creds.fbAdAccountId, role: 'main', nickname: null,
      syncing: !!creds.fbToken, hasToken: !!creds.fbToken,
      spend30d: round2(parts.reduce((t, p) => t + p.spend30d, 0)), lastSpendDate: last,
    })
    listed.add(creds.fbAdAccountId)
  }
  for (const e of extras) {
    const s = spendOf.get(e.fb_ad_account_id)
    out.push({
      id: e.id, adAccountId: e.fb_ad_account_id, role: 'extra', nickname: e.nickname,
      syncing: e.is_active && e.has_token, hasToken: e.has_token,
      spend30d: round2(s?.spend30d ?? 0), lastSpendDate: s?.last ?? null,
    })
    listed.add(e.fb_ad_account_id)
  }
  for (const s of spend) {
    if (!s.acct || listed.has(s.acct)) continue
    out.push({
      id: null, adAccountId: s.acct, role: 'historical', nickname: null, syncing: false, hasToken: false,
      spend30d: round2(s.spend30d), lastSpendDate: s.last,
    })
  }
  return out
}

const round2 = (n: number) => Math.round(n * 100) / 100

export async function listExtraAccountsLegacy(storeId: string): Promise<ExtraFbAccount[]> {
  return query<ExtraFbAccount>(
    `SELECT id, tenant_id, fb_ad_account_id, nickname, is_active, ${isoSql('created_at')} AS created_at
       FROM tenant_fb_accounts WHERE tenant_id = $1 ORDER BY created_at, id`,
    [storeId],
  )
}

/** Picker rows: what the token can read, and where each account already is. */
export async function describeForPicker(viewer: Viewer, store: StoreRef, accounts: GraphAdAccount[]): Promise<PickerAdAccount[]> {
  if (accounts.length === 0) return []
  const rows = await query<{ acct: string; store_id: string; role: 'main' | 'extra' }>(
    `SELECT fb_ad_account_id AS acct, id AS store_id, 'main' AS role FROM tenants WHERE fb_ad_account_id = ANY($1::text[])
     UNION ALL
     SELECT fb_ad_account_id, tenant_id, 'extra' FROM tenant_fb_accounts WHERE fb_ad_account_id = ANY($1::text[])`,
    [accounts.map(a => a.id)],
  )
  const visible = new Map((await listStores(viewer, { includeArchived: true })).map(s => [s.id, s.name]))
  return accounts.map(a => {
    const here = rows.find(r => r.acct === a.id && r.store_id === store.id)
    const elsewhere = rows.find(r => r.acct === a.id && r.store_id !== store.id)
    return {
      id: a.id,
      name: a.name,
      accountStatus: a.account_status,
      active: a.account_status === 1,
      attachedHere: here?.role ?? null,
      attachedElsewhere: !!elsewhere,
      // Another account's store is never named to a partner.
      attachedElsewhereTo: elsewhere ? visible.get(elsewhere.store_id) ?? null : null,
    }
  })
}

export interface AttachInput {
  adAccountId: string
  role: 'main' | 'extra'
  token: string
  nickname?: string | null
  confirmReplacePermanent?: boolean
}

export interface AttachResult {
  account: StoreAdAccount
  /** Collection only fetches the last couple of days: the caller should start a
   *  backfill for this store from this date (POST /api/refresh). */
  backfillFrom: string
  warning: string | null
}

export async function attachAdAccount(viewer: Viewer, store: StoreRef, input: AttachInput): Promise<AttachResult> {
  const { adAccountId, role, token } = input
  if (store.archived) throw new HttpError(409, 'store_archived', 'Esta loja está arquivada. Desarquive antes de ligar contas.')

  const graph = await readAdAccount(token, adAccountId)
  if (!graph) throw new HttpError(422, 'no_access', `Este acesso do Facebook não consegue ler a conta ${adAccountId}.`)

  const creds = await storeCredentials(store.id)
  const currentToken = role === 'main'
    ? creds?.fbToken ?? null
    : (await extraAccountCredentials(store.id)).find(e => e.adAccountId === adAccountId)?.token ?? null
  if (currentToken && currentToken !== token && !input.confirmReplacePermanent) {
    const [before, after] = await Promise.all([inspectToken(currentToken), inspectToken(token)])
    if (before?.neverExpires && after && !after.neverExpires) {
      throw new HttpError(409, 'replaces_permanent_token',
        'A chave atual desta conta é permanente; a nova vence' +
        (after.expiresAt ? ` em ${after.expiresAt.slice(0, 10)}` : '') +
        '. Confirme para trocar mesmo assim.',
        { expiresAt: after.expiresAt })
    }
  }

  const visible = new Map((await listStores(viewer, { includeArchived: true })).map(s => [s.id, s.name]))
  await withTransaction(async c => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fb:${adAccountId}`])
    const found = await attachments(adAccountId, async (sql, p) => (await c.query<AttachmentRow>(sql, p)).rows)
    const elsewhere = found.find(r => r.store_id !== store.id)
    if (elsewhere) {
      const name = visible.get(elsewhere.store_id)
      throw new HttpError(409, 'attached_elsewhere',
        name ? `A conta ${adAccountId} já está ligada à loja ${name}.` : `A conta ${adAccountId} já está ligada a outra loja.`)
    }
    if (role === 'main' && found.some(r => r.role === 'extra')) {
      throw new HttpError(409, 'already_extra', `A conta ${adAccountId} já é conta extra desta loja. Remova-a das extras antes.`)
    }
    if (role === 'extra' && found.some(r => r.role === 'main')) {
      throw new HttpError(409, 'already_main', `A conta ${adAccountId} já é a conta principal desta loja.`)
    }
    if (role === 'main') {
      const r = await c.query(
        `UPDATE tenants SET fb_ad_account_id = $2, fb_access_token = $3, updated_at = now() WHERE id = $1`,
        [store.id, adAccountId, token])
      if (r.rowCount !== 1) throw new AccessError(404)
    } else {
      await c.query(
        `INSERT INTO tenant_fb_accounts (tenant_id, fb_ad_account_id, fb_access_token, nickname, is_active)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (tenant_id, fb_ad_account_id) DO UPDATE SET
           fb_access_token = EXCLUDED.fb_access_token,
           nickname        = COALESCE(EXCLUDED.nickname, tenant_fb_accounts.nickname),
           is_active       = true`,
        [store.id, adAccountId, token, input.nickname?.trim() || null])
    }
  })

  const account = (await listStoreAdAccounts(store.id)).find(a => a.adAccountId === adAccountId && a.role === role)
  if (!account) throw new HttpError(500, 'save_failed', 'A conta não foi salva. Tente de novo.')
  // The store's own calendar, like every other date in the app (a UTC date is
  // already "tomorrow" for Hibikura's Tokyo afternoon).
  const from = shiftDate(todayInTz(store.timezone), -30)
  return {
    account,
    backfillFrom: from,
    warning: graph.account_status === 1 ? null : 'Esta conta está desativada no Meta e não será coletada.',
  }
}

/** The extra-account row, after checking the viewer may see its store. */
export async function ownedExtraAccount(viewer: Viewer, rowId: string): Promise<{ id: number; store: StoreRef }> {
  if (!/^\d{1,10}$/.test(rowId)) throw new AccessError(404)
  const [row] = await query<{ id: number; tenant_id: string }>(
    `SELECT id, tenant_id FROM tenant_fb_accounts WHERE id = $1`, [Number(rowId)])
  if (!row) throw new AccessError(404)
  return { id: row.id, store: await requireStore(viewer, row.tenant_id) }
}

export async function updateExtraAccount(
  storeId: string, rowId: number, patch: { isActive?: boolean; nickname?: string | null },
): Promise<ExtraFbAccount> {
  const sets: string[] = []
  const vals: unknown[] = [storeId, rowId]
  if (patch.isActive !== undefined) sets.push(`is_active = $${vals.push(patch.isActive)}`)
  if (patch.nickname !== undefined) sets.push(`nickname = $${vals.push(patch.nickname?.trim() || null)}`)
  if (sets.length === 0) throw new HttpError(400, 'nothing_to_update', 'Nada para atualizar (is_active ou nickname)')
  const [row] = await query<ExtraFbAccount>(
    `UPDATE tenant_fb_accounts SET ${sets.join(', ')}
      WHERE tenant_id = $1 AND id = $2
      RETURNING id, tenant_id, fb_ad_account_id, nickname, is_active, ${isoSql('created_at')} AS created_at`,
    vals)
  if (!row) throw new AccessError(404)
  return row
}

/** Unlink an extra account: collection stops, its past spend stays in the store. */
export async function removeExtraAccount(storeId: string, rowId: number): Promise<{ adAccountId: string }> {
  const [row] = await query<{ fb_ad_account_id: string }>(
    `DELETE FROM tenant_fb_accounts WHERE tenant_id = $1 AND id = $2 RETURNING fb_ad_account_id`,
    [storeId, rowId])
  if (!row) throw new AccessError(404)
  return { adAccountId: row.fb_ad_account_id }
}
