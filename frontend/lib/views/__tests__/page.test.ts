import { beforeEach, describe, expect, it, vi } from 'vitest'

// lib/access (cookies, database) is never reached: it is answered here.
vi.mock('../../access', () => ({ getViewer: vi.fn(), listStores: vi.fn(), resolveStore: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }))

import { getViewer, listStores, resolveStore, type StoreRef } from '../../access'
import { notFound } from 'next/navigation'
import {
  ALL_STORES, buildHref, carriedLoja, clockLabel, getPageContext, MAX_WINDOW_DAYS, MIN_PAGE_DATE, pageMetadata, parsePageParams,
  resolvePeriodWindow, toStoreOption, type PageParams, type SearchParams,
} from '../page'

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
  // lib/views/store comparisonPlan and portfolio loadComparison cut the last
  // comparison day of any window ending today (cutLast = sameTimeOfDay ||
  // range.to >= today); the engine's comparisonRange says sameTimeOfDay false
  // for a custom range, and the text named the whole 31 out – 9 nov for a
  // profit that stops at this hour.
  it('a custom range ending today names the cut of its comparison', () => {
    const w = resolvePeriodWindow('custom', '2026-11-10', '2026-11-17', 'America/Sao_Paulo', NOW)
    expect(w.partial).toBe(true)
    expect(w.comparison.sameTimeOfDay).toBe(false)
    expect(w.comparisonText).toBe('vs 8 dias anteriores (2–9 nov, até esta hora de 9 nov)')
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

describe('custom range limits (regression: ?de=1990-01-01 priced 13,470 days in 18 s)', () => {
  it('parsePageParams ignores a range wholly before MIN_PAGE_DATE, like a malformed date', () => {
    expect(parsePageParams({ periodo: 'custom', de: '1990-01-01', ate: '1995-01-01' }).periodo).toBe('7d')
    expect(parsePageParams({ de: '0100-01-01', ate: '0200-01-01' }).periodo).toBe('7d')
    // One end in range: kept, the window cuts it.
    expect(parsePageParams({ periodo: 'custom', de: '1990-01-01', ate: '2026-11-17' }))
      .toMatchObject({ periodo: 'custom', de: '1990-01-01', ate: '2026-11-17' })
  })

  it('keeps the last MAX_WINDOW_DAYS days of a longer range, says so, and compares with as many before', () => {
    const w = resolvePeriodWindow('custom', '1990-01-01', '2026-11-17', 'America/Belem', NOW)
    expect(w.range).toEqual({ from: '2025-11-17', to: '2026-11-17' })
    expect(MAX_WINDOW_DAYS).toBe(366)
    expect(w.comparison.from).toBe('2024-11-16')
    expect(w.comparison.to).toBe('2025-11-16')
    // The window ends today, so the views cut its comparison's last day at this hour.
    expect(w.comparisonText).toBe('vs 366 dias anteriores (16 nov 2024 – 16 nov 2025, até esta hora de 16 nov 2025)')
    expect(w.rangeNote).toBe('O período pedido passa de 366 dias, o máximo por página: aqui estão os últimos 366, 17 nov 2025 – 17 nov 2026.')
  })

  it('a year-100 start no longer yields a negative year or "undefined" in the text', () => {
    const w = resolvePeriodWindow('custom', '0100-01-01', '2026-11-17', 'America/Belem', NOW)
    expect(w.range.from >= MIN_PAGE_DATE).toBe(true)
    expect(w.comparison.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(w.comparisonText).not.toMatch(/undefined|-00/)
  })

  it('a start before MIN_PAGE_DATE starts there when the result is short enough', () => {
    const w = resolvePeriodWindow('custom', '1999-12-01', '2000-02-01', 'America/Belem', NOW)
    expect(w.range).toEqual({ from: '2000-01-01', to: '2000-02-01' })
    expect(w.rangeNote).toBe('Datas antes de 1 jan 2000 não entram: o período começa em 1 jan 2000.')
  })

  it('exactly 366 days, and every preset, pass untouched with no note', () => {
    const w = resolvePeriodWindow('custom', '2025-11-17', '2026-11-17', 'America/Belem', NOW)
    expect(w.range).toEqual({ from: '2025-11-17', to: '2026-11-17' })
    expect(w.rangeNote).toBeNull()
    for (const p of ['today', 'yesterday', '7d', '14d', '30d', '90d', 'mtd', 'lastmonth'] as const) {
      expect(resolvePeriodWindow(p, null, null, 'America/Belem', NOW).rangeNote).toBeNull()
    }
  })
})

describe('pageMetadata (regression: 404s kept the page title, e.g. "Resumo · Opero")', () => {
  const stores = [{ id: 'user_3CV', archived: false }, { id: 'old', archived: true }]
  const sp = (o: SearchParams) => Promise.resolve(o)

  it('404s (via generateMetadata) on a ?loja the viewer cannot see, so Next uses the not-found title', async () => {
    vi.mocked(getViewer).mockResolvedValue({ kind: 'owner' })
    vi.mocked(listStores).mockResolvedValue(stores as never)
    vi.mocked(notFound).mockImplementation(() => { throw new Error('NEXT_NOT_FOUND') })
    await expect(pageMetadata('Campanhas')({ searchParams: sp({ loja: 'bogus' }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('keeps the title for a visible store (archived included), todas, no ?loja, no viewer, and scope all', async () => {
    vi.mocked(listStores).mockResolvedValue(stores as never)
    vi.mocked(notFound).mockImplementation(() => { throw new Error('NEXT_NOT_FOUND') })
    vi.mocked(getViewer).mockResolvedValue({ kind: 'owner' })
    const meta = pageMetadata({ absolute: 'Resumo · Opero' })
    await expect(meta({ searchParams: sp({ loja: 'user_3CV' }) })).resolves.toEqual({ title: { absolute: 'Resumo · Opero' } })
    await expect(meta({ searchParams: sp({ loja: 'old' }) })).resolves.toBeTruthy()
    await expect(meta({ searchParams: sp({ loja: ALL_STORES }) })).resolves.toBeTruthy()
    await expect(meta({ searchParams: sp({}) })).resolves.toBeTruthy()
    await expect(pageMetadata('Todas as lojas', { scope: 'all' })({ searchParams: sp({ loja: 'bogus' }) })).resolves.toBeTruthy()
    vi.mocked(getViewer).mockResolvedValue(null)
    await expect(meta({ searchParams: sp({ loja: 'bogus' }) })).resolves.toBeTruthy()
  })

  it('404s when the page-specific check fails (a creative id that does not exist)', async () => {
    vi.mocked(getViewer).mockResolvedValue({ kind: 'owner' })
    vi.mocked(listStores).mockResolvedValue(stores as never)
    vi.mocked(notFound).mockImplementation(() => { throw new Error('NEXT_NOT_FOUND') })
    const meta = pageMetadata('Criativo', { exists: async p => p.id === '42' })
    await expect(meta({ params: Promise.resolve({ id: '123' }), searchParams: sp({ loja: 'user_3CV' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(meta({ params: Promise.resolve({ id: '42' }), searchParams: sp({ loja: 'user_3CV' }) })).resolves.toEqual({ title: 'Criativo' })
  })
})

describe('Todas is never silently turned into one store (regression: Todas → Resumo → Campanhas opened MOKOO)', () => {
  const store = (id: string, name: string, timezone: string): StoreRef =>
    ({ id, name, shopName: name, domain: null, timezone, archived: false, userId: null })
  const MOKOO = store('user_3CV', 'MOKOO', 'America/Belem')
  const EPOCH = store('73a1', 'EPOCH', 'America/Sao_Paulo')

  /** The owner's two stores; the browser remembers MOKOO. */
  function viewer(kind: 'owner' | 'partner', stores: StoreRef[]) {
    vi.mocked(getViewer).mockResolvedValue(kind === 'owner' ? { kind } : { kind, userId: 'u1' })
    vi.mocked(listStores).mockResolvedValue(stores)
    vi.mocked(resolveStore).mockImplementation(async (_v, urlId) => ({
      store: (urlId ? stores.find(s => s.id === urlId) : stores[0]) ?? null, stores,
    }))
  }
  beforeEach(() => { viewer('owner', [MOKOO, EPOCH]) })

  it('carriedLoja: Todas asked on a one-store page is carried; anything else carries what is shown', () => {
    expect(carriedLoja(ALL_STORES, 'store', true, MOKOO.id)).toBe(ALL_STORES)
    expect(carriedLoja(MOKOO.id, 'store', true, MOKOO.id)).toBe(MOKOO.id)
    expect(carriedLoja(null, 'store', true, MOKOO.id)).toBe(MOKOO.id)
    expect(carriedLoja(ALL_STORES, 'all', true, null)).toBe(ALL_STORES)
    // A one-store partner has no Todas to keep.
    expect(carriedLoja(ALL_STORES, 'store', false, MOKOO.id)).toBe(MOKOO.id)
    // No store at all: nothing to carry but nothing to show either.
    expect(carriedLoja(ALL_STORES, 'store', true, null)).toBeNull()
  })

  it('Resumo with ?loja=todas shows the remembered store, but its navigation keeps Todas', async () => {
    const ctx = await getPageContext({ loja: ALL_STORES, periodo: '30d' }, { scope: 'store', now: NOW })
    expect(ctx.store?.id).toBe(MOKOO.id)
    expect(ctx.scope).toBe('store')
    expect(ctx.fromAll).toBe(true)
    expect(ctx.params.loja).toBe(MOKOO.id)
    expect(ctx.navParams.loja).toBe(ALL_STORES)
    // Sidebar: Campanhas, Produtos, Países e clientes, Todas as lojas keep Todas.
    expect(ctx.navHref('/campaigns')).toBe('/campaigns?loja=todas&periodo=30d')
    expect(ctx.navHref('/products')).toBe('/products?loja=todas&periodo=30d')
    expect(ctx.navHref('/countries')).toBe('/countries?loja=todas&periodo=30d')
    expect(ctx.navHref('/overview')).toBe('/overview?loja=todas&periodo=30d')
    // Period picker and split toggle reload the page still from Todas.
    expect(ctx.navHref('', { periodo: '7d' })).toBe('?loja=todas')
    expect(ctx.navHref('', { parte: true })).toBe('?loja=todas&periodo=30d&parte=50')
    // A link about the store on screen (its campaigns block) names it.
    expect(ctx.hrefWith('/campaigns')).toBe(`/campaigns?loja=${MOKOO.id}&periodo=30d`)
  })

  it('Custos with ?loja=todas (scope store) sends Produtos to Todas', async () => {
    const ctx = await getPageContext({ loja: ALL_STORES }, { scope: 'store', now: NOW })
    expect(ctx.store?.id).toBe(MOKOO.id)
    expect(ctx.navHref('/products')).toBe('/products?loja=todas')
    expect(ctx.navHref('/profit')).toBe('/profit?loja=todas')
  })

  it('once a store is picked (?loja=<id>) the navigation carries that store', async () => {
    const ctx = await getPageContext({ loja: MOKOO.id }, { scope: 'store', now: NOW })
    expect(ctx.fromAll).toBe(false)
    expect(ctx.navHref('/campaigns')).toBe(`/campaigns?loja=${MOKOO.id}`)
    expect(ctx.navHref('/campaigns')).toBe(ctx.hrefWith('/campaigns'))
  })

  it('a bare URL carries the remembered store, as before', async () => {
    const ctx = await getPageContext({}, { scope: 'store', now: NOW })
    expect(ctx.fromAll).toBe(false)
    expect(ctx.navHref('/campaigns')).toBe(`/campaigns?loja=${MOKOO.id}`)
  })

  it('pages that show Todas keep it in both builders', async () => {
    const either = await getPageContext({ loja: ALL_STORES }, { now: NOW })
    expect(either.scope).toBe('all')
    expect(either.fromAll).toBe(false)
    expect(either.navHref('/')).toBe('/?loja=todas')
    expect(either.hrefWith('/')).toBe('/?loja=todas')
    const all = await getPageContext({}, { scope: 'all', now: NOW })
    expect(all.navHref('/campaigns')).toBe('/campaigns?loja=todas')
  })

  it('a one-store partner asking for Todas just gets the store (no Todas to keep, no note)', async () => {
    viewer('partner', [EPOCH])
    const ctx = await getPageContext({ loja: ALL_STORES }, { scope: 'store', now: NOW })
    expect(ctx.allowAll).toBe(false)
    expect(ctx.fromAll).toBe(false)
    expect(ctx.navHref('/campaigns')).toBe(`/campaigns?loja=${EPOCH.id}`)
  })
})

describe('the store on screen as the shell shows it (regression: an archived store read "Fuso —")', () => {
  const store = (id: string, name: string, timezone: string, domain: string | null, archived = false): StoreRef =>
    ({ id, name, shopName: name, domain, timezone, archived, userId: null })
  const MOKOO = store('user_3CV', 'MOKOO', 'America/Belem', '6k7fjw-jt.myshopify.com')
  // Archived stores are opened by id (their history) but listStores leaves them out.
  const SQUISHY = store('75cb', 'Squishy World', 'America/Sao_Paulo', '7ad04d-2g.myshopify.com', true)
  const OLD_TOKYO = store('old-jp', 'Velha', 'Asia/Tokyo', null, true)
  const ARCHIVED = [SQUISHY, OLD_TOKYO]

  beforeEach(() => {
    vi.mocked(getViewer).mockResolvedValue({ kind: 'owner' })
    vi.mocked(listStores).mockResolvedValue([MOKOO])
    vi.mocked(resolveStore).mockImplementation(async (_v, urlId) => ({
      store: (urlId ? [MOKOO, ...ARCHIVED].find(s => s.id === urlId) : MOKOO) ?? null, stores: [MOKOO],
    }))
  })

  it('an archived store gets its city, code and day label although storeOptions leaves it out', async () => {
    const ctx = await getPageContext({ loja: SQUISHY.id, periodo: 'custom', de: '2026-06-02', ate: '2026-10-31' }, { now: NOW })
    expect(ctx.storeOptions.map(o => o.id)).toEqual([MOKOO.id])
    expect(ctx.storeOption).toMatchObject({ id: SQUISHY.id, code: '7ad04d', city: 'São Paulo', dayLabel: null, archived: true })
    expect(clockLabel(ctx)).toBe('São Paulo')
    const jp = await getPageContext({ loja: OLD_TOKYO.id }, { now: NOW })
    expect(jp.storeOption).toMatchObject({ city: 'Tóquio', dayLabel: 'dia de Tóquio' })
    expect(clockLabel(jp)).toBe('Tóquio')
  })

  it('an active store reads the same as its picker option; Todas has none and says how it counts', async () => {
    const one = await getPageContext({ loja: MOKOO.id }, { now: NOW })
    expect(one.storeOption).toEqual(one.storeOptions[0])
    expect(clockLabel(one)).toBe('Belém')
    const all = await getPageContext({ loja: ALL_STORES }, { now: NOW })
    expect(all.storeOption).toBeNull()
    expect(clockLabel(all)).toBe('Brasília · cada loja no seu fuso')
  })
})
