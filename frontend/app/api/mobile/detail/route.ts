import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import { listStores } from '@/lib/access'
import { getAlertConfig } from '@/lib/alerts'
import { selectStores, StoreSelectionError } from '@/lib/views/mobile'
import {
  DetailFailedError, DetailQueryError, mobileDetailOnce, parseDetailQuery,
} from '@/lib/views/mobileDetail'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The phone's detail tabs: GET /api/mobile/detail?section=&period=&store=&from=&to=
 *
 *  section  campanhas | criativos | produtos | paises | clientes
 *  period, store, from, to  exactly as GET /api/mobile (same presets, same
 *           store selection, a custom period needs both dates).
 *
 * Answers with lib/views/mobileDetail.ts MobileDetailResponse, built on
 * lib/data/* and echoing the request. Fetched only when a tab is opened, so
 * the headline never waits on a tab nobody looks at.
 *
 * Owner only, like /api/mobile: these lists span every store.
 */
export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  try {
    const q = parseDetailQuery(new URL(req.url).searchParams)
    const visible = await listStores({ kind: 'owner' }, { includeArchived: true })
    const { key, stores } = selectStores(q.store, visible)
    const cfg = await getAlertConfig()
    const body = await mobileDetailOnce({ ...q, storeKey: key }, stores, {
      thresholds: { minMargin: cfg.scaleAlerts.threshold },
      storeNames: new Map(visible.map(s => [s.id, s.name])),
    })
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof DetailQueryError) return Response.json({ error: err.message }, { status: 400 })
    if (err instanceof StoreSelectionError) return Response.json({ error: err.message }, { status: err.status })
    if (err instanceof DetailFailedError) return Response.json({ error: 'Nenhuma loja respondeu' }, { status: 500 })
    console.error('[mobile/detail] failed', err)
    return Response.json({ error: 'Falha ao carregar' }, { status: 500 })
  }
}
