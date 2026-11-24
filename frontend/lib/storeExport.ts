import ExcelJS from 'exceljs'
import { query } from './db'
import {
  KEPT_ORDER_SQL, chargebackCounts, computePnL, loadStores, sumPnL,
  type PnL, type StorePnL,
} from './engine/pnl'
import {
  buildCogsLookups, orderFees, orderSupplierCost, perOrderExtras, shippingCost,
  type CostItem, type ProfitConfig,
} from './engine/costs'
import { formatRange, todayInTz, type DateRange } from './engine/dates'
import { PRICING_SOURCE_LABEL, costLines, normalizeSavedConfig, pricingSource } from './data/profitConfig'
import { ORPHAN_CAMPAIGN_NAME, isSharedAccount, loadAdDayFacts, loadAdInfo } from './data/meta'
import { getChargebackHealth, type ChargebackHealth } from './adjustments'
import type { StoreRef } from './access'

/**
 * A full accounting of one or more stores over a period, as a spreadsheet.
 *
 * Every figure comes from the profit engine (lib/engine): the summary is the
 * engine's totals, the daily sheet its day series (which sums to the totals),
 * products and countries its per-order costs grouped. The earlier export
 * priced things its own way and it showed: a cash result that subtracted a
 * fully refunded order twice, cost columns that could not add up to the total
 * (Shop Campaigns had no column, the EU fee was counted twice), campaign spend
 * missing every ad the sync had not described, dates as "2026-10-18
 * 00:00:00+00" text.
 *
 * The reader is assumed to have no access to Opero, so the workbook carries its
 * own context: the cost settings every figure was derived from, a written
 * method, and reconciliation rows that show the columns add up.
 *
 * Customer e-mail and checkout IP are deliberately left out: the analysis
 * never needs them and the file is made to be handed to someone outside the
 * business.
 */

export interface ExportOptions {
  /** Stores already resolved through lib/access — this module never decides
   *  who may see what. `name` is the disambiguated label. */
  stores: Pick<StoreRef, 'id' | 'name' | 'timezone'>[]
  range: DateRange
  /** Order-level detail can run to thousands of rows. Default true. */
  includeOrders?: boolean
  now?: Date
}

// ─── Data ─────────────────────────────────────────────────────────────────────

type ExportStore = ExportOptions['stores'][number]

export interface StoreConfig {
  configured: boolean
  /** Normalised (every key present): what the "Configuração de custos" sheet lists. */
  config: ProfitConfig
  /** The stored row exactly as the engine read it, used to price orders and
   *  name each product's cost rule, so the order sheet adds up to the engine's
   *  totals even for a row normalising would change. Falls back to `config`. */
  engineConfig?: ProfitConfig
}

/** One row of order_adjustments as the export reads it. */
export interface AdjustmentRow {
  tenant_id: string
  kind: string
  order_id: string | null
  order_number: number | null
  event_date: string
  order_date: string | null
  amount: number
  fee: number | null
  currency: string | null
  reason: string | null
  status: string | null
  order_status: string | null
  order_currency: string | null
  fx_rate: number | null
  order_known: boolean
}

export interface CampaignLine {
  storeId: string
  campaignId: string | null
  name: string
  accountId: string | null
  sharedAccount: boolean
  landingUrl: string | null
  spend: number
  purchases: number
  purchaseValue: number
  /** Purchase value Meta reported and the phantom filter dropped. */
  phantomValue: number
  impressions: number
  linkClicks: number
}

export interface OrderRow {
  tenant_id: string
  order_number: number | null
  total: number
  country_code: string | null
  d: string
  items: { p: string | null; t: string | null; u: number | null; v: number | null }[]
}

export interface ExportData {
  range: DateRange
  generatedAt: Date
  stores: ExportStore[]
  pnl: Map<string, StorePnL>
  configs: Map<string, StoreConfig>
  adjustments: AdjustmentRow[]
  campaigns: CampaignLine[]
  health: Map<string, ChargebackHealth>
  /** Null when order detail was not asked for. */
  orders: OrderRow[] | null
}

async function loadAdjustmentRows(ids: string[], range: DateRange): Promise<AdjustmentRow[]> {
  return query<AdjustmentRow>(
    `SELECT a.tenant_id, a.kind, a.order_id, o.order_number, a.event_date::text AS event_date,
            a.order_date::text AS order_date, a.amount::float8 AS amount, a.fee::float8 AS fee,
            a.currency, a.reason, a.status,
            o.financial_status AS order_status, o.currency AS order_currency,
            o.fx_rate::float8 AS fx_rate, (o.order_id IS NOT NULL) AS order_known
       FROM order_adjustments a
       LEFT JOIN shopify_orders o ON o.order_id = a.order_id AND o.tenant_id = a.tenant_id
      WHERE a.tenant_id = ANY($1::text[]) AND a.event_date BETWEEN $2::date AND $3::date
      ORDER BY a.event_date, a.kind DESC, a.amount DESC`,
    [ids, range.from, range.to],
  )
}

/** Spend per campaign from the shared Meta read (lib/data/meta): every ad-day
 *  of the store, so a store's campaigns add up to the Meta spend the engine
 *  charges it, ads the sync has not described included. */
async function loadCampaignLines(storeId: string, range: DateRange): Promise<CampaignLine[]> {
  const facts = await loadAdDayFacts(storeId, range)
  const info = await loadAdInfo(facts.map(f => f.adId))
  const by = new Map<string, CampaignLine>()
  for (const f of facts) {
    const key = f.campaignId ?? ''
    const ad = info.get(f.adId)
    const line = by.get(key) ?? {
      storeId, campaignId: f.campaignId,
      name: f.campaignId ? ad?.campaignName || `Campanha ${f.campaignId}` : ORPHAN_CAMPAIGN_NAME,
      accountId: f.accountId, sharedAccount: isSharedAccount(f.accountId), landingUrl: ad?.landingUrl ?? null,
      spend: 0, purchases: 0, purchaseValue: 0, phantomValue: 0, impressions: 0, linkClicks: 0,
    }
    line.spend += f.spend
    line.purchases += f.purchases
    line.purchaseValue += f.purchaseValue
    line.phantomValue += f.phantomValue
    line.impressions += f.impressions
    line.linkClicks += f.linkClicks
    line.accountId ??= f.accountId
    line.sharedAccount ||= isSharedAccount(f.accountId)
    line.landingUrl ??= ad?.landingUrl ?? null
    // The first ad seen may carry no campaign name while a later one does.
    if (f.campaignId && line.name === `Campanha ${f.campaignId}` && ad?.campaignName) line.name = ad.campaignName
    by.set(key, line)
  }
  return [...by.values()].filter(l => l.spend > 0 || l.purchaseValue > 0).sort((a, b) => b.spend - a.spend)
}

