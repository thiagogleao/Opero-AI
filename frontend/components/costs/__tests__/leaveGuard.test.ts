import { describe, expect, it } from 'vitest'
import { BEFORE_PERIOD_CHANGE, eventDestination, leavesEditor } from '../useLeaveGuard'

const here = new URL('http://localhost:3100/profit?loja=a&periodo=7d')

describe('leave guard: what counts as leaving the cost editor', () => {
  const at = (path: string) => new URL(`http://localhost:3100${path}`)

  it('another page or another store leaves; another period or a #section does not', () => {
    expect(leavesEditor(at('/settings?loja=a'), here, 'a')).toBe(true)
    expect(leavesEditor(at('/profit?loja=b&periodo=7d'), here, 'a')).toBe(true)
    expect(leavesEditor(at('/profit?loja=a&periodo=30d'), here, 'a')).toBe(false)
    expect(leavesEditor(at('/profit?loja=a#frete'), here, 'a')).toBe(false)
  })

  it('/profit opened without ?loja shows the remembered store: links naming that store are not leaving', () => {
    // The period buttons and the "Custos" sidebar item carry loja=<id> even when
    // the address bar has none; this used to ask "Sair mesmo assim?".
    const bare = at('/profit')
    expect(leavesEditor(at('/profit?loja=a&periodo=30d'), bare, 'a')).toBe(false)
    expect(leavesEditor(at('/profit?loja=a'), bare, 'a')).toBe(false)
    expect(leavesEditor(at('/profit?periodo=30d'), bare, 'a')).toBe(false)
    expect(leavesEditor(at('/profit#frete'), bare, 'a')).toBe(false)
    // Another store or another page still leaves.
    expect(leavesEditor(at('/profit?loja=b&periodo=30d'), bare, 'a')).toBe(true)
    expect(leavesEditor(at('/campaigns?loja=a'), bare, 'a')).toBe(true)
  })

  it('?loja=todas on this one-store page also means the remembered store', () => {
    const todas = at('/profit?loja=todas&periodo=7d')
    expect(leavesEditor(at('/profit?loja=a&periodo=30d'), todas, 'a')).toBe(false)
    expect(leavesEditor(at('/profit?loja=b'), todas, 'a')).toBe(true)
  })

  it('a link naming no store, from a page that named one, may open another store: it asks', () => {
    // The remembered store need not be the one in the address bar.
    expect(leavesEditor(at('/profit?periodo=30d'), here, 'a')).toBe(true)
  })

  it('reads where a picker event is going from its detail (href, to or url), relative to the page', () => {
    const ev = (detail: unknown) => new CustomEvent(BEFORE_PERIOD_CHANGE, { cancelable: true, detail })
    expect(eventDestination(ev({ href: '/profit?loja=a&periodo=30d' }), here.href)?.searchParams.get('periodo')).toBe('30d')
    expect(eventDestination(ev({ to: '/settings?loja=a' }), here.href)?.pathname).toBe('/settings')
    expect(eventDestination(ev({ url: 'http://localhost:3100/?loja=b' }), here.href)?.searchParams.get('loja')).toBe('b')
    // No destination: a plain period change, which keeps the draft.
    expect(eventDestination(ev({ period: '30d' }), here.href)).toBeNull()
    expect(eventDestination(ev(null), here.href)).toBeNull()
    expect(eventDestination(new Event(BEFORE_PERIOD_CHANGE), here.href)).toBeNull()
  })
})
