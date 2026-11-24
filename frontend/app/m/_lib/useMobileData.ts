'use client'

/**
 * Fetching for the phone: the home payload (GET /api/mobile), a detail tab
 * (GET /api/mobile/detail) and the "Atualizar" progress.
 *
 * Rules, each from a bug that made the store "jump back":
 *  - every request has an AbortController; a new selection aborts the old one;
 *  - an answer is applied only if the selection it was asked for is still the
 *    one on screen AND its echoed `request` matches it;
 *  - one request in flight at a time: a poll never stacks on a slow answer;
 *  - polling every 45 s only while the page is visible (never for an archived
 *    store, which is not synced);
 *  - callbacks read the selection from a ref, never from a stale closure (the
 *    old "Atualizar" re-applied the store of the moment it was tapped for 70 s).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { MobileResponse } from '@/lib/views/mobile'
import type { DetailSection, MobileDetailResponse } from '@/lib/views/mobileDetail'
import type { RefreshResponse, RefreshStatusResponse } from '@/lib/views/refresh'
import { apiQuery, echoMatches, selectionKey, type Selection } from './selection'
import { afterFailedStatus, STATUS_GIVE_UP_MS } from './refreshProgress'

export const POLL_MS = 45_000

export type LoadErrorKind = 'session' | 'store' | 'bad' | 'server' | 'network'
export interface LoadError { kind: LoadErrorKind; message: string; at: number }

/** Turn a failed response into something the screen can say. The auth guard
 *  answers a plain-text 404 ("Not found"); a JSON 404 is an unknown store. */
async function errorOf(res: Response): Promise<LoadError> {
  const at = Date.now()
  const body = await res.json().catch(() => null) as { error?: unknown } | null
  const msg = typeof body?.error === 'string' ? body.error : null
  if (res.status === 404 && !msg) return { kind: 'session', message: 'Sessão expirada neste aparelho', at }
  if (res.status === 404) return { kind: 'store', message: msg ?? 'Loja não encontrada', at }
  if (res.status === 400) return { kind: 'bad', message: msg ?? 'Pedido inválido', at }
  return { kind: 'server', message: msg ?? `Erro ${res.status}`, at }
}

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError'

// ─── Home payload ─────────────────────────────────────────────────────────────

export interface HomeState {
  data: MobileResponse | null
  /** selectionKey() the data answers. */
  dataKey: string | null
  /** When the data arrived (ms epoch). */
  fetchedAt: number | null
  error: LoadError | null
  /** selectionKey() the error belongs to. */
  errorKey: string | null
}

export type LoadReason = 'select' | 'poll' | 'manual'

export function useMobileData(sel: Selection | null, opts: {
  /** False: fetch on a new selection or on demand only, never on a timer (an
   *  archived store is not synced: nothing new can arrive). */
  poll?: boolean
} = {}) {
  const poll = opts.poll ?? true
  const [state, setState] = useState<HomeState>({ data: null, dataKey: null, fetchedAt: null, error: null, errorKey: null })
  const [loadingKey, setLoadingKey] = useState<string | null>(null)
  const selRef = useRef<Selection | null>(sel)
  const inflight = useRef<{ key: string; ctrl: AbortController } | null>(null)
  const lastStart = useRef(0)

  useEffect(() => { selRef.current = sel }, [sel])

  const load = useCallback((reason: LoadReason) => {
    const s = selRef.current
    if (!s) return
    const key = selectionKey(s)
    if (inflight.current) {
      // A poll never stacks on the request already running for this view.
      if (inflight.current.key === key && reason === 'poll') return
      inflight.current.ctrl.abort()
    }
    const ctrl = new AbortController()
    inflight.current = { key, ctrl }
    lastStart.current = Date.now()
    setLoadingKey(key)
    const stillWanted = () => !ctrl.signal.aborted && !!selRef.current && selectionKey(selRef.current) === key

    fetch(`/api/mobile?${apiQuery(s)}`, { signal: ctrl.signal, cache: 'no-store', credentials: 'same-origin' })
      .then(async res => {
        if (!res.ok) {
          const error = await errorOf(res)
          if (stillWanted()) setState(prev => ({ ...prev, error, errorKey: key }))
          return
        }
        const body = await res.json() as MobileResponse
        // Dropped unless it answers exactly what is on screen now.
        if (!stillWanted() || !echoMatches(body.request, selRef.current!)) return
        setState({ data: body, dataKey: key, fetchedAt: Date.now(), error: null, errorKey: null })
      })
      .catch(err => {
        if (isAbort(err) || !stillWanted()) return
        setState(prev => ({ ...prev, error: { kind: 'network', message: 'Sem conexão com o servidor', at: Date.now() }, errorKey: key }))
      })
      .finally(() => {
        if (inflight.current?.ctrl === ctrl) {
          inflight.current = null
          setLoadingKey(null)
        }
      })
  }, [])

  const key = sel ? selectionKey(sel) : null

  // A new selection: fetch at once (aborting whatever was running).
  useEffect(() => {
    if (key) load('select')
  }, [key, load])

  // Poll every 45 s while visible; catch up when the app comes back.
  useEffect(() => {
    if (!poll) return
    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer === null) timer = setInterval(() => { if (document.visibilityState === 'visible') load('poll') }, POLL_MS)
    }
    const stop = () => { if (timer !== null) { clearInterval(timer); timer = null } }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - lastStart.current >= POLL_MS) load('poll')
        start()
      } else stop()
    }
    const onOnline = () => load('poll')
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('online', onOnline)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('online', onOnline)
    }
  }, [load, poll])

  useEffect(() => () => inflight.current?.ctrl.abort(), [])

  return { ...state, loadingKey, load }
}

