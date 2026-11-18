/**
 * The sale chime ("cha-ching"), synthesised with two oscillators — Web Push
 * cannot carry a custom sound, so this only plays while the app is open.
 *
 * Two things the old version got wrong:
 *  - turning sound off did not silence it: playing never looked at the
 *    preference. Now `enabled` gates every play and "off" suspends the context.
 *  - on iOS the context is suspended (or "interrupted") whenever the phone
 *    locks, and only a tap may resume it. The old code listened for ONE tap;
 *    after the first lock the chime was gone until a reload. Now, while sound
 *    is on, every tap and every return to the foreground tries to resume.
 */

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

let ctx: AudioContext | null = null
let enabled = false
let armed = false

export const SOUND_KEY = 'opero_sound'

function ensureContext(): AudioContext | null {
  if (ctx) return ctx
  try {
    const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
    ctx = Ctor ? new Ctor() : null
  } catch {
    ctx = null
  }
  return ctx
}

function resume() {
  if (!enabled) return
  const c = ensureContext()
  // 'interrupted' is Safari's state after a call or a lock.
  if (c && c.state !== 'running') void c.resume().catch(() => {})
}

function onVisible() {
  if (document.visibilityState === 'visible') resume()
}

function arm() {
  if (armed) return
  armed = true
  window.addEventListener('pointerdown', resume, { passive: true })
  window.addEventListener('touchend', resume, { passive: true })
  window.addEventListener('keydown', resume)
  document.addEventListener('visibilitychange', onVisible)
}

function disarm() {
  if (!armed) return
  armed = false
  window.removeEventListener('pointerdown', resume)
  window.removeEventListener('touchend', resume)
  window.removeEventListener('keydown', resume)
  document.removeEventListener('visibilitychange', onVisible)
}

/** Whether Web Audio exists at all on this device. */
export function soundSupported(): boolean {
  return typeof window !== 'undefined' && !!(window.AudioContext ?? (window as WebkitWindow).webkitAudioContext)
}

/**
 * Turn the chime on or off. Call it from the tap that toggles it: iOS only
 * lets a context start inside a user gesture.
 */
export function setSoundEnabled(on: boolean) {
  enabled = on
  if (on) {
    arm()
    resume()
  } else {
    disarm()
    if (ctx && ctx.state === 'running') void ctx.suspend().catch(() => {})
  }
}

export function soundEnabled(): boolean {
  return enabled
}

/** Whether a chime would be heard right now (on, and the context running). */
export function soundReady(): boolean {
  return enabled && ctx?.state === 'running'
}

function ping(c: AudioContext, at: number, freq: number, gain: number, decay: number) {
  const osc = c.createOscillator()
  const amp = c.createGain()
  osc.type = 'triangle'
  osc.frequency.setValueAtTime(freq, at)
  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.006)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + decay)
  osc.connect(amp).connect(c.destination)
  osc.start(at)
  osc.stop(at + decay + 0.02)
}

function ring(c: AudioContext, volume: number) {
  const t = c.currentTime + 0.01
  const v = Math.max(0, Math.min(1, volume))
  // "cha": the drawer strike
  ping(c, t, 2100, 0.10 * v, 0.05)
  ping(c, t, 1500, 0.06 * v, 0.06)
  // "ching": C6 and E6, the second slightly late so it rings rather than chords
  ping(c, t + 0.085, 1046.5, 0.34 * v, 0.55)
  ping(c, t + 0.100, 1318.5, 0.26 * v, 0.60)
  ping(c, t + 0.085, 2093.0, 0.07 * v, 0.40)
}

/** Ring once — only when the owner turned sound on. */
export function playChaChing(volume = 0.5) {
  if (!enabled || !ctx) return
  if (ctx.state === 'running') { ring(ctx, volume); return }
  const c = ctx
  void c.resume().then(() => { if (enabled && c.state === 'running') ring(c, volume) }).catch(() => {})
}

// ─── The owner's preference (localStorage), as an external store ─────────────

const prefListeners = new Set<() => void>()

export function getSoundPref(): boolean {
  try { return window.localStorage.getItem(SOUND_KEY) === '1' } catch { return false }
}

export function subscribeSoundPref(cb: () => void): () => void {
  prefListeners.add(cb)
  const onStorage = (e: StorageEvent) => { if (e.key === SOUND_KEY) cb() }
  window.addEventListener('storage', onStorage)
  return () => { prefListeners.delete(cb); window.removeEventListener('storage', onStorage) }
}

/** Save the preference and apply it now (call from the tap). */
export function setSoundPref(on: boolean) {
  try { window.localStorage.setItem(SOUND_KEY, on ? '1' : '0') } catch { /* private mode: still applies for this visit */ }
  setSoundEnabled(on)
  for (const l of prefListeners) l()
}
