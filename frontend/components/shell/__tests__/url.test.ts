import { describe, expect, it } from 'vitest'
import {
  beginNavigation, detailRoute, endNavigation, IN_FLIGHT_TTL_MS, inFlightParam, layerHref, mergeQuery, NAV_LAYER,
  navigationInFlight, onTopOfInFlight, storeSwitchHref,
} from '../url'

const MOKOO = 'user_3CVoVQYfnj1Ljnm3tf0iHP40fxX'
const EPOCH = '73a1d3b1-45ff-410a-af37-93f95a591e6e'
const GLOOTY = '5071bfb6-61c8-431f-8837-1b546f7e4f38'

describe('mergeQuery', () => {
  it('lets the state query win and keeps the page’s own keys', () => {
    expect(mergeQuery(`?loja=${GLOOTY}&periodo=30d`, `?loja=${MOKOO}&aba=criativos`))
      .toBe(`?loja=${GLOOTY}&periodo=30d&aba=criativos`)
  })

  it('drops the one-shot OAuth result flags: a banner about store A never follows to store B', () => {
    expect(mergeQuery(`?loja=${GLOOTY}`, `?loja=${MOKOO}&fb_connected=true`)).toBe(`?loja=${GLOOTY}`)
    expect(mergeQuery(
      `?loja=${GLOOTY}`,
      `?loja=${MOKOO}&shopify_connected=true&shopify_error=x&error=y&fb_extra_connected=true&fb_error=z&store=${MOKOO}&storeStartDate=2026-11-01&aba=chaves`,
    )).toBe(`?loja=${GLOOTY}&aba=chaves`)
  })

  it('drops them on a period or split change too (same store, new view)', () => {
    expect(mergeQuery(`?loja=${MOKOO}&periodo=today`, `?loja=${MOKOO}&fb_connected=true`)).toBe(`?loja=${MOKOO}&periodo=today`)
    expect(mergeQuery(`?loja=${MOKOO}&parte=50`, `?loja=${MOKOO}&shopify_error=denied`)).toBe(`?loja=${MOKOO}&parte=50`)
  })
})

describe('store switch from a page of one store’s object', () => {
  it('knows the creative page belongs to Campanhas', () => {
    expect(detailRoute('/creatives/120249693989210625')?.nav).toBe('/campaigns')
    expect(detailRoute('/campaigns')).toBeNull()
    expect(detailRoute('/creatives')).toBeNull()
  })

  it('opens the chosen store’s creatives list, keeping the period, instead of the other store’s ad (a 404)', () => {
    const href = storeSwitchHref('/creatives/120249693989210625', `?loja=${EPOCH}&periodo=30d`, `?loja=${MOKOO}&periodo=30d`)
    const u = new URL(href, 'http://x')
    expect(u.pathname).toBe('/campaigns')
    expect(Object.fromEntries(u.searchParams)).toEqual({ loja: EPOCH, periodo: '30d', aba: 'criativos' })
  })

  it('does not carry the ad page’s own keys to the list', () => {
    const href = storeSwitchHref('/creatives/1', `?loja=${EPOCH}`, `?loja=${MOKOO}&ordem=gasto`)
    expect(href).toBe(`/campaigns?loja=${EPOCH}&aba=criativos`)
  })

  it('reloads any other page with its own keys', () => {
    expect(storeSwitchHref('/campaigns', `?loja=${EPOCH}`, `?loja=${MOKOO}&aba=criativos`)).toBe(`/campaigns?loja=${EPOCH}&aba=criativos`)
    expect(storeSwitchHref('/settings', `?loja=${GLOOTY}`, `?loja=${MOKOO}&fb_connected=true`)).toBe(`/settings?loja=${GLOOTY}`)
  })
})

// ─── Two quick choices (regression: the second one undid the first) ──────────
// The store picker and the period picker build their URLs from the state on
// screen. Hibikura picked on EPOCH · 30 dias, then "7 dias" clicked while it
// still said "abrindo…", landed on EPOCH · 7 dias; "30 dias" then Glooty
// landed on Glooty · 7 dias.

const HIBIKURA = '0344f31b-bd37-4674-8696-7555f3d98417'

