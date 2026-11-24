import { describe, expect, it } from 'vitest'
import { keepPeriodHref } from '../KeepPeriodLink'

// The 404 page's "Ir para o Resumo" used to go to bare "/", dropping the period.
describe('keepPeriodHref', () => {
  it('keeps periodo, de, ate and parte, and drops loja (it may be what was not found)', () => {
    const sp = new URLSearchParams('loja=bogus&periodo=custom&de=2026-11-01&ate=2026-11-10&parte=50&aba=x')
    expect(keepPeriodHref('/', sp)).toBe('/?periodo=custom&de=2026-11-01&ate=2026-11-10&parte=50')
  })

  // Without volta the page opened read a Todas row's dates as dates the owner
  // picked ("Período escolhido"), and kept them frozen the next day.
  it('keeps the preset row dates stand for (volta)', () => {
    const sp = new URLSearchParams('loja=0344&periodo=custom&de=2026-11-24&ate=2026-11-24&volta=today')
    expect(keepPeriodHref('/', sp)).toBe('/?periodo=custom&de=2026-11-24&ate=2026-11-24&volta=today')
  })

  it('is a bare path when there is no period in the URL', () => {
    expect(keepPeriodHref('/', new URLSearchParams('loja=bogus'))).toBe('/')
    expect(keepPeriodHref('/', new URLSearchParams(''))).toBe('/')
  })
})
