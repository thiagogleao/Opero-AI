import { listStores, requireStore, requireViewer, resolveStore, type StoreRef, type Viewer } from '@/lib/access'
import type { DateRange, Period } from '@/lib/engine/dates'
import { getAlertConfig } from '@/lib/alerts'
import type { ScaleThresholds } from '@/lib/campaignSignal'
import { BadRequest, parseWindow } from './window'

/**
 * What every campaign route needs from a request: who is asking, which store
 * (always through requireStore — never a cookie or a URL alone), and which
 * calendar days, resolved on the server in the store's own timezone.
 */

export interface CampaignRequest {
  viewer: Viewer
  store: StoreRef
  range: DateRange
  period: Period
  /** id → disambiguated name of every store the viewer can see. */
  storeNames: Map<string, string>
}

/**
 * ?store=<id> plus the window parameters (see parseWindow). Without a store,
 * the viewer's current store is used. Default window: the last 7 closed days.
 */
export async function readCampaignRequest(req: Request, fallback: Period = '7d'): Promise<CampaignRequest> {
  const sp = new URL(req.url).searchParams
  const viewer = await requireViewer()
  const wanted = sp.get('store') ?? (await resolveStore(viewer, null)).store?.id
  const store = await requireStore(viewer, wanted)
  const { range, period } = parseWindow(sp, store.timezone, fallback)
  const stores = await listStores(viewer, { includeArchived: true })
  return { viewer, store, range, period, storeNames: new Map(stores.map(s => [s.id, s.name])) }
}

/**
 * The action thresholds. There is no per-store setting: minMargin is the
 * owner's scale threshold from the alert settings (default 20%), the same
 * number the push alerts use, so a badge and a push never disagree.
 */
export async function scaleThresholds(): Promise<Partial<ScaleThresholds>> {
  const cfg = await getAlertConfig()
  return { minMargin: cfg.scaleAlerts.threshold }
}

export function badRequestResponse(err: unknown): Response | null {
  return err instanceof BadRequest ? Response.json({ error: err.message }, { status: 400 }) : null
}
