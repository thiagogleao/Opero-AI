'use client'

/**
 * useInsights — the AI reading of one store over one window, from /api/ai.
 *
 *  - On mount (and whenever store, window or split change) it only asks
 *    whether a reading is already cached: GET never calls the model and does
 *    not count against the limit. The model runs only when the user clicks
 *    (AI23: the old panel spent an Opus call on every page view).
 *  - Every request belongs to one key (store + window + split). A change of
 *    key aborts what was in flight, and a response is applied only while its
 *    key is still the one on screen (checked against a ref updated at commit,
 *    so nothing lands in the frame between the new key and the abort) and it
 *    matches the store/window/split it announced (AI12: a slow answer for the
 *    previous store overwrote the current one).
 *  - State is reset per key, so an error never sticks to the next store (AI13).
 *  - A window that starts on the store's today ("Hoje") cannot be read: it is
 *    shown as such without the request the server would refuse.
 */

import { useEffect, useRef, useState } from 'react'
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect'
import type { InsightsEvent, InsightsResult, InsightsWindowInfo } from '@/lib/ai/insights/run'
import { describeAiError, type UiError } from './errors'
import {
  insightsBody, insightsQuery, insightsRequestKey, lacksClosedDay, mayLackClosedDay, resultMatches,
  type InsightsRequest, type Phase,
} from './insightsModel'
import { isAbortError, readErrorBody, readSse } from './sse'
import { loadStores } from './stores'

/** The store's timezone, or null when the list cannot be read (the server then decides). */
async function storeTimezone(storeId: string): Promise<string | null> {
  try {
    return (await loadStores()).find(s => s.id === storeId)?.timezone ?? null
  } catch {
    return null
  }
}

export type InsightsState =
  /** Asking the server whether a reading is cached. */
  | { kind: 'checking' }
  /** Nothing cached: the button to generate. */
  | { kind: 'idle'; window: InsightsWindowInfo }
  /** The window cannot be read at all (no closed day, no access…). */
  | { kind: 'unavailable'; error: UiError }
  /** The cache check failed (network, server): retry the check. */
  | { kind: 'check_failed'; error: UiError }
  | { kind: 'generating'; window: InsightsWindowInfo | null; phase: Phase; startedAt: number; previous: InsightsResult | null }
  | { kind: 'ready'; result: InsightsResult; cached: boolean }
  /** Generation failed; a previous reading of the same key stays visible below. */
  | { kind: 'failed'; window: InsightsWindowInfo | null; error: UiError; previous: InsightsResult | null }

