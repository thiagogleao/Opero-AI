/**
 * lib/period, table-driven: one case per rule example of the spec
 * (D:/opero-tmp/period/spec.md R1–R19, §4) with the clock injected. Brasília
 * is UTC−3, Tokyo UTC+9: Tokyo's midnight is 12:00 BRT.
 */

import { describe, expect, it } from 'vitest'
import {
  announce, carry, checkPickedDates, countdownText, dateBeside, dates, decisionWindow, desktopHref, fitValue, layer,
  minutesLeft, nextMidnight, normaliseDates, notesText, noteText, parseDesktop, parsePeriod, pickIsNoop, preset,
  rangeBeside, resolve, sameResolution, startsInside, beforeFirstSale, MENU, presetInfo, datesButton, datesButtonYear,
  keepPeriodHref, notificationHref, parseLegacyPush, membersHash, windowFor, previousFor, landingNotes,
  type PeriodValue, type ScopeRef, type Selection,
} from '..'
import { ALL, brt, CAMP, EPOCH, GLOOTY, HIBIKURA, MOKOO, PARTNER_ONE, PARTNER_TWO, SQUISHY, store, tokyo, VIEWER } from './fixtures'

const sel = (scope: ScopeRef, period: PeriodValue, split = false): Selection => ({ scope, period, split })
const R = (scope: ScopeRef, period: PeriodValue, now: Date) => resolve(sel(scope, period), VIEWER, now)
const member = (r: ReturnType<typeof R>, id: string) => r.members.find(m => m.storeId === id)!

const T1159 = brt('2026-11-24', '11:59')
const T1201 = brt('2026-11-24', '12:01')
const T1600 = brt('2026-11-24', '16:00')
const T2359 = brt('2026-11-24', '23:59')
const T0001 = brt('2026-11-25', '00:01')

const ctx = (pathname: string, remembered: string | null = MOKOO, now = T1600) => ({ pathname, viewer: VIEWER, remembered, now })

describe('R1 · the period value', () => {
  it('ex1: Hibikura · Hoje is Tokyo 24 nov at 11:59 BRT and 25 nov at 12:01, same selection', () => {
    const a = R(store(HIBIKURA), preset('today'), T1159)
    const b = R(store(HIBIKURA), preset('today'), T1201)
    expect(a.window).toEqual({ from: '2026-11-24', to: '2026-11-24' })
    expect(a.partialUntil).toBe('23h59')
    expect(b.window).toEqual({ from: '2026-11-25', to: '2026-11-25' })
    expect(b.label.full).toBe('Hoje · 25 nov')
    expect(b.partialUntil).toBe('00h01')
    expect(b.selection).toEqual(a.selection)
  })
  it('ex2: MOKOO 1–24 nov does not roll at 00:01; partial turns off', () => {
    const a = R(store(MOKOO), dates('2026-11-01', '2026-11-24'), T2359)
    const b = R(store(MOKOO), dates('2026-11-01', '2026-11-24'), T0001)
    expect(a.window).toEqual(b.window)
    expect(a.partial).toBe(true)
    expect(b.partial).toBe(false)
  })
  it('ex3: custom 1–24 nov is named by its dates and compared with 24 days before', () => {
    const r = R(store(MOKOO), dates('2026-11-01', '2026-11-24'), T1600)
    expect(r.label.button).toBe('1–24 nov')
    expect(r.comparison!.range).toEqual({ from: '2026-10-08', to: '2026-10-31' })
    expect(r.comparison!.words).toBe('24 dias anteriores')
  })
})

describe('R2 · whose clock resolves a selection', () => {
  it('ex1: Todas · Hoje at 16:00: Brazil stores running, Hibikura closed on its own 24 nov', () => {
    const r = R(ALL, preset('today'), T1600)
    expect(r.window).toEqual({ from: '2026-11-24', to: '2026-11-24' })
    for (const id of [MOKOO, EPOCH, GLOOTY]) expect(member(r, id).state).toBe('running')
    expect(member(r, HIBIKURA).state).toBe('closed')
    expect(member(r, HIBIKURA).read).toEqual({ from: '2026-11-24', to: '2026-11-24' })
    expect(r.members.map(m => m.storeId)).not.toContain(SQUISHY)
  })
  it('ex2: Hibikura · Hoje alone at 16:00 is Tokyo 25 nov, running until 04h00, clock note Tóquio', () => {
    const r = R(store(HIBIKURA), preset('today'), T1600)
    expect(r.window.from).toBe('2026-11-25')
    expect(r.partialUntil).toBe('04h00')
    expect(r.clockNote).toBe('Tóquio')
  })
  it('ex3: Todas · 7 dias = 17–23 nov for every store; Hibikura alone = 18–24 nov', () => {
    expect(R(ALL, preset('7d'), T1600).window).toEqual({ from: '2026-11-17', to: '2026-11-23' })
    expect(R(store(HIBIKURA), preset('7d'), T1600).window).toEqual({ from: '2026-11-18', to: '2026-11-24' })
  })
})

