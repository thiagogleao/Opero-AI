/**
 * Cash-register chime for new sales.
 *
 * Synthesised rather than shipped as an audio file: Shopify's own sound is
 * their asset, and two oscillators cost nothing to load. Web Push cannot carry
 * a custom sound on any browser (the Notification API's `sound` property was
 * dropped from the spec), so this only fires while the app is open.
 */

let ctx: AudioContext | null = null

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext }

/**
 * Must be called from a user gesture: iOS starts every AudioContext suspended
 * and only a tap can resume it. Returns false when Web Audio is unavailable.
 */
export function unlockAudio(): boolean {
  try {
    if (!ctx) {
      const Ctor = window.AudioContext ?? (window as WebkitWindow).webkitAudioContext
      if (!Ctor) return false
      ctx = new Ctor()
    }
    if (ctx.state === 'suspended') void ctx.resume()
    return true
  } catch {
    return false
  }
}

/** One struck-bell partial: fast attack, exponential decay. */
function ping(at: number, freq: number, gain: number, decay: number) {
  if (!ctx) return
  const osc = ctx.createOscillator()
  const amp = ctx.createGain()

  osc.type = 'triangle'
  osc.frequency.setValueAtTime(freq, at)

  amp.gain.setValueAtTime(0.0001, at)
  amp.gain.exponentialRampToValueAtTime(gain, at + 0.006)
  amp.gain.exponentialRampToValueAtTime(0.0001, at + decay)

  osc.connect(amp).connect(ctx.destination)
  osc.start(at)
  osc.stop(at + decay + 0.02)
}

/**
 * "cha-ching": a short bright strike, then two bell partials a major third
 * apart — the interval that gives a till its ring.
 */
export function playChaChing(volume = 0.5) {
  if (!ctx || ctx.state !== 'running') return
  const t = ctx.currentTime + 0.01
  const v = Math.max(0, Math.min(1, volume))

  // "cha" — the drawer strike
  ping(t, 2100, 0.10 * v, 0.05)
  ping(t, 1500, 0.06 * v, 0.06)

  // "ching" — C6 and E6, the second slightly delayed so it rings, not chords
  ping(t + 0.085, 1046.5, 0.34 * v, 0.55)
  ping(t + 0.100, 1318.5, 0.26 * v, 0.60)
  ping(t + 0.085, 2093.0, 0.07 * v, 0.40) // octave shimmer
}

export function audioReady(): boolean {
  return ctx?.state === 'running'
}
