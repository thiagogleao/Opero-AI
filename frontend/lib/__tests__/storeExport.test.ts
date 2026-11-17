import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import {
  adjustmentEffect, costColumns, excelDate, priceOrderRow, refundFactor, sumOrderCosts, totalCost, writeWorkbook,
  type AdjustmentRow, type ExportData, type OrderRow, type StoreConfig,
} from '../storeExport'
import { derive, sumPnL, type PnLLines, type StorePnL } from '../engine/pnl'
import { buildCogsLookups, orderSupplierCost } from '../engine/costs'
import { defaultProfitConfig } from '../data/profitConfig'

const lines = (over: Partial<PnLLines> = {}): PnLLines => ({
  ...sumPnL([]),
  revenue: 1000, orders: 10, units: 14, cogs: 300, packaging: 18, supplierFees: 7, unitSavings: 12,
  shipping: 40, shopifyFees: 29, paymentFees: 3, perOrderExtras: 4, fixedCosts: 13,
  metaSpend: 250, shopSpend: 20, metaPurchaseValue: 900, metaPurchases: 9,
  refundGross: 100, refundCount: 2, refunds: 60, chargebacks: 50, chargebackFees: 15, chargebackCount: 1,
  ...over,
})

const adj = (over: Partial<AdjustmentRow>): AdjustmentRow => ({
  tenant_id: 's1', kind: 'refund', order_id: '1', order_number: 1001, event_date: '2026-11-10', order_date: '2026-11-01',
  amount: 100, fee: null, currency: 'USD', reason: null, status: null,
  order_status: 'partially_refunded', order_currency: 'USD', fx_rate: null, order_known: true, ...over,
})

describe('cost columns', () => {
  it('add up exactly to the total cost, and revenue − total cost is the profit', () => {
    const t = derive(lines())
    const sum = costColumns(t).reduce((s, c) => s + c.amount, 0)
    expect(sum).toBeCloseTo(totalCost(t), 10)
    expect(t.revenue - totalCost(t)).toBeCloseTo(t.operatingProfit, 10)
    expect(costColumns(t).map(c => c.key)).toContain('shop_ads')
  })
})

describe('refunds and chargebacks, line by line', () => {
  it('a refund costs its margin; the factor is the window\'s contribution margin, clamped', () => {
    const t = derive(lines())
    expect(refundFactor(t)).toBeCloseTo(t.contribution / t.revenue, 12)
    expect(refundFactor(derive(lines({ revenue: 0 })))).toBe(1)
    expect(refundFactor(derive(lines({ revenue: 100 })))).toBe(0) // contribution < 0
    const e = adjustmentEffect(adj({}), 0.6)
    expect(e).toMatchObject({ usd: 100, counted: true, value: 60, fee: 0 })
  })

  it('a fully refunded order we hold is not subtracted twice', () => {
    const e = adjustmentEffect(adj({ order_status: 'refunded' }), 0.6)
    expect(e).toMatchObject({ counted: false, value: 0 })
    // An order we do not hold has no revenue to drop: its refund counts.
    expect(adjustmentEffect(adj({ order_status: null, order_known: false }), 0.6)).toMatchObject({ counted: true, value: 60 })
  })

  it('converts a shop-currency refund with the order\'s rate, never yen as dollars', () => {
    expect(adjustmentEffect(adj({ currency: 'JPY', order_currency: 'JPY', fx_rate: 0.0065, amount: 10000 }), 1).value).toBeCloseTo(65, 10)
    expect(adjustmentEffect(adj({ currency: 'JPY', order_currency: 'USD', fx_rate: null, amount: 10000 }), 1)).toMatchObject({ usd: 0, value: 0, counted: false })
  })

  it('a chargeback costs all of it plus the fee, unless it was won', () => {
    expect(adjustmentEffect(adj({ kind: 'chargeback', status: 'lost', fee: 15 }), 0.6)).toMatchObject({ counted: true, value: 100, fee: 15 })
    expect(adjustmentEffect(adj({ kind: 'chargeback', status: 'prevented', fee: 15 }), 0.6)).toMatchObject({ counted: true, value: 100 })
    expect(adjustmentEffect(adj({ kind: 'chargeback', status: 'won', fee: 15 }), 0.6)).toMatchObject({ counted: false, value: 0, fee: 0 })
  })
})

