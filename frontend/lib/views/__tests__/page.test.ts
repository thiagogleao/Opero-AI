import { describe, expect, it, vi } from 'vitest'

// The pure parts only: lib/access (cookies, database) is never reached.
vi.mock('../../access', () => ({ getViewer: vi.fn(), listStores: vi.fn(), resolveStore: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }))

import { ALL_STORES, buildHref, parsePageParams, resolvePeriodWindow, toStoreOption, type PageParams } from '../page'

// 2026-11-17 13:38 in Brasília = 16:38 UTC = 2026-11-18 01:38 in Tokyo.
const NOW = new Date('2026-11-17T16:38:00Z')

describe('parsePageParams', () => {
  it('defaults to 7 days, no store, no split', () => {
    expect(parsePageParams({})).toEqual({ loja: null, periodo: '7d', de: null, ate: null, parte: false })
  })

  it('reads a preset, a store and the split', () => {
    expect(parsePageParams({ loja: 'abc', periodo: 'today', parte: '50' }))
      .toEqual({ loja: 'abc', periodo: 'today', de: null, ate: null, parte: true })
  })

  it('treats de+ate without periodo as a custom range', () => {
    expect(parsePageParams({ de: '2026-11-01', ate: '2026-11-05' }))
      .toMatchObject({ periodo: 'custom', de: '2026-11-01', ate: '2026-11-05' })
  })

  it('falls back to the default for custom without both dates, and for junk', () => {
    expect(parsePageParams({ periodo: 'custom', de: '2026-11-01' }).periodo).toBe('7d')
    expect(parsePageParams({ periodo: 'ontem' }).periodo).toBe('7d')
    expect(parsePageParams({ periodo: 'custom', de: '2026-02-30', ate: '2026-03-01' }).periodo).toBe('7d')
  })

  it('drops dates that came with a preset', () => {
    expect(parsePageParams({ periodo: '30d', de: '2026-11-01', ate: '2026-11-05' }))
      .toMatchObject({ periodo: '30d', de: null, ate: null })
  })

  it('takes the first of repeated keys and ignores parte values other than 50', () => {
    expect(parsePageParams({ loja: ['a', 'b'], parte: '1' })).toMatchObject({ loja: 'a', parte: false })
  })
})

describe('resolvePeriodWindow', () => {
  it('7 days on Belém: complete days ending yesterday, compared with the 7 before', () => {
    const w = resolvePeriodWindow('7d', null, null, 'America/Belem', NOW)
    expect(w.range).toEqual({ from: '2026-11-10', to: '2026-11-16' })
    expect(w.rangeLabel).toBe('10–16 nov')
    expect(w.periodLabel).toBe('Últimos 7 dias')
    expect(w.periodPhrase).toBe('nos últimos 7 dias')
    expect(w.comparisonRangeLabel).toBe('3–9 nov')
    expect(w.comparisonText).toBe('vs 7 dias anteriores (3–9 nov)')
    expect(w.partial).toBe(false)
    expect(w.partialLabel).toBeNull()
  })

  it('today in Brasília is partial and compared at the same time yesterday', () => {
    const w = resolvePeriodWindow('today', null, null, 'America/Sao_Paulo', NOW)
    expect(w.range).toEqual({ from: '2026-11-17', to: '2026-11-17' })
    expect(w.partial).toBe(true)
    expect(w.partialLabel).toBe('parcial · até 13h38')
    expect(w.comparisonText).toBe('vs ontem até esta hora')
    expect(w.periodPhrase).toBe('hoje')
  })

  it("Hibikura's today is Tokyo's 18 Nov at 01h38", () => {
    const w = resolvePeriodWindow('today', null, null, 'Asia/Tokyo', NOW)
    expect(w.range.from).toBe('2026-11-18')
    expect(w.partialLabel).toBe('parcial · até 01h38')
  })

  it('a custom range is labelled by its dates', () => {
    const w = resolvePeriodWindow('custom', '2026-10-28', '2026-11-03', 'America/Sao_Paulo', NOW)
    expect(w.periodLabel).toBe('28 out – 3 nov')
    expect(w.periodPhrase).toBe('em 28 out – 3 nov')
    expect(w.comparisonText).toBe('vs 7 dias anteriores (21–27 out)')
  })
})

describe('buildHref', () => {
  const state: PageParams = { loja: 'user_3CV', periodo: '7d', de: null, ate: null, parte: false }

  it('keeps the store, leaves the default period out', () => {
    expect(buildHref('/campaigns', state)).toBe('/campaigns?loja=user_3CV')
  })

  it('keeps a preset and the split', () => {
    expect(buildHref('/products', { ...state, periodo: 'today', parte: true }))
      .toBe('/products?loja=user_3CV&periodo=today&parte=50')
  })

  it('keeps custom dates only with periodo=custom', () => {
    const custom: PageParams = { ...state, periodo: 'custom', de: '2026-11-01', ate: '2026-11-05' }
    expect(buildHref('/', custom)).toBe('/?loja=user_3CV&periodo=custom&de=2026-11-01&ate=2026-11-05')
    expect(buildHref('/', custom, { periodo: '30d' })).toBe('/?loja=user_3CV&periodo=30d')
  })

  it('overrides and removes keys', () => {
    expect(buildHref('/', state, { loja: ALL_STORES })).toBe('/?loja=todas')
    expect(buildHref('/', state, { loja: null })).toBe('/')
    expect(buildHref('/', { ...state, parte: true }, { parte: false })).toBe('/?loja=user_3CV')
    expect(buildHref('/', state, { periodo: 'custom' })).toBe('/?loja=user_3CV')
  })

  it("keeps the path's own query and hash", () => {
    expect(buildHref('/settings?aba=custos#frete', state)).toBe('/settings?loja=user_3CV&aba=custos#frete')
  })
})

describe('toStoreOption', () => {
  it('adds the domain code, the city and the day label', () => {
    expect(toStoreOption({
      id: '0344', name: 'Hibikura', shopName: 'Hibikura', domain: 'mpjmxs-uj.myshopify.com',
      timezone: 'Asia/Tokyo', archived: false, userId: null,
    })).toEqual({
      id: '0344', name: 'Hibikura', shopName: 'Hibikura', code: 'mpjmxs', timezone: 'Asia/Tokyo',
      city: 'Tóquio', dayLabel: 'dia de Tóquio', archived: false,
    })
    expect(toStoreOption({
      id: 'u', name: 'MOKOO', shopName: 'MOKOO', domain: '6k7fjw-jt.myshopify.com',
      timezone: 'America/Belem', archived: false, userId: null,
    }).dayLabel).toBeNull()
  })
})
