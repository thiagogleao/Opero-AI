'use client'

/**
 * useCopilotChat — the Copilot conversation: one store, plain-text history,
 * streamed answers from POST /api/agent.
 *
 * Scope: a conversation belongs to one store and one split setting (AI21: the
 * old chat kept MOKOO's answers and sent them with Glooty's prompt).
 *  - Each page draws its own shell, so changing the store (or the 50% view)
 *    remounts the Copilot. The conversation is kept in sessionStorage and
 *    read back on mount only when it is about the same store and split;
 *    otherwise it is dropped and `reset` says so.
 *  - When the scope changes without a remount (the store chosen in the drawer
 *    on "Todas"), the request in flight is aborted and the conversation is
 *    cleared in the same render. Late events of an aborted answer cannot land
 *    in the new conversation: every update targets its turn by id, and a
 *    cleared turn no longer exists.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ChatEvent } from '@/lib/ai/chat'
import {
  applyChatEvent, historyFor, isOpen, parseSaved, STORAGE_KEY, toSaved,
  type AssistantTurn, type Turn,
} from './chatModel'
import { describeAiError } from './errors'
import { isAbortError, readErrorBody, readSse } from './sse'

export interface ChatReset {
  /** store: the store changed · split: the 50% view was switched. */
  kind: 'store' | 'split'
  /** The store the cleared conversation was about: its id (the drawer names
   *  it from the store list) and the name the server announced, if any (an
   *  answer stopped before the server's `start` has none). */
  fromId: string | null
  fromName: string | null
}

interface Initial { chosen: string | null; turns: Turn[]; storeName: string | null; reset: ChatReset | null }

const EMPTY: Initial = { chosen: null, turns: [], storeName: null, reset: null }

/** The saved conversation, if it is about the store and split on screen. On
 *  "Todas" (no page store) the saved store is chosen again. Runs once per
 *  mount; on the server there is no storage and nothing is restored (the
 *  conversation is never part of the server HTML, so hydration agrees). */
function initial(pageStoreId: string | null, split: boolean): Initial {
  if (typeof window === 'undefined') return EMPTY
  let saved = null
  try { saved = parseSaved(window.sessionStorage.getItem(STORAGE_KEY)) } catch { return EMPTY }
  if (!saved || saved.turns.length === 0) return EMPTY
  const target = pageStoreId ?? saved.storeId
  if (saved.storeId !== target) return { ...EMPTY, reset: { kind: 'store', fromId: saved.storeId, fromName: saved.storeName } }
  const chosen = pageStoreId === null ? saved.storeId : null
  if (saved.split !== split) return { ...EMPTY, chosen, reset: { kind: 'split', fromId: saved.storeId, fromName: saved.storeName } }
  return { chosen, turns: saved.turns, storeName: saved.storeName, reset: null }
}

interface Scope { storeId: string | null; split: boolean }

