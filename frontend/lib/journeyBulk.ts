import { query } from './db'
import type { JourneyStore } from './journey'

/**
 * History backfill through Shopify's Bulk Operations API.
 *
 * The paged collector in journey.ts costs about a second per order, because
 * customerJourneySummary is expensive and the cost budget has to be respected.
 * A bulk operation asks Shopify to run the same query on its own side and hand
 * back a file: one store's 3,135 orders took roughly thirty seconds instead of
 * an hour. That is the difference between a backfill that finishes today and
 * one that finishes over two days.
 *
 * The file is JSONL with a line per object. Orders carry the journey summary;
 * each visit is its own line pointing at its order through __parentId.
 */

const API_VERSION = '2024-10'

// One statement per batch instead of per row: 50k inserts one at a time is
// almost all round-trip time.
const INSERT_BATCH = 300

const BULK_QUERY = `
{
  orders {
    edges { node {
      id
      createdAt
      customerJourneySummary {
        ready
        momentsCount { count precision }
        daysToConversion
        customerOrderIndex
        moments {
          edges { node {
            occurredAt
            ... on CustomerVisit {
              landingPage referrerUrl source sourceType
              utmParameters { source medium campaign content term }
            }
          } }
        }
      }
    } }
  }
}`

interface BulkOperation {
  id: string
  status: string
  errorCode: string | null
  objectCount: string | null
  url: string | null
}

