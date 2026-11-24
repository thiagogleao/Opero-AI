import type { StoreRef } from '@/lib/access'
import { getMetaBreakdown } from '@/lib/data/meta'
import { comparisonRange, computeStorePnL, type DateRange } from '@/lib/engine'
import {
  adLists, campaignViews, contributionRateOf, loadAdData, loadDecisionBasis,
  type AdLists, type AdView, type CampaignList,
} from '../ads'
import { currencyLine, loadStoreContext, type StoreContext } from '../context'
import { customerMix, type CustomerMix } from '../data'
import { int, pct, times, usd } from '../format'
import {
  countriesView, partnerShareView, productsView, seriesView, totalsView,
  type CountriesView, type PartnerShareView, type ProductsView, type SeriesPoint, type TotalsView,
} from '../views'
import type { InsightsWindow } from '../window'

/**
 * The fact sheet the insights are written from: built on the server, from the
 * profit engine and lib/data, for closed days only. The browser sends a store
 * id and a period, never a prompt (the old route trusted a 300-line system
 * prompt from the client, with the split halving the store's margin and the
 * "last 7 days" being the last 7 rows of whatever range was picked).
 *
 * Money is the whole store's. The partner's half appears as one extra line,
 * "SUA PARTE (50%)", so margins, ROAS and break-even are never halved.
 */

export interface InsightsFacts {
  ctx: StoreContext
  window: InsightsWindow
  previous: DateRange & { label: string }
  split: boolean
  configured: boolean
  totals: TotalsView
  partnerShare: PartnerShareView | null
  previousTotals: TotalsView | null
  series: { granularity: 'day' | 'week'; points: SeriesPoint[] }
  customers: CustomerMix
  products: ProductsView
  countries: CountriesView
  metaCountryCoverage: { covered: number; total: number; missingDays: number }
  ads: AdLists
  campaigns: CampaignList
}

export async function buildInsightsFacts(
  store: StoreRef, window: InsightsWindow, split: boolean, now: Date = new Date(),
): Promise<InsightsFacts> {
  const ctx = await loadStoreContext(store, now)
  const prevRange = comparisonRange('custom', window, ctx.timezone, now)
  const [pnl, prev, adData, customers, metaCountry, decision] = await Promise.all([
    computeStorePnL(store.id, window, { products: true, countries: true }, now),
    computeStorePnL(store.id, prevRange, {}, now),
    loadAdData(store.id, window, ctx.timezone, 7),
    customerMix(store.id, ctx.timezone, window),
    getMetaBreakdown(store.id, window, 'country'),
    loadDecisionBasis(store.id, window, ctx.today, now),
  ])
  if (!pnl) throw new Error(`store ${store.id} not found by the engine`)
  const t = pnl.totals
  const breakEven = pnl.configured ? t.breakEvenRoas : null
  return {
    ctx, window,
    previous: { from: prevRange.from, to: prevRange.to, label: prevRange.label },
    split,
    configured: pnl.configured,
    totals: totalsView(t, pnl.configured),
    partnerShare: split ? partnerShareView(t) : null,
    previousTotals: prev ? totalsView(prev.totals, prev.configured) : null,
    series: seriesView(pnl.daily),
    customers,
    products: productsView(pnl.products ?? [], 10),
    countries: countriesView(pnl.countries ?? [], 12),
    metaCountryCoverage: {
      covered: metaCountry.coveredSpend, total: metaCountry.totalSpend, missingDays: metaCountry.missingDays.length,
    },
    ads: adLists(adData.ads, breakEven, window.to, undefined, pnl.configured),
    campaigns: campaignViews(adData, {
      contributionRate: contributionRateOf(pnl.configured, t.revenue, t.contribution),
      storeToday: ctx.today,
      limit: 10,
      decision,
    }),
  }
}

const CENT = 0.005

/** Something happened in these totals: an order, a sale, ad spend, or a
 *  refund or chargeback arriving. Fixed costs alone do not count — they run
 *  by the calendar, not by anything the store did. */
function hasActivity(t: TotalsView | null): boolean {
  if (!t) return false
  const money = (n: number | null) => (n ?? 0) > CENT
  return t.orders > 0 || money(t.revenue) || money(t.metaSpend) || money(t.shopSpend)
    || t.refundCount > 0 || t.chargebackCount > 0
}

/**
 * Neither the window nor the one before it has anything in it — a store that
 * did not sell yet (Hibikura before 7 nov), or one long dead. The sheet would
 * be zeros only, and the model call is paid: generateInsights refuses before
 * making it. A quiet window after a busy one still goes to the model ("vendas
 * caíram a zero" is worth reading).
 */
