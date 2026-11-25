import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { sumPnL } from '@/lib/engine/pnl'
import { eachDay } from '@/lib/engine/dates'
import type { MobileResponse } from '@/lib/views/mobile'
import type { PortfolioDay } from '@/lib/views/portfolio'
import { DailyBlock } from '../Home'

// /m?loja=<Squishy World>&periodo=30d (25 out – 23 nov, archived on 10 nov):
// the chart drew $0 bars for 11–23 nov, days never read, under the verdict's
// "não há dados dos dias seguintes". The desktop chart stops on 10 nov.

const day = (date: string, profit = 0): PortfolioDay => ({
  date, revenue: profit > 0 ? profit * 2 : 0, orders: profit > 0 ? 1 : 0, contribution: profit, metaSpend: 0, shopSpend: 0, adSpend: 0,
  fixedCosts: 0, operatingProfit: profit, adjustments: 0, cashResult: profit, margin: null, roas: null,
})

function data(opts: { archived: boolean; archivedOn: string | null }): MobileResponse {
  const range = { from: '2026-10-25', to: '2026-11-23' }
  const days = eachDay(range.from, range.to).map(d => day(d, d === '2026-11-03' ? 40 : 0))
  return {
    range, rangeLabel: '25 out – 23 nov', anchorToday: '2026-11-24', anchorTimezone: 'America/Sao_Paulo',
    generatedAt: '2026-11-24T18:11:00.000Z', period: '30d',
    request: { store: 'sw', period: '30d', from: null, to: null },
    daily: days, dailyJudged: days,
    stores: [{
      id: 'sw', name: 'Squishy World', timezone: 'America/Sao_Paulo', archived: opts.archived, archivedOn: opts.archivedOn,
      configured: true, partial: false, totals: sumPnL([]), firstOrderDate: '2026-09-01',
    }],
  } as unknown as MobileResponse
}

// TapBars: one tappable column (a button) per day drawn.
const bars = (html: string) => (html.match(/data-col=/g) ?? []).length

describe('the phone\'s daily chart of an archived store', () => {
  it('stops on the archive day: no bars for the days never read', () => {
    const html = renderToStaticMarkup(createElement(DailyBlock, { data: data({ archived: true, archivedOn: '2026-11-10' }) }))
    // 25 out – 10 nov: 17 days read.
    expect(bars(html)).toBe(17)
    expect(html).not.toMatch(/(11|23) nov:/)
  })

  it('a store that syncs (or an archive day outside the window) draws every day', () => {
    expect(bars(renderToStaticMarkup(createElement(DailyBlock, { data: data({ archived: false, archivedOn: null }) })))).toBe(30)
    expect(bars(renderToStaticMarkup(createElement(DailyBlock, { data: data({ archived: true, archivedOn: '2026-11-30' }) })))).toBe(30)
  })
})
