/**
 * "O que o Meta credita × o que a loja vendeu" — the reconciliation strip of
 * the campaigns page, as the verdict's aside. Two bars (store revenue against
 * what Meta credits to the campaigns), then the bridge from the campaigns'
 * estimated profit to the store's real profit (see adsVerdict.ts for the
 * identity). Server component.
 *
 * Props: { rec: Reconciliation; rangeLabel: string; split?: boolean;
 *          elsewhere?: { spend; stores: string[] } | null — campaigns that sell
 *          here but are paid in another store's books (CAMP HALLOW's ads in
 *          EPOCH's account): named under the total, never added to it }
 */

import { Badge, EmptyState, Icon } from '@/components/ui'
import { formatMoney, formatPct, plural } from '@/lib/format'
import type { Reconciliation } from './adsVerdict'
import { WhyEmpty, type EmptyWindowText } from './emptyWhy'
import s from './campaigns.module.css'

const signed = (v: number) => formatMoney(v, { sign: true })

export function ReconciliationLedger({ rec, rangeLabel, split, elsewhere, why = null }: {
  rec: Reconciliation; rangeLabel: string; split?: boolean; elsewhere?: { spend: number; stores: string[] } | null
  /** The verdict's reason the window is empty (./emptyWhy): before the first
   *  sale or after the archive day there was nothing to compare, not a window
   *  read and found empty. */
  why?: EmptyWindowText | null
}) {
  const top = Math.max(rec.storeRevenue, rec.credited + rec.creditedShared, 1e-9)
  const pctOfStore = (v: number) => (rec.storeRevenue > 0 ? formatPct((v / rec.storeRevenue) * 100, { digits: 0 }) : '—')
  const ratePct = rec.rate !== null ? formatPct(rec.rate * 100) : null

  const head = (
    <div className={s.recHead}>
      <div className={s.recTitle}>O que o Meta credita × o que a loja vendeu</div>
      <div className={s.recSub}>Das campanhas ao lucro real da loja, em {rangeLabel}</div>
    </div>
  )

  if (rec.metaSpend <= 0 && rec.storeRevenue <= 0) {
    return (
      <div>
        {head}
        {why ? <WhyEmpty why={why} /> : <EmptyState compact title="Sem vendas e sem gasto no Meta">Não há nada para comparar neste período.</EmptyState>}
      </div>
    )
  }

  return (
    <div>
      {head}
      <div className={s.bars} role="img" aria-label={`Loja vendeu ${formatMoney(rec.storeRevenue)}; o Meta credita ${formatMoney(rec.credited)} às campanhas`}>
        <div className={s.barRow}>
          <span>Vendas da loja</span>
          <span className={s.barTrack}><i className={s.barFill} style={{ width: `${(rec.storeRevenue / top) * 100}%` }} /></span>
          <span className={s.barVal}>{formatMoney(rec.storeRevenue)}</span>
        </div>
        <div className={s.barRow}>
          <span>Creditado pelo Meta</span>
          <span className={s.barTrack}><i className={`${s.barFill} ${s.barMeta}`} style={{ width: `${(rec.credited / top) * 100}%` }} /></span>
          <span className={s.barVal}>{formatMoney(rec.credited)}</span>
        </div>
      </div>

      {!rec.configured || !rec.bridge ? (
        <table className={s.recTable}>
          <tbody>
            <tr>
              <td><span className={s.op} /><span className={s.nm}>Vendas da loja</span><span className={s.sub}>{plural(rec.orders, 'pedido', 'pedidos')} na Shopify</span></td>
              <td className={s.v}>{formatMoney(rec.storeRevenue)}</td>
            </tr>
            <tr>
              <td><span className={s.op}>−</span><span className={s.nm}>Anúncios</span><span className={s.sub}>Meta e Shop Campaigns</span></td>
              <td className={s.v}>{formatMoney(rec.revenueMinusAds - rec.storeRevenue)}</td>
            </tr>
            <tr className={s.total}>
              <td>
                <span className={s.op}>=</span><span className={s.nm}>Vendas − anúncios</span>
                <span className={s.sub}>{rec.configured ? 'sem vendas na loja, não há margem para estimar as campanhas' : 'não é lucro: falta o custo dos produtos'}</span>
              </td>
              <td className={`${s.v} ${rec.revenueMinusAds < 0 ? s.neg : ''}`}>{formatMoney(rec.revenueMinusAds)}</td>
            </tr>
            {!rec.configured && (
              <tr>
                <td colSpan={2}><Badge tone="warn" icon="alert">custos não configurados</Badge></td>
              </tr>
            )}
          </tbody>
        </table>
      ) : (
        <table className={s.recTable}>
          <tbody>
            <tr>
              <td>
                <span className={s.op} /><span className={s.nm}>Campanhas · lucro estimado</span>
                <span className={s.sub}>{formatMoney(rec.credited)} creditados ({pctOfStore(rec.credited)} das vendas) × {ratePct} − gasto</span>
              </td>
              <td className={`${s.v} ${rec.bridge.campaigns < 0 ? s.neg : ''}`}>{formatMoney(rec.bridge.campaigns)}</td>
            </tr>
            <tr>
              <td>
                <span className={s.op}>{rec.uncredited >= 0 ? '+' : '−'}</span>
                <span className={s.nm}>{rec.uncredited >= 0 ? 'Vendas sem campanha' : 'Crédito a mais do Meta'}</span>
                <span className={s.sub}>
                  {rec.uncredited >= 0
                    ? `${formatMoney(rec.uncredited)} que o Meta não credita a nenhuma campanha × ${ratePct}`
                    : `o Meta credita ${formatMoney(-rec.uncredited)} além do que a loja vendeu × ${ratePct}`}
                </span>
              </td>
              <td className={`${s.v} ${rec.bridge.uncreditedContribution < 0 ? s.neg : ''}`}>{signed(rec.bridge.uncreditedContribution)}</td>
            </tr>
            {rec.bridge.unpricedSpend > 0 && (
              <tr>
                <td>
                  <span className={s.op}>−</span><span className={s.nm}>Campanhas de conta compartilhada</span>
                  <span className={s.sub}>gasto nesta loja, vendas possivelmente em outra ({formatMoney(rec.creditedShared)} creditados a elas)</span>
                </td>
                <td className={s.v}>{formatMoney(-rec.bridge.unpricedSpend)}</td>
              </tr>
            )}
            {rec.bridge.shopSpend > 0 && (
              <tr>
                <td><span className={s.op}>−</span><span className={s.nm}>Anúncios Shopify</span><span className={s.sub}>Shop Campaigns, fora do Meta</span></td>
                <td className={s.v}>{formatMoney(-rec.bridge.shopSpend)}</td>
              </tr>
            )}
            {rec.bridge.fixedCosts > 0 && (
              <tr>
                <td><span className={s.op}>−</span><span className={s.nm}>Custos fixos</span><span className={s.sub}>não crescem com o gasto no Meta</span></td>
                <td className={s.v}>{formatMoney(-rec.bridge.fixedCosts)}</td>
              </tr>
            )}
            {Math.abs(rec.bridge.residual) >= 0.5 && (
              <tr>
                <td><span className={s.op}>±</span><span className={s.nm}>Diferença lista × contabilidade</span><span className={s.sub}>gasto que a lista de campanhas não explica</span></td>
                <td className={s.v}>{signed(rec.bridge.residual)}</td>
              </tr>
            )}
            <tr className={s.total}>
              <td><span className={s.op}>=</span><span className={s.nm}>Lucro real da loja</span><span className={s.sub}>o mesmo número do Resumo, depois de todos os custos</span></td>
              <td className={`${s.v} ${rec.bridge.storeProfit < 0 ? s.neg : s.pos}`}>{formatMoney(rec.bridge.storeProfit)}</td>
            </tr>
            {split && (
              <tr className={s.part}>
                <td><span className={s.op} /><span className={s.nm}>Sua parte (50%)</span></td>
                <td className={`${s.v} ${rec.bridge.storeProfit < 0 ? s.neg : ''}`}>{formatMoney(rec.bridge.storeProfit * 0.5)}</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
      {elsewhere && elsewhere.spend > 0 && (
        <p className={`${s.small} ${s.recFoot}`}>
          <b className="warn"><Icon name="alert" size={12} /> Fora desta conta:</b> {formatMoney(elsewhere.spend)} de gasto de campanhas pagas na conta da {elsewhere.stores.join(' e ')} que vendem sobretudo aqui (a campanha inteira; a Atribuição soma só os anúncios com pedido creditado nesta loja).
          Esse gasto está no lucro de lá, não neste — some as duas lojas para julgar.
        </p>
      )}
      <p className={`${s.small} ${s.recFoot}`}>
        Por isso a soma das campanhas não é o lucro da loja: julgue cada campanha pelo veredito e a loja pelo lucro real.
      </p>
    </div>
  )
}
