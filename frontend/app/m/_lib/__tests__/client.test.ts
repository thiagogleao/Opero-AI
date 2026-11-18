import { describe, expect, it } from 'vitest'
import {
  apiQuery, clockDiffers, echoMatches, rawFromSearch, rawFromStorage, resolveView, selectionKey, toSearch, toStorage, tzOffsetMinutes,
} from '../selection'
import { diffFeed, FRESH_SALE_MS, inScope } from '../feed'
import { refreshProgress, skippedText } from '../refreshProgress'
import { bytesToBase64Url, sameServerKey, urlBase64ToUint8Array } from '../pushKeys'

const known = (id: string) => ['mokoo', 'epoch', 'squishy'].includes(id)

describe('resolveView', () => {
  const stored = rawFromStorage(JSON.stringify({ loja: 'epoch', periodo: '30d', de: null, ate: null, aba: 'produtos' }))

  it('launch without a URL restores the last store, period and tab', () => {
    expect(resolveView(rawFromSearch(''), stored, known)).toEqual({ sel: { loja: 'epoch', periodo: '30d', de: null, ate: null }, aba: 'produtos' })
  })
  it('first launch ever: Todas · Hoje', () => {
    expect(resolveView({}, {}, known)).toEqual({ sel: { loja: 'todas', periodo: 'today', de: null, ate: null }, aba: null })
  })
  it('a notification tap (?loja=&aba=) picks the store and tab and keeps the stored period', () => {
    const v = resolveView(rawFromSearch('?loja=mokoo&aba=campanhas'), stored, known)
    expect(v).toEqual({ sel: { loja: 'mokoo', periodo: '30d', de: null, ate: null }, aba: 'campanhas' })
  })
  it('a store the owner cannot open, or garbage, falls back field by field', () => {
    const v = resolveView(rawFromSearch('?loja=someone-else&periodo=forever&aba=x'), stored, known)
    expect(v).toEqual({ sel: { loja: 'epoch', periodo: '30d', de: null, ate: null }, aba: null })
    expect(resolveView(rawFromSearch('?loja=nope'), rawFromStorage('{not json'), known).sel.loja).toBe('todas')
  })
  it('custom counts only with both dates (sorted), else the previous period stays', () => {
    expect(resolveView(rawFromSearch('?periodo=custom&de=2026-11-12&ate=2026-11-01'), {}, known).sel)
      .toEqual({ loja: 'todas', periodo: 'custom', de: '2026-11-01', ate: '2026-11-12' })
    expect(resolveView(rawFromSearch('?periodo=custom&de=2026-11-12'), stored, known).sel.periodo).toBe('30d')
  })
  it('round-trips through the URL and storage', () => {
    const v = { sel: { loja: 'mokoo', periodo: 'custom' as const, de: '2026-11-01', ate: '2026-11-05' }, aba: 'paises' as const }
    expect(toSearch(v)).toBe('loja=mokoo&periodo=custom&de=2026-11-01&ate=2026-11-05&aba=paises')
    expect(resolveView(rawFromSearch(toSearch(v)), {}, known)).toEqual(v)
    expect(resolveView({}, rawFromStorage(toStorage(v)), known)).toEqual(v)
  })
})

describe('echoMatches', () => {
  const sel = { loja: 'mokoo', periodo: 'today' as const, de: null, ate: null }
  it('accepts only the exact answer to what is on screen', () => {
    expect(echoMatches({ store: 'mokoo', period: 'today', from: null, to: null }, sel)).toBe(true)
    // The slow "Todas" answer landing after MOKOO was tapped: dropped.
    expect(echoMatches({ store: 'all', period: 'today', from: null, to: null }, sel)).toBe(false)
    expect(echoMatches({ store: 'mokoo', period: '7d', from: null, to: null }, sel)).toBe(false)
    expect(echoMatches(null, sel)).toBe(false)
  })
  it('custom dates must match too, and Todas is "all" on the wire', () => {
    const c = { loja: 'todas', periodo: 'custom' as const, de: '2026-11-01', ate: '2026-11-05' }
    expect(apiQuery(c)).toBe('period=custom&store=all&from=2026-11-01&to=2026-11-05')
    expect(echoMatches({ store: 'all', period: 'custom', from: '2026-11-01', to: '2026-11-05' }, c)).toBe(true)
    expect(echoMatches({ store: 'all', period: 'custom', from: '2026-11-01', to: '2026-11-04' }, c)).toBe(false)
    expect(selectionKey(c)).not.toBe(selectionKey({ ...c, ate: '2026-11-04' }))
  })
})

describe('clocks', () => {
  const at = new Date('2026-11-17T16:00:00Z')
  it('Belém and São Paulo share a clock (no "dia de Belém" noise); Tóquio does not', () => {
    expect(tzOffsetMinutes('America/Sao_Paulo', at)).toBe(-180)
    expect(tzOffsetMinutes('Asia/Tokyo', at)).toBe(540)
    expect(clockDiffers('America/Belem', 'America/Sao_Paulo', at)).toBe(false)
    expect(clockDiffers('Asia/Tokyo', 'America/Sao_Paulo', at)).toBe(true)
  })
})

