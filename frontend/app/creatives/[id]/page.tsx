import { notFound } from 'next/navigation'
import { ALL_STORES, getPageContext, pageMetadata, type SearchParams } from '@/lib/views/page'
import { computeStorePnL } from '@/lib/engine/pnl'
import { getViewer, listStores, resolveStore } from '@/lib/access'
import { adBelongsToStore, getCreativeDetail, type CreativeDetail, type CreativeRow } from '@/lib/data/creatives'
import { FREQUENCY_UNAVAILABLE, HOOK_RATE_UNAVAILABLE } from '@/lib/creativeSignal'
import { formatMoney, formatNumber, formatPct, formatRoas, formatWeekdayDate, plural } from '@/lib/format'
import { EARLY_DAY_MINUTES } from '@/lib/views/verdict'
import { AppShell, PageHeader, periodName } from '@/components/shell'
import {
  Block, ButtonLink, Card, Chip, Count, DataTable, EmptyState, ErrorState, KpiCard, KpiGrid, Money, Pct,
  type DataColumn, type DataRow,
} from '@/components/ui'
import { DailyProfitBars } from '@/components/charts'
import { buildCreativeVerdict, noSpendWhen } from '@/components/campaigns/creativeVerdict'
import { storeMarginFromPnL } from '@/components/campaigns/margin'
import { AdThumb } from '@/components/campaigns/AdThumb'
import { RoasCell } from '@/components/campaigns/RoasCell'
import { detailsOf, statusChipsOf } from '@/lib/views/numberBand'
import { NumberBandView, PeriodDetails } from '@/components/numbers'
import s from '@/components/campaigns/campaigns.module.css'

/**
 * One ad: its verdict (the shared ad verdict), its numbers and its day-by-day
 * over the SAME period the dashboard shows (loja/periodo/de/ate come from the
 * URL through getPageContext, and every link here keeps them). An ad of this
 * store with no spend in the period says so; another store's ad is a 404.
 */

/** The ad id from the route; null when it is not a valid %-escape, which the
 *  page answers with a 404 instead of a crash. */
function adIdOf(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw
  if (!v) return null
  try {
    return decodeURIComponent(v) || null
  } catch {
    return null
  }
}

const firstParam = (v: string | string[] | undefined): string | null => {
  const t = (Array.isArray(v) ? v[0] : v)?.trim()
  return t ? t : null
}

/**
 * The tab title, and "Página não encontrada" whenever the page itself 404s:
 * the same store getPageContext shows (an unknown ?loja is handled by
 * pageMetadata), and an ad that store never had, whatever the window. A
 * cheap EXISTS: pricing the detail here would double the page's work.
 */
export const generateMetadata = pageMetadata('Criativo', {
  scope: 'store',
  exists: async (params, sp) => {
    const adId = adIdOf(params.id)
    if (!adId) return false
    const viewer = await getViewer()
    if (!viewer) return true // the page redirects to /sign-in
    const loja = firstParam(sp.loja)
    const { store } = await resolveStore(viewer, loja && loja !== ALL_STORES ? loja : null)
    return store ? adBelongsToStore(store.id, adId) : false
  },
})

/** Meta's effective_status values, in words. An ad whose own status is ACTIVE
 *  but that does not run has its ad set or campaign paused. */
const STATUS_TEXT: Record<string, string> = {
  PAUSED: 'pausado',
  DELETED: 'excluído',
  ARCHIVED: 'arquivado',
  DISAPPROVED: 'reprovado pelo Meta',
  PENDING_REVIEW: 'em revisão no Meta',
  IN_PROCESS: 'em processamento no Meta',
  WITH_ISSUES: 'com problemas no Meta',
  CAMPAIGN_PAUSED: 'campanha pausada',
  ADSET_PAUSED: 'conjunto pausado',
}

function statusText(c: Pick<CreativeRow, 'running' | 'status' | 'known'>): string {
  if (c.running) return 'ativo'
  if (!c.known || !c.status) return 'sem gasto no último dia · ainda não sincronizado'
  const st = c.status.toUpperCase()
  if (st === 'ACTIVE') return 'parado: campanha ou conjunto pausado'
  return STATUS_TEXT[st] ?? 'parado'
}