describe('R3 · a link in the same scope carries the selection unchanged', () => {
  it('ex1: Campanhas · MOKOO · mtd → Produtos', () => {
    expect(desktopHref('/products', sel(store(MOKOO), preset('mtd')))).toBe('/products?loja=mokoo&periodo=mtd')
  })
  it('ex2: Hibikura custom with parte → Países keeps everything', () => {
    expect(desktopHref('/countries', sel(store(HIBIKURA), dates('2026-11-01', '2026-11-15'), true)))
      .toBe('/countries?loja=hibikura&periodo=custom&de=2026-11-01&ate=2026-11-15&parte=50')
  })
  it('ex3: on Todas a store-only page is an R4 link to the remembered store with vem=todas', () => {
    expect(layer('/overview?loja=todas', { kind: 'page', path: '/', scope: store(MOKOO) }, { archivedIds: [] }))
      .toBe('/?loja=mokoo&vem=todas')
  })
})

describe('R4 · a link to another store or scope', () => {
  it('ex1: the Hibikura row keeps Hoje and is announced; MOKOO row is not; at 11:00 nothing is', () => {
    const s = sel(ALL, preset('today'))
    const a = announce(s, ALL, store(HIBIKURA), VIEWER, T1600)!
    expect(a.line).toBe('Hibikura abre o Hoje de Tóquio (25 nov)')
    expect(a.landing).toBe('Hoje na Hibikura é 25 nov (dia de Tóquio). Em Todas as lojas, Hoje é 24 nov.')
    expect(announce(s, ALL, store(MOKOO), VIEWER, T1600)).toBeNull()
    expect(announce(s, ALL, store(HIBIKURA), VIEWER, brt('2026-11-24', '11:00'))).toBeNull()
    expect(carry(s, store(HIBIKURA), VIEWER)!.selection.period).toEqual(preset('today'))
  })
  it('ex2: Mês passado on Hibikura is the same 1–31 out: no announcement', () => {
    expect(announce(sel(ALL, preset('lastmonth')), ALL, store(HIBIKURA), VIEWER, T1600)).toBeNull()
  })
  it('ex3: 24 dez, Todas · Este mês → Hibikura announces its Tokyo dates and comparison', () => {
    const a = announce(sel(ALL, preset('mtd')), ALL, store(HIBIKURA), VIEWER, brt('2026-12-24', '16:00'))!
    expect(a.line).toBe('Hibikura abre o Este mês de Tóquio: 1–25 dez, vs 1–25 nov até 04h00')
  })
  it('ex4: Todas custom 18–24 nov travels as the same dates to every row and through the picker', () => {
    const s = sel(ALL, dates('2026-11-18', '2026-11-24'))
    expect(carry(s, store(MOKOO), VIEWER)!.selection.period).toEqual(dates('2026-11-18', '2026-11-24'))
    expect(carry(sel(store(HIBIKURA), dates('2026-11-18', '2026-11-24')), store(EPOCH), VIEWER)!.selection.period)
      .toEqual(dates('2026-11-18', '2026-11-24'))
  })
  it('ex5: Atribuição on Hibikura · Ontem → Todas carries the preset; the landing note names both days', () => {
    const href = layer('/attribution?loja=hibikura&periodo=yesterday', { kind: 'page', path: '/overview', scope: ALL }, { archivedIds: [] })
    expect(href).toBe('/overview?loja=todas&periodo=yesterday&vem=hibikura')
    const a = announce(sel(store(HIBIKURA), preset('yesterday')), store(HIBIKURA), ALL, VIEWER, T1600)!
    expect(a.landing).toBe('Ontem em Todas as lojas é 23 nov (Brasília). Na Hibikura era 24 nov.')
  })
  it('ex6: round trip Todas 7 dias → Hibikura → Todas returns the same window, each step announced', () => {
    const toH = announce(sel(ALL, preset('7d')), ALL, store(HIBIKURA), VIEWER, T1600)!
    expect(toH.landing).toBe('Os últimos 7 dias na Hibikura são 18–24 nov (dia de Tóquio). Em Todas as lojas são 17–23 nov.')
    const back = carry(carry(sel(ALL, preset('7d')), store(HIBIKURA), VIEWER)!.selection, ALL, VIEWER)!.selection
    expect(resolve(back, VIEWER, T1600).window).toEqual({ from: '2026-11-17', to: '2026-11-23' })
  })
  it('ex7: leaving an archived store does not carry its period (left_archive)', () => {
    const c = carry(sel(store(SQUISHY), dates('2026-10-12', '2026-11-10')), store(MOKOO), VIEWER)!
    expect(c.leftArchive).toBe(true)
    expect(c.selection.period).toEqual(preset('7d'))
    expect(layer('/?loja=squishy&periodo=custom&de=2026-10-12&ate=2026-11-10', { kind: 'store', scope: store(MOKOO) }, { archivedIds: [SQUISHY] }))
      .toBe('/?loja=mokoo&vem=squishy')
  })
  it('a target the viewer cannot see returns null (render the text without a link)', () => {
    expect(carry(sel(store(CAMP), preset('7d')), store(EPOCH), PARTNER_TWO)).toBeNull()
    expect(carry(sel(store(CAMP), preset('7d')), ALL, PARTNER_ONE)).toBeNull()
  })
})

