/**
 * period-fix-r3: one regression per finding of the round-3 bug hunt, each
 * named "F<n> · …" after the finding's place in the list. Clock injected
 * (P6): 24 nov 2026, Brasília UTC−3, Tokyo UTC+9.
 */

import { describe, expect, it } from 'vitest'
import {
  announce, archiveOpening, comparisonFullAmong, dates, desktopHref, feedAheadText, feedSplit, firstSaleAfter, landingNotes,
  layer, notesText, parseDesktop, preset, previousFor, relayLink, resolve, rowsAnnouncement, screenComparison, vemFor,
  type ScopeRef, type Selection,
} from '..'
import { act, liveTransient, openApp, parsePhoneLink, reduce, stripFor, type PhoneState, type SavedView } from '../phone'
import { withPageState } from '../../../components/ai/links'
import { ALL, brt, GLOOTY, HIBIKURA, MOKOO, SQUISHY, store, VIEWER } from './fixtures'

const sel = (scope: ScopeRef, period: Selection['period']): Selection => ({ scope, period, split: false })
const ARCH = { archivedIds: [SQUISHY] }
const archived = (id: string) => id === SQUISHY
const saved = (loja: string, period = preset('7d')): SavedView => ({ v: 3, loja, period, aba: null })
let n = 0
const newId = () => `r3_${++n}`

/** What a desktop URL lands on: canonical, redirect and the notes line. */
function land(url: string, now: Date) {
  const [pathname, q] = url.split('?')
  const sp = Object.fromEntries(new URLSearchParams(q ?? ''))
  const p = parseDesktop(sp, { pathname, viewer: VIEWER, remembered: MOKOO, now })
  const base = resolve(p.selection!, VIEWER, now)
  const notes = landingNotes(p.notes, p.cameFrom, base, VIEWER, now)
  const r = resolve(p.selection!, VIEWER, now, { notes })
  return { p, r, text: notesText(r.notes) }
}

const T2103 = brt('2026-11-24', '21:03')
const OPEN = archiveOpening(VIEWER.archived[0])!

describe('links that set their own period carry no vem (R3, R4)', () => {
  it('F1/F15 · "Abrir histórico" from Todas · Hoje lands with only the archive label, never a sentence about Todas', () => {
    const todasHoje = sel(ALL, preset('today'))
    const target = sel(store(SQUISHY), OPEN)
    expect(vemFor(todasHoje, target, archived)).toBeNull()
    const href = desktopHref('/', target, {}, { vem: vemFor(todasHoje, target, archived) })
    expect(href).toBe(`/?loja=${SQUISHY}&periodo=custom&de=2026-10-12&ate=2026-11-10`)
    const { r, text } = land(href, T2103)
    expect(r.label.full).toBe('Últimos 30 dias até o arquivamento · 12 out – 10 nov')
    expect(text).not.toMatch(/Todas as lojas/)
    expect(r.notes.map(x => x.code)).toEqual(['archived_clamp'])
  })

  it('F1 · an old landed URL with vem=todas on the archive dates is still announced honestly: its cut says "hora do arquivamento"', () => {
    // The same period carried to an archived store (an AI link without dates of its own):
    // the cut of the archived side is the archive minute and says so (§8.2).
    const a = announce(sel(store(MOKOO), OPEN), store(MOKOO), store(SQUISHY), VIEWER, T2103)!
    expect(a.landing).toMatch(/até 10h00, hora do arquivamento/)
    expect(a.landing).not.toMatch(/até 10h00\./)
  })

  it('F1 · AI answer links that name their own period and another scope carry no vem', () => {
    const href = withPageState(`/?loja=${SQUISHY}&periodo=custom&de=2026-10-12&ate=2026-11-10`, 'loja=todas&periodo=today', null, [SQUISHY])
    expect(href).not.toMatch(/vem=/)
    // Same period, another scope: R4, announced.
    expect(withPageState(`/?loja=${HIBIKURA}`, 'loja=todas&periodo=today', null, [SQUISHY])).toMatch(/vem=todas/)
  })
})

