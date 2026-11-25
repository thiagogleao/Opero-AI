import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import {
  computeSameTimeComparison, computeStorePnL, PERIODS, type Period,
} from '@/lib/engine'
import { BREAKDOWN_TYPES, getMetaBreakdown, type BreakdownType } from '@/lib/data/meta'
import {
  adTotals, adView, campaignViews, contributionRateOf, loadAdData, loadDecisionBasis, type VerdictCounts,
} from './ads'
import type { StoreContext } from './context'
import { catalogue, customerMix, getOrder, listOrders, topCustomers, type OrderStatusFilter } from './data'
import { r1, r2, safeDiv } from './format'
import { readInventory, ShopifyReadError } from './shopifyRead'
import { countriesView, partnerShareView, productsView, seriesView, totalsView, type ProductSort } from './views'
import { toolRange, type ToolRange } from './window'
import { previousFor } from '../period'
import { viewerStoresOf } from '../views/periodFacts'
import { priceComparison } from '../views/store'

/**
 * The Copilot's tools. Read-only, every one of them: the old write tools
 * (create/update product, stock, pages) never executed and the owner decided
 * the AI only analyses.
 *
 * Every number comes from the profit engine or lib/data, on the store's own
 * calendar, with phantom Meta purchases removed. A list that is cut says so
 * and carries the sum of what it left out, so the model cannot add up a
 * partial list and present it as a total (the old fb_metrics topic returned
 * the 200 most recent ad-days and the model reported them as "7 days").
 */

const TOOL_PERIODS = PERIODS.map(p => p.key).filter((k): k is Exclude<Period, 'custom'> => k !== 'custom')

const RANGE_PROPS = {
  period: {
    type: 'string',
    enum: TOOL_PERIODS,
    description: 'Período pronto, no fuso da loja. "7d", "14d", "30d" e "90d" são dias completos terminando ontem; "mtd" é este mês até hoje; "today" ainda não terminou. Padrão: "7d".',
  },
  from: { type: 'string', description: 'Data inicial YYYY-MM-DD no calendário da loja. Com "to", substitui "period".' },
  to: { type: 'string', description: 'Data final YYYY-MM-DD, inclusiva.' },
} as const

function tool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): BetaTool {
  return {
    name,
    description,
    input_schema: { type: 'object', properties, ...(required.length ? { required } : {}) },
    // Streamed requests with client tools stream tool input as it is written;
    // runTool validates every field itself, so nothing relies on the API's
    // buffering-time validation.
    eager_input_streaming: true,
  }
}

/** Definitions in a fixed order: the tools are the first thing in the cached
 *  prompt prefix, so their bytes must never vary between requests. */
