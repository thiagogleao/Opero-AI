import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlock, BetaMessage, BetaMessageStreamParams,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { FALLBACK_BETA } from './config'

/**
 * The one Anthropic client, the one way to open a stream, and the one place
 * that turns an API failure into a sentence a partner can act on.
 */

let client: Anthropic | null = null

/** Created on first use so importing this module (tests, type checks) never
 *  needs the key. The SDK reads ANTHROPIC_API_KEY itself. */
export function anthropic(): Anthropic {
  client ??= new Anthropic({ maxRetries: 2 })
  return client
}

export type StreamParams = Omit<BetaMessageStreamParams, 'betas'>

/**
 * What the chat loop and the insights run need from a streamed call. A small
 * seam of our own rather than the SDK class, so the loops can be tested with a
 * scripted model and no network.
 */
export interface StreamLike {
  /** Text deltas, in order, as the model writes them. */
  onText(cb: (delta: string) => void): void
  /** The type of each content block as it opens ('thinking', 'text', 'tool_use', 'fallback', …). */
  onBlockStart(cb: (type: string) => void): void
  /** The complete message; rejects on API errors, aborts and unparseable tool JSON. */
  finalMessage(): Promise<BetaMessage>
}

export type OpenStream = (params: StreamParams, signal: AbortSignal) => StreamLike

/**
 * Open a streamed request with the server-side refusal fallback switched on.
 *
 * `fallbacks: "default"` lets the API re-run a declined request on the model
 * Anthropic routes that refusal category to, inside the same call; without it
 * a refusal simply ends the answer. The installed SDK predates the parameter,
 * so it rides on the body untyped — the SDK forwards unknown keys as-is.
 * The signal aborts the HTTP request: when the browser goes away, Anthropic
 * stops generating and we stop paying.
 */
export const openStream: OpenStream = (params, signal) => {
  const body = { ...params, betas: [FALLBACK_BETA], fallbacks: 'default' } as BetaMessageStreamParams
  const s = anthropic().beta.messages.stream(body, { signal })
  return {
    onText: cb => { s.on('text', delta => cb(delta)) },
    onBlockStart: cb => {
      s.on('streamEvent', e => { if (e.type === 'content_block_start') cb((e.content_block as { type: string }).type) })
    },
    finalMessage: () => s.finalMessage(),
  }
}

/** Content that may be sent back to the API on the next call of a tool loop.
 *  After a mid-answer fallback, thinking and tool_use blocks produced before
 *  the last `fallback` block belong to the declined attempt and must not be
 *  echoed; the fallback block itself stays exactly where it was. */
export function echoableContent(content: BetaContentBlock[]): BetaContentBlock[] {
  const lastFallback = findLastIndex(content, b => (b as { type: string }).type === 'fallback')
  if (lastFallback < 0) return content
  const dropBefore = new Set(['thinking', 'redacted_thinking', 'tool_use', 'server_tool_use'])
  return content.filter((b, i) => i >= lastFallback || !dropBefore.has(b.type))
}

function findLastIndex<T>(arr: T[], pred: (x: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return i
  return -1
}

/** The text of a finished message, in order, ignoring every other block. */
export function messageText(content: BetaContentBlock[]): string {
  return content.filter((b): b is Extract<BetaContentBlock, { type: 'text' }> => b.type === 'text')
    .map(b => b.text).join('')
}

/** The SDK's error for a tool input it could not parse at all (possible with
 *  eager input streaming). Only this one is worth re-issuing the call for;
 *  every typed API error is a real failure. */
export function isToolJsonError(err: unknown): boolean {
  return err instanceof Anthropic.AnthropicError && !(err instanceof Anthropic.APIError)
    && /tool parameter JSON/i.test(err.message)
}

export function isAbort(err: unknown, signal?: AbortSignal): boolean {
  return err instanceof Anthropic.APIUserAbortError || !!signal?.aborted
}

export type AiErrorCode =
  | 'aborted' | 'overloaded' | 'rate_limited' | 'unavailable' | 'bad_request' | 'auth' | 'billing' | 'internal'

export interface AiError { code: AiErrorCode; message: string; status: number }

/** An exhausted Anthropic balance. The API reports it as a 400
 *  invalid_request_error (or a billing_error), and no SDK class tells it apart
 *  from a malformed request, so the body is read. Without this the partner
 *  was told to rephrase a question that no rephrasing could fix. */
function isBillingError(err: InstanceType<typeof Anthropic.APIError>): boolean {
  const body = err.error as { error?: { type?: string; message?: string } } | undefined
  return err.status === 402 || body?.error?.type === 'billing_error'
    || /credit balance/i.test(body?.error?.message ?? err.message)
}

/** Friendly Portuguese for every failure. The raw SDK text goes to the server
 *  log, never to the screen (it is a JSON blob nobody can act on). */
export function toAiError(err: unknown): AiError {
  if (err instanceof Anthropic.APIUserAbortError) return { code: 'aborted', message: 'Cancelado.', status: 499 }
  if (err instanceof Anthropic.APIError && isBillingError(err)) {
    console.error('[ai] conta da Anthropic sem créditos', err.status)
    return { code: 'billing', message: 'A IA está indisponível: a conta da Anthropic está sem créditos. Avise o administrador.', status: 503 }
  }
  if (err instanceof Anthropic.RateLimitError) {
    return { code: 'rate_limited', message: 'A IA está recebendo pedidos demais agora. Tente de novo em 1 minuto.', status: 429 }
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    console.error('[ai] credencial da Anthropic recusada', err.status)
    return { code: 'auth', message: 'A chave da IA foi recusada. Avise o administrador.', status: 502 }
  }
  if (err instanceof Anthropic.BadRequestError) {
    console.error('[ai] pedido recusado pela API', err.message)
    return { code: 'bad_request', message: 'A IA recusou este pedido. Tente reformular a pergunta.', status: 502 }
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return { code: 'unavailable', message: 'Não consegui falar com a IA. Verifique a conexão e tente de novo.', status: 503 }
  }
  if (err instanceof Anthropic.APIError) {
    // 529 overloaded and 5xx: transient, worth a retry in a minute.
    if (err.status === 529 || (typeof err.status === 'number' && err.status >= 500)) {
      return { code: 'overloaded', message: 'A IA está ocupada agora. Tente de novo em 1 minuto.', status: 503 }
    }
  }
  console.error('[ai] erro inesperado', err)
  return { code: 'internal', message: 'Algo deu errado ao consultar a IA. Tente de novo.', status: 500 }
}

/** One log line per model call: who, which store, which model, what it cost. */
export function logUsage(kind: 'chat' | 'insights', viewerKey: string, storeId: string, msg: BetaMessage, startedAt: number) {
  const u = msg.usage
  console.info('[ai.usage]', JSON.stringify({
    kind, viewer: viewerKey, store: storeId, model: msg.model, stop: msg.stop_reason,
    input: u.input_tokens, output: u.output_tokens,
    cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0,
    ms: Date.now() - startedAt,
  }))
}
