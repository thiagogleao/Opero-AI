import { pool, query } from './db'

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
 *   - The query is expensive in Shopify's cost budget, so every call reads the
 *     throttle status it returns and waits when the bucket runs low.
 *
 * This module holds what the paged collector and the bulk backfill
 * (journeyBulk.ts) share: the API version, id parsing, the moment fields, and
 * the one writer both use, so an order collected either way is stored the
 * same way (moments sorted by time, first and last ad from the full list).
 */

export const API_VERSION = '2024-10'

// Small pages: customerJourneySummary with its moments is one of the priciest
// things in the Admin API, and a big page can exceed the single-query ceiling.
const PAGE_SIZE = 10
const MOMENTS_FIRST_PAGE = 20
const MOMENTS_MORE_PAGE = 50
// An order with more visits than this is an outlier (a bot, a shared device);
// the cap bounds the cost of one order, and the stored momentsCount still says
// how many Shopify counted.
const MAX_MOMENTS = 250
// Shopify settles a journey within hours. One still not ready after a week
// never will be, and asking forever would crowd out the fresh ones.
const PENDING_MAX_AGE_DAYS = 7

export interface JourneyStore {
  id: string
  shopify_domain: string
  shopify_access_token: string
}

export interface UtmParameters {
  source?: string | null
  medium?: string | null
  campaign?: string | null
  content?: string | null
  term?: string | null
}

export interface Moment {
  occurredAt?: string | null
  landingPage?: string | null
  referrerUrl?: string | null
  source?: string | null
  sourceType?: string | null
  utmParameters?: UtmParameters | null
}

export interface JourneySummary {
  ready: boolean
  momentsCount: { count: number; precision: string } | null
  daysToConversion: number | null
  customerOrderIndex: number | null
}

/** One order's journey, parsed, ready to store. */
export interface ParsedJourney {
  orderId: string
  createdAt: string
  summary: JourneySummary | null
  /** Sorted by time. Empty when Shopify has none (yet). */
  moments: Moment[]
}

/** The visit fields, one copy for every query that reads moments. */
export const MOMENT_FIELDS = `
  occurredAt
  ... on CustomerVisit {
    landingPage referrerUrl source sourceType
    utmParameters { source medium campaign content term }
  }`

const SUMMARY_FIELDS = `ready momentsCount { count precision } daysToConversion customerOrderIndex`

const PAGE_QUERY = `
query journeys($cursor: String, $pageSize: Int!, $moments: Int!) {
  orders(first: $pageSize, reverse: true, sortKey: CREATED_AT, after: $cursor) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id
      createdAt
      customerJourneySummary {
        ${SUMMARY_FIELDS}
        moments(first: $moments) { pageInfo { hasNextPage endCursor } edges { node { ${MOMENT_FIELDS} } } }
      }
    } }
  }
}`

const SINGLE_QUERY = `
query one($id: ID!, $moments: Int!) {
  order(id: $id) {
    id
    createdAt
    customerJourneySummary {
      ${SUMMARY_FIELDS}
      moments(first: $moments) { pageInfo { hasNextPage endCursor } edges { node { ${MOMENT_FIELDS} } } }
    }
  }
}`

const MORE_MOMENTS_QUERY = `
query more($id: ID!, $after: String!, $moments: Int!) {
  order(id: $id) {
    customerJourneySummary {
      moments(first: $moments, after: $after) { pageInfo { hasNextPage endCursor } edges { node { ${MOMENT_FIELDS} } } }
    }
  }
}`

interface MomentConnection {
  pageInfo?: { hasNextPage: boolean; endCursor: string | null } | null
  edges: { node: Moment }[]
}

interface JourneyNode {
  id: string
  createdAt: string
  customerJourneySummary: (JourneySummary & { moments: MomentConnection | null }) | null
}

/** "gid://shopify/Order/123" → "123", matching shopify_orders.order_id. */
export function numericId(gid: string): string {
  const tail = gid.split('/').pop() ?? gid
  return tail.split('?')[0]
}