export const TOOLS: BetaTool[] = [
  tool('get_profit',
    'Resultado da loja num período, do motor de lucro do Opero (a mesma conta do painel): receita, pedidos, custos, contribuição, gasto Meta e Shopify, custos fixos, lucro operacional, reembolsos, chargebacks, ROAS de empate, ROAS da conta e ROAS do Meta. Use para qualquer pergunta de lucro, receita, margem, gasto ou ROAS. "daily": série por dia (ou semana em janelas longas). "compare": o período anterior equivalente (para "today", ontem até a mesma hora).',
    { ...RANGE_PROPS, daily: { type: 'boolean' }, compare: { type: 'boolean' } }),
  tool('get_products',
    'Produtos vendidos no período (pedidos válidos), com unidades, pedidos, receita e contribuição de cada um pelo motor de lucro. Lista os primeiros e soma o resto em "others", de modo que tudo soma a receita da loja.',
    { ...RANGE_PROPS, sort: { type: 'string', enum: ['revenue', 'units', 'contribution'] }, limit: { type: 'integer', description: '1 a 30, padrão 10.' } }),
  tool('get_countries',
    'Países pelos pedidos reais da Shopify (pedidos = tamanho da amostra), com receita e contribuição, ao lado do gasto que o Meta entregou em cada país. Use para qualquer pergunta de geografia. A atribuição de compras por país do Meta vem só como referência e não serve para decidir.',
    { ...RANGE_PROPS, limit: { type: 'integer', description: '1 a 25, padrão 12.' } }),
  tool('get_ads',
    'Anúncios do Meta no período: gasto, compras e valor atribuídos pelo Meta (compras fantasma acima de $20.000 por dia removidas), ROAS do Meta, CPA, CTR e o veredito do Opero (kill = desligar, scale = escalar, ok, ou sem veredito) contra o ROAS de empate da loja. Os totais cobrem todos os anúncios, mesmo os que não couberam na lista.',
    {
      ...RANGE_PROPS,
      verdict: { type: 'string', enum: ['kill', 'scale', 'all'], description: 'Filtra pelo veredito. Padrão: all.' },
      search: { type: 'string', description: 'Parte do nome do anúncio ou da campanha.' },
      limit: { type: 'integer', description: '1 a 30, padrão 15.' },
    }),
  tool('get_campaigns',
    'Campanhas do Meta no período, com gasto, compras e valor atribuídos, ROAS, lucro estimado (valor atribuído × taxa de contribuição da loja − gasto) e o veredito da tela de campanhas (escalar, manter, cortar, observar) sobre os últimos 7 dias fechados.',
    { ...RANGE_PROPS, limit: { type: 'integer', description: '1 a 25, padrão 12.' } }),
  tool('list_orders',
    'Pedidos da loja no período, mais recentes primeiro, sem dados pessoais. "matching" e "matchingRevenue" contam todos os pedidos do filtro, mesmo os que não couberam na lista. status "kept" = pedidos válidos (os que o painel conta), "refunded" = reembolsados/cancelados, "all" = todos.',
    {
      ...RANGE_PROPS,
      status: { type: 'string', enum: ['kept', 'refunded', 'all'] },
      country: { type: 'string', description: 'Código de país com 2 letras (ex.: US).' },
      limit: { type: 'integer', description: '1 a 50, padrão 20.' },
    }),
  tool('get_order',
    'Um pedido pelo número (o "#1234" da Shopify): itens, valores, status, país e se é a primeira compra do cliente. O e-mail do cliente só vem quando o usuário citou esse número na pergunta.',
    { order_number: { type: 'integer' } }, ['order_number']),
  tool('get_customers',
    'Clientes novos x recorrentes no período (pela ordem real das compras de cada cliente) e os maiores compradores, identificados por um código anônimo.',
    { ...RANGE_PROPS, top: { type: 'integer', description: '0 a 20, padrão 10.' } }),
  tool('get_catalogue',
    'Produtos cadastrados na loja (última sincronização): quantos por status, título, faixa de preço em US$ e número de variantes. Não traz estoque nem vendas.',
    {
      search: { type: 'string', description: 'Parte do título.' },
      status: { type: 'string', enum: ['active', 'draft', 'archived'] },
      limit: { type: 'integer', description: '1 a 50, padrão 20.' },
    }),
  tool('get_inventory',
    'Estoque atual lido ao vivo na Shopify (somente leitura): total de todas as variantes de cada produto e quantos estão sem estoque.',
    {
      search: { type: 'string', description: 'Parte do título.' },
      only_out_of_stock: { type: 'boolean' },
      status: { type: 'string', enum: ['active', 'draft', 'archived', 'any'] },
      limit: { type: 'integer', description: '1 a 50, padrão 20.' },
    }),
  tool('get_meta_breakdown',
    'O detalhamento do próprio Meta por dispositivo, posicionamento, idade/gênero ou país: gasto, compras e valor atribuídos, ROAS, CTR, CPC, e quanto do gasto o detalhamento cobre. Atribuição do Meta, não pedidos da Shopify.',
    { ...RANGE_PROPS, type: { type: 'string', enum: [...BREAKDOWN_TYPES] } }, ['type']),
]

const TOOL_NAMES = TOOLS.map(t => t.name)

// ─── Input helpers ────────────────────────────────────────────────────────────

type Input = Record<string, unknown>

const str = (v: unknown, max = 100): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null

function intIn(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], dflt: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : dflt
}

const bool = (v: unknown): boolean => v === true || v === 'true'

function rangeInfo(r: ToolRange) {
  return {
    from: r.from, to: r.to, label: r.label, days: r.days, partial: r.partial,
    ...(r.partial ? { partialNote: 'Inclui hoje, que ainda não terminou: não compare com dias inteiros.' } : {}),
  }
}

