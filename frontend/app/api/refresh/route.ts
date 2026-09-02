import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import { auth } from '@clerk/nextjs/server'
import { getLastSyncTime, getTenantTimezone } from '@/lib/queries'
import { getActiveTenantId } from '@/lib/activeStore'
import { getTenantsByUserId } from '@/lib/tenant'

const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const PYTHON = process.env.PYTHON_BIN || 'python3'
const SCRIPT = path.join(PROJECT_ROOT, 'collect_recent.py')
const SYNC_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

/** Returns YYYY-MM-DD in the given IANA timezone. */
function todayInTz(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz })
}

function spawnSource(source: string, dateFrom: string, dateTo: string, tenantId: string, mode?: string): ChildProcess | null {
  try {
    const args = [SCRIPT, '--source', source, '--date-from', dateFrom, '--date-to', dateTo, '--tenant', tenantId]
    if (mode) args.push('--mode', mode)
    const proc = spawn(PYTHON, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      shell: false,
      stdio: 'ignore',
    })

    // Kill after SYNC_TIMEOUT_MS to prevent hung processes
    const killTimer = setTimeout(() => {
      console.warn(`[refresh] timeout — killing ${source} pid=${proc.pid} after ${SYNC_TIMEOUT_MS / 60000}min`)
      proc.kill('SIGTERM')
    }, SYNC_TIMEOUT_MS)

    proc.on('exit', (code, signal) => {
      clearTimeout(killTimer)
      if (code !== 0) {
        console.error(`[refresh] ${source} pid=${proc.pid} exited with code=${code} signal=${signal}`)
      } else {
        console.log(`[refresh] ${source} pid=${proc.pid} finished ok`)
      }
    })

    proc.unref()
    console.log(`[refresh] spawned ${source} pid=${proc.pid} tenant=${tenantId} from=${dateFrom} to=${dateTo}`)
    return proc
  } catch (err) {
    console.error(`[refresh] failed to spawn ${source}:`, err)
    return null
  }
}

/** Compute dateFrom for a tenant+source based on its last sync time. */
async function computeDateFrom(tenantId: string, tz: string, explicitDateFrom?: string, source?: string): Promise<string> {
  if (explicitDateFrom) return explicitDateFrom
  const syncs = await getLastSyncTime(tenantId, source)
  const lastFinished = syncs[0]?.finished_at ?? null
  if (lastFinished) {
    const lastSyncLocalDate = new Date(lastFinished)
      .toLocaleDateString('en-CA', { timeZone: tz })
    // Go back 1 day: Facebook Insights for a given day are only fully
    // available the following morning. Re-fetching the previous day ensures
    // we capture data that was incomplete at sync time.
    const [y, m, day] = lastSyncLocalDate.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, day - 1)).toISOString().slice(0, 10)
  }
  const ninetyDaysAgo = new Date(Date.now() - 89 * 86400000)
  return ninetyDaysAgo.toLocaleDateString('en-CA', { timeZone: tz })
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const tenantId = await getActiveTenantId(userId)
    const body = await req.json().catch(() => ({}))

    // --- Active store: sync immediately ---
    const storeTimezone = await getTenantTimezone(tenantId)
    const today = todayInTz(storeTimezone)
    const dateTo: string = body.dateTo ?? today
    // Each source uses its own last sync date so a fresh Shopify sync
    // doesn't prevent Facebook from going back 90 days on first run.
    const shopifyDateFrom  = await computeDateFrom(tenantId, storeTimezone, body.dateFrom, 'shopify')
    const facebookDateFrom = await computeDateFrom(tenantId, storeTimezone, body.dateFrom, 'facebook')

    spawnSource('shopify',  shopifyDateFrom,  dateTo, tenantId)
    spawnSource('facebook', facebookDateFrom, dateTo, tenantId)

    // --- Other stores: queue in background with staggered delay ---
    // Only when this is a smart incremental refresh (no explicit date range),
    // so we don't apply a custom range to stores the user didn't intend.
    if (!body.dateFrom) {
      const allTenants = await getTenantsByUserId(userId)
      const otherTenants = allTenants.filter(t => t.id !== tenantId)

      otherTenants.forEach((tenant, i) => {
        // 8 s gap between stores so the active store gets a clear head start
        const delayMs = (i + 1) * 8_000
        setTimeout(async () => {
          try {
            const tz = await getTenantTimezone(tenant.id)
            const tenantToday = todayInTz(tz)
            const tenantShopifyFrom  = await computeDateFrom(tenant.id, tz, undefined, 'shopify')
            const tenantFacebookFrom = await computeDateFrom(tenant.id, tz, undefined, 'facebook')
            spawnSource('shopify',  tenantShopifyFrom,  tenantToday, tenant.id)
            // 'quick' mode: only daily insights, skip structure re-sync to avoid
            // FB rate limits when multiple stores share the same ad account.
            spawnSource('facebook', tenantFacebookFrom, tenantToday, tenant.id, 'quick')
          } catch (err) {
            console.error(`[refresh] failed to queue background tenant ${tenant.id}:`, err)
          }
        }, delayMs)
      })

      return Response.json({
        started: true, shopifyDateFrom, facebookDateFrom, dateTo, storeTimezone,
        otherStoresCount: otherTenants.length,
      })
    }

    return Response.json({ started: true, shopifyDateFrom, facebookDateFrom, dateTo, storeTimezone, otherStoresCount: 0 })
  } catch (err) {
    console.error('[refresh] error:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
