/**
 * period-fix-r2: one regression per finding of the round-2 bug hunt, each
 * named "F<n> · …" after the finding's place in the list. Clock injected
 * (P6): 24 nov 2026, Brasília UTC−3, Tokyo UTC+9.
 */

import { describe, expect, it } from 'vitest'
import {
  announce, archiveMoment, checkPickedDates, dates, layer, notesText, parseDesktop, parseLegacyPush, pickerDates,
  preset, previousFor, relayLink, resolve, type ScopeRef, type Selection,
} from '..'
import {
  act, factsChange, liveTransient, openApp, parsePhoneLink, reduce, rowHelp, shownSelection, storeOptions, stripFor,
  type PhoneState, type SavedView, type Visit,
} from '../phone'
import { viewerStores } from '../viewer'
import { decisionWindow } from '../decision'
import { decisionWindows } from '../../data/campaigns'
import { ALL, brt, EPOCH, GLOOTY, HIBIKURA, MOKOO, PARTNER_ONE, SQUISHY, STORES, store, VIEWER } from './fixtures'

const sel = (scope: ScopeRef, period: Selection['period']): Selection => ({ scope, period, split: false })
const NONE = { archivedIds: [] as string[] }
const ARCH = { archivedIds: [SQUISHY] }
const T1600 = brt('2026-11-24', '16:00')
const T1900 = brt('2026-11-24', '19:00')
const T1925 = brt('2026-11-24', '19:25')
const ctx = (pathname: string, remembered: string | null = MOKOO, viewer = VIEWER) => ({ pathname, viewer, remembered, now: T1900 })
const saved = (loja: string, period = preset('7d')): SavedView => ({ v: 3, loja, period, aba: null })
const st = (s: SavedView, visit: Visit | null = null): PhoneState => ({ saved: s, visit, closedStrip: false, transient: [] })
let n = 0
const newId = () => `r${++n}`

/** A row/tab/in-page link clicked while `inFlight` loads, on the page `shown`. */
const click = (href: string, shown: string, inFlight: string, c = NONE) => {
  const link = relayLink(href, shown, c)
  return link ? layer(inFlight, link, c) : href
}

