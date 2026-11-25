import { describe, expect, it } from 'vitest'
import { addStoreHref, askedStoreId } from '../storeParam'
import { ALL_STORES, type SearchParams } from '@/lib/views/page'
import { dates, preset, type Selection } from '@/lib/period'

const MOKOO = 'user_3CVoVQYfnj1Ljnm3tf0iHP40fxX'
const q = (href: string) => Object.fromEntries(new URLSearchParams(href.split('?')[1] ?? '')) as SearchParams

// Ajustes' "Adicionar loja": /onboarding?addStore=true with the page's period
// (lib/period desktopHref). It names Todas (loja=todas), which onboarding reads
// as no store, so a store id never continues that store's setup.
describe('addStoreHref — Ajustes → Adicionar loja', () => {
  it('keeps the period and the split, names Todas, never a store id', () => {
    for (const scope of [{ kind: 'store', id: MOKOO }, { kind: 'all' }] as Selection['scope'][]) {
      const href = addStoreHref({ selection: { scope, period: preset('30d'), split: true } })
      expect(href).toBe('/onboarding?loja=todas&periodo=30d&parte=50&addStore=true')
      expect(askedStoreId(q(href), { legacyStoreKey: true })).toBeNull()
    }
  })
  it('dates travel as dates; the default period is left out', () => {
    expect(addStoreHref({ selection: { scope: { kind: 'all' }, period: dates('2026-11-01', '2026-11-10'), split: false } }))
      .toBe('/onboarding?loja=todas&periodo=custom&de=2026-11-01&ate=2026-11-10&addStore=true')
    expect(addStoreHref({ selection: { scope: { kind: 'all' }, period: preset('7d'), split: false } })).toBe(`/onboarding?loja=${ALL_STORES}&addStore=true`)
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
