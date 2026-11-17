import { accessErrorResponse, getViewer, requireStore, type StoreRef } from '@/lib/access'
import { runChat, type ChatEvent } from '@/lib/ai/chat'
import { openStream } from '@/lib/ai/claude'
import { loadStoreContext } from '@/lib/ai/context'
import { chatLimiter, jsonError, rateLimitedResponse, readJsonBody, viewerKey } from '@/lib/ai/guard'
import { parseHistory } from '@/lib/ai/history'
import { sseResponse } from '@/lib/ai/sse'

/**
 * POST /api/agent — the Copilot. A read-only analyst for one store.
 *
 * Request (JSON):
 *   { storeId: string,                      // a store the viewer may see
 *     messages: { role: 'user' | 'assistant', content: string }[],
 *                                           // plain-text history, last = the question
 *     split?: boolean }                     // partner view: add "sua parte (50%)"
 *
 * Errors before the stream starts are JSON { error, code? } with 400 (bad
 * body), 401 (no viewer), 404 (store not visible to this viewer) or 429
 * (per-viewer limit; Retry-After header and `retryAfter` seconds).
 *
 * Otherwise a text/event-stream of `data: <ChatEvent JSON>` frames (see
 * lib/ai/chat.ts): start, then any number of text / replace / tool, then done or error. Lines that
 * do not start with "data: " are keep-alive comments. Closing the request
 * aborts the model call.
 *
 * The store comes from lib/access, never from the Clerk user id (the old
 * route always read the store whose id equals the user id: wrong store for
 * two accounts, a 400 for the EPOCH partner). The system prompt is built
 * here, never taken from the client.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<Response> {
  const viewer = await getViewer()
  if (!viewer) return jsonError(401, 'Não autenticado')
  const body = await readJsonBody(req)
  if (!body) return jsonError(400, 'Corpo inválido: envie JSON com storeId e messages.')

  let store: StoreRef
  try {
    store = await requireStore(viewer, typeof body.storeId === 'string' ? body.storeId : null)
  } catch (err) {
    return accessErrorResponse(err)
  }

  const history = parseHistory(body.messages)
  if (!history.ok) return jsonError(400, history.error)

  const key = viewerKey(viewer)
  const limit = chatLimiter.take(key)
  if (!limit.ok) return rateLimitedResponse(limit.retryAfter, 'perguntas ao Copiloto')

  let ctx
  try {
    ctx = await loadStoreContext(store)
  } catch (err) {
    console.error('[ai.agent] contexto da loja', err)
    return jsonError(500, 'Não consegui ler os dados da loja agora. Tente de novo.')
  }
  const split = body.split === true
  return sseResponse<ChatEvent>(req, (send, signal) =>
    runChat({ ctx, turns: history.turns, split, viewerKey: key }, send, signal, openStream))
}
