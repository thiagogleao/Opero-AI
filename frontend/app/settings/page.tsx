/**
 * Ajustes (/settings) — one store's connections and the viewer's stores.
 *
 *  - Loja: name, domain, timezone (read-only: it comes from Shopify and the
 *    collector rewrites it on every sync — A8), currency.
 *  - Shopify: connection type and a live check (token health, the 24h Dev
 *    Dashboard token), last collection, the fix (signed OAuth or keys page).
 *  - Contas de anúncio: main + extras + históricas with live health per
 *    account; pause / rename / unlink / link, all confirmed by the server.
 *  - Lojas: archive / restore with a confirmation that says what it means.
 *  - Modo dono: for the owner's unlocked browser.
 *
 * The old page's controls that did nothing (theme, language, currency,
 * date format, attribution window, goals, desktop alert toggles — L9) are
 * gone: US dollars and Portuguese only, alerts live on the phone.
 */

import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getPageContext, type SearchParams } from '@/lib/views/page'
import { AppShell, PageHeader } from '@/components/shell'
import { Callout, EmptyState, SkeletonBlock } from '@/components/ui'
import {
  FacebookBlock, OwnerModeBlock, ReturnBanner, ShopifyBlock, StoreInfoBlock, StoresBlock,
} from '@/components/settings/blocks'
import { AnchorButton } from '@/components/settings/AnchorButton'
import s from '@/components/settings/settings.module.css'

export const dynamic = 'force-dynamic'

/** The domain code pill, unless the name already ends with it ("Dumpling Squishy · 8jcp3a"). */
function pillCode(store: { name: string; domain: string | null } | null): string | null {
  const code = store?.domain ? store.domain.split('.')[0].split('-')[0] : null
  return code && !store!.name.endsWith(code) ? code : null
}

const FLAG_KEYS = ['shopify_connected', 'shopify_error', 'fb_connected', 'fb_extra_connected', 'fb_error'] as const

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function SettingsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  // The OAuth callbacks come back with ?store=<id>; the site's key is ?loja.
  // Rewrite once so the page, the shell and every link agree on the store.
  const back = one(sp.store)
  if (back && !one(sp.loja)) {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(sp)) if (k !== 'store' && typeof one(v) === 'string') q.set(k, one(v)!)
    q.set('loja', back)
    redirect(`/settings?${q}`)
  }

  const ctx = await getPageContext(sp, { scope: 'store' })
  const store = ctx.store
  const flags = Object.fromEntries(FLAG_KEYS.map(k => [k, one(sp[k])]))

  return (
    <AppShell ctx={ctx}>
      <PageHeader
        ctx={ctx}
        code={pillCode(store)}
        title={store ? `Ajustes · ${store.name}` : 'Ajustes'}
        sub="Loja, Shopify, contas de anúncio e lojas da conta"
      />
      <ReturnBanner params={flags} />
      {one(sp.loja) === 'todas' && store && (
        <Callout tone="info" title={`Ajustes são de uma loja por vez: esta é a ${store.name}`}>
          Para outra loja, troque no seletor de loja do menu ou abra pela lista em Lojas, abaixo.
        </Callout>
      )}
      {!store ? (
        <>
          <EmptyState icon="store" title="Nenhuma loja ainda" action={<AnchorButton href="/onboarding" variant="primary" icon="store">Conectar uma loja</AnchorButton>}>
            Conecte a primeira loja Shopify para ver vendas, anúncios e lucro.
          </EmptyState>
          {ctx.isOwner && <OwnerModeBlock />}
        </>
      ) : (
        <>
          <nav className={s.toc} aria-label="Seções de ajustes">
            <a href="#loja">Loja</a>
            <a href="#integracoes">Shopify</a>
            <a href="#contas">Contas de anúncio</a>
            <a href="#lojas">Lojas</a>
            {ctx.isOwner && <a href="#modo-dono">Modo dono</a>}
          </nav>
          {/* Keyed by store: switching stores must not keep the previous
              store's live checks on screen, nor the client state of its
              blocks (a "coleta pausada" message about another store's
              account, an open link form). */}
          <div className={s.grid2}>
            <Suspense key={`info-${store.id}`} fallback={<SkeletonBlock lines={5} height={60} />}>
              <StoreInfoBlock store={store} today={ctx.today} />
            </Suspense>
            <Suspense key={`shopify-${store.id}`} fallback={<SkeletonBlock lines={4} height={80} />}>
              <ShopifyBlock store={store} keysHref={ctx.hrefWith('/settings/chaves')} now={ctx.now} />
            </Suspense>
          </div>
          <Suspense key={`fb-${store.id}`} fallback={<SkeletonBlock lines={6} height={120} />}>
            <FacebookBlock store={store} today={ctx.today} now={ctx.now} />
          </Suspense>
          <Suspense key={`stores-${store.id}`} fallback={<SkeletonBlock lines={4} height={80} />}>
            <StoresBlock
              viewer={ctx.viewer}
              currentId={store.id}
              hrefFor={id => ctx.hrefWith('/settings', { loja: id })}
              addHref="/onboarding?addStore=true"
            />
          </Suspense>
          {ctx.isOwner && <OwnerModeBlock />}
        </>
      )}
    </AppShell>
  )
}
