import { describe, expect, it, vi } from 'vitest'

// buildHref lives next to getPageContext; keep its server imports inert.
vi.mock('@/lib/access', () => ({ getViewer: vi.fn(), listStores: vi.fn(), resolveStore: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }))

import { allStoresWindow } from '../allStoresLink'
import { REFERENCE_TZ, resolveRange, type Period } from '@/lib/engine/dates'
import { ALL_STORES, buildHref, type PageParams } from '@/lib/views/page'

const HIBIKURA = '0344f31b'
const TOKYO = 'Asia/Tokyo'
// 18 nov, 15h20 in Brasília = 19 nov, 03h20 in Tokyo.
const NOW = new Date('2026-11-18T18:20:00Z')

/** The link's overrides for a store on `tz`, as the page computes them. */
function linkFor(period: Period, tz: string, now = NOW) {
  const page = { period, range: resolveRange(period, tz, null, null, now) }
  const all = { range: resolveRange(period, REFERENCE_TZ, null, null, now), today: resolveRange('today', REFERENCE_TZ, null, null, now).to }
  return allStoresWindow(page, all)
}

describe('allStoresWindow: one store → Todas keeps the days on screen', () => {
  it('same calendar: every period travels by name', () => {
    for (const p of ['today', 'yesterday', '7d', '30d', 'mtd', 'lastmonth'] as const) {
      expect(linkFor(p, 'America/Belem')).toEqual({})
    }
  })

  it('a custom window already carries its dates', () => {
    expect(allStoresWindow(
      { period: 'custom', range: { from: '2026-10-28', to: '2026-11-03' } },
      { range: { from: '2026-11-18', to: '2026-11-18' }, today: '2026-11-18' },
    )).toEqual({})
  })

  it("Tokyo's ontem and 7 dias after noon in Brasília travel as their exact dates", () => {
    expect(linkFor('yesterday', TOKYO)).toEqual({ periodo: 'custom', de: '2026-11-18', ate: '2026-11-18' })
    expect(linkFor('7d', TOKYO)).toEqual({ periodo: 'custom', de: '2026-11-12', ate: '2026-11-18' })
  })

  it('Mês passado keeps its name mid-month, and travels as dates on Tokyo\'s 1st', () => {
    expect(linkFor('lastmonth', TOKYO)).toEqual({})
    // 30 nov, 15h in Brasília = 1 dez in Tokyo: "Mês passado" is November there.
    expect(linkFor('lastmonth', TOKYO, new Date('2026-11-30T18:00:00Z')))
      .toEqual({ periodo: 'custom', de: '2026-11-01', ate: '2026-11-30' })
  })

  it("a window past Brasília's today (Tokyo's hoje, este mês) keeps the period name", () => {
    expect(linkFor('today', TOKYO)).toEqual({})
    expect(linkFor('mtd', TOKYO)).toEqual({})
  })

  it('the link keeps parte and a custom window (hrefWith rules)', () => {
    const custom: PageParams = { loja: HIBIKURA, periodo: 'custom', de: '2026-10-28', ate: '2026-11-03', parte: true }
    const page = { period: custom.periodo, range: { from: '2026-10-28', to: '2026-11-03' } }
    const all = { range: { from: '2026-11-18', to: '2026-11-18' }, today: '2026-11-18' }
    expect(buildHref('/overview', custom, { loja: ALL_STORES, ...allStoresWindow(page, all) }))
      .toBe('/overview?loja=todas&periodo=custom&de=2026-10-28&ate=2026-11-03&parte=50')

    const yesterday: PageParams = { loja: HIBIKURA, periodo: 'yesterday', de: null, ate: null, parte: true }
    expect(buildHref('/overview', yesterday, { loja: ALL_STORES, ...linkFor('yesterday', TOKYO) }))
      .toBe('/overview?loja=todas&periodo=custom&de=2026-11-18&ate=2026-11-18&parte=50')
  })
})