export function useInsights({ storeId, from, to, split }: InsightsRequest) {
  const req: InsightsRequest = { storeId, from, to, split }
  const key = insightsRequestKey(req)
  const [shownKey, setShownKey] = useState(key)
  const [state, setState] = useState<InsightsState>({ kind: 'checking' })
  const [checkNonce, setCheckNonce] = useState(0)
  const genRef = useRef<AbortController | null>(null)
  // The key on screen, as of the last commit: every response checks it.
  const keyRef = useRef(key)

  // New store, window or split: start from scratch in this very render, so
  // no frame shows the previous key's reading or error.
  if (shownKey !== key) {
    setShownKey(key)
    setState({ kind: 'checking' })
  }

  // At commit (before paint, before any late response can run): record the
  // new key and abort the previous key's generation, which the server then
  // stops. Also on unmount.
  useIsomorphicLayoutEffect(() => {
    keyRef.current = key
    return () => { genRef.current?.abort() }
  }, [key])

  // Cache check for the key on screen.
  useEffect(() => {
    const ac = new AbortController()
    const req: InsightsRequest = { storeId, from, to, split }
    const myKey = insightsRequestKey(req)
    const live = () => !ac.signal.aborted && keyRef.current === myKey
    ;(async () => {
      try {
        if (mayLackClosedDay(req.from)) {
          const tz = await storeTimezone(req.storeId)
          if (!live()) return
          if (tz && lacksClosedDay(req.from, tz)) {
            setState({ kind: 'unavailable', error: describeAiError({ code: 'no_closed_days' }, 'insights') })
            return
          }
        }
        const res = await fetch(`/api/ai?${insightsQuery(req)}`, { signal: ac.signal, cache: 'no-store' })
        if (!live()) return
        if (!res.ok) {
          const b = await readErrorBody(res)
          if (!live()) return
          const error = describeAiError({ status: res.status, code: b.code, serverMessage: b.error }, 'insights')
          setState(error.retry ? { kind: 'check_failed', error } : { kind: 'unavailable', error })
          return
        }
        const j = (await res.json()) as { window: InsightsWindowInfo; cached: InsightsResult | null }
        if (!live()) return
        const cached = j.cached && resultMatches(j.cached, req, j.window) ? j.cached : null
        setState(prev => {
          // A click that started generating while the check was in flight wins.
          if (prev.kind === 'generating') return prev
          return cached ? { kind: 'ready', result: cached, cached: true } : { kind: 'idle', window: j.window }
        })
      } catch (err) {
        if (!live() || isAbortError(err)) return
        setState({ kind: 'check_failed', error: describeAiError({ code: 'network' }, 'insights') })
      }
    })()
    return () => ac.abort()
  }, [storeId, from, to, split, checkNonce])

  async function generate(refresh: boolean) {
    genRef.current?.abort()
    const ac = new AbortController()
    genRef.current = ac
    const myKey = key
    const live = () => !ac.signal.aborted && keyRef.current === myKey
    const previous = state.kind === 'ready' ? state.result : state.kind === 'failed' ? state.previous : null
    let win: InsightsWindowInfo | null = state.kind === 'idle' ? state.window : previous?.window ?? null
    // A failure trying again cannot fix (no data, no access) and nothing to
    // keep on screen: the same "unavailable" state the cache check shows,
    // instead of a red callout over no button.
    const fail = (error: UiError) => {
      if (!live()) return
      setState(!error.retry && !previous ? { kind: 'unavailable', error } : { kind: 'failed', window: win, error, previous })
    }
    setState({ kind: 'generating', window: win, phase: 'starting', startedAt: Date.now(), previous }) // clock-ok: progress timing, not a period
    let ended = false
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(insightsBody(req, refresh)),
        signal: ac.signal,
      })
      if (!res.ok || !res.body) {
        const b = await readErrorBody(res)
        const retryAfter = b.retryAfter ?? (Number(res.headers.get('Retry-After')) || null)
        fail(describeAiError({ status: res.status, code: b.code, serverMessage: b.error, retryAfter }, 'insights'))
        return
      }
      await readSse<InsightsEvent>(res.body, ev => {
        if (!live()) return
        switch (ev.type) {
          case 'start':
            // Belongs to another store or split: drop the whole stream.
            if (ev.store.id !== req.storeId || ev.split !== req.split) {
              ended = true
              fail({ code: 'mismatch', title: 'Leitura descartada', message: 'A resposta era de outra loja e foi descartada. Gere de novo.', retry: true })
              ac.abort()
              return
            }
            win = ev.window
            setState(s => (s.kind === 'generating' ? { ...s, window: ev.window } : s))
            return
          case 'status':
            setState(s => (s.kind === 'generating' ? { ...s, phase: ev.phase } : s))
            return
          case 'delta':
            return // raw JSON being written: progress only
          case 'done':
            ended = true
            if (!resultMatches(ev.result, req, win)) {
              fail({ code: 'mismatch', title: 'Leitura descartada', message: 'A resposta era de outra loja ou de outro período e foi descartada. Gere de novo.', retry: true })
              return
            }
            setState({ kind: 'ready', result: ev.result, cached: ev.cached })
            return
          case 'error':
            ended = true
            fail(describeAiError({ code: ev.code, serverMessage: ev.message }, 'insights'))
            return
        }
      }, ac.signal)
      if (!ended) fail(describeAiError({ code: 'cut' }, 'insights'))
    } catch (err) {
      if (!live() || isAbortError(err)) return
      fail(describeAiError({ code: 'network' }, 'insights'))
    } finally {
      if (genRef.current === ac) genRef.current = null
    }
  }

  /** Cancelar: stop the generation and go back to what was there before. */
  function cancel() {
    genRef.current?.abort()
    genRef.current = null
    setState(s => {
      if (s.kind !== 'generating') return s
      if (s.previous) return { kind: 'ready', result: s.previous, cached: true }
      return s.window ? { kind: 'idle', window: s.window } : { kind: 'checking' }
    })
    if (state.kind === 'generating' && !state.previous && !state.window) setCheckNonce(n => n + 1)
  }

  return {
    state,
    generate: () => void generate(false),
    regenerate: () => void generate(true),
    cancel,
    recheck: () => { setState({ kind: 'checking' }); setCheckNonce(n => n + 1) },
  }
}
