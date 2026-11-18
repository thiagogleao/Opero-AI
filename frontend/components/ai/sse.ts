/**
 * Reading the AI routes' server-sent events in the browser.
 *
 * The routes (lib/ai/sse.ts) send `data: <json>\n\n` frames plus `: ping`
 * keep-alive comments. EventSource cannot POST, so the body of a fetch is read
 * by hand. One frame that fails to parse is skipped, never fatal: the old chat
 * ended the whole read on the first bad frame while the server kept running
 * (and kept billing) behind a dead "Erro de conexão".
 */

/** Incremental frame parser: feed it text chunks, it calls `onEvent` once per
 *  complete `data:` frame. Pure, so it is unit-tested without a network. */
export function createSseParser<E>(onEvent: (event: E) => void) {
  let buffer = ''

  const frame = (raw: string) => {
    const data = raw
      .split('\n')
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).replace(/^ /, ''))
      .join('\n')
    if (!data) return // a comment / ping frame
    try {
      onEvent(JSON.parse(data) as E)
    } catch {
      // A malformed frame is dropped; the next ones still arrive.
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk.replace(/\r\n?/g, '\n')
      let i: number
      while ((i = buffer.indexOf('\n\n')) >= 0) {
        frame(buffer.slice(0, i))
        buffer = buffer.slice(i + 2)
      }
    },
    /** The stream ended: parse a last frame that had no blank line after it. */
    flush() {
      if (buffer.trim()) frame(buffer)
      buffer = ''
    },
  }
}

/** Reads a fetch body to the end, calling `onEvent` per event. Resolves when
 *  the server closes the stream; rejects with an AbortError when `signal`
 *  fires (the caller decides whether that was a stop or a store change). */
export async function readSse<E>(body: ReadableStream<Uint8Array>, onEvent: (event: E) => void, signal: AbortSignal): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const parser = createSseParser<E>(onEvent)
  const cancel = () => { reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (signal.aborted) throw new DOMException('aborted', 'AbortError')
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    parser.push(decoder.decode())
    parser.flush()
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

export function isAbortError(err: unknown): boolean {
  return (err instanceof DOMException && err.name === 'AbortError')
    || (err instanceof Error && err.name === 'AbortError')
}

/** A JSON error body from a route that refused before streaming:
 *  `{ error, code?, retryAfter? }`. Anything else becomes an empty object. */
export async function readErrorBody(res: Response): Promise<{ error?: string; code?: string; retryAfter?: number }> {
  try {
    const j: unknown = await res.json()
    if (!j || typeof j !== 'object') return {}
    const o = j as Record<string, unknown>
    return {
      error: typeof o.error === 'string' ? o.error : undefined,
      code: typeof o.code === 'string' ? o.code : undefined,
      retryAfter: typeof o.retryAfter === 'number' ? o.retryAfter : undefined,
    }
  } catch {
    return {}
  }
}
