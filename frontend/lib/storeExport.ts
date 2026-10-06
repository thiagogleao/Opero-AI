import ExcelJS from 'exceljs'
import { query } from './db'
import {
  getProfitSummary, getDailyProfitData, buildCogsLookups, orderSupplierCost,
  type ProfitConfig,
} from './profitCalc'
import { getAdjustments, getChargebackHealth } from './adjustments'

/**
 * A full accounting of one or more stores over a period, as a spreadsheet.
 *
 * The reader is assumed to have no access to Opero, so the workbook has to
 * carry its own context: the cost configuration every figure was derived from,
 * and a written method. A number nobody can check is not analysis.
 *
 * Customer email and checkout IP are deliberately left out. The export exists
 * for profit analysis, that analysis never needs them, and the file is made to
 * be handed to someone outside the business.
 */

export interface ExportOptions {
  tenantIds: string[]
  from: string
  to: string
  /** Order-level detail can run to thousands of rows; off by default. */
  includeOrders?: boolean
}

const MONEY = '#,##0.00'
const PCT = '0.0"%"'

type Row = Record<string, unknown>

function sheet(wb: ExcelJS.Workbook, name: string, columns: Partial<ExcelJS.Column>[], rows: Row[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = columns
  ws.getRow(1).font = { bold: true }
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
  for (const r of rows) ws.addRow(r)
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } }
  return ws
}

async function storeNames(ids: string[]): Promise<Map<string, string>> {
  const rows = await query<{ id: string; shop_name: string | null; shopify_domain: string | null }>(
    `SELECT id, shop_name, shopify_domain FROM tenants WHERE id = ANY($1::text[])`, [ids]
  )
  const label = (r: typeof rows[number]) =>
    r.shop_name ?? r.shopify_domain?.replace('.myshopify.com', '') ?? 'Loja'
  // Clone stores share a Shopify name; append the handle only where they collide.
  const counts = new Map<string, number>()
  for (const r of rows) counts.set(label(r), (counts.get(label(r)) ?? 0) + 1)
  return new Map(rows.map(r => [
    r.id,
    (counts.get(label(r)) ?? 0) > 1 && r.shopify_domain
      ? `${label(r)} (${r.shopify_domain.replace('.myshopify.com', '')})`
      : label(r),
  ]))
}

