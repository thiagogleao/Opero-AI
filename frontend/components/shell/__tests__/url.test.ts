import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  beginNavigation, detailRoute, endNavigation, IN_FLIGHT_TTL_MS, inFlightParam, isStoreOnlyPath, layerHref, mergeQuery, NAV_LAYER,
  navigationInFlight, onTopOfInFlight, pickIsNoop, storeSwitchHref,
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
    // A campaign filter names one store's campaign: EPOCH has no such campaign, and picking the
    // MOKOO again must not bring the old filter back.
    expect(storeSwitchHref('/campaigns', `?loja=${EPOCH}&periodo=30d`, `?loja=${MOKOO}&periodo=30d&aba=criativos&campanha=120249693763810625&mostrar=todos`)).toBe(`/campaigns?loja=${EPOCH}&periodo=30d&aba=criativos`)
  })

  it('keeps the campaign filter on a period change (same store, same campaign)', () => {
    expect(mergeQuery(`?loja=${MOKOO}&periodo=30d`, `?loja=${MOKOO}&aba=criativos&campanha=120249693763810625&mostrar=todos`))
      .toBe(`?loja=${MOKOO}&periodo=30d&aba=criativos&campanha=120249693763810625&mostrar=todos`)
  })

  it('drops the campaign filter when a store is picked while a period change on it still loads', () => {
    const opening = `/campaigns?loja=${MOKOO}&periodo=30d&aba=criativos&campanha=120249693763810625`
    const storeFromScreen = storeSwitchHref('/campaigns', `?loja=${EPOCH}`, `?loja=${MOKOO}&aba=criativos&campanha=120249693763810625`)
    expect(layerHref(opening, storeFromScreen, NAV_LAYER.store)).toBe(`/campaigns?loja=${EPOCH}&periodo=30d&aba=criativos`)
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

describe('pickIsNoop (regression: on a one-store page opened from Todas, the store on screen could not be picked)', () => {
  it('the store the URL names is the current choice; picking it again does nothing', () => {
    expect(pickIsNoop(MOKOO, MOKOO)).toBe(true)
    expect(pickIsNoop(EPOCH, MOKOO)).toBe(false)
    expect(pickIsNoop('todas', 'todas')).toBe(true)
  })

  it('Resumo opened from Todas shows MOKOO: picking MOKOO pins it, picking Todas opens /overview', () => {
    expect(pickIsNoop(MOKOO, MOKOO, 'todas')).toBe(false)
    expect(pickIsNoop('todas', MOKOO, 'todas')).toBe(false)
    expect(pickIsNoop(EPOCH, MOKOO, 'todas')).toBe(false)
  })

  it('a navigation still loading decides what is current, as before', () => {
    expect(pickIsNoop(GLOOTY, MOKOO, 'todas', `/?loja=${GLOOTY}`)).toBe(true)
    expect(pickIsNoop(MOKOO, MOKOO, 'todas', `/?loja=${GLOOTY}`)).toBe(false)
    expect(pickIsNoop('todas', MOKOO, 'todas', `/?loja=${GLOOTY}`)).toBe(false)
    // null: nothing loads, the screen decides.
    expect(pickIsNoop(MOKOO, MOKOO, undefined, null)).toBe(true)
    // A URL without loja shows the remembered store: never Todas.
    expect(pickIsNoop('todas', 'todas', undefined, '/campaigns?periodo=today')).toBe(false)
    expect(pickIsNoop(MOKOO, MOKOO, undefined, '/campaigns?periodo=today')).toBe(true)
  })

  // Regression: on a Resumo opened from Todas, "Ontem" then "Todas as lojas"
  // while it loaded did nothing — the period picker's URL carries loja=todas,
  // read as "already Todas" — and the Resumo landed still on the MOKOO.
  it('a one-store page still loading with loja=todas only carries Todas: every entry still navigates', () => {
    const periodOnResumo = '/?loja=todas&periodo=yesterday'
    expect(pickIsNoop('todas', MOKOO, 'todas', periodOnResumo)).toBe(false)
    expect(pickIsNoop(MOKOO, MOKOO, 'todas', periodOnResumo)).toBe(false)
    expect(pickIsNoop(EPOCH, MOKOO, 'todas', periodOnResumo)).toBe(false)
    // The same from the other one-store pages, and a sidebar link from Todas to one of them.
    expect(pickIsNoop('todas', MOKOO, 'todas', '/attribution?loja=todas&parte=50')).toBe(false)
    expect(pickIsNoop('todas', MOKOO, 'todas', '/profit?loja=todas&periodo=30d')).toBe(false)
    expect(pickIsNoop('todas', MOKOO, 'todas', '/settings?loja=todas#lojas')).toBe(false)
    expect(pickIsNoop('todas', 'todas', undefined, '/?loja=todas')).toBe(false)
  })

  it('a page that shows Todas still loading is Todas: picking it again changes nothing', () => {
    // A period on /overview, or on Campanhas · Todas.
    expect(pickIsNoop('todas', 'todas', undefined, '/overview?loja=todas&periodo=yesterday')).toBe(true)
    expect(pickIsNoop('todas', 'todas', undefined, '/campaigns?loja=todas&periodo=yesterday')).toBe(true)
    // Todas picked on a store-pinned page (opens /overview), then picked again.
    expect(pickIsNoop('todas', MOKOO, undefined, '/overview?loja=todas')).toBe(true)
    // From a Resumo opened from Todas, a sidebar link to Campanhas (which shows
    // Todas) is not undone by "Todas as lojas" — it would open /overview instead.
    expect(pickIsNoop('todas', MOKOO, 'todas', '/campaigns?loja=todas')).toBe(true)
    expect(pickIsNoop(MOKOO, MOKOO, 'todas', '/campaigns?loja=todas')).toBe(false)
  })
})

describe('isStoreOnlyPath', () => {
  it('matches each one-store page and its subpaths, and only those', () => {
    for (const p of ['/', '/attribution', '/profit', '/settings', '/settings/chaves', '/facebook/accounts', '/creatives/120249693989210625']) {
      expect(isStoreOnlyPath(p), p).toBe(true)
    }
    for (const p of ['/overview', '/campaigns', '/products', '/countries', '/dev/ui', '/profits', '/settingsx']) {
      expect(isStoreOnlyPath(p), p).toBe(false)
    }
  })

  // The list repeats what each page asks getPageContext for; this keeps the two
  // from drifting apart (a page moved to scope 'store' without the list would
  // let "Todas as lojas" do nothing again while it loads).
  it('agrees with the scope every shell page asks getPageContext for', () => {
    const appDir = path.resolve(__dirname, '../../../app')
    const pages: string[] = []
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name)
        if (e.isDirectory()) walk(full)
        else if (e.name === 'page.tsx') pages.push(full)
      }
    }
    walk(appDir)
    let checked = 0
    for (const file of pages) {
      const src = readFileSync(file, 'utf8')
      const usesShell = /getPageContext\(|<PickerPage\b/.test(src)
      if (!usesShell) continue
      const storeOnly = /scope:\s*'store'/.test(src) || /<PickerPage\b/.test(src)
      const route = '/' + path.relative(appDir, path.dirname(file)).split(path.sep)
        .filter(seg => seg && !/^\(.*\)$/.test(seg))
        .map(seg => (seg.startsWith('[') ? 'x' : seg))
        .join('/')
      expect(isStoreOnlyPath(route), `${route} (${path.relative(appDir, file)})`).toBe(storeOnly)
      checked++
    }
    expect(checked).toBeGreaterThanOrEqual(10)
  })
})

