import { describe, expect, it } from 'vitest'
import type { PnL } from '@/lib/engine/pnl'
import type { CampaignRow } from '@/lib/data/campaigns'
import { buildAdsVerdict, buildReconciliation, type AdsWindow, type ReportForVerdict } from '../adsVerdict'
import { actionCountsText, adSignalChip, ptText, trendSpec } from '../text'

const WINDOW: AdsWindow = {
  period: '7d', rangeLabel: '10–16 nov', periodPhrase: 'nos últimos 7 dias', partial: false,
  partialLabel: null, minutesIntoDay: 600, dayLabel: null,
}

function pnl(over: Partial<PnL>): PnL {
  const base = {
    revenue: 0, orders: 0, units: 0, cogs: 0, packaging: 0, supplierFees: 0, unitSavings: 0, shipping: 0,
    shopifyFees: 0, paymentFees: 0, perOrderExtras: 0, fixedCosts: 0, metaSpend: 0, shopSpend: 0,
    metaPurchaseValue: 0, metaPurchases: 0, refundGross: 0, refundCount: 0, refunds: 0, chargebacks: 0,
    chargebackFees: 0, chargebackCount: 0, productCost: 0, fees: 0, variableCosts: 0, contribution: 0,
    adSpend: 0, operatingProfit: 0, adjustments: 0, cashResult: 0, margin: null, contributionMargin: null,
    breakEvenRoas: null, roas: null, metaRoas: null, profitPerOrder: null,
  }
  return { ...base, ...over }
}

/** A store selling $10,000 at a 60% contribution rate, $3,000 on Meta and
 *  $200 on Shop Campaigns, $100 of fixed costs. */
function store(): PnL {
  const revenue = 10000, contribution = 6000, meta = 3000, shop = 200, fixed = 100
  return pnl({
    revenue, orders: 120, contribution, variableCosts: revenue - contribution, metaSpend: meta, shopSpend: shop,
    fixedCosts: fixed, adSpend: meta + shop, operatingProfit: contribution - meta - shop - fixed,
    roas: revenue / meta, breakEvenRoas: revenue / contribution,
  })
}

function row(over: Partial<CampaignRow>): CampaignRow {
  return {
    campaignId: 'c1', name: 'C1', status: 'ACTIVE', running: true, objective: null, accountId: 'act_1',
    unsynced: false, unsyncedAds: [], shared: null, ads: 1, adsets: 1, estimatedProfit: null, margin: null,
    journeyOrders: 0, phantomValueDropped: 0, days: [],
    spend: 0, purchaseValue: 0, purchases: 0, impressions: 0, linkClicks: 0,
    roas: null, cpa: null, ctr: null, cpm: null, cpc: null, aov: null,
    // decision is not read by the verdict
    decision: {} as CampaignRow['decision'],
    ...over,
  }
}

function report(rows: CampaignRow[], over: Partial<ReportForVerdict> = {}): ReportForVerdict {
  const rate = 0.6
  const priced = rows.filter(r => !r.shared)
  const est = priced.reduce((t, r) => t + (r.purchaseValue * rate - r.spend), 0)
  return {
    configured: true, contributionRate: rate, breakEvenRoas: 1 / rate, storeRevenue: 10000,
    campaigns: rows.map(r => ({ ...r, estimatedProfit: r.shared ? null : r.purchaseValue * rate - r.spend })),
    totals: {
      spend: rows.reduce((t, r) => t + r.spend, 0), purchaseValue: rows.reduce((t, r) => t + r.purchaseValue, 0),
      purchases: 40, roas: null, estimatedProfit: priced.length ? est : null,
      unpricedSpend: rows.filter(r => r.shared).reduce((t, r) => t + r.spend, 0),
      campaigns: rows.length, actions: { escalar: 1, manter: 0, cortar: 1, observar: 0 }, trends: { melhorando: 0, piorando: 0 },
    },
    reconciliation: { engineMetaSpend: 3000, listedSpend: 3000, gap: 0, unsyncedSpend: 0, phantomAdDays: 0, phantomValueDropped: 0 },
    thresholds: { minMargin: 20, cutMargin: -10, minOrders: 10, minSpend: 150, windowDays: 7 },
    ...over,
  }
}

