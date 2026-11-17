import { query } from '@/lib/db'
import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import { isKnownEndpoint, pushDeviceCount } from '@/lib/push'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A push endpoint is an https URL handed out by the browser's push service. */
function validEndpoint(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 2000) return false
  try { return new URL(v).protocol === 'https:' } catch { return false }
}
const validKey = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 300

/** Register (or refresh) this device's push subscription. */
export async function POST(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const body = await req.json().catch(() => null) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | null
  const endpoint = body?.endpoint
  const p256dh = body?.keys?.p256dh
  const auth = body?.keys?.auth
  if (!validEndpoint(endpoint) || !validKey(p256dh) || !validKey(auth)) {
    return Response.json({ error: 'Inscrição inválida' }, { status: 400 })
  }

  await query(
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE
       SET p256dh = $2, auth = $3, user_agent = $4`,
    [endpoint, p256dh, auth, req.headers.get('user-agent')?.slice(0, 300) ?? null],
  )

  return Response.json({ ok: true, devices: await pushDeviceCount() })
}

/** Unregister this device. */
export async function DELETE(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()
  const body = await req.json().catch(() => null) as { endpoint?: unknown } | null
  if (!validEndpoint(body?.endpoint)) return Response.json({ error: 'Endpoint ausente' }, { status: 400 })
  await query(`DELETE FROM push_subscriptions WHERE endpoint = $1`, [body.endpoint])
  return Response.json({ ok: true })
}

/**
 * Registered device count, the public VAPID key the browser needs to
 * subscribe, and — with ?endpoint= — whether this device's subscription is
 * still on file. A device whose permission is "granted" but whose row was
 * pruned must subscribe again; without this it cannot tell.
 */
export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()
  const endpoint = new URL(req.url).searchParams.get('endpoint')
  const [devices, known] = await Promise.all([
    pushDeviceCount(),
    validEndpoint(endpoint) ? isKnownEndpoint(endpoint) : Promise.resolve(null),
  ])
  return Response.json(
    { devices, vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null, known },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
