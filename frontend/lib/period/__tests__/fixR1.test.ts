/**
 * period-fix-r1: one regression per finding of the round-1 bug hunt (desktop,
 * phone and code reviews), each named "F<n> · …" after the finding's place in
 * the list. Clock injected (P6): 24 nov 2026, Brasília UTC−3, Tokyo UTC+9.
 */

import { describe, expect, it } from 'vitest'
import {
  announce, archiveOpening, dates, dayPhrase, desktopHref, landingNotes, layer, notesText, parseDesktop, parseLegacyPush,
  periodQuery, preset, pricedWindow, resolve, rowsAnnouncement, screenComparison, type ScopeRef, type Selection,
} from '..'
import {
  fillOpenNotes, openApp, parsePhoneLink, readSaved, reduce, stripFor, stripNotes, type PhoneState, type SavedView,
} from '../phone'
import { adoptFreshServerNow, clockOffset, resetClientClock } from '../client/clock'
import { salePushText } from '../../sync/salePush'
import { ALL, brt, CAMP, HIBIKURA, MOKOO, PARTNER_ONE, SQUISHY, store, VIEWER } from './fixtures'

const sel = (scope: ScopeRef, period: Selection['period']): Selection => ({ scope, period, split: false })
const T1600 = brt('2026-11-24', '16:00')
const T1419 = brt('2026-11-24', '14:19')
const T1805 = brt('2026-11-24', '18:05')
const ctx = (pathname: string, viewer = VIEWER, remembered: string | null = MOKOO) => ({ pathname, viewer, remembered, now: T1600 })
const saved = (loja: string, period = preset('7d')): SavedView => ({ v: 3, loja, period, aba: null })
let n = 0
const newId = () => `v${++n}`

describe('comparison words: one naming path (R6, R7)', () => {
  it('F2/F15 · no comparison is "sem base: a loja começou em 7 nov", never "vs dia anterior"', () => {
    const r = resolve(sel(store(HIBIKURA), preset('mtd')), VIEWER, T1600)
    expect(r.comparison).toBeNull()
    expect(r.deltaNote).toEqual({ reason: 'no_base', text: 'sem base: a loja começou em 7 nov' })
    const c = screenComparison(r)
    expect(c.none).toBe('sem base: a loja começou em 7 nov')
    expect(c.label).toBe('')
    expect(`${c.full}${c.short}${c.label}`).not.toMatch(/dia anterior/)
    // Mês passado of a store that started after it: the same.
    expect(screenComparison(resolve(sel(store(HIBIKURA), preset('lastmonth')), VIEWER, T1600)).none).toBe('sem base: a loja começou em 7 nov')
    // Todas before every store: no invented D−1 either.
    const old = resolve(sel(ALL, dates('2024-12-25', '2025-01-03')), VIEWER, T1600)
    expect(screenComparison(old).none).toMatch(/^sem base: a primeira loja começou em /)
  })

  it('F2/F15 · a frozen archived window has no comparison and no words', () => {
    const r = resolve(sel(store(SQUISHY), preset('7d')), VIEWER, T1600)
    expect(r.members[0].state).toBe('frozen')
    expect(screenComparison(r).none).toBe('')
  })

  it('F3 · a partial base says "base incompleta" (one store)', () => {
    const r = resolve(sel(store(HIBIKURA), preset('14d')), VIEWER, T1600)
    expect(r.members[0].compare?.base).toBe('partial')
    expect(screenComparison(r).partialBase).toBe('base incompleta: a loja começou em 7 nov')
  })

  it('F4/F22 · labels carry the cut, each day said once', () => {
    // Hibikura custom 10–25 nov at 16:00 BRT (Tokyo 25 nov 04:00): cut base.
    const h = screenComparison(resolve(sel(store(HIBIKURA), dates('2026-11-10', '2026-11-25')), VIEWER, T1600))
    expect(h.short).toBe('vs 25 out – 9 nov (até 04h00)')
    expect(h.full).toBe('vs 16 dias anteriores (25 out – 9 nov, até 04h00)')
    expect(h.rangeText).toBe('25 out – 9 nov (até 04h00)')
    // Todas · Este mês: "até esta hora", never "até 18h14 de 24 out".
    const t = screenComparison(resolve(sel(ALL, preset('mtd')), VIEWER, T1805))
    expect(t.rangeText).toBe('1–24 out (até esta hora)')
    for (const s of [h.full, h.short, h.rangeText, t.full, t.short, t.rangeText]) expect(s).not.toMatch(/ de \d+ (out|nov)\)/)
  })

  it('F5/F18 · an archived store is compared until its archive minute, said so, never "até esta hora"', () => {
    const r = resolve(sel(store(SQUISHY), preset('30d')), VIEWER, T1419)
    const c = screenComparison(r)
    expect(c.phrase).toBe('nos 17 dias anteriores, até 10h00 (hora do arquivamento)')
    expect(c.short).toBe('vs 8–24 out (até 10h00, hora do arquivamento)')
    expect(c.phrase).not.toMatch(/esta hora/)
    // Identical at 23:59 (R10 ex. 1).
    expect(screenComparison(resolve(sel(store(SQUISHY), preset('30d')), VIEWER, brt('2026-11-24', '23:59'))).phrase).toBe(c.phrase)
  })
})

