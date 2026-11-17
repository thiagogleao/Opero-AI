import { describe, expect, it } from 'vitest'
import { derive, sumPnL, type CountryPnL, type DayPnL, type PnLLines, type ProductPnL } from '@/lib/engine'
import { adRunning as screenAdRunning } from '@/lib/data/creatives'
import type { AdDayFact, AdInfo } from '@/lib/data/meta'
import { DEFAULT_THRESHOLDS } from '@/lib/campaignSignal'
import { adLists, adRunning, campaignViews, decisionWindow, localDay, sharedNoteOf, type AdAggregate, type AdData } from '../ads'
import { countriesView, partnerShareView, productsView, seriesView, totalsView } from '../views'

function lines(over: Partial<PnLLines>): PnLLines {
  return {
    revenue: 0, orders: 0, units: 0, cogs: 0, packaging: 0, supplierFees: 0, unitSavings: 0, shipping: 0,
    shopifyFees: 0, paymentFees: 0, perOrderExtras: 0, fixedCosts: 0, metaSpend: 0, shopSpend: 0,
    metaPurchaseValue: 0, metaPurchases: 0, refundGross: 0, refundCount: 0, refunds: 0, chargebacks: 0,
    chargebackFees: 0, chargebackCount: 0, ...over,
  }
}

const days: DayPnL[] = Array.from({ length: 40 }, (_, i) => ({
  date: `2026-10-${String(i + 1).padStart(2, '0')}`,
  ...derive(lines({ revenue: 100 + i, orders: 1, cogs: 30, metaSpend: 20, fixedCosts: 1 })),
}))

describe('engine views', () => {
  it('weekly buckets add up to the window total', () => {
    const s = seriesView(days)
    expect(s.granularity).toBe('week')
    const total = sumPnL(days)
    const rev = s.points.reduce((a, p) => a + (p.revenue ?? 0), 0)
    expect(rev).toBeCloseTo(total.revenue, 2)
    expect(seriesView(days.slice(0, 30)).granularity).toBe('day')
  })

  it('halves money for the partner, never ratios', () => {
    const t = derive(lines({ revenue: 1000, orders: 10, cogs: 400, metaSpend: 300, refunds: 20 }))
    const s = partnerShareView(t)
    expect(s.operatingProfit).toBe(150)
    expect(s.profitPerOrder).toBe(15)
    expect(s.refunds).toBe(10)
    const v = totalsView(t)
    expect(v.margin).toBe(30) // whole store, unhalved
    expect(v.breakEvenRoas).toBeCloseTo(1.67, 2)
  })

  it('product lists sum back to the store with "others"', () => {
    const products: ProductPnL[] = Array.from({ length: 15 }, (_, i) => ({
      key: `p${i}`, productId: `p${i}`, title: `P${i}`, units: i + 1, orders: 1, revenue: 10 * (i + 1),
      variableCosts: 1, contribution: 10 * (i + 1) - 1,
    }))
    const v = productsView(products, 5)
    const sum = v.top.reduce((a, p) => a + (p.revenue ?? 0), 0) + (v.others.revenue ?? 0)
    expect(sum).toBe(products.reduce((a, p) => a + p.revenue, 0))
    expect(v.top[0].title).toBe('P14')
    expect(productsView(products, 3, 'units').top.map(p => p.units)).toEqual([15, 14, 13])
  })

  it('countries keep any market where Meta spent real money, with the sample size', () => {
    const cs: CountryPnL[] = [
      { country: 'US', revenue: 5000, orders: 200, variableCosts: 0, contribution: 2000, metaSpend: 1000, metaPurchaseValue: 3000 },
      { country: 'DE', revenue: 300, orders: 5, variableCosts: 0, contribution: 100, metaSpend: 200, metaPurchaseValue: 50 },
      { country: 'FR', revenue: 400, orders: 12, variableCosts: 0, contribution: 150, metaSpend: 0, metaPurchaseValue: 0 },
    ]
    const v = countriesView(cs, 1)
    expect(v.rows.map(r => r.country)).toEqual(['US', 'DE'])
    expect(v.rows[1].sample).toBe('insuficiente')
    expect(v.others.countries).toBe(1)
  })
})

function ad(over: Partial<AdAggregate>): AdAggregate {
  return {
    adId: 'a', name: 'A', known: true, campaignId: 'c1', campaignName: 'C1', adsetName: null, accountId: 'act_1', sharedNote: null, status: 'ACTIVE',
    adsetStatus: 'ACTIVE', campaignStatus: 'ACTIVE', createdDay: null, spend: 0, purchaseValue: 0, purchases: 0, phantomValue: 0,
    phantomDays: 0, impressions: 1000, linkClicks: 10, daysWithSpend: 5, firstSpendDay: '2026-11-10',
    lastSpendDay: '2026-11-16', ...over,
  }
}