describe('order rows', () => {
  const cfg: StoreConfig = (() => {
    const c = defaultProfitConfig()
    c.shopify = { transaction_fee_pct: 2.9, payment_processing_pct: 0, payment_processing_fixed: 0.3 }
    c.cogs.default_cost_usd = 9
    c.cogs.additional_unit_discount_usd = 3
    c.cogs.order_fees = [{ country_code: 'AT', amount_usd: 3.5 }]
    c.extra_costs = [{ name: 'Brinde', amount_usd: 0.4, frequency: 'per_order' }]
    return { configured: true, config: c }
  })()
  const order = (over: Partial<OrderRow> = {}): OrderRow => ({
    tenant_id: 's1', order_number: 1001, total: 50, country_code: 'AT', d: '2026-11-10',
    items: [{ p: '1', t: 'Capy', u: 2, v: 25 }], ...over,
  })

  it('uses the engine\'s per-order cost functions', () => {
    const c = priceOrderRow(order(), cfg)
    const sup = orderSupplierCost({ country_code: 'AT', order_date: '2026-11-10', items: [{ product_id: '1', product_title: 'Capy', units: 2 }] }, buildCogsLookups(cfg.config), cfg.config)
    expect(c).toMatchObject({ units: 2, revenue: 50, cogs: sup.cogs, supplierFees: 3.5, unitSavings: 3, perOrderExtras: 0.4 })
    expect(c.shopifyFees).toBeCloseTo(1.45, 10)
    expect(c.paymentFees).toBeCloseTo(0.3, 10)
    expect(c.variableCosts).toBeCloseTo(18 + 3.5 - 3 + 1.45 + 0.3 + 0.4, 10)
  })

  it('an order without items is one unit; a store without settings costs nothing', () => {
    expect(priceOrderRow(order({ items: [] }), cfg).cogs).toBe(9)
    expect(priceOrderRow(order(), { configured: false, config: defaultProfitConfig() })).toMatchObject({ revenue: 50, variableCosts: 0 })
    expect(sumOrderCosts([priceOrderRow(order(), cfg), priceOrderRow(order(), cfg)]).revenue).toBe(100)
  })

  it('prices with the stored row the engine read, not the normalised copy', () => {
    // A row a script wrote with a lowercase country: the engine never matches
    // it to an order's "AT", so neither may the order sheet.
    const raw = structuredClone(cfg.config)
    raw.cogs.order_fees = [{ country_code: 'at', amount_usd: 3.5 }]
    expect(priceOrderRow(order(), { ...cfg, engineConfig: raw }).supplierFees).toBe(0)
    expect(priceOrderRow(order(), cfg).supplierFees).toBe(3.5)
  })
})