describe('desktop links over the latest requested selection (R13)', () => {
  it('F1/F18 · a Todas row clicked while "Ontem" loads opens the store on Ontem', () => {
    const shown = '/overview?loja=todas'
    const inFlight = layer(shown, { kind: 'period', period: preset('yesterday') }, NONE)
    expect(click(`/?loja=${MOKOO}&vem=todas`, shown, inFlight)).toBe(`/?loja=${MOKOO}&periodo=yesterday&vem=todas`)
    const today = layer(shown, { kind: 'period', period: preset('today') }, NONE)
    expect(click(`/?loja=${HIBIKURA}&vem=todas`, shown, today)).toBe(`/?loja=${HIBIKURA}&periodo=today&vem=todas`)
  })

  it('F1/F18 · a Campanhas · Todas row keeps a 30 dias still loading', () => {
    const shown = '/campaigns?loja=todas&periodo=yesterday'
    const inFlight = layer(shown, { kind: 'period', period: preset('30d') }, NONE)
    expect(click(`/campaigns?loja=${EPOCH}&periodo=yesterday&vem=todas`, shown, inFlight))
      .toBe(`/campaigns?loja=${EPOCH}&periodo=30d&vem=todas`)
  })

  it('F1 · an in-page drill-down keeps the period and split loading, and its own page keys only', () => {
    const shown = `/campaigns?loja=${MOKOO}&periodo=30d&parte=50&aba=criativos&campanha=120249693763810625`
    const inFlight = layer(shown, { kind: 'period', period: preset('today') }, NONE)
    expect(inFlight).toContain('campanha=120249693763810625')
    // "Ver os anúncios de todas as campanhas": aba kept, campanha dropped.
    expect(click(`/campaigns?loja=${MOKOO}&periodo=30d&parte=50&aba=criativos`, shown, inFlight))
      .toBe(`/campaigns?loja=${MOKOO}&periodo=today&parte=50&aba=criativos`)
    // The "Campanhas" tab drops aba.
    expect(click(`/campaigns?loja=${MOKOO}&periodo=30d&parte=50`, shown, inFlight))
      .toBe(`/campaigns?loja=${MOKOO}&periodo=today&parte=50`)
  })

  it('F1 · with nothing loading a relayed link is the href as rendered', () => {
    const shown = '/overview?loja=todas&periodo=30d'
    expect(click(`/?loja=${MOKOO}&periodo=30d&vem=todas`, shown, shown)).toBe(`/?loja=${MOKOO}&periodo=30d&vem=todas`)
    const camp = `/campaigns?loja=${MOKOO}&periodo=30d&aba=criativos&campanha=123`
    expect(click(`/creatives/987?loja=${MOKOO}&periodo=30d`, camp, camp)).toBe(`/creatives/987?loja=${MOKOO}&periodo=30d`)
  })

  it('F1 · a link that chooses its own period keeps it; leaving an archived store opens the default', () => {
    const shown = `/creatives/1?loja=${MOKOO}`
    const inFlight = layer(shown, { kind: 'period', period: preset('today') }, NONE)
    expect(click(`/creatives/1?loja=${MOKOO}&periodo=30d`, shown, inFlight)).toBe(`/creatives/1?loja=${MOKOO}&periodo=30d`)
    const arch = `/?loja=${SQUISHY}&periodo=custom&de=2026-10-12&ate=2026-11-10`
    expect(click(`/overview?loja=todas&vem=${SQUISHY}`, arch, arch, ARCH)).toBe(`/overview?loja=todas&vem=${SQUISHY}`)
  })

  it('F1 · /api routes and URLs without a store are not relayed', () => {
    expect(relayLink(`/api/export?loja=${MOKOO}`, '/overview?loja=todas', NONE)).toBeNull()
    expect(relayLink('/onboarding', '/overview?loja=todas', NONE)).toBeNull()
    expect(relayLink('https://x.test/?loja=a', '/overview?loja=todas', NONE)).toBeNull()
  })

  it('F18 · a period picked right after a row click lays over the row, not over Todas', () => {
    const shown = '/overview?loja=todas'
    const row = click(`/?loja=${MOKOO}&vem=todas`, shown, shown)
    expect(layer(row, { kind: 'period', period: preset('yesterday') }, { ...NONE, inFlight: true })).toBe(`/?loja=${MOKOO}&periodo=yesterday&vem=todas`)
    // Over a page already on screen the one-shot vem is not repeated.
    expect(layer(row, { kind: 'period', period: preset('yesterday') }, NONE)).toBe(`/?loja=${MOKOO}&periodo=yesterday`)
  })

  it('F17 · a sidebar store-only page from Todas keeps a store picked in flight', () => {
    const inFlight = layer('/overview?loja=todas&periodo=30d', { kind: 'store', scope: store(EPOCH) }, NONE)
    const side = { kind: 'page' as const, path: '/attribution', storeFallback: store(MOKOO), keys: 'inherit' as const }
    expect(layer(inFlight, side, NONE)).toBe(`/attribution?loja=${EPOCH}&periodo=30d`)
    // Nothing picked: the remembered store, as an R4 link with vem.
    expect(layer('/overview?loja=todas&periodo=30d', side, NONE)).toBe(`/attribution?loja=${MOKOO}&periodo=30d&vem=todas`)
    // /overview names Todas.
    expect(layer(`/?loja=${MOKOO}&periodo=30d`, { kind: 'page', path: '/overview', scope: ALL, keys: 'inherit' }, NONE))
      .toBe(`/overview?loja=todas&periodo=30d&vem=${MOKOO}`)
  })
})

