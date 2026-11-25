/**
 * One regression case per bug of the spec's bug→rule table (spec.md §6),
 * named after the bug (#n · round · Lline of past_period_bugs.md), each run
 * with the clock injected through lib/period.
 */

import { describe, expect, it } from 'vitest'
import {
  announce, beforeFirstSale, carry, countdownText, dateBeside, decisionWindow, desktopHref, layer, minutesLeft,
  notificationHref, parseDesktop, pickIsNoop, preset, dates, resolve, startsInside, MENU, presetInfo,
  type PeriodValue, type ScopeRef, type Selection,
} from '..'
import { openApp, reduce, readSaved, stripFor, shownView, type PhoneState, type SavedView } from '../phone'
import { ALL, brt, EPOCH, GLOOTY, HIBIKURA, MOKOO, SQUISHY, store, VIEWER } from './fixtures'

const sel = (scope: ScopeRef, period: PeriodValue, split = false): Selection => ({ scope, period, split })
const R = (scope: ScopeRef, period: PeriodValue, now: Date) => resolve(sel(scope, period), VIEWER, now)
const T1600 = brt('2026-11-24', '16:00')
const LAYER = { archivedIds: [SQUISHY] }
const savedOf = (loja: string, period: PeriodValue, aba: SavedView['aba'] = null): SavedView => ({ v: 3, loja, period, aba })
let n = 0
const newId = () => `v${++n}`
const open = (url: string, saved: SavedView, now: Date, navType: 'navigate' | 'reload' = 'navigate') =>
  openApp({ url, navType, fromSwMessage: false, session: null, saved, viewer: VIEWER, now, newId })
const push = (loja: string, from: string, to = from, extra = '') =>
  `${notificationHref({ loja, from, to, nonce: `n${++n}` })}${extra}`