describe('ad verdicts', () => {
  const ads = [
    ad({ adId: 'loser', spend: 558.36, purchaseValue: 541.6, purchases: 12 }),
    ad({ adId: 'winner', spend: 100, purchaseValue: 400, purchases: 8 }),
    ad({ adId: 'paused-loser', spend: 300, purchaseValue: 10, purchases: 1, status: 'PAUSED' }),
    ad({ adId: 'tiny', spend: 10, purchaseValue: 0 }),
  ]
  it('lists every losing running ad, not just the best scores', () => {
    const l = adLists(ads, 1.55, '2026-11-16')
    expect(l.kill.map(a => a.adId)).toEqual(['loser'])
    expect(l.scale.map(a => a.adId)).toEqual(['winner'])
    expect(l.verdictCounts).toMatchObject({ kill: 1, scale: 1, none: 1, ok: 1 })
    expect(l.totals.spend).toBeCloseTo(968.36, 2)
  })
  it('gives no verdict without a break-even (no cost settings)', () => {
    const l = adLists(ads, null, '2026-11-16')
    expect(l.kill).toEqual([])
    expect(l.scale).toEqual([])
    expect(l.verdictCounts.none).toBe(4)
  })
  it('runs only with ad, ad set and campaign active, like the creatives screen', () => {
    const base = { known: true, status: 'ACTIVE', adsetStatus: 'ACTIVE', campaignStatus: 'ACTIVE', lastSpendDay: '2026-11-16' }
    const info = (o: Partial<AdInfo>): AdInfo => ({
      adId: 'a', known: true, name: 'A', status: 'ACTIVE', adsetId: null, adsetName: null, adsetStatus: 'ACTIVE',
      campaignId: null, campaignName: null, campaignStatus: 'ACTIVE', campaignObjective: null, campaignAccountId: null,
      thumbnailUrl: null, creativeUrl: null, landingUrl: null, createdTime: null, ...o,
    })
    const cases = [
      {}, { campaignStatus: 'PAUSED' }, { adsetStatus: 'PAUSED' }, { status: 'PAUSED' },
      { status: null }, { known: false }, { adsetStatus: null, campaignStatus: null },
    ]
    for (const c of cases) {
      for (const spentLast of [true, false]) {
        const last = spentLast ? '2026-11-16' : '2026-11-10'
        expect(adRunning({ ...base, ...c, lastSpendDay: last }, '2026-11-16')).toBe(screenAdRunning(info(c), spentLast))
      }
    }
    expect(adRunning({ ...base, campaignStatus: 'PAUSED' }, '2026-11-16')).toBe(false)
    expect(adRunning({ ...base, adsetStatus: 'PAUSED' }, '2026-11-16')).toBe(false)
  })
})

describe('campaigns', () => {
  it('judges on the last 7 closed days', () => {
    expect(decisionWindow({ from: '2026-10-18', to: '2026-11-17' }, '2026-11-17')).toEqual({ from: '2026-11-10', to: '2026-11-16' })
    expect(decisionWindow({ from: '2026-11-17', to: '2026-11-17' }, '2026-11-17')).toBeNull()
    expect(decisionWindow({ from: '2026-11-14', to: '2026-11-16' }, '2026-11-17')).toEqual({ from: '2026-11-14', to: '2026-11-16' })
  })
  it('sums campaigns from every ad-day and flags shared accounts and unsynced spend', () => {
    const f = (date: string, adId: string, campaignId: string | null, spend: number, pv: number, accountId: string | null = 'act_1'): AdDayFact => ({
      date, adId, campaignId, adsetId: null, accountId, spend, purchaseValue: pv, purchases: pv > 0 ? 1 : 0, phantomValue: 0,
      impressions: 0, reach: 0, linkClicks: 0, landingPageViews: 0, addToCart: 0, initiateCheckout: 0,
      videoPlays: 0, videoP25: 0, videoP50: 0, videoP75: 0, videoP100: 0,
    })
    const facts = [
      f('2026-11-03', 'a1', 'c1', 999, 0), // before the window: trend only
      f('2026-11-10', 'a1', 'c1', 100, 300), f('2026-11-16', 'a1', 'c1', 100, 300),
      f('2026-11-16', 'a2', 'c2', 50, 0, 'act_3618880568247785'),
      f('2026-11-16', 'a3', null, 20, 0),
    ]
    const data: AdData = {
      storeId: 'epoch', journeys: new Map(), range: { from: '2026-11-10', to: '2026-11-16' }, facts,
      ads: [ad({ adId: 'a1', campaignId: 'c1', campaignName: 'C1' }), ad({ adId: 'a2', campaignId: 'c2', campaignName: 'C2', accountId: 'act_3618880568247785' })],
    }
    const v = campaignViews(data, { contributionRate: 0.5, storeToday: '2026-11-17', limit: 2 })
    expect(v.totalCampaigns).toBe(3)
    expect(v.rows[0]).toMatchObject({ name: 'C1', spend: 200, purchaseValue: 600, estimatedProfit: 100 })
    expect(v.rows[1].sharedAccount).toMatch(/conta antiga da EPOCH/)
    expect(v.rows[1].decision?.action).toBeNull()
    expect(v.omitted).toMatchObject({ count: 1, spend: 20 })
  })
})

