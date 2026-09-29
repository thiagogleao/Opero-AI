import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { getTenantsByUserId } from '@/lib/tenant'
import { syncJourneys, refreshPendingJourneys, type JourneyStore } from '@/lib/journey'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** How far the journey collection has got, for the signed-in user's stores. */
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const stores = await getTenantsByUserId(userId)
  const ids = stores.map(s => s.id)
  if (ids.length === 0) return NextResponse.json({ stores: [] })

  const rows = await query<{
    tenant_id: string; journeys: string; ready: string; orders: string
    touches: string; with_ad: string; matched_ad: string
    backfill_done: boolean; last_run_at: string | null
  }>(
    `SELECT t.id AS tenant_id,
       (SELECT count(*) FROM order_journeys j WHERE j.tenant_id = t.id)::text                         AS journeys,
       (SELECT count(*) FROM order_journeys j WHERE j.tenant_id = t.id AND j.ready)::text             AS ready,
       (SELECT count(*) FROM shopify_orders o WHERE o.tenant_id = t.id)::text                         AS orders,
       (SELECT count(*) FROM order_touchpoints p WHERE p.tenant_id = t.id)::text                      AS touches,
       (SELECT count(*) FROM order_touchpoints p WHERE p.tenant_id = t.id AND p.ad_id IS NOT NULL)::text AS with_ad,
       (SELECT count(*) FROM order_touchpoints p JOIN fb_ads a ON a.ad_id = p.ad_id
          WHERE p.tenant_id = t.id)::text                                                              AS matched_ad,
       COALESCE(s.backfill_done, false) AS backfill_done,
       s.last_run_at::text              AS last_run_at
     FROM tenants t
     LEFT JOIN journey_sync_state s ON s.tenant_id = t.id
     WHERE t.id = ANY($1::text[])`,
    [ids]
  )

  const byId = new Map(rows.map(r => [r.tenant_id, r]))
  return NextResponse.json({
    stores: stores.map(s => {
      const r = byId.get(s.id)
      const orders = Number(r?.orders ?? 0)
      const journeys = Number(r?.journeys ?? 0)
      return {
        id: s.id,
        name: s.shop_name ?? s.shopify_domain?.replace('.myshopify.com', '') ?? 'Loja',
        orders,
        journeys,
        ready: Number(r?.ready ?? 0),
        touches: Number(r?.touches ?? 0),
        touchesWithAd: Number(r?.with_ad ?? 0),
        touchesMatchedToAd: Number(r?.matched_ad ?? 0),
        coverage: orders > 0 ? Math.round((journeys / orders) * 100) : 0,
        backfillDone: Boolean(r?.backfill_done),
        lastRunAt: r?.last_run_at ?? null,
      }
    }),
  })
}

/**
 * Run a collection pass now, for this user's stores.
 *
 * The scheduler already does this every 20 minutes; this is for when you have
 * just connected a store and do not want to wait for the cycle.
 */
export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { maxOrders?: number; mode?: string }
  // Bounded on purpose: this runs inside a request, and the Shopify query is
  // slow enough that an unbounded backfill would outlive the connection.
  const maxOrders = Math.min(Math.max(Number(body.maxOrders) || 60, 1), 200)

  const tenants = await getTenantsByUserId(userId)
  const stores: JourneyStore[] = tenants
    .filter(t => t.shopify_access_token && t.shopify_domain)
    .map(t => ({
      id: t.id,
      shopify_domain: t.shopify_domain as string,
      shopify_access_token: t.shopify_access_token as string,
    }))

  const results = []
  for (const store of stores) {
    const recent = await syncJourneys(store, {
      maxOrders,
      resume: body.mode === 'backfill',
      stopAfterKnown: body.mode === 'backfill' ? 0 : 15,
    })
    const refreshed = await refreshPendingJourneys(store, { maxOrders: 25 })
    results.push({ ...recent, nowReady: refreshed.nowReady })
  }

  return NextResponse.json({ results })
}