/** Orders exactly as the engine selects them (same timezone cut, same status
 *  filter, same items), with the order number for the reader. */
async function loadOrderRows(ids: string[], range: DateRange): Promise<OrderRow[]> {
  return query<OrderRow>(
    `SELECT o.tenant_id, o.order_number, o.total_price::float8 AS total, o.country_code,
            (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date::text AS d,
            COALESCE(
              (SELECT json_agg(json_build_object('p', oi.product_id, 't', oi.product_title,
                                                 'u', oi.quantity, 'v', oi.price) ORDER BY oi.id)
                 FROM shopify_order_items oi
                WHERE oi.order_id = o.order_id
                  AND (oi.tenant_id IS NULL OR oi.tenant_id = o.tenant_id)),
              '[]'::json) AS items
       FROM shopify_orders o
       JOIN tenants t ON t.id = o.tenant_id
      WHERE o.tenant_id = ANY($1::text[])
        AND o.created_at >= ($2::date - 2)::timestamptz
        AND o.created_at <  ($3::date + 3)::timestamptz
        AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
        AND ${KEPT_ORDER_SQL}
      ORDER BY o.created_at`,
    [ids, range.from, range.to],
  )
}

export async function loadExportData(opts: ExportOptions): Promise<ExportData> {
  const { stores, range, includeOrders = true, now = new Date() } = opts
  const ids = stores.map(s => s.id)
  const [pnl, storeRows, adjustments, campaigns, health, orders] = await Promise.all([
    computePnL(ids, range, { products: true, countries: true }, now),
    loadStores(ids),
    loadAdjustmentRows(ids, range),
    Promise.all(stores.map(s => loadCampaignLines(s.id, range))).then(x => x.flat()),
    Promise.all(stores.map(async s => [s.id, await getChargebackHealth(s.id)] as const)).then(x => new Map(x)),
    includeOrders ? loadOrderRows(ids, range) : Promise.resolve(null),
  ])
  const configs = new Map<string, StoreConfig>()
  for (const r of storeRows) {
    const n = normalizeSavedConfig(r.settings)
    configs.set(r.id, { configured: n.configured, config: n.config, engineConfig: n.configured && r.settings ? r.settings : undefined })
  }
  return { range, generatedAt: now, stores: stores.filter(s => pnl.has(s.id)), pnl, configs, adjustments, campaigns, health, orders }
}

export async function buildStoreWorkbook(opts: ExportOptions): Promise<ExcelJS.Workbook> {
  return writeWorkbook(await loadExportData(opts))
}

// ─── Pure pieces (unit-tested) ────────────────────────────────────────────────

/** "Custo total": everything between revenue and profit. */
export const totalCost = (t: PnL) => t.variableCosts + t.fixedCosts + t.metaSpend + t.shopSpend

/** The cost columns, in statement order, summing exactly to totalCost(t). */
export function costColumns(t: PnL): { key: string; label: string; amount: number }[] {
  return [
    ...costLines(t).map(l => ({ key: l.key, label: l.label, amount: l.amount })),
    { key: 'meta_ads', label: 'Anúncios Meta', amount: t.metaSpend },
    { key: 'shop_ads', label: 'Anúncios Shopify (Shop Campaigns)', amount: t.shopSpend },
  ]
}

/** What a refund costs per dollar refunded: the window's contribution margin,
 *  clamped to [0, 1], 1 without revenue — the engine's rule. */
export function refundFactor(t: PnL): number {
  const cm = t.revenue > 0 ? t.contribution / t.revenue : 1
  return Math.max(0, Math.min(1, cm))
}

export interface AdjustmentEffect {
  /** The amount in US dollars (0 when it cannot be converted). */
  usd: number
  counted: boolean
  /** What it takes off the result (refund: its margin; chargeback: all of it). */
  value: number
  fee: number
  note: string
}

/**
 * How the engine books one refund or chargeback (lib/engine/pnl.ts,
 * computePnL), line by line so the sheet adds up to the summary. Mirrors the
 * engine because it exposes only the totals; the production check compares
 * the sums with the engine's to the cent.
 */
export function adjustmentEffect(a: AdjustmentRow, factor: number): AdjustmentEffect {
  const amount = Number(a.amount) || 0
  let usd = 0
  let note = ''
  if (!a.currency || a.currency === 'USD') usd = amount
  else if (a.fx_rate && a.order_currency === a.currency) usd = amount * a.fx_rate
  else note = `Em ${a.currency} sem câmbio conhecido: não convertido, fica fora. `

  if (a.kind === 'refund') {
    if (a.order_known && a.order_status === 'refunded') {
      return { usd, counted: false, value: 0, fee: 0, note: 'Pedido reembolsado por inteiro: já saiu da receita do dia em que foi feito.' }
    }
    return { usd, counted: usd !== 0, value: usd * factor, fee: 0, note: `${note}Custa a margem do pedido (${(factor * 100).toFixed(1)}% do valor).` }
  }
  if (a.kind === 'chargeback') {
    if (!chargebackCounts(a.status)) return { usd, counted: false, value: 0, fee: 0, note: 'Disputa ganha: não conta.' }
    return { usd, counted: true, value: usd, fee: Number(a.fee) || 0, note: `${note}Valor integral mais a taxa.` }
  }
  return { usd, counted: false, value: 0, fee: 0, note: 'Tipo não usado no resultado.' }
}

export const ORDER_COST_KEYS = [
  'units', 'revenue', 'cogs', 'packaging', 'supplierFees', 'unitSavings', 'shipping',
  'shopifyFees', 'paymentFees', 'perOrderExtras', 'variableCosts',
] as const

export interface OrderCosts {
  units: number
  revenue: number
  cogs: number
  packaging: number
  supplierFees: number
  unitSavings: number
  shipping: number
  shopifyFees: number
  paymentFees: number
  perOrderExtras: number
  variableCosts: number
}

/** Lookups built once per config, not once per order (a year of MOKOO is
 *  thousands of orders over 283 products and 49 country lists). */
const lookupCache = new WeakMap<ProfitConfig, ReturnType<typeof buildCogsLookups>>()
function lookupsFor(c: ProfitConfig) {
  let l = lookupCache.get(c)
  if (!l) { l = buildCogsLookups(c); lookupCache.set(c, l) }
  return l
}

