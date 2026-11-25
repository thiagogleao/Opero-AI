/**
 * BreakdownBar and BreakdownLedger — "Para onde foi cada dólar", from an
 * engine PnL. Server-safe. Feed them the SAME totals the verdict judged
 * (verdict.totals) so the ledger and the big number always agree.
 *
 *   <BreakdownBar pnl={v.totals} configured={v.basis !== 'revenue_minus_ads'} />
 *   <BreakdownLedger pnl={v.totals} configured={…} split={ctx.split}
 *     title="Para onde foi cada dólar" sub={`De cada $1,00 vendido em ${ctx.rangeLabel}`} />
 *
 * Lines (bar segments in the same order): Vendas · Custo dos produtos · Frete ·
 * Taxas Shopify e pagamento · Extras por pedido (only when > 0) · Anúncios Meta · Anúncios Shopify · Custos
 * fixos · = Lucro real · then, when refunds or chargebacks arrived, − Reembolsos
 * e chargebacks · = Resultado de caixa. Each line shows its value and the ¢ of
 * each dollar sold (largest-remainder rounding, adds to 100 when in profit);
 * a share past a dollar prints in dollars ("$2,62", components/ui/perDollar),
 * and with no sales the bar's legend prints money instead of shares.
 *
 * Honest states: a store without cost settings shows "não configurado" on
 * product, shipping, fees and fixed costs and its total is "Vendas − anúncios";
 * a zero line reads "nenhum cadastrado" instead of a silent $0; a window with
 * no orders, no spend and no refunds shows "Sem vendas no período" instead of
 * a table of zeros (ads without sales still get the full ledger). In the partner
 * split the ledger stays whole (it must add up) and a "Sua parte (50%)" line
 * follows the profit and the cash result.
 *
 * BreakdownBar props:    { pnl: PnL; configured?: boolean (default true);
 *                          size?: 'md'|'thin' (thin = phone, legend carries the ¢);
 *                          legend?: boolean (default true) }
 * BreakdownLedger props: { pnl: PnL; configured?: boolean; split?: boolean;
 *                          title?: ReactNode; sub?: ReactNode; bar?: boolean (draw the
 *                          BreakdownBar above the table, default true);
 *                          notes?: Partial<Record<LedgerKey, ReactNode>> (override a line's
 *                          small print, e.g. { cogs: 'tabela do fornecedor…' });
 *                          emptyTitle?, emptyText?: ReactNode (the no-sales state's words,
 *                          e.g. "A loja ainda não vendia" before the first sale) }
 * LedgerKey: 'revenue'|'cogs'|'shipping'|'fees'|'extras'|'meta'|'shop'|'fixed'|'profit'|'adjustments'|'cash'
 */

import type { ReactNode } from 'react'
import type { PnL } from '@/lib/engine/pnl'
import { centsOfDollar, formatMoney, plural } from '@/lib/format'
import { EmptyState } from './Card'
import { Badge } from './Chip'
import { formatPerDollar, perDollarPhrase } from './perDollar'
import s from './Kpi.module.css'

export type LedgerKey = 'revenue' | 'cogs' | 'shipping' | 'fees' | 'extras' | 'meta' | 'shop' | 'fixed' | 'profit' | 'adjustments' | 'cash'

interface Part { key: LedgerKey; name: string; short: string; value: number; sw: string }

/** The cost parts of a PnL, in the order they are drawn. */
function costParts(p: PnL): Part[] {
  return [
    { key: 'cogs', name: 'Custo dos produtos', short: 'produto', value: p.productCost, sw: s.cogs },
    { key: 'shipping', name: 'Frete', short: 'frete', value: p.shipping, sw: s.ship },
    { key: 'fees', name: 'Taxas Shopify e pagamento', short: 'taxas', value: p.fees, sw: s.fees },
    { key: 'extras', name: 'Extras por pedido', short: 'extras', value: p.perOrderExtras, sw: s.fees },
    // Meta before Shopify ads, as in mockup C: the big lever first.
    { key: 'meta', name: 'Anúncios Meta', short: 'Meta', value: p.metaSpend, sw: s.meta },
    { key: 'shop', name: 'Anúncios Shopify', short: 'Anúncios Shopify', value: p.shopSpend, sw: s.shop },
    { key: 'fixed', name: 'Custos fixos', short: 'fixos', value: p.fixedCosts, sw: s.fixed },
  ]
}

