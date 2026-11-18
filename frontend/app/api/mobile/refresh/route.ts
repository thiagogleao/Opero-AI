import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import { listStores, type StoreRef } from '@/lib/access'
import { selectStores, StoreSelectionError } from '@/lib/views/mobile'
import { laneBusy, launch, syncAllowed } from '@/lib/sync/jobs'
import {
  planRefresh, recentStarts, runsSince, storesWithAds, syncDisabledReason,
  type RefreshResponse, type RefreshStatusResponse,
} from '@/lib/views/refresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** 503 when this server does not run collectors (a local run, a read-only
 *  database): the phone says so instead of showing a sync that never runs. */
function disabled(): Response {
  const error = syncDisabledReason(process.env) ?? 'Sincronização desligada neste servidor'
  return Response.json({ error }, { status: 503 })
}

/** Active stores named by `store` (query) or `stores` (JSON body); 'all' or
 *  nothing means every active store. Archived stores are not synced. */
async function resolveTargets(param: string | null): Promise<StoreRef[]> {
  const visible = await listStores({ kind: 'owner' }, { includeArchived: true })
  const { stores } = selectStores(param, visible)
  if (stores.some(s => s.archived)) throw new StoreSelectionError(400, 'Loja arquivada não é sincronizada')
  return stores
}

/**
 * Refresh the stores on screen: POST /api/mobile/refresh?store=<id[,id]|all>
 * (or a JSON body { stores: [...] }). Starts a Shopify and a Meta (quick)
 * collection per store unless one started in the last two minutes, and says
 * exactly what it started and what it skipped. 503 when this server does not
 * run collectors (DATABASE_READ_ONLY=1 or AUTO_SYNC_DISABLED=1).
 */
export async function POST(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()
  // Before anything else: nothing below may plan, let alone start, a
  // collector on a server that must not write.
  if (!syncAllowed()) return disabled()

  const body = await req.json().catch(() => null) as { stores?: unknown } | null
  const fromBody = Array.isArray(body?.stores) ? body.stores.filter((x): x is string => typeof x === 'string').join(',') : null
  const param = new URL(req.url).searchParams.get('store') ?? fromBody
  // An explicit empty list is a client bug, not a request to refresh everything.
  if (param !== null && param.trim() === '') return Response.json({ error: 'Nenhuma loja informada' }, { status: 400 })

  let targets: StoreRef[]
  try {
    targets = await resolveTargets(param)
  } catch (err) {
    if (err instanceof StoreSelectionError) return Response.json({ error: err.message }, { status: err.status })
    throw err
  }

  const ids = targets.map(t => t.id)
  const [withAds, recent] = await Promise.all([storesWithAds(ids), recentStarts(ids)])
  const now = new Date()
  // Lanes alive in this process: a second tap before the first run has
  // written its sync_runs row is "em andamento", not a second process.
  const busy = new Set(targets.flatMap(t => (['shopify', 'facebook'] as const)
    .filter(source => laneBusy(t.id, source)).map(source => `${t.id}:${source}`)))
  const plan = planRefresh(
    targets.map(t => ({ id: t.id, name: t.name, timezone: t.timezone, hasAds: withAds.has(t.id) })), recent, now, busy)

  // The job runner caps and spaces the processes, captures their output and
  // folds this request into a job already waiting for the same lane.
  const launched: RefreshResponse['launched'] = []
  for (const l of plan.launch) {
    const state = launch({
      tenantId: l.storeId, lane: l.source, mode: l.mode, from: l.dateFrom, to: l.dateTo,
      reason: 'atualizar (celular)', label: l.name,
    })
    if (state === 'disabled') return disabled()
    launched.push({ storeId: l.storeId, name: l.name, source: l.source, state })
  }

  const res: RefreshResponse = {
    requestedAt: now.toISOString(),
    stores: targets.map(t => ({ id: t.id, name: t.name })),
    launched,
    skipped: plan.skipped,
  }
  return Response.json(res)
}

/**
 * Progress of a refresh: GET /api/mobile/refresh?store=<ids|all>&since=<ISO>
 * (`since` = requestedAt from the POST). The newest run per store and source
 * started since then, so the phone can stop its spinner when the syncs end.
 */
export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()
  const sp = new URL(req.url).searchParams
  const since = new Date(sp.get('since') ?? '')
  if (Number.isNaN(since.getTime())) return Response.json({ error: 'Parâmetro since inválido' }, { status: 400 })

  let targets: StoreRef[]
  try {
    targets = await resolveTargets(sp.get('store'))
  } catch (err) {
    if (err instanceof StoreSelectionError) return Response.json({ error: err.message }, { status: err.status })
    throw err
  }
  // A collector writes its row a moment after it starts; allow a little slack.
  const runs = await runsSince(targets, new Date(since.getTime() - 5_000))
  const started = runs.filter(r => r.status !== null)
  const res: RefreshStatusResponse = {
    since: since.toISOString(),
    runs,
    done: started.length > 0 && started.every(r => r.status !== 'running'),
  }
  return Response.json(res, { headers: { 'Cache-Control': 'no-store' } })
}
