import { beforeEach, describe, expect, it, vi } from 'vitest'

// lib/access (cookies, database) and the store facts are answered here.
vi.mock('../../access', () => ({ getViewer: vi.fn(), listStores: vi.fn(), resolveStore: vi.fn(), ACTIVE_STORE_COOKIE: 'active_store_id' }))
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }))
vi.mock('next/headers', () => ({ cookies: vi.fn() }))
vi.mock('../periodFacts', () => ({ viewerStoresOf: vi.fn() }))

import { getViewer, listStores, type StoreRef } from '../../access'
import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { viewerStoresOf } from '../periodFacts'
import { viewerStores } from '../../period/viewer'
import { ALL_STORES, clockLabel, getPageContext, pageMetadata, toStoreOption, type SearchParams } from '../page'

const sp = (o: SearchParams) => Promise.resolve(o)

describe('pageMetadata (regression: 404s kept the page title, e.g. "Resumo · Opero")', () => {
  const stores = [{ id: 'user_3CV', archived: false }, { id: 'old', archived: true }]

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
})

/**
 * getPageContext on lib/period: parseDesktop → one canonical redirect →
 * resolve. Brasília 24 nov 2026 14:47 (Tokyo 25 nov 02:47).
 */
describe('getPageContext (lib/period)', () => {
  const AT = new Date('2026-11-24T17:47:00Z')
  const ref = (id: string, name: string, timezone: string, archived = false): StoreRef =>
    ({ id, name, shopName: name, domain: `${id}-x.myshopify.com`, timezone, archived, userId: null })
  const MOKOO = ref('mokoo', 'MOKOO', 'America/Belem')
  const HIB = ref('hib', 'Hibikura', 'Asia/Tokyo')
  const SQUISHY = ref('squishy', 'Squishy World', 'America/Sao_Paulo', true)
  const ALL = [MOKOO, HIB, SQUISHY]
  let remembered: string | undefined

  beforeEach(() => {
    remembered = 'mokoo'
    vi.mocked(getViewer).mockResolvedValue({ kind: 'owner' })
    vi.mocked(listStores).mockResolvedValue(ALL)
    vi.mocked(cookies).mockResolvedValue({ get: (k: string) => (k === 'active_store_id' && remembered ? { value: remembered } : undefined) } as never)
    vi.mocked(viewerStoresOf).mockResolvedValue(viewerStores([
      { id: 'mokoo', name: 'MOKOO', timezone: 'America/Belem', archived: false, firstOrderDate: '2026-04-11', firstActivityDate: '2026-02-18' },
      { id: 'hib', name: 'Hibikura', timezone: 'Asia/Tokyo', archived: false, firstOrderDate: '2026-11-07', firstActivityDate: '2026-11-07' },
      { id: 'squishy', name: 'Squishy World', timezone: 'America/Sao_Paulo', archived: true, archivedAt: '2026-11-10T13:00:00.000Z', firstOrderDate: '2025-01-10', firstActivityDate: '2025-01-10' },
    ]))
    vi.mocked(redirect).mockReset()
    vi.mocked(redirect).mockImplementation((url: string) => { throw new Error(`REDIRECT ${url}`) })
    vi.mocked(notFound).mockImplementation(() => { throw new Error('NEXT_NOT_FOUND') })
  })

  it('a store-only page opened with loja=todas redirects once to the remembered store, with vem=todas', async () => {
    await expect(getPageContext({ loja: 'todas', periodo: 'today' }, { path: '/', scope: 'store', now: AT }))
      .rejects.toThrow('REDIRECT /?loja=mokoo&periodo=today&vem=todas')
  })

  it('an invalid remembered store is cleared through the forget route', async () => {
    remembered = 'squishy'
    await expect(getPageContext({}, { path: '/', scope: 'store', now: AT }))
      .rejects.toThrow(`REDIRECT /api/active-store/forget?to=${encodeURIComponent('/?loja=hib&ajuste=remembered_gone%3Asquishy')}`)
  })

  it('a canonical URL renders; the landing note announces the dates vem came from', async () => {
    const ctx = await getPageContext({ loja: 'hib', periodo: 'today', vem: 'todas' }, { path: '/', scope: 'store', now: new Date('2026-11-24T19:00:00Z') })
    expect(ctx.range).toEqual({ from: '2026-11-25', to: '2026-11-25' })
    expect(ctx.cameFrom).toEqual({ kind: 'all' })
    expect(ctx.noteLine).toBe('Hoje na Hibikura é 25 nov (dia de Tóquio). Em Todas as lojas, Hoje é 24 nov.')
    expect(ctx.storeOption!.dayLabel).toBe('dia de Tóquio')
    expect(clockLabel(ctx)).toBe('Tóquio')
  })

  it('an archived store: clamped at its archive instant, no running day, compared on the days read', async () => {
    const ctx = await getPageContext({ loja: 'squishy', periodo: 'mtd' }, { path: '/', scope: 'store', now: AT })
    expect(ctx.archivedOn).toBe('2026-11-10')
    expect(ctx.readRange).toEqual({ from: '2026-11-01', to: '2026-11-10' })
    expect(ctx.partial).toBe(false)
    expect(ctx.comparisonText).toBe('vs mesmos dias do mês passado (1–10 out, até 10h00, hora do arquivamento)')
    expect(ctx.range).toEqual({ from: '2026-11-01', to: '2026-11-24' })
  })

  it('hrefWith keeps the selection; a loja override is an R4 link with vem; a period override sets it', async () => {
    const ctx = await getPageContext({ loja: 'mokoo', periodo: 'mtd' }, { path: '/campaigns', now: AT })
    expect(ctx.hrefWith('/products')).toBe('/products?loja=mokoo&periodo=mtd')
    expect(ctx.hrefWith('/', { loja: 'hib' })).toBe('/?loja=hib&periodo=mtd&vem=mokoo')
    expect(ctx.hrefWith('/overview', { loja: null })).toBe('/overview?loja=todas&periodo=mtd&vem=mokoo')
    expect(ctx.hrefWith('/campaigns', { periodo: 'custom', de: '2026-11-01', ate: '2026-11-10' }))
      .toBe('/campaigns?loja=mokoo&periodo=custom&de=2026-11-01&ate=2026-11-10')
    expect(ctx.scopeHref('/', { kind: 'store', id: 'nobody' })).toBeNull()
  })

  it('F9 (period-fix-r1) · a fitted window is said on the header line, not only in the chip title', async () => {
    const ctx = await getPageContext({ loja: 'mokoo', periodo: 'custom', de: '2026-11-28', ate: '2026-11-30' }, { path: '/', scope: 'store', now: AT })
    expect(ctx.rangeNote).toBe('28–30 nov ainda não começou em Belém: mostrando Hoje (24 nov).')
    expect(ctx.noteLine).toBe('28–30 nov ainda não começou em Belém: mostrando Hoje (24 nov).')
  })

  it('F7 (period-fix-r1) · the Todas header names a dates range once', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const { createElement } = await import('react')
    const { PageHeader } = await import('../../../components/shell/PageHeader')
    const ctx = await getPageContext({ loja: 'todas', periodo: 'custom', de: '2025-12-25', ate: '2026-01-03' }, { path: '/overview', scope: 'all', now: AT })
    const html = renderToStaticMarkup(createElement(PageHeader, { ctx, title: 'Todas as lojas', code: null }))
    expect(html.split('25 dez 2025 – 3 jan 2026').length - 1).toBe(1)
    expect(html).toContain('2 lojas')
  })

  it('F11 (period-fix-r1) · an unknown aba or key does not survive the canonical redirect', async () => {
    await expect(getPageContext({ loja: 'mokoo', aba: 'xx', foo: 'bar', modelo: 'ultimo' }, { path: '/campaigns', now: AT }))
      .rejects.toThrow('REDIRECT /campaigns?loja=mokoo')
    // Ajustes keeps its own OAuth flags (declared), and only them.
    await expect(getPageContext({ loja: 'mokoo', fb_connected: 'true', foo: 'bar' }, { path: '/settings', scope: 'store', now: AT }))
      .rejects.toThrow('REDIRECT /settings?loja=mokoo&fb_connected=true')
  })

  it('a store the viewer cannot see is a 404', async () => {
    await expect(getPageContext({ loja: 'nobody' }, { path: '/', scope: 'store', now: AT })).rejects.toThrow('NEXT_NOT_FOUND')
  })

  it('toStoreOption: "dia de Tóquio" from the UTC offset, not a name list', () => {
    expect(toStoreOption(HIB, AT).dayLabel).toBe('dia de Tóquio')
    expect(toStoreOption(MOKOO, AT).dayLabel).toBeNull()
    expect(toStoreOption(MOKOO, AT).code).toBe('mokoo')
  })
})