/** Sum of what a list left out. */
function omittedOf(rest: { spend?: number | null; revenue?: number | null; purchaseValue?: number | null }[]) {
  return {
    count: rest.length,
    spend: r2(rest.reduce((s, x) => s + (x.spend ?? 0), 0)),
    purchaseValue: r2(rest.reduce((s, x) => s + (x.purchaseValue ?? 0), 0)),
  }
}

// ─── Runtime ──────────────────────────────────────────────────────────────────

export interface ToolEnv {
  ctx: StoreContext
  /** The viewer splits profit 50/50: results add a "sua parte (50%)" line. */
  split: boolean
  /** The question being answered: an order's e-mail is shown only when the
   *  user typed that order's number here. */
  lastUserText: string
  signal: AbortSignal
  now: Date
}

export interface ToolOutcome {
  /** JSON for the model. */
  content: string
  isError: boolean
}

class ToolInputError extends Error {}

const json = (v: unknown) => JSON.stringify(v)

function notConfiguredNote(configured: boolean) {
  return configured ? undefined
    : 'Custos não configurados nesta loja: o "lucro" é receita − anúncios; custo de produto, frete e taxas não entram, e não há ROAS de empate nem veredito de anúncio.'
}

async function pnlOrThrow(ctx: StoreContext, r: ToolRange, opts: { products?: boolean; countries?: boolean }, now: Date) {
  const pnl = await computeStorePnL(ctx.id, r, opts, now)
  if (!pnl) throw new ToolInputError('Loja não encontrada.')
  return pnl
}

