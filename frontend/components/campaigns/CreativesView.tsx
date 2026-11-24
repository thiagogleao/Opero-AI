/**
 * The creatives tab of /campaigns: the ads that need a decision as cards, then
 * every ad in a sortable table. Every ad carries the ONE ad verdict
 * (lib/creativeSignal creativeVerdict, computed in lib/data/creatives) against
 * the store's contribution break-even. Hook rate is shown as unavailable with
 * the reason: the collector stores play starts, not 3-second views.
 * Server component (the table sorts on the client from pre-rendered cells).
 *
 * Props: { report: CreativesReport; hrefWith; rangeLabel; filter: CreativesFilter | null (./campaignFilter);
 *          limit: number | null (rows shown; null = all); showAllHref: string;
 *          split?: boolean (partner view: estimated profit is the partner's half,
 *            labelled "sua parte", as on the Resumo; spend and ROAS stay whole) }
 */

import Link from 'next/link'
import type { CreativeRow, CreativesReport } from '@/lib/data/creatives'
import { byVerdictThenSpend } from '@/lib/data/creatives'
import { HOOK_RATE_UNAVAILABLE } from '@/lib/creativeSignal'
import {
  Block, ButtonLink, Callout, Chip, Count, DataTable, EmptyState, InfoTip, Money, Pct,
  type DataColumn, type DataRow,
} from '@/components/ui'
import { formatMoney, formatPct, formatRangeLabel, formatRoas, plural } from '@/lib/format'
import { eachDay } from '@/lib/engine/dates'
import { SPLIT_SHARE } from '@/lib/views/verdict'
import { AD_VERDICT_RULE, adVerdictChip, ptText } from './text'
import { AdThumb } from './AdThumb'
import { RoasCell } from './RoasCell'
import type { CreativesFilter } from './campaignFilter'
import s from './campaigns.module.css'

const CARD_LIMIT = 12

function Thumb({ ad, className, large }: { ad: CreativeRow; className: string; large?: boolean }) {
  // Cards want the full creative; table rows the small thumbnail.
  const sources = large ? [ad.creativeUrl, ad.thumbnailUrl] : [ad.thumbnailUrl, ad.creativeUrl]
  // Cards have room to say why there is no picture; table rows keep it in the tooltip.
  return <AdThumb sources={sources} video={!!ad.video} className={className} expired={ad.previewExpired} label={large} />
}

/** The verdict's own word (judged on the verdict window, not on the row's ROAS). */
function VerdictChip({ ad }: { ad: CreativeRow }) {
  const spec = adVerdictChip(ad.verdict)
  if (!spec) return <span className={s.why}>{ad.running ? 'sem veredito' : 'pausado'}</span>
  return <Chip tone={spec.tone} icon={spec.icon} size="sm">{spec.label}</Chip>
}

function AdCard({ ad, href, k }: { ad: CreativeRow; href: string; k: number }) {
  const est = ad.estimatedProfit === null ? null : ad.estimatedProfit * k
  return (
    <Link href={href} className={s.card}>
      <Thumb ad={ad} className={s.thumb} large />
      <span className={s.cardBody}>
        <span><VerdictChip ad={ad} /></span>
        <span className={s.cardName} title={ad.name}>{ad.name}</span>
        <span className={s.cardCamp} title={ad.campaignName ?? undefined}>{ad.campaignName ?? 'campanha não sincronizada'}</span>
        <span className={s.cardFigs}>
          <span>Gasto<b>{formatMoney(ad.spend)}</b></span>
          <span>ROAS<b>{formatRoas(ad.roas)}</b></span>
          <span title={k !== 1 ? 'Sua parte (50%) do lucro estimado' : undefined}>{k !== 1 ? 'Sua parte' : 'Lucro est.'}<b className={est !== null && est < 0 ? s.neg : undefined}>{formatMoney(est)}</b></span>
        </span>
        <span className={s.why}>{ptText(ad.verdict.reason)}</span>
      </span>
    </Link>
  )
}

