/**
 * Server-sent events for the AI routes.
 *
 * Each event is one line `data: <json>` followed by a blank line. A comment
 * line (`: ping`) goes out every 15 s so proxies do not close a stream while
 * the model is thinking; clients must ignore lines that do not start with
 * `data: `.
 *
 * The abort signal handed to `run` fires when the client goes away (the
 * request's own signal, or the response body being cancelled), so the caller
 * stops paying for a model call nobody will read.
 */

const PING_MS = 15_000

export type Send<E> = (event: E) => void

export function sseResponse<E extends object>(
  req: Request,
  run: (send: Send<E>, signal: AbortSignal) => Promise<void>,
): Response {
  const ac = new AbortController()
  const abort = () => { if (!ac.signal.aborted) ac.abort() }
  if (req.signal.aborted) abort()
  else req.signal.addEventListener('abort', abort, { once: true })

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (chunk: string) => {
        if (closed || ac.signal.aborted) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          // The consumer is gone: stop the work behind it.
          abort()
        }
      }
      const send: Send<E> = e => write(`data: ${JSON.stringify(e)}\n\n`)
      const ping = setInterval(() => write(': ping\n\n'), PING_MS)
      try {
        await run(send, ac.signal)
      } finally {
        clearInterval(ping)
        req.signal.removeEventListener('abort', abort)
        closed = true
        try { controller.close() } catch { /* already closed by a cancel */ }
      }
    },
    cancel() {
      closed = true
      abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
