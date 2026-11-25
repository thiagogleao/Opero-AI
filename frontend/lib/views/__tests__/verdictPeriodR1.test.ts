/**
 * period-fix-r1, verdict side: the verdict reads lib/period's comparison
 * (screenComparison) — the same set on both sides of a delta, no invented
 * "dia anterior", "base incompleta" for a partial base, the archive minute
 * for an archived store, and a countdown the screen keeps live. Each test
 * names its finding ("F<n>").
 */

import { describe, expect, it } from 'vitest'
import { sumPnL, type PnL, type PnLLines } from '../../engine/pnl'
import { buildVerdict, type ComparisonWindow, type VerdictInput, type VerdictStore } from '../verdict'
import { comparisonPrevious } from '../store'
import { kpiComparisonLabel } from '../../../components/dashboard/comparisonLabel'
import { dates, preset, resolve, screenComparison, type Selection } from '../../period'
import { brt, HIBIKURA, SQUISHY, store as scope, VIEWER } from '../../period/__tests__/fixtures'

const pnl = (over: Partial<PnLLines> = {}): PnL => sumPnL([{ ...sumPnL([]), ...over }])
const T1600 = brt('2026-11-24', '16:00')
const T1419 = brt('2026-11-24', '14:19')

function vs(over: Partial<VerdictStore> & Pick<VerdictStore, 'id' | 'name' | 'totals'>): VerdictStore {
  return { timezone: 'America/Sao_Paulo', configured: true, comparison: null, partial: false, minutesCovered: 1440, dayState: 'complete', ...over }
}

/** The verdict's comparison as the adapter builds it from a resolution. */
function cmpOf(sel: Selection, now: Date): ComparisonWindow {
  const c = screenComparison(resolve(sel, VIEWER, now))
  return { ...c, cutoffMinutes: c.cutoffMinutes }
}

describe('F1/F27 · Todas: the delta compares the same stores on both sides', () => {
  // MOKOO flat ($2.000 vs $2.000); Hibikura's base is partial (started 7 nov,
  // inside 27 out – 9 nov): priced, but out of the base — and so out of the
  // current side too.
  const mokoo = vs({ id: 'mokoo', name: 'MOKOO', totals: pnl({ revenue: 5000, orders: 50, cogs: 3000 }), comparison: { included: true, totals: pnl({ revenue: 5000, orders: 50, cogs: 3000 }) } })
  const hibikura = vs({
    id: 'hibikura', name: 'Hibikura', timezone: 'Asia/Tokyo', firstOrderDate: '2026-11-07',
    totals: pnl({ revenue: 4000, orders: 40, cogs: 2400 }), comparison: { included: false, totals: pnl({ revenue: 750, orders: 8, cogs: 450 }) },
  })
  const input: VerdictInput = {
    stores: [mokoo, hibikura], period: '14d', range: { from: '2026-11-10', to: '2026-11-23' }, today: '2026-11-24',
    anchorTimezone: 'America/Sao_Paulo',
    comparison: {
      from: '2026-10-27', to: '2026-11-09', label: '14 dias anteriores', sameTimeOfDay: false,
      full: 'vs 14 dias anteriores (27 out – 9 nov), sem Hibikura (começou em 7 nov)', short: 'vs 27 out – 9 nov',
      phrase: 'nos 14 dias anteriores', rangeText: '27 out – 9 nov', cutText: null, none: null, partialBase: null, leftOut: ['Hibikura'],
    },
  }
  const v = buildVerdict(input)

  it('says "quase o mesmo", not "+80%"', () => {
    expect(v.headline).toBe('As lojas lucraram juntas nos últimos 14 dias — quase o mesmo que nos 14 dias anteriores.')
    expect(v.details.map(d => d.text).join(' ')).not.toMatch(/80%/)
    const cmpLine = v.details.map(d => d.text).find(t => t.startsWith('O lucro era'))
    expect(cmpLine).toMatch(/^O lucro era \$2\.000 em 27 out – 9 nov\. A Hibikura só começou a vender em 7 nov: /)
    expect(cmpLine).toMatch(/\$1\.600 dela/)
    expect(v.likeTotals?.operatingProfit).toBeCloseTo(2000, 6)
    expect(v.when).toContain('sem Hibikura (começou em 7 nov)')
  })
})

