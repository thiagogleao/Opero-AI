/**
 * Customers and funnel blocks of "Países e clientes" (server components):
 *  - CustomersSplit: new vs returning vs guest orders (lib/data/customers:
 *    row_number over the customer's whole collected history; guests apart);
 *  - LtvBlock: lifetime value over the whole history, counted from orders;
 *  - CustomersByStore: the same per store, for "Todas";
 *  - FunnelBlock: Meta's measured steps only, Shopify's orders and abandoned
 *    checkouts apart, Meta purchases ÷ real orders shown as capture.
 */

import type { CustomerLtv, CustomerSplit } from '@/lib/data/customers'
import type { FunnelReport } from '@/lib/data/funnel'
import {
  Block, Callout, Count, DataTable, EmptyState, KpiCard, KpiGrid, Money, Pct, type DataColumn, type DataRow,
} from '@/components/ui'
import { formatCount, formatDate, formatMoney, formatPct, plural } from '@/lib/format'
import s from './countries.module.css'

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null)

export function historyNote(historyStart: string | null, today: string): string {
  return historyStart
    ? `"Novo" = primeiro pedido do cliente desde ${formatDate(historyStart, today)}, quando o Opero começou a guardar os pedidos desta loja. Quem comprou antes disso conta como novo no primeiro pedido guardado.`
    : '"Novo" = primeiro pedido do cliente nos pedidos que o Opero guardou.'
}

export function CustomersSplit({ split, today, rangeLabel }: { split: CustomerSplit; today: string; rangeLabel: string }) {
  if (split.orders === 0) {
    return (
      <Block title="Clientes novos e recompra" howTo="Quem comprou pela primeira vez e quem voltou.">
        <EmptyState compact title="Nenhum pedido no período" />
      </Block>
    )
  }
  const identified = split.orders - split.guestOrders
  return (
    <Block
      title="Clientes novos e recompra"
      howTo={`Cada pedido de ${rangeLabel} pelo lugar dele no histórico do cliente: o primeiro é "novo", os seguintes são "recompra". Sem cadastro fica à parte.`}
      info={historyNote(split.historyStart, today)}
    >
      <KpiGrid>
        <KpiCard label="Pedidos de clientes novos" value={<Count value={split.newOrders} />}
          note={<><b>{formatPct(pct(split.newOrders, split.orders), { digits: 0 })}</b> dos pedidos · <b>{formatMoney(split.newRevenue)}</b></>} />
        <KpiCard label="Pedidos de recompra" value={<Count value={split.returningOrders} />}
          note={<><b>{formatPct(pct(split.returningOrders, split.orders), { digits: 0 })}</b> dos pedidos · <b>{formatMoney(split.returningRevenue)}</b></>}
          info="Pedidos de quem já tinha comprado antes, dentro ou antes do período." />
        <KpiCard label="Sem cadastro" value={<Count value={split.guestOrders} />} tone={split.guestOrders ? undefined : 'mut'}
          note={<>checkout sem cliente · <b>{formatMoney(split.guestRevenue)}</b></>}
          info="Pedidos sem cliente identificado: não dá para saber se é novo ou recompra." />
        <KpiCard label="Clientes" value={<Count value={split.customers} />}
          note={<><b>{formatCount(split.newCustomers)}</b> {split.newCustomers === 1 ? 'novo' : 'novos'} · <b>{formatCount(split.returningCustomers)}</b> {split.returningCustomers === 1 ? 'já conhecido' : 'já conhecidos'}</>}
          footnote={split.repeatOrdersOfNewCustomers > 0 ? `${plural(split.repeatOrdersOfNewCustomers, 'recompra', 'recompras')} de clientes que estrearam no período` : undefined} />
      </KpiGrid>
      <p className={`${s.small} ${s.gapTop}`}>
        Recompra = {formatPct(split.repeatOrderPct)} dos {plural(identified, 'pedido identificado', 'pedidos identificados')}. {historyNote(split.historyStart, today)}
      </p>
    </Block>
  )
}