const HANDLERS: Record<string, (input: Input, env: ToolEnv) => Promise<unknown>> = {
  async get_profit(input, { ctx, split, now }) {
    const r = toolRange(ctx.timezone, input, '7d', now)
    const pnl = await pnlOrThrow(ctx, r, {}, now)
    const out: Record<string, unknown> = {
      range: rangeInfo(r),
      configured: pnl.configured,
      configuredNote: notConfiguredNote(pnl.configured),
      totals: totalsView(pnl.totals, pnl.configured),
    }
    if (split) out.partnerShare = { label: 'sua parte (50%)', ...partnerShareView(pnl.totals) }
    if (bool(input.daily)) out.daily = seriesView(pnl.daily)
    if (bool(input.compare)) {
      // R6's base rule from the store's facts (the one facts loader), as the
      // page: Hibikura · Este mês on 24 nov is "sem base", never a comparison
      // of zeros with an October before it existed.
      const facts = await viewerStoresOf([{ id: ctx.id, name: ctx.name, timezone: ctx.timezone, archived: ctx.archived }])
      const first = (facts.active[0] ?? facts.archived[0])?.firstActivityDate ?? null
      const cr = previousFor(r.period, r, ctx.timezone, now, first)
      if (cr.base === 'none') {
        out.comparison = { from: cr.from, to: cr.to, label: cr.label, none: cr.baseNote }
      } else if (r.from === r.to && r.to === ctx.today) {
        const c = (await computeSameTimeComparison([ctx.id], r.from, now)).get(ctx.id)
        if (c) out.comparison = { from: c.range.from, to: c.range.to, label: 'ontem até a mesma hora', totals: totalsView(c.totals, c.configured), ...(cr.baseNote ? { baseNote: `${cr.baseNote}: não calcule variação percentual` } : {}) }
      } else {
        // R6: a running window (Este mês, dates ending today) is compared up
        // to this minute, priced as the pages price it (priceComparison).
        const c = await priceComparison(ctx.id, cr, cr.cutAtMinute, now)
        if (c) out.comparison = { from: cr.from, to: cr.to, label: cr.label, totals: totalsView(c.totals, c.configured), ...(cr.baseNote ? { baseNote: `${cr.baseNote}: não calcule variação percentual` } : {}) }
      }
    }
    return out
  },

  async get_products(input, { ctx, now }) {
    const r = toolRange(ctx.timezone, input, '7d', now)
    const pnl = await pnlOrThrow(ctx, r, { products: true }, now)
    const sort = oneOf<ProductSort>(input.sort, ['revenue', 'units', 'contribution'], 'revenue')
    return {
      range: rangeInfo(r),
      configured: pnl.configured,
      configuredNote: notConfiguredNote(pnl.configured),
      storeRevenue: r2(pnl.totals.revenue),
      ...productsView(pnl.products ?? [], intIn(input.limit, 1, 30, 10), sort),
    }
  },

  async get_countries(input, { ctx, now }) {
    const r = toolRange(ctx.timezone, input, '7d', now)
    const [pnl, meta] = await Promise.all([
      pnlOrThrow(ctx, r, { countries: true }, now),
      getMetaBreakdown(ctx.id, r, 'country'),
    ])
    return {
      range: rangeInfo(r),
      configured: pnl.configured,
      storeOrders: pnl.totals.orders,
      storeRevenue: r2(pnl.totals.revenue),
      ...countriesView(pnl.countries ?? [], intIn(input.limit, 1, 25, 12)),
      metaCountryCoverage: {
        spendCovered: r2(meta.coveredSpend), metaSpend: r2(meta.totalSpend),
        daysWithoutBreakdown: meta.missingDays.length,
      },
      caveat: 'Decida geografia pelos pedidos da Shopify (orders), nunca pelo valor atribuído pelo Meta por país: medido na EPOCH, ele captou de 17% a 140% dos pedidos reais conforme o país. Com menos de 30 pedidos num país, não há amostra para cortar nem escalar.',
    }
  },

  async get_ads(input, { ctx, now }) {
    const r = toolRange(ctx.timezone, input, '7d', now)
    const [pnl, data] = await Promise.all([pnlOrThrow(ctx, r, {}, now), loadAdData(ctx.id, r, ctx.timezone)])
    const be = pnl.configured ? pnl.totals.breakEvenRoas : null
    const all = data.ads.filter(a => a.spend > 0).map(a => adView(a, be, r.to, pnl.configured))
      .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
    const counts: VerdictCounts = { kill: 0, scale: 0, refresh: 0, ok: 0, none: 0 }
    for (const v of all) counts[v.verdict ?? 'none']++
    const verdict = oneOf(input.verdict, ['kill', 'scale', 'all'] as const, 'all')
    const search = str(input.search)?.toLowerCase() ?? null
    const matching = all.filter(v => (verdict === 'all' || v.verdict === verdict)
      && (!search || v.name.toLowerCase().includes(search) || (v.campaign ?? '').toLowerCase().includes(search)))
    const limit = intIn(input.limit, 1, 30, 15)
    return {
      range: rangeInfo(r),
      breakEvenRoas: r2(be),
      breakEvenNote: be !== null
        ? 'ROAS de empate da loja (receita ÷ contribuição) no período: kill = ROAS abaixo de 80% dele com $50+ gastos; scale = 40% acima com $30+ e 3+ compras. Anúncios pausados e os de campanhas cujas vendas rastreadas caem em outra loja (reason explica) ficam sem veredito.'
        : pnl.configured
          ? 'A contribuição da loja no período é zero ou negativa: nenhum ROAS paga os custos variáveis, então não há veredito.'
          : notConfiguredNote(false),
      allAds: adTotals(data.ads),
      verdictCounts: counts,
      filter: { verdict, search },
      matching: matching.length,
      rows: matching.slice(0, limit),
      notListed: omittedOf(matching.slice(limit)),
      unavailable: 'Frequência do período e hook rate não são coletados: não há como julgar saturação por frequência.',
    }
  },

  async get_campaigns(input, { ctx, now }) {
    const r = toolRange(ctx.timezone, input, '7d', now)
    const [pnl, data, decision] = await Promise.all([
      pnlOrThrow(ctx, r, {}, now), loadAdData(ctx.id, r, ctx.timezone, 7), loadDecisionBasis(ctx.id, ctx.today, now, { archived: !!ctx.archived }),
    ])
    const rate = contributionRateOf(pnl.configured, pnl.totals.revenue, pnl.totals.contribution)
    return {
      range: rangeInfo(r),
      contributionRate: rate === null ? null : r1(rate * 100),
      configuredNote: notConfiguredNote(pnl.configured),
      allAds: adTotals(data.ads),
      ...campaignViews(data, { contributionRate: rate, storeToday: ctx.today, limit: intIn(input.limit, 1, 25, 12), decision }),
      decisionWindow: decision.window ? { ...decision.window, label: 'últimos 7 dias fechados da loja' } : null,
      note: decision.window
        ? `Valor e compras são a atribuição do Meta (pedidos da Shopify não trazem campanha). O veredito usa os últimos 7 dias fechados da loja (${decision.window.from} a ${decision.window.to}), com a margem desses mesmos dias, como a tela de campanhas — não os dias do período pedido.`
        : 'Valor e compras são a atribuição do Meta (pedidos da Shopify não trazem campanha). Loja arquivada: sem veredito de campanha.',
    }
  },

  async list_orders(input, { ctx, now }) {
    const r = toolRange(ctx.timezone, input, '7d', now)
    const status = oneOf<OrderStatusFilter>(input.status, ['kept', 'refunded', 'all'], 'kept')
    const countryRaw = str(input.country, 2)
    const country = countryRaw && /^[A-Za-z]{2}$/.test(countryRaw) ? countryRaw.toUpperCase() : null
    const list = await listOrders(ctx.id, ctx.timezone, r, { status, country, limit: intIn(input.limit, 1, 50, 20) })
    return {
      range: rangeInfo(r),
      filter: { status, country },
      matching: list.matching,
      matchingRevenue: r2(list.matchingRevenue),
      truncated: list.truncated,
      rows: list.rows.map(o => ({ ...o, total: r2(o.total) })),
      ...(country === 'US' ? { note: 'Porto Rico, Ilhas Virgens, Guam, Samoa e Marianas chegam como US.' } : {}),
    }
  },

  async get_order(input, { ctx, lastUserText }) {
    const n = intIn(input.order_number, 1, 1e9, NaN)
    if (!Number.isFinite(n)) throw new ToolInputError('Informe order_number como número inteiro (ex.: 1234).')
    // The e-mail is shown only when the user asked about this very order.
    const revealContact = new RegExp(`(^|\\D)${n}(\\D|$)`).test(lastUserText)
    const order = await getOrder(ctx.id, ctx.timezone, n, { revealContact })
    if (!order) throw new ToolInputError(`Pedido #${n} não encontrado nesta loja.`)
    return {
      ...order,
      ...(order.contactHidden ? { contactNote: 'E-mail omitido: só aparece quando o usuário cita este número de pedido na pergunta.' } : {}),
      currencyNote: ctx.currency && ctx.currency !== 'USD' ? `Valores em US$ (a loja vende em ${ctx.currency}).` : undefined,
    }
  },

  async get_customers(input, { ctx, now }) {
    const r = toolRange(ctx.timezone, input, '7d', now)
    const top = intIn(input.top, 0, 20, 10)
    const [mix, best] = await Promise.all([
      customerMix(ctx.id, ctx.timezone, r),
      top > 0 ? topCustomers(ctx.id, ctx.timezone, r, top) : Promise.resolve(null),
    ])
    const known = mix.newOrders + mix.returningOrders
    return {
      range: rangeInfo(r),
      mix: {
        newOrders: mix.newOrders, newRevenue: r2(mix.newRevenue),
        returningOrders: mix.returningOrders, returningRevenue: r2(mix.returningRevenue),
        ordersWithoutCustomer: mix.unknownOrders, revenueWithoutCustomer: r2(mix.unknownRevenue),
        returningShare: r1(safeDiv(mix.returningOrders * 100, known)),
      },
      ...(best ? {
        customersInWindow: best.customers,
        topCustomers: best.rows.map(c => ({ ...c, revenueInWindow: r2(c.revenueInWindow) })),
      } : {}),
      note: 'Novo = primeira compra do cliente na loja; recorrente = qualquer compra seguinte. Clientes aparecem por código anônimo.',
    }
  },

  async get_catalogue(input, { ctx }) {
    const status = typeof input.status === 'string' ? oneOf(input.status, ['active', 'draft', 'archived'] as const, 'active') : null
    const view = await catalogue(ctx.id, ctx.timezone, { search: str(input.search), status, limit: intIn(input.limit, 1, 50, 20) })
    return {
      ...view,
      rows: view.rows.map(p => ({ ...p, priceMin: r2(p.priceMin), priceMax: r2(p.priceMax) })),
      note: 'Preços em US$. Estoque não é guardado no Opero: use get_inventory.',
    }
  },

  async get_inventory(input, { ctx, signal }) {
    try {
      return await readInventory(ctx.id, {
        search: str(input.search),
        onlyOutOfStock: bool(input.only_out_of_stock),
        status: oneOf(input.status, ['active', 'draft', 'archived', 'any'] as const, 'active'),
        limit: intIn(input.limit, 1, 50, 20),
      }, signal)
    } catch (err) {
      if (err instanceof ShopifyReadError) throw new ToolInputError(err.message)
      throw err
    }
  },

  async get_meta_breakdown(input, { ctx, now }) {
    const type = oneOf<BreakdownType>(input.type, BREAKDOWN_TYPES, 'placement')
    const r = toolRange(ctx.timezone, input, '7d', now)
    const b = await getMetaBreakdown(ctx.id, r, type)
    const rows = b.rows.map(x => ({
      label: x.label, spend: r2(x.spend), purchases: Math.round(x.purchases), purchaseValue: r2(x.purchaseValue),
      roas: r2(x.roas), ctr: r2(x.ctr), cpc: r2(x.cpc),
    }))
    return {
      range: rangeInfo(r),
      type,
      rows: rows.slice(0, 20),
      notListed: omittedOf(rows.slice(20)),
      spendCovered: r2(b.coveredSpend),
      metaSpend: r2(b.totalSpend),
      daysWithoutBreakdown: b.missingDays.length,
      ...(b.caveat ? { caveat: b.caveat } : {}),
    }
  },
}

