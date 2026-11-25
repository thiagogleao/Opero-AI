/**
 * State sequences: multi-step flows replayed with an injected clock at 23:59 /
 * 00:01 Brasília and Tokyo (spec P6), through the same functions the screens
 * call (resolve, carry, layer, parseDesktop, the phone's openApp/reduce), plus
 * the openApp identity matrix (R16) and the turn guard (R8).
 */

import { describe, expect, it } from 'vitest'
import { carry, dates, desktopHref, layer, notificationHref, parseDesktop, preset, resolve, type Selection } from '..'
import { openApp, reduce, shownSelection, shownView, stripFor, toUrl, type NavType, type PhoneState, type SavedView, type SessionRecord } from '../phone'
import { shouldRefresh, initialGuard, MAX_RETRIES } from '../client/turnGuard'
import { brt, GLOOTY, HIBIKURA, MOKOO, EPOCH, store, tokyo, VIEWER } from './fixtures'

let ids = 0
const newId = () => `id${++ids}`
const saved = (loja: string, period = preset('7d'), aba: SavedView['aba'] = null): SavedView => ({ v: 3, loja, period, aba })
const windowOf = (s: Selection, now: Date) => resolve(s, VIEWER, now).window

describe('desktop: Todas · Hoje → Hibikura row → back → next day', () => {
  it('keeps Hoje as a preset at every step and rolls with each clock', () => {
    // 23:59 BRT 24 nov = 11:59 Tokyo 25 nov.
    const t1 = brt('2026-11-24', '23:59')
    const todas: Selection = { scope: { kind: 'all' }, period: preset('today'), split: false }
    expect(windowOf(todas, t1)).toEqual({ from: '2026-11-24', to: '2026-11-24' })
    // The Hibikura row: an R4 link that carries the preset.
    const rowHref = layer('/overview?loja=todas&periodo=today', { kind: 'page', path: '/', scope: store(HIBIKURA) }, { archivedIds: [] })
    expect(rowHref).toBe('/?loja=hibikura&periodo=today&vem=todas')
    const landed = parseDesktop(Object.fromEntries(new URLSearchParams(rowHref.split('?')[1])), { pathname: '/', viewer: VIEWER, remembered: MOKOO, now: t1 })
    expect(landed.redirect).toBe(false)
    expect(windowOf(landed.selection!, t1)).toEqual({ from: '2026-11-25', to: '2026-11-25' })
    // Back to Todas through the sidebar: still Hoje, still 24 nov in Brasília.
    const back = layer(rowHref, { kind: 'page', path: '/overview', scope: { kind: 'all' } }, { archivedIds: [] })
    expect(back).toBe('/overview?loja=todas&periodo=today&vem=hibikura')
    // 00:01 BRT 25 nov: Todas rolls to 25 nov; Hibikura is still on Tokyo's 25 nov.
    const t2 = brt('2026-11-25', '00:01')
    const again = parseDesktop({ loja: 'todas', periodo: 'today' }, { pathname: '/overview', viewer: VIEWER, remembered: MOKOO, now: t2 })
    expect(windowOf(again.selection!, t2)).toEqual({ from: '2026-11-25', to: '2026-11-25' })
    expect(windowOf(landed.selection!, t2)).toEqual({ from: '2026-11-25', to: '2026-11-25' })
    // 00:01 Tokyo 26 nov (12:01 BRT 25 nov): Hibikura alone rolls; Todas does not.
    const t3 = tokyo('2026-11-26', '00:01')
    expect(windowOf(landed.selection!, t3)).toEqual({ from: '2026-11-26', to: '2026-11-26' })
    expect(windowOf(again.selection!, t3)).toEqual({ from: '2026-11-25', to: '2026-11-25' })
  })
})

describe('desktop: picker dates after a Todas link', () => {
  it('dates picked on a page opened from Todas stay those dates through every link', () => {
    const t = brt('2026-11-24', '23:59')
    let url = '/?loja=hibikura&periodo=today&vem=todas'
    url = layer(url, { kind: 'period', period: dates('2026-11-01', '2026-11-10') }, { archivedIds: [] })
    expect(url).toBe('/?loja=hibikura&periodo=custom&de=2026-11-01&ate=2026-11-10')
    url = layer(url, { kind: 'store', scope: store(MOKOO) }, { archivedIds: [] })
    expect(url).toBe('/?loja=mokoo&periodo=custom&de=2026-11-01&ate=2026-11-10&vem=hibikura')
    url = layer(url, { kind: 'page', path: '/products' }, { archivedIds: [] })
    expect(url).toBe('/products?loja=mokoo&periodo=custom&de=2026-11-01&ate=2026-11-10')
    const next = brt('2026-11-26', '00:01')
    const p = parseDesktop(Object.fromEntries(new URLSearchParams(url.split('?')[1])), { pathname: '/products', viewer: VIEWER, remembered: MOKOO, now: next })
    expect(windowOf(p.selection!, next)).toEqual({ from: '2026-11-01', to: '2026-11-10' })
    expect(windowOf(p.selection!, t)).toEqual({ from: '2026-11-01', to: '2026-11-10' })
  })
})

