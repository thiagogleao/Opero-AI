import { AccessError, getViewer, requireStore, resolveStore, type StoreRef, type Viewer } from '../access'

/**
 * Small helpers shared by the integration routes. Every route resolves the
 * viewer with lib/access getViewer() and the store with requireStore(), so a
 * partner can only ever touch the stores of their own account — whatever a
 * cookie, a body or a URL says. A store the viewer cannot see is a 404, the
 * same answer as a store that does not exist.
 */

/** An error with a status the client can act on and a Portuguese message. */
export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message)
  }
}

export function errorResponse(err: unknown): Response {
  if (err instanceof AccessError) return Response.json({ error: err.message, code: err.status === 401 ? 'unauthenticated' : 'not_found' }, { status: err.status })
  if (err instanceof HttpError) return Response.json({ error: err.message, code: err.code, ...err.extra }, { status: err.status })
  console.error('[integrations]', err instanceof Error ? err.message : err)
  return Response.json({ error: 'Erro interno', code: 'internal' }, { status: 500 })
}

export async function viewerOrThrow(): Promise<Viewer> {
  const v = await getViewer()
  if (!v) throw new AccessError(401)
  return v
}

/** `store` (what the data routes use) or `storeId`, from a URL. */
export function storeParam(url: URL): string | null {
  return url.searchParams.get('store') || url.searchParams.get('storeId') || null
}

/** `storeId` or `store` from a JSON body. */
export function storeFromBody(body: Record<string, unknown>): string | null {
  const v = body.storeId ?? body.store
  return typeof v === 'string' && v ? v : null
}

/**
 * The store a request is about: the explicit id when given (404 unless the
 * viewer may see it), otherwise the viewer's active store. The fallback exists
 * for the current settings screens, which do not send an id yet; new screens
 * should always send one.
 */
export async function targetStore(viewer: Viewer, explicitId: string | null): Promise<StoreRef> {
  if (explicitId) return requireStore(viewer, explicitId)
  const { store } = await resolveStore(viewer, null)
  if (!store) throw new AccessError(404)
  return store
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch { /* fall through */ }
  throw new HttpError(400, 'invalid_body', 'Corpo da requisição inválido (JSON esperado)')
}

/**
 * Public origin of the app. Behind Railway's proxy the request's own origin is
 * the container address, so the configured public URL wins. The forwarded
 * host is not used: it can be set by the caller.
 */
export function appOrigin(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/+$/, '')
  return new URL(req.url).origin
}

/** Cookie options for the short-lived flow cookies. */
export function flowCookie(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  }
}

/** The Clerk account a new store will belong to. A partner adds to their own
 *  account; the owner's unlocked device has no account of its own, so it must
 *  also be signed in to the Clerk account that will own the store. */
export async function accountForNewStore(viewer: Viewer): Promise<string> {
  if (viewer.kind === 'partner') return viewer.userId
  try {
    const { auth } = await import('@clerk/nextjs/server')
    const { userId } = await auth()
    if (userId) return userId
  } catch { /* not behind Clerk */ }
  throw new HttpError(400, 'account_required', 'Para adicionar uma loja, entre com a conta (Clerk) que vai ser dona dela.')
}
