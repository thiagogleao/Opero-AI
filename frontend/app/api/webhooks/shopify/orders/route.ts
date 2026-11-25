import { query } from '@/lib/db'
import { computeStorePnL } from '@/lib/engine'
import { sendPushToAll } from '@/lib/push'
import { localDay } from '@/lib/sync/orderMapping'
import { dayPhrase, newNonce, notificationHref, todayIn } from '@/lib/period'
import { adminUrl, isOrderTopic, webhookAuthMethod } from '@/lib/sync/shopifyApi'
import { usdRate } from '@/lib/sync/fx'
import { salePushText } from '@/lib/sync/salePush'
import { upsertOrderFromWebhook } from '@/lib/sync/webhookOrders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Shopify order webhooks: orders/create, orders/updated, orders/paid.
 *
 * Every topic writes the order into shopify_orders (and its items) with the
 * collector's own mapping, so numbers move with the push — a paid, refunded
 * or cancelled order no longer waits for the next ten-minute sync, and a sale
 * is in "Lucro hoje" when its notification arrives. orders/create also feeds
 * the live feed (live_orders) and sends the sale push, once per order.
 *
 * Shopify drops a delivery that takes longer than five seconds, so the profit
 * line of the push is bounded and optional; the write never is.
 */

interface Tenant {
  id: string; shop_name: string | null; shopify_domain: string; timezone: string
  client_secret: string | null; access_token: string | null; archived: boolean
}

async function findTenant(shopDomain: string): Promise<Tenant | null> {
  const rows = await query<Tenant>(
    `SELECT id, shop_name, shopify_domain, COALESCE(timezone, 'UTC') AS timezone,
            shopify_client_secret AS client_secret, shopify_access_token AS access_token,
            (archived_at IS NOT NULL) AS archived
       FROM tenants WHERE lower(shopify_domain) = lower($1)
      ORDER BY archived_at NULLS FIRST, created_at LIMIT 1`,
    [shopDomain],
  )
  return rows[0] ?? null
}

/** This store's profit on `day` (the engine's "lucro") priced at `now`, or
 *  null when the store has no cost settings or the lookup is slow. `day` is
 *  the sale's own day, the one the push link opens (R17): pricing the
 *  webhook's run day split the two across midnight. */
async function dayProfit(tenantId: string, day: string, now: Date): Promise<number | null> {
  try {
    const pnl = await Promise.race([
      computeStorePnL(tenantId, { from: day, to: day }, {}, now),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
    ])
    return pnl && pnl.configured ? pnl.totals.operatingProfit : null
  } catch (err) {
    console.warn('[webhook] lucro do dia não calculado:', (err as Error).message)
    return null
  }
}

/** Read one order back from the store's Admin API, or null. Bounded so the
 *  webhook still answers inside Shopify's five seconds. */
function fetchOrder(tenant: Tenant) {
  return async (orderId: string): Promise<Record<string, unknown> | null> => {
    if (!tenant.access_token) return null
    try {
      const res = await fetch(adminUrl(tenant.shopify_domain, `orders/${orderId}.json`), {
        headers: { 'X-Shopify-Access-Token': tenant.access_token },
        signal: AbortSignal.timeout(3000),
      })
      if (!res.ok) return null
      const json = await res.json() as { order?: Record<string, unknown> }
      return json.order && String(json.order.id) === orderId ? json.order : null
    } catch {
      return null
    }
  }
}