describe("shared ad accounts (the screens' rule)", () => {
  const OLD = 'act_3618880568247785'
  const journeys = new Map([
    ['camp', new Map([['camp-hallow', 338]])],
    ['own', new Map([['epoch', 40], ['camp-hallow', 2]])],
    ['moved', new Map([['other', 9], ['epoch', 1]])],
  ])
  const data = { storeId: 'epoch', journeys }
  it('flags a campaign whose tracked orders land in another store, and only that', () => {
    expect(sharedNoteOf(data, 'camp', OLD)).toMatch(/conta antiga da EPOCH.*100% dos 338/)
    // EPOCH's own campaign in the same shared account is EPOCH's.
    expect(sharedNoteOf(data, 'own', OLD)).toBeNull()
    // Any account: 5+ tracked orders, most of them elsewhere.
    expect(sharedNoteOf(data, 'moved', 'act_1')).toMatch(/outra loja/)
    expect(sharedNoteOf(data, 'unknown', 'act_1')).toBeNull()
  })
  it("gives an ad of another store's campaign no verdict, however good its ROAS", () => {
    const l = adLists([ad({ adId: 'w', spend: 500, purchaseValue: 4000, purchases: 40, sharedNote: 'Rodou na conta antiga' })], 1.28, '2026-11-16')
    expect(l.scale).toEqual([])
    expect(l.verdictCounts.none).toBe(1)
  })
  it("judges campaigns with the decision basis and never prices another store's campaign", () => {
    const f = (date: string, adId: string, campaignId: string, spend: number, pv: number, purchases: number): AdDayFact => ({
      date, adId, campaignId, adsetId: null, accountId: OLD, spend, purchaseValue: pv, purchases, phantomValue: 0,
      impressions: 0, reach: 0, linkClicks: 0, landingPageViews: 0, addToCart: 0, initiateCheckout: 0,
      videoPlays: 0, videoP25: 0, videoP50: 0, videoP75: 0, videoP100: 0,
    })
    const days = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']
    const facts = days.flatMap(d => [f(d, 'a1', 'own', 100, 400, 4), f(d, 'a2', 'camp', 100, 400, 4)])
    const d: AdData = {
      storeId: 'epoch', journeys, range: { from: '2026-11-10', to: '2026-11-16' }, facts,
      ads: [ad({ adId: 'a1', campaignId: 'own', campaignName: 'Own', accountId: OLD }), ad({ adId: 'a2', campaignId: 'camp', campaignName: 'Camp', accountId: OLD })],
    }
    const window = { from: '2026-11-10', to: '2026-11-16' }
    const v = campaignViews(d, {
      contributionRate: 0.5, storeToday: '2026-11-17', limit: 5,
      decision: { window, contributionRate: 0.5, costsConfigured: true, thresholds: DEFAULT_THRESHOLDS },
    })
    const own = v.rows.find(r => r.campaignId === 'own')!
    const camp = v.rows.find(r => r.campaignId === 'camp')!
    expect(own.sharedAccount).toBeNull()
    expect(own.decision?.action).toBe('escalar')
    expect(own.estimatedProfit).toBe(700)
    expect(camp.sharedAccount).toMatch(/338/)
    expect(camp.decision?.action).toBeNull()
    expect(camp.estimatedProfit).toBeNull()
    // The basis decides, not the window rate: a loss-making margin over the judged days cuts.
    const cut = campaignViews(d, {
      contributionRate: 0.5, storeToday: '2026-11-17', limit: 5,
      decision: { window, contributionRate: 0.1, costsConfigured: true, thresholds: DEFAULT_THRESHOLDS },
    })
    expect(cut.rows.find(r => r.campaignId === 'own')?.decision?.action).toBe('cortar')
  })
})

describe('localDay', () => {
  it('puts a Postgres timestamptz on the store calendar', () => {
    expect(localDay('2026-10-28 02:10:00+00', 'America/Belem')).toBe('2026-10-27')
    expect(localDay('2026-10-27 16:10:00.123+00', 'Asia/Tokyo')).toBe('2026-10-28')
    expect(localDay('2026-10-28 02:10:00+05:30', 'UTC')).toBe('2026-10-27')
    expect(localDay('2026-10-28 junk', 'UTC')).toBe('2026-10-28')
  })
})
