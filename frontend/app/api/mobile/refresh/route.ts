import { spawn } from 'child_process'
import path from 'path'
import { query } from '@/lib/db'
import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import { todayInTz, shiftDate } from '@/lib/mobileRange'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const PYTHON = process.env.PYTHON_BIN || 'python3'
const SCRIPT = path.join(PROJECT_ROOT, 'collect_recent.py')
const SYNC_TIMEOUT_MS = 10 * 60 * 1000

function spawnSource(source: string, dateFrom: string, dateTo: string, tenantId: string, mode?: string) {
  try {
    const args = [SCRIPT, '--source', source, '--date-from', dateFrom, '--date-to', dateTo, '--tenant', tenantId]
    if (mode) args.push('--mode', mode)
    const proc = spawn(PYTHON, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      shell: false,
      stdio: 'ignore',
    })
    const killTimer = setTimeout(() => proc.kill('SIGTERM'), SYNC_TIMEOUT_MS)
    proc.on('exit', () => clearTimeout(killTimer))
    proc.unref()
    console.log(`[mobile/refresh] spawned ${source} tenant=${tenantId} ${dateFrom}..${dateTo}`)
  } catch (err) {
    console.error(`[mobile/refresh] failed to spawn ${source}:`, err)
  }
}

/**
 * Force a data refresh for every store, from the phone.
 *
 * Mirrors /api/refresh, but that route is Clerk-scoped to one account's stores
 * while this view spans all of them. Facebook runs in 'quick' mode because
 * several stores share an ad account and a full pass across all of them trips
 * the per-account rate limit (error 17).
 */
export async function POST(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const tenants = await query<{ id: string; timezone: string | null }>(
    `SELECT id, COALESCE(timezone, 'UTC') AS timezone
     FROM tenants
     WHERE shopify_access_token IS NOT NULL
     ORDER BY created_at`
  )

  tenants.forEach((t, i) => {
    const tz = t.timezone ?? 'UTC'
    const today = todayInTz(tz)
    // Two days back: the current day is still open and yesterday's late orders
    // and ad spend are often incomplete at the time of the previous sync.
    const dateFrom = shiftDate(today, -2)
    // Stagger so five stores don't hit Shopify and Facebook simultaneously.
    setTimeout(() => {
      spawnSource('shopify', dateFrom, today, t.id)
      spawnSource('facebook', dateFrom, today, t.id, 'quick')
    }, i * 6_000)
  })

  return Response.json({ started: true, stores: tenants.length })
}