export function LtvBlock({ ltv, today }: { ltv: CustomerLtv; today: string }) {
  if (ltv.customers === 0) {
    return (
      <Block title="Valor do cliente (LTV)" howTo="Quanto cada cliente comprou desde o primeiro pedido.">
        <EmptyState compact title="Nenhum cliente identificado ainda" />
      </Block>
    )
  }
  const columns: DataColumn[] = [
    { key: 'segment', label: 'Clientes com' },
    { key: 'customers', label: 'Clientes', numeric: true },
    { key: 'pct', label: '%', numeric: true },
    { key: 'avgOrders', label: 'Pedidos/cliente', numeric: true },
    { key: 'avgLtv', label: 'LTV médio', numeric: true },
  ]
  const rows: DataRow[] = ltv.buckets.map(b => ({
    key: b.segment,
    tone: b.customers ? undefined : 'mut',
    cells: {
      segment: <span>{b.segment}</span>,
      customers: <Count value={b.customers} />,
      pct: <Pct value={b.pct} />,
      avgOrders: <span>{b.avgOrders === null ? '—' : b.avgOrders.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}</span>,
      avgLtv: <Money value={b.avgLtv} />,
    },
  }))
  return (
    <Block
      title="Valor do cliente (LTV) · histórico completo"
      howTo={`Tudo o que cada cliente comprou desde ${ltv.historyStart ? formatDate(ltv.historyStart, today) : 'o primeiro pedido guardado'}, não só no período escolhido.`}
      info="Contado dos próprios pedidos (não reembolsados), não do contador de pedidos do cadastro da Shopify, que o coletor sobrescreve e subconta a recompra."
      flush
      footer={ltv.guestOrders > 0 ? <span>{plural(ltv.guestOrders, 'pedido sem cadastro fica', 'pedidos sem cadastro ficam')} fora do LTV.</span> : undefined}
    >
      <div className={s.kpiPad}>
        <KpiGrid>
          <KpiCard label="LTV médio" value={<Money value={ltv.avgLtv} />} note={<>em <b>{ltv.avgOrders === null ? '—' : ltv.avgOrders.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}</b> {ltv.avgOrders !== null && ltv.avgOrders < 1.005 ? 'pedido' : 'pedidos'} por cliente</>} />
          <KpiCard label="Voltaram a comprar" value={<Pct value={ltv.repeatCustomerPct} />} note={<><b>{formatCount(ltv.repeatCustomers)}</b> de {formatCount(ltv.customers)} clientes</>} />
          <KpiCard label="Receita identificada" value={<Money value={ltv.revenue} />} note={<><b>{formatCount(ltv.orders)}</b> {ltv.orders === 1 ? 'pedido' : 'pedidos'} de clientes com cadastro</>} />
        </KpiGrid>
      </div>
      <DataTable caption="Clientes por número de pedidos, histórico completo" columns={columns} rows={rows} dense />
    </Block>
  )
}

export interface StoreCustomers {
  id: string
  name: string
  split: CustomerSplit | null
  ltv: CustomerLtv | null
}

export function CustomersByStore({ stores, rangeLabel }: { stores: StoreCustomers[]; rangeLabel: string }) {
  const columns: DataColumn[] = [
    { key: 'store', label: 'Loja' },
    { key: 'orders', label: 'Pedidos', numeric: true, sortable: true },
    { key: 'new', label: 'Novos', numeric: true, sortable: true },
    { key: 'returning', label: 'Recompra', numeric: true, sortable: true },
    { key: 'guest', label: 'Sem cadastro', numeric: true, sortable: true },
    { key: 'repeat', label: '% recompra', numeric: true, sortable: true, info: 'Pedidos de recompra ÷ pedidos com cliente identificado, no período.' },
    { key: 'ltv', label: 'LTV médio (histórico)', numeric: true, sortable: true, info: 'Tudo o que cada cliente comprou desde o primeiro pedido guardado, contado dos pedidos.' },
    { key: 'back', label: 'Voltaram (histórico)', numeric: true, sortable: true },
  ]
  const rows: DataRow[] = stores.map(st => {
    const sp = st.split, l = st.ltv
    return {
      key: st.id,
      tone: sp && sp.orders > 0 ? undefined : 'mut',
      cells: {
        store: <span className={s.cName}>{st.name}</span>,
        orders: <Count value={sp?.orders ?? null} />,
        new: <Count value={sp?.newOrders ?? null} />,
        returning: <Count value={sp?.returningOrders ?? null} />,
        guest: <Count value={sp?.guestOrders ?? null} />,
        repeat: <Pct value={sp?.repeatOrderPct ?? null} />,
        ltv: <Money value={l?.avgLtv ?? null} />,
        back: <Pct value={l?.repeatCustomerPct ?? null} />,
      },
      sort: {
        orders: sp?.orders ?? null, new: sp?.newOrders ?? null, returning: sp?.returningOrders ?? null,
        guest: sp?.guestOrders ?? null, repeat: sp?.repeatOrderPct ?? null, ltv: l?.avgLtv ?? null, back: l?.repeatCustomerPct ?? null,
      },
    }
  })
  return (
    <Block
      title="Clientes por loja"
      howTo={`Novos, recompra e sem cadastro em ${rangeLabel}; LTV sobre todo o histórico de cada loja. Cada loja tem os próprios clientes.`}
      info={'"Novo" = primeiro pedido do cliente nos pedidos que o Opero guardou de cada loja (as lojas começaram a ser coletadas em datas diferentes).'}
      flush
    >
      {/* Long headers ("LTV médio (histórico)") wrap instead of pushing the
          last column behind a scrollbar at 1024px. */}
      <div className={s.wrapHeads}>
        <DataTable caption="Clientes por loja" columns={columns} rows={rows} initialSort={{ key: 'orders', dir: 'desc' }} dense />
      </div>
    </Block>
  )
}