describe('archived stores (R10)', () => {
  it('F6/F18 · the "arquivadas" opening is the 30 days to archivedOn, named as such', () => {
    const sq = VIEWER.archived.find(s => s.id === SQUISHY)!
    const open = archiveOpening(sq)!
    expect(open).toEqual({ kind: 'dates', from: '2026-10-12', to: '2026-11-10' })
    const r = resolve(sel(store(SQUISHY), open), VIEWER, T1600)
    expect(r.label.full).toBe('Últimos 30 dias até o arquivamento · 12 out – 10 nov')
    expect(r.label.short).toBe('últimos 30 dias até o arquivamento (12 out – 10 nov)')
    // Any other dates keep their plain name.
    expect(resolve(sel(store(SQUISHY), dates('2026-10-13', '2026-11-10')), VIEWER, T1600).label.full).toBe('13 out – 10 nov')
  })

  it('F35 · a clamped member is priced on the days it read, not the whole window', () => {
    const r = resolve(sel(store(SQUISHY), preset('mtd')), VIEWER, T1600)
    expect(pricedWindow(r, SQUISHY)).toEqual({ from: '2026-11-01', to: '2026-11-10' })
    const t = resolve(sel(ALL, preset('mtd')), VIEWER, T1600)
    expect(pricedWindow(t, MOKOO)).toEqual(t.window)
  })
})

describe('announcements (R4, §4)', () => {
  it('F8/F24/F42 · "Na <loja>", "o período" in lower case mid-sentence', () => {
    const fromH = announce(sel(store(HIBIKURA), dates('2026-11-20', '2026-11-25')), store(HIBIKURA), store(MOKOO), VIEWER, T1600)!
    // r3 F8: MOKOO's 24 nov is today, so the fit is said in the same sentence, once.
    expect(fromH.landing).toBe('O período na MOKOO é 20–24 nov, até hoje (o resto ainda não aconteceu). Na Hibikura era 20–25 nov.')
    const fromAll = announce(sel(ALL, dates('2026-11-20', '2026-11-25')), ALL, store(HIBIKURA), VIEWER, T1600)!
    expect(fromAll.landing).toBe('O período na Hibikura é 20–25 nov (dia de Tóquio), vs 14–19 nov até 04h00. Em Todas as lojas, o período é 20–24 nov, vs 15–19 nov (dias inteiros).')
    const hoje = announce(sel(store(MOKOO), preset('today')), store(MOKOO), store(HIBIKURA), VIEWER, T1600)!
    expect(hoje.landing).toBe('Hoje na Hibikura é 25 nov (dia de Tóquio). Na MOKOO era 24 nov.')
    for (const a of [fromH, fromAll, hoje]) {
      expect(a.landing).not.toMatch(/, O período/)
      expect(a.landing).not.toMatch(/Em (MOKOO|Hibikura)/)
    }
  })

  it('F10 · a table of store rows announces with one function (Overview and Campanhas · Todas)', () => {
    const ids = VIEWER.active.map(s => s.id)
    expect(rowsAnnouncement(sel(ALL, preset('today')), ids, VIEWER, T1600)).toBe('(Hibikura abre o Hoje de Tóquio (25 nov))')
    // 11:00 BRT: Tokyo is on 24 nov too, nothing to say.
    expect(rowsAnnouncement(sel(ALL, preset('today')), ids, VIEWER, brt('2026-11-24', '11:00'))).toBeNull()
  })
})

