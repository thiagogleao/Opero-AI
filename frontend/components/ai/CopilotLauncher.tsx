'use client'

/**
 * CopilotLauncher — the top-bar button that opens the Copilot drawer: a
 * read-only analyst for the store on screen, over POST /api/agent.
 *
 * Props (AppShell passes them):
 *   { storeId: string | null   — the store in view; null = "Todas as lojas"
 *                                (the drawer then asks which store: the AI
 *                                reads one store's books at a time)
 *     from: string             — window start on screen, YYYY-MM-DD
 *     to: string               — window end, YYYY-MM-DD (used for the suggested question)
 *     split: boolean           — partner view (?parte=50): answers add "sua parte (50%)" }
 *
 * The conversation lives here, not in the drawer: closing the drawer keeps an
 * answer streaming (the button shows a dot meanwhile). Each page draws its own
 * shell, so the open/closed state and the conversation are kept in
 * sessionStorage and come back on the next page — the conversation only when
 * it is about the same store (useCopilotChat).
 */

import { useCallback, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/Card'
import { useIsClient } from '@/components/ui/InfoTip'
import { CopilotDrawer } from './CopilotDrawer'
import { useCopilotChat } from './useCopilotChat'
import { loadStores } from './stores'
import s from './Copilot.module.css'

export interface CopilotLauncherProps {
  storeId: string | null
  from: string
  to: string
  split: boolean
}

const OPEN_KEY = 'opero.copilot.open'

function readOpen(): boolean {
  if (typeof window === 'undefined') return false
  try { return window.sessionStorage.getItem(OPEN_KEY) === '1' } catch { return false }
}

function writeOpen(open: boolean) {
  try {
    if (open) window.sessionStorage.setItem(OPEN_KEY, '1')
    else window.sessionStorage.removeItem(OPEN_KEY)
  } catch { /* storage unavailable: the drawer just won't reopen on the next page */ }
}

export function CopilotLauncher({ storeId, from, to, split }: CopilotLauncherProps) {
  // Read on the client only; the drawer itself renders after hydration
  // (useIsClient), so the server HTML never depends on it.
  const [open, setOpen] = useState(readOpen)
  const [byClick, setByClick] = useState(false)
  const chat = useCopilotChat(storeId, split)
  const client = useIsClient()
  const buttonId = useId()
  const drawerId = useId()
  const shown = client && open

  const show = () => { writeOpen(true); setByClick(true); setOpen(true) }
  // Warm the store list (names for the drawer header) as the pointer or focus
  // reaches the button, so the drawer opens with "Sobre MOKOO" rather than
  // "Sobre esta loja" for the second /api/stores takes. A failure is shown by
  // the drawer, which asks again.
  const warm = () => { loadStores().catch(() => {}) }
  const close = useCallback(() => {
    writeOpen(false)
    setOpen(false)
    document.getElementById(buttonId)?.focus({ preventScroll: true })
  }, [buttonId])

  return (
    <>
      <Button
        id={buttonId}
        variant="secondary"
        icon="sparkle"
        aria-haspopup="dialog"
        aria-expanded={shown}
        aria-controls={shown ? drawerId : undefined}
        title={storeId ? 'Perguntar ao Copiloto sobre esta loja' : 'Perguntar ao Copiloto sobre uma das lojas'}
        onClick={() => (shown ? close() : show())}
        onPointerEnter={warm}
        onFocus={warm}
      >
        Copiloto
        {chat.busy && !shown && <span className={s.busyDot} role="status" aria-label="respondendo" />}
      </Button>
      {shown && createPortal(
        <CopilotDrawer id={drawerId} chat={chat} pageStoreId={storeId} from={from} to={to} split={split} onClose={close} autoFocus={byClick} />,
        document.body,
      )}
    </>
  )
}

export default CopilotLauncher