async function gql<T>(store: JourneyStore, query_: string): Promise<T> {
  const res = await fetch(`https://${store.shopify_domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'X-Shopify-Access-Token': store.shopify_access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: query_ }),
  })
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const json = await res.json()
  if (json.errors) throw new Error(`GraphQL: ${JSON.stringify(json.errors).slice(0, 300)}`)
  return json.data as T
}

async function currentOperation(store: JourneyStore): Promise<BulkOperation | null> {
  const data = await gql<{ currentBulkOperation: BulkOperation | null }>(
    store,
    `{ currentBulkOperation { id status errorCode objectCount url } }`
  )
  return data.currentBulkOperation
}

/** Ask Shopify to start building the file. */
async function startOperation(store: JourneyStore): Promise<string> {
  const data = await gql<{
    bulkOperationRunQuery: { bulkOperation: { id: string } | null; userErrors: { message: string }[] }
  }>(store, `
    mutation {
      bulkOperationRunQuery(query: """${BULK_QUERY}""") {
        bulkOperation { id status }
        userErrors { field message }
      }
    }`)

  const errs = data.bulkOperationRunQuery.userErrors
  if (errs.length) throw new Error(errs.map(e => e.message).join('; '))
  const id = data.bulkOperationRunQuery.bulkOperation?.id
  if (!id) throw new Error('Shopify accepted the mutation but returned no operation')
  return id
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function numericId(gid: string): string {
  return (gid.split('/').pop() ?? gid).split('?')[0]
}

function asMetaId(value: string | null | undefined): string | null {
  if (!value) return null
  return /^\d{10,}$/.test(value) ? value : null
}

interface OrderLine {
  id: string
  createdAt: string
  customerJourneySummary?: {
    ready: boolean
    momentsCount: { count: number; precision: string } | null
    daysToConversion: number | null
    customerOrderIndex: number | null
  } | null
}

interface VisitLine {
  occurredAt?: string | null
  landingPage?: string | null
  referrerUrl?: string | null
  source?: string | null
  sourceType?: string | null
  utmParameters?: {
    source?: string | null; medium?: string | null; campaign?: string | null
    content?: string | null; term?: string | null
  } | null
  __parentId: string
}

export interface BulkResult {
  tenantId: string
  orders: number
  touches: number
  seconds: number
  error?: string
}

/** Read the JSONL and write both tables. */
async function ingest(store: JourneyStore, url: string): Promise<{ orders: number; touches: number }> {
  const text = await fetch(url).then(r => r.text())
  const lines = text.split('\n').filter(Boolean)

  const orders: OrderLine[] = []
  const visitsByOrder = new Map<string, VisitLine[]>()

  for (const line of lines) {
    let obj: OrderLine & VisitLine
    try { obj = JSON.parse(line) } catch { continue }
    if (obj.__parentId) {
      const key = numericId(obj.__parentId)
      const list = visitsByOrder.get(key)
      if (list) list.push(obj)
      else visitsByOrder.set(key, [obj])
    } else if (obj.id) {
      orders.push(obj)
    }
  }

  // ── Journeys ──────────────────────────────────────────────────────────────
  let written = 0
  for (let i = 0; i < orders.length; i += INSERT_BATCH) {
    const slice = orders.slice(i, i + INSERT_BATCH)
    const values: unknown[] = []
    const rows: string[] = []

    for (const o of slice) {
      const orderId = numericId(o.id)
      const j = o.customerJourneySummary
      const visits = (visitsByOrder.get(orderId) ?? [])
        .sort((a, b) => String(a.occurredAt ?? '').localeCompare(String(b.occurredAt ?? '')))
      const ads = visits.map(v => asMetaId(v.utmParameters?.content)).filter((a): a is string => a !== null)

      const n = values.length
      rows.push(`($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6},$${n + 7},$${n + 8},$${n + 9},$${n + 10},NOW())`)
      values.push(
        store.id, orderId, j?.ready ?? false,
        j?.momentsCount?.count ?? null, j?.momentsCount?.precision ?? null,
        j?.daysToConversion ?? null, j?.customerOrderIndex ?? null,
        ads[0] ?? null, ads[ads.length - 1] ?? null, o.createdAt,
      )
    }

    await query(
      `INSERT INTO order_journeys (
         tenant_id, order_id, ready, moments_count, moments_precision,
         days_to_conversion, customer_order_index, first_ad_id, last_ad_id,
         order_created_at, synced_at
       ) VALUES ${rows.join(',')}
       ON CONFLICT (tenant_id, order_id) DO UPDATE SET
         ready = EXCLUDED.ready, moments_count = EXCLUDED.moments_count,
         moments_precision = EXCLUDED.moments_precision,
         days_to_conversion = EXCLUDED.days_to_conversion,
         customer_order_index = EXCLUDED.customer_order_index,
         first_ad_id = EXCLUDED.first_ad_id, last_ad_id = EXCLUDED.last_ad_id,
         order_created_at = EXCLUDED.order_created_at, synced_at = NOW()`,
      values
    )
    written += slice.length
  }

  // ── Touches ───────────────────────────────────────────────────────────────
  // Rewritten wholesale per order, so re-running the backfill cannot leave a
  // half-old, half-new sequence behind.
  const orderIds = [...visitsByOrder.keys()]
  for (let i = 0; i < orderIds.length; i += INSERT_BATCH) {
    await query(
      `DELETE FROM order_touchpoints WHERE tenant_id = $1 AND order_id = ANY($2::text[])`,
      [store.id, orderIds.slice(i, i + INSERT_BATCH)]
    )
  }

  const flat: { orderId: string; seq: number; v: VisitLine }[] = []
  for (const [orderId, visits] of visitsByOrder) {
    visits
      .sort((a, b) => String(a.occurredAt ?? '').localeCompare(String(b.occurredAt ?? '')))
      .forEach((v, idx) => flat.push({ orderId, seq: idx + 1, v }))
  }

  let touches = 0
  for (let i = 0; i < flat.length; i += INSERT_BATCH) {
    const slice = flat.slice(i, i + INSERT_BATCH)
    const values: unknown[] = []
    const rows: string[] = []

    for (const { orderId, seq, v } of slice) {
      const u = v.utmParameters ?? {}
      const n = values.length
      rows.push(`(${Array.from({ length: 16 }, (_, k) => `$${n + k + 1}`).join(',')})`)
      values.push(
        store.id, orderId, seq, v.occurredAt ?? null,
        v.source ?? null, v.sourceType ?? null,
        v.referrerUrl ?? null, v.landingPage ?? null,
        u.source ?? null, u.medium ?? null, u.campaign ?? null,
        u.content ?? null, u.term ?? null,
        asMetaId(u.content), asMetaId(u.term), asMetaId(u.campaign),
      )
    }

    await query(
      `INSERT INTO order_touchpoints (
         tenant_id, order_id, seq, occurred_at, source, source_type,
         referrer_url, landing_page, utm_source, utm_medium, utm_campaign,
         utm_content, utm_term, ad_id, adset_id, campaign_id
       ) VALUES ${rows.join(',')}
       ON CONFLICT (tenant_id, order_id, seq) DO NOTHING`,
      values
    )
    touches += slice.length
  }

  return { orders: written, touches }
}

/**
 * Run the whole history for one store.
 *
 * Shopify allows a single bulk operation per shop at a time, so an operation
 * already in flight is waited on rather than started over.
 */
export async function runBulkBackfill(
  store: JourneyStore,
  opts: { maxWaitMs?: number } = {}
): Promise<BulkResult> {
  const started = Date.now()
  const maxWait = opts.maxWaitMs ?? 8 * 60_000
  const out: BulkResult = { tenantId: store.id, orders: 0, touches: 0, seconds: 0 }

  try {
    const existing = await currentOperation(store)
    const running = existing && (existing.status === 'CREATED' || existing.status === 'RUNNING')
    if (!running) await startOperation(store)

    let op: BulkOperation | null = null
    while (Date.now() - started < maxWait) {
      await sleep(5000)
      op = await currentOperation(store)
      if (!op) continue
      if (op.status === 'COMPLETED') break
      if (op.status === 'FAILED' || op.status === 'CANCELED') {
        throw new Error(`bulk operation ${op.status}${op.errorCode ? ` (${op.errorCode})` : ''}`)
      }
    }

    if (!op || op.status !== 'COMPLETED') throw new Error('bulk operation did not finish in time')
    // A store with no orders completes with no file at all.
    if (!op.url) {
      await markDone(store.id, 0)
      out.seconds = Math.round((Date.now() - started) / 1000)
      return out
    }

    const { orders, touches } = await ingest(store, op.url)
    out.orders = orders
    out.touches = touches
    await markDone(store.id, orders)
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err)
    console.error('[journey/bulk] failed for', store.id, out.error)
  }

  out.seconds = Math.round((Date.now() - started) / 1000)
  return out
}

async function markDone(tenantId: string, orders: number): Promise<void> {
  await query(
    `INSERT INTO journey_sync_state (tenant_id, backfill_done, last_run_at, orders_synced)
     VALUES ($1, true, NOW(), $2)
     ON CONFLICT (tenant_id) DO UPDATE SET
       backfill_done = true, last_run_at = NOW(),
       orders_synced = journey_sync_state.orders_synced + $2`,
    [tenantId, orders]
  )
}

/** Stores whose history has not been pulled yet. */
export async function storesNeedingBackfill(stores: JourneyStore[]): Promise<JourneyStore[]> {
  const rows = await query<{ tenant_id: string }>(
    `SELECT tenant_id FROM journey_sync_state WHERE backfill_done = true`
  )
  const done = new Set(rows.map(r => r.tenant_id))
  return stores.filter(s => !done.has(s.id))
}