export function CreativesView({ report, hrefWith, rangeLabel, filter, limit, showAllHref, split = false, storeRevenue }: {
  report: CreativesReport
  hrefWith: (path: string) => string
  rangeLabel: string
  filter: CreativesFilter | null
  limit: number | null
  showAllHref: string
  split?: boolean
  /** The store's revenue in the window (engine): tells the ROAS gauges'
   *  "sem empate → loja sem vendas" apart from an unknown break-even. */
  storeRevenue?: number | null
}) {
  const be = report.configured ? report.breakEvenRoas : null
  // Verdicts are judged on the campaigns' last closed days (lib/data/creatives),
  // whatever window the figures show: the tab says which.
  const vw = report.verdictWindow
  const verdictDays = eachDay(vw.from, vw.to).length
  const verdictLabel = formatRangeLabel(vw)
  const sameWindow = vw.from === report.range.from && vw.to === report.range.to
  const verdictBe = report.configured ? report.verdictBreakEvenRoas : null
  const windowNote = `O veredito de cada anúncio olha os últimos ${verdictDays} dias fechados (${verdictLabel}), como o das campanhas, seja qual for o período da tabela.`
  const k = split ? SPLIT_SHARE : 1
  const est = (a: CreativeRow) => (a.estimatedProfit === null ? null : a.estimatedProfit * k)
  const ads = report.creatives
  const hrefOf = (ad: CreativeRow) => hrefWith(`/creatives/${encodeURIComponent(ad.adId)}`)
  const decide = ads.filter(a => a.verdict.signal === 'kill' || a.verdict.signal === 'scale' || a.verdict.signal === 'refresh')
    .sort(byVerdictThenSpend)
  const singleDay = report.range.from === report.range.to

  // The table: every ad, or the biggest `limit` by spend (the rest named).
  const bySpend = [...ads].sort((a, b) => b.spend - a.spend)
  const shown = limit !== null && bySpend.length > limit ? bySpend.slice(0, limit) : bySpend
  const hiddenCount = ads.length - shown.length
  const shownSpend = shown.reduce((t, a) => t + a.spend, 0)

  const columns: DataColumn[] = [
    { key: 'ad', label: 'Anúncio' },
    { key: 'spend', label: 'Gasto', numeric: true, sortable: true },
    { key: 'purchases', label: 'Compras', numeric: true, sortable: true },
    // CTR and Hook fold away below ~1100px of table box (campaigns.module.css):
    // at 1024 Hook and the verdict column sat behind an unseen scrollbar. CTR
    // then shows under Compras; hook rate is unavailable for every ad anyway,
    // and the block's footer says so.
    { key: 'ctr', label: <span className={s.colCtr}>CTR</span>, numeric: true, sortable: true },
    { key: 'roas', label: be !== null ? `ROAS × empate ${formatRoas(be)}` : 'ROAS', sortable: true, info: 'Vendas atribuídas pelo Meta ÷ gasto, contra o empate da loja (receita ÷ contribuição). Compras = compras que o Meta atribui ao anúncio; CTR = cliques no link ÷ impressões.' },
    { key: 'est', label: split ? 'Lucro est. (sua parte)' : 'Lucro est.', numeric: true, sortable: true, info: split ? `${ptText(report.formula)} Na visão de sócio, cada valor é a sua parte (50%).` : ptText(report.formula) },
    ...(singleDay ? [{ key: 'freq', label: 'Frequência', numeric: true, sortable: true, info: 'Impressões ÷ alcance do dia.' } as DataColumn] : []),
    { key: 'hook', label: <span className={s.colHook}>Hook</span>, info: HOOK_RATE_UNAVAILABLE },
    { key: 'verdict', label: `Veredito · ${verdictDays} dias`, sortable: true, info: `${AD_VERDICT_RULE} ${windowNote}` },
  ]
  const rank = (a: CreativeRow) => (a.verdict.signal === 'kill' ? 0 : a.verdict.signal === 'scale' ? 1 : a.verdict.signal === 'refresh' ? 2 : a.verdict.signal === 'ok' ? 3 : 4)
  const rows: DataRow[] = shown.map(a => ({
    key: a.adId,
    href: hrefOf(a),
    tone: a.running ? undefined : 'mut',
    cells: {
      ad: (
        <span className={s.adCell}>
          <Thumb ad={a} className={s.mini} />
          <span className={s.adText}>
            <span className={s.adName} title={a.name}>{a.name}</span>
            <span className={s.adSub} title={[a.campaignName, a.adsetName].filter(Boolean).join(' · ')}>
              {a.campaignName ?? 'campanha não sincronizada'}{a.adsetName ? ` · ${a.adsetName}` : ''}
              {a.shared ? ' · conta compartilhada' : ''}
            </span>
          </span>
        </span>
      ),
      spend: <Money value={a.spend} />,
      purchases: <><Count value={a.purchases} />{a.ctr !== null && <span className={`${s.cellSub} ${s.inlineCtr}`}>CTR {formatPct(a.ctr, { digits: 2 })}</span>}</>,
      ctr: <span className={s.colCtr}><Pct value={a.ctr} digits={2} /></span>,
      roas: a.shared ? <span className={s.why}>{formatRoas(a.roas)} · sem empate</span> : <RoasCell roas={a.roas} breakEven={be} paused={!a.running}
        configured={report.configured} revenue={storeRevenue} contribution={report.contributionRate} />,
      est: a.estimatedProfit === null ? <span className={s.muted}>—</span> : <Money value={est(a)} />,
      freq: <span>{a.frequency === null ? '—' : a.frequency.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span>,
      hook: (
        <span className={s.colHook}>
          {a.video
            ? <span className={s.unavailable} title={HOOK_RATE_UNAVAILABLE}>indisponível</span>
            : <span className={s.muted}>imagem</span>}
        </span>
      ),
      verdict: <span className={s.verdictCell} title={ptText(a.verdict.reason)}>{a.verdict.signal && <VerdictChip ad={a} />}<span className={s.why}>{ptText(a.verdict.reason)}</span></span>,
    },
    sort: {
      spend: a.spend, purchases: a.purchases, ctr: a.ctr, roas: a.roas,
      est: est(a), freq: a.frequency, verdict: -rank(a),
    },
  }))

  const t = report.totals
  // Ads of shared-account campaigns are in the list (their spend is in the
  // books) but their credited sales mostly landed in another store: say how
  // much of the list's attributed sales they are, as the verdict does.
  const sharedValue = ads.filter(a => a.shared).reduce((sum, a) => sum + a.purchaseValue, 0)
  return (
    <div className={s.stack}>
      {filter && (
        <Callout tone="neu" icon="sliders" title={filter.title}>
          {filter.note ? <> {filter.note}</> : null}{' '}<Link href={filter.clearHref}>Ver os anúncios de todas as campanhas</Link>
        </Callout>
      )}
      <Block
        title="Anúncios que pedem decisão"
        howTo={sameWindow
          ? `Desligar ou escalar, pelo ROAS de ${rangeLabel} contra o empate da loja${verdictBe !== null ? ` (${formatRoas(verdictBe)})` : ''} — os últimos ${verdictDays} dias fechados, a janela do veredito das campanhas. Os mais urgentes primeiro.${split ? ' "Sua parte" é a sua metade do lucro estimado do anúncio.' : ''}`
          : `Desligar ou escalar, pelo ROAS dos últimos ${verdictDays} dias fechados (${verdictLabel}) contra o empate da loja nesses dias${verdictBe !== null ? ` (${formatRoas(verdictBe)})` : ''}, como o veredito das campanhas. Gasto, ROAS e lucro de cada cartão são de ${rangeLabel}.${split ? ' "Sua parte" é a sua metade do lucro estimado do anúncio.' : ''}`}
        info="O mesmo veredito aparece no celular. Um dia ainda aberto não decide: o Meta atribui as vendas com atraso. Anúncios pausados não recebem recomendação."
      >
        {!report.configured ? (
          <EmptyState icon="sliders" title="Custos não configurados">
            Sem o custo dos produtos não há empate, e sem empate não há veredito por anúncio. Gasto e ROAS estão na tabela abaixo.
          </EmptyState>
        ) : decide.length === 0 ? (
          <EmptyState compact title="Nenhum anúncio para desligar ou escalar">
            {ads.length ? 'Os anúncios com gasto estão entre os limites, ou com pouco gasto para julgar.' : filter ? 'Nenhum anúncio desta campanha teve gasto no período.' : 'Nenhum anúncio teve gasto no período.'}
          </EmptyState>
        ) : (
          <div className={s.cards}>
            {decide.slice(0, CARD_LIMIT).map(a => <AdCard key={a.adId} ad={a} href={hrefOf(a)} k={k} />)}
          </div>
        )}
      </Block>

      <Block
        title={filter ? 'Anúncios da campanha' : 'Todos os anúncios'}
        howTo="Ordene por qualquer coluna; clique num anúncio para ver o dia a dia dele no mesmo período."
        info={<>A lista soma o gasto que a contabilidade da loja carrega: {formatMoney(t.spend)} em {plural(t.ads, 'anúncio', 'anúncios')}. <span>{HOOK_RATE_UNAVAILABLE}</span>{report.notes.frequency ? <> {report.notes.frequency}</> : null}</>}
        flush
        footer={
          <>
            <span><b>{plural(t.ads, 'anúncio', 'anúncios')}</b> com gasto ou venda · gasto <b className="num">{formatMoney(t.spend)}</b> · vendas atribuídas <b className="num">{formatMoney(t.purchaseValue)}</b>{sharedValue > 0 ? <>, das quais <b className="num">{formatMoney(sharedValue)}</b> em anúncios de conta compartilhada</> : null}</span>
            {report.reconciliation && Math.abs(report.reconciliation.gap) >= 0.01 && (
              <span className="warn">A lista e a contabilidade diferem em {formatMoney(report.reconciliation.gap)}.</span>
            )}
            {hiddenCount > 0 && (
              <span>
                Mostrando os {shown.length} de maior gasto ({formatPct(t.spend > 0 ? (shownSpend / t.spend) * 100 : null, { digits: 0 })} do gasto). <Link href={showAllHref}>Mostrar todos os {ads.length}</Link>
              </span>
            )}
            <span>Hook rate <InfoTip label="Por que o hook rate está indisponível">{HOOK_RATE_UNAVAILABLE}</InfoTip> indisponível</span>
          </>
        }
      >
        <div className={s.adsBox}>
          <DataTable
            caption={`Anúncios em ${rangeLabel}`}
            columns={columns}
            rows={rows}
            initialSort={report.configured ? { key: 'est', dir: 'desc' } : { key: 'spend', dir: 'desc' }}
            maxHeight={720}
            dense
            empty={<EmptyState compact title="Nenhum anúncio com gasto no período" action={filter ? <ButtonLink href={filter.clearHref} size="sm">Ver todas as campanhas</ButtonLink> : undefined} />}
          />
        </div>
      </Block>
    </div>
  )
}