/** One order's variable costs with the engine's per-order cost functions
 *  (lib/engine/costs), the way computePnL prices it: an order with no items
 *  is one unit of an unknown product. */
export function priceOrderRow(o: OrderRow, cfg: StoreConfig | undefined): OrderCosts {
  const raw = Array.isArray(o.items) ? o.items : []
  const items: CostItem[] = raw.length
    ? raw.map(i => ({ product_id: i.p ?? null, product_title: i.t ?? null, units: Math.max(0, Number(i.u ?? 1)) }))
    : [{ product_id: null, product_title: null, units: 1 }]
  const revenue = Number(o.total) || 0
  const out = sumOrderCosts([])
  out.units = items.reduce((s, i) => s + i.units, 0)
  out.revenue = revenue
  if (!cfg?.configured) return out
  const c = cfg.engineConfig ?? cfg.config
  const sup = orderSupplierCost({ country_code: o.country_code, order_date: o.d, items }, lookupsFor(c), c)
  const fees = orderFees(revenue, c)
  out.cogs = sup.cogs
  out.packaging = sup.packaging
  out.supplierFees = sup.orderFee
  out.unitSavings = sup.saving
  out.shipping = shippingCost(o.country_code, c)
  out.shopifyFees = fees.shopify
  out.paymentFees = fees.payment
  out.perOrderExtras = perOrderExtras(c)
  out.variableCosts = out.cogs + out.packaging + out.supplierFees - out.unitSavings + out.shipping
    + out.shopifyFees + out.paymentFees + out.perOrderExtras
  return out
}

export function sumOrderCosts(list: OrderCosts[]): OrderCosts {
  const out = Object.fromEntries(ORDER_COST_KEYS.map(k => [k, 0])) as Record<keyof OrderCosts, number>
  for (const c of list) for (const k of ORDER_COST_KEYS) out[k] += c[k]
  return out
}

/** A YYYY-MM-DD store date as a real Excel date. Built in UTC, which is how
 *  ExcelJS converts a Date to a serial, so the day never shifts. */
export function excelDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d))
}

// ─── Workbook ─────────────────────────────────────────────────────────────────

const FMT = {
  money: '#,##0.00',
  pct: '0.0"%"',
  ratio: '0.00',
  int: '#,##0',
  date: 'yyyy-mm-dd',
  text: '@',
} as const
type Fmt = keyof typeof FMT

interface Col { header: string; key: string; width: number; fmt?: Fmt }
type Cell = string | number | Date | null | undefined
type Row = Record<string, Cell>

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }
const HEADER_FONT: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' } }

/** A filterable table, and below it (outside the filter) bold total rows. */
function table(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: Row[], totals: Row[] = []) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] })
  ws.columns = cols.map(c => ({ header: c.header, key: c.key, width: c.width, style: c.fmt ? { numFmt: FMT[c.fmt] } : undefined }))
  ws.getRow(1).fill = HEADER_FILL
  ws.getRow(1).font = HEADER_FONT
  const clean = (r: Row) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v ?? null]))
  for (const r of rows) ws.addRow(clean(r))
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, rows.length + 1), column: cols.length } }
  if (totals.length) {
    ws.addRow({})
    for (const t of totals) ws.addRow(clean(t)).font = { bold: true }
  }
  return ws
}

const sumBy = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)
const ratioOrNull = (a: number, b: number) => (b > 0 ? a / b : null)
const colLetter = (n: number) => {
  let s = ''
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s
  return s
}

export function writeWorkbook(data: ExportData): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Opero AI'
  wb.created = data.generatedAt
  // The reconciliation rows are formulas: have Excel compute them on open.
  wb.calcProperties.fullCalcOnLoad = true

  const name = new Map(data.stores.map(s => [s.id, s.name]))
  const loja = (id: string) => name.get(id) ?? id

  addSummarySheet(wb, data)
  addDailySheet(wb, data, loja)
  addProductsSheet(wb, data, loja)
  addCountriesSheet(wb, data, loja)
  addCampaignsSheet(wb, data, loja)
  addAdjustmentsSheet(wb, data, loja)
  addHealthSheet(wb, data, loja)
  if (data.orders) addOrdersSheet(wb, data, loja)
  addConfigSheet(wb, data, loja)
  addMethodSheet(wb, data)
  return wb
}

// ── Resumo: a statement per store, the columns are stores ────────────────────

type LineDef =
  | { section: string }
  | { key: string; label: string; fmt: Fmt; get: (t: PnL, s: StorePnL | null) => Cell; strong?: boolean; cost?: boolean }

