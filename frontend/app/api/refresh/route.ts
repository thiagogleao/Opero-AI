import { spawn } from 'child_process'
import path from 'path'
import { auth } from '@clerk/nextjs/server'

const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const PYTHON = process.env.PYTHON_BIN
  || (process.platform === 'win32'
    ? 'C:\\Users\\thiag\\AppData\\Local\\Programs\\Python\\Python312\\python.exe'
    : 'python3')
const SCRIPT = path.join(PROJECT_ROOT, 'collect_recent.py')

const SYNC_TIMEOUT_MS = 8 * 60 * 1000 // 8 minutes

function runSource(source: string, dateFrom: string, dateTo: string, tenantId: string): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    const args = [SCRIPT, '--source', source, '--date-from', dateFrom, '--date-to', dateTo, '--tenant', tenantId]
    const proc = spawn(PYTHON, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      shell: true,
    })
    const lines: string[] = []
    proc.stdout.on('data', (d: Buffer) => lines.push(d.toString()))
    proc.stderr.on('data', (d: Buffer) => lines.push(d.toString()))

    const timer = setTimeout(() => {
      proc.kill()
      resolve({ ok: false, output: lines.join('') + '\n[timeout after 8 minutes]' })
    }, SYNC_TIMEOUT_MS)

    proc.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0, output: lines.join('') }) })
    proc.on('error', err => { clearTimeout(timer); resolve({ ok: false, output: err.message }) })
  })
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const today = new Date().toISOString().split('T')[0]
  const dateTo: string = body.dateTo ?? today
  const dateFrom: string = body.dateFrom
    ?? (() => { const d = new Date(); d.setDate(d.getDate() - (body.days ?? 2)); return d.toISOString().split('T')[0] })()

  const [shopify, facebook] = await Promise.all([
    runSource('shopify', dateFrom, dateTo, userId),
    runSource('facebook', dateFrom, dateTo, userId),
  ])

  const isFbTokenError = !facebook.ok && (
    facebook.output.includes('OAuthException') ||
    facebook.output.includes('access blocked') ||
    facebook.output.includes('token')
  )

  return Response.json({
    shopify: { ok: shopify.ok, output: shopify.output },
    facebook: { ok: facebook.ok, tokenExpired: isFbTokenError, output: facebook.output },
    anyOk: shopify.ok || facebook.ok,
  })
}