/** Model tool names sometimes differ only in letter case; accept those. The
 *  name is model output: an own-key check, or "constructor" resolved to
 *  Object (runTool "succeeded" by echoing the input) and "__proto__" threw. */
export function resolveToolName(name: string): string | null {
  if (Object.hasOwn(HANDLERS, name)) return name
  const lower = name.toLowerCase()
  return TOOL_NAMES.find(n => n.toLowerCase() === lower) ?? null
}

export async function runTool(name: string, input: unknown, env: ToolEnv): Promise<ToolOutcome> {
  const resolved = resolveToolName(name)
  if (!resolved) {
    return { isError: true, content: json({ error: `A ferramenta "${name}" não existe. Use uma destas: ${TOOL_NAMES.join(', ')}.` }) }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { isError: true, content: json({ error: 'Entrada inválida: envie um objeto JSON com os campos da ferramenta.' }) }
  }
  try {
    const result = await HANDLERS[resolved](input as Input, env)
    return { isError: false, content: json(result) }
  } catch (err) {
    if (err instanceof ToolInputError) return { isError: true, content: json({ error: err.message }) }
    if (env.signal.aborted) throw err
    console.error('[ai.tool]', resolved, err)
    return { isError: true, content: json({ error: 'Falha ao ler os dados desta consulta. Tente outra consulta ou avise que o dado não está disponível agora.' }) }
  }
}