describe('phone: push tapped → app reopened → day turns', () => {
  const href = notificationHref({ loja: 'todas', from: '2026-11-24', to: '2026-11-24', nonce: 'k3x9q2ab', members: [MOKOO] })
  const base = saved('todas')
  it('a tap at 23:59 BRT opens 24 nov (hoje); at 00:01 the same visit is 24 nov (ontem), never saved', () => {
    const t1 = brt('2026-11-24', '23:59')
    const o = openApp({ url: href, navType: 'navigate', fromSwMessage: false, session: null, saved: base, viewer: VIEWER, now: t1, newId })
    expect(o.kind).toBe('fresh')
    const r1 = resolve(shownSelection(o.state), VIEWER, t1)
    expect(r1.label.short).toBe('24 nov (hoje)')
    expect(stripFor(o.state, VIEWER, r1, r1.clockToday)!.text).toMatch(/^Notificação sobre 24 nov \(hoje\): mostrando esse dia\./)
    const t2 = brt('2026-11-25', '00:01')
    const r2 = resolve(shownSelection(o.state), VIEWER, t2)
    expect(r2.window).toEqual({ from: '2026-11-24', to: '2026-11-24' })
    expect(r2.label.short).toBe('24 nov (ontem)')
    expect(o.state.saved).toEqual(base)
    // The app is reopened by a reload 5 minutes later: a restore of the same visit.
    const session: SessionRecord = { visit: o.state.visit!, hiddenAt: null, lastSeenAt: t2.toISOString(), closedStrip: false }
    const re = openApp({ url: o.url, navType: 'reload', fromSwMessage: false, session, saved: base, viewer: VIEWER, now: brt('2026-11-25', '00:06'), newId })
    expect(re.kind).toBe('restore')
    expect(re.state.visit!.id).toBe(o.state.visit!.id)
    // Reopened from the home-screen icon (bare /m): the saved view, no visit.
    const icon = openApp({ url: '/m', navType: 'navigate', fromSwMessage: false, session, saved: base, viewer: VIEWER, now: brt('2026-11-25', '08:00'), newId })
    expect(icon.state.visit).toBeNull()
    expect(shownView(icon.state).period).toEqual(preset('7d'))
  })
  it('Hibikura row inside the visit at 23:59 Tokyo, then Tokyo midnight: the day does not move', () => {
    const t1 = tokyo('2026-11-25', '23:59') // 11:59 BRT 25 nov
    const o = openApp({ url: href, navType: 'navigate', fromSwMessage: false, session: null, saved: base, viewer: VIEWER, now: t1, newId })
    const s = reduce(o.state, { type: 'row', loja: HIBIKURA }, VIEWER, newId)
    expect(s.saved).toEqual(base)
    const before = resolve(shownSelection(s), VIEWER, t1)
    const after = resolve(shownSelection(s), VIEWER, tokyo('2026-11-26', '00:01'))
    expect(before.window).toEqual(after.window)
    expect(after.window).toEqual({ from: '2026-11-24', to: '2026-11-24' })
    // The Todas chip brings back the owner's own view.
    const chip = reduce(s, { type: 'chip', loja: 'todas' }, VIEWER, newId)
    expect(chip.visit).toBeNull()
    expect(shownView(chip).period).toEqual(preset('7d'))
  })
  it('a period pick inside a push visit: the strip says what is still overridden', () => {
    const scale = notificationHref({ loja: GLOOTY, from: '2026-11-14', to: '2026-11-20', aba: 'campanhas', nonce: 'scale001' })
    const o = openApp({ url: scale, navType: 'navigate', fromSwMessage: false, session: null, saved: base, viewer: VIEWER, now: brt('2026-11-24', '10:00'), newId })
    const s = reduce(o.state, { type: 'period', period: preset('today') }, VIEWER, newId)
    expect(s.saved.period).toEqual(preset('today'))
    expect(stripFor(s, VIEWER, null)!.text).toBe('Mostrando Glooty, aberta pela notificação. Aba Campanhas aberta pela notificação. Os botões de loja no alto voltam para Todas · Hoje.')
  })
})