describe('R5 · the store picker and the remembered store', () => {
  it('ex1: bare / with cookie MOKOO → /?loja=MOKOO; picking MOKOO again is a no-op', () => {
    expect(parseDesktop({}, ctx('/')).canonical).toBe('/?loja=mokoo')
    expect(pickIsNoop(store(MOKOO), '/profit?loja=mokoo')).toBe(true)
  })
  it('ex2: a shared link names its store; the cookie is not involved', () => {
    const p = parseDesktop({ loja: EPOCH, periodo: '30d' }, ctx('/'))
    expect(p.selection!.scope).toEqual(store(EPOCH))
    expect(p.redirect).toBe(false)
    expect(p.forgetRemembered).toBe(false)
  })
  it('ex4: cookie = an archived store → cleared, first active by name, remembered_gone', () => {
    const p = parseDesktop({}, ctx('/', SQUISHY))
    expect(p.forgetRemembered).toBe(true)
    expect(p.selection!.scope).toEqual(store(CAMP))
    // The redirect carries the store it forgets, so the landing note names it
    // (R5 ex. 4: "A loja lembrada (Squishy World) não está mais disponível").
    expect(p.canonical).toBe('/?loja=camp&ajuste=remembered_gone%3Asquishy')
    // Landed through the forget route: the cookie is cleared (period-fix-r2).
    const landed = parseDesktop({ loja: CAMP, ajuste: `remembered_gone:${SQUISHY}` }, ctx('/', null))
    const r = resolve(landed.selection!, VIEWER, T1600)
    expect(notesText(landingNotes(landed.notes, landed.cameFrom, r, VIEWER, T1600)))
      .toBe('A loja lembrada (Squishy World) não está mais disponível: mostrando CAMP HALLOW.')
  })
  it('Todas picked on a store-only page always opens /overview', () => {
    expect(pickIsNoop(ALL, '/?loja=mokoo')).toBe(false)
    expect(layer('/?loja=mokoo', { kind: 'store', scope: ALL }, { archivedIds: [] })).toBe('/overview?loja=todas&vem=mokoo')
  })
})

describe('R6 · comparison windows', () => {
  it('ex1: Todas · Hoje 16:00: Brazil cut at 16h00, Hibikura whole; mixed label', () => {
    const r = R(ALL, preset('today'), T1600)
    expect(member(r, MOKOO).compare).toEqual({ range: { from: '2026-11-23', to: '2026-11-23' }, cutAtMinute: 960, base: 'full' })
    expect(member(r, HIBIKURA).compare!.cutAtMinute).toBeNull()
    expect(r.comparison!.cut).toBe('mixed')
    expect(r.comparison!.label).toBe('vs ontem até esta hora; Hibikura com o dia inteiro (o dia de Tóquio já fechou)')
    expect(R(ALL, preset('today'), brt('2026-11-24', '11:00')).comparison!.label).toBe('vs ontem até esta hora')
  })
  it('ex2: Hibikura · Este mês on 24 nov has no base (October before its first sale)', () => {
    const r = R(store(HIBIKURA), preset('mtd'), T1600)
    expect(r.members[0].compare).toBeNull()
    expect(r.members[0].noBase).toBe(true)
    expect(r.comparison).toBeNull()
  })
  it('ex3: Hibikura · 14 dias has a partial base and a partial_base note', () => {
    const r = R(store(HIBIKURA), preset('14d'), T1600)
    expect(r.members[0].compare!.base).toBe('partial')
    expect(r.notes.map(n => n.code)).toContain('partial_base')
  })
  it('ex4: MOKOO 20–24 nov cut at 23h59, whole at 00:01', () => {
    const a = R(store(MOKOO), dates('2026-11-20', '2026-11-24'), T2359)
    const b = R(store(MOKOO), dates('2026-11-20', '2026-11-24'), T0001)
    expect(a.comparison!.range).toEqual({ from: '2026-11-15', to: '2026-11-19' })
    expect(a.members[0].compare!.cutAtMinute).toBe(1439)
    expect(a.comparison!.short).toBe('vs 15–19 nov (até 23h59)')
    expect(b.members[0].compare!.cutAtMinute).toBeNull()
    expect(b.comparison!.short).toBe('vs 15–19 nov')
  })
  it('the delta leaves out members without a full base, and names them', () => {
    const r = R(ALL, preset('14d'), T1600)
    expect(r.comparison!.leftOut).toContain('Hibikura')
    expect(r.comparison!.label).toMatch(/, sem Glooty \(começou em 4 nov\) e Hibikura \(começou em 7 nov\)$/)
  })
})