describe('left_archive only when the consultation period was dropped (P5, R4)', () => {
  const onArch = `/?loja=${SQUISHY}&periodo=custom&de=2026-10-12&ate=2026-11-10`

  it('F4/F20 · a period picked over the in-flight URL drops the archived vem; the landing has no left_archive', () => {
    const toMokoo = layer(onArch, { kind: 'store', scope: store(MOKOO) }, ARCH)
    expect(toMokoo).toBe(`/?loja=${MOKOO}&vem=${SQUISHY}`)
    const pick30 = layer(toMokoo, { kind: 'period', period: preset('30d') }, { ...ARCH, inFlight: true })
    expect(pick30).toBe(`/?loja=${MOKOO}&periodo=30d`)
    expect(land(pick30, T2103).text).not.toMatch(/arquivada/)
    // The sidebar "Todas as lojas" + 30 dias in flight (case 1 of F4).
    const toAll = layer(onArch, { kind: 'page', path: '/overview', scope: ALL }, ARCH)
    expect(layer(toAll, { kind: 'period', period: preset('30d') }, { ...ARCH, inFlight: true })).toBe('/overview?loja=todas&periodo=30d')
  })

  it('F4 · a consultation already on the default 7 dias drops nothing: no vem, no note', () => {
    const on7 = `/?loja=${SQUISHY}`
    expect(layer(on7, { kind: 'page', path: '/overview', scope: ALL }, ARCH)).toBe('/overview?loja=todas')
    expect(layer(on7, { kind: 'store', scope: store(MOKOO) }, ARCH)).toBe(`/?loja=${MOKOO}`)
    // A row/sidebar link relayed from the archived page.
    const link = relayLink(`/overview?loja=todas&vem=${SQUISHY}`, on7, ARCH)!
    expect(layer(on7, link, ARCH)).toBe('/overview?loja=todas')
  })

  it('F4 · a forwarded /?loja=MOKOO&periodo=30d&vem=<squishy> is redirected without vem (the claim does not hold)', () => {
    const { p, text } = land(`/?loja=${MOKOO}&periodo=30d&vem=${SQUISHY}`, T2103)
    expect(p.cameFrom).toBeNull()
    expect(p.redirect).toBe(true)
    expect(p.canonical).toBe(`/?loja=${MOKOO}&periodo=30d`)
    expect(text).toBe('')
  })

  it('F4 · the phone: leaving an archive visit already on the saved period announces nothing', () => {
    const o = openApp({
      url: `/m?loja=${SQUISHY}&periodo=today&origem=arquivo`, navType: 'navigate', fromSwMessage: false, session: null,
      saved: saved('todas', preset('today')), viewer: VIEWER, now: T2103, newId,
    })
    const s = act(o.state, { type: 'chip', loja: MOKOO }, VIEWER, T2103)
    expect(s.transient).toEqual([])
  })
})

describe('the canonical URL (R15)', () => {
  it('F5 · dates before 2000 AND longer than 366 days: one redirect to a URL that parses back to itself', () => {
    const now = brt('2026-11-24', '16:00')
    const first = land(`/?loja=${MOKOO}&periodo=custom&de=1999-06-01&ate=2001-01-01`, now)
    expect(first.p.redirect).toBe(true)
    expect(first.p.canonical).toBe(`/?loja=${MOKOO}&periodo=custom&de=2000-01-02&ate=2001-01-01&ajuste=too_long`)
    const second = land(first.p.canonical, now)
    expect(second.p.redirect).toBe(false)
    expect(second.p.canonical).toBe(first.p.canonical)
    expect(second.text).toMatch(/Mostrando os últimos 366 dias/)
  })
})

