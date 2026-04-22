import { spawn } from 'child_process'
import path from 'path'
import { auth } from '@clerk/nextjs/server'

const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const PYTHON = process.env.PYTHON_BIN
  || (process.platform === 'win32'
    ? 'C:\\Users\\thiag\\AppData\\Local\\Programs\\Python\\Python312\\python.exe'
    : 'python3')
const SCRIPT = path.join(PROJECT_ROOT, 'collect_recent.py')

// Fire-and-forget: starts the process and returns immediately.
// The process keeps running on the server after the HTTP response is sent.
function spawnSource(source: string, dateFrom: string, dateTo: string, tenantId: string) {
  const args = [SCRIPT, '--source', source, '--date-from', dateFrom, '--date-to', dateTo, '--tenant', tenantId]
  const proc = spawn(PYTHON, args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    shell: true,
    detached: false,
  })
  proc.stdout.on('data', (d: Buffer) => process.stdout.write(`[sync:${source}] ${d}`))
  proc.stderr.on('data', (d: Buffer) => process.stderr.write(`[sync:${source}] ${d}`))
  proc.on('close', code => console.log(`[sync:${source}] exited with code ${code}`))
  proc.on('error', err => console.error(`[sync:${source}] error:`, err.message))
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const today = new Date().toISOString().split('T')[0]
  const dateTo: string   = body.dateTo ?? today
  const dateFrom: string = body.dateFrom
    ?? (() => { const d = new Date(); d.setDate(d.getDate() - (body.days ?? 2)); return d.toISOString().split('T')[0] })()

  // Start both syncs in the background — return immediately so Railway doesn't timeout
  spawnSource('shopify',  dateFrom, dateTo, userId)
  spawnSource('facebook', dateFrom, dateTo, userId)

  return Response.json({
    started: true,
    dateFrom,
    dateTo,
    shopify:  { ok: true },
    facebook: { ok: true },
  })
}
