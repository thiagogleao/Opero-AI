/**
 * Resumo (/) — one store, one period, numbers first: the band of six numbers
 * (lucro, margem, receita, pedidos, anúncios, ROAS × empate, each with its ▲▼)
 * and a one-row status line right under the header; "Detalhes do período"
 * (closed) holds the sentences; then the daily profit chart, where each dollar
 * went beside the per-day and per-order numbers, the biggest campaigns, top
 * products and countries, refunds and the AI's reading.
 *
 * Data: lib/views/store loadStoreSummary — ONE engine pass over the window
 * (daily, hourly, products, countries) plus the comparison, assembled like the
 * portfolio so this verdict is the one the phone and the overview show. The
 * band is presentation only (lib/views/numberBand reads the verdict). Slow
 * or secondary blocks (context days, campaigns, 90-day chargebacks, AI) stream
 * in <Suspense>, each with its own error state: one failing block never blanks
 * the page or sends anyone to onboarding.
 *
 * Store and period come only from the URL via getPageContext (scope 'store':
 * "Todas" lives at /overview).
 */

import { Suspense } from 'react'
import Link from 'next/link'
import { getPageContext, pageMetadata, type PageContext, type SearchParams } from '@/lib/views/page'
import type { StoreRef } from '@/lib/access'
import { loadStoreSummary, type StoreSummary } from '@/lib/views/store'
import { buildVerdict, verdictInputFromPortfolio } from '@/lib/views/verdict'
import { buildNumberBand, type BandChip, type BandTileKey } from '@/lib/views/numberBand'
import { AppShell, PageHeader, periodName, periodNoteText } from '@/components/shell'
import { BreakdownLedger, ButtonLink, Callout, Card, Chip, EmptyState, ErrorState, SkeletonBlock } from '@/components/ui'
import { DetailPara, NumberBandView, PeriodDetails } from '@/components/numbers'
import { InsightsSlot } from '@/components/ai/InsightsSlot'
import { BlockBoundary } from '@/components/dashboard/BlockBoundary'
import { StoreKpis } from '@/components/dashboard/StoreKpis'
import { ProfitChartBlock } from '@/components/dashboard/ProfitChartBlock'
import { CampaignsBlock } from '@/components/dashboard/CampaignsBlock'
import { TopCountries, TopProducts } from '@/components/dashboard/TopLists'
import { RefundsBlock } from '@/components/dashboard/RefundsBlock'
import { SharedAccountNote } from '@/components/dashboard/SharedAccountNote'
import { QuietStoreNote } from '@/components/dashboard/QuietStoreNote'
import { emptyWindowOf, frozenTailOf } from '@/components/dashboard/emptyWindow'
import s from '@/components/dashboard/dashboard.module.css'
import { rangeBeside } from '@/lib/period'

// Absolute: the root layout's "%s · Opero" template only reaches child
// segments, and this page sits in the layout's own segment (the tab read
// "Resumo" while every other page read "… · Opero"). generateMetadata, not a
// static title: it 404s on a ?loja the viewer cannot see, so that tab reads
// "Página não encontrada · Opero" over the not-found card instead of "Resumo".
export const generateMetadata = pageMetadata({ absolute: 'Resumo · Opero' }, { scope: 'store' })

/** The code pill, unless the store's name already carries it ("Dumpling
 *  Squishy · 8jcp3a" read "… 8jcp3a 8jcp3a"). */
function headerCode(ctx: PageContext, store: StoreRef): string | null | undefined {
  const code = ctx.storeOption?.code
  return code && store.name.endsWith(code) ? null : undefined
}

/** For a custom window the default sub line repeated the range ("1–12 nov ·
 *  1–12 nov"): name it once. */
function customSub(ctx: PageContext) {
  if (ctx.selection.period.kind !== 'dates') return undefined
  return <b>{periodName(ctx)}</b>
}
export const dynamic = 'force-dynamic'