describe('the comparison names only members of the sum (R6)', () => {
  it('F6 · Todas · 30 dias: Glooty (out of the sum for no costs) is not named as left out for its start', () => {
    const r = resolve(sel(ALL, preset('30d')), VIEWER, brt('2026-11-24', '16:00'))
    const c = screenComparison(r)
    expect(c.full).toMatch(/sem Glooty .* e Hibikura/)
    const judged = VIEWER.active.map(s => s.id).filter(id => id !== GLOOTY)
    const words = comparisonFullAmong(c, judged)!
    expect(words).toMatch(/sem Hibikura \(começou em 7 nov\)$/)
    expect(words).not.toMatch(/Glooty/)
    // Older answers without the structured fields keep their full label.
    expect(comparisonFullAmong({ full: 'vs x' }, judged)).toBe('vs x')
  })
})

describe('combined landing notes say each day once (§4)', () => {
  it('F8 · Hibikura custom 20–25 nov → MOKOO: the fit and the scope change are one sentence', () => {
    const now = brt('2026-11-24', '21:06')
    const { text } = land(`/countries?loja=${MOKOO}&periodo=custom&de=2026-11-20&ate=2026-11-25&vem=${HIBIKURA}`, now)
    expect(text).toBe('O período na MOKOO é 20–24 nov, até hoje (o resto ainda não aconteceu). Na Hibikura era 20–25 nov.')
    expect(text.match(/24 nov/g)).toHaveLength(1)
  })

  it('F8 · Todas on 25 nov from Hibikura: "25 nov ainda não começou … Na Hibikura era 25 nov." — 24 nov once', () => {
    const now = brt('2026-11-24', '21:06')
    const { text } = land(`/overview?loja=todas&periodo=custom&de=2026-11-25&ate=2026-11-25&vem=${HIBIKURA}`, now)
    expect(text).toBe('25 nov ainda não começou em Brasília: mostrando Hoje (24 nov). Na Hibikura era 25 nov.')
  })
})

describe('the live feed on Todas (R2)', () => {
  it('F9 · Todas · Hoje at 21h07: Hibikura orders of Tokyo\'s 25 nov go on one dim line, not among today\'s sales', () => {
    const now = brt('2026-11-24', '21:07')
    const r = resolve(sel(ALL, preset('today')), VIEWER, now)
    const tz = (id: string) => VIEWER.active.find(s => s.id === id)?.tz ?? null
    const items = [
      { storeId: HIBIKURA, orderId: '1233', placedAt: '2026-11-25T00:03:00Z', receivedAt: '2026-11-25T00:03:05Z' },
      { storeId: HIBIKURA, orderId: '1231', placedAt: '2026-11-24T21:33:00Z', receivedAt: '2026-11-24T21:33:05Z' },
      { storeId: HIBIKURA, orderId: '1200', placedAt: '2026-11-24T10:00:00Z', receivedAt: '2026-11-24T10:00:05Z' },
      { storeId: MOKOO, orderId: 'm1', placedAt: '2026-11-24T23:50:00Z', receivedAt: '2026-11-24T23:50:05Z' },
    ]
    const s = feedSplit(items, r, tz)
    expect(s.inRead.map(o => o.orderId)).toEqual(['1200', 'm1'])
    expect(s.ahead).toEqual([{ storeId: HIBIKURA, day: '2026-11-25', count: 2 }])
    expect(feedAheadText(s.ahead[0], 'Hibikura', 'Asia/Tokyo', r)).toBe('Hibikura · 2 vendas já em 25 nov (dia de Tóquio, fora deste Hoje)')
    // A closed window's feed is the plain list of recent sales; a store page too.
    expect(feedSplit(items, resolve(sel(ALL, preset('7d')), VIEWER, now), tz).ahead).toEqual([])
    expect(feedSplit(items, resolve(sel(store(HIBIKURA), preset('today')), VIEWER, now), tz).ahead).toEqual([])
  })
})