function summaryLines(): LineDef[] {
  const costKeys = costColumns(sumPnL([]))
  return [
    { section: 'Vendas' },
    { key: 'revenue', label: 'Receita', fmt: 'money', get: t => t.revenue, strong: true },
    { key: 'orders', label: 'Pedidos', fmt: 'int', get: t => t.orders },
    { key: 'units', label: 'Unidades', fmt: 'int', get: t => t.units },
    { key: 'aov', label: 'Ticket médio', fmt: 'money', get: t => ratioOrNull(t.revenue, t.orders) },
    { section: 'Custos (somam o custo total)' },
    ...costKeys.map((c, i): LineDef => ({ key: `cost_${c.key}`, label: c.label, fmt: 'money', cost: true, get: t => costColumns(t)[i].amount })),
    { key: 'total_cost', label: 'Custo total', fmt: 'money', get: t => totalCost(t), strong: true },
    { section: 'Resultado' },
    { key: 'profit', label: 'Lucro (receita − custo total)', fmt: 'money', get: t => t.operatingProfit, strong: true },
    { key: 'margin', label: 'Margem', fmt: 'pct', get: t => t.margin },
    { key: 'ppo', label: 'Lucro por pedido', fmt: 'money', get: t => t.profitPerOrder },
    { key: 'variable', label: 'Custos variáveis (produto, embalagem, frete, taxas, extras por pedido)', fmt: 'money', get: t => t.variableCosts },
    { key: 'contribution', label: 'Contribuição (receita − custos variáveis)', fmt: 'money', get: t => t.contribution },
    { key: 'cm', label: 'Margem de contribuição', fmt: 'pct', get: t => t.contributionMargin },
    { key: 'roas', label: 'ROAS (receita da loja ÷ anúncios Meta)', fmt: 'ratio', get: t => t.roas },
    { key: 'meta_roas', label: 'ROAS Meta (valor atribuído pela Meta ÷ anúncios Meta)', fmt: 'ratio', get: t => t.metaRoas },
    { key: 'be_roas', label: 'ROAS de equilíbrio (receita ÷ contribuição)', fmt: 'ratio', get: t => t.breakEvenRoas },
    { key: 'meta_purchases', label: 'Compras atribuídas pela Meta', fmt: 'int', get: t => t.metaPurchases },
    { key: 'meta_value', label: 'Valor atribuído pela Meta', fmt: 'money', get: t => t.metaPurchaseValue },
    { section: 'Estornos e chargebacks (na data em que chegaram)' },
    { key: 'refund_gross', label: 'Estornos — valor bruto (informativo)', fmt: 'money', get: t => t.refundGross },
    { key: 'refund_count', label: 'Estornos — quantidade', fmt: 'int', get: t => t.refundCount },
    { key: 'refunds', label: 'Estornos — margem devolvida', fmt: 'money', get: t => t.refunds },
    { key: 'chargebacks', label: 'Chargebacks — valor', fmt: 'money', get: t => t.chargebacks },
    { key: 'chargeback_fees', label: 'Chargebacks — taxas', fmt: 'money', get: t => t.chargebackFees },
    { key: 'chargeback_count', label: 'Chargebacks — quantidade', fmt: 'int', get: t => t.chargebackCount },
    { key: 'cash', label: 'Resultado de caixa (lucro − estornos − chargebacks − taxas)', fmt: 'money', get: t => t.cashResult, strong: true },
    { section: 'Situação' },
    { key: 'configured', label: 'Custos configurados', fmt: 'text', get: (_t, s) => (s ? (s.configured ? 'Sim' : 'Não — lucro = receita − anúncios') : '') },
    { key: 'partial', label: 'Inclui o dia de hoje (parcial)', fmt: 'text', get: (_t, s) => (s ? (s.partial ? 'Sim' : 'Não') : '') },
  ]
}

function addSummarySheet(wb: ExcelJS.Workbook, data: ExportData) {
  const ws = wb.addWorksheet('Resumo', { views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] })
  const cols: { label: string; totals: PnL; s: StorePnL | null }[] = data.stores.map(st => {
    const s = data.pnl.get(st.id)!
    return { label: st.name, totals: s.totals, s }
  })
  if (cols.length > 1) cols.push({ label: 'Total', totals: sumPnL(cols.map(c => c.totals)), s: null })

  ws.getColumn(1).width = 62
  cols.forEach((_, i) => { ws.getColumn(i + 2).width = 18 })
  ws.addRow([`Opero AI — ${formatRange(data.range)} (${data.range.from} a ${data.range.to}), em US$`]).font = { bold: true, size: 13 }
  ws.addRow([])
  const head = ws.addRow(['', ...cols.map(c => c.label)])
  head.fill = HEADER_FILL
  head.font = HEADER_FONT

  const rowOf = new Map<string, number>()
  let firstCost = 0, lastCost = 0
  for (const def of summaryLines()) {
    if ('section' in def) {
      ws.addRow([])
      ws.addRow([def.section]).font = { bold: true, color: { argb: 'FF6B7280' } }
      continue
    }
    const r = ws.addRow([def.label, ...cols.map(c => def.get(c.totals, c.s) ?? null)])
    rowOf.set(def.key, r.number)
    if (def.cost) { firstCost ||= r.number; lastCost = r.number }
    if (def.strong) r.font = { bold: true }
    cols.forEach((_, i) => { r.getCell(i + 2).numFmt = FMT[def.fmt] })
  }

  // Reconciliation: formulas over the cells above, so anyone can see the
  // columns add up. The cached result is the same check done here.
  ws.addRow([])
  ws.addRow(['Conferência (cada linha deve dar 0,00)']).font = { bold: true, color: { argb: 'FF6B7280' } }
  const at = (key: string, col: number) => `${colLetter(col)}${rowOf.get(key)}`
  const checks: { label: string; formula: (c: number) => string | null; value: (t: PnL) => number }[] = [
    {
      label: 'Soma das linhas de custo − Custo total',
      formula: c => `SUM(${colLetter(c)}${firstCost}:${colLetter(c)}${lastCost})-${at('total_cost', c)}`,
      value: t => sumBy(costColumns(t), x => x.amount) - totalCost(t),
    },
    {
      label: 'Receita − Custo total − Lucro',
      formula: c => `${at('revenue', c)}-${at('total_cost', c)}-${at('profit', c)}`,
      value: t => t.revenue - totalCost(t) - t.operatingProfit,
    },
    {
      label: 'Lucro − estornos − chargebacks − taxas − Resultado de caixa',
      formula: c => `${at('profit', c)}-${at('refunds', c)}-${at('chargebacks', c)}-${at('chargeback_fees', c)}-${at('cash', c)}`,
      value: t => t.operatingProfit - t.refunds - t.chargebacks - t.chargebackFees - t.cashResult,
    },
  ]
  if (cols.length > 1) {
    const last = cols.length // the Total column sits at index cols.length + 1
    checks.push({
      label: 'Soma das lojas − Total (lucro)',
      formula: c => (c === last + 1 ? `SUM(${colLetter(2)}${rowOf.get('profit')}:${colLetter(last)}${rowOf.get('profit')})-${at('profit', c)}` : null),
      value: () => sumBy(cols.slice(0, -1), x => x.totals.operatingProfit) - cols[cols.length - 1].totals.operatingProfit,
    })
  }
  for (const chk of checks) {
    const r = ws.addRow([chk.label])
    cols.forEach((c, i) => {
      const formula = chk.formula(i + 2)
      if (formula === null) return
      const cell = r.getCell(i + 2)
      // "|| 0" turns a -0 from rounding into a plain 0.
      cell.value = { formula, result: Math.round(chk.value(c.totals) * 100) / 100 || 0 }
      cell.numFmt = FMT.money
    })
  }
}

// ── Diário ───────────────────────────────────────────────────────────────────

