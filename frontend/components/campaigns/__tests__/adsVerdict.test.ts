import { describe, expect, it } from 'vitest'
import type { PnL } from '@/lib/engine/pnl'
import type { CampaignRow } from '@/lib/data/campaigns'
import { attributedRoasNote, buildAdsVerdict, buildReconciliation, creditedWithoutSalesText, noEmpateWhy, noSpendHistory, ownAttributedRoas, sharedCampaigns, uncreditedSources, type AdsWindow, type ReportForVerdict } from '../adsVerdict'
import { actionCountsText, adSignalChip, phantomBadge, phantomNote, ptText, sharedCampaignsNote, trendSpec } from '../text'
import { creativeVerdict, signalLabel, SIGNAL_LABEL } from '@/lib/creativeSignal'

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

  it('calls the billed-elsewhere spend the whole campaign, not the ads that sold here', () => {
    const p = pnl({ revenue: 9846.28, orders: 103 })
    const r = report([], { reconciliation: { engineMetaSpend: 0, listedSpend: 0, gap: 0, unsyncedSpend: 0, phantomAdDays: 0, phantomValueDropped: 0 } })
    const { verdict } = buildAdsVerdict({
      storeName: 'CAMP HALLOW', report: r, pnl: p, window: WINDOW, decision: null,
      billedElsewhere: { spend: 4545.78, campaigns: 1, stores: ['EPOCH'] },
    })
    const text = verdict.details.map(d => d.text).join(' ')
    // Atribuição shows $2.954 for the ads credited with an order here; this
    // line must not claim the $4.546 is what "brought sales here".
    expect(text).not.toContain('trouxe vendas para cá')
    expect(text).toContain('$4.546 de gasto da campanha inteira no período')
  })

  it('measures the store ROAS box on the Resumo\'s ad channel, not on Meta alone', () => {
    // Dumpling 8jcp3a, 11–17 nov: $56 of Meta next to $1.796 of Shop Campaigns.
    // Revenue ÷ Meta read "319× → no lucro"; the Resumo says 2,97× on Shopify ads.
    const revenue = 5334.12, meta = 16.71, shop = 1796, contribution = revenue / 1.46
    const p = pnl({
      revenue, orders: 60, contribution, variableCosts: revenue - contribution, metaSpend: meta, shopSpend: shop,
      adSpend: meta + shop, operatingProfit: contribution - meta - shop, roas: revenue / meta, breakEvenRoas: 1.46,
    })
    const rows = [row({ spend: meta, purchaseValue: 0 })]
    const r = report(rows, { contributionRate: 1 / 1.46, breakEvenRoas: 1.46, storeRevenue: revenue,
      reconciliation: { engineMetaSpend: meta, listedSpend: meta, gap: 0, unsyncedSpend: 0, phantomAdDays: 0, phantomValueDropped: 0 } })
    const { verdict } = buildAdsVerdict({ storeName: 'Dumpling Squishy', report: r, pnl: p, window: WINDOW, decision: null })
    expect(verdict.roas?.channel).toBe('shop')
    expect(verdict.roas?.label).toBe('ROAS dos Anúncios Shopify')
    expect(verdict.roas?.roas).toBeCloseTo(revenue / shop, 6)
    expect(verdict.roas?.state).toBe('pos')
    // A store whose ads are all Meta keeps the Meta ROAS.
    expect(buildAdsVerdict({ storeName: 'X', report: report([row({ spend: 3000, purchaseValue: 4000 })]), pnl: store(), window: WINDOW, decision: null })
      .verdict.roas).toMatchObject({ channel: 'meta', roas: 10000 / 3000 })
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

  it('keeps "gasto sem vendas" on a day without sales, whatever the rows priced', () => {
    // MOKOO "Hoje" at 01h20: 4 campaigns, $32,55, no order. Every row priced at
    // −spend (Meta credited nothing), so the estimate is −32,55, not null; the
    // caption read "cada venda já sai no prejuízo" with no sale at all.
    const w: AdsWindow = { ...WINDOW, period: 'today', rangeLabel: '24 nov', periodPhrase: 'hoje', partial: true, partialLabel: 'parcial · até 05h20', minutesIntoDay: 320 }
    const rows = [row({ spend: 20.44 }), row({ campaignId: 'c2', spend: 12.11 })]
    const noSales = pnl({ metaSpend: 32.55, adSpend: 32.55, operatingProfit: -32.55, roas: 0 })
    const r = report(rows, { contributionRate: null, breakEvenRoas: null, storeRevenue: 0 })
    r.totals = { ...r.totals, estimatedProfit: -32.55 }
    const v = buildAdsVerdict({ storeName: 'MOKOO', report: r, pnl: noSales, window: w, decision: null }).verdict
    // The day is still running: "ainda não vendeu", as the Resumo says.
    expect(v.headline).toBe('A MOKOO gastou $32,55 no Meta hoje e ainda não vendeu nada.')
    expect(v.chips[0].label).toBe('Gasto sem vendas')
    expect(v.amount).toBeCloseTo(-32.55, 6)
    expect(v.amountCaption).toBe('de prejuízo: gasto no Meta sem margem para cobri-lo')
    expect(v.amountCaption).not.toContain('cada venda')

    // One campaign credited (unpriced without a rate), one not: the estimate
    // is only part of the spend; the amount stays the whole Meta spend.
    const mixed = report([row({ spend: 20, purchaseValue: 30 }), row({ campaignId: 'c2', spend: 12.55 })], { contributionRate: null, breakEvenRoas: null, storeRevenue: 0 })
    mixed.totals = { ...mixed.totals, estimatedProfit: -12.55 }
    const m = buildAdsVerdict({ storeName: 'MOKOO', report: mixed, pnl: noSales, window: w, decision: null, split: true }).verdict
    expect(m.amount).toBeCloseTo(-32.55 / 2, 6)
    // Dumpling 22 out, parte=50: "−$37,53 sua parte do gasto no Meta" beside a chip that says spend stays whole.
    expect(m.amountCaption).toBe('de prejuízo (sua parte, 50%): gasto no Meta sem margem para cobri-lo')
    expect(m.amountCaption).not.toContain('parte do gasto')
  })

  it('keeps "cada venda já sai no prejuízo" for sales that do not cover their own costs', () => {
    const rows = [row({ spend: 100, purchaseValue: 300 })]
    const p = pnl({ revenue: 812, orders: 9, contribution: -40, variableCosts: 852, metaSpend: 100, adSpend: 100, operatingProfit: -140 })
    const r = report(rows, { contributionRate: -40 / 812, breakEvenRoas: null, storeRevenue: 812 })
    r.totals = { ...r.totals, estimatedProfit: 300 * (-40 / 812) - 100 }
    const v = buildAdsVerdict({ storeName: 'X', report: r, pnl: p, window: WINDOW, decision: null }).verdict
    expect(v.amountCaption).toBe('de lucro estimado das campanhas: cada venda já sai no prejuízo')
    expect(v.amount).toBeCloseTo(300 * (-40 / 812) - 100, 6)
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

describe('buildAdsVerdict — round-2 wording', () => {
  /** EPOCH, 1–31 out (engine + getCampaignReport, read-only). */
  function epochOct() {
    const revenue = 42058.56, contribution = 33211.56, meta = 47220, shop = 366.68
    const p = pnl({
      revenue, orders: 381, contribution, variableCosts: revenue - contribution, metaSpend: meta, shopSpend: shop,
      adSpend: meta + shop, operatingProfit: contribution - meta - shop, roas: revenue / meta, breakEvenRoas: revenue / contribution,
    })
    const flag = { accountId: 'act_3618880568247785', note: 'conta compartilhada.', journeyStoreId: null, journeyOrdersHere: 0, journeyOrdersTotal: 338 }
    const rows = [
      row({ spend: 25161.83, purchaseValue: 33909.66 }),
      row({ campaignId: 'freddie', spend: 22058.17, purchaseValue: 39637.9, shared: flag }),
    ]
    const rate = contribution / revenue
    const r = report(rows, {
      contributionRate: rate, breakEvenRoas: revenue / contribution, storeRevenue: revenue,
      reconciliation: { engineMetaSpend: meta, listedSpend: meta, gap: 0, unsyncedSpend: 0, phantomAdDays: 0, phantomValueDropped: 0 },
    })
    r.campaigns = rows.map(x => ({ ...x, estimatedProfit: x.shared ? null : x.purchaseValue * rate - x.spend }))
    r.totals = { ...r.totals, estimatedProfit: 33909.66 * rate - 25161.83 }
    return { p, r }
  }

  it('puts the same campaigns on both sides of the attributed-ROAS sentence', () => {
    const { p, r } = epochOct()
    const { verdict } = buildAdsVerdict({ storeName: 'EPOCH ®️', report: r, pnl: p, window: { ...WINDOW, periodPhrase: 'no mês passado' }, decision: null })
    expect(verdict.details[0].text).toBe(
      'Gasto no Meta: $25.162 em 1 campanha desta loja (mais $22.058 em 1 de conta compartilhada). '
      + 'O Meta credita à da loja $33.910 em vendas — ROAS atribuído 1,35× contra empate 1,27×.',
    )
    // The judgement leaves out 47% of the spend, and says so up front.
    expect(verdict.headline).toBe('As campanhas da EPOCH ®️ deram lucro no mês passado, pela atribuição do Meta, sem contar 47% do gasto (campanhas de conta compartilhada) — mas a loja inteira não cobriu o gasto com anúncios.')
    expect(verdict.amountCaption).toBe('de lucro estimado das campanhas desta loja: vendas atribuídas × margem da loja − gasto')
  })

  it('keeps the plain sentence for a store without shared campaigns', () => {
    const { verdict } = buildAdsVerdict({ storeName: 'MOKOO', report: report([row({ spend: 3000, purchaseValue: 4000 })]), pnl: store(), window: WINDOW, decision: null })
    expect(verdict.details[0].text).toBe('Gasto no Meta: $3.000 em 1 campanha. O Meta credita a ela $4.000 em vendas — ROAS atribuído 1,33× contra empate 1,67×.')
    expect(verdict.headline).not.toContain('sem contar')
    // Two campaigns: the plural pronoun.
    const two = buildAdsVerdict({ storeName: 'MOKOO', report: report([row({ spend: 2000, purchaseValue: 3000 }), row({ campaignId: 'c2', spend: 1000, purchaseValue: 1000 })]), pnl: store(), window: WINDOW, decision: null })
    expect(two.verdict.details[0].text).toBe('Gasto no Meta: $3.000 em 2 campanhas. O Meta credita a elas $4.000 em vendas — ROAS atribuído 1,33× contra empate 1,67×.')
  })

  it('gives the real reason when a store with costs has no break-even', () => {
    // EPOCH at 09h10 on 18 nov: $347 on Meta, no order yet, costs set.
    const rows = [row({ spend: 347.32 })]
    const noSales = pnl({ metaSpend: 347.32, adSpend: 347.32, operatingProfit: -347.32, roas: 0 })
    const r = report(rows, { breakEvenRoas: null, storeRevenue: 0,
      reconciliation: { engineMetaSpend: 347.32, listedSpend: 347.32, gap: 0, unsyncedSpend: 0, phantomAdDays: 0, phantomValueDropped: 0 } })
    const a = buildAdsVerdict({ storeName: 'EPOCH ®️', report: r, pnl: noSales, window: WINDOW, decision: null }).verdict
    expect(a.details[0].text).toBe('Gasto no Meta: $347 em 1 campanha. O Meta credita a ela $0 em vendas — ROAS atribuído 0,00× (sem vendas no período, não há empate).')
    expect(a.details[0].text).not.toContain('sem custos')

    expect(noEmpateWhy(true, { revenue: 812, contribution: -40 })).toBe('as vendas não cobrem produto, frete e taxas: nenhum ROAS empata')
    expect(noEmpateWhy(false, { revenue: 812, contribution: 812 })).toBe('sem custos, não há empate')
  })

  it('names Shopify ads first among the sales Meta does not credit', () => {
    // Dumpling 8jcp3a, 17 nov: $6.229 sold, $59,84 of Meta, $1.867 of Shop Campaigns.
    const revenue = 6229.42, meta = 59.84, shop = 1867.46, contribution = 4318.07
    const p = pnl({
      revenue, orders: 90, contribution, variableCosts: revenue - contribution, metaSpend: meta, shopSpend: shop,
      adSpend: meta + shop, operatingProfit: contribution - meta - shop, roas: revenue / meta, breakEvenRoas: revenue / contribution,
    })
    const r = report([row({ spend: meta, purchaseValue: 54.11 })], { contributionRate: contribution / revenue, breakEvenRoas: revenue / contribution, storeRevenue: revenue,
      reconciliation: { engineMetaSpend: meta, listedSpend: meta, gap: 0, unsyncedSpend: 0, phantomAdDays: 0, phantomValueDropped: 0 } })
    const { verdict } = buildAdsVerdict({ storeName: 'Dumpling Squishy · 8jcp3a', report: r, pnl: p, window: WINDOW, decision: null })
    expect(verdict.details[1].text).toBe('A loja vendeu $6.229 no total: 99% disso não é creditado a nenhuma campanha do Meta (Anúncios Shopify, com $1.867 de gasto no período; orgânico, e-mail, recompra ou venda que o pixel não viu).')
    expect(uncreditedSources(0)).toBe('orgânico, e-mail, recompra ou venda que o pixel não viu')
    expect(attributedRoasNote({ sharedSpend: 0, shopSpend: shop })).toContain('(Anúncios Shopify, orgânico, e-mail, recompra)')
    expect(attributedRoasNote({ sharedSpend: 22058.17, shopSpend: 0 })).toContain('campanhas desta loja ÷ o gasto delas (os $22.058 das campanhas de conta compartilhada ficam fora)')
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
    expect(adSignalChip('ok', 1.8, 1.5).label).toBe('Manter')
    expect(adSignalChip('ok', 0, 1.5)).toEqual({ label: 'Abaixo do empate', tone: 'neu', icon: 'ring' })
    expect(adSignalChip('ok', 1.2, null).label).toBe('Manter')
    expect(adSignalChip('kill', 0.5, 1.5).label).toBe('Desligar')
  })

  it('counts the actions in words', () => {
    expect(actionCountsText({ cortar: 1, escalar: 0, manter: 2, observar: 1 }))
      .toBe('1 campanha para cortar, nenhuma para escalar, 2 para manter e 1 para observar')
    expect(actionCountsText({ cortar: 0, escalar: 2, manter: 0, observar: 0 }))
      .toBe('nenhuma campanha para cortar, 2 para escalar, nenhuma para manter e nenhuma para observar')
  })
})

describe('ownAttributedRoas (the Total row of the campaigns table)', () => {
  it("is the verdict's ROAS atribuído: the store's own campaigns, shared-account ones left out", () => {
    // EPOCH, October: $33.910 / $25.162 = 1,35×, not $73.548 / $47.220 = 1,56×.
    const flag = { accountId: 'act_3618880568247785', note: 'n', journeyStoreId: null, journeyOrdersHere: 0, journeyOrdersTotal: 338 }
    const rows = [
      row({ spend: 25161.83, purchaseValue: 33909.66 }),
      row({ campaignId: 'freddie', spend: 22058.17, purchaseValue: 39637.9, shared: flag }),
    ]
    const own = ownAttributedRoas({ campaigns: rows })
    expect(own.roas).toBeCloseTo(1.3477, 3)
    expect(own.spend).toBeCloseTo(25161.83, 2)
    expect(sharedCampaigns({ campaigns: rows }).spend).toBeCloseTo(22058.17, 2)
  })
})

describe('phantomBadge', () => {
  it('says it in words, with no minus sign that reads as a loss', () => {
    expect(phantomBadge(183000)).toBe('compra fantasma descartada ($183.000)')
    expect(phantomBadge(183000)).not.toMatch(/[−-]\$/)
    expect(phantomNote(183000)).toContain('$183.000 em compras impossíveis')
  })
})

describe('ad signal words', () => {
  it('never calls an ad below the break-even "OK", and is Portuguese everywhere', () => {
    // Hibikura, 7 dias: ROAS 0,00× and 1,21× against 1,34×, under $50 spent.
    const zero = creativeVerdict({ spend: 41.04, roas: 0, purchases: 0, breakEven: 1.34, frequency: null, running: true })
    expect(zero.signal).toBe('ok')
    expect(zero.label).toBe('Abaixo do empate')
    expect(creativeVerdict({ spend: 43.75, roas: 1.21, purchases: 1, breakEven: 1.34, frequency: null, running: true }).label).toBe('Abaixo do empate')
    expect(creativeVerdict({ spend: 60, roas: 1.39, purchases: 2, breakEven: 1.34, frequency: null, running: true }).label).toBe('Manter')
    expect(creativeVerdict({ spend: 80, roas: 0.5, purchases: 0, breakEven: 1.34, frequency: null, running: true }).label).toBe('Desligar')
    // No signal, no label.
    expect(creativeVerdict({ spend: 0, roas: null, purchases: 0, breakEven: 1.34, frequency: null, running: true }).label).toBeUndefined()
    expect(Object.values(SIGNAL_LABEL)).not.toContain('OK')
    expect(signalLabel('ok', 0, 1.34)).toBe(adSignalChip('ok', 0, 1.34).label)
  })
})

describe('buildAdsVerdict — round-5 wording', () => {
  const today: AdsWindow = { ...WINDOW, period: 'today', rangeLabel: '24 nov', periodPhrase: 'hoje', partial: true, partialLabel: 'parcial · até 06h12', minutesIntoDay: 372 }

  it('tells a running day in the present tense', () => {
    // EPOCH, Hoje at 06h12: "deram lucro hoje" read as a closed day.
    const rows = [row({ spend: 1000, purchaseValue: 3000 })]
    const v = buildAdsVerdict({ storeName: 'EPOCH ®️', report: report(rows), pnl: store(), window: today, decision: null }).verdict
    expect(v.headline).toBe('As campanhas da EPOCH ®️ estão dando lucro hoje, até agora, pela atribuição do Meta.')
    const loss = buildAdsVerdict({ storeName: 'MOKOO', report: report([row({ spend: 3000, purchaseValue: 4000 })]), pnl: store(), window: today, decision: null }).verdict
    expect(loss.headline).toBe('As campanhas da MOKOO estão dando prejuízo hoje, até agora, pela atribuição do Meta — mas a loja inteira está cobrindo o gasto com anúncios.')
    // A closed window keeps the past tense.
    expect(buildAdsVerdict({ storeName: 'EPOCH ®️', report: report(rows), pnl: store(), window: WINDOW, decision: null }).verdict.headline)
      .toBe('As campanhas da EPOCH ®️ deram lucro nos últimos 7 dias, pela atribuição do Meta.')
    // No spend yet today, for a store that spent yesterday.
    const spentYesterday = { firstSpendDay: '2026-05-21', lastSpendDay: '2026-11-23', range: { from: '2026-11-24', to: '2026-11-24' }, today: '2026-11-24' }
    const yet = buildAdsVerdict({ storeName: 'X', report: report([]), pnl: pnl({}), window: today, decision: null, metaHistory: spentYesterday }).verdict
    expect(yet.headline).toBe('A X ainda não gastou no Meta hoje.')
    expect(yet.chips[0].label).toBe('Sem gasto no Meta ainda')
    // Without the history, never "ainda": the spend may not be coming.
    expect(buildAdsVerdict({ storeName: 'X', report: report([]), pnl: pnl({}), window: today, decision: null }).verdict.headline)
      .toBe('A X não gastou no Meta hoje.')
  })

  // REGRESSION: "A Glooty ainda não gastou no Meta hoje" — its ads stopped on
  // 15 nov — and the same for CAMP HALLOW, whose ads run in EPOCH's account.
  it('says "ainda" only for a store that was spending, and why the others are not', () => {
    const range = { from: '2026-11-24', to: '2026-11-24' }
    const glooty = buildAdsVerdict({
      storeName: 'Glooty', report: report([], { configured: false }), pnl: pnl({}), window: today, decision: null,
      metaHistory: { firstSpendDay: '2026-11-04', lastSpendDay: '2026-11-15', range, today: '2026-11-24' },
    }).verdict
    expect(glooty.headline).toBe('A Glooty não gastou no Meta hoje.')
    expect(glooty.chips[0].label).toBe('Sem gasto no Meta')
    expect(glooty.details.map(d => d.text)).toEqual(['Nenhuma venda e nenhum gasto no Meta hoje.', 'Anúncios parados: o último gasto no Meta foi em 15 nov.'])
    const camp = buildAdsVerdict({
      storeName: 'CAMP HALLOW', report: report([]), pnl: pnl({}), window: today, decision: null,
      metaHistory: { firstSpendDay: null, lastSpendDay: null, range, today: '2026-11-24', adsRunIn: ['EPOCH ®️'] },
    }).verdict
    expect(camp.headline).toBe('A CAMP HALLOW não gastou no Meta hoje.')
    expect(camp.details[1].text).toBe('A CAMP HALLOW não tem gasto no Meta registrado nela: os anúncios dela rodam na conta da EPOCH ®️, e o gasto deles fica na contabilidade de lá.')
    // With campaigns paid elsewhere in the window, that line says it instead.
    const billed = buildAdsVerdict({
      storeName: 'CAMP HALLOW', report: report([]), pnl: pnl({ revenue: 500, orders: 5 }), window: WINDOW, decision: null,
      billedElsewhere: { spend: 900, campaigns: 2, stores: ['EPOCH ®️'] },
      metaHistory: { firstSpendDay: null, lastSpendDay: null, range: { from: '2026-10-10', to: '2026-10-16' }, today: '2026-11-24', adsRunIn: ['EPOCH ®️'] },
    }).verdict
    expect(billed.details.map(d => d.text).filter(t => t.includes('rodam na conta'))).toHaveLength(0)
    expect(billed.details.map(d => d.text).join(' ')).toContain('2 campanhas pagas na conta da EPOCH ®️')
  })

  it('noSpendHistory tells "ainda", stopped ads, ads that started later and ads never in these books apart', () => {
    const day = { from: '2026-11-24', to: '2026-11-24' }
    expect(noSpendHistory({ firstSpendDay: '2026-05-21', lastSpendDay: '2026-11-23', range: day, today: '2026-11-24' }, true, 'EPOCH')).toEqual({ yet: true, line: null })
    // A closed day is never "ainda".
    expect(noSpendHistory({ firstSpendDay: '2026-05-21', lastSpendDay: '2026-11-22', range: { from: '2026-11-23', to: '2026-11-23' }, today: '2026-11-24' }, false, 'EPOCH').yet).toBe(false)
    // 7 dias ending yesterday: still the present, so "parados".
    expect(noSpendHistory({ firstSpendDay: '2026-11-04', lastSpendDay: '2026-11-15', range: { from: '2026-11-17', to: '2026-11-23' }, today: '2026-11-24' }, false, 'Glooty').line)
      .toBe('Anúncios parados: o último gasto no Meta foi em 15 nov.')
    // A window in the past says only when the last spend before it was.
    expect(noSpendHistory({ firstSpendDay: '2026-08-09', lastSpendDay: '2026-10-01', range: { from: '2026-10-10', to: '2026-10-16' }, today: '2026-11-24' }, false, 'Dumpling').line)
      .toBe('O último gasto no Meta antes destas datas foi em 1 out.')
    // Before the store's first spend.
    expect(noSpendHistory({ firstSpendDay: '2026-11-08', lastSpendDay: null, range: { from: '2026-11-07', to: '2026-11-07' }, today: '2026-11-24' }, false, 'Hibikura').line)
      .toBe('A Hibikura começou a anunciar no Meta em 8 nov.')
    expect(noSpendHistory({ firstSpendDay: null, lastSpendDay: null, range: day, today: '2026-11-24' }, true, 'X').line)
      .toBe('A X não tem nenhum gasto no Meta registrado.')
    expect(noSpendHistory(null, true, 'X')).toEqual({ yet: false, line: null })
  })

  it('names unsynced ads instead of "0 campanhas"', () => {
    // Glooty, 12 nov: $138, all in ads the sync had not tied to a campaign.
    const bucket = row({ campaignId: null, name: 'Anúncios ainda não sincronizados', unsynced: true, spend: 138.4 })
    const r = report([bucket], { configured: false, contributionRate: null, breakEvenRoas: null, storeRevenue: 0 })
    r.totals = { ...r.totals, campaigns: 0 }
    const v = buildAdsVerdict({ storeName: 'Glooty', report: r, pnl: pnl({ metaSpend: 138.4, adSpend: 138.4 }), window: WINDOW, decision: null }).verdict
    expect(v.details[0].text).toBe('Gasto no Meta: $138, todo em anúncios que a sincronização ainda não ligou a uma campanha. O Meta credita a eles $0 em vendas — ROAS atribuído 0,00× (sem vendas no período, não há empate).')
    expect(v.details[0].text).not.toContain('0 campanhas')
  })

  it('says Meta credits sales the store never had', () => {
    // MOKOO, 1–31 mar (first order 11 abr): $1.506 credited by Meta, store revenue $0.
    const rows = [row({ spend: 1132.4, purchaseValue: 1506.2, purchases: 23 })]
    const r = report(rows, { contributionRate: null, breakEvenRoas: null, storeRevenue: 0 })
    r.totals = { ...r.totals, estimatedProfit: -1132.4 }
    const p = pnl({ metaSpend: 1132.4, adSpend: 1132.4, operatingProfit: -1132.4 })
    const v = buildAdsVerdict({ storeName: 'MOKOO', report: r, pnl: p, window: { ...WINDOW, periodPhrase: 'em 1–31 mar' }, decision: null }).verdict
    expect(v.headline).toBe('A MOKOO gastou $1.132 no Meta em 1–31 mar e não vendeu nada.')
    expect(v.details.map(d => d.text)).toContain('O Meta credita $1.506 em vendas às campanhas, mas a loja não teve nenhum pedido no período: essas compras não são vendas desta loja — a atribuição do Meta não fecha com os pedidos.')
    expect(creditedWithoutSalesText(0, 0)).toBeNull()
    expect(creditedWithoutSalesText(286, 120)).toBeNull()
    expect(creditedWithoutSalesText(286, 0, true)).toContain('não tem nenhum pedido até agora')
    // The gauge's help: never "fica abaixo" when it is above.
    expect(attributedRoasNote({ sharedSpend: 0, shopSpend: 0, credited: 1506.2, storeRevenue: 0 }))
      .toBe('Vendas que o Meta credita às campanhas ÷ gasto no Meta. A loja não teve nenhum pedido no período: o que o Meta credita não são vendas desta loja — a atribuição do Meta não fecha com os pedidos.')
    expect(attributedRoasNote({ sharedSpend: 0, shopSpend: 0, credited: 1259, storeRevenue: 1245 })).toContain('Fica acima do ROAS do quadro ao lado')
    expect(attributedRoasNote({ sharedSpend: 0, shopSpend: 0, credited: 400, storeRevenue: 1245 })).toContain('Fica abaixo do ROAS do quadro ao lado')
  })

  it('keeps the split on the result, never on the sales or the spend', () => {
    const rows = [row({ spend: 800, purchaseValue: 150 })]
    const p = pnl({ revenue: 156, orders: 2, metaSpend: 800, adSpend: 800 })
    const v = buildAdsVerdict({ storeName: 'Glooty', report: report(rows, { configured: false, contributionRate: null, breakEvenRoas: null }), pnl: p, window: WINDOW, decision: null, split: true }).verdict
    expect(v.amountCaption).toBe('vendas da loja − anúncios, sem o custo dos produtos (sua parte, 50%)')
  })
})

describe('sharedCampaignsNote', () => {
  it('agrees with the count and drops the money sentence with no spend', () => {
    // EPOCH 30 dias: one shared campaign, $0 in the window, 2 late purchases.
    const one = sharedCampaignsNote([{ name: 'CBO - FREDDIE KReUGER - USA', spend: 0, purchases: 2 }], '25 out – 23 nov')!
    expect(one.tone).toBe('neu')
    expect(one.text).toBe('1 campanha desta lista rodou numa conta que também veiculou anúncios de outra loja (CBO - FREDDIE KReUGER - USA). Ela não gastou nada em 25 out – 23 nov: as 2 compras atribuídas a ela vêm de anúncios anteriores e podem ter caído na outra loja.')
    expect(one.text).not.toContain('$0')
    const paid = sharedCampaignsNote([{ name: 'A', spend: 1200, purchases: 10 }], '10–16 nov')!
    expect(paid.tone).toBe('warn')
    expect(paid.text).toContain('O gasto dela, $1.200, está nesta loja, mas as vendas podem ter caído na outra: fica sem margem e sem veredito.')
    const two = sharedCampaignsNote([{ name: 'A', spend: 1200, purchases: 10 }, { name: 'B', spend: 300, purchases: 1 }], '10–16 nov')!
    expect(two.text).toContain('2 campanhas desta lista rodaram')
    expect(two.text).toContain('O gasto delas, $1.500, está nesta loja, mas as vendas podem ter caído na outra: ficam sem margem e sem veredito.')
    expect(sharedCampaignsNote([], '10–16 nov')).toBeNull()
    expect(sharedCampaignsNote([{ name: 'A', spend: 0, purchases: 1 }], 'hoje')!.text).toContain('a compra atribuída a ela vem de anúncios anteriores e pode ter caído')
  })
})
