import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import { listStores } from '@/lib/access'
import { loadSharedInWindow } from '@/components/portfolio/data'
import type { SharedAdAccount } from '@/lib/attributionModels'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY = /^\d{4}-\d{2}-\d{2}$/
/** The longest window asked (a custom range is at most 366 days, R9). */
const MAX_DAYS = 400

function rangeOf(from: string | null, to: string | null): { from: string; to: string } | null {
  if (!from || !to || !DAY.test(from) || !DAY.test(to) || from > to) return null
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000
  return Number.isFinite(days) && days <= MAX_DAYS ? { from, to } : null
}

/**
 * Shared ad-account pair orders for ONE store, in the window on screen and in
 * its comparison window: GET /api/mobile/shared?store=&from=&to=&cfrom=&cto=
 *
 * The desktop Resumo reads these with components/portfolio/data
 * loadSharedInWindow (SharedAccountNote): whether THIS window is mixed with
 * the pair (EPOCH paying the ads that sold for CAMP HALLOW), and whether the
 * comparison base is (R2-1, "base misturada"). The phone asks only for a store
 * that is in a 90-day pair (app/m/_lib/sharedAds), with the dates of the
 * answer it shows (resolved by the server: no clock here). Read only.
 *
 * Answers { window, base }: the pairs that store is in, with their order
 * counts; null for a side that was not asked or whose read failed.
 * Owner only, like /api/mobile.
 */
export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()
  const sp = new URL(req.url).searchParams
  const id = (sp.get('store') ?? '').trim()
  const win = rangeOf(sp.get('from'), sp.get('to'))
  if (!id || !win) return Response.json({ error: 'Pedido inválido' }, { status: 400 })
  const base = rangeOf(sp.get('cfrom'), sp.get('cto'))

  try {
    const visible = await listStores({ kind: 'owner' }, { includeArchived: true })
    const store = visible.find(s => s.id === id)
    if (!store) return Response.json({ error: 'Loja não encontrada' }, { status: 404 })
    // The viewer's active stores, plus the store itself when archived (as the desktop).
    const stores = visible.filter(s => !s.archived || s.id === id)
    const mine = (list: SharedAdAccount[] | null) => list === null ? null
      : list.filter(p => p.adStoreId === id || p.salesStoreId === id)
        .map(p => ({ adStoreId: p.adStoreId, salesStoreId: p.salesStoreId, orders: p.orders }))
    const [w, b] = await Promise.all([
      loadSharedInWindow(stores, win),
      base ? loadSharedInWindow(stores, base) : Promise.resolve(null),
    ])
    return Response.json({ window: mine(w), base: mine(b) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    console.error('[mobile/shared] failed', err)
    return Response.json({ error: 'Falha ao carregar' }, { status: 500 })
  }
}