export async function buildStoreWorkbook(opts: ExportOptions): Promise<ExcelJS.Workbook> {
  const { tenantIds, from, to, includeOrders = true } = opts
  const names = await storeNames(tenantIds)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Opero AI'
  wb.created = new Date()

  // ── Resumo ────────────────────────────────────────────────────────────────
  const resumo: Row[] = []
  const summaries = new Map<string, Awaited<ReturnType<typeof getProfitSummary>>>()
  for (const id of tenantIds) {
    const s = await getProfitSummary(id, from, to)
    summaries.set(id, s)
    const adj = await getAdjustments(id, from, to).catch(() => null)
    const estornos = adj?.refundAmount ?? 0
    const cbValor = adj?.chargebackAmount ?? 0
    const cbTaxas = adj?.chargebackFees ?? 0
    const naoAds = s.totalRevenue > 0 ? (s.totalCosts - s.fbSpend) / s.totalRevenue : 0
    resumo.push({
      loja: names.get(id) ?? id,
      receita: s.totalRevenue,
      pedidos: s.orderCount,
      ticket: s.orderCount > 0 ? s.totalRevenue / s.orderCount : 0,
      cogs: s.totalCogs,
      taxa_fixa_fornecedor: s.totalSupplierOrderFees,
      frete: s.totalShipping,
      taxas_pagamento: s.totalFees,
      custos_extras: s.totalExtraCosts,
      desconto_unidade_extra: -s.totalAdditionalUnitSavings,
      gasto_ads: s.fbSpend,
      custo_total: s.totalCosts,
      lucro: s.netProfit,
      margem: s.margin,
      roas: s.fbSpend > 0 ? s.totalRevenue / s.fbSpend : 0,
      roas_equilibrio: naoAds < 1 ? 1 / (1 - naoAds) : 0,
      estornos: -estornos,
      chargebacks: -cbValor,
      taxas_chargeback: -cbTaxas,
      resultado_caixa: s.netProfit - estornos - cbValor - cbTaxas,
    })
  }
  sheet(wb, 'Resumo', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'Receita', key: 'receita', width: 13, style: { numFmt: MONEY } },
    { header: 'Pedidos', key: 'pedidos', width: 10 },
    { header: 'Ticket médio', key: 'ticket', width: 13, style: { numFmt: MONEY } },
    { header: 'COGS + embalagem', key: 'cogs', width: 17, style: { numFmt: MONEY } },
    { header: 'Taxa fixa fornecedor', key: 'taxa_fixa_fornecedor', width: 19, style: { numFmt: MONEY } },
    { header: 'Frete', key: 'frete', width: 11, style: { numFmt: MONEY } },
    { header: 'Taxas de pagamento', key: 'taxas_pagamento', width: 19, style: { numFmt: MONEY } },
    { header: 'Custos extras', key: 'custos_extras', width: 14, style: { numFmt: MONEY } },
    { header: 'Desc. unidade extra', key: 'desconto_unidade_extra', width: 19, style: { numFmt: MONEY } },
    { header: 'Gasto com ads', key: 'gasto_ads', width: 14, style: { numFmt: MONEY } },
    { header: 'Custo total', key: 'custo_total', width: 13, style: { numFmt: MONEY } },
    { header: 'Lucro', key: 'lucro', width: 13, style: { numFmt: MONEY } },
    { header: 'Margem %', key: 'margem', width: 11, style: { numFmt: PCT } },
    { header: 'ROAS', key: 'roas', width: 9, style: { numFmt: '0.00' } },
    { header: 'ROAS equilíbrio', key: 'roas_equilibrio', width: 15, style: { numFmt: '0.00' } },
    { header: 'Estornos', key: 'estornos', width: 12, style: { numFmt: MONEY } },
    { header: 'Chargebacks', key: 'chargebacks', width: 13, style: { numFmt: MONEY } },
    { header: 'Taxas chargeback', key: 'taxas_chargeback', width: 17, style: { numFmt: MONEY } },
    { header: 'Resultado de caixa', key: 'resultado_caixa', width: 18, style: { numFmt: MONEY } },
  ], resumo)

  // ── Diário ────────────────────────────────────────────────────────────────
  const diario: Row[] = []
  for (const id of tenantIds) {
    const { dailyData } = await getDailyProfitData(id, from, to).catch(() => ({ dailyData: [] }))
    for (const d of dailyData) {
      diario.push({
        loja: names.get(id) ?? id, data: d.date,
        receita: d.revenue, gasto_ads: d.fbSpend, lucro: d.profit,
        margem: d.margin ?? 0,
        roas: d.fbSpend > 0 ? d.revenue / d.fbSpend : 0,
      })
    }
  }
  diario.sort((a, b) => String(a.data).localeCompare(String(b.data)))
  sheet(wb, 'Diário', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'Data', key: 'data', width: 12 },
    { header: 'Receita', key: 'receita', width: 13, style: { numFmt: MONEY } },
    { header: 'Gasto com ads', key: 'gasto_ads', width: 14, style: { numFmt: MONEY } },
    { header: 'Lucro', key: 'lucro', width: 13, style: { numFmt: MONEY } },
    { header: 'Margem %', key: 'margem', width: 11, style: { numFmt: PCT } },
    { header: 'ROAS', key: 'roas', width: 9, style: { numFmt: '0.00' } },
  ], diario)

  // ── Produtos ──────────────────────────────────────────────────────────────
  const produtos = await query<{
    tenant_id: string; product_title: string | null; product_id: string | null
    unidades: string; receita: string; pedidos: string
  }>(`
    SELECT oi.tenant_id, oi.product_title, oi.product_id,
           SUM(oi.quantity)::text AS unidades,
           SUM(oi.quantity * oi.price)::text AS receita,
           COUNT(DISTINCT oi.order_id)::text AS pedidos
    FROM shopify_order_items oi
    JOIN shopify_orders o ON o.order_id = oi.order_id AND o.tenant_id = oi.tenant_id
    JOIN tenants t ON t.id = o.tenant_id
    WHERE oi.tenant_id = ANY($1::text[])
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone,'UTC'))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded','voided')
    GROUP BY 1,2,3 ORDER BY SUM(oi.quantity * oi.price) DESC
  `, [tenantIds, from, to])
  sheet(wb, 'Produtos', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'Produto', key: 'produto', width: 46 },
    { header: 'ID do produto', key: 'pid', width: 18 },
    { header: 'Unidades', key: 'unidades', width: 11 },
    { header: 'Pedidos', key: 'pedidos', width: 10 },
    { header: 'Receita', key: 'receita', width: 13, style: { numFmt: MONEY } },
    { header: 'Preço médio', key: 'medio', width: 13, style: { numFmt: MONEY } },
  ], produtos.map(p => ({
    loja: names.get(p.tenant_id) ?? p.tenant_id,
    produto: p.product_title, pid: p.product_id,
    unidades: Number(p.unidades), pedidos: Number(p.pedidos),
    receita: Number(p.receita),
    medio: Number(p.unidades) > 0 ? Number(p.receita) / Number(p.unidades) : 0,
  })))

  // ── Países ────────────────────────────────────────────────────────────────
  const paises = await query<{
    tenant_id: string; country_code: string | null; pedidos: string; receita: string; unidades: string
  }>(`
    SELECT o.tenant_id, o.country_code, COUNT(DISTINCT o.order_id)::text AS pedidos,
           SUM(o.total_price)::text AS receita,
           COALESCE(SUM(i.un),0)::text AS unidades
    FROM shopify_orders o
    JOIN tenants t ON t.id = o.tenant_id
    LEFT JOIN LATERAL (
      SELECT SUM(quantity) un FROM shopify_order_items
      WHERE order_id = o.order_id AND tenant_id = o.tenant_id
    ) i ON TRUE
    WHERE o.tenant_id = ANY($1::text[])
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone,'UTC'))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded','voided')
    GROUP BY 1,2 ORDER BY SUM(o.total_price) DESC
  `, [tenantIds, from, to])
  sheet(wb, 'Países', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'País', key: 'pais', width: 8 },
    { header: 'Pedidos', key: 'pedidos', width: 10 },
    { header: 'Unidades', key: 'unidades', width: 11 },
    { header: 'Receita', key: 'receita', width: 13, style: { numFmt: MONEY } },
    { header: 'Ticket médio', key: 'ticket', width: 13, style: { numFmt: MONEY } },
  ], paises.map(p => ({
    loja: names.get(p.tenant_id) ?? p.tenant_id, pais: p.country_code ?? '—',
    pedidos: Number(p.pedidos), unidades: Number(p.unidades), receita: Number(p.receita),
    ticket: Number(p.pedidos) > 0 ? Number(p.receita) / Number(p.pedidos) : 0,
  })))

  // ── Campanhas e anúncios ──────────────────────────────────────────────────
  const campanhas = await query<{
    tenant_id: string; campaign_id: string | null; landing_url: string | null
    gasto: string; compras: string; valor: string; impressoes: string; cliques: string
  }>(`
    SELECT m.tenant_id, a.campaign_id, MAX(a.landing_url) AS landing_url,
           SUM(m.spend)::text AS gasto, SUM(m.purchases)::text AS compras,
           SUM(m.purchase_value)::text AS valor,
           SUM(m.impressions)::text AS impressoes, SUM(m.clicks)::text AS cliques
    FROM fb_ad_daily_metrics m
    JOIN fb_ads a ON a.ad_id = m.ad_id
    WHERE m.tenant_id = ANY($1::text[]) AND m.date BETWEEN $2::date AND $3::date
      AND a.campaign_id IS NOT NULL
    GROUP BY 1,2 HAVING SUM(m.spend) > 0 ORDER BY SUM(m.spend) DESC
  `, [tenantIds, from, to])
  sheet(wb, 'Campanhas', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'ID da campanha', key: 'cid', width: 22 },
    { header: 'Destino', key: 'url', width: 54 },
    { header: 'Gasto', key: 'gasto', width: 12, style: { numFmt: MONEY } },
    { header: 'Compras (Meta)', key: 'compras', width: 15 },
    { header: 'Valor (Meta)', key: 'valor', width: 14, style: { numFmt: MONEY } },
    { header: 'ROAS (Meta)', key: 'roas', width: 13, style: { numFmt: '0.00' } },
    { header: 'Impressões', key: 'imp', width: 13 },
    { header: 'Cliques', key: 'cliques', width: 11 },
    { header: 'CPC', key: 'cpc', width: 10, style: { numFmt: MONEY } },
  ], campanhas.map(c => ({
    loja: names.get(c.tenant_id) ?? c.tenant_id, cid: c.campaign_id, url: c.landing_url,
    gasto: Number(c.gasto), compras: Number(c.compras), valor: Number(c.valor),
    roas: Number(c.gasto) > 0 ? Number(c.valor) / Number(c.gasto) : 0,
    imp: Number(c.impressoes), cliques: Number(c.cliques),
    cpc: Number(c.cliques) > 0 ? Number(c.gasto) / Number(c.cliques) : 0,
  })))

  // ── Estornos e chargebacks ────────────────────────────────────────────────
  // Line by line, straight from the table: the totals above are sums of these.
  const ajustes = (await query<{
    tenant_id: string; event_date: string; order_date: string | null; kind: string
    order_id: string | null; amount: string; fee: string; reason: string | null; status: string | null
  }>(`
    SELECT tenant_id, event_date::text, order_date::text, kind, order_id,
           amount::text, fee::text, reason, status
    FROM order_adjustments
    WHERE tenant_id = ANY($1::text[]) AND event_date BETWEEN $2::date AND $3::date
    ORDER BY event_date DESC, amount DESC
  `, [tenantIds, from, to])).map(a => ({
    loja: names.get(a.tenant_id) ?? a.tenant_id,
    data: a.event_date, data_pedido: a.order_date ?? '', tipo: a.kind,
    pedido: a.order_id ?? '', valor: -Number(a.amount), taxa: -Number(a.fee),
    motivo: a.reason ?? '', situacao: a.status ?? '',
  }))
  sheet(wb, 'Estornos e chargebacks', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'Data do evento', key: 'data', width: 14 },
    { header: 'Data do pedido', key: 'data_pedido', width: 14 },
    { header: 'Tipo', key: 'tipo', width: 13 },
    { header: 'Pedido', key: 'pedido', width: 14 },
    { header: 'Valor', key: 'valor', width: 12, style: { numFmt: MONEY } },
    { header: 'Taxa', key: 'taxa', width: 10, style: { numFmt: MONEY } },
    { header: 'Motivo', key: 'motivo', width: 22 },
    { header: 'Situação', key: 'situacao', width: 16 },
  ], ajustes)

  // ── Saúde de chargebacks ──────────────────────────────────────────────────
  const saude: Row[] = []
  for (const id of tenantIds) {
    const h = await getChargebackHealth(id).catch(() => null)
    if (!h?.hasData) continue
    saude.push({
      loja: names.get(id) ?? id, disputas: h.count, pedidos: h.orders,
      taxa: h.rate, limite: 1.5, abertas: h.open,
      situacao: h.rate >= 1.5 ? 'ACIMA DO LIMITE' : 'ok',
    })
  }
  sheet(wb, 'Saúde chargeback 90d', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'Disputas', key: 'disputas', width: 11 },
    { header: 'Pedidos', key: 'pedidos', width: 11 },
    { header: 'Taxa %', key: 'taxa', width: 10, style: { numFmt: PCT } },
    { header: 'Limite Shopify %', key: 'limite', width: 17, style: { numFmt: PCT } },
    { header: 'Em aberto', key: 'abertas', width: 12 },
    { header: 'Situação', key: 'situacao', width: 18 },
  ], saude)

  // ── Pedidos ───────────────────────────────────────────────────────────────
  if (includeOrders) await addOrdersSheet(wb, tenantIds, from, to, names)

  // ── Configuração de custos ────────────────────────────────────────────────
  await addConfigSheet(wb, tenantIds, names)

  // ── Metodologia ───────────────────────────────────────────────────────────
  addMethodSheet(wb, from, to, tenantIds.map(id => names.get(id) ?? id))

  return wb
}

