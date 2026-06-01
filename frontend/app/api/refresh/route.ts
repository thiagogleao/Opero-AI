import { spawn, ChildProcess } from 'child_process'
import path from 'path'
import { auth } from '@clerk/nextjs/server'
import { getLastSyncTime, getTenantTimezone } from '@/lib/queries'
import { getActiveTenantId } from '@/lib/activeStore'

const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const PYTHON = process.env.PYTHON_BIN || 'python3'
const SCRIPT = path.join(PROJECT_ROOT, 'collect_recent.py')
const SYNC_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

/** Returns YYYY-MM-DD in the given IANA timezone. */
function todayInTz(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz })
}

function spawnSource(source: string, dateFrom: string, dateTo: string, tenantId: string): ChildProcess | null {
  try {
    const args = [SCRIPT, '--source', source, '--date-from', dateFrom, '--date-to', dateTo, '--tenant', tenantId]
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
    console.log(`[refresh] spawned ${source} pid=${proc.pid} from=${dateFrom} to=${dateTo}`)
    return proc
  } catch (err) {
    console.error(`[refresh] failed to spawn ${source}:`, err)
    return null
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const tenantId = await getActiveTenantId(userId)
    const body = await req.json().catch(() => ({}))

    // Always derive "today" from the store's timezone, not the server's UTC clock
    const storeTimezone = await getTenantTimezone(tenantId)
    const today = todayInTz(storeTimezone)

    let dateFrom: string
    const dateTo: string = body.dateTo ?? today

    if (body.dateFrom) {
      dateFrom = body.dateFrom
    } else {
      const syncs = await getLastSyncTime(tenantId)
      const lastFinished = syncs[0]?.finished_at ?? null

      if (lastFinished) {
        const lastSyncLocalDate = new Date(lastFinished)
          .toLocaleDateString('en-CA', { timeZone: storeTimezone })
        dateFrom = lastSyncLocalDate
      } else {
        const d = new Date()
        const thirtyDaysAgo = new Date(d.getTime() - 29 * 86400000)
        dateFrom = thirtyDaysAgo.toLocaleDateString('en-CA', { timeZone: storeTimezone })
      }
    }

    spawnSource('shopify',  dateFrom, dateTo, tenantId)
    spawnSource('facebook', dateFrom, dateTo, tenantId)

    return Response.json({ started: true, dateFrom, dateTo, storeTimezone })
  } catch (err) {
    console.error('[refresh] error:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