/**
 * The legend's lead and how each part is printed. Costs above the sales get
 * "Para cada $1 vendido: $2,62 Meta" (formatPerDollar), never "262¢"; with no
 * sales at all there is no dollar to divide, so the parts print in money.
 */
function shareFormat(rev: number, over: boolean) {
  if (!(rev > 0)) return { lead: 'Nenhuma venda:', part: (_c: number, v: number) => formatMoney(v) }
  return { lead: over ? 'Para cada $1 vendido:' : 'De cada $1:', part: (c: number) => formatPerDollar(c) }
}

export function BreakdownBar({ pnl, configured = true, size = 'md', legend = true }: {
  pnl: PnL; configured?: boolean; size?: 'md' | 'thin'; legend?: boolean
}) {
  const rev = Math.max(0, pnl.revenue)
  const thin = size === 'thin'
  if (!configured) {
    // Only the ads are known; what is left is NOT profit (product costs missing).
    const left = Math.max(0, rev - pnl.adSpend)
    const parts = [
      { k: 'meta', label: 'Meta', v: pnl.metaSpend, cls: s.meta },
      { k: 'shop', label: 'Anúncios Shopify', v: pnl.shopSpend, cls: s.shop },
    ].filter(x => x.v > 0)
    const over = pnl.adSpend > rev
    const total = Math.max(rev, pnl.adSpend)
    const cents = centsOfDollar([...parts.map(p => p.v), left], rev)
    const fmt = shareFormat(rev, over)
    const aria = rev > 0
      ? `Anúncios ${formatMoney(pnl.adSpend)} de ${formatMoney(rev)} vendidos (${perDollarPhrase((pnl.adSpend / rev) * 100)}); custos de produto não configurados`
      : `Nenhuma venda; ${formatMoney(pnl.adSpend)} em anúncios; custos de produto não configurados`
    return (
      <div>
        <div className={`${s.stack} ${thin ? s.stackThin : ''}`} role="img" aria-label={aria}>
          {parts.map((p, i) => (
            <span key={p.k} className={`${s.seg} ${p.cls}`} style={{ flex: `${p.v / Math.max(total, 1e-9)} 0 0` }}
                  title={rev > 0 ? `${p.label}: ${formatMoney(p.v)} · ${perDollarPhrase(cents[i])}` : `${p.label}: ${formatMoney(p.v)}`}>
              {!thin && rev > 0 && cents[i] >= 7 ? formatPerDollar(cents[i]) : ''}
            </span>
          ))}
          {left > 0 && <span className={`${s.seg} ${s.segLeft}`} style={{ flex: `${left / total} 0 0` }}>{!thin && cents[parts.length] >= 12 ? 'sobra antes do custo dos produtos' : ''}</span>}
          {over && rev > 0 && <span className={s.revMark} style={{ left: `${(rev / total) * 100}%` }} title="até aqui, as vendas" />}
        </div>
        {legend && (
          <div className={s.cents}>
            <span className={s.centsLead}>{fmt.lead}</span>
            {parts.map((p, i) => <span key={p.k}><i className={p.cls} /><b>{fmt.part(cents[i], p.v)}</b> {p.label}</span>)}
            {over && rev > 0 && <span><i className={s.markSw} />até aqui, as vendas: os anúncios passaram delas</span>}
            <span><i className={s.leftSw} />custo dos produtos não configurado</span>
          </div>
        )}
      </div>
    )
  }

  const costs = costParts(pnl).filter(p => p.value > 0)
  const profit = pnl.operatingProfit
  const costTotal = costs.reduce((a, p) => a + p.value, 0)
  const loss = profit < 0
  const total = loss ? costTotal : rev
  const values = [...costs.map(p => p.value), ...(loss ? [] : [profit])]
  const cents = centsOfDollar(values, rev)
  const fmt = shareFormat(rev, loss)
  const label = !(rev > 0)
    ? `Nenhuma venda: ${costs.map(p => `${p.short} ${formatMoney(p.value)}`).join(', ')}; prejuízo de ${formatMoney(-profit)}`
    : loss
      ? `Custos de ${formatMoney(costTotal)} contra ${formatMoney(rev)} vendidos: prejuízo de ${formatMoney(-profit)}`
      : `De ${formatMoney(rev)} vendidos: ${costs.map((p, i) => `${p.short} ${formatPerDollar(cents[i])}`).join(', ')}, lucro ${formatPerDollar(cents[costs.length])}`

  return (
    <div>
      <div className={`${s.stack} ${thin ? s.stackThin : ''}`} role="img" aria-label={label}>
        {costs.map((p, i) => (
          <span key={p.key} className={`${s.seg} ${p.sw} ${p.key === 'fixed' || p.key === 'shipping' ? s.segLight : ''}`}
                style={{ flex: `${p.value / Math.max(total, 1e-9)} 0 0` }}
                title={rev > 0 ? `${p.name}: ${formatMoney(p.value)} · ${perDollarPhrase(cents[i])}` : `${p.name}: ${formatMoney(p.value)}`}>
            {!thin && rev > 0 && cents[i] >= 6 ? formatPerDollar(cents[i]) : ''}
          </span>
        ))}
        {!loss && profit > 0 && (
          <span className={`${s.seg} ${s.profit}`} style={{ flex: `${profit / Math.max(total, 1e-9)} 0 0` }} title={`Lucro real: ${formatMoney(profit)}`}>
            {!thin && cents[costs.length] >= 6 ? formatPerDollar(cents[costs.length]) : ''}
          </span>
        )}
        {loss && rev > 0 && <span className={s.revMark} style={{ left: `${(rev / total) * 100}%` }} title="até aqui, as vendas" />}
      </div>
      {legend && (
        <div className={s.cents}>
          <span className={s.centsLead}>{fmt.lead}</span>
          {costs.map((p, i) => <span key={p.key}><i className={p.sw} /><b>{fmt.part(cents[i], p.value)}</b> {p.short}</span>)}
          {!loss
            ? <span><i className={s.profit} /><b>{formatPerDollar(cents[costs.length] ?? 0)}</b> lucro</span>
            : <span><i className={s.lossSw} /><b className="neg">{formatMoney(profit)}</b> prejuízo: {rev > 0 ? 'os custos passaram das vendas' : 'custos sem nenhuma venda'}</span>}
        </div>
      )}
    </div>
  )
}