describe('buildReconciliation', () => {
  it('bridges the campaigns to the store profit exactly', () => {
    const rows = [row({ spend: 2000, purchaseValue: 3000 }), row({ campaignId: 'c2', spend: 1000, purchaseValue: 2500 })]
    const rec = buildReconciliation(report(rows), store())
    expect(rec.credited).toBe(5500)
    expect(rec.uncredited).toBe(4500)
    const b = rec.bridge!
    // campaigns: 5500 × 0.6 − 3000 = 300; uncredited: 4500 × 0.6 = 2700
    expect(b.campaigns).toBeCloseTo(300, 6)
    expect(b.uncreditedContribution).toBeCloseTo(2700, 6)
    expect(b.campaigns + b.uncreditedContribution - b.unpricedSpend - b.shopSpend - b.fixedCosts).toBeCloseTo(b.storeProfit, 6)
    expect(b.residual).toBeCloseTo(0, 6)
    expect(b.storeProfit).toBe(2700)
  })

  it('keeps shared-account campaigns out of the credit and charges their spend', () => {
    const shared = { accountId: 'act_x', note: 'outra loja.', journeyStoreId: null, journeyOrdersHere: 0, journeyOrdersTotal: 9 }
    const rows = [row({ spend: 2500, purchaseValue: 4000 }), row({ campaignId: 'c2', spend: 500, purchaseValue: 1500, shared })]
    const rec = buildReconciliation(report(rows), store())
    expect(rec.credited).toBe(4000)
    expect(rec.creditedShared).toBe(1500)
    expect(rec.bridge!.unpricedSpend).toBe(500)
    expect(rec.bridge!.residual).toBeCloseTo(0, 6)
  })

  it('has no bridge without cost settings', () => {
    const rows = [row({ spend: 800, purchaseValue: 150 })]
    const p = pnl({ revenue: 156, orders: 2, metaSpend: 800, adSpend: 800 })
    const rec = buildReconciliation(report(rows, { configured: false, contributionRate: null, breakEvenRoas: null }), p)
    expect(rec.bridge).toBeNull()
    expect(rec.revenueMinusAds).toBe(-644)
  })
})

describe('buildAdsVerdict', () => {
  it('judges the campaigns and says when the store as a whole disagrees', () => {
    // Campaigns: 4000 × 0.6 − 3000 = −600 (loss); store ROAS 3.33 ≥ 1.67 (covers).
    const rows = [row({ spend: 3000, purchaseValue: 4000 })]
    const { verdict } = buildAdsVerdict({ storeName: 'MOKOO', report: report(rows), pnl: store(), window: WINDOW, decision: null })
    expect(verdict.tone).toBe('neg')
    expect(verdict.amount).toBeCloseTo(-600, 6)
    expect(verdict.headline).toBe('As campanhas da MOKOO deram prejuízo nos últimos 7 dias, pela atribuição do Meta — mas a loja inteira cobriu o gasto com anúncios.')
    expect(verdict.chips[0].label).toBe('Campanhas no prejuízo')
    expect(verdict.roas?.state).toBe('pos')
    expect(verdict.basis).toBe('profit')
  })

  it('halves only the amount in the split view', () => {
    const rows = [row({ spend: 1000, purchaseValue: 3000 })]
    const a = buildAdsVerdict({ storeName: 'X', report: report(rows), pnl: store(), window: WINDOW, decision: null })
    const b = buildAdsVerdict({ storeName: 'X', report: report(rows), pnl: store(), window: WINDOW, decision: null, split: true })
    expect(b.verdict.amount).toBeCloseTo((a.verdict.amount ?? 0) / 2, 6)
    expect(b.verdict.roas?.roas).toBe(a.verdict.roas?.roas)
    expect(b.verdict.amountCaption).toMatch(/^sua parte/)
  })

  it('flags "no limite" within 10% of the break-even', () => {
    // ROAS 1.6 vs break-even 1.667: 4% below.
    const rows = [row({ spend: 1000, purchaseValue: 1600 })]
    const { verdict } = buildAdsVerdict({ storeName: 'X', report: report(rows), pnl: store(), window: WINDOW, decision: null })
    expect(verdict.chips.map(c => c.label)).toContain('No limite do empate')
  })

  it('never shows a fake $0 without Meta spend', () => {
    const p = pnl({ revenue: 500, orders: 5 })
    const r = report([], { reconciliation: { engineMetaSpend: 0, listedSpend: 0, gap: 0, unsyncedSpend: 0, phantomAdDays: 0, phantomValueDropped: 0 } })
    const { verdict } = buildAdsVerdict({ storeName: 'CAMP HALLOW', report: r, pnl: p, window: WINDOW, decision: null })
    expect(verdict.amount).toBeNull()
    expect(verdict.basis).toBe('none')
    expect(verdict.headline).toBe('A CAMP HALLOW não gastou no Meta nos últimos 7 dias.')
  })

  it('judges a store without costs on revenue − ads, flagged', () => {
    const rows = [row({ spend: 819.5, purchaseValue: 160 })]
    const p = pnl({ revenue: 156.3, orders: 2, metaSpend: 819.5, adSpend: 819.5, roas: 156.3 / 819.5 })
    const r = report(rows, { configured: false, contributionRate: null, breakEvenRoas: null })
    const { verdict } = buildAdsVerdict({ storeName: 'Glooty', report: r, pnl: p, window: WINDOW, decision: null })
    expect(verdict.basis).toBe('revenue_minus_ads')
    expect(verdict.amount).toBeCloseTo(-663.2, 6)
    expect(verdict.chips.map(c => c.label)).toContain('Custos não configurados')
    expect(verdict.roas?.state).toBe('unknown')
  })

  it('says a store without costs that sold nothing spent without sales', () => {
    const rows = [row({ spend: 545.19 })]
    const p = pnl({ metaSpend: 545.19, adSpend: 545.19, roas: 0 })
    const r = report(rows, { configured: false, contributionRate: null, breakEvenRoas: null })
    const { verdict } = buildAdsVerdict({ storeName: 'Glooty', report: r, pnl: p, window: WINDOW, decision: null })
    expect(verdict.headline).toBe('A Glooty gastou $545 no Meta nos últimos 7 dias e não vendeu nada.')
    expect(verdict.chips[0].label).toBe('Gasto sem vendas')
  })

  it('keeps the partial clock in its chip, not twice in the date line', () => {
    const rows = [row({ spend: 100, purchaseValue: 300 })]
    const w: AdsWindow = { ...WINDOW, period: 'today', rangeLabel: '18 nov', partial: true, partialLabel: 'parcial · até 15h10', minutesIntoDay: 910 }
    const { verdict } = buildAdsVerdict({ storeName: 'X', report: report(rows), pnl: store(), window: w, decision: null })
    expect(verdict.when).toBe('18 nov')
    expect(verdict.chips.map(c => c.label)).toContain('parcial · até 15h10')
  })

  it('calls a young running day too early to judge', () => {
    const rows = [row({ spend: 100, purchaseValue: 50 })]
    const w: AdsWindow = { ...WINDOW, period: 'today', partial: true, partialLabel: 'parcial · até 02h10', minutesIntoDay: 130 }
    const { verdict } = buildAdsVerdict({ storeName: 'X', report: report(rows), pnl: store(), window: w, decision: null })
    expect(verdict.tone).toBe('neu')
    expect(verdict.amountTone).toBe('neu')
    expect(verdict.chips[0].label).toBe('Cedo demais para julgar')
  })
})

