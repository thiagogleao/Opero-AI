/**
 * The Copilot conversation as the screen holds it, and the pure rules over it:
 * how a stream event changes the answer being written, which turns go back to
 * the server as history, and what survives a page change in sessionStorage.
 * No React here, so every rule is unit-tested.
 */

import type { ChatEvent } from '@/lib/ai/chat'
import { describeAiError, type UiError } from './errors'

export interface ToolActivity {
  id: string
  /** "Lucro · 16 nov", from the server. */
  label: string
  status: 'running' | 'done' | 'error'
}

export interface UserTurn { id: string; role: 'user'; text: string }

export interface AssistantTurn {
  id: string
  role: 'assistant'
  text: string
  tools: ToolActivity[]
  /** waiting: request sent, nothing back yet · streaming: the server started
   *  answering · done / stopped (the user pressed Parar) / error. */
  status: 'waiting' | 'streaming' | 'done' | 'stopped' | 'error'
  /** The server's note on an incomplete answer (cut by length, refused…). */
  notice: string | null
  error: UiError | null
}

export type Turn = UserTurn | AssistantTurn

export interface ChatMessage { role: 'user' | 'assistant'; content: string }

export const MAX_QUESTION_CHARS = 2_000

/** The history to send with a new question: only complete exchanges (a
 *  question and the answer that finished). A failed or stopped exchange is
 *  left out with its question, so a broken turn can never poison the next
 *  request — the old chat kept resending a dangling tool call and every later
 *  message failed. */
export function historyFor(turns: Turn[], question: string): ChatMessage[] {
  const out: ChatMessage[] = []
  for (let i = 0; i < turns.length - 1; i++) {
    const q = turns[i]
    const a = turns[i + 1]
    if (q.role === 'user' && a.role === 'assistant' && a.status === 'done' && a.text.trim()) {
      out.push({ role: 'user', content: q.text }, { role: 'assistant', content: a.text })
      i++
    }
  }
  out.push({ role: 'user', content: question })
  return out
}

/** One stream event applied to the answer being written. */
export function applyChatEvent(turn: AssistantTurn, ev: ChatEvent): AssistantTurn {
  switch (ev.type) {
    case 'start':
      return { ...turn, status: 'streaming' }
    case 'text':
      return { ...turn, status: 'streaming', text: turn.text + ev.delta }
    case 'replace':
      return { ...turn, text: ev.text }
    case 'tool': {
      const at = turn.tools.findIndex(t => t.id === ev.id)
      const next: ToolActivity = { id: ev.id, label: ev.label, status: ev.status }
      const tools = at < 0 ? [...turn.tools, next] : turn.tools.map((t, i) => (i === at ? next : t))
      return { ...turn, status: 'streaming', tools }
    }
    case 'done':
      return {
        ...turn, status: 'done', text: ev.text, notice: ev.notice,
        // A tool still marked running when the turn ended did finish server-side.
        tools: turn.tools.map(t => (t.status === 'running' ? { ...t, status: 'done' } : t)),
      }
    case 'error':
      return {
        ...turn,
        status: 'error',
        error: describeAiError({ code: ev.code, serverMessage: ev.message }, 'chat'),
        tools: turn.tools.map(t => (t.status === 'running' ? { ...t, status: 'error' } : t)),
      }
  }
}

export function isOpen(turn: Turn): boolean {
  return turn.role === 'assistant' && (turn.status === 'waiting' || turn.status === 'streaming')
}

// ─── Kept across page changes (sessionStorage) ────────────────────────────────

export const STORAGE_KEY = 'opero.copilot.v1'
const MAX_SAVED_TURNS = 40

export interface SavedConversation {
  v: 1
  storeId: string
  storeName: string | null
  split: boolean
  turns: Turn[]
}

export const CUT_BY_NAVIGATION = 'A resposta foi interrompida quando a página mudou. Pergunte de novo se precisar.'

/** What is kept when the page changes. An answer still being written has its
 *  request aborted by the page change, so it is kept as stopped, with what
 *  had arrived and a note saying why — never silently dropped. */
export function toSaved(storeId: string, storeName: string | null, split: boolean, turns: Turn[]): SavedConversation {
  const kept = turns.map((t): Turn => (isOpen(t) && t.role === 'assistant'
    ? {
        ...t, status: 'stopped', notice: CUT_BY_NAVIGATION,
        tools: t.tools.map(x => (x.status === 'running' ? { ...x, status: 'error' } : x)),
      }
    : t))
  // Never start the saved list in the middle of an exchange.
  let tail = kept.slice(-MAX_SAVED_TURNS)
  if (tail[0]?.role === 'assistant') tail = tail.slice(1)
  return { v: 1, storeId, storeName, split, turns: tail }
}

const isStr = (v: unknown): v is string => typeof v === 'string'

function parseTurn(raw: unknown): Turn | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!isStr(r.id) || !isStr(r.text)) return null
  if (r.role === 'user') return { id: r.id, role: 'user', text: r.text }
  if (r.role !== 'assistant') return null
  const status = r.status === 'done' || r.status === 'stopped' || r.status === 'error' ? r.status : null
  if (!status) return null
  const tools = Array.isArray(r.tools)
    ? r.tools.flatMap((t): ToolActivity[] => {
        if (!t || typeof t !== 'object') return []
        const o = t as Record<string, unknown>
        const st = o.status === 'done' || o.status === 'error' ? o.status : 'done'
        return isStr(o.id) && isStr(o.label) ? [{ id: o.id, label: o.label, status: st }] : []
      })
    : []
  const e = r.error as Record<string, unknown> | null | undefined
  const error: UiError | null = e && isStr(e.code) && isStr(e.title) && isStr(e.message)
    ? { code: e.code, title: e.title, message: e.message, retry: e.retry === true }
    : null
  return { id: r.id, role: 'assistant', text: r.text, tools, status, notice: isStr(r.notice) ? r.notice : null, error }
}

/** A saved conversation, or null when the value is missing or not ours. */
export function parseSaved(raw: string | null): SavedConversation | null {
  if (!raw) return null
  let v: unknown
  try { v = JSON.parse(raw) } catch { return null }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (o.v !== 1 || !isStr(o.storeId) || !Array.isArray(o.turns)) return null
  const turns = o.turns.map(parseTurn)
  if (turns.some(t => t === null)) return null
  return {
    v: 1, storeId: o.storeId, storeName: isStr(o.storeName) ? o.storeName : null,
    split: o.split === true, turns: turns as Turn[],
  }
}
