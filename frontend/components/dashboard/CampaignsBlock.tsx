/**
 * CampaignsBlock — the biggest campaigns of the period by spend, each with the
 * ONE action every screen shows (Escalar / Manter / Cortar / Observar, from
 * lib/campaignSignal via lib/data/campaigns) and a link to /campaigns keeping
 * loja and periodo. Async server component; streams in <Suspense>.
 *
 * Money columns cover the page's window; the action is judged on the last 7
 * closed days, as on the campaigns page — the block says so.
 */

import Link from 'next/link'
import type { PageContext } from '@/lib/views/page'
import type { StoreSummary } from '@/lib/views/store'
import { empateGap, loadCampaignSummary } from '@/lib/views/store'
import type { CampaignRow } from '@/lib/data/campaigns'
import { ACTION_LABEL, type CampaignAction, type CampaignDecision } from '@/lib/campaignSignal'
import { formatCount, formatDate, formatMoney, formatPct, formatRangeLabel, formatRoas, plural } from '@/lib/format'
import { Badge, Block, DataTable, EmptyState, ErrorState, Icon, Money, type ChipTone, type IconName } from '@/components/ui'
import { RoasVsEmpate } from './RoasVsEmpate'
import { creditedWithoutSalesText, ownAttributedRoas } from '@/components/campaigns/adsVerdict'
import { emptyWindowText, type EmptyWindow } from './emptyWindow'
import s from './dashboard.module.css'

const ACTION_STYLE: Record<CampaignAction, { tone: ChipTone; icon: IconName }> = {
  escalar: { tone: 'pos', icon: 'up' },
  manter: { tone: 'info', icon: 'check' },
  cortar: { tone: 'neg', icon: 'down' },
  observar: { tone: 'neu', icon: 'ring' },
}

const BASIS_LABEL: Partial<Record<CampaignDecision['basis'], string>> = {
  pausada: 'pausada',
  conta_compartilhada: 'conta compartilhada',
  nao_sincronizada: 'não sincronizada',
  sem_custos: 'sem custos',
  sem_margem: 'sem margem',
  sem_gasto: 'sem gasto',
  volume: 'pouco volume',
}

/** The campaign's action as a badge, or the reason it has none. */
export function ActionBadge({ decision }: { decision: CampaignDecision }) {
  if (decision.action) {
    const st = ACTION_STYLE[decision.action]
    return <Badge tone={st.tone} icon={st.icon}>{ACTION_LABEL[decision.action]}</Badge>
  }
  return <Badge tone="mut">{BASIS_LABEL[decision.basis] ?? 'sem ação'}</Badge>
}

function status(c: CampaignRow): string {
  const st = c.running ? 'ativa' : c.status ? 'pausada' : 'status desconhecido'
  return `${st} · ${plural(Math.round(c.purchases), 'compra atribuída', 'compras atribuídas')}`
}