describe('diffFeed', () => {
  const now = Date.parse('2026-11-17T20:00:00Z')
  const sale = (storeId: string, orderId: string, minutesAgo: number) => {
    const at = new Date(now - minutesAgo * 60_000).toISOString()
    return { storeId, orderId, placedAt: at, receivedAt: at }
  }
  it('the first answer of a selection is a silent baseline', () => {
    const r = diffFeed(null, 'mokoo|today||', [sale('mokoo', '1', 1)], new Set(), now)
    expect(r.fresh).toEqual([])
  })
  it('switching store never rings, even with orders the old view had not seen', () => {
    const base = diffFeed(null, 'mokoo|today||', [sale('mokoo', '1', 30)], new Set(), now).baseline
    const r = diffFeed(base, 'todas|today||', [sale('epoch', '9', 2), sale('mokoo', '1', 30)], new Set(), now)
    expect(r.fresh).toEqual([])
    expect(r.baseline.key).toBe('todas|today||')
  })
  it('rings for a new, recent sale of the same view, once', () => {
    const base = diffFeed(null, 'k', [sale('mokoo', '1', 30)], new Set(), now).baseline
    const r = diffFeed(base, 'k', [sale('mokoo', '2', 1), sale('mokoo', '1', 30)], new Set(), now)
    expect(r.fresh).toEqual(['mokoo|2'])
    expect(diffFeed(r.baseline, 'k', [sale('mokoo', '2', 1)], new Set(), now).fresh).toEqual([])
    // Already announced by the service worker's push: no second chime.
    expect(diffFeed(base, 'k', [sale('mokoo', '3', 1)], new Set(['mokoo|3']), now).fresh).toEqual([])
  })
  it('an old sale that surfaces late is history, not news', () => {
    const base = diffFeed(null, 'k', [], new Set(), now).baseline
    expect(diffFeed(base, 'k', [sale('glooty', '7', FRESH_SALE_MS / 60_000 + 5)], new Set(), now).fresh).toEqual([])
  })
  it('inScope: Todas means the active stores; one store means that store', () => {
    const active = new Set(['mokoo', 'epoch'])
    expect(inScope('todas', 'epoch', active)).toBe(true)
    expect(inScope('todas', 'squishy', active)).toBe(false)
    expect(inScope('mokoo', 'epoch', active)).toBe(false)
    expect(inScope('mokoo', undefined, active)).toBe(false)
  })
})

describe('refreshProgress', () => {
  const launched = [
    { storeId: 'mokoo', name: 'MOKOO', source: 'shopify' as const, startsInSeconds: 0 },
    { storeId: 'mokoo', name: 'MOKOO', source: 'facebook' as const, startsInSeconds: 0 },
    { storeId: 'epoch', name: 'EPOCH', source: 'shopify' as const, startsInSeconds: 4 },
  ]
  const run = (storeId: string, source: 'shopify' | 'facebook', status: string | null) => ({
    storeId, name: storeId, source, status, startedAt: status ? '2026-11-17T20:00:00Z' : null, finishedAt: null,
  })
  it('counts finished runs, not time', () => {
    const p = refreshProgress(launched, { since: '', done: false, runs: [run('mokoo', 'shopify', 'success'), run('mokoo', 'facebook', 'running'), run('epoch', 'shopify', null)] })
    expect(p.lines.map(l => l.state)).toEqual(['ok', 'rodando', 'fila'])
    expect([p.done, p.total, p.finished]).toEqual([1, 3, false])
  })
  it('finished when every launched run ended; failures are named', () => {
    const p = refreshProgress(launched, { since: '', done: true, runs: [run('mokoo', 'shopify', 'success'), run('mokoo', 'facebook', 'error'), run('epoch', 'shopify', 'success'), run('glooty', 'shopify', 'running')] })
    expect(p.finished).toBe(true)
    expect(p.failed.map(l => `${l.name}:${l.source}`)).toEqual(['MOKOO:facebook'])
  })
  it('nothing launched is never "finished" (and before any status, all queued)', () => {
    expect(refreshProgress([], null).finished).toBe(false)
    expect(refreshProgress(launched, null).lines.every(l => l.state === 'fila')).toBe(true)
  })
  it('says which stores were skipped as recent', () => {
    expect(skippedText([
      { storeId: 'a', name: 'MOKOO', source: 'shopify', reason: 'recente', retryInSeconds: 30 },
      { storeId: 'a', name: 'MOKOO', source: 'facebook', reason: 'recente', retryInSeconds: 30 },
      { storeId: 'b', name: 'CAMP HALLOW', source: 'facebook', reason: 'sem_conta_de_anuncio', retryInSeconds: null },
    ])).toBe('MOKOO: sincronizada há menos de 2 min, não precisa de novo.')
    expect(skippedText([])).toBeNull()
  })
})

describe('push keys', () => {
  const key = 'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
  it('compares the subscription key with the server key, padding-insensitive', () => {
    const bytes = urlBase64ToUint8Array(key)
    expect(bytes.length).toBe(65)
    expect(bytesToBase64Url(bytes)).toBe(key)
    expect(sameServerKey(bytes.buffer, key)).toBe(true)
    expect(sameServerKey(bytes.buffer, `${key}=`)).toBe(true)
    expect(sameServerKey(urlBase64ToUint8Array(key.replace('BEl', 'BEm')).buffer, key)).toBe(false)
    expect(sameServerKey(null, key)).toBeNull()
  })
})
