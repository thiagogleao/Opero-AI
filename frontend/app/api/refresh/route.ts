import { spawn } from 'child_process'
import path from 'path'
import { auth } from '@clerk/nextjs/server'

const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const PYTHON = process.env.PYTHON_BIN || 'python3'
const SCRIPT = path.join(PROJECT_ROOT, 'collect_recent.py')

function spawnSource(source: string, dateFrom: string, dateTo: string, tenantId: string) {
  try {
    const args = [SCRIPT, '--source', source, '--date-from', dateFrom, '--date-to', dateTo, '--tenant', tenantId]
    const proc = spawn(PYTHON, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      shell: false,
      stdio: 'ignore',
    })
    proc.unref()
    console.log(`[refresh] spawned ${source} pid=${proc.pid}`)
  } catch (err) {
    console.error(`[refresh] failed to spawn ${source}:`, err)
  }
}

export async function POST(req: Request) {
  try {
    const { userId } = await auth()
    if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => ({}))
    const today = new Date().toISOString().split('T')[0]
    const dateTo: string   = body.dateTo ?? today
    const dateFrom: string = body.dateFrom
      ?? (() => { const d = new Date(); d.setDate(d.getDate() - (body.days ?? 2)); return d.toISOString().split('T')[0] })()

    spawnSource('shopify',  dateFrom, dateTo, userId)
    spawnSource('facebook', dateFrom, dateTo, userId)

    return Response.json({ started: true, dateFrom, dateTo })
  } catch (err) {
    console.error('[refresh] error:', err)
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
