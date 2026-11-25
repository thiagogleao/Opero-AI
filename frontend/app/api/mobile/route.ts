import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import { listStores } from '@/lib/access'
import { landingNotes, resolve, viewerStores as buildViewerStores, type Selection } from '@/lib/period'
import { viewerStoresOf } from '@/lib/views/periodFacts'
import { PortfolioInputError } from '@/lib/views/portfolio'
import {
  echoOf, parseMobilePeriod, portfolioOnce, selectStores, StoreSelectionError, toOption, type MobileResponse,
} from '@/lib/views/mobile'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The phone's home screen: GET /api/mobile?store=&period=&from=&to=
 *
 * The request carries the SELECTION, not resolved dates (lib/period R19):
 *  store   'all' (default: every active store) or a store id (an archived one
 *          only by id: consultation). Several ids, comma-separated, are summed
 *          as a Todas of those stores.
 *  period  a preset (default 'today'), or 'custom' with from and to
 *          (YYYY-MM-DD), normalised (ordered, at most 366 days ending at `to`).
 * The server resolves with its own clock and answers with lib/views/mobile.ts
 * MobileResponse: the portfolio view (with its `resolution`), `serverNow`,
 * `facts` (the store facts it resolved with), the request echoed back, and the
 * store picker. 400 only for a malformed request; a long or future range is
 * fitted and announced in the resolution's notes (R9).
 *
 * Owner only (the magic-link cookie or the x-mobile-token header): this surface
 * spans every store, so a partner's Clerk session gets nothing here.
 */
export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const sp = new URL(req.url).searchParams
  const parsed = parseMobilePeriod(sp)
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 })

  try {
    const now = new Date() // clock-ok: the request instant every resolution of this answer uses
    const visible = await listStores({ kind: 'owner' }, { includeArchived: true })
    const { key, stores } = selectStores(sp.get('store'), visible)
    const facts = await viewerStoresOf(visible)
    // Several ids: a Todas of exactly those stores, on Todas' rule.
    const several = key !== 'all' && stores.length > 1
    const vs = several
      ? buildViewerStores(stores.map(s => {
          const f = [...facts.active, ...facts.archived].find(x => x.id === s.id)
          // selectStores refused any archived id in a list (R2, R10).
          return { id: s.id, name: s.name, timezone: s.timezone, archived: false, firstOrderDate: f?.firstOrderDate, firstActivityDate: f?.firstActivityDate }
        }))
      : facts
    const selection: Selection = {
      scope: key === 'all' || several ? { kind: 'all' } : { kind: 'store', id: stores[0].id },
      period: parsed.value,
      split: false,
    }
    // How the asked dates were normalised (too_long, floor) is said in the
    // answer's notes, with the same words as the desktop (R9).
    const base = resolve(selection, vs, now)
    const extra = landingNotes(parsed.notes.map(code => ({ code })), null, base, vs, now)
    const resolution = extra.length ? resolve(selection, vs, now, { notes: extra }) : base
    const view = await portfolioOnce(stores, resolution, vs)
    const body: MobileResponse = {
      ...view,
      serverNow: new Date().toISOString(), // clock-ok: the answer's send instant, for the client's offset (R19)
      facts,
      request: echoOf(key, parsed.value),
      storeOptions: visible.filter(s => !s.archived).map(toOption),
      archivedStores: visible.filter(s => s.archived).map(toOption),
    }
    return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    if (err instanceof StoreSelectionError) return Response.json({ error: err.message }, { status: err.status })
    if (err instanceof PortfolioInputError) return Response.json({ error: err.message }, { status: 400 })
    console.error('[mobile] portfolio failed', err)
    return Response.json({ error: 'Falha ao calcular os números' }, { status: 500 })
  }
}