const PNL_COLS: Col[] = [
  { header: 'Receita', key: 'revenue', width: 13, fmt: 'money' },
  { header: 'Pedidos', key: 'orders', width: 9, fmt: 'int' },
  { header: 'Unidades', key: 'units', width: 10, fmt: 'int' },
  ...costColumns(sumPnL([])).map((c): Col => ({ header: c.label, key: `cost_${c.key}`, width: Math.max(12, Math.min(24, c.label.length + 2)), fmt: 'money' })),
  { header: 'Custo total', key: 'total_cost', width: 13, fmt: 'money' },
  { header: 'Lucro', key: 'profit', width: 13, fmt: 'money' },
  { header: 'Margem %', key: 'margin', width: 10, fmt: 'pct' },
  { header: 'ROAS', key: 'roas', width: 8, fmt: 'ratio' },
  { header: 'Estornos (margem)', key: 'refunds', width: 16, fmt: 'money' },
  { header: 'Chargebacks', key: 'chargebacks', width: 13, fmt: 'money' },
  { header: 'Taxas de chargeback', key: 'chargeback_fees', width: 18, fmt: 'money' },
  { header: 'Resultado de caixa', key: 'cash', width: 17, fmt: 'money' },
]

function pnlRow(t: PnL): Row {
  const row: Row = {
    revenue: t.revenue, orders: t.orders, units: t.units,
    total_cost: totalCost(t), profit: t.operatingProfit, margin: t.margin, roas: t.roas,
    refunds: t.refunds, chargebacks: t.chargebacks, chargeback_fees: t.chargebackFees, cash: t.cashResult,
  }
  for (const c of costColumns(t)) row[`cost_${c.key}`] = c.amount
  return row
}

function addDailySheet(wb: ExcelJS.Workbook, data: ExportData, loja: (id: string) => string) {
  const rows: (Row & { _d: string; _i: number })[] = []
  data.stores.forEach((st, i) => {
    for (const d of data.pnl.get(st.id)!.daily) {
      rows.push({ _d: d.date, _i: i, loja: loja(st.id), data: excelDate(d.date), ...pnlRow(d) })
    }
  })
  rows.sort((a, b) => a._d.localeCompare(b._d) || a._i - b._i)
  table(wb, 'Diário', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'Data', key: 'data', width: 12, fmt: 'date' },
    ...PNL_COLS,
  ], rows.map(({ _d: _x, _i: _y, ...r }) => r))
}

// ── Produtos e países ────────────────────────────────────────────────────────

function addProductsSheet(wb: ExcelJS.Workbook, data: ExportData, loja: (id: string) => string) {
  const rows: Row[] = []
  for (const st of data.stores) {
    const cfg = data.configs.get(st.id)
    for (const p of data.pnl.get(st.id)!.products ?? []) {
      const rule = cfg?.configured ? PRICING_SOURCE_LABEL[pricingSource({ productId: p.productId, title: p.title }, cfg.config, data.range.to)] : 'Custos não configurados'
      rows.push({
        loja: loja(st.id), produto: p.title, pid: p.productId ?? '', unidades: p.units, pedidos: p.orders,
        receita: p.revenue, custos: p.variableCosts, contribuicao: p.contribution,
        margem: p.revenue > 0 ? (p.contribution / p.revenue) * 100 : null, regra: rule,
      })
    }
  }
  table(wb, 'Produtos', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'Produto', key: 'produto', width: 46 },
    { header: 'ID do produto', key: 'pid', width: 18 },
    { header: 'Unidades', key: 'unidades', width: 10, fmt: 'int' },
    { header: 'Pedidos', key: 'pedidos', width: 9, fmt: 'int' },
    { header: 'Receita (rateada)', key: 'receita', width: 16, fmt: 'money' },
    { header: 'Custos variáveis', key: 'custos', width: 16, fmt: 'money' },
    { header: 'Contribuição', key: 'contribuicao', width: 14, fmt: 'money' },
    { header: 'Margem de contribuição %', key: 'margem', width: 14, fmt: 'pct' },
    { header: 'Regra de custo (no último dia)', key: 'regra', width: 40 },
  ], rows)
}

function addCountriesSheet(wb: ExcelJS.Workbook, data: ExportData, loja: (id: string) => string) {
  const rows: Row[] = []
  for (const st of data.stores) {
    for (const c of data.pnl.get(st.id)!.countries ?? []) {
      rows.push({
        loja: loja(st.id), pais: c.country, pedidos: c.orders, receita: c.revenue,
        ticket: ratioOrNull(c.revenue, c.orders), custos: c.variableCosts, contribuicao: c.contribution,
        margem: c.revenue > 0 ? (c.contribution / c.revenue) * 100 : null,
        gasto_meta: c.metaSpend, valor_meta: c.metaPurchaseValue,
      })
    }
  }
  table(wb, 'Países', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'País', key: 'pais', width: 7 },
    { header: 'Pedidos', key: 'pedidos', width: 9, fmt: 'int' },
    { header: 'Receita', key: 'receita', width: 13, fmt: 'money' },
    { header: 'Ticket médio', key: 'ticket', width: 13, fmt: 'money' },
    { header: 'Custos variáveis', key: 'custos', width: 16, fmt: 'money' },
    { header: 'Contribuição', key: 'contribuicao', width: 14, fmt: 'money' },
    { header: 'Margem de contribuição %', key: 'margem', width: 14, fmt: 'pct' },
    { header: 'Gasto Meta (atribuição da Meta)', key: 'gasto_meta', width: 18, fmt: 'money' },
    { header: 'Valor Meta (atribuição da Meta)', key: 'valor_meta', width: 18, fmt: 'money' },
  ], rows)
}

// ── Campanhas ────────────────────────────────────────────────────────────────