/** Order-level detail, priced through the same engine the dashboard uses. */
async function addOrdersSheet(
  wb: ExcelJS.Workbook, tenantIds: string[], from: string, to: string, names: Map<string, string>
) {
  const rows = await query<{
    tenant_id: string; order_id: string; order_number: string | null; order_date: string
    country_code: string | null; total_price: string
    product_id: string | null; product_title: string | null; units: string
  }>(`
    SELECT o.tenant_id, o.order_id, o.order_number::text, o.country_code, o.total_price::text,
           (o.created_at AT TIME ZONE COALESCE(t.timezone,'UTC'))::date::text AS order_date,
           oi.product_id, oi.product_title, COALESCE(oi.quantity,1)::text AS units
    FROM shopify_orders o
    JOIN tenants t ON t.id = o.tenant_id
    LEFT JOIN shopify_order_items oi ON oi.order_id = o.order_id AND oi.tenant_id = o.tenant_id
    WHERE o.tenant_id = ANY($1::text[])
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone,'UTC'))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded','voided')
    ORDER BY o.created_at
  `, [tenantIds, from, to])

  const byOrder = new Map<string, {
    tenant_id: string; order_number: string | null; order_date: string
    country_code: string | null; total_price: string
    items: { product_id: string | null; product_title: string | null; units: number }[]
  }>()
  for (const r of rows) {
    const key = `${r.tenant_id}:${r.order_id}`
    if (!byOrder.has(key)) byOrder.set(key, { ...r, items: [] })
    byOrder.get(key)!.items.push({
      product_id: r.product_id, product_title: r.product_title, units: Number(r.units),
    })
  }

  // Each store prices its orders with its own configuration.
  const cfgs = new Map<string, ProfitConfig>()
  for (const r of await query<{ tenant_id: string; settings: ProfitConfig }>(
    `SELECT tenant_id, settings FROM profit_settings WHERE tenant_id = ANY($1::text[])`, [tenantIds]
  )) cfgs.set(r.tenant_id, r.settings)

  const out: Row[] = []
  for (const o of byOrder.values()) {
    const cfg = cfgs.get(o.tenant_id)
    const receita = Number(o.total_price)
    let cogs = 0, embalagem = 0, taxaFixa = 0, desconto = 0, taxas = 0
    if (cfg) {
      const c = orderSupplierCost(o, buildCogsLookups(cfg), cfg)
      cogs = c.cogs; embalagem = c.packaging; taxaFixa = c.orderFee; desconto = c.saving
      taxas = receita * (cfg.shopify.transaction_fee_pct / 100)
            + receita * (cfg.shopify.payment_processing_pct / 100)
            + cfg.shopify.payment_processing_fixed
    }
    const bruto = receita - cogs - embalagem - taxaFixa - taxas + desconto
    out.push({
      loja: names.get(o.tenant_id) ?? o.tenant_id,
      pedido: o.order_number ?? '', data: o.order_date, pais: o.country_code ?? '—',
      unidades: o.items.reduce((s, i) => s + i.units, 0),
      itens: o.items.map(i => `${i.units}x ${i.product_title ?? '?'}`).join(' + '),
      receita, cogs, embalagem, taxa_fixa: taxaFixa,
      desconto_unidade_extra: desconto, taxas_pagamento: taxas,
      margem_bruta: bruto,
      margem_pct: receita > 0 ? (bruto / receita) * 100 : 0,
    })
  }
  sheet(wb, 'Pedidos', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'Pedido', key: 'pedido', width: 10 },
    { header: 'Data', key: 'data', width: 12 },
    { header: 'País', key: 'pais', width: 7 },
    { header: 'Unidades', key: 'unidades', width: 10 },
    { header: 'Itens', key: 'itens', width: 50 },
    { header: 'Receita', key: 'receita', width: 12, style: { numFmt: MONEY } },
    { header: 'COGS', key: 'cogs', width: 11, style: { numFmt: MONEY } },
    { header: 'Embalagem', key: 'embalagem', width: 12, style: { numFmt: MONEY } },
    { header: 'Taxa fixa país', key: 'taxa_fixa', width: 14, style: { numFmt: MONEY } },
    { header: 'Desc. unid. extra', key: 'desconto_unidade_extra', width: 17, style: { numFmt: MONEY } },
    { header: 'Taxas pagamento', key: 'taxas_pagamento', width: 17, style: { numFmt: MONEY } },
    { header: 'Margem bruta', key: 'margem_bruta', width: 14, style: { numFmt: MONEY } },
    { header: 'Margem %', key: 'margem_pct', width: 11, style: { numFmt: PCT } },
  ], out)
}

