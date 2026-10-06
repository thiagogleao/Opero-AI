import { auth } from '@clerk/nextjs/server'
import { buildStoreWorkbook } from '@/lib/storeExport'
import { getTenantsByUserId } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A wide period over several stores prices every order individually.
export const maxDuration = 300

export async function GET(req: Request) {
  const { userId } = await auth()
  if (!userId) return new Response('Unauthorized', { status: 401 })

  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return Response.json({ error: 'from e to são obrigatórios no formato YYYY-MM-DD' }, { status: 400 })
  }
  if (from > to) {
    return Response.json({ error: 'from não pode ser depois de to' }, { status: 400 })
  }

  // Only the caller's own stores, whatever the query string asks for.
  const mine = await getTenantsByUserId(userId)
  const allowed = new Set(mine.map(t => t.id))
  const asked = searchParams.getAll('store').flatMap(s => s.split(',')).filter(Boolean)
  const tenantIds = asked.length > 0 ? asked.filter(id => allowed.has(id)) : [...allowed]

  if (tenantIds.length === 0) {
    return Response.json({ error: 'nenhuma loja acessível foi selecionada' }, { status: 400 })
  }

  try {
    const wb = await buildStoreWorkbook({
      tenantIds, from, to,
      includeOrders: searchParams.get('orders') !== '0',
    })
    const buf = await wb.xlsx.writeBuffer()

    const label = tenantIds.length === 1
      ? (mine.find(t => t.id === tenantIds[0])?.shop_name ?? 'loja')
      : `${tenantIds.length}-lojas`
    const name = `opero-${label}-${from}-a-${to}.xlsx`
      .normalize('NFD').replace(/[̀-ͯ]/g, '')   // accents break some clients
      .replace(/[^a-zA-Z0-9.\-_]/g, '-').replace(/-+/g, '-')

    return new Response(buf as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    console.error('[export] failed', err)
    return Response.json({ error: 'falha ao gerar o arquivo' }, { status: 500 })
  }
}
