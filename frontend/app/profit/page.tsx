/**
 * Custos (/profit) — a store's cost settings, with a live preview of what they
 * do to the profit of the window chosen at the top, before saving.
 *
 * Server page: the store and the window come from the URL (getPageContext,
 * one store), the saved settings, the catalogue and the saved settings' P&L
 * are read here once; the editor (client) only previews drafts and saves.
 * An archived store opens read-only (consultation only): the editor shows the
 * saved settings and their preview, with one line saying why nothing can change.
 */

import { Suspense } from 'react'
import { getPageContext, type PageContext, type SearchParams } from '@/lib/views/page'
import { AppShell, PageHeader } from '@/components/shell'
import { Callout, EmptyState, ErrorState, SkeletonBlock } from '@/components/ui'
import { CostsEditor } from '@/components/costs/CostsEditor'
import { loadCatalogue, loadCurrency, loadSavedCosts, loadSavedPreview } from '@/components/costs/load'
import { loadFirstSale } from '@/components/campaigns/firstSale'
import { loadArchivedStore } from '@/components/dashboard/archivedStore'
import { emptyPreviewWhy } from '@/components/costs/emptyPreview'
import s from '@/components/costs/costs.module.css'
import { storePageMetadata } from '@/components/settings/pageMetadata'

export const dynamic = 'force-dynamic'
export const generateMetadata = storePageMetadata('Custos')

/** The domain code pill, unless the name already ends with it ("Dumpling Squishy · 8jcp3a"). */
function pillCode(store: { name: string; domain: string | null } | null): string | null {
  const code = store?.domain ? store.domain.split('.')[0].split('-')[0] : null
  return code && !store!.name.endsWith(code) ? code : null
}

export default async function CostsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const ctx = await getPageContext(sp, { scope: 'store' })
  const store = ctx.store
  // Arrived from "Todas as lojas": costs are per store, so say which one opened.
  const askedAll = (Array.isArray(sp.loja) ? sp.loja[0] : sp.loja) === 'todas'

  return (
    <AppShell ctx={ctx}>
      <PageHeader
        ctx={ctx}
        code={pillCode(store)}
        title={store ? `Custos · ${store.name}` : 'Custos'}
        sub={store
          // A custom window's label already is its range: say it once.
          ? <>Valem para todas as telas · prévia em {ctx.periodLabel === ctx.rangeLabel
              ? <b className="num">{ctx.rangeLabel}</b>
              : <><b>{ctx.periodLabel}</b> · <span className="num">{ctx.rangeLabel}</span></>}</>
          : undefined}
      />
      {askedAll && store && (
        <Callout tone="info" title={`Custos são de uma loja por vez: esta é a ${store.name}`}>
          Para outra loja, troque no seletor de loja do menu.
        </Callout>
      )}
      {!store ? (
        <EmptyState icon="store" title="Nenhuma loja">
          Conecte uma loja Shopify em Ajustes para configurar os custos dela.
        </EmptyState>
      ) : (
        <Suspense key={store.id} fallback={<EditorSkeleton />}>
          <Editor ctx={ctx} />
        </Suspense>
      )}
    </AppShell>
  )
}

function EditorSkeleton() {
  return (
    <div className={s.layout}>
      <div className={s.main}><SkeletonBlock lines={4} height={120} /><SkeletonBlock lines={6} height={220} /></div>
      <div className={s.aside}><SkeletonBlock lines={5} height={180} /></div>
    </div>
  )
}

async function Editor({ ctx }: { ctx: PageContext }) {
  const store = ctx.store!
  let saved, catalogue, currency, firstSale, archivedStore
  try {
    // loadFirstSale and loadArchivedStore never throw (a failed read is null:
    // the plain wording, or "arquivada" without its day).
    ;[saved, catalogue, currency, firstSale, archivedStore] = await Promise.all([
      loadSavedCosts(store.id), loadCatalogue(store.id), loadCurrency(store), loadFirstSale(ctx), loadArchivedStore(ctx),
    ])
  } catch (err) {
    console.error('[custos] load', err instanceof Error ? err.message : err)
    return (
      <ErrorState title="Não foi possível carregar os custos desta loja">
        Nada foi alterado. Recarregue a página em instantes; enquanto a configuração não carregar, salvar fica
        indisponível (uma tela vazia nunca é gravada por cima dos custos).
      </ErrorState>
    )
  }

  // The preview failing must not block editing: the editor shows the error and
  // can retry, and previews of drafts go through POST /api/profit.
  let preview = null
  let previewError: string | null = null
  try {
    preview = await loadSavedPreview(store, ctx.period, ctx.range, saved)
  } catch (err) {
    console.error('[custos] preview', err instanceof Error ? err.message : err)
    previewError = 'O cálculo do período não respondeu. A configuração pode ser editada e salva normalmente.'
  }

  return (
    <CostsEditor
      key={store.id}
      store={{ id: store.id, name: store.name, timezone: store.timezone, archived: store.archived, currency }}
      window={{
        period: ctx.period, from: ctx.range.from, to: ctx.range.to, periodLabel: ctx.periodLabel, partialLabel: ctx.partialLabel,
        // A window that ends before the first sale (Hibikura 25 out – 5 nov,
        // first sale 7 nov) or starts after an archived store's archive day
        // (Squishy World 17–23 nov, archived 10 nov): no longer window ending
        // there has data either, so the empty preview names the date, as the
        // other pages do.
        emptyWhy: emptyPreviewWhy({
          range: ctx.range, today: ctx.today,
          firstSale: firstSale?.firstOrderDate ?? null,
          archived: store.archived, archivedOn: archivedStore?.archivedOn ?? null,
        }),
      }}
      today={ctx.today}
      saved={saved}
      initialPreview={preview}
      initialPreviewError={previewError}
      catalogue={catalogue}
      split={ctx.split}
      restoreHref={ctx.hrefWith('/settings#lojas')}
    />
  )
}
