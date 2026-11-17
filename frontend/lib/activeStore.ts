import { resolveStore } from './access'

/**
 * @deprecated Use lib/access: `resolveStore(viewer, urlId)` for pages and
 * `requireStore(viewer, id)` for routes. Kept for the screens that still pass
 * a Clerk userId.
 *
 * The active store of a partner: the cookie's store when it belongs to the
 * account and is not archived, else the account's OLDEST active store — the
 * same answer lib/access gives everywhere else. (This used to skip the
 * archived check and default to the newest store, so the EPOCH login opened on
 * CAMP HALLOW while every list showed EPOCH first.) Returns userId when the
 * account has no store, as before.
 */
export async function getActiveTenantId(userId: string): Promise<string> {
  const { store } = await resolveStore({ kind: 'partner', userId }, null)
  return store?.id ?? userId
}
