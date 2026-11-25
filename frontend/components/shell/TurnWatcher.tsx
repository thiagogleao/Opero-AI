'use client'

/**
 * TurnWatcher — the desktop's day turning (R8). A page is rendered once on the
 * server; when its day turns (Brasília midnight, Tokyo midnight for Hibikura,
 * a member of Todas closing its day) this island calls router.refresh() and
 * the server re-resolves with its own clock. The schedule runs on the
 * server's clock (serverNow adopts the offset, R19) and is bounded by the
 * turn guard. A form with unsaved edits defers the refresh and shows
 * "O dia virou … [Atualizar]" instead.
 *
 * Props: { nextTurnAt; serverNow; selection; viewer; shownKey; label }
 */

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { resolve, resolutionKey, type Selection, type ViewerStores } from '@/lib/period'
import { adoptFreshServerNow, clientNow } from '@/lib/period/client/clock'
import { anyDirty } from '@/lib/period/client/dirty'
import { useTurnWatcher } from '@/lib/period/client/turn'
import s from './shell.module.css'

export function TurnWatcher({ nextTurnAt, serverNow, selection, viewer, shownKey, label }: {
  nextTurnAt: string; serverNow: string; selection: Selection; viewer: ViewerStores; shownKey: string; label: string
}) {
  const router = useRouter()
  const [deferred, setDeferred] = useState(false)
  const adopted = useRef<string | null>(null)
  useEffect(() => {
    if (adopted.current === serverNow) return
    adopted.current = serverNow
    // The page was rendered at serverNow; the HTML reached us around now. A
    // render seen before (back/forward, client cache) is not a fresh sample.
    const t = Date.now() // clock-ok: the offset sample needs the device clock
    adoptFreshServerNow(serverNow, t, t)
  }, [serverNow])

  useTurnWatcher({
    nextTurnAt,
    differs: () => resolutionKey(resolve(selection, viewer, clientNow())) !== shownKey,
    onTurn: () => { setDeferred(false); router.refresh() },
    isDirty: anyDirty,
    onDeferred: () => setDeferred(true),
  })

  if (!deferred) return null
  return (
    <div className={s.turnNote} role="status">
      O dia virou: estes números são de {label}.{' '}
      <button type="button" onClick={() => { setDeferred(false); router.refresh() }}>Atualizar</button>
    </div>
  )
}
