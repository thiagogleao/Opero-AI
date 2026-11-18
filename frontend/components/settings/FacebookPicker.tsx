'use client'

/**
 * Choose which ad account a Facebook login links to a store, after the OAuth
 * round trip (/facebook/accounts for the main account, /facebook/extra-accounts
 * for an extra). The store is named on screen and sent with the request; the
 * server re-checks it against the viewer and the sealed login cookie (A3/A12).
 *
 * Linking a 60-day user token over a store's permanent system-user token needs
 * an explicit second click that says when it expires (A17). After a link, the
 * account's history is requested from the date the server returned.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, Callout, Chip } from '@/components/ui'
import type { FacebookPicker as Picker, PickerAdAccount } from '@/lib/integrations/types'
import { startBackfill } from './backfill'
import { FACEBOOK_ERROR, FB_RETURN_KEY, accountStatusText, callApi, nothingChanged } from './messages'
import s from './settings.module.css'

/** Onboarding's hint ("/onboarding?periodo=30d") → back to its import step,
 *  on the same period; anything else → Ajustes. Only the period keys of the
 *  hint are kept: it is a hint, not a place to send someone. */
function returnPath(storeId: string, fallback: string): string {
  try {
    const raw = window.sessionStorage.getItem(FB_RETURN_KEY)
    window.sessionStorage.removeItem(FB_RETURN_KEY)
    if (raw?.startsWith('/onboarding') && !raw.startsWith('//')) {
      const hint = new URL(raw, window.location.origin)
      if (hint.origin === window.location.origin && hint.pathname === '/onboarding') {
        const q = new URLSearchParams()
        for (const k of ['periodo', 'de', 'ate', 'parte']) {
          const v = hint.searchParams.get(k)
          if (v) q.set(k, v)
        }
        q.set('loja', storeId)
        q.set('fb_connected', 'true')
        return `/onboarding?${q}`
      }
    }
  } catch { /* storage disabled */ }
  return fallback
}