describe('text helpers', () => {
  it('turns en-US numbers in library sentences into pt-BR', () => {
    expect(ptText('ROAS 1.53x com $2,034 gastos')).toBe('ROAS 1,53× com $2.034 gastos')
    expect(ptText('Margem de -34% em 7 dias')).toBe('Margem de −34% em 7 dias')
    expect(ptText('Frequência 3.6 no período')).toBe('Frequência 3,6 no período')
    expect(ptText('$12,500 e $1,234,567')).toBe('$12.500 e $1.234.567')
    expect(ptText('já em pt-BR: $1.313 e 1,95×')).toBe('já em pt-BR: $1.313 e 1,95×')
  })

  it('shows a trend only against a real earlier period', () => {
    expect(trendSpec(null, null, 7).text).toBe('—')
    expect(trendSpec('melhorando', 77.2, 7).text).toBe('▲ 77%')
    expect(trendSpec('piorando', -30, 7).tone).toBe('neg')
  })

  it('never puts a check mark on an ad below the break-even', () => {
    expect(adSignalChip('ok', 1.8, 1.5).label).toBe('OK')
    expect(adSignalChip('ok', 0, 1.5)).toEqual({ label: 'Abaixo do empate', tone: 'neu', icon: 'ring' })
    expect(adSignalChip('ok', 1.2, null).label).toBe('OK')
    expect(adSignalChip('kill', 0.5, 1.5).label).toBe('Desligar')
  })

  it('counts the actions in words', () => {
    expect(actionCountsText({ cortar: 1, escalar: 0, manter: 2, observar: 1 }))
      .toBe('1 campanha para cortar, nenhuma para escalar, 2 para manter e 1 para observar')
    expect(actionCountsText({ cortar: 0, escalar: 2, manter: 0, observar: 0 }))
      .toBe('nenhuma campanha para cortar, 2 para escalar, nenhuma para manter e nenhuma para observar')
  })
})
