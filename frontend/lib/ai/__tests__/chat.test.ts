import Anthropic from '@anthropic-ai/sdk'
import type { BetaMessage, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenStream, StreamParams } from '../claude'
import { CHAT_MAX_MODEL_CALLS } from '../config'
import type { StoreContext } from '../context'

// The loop is tested with a scripted model and stubbed tools: no network, no DB.
const runTool = vi.fn(async (...args: unknown[]) => ({ content: JSON.stringify({ ok: args[0] }), isError: false }))
vi.mock('../tools', () => ({
  TOOLS: [{ name: 'get_profit', description: 'x', input_schema: { type: 'object', properties: {} } }],
  runTool: (name: string, input: unknown, env: unknown) => runTool(name, input, env),
  toolLabel: (name: string) => `label:${name}`,
}))

const { runChat, chatSystemPrompt } = await import('../chat')
type Ev = Parameters<Parameters<typeof runChat>[1]>[0]

const CTX: StoreContext = {
  id: 'store-1', name: 'MOKOO', domain: '6k7fjw-jt.myshopify.com', timezone: 'America/Belem', archived: false,
  currency: 'USD', configured: true, today: '2026-11-17', localTime: '15:42', weekday: 'terça-feira', notes: [],
}

interface Turn { deltas?: string[]; message?: Partial<BetaMessage>; error?: unknown }

function message(m: Partial<BetaMessage>): BetaMessage {
  return {
    id: 'msg', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content: [],
    stop_reason: 'end_turn', stop_sequence: null, container: null, context_management: null,
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    ...m,
  } as unknown as BetaMessage
}

function scripted(turns: Turn[]) {
  const calls: StreamParams[] = []
  const open: OpenStream = params => {
    calls.push(JSON.parse(JSON.stringify(params)))
    const t = turns.shift()
    if (!t) throw new Error('model called more times than scripted')
    const textCbs: ((d: string) => void)[] = []
    return {
      onText: cb => { textCbs.push(cb) },
      onBlockStart: () => {},
      finalMessage: async () => {
        for (const d of t.deltas ?? []) textCbs.forEach(cb => cb(d))
        if (t.error) throw t.error
        return message(t.message ?? {})
      },
    }
  }
  return { open, calls }
}

async function run(turns: Turn[], opts: { signal?: AbortSignal; question?: string } = {}) {
  const events: Ev[] = []
  const model = scripted(turns)
  await runChat(
    { ctx: CTX, turns: [{ role: 'user', content: opts.question ?? 'Qual foi meu lucro ontem?' }], split: false, viewerKey: 'owner' },
    e => events.push(e), opts.signal ?? new AbortController().signal, model.open,
  )
  return { events, calls: model.calls }
}

const lastRole = (msgs: BetaMessageParam[]) => msgs[msgs.length - 1].role
const done = (events: Ev[]) => events.find(e => e.type === 'done') as Extract<Ev, { type: 'done' }> | undefined

