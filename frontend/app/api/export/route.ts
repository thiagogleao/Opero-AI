/**
 * GET /api/export — the stores' accounting as an .xlsx file.
 *
 *   ?store=<id>      repeatable, or comma separated; absent = every active
 *                    store the viewer can see
 *   ?period=30d      a preset, resolved on the server, or
 *   ?from=&to=       YYYY-MM-DD (period "custom")
 *   ?orders=0        leave out the order-by-order sheet
 *
 * Who may export what is lib/access: the owner every store, a partner the
 * stores of their account. A store id the viewer cannot see is a 404 for the
 * whole request, never silently dropped (a file that quietly misses a store
 * reads as a store that sold nothing).
 */

import { AccessError, accessErrorResponse, getViewer, listStores, type StoreRef } from '@/lib/access'
import { anchorTz } from '@/lib/engine/dates'
import { parseWindow } from '@/lib/data/profitConfig'
import { buildStoreWorkbook } from '@/lib/storeExport'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A wide period over several stores prices every order individually.
export const maxDuration = 300

function fileName(stores: StoreRef[], from: string, to: string): string {
  const label = stores.length === 1 ? stores[0].name : `${stores.length}-lojas`
  return `opero-${label}-${from}-a-${to}.xlsx`
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // accents break some clients
    .replace(/[^a-zA-Z0-9.\-_]/g, '-').replace(/-+/g, '-')
}

export async function GET(req: Request) {
  let stores: StoreRef[]
  let range: { from: string; to: string }
  try {
    const viewer = await getViewer()
    if (!viewer) throw new AccessError(401)
    const params = new URL(req.url).searchParams
    const all = await listStores(viewer, { includeArchived: true })
    const asked = [...new Set(params.getAll('store').flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean))]
    if (asked.length) {
      stores = asked.map(id => all.find(s => s.id === id) ?? null).filter((s): s is StoreRef => s !== null)
      // Archived stores only when named: their history, never in "all".
      if (stores.length !== asked.length) throw new AccessError(404)
    } else {
      stores = all.filter(s => !s.archived)
    }
    if (!stores.length) return Response.json({ error: 'Nenhuma loja para exportar.' }, { status: 400 })

    const win = parseWindow(
      { period: params.get('period'), from: params.get('from'), to: params.get('to') },
      anchorTz(stores.map(s => s.timezone)),
    )
    if (!win.ok) return Response.json({ error: win.issue.message, issues: [win.issue] }, { status: 400 })
    range = win.range
  } catch (err) {
    return accessErrorResponse(err)
  }

  try {
    const wb = await buildStoreWorkbook({
      stores, range, includeOrders: new URL(req.url).searchParams.get('orders') !== '0',
    })
    const buf = await wb.xlsx.writeBuffer()
    return new Response(buf as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName(stores, range.from, range.to)}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[export] failed', err)
    return Response.json({ error: 'Falha ao gerar o arquivo.' }, { status: 500 })
  }
}
