import { describe, expect, it } from 'vitest'
import { createSseParser, readSse } from '../sse'
import { BILLING_MESSAGE, describeAiError } from '../errors'
import { internalHref, withPageState } from '../links'
import { applyChatEvent, CUT_BY_NAVIGATION, historyFor, parseSaved, toSaved, type AssistantTurn, type Turn } from '../chatModel'
import { adChannelOf, channelRoas, insightsQuery, insightsRequestKey, lacksClosedDay, mayLackClosedDay, resultMatches } from '../insightsModel'
import type { InsightsResult } from '@/lib/ai/insights/run'

const answer = (over: Partial<AssistantTurn> = {}): AssistantTurn => ({
  id: 'a', role: 'assistant', text: '', tools: [], status: 'waiting', notice: null, error: null, ...over,
})

describe('createSseParser', () => {
  it('parses frames split across chunks and skips pings', () => {
    const got: unknown[] = []
    const p = createSseParser<unknown>(e => got.push(e))
    p.push('data: {"type":"st')
    p.push('art"}\n\n: ping\n\ndata: {"type":"text","delta":"Olá"}\n')
    p.push('\n')
    expect(got).toEqual([{ type: 'start' }, { type: 'text', delta: 'Olá' }])
  })

  it('drops a malformed frame and keeps reading (AI27)', () => {
    const got: unknown[] = []
    const p = createSseParser<unknown>(e => got.push(e))
    p.push('data: {nope\n\ndata: {"type":"done"}\n\n')
    expect(got).toEqual([{ type: 'done' }])
  })

  it('handles CRLF and a last frame without a blank line', () => {
    const got: unknown[] = []
    const p = createSseParser<unknown>(e => got.push(e))
    p.push('data: {"a":1}\r\n\r\ndata: {"b":2}')
    p.flush()
    expect(got).toEqual([{ a: 1 }, { b: 2 }])
  })
})

