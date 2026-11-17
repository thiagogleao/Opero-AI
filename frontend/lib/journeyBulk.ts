import { query } from './db'
import {
  MOMENT_FIELDS, numericId, shopifyGraphql, sortMoments, writeJourneys,
  type JourneyStore, type JourneySummary, type Moment, type ParsedJourney,
} from './journey'

/**
 * History backfill through Shopify's Bulk Operations API.
 *
 * The paged collector in journey.ts costs about a second per order, because
 * customerJourneySummary is expensive and the cost budget has to be respected.
 * A bulk operation asks Shopify to run the same query on its own side and hand
 * back a file: one store's 3,135 orders took roughly thirty seconds instead of
 * an hour.
 *
 * The file is JSONL with a line per object. Orders carry the journey summary;
 * each visit is its own line pointing at its order through __parentId. Parsing
 * ends in the same ParsedJourney the paged collector builds, and both go
 * through journey.ts's one writer — so an order is stored the same way (moments
 * sorted by time, first and last ad from the full list) whichever path saw it.
 */

// Bulk queries take no pagination arguments: Shopify walks every connection,
// which is why this path always has every moment of every order.
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
        moments { edges { node { ${MOMENT_FIELDS} } } }
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

async function currentOperation(store: JourneyStore): Promise<BulkOperation | null> {
  const data = await shopifyGraphql<{ currentBulkOperation: BulkOperation | null }>(
    store, `{ currentBulkOperation { id status errorCode objectCount url } }`,
  )
  return data.currentBulkOperation
}

/** Ask Shopify to start building the file. */
async function startOperation(store: JourneyStore): Promise<string> {
  const data = await shopifyGraphql<{
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

interface OrderLine {
  id: string
  createdAt: string
  customerJourneySummary?: JourneySummary | null
}

type VisitLine = Moment & { __parentId: string }

/** Turn the JSONL file into one ParsedJourney per order. Pure, for the tests. */
export function parseBulkJsonl(text: string): ParsedJourney[] {
  const orders: OrderLine[] = []
  const visitsByOrder = new Map<string, Moment[]>()

  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let obj: Partial<OrderLine & VisitLine>
    try { obj = JSON.parse(line) } catch { continue }
    if (obj.__parentId) {
      const key = numericId(obj.__parentId)
      const { __parentId: _p, ...visit } = obj as VisitLine
      const list = visitsByOrder.get(key)
      if (list) list.push(visit)
      else visitsByOrder.set(key, [visit])
    } else if (obj.id && obj.createdAt) {
      orders.push(obj as OrderLine)
    }
  }

  return orders.map(o => {
    const orderId = numericId(o.id)
    const s = o.customerJourneySummary
    return {
      orderId,
      createdAt: o.createdAt,
      summary: s ? {
        ready: s.ready, momentsCount: s.momentsCount ?? null,
        daysToConversion: s.daysToConversion ?? null, customerOrderIndex: s.customerOrderIndex ?? null,
      } : null,
      moments: sortMoments(visitsByOrder.get(orderId) ?? []),
    }
  })
}

export interface BulkResult {
  tenantId: string
  orders: number
  touches: number
  seconds: number
  error?: string
}

async function ingest(store: JourneyStore, url: string): Promise<{ orders: number; touches: number }> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`bulk file ${res.status}`)
  const journeys = parseBulkJsonl(await res.text())
  const touches = await writeJourneys(store.id, journeys)
  return { orders: journeys.length, touches }
}

/**
 * Run the whole history for one store.
 *
 * Shopify allows a single bulk operation per shop at a time, so an operation
 * already in flight is waited on rather than started over.
 */
export async function runBulkBackfill(
  store: JourneyStore,
  opts: { maxWaitMs?: number } = {},
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
    if (op.url) {
      const { orders, touches } = await ingest(store, op.url)
      out.orders = orders
      out.touches = touches
    }
    await markDone(store.id, out.orders)
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
    [tenantId, orders],
  )
}

/** Stores whose history has not been pulled yet. */
export async function storesNeedingBackfill(stores: JourneyStore[]): Promise<JourneyStore[]> {
  const rows = await query<{ tenant_id: string }>(
    `SELECT tenant_id FROM journey_sync_state WHERE backfill_done = true`,
  )
  const done = new Set(rows.map(r => r.tenant_id))
  return stores.filter(s => !done.has(s.id))
}
