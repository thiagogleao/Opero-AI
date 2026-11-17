import { cookies } from 'next/headers'
import { query } from './db'
import { hasMobileSession } from './mobileAuth'

/**
 * Who is looking, and which stores they may see.
 *
 * Two kinds of viewer:
 *  - the owner, on a device unlocked with the magic link (the opero_m cookie):
 *    every active store, on the phone and on the desktop site alike;
 *  - a partner, signed in with a Clerk account: only the stores of that
 *    account. Partners share logins with the owner per store, so a store
 *    belongs to exactly one account.
 *
 * Every page and API route that touches store data resolves the store through
 * requireStore(). Nothing else — not a cookie, not a URL — decides whose
 * numbers are read.
 */

export type Viewer =
  | { kind: 'owner' }
  | { kind: 'partner'; userId: string }

export interface StoreRef {
  id: string
  /** Shop name, disambiguated when two stores share one ("Dumpling Squishy · 8jcp3a"). */
  name: string
  shopName: string
  domain: string | null
  timezone: string
  archived: boolean
  userId: string | null
}

export class AccessError extends Error {
  constructor(public status: 401 | 404, message = status === 401 ? 'Não autenticado' : 'Loja não encontrada') {
    super(message)
  }
}

/** The Clerk user of this request, or null when Clerk is not in front of it. */
async function clerkUserId(): Promise<string | null> {
  try {
    const { auth } = await import('@clerk/nextjs/server')
    const { userId } = await auth()
    return userId ?? null
  } catch {
    return null
  }
}

/** The owner's unlocked device wins over a Clerk session in the same browser:
 *  the owner signs in to partner accounts too, and should not lose the full
 *  view by doing so. */
export async function getViewer(): Promise<Viewer | null> {
  if (await hasMobileSession()) return { kind: 'owner' }
  const userId = await clerkUserId()
  return userId ? { kind: 'partner', userId } : null
}

export async function requireViewer(): Promise<Viewer> {
  const v = await getViewer()
  if (!v) throw new AccessError(401)
  return v
}

interface Row {
  id: string; shop_name: string | null; shopify_domain: string | null; timezone: string | null
  archived: boolean; user_id: string | null
}

function label(rows: Row[]): StoreRef[] {
  const count = new Map<string, number>()
  for (const r of rows) {
    const n = (r.shop_name || r.shopify_domain || r.id).trim()
    count.set(n, (count.get(n) ?? 0) + 1)
  }
  return rows.map(r => {
    const shopName = (r.shop_name || r.shopify_domain || r.id).trim()
    const suffix = (r.shopify_domain || r.id).split('.')[0].split('-')[0]
    return {
      id: r.id,
      shopName,
      name: (count.get(shopName) ?? 0) > 1 ? `${shopName} · ${suffix}` : shopName,
      domain: r.shopify_domain,
      timezone: r.timezone || 'UTC',
      archived: r.archived,
      userId: r.user_id,
    }
  })
}

/**
 * The stores a viewer may see, oldest first. Archived stores only on request:
 * they keep their history and are read in a separate "arquivadas" view, never
 * in "Todas" totals.
 */
export async function listStores(viewer: Viewer, opts: { includeArchived?: boolean } = {}): Promise<StoreRef[]> {
  const rows = viewer.kind === 'owner'
    ? await query<Row>(
        `SELECT t.id, t.shop_name, t.shopify_domain, t.timezone, (t.archived_at IS NOT NULL) AS archived, t.user_id
           FROM tenants t
          WHERE t.shopify_domain IS NOT NULL
          ORDER BY t.created_at`)
    : await query<Row>(
        `SELECT t.id, t.shop_name, t.shopify_domain, t.timezone, (t.archived_at IS NOT NULL) AS archived, t.user_id
           FROM tenants t
          WHERE (t.user_id = $1 OR (t.user_id IS NULL AND t.id = $1))
          ORDER BY t.created_at`,
        [viewer.userId])
  // Labels are computed over every store the viewer can see, archived
  // included, so a name stays the same when the archived list is shown.
  const all = label(rows)
  return opts.includeArchived ? all : all.filter(s => !s.archived)
}

/** One store the viewer may see (archived included), or AccessError(404). */
export async function requireStore(viewer: Viewer, storeId: string | null | undefined): Promise<StoreRef> {
  if (!storeId) throw new AccessError(404)
  const all = await listStores(viewer, { includeArchived: true })
  const s = all.find(x => x.id === storeId)
  if (!s) throw new AccessError(404)
  return s
}

export const ACTIVE_STORE_COOKIE = 'active_store_id'

/**
 * Which store a page shows: the one in the URL when the viewer may see it,
 * else the last one picked in this browser, else the first active store.
 * Returns null only when the viewer has no stores at all.
 */
export async function resolveStore(
  viewer: Viewer, fromUrl: string | null | undefined,
): Promise<{ store: StoreRef | null; stores: StoreRef[] }> {
  const all = await listStores(viewer, { includeArchived: true })
  const stores = all.filter(s => !s.archived)
  const pick = (id: string | null | undefined) => (id ? all.find(s => s.id === id) ?? null : null)
  let store = pick(fromUrl)
  if (!store) {
    const jar = await cookies()
    const c = pick(jar.get(ACTIVE_STORE_COOKIE)?.value)
    store = c && !c.archived ? c : null
  }
  return { store: store ?? stores[0] ?? null, stores }
}

/** JSON error response for an AccessError (and a 500 for anything else). */
export function accessErrorResponse(err: unknown): Response {
  if (err instanceof AccessError) return Response.json({ error: err.message }, { status: err.status })
  console.error('[access]', err)
  return Response.json({ error: 'Erro interno' }, { status: 500 })
}
