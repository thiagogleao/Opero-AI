import { pool } from '../db'
import { usdRate } from './fx'
import { localDay, mapLineItems, mapOrder, MissingRate } from './orderMapping'
import { pick, tableColumns } from './schema'
import { buildUpsert } from './upsertSql'

export interface WebhookWrite {
  written: boolean
  /** Why nothing was written (no rate for a yen order, say). */
  reason?: string
  /** The order total in US dollars, when known. */
  usdTotal: number | null
}

/**
 * Write a webhook's order into shopify_orders and its items, so the dashboard
 * moves with the push instead of after the next ten-minute sync.
 *
 * Same mapping and same upsert rules as the collector. A foreign-currency
 * order without a known rate is not written (the collector will write it once
 * it has the rate) — it is never stored as dollars.
 */
export async function upsertOrderFromWebhook(tenantId: string, order: Record<string, unknown>): Promise<WebhookWrite> {
  const currency = String(order.currency || 'USD').toUpperCase()
  let rate: number | null = null
  if (currency !== 'USD') {
    const day = localDay(order.created_at)
    rate = day ? await usdRate(currency, day) : null
  }
  let row, items
  try {
    row = mapOrder(order, () => rate)
    items = mapLineItems(order, () => rate)
  } catch (err) {
    if (err instanceof MissingRate) return { written: false, reason: err.message, usdTotal: null }
    throw err
  }

  const [orderCols, itemCols] = await Promise.all([tableColumns('shopify_orders'), tableColumns('shopify_order_items')])
  const orderSql = buildUpsert({
    table: 'shopify_orders',
    rows: [pick({ ...row, tenant_id: tenantId }, orderCols)],
    conflict: ['order_id'],
    preserveOnNull: ['browser_ip', 'user_agent', 'accept_language'],
  })
  const itemSql = buildUpsert({
    table: 'shopify_order_items',
    rows: items.map(i => pick({ ...i, tenant_id: tenantId }, itemCols)),
    conflict: ['order_id', 'line_item_id'],
  })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (orderSql) await client.query(orderSql.sql, orderSql.params)
    if (itemSql) await client.query(itemSql.sql, itemSql.params)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  return { written: true, usdTotal: row.total_price }
}
