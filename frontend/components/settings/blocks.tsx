import 'server-only'

/**
 * The blocks of Ajustes (/settings). Server components: each reads what it
 * shows (lib/integrations) and the slow ones — the live checks against Shopify
 * and Meta — stream in their own Suspense boundary.
 */

import type { ReactNode } from 'react'
import { listStores, type StoreRef, type Viewer } from '@/lib/access'
import { formatDate, formatRelativeTime, formatTimeInTz, tzCity } from '@/lib/format'
import { shiftDate, todayInTz } from '@/lib/engine/dates'
import { listStoreAdAccounts } from '@/lib/integrations/adAccounts'
import { facebookHealth, shopifyHealth } from '@/lib/integrations/health'
import { loadStoreSummaries, storeSummary } from '@/lib/integrations/stores'
import type { StoreShopifyHealth, SyncStatus } from '@/lib/integrations/types'
import { Block, Callout, Chip, ErrorState, Icon } from '@/components/ui'
import { AdAccounts, type AccountRow } from './AdAccounts'
import { AnchorButton } from './AnchorButton'
import { facebookErrorText, shopifyErrorText } from './messages'
import { SyncErrorsLine } from './SyncErrorsLine'
import { StoresList } from './StoresList'
import { storeDay } from './storeDay'
import { ButtonLink } from '@/components/ui'
import s from './settings.module.css'

// ─── Banners after an OAuth round trip ────────────────────────────────────────

/** What the Shopify / Facebook flows reported when they came back here. */
export function ReturnBanner({ params }: { params: Record<string, string | undefined> }) {
  const out: ReactNode[] = []
  if (params.shopify_connected === 'true') {
    out.push(<Callout key="sc" tone="info" icon="check" title="Shopify reconectada">A Shopify confirmou o acesso e a chave nova foi gravada.</Callout>)
  }
  if (params.shopify_error) {
    out.push(<Callout key="se" tone="neg" title="A Shopify não foi conectada">{shopifyErrorText(params.shopify_error)} Nada foi alterado.</Callout>)
  }
  if (params.fb_connected === 'true' || params.fb_extra_connected === 'true') {
    out.push(
      <Callout key="fc" tone="info" icon="check" title="Conta de anúncio ligada">
        O Facebook confirmou o acesso e a conta foi gravada. O histórico dela é buscado pela sincronização; confira a saúde abaixo.
      </Callout>,
    )
  }
  if (params.fb_error) {
    out.push(<Callout key="fe" tone="neg" title="O Facebook não foi conectado">{facebookErrorText(params.fb_error)} Nada foi alterado.</Callout>)
  }
  return out.length ? <>{out}</> : null
}

// ─── Modo dono ────────────────────────────────────────────────────────────────

export function OwnerModeBlock() {
  return (
    <Block
      id="modo-dono"
      title="Modo dono"
      howTo="Este navegador foi liberado pelo link do celular: você vê e configura todas as lojas ativas, sem login de sócio."
    >
      <ul className={s.ol}>
        <li>Os <b>sócios</b> entram com a própria conta e veem só as lojas dela. Eles podem configurar custos, contas de anúncio, reconectar a Shopify e arquivar as próprias lojas.</li>
        <li><b>“Minha parte 50%”</b>, no topo, divide por dois só os valores em dinheiro (lucro, lucro por pedido, resultado de caixa); margens e ROAS não mudam.</li>
        <li>Os <b>alertas no celular</b> são ajustados no app do celular, em <span className={s.code}>/m</span>.</li>
        <li>Para tirar o modo dono deste navegador, use <b>sair</b> no canto superior direito. Para adicionar uma loja nova, entre também com a conta de sócio que vai ser dona dela.</li>
      </ul>
    </Block>
  )
}

// ─── Loja ─────────────────────────────────────────────────────────────────────