export function useCopilotChat(pageStoreId: string | null, split: boolean) {
  const [init] = useState(() => initial(pageStoreId, split))
  // On "Todas" the page has no store: the drawer asks which one.
  const [chosen, setChosen] = useState<string | null>(init.chosen)
  const storeId = pageStoreId ?? chosen

  const [turns, setTurns] = useState<Turn[]>(init.turns)
  const [storeName, setStoreName] = useState<string | null>(init.storeName)
  const [reset, setReset] = useState<ChatReset | null>(init.reset)
  const [scope, setScope] = useState<Scope>({ storeId, split })
  const abortRef = useRef<AbortController | null>(null)
  const savedCount = useRef(-1)
  const seq = useRef(0)

  // The scope changed under a mounted conversation: clear it in this render,
  // so no frame shows one store's answers under another store's name.
  if (scope.storeId !== storeId || scope.split !== split) {
    setScope({ storeId, split })
    if (turns.length > 0) {
      setTurns([])
      setReset({ kind: scope.storeId !== storeId ? 'store' : 'split', fromId: scope.storeId, fromName: storeName })
    }
    setStoreName(null)
  }

  // …and stop paying for the answer nobody will read (also on unmount). At
  // commit, not after paint: a frame of the old stream (the `start` with the
  // old store's name) must not land after the conversation was cleared.
  useLayoutEffect(() => {
    const ref = abortRef
    return () => { ref.current?.abort() }
  }, [storeId, split])

  // Keep the conversation for the next page. While an answer streams, write
  // only when a turn is added (not on every token): if the page changes
  // mid-answer, the question survives and the answer is marked as cut.
  useEffect(() => {
    const streaming = turns.some(isOpen)
    if (streaming && savedCount.current === turns.length) return
    savedCount.current = turns.length
    try {
      if (!storeId || turns.length === 0) window.sessionStorage.removeItem(STORAGE_KEY)
      else window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(toSaved(storeId, storeName, split, turns)))
    } catch {
      // Private mode or a full quota: the chat works, it just won't survive a page change.
    }
  }, [turns, storeId, storeName, split])

  const update = (id: string, fn: (t: AssistantTurn) => AssistantTurn) =>
    setTurns(prev => prev.map(t => (t.id === id && t.role === 'assistant' ? fn(t) : t)))

  async function send(question: string, base: Turn[] = turns) {
    const q = question.trim()
    if (!q || !storeId || base.some(isOpen)) return
    const n = ++seq.current
    const stamp = `${Date.now()}-${n}`
    const answerId = `a${stamp}`
    const history = historyFor(base, q)
    setTurns([
      ...base,
      { id: `u${stamp}`, role: 'user', text: q },
      { id: answerId, role: 'assistant', text: '', tools: [], status: 'waiting', notice: null, error: null },
    ])
    setReset(null)

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    let ended = false
    let wrongStore = false
    try {
      const res = await fetch('/api/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId, messages: history, split }),
        signal: ac.signal,
      })
      if (!res.ok || !res.body) {
        const b = await readErrorBody(res)
        const retryAfter = b.retryAfter ?? (Number(res.headers.get('Retry-After')) || null)
        update(answerId, t => ({
          ...t, status: 'error',
          error: describeAiError({ status: res.status, code: b.code, serverMessage: b.error, retryAfter }, 'chat'),
        }))
        return
      }
      await readSse<ChatEvent>(res.body, ev => {
        if (ev.type === 'start') {
          // The server answers for the store we asked about; anything else is dropped.
          if (ev.store.id !== storeId) { wrongStore = true; ac.abort(); return }
          setStoreName(ev.store.name)
        }
        if (ev.type === 'done' || ev.type === 'error') ended = true
        update(answerId, t => applyChatEvent(t, ev))
      }, ac.signal)
      if (!ended) {
        update(answerId, t => ({ ...t, status: 'error', error: describeAiError({ code: 'cut' }, 'chat') }))
      }
    } catch (err) {
      if (wrongStore) {
        update(answerId, t => ({
          ...t, status: 'error', text: '',
          error: { code: 'wrong_store', title: 'Resposta descartada', message: 'A resposta veio de outra loja e foi descartada. Pergunte de novo.', retry: true },
        }))
      } else if (isAbortError(err) || ac.signal.aborted) {
        update(answerId, t => (isOpen(t) ? { ...t, status: 'stopped' } : t))
      } else {
        update(answerId, t => ({ ...t, status: 'error', error: describeAiError({ code: 'network' }, 'chat') }))
      }
    } finally {
      if (abortRef.current === ac) abortRef.current = null
    }
  }

  /** Parar: abort the request; the partial answer stays on screen, marked as stopped. */
  function stop() {
    abortRef.current?.abort()
  }

  /** Ask a failed question again (the failed pair is replaced). */
  function retry(answerId: string) {
    const i = turns.findIndex(t => t.id === answerId)
    const q = turns[i - 1]
    if (i < 1 || q.role !== 'user') return
    void send(q.text, turns.filter((_, k) => k !== i && k !== i - 1))
  }

  function clear() {
    abortRef.current?.abort()
    setTurns([])
    setReset(null)
    setStoreName(null)
  }

  /** On "Todas": the store chosen in the drawer. An answer still coming is
   *  about the previous store: stop it now. */
  function choose(id: string) {
    if (id === chosen) return
    abortRef.current?.abort()
    setChosen(id)
  }

  return {
    storeId, chosen, choose, storeName,
    turns, busy: turns.some(isOpen), reset, dismissReset: () => setReset(null),
    send, stop, retry, clear,
  }
}

export type CopilotChat = ReturnType<typeof useCopilotChat>
