/**
 * F12 (period-fix-r1): a dates value across years shows its year on the
 * button's second line (R7 buttonYear), the same function resolve() uses.
 * "30/12–30/12" alone read as this year.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PeriodPicker } from '../PeriodPicker'
import { dates, preset } from '@/lib/period'

const props = (current: Parameters<typeof PeriodPicker>[0]['current']) => ({
  current, today: '2026-11-24', range: { from: '2025-12-30', to: '2026-11-24' }, rangeLabel: '', partialLabel: null,
})

describe('PeriodPicker year line', () => {
  it('"30/12–30/12" over "2025–26"', () => {
    const html = renderToStaticMarkup(createElement(PeriodPicker, props(dates('2025-12-30', '2026-12-30'))))
    expect(html).toContain('30/12–30/12')
    expect(html).toContain('2025–26')
  })

  it('no year line inside this year, nor for a preset', () => {
    expect(renderToStaticMarkup(createElement(PeriodPicker, props(dates('2026-11-01', '2026-11-10'))))).not.toMatch(/2026/)
    expect(renderToStaticMarkup(createElement(PeriodPicker, props(preset('7d'))))).not.toMatch(/20\d\d–/)
  })
})
