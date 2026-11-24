import type { BetaMessage } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { describe, expect, it, vi } from 'vitest'
import type { OpenStream, StreamParams } from '../claude'
import type { StoreContext } from '../context'
import { sseResponse } from '../sse'
import { resolveToolName, runTool, toolLabel, TOOLS } from '../tools'

vi.mock('../insights/facts', () => ({
  factSheetText: () => '- Receita: $1,000.00 · 10 pedidos\n- Lucro operacional: $120.00',
  // The sheet above has sales: the empty-sheet refusal is tested in insights.test.ts.
  nothingToRead: () => false,
}))
const { generateInsights, InsightsFailure, insightsRequest } = await import('../insights/run')

const CTX: StoreContext = {
  id: 's', name: 'MOKOO', domain: null, timezone: 'America/Belem', archived: false, currency: 'USD',
  configured: true, today: '2026-11-17', localTime: '10:00', weekday: 'terça-feira', notes: [],
}
const NOW = new Date('2026-11-17T13:00:00Z')

describe('Copilot tools', () => {
  it('are read-only: no write tool survives', () => {
    const names = TOOLS.map(t => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const banned of ['create_product', 'update_product', 'update_inventory', 'create_page', 'update_page', 'query_analytics']) {
      expect(names).not.toContain(banned)
    }
    expect(names).toContain('get_profit')
    for (const t of TOOLS) expect(t.eager_input_streaming).toBe(true)
  })
  it('accepts a name that differs only in case, and refuses unknown names without touching data', async () => {
    expect(resolveToolName('GET_PROFIT')).toBe('get_profit')
    expect(resolveToolName('drop_tables')).toBeNull()
    const env = { ctx: CTX, split: false, lastUserText: '', signal: new AbortController().signal, now: NOW }
    const unknown = await runTool('create_product', { title: 'x' }, env)
    expect(unknown.isError).toBe(true)
    expect(JSON.parse(unknown.content).error).toContain('get_profit')
    expect((await runTool('get_profit', 'not an object', env)).isError).toBe(true)
  })
  it('refuses Object.prototype member names (model output), in the run and in the chip', async () => {
    const env = { ctx: CTX, split: false, lastUserText: '', signal: new AbortController().signal, now: NOW }
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
      expect(resolveToolName(name)).toBeNull()
      const out = await runTool(name, { a: 1 }, env)
      expect(out.isError).toBe(true)
      expect(JSON.parse(out.content).error).toContain('não existe')
      expect(toolLabel(name, {}, CTX, NOW)).toBe(name)
    }
  })
  it('labels the chip with the resolved store-calendar window', () => {
    expect(toolLabel('get_profit', { period: 'yesterday' }, CTX, NOW)).toBe('Lucro · 16 nov')
    expect(toolLabel('get_order', { order_number: 1234 }, CTX, NOW)).toBe('Pedido #1234')
  })
})

describe('sseResponse', () => {
  it('frames events as data lines and closes', async () => {
    const res = sseResponse<{ type: string }>(new Request('http://x'), async send => { send({ type: 'a' }); send({ type: 'b' }) })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    expect(await res.text()).toBe('data: {"type":"a"}\n\ndata: {"type":"b"}\n\n')
  })
  it('aborts the work when the client cancels', async () => {
    let seen: AbortSignal | null = null
    let release!: () => void
    const res = sseResponse(new Request('http://x'), async (_send, signal) => {
      seen = signal
      await new Promise<void>(r => { release = r; signal.addEventListener('abort', () => r()) })
    })
    const reader = res.body!.getReader()
    await new Promise(r => setTimeout(r, 0))
    await reader.cancel()
    expect((seen as AbortSignal | null)?.aborted).toBe(true)
    release?.()
  })
})

describe('generateInsights', () => {
  const facts = {
    ctx: CTX, split: true, configured: true,
    window: { from: '2026-10-18', to: '2026-11-16', days: 30, label: '18 out – 16 nov', cutAtYesterday: false, shortened: false },
    totals: { revenue: 1000, orders: 10, operatingProfit: 120, margin: 12, metaSpend: 300, shopSpend: 0, roas: 3.33, metaRoas: 2, breakEvenRoas: 1.5 },
    partnerShare: { share: 0.5, operatingProfit: 60, profitPerOrder: 6, cashResult: 60, refunds: 0 },
  } as never

  function model(msg: Partial<BetaMessage>, deltas: string[] = []) {
    const calls: StreamParams[] = []
    const open: OpenStream = params => {
      calls.push(params)
      const cbs: ((d: string) => void)[] = []
      return {
        onText: cb => { cbs.push(cb) },
        onBlockStart: () => {},
        finalMessage: async () => {
          deltas.forEach(d => cbs.forEach(cb => cb(d)))
          return {
            id: 'm', type: 'message', role: 'assistant', model: 'claude-opus-5-5', stop_reason: 'end_turn', stop_sequence: null,
            content: [], usage: { input_tokens: 1, output_tokens: 1 }, ...msg,
          } as unknown as BetaMessage
        },
      }
    }
    return { open, calls }
  }
  const opts = { viewerKey: 'owner', ttlMs: 1000, now: NOW }
  const quiet = () => { vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}) }

  it('sends only the server-built sheet and asks for structured JSON', () => {
    const { params } = insightsRequest(facts)
    expect(params.model).toBe('claude-opus-5-5')
    expect(params.output_config.format.type).toBe('json_schema')
    expect(params.messages).toHaveLength(1)
    expect(params.messages[0].role).toBe('user')
    expect(params.system).toContain('sua parte (50%)')
  })

  it('returns verified cards with the engine headline', async () => {
    quiet()
    const json = JSON.stringify({
      summary: 'Lucro de $120.00; sua parte (50%) $60.00.',
      insights: [{
        kind: 'diagnostico', title: 'Lucro positivo', detail: 'Receita $1,000.00.', action: null, confidence: 'media',
        sample: '10 pedidos', evidence: [{ label: 'Receita', value: '$1,000.00' }, { label: 'x', value: '$7.77' }],
        target: { type: 'loja', id: null, name: null },
      }],
      dataGaps: [],
    })
    const sent: unknown[] = []
    const m = model({ content: [{ type: 'text', text: json, citations: null }] as never }, [json])
    const r = await generateInsights(facts, e => sent.push(e), new AbortController().signal, m.open, opts)
    expect(r.headline).toMatchObject({ revenue: 1000, operatingProfit: 120, partnerProfit: 60 })
    expect(r.insights[0].evidence.map(e => e.verified)).toEqual([true, false])
    expect(r.expiresAt).toBe(new Date(NOW.getTime() + 1000).toISOString())
    expect(sent.some(e => (e as { type: string }).type === 'delta')).toBe(true)
  })

  it('never returns (or caches) a refused or cut-off analysis', async () => {
    quiet()
    const signal = new AbortController().signal
    await expect(generateInsights(facts, () => {}, signal, model({ stop_reason: 'refusal' }).open, opts))
      .rejects.toMatchObject({ code: 'refused' })
    await expect(generateInsights(facts, () => {}, signal, model({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"summ', citations: null }] as never }).open, opts))
      .rejects.toBeInstanceOf(InsightsFailure)
    await expect(generateInsights(facts, () => {}, signal, model({ content: [{ type: 'text', text: 'not json', citations: null }] as never }).open, opts))
      .rejects.toMatchObject({ code: 'invalid_output' })
  })
})
