import { spawn, type ChildProcess } from 'child_process'
import path from 'path'
import { cliArgs, jobKey, jobTimeoutMs, mergeJobs, type Lane, type SyncJob } from './plan'

/**
 * The one place that starts collect_recent.py.
 *
 * There used to be three copies (scheduler, desktop refresh, phone refresh),
 * each with its own window rules, none with a limit: two tabs and a phone
 * could start thirty interpreters in a minute, an archived store kept being
 * hit, and output went to /dev/null. Here:
 *  - one job per store and lane at a time; a request for a busy lane is folded
 *    into a single waiting job (wider window, stronger mode);
 *  - at most SYNC_MAX_CONCURRENT processes, started a few seconds apart;
 *  - stdout/stderr are captured, and the tail is logged when a run fails;
 *  - a kill timer sized to the job, SIGTERM first (the collector records the
 *    run as interrupted) and SIGKILL if it does not stop.
 *
 * State lives on globalThis: the instrumentation hook and the route handlers
 * may load this module separately, and must still share one queue.
 */

const PROJECT_ROOT = path.resolve(process.cwd(), '..')
const PYTHON = process.env.PYTHON_BIN || 'python3'
const SCRIPT = path.join(PROJECT_ROOT, 'collect_recent.py')
const MAX_CONCURRENT = Math.max(1, Number(process.env.SYNC_MAX_CONCURRENT ?? 3))
const SPAWN_GAP_MS = Number(process.env.AUTO_SYNC_STAGGER_MS ?? 3_000)
const EXIT_LOCKED = 75
const TAIL_LINES = 40

export interface RunningJob {
  job: SyncJob
  startedAt: number
  pid: number | undefined
  tail: string[]
  child: ChildProcess
}

export interface FinishedJob {
  job: SyncJob
  startedAt: number
  finishedAt: number
  /** Process exit code; null when it could not start or was killed. */
  code: number | null
  outcome: 'ok' | 'failed' | 'locked' | 'killed' | 'spawn-error'
}

interface RunnerState {
  running: Map<string, RunningJob>
  pending: Map<string, SyncJob>
  order: string[]
  recent: Map<string, FinishedJob>
  lastSpawnAt: number
  pumpTimer: NodeJS.Timeout | null
  listeners: Set<(f: FinishedJob) => void>
}

const g = globalThis as unknown as { __operoSyncRunner?: RunnerState }
const state: RunnerState = g.__operoSyncRunner ??= {
  running: new Map(), pending: new Map(), order: [], recent: new Map(),
  lastSpawnAt: 0, pumpTimer: null, listeners: new Set(),
}

/**
 * Whether this process may start collectors at all. Off for local runs
 * (AUTO_SYNC_DISABLED=1) and for a read-only database (DATABASE_READ_ONLY=1):
 * a laptop pointed at production must not write to it.
 */
export function syncAllowed(): boolean {
  return process.env.AUTO_SYNC_DISABLED !== '1' && process.env.DATABASE_READ_ONLY !== '1'
}

export type LaunchResult = 'started' | 'queued' | 'merged' | 'disabled'

/** Queue a job (or fold it into the one already waiting in its lane). */
export function launch(job: SyncJob): LaunchResult {
  if (!syncAllowed()) return 'disabled'
  const key = jobKey(job)
  const waiting = state.pending.get(key)
  if (waiting) {
    state.pending.set(key, mergeJobs(waiting, job))
    return 'merged'
  }
  state.pending.set(key, job)
  state.order.push(key)
  const busy = state.running.has(key)
  pump()
  return busy || state.pending.has(key) ? 'queued' : 'started'
}

/** Is a job of this store and lane running or waiting? */
export function laneBusy(tenantId: string, lane: Lane): boolean {
  const key = `${tenantId}:${lane}`
  return state.running.has(key) || state.pending.has(key)
}

/** "tenant:lane" of every job alive in this process. */
export function activeLanes(): string[] {
  return [...state.running.keys()]
}

export interface JobSnapshot {
  tenantId: string
  lane: Lane
  mode: string
  from: string
  to: string
  account: string | null
  reason: string
  state: 'running' | 'queued'
  startedAt: string | null
}

export function snapshot(tenantIds?: string[]): JobSnapshot[] {
  const want = tenantIds ? new Set(tenantIds) : null
  const out: JobSnapshot[] = []
  const add = (j: SyncJob, s: 'running' | 'queued', startedAt: number | null) => {
    if (want && !want.has(j.tenantId)) return
    out.push({
      tenantId: j.tenantId, lane: j.lane, mode: j.mode, from: j.from, to: j.to, account: j.account ?? null,
      reason: j.reason, state: s, startedAt: startedAt ? new Date(startedAt).toISOString() : null,
    })
  }
  for (const r of state.running.values()) add(r.job, 'running', r.startedAt)
  for (const j of state.pending.values()) add(j, 'queued', null)
  return out
}

