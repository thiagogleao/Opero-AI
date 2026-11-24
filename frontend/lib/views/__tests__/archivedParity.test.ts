import { describe, expect, it, vi } from 'vitest'

// lib/access (cookies, database) and next/navigation are never reached.
vi.mock('../../access', () => ({ getViewer: vi.fn(), listStores: vi.fn(), resolveStore: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: vi.fn(), redirect: vi.fn() }))

import type { Period } from '../../engine/dates'
import { archivedWindow, resolvePeriodWindow } from '../page'
import { archivedComparison } from '../portfolio'

// An archived store's comparison is decided twice: by the desktop page
// context (lib/views/page archivedWindow → ctx.comparison) and by
// archivedComparison (buildPortfolio for the phone, loadStoreSummary for the
// Resumo, which is handed ctx.comparison). Both must name the same days, or
// the phone and the desktop compare Squishy World differently.

const SP = 'America/Sao_Paulo'
const SW = { archived: true }
// 24 nov 14h47 in São Paulo.
const NOW = new Date('2026-11-24T17:47:00Z')

const windows: [Period, string | null, string | null, Period | null][] = [
  ['today', null, null, null], ['yesterday', null, null, null], ['7d', null, null, null], ['30d', null, null, null],
  ['mtd', null, null, null], ['lastmonth', null, null, null],
  ['custom', '2026-11-05', '2026-11-24', null], ['custom', '2026-10-01', '2026-11-20', null],
  ['custom', '2026-11-01', '2026-11-24', 'mtd'], ['custom', '2026-10-01', '2026-10-31', 'lastmonth'],
]
const archiveDays = [null, '2026-06-01', '2026-10-10', '2026-11-01', '2026-11-10', '2026-11-20', '2026-11-23', '2026-11-24']

describe('archivedComparison and the page context agree on an archived store\'s comparison', () => {
  for (const [period, de, ate, compareAs] of windows) {
    for (const on of archiveDays) {
      it(`${period}${de ? ` ${de}…${ate}` : ''}${compareAs ? ` as ${compareAs}` : ''}, archived ${on ?? '(unknown)'}`, () => {
        const resolved = resolvePeriodWindow(period, de, ate, SP, NOW, compareAs)
        const page = archivedWindow(resolved, on, NOW).comparison
        // From the raw comparison (buildPortfolio) …
        expect(archivedComparison(SW, on, resolved.range, resolved.comparison, SP, NOW)).toEqual(page)
        // … and from the one the page context already moved (loadStoreSummary).
        expect(archivedComparison(SW, on, resolved.range, page, SP, NOW)).toEqual(page)
      })
    }
  }
})
