/**
 * The data-loading parts of /attribution, each its own async server
 * component so the page streams them under Suspense and one failing costs
 * that part only (with a designed error state), never the whole screen.
 *
 * Server only: reads lib/attribution and the profit engine directly.
 */

import 'server-only'
import { getAttributionReport, getJourneyPage, getSharedAdAccountsForStore, type JourneyPage, type Model, type SharedAdAccount } from '@/lib/attribution'
import { computeStorePnL } from '@/lib/engine/pnl'
import { shiftDate } from '@/lib/engine/dates'
import type { PageContext } from '@/lib/views/page'
import { formatRelativeTime, tzCity } from '@/lib/format'
import { Block, ButtonLink, Card, ErrorState } from '@/components/ui'
import { AttributionHeader } from './AttributionHeader'
import { AttributionKpis } from './AttributionKpis'
import { CreativeTable } from './CreativeTable'
import { JourneyReader } from './JourneyReader'
import { MODEL_ORDER, modelParam, DEFAULT_MODEL, MODEL_KEY } from './model'
import { ModelPicker } from './ModelPicker'
import { Reconciliation } from './Reconciliation'
import { SharedAccountNote } from './SharedAccountNote'
import { SourceBars } from './SourceBars'
import { buildAttributionVerdict } from './verdict'
import { loadFirstSale } from '@/components/campaigns/firstSale'
import { loadArchivedStore } from '@/components/dashboard/archivedStore'
import { emptyWindowWords, windowWhy } from '@/components/campaigns/emptyWhy'

/** Rows in the creative table; the rest are summed into "outros". */
export const CREATIVE_LIMIT = 40
/** How far back the shared-account reminder looks when the window has none. */
const SHARED_LOOKBACK_DAYS = 90

/** This page's own URL for a model (first click is the default and stays out of the URL). */
export function modelHref(ctx: PageContext, m: Model): string {
  return ctx.hrefWith(m === DEFAULT_MODEL ? '/attribution' : `/attribution?${MODEL_KEY}=${modelParam(m)}`)
}

function storeNames(ctx: PageContext): Record<string, string> {
  const out: Record<string, string> = Object.fromEntries(ctx.stores.map(st => [st.id, st.name]))
  if (ctx.store) out[ctx.store.id] = ctx.store.name
  return out
}