describe('desktop URL (R14, R15)', () => {
  it('F11 · an unknown aba and undeclared keys are dropped by the canonical redirect', () => {
    const p = parseDesktop({ loja: MOKOO, aba: 'xx', foo: 'bar', modelo: 'ultimo' }, ctx('/campaigns'))
    expect(p.canonical).toBe('/campaigns?loja=mokoo')
    expect(p.redirect).toBe(true)
    const a = parseDesktop({ loja: 'todas', periodo: '7d', volta: 'today', aba: 'xx' }, ctx('/attribution'))
    expect(a.canonical).not.toMatch(/aba=/)
    // A page's own OAuth flags survive its canonical URL, never a link.
    const s = parseDesktop({ loja: MOKOO, fb_connected: 'true', foo: '1' }, ctx('/settings'))
    expect(s.canonical).toBe('/settings?loja=mokoo&fb_connected=true')
    expect(layer('/settings?loja=mokoo&fb_connected=true', { kind: 'period', period: preset('30d') }, { archivedIds: [] }))
      .toBe('/settings?loja=mokoo&periodo=30d')
  })

  it('F37 · Todas for a one-store partner is noted on every page; a bad periodo is noted beside volta', () => {
    const home = parseDesktop({ loja: 'todas' }, ctx('/', PARTNER_ONE, CAMP))
    expect(home.notes.map(x => x.code)).toContain('single_store')
    const camp = parseDesktop({ loja: 'todas' }, ctx('/campaigns', PARTNER_ONE, CAMP))
    expect(camp.canonical).toBe('/?loja=camp&ajuste=single_store')
    const bad = parseDesktop({ loja: MOKOO, periodo: 'semana', volta: 'today' }, ctx('/'))
    expect(bad.selection!.period).toEqual(preset('today'))
    expect(bad.notes.map(x => x.code)).toContain('bad_param')
    const inc = parseDesktop({ loja: MOKOO, periodo: 'custom', de: '2026-11-01', volta: 'yesterday' }, ctx('/'))
    expect(inc.notes.map(x => x.code)).toContain('incomplete')
  })

  it('F37 · remembered_gone names the store the cookie held', () => {
    const p = parseDesktop({}, ctx('/', VIEWER, SQUISHY))
    // The redirect goes through /api/active-store/forget, which clears the
    // cookie: the landed request has no remembered store (period-fix-r2:
    // with a valid cookie the token no longer holds and is dropped).
    const landed = parseDesktop(Object.fromEntries(new URLSearchParams(p.canonical.split('?')[1])), ctx('/', VIEWER, null))
    const r = resolve(landed.selection!, VIEWER, T1600)
    expect(notesText(landingNotes(landed.notes, landed.cameFrom, r, VIEWER, T1600)))
      .toBe('A loja lembrada (Squishy World) não está mais disponível: mostrando CAMP HALLOW.')
  })

  it('F38 · the period of a URL is copied only through the URL parser (normalised)', () => {
    expect(periodQuery(new URLSearchParams('periodo=custom&de=2024-01-01&ate=2026-12-30&parte=50&foo=1')).toString())
      .toBe('periodo=custom&de=2025-12-30&ate=2026-12-30&parte=50')
    expect(periodQuery(new URLSearchParams('periodo=semana')).toString()).toBe('')
  })
})