describe('readSse', () => {
  it('reads a body to the end', async () => {
    const enc = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(enc.encode('data: {"n":1}\n\n'))
        c.enqueue(enc.encode('data: {"n":2}\n\n'))
        c.close()
      },
    })
    const got: unknown[] = []
    await readSse(body, e => got.push(e), new AbortController().signal)
    expect(got).toEqual([{ n: 1 }, { n: 2 }])
  })

  it('rejects with AbortError when stopped', async () => {
    const body = new ReadableStream<Uint8Array>({ start() { /* never sends */ } })
    const ac = new AbortController()
    const p = readSse(body, () => {}, ac.signal)
    ac.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('describeAiError', () => {
  it('names who fixes an empty Anthropic balance', () => {
    expect(describeAiError({ code: 'billing', serverMessage: 'Avise o administrador.' }, 'chat').message).toBe(BILLING_MESSAGE)
    expect(describeAiError({ code: 'billing' }, 'insights').message).toBe(BILLING_MESSAGE)
  })

  it('keeps the server sentence for our own 429 and for a 400', () => {
    const e = describeAiError({ status: 429, code: 'rate_limited', serverMessage: 'Limite de perguntas ao Copiloto atingido. Tente de novo em 7 min.', retryAfter: 400 }, 'chat')
    expect(e.message).toContain('em 7 min')
    expect(describeAiError({ status: 429, code: 'rate_limited', retryAfter: 400 }, 'insights').message).toContain('em 7 min')
    expect(describeAiError({ status: 400, serverMessage: 'A pergunta passou de 2000 caracteres.' }, 'chat').message).toContain('2000')
  })

  it('never shows raw SDK text and says when retrying cannot help', () => {
    const e = describeAiError({ code: 'bad_request', serverMessage: '400 {"type":"error"}' }, 'chat')
    expect(e.message).not.toContain('{')
    expect(describeAiError({ status: 401 }, 'chat').retry).toBe(false)
    expect(describeAiError({ status: 422, code: 'no_closed_days' }, 'insights').retry).toBe(false)
    expect(describeAiError({ code: 'overloaded' }, 'insights').retry).toBe(true)
  })
})

describe('internalHref (AI18)', () => {
  it('allows only pages of this app', () => {
    expect(internalHref('/campaigns?loja=x')).toBe('/campaigns?loja=x')
    expect(internalHref('/')).toBe('/')
    expect(internalHref('https://evil.example/?d=1')).toBeNull()
    expect(internalHref('//evil.example')).toBeNull()
    expect(internalHref('/\\evil.example')).toBeNull()
    expect(internalHref('javascript:alert(1)')).toBeNull()
    expect(internalHref('/api/mobile/unlock?k=1')).toBeNull()
    expect(internalHref('/sign-in')).toBeNull()
    expect(internalHref('/campaigns\n//x')).toBeNull()
  })

  it('judges the path the browser opens, not the raw text (dot segments)', () => {
    // Each of these passed the first-segment check and resolved to an API route.
    expect(internalHref('/campaigns/../api/facebook/auth?store=x&mode=main')).toBeNull()
    expect(internalHref('/campaigns/%2e%2e/api/mobile/unlock')).toBeNull()
    expect(internalHref('/campaigns/.%2E/api/mobile/unlock')).toBeNull()
    expect(internalHref('/m/../api/export?period=90d')).toBeNull()
    expect(internalHref('/overview/..%2fapi/export')).toBeNull()
    expect(internalHref('/creatives/..')).toBeNull()
    expect(internalHref('/campaigns/./x')).toBeNull()
    // Dots in the query are not path segments and stay allowed.
    expect(internalHref('/campaigns?q=../api')).toBe('/campaigns?q=../api')
    expect(internalHref('/products/')).toBe('/products/')
    expect(internalHref('/m')).toBe('/m')
  })

  it('drops a page that needs an id when it has none', () => {
    expect(internalHref('/creatives')).toBeNull()
    expect(internalHref('/creatives/120249395069380003')).toBe('/creatives/120249395069380003')
  })

  it('keeps the store and period on screen on an app link', () => {
    const on = '?loja=mokoo&periodo=custom&de=2026-11-01&ate=2026-11-12&parte=50&x=1'
    expect(withPageState('/campaigns', on)).toBe('/campaigns?loja=mokoo&periodo=custom&de=2026-11-01&ate=2026-11-12&parte=50')
    // The link's own store wins — another scope, so an R4 link with vem
    // (period-fix-r1 F32); the hash stays at the end.
    expect(withPageState('/products?loja=glooty#top', on)).toBe('/products?loja=glooty&periodo=custom&de=2026-11-01&ate=2026-11-12&parte=50&vem=mokoo#top')
    expect(withPageState('/m', on)).toBe('/m')
    expect(withPageState('/campaigns', '')).toBe('/campaigns')
  })

  it("opens the conversation's store, not the address's loja", () => {
    // "Todas as lojas" reached from MOKOO's Resumo keeps MOKOO's id in the
    // address; the drawer's conversation is about Glooty.
    const todas = '?loja=user_3CVoVQYfnj1Ljnm3tf0iHP40fxX&periodo=yesterday'
    const glooty = '5071bfb6-0000-0000-0000-000000000000'
    // Another scope than the address: R4 (vem), so the landing page announces other dates.
    expect(withPageState('/campaigns', todas, glooty)).toBe(`/campaigns?loja=${glooty}&periodo=yesterday&vem=user_3CVoVQYfnj1Ljnm3tf0iHP40fxX`)
    // 7 dias is the desktop default, left out of URLs (lib/period desktopHref).
    expect(withPageState('/products', '?loja=todas&periodo=7d', glooty)).toBe(`/products?loja=${glooty}&vem=todas`)
    // A link that names its store keeps it; no conversation store: the address.
    expect(withPageState('/campaigns?loja=other', todas, glooty)).toBe('/campaigns?loja=other&periodo=yesterday&vem=user_3CVoVQYfnj1Ljnm3tf0iHP40fxX')
    expect(withPageState('/campaigns', todas, null)).toBe(`/campaigns${todas}`)
    expect(withPageState('/m', todas, glooty)).toBe('/m')
  })
})

describe('chat model', () => {
  it('sends only complete exchanges as history (AI3)', () => {
    const turns: Turn[] = [
      { id: '1', role: 'user', text: 'lucro ontem?' },
      answer({ id: '2', status: 'done', text: '$500' }),
      { id: '3', role: 'user', text: 'e hoje?' },
      answer({ id: '4', status: 'error', text: '' }),
      { id: '5', role: 'user', text: 'parei' },
      answer({ id: '6', status: 'stopped', text: 'meia resp' }),
    ]
    expect(historyFor(turns, 'e a semana?')).toEqual([
      { role: 'user', content: 'lucro ontem?' },
      { role: 'assistant', content: '$500' },
      { role: 'user', content: 'e a semana?' },
    ])
  })

  it('applies stream events in order', () => {
    let t = answer()
    t = applyChatEvent(t, { type: 'start', store: { id: 's', name: 'MOKOO', timezone: 'America/Belem', today: '2026-11-17' }, model: 'm' })
    t = applyChatEvent(t, { type: 'tool', id: 'x', name: 'get_profit', label: 'Lucro · 16 nov', status: 'running' })
    t = applyChatEvent(t, { type: 'text', delta: 'O lucro ' })
    t = applyChatEvent(t, { type: 'tool', id: 'x', name: 'get_profit', label: 'Lucro · 16 nov', status: 'done' })
    t = applyChatEvent(t, { type: 'replace', text: 'Refeito' })
    expect(t.text).toBe('Refeito')
    expect(t.tools).toEqual([{ id: 'x', label: 'Lucro · 16 nov', status: 'done' }])
    t = applyChatEvent(t, { type: 'done', stop: 'max_tokens', text: 'Final', notice: 'cortada' })
    expect(t).toMatchObject({ status: 'done', text: 'Final', notice: 'cortada' })
  })

  it('maps a billing error event to the Portuguese message', () => {
    const t = applyChatEvent(answer(), { type: 'error', code: 'billing', message: 'x' })
    expect(t.status).toBe('error')
    expect(t.error?.message).toBe(BILLING_MESSAGE)
  })

  it('keeps an answer cut by a page change as stopped, with a note, and reads it back', () => {
    const turns: Turn[] = [
      { id: '1', role: 'user', text: 'a' },
      answer({ id: '2', status: 'done', text: 'b', tools: [{ id: 't', label: 'L', status: 'done' }] }),
      { id: '3', role: 'user', text: 'c' },
      answer({ id: '4', status: 'streaming', text: 'pela metade', tools: [{ id: 'r', label: 'Lucro', status: 'running' }] }),
    ]
    const saved = toSaved('store-1', 'MOKOO', false, turns)
    expect(saved.turns.map(t => t.id)).toEqual(['1', '2', '3', '4'])
    expect(saved.turns[3]).toMatchObject({ status: 'stopped', text: 'pela metade', notice: CUT_BY_NAVIGATION, tools: [{ status: 'error' }] })
    expect(historyFor(saved.turns, 'x')).toHaveLength(3)
    expect(parseSaved(JSON.stringify(saved))).toEqual(saved)
    expect(parseSaved('{"v":2}')).toBeNull()
    expect(parseSaved('nope')).toBeNull()
  })
})

describe('insights model (AI12/AI22)', () => {
  const req = { storeId: 'mokoo', from: '2026-11-10', to: '2026-11-16', split: true }
  const result = (over: Partial<InsightsResult>): InsightsResult => ({
    storeId: 'mokoo', storeName: 'MOKOO', split: true, model: 'm', generatedAt: '', expiresAt: '',
    window: { from: '2026-11-10', to: '2026-11-16', label: '', days: 7, cutAtYesterday: false, shortened: false },
    headline: {
      configured: true, revenue: 1, orders: 1, operatingProfit: 1, partnerProfit: 0.5, margin: 1,
      metaSpend: 1, shopSpend: 0, roas: 1, metaRoas: 1, breakEvenRoas: 1,
    },
    summary: '', insights: [], dataGaps: [], ...over,
  })

  it('keys by store, window and split', () => {
    expect(insightsRequestKey(req)).not.toBe(insightsRequestKey({ ...req, split: false }))
    expect(insightsRequestKey(req)).not.toBe(insightsRequestKey({ ...req, storeId: 'glooty' }))
    expect(insightsQuery(req)).toBe('storeId=mokoo&period=custom&from=2026-11-10&to=2026-11-16&split=1')
  })

  it('knows a window that starts on the store today has no closed day', () => {
    // 02:45 UTC on 18/11: still 17/11 in Belém (UTC−3), already 18/11 in Tokyo.
    const now = new Date('2026-11-18T02:45:00Z')
    expect(lacksClosedDay('2026-11-17', 'America/Belem', now)).toBe(true)
    expect(lacksClosedDay('2026-11-16', 'America/Belem', now)).toBe(false)
    expect(lacksClosedDay('2026-11-18', 'Asia/Tokyo', now)).toBe(true)
    expect(lacksClosedDay('2026-11-17', 'Asia/Tokyo', now)).toBe(false)
    // Only windows starting on the earliest today on Earth (17/11 at UTC−12) need the lookup.
    expect(mayLackClosedDay('2026-11-17', now)).toBe(true)
    expect(mayLackClosedDay('2026-11-16', now)).toBe(false)
    expect(mayLackClosedDay('2026-11-10', now)).toBe(false)
  })

  it('refuses a result for another store, split or window', () => {
    const w = result({}).window
    expect(resultMatches(result({}), req, w)).toBe(true)
    expect(resultMatches(result({ storeId: 'glooty' }), req, w)).toBe(false)
    expect(resultMatches(result({ split: false }), req, w)).toBe(false)
    expect(resultMatches(result({ window: { ...w, from: '2026-11-03' } }), req, w)).toBe(false)
  })
})

describe('headline ROAS basis', () => {
  // Real headlines (production, read-only, 18/11): the card must measure ROAS
  // on the same spend as the Resumo page's ROAS card.
  const cases = [
    { name: 'MOKOO 11–17 nov', revenue: 11057.83, metaSpend: 5925.22, shopSpend: 193.66 },
    { name: 'Dumpling 8jcp3a 11–17 nov', revenue: 19095.52, metaSpend: 59.74, shopSpend: 6436 },
    { name: 'Dumpling 8jcp3a 19 out – 17 nov', revenue: 37836.66, metaSpend: 4875.7, shopSpend: 11487.45 },
    { name: 'Glooty 11–17 nov', revenue: 0, metaSpend: 545.19, shopSpend: 0 },
    { name: 'no spend', revenue: 120, metaSpend: 0, shopSpend: 0 },
  ]

  it('agrees with lib/views/store for every case', async () => {
    const page = await import('@/lib/views/store')
    for (const c of cases) {
      expect(adChannelOf(c), c.name).toBe(page.adChannelOf(c))
      expect(channelRoas(c), c.name).toBe(page.channelRoas(c))
    }
  })

  it('never shows revenue ÷ Meta for a store whose sales come from Shopify ads', () => {
    const d = cases[1]
    expect(adChannelOf(d)).toBe('shop')
    expect(channelRoas(d)).toBeCloseTo(2.967, 3) // not 319,64×
    expect(adChannelOf(cases[2])).toBe('both')
    expect(channelRoas(cases[2])).toBeCloseTo(2.312, 3) // not 7,76×
    expect(adChannelOf(cases[4])).toBeNull()
  })
})

describe('useIsomorphicLayoutEffect', () => {
  it('is one hook fixed when the module loads (useEffect without a window)', async () => {
    // The constant, not a per-render choice: React reported a change in hook
    // order in CopilotLauncher when the slot held useEffect in one render and
    // useLayoutEffect in the next.
    const React = await import('react')
    const { useIsomorphicLayoutEffect } = await import('../useIsomorphicLayoutEffect')
    expect(typeof window).toBe('undefined')
    expect(useIsomorphicLayoutEffect).toBe(React.useEffect)
  })
})