export default async function CreativePage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<SearchParams>
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams])
  const ctx = await getPageContext(sp, { path: `/creatives/${encodeURIComponent(id)}`, scope: 'store' })
  const store = ctx.store
  const adId = adIdOf(id)
  if (!store || !adId) notFound()
  const backHref = ctx.hrefWith('/campaigns?aba=criativos')

  let detail: CreativeDetail | null
  let pnl: Awaited<ReturnType<typeof computeStorePnL>>
  try {
    const [all, p] = await Promise.all([
      listStores(ctx.viewer, { includeArchived: true }),
      computeStorePnL(store.id, ctx.range, {}, ctx.now),
    ])
    pnl = p
    detail = await getCreativeDetail(store, adId, ctx.range, {
      storeNames: new Map(all.map(x => [x.id, x.name])), margin: storeMarginFromPnL(ctx.range, p), now: ctx.now,
    })
  } catch (err) {
    console.error('[creative] detail', err)
    return (
      <AppShell ctx={ctx}>
        <PageHeader ctx={ctx} title="Criativo" />
        <ErrorState title="Não foi possível carregar este anúncio" action={<ButtonLink href={backHref} size="sm">Voltar aos criativos</ButtonLink>} />
      </AppShell>
    )
  }
  // Never another store's ad: lib/data/creatives returns null for it.
  if (!detail || !pnl) notFound()

  const c = detail.creative
  const verdict = buildCreativeVerdict({
    detail, storeTotals: pnl.totals, rangeLabel: ctx.rangeLabel, periodPhrase: ctx.periodPhrase,
    partialLabel: ctx.partialLabel, today: ctx.today, split: ctx.split,
    early: ctx.period === 'today' && ctx.partial && ctx.minutesIntoDay < EARLY_DAY_MINUTES,
  })
  const be = detail.breakEvenRoas
  const single = ctx.range.from === ctx.range.to
  // The ad's format over its whole history, not this window's plays: a video
  // on a day without spend has none and read "imagem".
  const isVideo = detail.format === 'video'

  const aside = (
    <div>
      <AdThumb className={s.preview} sources={[c.creativeUrl, c.thumbnailUrl]} video={isVideo} alt={`Imagem do anúncio ${c.name}`}
        iconSize={20} expired={c.previewExpired} label compact />
      <dl className={`${s.meta} ${s.metaTop}`}>
        <dt>Status</dt><dd>{statusText(c)}</dd>
        <dt>Campanha</dt><dd>{c.campaignName ?? 'não sincronizada'}</dd>
        <dt>Conjunto</dt><dd>{c.adsetName ?? '—'}</dd>
        <dt>Formato</dt><dd>{detail.format === null ? '—' : isVideo ? 'vídeo' : 'imagem'}</dd>
        {c.landingUrl && <><dt>Destino</dt><dd><a href={c.landingUrl} target="_blank" rel="noopener noreferrer">{c.landingUrl.replace(/^https?:\/\//, '')}</a></dd></>}
        <dt>ID</dt><dd className="num">{c.adId}</dd>
      </dl>
    </div>
  )

  const columns: DataColumn[] = [
    { key: 'date', label: 'Dia' },
    { key: 'spend', label: 'Gasto', numeric: true, sortable: true },
    { key: 'purchases', label: 'Compras', numeric: true, sortable: true },
    { key: 'pv', label: 'Vendas atribuídas', numeric: true, sortable: true },
    { key: 'roas', label: 'ROAS', numeric: true, sortable: true },
    { key: 'ctr', label: 'CTR', numeric: true, sortable: true },
    // Partner view: the same half as the chart above and the verdict, so a day
    // never shows two amounts on one page.
    { key: 'est', label: ctx.split ? 'Lucro estimado (sua parte)' : 'Lucro estimado', numeric: true, sortable: true },
  ]
  const rows: DataRow[] = detail.daily.map(d => ({
    key: d.date,
    tone: d.spend > 0 ? undefined : 'mut',
    cells: {
      date: <span>{formatWeekdayDate(d.date, ctx.today)}{d.date === ctx.today ? <span className="mut"> · parcial</span> : null}</span>,
      spend: <Money value={d.spend} />,
      purchases: <Count value={d.purchases} />,
      pv: <Money value={d.purchaseValue} />,
      roas: <span>{d.roas === null ? '—' : formatRoas(d.roas)}</span>,
      ctr: <Pct value={d.impressions > 0 ? (d.linkClicks / d.impressions) * 100 : null} digits={2} />,
      est: d.estimatedProfit === null ? <span className="mut">—</span> : <Money value={ctx.part(d.estimatedProfit)} />,
    },
    sort: {
      date: d.date, spend: d.spend, purchases: d.purchases, pv: d.purchaseValue, roas: d.roas,
      ctr: d.impressions > 0 ? d.linkClicks / d.impressions : null, est: d.estimatedProfit === null ? null : ctx.part(d.estimatedProfit),
    },
  }))

  const kpis = (
    <>
    <KpiCard label="Gasto" swatch="meta" value={<Money value={c.spend} />} note={<>{plural(c.daysWithSpend, 'dia', 'dias')} com gasto · CPM <b>{formatMoney(c.cpm)}</b></>} />
    <KpiCard label="Vendas atribuídas" value={<Money value={c.purchaseValue} />} note={<><b>{c.purchases}</b> {c.purchases === 1 ? 'compra' : 'compras'} · CPA <b>{formatMoney(c.cpa)}</b></>}
      info="O que o Meta credita a este anúncio. Compras impossíveis (acima de $20.000 num dia de um anúncio) já foram descartadas." />
    <KpiCard label="ROAS" value={<span>{formatRoas(c.roas)}</span>} note={<RoasCell roas={c.roas} breakEven={be} paused={!c.running} showValue={false}
        configured={detail.configured} revenue={pnl.totals.revenue} contribution={pnl.totals.contribution}
        reason={c.shared ? 'other_store' : null} />}
      info="Vendas atribuídas ÷ gasto, contra o empate da loja no mesmo período (receita ÷ contribuição)." />
    <KpiCard label="Cliques" value={<span>{formatPct(c.ctr, { digits: 2 })}</span>} note={<><b>{formatNumber(c.linkClicks)}</b> cliques no link · CPC <b>{formatMoney(c.cpc)}</b></>}
      info="CTR = cliques no link ÷ impressões." />
    <KpiCard label="Frequência" tone={c.frequency === null ? 'mut' : undefined}
      value={c.frequency === null ? <span className={s.kpiNa}>indisponível</span> : <span>{c.frequency.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span>}
      note={single ? 'impressões ÷ alcance do dia' : 'só existe para um dia de cada vez'} info={FREQUENCY_UNAVAILABLE} />
    <KpiCard label="Hook rate" tone="mut" value={<span className={s.kpiNa}>indisponível</span>}
      note={c.video ? `vídeo: ${formatNumber(c.video.plays)} inícios de reprodução, não visualizações de 3 s`
        : isVideo ? 'vídeo: quase nenhum início de reprodução neste período'
          : detail.format === 'image' ? 'anúncio de imagem' : 'formato desconhecido'} info={HOOK_RATE_UNAVAILABLE} />
    </>
  )

  return (
    <AppShell ctx={ctx}>
      <PageHeader
        ctx={ctx}
        title={c.name}
        sub={<><b>{periodName(ctx)}</b> · <span className="num">{ctx.rangeLabel}</span> · criativo da {store.name}</>}
        actions={<ButtonLink href={backHref} size="sm" icon="camp">Todos os criativos</ButtonLink>}
      />
      <div className={s.creativeTop}>
        <div className={s.creativeMain}>
          {/* Numbers first: the chips, the ad's numbers, then the verdict's sentences on demand. */}
          <NumberBandView tiles={[]} status={statusChipsOf(verdict)} ariaLabel="Situação do anúncio" />
          {detail.hasSpend && (
            // Seven cards: 4 + 3 on a wide column, never one alone on a row.
            <div className={s.creativeKpis}>
              <KpiGrid>
                <KpiCard label={ctx.split ? 'Lucro estimado (sua parte)' : 'Lucro estimado'}
                  value={verdict.amount === null ? <span className="mut">—</span> : <Money value={verdict.amount} />}
                  tone={verdict.amount === null ? 'mut' : verdict.amountTone === 'pos' ? 'pos' : verdict.amountTone === 'neg' ? 'neg' : undefined}
                  // A short tag, as on Campanhas; the caption's formula is in the ⓘ.
                  note={verdict.basis === 'profit' ? <Chip tone="neu" size="sm">estimado · atribuição do Meta</Chip> : verdict.amountCaption}
                  info={verdict.basis === 'profit' ? `${verdict.amountCaption.replace(/^de /, 'Lucro estimado: ')}. ${detail.formula}` : detail.formula} />
                {kpis}
              </KpiGrid>
            </div>
          )}
          <PeriodDetails details={detailsOf(verdict)} />
        </div>
        <Card className={s.creativeAside} as="aside" aria-label="O anúncio">{aside}</Card>
      </div>

      {!detail.hasSpend ? (
        <Card pad="md">
          <EmptyState
            title="Sem gasto neste período"
            action={<ButtonLink href={ctx.hrefWith(`/creatives/${encodeURIComponent(c.adId)}`, { periodo: '30d' })} size="sm">Ver os últimos 30 dias</ButtonLink>}
          >
            O anúncio é desta loja, mas não teve gasto {noSpendWhen(ctx.range, ctx.today)}.
          </EmptyState>
        </Card>
      ) : (
        <>

          {c.video && (
            <Block title="Quanto do vídeo as pessoas assistem" howTo="Parte dos inícios de reprodução que chegou a cada ponto do vídeo. O autoplay conta como início, então é retenção, não gancho.">
              <div className={s.retention}>
                {([['25% do vídeo', c.video.retention25], ['metade', c.video.retention50], ['75% do vídeo', c.video.retention75], ['até o fim', c.video.retention100]] as const).map(([label, v]) => (
                  <div key={label} className={s.retRow}>
                    <span>{label}</span>
                    <span className={s.barTrack}><i className={`${s.barFill} ${s.barMeta}`} style={{ width: `${Math.min(100, v ?? 0)}%` }} /></span>
                    <b>{formatPct(v)}</b>
                  </div>
                ))}
              </div>
            </Block>
          )}

          {detail.configured && detail.contributionRate !== null && (
            <Block title={ctx.split ? 'Lucro estimado por dia (sua parte)' : 'Lucro estimado por dia'} howTo="Barra acima da linha do zero = dia em que as vendas atribuídas, depois da margem da loja, pagaram o gasto do anúncio." info={detail.formula}>
              {/* The whole day's estimate plus the split: the bars show the
                  viewer's part, the tooltip's margin stays the whole day's
                  (the split halves money, never ratios). The tooltip names
                  what is plotted: an estimate over Meta-attributed sales, and
                  Meta's credited purchases, which are not the store's orders. */}
              <DailyProfitBars
                days={detail.daily.map(d => ({ date: d.date, profit: d.estimatedProfit ?? 0, revenue: d.purchaseValue, metaSpend: d.spend, orders: d.purchases }))}
                labels={{ profit: 'lucro estimado', wholeProfit: 'lucro estimado do dia', revenue: 'vendas atribuídas', orders: 'compras (Meta)' }}
                share={ctx.splitFactor}
                partialDate={ctx.partial ? ctx.today : null}
                partialNote={ctx.partialLabel ?? undefined}
                today={ctx.today}
                height={200}
                ariaLabel={`Lucro estimado por dia do anúncio ${c.name}`}
              />
            </Block>
          )}

          <Block title="Dia a dia" howTo="Cada dia no fuso da loja. Dias sem gasto aparecem apagados." flush>
            <DataTable caption={`Dia a dia do anúncio ${c.name}`} columns={columns} rows={rows} initialSort={{ key: 'date', dir: 'desc' }} dense />
          </Block>
        </>
      )}
    </AppShell>
  )
}