beforeEach(() => {
  runTool.mockClear()
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('runChat', () => {
  it('streams text and ends with the authoritative text', async () => {
    const { events, calls } = await run([{ deltas: ['O lucro ', 'foi $10.'], message: { content: [{ type: 'text', text: 'O lucro foi $10.', citations: null }] as never } }])
    expect(events[0]).toMatchObject({ type: 'start', store: { id: 'store-1', today: '2026-11-17' } })
    expect(events.filter(e => e.type === 'text').map(e => (e as { delta: string }).delta).join('')).toBe('O lucro foi $10.')
    expect(done(events)).toMatchObject({ stop: 'end_turn', text: 'O lucro foi $10.', notice: null })
    // Server-built system prompt with a cache point; the clock rides in the user turn.
    const sys = calls[0].system as { text: string; cache_control?: unknown }[]
    expect(sys[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(sys[0].text).toContain('MOKOO')
    expect(JSON.stringify(calls[0].messages)).toContain('15:42')
  })

  it('answers every tool_use of a turn in one user message and never sends an assistant-last request', async () => {
    const { events, calls } = await run([
      {
        deltas: ['Vou consultar.'],
        message: {
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'Vou consultar.', citations: null },
            { type: 'tool_use', id: 't1', name: 'get_profit', input: { period: 'yesterday' } },
            { type: 'tool_use', id: 't2', name: 'get_ads', input: {} },
          ] as never,
        },
      },
      { deltas: ['Foi $10.'], message: { content: [{ type: 'text', text: 'Foi $10.', citations: null }] as never } },
    ])
    expect(runTool).toHaveBeenCalledTimes(2)
    expect(calls).toHaveLength(2)
    for (const c of calls) expect(lastRole(c.messages)).toBe('user')
    const results = calls[1].messages[calls[1].messages.length - 1].content as { type: string; tool_use_id: string }[]
    expect(results.map(r => [r.type, r.tool_use_id])).toEqual([['tool_result', 't1'], ['tool_result', 't2']])
    expect(events.filter(e => e.type === 'tool').map(e => (e as { status: string }).status)).toEqual(['running', 'running', 'done', 'done'])
    expect(done(events)?.text).toBe('Vou consultar.\n\nFoi $10.')
  })

  it('does not run a tool whose input may be cut off at max_tokens', async () => {
    const { events, calls } = await run([{
      message: { stop_reason: 'max_tokens', content: [{ type: 'tool_use', id: 't1', name: 'get_profit', input: {} }] as never },
    }])
    expect(runTool).not.toHaveBeenCalled()
    expect(calls).toHaveLength(1)
    expect(done(events)).toMatchObject({ stop: 'max_tokens' })
    expect(done(events)?.notice).toMatch(/interrompida/)
  })

  it('ends the turn on pause_turn instead of resuming with an assistant-last request', async () => {
    const { events, calls } = await run([{ deltas: ['Parte.'], message: { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'Parte.', citations: null }] as never } }])
    expect(calls).toHaveLength(1)
    expect(done(events)).toMatchObject({ stop: 'end_turn', text: 'Parte.' })
  })

  it('takes back a refused partial answer and explains', async () => {
    const { events } = await run([{ deltas: ['Parcial'], message: { stop_reason: 'refusal', content: [{ type: 'text', text: 'Parcial', citations: null }] as never } }])
    expect(events.some(e => e.type === 'replace' && e.text === '')).toBe(true)
    expect(done(events)).toMatchObject({ stop: 'refusal', text: '' })
    expect(done(events)?.notice).toBeTruthy()
  })

  it('stops after the call limit instead of looping forever', async () => {
    const toolTurn: Turn = { message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'x', name: 'get_profit', input: {} }] as never } }
    const { events, calls } = await run(Array.from({ length: CHAT_MAX_MODEL_CALLS }, () => ({ ...toolTurn })))
    expect(calls).toHaveLength(CHAT_MAX_MODEL_CALLS)
    expect(done(events)).toMatchObject({ stop: 'tool_limit' })
  })

  it('re-issues a call whose tool input was unparseable JSON, taking back its text', async () => {
    const { events, calls } = await run([
      { deltas: ['abc'], error: new Anthropic.AnthropicError('Unable to parse tool parameter JSON from model. Error: x') },
      { deltas: ['Certo.'], message: { content: [{ type: 'text', text: 'Certo.', citations: null }] as never } },
    ])
    expect(calls).toHaveLength(2)
    expect(events.some(e => e.type === 'replace' && e.text === '')).toBe(true)
    expect(done(events)?.text).toBe('Certo.')
  })

  it('maps API failures to a friendly error and no done', async () => {
    const { events } = await run([{ error: new Anthropic.InternalServerError(529, undefined, 'overloaded', new Headers()) }])
    const err = events.find(e => e.type === 'error') as Extract<Ev, { type: 'error' }>
    expect(err).toMatchObject({ code: 'overloaded' })
    expect(err.message).not.toMatch(/\{/)
    expect(done(events)).toBeUndefined()
  })

  it('stays silent once the client is gone', async () => {
    const ac = new AbortController()
    ac.abort()
    const { events, calls } = await run([{ message: {} }], { signal: ac.signal })
    expect(calls).toHaveLength(0)
    expect(events.filter(e => e.type === 'done' || e.type === 'error')).toHaveLength(0)
  })

  it('after a mid-answer fallback runs only the tool calls after the boundary', async () => {
    await run([
      {
        message: {
          stop_reason: 'tool_use',
          content: [
            { type: 'thinking', thinking: '', signature: 's' },
            { type: 'tool_use', id: 'declined', name: 'get_profit', input: {} },
            { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
            { type: 'tool_use', id: 'kept', name: 'get_profit', input: {} },
          ] as never,
        },
      },
      { message: { content: [{ type: 'text', text: 'ok', citations: null }] as never } },
    ])
    expect(runTool).toHaveBeenCalledTimes(1)
  })
})

describe('chatSystemPrompt', () => {
  it('adds the partner line only with the split, and never claims write powers', () => {
    expect(chatSystemPrompt(CTX, false)).not.toContain('sua parte (50%)')
    expect(chatSystemPrompt(CTX, true)).toContain('sua parte (50%)')
    expect(chatSystemPrompt(CTX, false)).toContain('só lê dados')
  })
  it('carries the store notes and the unconfigured warning', () => {
    const p = chatSystemPrompt({ ...CTX, configured: false, notes: ['Nota X'] }, false)
    expect(p).toContain('Nota X')
    expect(p).toContain('receita − anúncios')
  })
})