describe('phone (R16, R17)', () => {
  const T = brt('2026-11-24', '18:05')
  const base = { navType: 'navigate' as const, fromSwMessage: false, session: null, viewer: VIEWER, now: T, newId }

  it('F16/F29 · open notes are filled with the saved view: "Mostrando MOKOO.", "mostrando Hoje."', () => {
    const a = openApp({ ...base, url: '/m?loja=bogus&periodo=custom&de=2026-11-25&ate=2026-11-25&origem=push', saved: saved(MOKOO) })
    expect(notesText(a.state.transient)).toBe('A loja do link não está disponível. Mostrando MOKOO.')
    const b = openApp({ ...base, url: '/m?loja=mokoo&periodo=semana', saved: saved('todas', preset('today')) })
    expect(notesText(b.state.transient)).toBe('O período do link não existe: mostrando Hoje.')
    const c = openApp({ ...base, url: '/m?loja=mokoo&periodo=custom&de=2026-11-01', saved: saved(MOKOO) })
    expect(notesText(c.state.transient)).toBe('O período do link não tinha as duas datas: mostrando Últimos 7 dias.')
    expect(notesText(fillOpenNotes([{ code: 'unknown_store' }], saved('todas'), VIEWER))).toBe('A loja do link não está disponível. Mostrando Todas as lojas.')
  })

  it('F17/F30 · a link cut to 366 days says so, in the desktop\'s combined sentence', () => {
    const o = openApp({ ...base, url: '/m?loja=mokoo&periodo=custom&de=2024-01-01&ate=2026-12-30', saved: saved('todas', preset('today')) })
    expect(o.state.transient.map(x => x.code)).toContain('too_long')
    expect(o.state.visit?.period).toEqual(dates('2025-12-30', '2026-12-30'))
    // The server's answer for the normalised dates carries future_end; the
    // phone folds the link's too_long into the same sentence.
    const r = resolve(sel(store(MOKOO), o.state.visit!.period!), VIEWER, T1600)
    const texts = stripNotes(o.state.transient, r)
    expect(texts.answer).toMatch(/^Período ajustado: as datas iam até 30 dez 2026, que ainda não aconteceu, e passavam de 366 dias. Mostrando 30 dez 2025 – 24 nov 2026./)
    expect(texts.transient).toBeNull()
  })

  it('F20 · a push visit whose period was replaced re-parses as a push visit, not an old undated one', () => {
    const push = openApp({ ...base, url: '/m?loja=todas&periodo=custom&de=2026-11-24&ate=2026-11-24&origem=push&n=k3x9q2aa&m=2s90c3', saved: saved('todas') })
    let st = reduce(push.state, { type: 'row', loja: HIBIKURA }, VIEWER, newId)
    st = reduce(st, { type: 'period', period: preset('today') }, VIEWER, newId)
    expect(st.visit?.url).toBe('/m?loja=hibikura&origem=push&n=k3x9q2aa')
    const fresh = openApp({ ...base, url: st.visit!.url, saved: st.saved })
    expect(fresh.state.visit?.undated).toBeUndefined()
    const strip = stripFor(fresh.state, VIEWER, null)!
    expect(strip.text).toMatch(/^Mostrando Hibikura, aberta pela notificação\./)
    expect(strip.text).not.toMatch(/Notificação antiga/)
    // A real legacy push (no nonce) still is one.
    expect(parsePhoneLink('loja=mokoo&aba=campanhas&origem=push', VIEWER).link?.undated).toBe(true)
  })

  it('F23 · any owner action clears the one-action strip, a tab pick included', () => {
    const st: PhoneState = { saved: saved(HIBIKURA), visit: null, closedStrip: false, transient: [{ code: 'scope_dates_differ', params: { text: 'x' } }] }
    expect(reduce(st, { type: 'tab', aba: 'paises' }, VIEWER).transient).toEqual([])
    expect(reduce(st, { type: 'close_transient' }, VIEWER).transient).toEqual([])
    // A chip or row sets its own announcement.
    expect(reduce(st, { type: 'chip', loja: MOKOO, notes: [{ code: 'scope_dates_differ', params: { text: 'y' } }] }, VIEWER).transient[0].params?.text).toBe('y')
  })

  it('F25 · migrating v2 with an archived store falls back to Todas with saved_store_gone', () => {
    const v2 = JSON.stringify({ loja: SQUISHY, periodo: '7d', de: null, ate: null, aba: null })
    const r = readSaved(null, v2, VIEWER)
    expect(r.saved.loja).toBe('todas')
    // r3 F13: the archived store's 7 dias do not follow to Todas either.
    expect(notesText(r.notes)).toBe('Squishy World não está mais disponível. Mostrando Todas. O período da consulta da loja arquivada não vale aqui: mostrando Hoje.')
  })

  it('F31 · facts updates leave their note in the strip the screen renders (PhoneState.transient)', () => {
    const viewerWithoutMokoo = { ...VIEWER, active: VIEWER.active.filter(s => s.id !== MOKOO), archived: [...VIEWER.archived, { ...VIEWER.active.find(s => s.id === MOKOO)!, archivedAt: '2026-11-24T19:00:00.000Z', archivedOn: '2026-11-24' }], version: 'v2' }
    const st: PhoneState = { saved: saved(MOKOO, preset('today')), visit: null, closedStrip: false, transient: [] }
    const next = reduce(st, { type: 'facts' }, viewerWithoutMokoo)
    expect(next.saved.loja).toBe('todas')
    expect(stripNotes(next.transient, null).transient).toBe('MOKOO não está mais disponível. Mostrando Todas.')
  })

  it('F36 · a legacy push with a long custom range is carried normalised (request, echo and visit agree)', () => {
    expect(parseLegacyPush({ periodo: 'custom', de: '2024-01-01', ate: '2026-11-20', dia: '2026-11-20', volta: null }).value)
      .toEqual(dates('2025-11-20', '2026-11-20'))
    const l = parsePhoneLink('loja=mokoo&periodo=custom&de=2024-01-01&ate=2026-11-20&dia=2026-11-20', VIEWER).link!
    expect(l.period).toEqual(dates('2025-11-20', '2026-11-20'))
  })
})