export async function POST(req: Request) {
  // Raw body is required for the HMAC — read as text before parsing.
  const rawBody = await req.text()
  const shopDomain = req.headers.get('x-shopify-shop-domain')
  const topic = req.headers.get('x-shopify-topic')
  const tenant = shopDomain ? await findTenant(shopDomain) : null

  const method = webhookAuthMethod({
    rawBody,
    hmacHeader: req.headers.get('x-shopify-hmac-sha256'),
    urlToken: new URL(req.url).searchParams.get('token'),
    expectedToken: process.env.SHOPIFY_WEBHOOK_TOKEN ?? null,
    secrets: [process.env.SHOPIFY_CLIENT_SECRET, tenant?.client_secret],
  })
  if (!method) {
    console.warn('[webhook] recusado: assinatura inválida', shopDomain ?? '')
    return new Response('Unauthorized', { status: 401 })
  }
  if (!shopDomain) return new Response('Missing shop domain', { status: 400 })
  // Unknown or archived store, or a topic we do not handle: acknowledge so
  // Shopify does not retry forever.
  if (!tenant || tenant.archived) return new Response('OK', { status: 200 })
  if (topic && !isOrderTopic(topic)) return new Response('OK', { status: 200 })

  let order: Record<string, unknown>
  try {
    order = JSON.parse(rawBody)
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }
  const orderId = String(order.id ?? '')
  if (!/^\d+$/.test(orderId)) return new Response('OK', { status: 200 })

  // A delivery that only carried the URL token proves its sender knows the
  // token, not that Shopify wrote the body. Before it can touch revenue, the
  // order is read back from Shopify itself; a body that does not match a real
  // order of this store is dropped. A signed (HMAC) delivery is trusted as is.
  if (method === 'token') {
    const real = await fetchOrder(tenant)(orderId)
    if (!real) {
      console.warn(`[webhook] ${tenant.shopify_domain} ${orderId}: entrega só com token e o pedido não foi confirmado na Shopify — ignorada`)
      return new Response('OK', { status: 200 })
    }
    order = real
  }

  // 1. The analytics row, for every topic.
  let usdTotal: number | null = null
  try {
    const w = await upsertOrderFromWebhook(tenant.id, order)
    usdTotal = w.usdTotal
    if (!w.written) console.warn(`[webhook] ${tenant.shopify_domain} ${orderId}: não gravado — ${w.reason}`)
  } catch (err) {
    // The collector will write it on its next pass; the push still goes out.
    console.error(`[webhook] ${tenant.shopify_domain} ${orderId}: falha ao gravar o pedido`, err)
  }
  if (topic && topic !== 'orders/create') return new Response('OK', { status: 200 })

  // 2. orders/create: live feed + sale push, once per order.
  const total = Number(order.total_price ?? 0)
  const currency = String(order.currency ?? 'USD').toUpperCase()
  const lineItems = Array.isArray(order.line_items) ? order.line_items as Record<string, unknown>[] : []
  const shipping = order.shipping_address as Record<string, unknown> | null
  const customer = order.customer as Record<string, unknown> | null
  const country = (shipping?.country_code as string) ?? null
  const custName = customer ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null : null

  // ON CONFLICT DO NOTHING makes a redelivery idempotent and tells us whether
  // this is the first time we see the order (only then do we notify).
  const inserted = await query<{ id: string }>(
    `INSERT INTO live_orders
       (tenant_id, order_id, order_number, total_price, currency,
        country_code, customer_name, line_items, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     ON CONFLICT (tenant_id, order_id) DO NOTHING
     RETURNING id::text AS id`,
    [
      tenant.id, orderId, order.name ? String(order.name) : null, total, currency, country, custName,
      JSON.stringify(lineItems.map(item => ({ title: item.title, quantity: item.quantity, price: item.price }))),
      order.created_at ? new Date(String(order.created_at)) : new Date(), // clock-ok: a live-feed row's fallback timestamp, not a period
    ],
  )
  if (inserted.length === 0) return new Response('OK', { status: 200 })

  const storeName = tenant.shop_name ?? tenant.shopify_domain.replace('.myshopify.com', '')
  const orderLabel = order.name ? String(order.name) : `#${order.order_number ?? orderId}`

  // Dollars first for a store that bills in another currency; local amount after.
  if (usdTotal === null && currency !== 'USD') {
    const day = localDay(order.created_at)
    const rate = day ? await usdRate(currency, day).catch(() => null) : null
    usdTotal = rate ? total * rate : null
  }

  // One instant for the whole push (P6): the sale's day, the profit priced on
  // it and the word for it ("hoje" only while it still is today there).
  const now = new Date() // clock-ok: the webhook's arrival instant
  const created = order.created_at ? new Date(String(order.created_at)) : null
  const saleDay = todayIn(tenant.timezone, created && !Number.isNaN(created.getTime()) ? created : now)
  const profit = await dayProfit(tenant.id, saleDay, now)
  const { title, body } = salePushText({
    storeName, orderLabel, total, currency, usdTotal, profitToday: profit, profitDay: dayPhrase(saleDay, todayIn(tenant.timezone, now)), lineItems, country,
  })
  try {
    await sendPushToAll({
      kind: 'sale',
      title,
      body,
      // The day the SALE is in, on the store's calendar (the order's
      // created_at, not the webhook's run time: an order at 23:59:50 delivered
      // after midnight belongs to the day before). One producer for every push
      // link (lib/period notificationHref, R17): a visit on those dates, never
      // saved, never rolling.
      url: notificationHref({ loja: tenant.id, from: saleDay, to: saleDay, nonce: newNonce() }),
      tag: `order-${tenant.id}-${orderId}`,
      data: { tenantId: tenant.id, orderId, total, currency, totalUsd: usdTotal, profitToday: profit },
    })
  } catch (err) {
    // Never fail the webhook because a push failed: Shopify would retry.
    console.error('[webhook] push falhou:', err)
  }
  return new Response('OK', { status: 200 })
}