/** The cost configuration every figure above was derived from. */
async function addConfigSheet(wb: ExcelJS.Workbook, tenantIds: string[], names: Map<string, string>) {
  const rows: Row[] = []
  for (const r of await query<{ tenant_id: string; settings: ProfitConfig }>(
    `SELECT tenant_id, settings FROM profit_settings WHERE tenant_id = ANY($1::text[])`, [tenantIds]
  )) {
    const loja = names.get(r.tenant_id) ?? r.tenant_id
    const c = r.settings
    const add = (grupo: string, item: string, valor: unknown, obs = '') =>
      rows.push({ loja, grupo, item, valor, obs })

    add('Taxas', 'Taxa de transação Shopify', `${c.shopify.transaction_fee_pct}%`)
    add('Taxas', 'Processamento de pagamento', `${c.shopify.payment_processing_pct}%`)
    add('Taxas', 'Processamento (fixo por pedido)', c.shopify.payment_processing_fixed)
    add('COGS', 'Custo padrão por unidade', c.cogs.default_cost_usd, 'usado quando o produto não tem preço próprio')
    add('COGS', 'Embalagem por pedido', c.cogs.packaging_cost_usd)
    add('COGS', 'Embalagem por unidade', c.cogs.packaging_per_unit_usd ?? 0,
      (c.cogs.packaging_per_unit_products?.length ?? 0) > 0
        ? `só em ${c.cogs.packaging_per_unit_products!.length} produto(s)` : 'em todas as unidades')
    add('COGS', 'Desconto por unidade adicional', c.cogs.additional_unit_discount_usd ?? 0)
    for (const p of c.cogs.products ?? []) {
      if (!(p.cost_usd > 0)) continue
      add('Preço base por produto', p.name, p.cost_usd, p.product_id)
    }
    for (const f of c.cogs.order_fees ?? []) {
      add('Taxa fixa por país', `${f.country_code} ${f.name ?? ''}`.trim(), f.amount_usd,
        f.effective_from ? `desde ${f.effective_from}` : '')
    }
    for (const cp of c.cogs.country_prices ?? []) {
      for (const [cc, v] of Object.entries(cp.prices ?? {})) {
        add('Preço por país', `${cp.name ?? cp.product_id} → ${cc}`, v, cp.product_id)
      }
    }
    for (const e of c.extra_costs ?? []) add('Custos extras', e.name, e.amount_usd, e.frequency)
    for (const s of c.shipping?.rates ?? []) add('Frete por país', `${s.country_code} ${s.name}`.trim(), s.cost_usd)
    if ((c.shipping?.default_rate_usd ?? 0) > 0) add('Frete', 'Padrão', c.shipping.default_rate_usd)
  }
  sheet(wb, 'Configuração de custos', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'Grupo', key: 'grupo', width: 24 },
    { header: 'Item', key: 'item', width: 52 },
    { header: 'Valor', key: 'valor', width: 14 },
    { header: 'Observação', key: 'obs', width: 44 },
  ], rows)
}

