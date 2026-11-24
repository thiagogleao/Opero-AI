import { beforeEach, describe, expect, it, vi } from 'vitest'

// lib/access (cookies, database) is never reached: it is answered here.
vi.mock('../../access', () => ({ getViewer: vi.fn(), listStores: vi.fn(), resolveStore: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }))
// The archive day of an archived store (getPageContext loads it on demand).
vi.mock('../portfolio', async importOriginal => ({
  ...(await importOriginal<typeof import('../portfolio')>()),
  loadArchiveDates: vi.fn(async () => new Map()),
}))

import { getViewer, listStores, resolveStore, type StoreRef } from '../../access'
import { notFound } from 'next/navigation'
import { loadArchiveDates } from '../portfolio'
import {
  ALL_STORES, archivedWindow, buildHref, carriedLoja, clockLabel, COMPARE_AS_PRESETS, getPageContext, MAX_WINDOW_DAYS, MIN_PAGE_DATE, pageMetadata,
  parsePageParams, resolvePeriodWindow, rowDateClocks, rowDatesOf, settleRowDates, toStoreOption, type PageParams, type SearchParams,
} from '../page'
import { mergeQuery } from '../../../components/shell/url'

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

// Squishy World, archived on 10 nov: its "Este mês" (1–24 nov) read "vs
// mesmos dias do mês passado (1–24 out, até 14h07 de 24 out)" — the hour
// following the clock on every reload, under "estes números não mudam" — and
// set 24 days of October against the 10 days of November that were read
// ("caiu 100%").
describe('an archived store compares whole days it read (regression: Este mês cut at the live hour, 1–24 out vs 1–10 nov)', () => {
  const SP = 'America/Sao_Paulo'
  // 24 nov 14h47 and 17h07 in São Paulo.
  const AT_1447 = new Date('2026-11-24T17:47:00Z')
  const AT_1707 = new Date('2026-11-24T20:07:00Z')
  const ON = '2026-11-10'
  const win = (period: Parameters<typeof resolvePeriodWindow>[0], now: Date, de: string | null = null, ate: string | null = null) =>
    archivedWindow(resolvePeriodWindow(period, de, ate, SP, now), ON, now)

  it('Este mês: 1–10 nov against 1–10 out, no hour cut, the same at any hour', () => {
    const live = resolvePeriodWindow('mtd', null, null, SP, AT_1447)
    expect(live.comparisonText).toBe('vs mesmos dias do mês passado (1–24 out, até esta hora de 24 out)')
    const w = win('mtd', AT_1447)
    expect(w.range).toEqual({ from: '2026-11-01', to: '2026-11-24' })
    expect(w.readRange).toEqual({ from: '2026-11-01', to: ON })
    expect(w.archivedOn).toBe(ON)
    expect(w.comparison).toEqual({ from: '2026-10-01', to: '2026-10-10', label: 'mesmos dias do mês passado', sameTimeOfDay: false })
    expect(w.comparisonRangeLabel).toBe('1–10 out')
    expect(w.comparisonText).toBe('vs mesmos dias do mês passado (1–10 out)')
    expect(w.partial).toBe(false)
    expect(w.partialLabel).toBeNull()
    const later = win('mtd', AT_1707)
    expect(later.comparison).toEqual(w.comparison)
    expect(later.comparisonText).toBe(w.comparisonText)
  })

  it('a rolling window past the archive day: its read days against the same number just before', () => {
    const w = win('30d', AT_1447)
    expect(w.range).toEqual({ from: '2026-10-25', to: '2026-11-23' })
    expect(w.readRange).toEqual({ from: '2026-10-25', to: ON })
    expect(w.comparison).toMatchObject({ from: '2026-10-08', to: '2026-10-24', label: '17 dias anteriores', sameTimeOfDay: false })
  })

  it('a custom range ending today: no "até esta hora", the read days only', () => {
    const w = win('custom', AT_1447, '2026-11-05', '2026-11-24')
    expect(w.comparisonText).toBe('vs 6 dias anteriores (30 out – 4 nov)')
    expect(w.comparisonText).not.toContain('até')
  })

  it('Mês passado cut short by the archive: the same days of the month before, not the whole month', () => {
    const w = archivedWindow(resolvePeriodWindow('lastmonth', null, null, SP, AT_1447), '2026-10-10', AT_1447)
    expect(w.readRange).toEqual({ from: '2026-10-01', to: '2026-10-10' })
    expect(w.comparison).toMatchObject({ from: '2026-09-01', to: '2026-09-10', sameTimeOfDay: false })
  })

  it('Hoje after the archive: the whole day before, not "ontem até esta hora"', () => {
    const w = win('today', AT_1447)
    expect(w.readRange).toBeNull()
    expect(w.comparison).toEqual({ from: '2026-11-23', to: '2026-11-23', label: 'dia anterior', sameTimeOfDay: false })
    expect(w.comparisonText).toBe('vs dia anterior (23 nov)')
    expect(w.partialLabel).toBeNull()
  })

  it('a window wholly before the archive day keeps its comparison', () => {
    const base = resolvePeriodWindow('custom', '2026-06-02', '2026-10-31', SP, AT_1447)
    const w = archivedWindow(base, ON, AT_1447)
    expect(w.readRange).toBeNull()
    expect(w.comparison).toEqual(base.comparison)
    expect(w.comparisonText).toBe(base.comparisonText)
  })

  it('without the archive day (the read failed) only the cut and the running day go', () => {
    const w = archivedWindow(resolvePeriodWindow('mtd', null, null, SP, AT_1447), null, AT_1447)
    expect(w.readRange).toBeNull()
    expect(w.comparison).toMatchObject({ from: '2026-10-01', to: '2026-10-24', sameTimeOfDay: false })
    expect(w.comparisonText).toBe('vs mesmos dias do mês passado (1–24 out)')
    expect(w.partial).toBe(false)
  })

  describe('getPageContext', () => {
    const store = (id: string, name: string, archived: boolean): StoreRef =>
      ({ id, name, shopName: name, domain: null, timezone: SP, archived, userId: null })
    const EPOCH = store('73a1', 'EPOCH', false)
    const SQUISHY = store('75cb', 'Squishy World', true)

    beforeEach(() => {
      vi.mocked(loadArchiveDates).mockReset()
      vi.mocked(loadArchiveDates).mockImplementation(async ids => new Map(ids.includes(SQUISHY.id) ? [[SQUISHY.id, ON]] : []))
      vi.mocked(getViewer).mockResolvedValue({ kind: 'owner' })
      vi.mocked(listStores).mockResolvedValue([EPOCH])
      vi.mocked(resolveStore).mockImplementation(async (_v, urlId) => ({
        store: (urlId ? [EPOCH, SQUISHY].find(s => s.id === urlId) : EPOCH) ?? null, stores: [EPOCH],
      }))
    })

    it('an archived store gets its archive day, its read days and a whole-day comparison', async () => {
      const ctx = await getPageContext({ loja: SQUISHY.id, periodo: 'mtd' }, { now: AT_1447 })
      expect(loadArchiveDates).toHaveBeenCalledWith([SQUISHY.id])
      expect(ctx.archivedOn).toBe(ON)
      expect(ctx.readRange).toEqual({ from: '2026-11-01', to: ON })
      expect(ctx.comparisonText).toBe('vs mesmos dias do mês passado (1–10 out)')
      expect(ctx.partial).toBe(false)
      expect(ctx.partialLabel).toBeNull()
      // The window itself is still the one the URL asked for.
      expect(ctx.range).toEqual({ from: '2026-11-01', to: '2026-11-24' })
      expect(ctx.params).toMatchObject({ periodo: 'mtd', de: null, ate: null })
    })

    it('an archived store whose archive day cannot be read still loses the live cut', async () => {
      vi.mocked(loadArchiveDates).mockRejectedValue(new Error('db down'))
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const ctx = await getPageContext({ loja: SQUISHY.id, periodo: 'mtd' }, { now: AT_1447 })
      err.mockRestore()
      expect(ctx.archivedOn).toBeNull()
      expect(ctx.comparisonText).toBe('vs mesmos dias do mês passado (1–24 out)')
    })

    it('an active store asks nothing and keeps its live comparison', async () => {
      const ctx = await getPageContext({ loja: EPOCH.id, periodo: 'mtd' }, { now: AT_1447 })
      expect(loadArchiveDates).not.toHaveBeenCalled()
      expect(ctx.archivedOn).toBeNull()
      expect(ctx.readRange).toBeNull()
      expect(ctx.partial).toBe(true)
      expect(ctx.comparisonText).toBe('vs mesmos dias do mês passado (1–24 out, até esta hora de 24 out)')
    })
  })
})

