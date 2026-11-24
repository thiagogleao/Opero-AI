import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import {
  AlertConfigError, getAlertConfig, loadRecentAlerts, saveAlertConfig, runAlertChecks, sendDailySummary,
  type AlertsGetResponse, type AlertsTestResponse,
} from '@/lib/alerts'
import { pushDeviceCount, pushKeysConfigured } from '@/lib/push'
import { listStores } from '@/lib/access'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Current thresholds, what fired lately (and what each reached), how many
 *  devices would hear it, and whether this server can send pushes at all. */
export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const [config, devices, stores] = await Promise.all([
    getAlertConfig(),
    pushDeviceCount().catch(() => 0),
    listStores({ kind: 'owner' }, { includeArchived: true }),
  ])
  // Each row says what it reached ("entregue a 2 aparelhos", "não entregue"):
  // a row is a once-a-day claim, not a delivery receipt.
  const recent = await loadRecentAlerts(new Map(stores.map(s => [s.id, s.name])))

  const body: AlertsGetResponse = { config, recent, devices, pushKeys: pushKeysConfigured() }
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
    const res: AlertsTestResponse = { tested: true, devices, pushKeys: pushKeysConfigured(), alerts, summary }
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
