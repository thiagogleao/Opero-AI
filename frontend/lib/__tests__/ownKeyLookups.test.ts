import { describe, expect, it } from 'vitest'
import { tzCity } from '../format'
import { cityOfTz } from '../views/portfolio'
import { alertRowTitle } from '../../app/m/_lib/labels'

// Lookups in plain Record tables keyed by outside data (Shopify's timezone,
// the DB's alert kind) read own keys only: a key named like an
// Object.prototype member returned a function instead of the fallback.
const PROTO = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']

describe('own-key lookups', () => {
  it('tzCity and cityOfTz: the table, else the last path segment', () => {
    for (const f of [tzCity, cityOfTz]) {
      expect(f('Asia/Tokyo')).toBe('Tóquio')
      expect(f('America/Sao_Paulo')).toBe('São Paulo')
      expect(f('America/Argentina/Buenos_Aires')).toBe('Buenos Aires')
      for (const k of PROTO) expect(f(k)).toBe(k.replace(/_/g, ' '))
    }
  })

  it('alertRowTitle: the kind in Portuguese, else "Alerta"', () => {
    expect(alertRowTitle('roas_drop', null)).toBe('ROAS abaixo do empate')
    expect(alertRowTitle('unknown_kind', '  ')).toBe('Alerta')
    for (const k of PROTO) expect(alertRowTitle(k, null)).toBe('Alerta')
  })
})
