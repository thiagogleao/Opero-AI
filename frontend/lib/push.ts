import webpush from 'web-push'
import { query } from './db'

/**
 * Web push to the owner's devices.
 *
 * Every send reports how many devices it actually reached, because the callers
 * (alerts, the daily summary, the test button) must not record "sent" when the
 * table is empty or every device refused: production ran for days claiming
 * alerts as sent with zero subscriptions.
 */

let _configured: boolean | null = null

/** Configure web-push once per process. False when the VAPID keys are missing. */
function configure(): boolean {
  if (_configured !== null) return _configured
  const publicKey = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    console.warn('[push] VAPID keys not configured — notifications disabled')
    _configured = false
    return false
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:thiago.garcialeao@gmail.com', publicKey, privateKey)
  _configured = true
  return true
}

/** What a push is about. The service worker chimes only for 'sale'. */
export type PushKind = 'sale' | 'alert' | 'summary' | 'scale' | 'test'

export interface PushPayload {
  title: string
  body: string
  /** What this push is about; the service worker tells the open app, which
   *  plays the cash-register sound only for a sale. */
  kind?: PushKind
  /** Path opened when the notification is tapped, e.g. /m?loja=<id>. */
  url?: string
  /** Groups notifications: a new one with the same tag replaces the previous. */
  tag?: string
  /** Extra data passed through to the service worker. */
  data?: Record<string, unknown>
}

export interface PushResult {
  /** Devices that accepted the message. */
  sent: number
  failed: number
  /** Subscriptions the push service says are gone (404/410), now deleted. */
  pruned: number
  /** Subscriptions refused for credentials (401/403): usually a VAPID key that
   *  changed after the device subscribed. Kept, because a wrong key on the
   *  server would otherwise wipe every device; the device must resubscribe. */
  rejected: number
  /** Subscriptions on file when the send started. */
  devices: number
}

const NOTHING: PushResult = { sent: 0, failed: 0, pruned: 0, rejected: 0, devices: 0 }

/** Whether this server can send pushes at all (its VAPID keys are set): with
 *  them missing, pushDeviceCount reads 0 whatever is subscribed, and the
 *  screens must say "sem chave de push", not "nenhum aparelho inscrito". */
export function pushKeysConfigured(): boolean {
  return configure()
}

/** Devices a push would reach right now (0 when VAPID is not configured). */
export async function pushDeviceCount(): Promise<number> {
  if (!configure()) return 0
  const rows = await query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM push_subscriptions`)
  return Number(rows[0]?.n ?? 0)
}

/** Whether this endpoint is on file, so a device can tell a lost subscription
 *  from a working one and subscribe again. */
export async function isKnownEndpoint(endpoint: string): Promise<boolean> {
  const rows = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE endpoint = $1`, [endpoint])
  return Number(rows[0]?.n ?? 0) > 0
}

/**
 * Send a notification to every registered device.
 * Subscriptions the push service has dropped (404/410: app uninstalled,
 * permission revoked) are deleted. Only the endpoints that accepted the
 * message get their last_used_at stamped.
 */
export async function sendPushToAll(payload: PushPayload): Promise<PushResult> {
  if (!configure()) return NOTHING

  const subs = await query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions`,
  )
  if (subs.length === 0) return NOTHING

  const body = JSON.stringify(payload)
  const ok: string[] = []
  const dead: string[] = []
  let failed = 0
  let rejected = 0

  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 3600, urgency: 'high' },
      )
      ok.push(sub.endpoint)
    } catch (err) {
      failed++
      const status = (err as { statusCode?: number }).statusCode
      if (status === 410 || status === 404) dead.push(sub.endpoint)
      else if (status === 401 || status === 403) {
        rejected++
        console.error('[push] subscription refused the VAPID credentials; the device must subscribe again', status)
      } else console.error('[push] send failed:', status, (err as Error).message)
    }
  }))

  if (dead.length) {
    await query(`DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])`, [dead])
    console.log(`[push] pruned ${dead.length} dead subscription(s)`)
  }
  if (ok.length) {
    await query(`UPDATE push_subscriptions SET last_used_at = NOW() WHERE endpoint = ANY($1::text[])`, [ok])
  }

  return { sent: ok.length, failed, pruned: dead.length, rejected, devices: subs.length }
}
