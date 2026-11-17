import { shopifyCredentials } from './data'

/**
 * One live, read-only Shopify call: stock. The collector does not store
 * inventory, and stock changes by the minute, so the Copilot asks Shopify.
 * GraphQL `totalInventory` sums every variant (the old REST tool reported the
 * first variant only), and pagination is followed up to a ceiling that is
 * reported, never hidden.
 */

const API_VERSION = '2026-10'
const PAGE = 50
const MAX_PAGES = 8
const TIMEOUT_MS = 15_000

export interface InventoryRow {
  title: string
  status: string
  totalInventory: number | null
  tracksInventory: boolean
  variants: number | null
}

export interface InventoryView {
  source: 'Shopify ao vivo'
  scanned: number
  /** True when more products matched than were read. */
  truncated: boolean
  outOfStock: number
  rows: InventoryRow[]
  rowsOmitted: number
}

interface GqlProducts {
  data?: {
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null }
      nodes: { title: string; status: string; totalInventory: number | null; tracksInventory: boolean; variantsCount: { count: number } | null }[]
    }
  }
  errors?: { message: string }[]
}

const QUERY = `query Inventory($first: Int!, $after: String, $query: String) {
  products(first: $first, after: $after, query: $query, sortKey: TITLE) {
    pageInfo { hasNextPage endCursor }
    nodes { title status totalInventory tracksInventory variantsCount { count } }
  }
}`

export class ShopifyReadError extends Error {}

export async function readInventory(
  storeId: string, opts: { search?: string | null; onlyOutOfStock?: boolean; status?: 'active' | 'draft' | 'archived' | 'any'; limit: number },
  signal: AbortSignal,
): Promise<InventoryView> {
  const cred = await shopifyCredentials(storeId)
  if (!cred) throw new ShopifyReadError('Esta loja não tem a Shopify conectada.')
  const domain = cred.domain.replace(/^https?:\/\//, '').replace(/\/$/, '')
  const terms: string[] = []
  const status = opts.status ?? 'active'
  if (status !== 'any') terms.push(`status:${status}`)
  // Free-text search; quotes and backslashes would break the query syntax.
  if (opts.search) terms.push(opts.search.replace(/["\\]/g, ' ').trim())
  const search = terms.join(' ') || null

  const nodes: InventoryRow[] = []
  let after: string | null = null
  let truncated = false
  for (let page = 0; page < MAX_PAGES; page++) {
    const res: Response = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': cred.token },
      body: JSON.stringify({ query: QUERY, variables: { first: PAGE, after, query: search } }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
    })
    if (res.status === 401 || res.status === 403) {
      throw new ShopifyReadError('A Shopify recusou o acesso desta loja (token expirado ou sem permissão). Reconecte a loja.')
    }
    if (res.status === 402) throw new ShopifyReadError('A loja está suspensa na Shopify.')
    if (!res.ok) throw new ShopifyReadError(`A Shopify respondeu ${res.status}. Tente de novo em instantes.`)
    const json = await res.json() as GqlProducts
    if (json.errors?.length || !json.data) {
      console.error('[ai.shopify] graphql', json.errors?.map(e => e.message).join('; '))
      throw new ShopifyReadError('A Shopify não devolveu o estoque. Tente de novo em instantes.')
    }
    for (const n of json.data.products.nodes) {
      nodes.push({
        title: n.title, status: n.status, totalInventory: n.totalInventory,
        tracksInventory: n.tracksInventory, variants: n.variantsCount?.count ?? null,
      })
    }
    const info = json.data.products.pageInfo
    if (!info.hasNextPage) break
    after = info.endCursor
    if (page === MAX_PAGES - 1) truncated = true
  }

  const out = nodes.filter(n => n.tracksInventory && (n.totalInventory ?? 0) <= 0)
  const listed = opts.onlyOutOfStock ? out : nodes
  return {
    source: 'Shopify ao vivo',
    scanned: nodes.length,
    truncated,
    outOfStock: out.length,
    rows: listed.slice(0, opts.limit),
    rowsOmitted: Math.max(0, listed.length - opts.limit),
  }
}
