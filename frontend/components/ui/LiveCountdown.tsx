'use client'

/**
 * LiveCountdown — "Faltam 3h59 para o dia fechar", ticking on the screen's
 * clock (R8: live with clientNow(), the server-corrected clock). A verdict is
 * rendered once on the server (the desktop has no poll), so its countdown
 * line was frozen at the render instant: opened at 20:00 it still said
 * "Faltam 3h59" at 23:30. The first paint is the server's text (no hydration
 * mismatch); the effect takes over at once.
 *
 * Props: { tz — the screen's clock (Resolution.clockTz); suffix — what follows
 *   the countdown (" para o dia fechar em Tóquio."); initial — the server's
 *   whole line }
 */

import { useEffect, useState } from 'react'
import { countdownText, minutesLeft } from '@/lib/period'
import { clientNow } from '@/lib/period/client/clock'

export function LiveCountdown({ tz, suffix, initial }: { tz: string; suffix: string; initial: string }) {
  const [text, setText] = useState(initial)
  useEffect(() => {
    const tick = () => setText(`${countdownText(minutesLeft(tz, clientNow()))}${suffix}`)
    tick()
    const id = setInterval(tick, 15_000)
    return () => clearInterval(id)
  }, [tz, suffix])
  return <>{text}</>
}