describe('push text and the day it opens (R17)', () => {
  it('F19/F33 · the sale push names the sale\'s day as the screen does', () => {
    // A MOKOO order at 23:59:50 BRT 24 nov, webhook at 00:00:10 25 nov.
    expect(dayPhrase('2026-11-24', '2026-11-25')).toBe('ontem')
    expect(dayPhrase('2026-11-24', '2026-11-24')).toBe('hoje')
    expect(dayPhrase('2026-11-20', '2026-11-24')).toBe('em 20 nov')
    const text = salePushText({ storeName: 'MOKOO', orderLabel: '#1', total: 50, currency: 'USD', usdTotal: null, profitToday: 812, profitDay: dayPhrase('2026-11-24', '2026-11-25'), lineItems: [], country: 'US' })
    expect(text.body).toBe('Lucro ontem: $812 · US')
  })
})

describe('desktop clock (R19)', () => {
  it('F40 · a render seen before (back/forward) is not a fresh offset sample', () => {
    resetClientClock()
    const now = Date.parse('2026-11-24T19:00:00Z')
    adoptFreshServerNow('2026-11-24T19:00:00.000Z', now, now)
    expect(clockOffset()).toBe(0)
    // 20 minutes later the owner goes back to that page: same serverNow.
    for (let i = 0; i < 4; i++) adoptFreshServerNow('2026-11-24T19:00:00.000Z', now + 20 * 60_000, now + 20 * 60_000)
    expect(clockOffset()).toBe(0)
    resetClientClock()
  })
})

describe('AI links (R3, R4)', () => {
  it('F32 · an answer link to another store is an R4 link (vem); leaving an archived store drops its dates', async () => {
    const { withPageState } = await import('../../../components/ai/links')
    expect(withPageState('/campaigns', '?loja=todas&periodo=today', HIBIKURA)).toBe('/campaigns?loja=hibikura&periodo=today&vem=todas')
    expect(withPageState('/campaigns', `?loja=${SQUISHY}&periodo=custom&de=2026-10-12&ate=2026-11-10`, MOKOO, [SQUISHY]))
      .toBe(`/campaigns?loja=mokoo&vem=${SQUISHY}`)
    // Same store: R3, no vem.
    expect(withPageState('/products', '?loja=mokoo&periodo=mtd', MOKOO)).toBe('/products?loja=mokoo&periodo=mtd')
  })
})

describe('desktop links built from a selection only (R3)', () => {
  it('F38 · desktopHref is the one builder the onboarding links use', () => {
    expect(desktopHref('/settings', sel(store(MOKOO), preset('30d')))).toBe('/settings?loja=mokoo&periodo=30d')
  })
})
