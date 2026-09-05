import { query } from '@/lib/db'
import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Register (or refresh) this device's push subscription. */
export async function POST(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const body = await req.json().catch(() => null)
  const endpoint = body?.endpoint
  const p256dh   = body?.keys?.p256dh
  const auth     = body?.keys?.auth
  if (!endpoint || !p256dh || !auth) {
    return Response.json({ error: 'Invalid subscription' }, { status: 400 })
  }

  await query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET p256dh = $2, auth = $3, user_agent = $4`,
    [endpoint, p256dh, auth, req.headers.get('user-agent')?.slice(0, 300) ?? null]
  )

  return Response.json({ ok: true })
}

/** Unregister this device. */
export async function DELETE(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()
  const body = await req.json().catch(() => null)
  if (!body?.endpoint) return Response.json({ error: 'Missing endpoint' }, { status: 400 })
  await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [body.endpoint])
  return Response.json({ ok: true })
}

/** Registered device count + the public VAPID key the browser needs to subscribe. */
export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()
  const rows = await query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM push_subscriptions`)
  return Response.json({
    devices: Number(rows[0]?.count ?? 0),
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
  })
}
