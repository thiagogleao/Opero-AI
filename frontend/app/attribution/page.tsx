import { Suspense } from 'react'
import Link from 'next/link'
import { getPageContext, pageMetadata, type SearchParams } from '@/lib/views/page'
import { AppShell, PageHeader, PeriodHeading, periodNoteText } from '@/components/shell'
import type { BandChip } from '@/lib/views/numberBand'
import { DetailPara } from '@/components/numbers'
import { Callout, EmptyState, SkeletonBlock } from '@/components/ui'
import { AttributionReportSection, JourneySection } from '@/components/attribution/AttributionSections'
import { MODEL_KEY, modelFromParam } from '@/components/attribution/model'

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
  const ctx = await getPageContext(sp, { path: '/attribution', scope: 'store' })
  const model = modelFromParam(sp[MODEL_KEY])
  const store = ctx.store

  if (!store) {
    return (
      <AppShell ctx={ctx}>
        <PageHeader ctx={ctx} title="Atribuição" sub="Nenhuma loja ligada ao seu acesso" halved={false} />
        <EmptyState icon="store" title="Nenhuma loja para mostrar">
          Quando uma loja estiver ligada à sua conta, o caminho de cada venda aparece aqui.
        </EmptyState>
      </AppShell>
    )
  }

  // Remount the streamed parts when the store, window or model changes, so
  // the skeleton shows instead of the previous store's numbers.
  const key = `${store.id}:${ctx.range.from}:${ctx.range.to}:${model}`
  // Arriving from Todas (`vem=todas`): this page reads one store at a time, so
  // say which one. The link back is an R4 link (lib/period carry): the period
  // travels as asked and Todas resolves it on its own clock, announcing the
  // other dates on landing; null for a viewer without Todas (I-16).
  const fromAll = ctx.cameFrom?.kind === 'all'
  const allStoresHref = ctx.scopeHref('/overview', { kind: 'all' })
  const periodText = periodNoteText(ctx)
  // Opened from Todas, the page shows one store: a visible chip (it is not
  // what was asked), the callout with its link in Detalhes.
  const fromAllChip: BandChip[] = fromAll ? [{
    code: 'mostrando', tone: 'neu', label: `mostrando a ${store.name}`,
    info: `A atribuição compara o Meta com a Shopify uma loja por vez. Escolha outra no seletor de loja${allStoresHref ? ', ou veja todas juntas em Todas as lojas' : ''}.`,
  }] : []
  return (
    <AppShell ctx={ctx}>
      <PageHeader
        ctx={ctx}
        sub={<><b>Atribuição</b> · <PeriodHeading ctx={ctx} /></>}
        halved={false}
        periodInfo
      />
      <Suspense key={`r:${key}`} fallback={<SkeletonBlock height={260} lines={3} />}>
        <AttributionReportSection ctx={ctx} model={model} extraChips={fromAllChip}
          extraCount={(periodText ? 1 : 0) + (fromAll && allStoresHref ? 1 : 0)}
          extraDetails={<>
            {periodText && <DetailPara>{periodText}</DetailPara>}
            {fromAll && allStoresHref && (
              <Callout tone="neu" icon="store" title={`Mostrando a ${store.name}`}>
                A atribuição compara o Meta com a Shopify uma loja por vez. Escolha outra no seletor de loja, ou
                veja todas juntas em <Link href={allStoresHref}>Todas as lojas</Link>.
              </Callout>
            )}
          </>} />
      </Suspense>
      <Suspense key={`j:${store.id}:${ctx.range.from}:${ctx.range.to}`} fallback={<SkeletonBlock height={200} lines={4} />}>
        <JourneySection ctx={ctx} />
      </Suspense>
    </AppShell>
  )
}
