import { spawn } from 'child_process'
import path from 'path'
import { query } from './db'
import { getAlertConfig, hourInTz, runAlertChecks, runScaleChecks, sendDailySummary } from './alerts'
import { journeyStores, syncJourneys, refreshPendingJourneys } from './journey'
import { runBulkBackfill, storesNeedingBackfill } from './journeyBulk'
import { adjustmentStores, syncAdjustments } from './adjustments'

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
// Alerts read what the syncs just wrote, so they run on their own short cadence:
// often enough to catch the summary hour, cheap because every send is claimed
// once per day in alert_events.
const ALERTS_EVERY_MIN   = Number(process.env.ALERTS_EVERY_MIN ?? 15)
// Journeys are collected on their own slow cadence: the Shopify query is
// expensive, and attribution is read in hindsight, not watched live.
const JOURNEY_EVERY_MIN  = Number(process.env.JOURNEY_EVERY_MIN ?? 20)
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

/**
 * Collect the attribution journeys Shopify recorded.
 *
 * Three jobs share one pass, in order of what a reader needs soonest:
 * new orders first, then the ones Shopify had not finished computing, then a
 * slice of history. Each is bounded, because the journey query is expensive
 * and this runs beside the ordinary syncs.
 */
async function runJourneyCycle() {
  const stores = await journeyStores()

  for (const store of stores) {
    try {
      // Newest orders. Stops as soon as it meets a run of orders it already
      // has, so a caught-up store costs one page.
      const recent = await syncJourneys(store, { maxOrders: 60, stopAfterKnown: 15 })

      // Journeys Shopify answered as not ready when we first asked.
      const refreshed = await refreshPendingJourneys(store, { maxOrders: 25 })

      if (recent.saved || refreshed.nowReady) {
        console.log(`[journey] ${store.shopify_domain}: novos ${recent.saved}, prontos agora ${refreshed.nowReady}`)
      }
    } catch (err) {
      console.error('[journey] cycle failed for', store.id, err)
    }
  }

  // History is pulled through a bulk operation instead of page by page: the
  // paged route costs about a second per order, which for these stores was the
  // difference between minutes and two days. One store per cycle, because a
  // shop may only have one bulk operation in flight.
  // Refunds and chargebacks ride along with the journey pass: both are read
  // from Shopify, neither is urgent to the minute, and a dispute's status can
  // change weeks after it opened, so re-reading is the only way a win is seen.
  for (const store of await adjustmentStores()) {
    try {
      const r = await syncAdjustments(store, { sinceDays: 45 })
      if (r.refunds || r.disputes) {
        console.log(`[adjustments] ${store.shopify_domain}: ${r.refunds} estornos, ${r.disputes} disputas${r.skipped ? ` · ${r.skipped}` : ''}`)
      }
    } catch (err) {
      console.error('[adjustments] failed for', store.id, err)
    }
  }

  const pending = await storesNeedingBackfill(stores)
  if (pending.length > 0) {
    const r = await runBulkBackfill(pending[0])
    console.log(
      `[journey] histórico ${pending[0].shopify_domain}: ${r.orders} pedidos, ` +
      `${r.touches} toques em ${r.seconds}s${r.error ? ` · ERRO ${r.error}` : ''} ` +
      `(faltam ${pending.length - 1} lojas)`
    )
  }
}

/**
 * Evaluate the alert rules, and push the daily summary once the configured
 * hour has passed. Running late still sends: a summary that missed its slot
 * because the server was redeploying is worth more than no summary.
 */
async function runAlertCycle() {
  const cfg = await getAlertConfig()
  await runAlertChecks()
  // Scale verdicts judge complete days only, so they are worth asking for once
  // the day has turned rather than on every pass through the morning.
  if (hourInTz() >= cfg.fromHour) await runScaleChecks()
  if (cfg.dailySummary.enabled && hourInTz() >= cfg.dailySummary.hour) {
    await sendDailySummary()
  }
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

  if (process.env.ALERTS_ENABLED === 'false') {
    console.log('[alerts] disabled via ALERTS_ENABLED=false')
    return
  }
  const alertGuard = () => {
    runAlertCycle().catch(err => console.error('[alerts] cycle failed:', err))
  }
  // First pass after the opening syncs, so it judges fresh numbers.
  setTimeout(alertGuard, 240_000)
  setInterval(alertGuard, ALERTS_EVERY_MIN * 60_000)
  console.log(`[alerts] scheduling checks every ${ALERTS_EVERY_MIN}min`)

  if (process.env.JOURNEY_SYNC_ENABLED === 'false') {
    console.log('[journey] disabled via JOURNEY_SYNC_ENABLED=false')
    return
  }
  const journeyGuard = () => {
    runJourneyCycle().catch(err => console.error('[journey] cycle failed:', err))
  }
  // Last of the four to start: it is the least urgent and the most expensive.
  setTimeout(journeyGuard, 330_000)
  setInterval(journeyGuard, JOURNEY_EVERY_MIN * 60_000)
  console.log(`[journey] scheduling collection every ${JOURNEY_EVERY_MIN}min`)
}