/**
 * Meta writes the campaign, adset and ad ids into the utm fields. Anything that
 * is not a long run of digits is someone's hand-written campaign name, and
 * storing it as an id would silently produce joins that never match.
 */
export function asMetaId(value: string | null | undefined): string | null {
  if (!value) return null
  return /^\d{10,}$/.test(value) ? value : null
}

/** Visits in time order; ties keep Shopify's order. */
export function sortMoments(moments: Moment[]): Moment[] {
  return moments
    .map((m, i) => ({ m, i }))
    .sort((a, b) => String(a.m.occurredAt ?? '').localeCompare(String(b.m.occurredAt ?? '')) || a.i - b.i)
    .map(x => x.m)
}

/** First and last Meta ad among the visits (already sorted). */
export function adsOf(moments: Moment[]): { first: string | null; last: string | null } {
  const ads = moments.map(m => asMetaId(m.utmParameters?.content)).filter((a): a is string => a !== null)
  return { first: ads[0] ?? null, last: ads[ads.length - 1] ?? null }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export class ShopifyThrottled extends Error {
  constructor() { super('Shopify throttled the journey query') }
}

interface GqlResponse<T> {
  data?: T
  errors?: { message?: string; extensions?: { code?: string } }[]
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable: number; restoreRate: number; maximumAvailable?: number } } }
}

/**
 * One Admin GraphQL call with the cost budget respected: a 429 or a THROTTLED
 * error waits and retries (three times), and a bucket running low waits
 * before the next call rather than being rejected by it.
 */
export async function shopifyGraphql<T>(
  store: JourneyStore, gql: string, variables: Record<string, unknown> = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://${store.shopify_domain}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'X-Shopify-Access-Token': store.shopify_access_token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: gql, variables }),
    })
    if (res.status === 429) {
      if (attempt >= 3) throw new ShopifyThrottled()
      await sleep(4000 * (attempt + 1))
      continue
    }
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = (await res.json()) as GqlResponse<T>
    const throttle = json.extensions?.cost?.throttleStatus
    if (json.errors?.length) {
      if (json.errors.some(e => e.extensions?.code === 'THROTTLED')) {
        if (attempt >= 3) throw new ShopifyThrottled()
        const restore = throttle?.restoreRate || 50
        const need = json.extensions?.cost?.requestedQueryCost ?? 400
        const have = throttle?.currentlyAvailable ?? 0
        await sleep(Math.ceil((Math.max(need - have, 50) / restore) * 1000))
        continue
      }
      throw new Error(`GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`)
    }
    // Stay inside the leaky bucket rather than waiting for it to reject us.
    if (throttle && throttle.currentlyAvailable < 200) {
      const restore = throttle.restoreRate || 50
      await sleep(Math.ceil(((400 - throttle.currentlyAvailable) / restore) * 1000))
    }
    return json.data as T
  }
}

/**
 * Every moment of one order. The first page came with the order; the rest is
 * fetched here, up to MAX_MOMENTS — reading only the first 20 used to give
 * long journeys the wrong last-click ad.
 */
async function allMoments(store: JourneyStore, node: JourneyNode): Promise<Moment[]> {
  const conn = node.customerJourneySummary?.moments
  const out = (conn?.edges ?? []).map(e => e.node)
  let page = conn?.pageInfo ?? null
  while (page?.hasNextPage && page.endCursor && out.length < MAX_MOMENTS) {
    const data = await shopifyGraphql<{ order: { customerJourneySummary: { moments: MomentConnection | null } | null } | null }>(
      store, MORE_MOMENTS_QUERY,
      { id: node.id, after: page.endCursor, moments: Math.min(MOMENTS_MORE_PAGE, MAX_MOMENTS - out.length) },
    )
    const more = data.order?.customerJourneySummary?.moments
    if (!more) break
    out.push(...more.edges.map(e => e.node))
    page = more.pageInfo ?? null
  }
  return out
}

