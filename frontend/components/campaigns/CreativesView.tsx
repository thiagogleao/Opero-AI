/**
 * The creatives tab of /campaigns: the ads that need a decision as cards, then
 * every ad in a sortable table. Every ad carries the ONE ad verdict
 * (lib/creativeSignal creativeVerdict, computed in lib/data/creatives) against
 * the store's contribution break-even. Hook rate is shown as unavailable with
 * the reason: the collector stores play starts, not 3-second views.
 * Server component (the table sorts on the client from pre-rendered cells).
 *
 * Props: { report: CreativesReport; hrefWith; rangeLabel; filter: { name; clearHref } | null;
 *          limit: number | null (rows shown; null = all); showAllHref: string }
 */

import Link from 'next/link'
import type { CreativeRow, CreativesReport } from '@/lib/data/creatives'
import { byVerdictThenSpend } from '@/lib/data/creatives'
import { HOOK_RATE_UNAVAILABLE } from '@/lib/creativeSignal'
import {
  Block, ButtonLink, Callout, Chip, Count, DataTable, EmptyState, InfoTip, Money, Pct,
  type DataColumn, type DataRow,
} from '@/components/ui'
import { formatMoney, formatPct, formatRoas, plural } from '@/lib/format'
import { AD_VERDICT_RULE, adSignalChip, ptText } from './text'
import { AdThumb } from './AdThumb'
import { RoasCell } from './RoasCell'
import s from './campaigns.module.css'

const CARD_LIMIT = 12

function Thumb({ ad, className, large }: { ad: CreativeRow; className: string; large?: boolean }) {
  // Cards want the full creative; table rows the small thumbnail.
  const sources = large ? [ad.creativeUrl, ad.thumbnailUrl] : [ad.thumbnailUrl, ad.creativeUrl]
  return <AdThumb sources={sources} video={!!ad.video} className={className} />
}

function VerdictChip({ ad, breakEven }: { ad: CreativeRow; breakEven: number | null }) {
  if (!ad.verdict.signal) return <span className={s.why}>{ad.running ? 'sem veredito' : 'pausado'}</span>
  const spec = adSignalChip(ad.verdict.signal, ad.roas, breakEven)
  return <Chip tone={spec.tone} icon={spec.icon} size="sm">{spec.label}</Chip>
}

function AdCard({ ad, href, breakEven }: { ad: CreativeRow; href: string; breakEven: number | null }) {
  return (
    <Link href={href} className={s.card}>
      <Thumb ad={ad} className={s.thumb} large />
      <span className={s.cardBody}>
        <span><VerdictChip ad={ad} breakEven={breakEven} /></span>
        <span className={s.cardName} title={ad.name}>{ad.name}</span>
        <span className={s.cardCamp} title={ad.campaignName ?? undefined}>{ad.campaignName ?? 'campanha não sincronizada'}</span>
        <span className={s.cardFigs}>
          <span>Gasto<b>{formatMoney(ad.spend)}</b></span>
          <span>ROAS<b>{formatRoas(ad.roas)}</b></span>
          <span>Lucro est.<b className={ad.estimatedProfit !== null && ad.estimatedProfit < 0 ? s.neg : undefined}>{formatMoney(ad.estimatedProfit)}</b></span>
        </span>
        <span className={s.why}>{ptText(ad.verdict.reason)}</span>
      </span>
    </Link>
  )
}