export async function AttributionReportSection({ ctx, model }: { ctx: PageContext; model: Model }) {
  const store = ctx.store
  if (!store) return null
  const names = storeNames(ctx)
  const nameMap = new Map(Object.entries(names))
  const retry = <ButtonLink href={modelHref(ctx, model)} size="sm" icon="refresh">Tentar de novo</ButtonLink>

  let data
  try {
    data = await Promise.all([
      getAttributionReport(store.id, ctx.range, model, { limit: CREATIVE_LIMIT, names: nameMap }),
      computeStorePnL(store.id, ctx.range, {}, ctx.now),
      // Only shown when the window itself has no shared sales; a failure here
      // just drops the reminder.
      getSharedAdAccountsForStore(store.id, { from: shiftDate(ctx.range.to, -(SHARED_LOOKBACK_DAYS - 1)), to: ctx.range.to }, nameMap)
        .catch((e: unknown): SharedAdAccount[] => { console.error('[attribution] shared lookback', e); return [] }),
      loadFirstSale(ctx),
      loadArchivedStore(ctx),
    ])
  } catch (e) {
    console.error('[attribution] report', e)
    return (
      <Card>
        <ErrorState title="Não foi possível montar a atribuição" action={retry}>
          A comparação entre o Meta e a Shopify não chegou. Nada foi alterado; tente de novo em instantes.
        </ErrorState>
      </Card>
    )
  }
  const [report, pnl, recent, firstSale, archived] = data
  const t = report.totals
  const sales = { revenue: pnl?.totals.revenue ?? 0, orders: pnl?.totals.orders ?? 0 }
  const verdict = buildAttributionVerdict({
    storeId: store.id,
    storeName: store.name,
    periodPhrase: ctx.periodPhrase,
    rangeLabel: ctx.rangeLabel,
    model,
    partialLabel: ctx.partialLabel,
    sales,
    totals: t,
    coverage: report.coverage,
    phantom: report.phantom,
    shared: report.sharedAccounts,
    journeysAge: report.coverage.journeysUpdatedAt ? formatRelativeTime(report.coverage.journeysUpdatedAt, ctx.now) : null,
    firstSale,
    archived,
  })
  // Before the first sale or after the archive day, the blocks say why.
  const why = verdict.empty ? emptyWindowWords(verdict.empty, ctx.rangeLabel) : null
  const sharedAdStore = report.sharedAccounts.find(p => p.salesStoreId === store.id)?.adStoreName ?? null
  const hrefs = Object.fromEntries(MODEL_ORDER.map(m => [m, modelHref(ctx, m)])) as Record<Model, string>

  return (
    <>
      <AttributionHeader
        verdict={verdict}
        aside={<Reconciliation verdict={verdict} totals={t} sales={sales} shared={report.sharedAccounts} storeId={store.id} rangeLabel={ctx.rangeLabel} />}
      />
      <SharedAccountNote storeId={store.id} shared={report.sharedAccounts} recent={recent} rangeLabel={ctx.rangeLabel} />
      {(t.spend > 0.005 || t.metaRevenue > 0.005) && (
        <AttributionKpis
          totals={t}
          store={pnl?.totals ?? null}
          configured={!!pnl?.configured}
          sharedAdStore={sharedAdStore}
        />
      )}
      <ModelPicker active={model} hrefs={hrefs} />
      <CreativeTable report={report} storeId={store.id} storeName={store.name} names={names} model={model} rangeLabel={ctx.rangeLabel} now={ctx.now} why={why} />
      <SourceBars sources={report.sources} rangeLabel={ctx.rangeLabel} why={why} />
    </>
  )
}

export async function JourneySection({ ctx }: { ctx: PageContext }) {
  const store = ctx.store
  if (!store) return null
  let initial: JourneyPage | null = null
  const [page, firstSale, archived] = await Promise.all([
    getJourneyPage(store.id, ctx.range.from, ctx.range.to, { limit: 30 })
      // The reader shows its own error state and retries through the API.
      .catch((e: unknown) => { console.error('[attribution] journeys', e); return null }),
    loadFirstSale(ctx),
    loadArchivedStore(ctx),
  ])
  initial = page
  // A window before the first sale, or after the archive day, has no order
  // for that reason (the verdict's), not "A loja não teve pedidos". Orders
  // only: ad spend before the first sale does not make an order.
  const why = initial && initial.total === 0
    ? windowWhy({ range: ctx.range, rangeLabel: ctx.rangeLabel, today: ctx.today, spend: 0, firstOrderDate: firstSale?.firstOrderDate ?? null, archived })
    : null
  return (
    <Block
      title="Pedidos e seus caminhos"
      howTo={`Cada pedido de ${ctx.rangeLabel} com as visitas que a Shopify registrou antes da compra. Clique num pedido para abrir o caminho; datas e horas no horário de ${tzCity(store.timezone)}.`}
      info="Um ponto azul é a visita que veio de um anúncio do Meta identificado pelo link; âmbar, visita paga sem o anúncio no link; cinza, qualquer outra origem."
    >
      <JourneyReader
        // A new store or period is a new reader: nothing of the old list survives (A4).
        key={`${store.id}:${ctx.range.from}:${ctx.range.to}`}
        storeId={store.id}
        from={ctx.range.from}
        to={ctx.range.to}
        today={ctx.today}
        initial={initial}
        why={why ? { title: why.title, text: why.text } : null}
      />
    </Block>
  )
}
