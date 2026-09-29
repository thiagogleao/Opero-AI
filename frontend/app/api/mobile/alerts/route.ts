import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import {
  getAlertConfig, saveAlertConfig, runAlertChecks, sendDailySummary,
  type AlertConfig,
} from '@/lib/alerts'
import { query } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Current thresholds, plus what already fired today. */
export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const config = await getAlertConfig()
  let today: { kind: string; tenant_id: string; sent_at: string }[] = []
  try {
    today = await query(
      `SELECT kind, tenant_id, sent_at::text
       FROM alert_events
       WHERE day = CURRENT_DATE
       ORDER BY sent_at DESC
       LIMIT 20`
    )
  } catch { /* table not migrated yet */ }

  return Response.json({ config, today })
}

/**
 * Save thresholds, or fire something on demand.
 *
 * `action: 'test'` bypasses the once-a-day claim so the button proves the whole
 * path — config, evaluation, VAPID, service worker — instead of silently doing
 * nothing because today's alert was already sent.
 */
export async function POST(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const body = await req.json().catch(() => ({})) as
    { action?: string; config?: Partial<AlertConfig> }

  if (body.action === 'test') {
    const fired = await runAlertChecks({ force: true })
    const summary = await sendDailySummary({ force: true })
    return Response.json({ tested: true, fired: fired.length, summary })
  }

  if (body.action === 'summary') {
    const sent = await sendDailySummary({ force: true })
    return Response.json({ sent })
  }

  const config = await saveAlertConfig(body.config ?? {})
  return Response.json({ config })
}