export function nothingToRead(f: Pick<InsightsFacts, 'totals' | 'previousTotals'>): boolean {
  return !hasActivity(f.totals) && !hasActivity(f.previousTotals)
}

// ─── The sheet as text ────────────────────────────────────────────────────────

const VERDICT_PT: Record<string, string> = { kill: 'desligar', scale: 'escalar', refresh: 'trocar criativo', ok: 'ok' }

function adLine(a: AdView): string {
  const parts = [
    `[anúncio ${a.adId}] "${a.name}"`,
    a.campaign ? `campanha "${a.campaign}"` : 'campanha desconhecida',
    a.status,
    `gasto ${usd(a.spend)}`,
    `${int(a.purchases)} compras`,
    `valor atribuído ${usd(a.purchaseValue)}`,
    `ROAS do Meta ${times(a.metaRoas)}`,
    `CPA ${usd(a.cpa)}`,
    `CTR ${pct(a.ctr)}`,
    `${a.daysWithSpend} dias com gasto${a.lastSpendDay ? ` (último ${a.lastSpendDay})` : ''}`,
    a.createdDay ? `criado em ${a.createdDay}` : null,
    `veredito: ${a.verdict ? VERDICT_PT[a.verdict] : 'nenhum'} (${a.reason})`,
  ]
  return `- ${parts.filter(Boolean).join(' · ')}`
}

function omittedLine(o: { count: number; spend: number | null; purchaseValue: number | null }, what: string): string | null {
  return o.count > 0 ? `- (+ ${o.count} ${what} não listados: gasto ${usd(o.spend)}, valor atribuído ${usd(o.purchaseValue)})` : null
}

