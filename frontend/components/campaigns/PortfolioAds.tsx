/**
 * Campanhas in "Todas as lojas": the Meta spend of every store against its own
 * break-even, side by side, each row opening that store's campaigns. Campaigns
 * themselves are per store (one ad account, one margin), so the portfolio view
 * judges stores, not campaigns. Built from buildPortfolio rows (engine totals).
 *
 * Exports buildPortfolioAdsVerdict (pure) and <PortfolioAdsTable> (server).
 */

import type { PortfolioStoreRow } from '@/lib/views/portfolio'
import type { SharedAdAccount } from '@/lib/attributionModels'
import type { Verdict, VerdictChip, VerdictLine } from '@/lib/views/verdict'
import { sumTotals } from '@/lib/views/verdict'
import { Badge, Callout, DataTable, EmptyState, Money, Pct, type DataColumn, type DataRow } from '@/components/ui'
import { RoasCell } from './RoasCell'
import { formatMoney, formatRoas, plural } from '@/lib/format'
import s from './campaigns.module.css'

const line = (...parts: (string | { text: string; strong?: boolean; tone?: 'pos' | 'neg' | 'warn' })[]): VerdictLine => {
  const ps = parts.map(p => (typeof p === 'string' ? { text: p } : p))
  return { parts: ps, text: ps.map(p => p.text).join('') }
}
const joinNames = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`)

/** Does the store's whole revenue cover its Meta spend (ROAS da loja ≥ empate)? */
export function coversMeta(r: Pick<PortfolioStoreRow, 'configured' | 'totals'>): boolean | null {
  if (!r.configured || !(r.totals.metaSpend > 0)) return null
  return r.totals.contribution >= r.totals.metaSpend
}

export function buildPortfolioAdsVerdict(input: {
  stores: Pick<PortfolioStoreRow, 'id' | 'name' | 'configured' | 'totals'>[]
  rangeLabel: string
  periodPhrase: string
  partialLabel: string | null
  split?: boolean
}): Verdict {
  const { stores, periodPhrase } = input
  const totals = sumTotals(stores.map(r => r.totals))
  const spenders = stores.filter(r => r.totals.metaSpend > 0)
  const judged = spenders.filter(r => r.configured)
  const covering = judged.filter(r => coversMeta(r))
  const below = judged.filter(r => !coversMeta(r))
  const unconfigured = spenders.filter(r => !r.configured)
  const chips: VerdictChip[] = []
  const details: VerdictLine[] = []
  // The partial clock is a chip of its own; the date line stays the range.
  const when = input.rangeLabel
  const base = {
    when, totals, comparisonTotals: null, excluded: [], partial: !!input.partialLabel, split: !!input.split,
    storeCount: stores.length, roas: null, early: false, fewOrders: false,
  }

  if (!spenders.length) {
    chips.push({ code: 'sem_vendas', label: 'Sem gasto no Meta', tone: 'neu', icon: 'ring' })
    return {
      ...base, tone: 'neu', chips, headline: `Nenhuma loja gastou no Meta ${periodPhrase}.`,
      amount: null, amountTone: 'neu', amountCaption: 'sem gasto com anúncios no período',
      details: [line(`As lojas venderam ${formatMoney(totals.revenue)} ${periodPhrase} sem gasto no Meta.`)], notes: [], basis: 'none',
    }
  }

  if (covering.length) chips.push({ code: 'lucro', label: `${covering.length} ${covering.length === 1 ? 'cobriu' : 'cobriram'} o Meta`, tone: 'pos', icon: 'up' })
  if (below.length) chips.push({ code: 'prejuizo', label: `${below.length} abaixo do empate`, tone: 'neg', icon: 'down' })
  if (unconfigured.length) chips.push({ code: 'sem_custos', label: unconfigured.length === 1 ? '1 loja sem custos' : `${unconfigured.length} lojas sem custos`, tone: 'cfg', icon: 'sliders' })
  if (input.partialLabel) chips.push({ code: 'parcial', label: input.partialLabel, tone: 'info', icon: 'clock' })

  const headline = judged.length === 0
    ? `Suas lojas gastaram ${formatMoney(totals.metaSpend)} no Meta ${periodPhrase}, mas nenhuma delas tem custos para dizer se compensou.`
    : below.length === 0
      ? `Todas as lojas com custos cobriram o gasto no Meta ${periodPhrase}.`
      : covering.length === 0
        ? `Nenhuma loja cobriu o gasto no Meta ${periodPhrase}.`
        : `${covering.length} de ${judged.length} lojas cobriram o gasto no Meta ${periodPhrase} — ${joinNames(below.map(r => r.name))} ${below.length === 1 ? 'ficou' : 'ficaram'} abaixo do empate.`

  details.push(line('O Meta credita ', { text: formatMoney(totals.metaPurchaseValue), strong: true },
    ` em vendas às campanhas (ROAS atribuído ${formatRoas(totals.metaRoas)}); as lojas venderam `,
    { text: formatMoney(totals.revenue), strong: true }, ` no total (ROAS das lojas ${formatRoas(totals.roas)}).`))
  details.push(line('"Cobrir o Meta" = as vendas da loja, depois de produto, frete e taxas, pagam o gasto no Meta: ROAS da loja no empate ou acima. Cada loja tem o seu empate.'))
  if (unconfigured.length) {
    details.push(line(`${joinNames(unconfigured.map(r => r.name))} ${unconfigured.length === 1 ? 'não tem' : 'não têm'} custos configurados: sem empate, só vendas − anúncios.`))
  }
  // Shopify's own ads stay out of every ROAS (lead's rule), so a store that
  // advertises mostly there shows a huge "ROAS da loja" against a tiny Meta
  // spend. Say so instead of letting it read as a great Meta result.
  const shopHeavy = stores.filter(r => r.totals.shopSpend > 0 && r.totals.shopSpend > r.totals.metaSpend)
  const notes: VerdictLine[] = shopHeavy.length
    ? [line(`${joinNames(shopHeavy.map(r => `${r.name} (${formatMoney(r.totals.shopSpend)})`))} ${shopHeavy.length === 1 ? 'gastou' : 'gastaram'} mais em Anúncios Shopify do que no Meta: esse gasto fica fora do ROAS, que por isso sai alto.`)]
    : []
  const worst = below.length ? below.reduce((a, b) => (b.totals.contribution - b.totals.metaSpend < a.totals.contribution - a.totals.metaSpend ? b : a)) : null

  return {
    ...base,
    tone: judged.length === 0 ? 'warn' : below.length === 0 ? 'pos' : covering.length === 0 ? 'neg' : 'warn',
    chips,
    headline,
    amount: totals.metaSpend,
    amountTone: 'neu',
    amountCaption: `gastos no Meta em ${plural(spenders.length, 'loja', 'lojas')}${worst ? ` · pior: ${worst.name}` : ''}`,
    details: details.slice(0, 3),
    notes,
    basis: 'none',
  }
}

export function SharedAccountsCallout({ pairs }: { pairs: SharedAdAccount[] }) {
  if (!pairs.length) return null
  return (
    <Callout tone="warn" title="Conta de anúncio compartilhada.">
      {' '}{pairs.map(p => `Anúncios pagos pela ${p.adStoreName} trouxeram ${plural(p.orders, 'pedido', 'pedidos')} (${formatMoney(p.revenue)}) da ${p.salesStoreName}`).join('; ')}.
      {' '}O gasto fica na loja dona da conta e as vendas na loja que vendeu: some as duas para julgar o resultado.
    </Callout>
  )
}

export function PortfolioAdsTable({ stores, hrefFor, rangeLabel }: {
  stores: PortfolioStoreRow[]; hrefFor: (storeId: string) => string; rangeLabel: string
}) {
  const columns: DataColumn[] = [
    { key: 'store', label: 'Loja' },
    { key: 'spend', label: 'Gasto Meta', numeric: true, sortable: true },
    { key: 'revenue', label: 'Vendas', numeric: true, sortable: true, info: 'Tudo o que a loja vendeu no período (Shopify), creditado ao Meta ou não.' },
    { key: 'roas', label: 'ROAS da loja', sortable: true, info: 'Vendas da loja (todas, creditadas ou não) ÷ gasto no Meta, contra o empate da própria loja (receita ÷ contribuição). A barra marca o empate de cada loja.' },
    { key: 'pv', label: 'Atribuídas', numeric: true, sortable: true, info: 'Vendas atribuídas: o que o Meta credita às campanhas da loja. Compras impossíveis já descartadas.' },
    { key: 'metaRoas', label: 'ROAS atribuído', numeric: true, sortable: true },
    { key: 'credit', label: 'Crédito Meta', numeric: true, sortable: true, info: 'Vendas atribuídas ÷ vendas da loja. Acima de 100%: o Meta credita mais do que a loja vendeu.' },
    { key: 'shop', label: 'Anúncios Shopify', numeric: true, sortable: true, info: 'Shop Campaigns, cobrados pela Shopify, fora do Meta: não entram no ROAS.' },
  ]
  const rows: DataRow[] = stores.map(r => {
    const t = r.totals
    const credit = t.revenue > 0 ? (t.metaPurchaseValue / t.revenue) * 100 : null
    return {
      key: r.id,
      href: hrefFor(r.id),
      tone: t.metaSpend > 0 ? undefined : 'mut',
      cells: {
        store: <span className={s.storeCell}><span className={s.nm}>{r.name}</span>{!r.configured && <Badge tone="cfg" icon="sliders">sem custos</Badge>}</span>,
        spend: <Money value={t.metaSpend} />,
        revenue: <Money value={t.revenue} />,
        roas: t.metaSpend > 0 ? <RoasCell roas={t.roas} breakEven={r.configured ? t.breakEvenRoas : null} /> : <span className={s.muted}>sem gasto no Meta</span>,
        pv: <Money value={t.metaPurchaseValue} />,
        metaRoas: <span>{formatRoas(t.metaRoas)}</span>,
        credit: <Pct value={credit} digits={0} />,
        shop: <Money value={t.shopSpend} />,
      },
      sort: {
        spend: t.metaSpend, revenue: t.revenue, roas: t.roas, pv: t.metaPurchaseValue, metaRoas: t.metaRoas,
        credit, shop: t.shopSpend,
      },
    }
  })
  return (
    <DataTable
      caption={`Gasto no Meta por loja em ${rangeLabel}`}
      columns={columns}
      rows={rows}
      initialSort={{ key: 'spend', dir: 'desc' }}
      dense
      empty={<EmptyState compact title="Nenhuma loja para mostrar" />}
    />
  )
}