describe('desktop picker and URL (R7, R9, R14, R15)', () => {
  it('F2 · the date form starts from the asked dates; editing one field keeps the asked end', () => {
    const p = pickerDates(dates('2026-11-20', '2026-11-25'), { from: '2026-11-20', to: '2026-11-24' }, '2026-11-24')
    expect(p).toEqual({ from: '2026-11-20', to: '2026-11-25', max: '2026-11-25' })
    const r = checkPickedDates('2026-11-18', p.to, p.max)
    expect(r.ok && r.value).toEqual(dates('2026-11-18', '2026-11-25'))
    // A preset starts from the window shown; max is today.
    expect(pickerDates(preset('7d'), { from: '2026-11-17', to: '2026-11-23' }, '2026-11-24'))
      .toEqual({ from: '2026-11-17', to: '2026-11-23', max: '2026-11-24' })
  })

  it('F3 · Campanhas · Todas declares no aba: the canonical drops it and the picker does not carry it', () => {
    const p = parseDesktop({ loja: 'todas', periodo: '7d', aba: 'criativos' }, ctx('/campaigns'))
    expect(p.canonical).toBe('/campaigns?loja=todas')
    expect(p.redirect).toBe(true)
    expect(layer(`/campaigns?loja=${MOKOO}&aba=criativos`, { kind: 'store', scope: ALL }, NONE)).toBe(`/campaigns?loja=todas&vem=${MOKOO}`)
    // Between stores it is still kept (keep policy).
    expect(layer(`/campaigns?loja=${MOKOO}&aba=criativos`, { kind: 'store', scope: store(EPOCH) }, NONE))
      .toBe(`/campaigns?loja=${EPOCH}&aba=criativos&vem=${MOKOO}`)
  })

  it('F4 · ajuste tokens that do not hold for the request are dropped by the canonical redirect', () => {
    const a = parseDesktop({ loja: MOKOO, ajuste: 'too_early,single_store' }, ctx('/'))
    expect(a.notes.map(x => x.code)).toEqual(['too_early'])
    expect(a.canonical).toBe(`/?loja=${MOKOO}&ajuste=too_early`)
    const b = parseDesktop({ loja: MOKOO, ajuste: `remembered_gone:${HIBIKURA}` }, ctx('/', null))
    expect(b.notes).toEqual([])
    expect(b.canonical).toBe(`/?loja=${MOKOO}`)
    const c = parseDesktop({ loja: MOKOO, periodo: 'custom', de: '2026-11-01', ate: '2026-11-10', ajuste: 'too_long' }, ctx('/'))
    expect(c.notes).toEqual([])
    expect(c.redirect).toBe(true)
    // A forwarded landing URL with a valid remembered store in this browser.
    expect(parseDesktop({ loja: MOKOO, ajuste: `remembered_gone:${SQUISHY}` }, ctx('/', MOKOO)).notes).toEqual([])
    // What really happened still shows.
    expect(parseDesktop({ loja: MOKOO, periodo: 'custom', de: '2025-12-30', ate: '2026-12-30', ajuste: 'too_long' }, ctx('/')).notes.map(x => x.code)).toEqual(['too_long'])
    expect(parseDesktop({ loja: MOKOO, ajuste: `remembered_gone:${SQUISHY}` }, ctx('/', null)).notes.map(x => x.code)).toEqual(['remembered_gone'])
    expect(parseDesktop({ loja: 'camp', ajuste: 'single_store' }, ctx('/', null, PARTNER_ONE)).notes.map(x => x.code)).toEqual(['single_store'])
  })
})

