import { spawn } from 'child_process'
import path from 'path'
import { auth } from '@clerk/nextjs/server'

const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const PYTHON = process.env.PYTHON_BIN
  || (process.platform === 'win32'
    ? 'C:\\Users\\thiag\\AppData\\Local\\Programs\\Python\\Python312\\python.exe'
    : 'python3')
const SCRIPT = path.join(PROJECT_ROOT, 'collect_recent.py')

function runSource(source: string, days: number, tenantId: string): Promise<{ ok: boolean; output: string }> {
  return new Promise(resolve => {
    const args = [SCRIPT, '--source', source, '--days', String(days), '--tenant', tenantId]
    const proc = spawn(PYTHON, args, {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      shell: true,
    })
    const lines: string[] = []
    proc.stdout.on('data', (d: Buffer) => lines.push(d.toString()))
    proc.stderr.on('data', (d: Buffer) => lines.push(d.toString()))
    proc.on('close', code => resolve({ ok: code === 0, output: lines.join('') }))
    proc.on('error', err => resolve({ ok: false, output: err.message }))
  })
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { days = 2 } = await req.json().catch(() => ({}))

  const [shopify, facebook] = await Promise.all([
    runSource('shopify', days, userId),
    runSource('facebook', days, userId),
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
