import { describe, expect, it } from 'vitest'
import { addStoreHref, askedStoreId } from '../storeParam'
import { ALL_STORES, buildHref, carriedLoja, parsePageParams, type HrefOverrides, type SearchParams } from '@/lib/views/page'

const MOKOO = 'user_3CVoVQYfnj1Ljnm3tf0iHP40fxX'

/** Ajustes' context as getPageContext builds it for an owner (scope 'store'):
 *  the store on screen in `params`, the carried loja in `navParams`. */
function settingsCtx(sp: SearchParams, shown = MOKOO) {
  const raw = parsePageParams(sp)
  const params = { ...raw, loja: shown }
  const navParams = { ...params, loja: carriedLoja(raw.loja, 'store', true, shown) }
  return {
    fromAll: navParams.loja === ALL_STORES,
    hrefWith: (p: string, o?: HrefOverrides) => buildHref(p, params, o),
    navHref: (p: string, o?: HrefOverrides) => buildHref(p, navParams, o),
  }
}

/** Onboarding's "Voltar para Ajustes" for a URL (app/onboarding/page.tsx). */
function onboardingBack(href: string): string {
  const sp = Object.fromEntries(new URLSearchParams(href.split('?')[1] ?? ''))
  return buildHref('/settings', parsePageParams({ ...sp, loja: sp.loja ?? sp.store }))
}

describe('addStoreHref — Ajustes → Adicionar loja → Voltar para Ajustes', () => {
  it('opened from Todas, keeps loja=todas so the round trip comes back to Todas', () => {
    const href = addStoreHref(settingsCtx({ loja: 'todas', periodo: '30d', parte: '50' }))
    expect(href).toBe('/onboarding?loja=todas&periodo=30d&parte=50&addStore=true')
    // Onboarding reads Todas as no store: a new connection starts.
    expect(askedStoreId(Object.fromEntries(new URLSearchParams(href.split('?')[1])), { legacyStoreKey: true })).toBeNull()
    expect(onboardingBack(href)).toBe('/settings?loja=todas&periodo=30d&parte=50')
  })

  it('opened from Todas with dates read on another clock, keeps them and their preset', () => {
    const href = addStoreHref(settingsCtx({ loja: 'todas', periodo: 'custom', de: '2026-11-24', ate: '2026-11-24', volta: 'today' }))
    expect(href).toBe('/onboarding?loja=todas&periodo=custom&de=2026-11-24&ate=2026-11-24&volta=today&addStore=true')
    expect(onboardingBack(href)).toBe('/settings?loja=todas&periodo=custom&de=2026-11-24&ate=2026-11-24&volta=today')
  })

  it('opened on a store, never carries its id: onboarding would continue that store\'s setup', () => {
    for (const sp of [{ loja: MOKOO, periodo: '30d' }, { periodo: '30d' }] as SearchParams[]) {
      const href = addStoreHref(settingsCtx(sp))
      expect(href).toBe('/onboarding?periodo=30d&addStore=true')
      expect(askedStoreId(Object.fromEntries(new URLSearchParams(href.split('?')[1])), { legacyStoreKey: true })).toBeNull()
    }
  })

  it('a one-store viewer asking for Todas carries no Todas (carriedLoja gives the store)', () => {
    const raw = parsePageParams({ loja: 'todas' })
    const params = { ...raw, loja: MOKOO }
    const navParams = { ...params, loja: carriedLoja(raw.loja, 'store', false, MOKOO) }
    const href = addStoreHref({
      fromAll: navParams.loja === ALL_STORES,
      hrefWith: (p, o) => buildHref(p, params, o),
      navHref: (p, o) => buildHref(p, navParams, o),
    })
    expect(href).toBe('/onboarding?addStore=true')
  })
})

describe('askedStoreId — the store a settings page opens from the URL', () => {
  it('?loja=todas names no store: /onboarding starts a new connection instead of a 404', () => {
    // Every other page accepts Todas; /onboarding?loja=todas showed "Não
    // encontramos esta página" under the tab title "Adicionar loja".
    expect(askedStoreId({ loja: 'todas' })).toBeNull()
    expect(askedStoreId({ loja: 'todas' }, { legacyStoreKey: true })).toBeNull()
    expect(askedStoreId({ loja: ' todas ' }, { legacyStoreKey: true })).toBeNull()
  })

  it('reads ?loja first, then the older ?store only when the page accepts it', () => {
    expect(askedStoreId({ loja: 'abc' })).toBe('abc')
    expect(askedStoreId({ store: 'abc' })).toBeNull()
    expect(askedStoreId({ store: 'abc' }, { legacyStoreKey: true })).toBe('abc')
    expect(askedStoreId({ loja: 'x', store: 'y' }, { legacyStoreKey: true })).toBe('x')
    // An explicit Todas wins over a legacy key, as the tab title always read it.
    expect(askedStoreId({ loja: 'todas', store: 'y' }, { legacyStoreKey: true })).toBeNull()
  })

  it('trims, ignores blanks and takes the first of repeated keys', () => {
    expect(askedStoreId({ loja: '  abc ' })).toBe('abc')
    expect(askedStoreId({ loja: '   ' })).toBeNull()
    expect(askedStoreId({ loja: '', store: 'y' }, { legacyStoreKey: true })).toBe('y')
    expect(askedStoreId({ loja: ['a', 'b'] })).toBe('a')
    expect(askedStoreId({})).toBeNull()
  })
})
