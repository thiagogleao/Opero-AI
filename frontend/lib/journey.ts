import { query } from './db'

/**
 * Collects the path to each purchase from Shopify.
 *
 * Shopify already tracks every visit that preceded an order, first-party, and
 * exposes it as `customerJourneySummary`. Meta's ad URLs carry the campaign,
 * adset and ad ids in the utm fields, so a stored touch joins straight to
 * fb_ads and its spend — which is what turns "this order came from Instagram"
 * into "this order came from this creative, which cost this much".
 *
 * Two things about the source data shape the design:
 *   - The journey is computed asynchronously. A fresh order answers
 *     `ready: false` with no moments, so it has to be asked again later.
 *   - The query is expensive in Shopify's cost budget, so every page reads the
 *     throttle status it returns and waits when the bucket runs low.
 */

const API_VERSION = '2024-10'

// Small pages: customerJourneySummary with its moments is one of the priciest
// things in the Admin API, and a big page can exceed the single-query ceiling.
const PAGE_SIZE = 10
const MOMENTS_PER_ORDER = 20

export interface JourneyStore {
  id: string
  shopify_domain: string
  shopify_access_token: string
}

interface UtmParameters {
  source?: string | null
  medium?: string | null
  campaign?: string | null
  content?: string | null
  term?: string | null
}

interface Moment {
  occurredAt?: string | null
  landingPage?: string | null
  referrerUrl?: string | null
  source?: string | null
  sourceType?: string | null
  utmParameters?: UtmParameters | null
}

interface JourneyNode {
  id: string
  createdAt: string
  customerJourneySummary: {
    ready: boolean
    momentsCount: { count: number; precision: string } | null
    daysToConversion: number | null
    customerOrderIndex: number | null
    moments: { edges: { node: Moment }[] } | null
  } | null
}

const QUERY = `
query journeys($cursor: String, $pageSize: Int!, $moments: Int!) {
  orders(first: $pageSize, reverse: true, sortKey: CREATED_AT, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id
      createdAt
      customerJourneySummary {
        ready
        momentsCount { count precision }
        daysToConversion
        customerOrderIndex
        moments(first: $moments) { edges { node {
          occurredAt
          ... on CustomerVisit {
            landingPage
            referrerUrl
            source
            sourceType
            utmParameters { source medium campaign content term }
          }
        } } }
      }
    } }
  }
}`

/** "gid://shopify/Order/123" → "123", matching shopify_orders.order_id. */
function numericId(gid: string): string {
  const tail = gid.split('/').pop() ?? gid
  return tail.split('?')[0]
}

/**
 * Meta writes the campaign, adset and ad ids into the utm fields. Anything that
 * is not a long run of digits is someone's hand-written campaign name, and
 * storing it as an id would silently produce joins that never match.
 */