describe('period bugs: one regression per bug (spec §6)', () => {
  it('#3 s4r1 L15 · notification opens the last-used period', () => {
    const o = open(push(MOKOO, '2026-11-24'), savedOf('todas', preset('30d')), brt('2026-11-25', '08:00'))
    expect(shownView(o.state).period).toEqual(dates('2026-11-24', '2026-11-24'))
  })
  it('#5 s4r1 L32 · Hibikura row opens a different day than the row showed — it is announced on both ends', () => {
    const a = announce(sel(ALL, preset('today')), ALL, store(HIBIKURA), VIEWER, T1600)!
    expect(a.line).toContain('25 nov')
    expect(a.landing).toContain('Em Todas as lojas, Hoje é 24 nov')
  })
  it('#6 s4r1 L41 · sparkline counts days before Hibikura existed — trails start at firstActivityDate', () => {
    expect(startsInside({ from: '2026-10-26', to: '2026-11-24' }, { firstActivityDate: '2026-11-07' })!.day).toBe('2026-11-07')
  })
  it('#7 s4r1 L47 · parte=50 is a view toggle: it travels, never changes the period', () => {
    const h = layer('/?loja=mokoo&periodo=mtd', { kind: 'split', on: true }, LAYER)
    expect(h).toBe('/?loja=mokoo&periodo=mtd&parte=50')
  })
  it('#8 s4r1 L53 · "Todas" picked while a period loads does nothing', () => {
    const latest = layer('/?loja=mokoo', { kind: 'period', period: preset('yesterday') }, LAYER)
    expect(pickIsNoop(ALL, latest)).toBe(false)
    expect(layer(latest, { kind: 'store', scope: ALL }, LAYER)).toBe('/overview?loja=todas&periodo=yesterday&vem=mokoo')
  })
  it('#9 s4r1 L59 · pinning the store already shown is not leaving', () => {
    expect(pickIsNoop(store(MOKOO), '/profit?loja=mokoo&periodo=30d')).toBe(true)
  })
  it('#10 s4r2 L65 · cut comparison label overflows KPI pills — short label says each day once', () => {
    const r = R(store(MOKOO), preset('mtd'), brt('2026-11-24', '00:06'))
    expect(r.comparison!.short).toBe('vs 1–24 out (até 00h06)')
  })
  it('#11 s4r2 L71 · creative chip on 7 closed days beside the page window — the block names its own dates', () => {
    expect(decisionWindow('America/Belem', T1600).window).toEqual({ from: '2026-11-17', to: '2026-11-23' })
  })
  it('#12 s4r2 L77 · Mês passado trail "sem movimento" before the store existed', () => {
    expect(beforeFirstSale('2026-10-31', { orders: 0, adSpend: 0 }, { firstOrderDate: '2026-11-07' })).toBe(true)
  })
  it('#13 s4r2 L83 · Hibikura row turns Hoje into a date that follows every chip', () => {
    const c = carry(sel(ALL, preset('today')), store(HIBIKURA), VIEWER)!
    expect(c.selection.period).toEqual(preset('today'))
  })
  it('#14 s4r2 L89 · two "empate" on one creative row — the decision window is its own, named', () => {
    const d = decisionWindow('Asia/Tokyo', T1600)
    expect(d.window).not.toEqual(R(store(HIBIKURA), preset('30d'), T1600).window)
  })
  it('#15 s4r2 L95 · countdown "Faltam 1 min" / "24h00"', () => {
    expect(countdownText(minutesLeft('America/Belem', brt('2026-11-25', '00:00')))).toBe('Faltam 23h59')
    expect(countdownText(1)).toBe('Falta 1 min')
    expect(countdownText(0)).toBe('Falta menos de 1 min')
  })
  it('#16 s4r2 L101 · Tokyo screen footer in the phone time — the screen clock is Tokyo', () => {
    const r = R(store(HIBIKURA), preset('today'), T1600)
    expect(r.clockTz).toBe('Asia/Tokyo')
    expect(r.partialUntil).toBe('04h00')
  })
  it('#18 s4r2 L113 · link to an unknown store silently opens the last store', () => {
    const o = open('/m?loja=bogus&periodo=custom&de=2026-11-25&ate=2026-11-25&origem=push', savedOf(MOKOO, preset('7d')), T1600)
    expect(o.state.visit).toBeNull()
    expect(o.notes.map(x => x.code)).toEqual(['unknown_store'])
    expect(shownView(o.state)).toMatchObject({ loja: MOKOO, period: preset('7d') })
  })
  it('#19 s4r2 L119 · daily summary differs from the Todas · Hoje it opens — same dates', () => {
    const o = open(push('todas', '2026-11-24'), savedOf('todas', preset('7d')), brt('2026-11-24', '23:00'))
    expect(shownView(o.state).period).toEqual(dates('2026-11-24', '2026-11-24'))
  })
  it('#21 s4r2 L131 · row dates stay after going back to Todas and come back next day', () => {
    let s: PhoneState = { saved: savedOf('todas', preset('today')), visit: null, closedStrip: false, transient: [] }
    s = reduce(s, { type: 'row', loja: HIBIKURA }, VIEWER, newId)
    s = reduce(s, { type: 'chip', loja: 'todas' }, VIEWER, newId)
    expect(s.saved).toEqual(savedOf('todas', preset('today')))
  })
  it('#22 s4r3 L145 · campanha dropped silently and coming back', () => {
    const a = layer('/campaigns?loja=mokoo&aba=criativos&campanha=X', { kind: 'period', period: preset('30d') }, LAYER)
    expect(a).toContain('campanha=X')
    const b = layer(a, { kind: 'store', scope: store(EPOCH) }, LAYER)
    expect(b).not.toContain('campanha')
    expect(layer(b, { kind: 'store', scope: store(MOKOO) }, LAYER)).not.toContain('campanha')
  })
  it('#23 s4r3 L156 · Glooty "sem custos" vs Hibikura "ainda não vendia" for October', () => {
    expect(beforeFirstSale('2026-10-31', { orders: 0, adSpend: 0 }, { firstOrderDate: '2026-11-06' })).toBe(true)
  })
  it('#26 s4r3 L174 · archived store on Hoje reads as a live day', () => {
    const r = R(store(SQUISHY), preset('today'), T1600)
    expect(r.members[0].state).toBe('frozen')
    expect(r.partial).toBe(false)
  })
  it('#27 s4r3 L180 · deep link cut to 366 days silently', () => {
    expect(parseDesktop({ loja: MOKOO, periodo: 'custom', de: '2024-01-01', ate: '2026-11-20' }, { pathname: '/', viewer: VIEWER, remembered: null, now: T1600 }).canonical)
      .toBe('/?loja=mokoo&periodo=custom&de=2025-11-20&ate=2026-11-20&ajuste=too_long')
  })
  it('#28 s4r3 L186 · "começou em 11 abr" without the year', () => {
    expect(dateBeside('2026-04-11', { window: { from: '2025-12-15', to: '2026-01-15' }, clockToday: '2026-11-24' })).toBe('11 abr 2026')
  })
  it('#30 s4r3 L200 · "Cedo demais" hides a decided 7-day verdict — the decision window is closed days', () => {
    expect(decisionWindow('America/Belem', brt('2026-11-24', '01:22')).window.to).toBe('2026-11-23')
  })
  it('#31 s5r1 L206 · "ontem até esta hora" includes a store out of the count', () => {
    const r = R(ALL, preset('14d'), T1600)
    expect(r.comparison!.leftOut).toEqual(expect.arrayContaining(['Glooty', 'Hibikura']))
  })
  it('#32 s5r1 L214 · total-row note names Hibikura but not Glooty — one test for both', () => {
    for (const first of ['2026-11-06', '2026-11-07']) expect(beforeFirstSale('2026-10-31', { orders: 0, adSpend: 0 }, { firstOrderDate: first })).toBe(true)
  })
  it('#33 s5r1 L220 · period name cut off on the phone bar — button texts come from MENU', () => {
    for (const p of [...MENU.main, ...MENU.more]) expect(presetInfo(p).button.length).toBeLessThanOrEqual(11)
  })
  it('#34 s5r1 L226 · push tapped after its day opens the new Hoje', () => {
    const o = open(push(HIBIKURA, '2026-11-24'), savedOf('todas', preset('today')), brt('2026-11-24', '12:05'))
    const r = resolve({ scope: store(HIBIKURA), period: shownView(o.state).period, split: false }, VIEWER, brt('2026-11-24', '12:05'))
    expect(r.window).toEqual({ from: '2026-11-24', to: '2026-11-24' })
    expect(r.members[0].state).toBe('closed')
  })
  it('#35 s5r1 L232 · row dates for Este mês change the comparison', () => {
    const c = carry(sel(ALL, preset('mtd')), store(HIBIKURA), VIEWER)!.selection
    expect(resolve(c, VIEWER, brt('2026-12-24', '16:00')).comparison!.words).toBe('mesmos dias do mês passado')
  })
  it('#38 s5r1 L268 · first-sale date without year beside a cross-year window', () => {
    expect(dateBeside('2026-02-18', { window: { from: '2025-12-01', to: '2026-03-01' }, clockToday: '2026-11-24' })).toBe('18 fev 2026')
  })
  it('#39 s5r1 L284 · every store before its first sale: "venderam $0"', () => {
    expect(beforeFirstSale('2025-01-01', { orders: 0, adSpend: 0 }, { firstOrderDate: '2026-04-11' })).toBe(true)
  })
  it('#40 s5r1 L295 · desktop row turns the preset into dates that follow picker and sidebar', () => {
    const row = carry(sel(ALL, preset('today')), store(HIBIKURA), VIEWER)!.selection
    expect(desktopHref('/', row)).toBe('/?loja=hibikura&periodo=today')
  })
  it('#41 s5r2 L301 · volta survives the shell merge; picked dates snap to the preset', () => {
    expect(layer('/?loja=mokoo&periodo=custom&de=2026-11-24&ate=2026-11-24&volta=today', { kind: 'period', period: dates('2026-11-01', '2026-11-10') }, LAYER))
      .toBe('/?loja=mokoo&periodo=custom&de=2026-11-01&ate=2026-11-10')
  })
  it('#43 s5r2 L313 · Campanhas · Todas past tense on a running day — Resolution.partial', () => {
    expect(R(ALL, preset('today'), T1600).partial).toBe(true)
  })
  it('#44 s5r2 L319 · creative page "deu lucro hoje" on a running day — Resolution.partial', () => {
    expect(R(store(MOKOO), preset('today'), T1600).partial).toBe(true)
  })
  it('#46 s5r2 L331 · archived Este mês "não há dados neste mês"', () => {
    expect(R(store(SQUISHY), preset('mtd'), T1600).members[0].state).toBe('clamped')
  })
  it('#47 s5r2 L337 · store page from Todas · Este mês compares "24 dias anteriores"', () => {
    const c = carry(sel(ALL, preset('mtd')), store(MOKOO), VIEWER)!.selection
    expect(resolve(c, VIEWER, T1600).comparison!.words).toBe('mesmos dias do mês passado')
  })
  it('#49 s5r2 L349 · a notification about an earlier day replaces the owner period', () => {
    const o = open(push(MOKOO, '2026-11-20'), savedOf('todas', preset('30d')), T1600)
    expect(o.state.saved.period).toEqual(preset('30d'))
    expect(reduce(o.state, { type: 'chip', loja: MOKOO }, VIEWER, newId).saved.period).toEqual(preset('30d'))
  })
  it('#51 s5r2 L367 · cross-year range cut on the period button', () => {
    const r = R(ALL, dates('2025-12-25', '2026-01-03'), T1600)
    expect([r.label.button, r.label.buttonYear]).toEqual(['25/12–3/1', '2025–26'])
  })
  it('#52 s5r2 L373 · desktop Hibikura row in Este mês compares "N dias anteriores"', () => {
    const r = R(ALL, preset('mtd'), T1600)
    expect(r.comparison!.words).toBe('mesmos dias do mês passado')
  })
  it('#53 s5r2 L379 · archived Este mês "não há dados"', () => {
    expect(R(store(SQUISHY), preset('mtd'), T1600).members[0].read).toEqual({ from: '2026-11-01', to: '2026-11-10' })
  })
  it('#54 s5r2 L385 · desktop row chip "sem vendas" before the first sale', () => {
    expect(beforeFirstSale('2026-10-31', { orders: 0, adSpend: 0, adjustments: 0 }, { firstOrderDate: '2026-11-07' })).toBe(true)
  })
  it('#56 s5r2 L397 · after a volta link, picked dates open the old preset', () => {
    const p = parseDesktop({ loja: MOKOO, periodo: 'custom', de: '2026-11-01', ate: '2026-11-10', volta: 'today' }, { pathname: '/', viewer: VIEWER, remembered: null, now: T1600 })
    expect(p.selection!.period).toEqual(dates('2026-11-01', '2026-11-10'))
    expect(p.canonical).not.toContain('volta')
  })
  it('#59 s5r2 L415 · first-sale and KPI dates without year beside cross-year windows', () => {
    expect(dateBeside('2026-04-11', { window: { from: '2026-01-01', to: '2026-01-31' }, comparison: { from: '2025-12-01', to: '2025-12-31' }, clockToday: '2026-11-24' })).toBe('11 abr 2026')
  })
  it('#62 s5r2 L433 · desktop "Escolher datas" opens the preset on a volta page', () => {
    expect(layer('/products?loja=mokoo&periodo=7d&volta=today', { kind: 'period', period: dates('2026-11-01', '2026-11-10') }, LAYER))
      .toBe('/products?loja=mokoo&periodo=custom&de=2026-11-01&ate=2026-11-10')
    expect(parseDesktop({ loja: MOKOO, periodo: 'custom', de: '2026-11-01', ate: '2026-11-10', volta: 'today' }, { pathname: '/products', viewer: VIEWER, remembered: null, now: T1600 }).canonical)
      .toBe('/products?loja=mokoo&periodo=custom&de=2026-11-01&ate=2026-11-10')
  })
  it('#63 s5r2 L455 · a push tapped after its day becomes the saved period', () => {
    const o = open(push(MOKOO, '2026-11-24'), savedOf('todas', preset('7d')), brt('2026-11-25', '09:00'))
    expect(o.state.saved).toEqual(savedOf('todas', preset('7d')))
  })
  it('#64 s5r2 L474 · desktop row from Todas · Este mês compares "24 dias anteriores"', () => {
    const c = carry(sel(ALL, preset('mtd')), store(EPOCH), VIEWER)!.selection
    expect(resolve(c, VIEWER, T1600).comparison!.range).toEqual({ from: '2026-10-01', to: '2026-10-24' })
  })
  it('#65 s5r2 L490 · Hibikura dates through Todas labelled "Ontem de Todas as lojas"', () => {
    const c = carry(sel(store(HIBIKURA), preset('yesterday')), ALL, VIEWER)!.selection
    const r = resolve(c, VIEWER, T1600)
    expect(r.window).toEqual({ from: '2026-11-23', to: '2026-11-23' })
    expect(r.label.full).toBe('Ontem · 23 nov')
  })
  it('#66 s5r3 L501 · on Todas with Hibikura dates, a Brazil row opens a different day', () => {
    const todas = sel(ALL, dates('2026-11-24', '2026-11-24'))
    expect(carry(todas, store(MOKOO), VIEWER)!.selection.period).toEqual(dates('2026-11-24', '2026-11-24'))
    expect(parseDesktop({ loja: 'todas' }, { pathname: '/', viewer: VIEWER, remembered: MOKOO, now: T1600 }).selection!.scope).toEqual(store(MOKOO))
  })
  it('#68 s5r3 L513 · archived Este mês "não há dados" on Campanhas/Produtos/Países/Atribuição — one state', () => {
    const r = R(store(SQUISHY), preset('mtd'), T1600)
    expect(r.members[0]).toMatchObject({ state: 'clamped', read: { from: '2026-11-01', to: '2026-11-10' } })
  })
  it('#69 s5r3 L519 · archived Este mês compares 1–10 nov with 1–24 out cut at the hour', () => {
    const c = R(store(SQUISHY), preset('mtd'), T1600).members[0].compare!
    expect(c).toEqual({ range: { from: '2026-10-01', to: '2026-10-10' }, cutAtMinute: 600, base: 'full' })
  })
  it('#71 s5r3 L531 · summary push then Hibikura row: Ontem moves at Tokyo midnight under the strip', () => {
    const o = open(push('todas', '2026-11-24'), savedOf('todas', preset('7d')), brt('2026-11-25', '08:00'))
    const s = reduce(o.state, { type: 'row', loja: HIBIKURA }, VIEWER, newId)
    expect(shownView(s)).toMatchObject({ loja: HIBIKURA, period: dates('2026-11-24', '2026-11-24') })
    const r = resolve({ scope: store(HIBIKURA), period: shownView(s).period, split: false }, VIEWER, brt('2026-11-25', '12:01'))
    expect(r.window).toEqual({ from: '2026-11-24', to: '2026-11-24' })
  })
  it('#72 s5r3 L537 · scale push becomes the saved period and tab', () => {
    const o = open(push(GLOOTY, '2026-11-14', '2026-11-20', '&aba=campanhas'), savedOf('todas', preset('7d')), T1600)
    expect(o.state.saved).toEqual(savedOf('todas', preset('7d')))
  })
  it('#73 s5r3 L543 · strip promises "ao trocar de loja"; closed strip comes back after a row tap', () => {
    const o = open(push('todas', '2026-11-24'), savedOf('todas', preset('7d')), brt('2026-11-25', '08:00'))
    expect(stripFor(o.state, VIEWER, null, '2026-11-25')!.text).not.toMatch(/ao trocar de loja/i)
    const closed = reduce(o.state, { type: 'close_strip' }, VIEWER, newId)
    const row = reduce(closed, { type: 'row', loja: HIBIKURA }, VIEWER, newId)
    expect(row.visit!.id).toBe(o.state.visit!.id)
    expect(stripFor(row, VIEWER, null)).toBeNull()
  })
  it('#75 s5r3 L555 · archived Este mês and Hoje compared "até esta hora"', () => {
    expect(R(store(SQUISHY), preset('mtd'), T1600).members[0].compare!.cutAtMinute).toBe(600)
    expect(R(store(SQUISHY), preset('today'), T1600).comparison).toBeNull()
  })
  it('#76 s5r3 L563 · the archived Este mês fix reached only the Resumo — the state is in the resolution', () => {
    expect(R(store(SQUISHY), preset('mtd'), brt('2026-11-24', '23:59')).members[0].state).toBe('clamped')
  })
  it('#77 s5r3 L569 · Todas row with spend before the first sale says "ainda não vendia" with dashes', () => {
    expect(beforeFirstSale('2026-11-05', { orders: 0, adSpend: 230 }, { firstOrderDate: '2026-11-06' })).toBe(false)
  })
  it('#78 s5r3 L575 · Todas · Mês passado says "nas mesmas datas"; the link opens the preset', () => {
    expect(announce(sel(ALL, preset('lastmonth')), ALL, store(HIBIKURA), VIEWER, T1600)).toBeNull()
  })
  it('#79 s5r3 L581 · archived disputes "Situação hoje" — the as-of instant is the archive instant', () => {
    const r = R(store(SQUISHY), preset('mtd'), T1600)
    expect(r.members[0].lastDayCut).toBe(600)
  })
  it('#80 s5r3 L587 · archived Este mês compared cut at the hour', () => {
    expect(R(store(SQUISHY), preset('mtd'), brt('2026-11-24', '14:19')).members[0].compare!.cutAtMinute).toBe(600)
  })
  it('#81 s5r3 L593 · phone saves the scale push 7 dias', () => {
    const o = open('/m?loja=mokoo&periodo=7d&aba=campanhas&dia=2026-11-21', savedOf('todas', preset('today')), T1600)
    expect(shownView(o.state)).toMatchObject({ period: dates('2026-11-14', '2026-11-20'), aba: 'campanhas' })
    expect(o.state.saved).toEqual(savedOf('todas', preset('today')))
  })
  it('#82 s5r3 L599 · archived Este mês "não há dados" on 4 pages', () => {
    expect(R(store(SQUISHY), preset('mtd'), T1600).members[0].read).not.toBeNull()
  })
  it('#83 s5r3 L605 · Todas spend before the first sale shows dashes', () => {
    expect(beforeFirstSale('2026-11-05', { orders: 0, adSpend: 1130 }, { firstOrderDate: '2026-11-06' })).toBe(false)
  })
  it('#84 s5r3 L611 · archived comparison cut at the current hour', () => {
    expect(R(store(SQUISHY), preset('30d'), T1600).members[0].compare!.cutAtMinute).toBe(600)
  })
  it('saved view migration keeps only an active store (C2-L7), and not an archived store\'s period (r3 F13)', () => {
    expect(readSaved(null, JSON.stringify({ loja: SQUISHY, periodo: '7d', aba: 'produtos' }), VIEWER).saved).toEqual(savedOf('todas', preset('today'), 'produtos'))
    expect(readSaved(null, JSON.stringify({ loja: MOKOO, periodo: '7d', aba: 'produtos' }), VIEWER).saved).toEqual(savedOf(MOKOO, preset('7d'), 'produtos'))
  })
})