describe('announcements (R4, R7)', () => {
  it('F6 · same dates, but whole on the target and cut on the source, is announced', () => {
    const a = announce(sel(store(MOKOO), dates('2026-11-20', '2026-11-24')), store(MOKOO), store(HIBIKURA), VIEWER, T1925)
    expect(a?.landing).toBe('O período na Hibikura é 20–24 nov (dia de Tóquio), vs 15–19 nov (dias inteiros). Na MOKOO era 20–24 nov, vs 15–19 nov até 19h25.')
  })

  it('F26 · across the year turn both dates carry the year, or neither', () => {
    const t = brt('2026-12-31', '16:00')
    const a = announce(sel(ALL, preset('today')), ALL, store(HIBIKURA), VIEWER, t)!
    expect(a.line).toBe('Hibikura abre o Hoje de Tóquio (1 jan 2027)')
    expect(a.landing).toBe('Hoje na Hibikura é 1 jan 2027 (dia de Tóquio). Em Todas as lojas, Hoje é 31 dez 2026.')
    // Same year: no year anywhere.
    expect(announce(sel(ALL, preset('today')), ALL, store(HIBIKURA), VIEWER, T1600)!.landing)
      .toBe('Hoje na Hibikura é 25 nov (dia de Tóquio). Em Todas as lojas, Hoje é 24 nov.')
  })
})

describe('comparison and facts (R6, R10, R11)', () => {
  it('F19 · the mixed-cut clause covers only members in the delta', () => {
    const r = resolve(sel(ALL, dates('2026-11-10', '2026-11-24')), VIEWER, T1600)
    expect(r.comparison?.label).not.toMatch(/com o dia inteiro/)
    expect(r.comparison?.cut).toBe('all')
    expect(r.comparison?.label).toMatch(/^vs 15 dias anteriores até esta hora \(26 out – 9 nov\), sem Glooty \(começou em 4 nov\) e Hibikura \(começou em 7 nov\)$/)
  })

  it('F28 · the archive instant is said with its time on the store clock', () => {
    const sq = VIEWER.archived[0]
    expect(archiveMoment(sq, { window: { from: '2026-11-01', to: '2026-11-24' }, clockToday: '2026-11-24' })).toEqual({ day: '10 nov', time: '10h00' })
    expect(archiveMoment(VIEWER.active[0], { window: { from: '2026-11-01', to: '2026-11-24' }, clockToday: '2026-11-24' })).toBeNull()
  })

  it('F25 · a running window compares up to this minute, whatever its rule', () => {
    const mtd = previousFor('mtd', { from: '2026-11-01', to: '2026-11-24' }, 'America/Belem', T1600)
    expect(mtd).toMatchObject({ from: '2026-10-01', to: '2026-10-24', cutAtMinute: 960, sameTimeOfDay: true })
    const custom = previousFor('custom', { from: '2026-11-20', to: '2026-11-24' }, 'America/Belem', T1600)
    expect(custom).toMatchObject({ from: '2026-11-15', to: '2026-11-19', cutAtMinute: 960 })
    expect(previousFor('7d', { from: '2026-11-17', to: '2026-11-23' }, 'America/Belem', T1600).cutAtMinute).toBeNull()
  })

  it('F24 · the scale push judges and links the same decision window (one injected clock)', () => {
    const t = brt('2026-11-24', '12:00', '05')
    expect(decisionWindows('Asia/Tokyo', t)).toEqual(decisionWindow('Asia/Tokyo', t))
    expect(decisionWindows('Asia/Tokyo', t).window).toEqual({ from: '2026-11-18', to: '2026-11-24' })
  })
})