export function FacebookPicker({ picker, role, manual, settingsHref }: {
  picker: Picker
  role: 'main' | 'extra'
  /** The login could not list any account: type the id. */
  manual: boolean
  /** Ajustes of this store, with ?fb_connected=true. */
  settingsHref: string
}) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [replace, setReplace] = useState<{ id: string; expiresAt: string | null } | null>(null)
  const [typed, setTyped] = useState('')
  const [nickname, setNickname] = useState('')

  async function link(id: string, confirmReplacePermanent = false) {
    setPending(id)
    setError(null)
    const r = await callApi<{ backfillFrom: string | null; warning: string | null }>('/api/facebook/accounts', {
      method: 'POST',
      body: JSON.stringify({ storeId: picker.storeId, fb_ad_account_id: id, role, nickname: role === 'extra' ? nickname.trim() || undefined : undefined, confirmReplacePermanent }),
    }, FACEBOOK_ERROR)
    if (!r.ok) {
      setPending(null)
      if (r.code === 'replaces_permanent_token') {
        setReplace({ id, expiresAt: typeof r.extra.expiresAt === 'string' ? r.extra.expiresAt : picker.tokenInfo?.expiresAt ?? null })
        return
      }
      setError(r.error)
      return
    }
    if (r.data?.backfillFrom) await startBackfill(picker.storeId, r.data.backfillFrom, id)
    router.push(returnPath(picker.storeId, settingsHref))
  }

  const accounts = picker.accounts
  const t = picker.tokenInfo

  return (
    <div className={s.stack}>
      <p className={s.text}>
        {role === 'main' ? 'Escolha a conta principal de anúncios de ' : 'Escolha a conta extra de anúncios para '}<b>{picker.storeName}</b>.
        {role === 'main' && ' Trocar a conta principal não apaga o gasto da conta antiga: ele continua no histórico.'}
      </p>
      {picker.source === 'store' && (
        <Callout tone="neu">Nenhum login do Facebook aguardando: a lista usa o acesso que a loja já tem.</Callout>
      )}
      {t && (
        <p className={s.sub}>
          Acesso deste login: {!t.valid ? <span className="neg">inválido</span>
            : t.neverExpires ? 'não expira'
            : t.expiresAt ? <>expira em <b>{t.expiresAt.slice(8, 10)}/{t.expiresAt.slice(5, 7)}/{t.expiresAt.slice(0, 4)}</b> e nada o renova sozinho</>
            : 'validade desconhecida'}.
          {t.replacesPermanent && <span className="warn"> Ele substituiria o token atual da loja, que não expira.</span>}
        </p>
      )}
      {error && <Callout tone="neg" title="A conta não foi ligada">{nothingChanged(error)}</Callout>}
      {replace && (
        <Callout tone="warn" title="Isto troca um token que não expira por um que expira">
          O acesso atual de {picker.storeName} não expira. O deste login {replace.expiresAt ? `expira em ${replace.expiresAt.slice(8, 10)}/${replace.expiresAt.slice(5, 7)}/${replace.expiresAt.slice(0, 4)}` : 'expira'} e nada
          o renova sozinho: quando vencer, a coleta do Meta para.
          <div className={s.inline} style={{ marginTop: 8 }}>
            <Button size="sm" variant="danger" pending={pending === replace.id} onClick={() => link(replace.id, true)}>Trocar mesmo assim</Button>
            <Button size="sm" variant="ghost" onClick={() => setReplace(null)}>Manter o atual</Button>
          </div>
        </Callout>
      )}

      {role === 'extra' && (
        <label className={s.field} style={{ maxWidth: 320 }}>
          <span className={s.label}>Apelido da conta extra (opcional)</span>
          <input className={s.input} value={nickname} onChange={e => setNickname(e.target.value)} placeholder="ex.: conta reserva" />
        </label>
      )}

      {manual || accounts.length === 0 ? (
        <div className={s.form}>
          <span className={s.label}>O Facebook não listou nenhuma conta para este login. Cole o ID da conta de anúncio:</span>
          <div className={s.inline}>
            <input className={`${s.input} ${s.inputMono}`} style={{ maxWidth: 260 }} value={typed} onChange={e => setTyped(e.target.value)} placeholder="act_123456789" />
            <Button size="sm" variant="primary" pending={!!pending} disabled={!typed.trim()} onClick={() => link(`act_${typed.trim().replace(/^act_/i, '')}`)}>Ligar conta</Button>
          </div>
          <span className={s.hint}>No Gerenciador de Anúncios, o número aparece na URL: …?act=<b>123456789</b>.</span>
        </div>
      ) : (
        <div className={s.pickList} role="list">
          {accounts.map(a => <AccountChoice key={a.id} a={a} pending={pending === a.id} disabled={!!pending} onPick={() => link(a.id)} />)}
        </div>
      )}
    </div>
  )
}

function AccountChoice({ a, pending, disabled, onPick }: { a: PickerAdAccount; pending: boolean; disabled: boolean; onPick: () => void }) {
  const st = accountStatusText(a.accountStatus)
  const blocked = a.attachedElsewhere || !!a.attachedHere
  return (
    <div role="listitem">
      <button type="button" className={s.pick} disabled={disabled || blocked} onClick={onPick} aria-busy={pending || undefined}>
        <span>
          <b>{a.name}</b>
          <small>{a.id}</small>
        </span>
        <span className={s.inline} style={{ justifyContent: 'flex-end' }}>
          {a.attachedHere && <Badge tone="info">já é {a.attachedHere === 'main' ? 'a principal' : 'extra'} desta loja</Badge>}
          {a.attachedElsewhere && <Badge tone="mut">ligada a {a.attachedElsewhereTo ?? 'outra loja'}</Badge>}
          <Chip tone={st.tone === 'pos' ? 'pos' : st.tone === 'neg' ? 'neg' : st.tone === 'warn' ? 'warn' : 'mut'} size="sm" icon={st.tone === 'pos' ? 'check' : 'alert'}>
            {st.text}{!a.active ? ' · não é coletada' : ''}
          </Chip>
          {pending && <span className="mut">ligando…</span>}
        </span>
      </button>
    </div>
  )
}
