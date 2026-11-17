import { requireStore, type StoreRef, type Viewer } from '../access'
import { attachAdAccount, describeForPicker, type AttachResult } from './adAccounts'
import { extraAccountCredentials, storeCredentials } from './credentials'
import { inspectToken, listAdAccounts, normalizeAdAccountId, readAdAccount } from './facebook'
import { HttpError, targetStore } from './http'
import { viewerKey } from './oauthState'
import { readPending } from './pending'
import type { FacebookPicker } from './types'

/**
 * The two halves of linking an ad account, shared by every route that does it
 * (the picker, the extra-account form, the current onboarding/settings screens
 * that still post to /api/tenant):
 *  - pickerFor(): which accounts can be linked to THIS store, read with the
 *    token of the OAuth just finished for it, or else the store's own token —
 *    never another store's (the old picker read the account's primary store).
 *  - linkAdAccount(): resolve the token, then attachAdAccount() enforces the
 *    ownership and one-store-per-account rules.
 */

/**
 * The store a Facebook request is about: the explicit id; else the store of
 * the Facebook login waiting in this browser (the current picker screens send
 * no id, and the active store may be a different one); else the active store.
 * Always re-checked against the viewer.
 */
export async function storeForFacebook(viewer: Viewer, explicitId: string | null, pendingCookie: string | undefined): Promise<StoreRef> {
  if (explicitId) return targetStore(viewer, explicitId)
  const pending = readPending(pendingCookie, viewerKey(viewer))
  if (pending) return requireStore(viewer, pending.storeId)
  return targetStore(viewer, null)
}

/** The tokens this store already holds, main first. */
async function storeTokens(storeId: string): Promise<string[]> {
  const [c, extras] = await Promise.all([storeCredentials(storeId), extraAccountCredentials(storeId)])
  const out: string[] = []
  if (c?.fbToken) out.push(c.fbToken)
  for (const e of extras) if (e.token && !out.includes(e.token)) out.push(e.token)
  return out
}

export async function pickerFor(viewer: Viewer, store: StoreRef, pendingCookie: string | undefined): Promise<FacebookPicker> {
  const pending = readPending(pendingCookie, viewerKey(viewer), store.id)
  let source: FacebookPicker['source'] = 'pending'
  let token = pending?.token ?? null
  if (!token) {
    source = 'store'
    token = (await storeTokens(store.id))[0] ?? null
  }
  if (!token) throw new HttpError(400, 'no_token', 'Esta loja ainda não tem acesso ao Facebook. Conecte o Facebook primeiro.')

  const listed = await listAdAccounts(token)
  if (!listed.ok) throw new HttpError(502, 'facebook_error', 'O Facebook não respondeu com as contas de anúncio. Tente de novo.')

  let tokenInfo: FacebookPicker['tokenInfo'] = null
  if (pending) {
    const info = await inspectToken(pending.token)
    let replacesPermanent = false
    if (pending.mode === 'main' && info && !info.neverExpires) {
      const current = (await storeCredentials(store.id))?.fbToken
      const before = current && current !== pending.token ? await inspectToken(current) : null
      replacesPermanent = !!before?.neverExpires
    }
    tokenInfo = info
      ? { ...info, replacesPermanent }
      : { valid: true, type: null, expiresAt: null, neverExpires: false, replacesPermanent }
  }

  return {
    storeId: store.id,
    storeName: store.name,
    source,
    mode: pending?.mode ?? null,
    accounts: await describeForPicker(viewer, store, listed.accounts),
    tokenInfo,
  }
}

export interface LinkRequest {
  adAccountId: unknown
  role: 'main' | 'extra' | null
  /** A token typed by the person (a system-user token, typically). */
  pastedToken?: unknown
  nickname?: unknown
  confirmReplacePermanent?: unknown
}

export async function linkAdAccount(
  viewer: Viewer, store: StoreRef, req: LinkRequest, pendingCookie: string | undefined,
): Promise<AttachResult & { usedPending: boolean }> {
  const adAccountId = normalizeAdAccountId(req.adAccountId)
  if (!adAccountId) throw new HttpError(400, 'invalid_account', 'ID de conta de anúncio inválido (ex.: act_123456789)')

  const pending = readPending(pendingCookie, viewerKey(viewer), store.id)
  const role = req.role ?? pending?.mode ?? 'main'
  let token: string | null = null
  let usedPending = false

  if (typeof req.pastedToken === 'string' && req.pastedToken.trim()) {
    token = req.pastedToken.trim()
    const info = await inspectToken(token)
    if (info && !info.valid) throw new HttpError(422, 'invalid_token', 'Este token do Facebook é inválido ou expirou.')
  } else if (pending) {
    token = pending.token
    usedPending = true
  } else {
    // The store's own tokens, the first that can read this account.
    for (const t of await storeTokens(store.id)) {
      if (await readAdAccount(t, adAccountId)) { token = t; break }
    }
    if (!token) {
      throw new HttpError(422, 'no_access', `Nenhum acesso do Facebook desta loja consegue ler a conta ${adAccountId}. Conecte o Facebook com um usuário que tenha acesso a ela.`)
    }
  }

  const result = await attachAdAccount(viewer, store, {
    adAccountId, role, token,
    nickname: typeof req.nickname === 'string' ? req.nickname : null,
    confirmReplacePermanent: req.confirmReplacePermanent === true,
  })
  return { ...result, usedPending }
}