describe('phone (R4, R5, R10, R16, R17, R19)', () => {
  const sqVisit = (): PhoneState => reduce(st(saved('8jcp3a')), { type: 'archive', loja: SQUISHY, period: dates('2026-10-12', '2026-11-10') }, VIEWER, newId)

  it('F7 · tapping the pressed chip of the archived store on screen changes nothing', () => {
    const s = sqVisit()
    expect(reduce(s, { type: 'chip', loja: SQUISHY }, VIEWER)).toBe(s)
    expect(act(s, { type: 'chip', loja: SQUISHY }, VIEWER, T1600)).toBe(s)
    expect(shownSelection(act(s, { type: 'chip', loja: SQUISHY }, VIEWER, T1600)).scope).toEqual(store(SQUISHY))
  })

  it('F8 · leaving an archived store by a chip says the consultation period does not apply', () => {
    const s = act(sqVisit(), { type: 'chip', loja: MOKOO }, VIEWER, T1600)
    expect(s.visit).toBeNull()
    expect(notesText(s.transient)).toBe('O período da consulta da loja arquivada não vale aqui: mostrando Últimos 7 dias.')
  })

  it('F9 · a chip that ends a push visit does not announce against a view that was not on screen', () => {
    const t = brt('2026-11-24', '19:26')
    const opened = openApp({
      url: `/m?loja=${HIBIKURA}&periodo=custom&de=2026-11-24&ate=2026-11-24&origem=push&n=q1w2e3r4`,
      navType: 'navigate', fromSwMessage: false, session: null, saved: saved('todas', preset('today')), viewer: VIEWER, now: t, newId,
    })
    const s = act(opened.state, { type: 'chip', loja: HIBIKURA }, VIEWER, t)
    expect(notesText(s.transient)).not.toMatch(/Todas as lojas/)
    expect(s.transient).toEqual([])
    // A row inside a visit keeps its period: announced against what was on screen.
    const v = openApp({
      url: '/m?loja=todas&periodo=today&origem=link', navType: 'navigate', fromSwMessage: false, session: null,
      saved: saved(MOKOO, preset('today')), viewer: VIEWER, now: T1600, newId,
    })
    const row = act(v.state, { type: 'row', loja: HIBIKURA }, VIEWER, T1600)
    expect(notesText(liveTransient(row.transient, { state: row, viewer: VIEWER, now: T1600 }))).toBe('Hoje na Hibikura é 25 nov (dia de Tóquio). Em Todas as lojas, Hoje é 24 nov.')
  })

  it('F10 · the store list says what a tap does: pins outside a visit, only shows inside one', () => {
    expect(rowHelp(st(saved('todas')))).toBe('Toque numa loja para fixá-la.')
    const push = openApp({
      url: '/m?loja=todas&periodo=custom&de=2026-11-23&ate=2026-11-23&origem=push&n=zz11yy22', navType: 'navigate', fromSwMessage: false,
      session: null, saved: saved(HIBIKURA, preset('today')), viewer: VIEWER, now: T1600, newId,
    })
    // r3 F14: one day is "nesse dia".
    expect(rowHelp(push.state)).toBe('Toque numa loja para vê-la nesse dia, sem fixá-la.')
    const after = reduce(push.state, { type: 'row', loja: MOKOO }, VIEWER)
    expect(after.saved.loja).toBe(HIBIKURA)
    expect(rowHelp(sqVisit())).toBe('Toque numa loja para fixá-la.')
  })

  it('F11 · legacy volta beside dates equal to what volta resolves to is that preset, as on the desktop', () => {
    const t = brt('2026-11-24', '19:29')
    const q = `?loja=${HIBIKURA}&periodo=custom&de=2026-11-24&ate=2026-11-24&volta=today`
    expect(parsePhoneLink(q, VIEWER, t).link?.period).toEqual(preset('today'))
    expect(parseDesktop({ loja: HIBIKURA, periodo: 'custom', de: '2026-11-24', ate: '2026-11-24', volta: 'today' }, { ...ctx('/'), now: t }).selection?.period)
      .toEqual(preset('today'))
    const opened = openApp({ url: `/m${q}`, navType: 'navigate', fromSwMessage: false, session: null, saved: saved('todas'), viewer: VIEWER, now: t, newId })
    expect(opened.url).toBe(`/m?loja=${HIBIKURA}&periodo=today&origem=link`)
    // On 26 nov the dates match no preset: kept.
    expect(parsePhoneLink(q, VIEWER, brt('2026-11-26', '10:00')).link?.period).toEqual(dates('2026-11-24', '2026-11-24'))
  })

  it('F12 · adopted facts: the chips follow them and the change is named', () => {
    const archivedMokoo = viewerStores(STORES.map(s => (s.id === MOKOO ? { ...s, archived: true, archivedAt: '2026-11-24T20:00:00.000Z' } : s)))
    expect(factsChange(VIEWER, archivedMokoo)).toBe('MOKOO foi arquivada')
    expect(factsChange(VIEWER, VIEWER)).toBeNull()
    const s = reduce(st(saved(MOKOO, preset('today'))), { type: 'facts', change: factsChange(VIEWER, archivedMokoo) }, archivedMokoo)
    expect(s.saved.loja).toBe('todas')
    expect(notesText(s.transient)).toBe('A lista de lojas mudou: MOKOO foi arquivada. MOKOO não está mais disponível. Mostrando Todas.')
    const o = storeOptions(archivedMokoo)
    expect(o.active.map(x => x.id)).not.toContain(MOKOO)
    expect(o.archived.map(x => x.id)).toContain(MOKOO)
  })

  it('F14 · a row tap that leaves the visit with nothing overridden drops it', () => {
    const v = openApp({
      url: '/m?loja=todas&periodo=today', navType: 'navigate', fromSwMessage: false, session: null,
      saved: saved(HIBIKURA, preset('today')), viewer: VIEWER, now: T1600, newId,
    })
    expect(v.state.visit).not.toBeNull()
    const s = reduce(v.state, { type: 'row', loja: HIBIKURA }, VIEWER)
    expect(s.visit).toBeNull()
    expect(stripFor(s, VIEWER, null)).toBeNull()
  })

  it('F16 · the one-action strip survives a reload, not a fresh open', () => {
    const strip = [{ code: 'scope_dates_differ' as const, params: { text: 'Hoje na Hibikura é 25 nov (dia de Tóquio).' } }]
    const base = { url: '/m', fromSwMessage: false, session: null, saved: saved(HIBIKURA, preset('today')), viewer: VIEWER, now: T1600, newId, strip }
    expect(openApp({ ...base, navType: 'reload' }).state.transient).toEqual(strip)
    expect(openApp({ ...base, navType: 'navigate' }).state.transient).toEqual([])
    expect(openApp({ ...base, navType: 'navigate', fromSwMessage: true, url: '/m?loja=todas&periodo=today&origem=push&n=a1' }).state.transient).toEqual([])
  })

  it('F21 · a store link from an archive visit ends the consultation (left_archive)', () => {
    const s = act(sqVisit(), { type: 'row', loja: GLOOTY }, VIEWER, T1600)
    expect(s.visit).toBeNull()
    expect(shownSelection(s)).toEqual(sel(store(GLOOTY), preset('7d')))
    expect(notesText(s.transient)).toBe('O período da consulta da loja arquivada não vale aqui: mostrando Últimos 7 dias.')
    const all = act(sqVisit(), { type: 'row', loja: 'todas' }, VIEWER, T1600)
    expect(all.visit).toBeNull()
    expect(stripFor(all, VIEWER, null)).toBeNull()
  })

  it('F23 · a legacy push link announces its cut; dated input before 2000 is too_early, not undated', () => {
    const long = parsePhoneLink(`?loja=${MOKOO}&periodo=custom&de=2024-01-01&ate=2026-12-30&dia=2026-11-21`, VIEWER)
    expect(long.link?.period).toEqual(dates('2025-12-30', '2026-12-30'))
    expect(long.notes.map(x => x.code)).toContain('too_long')
    const early = parsePhoneLink(`?loja=${MOKOO}&periodo=custom&de=1999-01-01&ate=1999-01-02&dia=1999-01-01`, VIEWER)
    expect(early.link?.undated).toBeUndefined()
    expect(early.notes.map(x => x.code)).toContain('too_early')
    expect(parseLegacyPush({ periodo: null, de: null, ate: null, dia: '1999-01-01', volta: null })).toEqual({ value: null, undated: false, notes: ['too_early'] })
  })
})
