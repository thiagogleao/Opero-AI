/**
 * F14/F28 (period-fix-r1): a phone whose clock is off by hours keeps a push
 * visit across a reload, and expires it after 30 real minutes hidden (R16,
 * R19, P6). The visit's hiddenAt / lastSeenAt used to be written in server
 * time (device + offset) and read back after the reload with the offset gone:
 * a clock 2 h fast dropped the visit 12 s later; 2 h slow kept one hidden for
 * 40 minutes.
 *
 * The browser is stubbed (storage, location, history, navigation type) and
 * the module is loaded fresh for every "page load", as a reload does.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { viewerStores } from '@/lib/period/viewer'
import { STORES } from '@/lib/period/__tests__/fixtures'

const VIEWER = viewerStores(STORES)
const PUSH = '/m?loja=mokoo&periodo=custom&de=2026-11-23&ate=2026-11-23&origem=push&n=skew0001'
const SERVER_NOW = Date.parse('2026-11-24T21:05:00.000Z') // 18:05 BRT

class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}

let session: MemStorage
let local: MemStorage
let nav: 'navigate' | 'reload' = 'navigate'
let href = PUSH

function stubBrowser() {
  const loc = { get pathname() { return href.split('?')[0] }, get search() { const q = href.split('?')[1]; return q ? `?${q}` : '' } }
  vi.stubGlobal('sessionStorage', session)
  vi.stubGlobal('localStorage', local)
  vi.stubGlobal('performance', { getEntriesByType: () => [{ type: nav }] })
  vi.stubGlobal('window', { location: loc, history: { replaceState: (_: unknown, __: string, url: string) => { href = url } } })
}

/** One page load: a fresh module (the offset starts at 0, as after a reload). */
async function load() {
  vi.resetModules()
  stubBrowser()
  const clock = await import('@/lib/period/client/clock')
  const store = await import('../viewStore')
  store.setFacts(VIEWER)
  return { clock, store }
}

beforeEach(() => {
  session = new MemStorage()
  local = new MemStorage()
  local.setItem('opero.m.view.v3', JSON.stringify({ v: 3, loja: 'todas', period: { kind: 'preset', preset: '7d' }, aba: null }))
  nav = 'navigate'
  href = PUSH
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('visit expiry on a skewed phone clock', () => {
  for (const skewH of [2, -2, 0]) {
    it(`device clock ${skewH >= 0 ? '+' : ''}${skewH} h: a reload 12 s later restores the push visit`, async () => {
      vi.setSystemTime(SERVER_NOW + skewH * 3600_000)
      const first = await load()
      // The first answer corrects the clock to the server's.
      first.clock.adoptServerNow(SERVER_NOW, Date.now(), Date.now())
      expect(first.store.getState()?.visit?.loja).toBe('mokoo')
      first.store.touch()
      vi.setSystemTime(Date.now() + 12_000)
      nav = 'reload'
      const second = await load()
      expect(second.store.getState()?.visit?.period).toEqual({ kind: 'dates', from: '2026-11-23', to: '2026-11-23' })
      expect(href).toBe(PUSH)
    })

    it(`device clock ${skewH >= 0 ? '+' : ''}${skewH} h: hidden 40 real minutes, a reload expires it`, async () => {
      vi.setSystemTime(SERVER_NOW + skewH * 3600_000)
      const first = await load()
      first.clock.adoptServerNow(SERVER_NOW, Date.now(), Date.now())
      first.store.markHidden()
      vi.setSystemTime(Date.now() + 40 * 60_000)
      nav = 'reload'
      const second = await load()
      expect(second.store.getState()?.visit).toBeNull()
      expect(href).toBe('/m')
    })
  }
})