export interface BreakdownLedgerProps {
  pnl: PnL
  configured?: boolean
  split?: boolean
  title?: ReactNode
  sub?: ReactNode
  bar?: boolean
  notes?: Partial<Record<LedgerKey, ReactNode>>
  /** The empty state's words when the default "Sem vendas no período" would
   *  mislead (a window before the store's first sale: "A loja ainda não vendia"). */
  emptyTitle?: ReactNode
  emptyText?: ReactNode
  /** The rows in a native <details>, closed by default (summary "Ver as N
   *  linhas"): header, ¢ bar and "De cada $1" legend stay visible. The phone
   *  home uses it to keep its fold for the numbers. Default false. */
  collapsibleRows?: boolean
}

export function BreakdownLedger({ pnl, configured = true, split, title, sub, bar = true, notes = {}, emptyTitle, emptyText, collapsibleRows = false }: BreakdownLedgerProps) {
  const rev = pnl.revenue
  const parts = costParts(pnl)
  const profitBase = configured ? pnl.operatingProfit : pnl.revenue - pnl.adSpend
  const shown = parts.filter(p => p.key !== 'extras' || p.value > 0)
  const cents = centsOfDollar([...shown.map(p => (configured || p.key === 'meta' || p.key === 'shop' ? p.value : 0)), Math.max(0, profitBase)], rev)
  // The column reads "per dollar sold" (Vendas = $1,00): cents up to a dollar,
  // dollars past it ("$2,62", not "262¢", when the ads passed the sales).
  const ct = (i: number) => (rev > 0 ? formatPerDollar(cents[i]) : '—')
  const ctTitle = (c: number) => (rev > 0 ? perDollarPhrase(c) : undefined)
  const totalShare = rev > 0 ? (profitBase >= 0 ? cents[shown.length] : (profitBase / rev) * 100) : null
  const unknown = (k: LedgerKey) => !configured && (k === 'cogs' || k === 'shipping' || k === 'fees' || k === 'fixed' || k === 'extras')

  const defaultNote: Partial<Record<LedgerKey, ReactNode>> = {
    revenue: `${plural(pnl.orders, 'pedido', 'pedidos')}, valor pago pelos clientes`,
    // Both amounts are the window's totals, not a per-order or per-unit price
    // ("já descontados $1.158 por unidade extra" read like $1.158 a unit). The
    // engine PnL does not carry the per-unit discount itself, so it is not named.
    cogs: pnl.unitSavings > 0 || pnl.supplierFees > 0
      ? [
          pnl.supplierFees > 0 ? `inclui ${formatMoney(pnl.supplierFees)} de taxas por pedido do fornecedor, somadas no período` : null,
          pnl.unitSavings > 0 ? `já descontados ${formatMoney(pnl.unitSavings)} no período (desconto nas unidades extras do mesmo pedido)` : null,
        ].filter(Boolean).join(' · ')
      : undefined,
    shipping: 'tarifa de entrega cadastrada por país',
    extras: 'custos cadastrados por pedido',
    meta: 'Facebook e Instagram',
    shop: 'Shop Campaigns, cobrados pela Shopify, fora do Meta',
    fixed: 'apps, equipe e ferramentas, rateados por dia',
  }
  const zeroNote: Partial<Record<LedgerKey, string>> = {
    shipping: 'nenhuma tarifa de frete cadastrada à parte',
    shop: 'nenhum gasto com Shop Campaigns',
    meta: 'nenhum gasto no Meta',
    fixed: 'nenhum cadastrado (apps, equipe, ferramentas)',
  }

  const head = (title || sub) && (
    <div style={{ marginBottom: 12 }}>
      {title && <div style={{ fontWeight: 600, fontSize: 15 }}>{title}</div>}
      {sub && <div style={{ fontSize: 12.5, color: 'var(--tx-3)', marginTop: 2 }}>{sub}</div>}
    </div>
  )

  // Nothing sold, nothing spent, nothing refunded: a ledger of $0 lines would
  // be the "fake $0" the brief forbids. Say there is nothing to split.
  if (pnl.orders === 0 && pnl.revenue <= 0 && pnl.adSpend <= 0 && pnl.adjustments <= 0 && pnl.fixedCosts <= 0) {
    return (
      <div>
        {head}
        <EmptyState compact icon={emptyTitle ? 'clock' : 'ring'} title={emptyTitle ?? 'Sem vendas no período'}>
          {emptyText ?? 'Nenhum pedido e nenhum gasto com anúncios: não há dólar para dividir.'}
        </EmptyState>
      </div>
    )
  }

  const rowCount = 2 + shown.length + (split ? 1 : 0) + (pnl.adjustments > 0 ? (split ? 3 : 2) : 0)
  const table = (
    <table className={s.ledger} style={{ marginTop: bar ? 14 : 0 }}>
      <tbody>
        <tr className={s.rowRev}>
          <td className={s.sw} />
          <td><span className={s.op} /><span className={s.nm}>Vendas</span><span className={s.sub}>{notes.revenue ?? defaultNote.revenue}</span></td>
          <td className={s.v}>{formatMoney(rev)}</td>
          <td className={s.ct}>{rev > 0 ? '$1,00' : '—'}</td>
        </tr>
        {shown.map((p, i) => {
          const isUnknown = unknown(p.key)
          const zero = !isUnknown && p.value === 0
          const note = notes[p.key] ?? (zero ? zeroNote[p.key] : defaultNote[p.key])
          return (
            <tr key={p.key} className={zero || isUnknown ? s.rowZero : undefined}>
              <td className={s.sw}><span className={`${s.swk} ${zero || isUnknown ? s.swEmpty : p.sw}`} /></td>
              <td>
                <span className={s.op}>−</span><span className={s.nm}>{p.name}</span>
                {/* The "why" once, on the first unknown line; the badges carry the rest. */}
                {isUnknown
                  ? p.key === 'cogs' && <span className={s.sub}>sem custos configurados: o lucro real é menor que o mostrado</span>
                  : note && <span className={s.sub}>{note}</span>}
              </td>
              <td className={s.v}>
                {isUnknown ? <Badge tone="warn" icon="alert">não configurado</Badge> : zero ? '$0' : `${formatMoney(-p.value)}`}
              </td>
              <td className={s.ct} title={isUnknown ? undefined : ctTitle(cents[i])}>{isUnknown ? '—' : ct(i)}</td>
            </tr>
          )
        })}
        <tr className={s.rowTotal}>
          <td className={s.sw}><span className={`${s.swk} ${configured ? s.profit : s.swEmpty}`} /></td>
          <td>
            <span className={s.op}>=</span><span className={s.nm}>{configured ? 'Lucro real' : 'Vendas − anúncios'}</span>
            {!configured && <span className={s.sub}>{notes.profit ?? 'não é lucro: falta o custo dos produtos'}</span>}
            {configured && notes.profit && <span className={s.sub}>{notes.profit}</span>}
          </td>
          <td className={`${s.v} ${profitBase < 0 ? s.vNegT : configured ? s.vPosT : ''}`}>{formatMoney(profitBase)}</td>
          <td className={s.ct} title={totalShare === null ? undefined : ctTitle(totalShare)}>{totalShare === null ? '—' : formatPerDollar(totalShare)}</td>
        </tr>
        {split && (
          <tr className={s.rowPart}>
            <td className={s.sw} />
            <td><span className={s.op} /><span className={s.nm}>Sua parte (50%)</span></td>
            <td className={`${s.v} ${profitBase < 0 ? s.vNegT : ''}`}>{formatMoney(profitBase * 0.5)}</td>
            <td className={s.ct} />
          </tr>
        )}
        {pnl.adjustments > 0 && (
          <>
            <tr>
              <td className={s.sw}><span className={`${s.swk} ${s.swEmpty}`} /></td>
              <td>
                <span className={s.op}>−</span><span className={s.nm}>Reembolsos e chargebacks</span>
                <span className={s.sub}>
                  {notes.adjustments ?? [
                    pnl.refundCount ? `${plural(pnl.refundCount, 'reembolso', 'reembolsos')} (a margem que voltou)` : null,
                    pnl.chargebackCount ? plural(pnl.chargebackCount, 'chargeback', 'chargebacks') : null,
                  ].filter(Boolean).join(' · ')}
                </span>
              </td>
              <td className={s.v}>{formatMoney(-pnl.adjustments)}</td>
              <td className={s.ct} />
            </tr>
            <tr className={s.rowTotal}>
              <td className={s.sw} />
              <td><span className={s.op}>=</span><span className={s.nm}>Resultado de caixa</span>{notes.cash && <span className={s.sub}>{notes.cash}</span>}</td>
              <td className={`${s.v} ${pnl.cashResult < 0 ? s.vNegT : ''}`}>{formatMoney(pnl.cashResult)}</td>
              <td className={s.ct} />
            </tr>
            {split && (
              <tr className={s.rowPart}>
                <td className={s.sw} />
                <td><span className={s.op} /><span className={s.nm}>Sua parte (50%)</span></td>
                <td className={s.v}>{formatMoney(pnl.cashResult * 0.5)}</td>
                <td className={s.ct} />
              </tr>
            )}
          </>
        )}
      </tbody>
    </table>
  )

  return (
    <div>
      {head}
      {bar && <BreakdownBar pnl={pnl} configured={configured} />}
      {collapsibleRows ? (
        <details className={s.ledgerRows}>
          <summary className={s.ledgerSummary}>Ver as {rowCount} linhas</summary>
          {table}
        </details>
      ) : table}
    </div>
  )
}