describe('R7 · naming and menus', () => {
  it('ex1: Hibikura · Hoje at 16:00: "Hoje · 25 nov", Tokyo clock differs', () => {
    const r = R(store(HIBIKURA), preset('today'), T1600)
    expect(r.label.full).toBe('Hoje · 25 nov')
    expect(r.clockDiffers).toBe(true)
  })
  it('ex2: a cross-year range: "25 dez 2025 – 3 jan 2026", button "25/12–3/1" with "2025–26"', () => {
    const r = R(ALL, dates('2025-12-25', '2026-01-03'), T1600)
    expect(r.label.full).toBe('25 dez 2025 – 3 jan 2026')
    expect(r.label.button).toBe('25/12–3/1')
    expect(r.label.buttonYear).toBe('2025–26')
  })
  it('ex3: at 09:00 BRT the chip still shows for Hibikura; no Todas row announcement', () => {
    expect(R(store(HIBIKURA), preset('today'), brt('2026-11-24', '09:00')).clockDiffers).toBe(true)
    expect(announce(sel(ALL, preset('today')), ALL, store(HIBIKURA), VIEWER, brt('2026-11-24', '09:00'))).toBeNull()
  })
  it('one menu for both platforms, 90 dias included', () => {
    expect(MENU.main).toEqual(['today', 'yesterday', '7d', '30d'])
    expect(MENU.more).toEqual(['14d', '90d', 'mtd', 'lastmonth'])
    expect(MENU.more.map(p => presetInfo(p).button)).toEqual(['14 dias', '90 dias', 'Este mês', 'Mês passado'])
  })
  it('a single-day dates value that is today or yesterday says so', () => {
    expect(R(store(MOKOO), dates('2026-11-24', '2026-11-24'), T1600).label.full).toBe('24 nov (hoje)')
    expect(R(store(MOKOO), dates('2026-11-23', '2026-11-23'), T1600).label.full).toBe('23 nov (ontem)')
  })
  it('a fitted selection is named as asked', () => {
    const r = R(ALL, dates('2026-11-25', '2026-11-25'), T1600)
    expect(r.label.full).toBe('25 nov · ainda não começou em Brasília')
    expect(r.label.button).toBe('25 nov')
    expect(r.window).toEqual({ from: '2026-11-24', to: '2026-11-24' })
  })
})

describe('R8 · the day turning', () => {
  it('ex1: countdown at 23:59:00 and 23:59:30; 00:00:02 and 00:00:59 read 23h59', () => {
    const tz = 'America/Belem'
    expect(countdownText(minutesLeft(tz, brt('2026-11-24', '23:59')))).toBe('Falta 1 min')
    expect(countdownText(minutesLeft(tz, brt('2026-11-24', '23:59', '30')))).toBe('Falta menos de 1 min')
    expect(countdownText(minutesLeft(tz, brt('2026-11-25', '00:00', '00', '000')))).toBe('Faltam 23h59')
    expect(countdownText(minutesLeft(tz, brt('2026-11-25', '00:00', '02')))).toBe('Faltam 23h59')
    expect(countdownText(minutesLeft(tz, brt('2026-11-25', '00:00', '59')))).toBe('Faltam 23h59')
    expect(countdownText(minutesLeft(tz, brt('2026-11-25', '00:01', '00', '001')))).toBe('Faltam 23h58')
    expect(R(store(MOKOO), preset('today'), T2359).nextTurnAt).toBe('2026-11-25T03:00:00.000Z')
  })
  it('countdown on a DST day (America/Los_Angeles, 8 mar 2026: 23 h)', () => {
    const tz = 'America/Los_Angeles'
    const midnight = new Date('2026-03-08T08:00:00.000Z') // 00:00 PST
    expect(minutesLeft(tz, midnight)).toBe(23 * 60 - 1)
    expect(nextMidnight(tz, midnight).toISOString()).toBe('2026-03-09T07:00:00.000Z')
  })
  it('ex2: Todas · Hoje at 11:59: the next turn is 12:00 (Hibikura closes), then 00:00', () => {
    const a = R(ALL, preset('today'), T1159)
    expect(a.nextTurnAt).toBe('2026-11-24T15:00:00.000Z')
    const b = R(ALL, preset('today'), brt('2026-11-24', '12:00', '02'))
    expect(member(b, HIBIKURA).state).toBe('closed')
    expect(member(b, HIBIKURA).compare!.cutAtMinute).toBeNull()
    expect(b.window).toEqual(a.window)
    expect(b.nextTurnAt).toBe('2026-11-25T03:00:00.000Z')
  })
  it('ex3: MOKOO · 7 dias moves from 17–23 to 18–24 nov across Brasília midnight', () => {
    expect(R(store(MOKOO), preset('7d'), brt('2026-11-24', '23:50')).window.from).toBe('2026-11-17')
    expect(R(store(MOKOO), preset('7d'), brt('2026-11-25', '00:10')).window.from).toBe('2026-11-18')
  })
  it('sameResolution ignores minutes and changes across a turn; nextTurnAt is never null', () => {
    const a = R(ALL, preset('today'), brt('2026-11-24', '16:00'))
    const b = R(ALL, preset('today'), brt('2026-11-24', '16:05'))
    expect(sameResolution(a, b)).toBe(true)
    expect(sameResolution(a, R(ALL, preset('today'), T0001))).toBe(false)
    expect(R(store(SQUISHY), preset('today'), T1600).nextTurnAt).toBe('2026-11-25T03:00:00.000Z')
  })
})