describe('dates a store row opened (?volta) stay with that store (regression: Todas · Hoje → Hibikura row froze "24 nov" on every page and store)', () => {
  const store = (id: string, name: string, timezone: string): StoreRef =>
    ({ id, name, shopName: name, domain: null, timezone, archived: false, userId: null })
  const MOKOO = store('user_3CV', 'MOKOO', 'America/Belem')
  const EPOCH = store('73a1', 'EPOCH', 'America/Sao_Paulo')
  const HIB = store('0344', 'Hibikura', 'Asia/Tokyo')
  const STORES = [MOKOO, EPOCH, HIB]
  const CLOCKS = ['America/Sao_Paulo', ...STORES.map(s => s.timezone)]
  // 24 nov 17:00 UTC: 14h00 in Brasília, 02h00 of 25 nov in Tokyo.
  const AFTERNOON = new Date('2026-11-24T17:00:00Z')
  // 25 nov 03:30 UTC: 00h30 in Brasília (the next day), 12h30 in Tokyo.
  const NEXT_NIGHT = new Date('2026-11-25T03:30:00Z')
  const rowToday: SearchParams = { loja: HIB.id, periodo: 'custom', de: '2026-11-24', ate: '2026-11-24', volta: 'today' }
  const rowWeek: SearchParams = { loja: HIB.id, periodo: 'custom', de: '2026-11-17', ate: '2026-11-23', volta: '7d' }
  const query = (href: string): SearchParams => Object.fromEntries(new URL(href, 'http://x').searchParams)

  beforeEach(() => {
    vi.mocked(getViewer).mockResolvedValue({ kind: 'owner' })
    vi.mocked(listStores).mockResolvedValue(STORES)
    vi.mocked(resolveStore).mockImplementation(async (_v, urlId) => ({
      store: (urlId ? STORES.find(s => s.id === urlId) : STORES[0]) ?? null, stores: STORES,
    }))
  })

  it('parsePageParams reads volta only next to custom dates', () => {
    expect(parsePageParams(rowToday).volta).toBe('today')
    expect(parsePageParams({ ...rowToday, periodo: 'today' }).volta).toBeUndefined()
    expect(parsePageParams({ ...rowToday, volta: 'custom' }).volta).toBeUndefined()
    expect(parsePageParams({ ...rowToday, volta: 'amanha' }).volta).toBeUndefined()
    expect(parsePageParams({ loja: HIB.id, periodo: 'custom', volta: 'today' }).volta).toBeUndefined()
    // Without it the state is exactly what it always was.
    expect(parsePageParams({ periodo: 'today' })).toEqual({ loja: null, periodo: 'today', de: null, ate: null, parte: false })
  })

  it('buildHref: the row link carries the preset, and the dates never leave that store', () => {
    const todas = parsePageParams({ loja: ALL_STORES, periodo: 'today' })
    expect(buildHref('/', todas, { loja: HIB.id, periodo: 'custom', de: '2026-11-24', ate: '2026-11-24', volta: 'today' }))
      .toBe(`/?loja=${HIB.id}&periodo=custom&de=2026-11-24&ate=2026-11-24&volta=today`)
    const hib = parsePageParams(rowToday)
    // Same store: the sidebar and the split toggle keep the row's dates.
    expect(buildHref('/campaigns', hib)).toBe(`/campaigns?loja=${HIB.id}&periodo=custom&de=2026-11-24&ate=2026-11-24&volta=today`)
    expect(buildHref('', hib, { parte: true })).toBe(`?loja=${HIB.id}&periodo=custom&de=2026-11-24&ate=2026-11-24&volta=today&parte=50`)
    // Another store, or Todas, from the picker: the owner's preset.
    expect(buildHref('', hib, { loja: MOKOO.id })).toBe(`?loja=${MOKOO.id}&periodo=today`)
    expect(buildHref('', hib, { loja: ALL_STORES })).toBe('?loja=todas&periodo=today')
    expect(buildHref('/overview', hib, { loja: null })).toBe('/overview?periodo=today')
    // 7 dias is the default: it is left out, as always.
    expect(buildHref('', parsePageParams(rowWeek), { loja: MOKOO.id })).toBe(`?loja=${MOKOO.id}`)
    // A period the owner picks replaces them (the period picker, "Escolher datas").
    expect(buildHref('', hib, { periodo: '30d' })).toBe(`?loja=${HIB.id}&periodo=30d`)
    expect(buildHref('', hib, { periodo: null })).toBe(`?loja=${HIB.id}`)
    expect(buildHref('', hib, { periodo: 'custom', de: '2026-11-01', ate: '2026-11-10' }))
      .toBe(`?loja=${HIB.id}&periodo=custom&de=2026-11-01&ate=2026-11-10`)
    // Dates the owner picked (no volta) still travel to another store, as before.
    const picked = parsePageParams({ loja: HIB.id, periodo: 'custom', de: '2026-11-01', ate: '2026-11-10' })
    expect(buildHref('', picked, { loja: MOKOO.id })).toBe(`?loja=${MOKOO.id}&periodo=custom&de=2026-11-01&ate=2026-11-10`)
  })

  it('settleRowDates: held while a clock still reads the preset as those dates, the preset otherwise', () => {
    const hib = parsePageParams(rowToday)
    // Hibikura at 14h: Tokyo is on 25 nov, Todas' (Brasília's) "Hoje" is still 24 nov.
    expect(settleRowDates(hib, 'Asia/Tokyo', CLOCKS, AFTERNOON)).toBe(hib)
    // After midnight in Brasília no clock calls 24 nov "Hoje": the preset rolls on.
    expect(settleRowDates(hib, 'Asia/Tokyo', CLOCKS, NEXT_NIGHT)).toEqual({ loja: HIB.id, periodo: 'today', de: null, ate: null, parte: false })
    // On Todas (Brasília) those dates ARE "Hoje": the preset, by name.
    expect(settleRowDates({ ...hib, loja: ALL_STORES }, 'America/Sao_Paulo', CLOCKS, AFTERNOON).periodo).toBe('today')
    // 7 dias: 17–23 nov is Todas' week today, not tomorrow.
    const week = parsePageParams(rowWeek)
    expect(settleRowDates(week, 'Asia/Tokyo', CLOCKS, AFTERNOON)).toBe(week)
    expect(settleRowDates(week, 'Asia/Tokyo', CLOCKS, new Date('2026-11-25T17:00:00Z')).periodo).toBe('7d')
    // Todas opened on Tokyo's "Ontem" (Atribuição's link): held while it is Tokyo's.
    const fromTokyo = parsePageParams({ loja: ALL_STORES, periodo: 'custom', de: '2026-11-24', ate: '2026-11-24', volta: 'yesterday' })
    expect(settleRowDates(fromTokyo, 'America/Sao_Paulo', CLOCKS, AFTERNOON)).toBe(fromTokyo)
    // Nothing to settle without volta.
    const plain = parsePageParams({ loja: HIB.id, periodo: 'custom', de: '2026-11-24', ate: '2026-11-24' })
    expect(settleRowDates(plain, 'Asia/Tokyo', CLOCKS, NEXT_NIGHT)).toBe(plain)
  })

  it('the whole walk: row → picker / sidebar → Todas, and a reload the next day', async () => {
    const hib = await getPageContext(rowToday, { now: AFTERNOON })
    expect(hib.store?.id).toBe(HIB.id)
    expect(hib.period).toBe('custom')
    expect(hib.range).toEqual({ from: '2026-11-24', to: '2026-11-24' })
    expect(hib.params.volta).toBe('today')
    // Store picker (AppShell: ctx.hrefWith('', { loja })) → the preset.
    expect(hib.hrefWith('', { loja: MOKOO.id })).toBe(`?loja=${MOKOO.id}&periodo=today`)
    expect(hib.hrefWith('', { loja: ALL_STORES })).toBe('?loja=todas&periodo=today')
    // Sidebar → Campanhas of the same store keeps the row's day.
    expect(hib.navHref('/campaigns')).toBe(`/campaigns?loja=${HIB.id}&periodo=custom&de=2026-11-24&ate=2026-11-24&volta=today`)
    // Sidebar → Todas as lojas: the URL still names the dates, the page reads them as "Hoje".
    const todas = await getPageContext(query(hib.navHref('/overview')), { scope: 'all', now: AFTERNOON })
    expect(todas.period).toBe('today')
    expect(todas.params.volta).toBeUndefined()
    expect(todas.navHref('/campaigns')).toBe('/campaigns?loja=todas&periodo=today')
    // MOKOO opened from the picker is MOKOO · Hoje.
    const mokoo = await getPageContext(query(hib.hrefWith('', { loja: MOKOO.id })), { now: AFTERNOON })
    expect(mokoo.period).toBe('today')
    expect(mokoo.range).toEqual({ from: '2026-11-24', to: '2026-11-24' })
    // The same row link reloaded after midnight: Hibikura · Hoje on its own clock.
    const later = await getPageContext(rowToday, { now: NEXT_NIGHT })
    expect(later.period).toBe('today')
    expect(later.params.volta).toBeUndefined()
    expect(later.range).toEqual({ from: '2026-11-25', to: '2026-11-25' })
    expect(later.navHref('/campaigns')).toBe(`/campaigns?loja=${HIB.id}&periodo=today`)
  })
})

