import { spawn } from 'child_process'
import path from 'path'
import { query } from './db'

/**
 * Server-side sync scheduler.
 *
 * Until now a sync only ran while a browser had Opero open — the dashboard's
 * AutoSync component drove it. So opening the phone after hours meant reading
 * stale numbers while a sync you just triggered caught up. This runs on the
 * server instead, independent of any client.
 *
 * Shopify and Facebook are on separate cadences on purpose: orders drive the
 * profit figure and are cheap to fetch, while several stores share one ad
 * account whose per-account hourly limit is what caused the earlier error 17.
 */

const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const PYTHON = process.env.PYTHON_BIN || 'python3'
const SCRIPT = path.join(PROJECT_ROOT, 'collect_recent.py')

const SHOPIFY_EVERY_MIN  = Number(process.env.AUTO_SYNC_SHOPIFY_MIN  ?? 10)
const FACEBOOK_EVERY_MIN = Number(process.env.AUTO_SYNC_FACEBOOK_MIN ?? 30)
const STAGGER_MS         = Number(process.env.AUTO_SYNC_STAGGER_MS   ?? 8_000)
const SYNC_TIMEOUT_MS    = 10 * 60 * 1000

let started = false

function todayInTz(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz })
}
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function spawnSync(source: string, from: string, to: string, tenantId: string, mode?: string) {
  try {
    const args = [SCRIPT, '--source', source, '--date-from', from, '--date-to', to, '--tenant', tenantId]
    if (mode) args.push('--mode', mode)
    const proc = spawn(PYTHON, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      shell: false,
      stdio: 'ignore',
    })
    const kill = setTimeout(() => proc.kill('SIGTERM'), SYNC_TIMEOUT_MS)
    proc.on('exit', () => clearTimeout(kill))
    proc.unref()
  } catch (err) {
    console.error(`[autosync] spawn ${source} failed for ${tenantId}:`, err)
  }
}

async function runCycle(source: 'shopify' | 'facebook') {
  const tenants = await query<{ id: string; timezone: string | null }>(
    `SELECT id, COALESCE(timezone, 'UTC') AS timezone
     FROM tenants
     WHERE shopify_access_token IS NOT NULL
     ORDER BY created_at`
  )

  console.log(`[autosync] ${source}: ${tenants.length} store(s)`)

  tenants.forEach((t, i) => {
    const tz = t.timezone ?? 'UTC'
    const to = todayInTz(tz)
    // Two days back: today is still open, and yesterday's late orders and ad
    // spend are usually incomplete at the time of the previous run.
    const from = shiftDate(to, -2)
    // collect_recent.py holds a per-tenant-per-source lock, so an overlapping
    // run exits on its own; the stagger is about not hammering the two APIs
    // with five stores at once.
    setTimeout(() => spawnSync(source, from, to, t.id, source === 'facebook' ? 'quick' : undefined), i * STAGGER_MS)
  })
}

/** Start the scheduler. Safe to call more than once. */
export function startAutoSync() {
  if (started) return
  if (process.env.AUTO_SYNC_ENABLED === 'false') {
    console.log('[autosync] disabled via AUTO_SYNC_ENABLED=false')
    return
  }
  started = true

  console.log(`[autosync] scheduling shopify/${SHOPIFY_EVERY_MIN}min facebook/${FACEBOOK_EVERY_MIN}min`)

  const guard = (source: 'shopify' | 'facebook') => () => {
    runCycle(source).catch(err => console.error(`[autosync] ${source} cycle failed:`, err))
  }

  // Offset the first runs so a cold boot doesn't fire both at once, and so a
  // deploy doesn't collide with whatever a browser may have just triggered.
  setTimeout(guard('shopify'), 60_000)
  setTimeout(guard('facebook'), 150_000)

  setInterval(guard('shopify'),  SHOPIFY_EVERY_MIN  * 60_000)
  setInterval(guard('facebook'), FACEBOOK_EVERY_MIN * 60_000)
}