function addCampaignsSheet(wb: ExcelJS.Workbook, data: ExportData, loja: (id: string) => string) {
  const row = (c: Pick<CampaignLine, 'spend' | 'purchases' | 'purchaseValue' | 'phantomValue' | 'impressions' | 'linkClicks'>): Row => ({
    gasto: c.spend, compras: c.purchases, valor: c.purchaseValue,
    roas: ratioOrNull(c.purchaseValue, c.spend), fantasma: c.phantomValue || null,
    imp: c.impressions, cliques: c.linkClicks, cpc: ratioOrNull(c.spend, c.linkClicks),
  })
  const rows = data.campaigns.map(c => ({
    loja: loja(c.storeId), campanha: c.name, cid: c.campaignId ?? '', conta: c.accountId ?? '',
    compartilhada: c.sharedAccount ? 'Sim' : '', url: c.landingUrl ?? '', ...row(c),
  }))
  const totals = data.stores.map(st => {
    const mine = data.campaigns.filter(c => c.storeId === st.id)
    const sum = (f: (c: CampaignLine) => number) => sumBy(mine, f)
    return {
      loja: `Total — ${st.name}`,
      ...row({ spend: sum(c => c.spend), purchases: sum(c => c.purchases), purchaseValue: sum(c => c.purchaseValue), phantomValue: sum(c => c.phantomValue), impressions: sum(c => c.impressions), linkClicks: sum(c => c.linkClicks) }),
    }
  })
  table(wb, 'Campanhas', [
    { header: 'Loja', key: 'loja', width: 30 },
    { header: 'Campanha', key: 'campanha', width: 40 },
    { header: 'ID da campanha', key: 'cid', width: 20 },
    { header: 'Conta de anúncio', key: 'conta', width: 22 },
    { header: 'Conta compartilhada com outra loja', key: 'compartilhada', width: 16 },
    { header: 'Destino', key: 'url', width: 48 },
    { header: 'Gasto', key: 'gasto', width: 12, fmt: 'money' },
    { header: 'Compras (Meta)', key: 'compras', width: 14, fmt: 'int' },
    { header: 'Valor (Meta)', key: 'valor', width: 14, fmt: 'money' },
    { header: 'ROAS (Meta)', key: 'roas', width: 11, fmt: 'ratio' },
    { header: 'Valor descartado (compra fantasma)', key: 'fantasma', width: 18, fmt: 'money' },
    { header: 'Impressões', key: 'imp', width: 12, fmt: 'int' },
    { header: 'Cliques no link', key: 'cliques', width: 13, fmt: 'int' },
    { header: 'CPC', key: 'cpc', width: 9, fmt: 'money' },
  ], rows, totals)
}

// ── Estornos e chargebacks ───────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = { refund: 'Estorno', chargeback: 'Chargeback' }

function addAdjustmentsSheet(wb: ExcelJS.Workbook, data: ExportData, loja: (id: string) => string) {
  const factor = new Map(data.stores.map(st => [st.id, refundFactor(data.pnl.get(st.id)!.totals)]))
  const known = new Set(data.stores.map(s => s.id))
  const lines = data.adjustments.filter(a => known.has(a.tenant_id)).map(a => ({ a, e: adjustmentEffect(a, factor.get(a.tenant_id) ?? 1) }))
  const rows = lines.map(({ a, e }) => ({
    loja: loja(a.tenant_id), data: excelDate(a.event_date), data_pedido: a.order_date ? excelDate(a.order_date) : null,
    tipo: KIND_LABEL[a.kind] ?? a.kind, pedido: a.order_number ?? a.order_id ?? '', situacao: a.status ?? '',
    moeda: a.currency ?? 'USD', valor: Number(a.amount) || 0, usd: e.usd,
    conta: e.counted ? 'Sim' : 'Não', efeito: e.value, taxa: e.fee, obs: e.note, motivo: a.reason ?? '',
  }))
  const totals = data.stores.flatMap(st => {
    const mine = lines.filter(l => l.a.tenant_id === st.id)
    const of = (kind: string) => mine.filter(l => l.a.kind === kind)
    return [
      { loja: `Total — ${st.name}`, tipo: 'Estornos', usd: sumBy(of('refund'), l => l.e.usd), efeito: sumBy(of('refund'), l => l.e.value), taxa: 0 },
      { loja: `Total — ${st.name}`, tipo: 'Chargebacks', usd: sumBy(of('chargeback'), l => l.e.usd), efeito: sumBy(of('chargeback'), l => l.e.value), taxa: sumBy(of('chargeback'), l => l.e.fee) },
    ]
  })
  table(wb, 'Estornos e chargebacks', [
    { header: 'Loja', key: 'loja', width: 30 },
    { header: 'Data do evento', key: 'data', width: 13, fmt: 'date' },
    { header: 'Data do pedido', key: 'data_pedido', width: 13, fmt: 'date' },
    { header: 'Tipo', key: 'tipo', width: 12 },
    { header: 'Pedido', key: 'pedido', width: 14 },
    { header: 'Situação', key: 'situacao', width: 15 },
    { header: 'Moeda', key: 'moeda', width: 7 },
    { header: 'Valor', key: 'valor', width: 11, fmt: 'money' },
    { header: 'Valor em US$', key: 'usd', width: 12, fmt: 'money' },
    { header: 'Conta no resultado', key: 'conta', width: 10 },
    { header: 'Sai do resultado', key: 'efeito', width: 14, fmt: 'money' },
    { header: 'Taxa', key: 'taxa', width: 9, fmt: 'money' },
    { header: 'Como foi contado', key: 'obs', width: 60 },
    { header: 'Motivo', key: 'motivo', width: 22 },
  ], rows, totals)
}

function addHealthSheet(wb: ExcelJS.Workbook, data: ExportData, loja: (id: string) => string) {
  const rows: Row[] = []
  for (const st of data.stores) {
    const h = data.health.get(st.id)
    if (!h?.hasData) continue
    rows.push({
      loja: loja(st.id), disputas: h.count, pedidos: h.orders, taxa: h.rate, limite: 1.5,
      abertas: h.open, perdidas: h.lost, ganhas: h.won, evitadas: h.prevented ?? 0, situacao: h.rate >= 1.5 ? 'ACIMA DO LIMITE' : 'ok',
    })
  }
  table(wb, 'Saúde chargeback 90d', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'Disputas', key: 'disputas', width: 10, fmt: 'int' },
    { header: 'Pedidos', key: 'pedidos', width: 10, fmt: 'int' },
    { header: 'Taxa %', key: 'taxa', width: 9, fmt: 'pct' },
    { header: 'Limite Shopify %', key: 'limite', width: 16, fmt: 'pct' },
    { header: 'Em aberto', key: 'abertas', width: 11, fmt: 'int' },
    { header: 'Perdidas', key: 'perdidas', width: 10, fmt: 'int' },
    { header: 'Ganhas', key: 'ganhas', width: 9, fmt: 'int' },
    { header: 'Evitadas', key: 'evitadas', width: 10, fmt: 'int' },
    { header: 'Situação', key: 'situacao', width: 18 },
  ], rows)
}

// ── Pedidos ──────────────────────────────────────────────────────────────────

const ORDER_COST_COLS: { key: keyof OrderCosts; header: string; sign?: -1 }[] = [
  { key: 'cogs', header: 'Custo dos produtos' },
  { key: 'packaging', header: 'Embalagem' },
  { key: 'supplierFees', header: 'Taxa fixa do fornecedor' },
  { key: 'unitSavings', header: 'Desconto por unidade adicional', sign: -1 },
  { key: 'shipping', header: 'Frete' },
  { key: 'shopifyFees', header: 'Taxa Shopify' },
  { key: 'paymentFees', header: 'Processamento de pagamento' },
  { key: 'perOrderExtras', header: 'Custos extras por pedido' },
]