/**
 * Opened from Todas (`vem=todas`: a sidebar link from an all-stores page, an
 * old ?loja=todas link redirected to the remembered store): this page reads
 * one store at a time, so say which one, as Atribuição does. The dates it
 * reads are announced by the header's landing note (lib/period announce).
 * Lives in "Detalhes do período" (the header already names the store).
 */
function FromAllNote({ ctx, store }: { ctx: PageContext; store: StoreRef }) {
  // R4: null when the viewer cannot open Todas (text, never a dead link).
  const all = ctx.scopeHref('/overview', { kind: 'all' })
  return (
    <Callout tone="neu" icon="store" title={`Mostrando a ${store.name}`}>
      O Resumo mostra uma loja por vez. Escolha outra no seletor de loja{all ? <>, ou veja todas juntas
      em <Link href={all}>Todas as lojas</Link></> : null}.
    </Callout>
  )
}

export default async function ResumoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const ctx = await getPageContext(sp, { path: '/', scope: 'store' })
  const store = ctx.store
  const fromAll = ctx.cameFrom?.kind === 'all' && !!store

  if (!store) {
    return (
      <AppShell ctx={ctx}>
        <PageHeader ctx={ctx} title="Resumo" code={null} />
        <Card>
          <EmptyState icon="store" title="Nenhuma loja conectada a esta conta"
            action={<ButtonLink href="/onboarding" variant="primary" icon="arrowRight">Conectar uma loja Shopify</ButtonLink>}>
            Quando uma loja estiver conectada, o lucro dela aparece aqui.
          </EmptyState>
        </Card>
      </AppShell>
    )
  }

  let summary: StoreSummary
  try {
    summary = await loadStoreSummary(store, { period: ctx.period, range: ctx.range, comparison: ctx.comparison, resolution: ctx.resolution, facts: ctx.viewerStores }, ctx.now)
  } catch (err) {
    console.error('[resumo] summary', store.id, err)
    return (
      <AppShell ctx={ctx}>
        <PageHeader ctx={ctx} code={headerCode(ctx, store)} sub={customSub(ctx)} />
        {fromAll && <FromAllNote ctx={ctx} store={store} />}
        <Card>
          <ErrorState title="Os números desta loja não carregaram"
            action={<ButtonLink href={ctx.hrefWith('/')} icon="refresh">Tentar de novo</ButtonLink>}>
            Nada foi alterado. Costuma ser uma falha passageira na leitura do banco.
          </ErrorState>
        </Card>
      </AppShell>
    )
  }

  const input = verdictInputFromPortfolio(summary.view, { split: ctx.split })
  const judged = buildVerdict(input)
  // Nothing in the window was read (an archived store after its archive day):
  // there is nothing to compare, and "hoje · vs ontem até esta hora" sat
  // beside "não há dados hoje".
  const shownInput = judged.frozen ? { ...input, comparison: null } : input
  const v = judged.frozen ? buildVerdict(shownInput) : judged
  const configured = summary.pnl.configured
  const sold = summary.pnl.totals.revenue > 0
  // A window before the first sale (the store did not sell yet) or after an
  // archived store's archive day (nothing is read): the verdict says so, and
  // every block beside it says the same instead of "$0 · nenhum pedido no
  // período" — the ledger, the KPIs, the lists, refunds, the chart, the
  // campaigns and the AI card. One reading, the verdict's (beforeStart /
  // frozen), with its dates as it prints them ("7 nov", "11 abr 2026").
  const empty = emptyWindowOf(v)
  const notYet = v.beforeStart ?? null
  const frozen = v.frozen ?? null
  // A window read only up to the archive day (the verdict's "não teve vendas
  // em 1–10 nov"): the ledger names those days, not the whole window.
  const tail = summary.row.archived ? frozenTailOf(summary.row.archivedOn, ctx.range) : null
  const readLabel = tail ? rangeBeside({ from: ctx.range.from, to: tail }, { window: ctx.range, comparison: ctx.comparison, clockToday: ctx.today }) : ctx.rangeLabel
  const storeNames = new Map(ctx.stores.map(st => [st.id, st.name]))
  if (!storeNames.has(store.id)) storeNames.set(store.id, store.name)

  // ── The band: chips the page words itself, and page tags on tiles.
  const periodText = periodNoteText(ctx, { compared: true })
  const extraChips: BandChip[] = []
  // An archived store whose window reaches its archive day: what was read.
  // A window wholly after it already says "Sem sincronização" (verdict chip).
  const archivedOn = summary.row.archived ? summary.row.archivedOn ?? null : null
  if (summary.row.archived && !frozen && (!archivedOn || ctx.range.to >= archivedOn)) {
    extraChips.push({
      code: 'arquivada', tone: 'mut',
      label: archivedOn ? `arquivada · lido até ${ctx.dateBeside(archivedOn)}` : 'arquivada',
      info: periodText ?? 'A loja está arquivada e não sincroniza mais: nada depois do arquivamento é lido.',
    })
  }
  const sellsInTitle = summary.sellsIn ? `A loja vende em ${summary.sellsIn}; os valores aparecem convertidos em dólar, no câmbio de cada pedido.` : null
  const band = buildNumberBand({
    input: shownInput, verdict: v, scope: 'store', extraChips,
    tileTags: sellsInTitle ? { receita: [{ code: 'moeda', label: `vende em ${summary.sellsIn}`, tone: 'info', info: sellsInTitle }] } : undefined,
  })
  // The costs callout keeps its home (with its button) in Detalhes.
  const costsCallout = !configured && !notYet
  const extraCount = (periodText ? 1 : 0) + (fromAll ? 1 : 0) + (costsCallout ? 1 : 0)
  // The ▲▼ are on screen: a shared-account pair mixed into the comparison
  // window is flagged beside the deltas it moves (SharedAccountNote 'base').
  const deltas = band.comparison?.kind === 'ok'
  /** The tile shows a ▲▼ (not a "—" with an empty row): only then is its base worth flagging. */
  const moved = (key: BandTileKey) => {
    const d = band.tiles.find(t => t.key === key)?.delta
    return deltas && !!d && d.kind !== 'none'
  }

  return (
    <AppShell ctx={ctx}>
      <div className={s.page}>
        <PageHeader
          ctx={ctx}
          code={headerCode(ctx, store)}
          sub={customSub(ctx)}
          periodInfo={{ compared: true }}
          badges={summary.sellsIn && (
            <Chip tone="info" size="sm" title={sellsInTitle ?? undefined}>
              vende em {summary.sellsIn} · convertido em US$
            </Chip>
          )}
        />

        <NumberBandView
          band={band}
          costsHref={ctx.hrefWith('/profit')}
          ariaLabel="Números do período"
          extra={<>
            <Suspense fallback={null}><SharedAccountNote ctx={ctx} store={store} variant="chip" deltas={deltas} /></Suspense>
            {/* No orders and a last sale days old: when it last sold and whether
                the order reading is current, so a quiet store does not read as
                a broken sync. */}
            <Suspense fallback={null}><QuietStoreNote ctx={ctx} store={store} summary={summary} variant="chip" /></Suspense>
          </>}
          tileExtra={{
            lucro: <Suspense fallback={null}><SharedAccountNote ctx={ctx} store={store} variant="base" deltas={moved('lucro')} /></Suspense>,
            margem: <Suspense fallback={null}><SharedAccountNote ctx={ctx} store={store} variant="base" deltas={moved('margem')} /></Suspense>,
            anuncios: <Suspense fallback={null}><SharedAccountNote ctx={ctx} store={store} variant="tag" deltas={moved('anuncios')} /></Suspense>,
            roas: <Suspense fallback={null}><SharedAccountNote ctx={ctx} store={store} variant="tag" deltas={moved('roas')} /></Suspense>,
          }}
          details={
            <PeriodDetails details={band.details} extraCount={extraCount}>
              {periodText && <DetailPara>{periodText}</DetailPara>}
              {fromAll && <FromAllNote ctx={ctx} store={store} />}
              {/* Before the first sale the verdict says so; costs change nothing
                  in a window with no activity (R11: "ainda não vendia" first). */}
              {costsCallout && (
                <Callout tone="warn" title="Custos não configurados">
                  Sem o custo dos produtos, do frete e das taxas, esta tela mostra receita − anúncios, que não é lucro.{' '}
                  <ButtonLink href={ctx.hrefWith('/profit')} size="sm" icon="sliders">Configurar custos</ButtonLink>
                </Callout>
              )}
              <Suspense fallback={null}><SharedAccountNote ctx={ctx} store={store} /></Suspense>
              <Suspense fallback={null}><QuietStoreNote ctx={ctx} store={store} summary={summary} /></Suspense>
            </PeriodDetails>
          }
        />

        <Suspense fallback={<SkeletonBlock height={240} lines={1} />}>
          <ProfitChartBlock ctx={ctx} summary={summary} empty={empty} amount={v.amount} />
        </Suspense>

        <div className={s.ledgerRow}>
          <Card className={s.ledgerCard} as="section" aria-label="Para onde foi cada dólar">
            <BreakdownLedger pnl={v.totals} configured={v.basis !== 'revenue_minus_ads'} split={ctx.split}
              // "De cada $1: 0¢ Meta" over $0 of sales: no bar to split, and the sub says so.
              bar={sold}
              title="Para onde foi cada dólar"
              sub={sold ? `De cada $1,00 vendido em ${ctx.rangeLabel}` : frozen ? `Sem dados de ${ctx.rangeLabel}` : `Nenhuma venda em ${readLabel}`}
              // The phone's words (app/m/_components/Home.tsx VerdictBlock).
              emptyTitle={notYet ? 'A loja ainda não vendia' : frozen ? 'Sem dados neste período' : undefined}
              emptyText={notYet
                ? `A ${store.name} começou a vender em ${notYet.text}: escolha um período a partir dessa data.`
                : frozen ? `A loja está arquivada${frozen.text ? ` desde ${frozen.text}` : ''} e não sincroniza mais: nada é lido depois disso.`
                  : tail ? `Nenhum pedido e nenhum gasto com anúncios em ${readLabel}. Depois disso a loja já estava arquivada: nada foi lido.` : undefined} />
          </Card>
          <StoreKpis ctx={ctx} summary={summary} band={band} empty={empty} />
        </div>

        <Suspense fallback={<SkeletonBlock height={220} lines={2} />}>
          <CampaignsBlock ctx={ctx} summary={summary} storeNames={storeNames} empty={empty} />
        </Suspense>

        <div className={s.grid2}>
          <TopProducts ctx={ctx} summary={summary} empty={empty} />
          <TopCountries ctx={ctx} summary={summary} empty={empty} />
        </div>

        <div className={s.grid2}>
          <RefundsBlock ctx={ctx} summary={summary} empty={empty} />
          <Suspense fallback={<SkeletonBlock height={120} lines={2} />}>
            {/* Keyed: a soft navigation to another store or window keeps this
                class component mounted, and a failure would stick to the next one. */}
            <BlockBoundary key={`${store.id}:${ctx.range.from}:${ctx.range.to}:${ctx.split}`} title="Leitura da IA">
              {/* A window the server would refuse (before the first sale, an
                  archived store after its archive day, this window and the one
                  before it empty) says so, as the verdict does, with no paid
                  "Gerar leitura" that can only come back as "no data". */}
              <InsightsSlot store={store} range={ctx.range} split={ctx.split} daily={summary.pnl.daily} now={ctx.now}
                notStarted={notYet ? { storeName: store.name, firstSale: notYet.text } : null}
                frozen={frozen ? { archivedOn: frozen.text } : undefined} />
            </BlockBoundary>
          </Suspense>
        </div>
      </div>
    </AppShell>
  )
}