export async function StoreInfoBlock({ store, today }: { store: StoreRef; today: string }) {
  let sum
  try {
    sum = await storeSummary(store)
  } catch {
    return <Block id="loja" title="Loja"><ErrorState compact>Os dados da loja não carregaram. Nada foi alterado.</ErrorState></Block>
  }
  return (
    <Block id="loja" title="Loja" howTo="Dados que vêm da Shopify. O fuso define onde cada dia começa e termina em todas as telas.">
      <dl className={s.dl}>
        <dt>Nome</dt><dd>{sum.name}{sum.shopName !== sum.name && <small>na Shopify: {sum.shopName}</small>}</dd>
        <dt>Domínio</dt><dd><span className={s.mono}>{sum.domain ?? '—'}</span></dd>
        <dt>Fuso horário</dt>
        <dd>
          <span>{tzCity(sum.timezone)} <span className={s.mono}>({sum.timezone})</span></span>
          <small>Vem da Shopify e é atualizado a cada sincronização; não dá para mudar aqui. Para mudar, altere o fuso no admin da Shopify.</small>
        </dd>
        <dt>Moeda da loja</dt>
        <dd>
          <span>{sum.currency ?? '—'}</span>
          <small>{sum.currency && sum.currency !== 'USD' ? 'Os pedidos chegam convertidos: o Opero mostra tudo em US$.' : 'O Opero mostra tudo em US$.'}</small>
        </dd>
        <dt>No Opero desde</dt><dd>{formatDate(storeDay(sum.createdAt, sum.timezone), today)}</dd>
        <dt>Situação</dt>
        <dd>
          <span className={s.inline}>
            {sum.archived ? <Chip tone="mut" size="sm">arquivada</Chip> : <Chip tone="pos" icon="check" size="sm">ativa</Chip>}
          </span>
          {sum.archived && <small>Fora de “Todas as lojas”, dos seletores e da sincronização. Desarquive em Lojas, abaixo.</small>}
        </dd>
      </dl>
    </Block>
  )
}

// ─── Shopify ──────────────────────────────────────────────────────────────────

const SHOPIFY_STATUS: Record<StoreShopifyHealth['status'], { tone: 'pos' | 'neg' | 'warn'; text: string }> = {
  ok: { tone: 'pos', text: 'funcionando' },
  invalid: { tone: 'neg', text: 'chave recusada pela Shopify' },
  expired: { tone: 'neg', text: 'token de 24 h vencido' },
  missing: { tone: 'neg', text: 'sem chave' },
  error: { tone: 'warn', text: 'a Shopify respondeu com erro' },
  unreachable: { tone: 'warn', text: 'a Shopify não respondeu' },
}

function syncLine(sync: SyncStatus | null, now: Date, what: string): ReactNode {
  if (!sync) return <span>Nenhuma coleta de {what} nos últimos 7 dias.</span>
  const ok = sync.status === 'success'
  return (
    <>
      <span className={ok ? undefined : 'neg'}>
        Última coleta de {what}: <b>{ok ? 'sucesso' : sync.status === 'running' ? 'em andamento' : 'erro'}</b> {formatRelativeTime(sync.at, now)}
        {!ok && sync.lastSuccessAt ? ` · último sucesso ${formatRelativeTime(sync.lastSuccessAt, now)}` : ''}
        {!ok && !sync.lastSuccessAt ? ' · nenhum sucesso em 7 dias' : ''}
      </span>
      <SyncErrorsLine e={sync} one="erro" many="erros" />
    </>
  )
}

/** "hoje às 10h41" / "amanhã às 02h03" (Brasília): a 24 h token's expiry
 *  read as a bare hour is ambiguous between today and tomorrow. */
function brasiliaWhen(at: string, now: Date): string {
  const tz = 'America/Sao_Paulo'
  const day = todayInTz(tz, new Date(at))
  const today = todayInTz(tz, now)
  const label = day === today ? 'hoje' : day === shiftDate(today, 1) ? 'amanhã' : day === shiftDate(today, -1) ? 'ontem' : formatDate(day, today)
  return `${label} às ${formatTimeInTz(at, tz)}`
}

/** One store's Shopify connection: type, live check, last collection, the fix.
 *  `returnTo`: the page the reauthorization comes back to, with its URL state
 *  (/settings or /settings/chaves; the auth route keeps only the period). */