describe('R9 · fitting dates', () => {
  it('ex1: 2024-01-01 – 2026-12-30 → 366 days ending 30 dez 2026, then fitted to today, one sentence', () => {
    const n = normaliseDates('2024-01-01', '2026-12-30')
    expect(n.value).toEqual({ kind: 'dates', from: '2025-12-30', to: '2026-12-30' })
    expect(n.notes).toEqual(['too_long'])
    expect(normaliseDates(n.value!.from, n.value!.to)).toEqual({ value: n.value, notes: [] })
    const r = R(store(MOKOO), n.value!, T1600)
    expect(r.window).toEqual({ from: '2025-12-30', to: '2026-11-24' })
    const text = notesText([...r.notes.filter(x => x.code === 'future_end'), { code: 'too_long', params: { window: r.label.range } }])
    expect(text).toBe('Período ajustado: as datas iam até 30 dez 2026, que ainda não aconteceu, e passavam de 366 dias. Mostrando 30 dez 2025 – 24 nov 2026.')
  })
  it('ex2: Hibikura 20–25 nov → MOKOO shows 20–24 with future_end → back to Hibikura keeps the 25th', () => {
    const h = sel(store(HIBIKURA), dates('2026-11-20', '2026-11-25'))
    const m = carry(h, store(MOKOO), VIEWER)!.selection
    const rm = resolve(m, VIEWER, T1600)
    expect(rm.window).toEqual({ from: '2026-11-20', to: '2026-11-24' })
    expect(noteText(rm.notes.find(n => n.code === 'future_end')!)).toBe('Até hoje, 24 nov: o resto ainda não aconteceu.')
    expect(resolve(carry(m, store(HIBIKURA), VIEWER)!.selection, VIEWER, T1600).window.to).toBe('2026-11-25')
  })
  it('ex3: Hibikura 25 nov → Todas shows Hoje with future_start; at 00:00 BRT it is 25 nov', () => {
    const r = R(ALL, dates('2026-11-25', '2026-11-25'), T1600)
    expect(noteText(r.notes[0])).toBe('25 nov ainda não começou em Brasília: mostrando Hoje (24 nov).')
    const later = R(ALL, dates('2026-11-25', '2026-11-25'), T0001)
    expect(later.window).toEqual({ from: '2026-11-25', to: '2026-11-25' })
    expect(later.notes.find(n => n.code === 'future_start')).toBeUndefined()
  })
  it('ex4: a link for 28–30 nov opened on 24 nov says it has not begun', () => {
    const f = fitValue(dates('2026-11-28', '2026-11-30'), '2026-11-24')
    expect(f.notes).toEqual(['future_start'])
    expect(f.window).toEqual({ from: '2026-11-24', to: '2026-11-24' })
  })
  it('the date forms refuse invalid input with one check (max = the shown clock\'s today)', () => {
    expect(checkPickedDates('2026-11-26', '2026-11-27', '2026-11-25')).toEqual({ ok: false, error: 'A data inicial não pode passar de hoje.' })
    expect(checkPickedDates('2026-11-20', '2026-11-25', '2026-11-25')).toMatchObject({ ok: true })
  })
})

