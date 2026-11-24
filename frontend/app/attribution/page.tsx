import { Suspense } from 'react'
import Link from 'next/link'
import { ALL_STORES, getPageContext, pageMetadata, type SearchParams } from '@/lib/views/page'
import { anchorTz, resolveRange, todayInTz } from '@/lib/engine/dates'
import { AppShell, PageHeader, PeriodNote, periodName } from '@/components/shell'
import { Callout, EmptyState, SkeletonBlock } from '@/components/ui'
import { AttributionReportSection, JourneySection } from '@/components/attribution/AttributionSections'
import { MODEL_KEY, modelFromParam } from '@/components/attribution/model'
import { allStoresWindow } from '@/components/attribution/allStoresLink'

/**
 * /attribution — what Meta says it sold against what the store really sold,
 * ad by ad, and the path behind every order (Shopify's own journey record).
 *
 * One store at a time (scope 'store': "Todas" in the picker opens the
 * overview). URL state: loja/periodo/de/ate/parte through getPageContext, plus
 * ?modelo=primeiro|ultimo|dividido for the credit model.
 */

export const generateMetadata = pageMetadata('Atribuição', { scope: 'store' })
export const dynamic = 'force-dynamic'

export default async function AttributionPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const ctx = await getPageContext(sp, { scope: 'store' })
  const model = modelFromParam(sp[MODEL_KEY])
  const store = ctx.store

  if (!store) {
    return (
      <AppShell ctx={ctx}>
        <PageHeader ctx={ctx} title="Atribuição" sub="Nenhuma loja ligada ao seu acesso" />
        <EmptyState icon="store" title="Nenhuma loja para mostrar">
          Quando uma loja estiver ligada à sua conta, o caminho de cada venda aparece aqui.
        </EmptyState>
      </AppShell>
    )
  }

  // Remount the streamed parts when the store, window or model changes, so
  // the skeleton shows instead of the previous store's numbers.
  const key = `${store.id}:${ctx.range.from}:${ctx.range.to}:${model}`
  // Arriving with "Todas" (a sidebar link from an all-stores page): this page
  // reads one store at a time, so say which one instead of switching silently.
  const lojaParam = Array.isArray(sp.loja) ? sp.loja[0] : sp.loja
  const fromAll = lojaParam === ALL_STORES
  // Todas reads the period on its own clock (Brasília); Hibikura's dates travel
  // as they are, so the link opens the days on screen. parte and a custom
  // window ride along through hrefWith.
  const allTz = anchorTz(ctx.stores.map(x => x.timezone))
  const allClock = { range: resolveRange(ctx.period, allTz, null, null, ctx.now), today: todayInTz(allTz, ctx.now) }
  const allStoresHref = ctx.hrefWith('/overview', { loja: ALL_STORES, ...allStoresWindow(ctx, allClock) })
  return (
    <AppShell ctx={ctx}>
      <PageHeader
        ctx={ctx}
        sub={<><b>Atribuição</b> · {periodName(ctx)} · <span className="num">{ctx.rangeLabel}</span></>}
      />
      {fromAll && (
        <Callout tone="neu" icon="store" title={`Mostrando a ${store.name}`}>
          A atribuição compara o Meta com a Shopify uma loja por vez. Escolha outra no seletor de loja, ou
          veja todas juntas em <Link href={allStoresHref}>Todas as lojas</Link>.
        </Callout>
      )}
      <PeriodNote ctx={ctx} />
      <Suspense key={`r:${key}`} fallback={<SkeletonBlock height={260} lines={3} />}>
        <AttributionReportSection ctx={ctx} model={model} />
      </Suspense>
      <Suspense key={`j:${store.id}:${ctx.range.from}:${ctx.range.to}`} fallback={<SkeletonBlock height={200} lines={4} />}>
        <JourneySection ctx={ctx} />
      </Suspense>
    </AppShell>
  )
}