describe('phone: openApp identity matrix (R16)', () => {
  const href = notificationHref({ loja: MOKOO, from: '2026-11-24', to: '2026-11-24', nonce: 'aaaa1111' })
  const otherN = notificationHref({ loja: MOKOO, from: '2026-11-24', to: '2026-11-24', nonce: 'bbbb2222' })
  const now = brt('2026-11-24', '20:00')
  const visit = { id: 'old', source: 'push' as const, pushId: 'aaaa1111', loja: MOKOO, period: dates('2026-11-24', '2026-11-24'), url: '' }
  visit.url = toUrl(visit)
  const sess = (minHidden: number, url = visit.url): SessionRecord => ({
    visit: { ...visit, url }, hiddenAt: new Date(now.getTime() - minHidden * 60_000).toISOString(), lastSeenAt: now.toISOString(), closedStrip: true,
  })
  const run = (navType: NavType, session: SessionRecord | null, url = href, fromSwMessage = false) =>
    openApp({ url, navType, fromSwMessage, session, saved: saved('todas'), viewer: VIEWER, now, newId })

  it('navigate / prerender / SW message: always a fresh visit (a re-tap after 40 min included)', () => {
    for (const nt of ['navigate', 'prerender'] as NavType[]) for (const s of [null, sess(5), sess(40)]) {
      const o = run(nt, s)
      expect(o.kind).toBe('fresh')
      expect(o.state.visit!.id).not.toBe('old')
      expect(o.state.closedStrip).toBe(false)
    }
    expect(run('reload', sess(40), href, true).kind).toBe('fresh')
  })
  it('reload / back_forward with the same visit: restore; hidden ≥ 30 min: no visit', () => {
    for (const nt of ['reload', 'back_forward'] as NavType[]) {
      const r = run(nt, sess(5))
      expect(r.kind).toBe('restore')
      expect(r.state.visit!.id).toBe('old')
      expect(r.state.closedStrip).toBe(true)
      const gone = run(nt, sess(40))
      expect(gone.state.visit).toBeNull()
      expect(gone.url).toBe('/m')
    }
  })
  it('reload with no visit or another visit in session: a fresh visit', () => {
    expect(run('reload', null).kind).toBe('fresh')
    expect(run('reload', sess(5, '/m?loja=epoch&origem=link')).kind).toBe('fresh')
  })
  it('unknown navigation type: the nonce decides', () => {
    expect(run('unknown', sess(5)).kind).toBe('restore')
    expect(run('unknown', sess(5), otherN).kind).toBe('fresh')
    expect(run('unknown', null).kind).toBe('fresh')
  })
  it('two pushes with the same dates open two visits', () => {
    const a = run('navigate', null, href)
    const b = run('navigate', null, otherN)
    expect(a.state.visit!.id).not.toBe(b.state.visit!.id)
  })
  it('a storage event during a visit changes the saved view, never the visit', () => {
    const o = run('navigate', null)
    const s: PhoneState = reduce(o.state, { type: 'storage', saved: saved(EPOCH) }, VIEWER, newId)
    expect(shownView(s).loja).toBe(MOKOO)
    expect(s.saved.loja).toBe(EPOCH)
  })
  it('a link equal to the saved view opens no visit; a push always does', () => {
    expect(openApp({ url: '/m?loja=todas&periodo=today', navType: 'navigate', fromSwMessage: false, session: null, saved: saved('todas', preset('today')), viewer: VIEWER, now, newId }).state.visit).toBeNull()
    expect(openApp({ url: notificationHref({ loja: 'todas', from: '2026-11-24', to: '2026-11-24', nonce: 'cccc3333' }), navType: 'navigate', fromSwMessage: false, session: null, saved: saved('todas', dates('2026-11-24', '2026-11-24')), viewer: VIEWER, now, newId }).state.visit).not.toBeNull()
  })
})

describe('turn guard (R8): client clock skew never loops', () => {
  const at = '2026-11-25T03:00:00.000Z'
  const turn = Date.parse(at)
  for (const [name, skew] of [['+3 min', 180_000], ['−3 min', -180_000], ['+2 h', 7_200_000]] as const) {
    it(`client ${name}: at most ${MAX_RETRIES + 1} refreshes while the server echoes the same nextTurnAt`, () => {
      let g = initialGuard
      let refreshes = 0
      // Simulate the watcher checking every second for 10 minutes of client time.
      for (let s = 0; s < 600; s++) {
        const r = shouldRefresh(g, at, turn - 60_000 + skew + s * 1000, false)
        g = r.state
        if (r.refresh) refreshes++
      }
      expect(refreshes).toBeLessThanOrEqual(MAX_RETRIES + 1)
    })
  }
  it('a new nextTurnAt arms a new refresh; an unchanged day before it never refreshes', () => {
    expect(shouldRefresh(initialGuard, at, turn - 10_000, false).refresh).toBe(false)
    const first = shouldRefresh(initialGuard, at, turn + 2_000, false)
    expect(first.refresh).toBe(true)
    expect(shouldRefresh(first.state, '2026-11-25T15:00:00.000Z', turn + 3_000, true).refresh).toBe(true)
  })
})

describe('desktop links never carry a legacy key through a sequence', () => {
  it('volta in the address never reaches a period, store or page link', () => {
    const start = '/products?loja=mokoo&periodo=custom&de=2026-11-24&ate=2026-11-24&volta=today&compare=mtd&dia=2026-11-24'
    for (const link of [
      { kind: 'period' as const, period: preset('30d') },
      { kind: 'store' as const, scope: store(EPOCH) },
      { kind: 'page' as const, path: '/countries' },
      { kind: 'split' as const, on: true },
    ]) expect(layer(start, link, { archivedIds: [] })).not.toMatch(/volta|compare|dia=/)
    expect(desktopHref('/', carry({ scope: store(MOKOO), period: preset('today'), split: false }, store(HIBIKURA), VIEWER)!.selection)).toBe('/?loja=hibikura&periodo=today')
  })
})
