import { describe, expect, it } from 'vitest'
import { withPageState } from '../links'

describe('withPageState and row dates (volta)', () => {
  // A store row of Todas · Hoje for Hibikura after noon opens Tokyo's date
  // with volta=today (lib/views/page PageParams.volta).
  const row = '?loja=hibikura&periodo=custom&de=2026-11-25&ate=2026-11-25&volta=today'

  it('carries volta with the dates it came with', () => {
    expect(withPageState('/campaigns', row)).toBe('/campaigns?loja=hibikura&periodo=custom&de=2026-11-25&ate=2026-11-25&volta=today')
    // A link that only names a store keeps the address's window, volta included.
    expect(withPageState('/products?loja=glooty', row)).toBe('/products?loja=glooty&periodo=custom&de=2026-11-25&ate=2026-11-25&volta=today')
  })

  it("leaves volta off a link that sets its own window", () => {
    // Its own custom dates must stay those dates, not turn into "Hoje".
    expect(withPageState('/campaigns?periodo=custom&de=2026-10-01&ate=2026-10-31', row))
      .toBe('/campaigns?periodo=custom&de=2026-10-01&ate=2026-10-31&loja=hibikura')
    expect(withPageState('/campaigns?periodo=7d', row)).not.toContain('volta=')
    expect(withPageState('/campaigns?de=2026-10-01', row)).not.toContain('volta=')
  })

  it('a link that already says volta keeps it', () => {
    expect(withPageState('/campaigns?volta=mtd', row)).toBe('/campaigns?volta=mtd&loja=hibikura&periodo=custom&de=2026-11-25&ate=2026-11-25')
  })
})