describe('R10 · archived stores', () => {
  const at = brt('2026-11-24', '14:19')
  it('ex1: Este mês: clamped 1–10 nov until 10h00, compared with 1–10 out cut at 10h00, same at 23:59', () => {
    for (const now of [at, T2359]) {
      const r = R(store(SQUISHY), preset('mtd'), now)
      expect(r.members[0]).toMatchObject({ state: 'clamped', read: { from: '2026-11-01', to: '2026-11-10' }, lastDayCut: 600 })
      expect(r.members[0].compare!.range).toEqual({ from: '2026-10-01', to: '2026-10-10' })
      expect(r.members[0].compare!.cutAtMinute).toBe(600)
      expect(r.partial).toBe(false)
      expect(noteText(r.notes.find(n => n.code === 'archived_clamp')!)).toBe('A Squishy World foi arquivada em 10 nov às 10h00 e não sincroniza mais: não há dados depois disso.')
    }
  })
  it('ex2: Hoje and 7 dias are frozen: no comparison, no countdown', () => {
    for (const p of [preset('today'), preset('7d')]) {
      const r = R(store(SQUISHY), p, at)
      expect(r.members[0].state).toBe('frozen')
      expect(r.comparison).toBeNull()
      expect(r.partial).toBe(false)
    }
  })
  it('ex3: 30 dias reads 25 out – 10 nov, compared with 8–24 out; Mês passado is closed', () => {
    const r = R(store(SQUISHY), preset('30d'), at)
    expect(r.members[0].read).toEqual({ from: '2026-10-25', to: '2026-11-10' })
    expect(r.members[0].compare!.range).toEqual({ from: '2026-10-08', to: '2026-10-24' })
    const m = R(store(SQUISHY), preset('lastmonth'), at)
    expect(m.members[0].state).toBe('closed')
    expect(m.members[0].compare!.range).toEqual({ from: '2026-09-01', to: '2026-09-30' })
  })
})

describe('R11 · stores before their first sale', () => {
  it('ex1: Glooty and Hibikura idle in October read "ainda não vendia"', () => {
    expect(beforeFirstSale('2026-10-31', { orders: 0, adSpend: 0 }, { firstOrderDate: '2026-11-06' })).toBe(true)
    expect(beforeFirstSale('2026-10-31', { orders: 0, adSpend: 0 }, { firstOrderDate: '2026-11-07' })).toBe(true)
  })
  it('ex2: Glooty spent $230 on 4–5 nov: not "ainda não vendia"', () => {
    expect(beforeFirstSale('2026-11-05', { orders: 0, adSpend: 230 }, { firstOrderDate: '2026-11-06' })).toBe(false)
  })
  it('ex3: MOKOO 15 dez 2025 – 15 jan 2026: the first sale is printed with its year', () => {
    const c = { window: { from: '2025-12-15', to: '2026-01-15' }, clockToday: '2026-11-24' }
    expect(dateBeside('2026-04-11', c)).toBe('11 abr 2026')
    expect(dateBeside('2026-11-07', { window: { from: '2026-11-01', to: '2026-11-24' }, clockToday: '2026-11-24' })).toBe('7 nov')
    expect(rangeBeside({ from: '2026-04-11', to: '2026-04-30' }, c)).toBe('11–30 abr 2026')
  })
  it('a store that never sold counts as after every window; fixed costs are not activity', () => {
    expect(beforeFirstSale('2026-11-24', { orders: 0, adSpend: 0 }, { firstOrderDate: null })).toBe(true)
  })
  it('starts inside the window: the note counts the days before', () => {
    expect(startsInside({ from: '2026-11-01', to: '2026-11-24' }, { firstActivityDate: '2026-11-07' })).toEqual({ day: '2026-11-07', daysBefore: 6 })
    expect(startsInside({ from: '2026-11-08', to: '2026-11-24' }, { firstActivityDate: '2026-11-07' })).toBeNull()
  })
})

describe('R12 · decision windows', () => {
  it('ex1: Hibikura at 00:16 Tokyo judges 17–23 nov (Tokyo days)', () => {
    expect(decisionWindow('Asia/Tokyo', tokyo('2026-11-24', '00:16')).window).toEqual({ from: '2026-11-17', to: '2026-11-23' })
  })
  it('ex2: MOKOO at 01:22 BRT still judges its 7 closed days', () => {
    expect(decisionWindow('America/Belem', brt('2026-11-24', '01:22')).window).toEqual({ from: '2026-11-17', to: '2026-11-23' })
  })
})