export function FunnelBlock({ funnel, rangeLabel, sharedNote }: {
  funnel: FunnelReport; rangeLabel: string
  /** The shared-account campaigns left out of the steps, the capture and the
   *  spend per order, in words (./sharedText), or null. */
  sharedNote?: string | null
}) {
  const steps = funnel.meta.steps
  const top = steps.length ? Math.max(...steps.map(x => x.value)) : 0
  const sh = funnel.shopify
  return (
    <Block
      title="Funil"
      howTo={`As etapas que o pixel do Meta mede em ${rangeLabel}, e os pedidos reais da Shopify à parte — são fontes diferentes e não se dividem uma pela outra como conversão.`}
      info="Uma etapa que o pixel não mede (sempre zero enquanto as seguintes têm valor) fica de fora. Quando uma etapa conta mais que a anterior, a taxa não é mostrada: o Meta conta cada etapa separadamente."
    >
      {steps.length === 0 ? (
        <EmptyState compact title="Sem anúncios no Meta no período">O pixel só mede o funil de quem veio de anúncio.</EmptyState>
      ) : (
        <div className={s.steps}>
          {steps.map(st => (
            <div key={st.key} className={s.step}>
              <span className={s.stepName}>{st.label}</span>
              <span className={s.stepTrack} aria-hidden="true"><i style={{ width: `${top > 0 ? Math.max(0.5, (st.value / top) * 100) : 0}%` }} /></span>
              <span className={s.stepVal}>{formatCount(st.value)}</span>
              <span className={s.stepRate}>
                {st.ratePct !== null
                  ? `${formatPct(st.ratePct)} da etapa anterior`
                  : st.exceedsPrevious ? 'acima da etapa anterior'
                    : st.key === 'impressions' ? (funnel.meta.cpm !== null ? `CPM ${formatMoney(funnel.meta.cpm, { cents: 'always' })}` : '')
                    : st.costPer !== null ? `${formatMoney(st.costPer, { cents: 'always' })} cada` : ''}
              </span>
            </div>
          ))}
        </div>
      )}
      {funnel.meta.omitted.length > 0 && (
        <p className={s.omitted}>Não medido pelo pixel desta loja: {funnel.meta.omitted.map(o => o.label.toLowerCase()).join(', ')}.</p>
      )}
      <div className={s.shopRow}>
        <span>Pedidos reais (Shopify) <b>{formatCount(sh.orders)}</b></span>
        <span>Checkouts abandonados <b>{formatCount(sh.abandonedCheckouts)}</b>{sh.abandonmentPct !== null ? ` (${formatPct(sh.abandonmentPct, { digits: 0 })} dos checkouts)` : ''}</span>
        {sh.costPerOrder !== null && <span>Gasto no Meta por pedido real <b>{formatMoney(sh.costPerOrder, { cents: 'always' })}</b></span>}
        {funnel.metaCapturePct !== null && (
          <span>O Meta diz ter visto <b>{formatPct(funnel.metaCapturePct, { digits: 0 })}</b> dos pedidos reais — captura, não conversão</span>
        )}
      </div>
      {sharedNote && <p className={s.omitted}>{sharedNote}</p>}
      <p className={s.omitted}>Checkouts abandonados são só contados: os valores gravados neles não são confiáveis.</p>
      {funnel.notes.map((n, i) => <Callout key={i} tone="neu">{n}</Callout>)}
    </Block>
  )
}
