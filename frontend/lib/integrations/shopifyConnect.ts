import { AccessError, listStores, requireStore, type Viewer } from '../access'
import { HttpError } from './http'
import { fetchShopInfo, mintClientCredentialsToken, normalizeShopDomain } from './shopify'
import { connectShopify, type ConnectShopifyResult } from './stores'

/**
 * Connecting a store without a browser redirect, from credentials typed in the
 * UI. The type of connection follows from what was typed:
 *  - Client ID + Client Secret (shpss_…): a Dev Dashboard app. A token is
 *    minted on the spot (client_credentials) to prove the pair works, and the
 *    pair is stored so the collector can keep re-minting the 24h token.
 *  - An Admin API token (shpat_…): a legacy custom app. Proven with shop.json.
 * The secret travels in a POST body, never a URL.
 */

export interface ConnectRequest {
  storeId: string | null
  shop: unknown
  mode?: unknown
  accessToken?: unknown
  clientId?: unknown
  clientSecret?: unknown
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export async function connectFromRequest(viewer: Viewer, req: ConnectRequest): Promise<ConnectShopifyResult> {
  // Ownership first: nothing is sent to Shopify for a store the viewer cannot see.
  let store = req.storeId ? await requireStore(viewer, req.storeId) : null
  const shop = normalizeShopDomain(str(req.shop) || store?.domain || '')
  if (!shop) throw new HttpError(400, 'invalid_shop', 'Domínio inválido: use o endereço <loja>.myshopify.com')
  // Refuse before the credentials are sent anywhere: connectShopify() would
  // refuse the save anyway, but only after minting/testing against that shop.
  if (store && store.domain?.toLowerCase() !== shop) {
    throw new HttpError(409, 'domain_mismatch',
      `A loja escolhida é ${store.domain ?? 'sem domínio'}, não ${shop}.`)
  }

  const mode = req.mode === 'reconnect' || (req.mode !== 'add' && store) ? 'reconnect' : 'add'
  if (mode === 'reconnect' && !store) {
    store = (await listStores(viewer, { includeArchived: true })).find(s => s.domain?.toLowerCase() === shop) ?? null
    if (!store) throw new AccessError(404)
  }
  const accessToken = str(req.accessToken)
  const clientId = str(req.clientId)
  const clientSecret = str(req.clientSecret)

  if (clientId || clientSecret) {
    if (!clientId || !clientSecret) throw new HttpError(400, 'missing_credentials', 'Informe o Client ID e o Client Secret do app.')
    const minted = await mintClientCredentialsToken(shop, clientId, clientSecret)
    if (!minted.ok) throw new HttpError(422, 'credentials_rejected', `Não foi possível conectar: ${minted.reason}.`)
    const check = await fetchShopInfo(shop, minted.token)
    if (!check.ok) throw new HttpError(422, 'shop_unreachable', 'A chave gerada não conseguiu ler a loja na Shopify.')
    return connectShopify(viewer, {
      storeId: store?.id ?? null, domain: shop, mode,
      credential: { kind: 'client_credentials', clientId, clientSecret, token: minted.token, expiresAt: minted.expiresAt! },
      info: check.info,
    })
  }

  if (!accessToken) throw new HttpError(400, 'missing_credentials', 'Informe a chave de acesso (shpat_…) ou o Client ID e o Secret.')
  if (accessToken.startsWith('shpss_')) {
    throw new HttpError(400, 'secret_not_token',
      'Isso é um Client Secret (shpss_), não uma chave de acesso. Informe também o Client ID do app.')
  }
  const check = await fetchShopInfo(shop, accessToken)
  if (!check.ok) {
    throw new HttpError(422, 'token_rejected', 'Chave inválida ou de outra loja. Verifique e tente de novo.')
  }
  return connectShopify(viewer, {
    storeId: store?.id ?? null, domain: shop, mode,
    credential: { kind: 'token', token: accessToken },
    info: check.info,
  })
}