describe('R13 · in-flight navigation', () => {
  const ctx13 = { archivedIds: [] }
  it('ex1: Ontem in flight, then Todas → /overview with Ontem', () => {
    const latest = layer('/?loja=mokoo', { kind: 'period', period: preset('yesterday') }, ctx13)
    expect(layer(latest, { kind: 'store', scope: ALL }, ctx13)).toBe('/overview?loja=todas&periodo=yesterday&vem=mokoo')
  })
  it('ex2: 30 dias in flight, then EPOCH', () => {
    const latest = layer('/?loja=mokoo', { kind: 'period', period: preset('30d') }, ctx13)
    expect(layer(latest, { kind: 'store', scope: store(EPOCH) }, ctx13)).toBe('/?loja=epoch&periodo=30d&vem=mokoo')
  })
  it('ex3: 30 dias in flight, then sidebar Produtos', () => {
    const latest = layer('/?loja=mokoo', { kind: 'period', period: preset('30d') }, ctx13)
    expect(layer(latest, { kind: 'page', path: '/products' }, ctx13)).toBe('/products?loja=mokoo&periodo=30d')
  })
})

describe('R14 · other parameters', () => {
  it('ex1: campanha survives a period change and drops on a store change', () => {
    const a = layer('/campaigns?loja=mokoo&periodo=30d&aba=criativos&campanha=X', { kind: 'period', period: preset('7d') }, { archivedIds: [] })
    expect(a).toBe('/campaigns?loja=mokoo&aba=criativos&campanha=X')
    expect(layer(a, { kind: 'store', scope: store(EPOCH) }, { archivedIds: [] })).toBe('/campaigns?loja=epoch&aba=criativos&vem=mokoo')
  })
  it('ex2: parte travels on a row link; a fresh tab has none', () => {
    expect(layer('/?loja=mokoo&parte=50', { kind: 'page', path: '/', scope: store(EPOCH) }, { archivedIds: [] })).toBe('/?loja=epoch&parte=50&vem=mokoo')
  })
  it('ex3: a volta page → Mais 1–10 nov → plain dates, no volta (L433)', () => {
    expect(layer('/products?loja=mokoo&periodo=7d&volta=today', { kind: 'period', period: dates('2026-11-01', '2026-11-10') }, { archivedIds: [] }))
      .toBe('/products?loja=mokoo&periodo=custom&de=2026-11-01&ate=2026-11-10')
  })
})

describe('R15 · invalid, legacy and hostile parameters', () => {
  it('ex1: periodo=semana → bad_param, default period', () => {
    expect(parseDesktop({ loja: MOKOO, periodo: 'semana' }, ctx('/')).canonical).toBe('/?loja=mokoo&ajuste=bad_param')
  })
  it('ex3: the old row link with volta=today: today on Brasília → Hoje; on 26 nov → its dates', () => {
    const sp = { loja: HIBIKURA, periodo: 'custom', de: '2026-11-24', ate: '2026-11-24', volta: 'today' }
    expect(parseDesktop(sp, ctx('/', MOKOO, T1600)).canonical).toBe('/?loja=hibikura&periodo=today')
    expect(parseDesktop(sp, ctx('/', MOKOO, brt('2026-11-26', '10:00'))).canonical).toBe('/?loja=hibikura&periodo=custom&de=2026-11-24&ate=2026-11-24')
  })
  it('ex5: /products?…&periodo=7d&volta=today → /products?loja=MOKOO', () => {
    expect(parseDesktop({ loja: MOKOO, periodo: '7d', volta: 'today' }, ctx('/products')).canonical).toBe('/products?loja=mokoo')
  })
  it('every canonical URL parses to itself', () => {
    const inputs = [
      {}, { loja: 'todas' }, { loja: MOKOO, periodo: 'semana' }, { loja: HIBIKURA, periodo: 'custom', de: '2026-11-25', ate: '2026-11-01' },
      { loja: MOKOO, de: '1990-01-01', ate: '1990-02-01' }, { periodo: 'custom', de: '2026-11-01' }, { loja: MOKOO, parte: '49' },
      { loja: 'bad id!' }, { loja: SQUISHY, periodo: 'mtd' },
    ]
    for (const sp of inputs) for (const path of ['/', '/overview', '/campaigns']) {
      const p = parseDesktop(sp, ctx(path))
      if (!p.selection) continue
      const q = Object.fromEntries(new URLSearchParams(p.canonical.split('?')[1] ?? ''))
      const again = parseDesktop(q, ctx(p.canonical.split('?')[0]))
      expect(again.canonical).toBe(p.canonical)
      expect(again.redirect).toBe(false)
    }
  })
  it('a store that is not the viewer\'s is a 404; /overview with a store shows Todas; Todas for one store → its Resumo', () => {
    expect(parseDesktop({ loja: 'someone_else' }, ctx('/')).notFound).toBe(true)
    expect(parseDesktop({ loja: MOKOO }, ctx('/overview')).canonical).toBe('/overview?loja=todas')
    const one = parseDesktop({ loja: 'todas' }, { pathname: '/overview', viewer: PARTNER_ONE, remembered: null, now: T1600 })
    expect(one.canonical).toBe('/?loja=camp&ajuste=single_store')
  })
  it('store-only page with loja=todas → remembered store with vem=todas', () => {
    expect(parseDesktop({ loja: 'todas', periodo: 'today' }, ctx('/')).canonical).toBe('/?loja=mokoo&periodo=today&vem=todas')
  })
  it('desktopHref never writes a legacy or unknown key, even from the path', () => {
    const h = desktopHref('/products?volta=today&compare=mtd&dia=2026-11-01&vem=x', sel(store(MOKOO), preset('7d')))
    expect(h).toBe('/products?loja=mokoo')
  })
  it('the 404 link keeps the period, never the store or volta', () => {
    expect(keepPeriodHref('/', new URLSearchParams('loja=x&periodo=custom&de=2026-11-01&ate=2026-11-10&volta=today&parte=50')))
      .toBe('/?periodo=custom&de=2026-11-01&ate=2026-11-10&parte=50')
  })
})

