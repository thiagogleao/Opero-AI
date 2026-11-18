import { listStores, requireStore, type StoreRef, type Viewer } from '@/lib/access'
import { HttpError } from '@/lib/integrations/http'
import { normalizeShopDomain } from '@/lib/integrations/shopify'

/**
 * Owner decision: an archived store is kept for consultation only. Its history
 * stays readable everywhere, but nothing about it may change — costs, ad
 * accounts (link, pause, rename, unlink), the Shopify connection, onboarding
 * flags. The one write left is restoring it (PATCH /api/stores/:id
 * { archived: false }), which is how it becomes editable again.
 *
 * Every config write route calls refuseIfArchived() right after resolving the
 * store and before anything is sent to Shopify or Meta, so a refusal never
 * costs an external call and never half-applies.
 */

/** JSON `code` of the refusal (the screens map it in components/settings/messages.ts). */
export const STORE_ARCHIVED = 'store_archived'

/** The sentence the API answers with. */
export function archivedStoreMessage(name: string): string {
  return `${name} está arquivada e fica só para consulta: nada nela pode ser alterado. ` +
    'Para mudar custos, contas de anúncio ou a conexão com a Shopify, desarquive a loja em Ajustes → Lojas.'
}

/** 409 store_archived when the store is archived; nothing otherwise. */
export function refuseIfArchived(store: Pick<StoreRef, 'archived' | 'name'>): void {
  if (store.archived) throw new HttpError(409, STORE_ARCHIVED, archivedStoreMessage(store.name))
}

/**
 * For the Shopify connect routes, before the typed credentials are minted or
 * tested against Shopify: the store named by id (404 unless the viewer's), or
 * else the viewer's store with this domain, must not be archived. A domain the
 * viewer has no store for passes (a new store, or another account's — the
 * connect itself answers those).
 */
export async function refuseArchivedShopifyTarget(viewer: Viewer, storeId: string | null, shop: unknown): Promise<void> {
  if (storeId) {
    refuseIfArchived(await requireStore(viewer, storeId))
    return
  }
  const domain = normalizeShopDomain(typeof shop === 'string' ? shop.trim() : '')
  if (!domain) return
  const mine = (await listStores(viewer, { includeArchived: true })).find(s => s.domain?.toLowerCase() === domain)
  if (mine) refuseIfArchived(mine)
}
