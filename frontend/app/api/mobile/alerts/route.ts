import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import {
  AlertConfigError, getAlertConfig, saveAlertConfig, runAlertChecks, sendDailySummary,
  type AlertEventRow, type AlertsGetResponse, type AlertsTestResponse,
} from '@/lib/alerts'
import { pushDeviceCount } from '@/lib/push'
import { listStores } from '@/lib/access'
import { query } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Current thresholds, what fired lately, and how many devices would hear it. */
export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const [config, devices, stores] = await Promise.all([
    getAlertConfig(),
    pushDeviceCount().catch(() => 0),
    listStores({ kind: 'owner' }, { includeArchived: true }),
  ])
  const nameOf = new Map(stores.map(s => [s.id, s.name]))
  let recent: AlertEventRow[] = []
  try {
    const rows = await query<{ kind: string; tenant_id: string; day: string; sent_at: string; title: string | null }>(
      `SELECT kind, tenant_id, day::text AS day, sent_at::text AS sent_at, payload->>'title' AS title
         FROM alert_events
        WHERE sent_at > now() - interval '24 hours'
        ORDER BY sent_at DESC
        LIMIT 30`)
    recent = rows.map(r => {
      // Scale alerts are keyed "<store>:<campaign>", the summary "*".
      const storeId = r.tenant_id === '*' ? null : r.tenant_id.split(':')[0]
      return {
        kind: r.kind, storeId, store: storeId ? nameOf.get(storeId) ?? null : null,
        day: r.day, sentAt: r.sent_at, title: r.title,
      }
    })
  } catch { /* table not migrated yet */ }

  const body: AlertsGetResponse = { config, recent, devices }
  return Response.json(body, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * Save thresholds, or fire something on demand.
 *
 * `action: 'test'` bypasses the hour and the once-a-day claim so the button
 * proves the whole path, and answers with the devices actually reached — not
 * with how many alerts were evaluated.
 */
export async function POST(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const body = await req.json().catch(() => null) as { action?: unknown; config?: unknown } | null
  if (!body || typeof body !== 'object') return Response.json({ error: 'Corpo inválido' }, { status: 400 })

  if (body.action === 'test') {
    const devices = await pushDeviceCount()
    const alerts = await runAlertChecks({ force: true })
    const summary = await sendDailySummary({ force: true })
    const res: AlertsTestResponse = { tested: true, devices, alerts, summary }
    return Response.json(res)
  }

  if (body.action === 'summary') {
    return Response.json(await sendDailySummary({ force: true }))
  }

  if (body.action !== undefined) return Response.json({ error: 'Ação desconhecida' }, { status: 400 })

  try {
    const config = await saveAlertConfig(body.config ?? {})
    return Response.json({ config })
  } catch (err) {
    if (err instanceof AlertConfigError) return Response.json({ error: 'Valores inválidos', problems: err.problems }, { status: 400 })
    throw err
  }
}