export async function CampaignsBlock({ ctx, summary, storeNames, empty = null }: {
  ctx: PageContext; summary: StoreSummary; storeNames: ReadonlyMap<string, string>
  /** The verdict's reason the window is empty (./emptyWindow emptyWindowOf). */
  empty?: EmptyWindow | null
}) {
  const title = 'Campanhas no Meta'
  let data
  try {
    data = await loadCampaignSummary(summary.store, ctx.range, storeNames, ctx.now)
  } catch (err) {
    console.error('[resumo] campaigns', err)
    return <Block title={title}><ErrorState compact /></Block>
  }
  const { report, highlights: h } = data
  const be = report.configured ? report.breakEvenRoas : null
  // The report prices the page's window, the same one as summary.pnl.
  const gap = empateGap(report.configured, be, summary.pnl.totals)
  const decided = formatRangeLabel(report.decisionWindow, ctx.today)
  const link = ctx.hrefWith('/campaigns')
  const elsewhere = report.billedElsewhere
  // The action is judged on the last 7 closed days; an archived store was not
  // read on the ones after its archive day, so an action from them ("sem
  // gasto nos 7 dias julgados", Squishy World on 17–23 nov) is about days
  // without data. Such a block shows no action and says why.
  const archivedOn = summary.row.archived ? summary.row.archivedOn ?? null : null
  const unjudged = summary.row.archived && (!archivedOn || report.decisionWindow.to > archivedOn)
  const judgedText = unjudged
    ? <>Sem ação: ela é julgada nos últimos 7 dias fechados ({decided}), e a loja foi arquivada{archivedOn ? <> em {formatDate(archivedOn, ctx.today)}</> : ''} — esses dias não foram lidos.</>
    : <>A ação é julgada nos últimos 7 dias fechados ({decided}), como na página Campanhas.</>

  // Ads the sync has not tied to a campaign: their spend is named apart, so
  // the counts here equal the campaigns page's and the money still adds up.
  const unsyncedLine = h.unsynced.spend > 0 && (
    <>{formatMoney(h.unsynced.spend)} em {plural(Math.max(1, h.unsynced.ads), 'anúncio', 'anúncios')} que a sincronização ainda não ligou a uma campanha (linha &ldquo;Anúncios ainda não sincronizados&rdquo; em Campanhas).</>
  )

  if (!h.top.length) {
    // Before the first sale, or after an archived store's archive day, "this
    // store had no Meta spend" is not what happened: the verdict's reason. Ads
    // billed to another store's account still say where they ran.
    const why = empty && !elsewhere.length && !unsyncedLine ? emptyWindowText(empty, ctx.rangeLabel) : null
    if (why) {
      return (
        <Block title={title} howTo={`Campanhas com gasto em ${ctx.rangeLabel}.`}>
          <EmptyState compact icon="clock" title={why.title}
            action={<Link className={s.link} href={link}>Abrir Campanhas <Icon name="arrowRight" size={12} /></Link>}>
            {why.text}
          </EmptyState>
        </Block>
      )
    }
    return (
      <Block title={title} howTo={`Campanhas com gasto em ${ctx.rangeLabel}.`}>
        <EmptyState compact icon="camp" title={`Nenhuma campanha com gasto em ${ctx.rangeLabel}`}
          action={<Link className={s.link} href={link}>Abrir Campanhas <Icon name="arrowRight" size={12} /></Link>}>
          {elsewhere.length
            ? <>Os anúncios desta loja rodaram na conta de outra: {elsewhere.map(e => <span key={e.campaignId}><b>{e.name}</b> ({formatMoney(e.spend)} na {e.billedStoreName}) </span>)}. O gasto está nas contas da {elsewhere[0].billedStoreName}; some as duas lojas para julgar.</>
            : unsyncedLine
              ? <>O gasto do período está todo em anúncios ainda sem campanha: {unsyncedLine}</>
              : 'Esta loja não teve gasto no Meta neste período.'}
        </EmptyState>
      </Block>
    )
  }

  const attributed = h.attributedShare
  // No sale at all: attributedShare is null, and the block dropped its Meta
  // sentence, so "2 compras atribuídas $167 · ROAS 2,85×" sat under "A Glooty
  // gastou $230 em anúncios e não vendeu nada" (1–5 nov). The words are the
  // Campanhas page's (adsVerdict), over the store's own campaigns.
  const noSaleCredit = creditedWithoutSalesText(ownAttributedRoas(report).value, report.storeRevenue, ctx.partial)
  return (
    <Block
      title={title}
      howTo={<>{h.top.length === 1 ? 'A campanha que mais gastou' : `As ${h.top.length} campanhas que mais gastaram`} em {ctx.rangeLabel}. {judgedText} O ROAS é comparado com o empate da loja{be ? ` (${formatRoas(be)})` : ''}.</>}
      info={report.formula}
      // The number the linked page shows on its tab ("Campanhas 6").
      actions={<Link className={s.link} href={link}>Ver {h.listed > h.top.length ? `as ${formatCount(h.listed)} campanhas` : 'campanhas'} <Icon name="arrowRight" size={12} /></Link>}
      flush
      footer={
        <div className={s.footLinks}>
          <span>
            {noSaleCredit ? <>{noSaleCredit} </>
              : attributed !== null && attributed > 100
              // Hibikura's day: $1.259 credited against $1.245 sold read "(101%)"
              // as if it were a share; it is Meta counting more than happened.
              ? <>O Meta atribui <b>{formatMoney(report.storeRevenue * (attributed / 100))}</b> às campanhas desta loja, mais do que os <b>{formatMoney(report.storeRevenue)}</b> que ela vendeu: a atribuição do Meta não fecha com os pedidos. </>
              : attributed !== null
                ? <>O Meta atribui <b>{formatMoney(report.storeRevenue * (attributed / 100))}</b> das <b>{formatMoney(report.storeRevenue)}</b> em vendas ({formatPct(attributed, { digits: 0 })}) às campanhas desta loja. </>
                : null}
            Use a ação para comparar campanhas entre si; a loja se julga pelo lucro real.
            {h.rest.count > 0 && <> Mais {plural(h.rest.count, 'campanha', 'campanhas')} com <b>{formatMoney(h.rest.spend)}</b> de gasto.</>}
            {unsyncedLine && <> Fora das campanhas: {unsyncedLine}</>}
          </span>
        </div>
      }
    >
      {/* campBox: headers may wrap, and the name and reason columns narrow in a
          small box (dashboard.module.css) — at 1024px the table was 914px in a
          906px box, its last column behind an inner scroll. */}
      <div className={s.campBox}>
      <DataTable
        caption={`Campanhas da ${summary.store.name} em ${ctx.rangeLabel}, por gasto`}
        dense
        columns={[
          { key: 'name', label: 'Campanha' },
          { key: 'spend', label: 'Gasto', numeric: true },
          { key: 'value', label: 'Vendas atribuídas', numeric: true, info: 'O valor que o Meta credita à campanha (compras fantasma acima de $20.000 por anúncio-dia descartadas).' },
          { key: 'roas', label: 'ROAS × empate', info: 'Vendas atribuídas ÷ gasto, contra o empate da loja (receita ÷ contribuição).' },
          { key: 'profit', label: `Lucro estimado${ctx.split ? ' (sua parte)' : ''}`, numeric: true, info: report.formula },
          { key: 'action', label: 'Ação · últimos 7 dias' },
        ]}
        rows={h.top.map(c => ({
          key: c.campaignId ?? c.name,
          tone: c.running ? undefined : 'mut',
          cells: {
            name: <span className={s.campName}><b title={c.name}>{c.name}</b><small>{status(c)}</small></span>,
            spend: <Money value={c.spend} />,
            value: <Money value={c.purchaseValue} tone="none" />,
            roas: c.spend > 0 && c.roas !== null
              ? <RoasVsEmpate roas={c.roas} breakEven={c.shared ? null : be} gap={c.shared ? 'shared' : gap} size="mini" paused={!c.running} />
              : <span className="mut">—</span>,
            profit: c.estimatedProfit === null ? <span className="mut">—</span> : <Money value={ctx.part(c.estimatedProfit)} sign tone="auto" />,
            action: unjudged ? (
              <span className={s.actionCell}>
                <Badge tone="mut">sem ação</Badge>
                <span className={s.reason}>loja arquivada: os 7 dias julgados não foram lidos</span>
              </span>
            ) : (
              <span className={s.actionCell}>
                <ActionBadge decision={c.decision} />
                <span className={s.reason}>{c.shared ? c.shared.note : c.decision.reason}</span>
              </span>
            ),
          },
        }))}
      />
      </div>
    </Block>
  )
}
