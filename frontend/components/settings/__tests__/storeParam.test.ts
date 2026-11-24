import { describe, expect, it } from 'vitest'
import { askedStoreId } from '../storeParam'

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
