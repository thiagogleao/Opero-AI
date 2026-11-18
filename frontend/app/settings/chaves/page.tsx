/**
 * Ajustes → Chaves da Shopify (/settings/chaves): every store's Shopify
 * connection, tested live, with the right way to fix each one.
 *
 * Fixes from the audit: the Client Secret no longer travels in a URL (POST
 * /api/shopify/connect), a Dev Dashboard store reconnects with Client ID +
 * Secret (its token lasts 24 h and is re-minted by the collector — a pasted
 * token would die within a day), statuses "expired" and "unreachable" have
 * words, and only a fingerprint of the stored key is shown.
 */

import { Suspense } from 'react'
import { listStores, type StoreRef } from '@/lib/access'
import { shopifyHealth } from '@/lib/integrations/health'
import { getPageContext, type SearchParams } from '@/lib/views/page'
import { AppShell, PageHeader } from '@/components/shell'
import { Block, ButtonLink, EmptyState, ErrorState, SkeletonBlock } from '@/components/ui'
import { ReturnBanner, ShopifyHealthItem } from '@/components/settings/blocks'
import { ShopifyKeyForm } from '@/components/settings/ShopifyKeyForm'
import s from '@/components/settings/settings.module.css'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function KeysPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  // The Shopify callback comes back with ?store=<id> (the store just reconnected).
  const ctx = await getPageContext({ ...sp, loja: one(sp.loja) ?? one(sp.store) }, { scope: 'store' })
  const flags = { shopify_connected: one(sp.shopify_connected), shopify_error: one(sp.shopify_error) }

  return (
    <AppShell ctx={ctx}>
      <PageHeader
        ctx={ctx}
        title="Chaves da Shopify"
        code={null}
        sub="Cada chave é testada agora na Shopify, não só conferida no banco"
        actions={<ButtonLink href={ctx.hrefWith('/settings')} size="sm" variant="ghost">Voltar para Ajustes</ButtonLink>}
      />
      <ReturnBanner params={flags} />
      {ctx.stores.length === 0 && !ctx.store ? (
        <EmptyState icon="store" title="Nenhuma loja">Conecte uma loja em Ajustes.</EmptyState>
      ) : (
        <Suspense fallback={<SkeletonBlock lines={6} height={160} />}>
          <KeysList viewer={ctx.viewer} currentId={ctx.store?.id ?? null} now={ctx.now} />
        </Suspense>
      )}
      <HowTo />
    </AppShell>
  )
}

async function KeysList({ viewer, currentId, now }: { viewer: Parameters<typeof listStores>[0]; currentId: string | null; now: Date }) {
  let stores: StoreRef[]
  let health
  try {
    const all = await listStores(viewer, { includeArchived: true })
    // Active stores, plus the store open in the shell if it is archived.
    stores = all.filter(st => !st.archived || st.id === currentId)
    stores.sort((a, b) => Number(b.id === currentId) - Number(a.id === currentId))
    health = await shopifyHealth(stores)
  } catch (err) {
    console.error('[chaves] health', err instanceof Error ? err.message : err)
    return <ErrorState title="O teste das chaves não respondeu">Nada foi alterado. Recarregue a página para testar de novo.</ErrorState>
  }
  const broken = health.filter(h => h.status === 'invalid' || h.status === 'missing' || h.status === 'expired')
  return (
    <>
      {broken.length > 0 && (
        <div role="note" className={s.sub}>
          <b className="neg">{broken.length === 1 ? '1 loja não está coletando pedidos' : `${broken.length} lojas não estão coletando pedidos`}:</b>{' '}
          {broken.map(b => b.name).join(', ')}. Os pedidos novos delas não entram até a chave ser trocada.
        </div>
      )}
      {stores.map(st => {
        const h = health.find(x => x.id === st.id)
        if (!h) return null
        return (
          <Block key={st.id} title={st.name} eyebrow={st.id === currentId ? 'Loja aberta' : undefined} howTo={<span className={s.mono}>{st.domain ?? 'sem domínio'}</span>}>
            <div className={s.stack}>
              <ShopifyHealthItem h={h} now={now} settingsKeysHref={null} returnTo="/settings/chaves" />
              <ShopifyKeyForm storeId={st.id} storeName={st.name} domain={st.domain} connection={h.connection} archived={st.archived} />
            </div>
          </Block>
        )
      })}
    </>
  )
}

function HowTo() {
  return (
    <div className={s.grid2}>
      <Block title="Onde pegar o Client ID e o Secret (app do Dev Dashboard)" howTo="O jeito atual de criar um app da Shopify. O token dura 24 h; o Opero renova sozinho com o par.">
        <ol className={s.ol}>
          <li>Entre no <b>Dev Dashboard</b> da Shopify (dev.shopify.com) com a conta dona do app.</li>
          <li>Abra o app instalado nesta loja (ou crie um e instale na loja com as permissões de leitura de pedidos, produtos e disputas).</li>
          <li>Na página de credenciais do app, copie o <b>Client ID</b> e o <b>Client secret</b> (começa com <code>shpss_</code>).</li>
          <li>Cole os dois na loja correspondente acima e clique em <b>Testar e salvar</b>.</li>
        </ol>
        <p className={s.sub} style={{ marginTop: 10 }}>Se a coleta parar de novo, o mais provável é que o app tenha sido recriado: o par antigo deixa de valer e precisa ser trocado aqui.</p>
      </Block>
      <Block title="Onde pegar o token (app próprio da loja)" howTo="Apps antigos criados no admin da loja. O token não expira; para se o app for reinstalado.">
        <ol className={s.ol}>
          <li>No admin da loja: <b>Configurações → Apps e canais de venda → Desenvolver apps</b>.</li>
          <li>Abra o app do Opero e confira as permissões de leitura (<code>read_orders</code>, <code>read_products</code>, <code>read_shopify_payments_disputes</code>).</li>
          <li>Em <b>Credenciais da API</b>, copie o <b>Admin API access token</b> (<code>shpat_</code>). Ele só aparece uma vez; se ninguém copiou, reinstale o app.</li>
          <li>Cole na loja correspondente, na opção “Token do app”.</li>
        </ol>
        <p className={s.sub} style={{ marginTop: 10 }}>Permissões ficam congeladas no token: marcar uma permissão nova não muda um token que já existe. Reinstale o app ou use “Reautorizar pelo app Opero”.</p>
      </Block>
    </div>
  )
}
