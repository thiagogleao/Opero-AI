import { accessErrorResponse, getViewer, requireStore, type StoreRef, type Viewer } from '@/lib/access'
import { isAbort, openStream, toAiError } from '@/lib/ai/claude'
import { INSIGHTS_TTL_MS, INSIGHTS_MODEL } from '@/lib/ai/config'
import { insightsLimiter, jsonError, rateLimitedResponse, readJsonBody, viewerKey } from '@/lib/ai/guard'
import { createInsightsStore, insightsKey } from '@/lib/ai/insights/cache'
import { buildInsightsFacts } from '@/lib/ai/insights/facts'
import {
  generateInsights, InsightsFailure, windowInfo, type InsightsEvent, type InsightsResult,
} from '@/lib/ai/insights/run'
import { sseResponse } from '@/lib/ai/sse'
import { insightsWindow, type InsightsWindow } from '@/lib/ai/window'

/**
 * /api/ai — the AI analysis of one store over a window of closed days.
 *
 * Not an LLM proxy: the request carries a store id and a period, never a
 * prompt or messages. The fact sheet is built here from the profit engine;
 * the model only explains it. Generated on request, cached in memory per
 * store + window + split for INSIGHTS_TTL_MS (6 h).
 *
 * GET /api/ai?storeId=…&period=30d[&from=YYYY-MM-DD&to=YYYY-MM-DD][&split=1]
 *   → 200 { window: InsightsWindowInfo, cached: InsightsResult | null }
 *   Never calls the model and does not count against the limit.
 *
 * POST /api/ai  { storeId, period?, from?, to?, split?: boolean, refresh?: boolean }
 *   → text/event-stream of `data: <InsightsEvent JSON>` frames
 *     (lib/ai/insights/run.ts): start, then any number of status / delta, then done or error.
 *   A cached result is returned at once (done, cached: true) unless
 *   refresh is true. A generation already running for the same key is
 *   awaited instead of started twice.
 *
 * Errors before the stream: JSON { error, code? } with 400, 401, 404,
 * 422 (code "no_closed_days": the period has no complete day yet) or 429
 * (per-viewer limit; Retry-After header and `retryAfter` seconds).
 *
 * period: one of lib/engine PERIODS ('today', 'yesterday', '7d', '14d', '30d',
 * '90d', 'mtd', 'lastmonth', 'custom' with from/to); default '30d'. Resolved
 * in the store's timezone and cut at yesterday.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const store = createInsightsStore<InsightsResult>()

type Resolved =
  | { ok: true; viewer: Viewer; shop: StoreRef; window: InsightsWindow; split: boolean; key: string }
  | { ok: false; response: Response }

async function resolve(params: Record<string, unknown>): Promise<Resolved> {
  const viewer = await getViewer()
  if (!viewer) return { ok: false, response: jsonError(401, 'Não autenticado') }
  let shop: StoreRef
  try {
    shop = await requireStore(viewer, typeof params.storeId === 'string' ? params.storeId : null)
  } catch (err) {
    return { ok: false, response: accessErrorResponse(err) }
  }
  const w = insightsWindow(shop.timezone, params.period, params.from, params.to)
  if (!w.ok) return { ok: false, response: jsonError(422, w.message, { code: 'no_closed_days' }) }
  const split = params.split === true || params.split === '1' || params.split === 'true'
  return { ok: true, viewer, shop, window: w.window, split, key: insightsKey(shop.id, w.window, split) }
}

export async function GET(req: Request): Promise<Response> {
  const q = new URL(req.url).searchParams
  const r = await resolve(Object.fromEntries(q.entries()))
  if (!r.ok) return r.response
  return Response.json({ window: windowInfo(r.window), cached: store.cache.get(r.key)?.value ?? null })
}

export async function POST(req: Request): Promise<Response> {
  const body = await readJsonBody(req)
  if (!body) return jsonError(400, 'Corpo inválido: envie JSON com storeId e period.')
  const r = await resolve(body)
  if (!r.ok) return r.response
  const { shop, window, split, key } = r
  const vKey = viewerKey(r.viewer)

  const start: InsightsEvent = {
    type: 'start', store: { id: shop.id, name: shop.name }, window: windowInfo(window), split, model: INSIGHTS_MODEL,
  }
  const hit = body.refresh === true ? null : store.cache.get(key)
  if (hit) {
    return sseResponse<InsightsEvent>(req, async send => {
      send(start)
      send({ type: 'done', result: hit.value, cached: true })
    })
  }

  const pending = store.inflight.get(key)
  if (!pending) {
    const limit = insightsLimiter.take(vKey)
    if (!limit.ok) return rateLimitedResponse(limit.retryAfter, 'análises de IA')
  }

  return sseResponse<InsightsEvent>(req, async (send, signal) => {
    send(start)
    let job = pending
    if (job) {
      send({ type: 'status', phase: 'waiting' })
    } else {
      send({ type: 'status', phase: 'reading' })
      job = (async () => {
        const facts = await buildInsightsFacts(shop, window, split)
        if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        return generateInsights(facts, send, signal, openStream, { viewerKey: vKey, ttlMs: INSIGHTS_TTL_MS })
      })()
      store.inflight.set(key, job)
      job.then(result => { store.cache.set(key, result) }, () => {})
        .finally(() => { if (store.inflight.get(key) === job) store.inflight.delete(key) })
    }
    try {
      const result = await job
      send({ type: 'done', result, cached: false })
    } catch (err) {
      // This client left: nobody to tell.
      if (signal.aborted) return
      if (err instanceof InsightsFailure) {
        send({ type: 'error', code: err.code, message: err.message })
        return
      }
      if (isAbort(err) || (err instanceof DOMException && err.name === 'AbortError')) {
        // The request that started the generation we were waiting on left.
        send({ type: 'error', code: 'aborted', message: 'A análise em andamento foi interrompida. Tente de novo.' })
        return
      }
      const e = toAiError(err)
      send({ type: 'error', code: e.code, message: e.message })
    }
  })
}