function addOrdersSheet(wb: ExcelJS.Workbook, data: ExportData, loja: (id: string) => string) {
  const known = new Set(data.stores.map(s => s.id))
  const priced = (data.orders ?? []).filter(o => known.has(o.tenant_id)).map(o => ({ o, c: priceOrderRow(o, data.configs.get(o.tenant_id)) }))
  const costCells = (c: OrderCosts): Row => Object.fromEntries(ORDER_COST_COLS.map(k => [k.key, (k.sign ?? 1) * c[k.key]]))
  const rows = priced.map(({ o, c }) => ({
    loja: loja(o.tenant_id), pedido: o.order_number ?? '', data: excelDate(o.d), pais: o.country_code ?? '—',
    unidades: c.units,
    itens: (o.items ?? []).map(i => `${i.u ?? 1}x ${i.t ?? '?'}`).join(' + '),
    receita: c.revenue, ...costCells(c), custos: c.variableCosts, contribuicao: c.revenue - c.variableCosts,
    margem: c.revenue > 0 ? ((c.revenue - c.variableCosts) / c.revenue) * 100 : null,
  }))
  const totals = data.stores.map(st => {
    const sum = sumOrderCosts(priced.filter(p => p.o.tenant_id === st.id).map(p => p.c))
    return {
      loja: `Total — ${st.name}`, unidades: sum.units, receita: sum.revenue, ...costCells(sum),
      custos: sum.variableCosts, contribuicao: sum.revenue - sum.variableCosts,
      margem: sum.revenue > 0 ? ((sum.revenue - sum.variableCosts) / sum.revenue) * 100 : null,
    }
  })
  table(wb, 'Pedidos', [
    { header: 'Loja', key: 'loja', width: 30 },
    { header: 'Pedido', key: 'pedido', width: 10 },
    { header: 'Data', key: 'data', width: 12, fmt: 'date' },
    { header: 'País', key: 'pais', width: 6 },
    { header: 'Unidades', key: 'unidades', width: 9, fmt: 'int' },
    { header: 'Itens', key: 'itens', width: 50 },
    { header: 'Receita', key: 'receita', width: 12, fmt: 'money' },
    ...ORDER_COST_COLS.map((k): Col => ({ header: k.header, key: k.key, width: Math.max(11, Math.min(22, k.header.length + 2)), fmt: 'money' })),
    { header: 'Custos variáveis', key: 'custos', width: 15, fmt: 'money' },
    { header: 'Contribuição', key: 'contribuicao', width: 13, fmt: 'money' },
    { header: 'Margem de contribuição %', key: 'margem', width: 13, fmt: 'pct' },
  ], rows, totals)
}

// ── Configuração de custos ───────────────────────────────────────────────────

function addConfigSheet(wb: ExcelJS.Workbook, data: ExportData, loja: (id: string) => string) {
  const rows: Row[] = []
  const money = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  for (const st of data.stores) {
    const l = loja(st.id)
    const add = (grupo: string, item: string, valor: Cell, obs = '') => rows.push({ loja: l, grupo, item, valor, obs })
    const cfg = data.configs.get(st.id)
    if (!cfg?.configured) {
      add('Situação', 'Custos não configurados', null, 'O lucro desta loja é receita − anúncios; nenhum custo de produto, frete ou taxa foi descontado.')
      continue
    }
    const c = cfg.config
    const nameOf = new Map(c.cogs.products.map(p => [p.product_id, p.name]))
    const label = (id: string) => nameOf.get(id) || id

    add('Taxas', 'Taxa de transação Shopify (%)', c.shopify.transaction_fee_pct)
    add('Taxas', 'Processamento de pagamento (%)', c.shopify.payment_processing_pct)
    add('Taxas', 'Processamento de pagamento (fixo por pedido)', c.shopify.payment_processing_fixed)
    add('Fornecedor', 'Custo padrão por unidade', c.cogs.default_cost_usd, 'usado quando o produto não tem preço próprio')
    add('Fornecedor', 'Embalagem por pedido', c.cogs.packaging_cost_usd)
    add('Fornecedor', 'Embalagem por unidade', c.cogs.packaging_per_unit_usd ?? 0,
      (c.cogs.packaging_per_unit_products ?? []).length
        ? `só em: ${(c.cogs.packaging_per_unit_products ?? []).map(label).join(', ')}` : 'em todas as unidades')
    add('Fornecedor', 'Desconto por unidade adicional', c.cogs.additional_unit_discount_usd, 'fora das tabelas do fornecedor')
    for (const v of c.cogs.volume_discounts) {
      add('Desconto por volume', `A partir de ${v.min_units} unidades`, v.discount_value, v.discount_type === 'pct' ? '% sobre o custo padrão' : 'US$ por unidade')
    }
    for (const t of c.cogs.price_tiers ?? []) {
      const steps = Object.keys(t.order_prices).map(Number).sort((a, b) => a - b)
        .map(n => `${n} un: ${money(t.order_prices[String(n)])}`).join(' · ')
      const scope = (t.product_ids ?? []).length ? `só ${(t.product_ids ?? []).map(label).join(', ')}` : 'pedido inteiro'
      add('Tabela do fornecedor', t.label || 'Tabela do fornecedor', `${steps} · unidade extra: ${money(t.extra_unit_usd)}`, `desde ${t.effective_from}; ${scope}`)
    }
    for (const id of c.cogs.zero_cost_products ?? []) add('Produto sem custo', label(id), 0, id)
    for (const p of c.cogs.products) if (p.cost_usd > 0) add('Preço base por produto', p.name || p.product_id, p.cost_usd, p.product_id)
    for (const cp of c.cogs.country_prices ?? []) {
      for (const [cc, v] of Object.entries(cp.prices)) add('Preço por país', `${cp.name || label(cp.product_id)} → ${cc}`, v, cp.product_id)
    }
    for (const f of c.cogs.order_fees ?? []) {
      add('Taxa fixa do fornecedor por país', `${f.country_code} ${f.name ?? ''}`.trim(), f.amount_usd, f.effective_from ? `desde ${f.effective_from}` : '')
    }
    add('Frete', 'Padrão', c.shipping.default_rate_usd)
    for (const s of c.shipping.rates) add('Frete por país', `${s.country_code} ${s.name}`.trim(), s.cost_usd)
    const freq = { monthly: 'mensal', annual: 'anual', per_order: 'por pedido' } as const
    for (const e of c.extra_costs) add('Custos extras', e.name, e.amount_usd, freq[e.frequency])
  }
  const ws = table(wb, 'Configuração de custos', [
    { header: 'Loja', key: 'loja', width: 26 },
    { header: 'Grupo', key: 'grupo', width: 30 },
    { header: 'Item', key: 'item', width: 52 },
    { header: 'Valor (US$)', key: 'valor', width: 30 },
    { header: 'Observação', key: 'obs', width: 60 },
  ], rows)
  ws.getColumn('valor').eachCell((cell, n) => { if (n > 1 && typeof cell.value === 'number') cell.numFmt = FMT.money })
}

