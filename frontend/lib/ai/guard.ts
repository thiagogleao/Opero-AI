import type { Viewer } from '@/lib/access'
import { RATE_LIMITS } from './config'
import { RateLimiter, waitLabel } from './rateLimit'

/**
 * The checks every AI route makes before a model is called: who is asking
 * (lib/access), how often they have asked (per-viewer limits) and whether the
 * body is something we accept. A route that skipped any of these was an open
 * LLM proxy billed to the owner's key.
 */

/** The rate-limit and log identity of a viewer. The owner is one person on
 *  any device; a partner is one Clerk account. */
export function viewerKey(v: Viewer): string {
  return v.kind === 'owner' ? 'owner' : `partner:${v.userId}`
}

// One process (Railway runs a single long-lived Node server), so memory is
// enough; a restart only loosens the limit for a moment.
export const chatLimiter = new RateLimiter(RATE_LIMITS.chat)
export const insightsLimiter = new RateLimiter(RATE_LIMITS.insights)

export function jsonError(status: number, error: string, extra: Record<string, unknown> = {}, headers?: HeadersInit): Response {
  return Response.json({ error, ...extra }, { status, headers })
}

export function rateLimitedResponse(retryAfter: number, what: string): Response {
  return jsonError(429, `Limite de ${what} atingido. Tente de novo ${waitLabel(retryAfter)}.`,
    { code: 'rate_limited', retryAfter }, { 'Retry-After': String(retryAfter) })
}

/** The request body as a plain object, or null when it is not JSON. Bodies are
 *  small (a question and a short history); anything bigger is refused before
 *  parsing. */
export async function readJsonBody(req: Request, maxBytes = 200_000): Promise<Record<string, unknown> | null> {
  const len = Number(req.headers.get('content-length') ?? 0)
  if (len > maxBytes) return null
  try {
    const text = await req.text()
    if (text.length > maxBytes) return null
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}