// ─── Row dates (?volta) are page state (regression) ──────────────────────────
// volta was not a state key, so the shell copied it from the URL on screen into
// every URL its pickers built: dates picked after a Todas row link opened as
// "?…&periodo=custom&de=2026-11-01&ate=2026-11-10&volta=today", and the server
// read them as stale row dates and showed "Hoje". It followed preset clicks
// and the store picker too. Only the server-built query may carry it now.
describe('volta is page state: only the server-built query carries it', () => {
  const row = `?loja=${HIBIKURA}&periodo=custom&de=2026-11-24&ate=2026-11-24&volta=today`

  it('dates picked, a preset or a store never pick up the volta on screen', () => {
    expect(mergeQuery(`?loja=${HIBIKURA}&periodo=custom&de=2026-11-01&ate=2026-11-10`, `${row}&aba=criativos`))
      .toBe(`?loja=${HIBIKURA}&periodo=custom&de=2026-11-01&ate=2026-11-10&aba=criativos`)
    expect(mergeQuery(`?loja=${HIBIKURA}&periodo=30d`, row)).toBe(`?loja=${HIBIKURA}&periodo=30d`)
    // A stale one left by an older build is dropped as well.
    expect(mergeQuery(`?loja=${MOKOO}&periodo=custom&de=2026-11-01&ate=2026-11-10`, `?loja=${MOKOO}&periodo=7d&volta=today`))
      .toBe(`?loja=${MOKOO}&periodo=custom&de=2026-11-01&ate=2026-11-10`)
    expect(storeSwitchHref('/products', `?loja=${MOKOO}&periodo=today`, row)).toBe(`/products?loja=${MOKOO}&periodo=today`)
  })

  it('keeps the volta the server put in the query (the split toggle on row dates)', () => {
    expect(mergeQuery(`${row}&parte=50`, row)).toBe(`${row}&parte=50`)
  })

  it('a period chosen while a row link loads replaces its dates and its volta', () => {
    const opening = `/${row}`
    expect(layerHref(opening, `/?loja=${HIBIKURA}&periodo=custom&de=2026-11-01&ate=2026-11-10`, NAV_LAYER.period))
      .toBe(`/?loja=${HIBIKURA}&periodo=custom&de=2026-11-01&ate=2026-11-10`)
    expect(layerHref(opening, `/overview?loja=todas&periodo=30d`, NAV_LAYER.period)).toBe(`/?loja=${HIBIKURA}&periodo=30d`)
  })

  it('a store chosen while a row link loads gets the preset back, as buildHref does', () => {
    const opening = `/products${row}`
    expect(layerHref(opening, `/products?loja=${MOKOO}&periodo=today`, NAV_LAYER.store)).toBe(`/products?loja=${MOKOO}&periodo=today`)
    expect(layerHref(`/${row.replace('volta=today', 'volta=7d')}`, `/overview?loja=todas`, NAV_LAYER.store)).toBe('/overview?loja=todas&periodo=7d')
    // The same store keeps its row dates; so do the split toggle and a sidebar link.
    expect(layerHref(opening, `/products?loja=${HIBIKURA}`, NAV_LAYER.store)).toBe(`/products${row}`)
    expect(layerHref(opening, `/products?loja=${HIBIKURA}&parte=50`, NAV_LAYER.split)).toBe(`/products${row}&parte=50`)
    expect(layerHref(opening, `/campaigns?loja=${EPOCH}`, NAV_LAYER.link)).toBe(`/campaigns${row}`)
  })
})
