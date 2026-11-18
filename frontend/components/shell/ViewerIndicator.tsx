'use client'

/**
 * ViewerIndicator — who is looking, with a way out.
 *  - Owner (magic-link cookie): "Modo dono" + "sair" → DELETE /api/mobile/unlock,
 *    then /sign-in. This signs out THIS device only (the phone stays unlocked).
 *  - Partner (Clerk): "Sócio" + "sair" → Clerk sign-out, then /sign-in.
 *
 * Props: { kind: 'owner' | 'partner' }
 */

import { useClerk } from '@clerk/nextjs'
import { useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import s from './shell.module.css'

export function ViewerIndicator({ kind }: { kind: 'owner' | 'partner' }) {
  return kind === 'owner' ? <OwnerIndicator /> : <PartnerIndicator />
}

function OwnerIndicator() {
  const [busy, setBusy] = useState(false)
  async function signOut() {
    setBusy(true)
    try { await fetch('/api/mobile/unlock', { method: 'DELETE' }) } finally {
      window.location.assign('/sign-in')
    }
  }
  return (
    <span className={s.viewer}>
      <span className={s.viewerTag} title="Este aparelho foi liberado pelo link do dono: vê todas as lojas.">
        <Icon name="lock" size={13} />Modo dono
      </span>
      <button type="button" className={s.linkBtn} onClick={signOut} disabled={busy} aria-label="Sair do modo dono neste aparelho">
        {busy ? 'saindo…' : 'sair'}
      </button>
    </span>
  )
}

function PartnerIndicator() {
  const { signOut } = useClerk()
  const [busy, setBusy] = useState(false)
  return (
    <span className={s.viewer}>
      <span className={s.viewerTag} title="Conta de sócio: vê só as lojas desta conta."><Icon name="user" size={13} />Sócio</span>
      <button
        type="button"
        className={s.linkBtn}
        disabled={busy}
        onClick={() => { setBusy(true); void signOut({ redirectUrl: '/sign-in' }) }}
      >
        {busy ? 'saindo…' : 'sair'}
      </button>
    </span>
  )
}