async function parseNode(store: JourneyStore, node: JourneyNode): Promise<ParsedJourney> {
  const s = node.customerJourneySummary
  return {
    orderId: numericId(node.id),
    createdAt: node.createdAt,
    summary: s ? {
      ready: s.ready, momentsCount: s.momentsCount,
      daysToConversion: s.daysToConversion, customerOrderIndex: s.customerOrderIndex,
    } : null,
    moments: sortMoments(s?.ready ? await allMoments(store, node) : (s?.moments?.edges ?? []).map(e => e.node)),
  }
}

// ─── Writing ──────────────────────────────────────────────────────────────────

// One statement per batch instead of per row: thousands of inserts one at a
// time is almost all round-trip time.
const WRITE_BATCH = 300

function placeholders(rowCount: number, width: number, offset = 0, tail = ''): string {
  const rows: string[] = []
  for (let r = 0; r < rowCount; r++) {
    const cells = Array.from({ length: width }, (_, k) => `$${offset + r * width + k + 1}`)
    rows.push(`(${cells.join(',')}${tail})`)
  }
  return rows.join(',')
}

/**
 * Store journeys and their touches, in one transaction per batch. Touches are
 * rewritten wholesale for every order that came with moments, so a journey
 * that was not ready before is replaced rather than duplicated; an order with
 * no moments (not ready yet) keeps whatever touches it had.
 */