export function factSheetText(f: InsightsFacts): string {
  const { ctx, totals: t, window: w } = f
  const L: (string | null)[] = []
  const push = (...xs: (string | null)[]) => L.push(...xs)

  push(
    `LOJA: ${ctx.name}${ctx.domain ? ` (${ctx.domain})` : ''} · fuso ${ctx.timezone} · ${currencyLine(ctx)}`,
    `PERÍODO: ${w.label} — ${w.from} a ${w.to}, ${w.days} dias fechados no calendário da loja.${w.cutAtYesterday ? ` Hoje (${ctx.today}) fica de fora: só dias completos entram.` : ''}${w.shortened ? ' O período pedido era maior e foi encurtado.' : ''}`,
    `CUSTOS CONFIGURADOS: ${f.configured ? 'sim' : 'não — sem custo de produto, frete nem taxas: o "lucro" abaixo é receita − anúncios, e não há contribuição, ROAS de empate nem veredito de anúncio'}`,
  )
  if (ctx.notes.length) {
    push('', 'NOTAS DA LOJA (o que os números desta loja não mostram sozinhos):')
    for (const n of ctx.notes) push(`- ${n}`)
  }

  push(
    '', 'RESULTADO DA LOJA (motor de lucro do Opero; valores inteiros da loja)',
    `- Receita: ${usd(t.revenue)} · ${int(t.orders)} pedidos · ticket médio ${usd(t.aov)} · ${int(t.units)} unidades`,
  )
  if (f.configured) {
    push(
      `- Custo de produto: ${usd(t.productCost)}`,
      `- Frete: ${usd(t.shipping)}`,
      `- Taxas Shopify e pagamento: ${usd(t.fees)}`,
      `- Extras por pedido: ${usd(t.perOrderExtras)}`,
      `- Custos variáveis: ${usd(t.variableCosts)}`,
      `- Contribuição: ${usd(t.contribution)} (margem de contribuição ${pct(t.contributionMargin)})`,
    )
  }
  push(
    `- Anúncios Meta: ${usd(t.metaSpend)}`,
    `- Anúncios Shopify (Shop Campaigns): ${usd(t.shopSpend)}`,
    f.configured ? `- Custos fixos do período: ${usd(t.fixedCosts)}` : null,
    `- Lucro operacional: ${usd(t.operatingProfit)} (margem ${pct(t.margin)}, lucro por pedido ${usd(t.profitPerOrder)})`,
    `- Reembolsos: ${int(t.refundCount)} (valor bruto ${usd(t.refundGross)}; custo no lucro ${usd(t.refunds)})`,
    `- Chargebacks: ${int(t.chargebackCount)} (${usd(t.chargebacks)}; taxas ${usd(t.chargebackFees)})`,
    `- Resultado de caixa (lucro operacional − reembolsos − chargebacks): ${usd(t.cashResult)}`,
    f.configured ? `- ROAS de empate (receita ÷ contribuição; sem custos fixos nem anúncios Shopify): ${times(t.breakEvenRoas)}` : null,
    `- ROAS da conta (receita da loja ÷ gasto Meta; inclui vendas orgânicas): ${times(t.roas)}`,
    `- ROAS do Meta (valor de compra atribuído pelo Meta ÷ gasto Meta): ${times(t.metaRoas)} · valor atribuído ${usd(t.metaPurchaseValue)} · ${int(t.metaPurchases)} compras atribuídas`,
    `- CAC (gasto Meta ÷ pedidos da Shopify): ${usd(t.cac)}`,
  )
  if (f.partnerShare) {
    const s = f.partnerShare
    push(
      '', 'SUA PARTE (50%) — a parte do sócio nos valores em dinheiro; margens, ROAS e empate não mudam',
      `- Lucro operacional: ${usd(s.operatingProfit)} · lucro por pedido ${usd(s.profitPerOrder)} · resultado de caixa ${usd(s.cashResult)} · custo dos reembolsos ${usd(s.refunds)}`,
    )
  }
  if (f.previousTotals) {
    const p = f.previousTotals
    push(
      '', `PERÍODO ANTERIOR (${f.previous.label}: ${f.previous.from} a ${f.previous.to})`,
      `- Receita ${usd(p.revenue)} · ${int(p.orders)} pedidos · Meta ${usd(p.metaSpend)} · lucro operacional ${usd(p.operatingProfit)} · ROAS da conta ${times(p.roas)} · ROAS do Meta ${times(p.metaRoas)}${f.configured ? ` · ROAS de empate ${times(p.breakEvenRoas)}` : ''}`,
    )
  }

  push('', `SÉRIE ${f.series.granularity === 'day' ? 'DIÁRIA' : 'SEMANAL (somas de 7 dias)'} (receita · pedidos · Meta · lucro operacional · ROAS da conta)`)
  for (const p of f.series.points) {
    push(`- ${p.period}: ${usd(p.revenue)} · ${int(p.orders)} · ${usd(p.metaSpend)}${(p.shopSpend ?? 0) > 0 ? ` (+ Shopify ${usd(p.shopSpend)})` : ''} · ${usd(p.operatingProfit)} · ${times(p.roas)}`)
  }

  const c = f.customers
  push(
    '', 'CLIENTES (pedidos válidos; novo = primeira compra do cliente na loja)',
    `- Novos: ${int(c.newOrders)} pedidos, ${usd(c.newRevenue)} · Recorrentes: ${int(c.returningOrders)} pedidos, ${usd(c.returningRevenue)} · Sem cliente: ${int(c.unknownOrders)} pedidos, ${usd(c.unknownRevenue)}`,
  )

  const pr = f.products
  push('', `PRODUTOS (${pr.top.length} de ${pr.totalProducts}, por receita; receita do pedido repartida entre as linhas)`)
  for (const p of pr.top) {
    push(`- [produto ${p.productId ?? 'sem id'}] "${p.title}": ${int(p.units)} unidades · ${int(p.orders)} pedidos · receita ${usd(p.revenue)}${f.configured ? ` · contribuição ${usd(p.contribution)} (${pct(p.contributionMargin)})` : ''}`)
  }
  if (pr.others.products > 0) {
    push(`- (+ ${pr.others.products} produtos: ${int(pr.others.units)} unidades · receita ${usd(pr.others.revenue)}${f.configured ? ` · contribuição ${usd(pr.others.contribution)}` : ''})`)
  }

  const co = f.countries
  push(
    '', 'PAÍSES (pedidos reais da Shopify × gasto que o Meta entregou no país; pedidos = amostra)',
    `- Cobertura do detalhamento por país do Meta: ${usd(f.metaCountryCoverage.covered)} de ${usd(f.metaCountryCoverage.total)} do gasto${f.metaCountryCoverage.missingDays ? ` (${f.metaCountryCoverage.missingDays} dias com gasto sem detalhamento)` : ''}`,
  )
  for (const r of co.rows) {
    push(`- ${r.country}: ${int(r.orders)} pedidos (amostra ${r.sample}) · receita ${usd(r.revenue)}${f.configured ? ` · contribuição ${usd(r.contribution)} · contribuição − Meta ${usd(r.contributionAfterMeta)}` : ''} · gasto Meta ${usd(r.metaSpend)} · valor atribuído pelo Meta ${usd(r.metaPurchaseValue)}`)
  }
  if (co.others.countries > 0) {
    push(`- (+ ${co.others.countries} países: ${int(co.others.orders)} pedidos · receita ${usd(co.others.revenue)} · gasto Meta ${usd(co.others.metaSpend)})`)
  }

  const a = f.ads
  push(
    '', 'ANÚNCIOS DO META (compras fantasma acima de $20,000 por anúncio-dia removidas)',
    a.breakEven !== null
      ? `- Regra do veredito (única no app), contra o ROAS de empate ${times(a.breakEven)}: desligar se ROAS do Meta < 80% do empate com $50+ gastos; escalar se ≥ 140% do empate com $30+ gastos e 3+ compras; anúncios pausados e os de campanhas cujas vendas rastreadas caem em outra loja não recebem veredito.`
      : '- Sem ROAS de empate (custos não configurados ou contribuição ≤ 0): nenhum anúncio recebe veredito.',
    `- Todos os anúncios: ${int(a.totals.adsWithSpend)} com gasto · gasto ${usd(a.totals.spend)} · valor atribuído ${usd(a.totals.purchaseValue)} · ${int(a.totals.purchases)} compras · ROAS do Meta ${times(a.totals.metaRoas)}${a.totals.phantomAdDays ? ` · ${a.totals.phantomAdDays} anúncio-dia fantasma removido (${usd(a.totals.phantomValueDropped)})` : ''}`,
    `- Vereditos: desligar ${a.verdictCounts.kill} · escalar ${a.verdictCounts.scale} · ok ${a.verdictCounts.ok} · sem veredito ${a.verdictCounts.none}`,
    '', `DESLIGAR (${a.kill.length + a.killOmitted.count}, maior gasto primeiro)`,
  )
  if (!a.kill.length) push('- nenhum')
  for (const x of a.kill) push(adLine(x))
  push(omittedLine(a.killOmitted, 'anúncios para desligar'))
  push('', `ESCALAR (${a.scale.length + a.scaleOmitted.count}, maior gasto primeiro)`)
  if (!a.scale.length) push('- nenhum')
  for (const x of a.scale) push(adLine(x))
  push(omittedLine(a.scaleOmitted, 'anúncios para escalar'))
  push('', 'MAIOR GASTO (qualquer veredito)')
  if (!a.topSpend.length) push('- nenhum anúncio com gasto')
  for (const x of a.topSpend) push(adLine(x))
  push(omittedLine(a.topSpendOmitted, 'anúncios'))

  const cp = f.campaigns
  push('', `CAMPANHAS (${cp.rows.length} de ${cp.totalCampaigns}, por gasto; veredito da tela de campanhas sobre os últimos 7 dias fechados; lucro estimado = valor atribuído × taxa de contribuição − gasto)`)
  for (const r of cp.rows) {
    const d = r.decision
    push(`- [campanha ${r.campaignId ?? 'sem id'}] "${r.name}" · ${r.status} · ${r.ads} anúncios · gasto ${usd(r.spend)} · ${int(r.purchases)} compras · valor atribuído ${usd(r.purchaseValue)} · ROAS do Meta ${times(r.metaRoas)}${r.estimatedProfit !== null ? ` · lucro estimado ${usd(r.estimatedProfit)}` : ''}${d ? ` · veredito ${d.window.from} a ${d.window.to}: ${d.action ?? 'nenhum'} (${d.reason})${d.trend ? `, tendência ${d.trend}` : ''}` : ''}${r.sharedAccount ? ` · ${r.sharedAccount}` : ''}`)
  }
  push(omittedLine(cp.omitted, 'campanhas'))

  push(
    '', 'O QUE ESTES DADOS NÃO MOSTRAM',
    '- Frequência do período e hook rate não são coletados: não há como julgar fadiga de criativo por frequência.',
    '- O frete cobrado do cliente não está nos dados.',
    '- A atribuição de compras por país do Meta captou de 17% a 140% dos pedidos reais conforme o país: decida geografia pelos pedidos da Shopify.',
    '- Pedidos de Porto Rico, Ilhas Virgens, Guam, Samoa e Marianas chegam como US.',
    '- Pedidos da Shopify não trazem campanha: lucro por campanha é estimado pelo valor que o Meta atribui.',
  )
  return L.filter((x): x is string => x !== null).join('\n')
}