describe('F2/F15 · no comparison is not "vs dia anterior"', () => {
  it('Hibikura · Este mês: "sem base: a loja começou em 7 nov", no D−1 line', () => {
    const v = buildVerdict({
      stores: [vs({ id: HIBIKURA, name: 'Hibikura', timezone: 'Asia/Tokyo', firstOrderDate: '2026-11-07', totals: pnl({ revenue: 4000, orders: 40, cogs: 2400 }), comparison: { included: false, totals: pnl() } })],
      period: 'mtd', range: { from: '2026-11-01', to: '2026-11-25' }, today: '2026-11-25', anchorTimezone: 'Asia/Tokyo',
      comparison: cmpOf({ scope: scope(HIBIKURA), period: preset('mtd'), split: false }, T1600),
    })
    expect(v.when).toBe('1–25 nov · sem base: a loja começou em 7 nov')
    const all = [v.when, v.headline, ...v.details.map(d => d.text), ...v.notes.map(d => d.text)].join(' ')
    expect(all).not.toMatch(/dia anterior|31 out|Sem vendas para comparar/)
  })
})

describe('F3 · a partial base: "base incompleta", no "sem vendas", no deltas', () => {
  const c = cmpOf({ scope: scope(HIBIKURA), period: preset('14d'), split: false }, T1600)
  const base = { included: false, totals: pnl({ revenue: 916, orders: 11, cogs: 500 }) }
  const v = buildVerdict({
    stores: [vs({ id: HIBIKURA, name: 'Hibikura', timezone: 'Asia/Tokyo', firstOrderDate: '2026-11-07', totals: pnl({ revenue: 4000, orders: 40, cogs: 2400 }), comparison: base })],
    period: '14d', range: { from: '2026-11-11', to: '2026-11-24' }, today: '2026-11-25', anchorTimezone: 'Asia/Tokyo', comparison: c,
  })

  it('names the partial base and never claims the base had no sales', () => {
    const lines = v.details.map(d => d.text)
    expect(lines.some(l => l.startsWith('Base incompleta: a loja começou em 7 nov. A comparação, 28 out – 10 nov, tem dias antes disso'))).toBe(true)
    expect(lines.join(' ')).not.toMatch(/Sem vendas para comparar/)
    expect(lines.join(' ')).not.toMatch(/%/)
  })

  it('gives the KPIs no base to put a % or p.p. against', () => {
    expect(comparisonPrevious(base)).toBeNull()
    expect(comparisonPrevious({ included: true, totals: base.totals })).toBe(base.totals)
  })
})

describe('F4/F22 · the pills read lib/period\'s short label', () => {
  it('"vs 25 out – 9 nov (até 04h00)", the cut said once', () => {
    const c = cmpOf({ scope: scope(HIBIKURA), period: dates('2026-11-10', '2026-11-25'), split: false }, T1600)
    expect(kpiComparisonLabel(c, '2026-11-25')).toEqual({ short: 'vs 25 out – 9 nov (até 04h00)', full: 'vs 16 dias anteriores (25 out – 9 nov, até 04h00)' })
  })
})

describe('F5/F18 · an archived store\'s comparison is "até 10h00 (hora do arquivamento)"', () => {
  it('never "até esta hora"', () => {
    const c = cmpOf({ scope: scope(SQUISHY), period: preset('30d'), split: false }, T1419)
    const v = buildVerdict({
      stores: [vs({
        id: SQUISHY, name: 'Squishy World', archived: true, archivedOn: '2026-11-10', firstOrderDate: '2025-01-10',
        totals: pnl({ revenue: 3000, orders: 30, cogs: 1500 }), comparison: { included: true, totals: pnl({ revenue: 3000, orders: 30, cogs: 3200 }) },
      })],
      period: '30d', range: { from: '2026-10-25', to: '2026-11-23' }, today: '2026-11-24', anchorTimezone: 'America/Sao_Paulo', comparison: c,
    })
    expect(v.headline).toBe('A Squishy World lucrou nos últimos 30 dias — depois de prejuízo nos 17 dias anteriores, até 10h00 (hora do arquivamento).')
    expect([v.headline, v.when, ...v.details.map(d => d.text)].join(' ')).not.toMatch(/esta hora/)
  })
})

describe('F34 · the countdown line is live on the screen', () => {
  it('carries its clock so the screen ticks it (LiveCountdown)', () => {
    const v = buildVerdict({
      stores: [vs({ id: 'mokoo', name: 'MOKOO', timezone: 'America/Belem', partial: true, minutesCovered: 20 * 60, totals: pnl({ revenue: 900, orders: 9, cogs: 300 }) })],
      period: 'today', range: { from: '2026-11-24', to: '2026-11-24' }, today: '2026-11-24', anchorTimezone: 'America/Belem',
      minutesLeft: 239, comparison: null,
    })
    const line = v.notes.find(n => n.countdown)
    expect(line?.text).toBe('Faltam 3h59 para o dia fechar.')
    expect(line?.countdown).toEqual({ tz: 'America/Belem', suffix: ' para o dia fechar.' })
  })
})
