import crypto from 'crypto'

/**
 * One Shopify Admin API version for every TypeScript call (refunds, disputes,
 * webhook registration). The Python collector uses the same value in
 * app/collectors/shopify_client.py — change both together. Shopify keeps a
 * version for about a year and then silently serves the oldest supported one,
 * so a stale constant means fields can change under us without a deploy.
 */
export const SHOPIFY_API_VERSION = '2026-10'

export function adminUrl(domain: string, path: string): string {
  const d = domain.replace(/^https?:\/\//, '').replace(/\/$/, '')
  return `https://${d}/admin/api/${SHOPIFY_API_VERSION}/${path.replace(/^\//, '')}`
}

/** Constant-time compare that tolerates a length mismatch. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return crypto.timingSafeEqual(ab, bb)
}

/** HMAC-SHA256 (base64) of a webhook body, as Shopify signs it. */
export function webhookDigest(rawBody: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
}

/**
 * Did this webhook come from Shopify?
 *
 * Stores are connected through different apps, so three proofs are accepted:
 * the shared token we put in the address at registration time, the HMAC with
 * our Partners app secret, and the HMAC with the store's own Dev Dashboard app
 * secret (Hibikura and Glooty: their webhooks are signed with that app's key).
 */
export function verifyWebhook(opts: {
  rawBody: string
  hmacHeader: string | null
  urlToken: string | null
  expectedToken?: string | null
  secrets: (string | null | undefined)[]
}): boolean {
  const { rawBody, hmacHeader, urlToken, expectedToken, secrets } = opts
  if (expectedToken && urlToken && safeEqual(urlToken, expectedToken)) return true
  if (!hmacHeader) return false
  return secrets.some(s => !!s && safeEqual(webhookDigest(rawBody, s), hmacHeader))
}

/** Topics the orders endpoint handles; register_webhooks.js subscribes these. */
export const ORDER_TOPICS = ['orders/create', 'orders/updated', 'orders/paid'] as const
export type OrderTopic = typeof ORDER_TOPICS[number]
export function isOrderTopic(t: string | null): t is OrderTopic {
  return !!t && (ORDER_TOPICS as readonly string[]).includes(t)
}
