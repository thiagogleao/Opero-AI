'use client'

/**
 * The store's ad accounts: main, extras and "históricas" (no longer linked,
 * but their past spend is still in the store's books), each with its live
 * health from /api/facebook/health and its spend in the last 30 days.
 *
 * Every write waits for the server and shows success only on a confirmed
 * answer, then re-reads the page (router.refresh) so the list is the
 * database's, not an optimistic guess (A24). Pausing stops collection only —
 * the account's spend stays in profit for every period (A2), and the screen
 * says so before and after. An archived store is consultation only: the
 * accounts and their health are listed, with no action at all.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, Button, Callout, Chip, Money } from '@/components/ui'
import type { AdAccountHealth, StoreAdAccount } from '@/lib/integrations/types'
import { formatDate } from '@/lib/format'
import { AnchorButton } from './AnchorButton'
import { ConfirmDialog } from './ConfirmDialog'
import { FACEBOOK_ERROR, FB_RETURN_KEY, accountStatusText, callApi } from './messages'
import { SyncErrorsLine } from './SyncErrorsLine'
import { startBackfill } from './backfill'
import s from './settings.module.css'

export interface AccountRow extends StoreAdAccount {
  health: AdAccountHealth | null
}

type Pending = { kind: 'pause' | 'remove'; row: AccountRow } | null

export function AdAccounts({ storeId, storeName, returnTo, archived, today, accounts, healthError }: {
  storeId: string
  storeName: string
  /** Ajustes with its URL state: where a Facebook login started here comes back. */
  returnTo: string
  archived: boolean
  today: string
  accounts: AccountRow[]
  healthError: string | null
}) {
  const router = useRouter()
  const [confirm, setConfirm] = useState<Pending>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [renaming, setRenaming] = useState<{ id: number; value: string } | null>(null)
  const [form, setForm] = useState<'main' | 'extra' | null>(null)

  const main = accounts.find(a => a.role === 'main') ?? null
  const extras = accounts.filter(a => a.role === 'extra')
  const historical = accounts.filter(a => a.role === 'historical')
  const label = (a: AccountRow) => a.nickname || a.health?.name || a.adAccountId

  async function setActive(row: AccountRow, active: boolean) {
    if (row.id === null) return
    setBusy(`active-${row.id}`)
    const r = await callApi(`/api/facebook/extra-accounts/${row.id}`, { method: 'PATCH', body: JSON.stringify({ is_active: active }) }, FACEBOOK_ERROR)
    setBusy(null)
    if (!r.ok) {
      if (confirm) setDialogError(r.error)
      else setResult({ ok: false, text: `Não foi possível ${active ? 'retomar' : 'pausar'} ${label(row)}: ${r.error}` })
      return
    }
    setConfirm(null)
    setResult({
      ok: true,
      text: active
        ? `Coleta de ${label(row)} retomada.`
        : `Coleta de ${label(row)} pausada. O gasto que ela já teve continua no lucro da loja.`,
    })
    router.refresh()
  }

  async function remove(row: AccountRow) {
    if (row.id === null) return
    setBusy(`remove-${row.id}`)
    const r = await callApi<{ historyKept: boolean }>(`/api/facebook/extra-accounts/${row.id}`, { method: 'DELETE' }, FACEBOOK_ERROR)
    setBusy(null)
    if (!r.ok) { setDialogError(r.error); return }
    setConfirm(null)
    setResult({ ok: true, text: `${label(row)} foi desligada da loja e não é mais coletada. O gasto dela continua no lucro e ela aparece em “Contas históricas”.` })
    router.refresh()
  }

  async function rename(row: AccountRow, nickname: string) {
    if (row.id === null) return
    setBusy(`rename-${row.id}`)
    const r = await callApi(`/api/facebook/extra-accounts/${row.id}`, { method: 'PATCH', body: JSON.stringify({ nickname: nickname.trim() || null }) }, FACEBOOK_ERROR)
    setBusy(null)
    if (!r.ok) { setResult({ ok: false, text: `O nome não foi salvo: ${r.error}` }); return }
    setRenaming(null)
    setResult({ ok: true, text: 'Nome salvo.' })
    router.refresh()
  }

  const oauth = (mode: 'main' | 'extra') => `/api/facebook/auth?store=${encodeURIComponent(storeId)}&mode=${mode}&return=${encodeURIComponent(returnTo)}`

  // A Facebook login started here comes back here, even if an abandoned
  // onboarding left its return hint in this tab.
  const clearReturnHint = () => { try { window.sessionStorage.removeItem(FB_RETURN_KEY) } catch { /* storage disabled */ } }

  return (
    <div className={s.stack} onClickCapture={e => { if ((e.target as Element).closest?.('a[href^="/api/facebook/auth"]')) clearReturnHint() }}>
      {/* An archived store is read-only: the page's one line says why, and
          no action below is offered (the server refuses them anyway). */}
      {healthError && <Callout tone="warn" title="Saúde das contas indisponível">{healthError} A lista abaixo vem do banco.</Callout>}
      {result && (
        <Callout tone={result.ok ? 'info' : 'neg'} icon={result.ok ? 'check' : undefined}>
          {result.text}
        </Callout>
      )}

      <div>
        <div className="lbl" style={{ marginBottom: 8 }}>Conta principal</div>
        {main ? (
          <AccountItem row={main} label={label(main)} today={today}>
            <div className={s.actions}>
              {!archived && <Button size="sm" variant="ghost" onClick={() => setForm(form === 'main' ? null : 'main')}>Trocar por ID e token</Button>}
              {!archived && <AnchorButton href={oauth('main')} icon="refresh">Reconectar com o Facebook</AnchorButton>}
            </div>
            <p className={s.sub}>A conta principal não pode ser pausada, só trocada. Trocar não apaga o gasto da conta antiga: ele fica no histórico.</p>
          </AccountItem>
        ) : (
          <div className={s.stack}>
            <p className={s.sub}>Nenhuma conta principal. Sem conta de anúncio, {storeName} aparece só com as vendas, sem gasto com Meta.</p>
            {!archived && (
              <div className={s.actions}>
                <AnchorButton href={oauth('main')} icon="external" variant="primary">Conectar com o Facebook</AnchorButton>
                <Button size="sm" variant="ghost" onClick={() => setForm(form === 'main' ? null : 'main')}>Colar ID e token</Button>
              </div>
            )}
          </div>
        )}
        {form === 'main' && <LinkForm storeId={storeId} role="main" onDone={text => { setForm(null); setResult({ ok: true, text }); router.refresh() }} onCancel={() => setForm(null)} />}
      </div>

      <div>
        <div className="lbl" style={{ marginBottom: 8 }}>Contas extras · {extras.length}</div>
        {extras.length === 0 && <p className={s.sub}>Nenhuma conta extra. Use uma quando a loja anuncia também por outra conta de anúncio.</p>}
        {extras.map(row => (
          <AccountItem key={row.adAccountId} row={row} label={label(row)} today={today}>
            {archived ? null : renaming?.id === row.id ? (
              <div className={s.inline}>
                <input
                  className={s.input} style={{ maxWidth: 260 }} value={renaming.value} aria-label="Apelido da conta"
                  onChange={e => setRenaming({ id: row.id!, value: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') rename(row, renaming.value); if (e.key === 'Escape') setRenaming(null) }}
                />
                <Button size="sm" variant="primary" pending={busy === `rename-${row.id}`} onClick={() => rename(row, renaming.value)}>Salvar nome</Button>
                <Button size="sm" variant="ghost" onClick={() => setRenaming(null)}>Cancelar</Button>
              </div>
            ) : (
              <div className={s.actions}>
                {row.syncing
                  ? <Button size="sm" onClick={() => { setDialogError(null); setConfirm({ kind: 'pause', row }) }}>Pausar coleta</Button>
                  : <Button size="sm" pending={busy === `active-${row.id}`} disabled={!row.hasToken} onClick={() => setActive(row, true)}>Retomar coleta</Button>}
                <Button size="sm" variant="ghost" onClick={() => setRenaming({ id: row.id!, value: row.nickname ?? '' })}>Renomear</Button>
                <Button size="sm" variant="ghost" onClick={() => { setDialogError(null); setConfirm({ kind: 'remove', row }) }}>Desligar da loja</Button>
              </div>
            )}
          </AccountItem>
        ))}
        {!archived && (
          <div className={s.actions} style={{ marginTop: 10 }}>
            <AnchorButton href={oauth('extra')} icon="external">Adicionar com o Facebook</AnchorButton>
            <Button size="sm" variant="ghost" onClick={() => setForm(form === 'extra' ? null : 'extra')}>Adicionar por ID e token</Button>
          </div>
        )}
        {form === 'extra' && <LinkForm storeId={storeId} role="extra" onDone={text => { setForm(null); setResult({ ok: true, text }); router.refresh() }} onCancel={() => setForm(null)} />}
      </div>

      {historical.length > 0 && (
        <div>
          <div className="lbl" style={{ marginBottom: 8 }}>Contas históricas · {historical.length}</div>
          <p className={s.sub} style={{ marginBottom: 8 }}>Não estão mais ligadas nem são coletadas, mas o gasto que tiveram continua no lucro desta loja.</p>
          {historical.map(row => <AccountItem key={row.adAccountId} row={row} label={label(row)} today={today} />)}
        </div>
      )}

      <ConfirmDialog
        open={confirm?.kind === 'pause'}
        title={`Pausar a coleta de ${confirm ? label(confirm.row) : ''}?`}
        confirmLabel="Pausar coleta"
        pending={!!busy}
        error={dialogError}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && setActive(confirm.row, false)}
      >
        O Opero para de buscar dados novos desta conta. <b>O gasto que ela já teve continua no lucro da loja</b>, em
        todos os períodos. O gasto que ela tiver enquanto estiver pausada não é coletado.
      </ConfirmDialog>
      <ConfirmDialog
        open={confirm?.kind === 'remove'}
        title={`Desligar ${confirm ? label(confirm.row) : ''} desta loja?`}
        confirmLabel="Desligar da loja"
        danger
        pending={!!busy}
        error={dialogError}
        onClose={() => setConfirm(null)}
        onConfirm={() => confirm && remove(confirm.row)}
      >
        A conta deixa de ser coletada e sai das contas ligadas. <b>O gasto que ela já teve continua no lucro</b> e ela
        passa a aparecer em “Contas históricas”. Para coletar de novo, adicione-a outra vez.
      </ConfirmDialog>
    </div>
  )
}

function AccountItem({ row, label, today, children }: { row: AccountRow; label: string; today: string; children?: React.ReactNode }) {
  const h = row.health
  const status = h ? accountStatusText(h.accountStatus) : null
  const t = h?.tokenInfo
  return (
    <div className={s.acct}>
      <div className={s.acctMain}>
        <div className={s.itemTitle}>
          {label}
          <small>{row.adAccountId}</small>
          <Badge tone={row.role === 'main' ? 'info' : row.role === 'extra' ? 'neu' : 'mut'}>
            {row.role === 'main' ? 'principal' : row.role === 'extra' ? 'extra' : 'histórica'}
          </Badge>
        </div>
        <div className={s.inline}>
          {row.role === 'historical'
            ? <Chip tone="mut" size="sm">não coletada · só histórico</Chip>
            : h && h.accountStatus !== null && h.accountStatus !== 1
              // Accounts Meta does not report as active are not collected.
              ? <Chip tone="warn" icon="alert" size="sm">não coletada: a conta não está ativa no Meta</Chip>
            : row.syncing
              ? <Chip tone="pos" icon="dot" size="sm">coletando</Chip>
              : <Chip tone="warn" icon="alert" size="sm">{row.hasToken ? 'coleta pausada' : 'sem token: não coletada'}</Chip>}
          {status && <Chip tone={status.tone === 'pos' ? 'pos' : status.tone === 'neg' ? 'neg' : status.tone === 'warn' ? 'warn' : 'mut'} icon={status.tone === 'pos' ? 'check' : status.tone === 'mut' ? undefined : 'alert'} size="sm">{status.text}</Chip>}
          {h && !h.readable && row.hasToken && <Chip tone="neg" icon="alert" size="sm">o token não lê esta conta</Chip>}
        </div>
        {h && (
          <div className={s.facts}>
            {t && (
              <span className={t.valid ? undefined : 'neg'}>
                {!t.valid ? 'Token inválido ou expirado: reconecte.'
                  : t.neverExpires ? `Token que não expira${t.type === 'SYSTEM_USER' ? ' (usuário do sistema)' : ''}.`
                  : t.expiresAt ? <>Token expira em <b>{formatDate(t.expiresAt.slice(0, 10), today)}</b>. Nada o renova sozinho: reconecte antes ou use um token de usuário do sistema.</>
                  : 'Validade do token desconhecida.'}
              </span>
            )}
            <SyncErrorsLine e={h} one="erro de coleta" many="erros de coleta" />
          </div>
        )}
        {children}
      </div>
      <div className={s.acctSide}>
        <span className={s.acctSpend}><Money value={row.spend30d} tone="none" /></span>
        <span className={s.sub}>gasto nos últimos 30 dias</span>
        {row.lastSpendDate && <span className={s.sub}>último gasto em {formatDate(row.lastSpendDate, today)}</span>}
      </div>
    </div>
  )
}

/** Link an account by typing its id and a token (a system-user token never expires). */
function LinkForm({ storeId, role, onDone, onCancel }: {
  storeId: string; role: 'main' | 'extra'; onDone: (text: string) => void; onCancel: () => void
}) {
  const [account, setAccount] = useState('')
  const [token, setToken] = useState('')
  const [nickname, setNickname] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [replace, setReplace] = useState<string | null>(null)

  async function submit(confirmReplacePermanent = false) {
    setPending(true)
    setError(null)
    const id = account.trim().replace(/^act_/i, '')
    const body = role === 'main'
      ? { storeId, fb_ad_account_id: `act_${id}`, role: 'main', token: token.trim() || undefined, confirmReplacePermanent }
      : { storeId, fb_ad_account_id: `act_${id}`, fb_access_token: token.trim(), nickname: nickname.trim() || undefined, confirmReplacePermanent }
    const r = await callApi<{ backfillFrom: string | null; warning: string | null }>(
      role === 'main' ? '/api/facebook/accounts' : '/api/facebook/extra-accounts',
      { method: 'POST', body: JSON.stringify(body) }, FACEBOOK_ERROR)
    if (!r.ok) {
      setPending(false)
      if (r.code === 'replaces_permanent_token') {
        setReplace(typeof r.extra.expiresAt === 'string' ? r.extra.expiresAt : '')
        return
      }
      setError(r.error)
      return
    }
    const backfill = r.data?.backfillFrom ? await startBackfill(storeId, r.data.backfillFrom, `act_${id}`) : null
    setPending(false)
    onDone([`Conta act_${id} ligada como ${role === 'main' ? 'principal' : 'extra'}.`, r.data?.warning, backfill].filter(Boolean).join(' '))
  }

  return (
    <div className={s.form} style={{ marginTop: 10 }}>
      <div className={s.fields}>
        <label className={s.field}>
          <span className={s.label}>ID da conta de anúncio</span>
          <input className={`${s.input} ${s.inputMono}`} value={account} placeholder="act_123456789" onChange={e => setAccount(e.target.value)} />
          <span className={s.hint}>No Gerenciador de Anúncios, na URL: …?act=<b>123456789</b>.</span>
        </label>
        <label className={s.field}>
          <span className={s.label}>Token de acesso {role === 'main' ? '(opcional)' : ''}</span>
          <input className={`${s.input} ${s.inputMono}`} type="password" autoComplete="off" value={token} placeholder="EAA…" onChange={e => setToken(e.target.value)} />
          <span className={s.hint}>De preferência um token de usuário do sistema (Business Manager), que não expira.{role === 'main' ? ' Vazio: usa um acesso que a loja já tem.' : ''}</span>
        </label>
        {role === 'extra' && (
          <label className={s.field}>
            <span className={s.label}>Apelido (opcional)</span>
            <input className={s.input} value={nickname} placeholder="ex.: conta reserva" onChange={e => setNickname(e.target.value)} />
          </label>
        )}
      </div>
      {error && <div className={s.err} role="alert">{error}</div>}
      {replace !== null && (
        <Callout tone="warn" title="Isto troca um token que não expira por um que expira">
          O token atual da loja não expira; o novo {replace ? `expira em ${replace.slice(8, 10)}/${replace.slice(5, 7)}/${replace.slice(0, 4)}` : 'expira'} e nada o
          renova sozinho. Quando vencer, a coleta do Meta para.
          <div className={s.inline} style={{ marginTop: 8 }}>
            <Button size="sm" variant="danger" pending={pending} onClick={() => submit(true)}>Trocar mesmo assim</Button>
            <Button size="sm" variant="ghost" onClick={() => setReplace(null)}>Manter o atual</Button>
          </div>
        </Callout>
      )}
      <div className={s.inline}>
        <Button size="sm" variant="primary" pending={pending} disabled={!account.trim() || (role === 'extra' && !token.trim())} onClick={() => submit(false)}>
          {role === 'main' ? 'Ligar como principal' : 'Ligar como extra'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>Cancelar</Button>
      </div>
    </div>
  )
}
