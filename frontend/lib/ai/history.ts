import { CHAT_HISTORY } from './config'

/**
 * The Copilot conversation as the browser sends it: plain text turns only.
 *
 * Tool calls, tool results and thinking never leave the server, so a client
 * cannot plant a fake tool result, and a conversation can never be left with a
 * tool_use that has no result (the old confirm flow did exactly that and
 * every later message failed with a 400). Long histories are trimmed from the
 * oldest end so a long chat keeps working instead of failing.
 */

export interface ChatTurn { role: 'user' | 'assistant'; content: string }

export type HistoryResult = { ok: true; turns: ChatTurn[] } | { ok: false; error: string }

export function parseHistory(raw: unknown, limits = CHAT_HISTORY): HistoryResult {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'Envie a pergunta em "messages".' }
  const turns: ChatTurn[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') return { ok: false, error: 'Mensagem inválida.' }
    const role = (m as { role?: unknown }).role
    const content = (m as { content?: unknown }).content
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') {
      return { ok: false, error: 'Cada mensagem precisa de role "user" ou "assistant" e content em texto.' }
    }
    const text = content.trim()
    if (!text) continue
    const last = turns[turns.length - 1]
    // Two turns in a row from the same side are one turn to the API anyway.
    if (last && last.role === role) last.content = `${last.content}\n\n${text}`
    else turns.push({ role, content: text })
  }
  const lastTurn = turns[turns.length - 1]
  if (!lastTurn || lastTurn.role !== 'user') return { ok: false, error: 'A última mensagem precisa ser a pergunta do usuário.' }
  if (lastTurn.content.length > limits.maxUserChars) {
    return { ok: false, error: `A pergunta passou de ${limits.maxUserChars} caracteres. Encurte e envie de novo.` }
  }

  // Older turns are capped, then dropped from the oldest end until the whole
  // history fits; the conversation must still start with a user turn.
  const capped = turns.map((t, i) => {
    if (i === turns.length - 1) return t
    const max = t.role === 'user' ? limits.maxUserChars : limits.maxAssistantChars
    return t.content.length > max ? { ...t, content: `${t.content.slice(0, max)}…` } : t
  })
  let out = capped.slice(-limits.maxMessages)
  const total = () => out.reduce((s, t) => s + t.content.length, 0)
  while (out.length > 1 && (total() > limits.maxTotalChars || out[0].role !== 'user')) out = out.slice(1)
  return { ok: true, turns: out }
}