describe('workbook', () => {
  const store = (id: string, name: string, day1: Partial<PnLLines>, day2: Partial<PnLLines>): [ExportData['stores'][number], StorePnL] => {
    const daily = [{ date: '2026-11-15', ...derive(lines(day1)) }, { date: '2026-11-16', ...derive(lines(day2)) }]
    return [{ id, name, timezone: 'America/Sao_Paulo' }, {
      store: { id, name, domain: null, timezone: 'America/Sao_Paulo', userId: null, archived: false },
      configured: true, range: { from: '2026-11-15', to: '2026-11-16' }, partial: false, minutesCovered: 1440, cutoffMinutes: null,
      totals: sumPnL(daily), daily, hourly: null,
      countries: [{ country: 'US', revenue: 2000, orders: 20, variableCosts: 800, contribution: 1200, metaSpend: 400, metaPurchaseValue: 1500 }],
      products: [{ key: '1', productId: '1', title: 'Capy', units: 28, orders: 20, revenue: 2000, variableCosts: 800, contribution: 1200 }],
    }]
  }
  const a = store('s1', 'Loja A', {}, { revenue: 500, metaSpend: 400 })
  const b = store('s2', 'Loja B', { shopSpend: 0 }, {})
  const data: ExportData = {
    range: { from: '2026-11-15', to: '2026-11-16' }, generatedAt: new Date('2026-11-17T12:00:00Z'),
    stores: [a[0], b[0]], pnl: new Map([[a[0].id, a[1]], [b[0].id, b[1]]]),
    configs: new Map([['s1', { configured: true, config: defaultProfitConfig() }], ['s2', { configured: false, config: defaultProfitConfig() }]]),
    adjustments: [adj({}), adj({ kind: 'chargeback', status: 'lost', fee: 15 })],
    campaigns: [], health: new Map(), orders: [],
  }

  it('has every sheet, in order', () => {
    const wb = writeWorkbook(data)
    expect(wb.worksheets.map(w => w.name)).toEqual([
      'Resumo', 'Diário', 'Produtos', 'Países', 'Campanhas', 'Estornos e chargebacks', 'Saúde chargeback 90d', 'Pedidos', 'Configuração de custos', 'Metodologia',
    ])
  })

  it('Resumo: one column per store plus Total; every reconciliation row is 0', () => {
    const ws = writeWorkbook(data).getWorksheet('Resumo')!
    expect((ws.getRow(3).values as unknown[]).slice(2)).toEqual(['Loja A', 'Loja B', 'Total'])
    const rows = new Map<string, ExcelJS.Row>()
    ws.eachRow(r => { if (typeof r.getCell(1).value === 'string') rows.set(r.getCell(1).value as string, r) })
    expect(rows.get('Lucro (receita − custo total)')!.getCell(4).value).toBeCloseTo(a[1].totals.operatingProfit + b[1].totals.operatingProfit, 6)
    for (const label of ['Soma das linhas de custo − Custo total', 'Receita − Custo total − Lucro', 'Lucro − estornos − chargebacks − taxas − Resultado de caixa']) {
      for (const col of [2, 3, 4]) {
        const cell = rows.get(label)!.getCell(col)
        expect(cell.formula).toBeTruthy()
        expect(cell.result).toBe(0)
      }
    }
    const total = rows.get('Soma das lojas − Total (lucro)')!
    expect(total.getCell(2).value).toBeNull()
    expect(total.getCell(4).result).toBe(0)
  })

  it('Diário dates are real dates shown as YYYY-MM-DD, and survive a save', async () => {
    const wb = writeWorkbook(data)
    const back = new ExcelJS.Workbook()
    await back.xlsx.load(await wb.xlsx.writeBuffer())
    const ws = back.getWorksheet('Diário')!
    const c = ws.getRow(2).getCell(2)
    expect(c.value).toBeInstanceOf(Date)
    expect((c.value as Date).toISOString().slice(0, 10)).toBe('2026-11-15')
    expect(c.numFmt).toBe('yyyy-mm-dd')
    expect(ws.rowCount).toBe(1 + 4)
    expect(excelDate('2026-03-08').toISOString()).toBe('2026-03-08T00:00:00.000Z')
  })

  it('Estornos: the total rows are what the lines take off the result', () => {
    const ws = writeWorkbook(data).getWorksheet('Estornos e chargebacks')!
    const totals: Record<string, unknown>[] = []
    ws.eachRow(r => { if (String(r.getCell(1).value).startsWith('Total — Loja A')) totals.push({ tipo: r.getCell(4).value, efeito: r.getCell(11).value, taxa: r.getCell(12).value }) })
    const f = refundFactor(a[1].totals)
    expect(totals).toEqual([{ tipo: 'Estornos', efeito: 100 * f, taxa: 0 }, { tipo: 'Chargebacks', efeito: 100, taxa: 15 }])
  })
})
