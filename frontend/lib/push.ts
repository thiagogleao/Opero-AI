import webpush from 'web-push'
import { query } from './db'

let _configured = false

/** Configure web-push once per process. Returns false when VAPID keys are missing. */
function configure(): boolean {
  if (_configured) return true
  const publicKey  = process.env.VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  if (!publicKey || !privateKey) {
    console.warn('[push] VAPID keys not configured — notifications disabled')
    return false
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:thiago.garcialeao@gmail.com',
    publicKey,
    privateKey,
  )
  _configured = true
  return true
}

export interface PushPayload {
  title: string
  body: string
  /** Path opened when the notification is tapped. */
  url?: string
  /** Groups notifications: a new one with the same tag replaces the previous. */
  tag?: string
  /** Extra data passed through to the service worker. */
  data?: Record<string, unknown>
}

/**
 * Send a notification to every registered device.
 * Subscriptions rejected by the push service (410/404 = uninstalled or
 * permission revoked) are deleted so the table doesn't accumulate dead rows.
 */
export async function sendPushToAll(payload: PushPayload): Promise<{ sent: number; failed: number }> {
  if (!configure()) return { sent: 0, failed: 0 }

  const subs = await query<{ endpoint: string; p256dh: string; auth: string }>(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions`
  )
  if (subs.length === 0) return { sent: 0, failed: 0 }

  const body = JSON.stringify(payload)
  let sent = 0, failed = 0
  const dead: string[] = []

  await Promise.all(subs.map(async sub => {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        body,
        { TTL: 3600, urgency: 'high' },
      )
      sent++
    } catch (err) {
      failed++
      const status = (err as { statusCode?: number }).statusCode
      if (status === 410 || status === 404) dead.push(sub.endpoint)
      else console.error('[push] send failed:', status, (err as Error).message)
    }
  }))

  if (dead.length) {
    await query(`DELETE FROM push_subscriptions WHERE endpoint = ANY($1::text[])`, [dead])
    console.log(`[push] pruned ${dead.length} dead subscription(s)`)
  }
  if (sent) {
    await query(`UPDATE push_subscriptions SET last_used_at = NOW()`)
  }

  return { sent, failed }
}