function asMetaId(value: string | null | undefined): string | null {
  if (!value) return null
  return /^\d{10,}$/.test(value) ? value : null
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface PageResult {
  nodes: JourneyNode[]
  hasNextPage: boolean
  endCursor: string | null
}

async function fetchPage(store: JourneyStore, cursor: string | null): Promise<PageResult> {
  const res = await fetch(`https://${store.shopify_domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': store.shopify_access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: QUERY,
      variables: { cursor, pageSize: PAGE_SIZE, moments: MOMENTS_PER_ORDER },
    }),
  })

  if (res.status === 429) {
    await sleep(4000)
    return fetchPage(store, cursor)
  }
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`)

  const json = await res.json()
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`)

  // Stay inside the leaky bucket rather than waiting for it to reject us.
  const throttle = json.extensions?.cost?.throttleStatus
  if (throttle && throttle.currentlyAvailable < 200) {
    const restore = throttle.restoreRate || 50
    await sleep(Math.ceil(((400 - throttle.currentlyAvailable) / restore) * 1000))
  }

  const orders = json.data?.orders
  return {
    nodes: (orders?.edges ?? []).map((e: { node: JourneyNode }) => e.node),
    hasNextPage: Boolean(orders?.pageInfo?.hasNextPage),
    endCursor: orders?.pageInfo?.endCursor ?? null,
  }
}

/** Write one order's journey and its touches. Rewrites touches wholesale, so a
 *  journey that was not ready before is replaced rather than duplicated. */
async function saveJourney(tenantId: string, node: JourneyNode): Promise<void> {
  const orderId = numericId(node.id)
  const j = node.customerJourneySummary

  const moments = (j?.moments?.edges ?? []).map(e => e.node)
  const ads = moments.map(m => asMetaId(m.utmParameters?.content))
  const withAd = ads.filter((a): a is string => a !== null)

  await query(
    `INSERT INTO order_journeys (
       tenant_id, order_id, ready, moments_count, moments_precision,
       days_to_conversion, customer_order_index, first_ad_id, last_ad_id,
       order_created_at, synced_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (tenant_id, order_id) DO UPDATE SET
       ready = $3, moments_count = $4, moments_precision = $5,
       days_to_conversion = $6, customer_order_index = $7,
       first_ad_id = $8, last_ad_id = $9, order_created_at = $10, synced_at = NOW()`,
    [
      tenantId, orderId, j?.ready ?? false,
      j?.momentsCount?.count ?? null, j?.momentsCount?.precision ?? null,
      j?.daysToConversion ?? null, j?.customerOrderIndex ?? null,
      withAd[0] ?? null, withAd[withAd.length - 1] ?? null,
      node.createdAt,
    ]
  )

  if (moments.length === 0) return

  await query(`DELETE FROM order_touchpoints WHERE tenant_id = $1 AND order_id = $2`, [tenantId, orderId])

  for (const [i, m] of moments.entries()) {
    const u = m.utmParameters ?? {}
    await query(
      `INSERT INTO order_touchpoints (
         tenant_id, order_id, seq, occurred_at, source, source_type,
         referrer_url, landing_page, utm_source, utm_medium, utm_campaign,
         utm_content, utm_term, ad_id, adset_id, campaign_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (tenant_id, order_id, seq) DO NOTHING`,
      [
        tenantId, orderId, i + 1, m.occurredAt ?? null,
        m.source ?? null, m.sourceType ?? null,
        m.referrerUrl ?? null, m.landingPage ?? null,
        u.source ?? null, u.medium ?? null, u.campaign ?? null,
        u.content ?? null, u.term ?? null,
        asMetaId(u.content), asMetaId(u.term), asMetaId(u.campaign),
      ]
    )
  }
}

export interface SyncResult {
  tenantId: string
  scanned: number
  saved: number
  skipped: number
  pages: number
  reachedEnd: boolean
  error?: string
}

/**
 * Walk a store's orders newest-first and store their journeys.
 *
 * `maxOrders` bounds one run so a scheduled pass cannot run away; the cursor is
 * kept so the next run continues where this one stopped. Orders already stored
 * as ready are skipped — except in `refresh` mode, which is how a journey that
 * was not ready at collection time eventually gets filled in.
 */
export async function syncJourneys(
  store: JourneyStore,
  opts: { maxOrders?: number; resume?: boolean; stopAfterKnown?: number } = {}
): Promise<SyncResult> {
  const maxOrders = opts.maxOrders ?? 200
  // Once the newest orders are all stored, the recurring pass would otherwise
  // pay for page after page of orders it already has. A run of consecutive
  // known orders means we have caught up.
  const stopAfterKnown = opts.stopAfterKnown ?? 0
  let consecutiveKnown = 0
  const out: SyncResult = {
    tenantId: store.id, scanned: 0, saved: 0, skipped: 0, pages: 0, reachedEnd: false,
  }

  let cursor: string | null = null
  if (opts.resume) {
    const [state] = await query<{ backfill_cursor: string | null; backfill_done: boolean }>(
      `SELECT backfill_cursor, backfill_done FROM journey_sync_state WHERE tenant_id = $1`,
      [store.id]
    )
    if (state?.backfill_done) { out.reachedEnd = true; return out }
    cursor = state?.backfill_cursor ?? null
  }

  // Everything already stored and settled, so a page of known orders is cheap
  // to skip without asking the database once per order.
  const done = new Set(
    (await query<{ order_id: string }>(
      `SELECT order_id FROM order_journeys WHERE tenant_id = $1 AND ready = true`,
      [store.id]
    )).map(r => r.order_id)
  )

  try {
    while (out.scanned < maxOrders) {
      const page: PageResult = await fetchPage(store, cursor)
      out.pages++
      if (page.nodes.length === 0) { out.reachedEnd = true; break }

      let caughtUp = false
      for (const node of page.nodes) {
        out.scanned++
        if (done.has(numericId(node.id))) {
          out.skipped++
          consecutiveKnown++
          if (stopAfterKnown > 0 && consecutiveKnown >= stopAfterKnown) { caughtUp = true; break }
          continue
        }
        consecutiveKnown = 0
        await saveJourney(store.id, node)
        out.saved++
      }
      if (caughtUp) break

      cursor = page.endCursor
      if (!page.hasNextPage) { out.reachedEnd = true; break }
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err)
    console.error('[journey] sync failed for', store.id, out.error)
  }

  await query(
    `INSERT INTO journey_sync_state (tenant_id, backfill_cursor, backfill_done, last_run_at, orders_synced)
     VALUES ($1, $2, $3, NOW(), $4)
     ON CONFLICT (tenant_id) DO UPDATE SET
       backfill_cursor = $2,
       backfill_done   = journey_sync_state.backfill_done OR $3,
       last_run_at     = NOW(),
       orders_synced   = journey_sync_state.orders_synced + $4`,
    [store.id, opts.resume ? cursor : null, opts.resume ? out.reachedEnd : false, out.saved]
  )

  return out
}

/** Re-ask Shopify for journeys that were not ready when first collected. */
export async function refreshPendingJourneys(
  store: JourneyStore,
  opts: { maxOrders?: number } = {}
): Promise<{ checked: number; nowReady: number }> {
  const rows = await query<{ order_id: string }>(
    `SELECT order_id FROM order_journeys
     WHERE tenant_id = $1 AND ready = false
       -- Shopify needs a little time; asking again immediately just burns quota.
       AND synced_at < NOW() - INTERVAL '30 minutes'
     ORDER BY order_created_at DESC
     LIMIT $2`,
    [store.id, opts.maxOrders ?? 50]
  )
  if (rows.length === 0) return { checked: 0, nowReady: 0 }

  const SINGLE = `
  query one($id: ID!, $moments: Int!) {
    order(id: $id) {
      id
      createdAt
      customerJourneySummary {
        ready
        momentsCount { count precision }
        daysToConversion
        customerOrderIndex
        moments(first: $moments) { edges { node {
          occurredAt
          ... on CustomerVisit {
            landingPage referrerUrl source sourceType
            utmParameters { source medium campaign content term }
          }
        } } }
      }
    }
  }`

  let nowReady = 0
  for (const { order_id } of rows) {
    try {
      const res = await fetch(`https://${store.shopify_domain}/admin/api/${API_VERSION}/graphql.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': store.shopify_access_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: SINGLE,
          variables: { id: `gid://shopify/Order/${order_id}`, moments: MOMENTS_PER_ORDER },
        }),
      })
      const json = await res.json()
      const node: JourneyNode | null = json.data?.order ?? null
      if (!node) continue
      await saveJourney(store.id, node)
      if (node.customerJourneySummary?.ready) nowReady++
    } catch (err) {
      console.error('[journey] refresh failed', store.id, order_id, err)
    }
  }

  return { checked: rows.length, nowReady }
}

/** Stores the journey collector can run against. */
export async function journeyStores(): Promise<JourneyStore[]> {
  return query<JourneyStore>(
    `SELECT id, shopify_domain, shopify_access_token
     FROM tenants
     WHERE shopify_access_token IS NOT NULL AND shopify_domain IS NOT NULL
     ORDER BY created_at`
  )
}