// ── Metodologia ──────────────────────────────────────────────────────────────

function addMethodSheet(wb: ExcelJS.Workbook, data: ExportData) {
  const ws = wb.addWorksheet('Metodologia')
  ws.columns = [{ width: 26 }, { width: 120 }]
  const partial = [...data.pnl.values()].some(s => s.partial)
  const today = data.stores[0] ? todayInTz(data.stores[0].timezone, data.generatedAt) : undefined
  const linhas: [string, string][] = [
    ['Período', `${formatRange(data.range, today)} (${data.range.from} a ${data.range.to}), pela data do pedido no fuso de cada loja.` +
      (partial ? ' Inclui o dia de hoje, ainda em andamento: os custos fixos contam só a parte do dia que passou.' : '')],
    ['Lojas', data.stores.map(s => s.name).join(' · ')],
    ['Gerado em', `${data.generatedAt.toISOString().slice(0, 19).replace('T', ' ')} UTC`],
    ['', ''],
    ['Receita', 'Valor total do pedido na Shopify (produtos + frete cobrado + impostos − descontos), em dólar. Pedidos reembolsados por inteiro ou anulados ficam fora.'],
    ['Custos variáveis', 'Produto (tabela do fornecedor, preço por país, preço do produto ou custo padrão) + embalagem + taxa fixa do fornecedor por país − desconto por unidade adicional + frete + taxa de transação da Shopify + processamento de pagamento + custos extras por pedido.'],
    ['Custo do produto', 'Ordem de precedência: tabela do fornecedor que não lista produtos (preça o pedido inteiro pela quantidade de unidades) → tabela que lista produtos (preça só os seus) → produto declarado sem custo → preço por país → preço do produto → custo padrão. Produto com custo 0 na lista significa "ainda sem preço" e usa o custo padrão.'],
    ['Contribuição', 'Receita − custos variáveis: o que sobra para pagar anúncios e custos fixos.'],
    ['Custo total', 'Custos variáveis + custos fixos + anúncios Meta + anúncios Shopify. As colunas de custo somam exatamente o custo total; as linhas de conferência do Resumo mostram isso.'],
    ['Lucro', 'Receita − custo total = contribuição − anúncios Meta − anúncios Shopify − custos fixos. Custos fixos mensais e anuais são rateados pelos dias reais de cada mês e ano.'],
    ['Anúncios Shopify', 'Gasto em Shop Campaigns da Shopify. Linha própria: entra no custo total e no lucro, nunca no ROAS da Meta.'],
    ['ROAS', '"ROAS" é a receita da loja ÷ gasto na Meta (inclui vendas orgânicas). "ROAS Meta" é o valor que a Meta atribui ÷ gasto. Anúncio-dia com compra acima de US$ 20.000 é falha de relatório da Meta e fica fora.'],
    ['ROAS de equilíbrio', 'Receita ÷ contribuição: o ROAS Meta em que os anúncios consomem toda a contribuição. Custos fixos e anúncios Shopify ficam de fora porque não crescem com o gasto na Meta.'],
    ['Estornos', 'Lançados na data em que chegaram, não na do pedido. Um estorno custa a margem do pedido (produto e frete voltam com a venda), calculada com a margem de contribuição do período. Um pedido reembolsado por inteiro já saiu da receita do dia em que foi feito e não é subtraído de novo.'],
    ['Chargebacks', 'Valor integral mais a taxa, na data em que chegaram. Disputas ganhas não contam.'],
    ['Resultado de caixa', 'Lucro − estornos − chargebacks − taxas de chargeback.'],
    ['Diário', 'Os dias de cada loja somam exatamente os valores do Resumo.'],
    ['Produtos', 'A receita de cada pedido é rateada pelas suas linhas pelo valor de cada linha (frete e imposto vão junto), e os custos variáveis do pedido do mesmo jeito; por isso os produtos somam a receita e os custos variáveis da loja. Anúncios e custos fixos não são rateados por produto.'],
    ['Países', 'Receita e custos dos pedidos reais, pelo país de entrega. "Gasto Meta" e "Valor Meta" por país são a atribuição da Meta, que não fecha com os pedidos reais (a captura medida varia de 17% a 140% entre países): para julgar um país, use as colunas de pedidos. Porto Rico, Ilhas Virgens, Guam, Samoa e Marianas chegam da Shopify como US.'],
    ['Campanhas', 'O gasto de cada loja soma exatamente os "Anúncios Meta" do Resumo. Anúncios que a sincronização ainda não descreveu aparecem em "Anúncios ainda não sincronizados". "Compras" e "Valor" são o que a Meta atribui à campanha, não o que a loja registrou. Uma conta compartilhada também veiculou anúncios de outra loja.'],
    ['Pedidos', 'Cada pedido com os custos variáveis do motor de lucro; a soma de cada loja bate com o Resumo. Anúncios e custos fixos não são por pedido.'],
    ['Taxa de chargeback', 'Disputas dos últimos 90 dias sobre pedidos dos últimos 90 dias. Acima de 1,5% a Shopify Payments fica em risco.'],
    ['', ''],
    ['Moeda', 'Todos os valores em dólar americano. A Hibikura vende em iene; os valores já chegam convertidos.'],
    ['Não incluído', 'E-mail do cliente e IP de checkout foram deixados de fora de propósito: a análise de lucro não precisa deles e este arquivo é feito para sair da empresa.'],
  ]
  ws.addRow(['Opero AI — exportação de dados da loja']).font = { bold: true, size: 14 }
  ws.addRow([])
  for (const [k, v] of linhas) {
    const r = ws.addRow([k, v])
    r.getCell(1).font = { bold: true }
    r.getCell(2).alignment = { wrapText: true, vertical: 'top' }
  }
}
