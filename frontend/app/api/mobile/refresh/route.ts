import { spawn } from 'child_process'
import path from 'path'
import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import { listStores, type StoreRef } from '@/lib/access'
import { selectStores, StoreSelectionError } from '@/lib/views/mobile'
import {
  planRefresh, recentStarts, runsSince, storesWithAds,
  type PlannedLaunch, type RefreshResponse, type RefreshStatusResponse,
} from '@/lib/views/refresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const PYTHON = process.env.PYTHON_BIN || 'python3'
const SCRIPT = path.join(PROJECT_ROOT, 'collect_recent.py')
const SYNC_TIMEOUT_MS = 10 * 60 * 1000

// This process's own launches, so two taps a second apart do not both spawn
// before the first run has written its sync_runs row.
const launchedAt = new Map<string, number>()

function spawnCollector(l: PlannedLaunch) {
  try {
    const args = [SCRIPT, '--source', l.source, '--date-from', l.dateFrom, '--date-to', l.dateTo, '--tenant', l.storeId]
    if (l.mode) args.push('--mode', l.mode)
    const proc = spawn(PYTHON, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      shell: false,
      stdio: 'ignore',
    })
    const killTimer = setTimeout(() => proc.kill('SIGTERM'), SYNC_TIMEOUT_MS)
    proc.on('exit', () => clearTimeout(killTimer))
    proc.on('error', err => console.error(`[mobile/refresh] ${l.source} ${l.storeId} failed to start:`, err))
    proc.unref()
    console.log(`[mobile/refresh] spawned ${l.source} tenant=${l.storeId} ${l.dateFrom}..${l.dateTo}`)
  } catch (err) {
    console.error(`[mobile/refresh] failed to spawn ${l.source}:`, err)
  }
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
 * exactly what it started and what it skipped.
 */
export async function POST(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

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
  for (const [k, at] of launchedAt) {
    if (!recent.has(k) || recent.get(k)! < at) recent.set(k, at)
  }
  const plan = planRefresh(
    targets.map(t => ({ id: t.id, name: t.name, timezone: t.timezone, hasAds: withAds.has(t.id) })), recent, now)

  for (const l of plan.launch) {
    launchedAt.set(`${l.storeId}:${l.source}`, now.getTime() + l.delayMs)
    if (l.delayMs > 0) setTimeout(() => spawnCollector(l), l.delayMs)
    else spawnCollector(l)
  }
  // Keep the map from growing with stale keys.
  for (const [k, at] of launchedAt) if (now.getTime() - at > 60 * 60_000) launchedAt.delete(k)

  const res: RefreshResponse = {
    requestedAt: now.toISOString(),
    stores: targets.map(t => ({ id: t.id, name: t.name })),
    launched: plan.launch.map(l => ({ storeId: l.storeId, name: l.name, source: l.source, startsInSeconds: Math.round(l.delayMs / 1000) })),
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
