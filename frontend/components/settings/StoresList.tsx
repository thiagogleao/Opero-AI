'use client'

/**
 * The viewer's stores, with archive / restore. Archiving is a soft switch
 * (A9): the store leaves "Todas", the pickers and the sync; history, costs
 * and credentials stay, and it can come back. The dialog says exactly that
 * before anything is written, and the list only changes after the server
 * confirmed (router.refresh re-reads it).
 */

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Avatar, Badge, Button, ButtonLink, Callout, Chip } from '@/components/ui'
import { ConfirmDialog } from './ConfirmDialog'
import { callApi, nothingChanged } from './messages'
import s from './settings.module.css'
import { dateBeside } from '@/lib/period'

export interface StoreListItem {
  id: string
  name: string
  domain: string | null
  city: string
  archived: boolean
  /** YYYY-MM-DD in the store's timezone (resolved on the server). */
  archivedOn: string | null
  current: boolean
  shopifyConnected: boolean
  facebookConnected: boolean
  /** Ajustes of this store (keeps the page state). */
  href: string
}

export function StoresList({ stores, today, addHref }: { stores: StoreListItem[]; today: string; addHref: string }) {
  const router = useRouter()
  const [target, setTarget] = useState<{ store: StoreListItem; archive: boolean } | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const active = stores.filter(st => !st.archived)
  const archived = stores.filter(st => st.archived)

  async function apply() {
    if (!target) return
    setPending(true)
    setError(null)
    const r = await callApi(`/api/stores/${encodeURIComponent(target.store.id)}`, {
      method: 'PATCH', body: JSON.stringify({ archived: target.archive }),
    })
    setPending(false)
    if (!r.ok) { setError(nothingChanged(r.error)); return }
    setResult({
      ok: true,
      text: target.archive
        ? `${target.store.name} foi arquivada: saiu de “Todas as lojas”, dos seletores e da sincronização. O histórico continua guardado.`
        : `${target.store.name} voltou: aparece de novo em “Todas as lojas” e volta a sincronizar.`,
    })
    setTarget(null)
    router.refresh()
  }

  const row = (st: StoreListItem) => (
    <div key={st.id} className={s.store}>
      <div className={s.storeName}>
        <Avatar name={st.name} size="sm" />
        <div>
          <div className={s.inline}>
            <Link href={st.href} style={{ textDecoration: 'none' }}><b>{st.name}</b></Link>
            {st.current && <Badge tone="info">aberta aqui</Badge>}
            {st.archived && <Badge tone="mut">arquivada</Badge>}
          </div>
          <div className={s.sub}>
            {st.domain ?? 'sem domínio'} · {st.city}
            {st.archivedOn ? ` · arquivada em ${dateBeside(st.archivedOn, { window: { from: st.archivedOn, to: st.archivedOn }, clockToday: today })}` : ''}
          </div>
        </div>
      </div>
      <div className={s.actions}>
        {!st.archived && (
          <>
            <Chip tone={st.shopifyConnected ? 'neu' : 'warn'} icon={st.shopifyConnected ? 'check' : 'alert'} size="sm">Shopify {st.shopifyConnected ? 'ligada' : 'sem chave'}</Chip>
            <Chip tone={st.facebookConnected ? 'neu' : 'mut'} icon={st.facebookConnected ? 'check' : undefined} size="sm">Meta {st.facebookConnected ? 'ligado' : 'sem conta'}</Chip>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => { setError(null); setTarget({ store: st, archive: !st.archived }) }}>
          {st.archived ? 'Desarquivar' : 'Arquivar'}
        </Button>
      </div>
    </div>
  )

  return (
    <div className={s.stack}>
      {result && <Callout tone={result.ok ? 'info' : 'neg'} icon={result.ok ? 'check' : undefined}>{result.text}</Callout>}
      <div>{active.map(row)}</div>
      {active.length === 0 && <p className={s.sub}>Nenhuma loja ativa.</p>}
      <div className={s.actions}>
        <ButtonLink href={addHref} icon="store" size="sm">Adicionar loja</ButtonLink>
      </div>
      {archived.length > 0 && (
        <div>
          <div className="lbl" style={{ margin: '8px 0' }}>Arquivadas · {archived.length}</div>
          <p className={s.sub} style={{ marginBottom: 6 }}>Fora de “Todas as lojas”, dos seletores e da sincronização. O nome abre os ajustes dela; com ela aberta, as outras telas mostram o histórico.</p>
          <div>{archived.map(row)}</div>
        </div>
      )}

      <ConfirmDialog
        open={!!target}
        title={target ? (target.archive ? `Arquivar ${target.store.name}?` : `Desarquivar ${target.store.name}?`) : ''}
        confirmLabel={target?.archive ? 'Arquivar loja' : 'Desarquivar loja'}
        danger={target?.archive}
        pending={pending}
        error={error}
        onClose={() => setTarget(null)}
        onConfirm={apply}
      >
        {target?.archive ? (
          <>
            A loja sai de <b>“Todas as lojas”</b>, dos seletores de loja e da <b>sincronização</b>: nada novo é importado
            da Shopify nem do Meta. <b>Nada é apagado</b>: pedidos, gastos, custos e credenciais ficam guardados, o histórico
            continua acessível aqui em Ajustes, e dá para desarquivar quando quiser.
          </>
        ) : (
          <>A loja volta para “Todas as lojas” e para os seletores, e a sincronização recomeça.</>
        )}
      </ConfirmDialog>
    </div>
  )
}