const TOOL_LABEL: Record<string, string> = {
  get_profit: 'Lucro', get_products: 'Produtos', get_countries: 'Países', get_ads: 'Anúncios',
  get_campaigns: 'Campanhas', list_orders: 'Pedidos', get_order: 'Pedido', get_customers: 'Clientes',
  get_catalogue: 'Catálogo', get_inventory: 'Estoque (Shopify)', get_meta_breakdown: 'Detalhamento do Meta',
}

const RANGED = new Set(['get_profit', 'get_products', 'get_countries', 'get_ads', 'get_campaigns', 'list_orders', 'get_customers', 'get_meta_breakdown'])

/** "Lucro · 10–16 nov", "Pedido #1234": the chip the UI shows while a tool runs. */
export function toolLabel(name: string, input: unknown, ctx: StoreContext, now: Date = new Date()): string {
  const resolved = resolveToolName(name)
  const base = resolved ? TOOL_LABEL[resolved] : name
  const i = (input && typeof input === 'object' ? input : {}) as Input
  if (resolved === 'get_order' && i.order_number !== undefined) return `${base} #${String(i.order_number).slice(0, 12)}`
  if (resolved && RANGED.has(resolved)) return `${base} · ${toolRange(ctx.timezone, i, '7d', now).label}`
  return base
}