export function lastFinished(tenantId: string, lane: Lane): FinishedJob | null {
  return state.recent.get(`${tenantId}:${lane}`) ?? null
}

/** Be told when a job ends (tests, the refresh endpoint's logs). */
export function onFinished(fn: (f: FinishedJob) => void): () => void {
  state.listeners.add(fn)
  return () => state.listeners.delete(fn)
}

// ─── Internals ────────────────────────────────────────────────────────────────

function pump(): void {
  if (state.pumpTimer) return
  while (state.running.size < MAX_CONCURRENT) {
    const idx = state.order.findIndex(k => !state.running.has(k))
    if (idx < 0) return
    const wait = state.lastSpawnAt + SPAWN_GAP_MS - Date.now()
    if (wait > 0) {
      state.pumpTimer = setTimeout(() => { state.pumpTimer = null; pump() }, wait)
      return
    }
    const key = state.order.splice(idx, 1)[0]
    const job = state.pending.get(key)
    state.pending.delete(key)
    if (job) start(key, job)
  }
}

const SECRET = /(access_token|appsecret_proof|client_secret|token)=([^&\s'"]+)|EAA[A-Za-z0-9]{20,}|shp(?:at|ca|ss|ua)_[A-Za-z0-9]{10,}/g
export const redactText = (s: string) => s.replace(SECRET, (m, k) => (k ? `${k}=***` : m.startsWith('EAA') ? 'EAA***' : 'shp***'))

function start(key: string, job: SyncJob): void {
  state.lastSpawnAt = Date.now()
  const tag = `[sync ${job.label ?? job.tenantId.slice(0, 8)}/${job.lane}/${job.mode}]`
  let child: ChildProcess
  try {
    child = spawn(PYTHON, [SCRIPT, ...cliArgs(job)], {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (err) {
    console.error(`${tag} não iniciou:`, err)
    finish(key, { job, startedAt: Date.now(), finishedAt: Date.now(), code: null, outcome: 'spawn-error' })
    return
  }
  const run: RunningJob = { job, startedAt: Date.now(), pid: child.pid, tail: [], child }
  state.running.set(key, run)
  console.log(`${tag} ${job.from}..${job.to}${job.account ? ` ${job.account}` : ''} (${job.reason}) pid=${child.pid}`)

  const collect = (chunk: Buffer) => {
    for (const line of chunk.toString('utf8').split('\n')) {
      if (!line.trim()) continue
      run.tail.push(redactText(line).slice(0, 400))
      if (run.tail.length > TAIL_LINES) run.tail.shift()
    }
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)

  let killed = false
  const timeout = jobTimeoutMs(job)
  const term = setTimeout(() => {
    killed = true
    console.warn(`${tag} passou de ${Math.round(timeout / 60000)} min — encerrando`)
    child.kill('SIGTERM')
    setTimeout(() => { if (child.exitCode === null) child.kill('SIGKILL') }, 20_000).unref()
  }, timeout)
  term.unref()

  let done = false
  const end = (code: number | null, spawnError?: Error) => {
    if (done) return
    done = true
    clearTimeout(term)
    const secs = Math.round((Date.now() - run.startedAt) / 1000)
    const outcome: FinishedJob['outcome'] = spawnError ? 'spawn-error'
      : killed ? 'killed' : code === 0 ? 'ok' : code === EXIT_LOCKED ? 'locked' : 'failed'
    if (outcome === 'ok') console.log(`${tag} ok em ${secs}s`)
    else if (outcome === 'locked') console.log(`${tag} outro processo já coleta esta loja — fica para a próxima rodada`)
    else console.error(`${tag} ${outcome} (código ${code}) em ${secs}s${spawnError ? `: ${spawnError.message}` : ''}\n  ` +
      run.tail.slice(-15).join('\n  '))
    finish(key, { job, startedAt: run.startedAt, finishedAt: Date.now(), code, outcome })
  }
  child.on('error', err => end(null, err))
  child.on('exit', code => end(code))
}

function finish(key: string, f: FinishedJob): void {
  state.running.delete(key)
  state.recent.set(key, f)
  for (const fn of state.listeners) {
    try { fn(f) } catch (err) { console.error('[sync] listener failed:', err) }
  }
  pump()
}