export function CreativesView({ report, hrefWith, rangeLabel, filter, limit, showAllHref }: {
  report: CreativesReport
  hrefWith: (path: string) => string
  rangeLabel: string
  filter: { name: string; clearHref: string } | null
  limit: number | null
  showAllHref: string
}) {
  const be = report.configured ? report.breakEvenRoas : null
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
    { key: 'ctr', label: 'CTR', numeric: true, sortable: true },
    { key: 'roas', label: be !== null ? `ROAS × empate ${formatRoas(be)}` : 'ROAS', sortable: true, info: 'Vendas atribuídas pelo Meta ÷ gasto, contra o empate da loja (receita ÷ contribuição). Compras = compras que o Meta atribui ao anúncio; CTR = cliques no link ÷ impressões.' },
    { key: 'est', label: 'Lucro est.', numeric: true, sortable: true, info: ptText(report.formula) },
    ...(singleDay ? [{ key: 'freq', label: 'Frequência', numeric: true, sortable: true, info: 'Impressões ÷ alcance do dia.' } as DataColumn] : []),
    { key: 'hook', label: 'Hook', info: HOOK_RATE_UNAVAILABLE },
    { key: 'verdict', label: 'Veredito', sortable: true, info: AD_VERDICT_RULE },
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
      purchases: <Count value={a.purchases} />,
      ctr: <Pct value={a.ctr} digits={2} />,
      roas: a.shared ? <span className={s.why}>{formatRoas(a.roas)} · sem empate</span> : <RoasCell roas={a.roas} breakEven={be} paused={!a.running} />,
      est: a.estimatedProfit === null ? <span className={s.muted}>—</span> : <Money value={a.estimatedProfit} />,
      freq: <span>{a.frequency === null ? '—' : a.frequency.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span>,
      hook: a.video
        ? <span className={s.unavailable} title={HOOK_RATE_UNAVAILABLE}>indisponível</span>
        : <span className={s.muted}>imagem</span>,
      verdict: <span className={s.verdictCell} title={ptText(a.verdict.reason)}>{a.verdict.signal && <VerdictChip ad={a} breakEven={be} />}<span className={s.why}>{ptText(a.verdict.reason)}</span></span>,
    },
    sort: {
      spend: a.spend, purchases: a.purchases, ctr: a.ctr, roas: a.roas,
      est: a.estimatedProfit, freq: a.frequency, verdict: -rank(a),
    },
  }))

  const t = report.totals
  return (
    <div className={s.stack}>
      {filter && (
        <Callout tone="neu" icon="sliders" title={`Só os anúncios de "${filter.name}".`}>
          {' '}<Link href={filter.clearHref}>Ver os anúncios de todas as campanhas</Link>
        </Callout>
      )}
      <Block
        title="Anúncios que pedem decisão"
        howTo={`Desligar ou escalar, pelo ROAS de ${rangeLabel} contra o empate da loja${be !== null ? ` (${formatRoas(be)})` : ''}. Os mais urgentes primeiro.`}
        info="O mesmo veredito aparece no celular e no Copiloto. Anúncios pausados não recebem recomendação."
      >
        {!report.configured ? (
          <EmptyState icon="sliders" title="Custos não configurados">
            Sem o custo dos produtos não há empate, e sem empate não há veredito por anúncio. Gasto e ROAS estão na tabela abaixo.
          </EmptyState>
        ) : decide.length === 0 ? (
          <EmptyState compact title="Nenhum anúncio para desligar ou escalar">
            {ads.length ? 'Os anúncios com gasto estão entre os limites, ou com pouco gasto para julgar.' : 'Nenhum anúncio teve gasto no período.'}
          </EmptyState>
        ) : (
          <div className={s.cards}>
            {decide.slice(0, CARD_LIMIT).map(a => <AdCard key={a.adId} ad={a} href={hrefOf(a)} breakEven={be} />)}
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
            <span><b>{plural(t.ads, 'anúncio', 'anúncios')}</b> com gasto ou venda · gasto <b className="num">{formatMoney(t.spend)}</b> · vendas atribuídas <b className="num">{formatMoney(t.purchaseValue)}</b></span>
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
        <DataTable
          caption={`Anúncios em ${rangeLabel}`}
          columns={columns}
          rows={rows}
          initialSort={report.configured ? { key: 'est', dir: 'desc' } : { key: 'spend', dir: 'desc' }}
          maxHeight={720}
          dense
          empty={<EmptyState compact title="Nenhum anúncio com gasto no período" action={filter ? <ButtonLink href={filter.clearHref} size="sm">Ver todas as campanhas</ButtonLink> : undefined} />}
        />
      </Block>
    </div>
  )
}
