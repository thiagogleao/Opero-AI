import crypto from 'crypto'
import { query } from '@/lib/db'
import { sendPushToAll } from '@/lib/push'
import { getProfitSummary } from '@/lib/profitCalc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Constant-time string compare that tolerates length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/**
 * Verify the request really came from Shopify.
 *
 * Two independent proofs are accepted because stores are connected through
 * different Shopify apps (our Partners app, or a per-store custom app whose
 * secret we never persist):
 *   1. HMAC-SHA256 of the raw body with SHOPIFY_CLIENT_SECRET — works for
 *      stores connected via our own app.
 *   2. A secret token in the query string, set by us at registration time —
 *      the fallback for stores whose app secret we don't hold.
 */
function verify(req: Request, rawBody: string): boolean {
  const token = process.env.SHOPIFY_WEBHOOK_TOKEN
  if (token) {
    const sent = new URL(req.url).searchParams.get('token')
    if (sent && safeEqual(sent, token)) return true
  }

  const secret = process.env.SHOPIFY_CLIENT_SECRET
  const hmac   = req.headers.get('x-shopify-hmac-sha256')
  if (secret && hmac) {
    const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
    if (safeEqual(digest, hmac)) return true
  }

  return false
}

const money = (v: number, currency: string) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(v)
  } catch {
    return `${currency} ${v.toFixed(2)}`
  }
}

/** Compact USD for the notification body: $966 / $12.9K. */
const compactUsd = (v: number) => {
  const sign = v < 0 ? '-' : ''
  const a = Math.abs(v)
  if (a >= 10_000) return `${sign}$${(a / 1_000).toFixed(1)}K`
  return `${sign}$${Math.round(a).toLocaleString('en-US')}`
}

/**
 * This store's profit so far today, for the notification body.
 *
 * Shopify drops the delivery and retries if we take too long, so this is
 * bounded and best-effort: a slow or failing profit query costs the extra
 * line, never the notification itself. The newly inserted order is already
 * in shopify_orders only after the next sync, so this reflects profit as of
 * the last sync plus whatever else landed today.
 */
async function todayProfit(tenantId: string, tz: string): Promise<number | null> {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: tz })
  try {
    const summary = await Promise.race([
      getProfitSummary(tenantId, today, today),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 2000)),
    ])
    return summary.configured ? summary.netProfit : null
  } catch (err) {
    console.warn('[webhook] profit lookup skipped:', (err as Error).message)
    return null
  }
}

export async function POST(req: Request) {
  // Raw body is required for HMAC — read as text before parsing.
  const rawBody = await req.text()

  if (!verify(req, rawBody)) {
    console.warn('[webhook] rejected: bad signature')
    return new Response('Unauthorized', { status: 401 })
  }

  const shopDomain = req.headers.get('x-shopify-shop-domain')
  if (!shopDomain) return new Response('Missing shop domain', { status: 400 })

  let order: Record<string, unknown>
  try {
    order = JSON.parse(rawBody)
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  // Resolve the store. Unknown domains are acknowledged (200) so Shopify
  // doesn't retry forever on a store we no longer track.
  const tenants = await query<{
    id: string; shop_name: string | null; shopify_domain: string; timezone: string | null
  }>(
    `SELECT id, shop_name, shopify_domain, COALESCE(timezone, 'UTC') AS timezone
     FROM tenants WHERE shopify_domain = $1 LIMIT 1`,
    [shopDomain]
  )
  const tenant = tenants[0]
  if (!tenant) {
    console.warn('[webhook] unknown shop:', shopDomain)
    return new Response('OK', { status: 200 })
  }

  const orderId  = String(order.id ?? '')
  const total    = Number(order.total_price ?? 0)
  const currency = String(order.currency ?? 'USD')
  const lineItems = Array.isArray(order.line_items) ? order.line_items : []
  const shipping = order.shipping_address as Record<string, unknown> | null
  const customer = order.customer as Record<string, unknown> | null
  const country  = (shipping?.country_code as string) ?? null
  const custName = customer
    ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null
    : null

  // Persist first, then notify. ON CONFLICT DO NOTHING makes redelivered
  // webhooks idempotent — and tells us whether to send a notification.
  const inserted = await query<{ id: string }>(
    `INSERT INTO live_orders
       (tenant_id, order_id, order_number, total_price, currency,
        country_code, customer_name, line_items, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
     ON CONFLICT (tenant_id, order_id) DO NOTHING
     RETURNING id::text AS id`,
    [
      tenant.id, orderId,
      order.name ? String(order.name) : null,
      total, currency, country, custName,
      JSON.stringify(lineItems.map((li) => {
        const item = li as Record<string, unknown>
        return { title: item.title, quantity: item.quantity, price: item.price }
      })),
      order.created_at ? new Date(String(order.created_at)) : new Date(),
    ]
  )

  // Duplicate delivery — already notified for this order.
  if (inserted.length === 0) return new Response('OK', { status: 200 })

  const storeName = tenant.shop_name ?? tenant.shopify_domain.replace('.myshopify.com', '')
  const units = lineItems.reduce((s, li) => s + Number((li as Record<string, unknown>).quantity ?? 0), 0)
  const firstItem = lineItems[0] as Record<string, unknown> | undefined
  const itemLabel = firstItem
    ? `${units}× ${String(firstItem.title ?? 'item')}${lineItems.length > 1 ? ` +${lineItems.length - 1}` : ''}`
    : `${units} item(s)`

  // Shopify's order name already carries the "#": fall back to building one.
  const orderLabel = order.name
    ? String(order.name)
    : `#${order.order_number ?? orderId}`

  const profit = await todayProfit(tenant.id, tenant.timezone ?? 'UTC')

  try {
    await sendPushToAll({
      title: `💰 ${money(total, currency)} · ${orderLabel} — ${storeName}`,
      body: [
        profit !== null ? `Lucro hoje: ${compactUsd(profit)}` : null,
        itemLabel,
        country,
      ].filter(Boolean).join(' · '),
      url: '/m',
      tag: `order-${tenant.id}-${orderId}`,
      data: { tenantId: tenant.id, orderId, total, currency, profitToday: profit },
    })
  } catch (err) {
    // Never fail the webhook because a push failed — Shopify would retry and
    // we'd double-insert nothing but would keep hammering this endpoint.
    console.error('[webhook] push failed:', err)
  }

  return new Response('OK', { status: 200 })
}