describe('layerHref: a choice laid on top of the URL being opened', () => {
  it('repro A: store first, then period → Hibikura + 7 dias', () => {
    const opening = `/countries?loja=${HIBIKURA}&periodo=30d`
    const periodFromScreen = `/countries?loja=${EPOCH}` // 7 dias = default, no periodo
    expect(layerHref(opening, periodFromScreen, NAV_LAYER.period)).toBe(`/countries?loja=${HIBIKURA}`)
  })

  it('repro B: period first, then store → Glooty + 30 dias', () => {
    const opening = `/products?loja=${MOKOO}&periodo=30d`
    const storeFromScreen = `/products?loja=${GLOOTY}&periodo=7d`
    expect(layerHref(opening, storeFromScreen, NAV_LAYER.store)).toBe(`/products?loja=${GLOOTY}&periodo=30d`)
  })

  it('a custom range replaces the whole period, and a preset drops de/ate', () => {
    const opening = `/products?loja=${GLOOTY}&periodo=30d`
    expect(layerHref(opening, `/products?loja=${MOKOO}&periodo=custom&de=2026-10-28&ate=2026-11-03`, NAV_LAYER.period))
      .toBe(`/products?loja=${GLOOTY}&periodo=custom&de=2026-10-28&ate=2026-11-03`)
    expect(layerHref(`/products?loja=${GLOOTY}&periodo=custom&de=2026-10-28&ate=2026-11-03`, `/products?loja=${MOKOO}&periodo=today`, NAV_LAYER.period))
      .toBe(`/products?loja=${GLOOTY}&periodo=today`)
  })

  it('the store picker decides the page; the period stays on the page being opened', () => {
    // On Todas (/overview) a store opens the Resumo: a period picked meanwhile follows it there.
    expect(layerHref(`/?loja=${MOKOO}`, `/overview?loja=todas&periodo=today`, NAV_LAYER.period)).toBe(`/?loja=${MOKOO}&periodo=today`)
    // A period loading on /overview, then a store: the Resumo of the store, with that period.
    expect(layerHref(`/overview?loja=todas&periodo=today`, `/?loja=${MOKOO}`, NAV_LAYER.store)).toBe(`/?loja=${MOKOO}&periodo=today`)
    // Taking the store choice back (Todas while MOKOO's Resumo loads) stays on /overview.
    expect(layerHref(`/?loja=${MOKOO}&periodo=today`, `/overview?loja=todas`, NAV_LAYER.store)).toBe('/overview?loja=todas&periodo=today')
  })

  it('keeps the page keys of the page that wins, never a one-shot flag', () => {
    // A creative's page: the other store opens its creatives list, with the period loading.
    expect(layerHref(`/creatives/1?loja=${MOKOO}&periodo=30d`, `/campaigns?loja=${EPOCH}&aba=criativos`, NAV_LAYER.store))
      .toBe(`/campaigns?loja=${EPOCH}&periodo=30d&aba=criativos`)
    // Then a period while that list loads: the list keeps its tab.
    expect(layerHref(`/campaigns?loja=${EPOCH}&aba=criativos`, `/creatives/1?loja=${MOKOO}&periodo=today`, NAV_LAYER.period))
      .toBe(`/campaigns?loja=${EPOCH}&periodo=today&aba=criativos`)
    expect(layerHref(`/settings?loja=${GLOOTY}&fb_connected=true&aba=chaves`, `/settings?loja=${MOKOO}&parte=50`, NAV_LAYER.split))
      .toBe(`/settings?loja=${GLOOTY}&parte=50&aba=chaves`)
  })

  it('a sidebar link opens its page with the state being opened', () => {
    expect(layerHref(`/countries?loja=${HIBIKURA}&periodo=30d`, `/campaigns?loja=${EPOCH}&periodo=30d`, NAV_LAYER.link))
      .toBe(`/campaigns?loja=${HIBIKURA}&periodo=30d`)
  })
})

describe('the navigation in flight', () => {
  it('is used only while it loads, and only its own token ends it', () => {
    const t0 = 1_000_000
    expect(onTopOfInFlight(`/products?loja=${GLOOTY}`, NAV_LAYER.store, t0)).toBe(`/products?loja=${GLOOTY}`)
    const first = beginNavigation(`/products?loja=${MOKOO}&periodo=30d`, t0)
    expect(inFlightParam('periodo', t0)).toBe('30d')
    expect(inFlightParam('parte', t0)).toBeNull()
    const second = beginNavigation(onTopOfInFlight(`/products?loja=${GLOOTY}&periodo=7d`, NAV_LAYER.store, t0), t0)
    expect(navigationInFlight(t0)).toBe(`/products?loja=${GLOOTY}&periodo=30d`)
    endNavigation(first) // the replaced navigation's control finishing changes nothing
    expect(navigationInFlight(t0)).toBe(`/products?loja=${GLOOTY}&periodo=30d`)
    endNavigation(second)
    expect(navigationInFlight(t0)).toBeNull()
    expect(inFlightParam('loja', t0)).toBeUndefined()
  })

  it('a navigation that never reported back stops counting after the safety window', () => {
    const t0 = 2_000_000
    const tok = beginNavigation(`/?loja=${MOKOO}`, t0)
    expect(navigationInFlight(t0 + IN_FLIGHT_TTL_MS - 1)).toBe(`/?loja=${MOKOO}`)
    expect(navigationInFlight(t0 + IN_FLIGHT_TTL_MS + 1)).toBeNull()
    expect(onTopOfInFlight(`/?loja=${EPOCH}&periodo=today`, NAV_LAYER.period, t0 + IN_FLIGHT_TTL_MS + 1)).toBe(`/?loja=${EPOCH}&periodo=today`)
    endNavigation(tok)
  })
})
