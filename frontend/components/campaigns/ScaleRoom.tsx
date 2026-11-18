/**
 * "Onde há folga para escalar" — the one campaign verdict (lib/campaignSignal
 * decideCampaign, via lib/data/campaigns), judged on the last 7 CLOSED days in
 * the store's timezone whatever period the page shows. Running campaigns are
 * grouped by action with the reason and a 7-day strip of estimated profit;
 * paused campaigns sit in a collapsed section without badges (they get no
 * recommendation); rows without a verdict (shared account, unsynced ads) say
 * why. The rule is spelled out under the list. Server component.
 *
 * Props: { report: CampaignReport for the decision window; windowLabel: "10–16 nov";
 *          costsHref: link to the cost settings;
 *          split?: boolean (partner view: the daily estimated profit is the
 *            partner's half; margins, spend and ROAS stay whole) }
 */

import type { CampaignAction } from '@/lib/campaignSignal'
import type { CampaignReport, CampaignRow } from '@/lib/data/campaigns'
import { Block, ButtonLink, Chip, EmptyState, Icon, RoasGauge } from '@/components/ui'
import { MiniBars } from '@/components/charts'
import { formatDate, formatMoney, formatPct, formatRoas, plural } from '@/lib/format'
import { SPLIT_SHARE } from '@/lib/views/verdict'
import { ACTION_CHIP, ptText } from './text'
import s from './campaigns.module.css'

const ORDER: CampaignAction[] = ['escalar', 'cortar', 'manter', 'observar']
const GROUP_TITLE: Record<CampaignAction, string> = {
  escalar: 'Têm folga para mais orçamento',
  cortar: 'Estão queimando dinheiro',
  manter: 'Dão lucro, sem folga para escalar',
  observar: 'Ainda sem sinal claro',
}

function DecisionRow({ row, breakEven, k }: { row: CampaignRow; breakEven: number | null; k: number }) {
  const d = row.decision
  const spec = d.action ? ACTION_CHIP[d.action] : null
  const strip = d.days.map(x => (x.estimatedProfit === null ? null : x.estimatedProfit * k))
  const half = k !== 1 ? ' (sua parte)' : ''
  return (
    <div className={s.decision}>
      <div>
        <div className={s.dName}>
          {spec && <Chip tone={spec.tone} icon={spec.icon} size="sm">{spec.label}</Chip>}
          <span>{row.name}</span>
        </div>
        <div className={s.dReason}>{ptText(d.reason)}</div>
        {d.notes.length > 0 && <div className={s.dNotes}>{d.notes.map(ptText).join(' · ')}</div>}
      </div>
      <div className={s.dFigures}>
        <span>margem <b className={d.margin !== null && d.margin < 0 ? s.neg : undefined}>{formatPct(d.margin, { digits: 0 })}</b> · gasto <b>{formatMoney(d.spend)}</b> · <b>{d.purchases}</b> {d.purchases === 1 ? 'compra' : 'compras'}</span>
        {/* Only campaigns with an action get here, and an action needs cost
            settings and store sales in the window (decideCampaign): a missing
            break-even can only mean product, shipping and fees ate the sales. */}
        <RoasGauge roas={d.roas} breakEven={breakEven} reason={breakEven === null ? 'no_margin' : null} size="mini" />
      </div>
      <div className={s.strip}>
        <MiniBars
          values={strip}
          width={150}
          ariaLabel={`Lucro estimado por dia de ${row.name}${half}`}
          tip={{
            title: `Lucro estimado por dia${half}`,
            rows: d.days.map(x => [formatDate(x.date), x.estimatedProfit === null ? 'sem gasto' : formatMoney(x.estimatedProfit * k), x.estimatedProfit === null ? null : x.estimatedProfit >= 0 ? 'pos' : 'neg']),
          }}
        />
        <span>{k !== 1 ? 'sua parte do lucro estimado, dia a dia' : 'lucro estimado, dia a dia'}</span>
      </div>
    </div>
  )
}