export async function writeJourneys(tenantId: string, input: ParsedJourney[]): Promise<number> {
  // One row per order: a multi-row upsert that names the same key twice is an
  // error in Postgres ("cannot affect row a second time"). The last copy wins.
  const journeys = [...new Map(input.map(j => [j.orderId, j])).values()]
  let touches = 0
  for (let i = 0; i < journeys.length; i += WRITE_BATCH) {
    const slice = journeys.slice(i, i + WRITE_BATCH)
    const jValues: unknown[] = []
    for (const j of slice) {
      const ads = adsOf(j.moments)
      jValues.push(
        tenantId, j.orderId, j.summary?.ready ?? false,
        j.summary?.momentsCount?.count ?? null, j.summary?.momentsCount?.precision ?? null,
        j.summary?.daysToConversion ?? null, j.summary?.customerOrderIndex ?? null,
        ads.first, ads.last, j.createdAt,
      )
    }

    const withMoments = slice.filter(j => j.moments.length > 0)
    const tValues: unknown[] = []
    for (const j of withMoments) {
      j.moments.forEach((m, idx) => {
        const u = m.utmParameters ?? {}
        tValues.push(
          tenantId, j.orderId, idx + 1, m.occurredAt ?? null,
          m.source ?? null, m.sourceType ?? null, m.referrerUrl ?? null, m.landingPage ?? null,
          u.source ?? null, u.medium ?? null, u.campaign ?? null, u.content ?? null, u.term ?? null,
          asMetaId(u.content), asMetaId(u.term), asMetaId(u.campaign),
        )
      })
    }

    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query(
        `INSERT INTO order_journeys (
           tenant_id, order_id, ready, moments_count, moments_precision,
           days_to_conversion, customer_order_index, first_ad_id, last_ad_id,
           order_created_at, synced_at
         ) VALUES ${placeholders(slice.length, 10, 0, ',NOW()')}
         ON CONFLICT (tenant_id, order_id) DO UPDATE SET
           ready = EXCLUDED.ready, moments_count = EXCLUDED.moments_count,
           moments_precision = EXCLUDED.moments_precision,
           days_to_conversion = EXCLUDED.days_to_conversion,
           customer_order_index = EXCLUDED.customer_order_index,
           first_ad_id = EXCLUDED.first_ad_id, last_ad_id = EXCLUDED.last_ad_id,
           order_created_at = EXCLUDED.order_created_at, synced_at = NOW()`,
        jValues,
      )
      if (withMoments.length) {
        await client.query(
          `DELETE FROM order_touchpoints WHERE tenant_id = $1 AND order_id = ANY($2::text[])`,
          [tenantId, withMoments.map(j => j.orderId)],
        )
        // 16 columns × rows must stay under Postgres' 65,535 parameters.
        const perStatement = 2000
        const width = 16
        for (let k = 0; k < tValues.length; k += perStatement * width) {
          const chunk = tValues.slice(k, k + perStatement * width)
          await client.query(
            `INSERT INTO order_touchpoints (
               tenant_id, order_id, seq, occurred_at, source, source_type,
               referrer_url, landing_page, utm_source, utm_medium, utm_campaign,
               utm_content, utm_term, ad_id, adset_id, campaign_id
             ) VALUES ${placeholders(chunk.length / width, width)}
             ON CONFLICT (tenant_id, order_id, seq) DO NOTHING`,
            chunk,
          )
        }
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
    touches += tValues.length / 16
  }
  return touches
}

// ─── The recurring pass ───────────────────────────────────────────────────────

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
 * Walk a store's orders newest-first and store the journeys not stored yet.
 *
 * `maxOrders` bounds one run so a scheduled pass cannot run away, and
 * `stopAfterKnown` ends it once it meets that many consecutive orders it
 * already has. History is the bulk backfill's job (journeyBulk.ts); the old
 * paged backfill mode is gone, and with it the cursor this pass used to
 * overwrite with NULL on every run.
 */
export async function syncJourneys(
  store: JourneyStore,
  opts: { maxOrders?: number; stopAfterKnown?: number } = {},
): Promise<SyncResult> {
  const maxOrders = opts.maxOrders ?? 200
  const stopAfterKnown = opts.stopAfterKnown ?? 0
  let consecutiveKnown = 0
  const out: SyncResult = { tenantId: store.id, scanned: 0, saved: 0, skipped: 0, pages: 0, reachedEnd: false }

  // Settled orders are skipped without asking the database once per order.
  const done = new Set(
    (await query<{ order_id: string }>(
      `SELECT order_id FROM order_journeys WHERE tenant_id = $1 AND ready = true`,
      [store.id],
    )).map(r => r.order_id),
  )

  let cursor: string | null = null
  try {
    while (out.scanned < maxOrders) {
      type PageData = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: { node: JourneyNode }[] } | null }
      const data: PageData = await shopifyGraphql<PageData>(store, PAGE_QUERY, {
        cursor, pageSize: PAGE_SIZE, moments: MOMENTS_FIRST_PAGE,
      })
      out.pages++
      const nodes = (data.orders?.edges ?? []).map(e => e.node)
      if (nodes.length === 0) { out.reachedEnd = true; break }

      const fresh: ParsedJourney[] = []
      let caughtUp = false
      for (const node of nodes) {
        out.scanned++
        if (done.has(numericId(node.id))) {
          out.skipped++
          consecutiveKnown++
          if (stopAfterKnown > 0 && consecutiveKnown >= stopAfterKnown) { caughtUp = true; break }
          continue
        }
        consecutiveKnown = 0
        fresh.push(await parseNode(store, node))
      }
      if (fresh.length) {
        await writeJourneys(store.id, fresh)
        out.saved += fresh.length
      }
      if (caughtUp) break
      cursor = data.orders?.pageInfo.endCursor ?? null
      if (!data.orders?.pageInfo.hasNextPage) { out.reachedEnd = true; break }
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err)
    console.error('[journey] sync failed for', store.id, out.error)
  }

  // Bookkeeping only. backfill_cursor and backfill_done belong to the bulk
  // backfill and are never touched here.
  await query(
    `INSERT INTO journey_sync_state (tenant_id, backfill_done, last_run_at, orders_synced)
     VALUES ($1, false, NOW(), $2)
     ON CONFLICT (tenant_id) DO UPDATE SET
       last_run_at   = NOW(),
       orders_synced = journey_sync_state.orders_synced + $2`,
    [store.id, out.saved],
  )

  return out
}

