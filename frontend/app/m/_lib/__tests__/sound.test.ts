import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// sound.ts reads `window` and `document` when called: a minimal pair of each,
// with a storage that another window can change behind this one's back.
type Listener = (e: { key: string | null }) => void
const listeners = new Map<string, Set<Listener>>()
const storage = new Map<string, string>()
const g = globalThis as unknown as { window?: unknown; document?: unknown }
const saved = { window: g.window, document: g.document }

beforeAll(() => {
  g.window = {
    addEventListener: (type: string, fn: Listener) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(fn) },
    removeEventListener: (type: string, fn: Listener) => { listeners.get(type)?.delete(fn) },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => { storage.set(k, v) },
    },
  }
  g.document = { addEventListener: () => {}, removeEventListener: () => {}, visibilityState: 'visible' }
})
afterAll(() => { g.window = saved.window; g.document = saved.document })

/** The other window wrote the preference: this one only gets the event. */
function otherWindowSets(key: string, value: string) {
  storage.set(key, value)
  for (const fn of listeners.get('storage') ?? []) fn({ key })
}

// Two windows sharing storage (the installed app and a browser tab): turning
// the sound off in one changed the other's icon but it kept ringing.
describe('sound preference changed in another window', () => {
  it('the chime follows the icon both ways', async () => {
    const sound = await import('../sound')
    storage.set(sound.SOUND_KEY, '1')
    sound.restoreSound(sound.getSoundPref())
    const rerender = vi.fn()
    const off = sound.subscribeSoundPref(rerender)
    expect(sound.soundEnabled()).toBe(true)

    otherWindowSets(sound.SOUND_KEY, '0')
    expect(rerender).toHaveBeenCalledTimes(1)
    expect(sound.getSoundPref()).toBe(false)
    expect(sound.soundEnabled()).toBe(false)

    otherWindowSets(sound.SOUND_KEY, '1')
    expect(sound.soundEnabled()).toBe(true)

    // Another key changes nothing.
    otherWindowSets('opero.m.selecao.v2', '{}')
    expect(rerender).toHaveBeenCalledTimes(2)
    expect(sound.soundEnabled()).toBe(true)
    off()
  })
})