// Repair round 5 (shared). Three things the row dates (?volta) still did wrong:
//  - dates picked in the period picker after a row link opened the preset
//    (the shell copied the stale volta into the picker's URL);
//  - a store row of Todas · Este mês opened compared with "24 dias
//    anteriores" while Todas, the row and the phone said "mesmos dias do mês
//    passado";
//  - Hibikura's "Ontem" carried through Todas to the MOKOO opened MOKOO's
//    running day as "Ontem de Todas as lojas".
describe('row dates after the row (regressions of ?volta)', () => {
  const store = (id: string, name: string, timezone: string): StoreRef =>
    ({ id, name, shopName: name, domain: null, timezone, archived: false, userId: null })
  const MOKOO = store('user_3CV', 'MOKOO', 'America/Belem')
  const EPOCH = store('73a1', 'EPOCH', 'America/Sao_Paulo')
  const HIB = store('0344', 'Hibikura', 'Asia/Tokyo')
  const STORES = [MOKOO, EPOCH, HIB]
  // 24 nov 18:00 UTC: 15h00 in Brasília, 03h00 of 25 nov in Tokyo.
  const AFTERNOON = new Date('2026-11-24T18:00:00Z')
  // 30 nov 17:00 UTC: 14h00 of 30 nov in Brasília, 02h00 of 1 dez in Tokyo.
  const LAST_DAY = new Date('2026-11-30T17:00:00Z')
  const query = (href: string): SearchParams => Object.fromEntries(new URL(href, 'http://x').searchParams)

  beforeEach(() => {
    vi.mocked(getViewer).mockResolvedValue({ kind: 'owner' })
    vi.mocked(listStores).mockResolvedValue(STORES)
    vi.mocked(resolveStore).mockImplementation(async (_v, urlId) => ({
      store: (urlId ? STORES.find(s => s.id === urlId) : STORES[0]) ?? null, stores: STORES,
    }))
  })

  it('dates picked in the period picker open as picked, on any page a row link opened', async () => {
    for (const [volta, de, ate] of [['today', '2026-11-24', '2026-11-24'], ['yesterday', '2026-11-23', '2026-11-23'], ['7d', '2026-11-17', '2026-11-23']] as const) {
      const rowSearch = `?loja=${HIB.id}&periodo=custom&de=${de}&ate=${ate}&volta=${volta}`
      const row = await getPageContext(query(rowSearch), { now: AFTERNOON })
      expect(row.params.volta).toBe(volta)
      // PeriodPicker.applyCustom: customBase (navHref('', { periodo: null })) +
      // the picked dates, merged with the URL on screen as hrefFor does.
      const base = new URLSearchParams(row.navHref('', { periodo: null }).slice(1))
      base.set('periodo', 'custom'); base.set('de', '2026-11-01'); base.set('ate', '2026-11-10')
      const pushed = mergeQuery(mergeQuery(`?${base}`, ''), rowSearch)
      expect(pushed).not.toContain('volta')
      const opened = await getPageContext(query(pushed), { now: AFTERNOON })
      expect(opened.period).toBe('custom')
      expect(opened.range).toEqual({ from: '2026-11-01', to: '2026-11-10' })
      // A preset clicked there leaves no volta behind either.
      expect(mergeQuery(row.navHref('', { periodo: '30d' }), rowSearch)).toBe(`?loja=${HIB.id}&periodo=30d`)
    }
  })

  it('a row of Todas · Este mês is compared by "Este mês"\'s rule, as the row and the phone', async () => {
    const todas = await getPageContext({ loja: ALL_STORES, periodo: 'mtd' }, { now: AFTERNOON })
    expect(todas.comparison).toMatchObject({ from: '2026-10-01', to: '2026-10-24', label: 'mesmos dias do mês passado' })
    // The Hibikura row (components/portfolio/model resumoLinkOverrides).
    const hib = await getPageContext({ loja: HIB.id, periodo: 'custom', de: '2026-11-01', ate: '2026-11-24', volta: 'mtd' }, { now: AFTERNOON })
    expect(hib.period).toBe('custom')
    expect(hib.range).toEqual({ from: '2026-11-01', to: '2026-11-24' })
    expect(hib.comparePeriod).toBe('mtd')
    expect(hib.comparison).toMatchObject({ from: '2026-10-01', to: '2026-10-24', label: 'mesmos dias do mês passado', sameTimeOfDay: false })
    expect(hib.comparisonText).toBe('vs mesmos dias do mês passado (1–24 out)')
  })

  it('a row of Todas · Mês passado on the month\'s last afternoon is compared with the month before', async () => {
    const hib = await getPageContext({ loja: HIB.id, periodo: 'custom', de: '2026-10-01', ate: '2026-10-31', volta: 'lastmonth' }, { now: LAST_DAY })
    expect(hib.range).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(hib.comparison).toMatchObject({ from: '2026-09-01', to: '2026-09-30', label: 'mês anterior' })
  })

  it('only "Este mês" and "Mês passado" lend their rule; other dates compare as dates', () => {
    const week = resolvePeriodWindow('custom', '2026-11-17', '2026-11-23', 'Asia/Tokyo', AFTERNOON, '7d')
    expect(week.comparePeriod).toBe('custom')
    expect(week.comparisonText).toBe('vs 7 dias anteriores (10–16 nov)')
    const picked = resolvePeriodWindow('custom', '2026-11-01', '2026-11-24', 'Asia/Tokyo', AFTERNOON)
    expect(picked.comparison.label).toBe('24 dias anteriores')
    // A preset is its own rule whatever compareAs says.
    expect(resolvePeriodWindow('7d', null, null, 'Asia/Tokyo', AFTERNOON, 'mtd').comparePeriod).toBe('7d')
  })

  it('the presets that lend their rule are the phone\'s and the portfolio\'s', async () => {
    const { COMPARE_AS } = await import('../portfolio')
    const { COMPARE_AS_PRESET } = await import('../../../app/m/_lib/selection')
    expect([...COMPARE_AS_PRESETS]).toEqual([...COMPARE_AS])
    expect([...COMPARE_AS_PRESETS]).toEqual([...COMPARE_AS_PRESET])
  })

  it('rowDateClocks: a store keeps row dates on Todas\' clock only; Todas on every store\'s', () => {
    const tzs = STORES.map(s => s.timezone)
    expect(rowDateClocks('store', tzs)).toEqual(['America/Sao_Paulo'])
    expect(rowDateClocks('all', tzs)).toEqual(tzs)
    // A partner with one store: that store's own clock, so no foreign dates hold.
    expect(rowDateClocks('store', ['Asia/Tokyo'])).toEqual(['Asia/Tokyo'])
  })

  it('Hibikura\'s "Ontem" carried through Todas never becomes another store\'s running day', async () => {
    // Atribuição on Hibikura · Ontem → Todas (components/attribution/allStoresLink).
    const todas = await getPageContext({ loja: ALL_STORES, periodo: 'custom', de: '2026-11-24', ate: '2026-11-24', volta: 'yesterday' }, { scope: 'all', now: AFTERNOON })
    expect(todas.period).toBe('custom')
    expect(todas.rowDatesOf).toBe('Hibikura')
    // An old link that still carries volta to the MOKOO (resumoLinkOverrides now gives that row plain dates) and the sidebar's
    // Resumo (carries loja=todas; shows the remembered store, the MOKOO).
    for (const href of [`/?loja=${MOKOO.id}&periodo=custom&de=2026-11-24&ate=2026-11-24&volta=yesterday`, todas.navHref('/')]) {
      const mokoo = await getPageContext(query(href), { scope: 'store', now: AFTERNOON })
      expect(mokoo.store?.id).toBe(MOKOO.id)
      expect(mokoo.period).toBe('yesterday')
      expect(mokoo.range).toEqual({ from: '2026-11-23', to: '2026-11-23' })
      expect(mokoo.params.volta).toBeUndefined()
      expect(mokoo.rowDatesOf).toBeNull()
    }
    // The Hibikura row: its own "Ontem", by name.
    const hib = await getPageContext({ loja: HIB.id, periodo: 'custom', de: '2026-11-24', ate: '2026-11-24', volta: 'yesterday' }, { now: AFTERNOON })
    expect(hib.period).toBe('yesterday')
    expect(hib.range).toEqual({ from: '2026-11-24', to: '2026-11-24' })
  })

  it('a store page on Todas\' row dates says they are Todas\'', async () => {
    const hib = await getPageContext({ loja: HIB.id, periodo: 'custom', de: '2026-11-24', ate: '2026-11-24', volta: 'today' }, { now: AFTERNOON })
    expect(hib.period).toBe('custom')
    expect(hib.rowDatesOf).toBe('Todas as lojas')
    expect(rowDatesOf({ periodo: 'custom', de: '2026-11-24', ate: '2026-11-24' }, 'all', STORES, AFTERNOON)).toBeNull()
  })
})