/**
 * Re-ask Shopify for journeys that were not ready when first collected.
 *
 * Every attempt moves the order's synced_at, answered or not, and the oldest
 * attempt goes first — so an order Shopify keeps answering with nothing
 * (deleted, or throttled) rotates to the back instead of being picked first
 * forever and starving the rest. Orders older than a week are given up on. A
 * throttled response ends the pass; the next cycle picks up where it stopped.
 *
 * Budget left over goes to journeys stored with fewer visits than Shopify
 * counted — collected when this pass read only the first 20 moments, which
 * gave them the wrong last-click ad. Each is retried at most once a day, so
 * one whose count Shopify never matches cannot crowd out the rest.
 */
export async function refreshPendingJourneys(
  store: JourneyStore,
  opts: { maxOrders?: number } = {},
): Promise<{ checked: number; nowReady: number; repaired: number }> {
  const budget = opts.maxOrders ?? 50
  const pending = await query<{ order_id: string }>(
    `SELECT order_id FROM order_journeys
      WHERE tenant_id = $1 AND ready = false
        -- Shopify needs a little time; asking again immediately just burns quota.
        AND synced_at < NOW() - INTERVAL '30 minutes'
        AND order_created_at > NOW() - ($3::int * INTERVAL '1 day')
      ORDER BY synced_at ASC
      LIMIT $2`,
    [store.id, budget, PENDING_MAX_AGE_DAYS],
  )
  const truncated = pending.length < budget
    ? await query<{ order_id: string }>(
        `SELECT j.order_id FROM order_journeys j
          WHERE j.tenant_id = $1 AND j.ready
            AND j.moments_count BETWEEN 2 AND $3
            AND j.synced_at < NOW() - INTERVAL '1 day'
            AND j.moments_count > (SELECT count(*) FROM order_touchpoints p
                                    WHERE p.tenant_id = j.tenant_id AND p.order_id = j.order_id)
          ORDER BY j.synced_at ASC
          LIMIT $2`,
        [store.id, budget - pending.length, MAX_MOMENTS],
      )
    : []
  const rows = [...pending, ...truncated]
  if (rows.length === 0) return { checked: 0, nowReady: 0, repaired: 0 }
  const repairing = new Set(truncated.map(r => r.order_id))

  let nowReady = 0
  let checked = 0
  let repaired = 0
  for (const { order_id } of rows) {
    checked++
    try {
      const data = await shopifyGraphql<{ order: JourneyNode | null }>(store, SINGLE_QUERY, {
        id: `gid://shopify/Order/${order_id}`, moments: MOMENTS_FIRST_PAGE,
      })
      if (!data.order) {
        await touchPending(store.id, order_id)
        continue
      }
      const parsed = await parseNode(store, data.order)
      await writeJourneys(store.id, [parsed])
      if (repairing.has(order_id)) repaired++
      else if (parsed.summary?.ready) nowReady++
    } catch (err) {
      await touchPending(store.id, order_id).catch(() => {})
      if (err instanceof ShopifyThrottled) {
        console.warn('[journey] refresh throttled for', store.id, '— resuming next cycle')
        break
      }
      console.error('[journey] refresh failed', store.id, order_id, err)
    }
  }
  return { checked, nowReady, repaired }
}

/** Mark an attempt on an order that produced nothing to store. */
async function touchPending(tenantId: string, orderId: string): Promise<void> {
  await query(
    `UPDATE order_journeys SET synced_at = NOW() WHERE tenant_id = $1 AND order_id = $2`,
    [tenantId, orderId],
  )
}

/** Stores the journey collector can run against. */
export async function journeyStores(): Promise<JourneyStore[]> {
  return query<JourneyStore>(
    `SELECT id, shopify_domain, shopify_access_token
       FROM tenants
      WHERE shopify_access_token IS NOT NULL AND shopify_domain IS NOT NULL
        AND archived_at IS NULL
      ORDER BY created_at`,
  )
}