export function ShopifyHealthItem({ h, now, settingsKeysHref, returnTo }: {
  h: StoreShopifyHealth; now: Date; settingsKeysHref: string | null; returnTo: string
}) {
  const st = SHOPIFY_STATUS[h.status]
  const reauth = `/api/shopify/auth?store=${encodeURIComponent(h.id)}&mode=reconnect&return=${encodeURIComponent(returnTo)}`
  return (
    <div className={s.facts}>
      <div className={s.inline}>
        <Chip tone={st.tone} icon={st.tone === 'pos' ? 'check' : 'alert'} size="sm">{st.text}{h.status === 'error' && h.httpStatus ? ` (HTTP ${h.httpStatus})` : ''}</Chip>
        {h.connection === 'dev_dashboard' && <Chip tone="info" size="sm">app do Dev Dashboard</Chip>}
        {h.connection === 'token' && <Chip tone="neu" size="sm">token fixo</Chip>}
      </div>
      <span className={s.fact}>
        <Icon name="lock" size={13} />
        <span>
          {h.connection === 'dev_dashboard'
            ? <>Conectada por <b>Client ID + Client Secret</b> (app do Dev Dashboard). O token dura 24 h e o coletor gera outro sozinho com esse par{h.tokenExpiresAt ? <> — o atual vence <b>{brasiliaWhen(h.tokenExpiresAt, now)}</b> (Brasília)</> : null}. Se o app for recriado, o par muda e precisa ser atualizado aqui.</>
            : h.connection === 'token'
              ? <>Conectada por um <b>token fixo</b> do app. Ele não expira, mas para de funcionar se o app for reinstalado ou a chave revogada.</>
              : <>Sem conexão com a Shopify: nenhum pedido novo entra.</>}
          {h.fingerprint && <> Impressão da chave: <span className={s.mono}>{h.fingerprint}</span>.</>}
        </span>
      </span>
      {h.status === 'invalid' && <span className="neg">A Shopify respondeu 401: a chave foi revogada (app reinstalado, escopos mudados ou credenciais trocadas). Reconecte.</span>}
      {h.status === 'expired' && <span className="neg">O token de 24 h venceu e o coletor não conseguiu gerar outro: o Client ID/Secret guardado provavelmente é de um app que foi recriado. Atualize o par.</span>}
      {h.status === 'error' && h.httpStatus === 402 && <span className={s.warnText}><Icon name="alert" size={12} /><span>HTTP 402: a loja está suspensa ou sem plano na Shopify.</span></span>}
      {h.status === 'ok' && h.missingScopes.length > 0 && (
        <span className={s.warnText}><Icon name="alert" size={12} /><span>Funciona, mas sem permissão para: {h.missingScopes.map(m => m.why).join(', ')} ({h.missingScopes.map(m => m.handle).join(', ')}).{h.connection === 'dev_dashboard' ? ' Marque a permissão no app do Dev Dashboard, reinstale o app na loja e teste de novo aqui.' : ' As permissões ficam congeladas no token: é preciso reautorizar.'}</span></span>
      )}
      <span className={s.fact}><Icon name="refresh" size={13} /><span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{syncLine(h.lastSync, now, 'pedidos')}</span></span>
      {!h.archived && (
        <div className={s.actions} style={{ marginTop: 4 }}>
          {h.connection === 'dev_dashboard' ? (
            settingsKeysHref && <ButtonLink href={settingsKeysHref} size="sm" icon="lock">Atualizar Client ID e Secret</ButtonLink>
          ) : (
            <>
              <AnchorButton href={reauth} icon="refresh">Reautorizar pelo app Opero</AnchorButton>
              {settingsKeysHref && <ButtonLink href={settingsKeysHref} size="sm" variant="ghost" icon="lock">Colar outra chave</ButtonLink>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export async function ShopifyBlock({ store, keysHref, returnTo, now }: { store: StoreRef; keysHref: string; returnTo: string; now: Date }) {
  let h: StoreShopifyHealth | undefined
  try {
    ;[h] = await shopifyHealth([store])
  } catch (err) {
    console.error('[ajustes] shopify health', err instanceof Error ? err.message : err)
  }
  return (
    <Block
      id="integracoes"
      title="Shopify"
      howTo="Testada agora, com a chave guardada: diz se os pedidos continuam entrando e o que fazer quando não."
      info="O teste lê a loja na Shopify com a chave guardada (só leitura) e junta com o que o coletor registrou nas últimas coletas."
    >
      {h ? <ShopifyHealthItem h={h} now={now} settingsKeysHref={keysHref} returnTo={returnTo} /> : (
        <ErrorState compact title="O teste da Shopify não respondeu">Nada foi alterado. Recarregue a página para testar de novo.</ErrorState>
      )}
    </Block>
  )
}

// ─── Facebook / Meta ──────────────────────────────────────────────────────────

export async function FacebookBlock({ store, today, now, returnTo }: { store: StoreRef; today: string; now: Date; returnTo: string }) {
  const [accountsRes, healthRes] = await Promise.allSettled([listStoreAdAccounts(store.id), facebookHealth(store)])
  if (accountsRes.status === 'rejected') {
    console.error('[ajustes] ad accounts', accountsRes.reason)
    return <Block id="contas" title="Contas de anúncio (Meta)"><ErrorState compact>A lista de contas não carregou. Nada foi alterado.</ErrorState></Block>
  }
  const health = healthRes.status === 'fulfilled' ? healthRes.value : null
  if (healthRes.status === 'rejected') console.error('[ajustes] facebook health', healthRes.reason)
  const rows: AccountRow[] = accountsRes.value.map(a => ({
    ...a,
    health: health?.accounts.find(h => h.adAccountId === a.adAccountId && h.role === (a.role === 'historical' ? 'extra' : a.role)) ?? null,
  }))
  return (
    <Block
      id="contas"
      title="Contas de anúncio (Meta)"
      howTo="Cada conta que traz gasto para esta loja, com a saúde dela agora e o gasto dos últimos 30 dias."
      info="Pausar uma conta extra só para a coleta: o gasto já registrado continua no lucro em todos os períodos. O gasto dos 30 dias é o que está no banco para esta loja (30 dias fechados até ontem, no fuso da loja)."
      footer={health ? <><span>Verificado {formatRelativeTime(health.checkedAt, now)}</span><span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>{syncLine(health.lastSync, now, 'anúncios')}</span></> : undefined}
    >
      <AdAccounts
        key={store.id}
        storeId={store.id}
        storeName={store.name}
        timezone={store.timezone}
        returnTo={returnTo}
        archived={store.archived}
        today={today}
        accounts={rows}
        healthError={healthRes.status === 'rejected' ? 'O Meta não respondeu ao teste das contas.' : null}
      />
    </Block>
  )
}

// ─── Lojas ────────────────────────────────────────────────────────────────────

export async function StoresBlock({ viewer, currentId, today, hrefFor, addHref }: {
  viewer: Viewer; currentId: string | null; today: string; hrefFor: (id: string) => string; addHref: string
}) {
  let items
  try {
    const refs = await listStores(viewer, { includeArchived: true })
    const sums = await loadStoreSummaries(refs)
    items = sums.map(sm => ({
      id: sm.id, name: sm.name, domain: sm.domain, city: tzCity(sm.timezone),
      // The archive instant as a calendar date in the store's own timezone:
      // the UTC date is already "tomorrow" after 21h in Brazil.
      archived: sm.archived, archivedOn: sm.archivedAt ? storeDay(sm.archivedAt, sm.timezone) : null,
      current: sm.id === currentId,
      shopifyConnected: sm.shopify.connected, facebookConnected: !!sm.facebook.mainAdAccountId || sm.facebook.activeExtraAccounts > 0,
      href: hrefFor(sm.id),
    }))
  } catch (err) {
    console.error('[ajustes] stores', err instanceof Error ? err.message : err)
    return <Block id="lojas" title="Lojas"><ErrorState compact>A lista de lojas não carregou. Nada foi alterado.</ErrorState></Block>
  }
  return (
    <Block
      id="lojas"
      title="Lojas"
      howTo={viewer.kind === 'owner' ? 'Todas as lojas do Opero. Arquivar tira a loja das somas e da sincronização sem apagar nada.' : 'As lojas da sua conta. Arquivar tira a loja das somas e da sincronização sem apagar nada.'}
    >
      <StoresList stores={items} today={today} addHref={addHref} />
    </Block>
  )
}