// ─── Detail tab ───────────────────────────────────────────────────────────────

export interface DetailState {
  data: MobileDetailResponse | null
  /** `${section}|${selectionKey}` the data answers. */
  dataKey: string | null
  fetchedAt: number | null
  error: LoadError | null
  errorKey: string | null
  loadingKey: string | null
}

/** A tab older than this is fetched again on the next home poll. */
export const DETAIL_STALE_MS = 5 * 60_000

export function useDetail(
  section: DetailSection | null, sel: Selection | null,
  /** Bumped when an "Atualizar" finishes: refetch whatever is open. */
  forceSignal: number,
  /** Bumped on every home answer: refetch only when the tab is stale. */
  pollSignal: number,
  /** The window of the home answer on screen ("from|to"). When the day turns,
   *  "Hoje" moves to a new date: a tab still on the old date is refetched at
   *  once instead of waiting out DETAIL_STALE_MS. */
  homeRange: string | null = null,
) {
  const [state, setState] = useState<DetailState>({ data: null, dataKey: null, fetchedAt: null, error: null, errorKey: null, loadingKey: null })
  const [retry, setRetry] = useState(0)
  const wantRef = useRef<string | null>(null)
  const ctrlRef = useRef<AbortController | null>(null)
  const inflightKey = useRef<string | null>(null)
  const fetchedRef = useRef<{ key: string; at: number; range: string } | null>(null)
  const lastForce = useRef({ force: forceSignal, retry })

  const key = section && sel ? `${section}|${selectionKey(sel)}` : null

  useEffect(() => { wantRef.current = key }, [key])

  useEffect(() => {
    const forced = lastForce.current.force !== forceSignal || lastForce.current.retry !== retry
    lastForce.current = { force: forceSignal, retry }
    if (!key || !section || !sel) {
      ctrlRef.current?.abort()
      return
    }
    if (!forced) {
      // Already on its way, or fresh enough: a home poll alone does not refetch.
      if (inflightKey.current === key) return
      const prev = fetchedRef.current
      const sameWindow = !homeRange || prev?.range === homeRange
      if (prev && prev.key === key && sameWindow && Date.now() - prev.at < DETAIL_STALE_MS) return
    }
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    inflightKey.current = key
    const wanted = () => !ctrl.signal.aborted && wantRef.current === key
    const settle = (patch: Partial<DetailState>) => {
      if (ctrlRef.current === ctrl) { ctrlRef.current = null; inflightKey.current = null }
      setState(p => ({ ...p, ...patch, loadingKey: p.loadingKey === key ? null : p.loadingKey }))
    }
    setState(p => ({ ...p, loadingKey: key }))
    fetch(`/api/mobile/detail?section=${section}&${apiQuery(sel)}`, { signal: ctrl.signal, cache: 'no-store', credentials: 'same-origin' })
      .then(async res => {
        if (!res.ok) {
          const error = await errorOf(res)
          settle(wanted() ? { error, errorKey: key } : {})
          return
        }
        const body = await res.json() as MobileDetailResponse
        if (!wanted() || body.request.section !== section || !echoMatches(body.request, sel)) { settle({}); return }
        fetchedRef.current = { key, at: Date.now(), range: `${body.range.from}|${body.range.to}` }
        settle({ data: body, dataKey: key, fetchedAt: Date.now(), error: null, errorKey: null })
      })
      .catch(err => {
        if (isAbort(err)) { if (ctrlRef.current === ctrl) settle({}); return }
        settle(wanted() ? { error: { kind: 'network', message: 'Sem conexão com o servidor', at: Date.now() }, errorKey: key } : {})
      })
    // `sel` and `section` are represented by `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, forceSignal, pollSignal, retry, homeRange])

  useEffect(() => () => ctrlRef.current?.abort(), [])

  const reload = useCallback(() => setRetry(r => r + 1), [])
  return { ...state, key, reload }
}

// ─── Atualizar ────────────────────────────────────────────────────────────────

export interface RefreshRun {
  phase: 'idle' | 'starting' | 'running' | 'done' | 'error'
  stores: { id: string; name: string }[]
  launched: RefreshResponse['launched']
  skipped: RefreshResponse['skipped']
  status: RefreshStatusResponse | null
  message: string | null
  startedAt: number | null
  /** The phone stopped watching after this many minutes with runs unfinished
   *  (null: it watched to the end). */
  gaveUpAfterMin: number | null
  /** False when another tap cannot help (the server does not sync at all). */
  retryable: boolean
  /** The error came while watching (the runs were launched and may still
   *  finish): the strip says it stopped following, not that nothing happened. */
  lostTrack: boolean
}

const STATUS_POLL_MS = 4_000
export { STATUS_GIVE_UP_MS }
const IDLE_RUN: RefreshRun = { phase: 'idle', stores: [], launched: [], skipped: [], status: null, message: null, startedAt: null, gaveUpAfterMin: null, retryable: true, lostTrack: false }

export function useRefresh(onFinished: () => void) {
  const [run, setRun] = useState<RefreshRun>(IDLE_RUN)
  const doneRef = useRef(onFinished)
  const ctrlRef = useRef<AbortController | null>(null)

  useEffect(() => { doneRef.current = onFinished }, [onFinished])
  useEffect(() => () => ctrlRef.current?.abort(), [])

  const start = useCallback(async (storeIds: string[]) => {
    if (!storeIds.length) return
    ctrlRef.current?.abort()
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    const startedAt = Date.now()
    setRun({ ...IDLE_RUN, phase: 'starting', startedAt })
    try {
      const res = await fetch('/api/mobile/refresh', {
        method: 'POST', signal: ctrl.signal, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stores: storeIds }),
      })
      if (!res.ok) {
        const e = await errorOf(res)
        // 503: this server does not run collectors; tapping again changes nothing.
        setRun(r => ({ ...r, phase: 'error', message: e.message, retryable: res.status !== 503 }))
        return
      }
      const plan = await res.json() as RefreshResponse
      if (!plan.launched.length) {
        setRun(r => ({ ...r, phase: 'done', stores: plan.stores, skipped: plan.skipped, message: 'Nada para buscar agora' }))
        doneRef.current()
        return
      }
      setRun(r => ({ ...r, phase: 'running', stores: plan.stores, launched: plan.launched, skipped: plan.skipped }))
      const ids = plan.stores.map(s => s.id).join(',')
      const gaveUpAfterMin = Math.round(STATUS_GIVE_UP_MS / 60_000)
      let failures = 0
      // Whether a launched run had finished at the last good read: a give-up
      // after failed reads reloads the numbers only then, like the timeout.
      let someFinished = false
      while (!ctrl.signal.aborted) {
        await new Promise(r => setTimeout(r, STATUS_POLL_MS))
        if (ctrl.signal.aborted) return
        const st = await fetch(`/api/mobile/refresh?store=${encodeURIComponent(ids)}&since=${encodeURIComponent(plan.requestedAt)}`, {
          signal: ctrl.signal, cache: 'no-store', credentials: 'same-origin',
        })
        if (!st.ok) {
          // A failed read is still judged against the clock (afterFailedStatus):
          // `continue` here spun forever with "Atualizar" disabled.
          failures += 1
          const e = await errorOf(st)
          const step = afterFailedStatus(e.kind === 'network' ? 'server' : e.kind, e.message, failures, Date.now() - startedAt)
          if (step.do === 'wait') continue
          if (step.do === 'giveUp') {
            setRun(r => ({ ...r, phase: 'done', gaveUpAfterMin }))
            if (someFinished) doneRef.current()
            return
          }
          setRun(r => ({ ...r, phase: 'error', message: step.message, retryable: step.retryable, lostTrack: true }))
          return
        }
        failures = 0
        const status = await st.json() as RefreshStatusResponse
        const launchedKeys = new Set(plan.launched.map(l => `${l.storeId}:${l.source}`))
        const mine = status.runs.filter(r => launchedKeys.has(`${r.storeId}:${r.source}`))
        const finished = mine.length === launchedKeys.size && mine.every(r => r.status !== null && r.status !== 'running')
        someFinished = mine.some(r => r.status !== null && r.status !== 'running')
        setRun(r => ({ ...r, status }))
        if (finished) {
          setRun(r => ({ ...r, phase: 'done', status }))
          doneRef.current()
          return
        }
        if (Date.now() - startedAt > STATUS_GIVE_UP_MS) {
          // Say how far the runs got (refreshOutcome); reload the numbers only
          // if something actually finished.
          setRun(r => ({ ...r, phase: 'done', status, gaveUpAfterMin }))
          if (someFinished) doneRef.current()
          return
        }
      }
    } catch (err) {
      if (isAbort(err)) return
      setRun(r => ({ ...r, phase: 'error', message: 'Sem conexão com o servidor', lostTrack: r.phase === 'running' }))
    }
  }, [])

  const dismiss = useCallback(() => setRun(r => (r.phase === 'running' || r.phase === 'starting' ? r : { ...r, phase: 'idle' })), [])
  return { run, start, dismiss }
}

// ─── Clock ────────────────────────────────────────────────────────────────────

/** "Now" for relative times, refreshed every 30 s (render stays pure). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(0)
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const first = setTimeout(tick, 0)
    const t = setInterval(tick, intervalMs)
    return () => { clearTimeout(first); clearInterval(t) }
  }, [intervalMs])
  return now
}