describe('R17 · notification links', () => {
  it('one producer: dates, periodo=custom, origem=push, nonce, members hash for Todas', () => {
    expect(notificationHref({ loja: MOKOO, from: '2026-11-24', to: '2026-11-24', nonce: 'k3x9q2ab' }))
      .toBe('/m?loja=mokoo&periodo=custom&de=2026-11-24&ate=2026-11-24&origem=push&n=k3x9q2ab')
    const h = notificationHref({ loja: 'todas', from: '2026-11-24', to: '2026-11-24', nonce: 'k3x9q2ab', members: [MOKOO, EPOCH] })
    expect(h).toContain(`&m=${membersHash([EPOCH, MOKOO])}`)
    expect(notificationHref({ loja: GLOOTY, from: '2026-11-14', to: '2026-11-20', aba: 'campanhas', nonce: 'abc' })).toContain('aba=campanhas&origem=push')
  })
  it('legacy forms: custom+dia, today+dia, preset+dia, preset alone, undated', () => {
    expect(parseLegacyPush({ periodo: 'custom', de: '2026-11-24', ate: '2026-11-24', dia: '2026-11-24', volta: 'yesterday' }).value).toEqual(dates('2026-11-24', '2026-11-24'))
    expect(parseLegacyPush({ periodo: 'today', de: null, ate: null, dia: '2026-11-21', volta: null }).value).toEqual(dates('2026-11-21', '2026-11-21'))
    expect(parseLegacyPush({ periodo: '7d', de: null, ate: null, dia: '2026-11-21', volta: null }).value).toEqual(dates('2026-11-14', '2026-11-20'))
    expect(parseLegacyPush({ periodo: '7d', de: null, ate: null, dia: null, volta: null }).value).toEqual(preset('7d'))
    expect(parseLegacyPush({ periodo: null, de: null, ate: null, dia: null, volta: null })).toEqual({ value: null, undated: true, notes: [] })
  })
})

describe('R19 · one window for server routes', () => {
  it('windowFor resolves on the store clock through lib/period (normalised, fitted)', () => {
    expect(windowFor('7d', 'Asia/Tokyo', null, null, T1600)).toEqual({ from: '2026-11-18', to: '2026-11-24' })
    expect(windowFor('custom', 'America/Belem', '2026-11-20', '2026-11-30', T1600)).toEqual({ from: '2026-11-20', to: '2026-11-24' })
    expect(previousFor('mtd', { from: '2026-11-01', to: '2026-11-24' }, 'America/Belem', T1600)).toMatchObject({ from: '2026-10-01', to: '2026-10-24', label: 'mesmos dias do mês passado' })
  })
})

describe('§4 notes and parsing', () => {
  it('parsePeriod: preset, custom, bad, incomplete, too early, reversed', () => {
    expect(parsePeriod({ periodo: '7d', de: '2026-01-01', ate: '2026-01-02' })).toEqual({ value: preset('7d'), notes: [], absent: false })
    expect(parsePeriod({ periodo: 'custom', de: '2026-11-10', ate: '2026-11-01' }).value).toEqual(dates('2026-11-01', '2026-11-10'))
    expect(parsePeriod({ periodo: 'semana' }).notes).toEqual(['bad_param'])
    expect(parsePeriod({ periodo: 'custom', de: '2026-11-01' }).notes).toEqual(['incomplete'])
    expect(parsePeriod({ periodo: 'custom', de: '2026-02-30', ate: '2026-03-01' }).notes).toEqual(['incomplete'])
    expect(parsePeriod({ de: '1990-01-01', ate: '1990-02-01' }).notes).toEqual(['too_early'])
    expect(parsePeriod({}).absent).toBe(true)
  })
  it('buttons: compact dates and the year line', () => {
    expect(datesButton({ from: '2026-10-25', to: '2026-11-23' })).toBe('25/10–23/11')
    expect(datesButtonYear({ from: '2026-10-25', to: '2026-11-23' }, '2026-11-24')).toBeNull()
  })
})