describe('the phone strip follows the clock (R4, R8)', () => {
  it('F10 · the row strip is kept as its inputs and announced again at each instant', () => {
    const t = brt('2026-11-24', '21:10')
    const st: PhoneState = { saved: saved('todas', preset('today')), visit: null, closedStrip: false, transient: [] }
    const row = act(st, { type: 'row', loja: HIBIKURA }, VIEWER, t)
    expect(row.transient).toEqual([{ code: 'scope_dates_differ', params: { from: 'todas' } }])
    expect(notesText(liveTransient(row.transient, { state: row, viewer: VIEWER, now: t })))
      .toBe('Hoje na Hibikura é 25 nov (dia de Tóquio). Em Todas as lojas, Hoje é 24 nov.')
    // Brasília's midnight: both are 25 nov, nothing to say.
    expect(liveTransient(row.transient, { state: row, viewer: VIEWER, now: brt('2026-11-25', '00:05') })).toEqual([])
    // Reloaded at 12:05 the next day (Tokyo on 26 nov): that day's dates, never "24 nov".
    const next = notesText(liveTransient(row.transient, { state: row, viewer: VIEWER, now: brt('2026-11-25', '12:05') }))
    expect(next).toBe('Hoje na Hibikura é 26 nov (dia de Tóquio). Em Todas as lojas, Hoje é 25 nov.')
  })
})

describe('equal sides are not announced (R4)', () => {
  it('F11 · Todas single day 24 nov at 21h12 → Hibikura (Tokyo\'s closed 24 nov vs 23 nov): no line, no strip', () => {
    const t = brt('2026-11-24', '21:12')
    const s = sel(ALL, dates('2026-11-24', '2026-11-24'))
    expect(announce(s, ALL, store(HIBIKURA), VIEWER, t)).toBeNull()
    expect(rowsAnnouncement(s, VIEWER.active.map(x => x.id), VIEWER, t)).toBeNull()
    // Still announced where it differs: Todas · Hoje at the same instant.
    expect(announce(sel(ALL, preset('today')), ALL, store(HIBIKURA), VIEWER, t)).not.toBeNull()
  })
})

describe('archive visits follow the facts (R10, R15)', () => {
  it('F12/F22 · origem=arquivo on an active store opens a link visit, with no archived wording', () => {
    const { link } = parsePhoneLink(`?loja=${MOKOO}&periodo=7d&origem=arquivo`, VIEWER)
    expect(link?.source).toBe('link')
    const o = openApp({
      url: `/m?loja=${MOKOO}&periodo=7d&origem=arquivo`, navType: 'navigate', fromSwMessage: false, session: null,
      saved: saved('todas', preset('today')), viewer: VIEWER, now: T2103, newId,
    })
    expect(stripFor(o.state, VIEWER, null)?.text ?? '').not.toMatch(/arquivada/)
    // An archived store still opens as consultation.
    expect(parsePhoneLink(`?loja=${SQUISHY}&origem=arquivo`, VIEWER).link?.source).toBe('archive')
  })

  it('F12/F22 · a facts update that unarchives the visit store turns it back into a link (or push) visit', () => {
    const o = openApp({
      url: `/m?loja=${SQUISHY}&periodo=custom&de=2026-10-12&ate=2026-11-10&origem=arquivo`, navType: 'navigate', fromSwMessage: false,
      session: null, saved: saved('todas', preset('today')), viewer: VIEWER, now: T2103, newId,
    })
    expect(o.state.visit?.source).toBe('archive')
    const sq = VIEWER.archived.find(s => s.id === SQUISHY)!
    const live = { ...VIEWER, active: [...VIEWER.active, { ...sq, archivedAt: null, archivedOn: null }], archived: [], version: 'unarchived' }
    const next = reduce(o.state, { type: 'facts', change: 'Squishy World voltou a ficar ativa' }, live)
    expect(next.visit?.source).toBe('link')
    expect(next.visit?.url).toMatch(/origem=link/)
    expect(stripFor(next, live, null)?.text ?? '').not.toMatch(/arquivada/)
  })
})