export function ScaleRoom({ report, windowLabel, costsHref, split = false }: { report: CampaignReport; windowLabel: string; costsHref: string; split?: boolean }) {
  const k = split ? SPLIT_SHARE : 1
  const rows = report.campaigns.filter(c => c.decision.spend > 0 || c.decision.basis !== 'sem_gasto')
  const acting = rows.filter(c => c.decision.action !== null)
  const paused = rows.filter(c => c.decision.basis === 'pausada')
  const other = rows.filter(c => c.decision.action === null && c.decision.basis !== 'pausada' && c.decision.basis !== 'sem_gasto')
  const be = report.decisionBreakEvenRoas
  const t = report.thresholds

  const rules = (
    <dl className={s.rules}>
      {ORDER.map(a => (
        <div key={a} className={s.ruleRow}>
          <dt><Chip tone={ACTION_CHIP[a].tone} icon={ACTION_CHIP[a].icon} size="sm">{ACTION_CHIP[a].label}</Chip></dt>
          <dd>{ptText(report.rules[a])}</dd>
        </div>
      ))}
    </dl>
  )

  return (
    <Block
      title="Onde há folga para escalar"
      howTo={`Cada campanha julgada nos últimos ${t.windowDays} dias fechados (${windowLabel}), seja qual for o período escolhido acima: margem estimada = vendas que o Meta atribui × margem da loja − gasto.`}
      info={<>{ptText(report.formula)} A margem mínima para escalar ({t.minMargin}%) é a mesma das notificações de escala, definida em Ajustes.</>}
      footer={rules}
    >
      {!report.configured ? (
        <EmptyState icon="sliders" title="Custos não configurados" action={<ButtonLink href={costsHref} size="sm" icon="sliders">Configurar custos</ButtonLink>}>
          Sem o custo dos produtos não há margem, e sem margem não há veredito de escala. O gasto e as vendas de cada campanha estão na tabela abaixo.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState title="Nenhuma campanha com gasto">Nenhuma campanha gastou nos últimos {t.windowDays} dias fechados.</EmptyState>
      ) : (
        <>
          {acting.length === 0 && (
            <EmptyState compact title="Nenhuma campanha ativa para julgar">
              As campanhas com gasto nesses dias estão pausadas ou sem veredito — veja abaixo.
            </EmptyState>
          )}
          {ORDER.map(a => {
            const list = acting.filter(c => c.decision.action === a)
            if (!list.length) return null
            return (
              <div key={a} className={s.group}>
                <div className={s.groupHead}>
                  <span className="lbl">{GROUP_TITLE[a]}</span>
                  <span className={s.groupCount}>{list.length}</span>
                </div>
                {list.map(c => <DecisionRow key={c.campaignId ?? c.name} row={c} breakEven={be} k={k} />)}
              </div>
            )
          })}
          {other.length > 0 && (
            <details className={s.collapse}>
              <summary>
                <Icon name="chev" size={13} className={s.chev} />
                Sem veredito ({other.length}) — conta compartilhada, anúncios não sincronizados ou sem margem
              </summary>
              {other.map(c => (
                <div key={c.campaignId ?? c.name} className={s.quiet}>
                  <span><span className={s.nm}>{c.name}</span><span className={s.whyBlock}>{ptText(c.decision.reason)}</span></span>
                  <span className={s.num}>{formatMoney(c.decision.spend)}</span>
                  <span className={s.num}>{formatRoas(c.decision.roas)}</span>
                </div>
              ))}
            </details>
          )}
          {paused.length > 0 && (
            <details className={s.collapse}>
              <summary>
                <Icon name="chev" size={13} className={s.chev} />
                {plural(paused.length, 'campanha pausada', 'campanhas pausadas')} — sem recomendação
              </summary>
              {paused.map(c => (
                <div key={c.campaignId ?? c.name} className={s.quiet}>
                  <span className={s.nm}>{c.name}</span>
                  <span className={s.num}>{formatMoney(c.decision.spend)} gastos</span>
                  <span className={s.muted}>
                    {c.decision.margin !== null ? `estava com margem de ${formatPct(c.decision.margin, { digits: 0 })}` : `ROAS ${formatRoas(c.decision.roas)}`}
                  </span>
                </div>
              ))}
            </details>
          )}
        </>
      )}
    </Block>
  )
}