function addMethodSheet(wb: ExcelJS.Workbook, from: string, to: string, lojas: string[]) {
  const ws = wb.addWorksheet('Metodologia')
  ws.columns = [{ width: 24 }, { width: 110 }]
  const linhas: [string, string][] = [
    ['Período', `${from} a ${to}, pela data do pedido no fuso de cada loja`],
    ['Lojas', lojas.join(' · ')],
    ['Gerado em', new Date().toISOString().slice(0, 19).replace('T', ' ') + ' UTC'],
    ['', ''],
    ['Lucro', 'receita − COGS − embalagem − taxa fixa do país − frete − taxas de pagamento − custos extras − gasto com ads + desconto por unidade adicional'],
    ['Custo do fornecedor', 'preço de tabela do país × quantidade + taxa fixa do país − desconto por unidade adicional. O frete vem embutido no preço de tabela, por isso ele muda por destino.'],
    ['Embalagem', 'Cobrada por unidade, e apenas nos produtos listados na aba de configuração. Caixas e cartões são comprados em lote e rateados.'],
    ['Pedidos excluídos', 'Pedidos com situação financeira "refunded" ou "voided" ficam fora de toda a apuração.'],
    ['Estornos e chargebacks', 'Lançados na data em que ocorreram, não na data do pedido. Por isso ficam fora do lucro e aparecem à parte, no "resultado de caixa". Um chargeback de agosto que cai hoje não é um juízo sobre hoje.'],
    ['Taxa de chargeback', 'Disputas dos últimos 90 dias sobre pedidos dos últimos 90 dias. Acima de 1,5% a Shopify Payments fica em risco.'],
    ['Dados da Meta', 'As colunas "Compras (Meta)" e "Valor (Meta)" são o que a Meta atribui à campanha, não o que a loja registrou. A Meta credita qualquer compra de quem viu o anúncio, inclusive de outro produto, então esse valor costuma ser maior que a venda do produto anunciado.'],
    ['ROAS de equilíbrio', 'ROAS mínimo para o lucro ser zero, dado o custo não publicitário do período. Abaixo dele a campanha perde dinheiro mesmo vendendo.'],
    ['', ''],
    ['Não incluído', 'E-mail do cliente e IP de checkout foram deixados de fora de propósito: a análise de lucro não precisa deles e este arquivo é feito para sair da empresa.'],
    ['Moeda', 'Todos os valores em dólar americano.'],
  ]
  ws.addRow(['Opero AI — exportação de dados da loja']).font = { bold: true, size: 14 }
  ws.addRow([])
  for (const [k, v] of linhas) {
    const r = ws.addRow([k, v])
    r.getCell(1).font = { bold: true }
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' }
  }
}