describe('the strip names a preset with its dates (R7, R16)', () => {
  it('F14 · "Link aberto em Últimos 30 dias · 25 out – 23 nov." / "Hoje · 25 nov (dia de Tóquio)"', () => {
    const t = brt('2026-11-24', '16:00')
    const o = openApp({ url: '/m?periodo=30d', navType: 'navigate', fromSwMessage: false, session: null, saved: saved(MOKOO), viewer: VIEWER, now: t, newId })
    const r = resolve(sel(store(MOKOO), preset('30d')), VIEWER, t)
    expect(stripFor(o.state, VIEWER, r)?.text).toMatch(/^Link aberto em Últimos 30 dias · 25 out – 23 nov\./)
    const h = openApp({ url: `/m?loja=${HIBIKURA}&periodo=today`, navType: 'navigate', fromSwMessage: false, session: null, saved: saved(MOKOO), viewer: VIEWER, now: t, newId })
    const rh = resolve(sel(store(HIBIKURA), preset('today')), VIEWER, t)
    expect(stripFor(h.state, VIEWER, rh)?.text).toMatch(/^Link aberto em Hoje · 25 nov \(dia de Tóquio\)\./)
  })
})

describe('first dates read one way (R11)', () => {
  it('F16 · a null first order is after every window; MIN_DATE (unknown) before every window', () => {
    expect(firstSaleAfter('2026-11-23', null)).toBe(true)
    expect(firstSaleAfter('2026-11-23', '2000-01-01')).toBe(false)
    expect(firstSaleAfter('2026-11-23', '2026-12-06')).toBe(true)
  })
})

describe('AI comparisons take R6\'s base rule (R6)', () => {
  it('F18 · Hibikura · Este mês on 24 nov is "sem base"; 14 dias is a partial base; unknown facts keep a full base', () => {
    const now = brt('2026-11-24', '16:00')
    const mtd = previousFor('mtd', { from: '2026-11-01', to: '2026-11-25' }, 'Asia/Tokyo', now, '2026-11-07')
    expect(mtd.base).toBe('none')
    expect(mtd.baseNote).toBe('sem base: a loja começou em 7 nov')
    const d14 = previousFor('14d', { from: '2026-11-11', to: '2026-11-24' }, 'Asia/Tokyo', now, '2026-11-07')
    expect(d14).toMatchObject({ from: '2026-10-28', to: '2026-11-10', base: 'partial', baseNote: 'base incompleta: a loja começou em 7 nov' })
    expect(previousFor('mtd', { from: '2026-11-01', to: '2026-11-25' }, 'Asia/Tokyo', now).base).toBe('full')
    // The same words as the page's resolution.
    const page = resolve(sel(store(HIBIKURA), preset('mtd')), VIEWER, now)
    expect(page.deltaNote?.text).toBe(mtd.baseNote)
  })
})

describe('a push always shows its strip (R16, C2-L2)', () => {
  it('F21 · a push whose day equals a saved dates period still says what it opened, with its button', () => {
    const t = brt('2026-11-24', '16:00')
    const s = saved(MOKOO, dates('2026-11-20', '2026-11-20'))
    const o = openApp({
      url: `/m?loja=${MOKOO}&periodo=custom&de=2026-11-20&ate=2026-11-20&origem=push&n=abc12345`, navType: 'navigate', fromSwMessage: false,
      session: null, saved: s, viewer: VIEWER, now: t, newId,
    })
    expect(o.state.visit?.source).toBe('push')
    const r = resolve(sel(store(MOKOO), dates('2026-11-20', '2026-11-20')), VIEWER, t)
    const strip = stripFor(o.state, VIEWER, r)
    expect(strip?.text).toMatch(/^Notificação sobre 20 nov: mostrando esse dia\. Os botões de loja no alto voltam para MOKOO · 20 nov\.$/)
    expect(strip?.button).toBe('Voltar para MOKOO · 20 nov')
  })
})
