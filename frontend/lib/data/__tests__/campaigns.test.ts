import { describe, expect, it } from 'vitest'
import { addListed, buildCampaignRows, campaignTotals, decisionWindows, estimateRow, listedCounts, metaTotals, splitOwnShared, type BuildCampaignInput } from '../campaigns'
import { adRunning, buildCreativeRows } from '../creatives'
import {
  mergeRanges, reconcile, sharedAccountFlag, ORPHAN_CAMPAIGN_NAME,
  type AdDayFact, type AdInfo, type CampaignInfo,
} from '../meta'
import { DEFAULT_THRESHOLDS } from '../../campaignSignal'

const EPOCH = '73a1d3b1-45ff-410a-af37-93f95a591e6e'
const CAMP_HALLOW = 'ae929078-e0ef-4ddc-9022-283fb67a5dd7'
const OLD_ACCOUNT = 'act_3618880568247785'
const NEW_ACCOUNT = 'act_1040512874708609'

function fact(over: Partial<AdDayFact>): AdDayFact {
  return {
    date: '2026-11-16', adId: 'ad1', campaignId: 'c1', adsetId: 's1', accountId: NEW_ACCOUNT,
    spend: 0, purchaseValue: 0, purchases: 0, phantomValue: 0, impressions: 0, reach: 0, linkClicks: 0,
    landingPageViews: 0, addToCart: 0, initiateCheckout: 0, videoPlays: 0, videoP25: 0, videoP50: 0,
    videoP75: 0, videoP100: 0, ...over,
  }
}

const decision = { window: { from: '2026-11-10', to: '2026-11-16' }, previous: { from: '2026-11-03', to: '2026-11-09' } }
const camp = (campaignId: string, accountId: string, status = 'ACTIVE', name = `C ${campaignId}`): CampaignInfo =>
  ({ campaignId, name, status, objective: null, accountId })

function build(over: Partial<BuildCampaignInput>): ReturnType<typeof buildCampaignRows> {
  return buildCampaignRows({
    storeId: EPOCH, range: decision.window, decision, facts: [],
    campaigns: new Map(), journeys: new Map(), firstTouch: new Map(),
    margin: { configured: true, contributionRate: 0.6 },
    decisionMargin: { configured: true, contributionRate: 0.6 },
    thresholds: DEFAULT_THRESHOLDS, ...over,
  })
}

describe('buildCampaignRows', () => {
  it('keeps spend of ads missing from fb_ads in their own row, so the list adds up', () => {
    const facts = [
      fact({ adId: 'a1', spend: 100, purchaseValue: 300, purchases: 3 }),
      fact({ adId: 'orphan1', campaignId: null, adsetId: null, spend: 40, purchaseValue: 50, purchases: 1 }),
      fact({ adId: 'orphan2', campaignId: null, adsetId: null, spend: 10, date: '2026-11-12' }),
    ]
    const rows = build({ facts, campaigns: new Map([['c1', camp('c1', NEW_ACCOUNT)]]) })
    const unsynced = rows.find(r => r.unsynced)!
    expect(unsynced.name).toBe(ORPHAN_CAMPAIGN_NAME)
    expect(unsynced.spend).toBe(50)
    expect(unsynced.unsyncedAds.map(a => a.name)).toEqual(['Anúncio sem nome (id orphan1)', 'Anúncio sem nome (id orphan2)'])
    expect(unsynced.decision.action).toBeNull()
    const totals = campaignTotals(rows, true)
    expect(totals.spend).toBe(150)
    expect(reconcile(facts, 150).gap).toBe(0)
    expect(reconcile(facts, 150).unsyncedSpend).toBe(50)
  })

  it('fills every date of the window and the days add up to the row', () => {
    const facts = [
      fact({ date: '2026-11-10', spend: 50, purchaseValue: 100, purchases: 1 }),
      fact({ date: '2026-11-14', spend: 50, purchaseValue: 200, purchases: 2 }),
    ]
    const [row] = build({ facts, campaigns: new Map([['c1', camp('c1', NEW_ACCOUNT)]]) })
    expect(row.days).toHaveLength(7)
    expect(row.days.filter(d => d.estimatedProfit === null)).toHaveLength(5)
    const sum = row.days.reduce((s, d) => s + (d.estimatedProfit ?? 0), 0)
    expect(sum).toBeCloseTo(row.estimatedProfit!)
    expect(row.estimatedProfit).toBeCloseTo(300 * 0.6 - 100)
  })

  it('reports the phantom value dropped from a row', () => {
    const facts = [fact({ spend: 4, purchaseValue: 0, phantomValue: 183000 })]
    const [row] = build({ facts, campaigns: new Map([['c1', camp('c1', OLD_ACCOUNT)]]), journeys: new Map([['c1', new Map([[EPOCH, 10]])]]) })
    expect(row.purchaseValue).toBe(0)
    expect(row.phantomValueDropped).toBe(183000)
    expect(reconcile(facts, 4)).toMatchObject({ phantomAdDays: 1, phantomValueDropped: 183000 })
  })

  it('flags a CAMP HALLOW campaign in EPOCH\'s old account instead of judging it with EPOCH\'s margin', () => {
    const facts = eachWindowDay(d => fact({ date: d, campaignId: 'freddie', spend: 500, purchaseValue: 1000, purchases: 15 }))
    const rows = build({
      facts,
      campaigns: new Map([['freddie', camp('freddie', OLD_ACCOUNT, 'ACTIVE', 'CBO - FREDDIE KReUGER - USA')]]),
      journeys: new Map([['freddie', new Map([[CAMP_HALLOW, 338]])]]),
      storeNames: new Map([[CAMP_HALLOW, 'CAMP HALLOW']]),
    })
    const [row] = rows
    expect(row.shared?.journeyStoreId).toBe(CAMP_HALLOW)
    expect(row.shared?.note).toMatch(/CAMP HALLOW/)
    expect(row.estimatedProfit).toBeNull()
    expect(row.decision.action).toBeNull()
    expect(row.decision.basis).toBe('conta_compartilhada')
    const totals = campaignTotals(rows, true)
    expect(totals.unpricedSpend).toBe(3500)
    expect(totals.estimatedProfit).toBeNull()
  })

  it('judges EPOCH\'s own campaign in the same shared account normally', () => {
    const facts = eachWindowDay(d => fact({ date: d, campaignId: 'e1962', spend: 50, purchaseValue: 1000 / 7, purchases: 2 }))
    const [row] = build({
      facts,
      campaigns: new Map([['e1962', camp('e1962', OLD_ACCOUNT)]]),
      journeys: new Map([['e1962', new Map([[EPOCH, 27]])]]),
    })
    expect(row.shared).toBeNull()
    expect(row.decision.action).toBe('escalar')
  })

  it('never gives a paused campaign an action', () => {
    const facts = eachWindowDay(d => fact({ date: d, spend: 50, purchaseValue: 1000 / 7, purchases: 2 }))
    const [row] = build({ facts, campaigns: new Map([['c1', camp('c1', NEW_ACCOUNT, 'PAUSED')]]) })
    expect(row.running).toBe(false)
    expect(row.decision.action).toBeNull()
  })

  it('judges the action on the decision window even when the money window is another', () => {
    const facts = [
      fact({ date: '2026-10-05', spend: 900, purchaseValue: 100, purchases: 1 }),
      ...eachWindowDay(d => fact({ date: d, spend: 50, purchaseValue: 1000 / 7, purchases: 2 })),
    ]
    const [row] = build({ facts, range: { from: '2026-10-01', to: '2026-10-31' }, campaigns: new Map([['c1', camp('c1', NEW_ACCOUNT)]]) })
    expect(row.spend).toBe(900)
    expect(row.days).toHaveLength(31)
    expect(row.decision.spend).toBeCloseTo(350)
    expect(row.decision.action).toBe('escalar')
  })

  it('no cost settings: no estimated profit, no action', () => {
    const facts = [fact({ spend: 50, purchaseValue: 100, purchases: 1 })]
    const [row] = build({
      facts, campaigns: new Map([['c1', camp('c1', NEW_ACCOUNT)]]),
      margin: { configured: false, contributionRate: null }, decisionMargin: { configured: false, contributionRate: null },
    })
    expect(row.estimatedProfit).toBeNull()
    expect(row.decision.basis).toBe('sem_custos')
  })

  // Hibikura at 04h in Tokyo: costs set, 0 orders (so no contribution rate),
  // $58,78 on Meta. Every row read "sem margem" and the total "Lucro estimado —".
  it('costs set but no sales: a row Meta credited nothing to loses its spend', () => {
    const noRate = { configured: true, contributionRate: null }
    const facts = [
      fact({ campaignId: 'c1', date: '2026-11-15', spend: 20 }),
      fact({ campaignId: 'c1', date: '2026-11-16', spend: 38.78 }),
      fact({ campaignId: 'c2', spend: 12, purchaseValue: 40, purchases: 1 }),
      fact({ campaignId: 'freddie', accountId: OLD_ACCOUNT, spend: 30 }),
    ]
    const rows = build({
      facts, margin: noRate, decisionMargin: noRate,
      campaigns: new Map([['c1', camp('c1', NEW_ACCOUNT)], ['c2', camp('c2', NEW_ACCOUNT)], ['freddie', camp('freddie', OLD_ACCOUNT)]]),
      journeys: new Map([['freddie', new Map([[CAMP_HALLOW, 338]])]]),
    })
    const byId = (id: string) => rows.find(r => r.campaignId === id)!
    expect(byId('c1').estimatedProfit).toBe(-58.78)
    expect(byId('c1').margin).toBeNull()
    // The days carry the same rule and add up to the row; a day without spend stays empty.
    const days = byId('c1').days
    expect(days.find(d => d.date === '2026-11-15')?.estimatedProfit).toBe(-20)
    expect(days.find(d => d.date === '2026-11-16')?.estimatedProfit).toBe(-38.78)
    expect(days.find(d => d.date === '2026-11-14')?.estimatedProfit).toBeNull()
    // Purchase value with no rate: no estimate. A shared row: never this store's margin.
    expect(byId('c2').estimatedProfit).toBeNull()
    expect(byId('freddie').shared).not.toBeNull()
    expect(byId('freddie').estimatedProfit).toBeNull()
    expect(campaignTotals(rows, true).estimatedProfit).toBe(-58.78)
  })

  // MOKOO 7 dias: "CBO - CHRISTMAS CAPY — global · pausada · 0 conjuntos · 0
  // anúncios · $0 · 2 compras", opening to "C4 TOF · 1 anúncio" and "C2 PRÉ-BLACK
  // FRIDAY · 1 anúncio": the row counted only ads with spend.
  it('counts the ad sets and ads it opens to: spend or a sale in the window', () => {
    const facts = [
      fact({ campaignId: 'xmas', adId: 'a1', adsetId: 'c4', purchases: 1, purchaseValue: 50 }),
      fact({ campaignId: 'xmas', adId: 'a2', adsetId: 'c2', purchases: 1, purchaseValue: 59 }),
      // An ad with nothing in the window, and a sale outside it, do not count.
      fact({ campaignId: 'xmas', adId: 'a3', adsetId: 'c9' }),
      fact({ campaignId: 'xmas', adId: 'a4', adsetId: 'c8', date: '2026-11-02', purchases: 1, purchaseValue: 30 }),
      // A spending campaign keeps counting its spenders (and their ad sets once).
      fact({ campaignId: 'live', adId: 'b1', adsetId: 's1', spend: 10 }),
      fact({ campaignId: 'live', adId: 'b2', adsetId: 's1', spend: 5, date: '2026-11-15' }),
    ]
    const rows = build({ facts, campaigns: new Map([['xmas', camp('xmas', NEW_ACCOUNT, 'PAUSED')], ['live', camp('live', NEW_ACCOUNT)]]) })
    const xmas = rows.find(r => r.campaignId === 'xmas')!
    expect(xmas.spend).toBe(0)
    expect({ adsets: xmas.adsets, ads: xmas.ads }).toEqual({ adsets: 2, ads: 2 })
    const live = rows.find(r => r.campaignId === 'live')!
    expect({ adsets: live.adsets, ads: live.ads }).toEqual({ adsets: 1, ads: 2 })
  })
})

describe('listedCounts', () => {
  it('counts an ad once over its days, with its ad set', () => {
    const ads = new Map()
    addListed(ads, { adId: 'a', adsetId: null, spend: 0, purchases: 0, purchaseValue: 0 })
    addListed(ads, { adId: 'a', adsetId: 's', spend: 0.01, purchases: 0, purchaseValue: 0 })
    addListed(ads, { adId: 'b', adsetId: 's', spend: 0, purchases: 0, purchaseValue: 0 })
    expect(listedCounts(ads)).toEqual({ ads: 1, adsets: 1 })
  })
})

describe('metaTotals', () => {
  it('has no CPA without spend: late purchases of a paused campaign did not cost $0 each', () => {
    // MOKOO 7d, "CBO - CHRISTMAS CAPY — global": spend 0, 2 purchases, $108,59.
    expect(metaTotals({ spend: 0, purchaseValue: 108.59, purchases: 2, impressions: 0, linkClicks: 0 }).cpa).toBeNull()
    expect(metaTotals({ spend: 602, purchaseValue: 186.62, purchases: 2, impressions: 0, linkClicks: 0 }).cpa).toBe(301)
    expect(metaTotals({ spend: 50, purchaseValue: 0, purchases: 0, impressions: 0, linkClicks: 0 }).cpa).toBeNull()
  })
})

describe('estimateRow', () => {
  const rate = { configured: true, contributionRate: 0.6 }
  const noRate = { configured: true, contributionRate: null }
  it('prices with the contribution rate when there is one', () => {
    expect(estimateRow(300, 100, rate, false)).toBe(80)
  })
  it('without a rate, only a row with no purchase value is priced: −spend', () => {
    expect(estimateRow(0, 58.78, noRate, false)).toBe(-58.78)
    expect(estimateRow(10, 58.78, noRate, false)).toBeNull()
  })
  it('never prices a shared row or a store without cost settings', () => {
    expect(estimateRow(0, 58.78, noRate, true)).toBeNull()
    expect(estimateRow(300, 100, rate, true)).toBeNull()
    expect(estimateRow(0, 58.78, { configured: false, contributionRate: null }, false)).toBeNull()
  })
  it('a fraction of a cent is $0, not −$0', () => {
    expect(Object.is(estimateRow(0, 0.001, noRate, false), 0)).toBe(true)
  })
})

describe('sharedAccountFlag', () => {
  it('flags a shared-account campaign with no tracked orders anywhere (EVEREST, BUBBO)', () => {
    expect(sharedAccountFlag(EPOCH, OLD_ACCOUNT, undefined)?.note).toMatch(/nenhum pedido rastreado/)
  })
  it('flags a campaign of any account whose orders mostly land elsewhere', () => {
    expect(sharedAccountFlag(EPOCH, NEW_ACCOUNT, new Map([[CAMP_HALLOW, 9], [EPOCH, 1]]))).not.toBeNull()
  })
  it('leaves alone campaigns with a handful of stray orders elsewhere', () => {
    expect(sharedAccountFlag(EPOCH, NEW_ACCOUNT, new Map([[CAMP_HALLOW, 2]]))).toBeNull()
    expect(sharedAccountFlag(EPOCH, NEW_ACCOUNT, undefined)).toBeNull()
  })
  it('never names, by id or by name, a store the viewer cannot see', () => {
    const f = sharedAccountFlag(EPOCH, OLD_ACCOUNT, new Map([[CAMP_HALLOW, 338]]), new Map())
    expect(f?.journeyStoreId).toBeNull()
    expect(f?.note).toMatch(/outra loja/)
  })
  it('says its order count is all time, not the window of the table it sits in', () => {
    // Freddie: 338 tracked orders since it started, 321 of them in October.
    const f = sharedAccountFlag(EPOCH, OLD_ACCOUNT, new Map([[CAMP_HALLOW, 1338]]), new Map([[CAMP_HALLOW, 'CAMP HALLOW']]))
    expect(f?.note).toContain('100% dos 1.338 pedidos rastreados dela, desde sempre, caíram em CAMP HALLOW')
  })
})

describe('windows', () => {
  it('judges the last 7 closed days on the store clock (Tokyo is a day ahead)', () => {
    const now = new Date('2026-11-17T16:30:00Z') // 13:30 São Paulo, 01:30 on the 18th in Tokyo
    expect(decisionWindows('America/Sao_Paulo', now).window).toEqual({ from: '2026-11-10', to: '2026-11-16' })
    expect(decisionWindows('Asia/Tokyo', now)).toEqual({
      window: { from: '2026-11-11', to: '2026-11-17' }, previous: { from: '2026-11-04', to: '2026-11-10' },
    })
  })
  it('merges overlapping or close ranges and keeps distant ones apart', () => {
    expect(mergeRanges([{ from: '2026-11-10', to: '2026-11-16' }, { from: '2026-11-03', to: '2026-11-16' }]))
      .toEqual([{ from: '2026-11-03', to: '2026-11-16' }])
    expect(mergeRanges([{ from: '2026-05-01', to: '2026-05-31' }, { from: '2026-11-03', to: '2026-11-16' }])).toHaveLength(2)
  })
})

describe('buildCreativeRows', () => {
  const info = (adId: string, over: Partial<AdInfo> = {}): AdInfo => ({
    adId, known: true, name: `Ad ${adId}`, status: 'ACTIVE', adsetId: 's1', adsetName: 'S', adsetStatus: 'ACTIVE',
    campaignId: 'c1', campaignName: 'C', campaignStatus: 'ACTIVE', campaignObjective: null, campaignAccountId: NEW_ACCOUNT,
    thumbnailUrl: null, creativeUrl: null, landingUrl: null, createdTime: null, ...over,
  })

  it('ranks by estimated profit, not by revenue − spend', () => {
    const facts = [
      // ROAS 1.3 at a 1.67 break-even: Meta "revenue − spend" is positive, profit is not.
      fact({ adId: 'a', spend: 100, purchaseValue: 130, purchases: 3, impressions: 1000, reach: 900 }),
      fact({ adId: 'b', spend: 20, purchaseValue: 60, purchases: 2, impressions: 500, reach: 450 }),
    ]
    const rows = buildCreativeRows({
      storeId: EPOCH, range: decision.window, facts, journeys: new Map(),
      info: new Map([['a', info('a')], ['b', info('b')]]),
      margin: { configured: true, contributionRate: 0.6, breakEvenRoas: 1 / 0.6 },
    })
    expect(rows.map(r => r.adId)).toEqual(['b', 'a'])
    expect(rows[1].estimatedProfit).toBeCloseTo(130 * 0.6 - 100)
    expect(rows[0].hookRate).toBeNull()
    expect(rows[0].frequency).toBeNull() // a 7-day window: reach does not add across days
  })

  it('computes frequency only for a single-day window', () => {
    const day = { from: '2026-11-16', to: '2026-11-16' }
    const [row] = buildCreativeRows({
      storeId: EPOCH, range: day, journeys: new Map(), info: new Map([['a', info('a')]]),
      facts: [fact({ adId: 'a', spend: 10, impressions: 400, reach: 100 })],
      margin: { configured: true, contributionRate: 0.6, breakEvenRoas: 1 / 0.6 },
    })
    expect(row.frequency).toBe(4)
  })

  it("judges an ad on the campaigns' closed days, not on today's running day", () => {
    // MOKOO "Hoje" 23 nov at 16h: the catalog ad spent $79,46 with no Meta
    // purchase yet today; over the 7 closed days it is the best ad (3,01×,
    // 13 sales) and its campaign says "Escalar". Judged on the day it read
    // "Desligar".
    const today = { from: '2026-11-17', to: '2026-11-17' }
    const facts = [
      ...eachWindowDay(date => fact({ adId: 'cat', date, spend: 60, purchaseValue: 180.6, purchases: date === '2026-11-16' ? 13 : 0, impressions: 1000, reach: 900 })),
      fact({ adId: 'cat', date: '2026-11-17', spend: 79.46, purchaseValue: 0, purchases: 0, impressions: 900, reach: 700 }),
      // An ad that started today has nothing on the closed days.
      fact({ adId: 'new', date: '2026-11-17', spend: 55, purchaseValue: 0, purchases: 0 }),
    ]
    const margin = { configured: true, contributionRate: 1 / 1.65, breakEvenRoas: 1.65 }
    const rows = buildCreativeRows({
      storeId: EPOCH, range: today, facts, journeys: new Map(),
      info: new Map([['cat', info('cat')], ['new', info('new')]]),
      margin, verdictWindow: { range: decision.window, margin },
    })
    const cat = rows.find(r => r.adId === 'cat')!
    // The row's figures stay the day's ...
    expect(cat.spend).toBe(79.46)
    expect(cat.roas).toBe(0)
    expect(cat.frequency).toBeCloseTo(900 / 700, 6)
    // ... the verdict is the week's, and says so.
    expect(cat.verdict.signal).toBe('scale')
    expect(cat.verdict.label).toBe('Escalar')
    expect(cat.verdict.reason).toBe('ROAS 3,01× nos 7 dias fechados — 40% ou mais acima do empate desses dias (1,65×) com 13 vendas')
    const fresh = rows.find(r => r.adId === 'new')!
    expect(fresh.verdict).toEqual({ signal: null, reason: 'Sem gasto nos 7 dias fechados' })

    // Without a verdict window (or with the page's own), the row judges itself.
    const alone = buildCreativeRows({ storeId: EPOCH, range: today, facts, journeys: new Map(), info: new Map([['cat', info('cat')]]), margin })
    expect(alone.find(r => r.adId === 'cat')!.verdict.signal).toBe('kill')
    const week = buildCreativeRows({
      storeId: EPOCH, range: decision.window, facts, journeys: new Map(), info: new Map([['cat', info('cat')]]),
      margin, verdictWindow: { range: decision.window, margin },
    })
    expect(week.find(r => r.adId === 'cat')!.verdict.reason).toBe('ROAS 3,01× — 40% ou mais acima do empate (1,65×) com 13 vendas')
  })

  it('prices ads like the campaign rows on a day without sales: −spend when Meta credited nothing', () => {
    // MOKOO "Hoje" at 01h20 (no order yet, $32,55 on Meta): the campaign row
    // read −$20,44 over ad sets and ads that all read "—".
    const day = { from: '2026-11-17', to: '2026-11-17' }
    const facts = [
      fact({ adId: 'a', date: '2026-11-17', spend: 7.75 }),
      fact({ adId: 'b', date: '2026-11-17', spend: 12.69 }),
      fact({ adId: 'credited', date: '2026-11-17', spend: 5, purchaseValue: 40, purchases: 1 }),
    ]
    const noRate = { configured: true, contributionRate: null, breakEvenRoas: null }
    const rows = buildCreativeRows({
      storeId: EPOCH, range: day, facts, journeys: new Map(),
      info: new Map([['a', info('a')], ['b', info('b')], ['credited', info('credited')]]), margin: noRate,
    })
    const by = (id: string) => rows.find(r => r.adId === id)!
    expect(by('a').estimatedProfit).toBe(-7.75)
    expect(by('b').estimatedProfit).toBe(-12.69)
    // Credited value with no contribution rate: no estimate, as on the campaign row.
    expect(by('credited').estimatedProfit).toBeNull()
    // The campaign row of the uncredited ads alone carries the same −spend.
    const camp = build({ range: day, facts: facts.slice(0, 2), margin: { configured: true, contributionRate: null } })
    expect(camp[0].estimatedProfit).toBe(-20.44)
    // Without cost settings nothing is priced.
    expect(buildCreativeRows({ storeId: EPOCH, range: day, facts, journeys: new Map(), info: new Map(), margin: { configured: false, contributionRate: null, breakEvenRoas: null } })
      .every(r => r.estimatedProfit === null)).toBe(true)
  })

  it('treats an ad as running only when ad, ad set and campaign are active', () => {
    expect(adRunning(info('a'), false)).toBe(true)
    expect(adRunning(info('a', { campaignStatus: 'PAUSED' }), true)).toBe(false)
    expect(adRunning(info('a', { adsetStatus: 'PAUSED' }), true)).toBe(false)
    expect(adRunning(undefined, true)).toBe(true)
    expect(adRunning(undefined, false)).toBe(false)
  })
})

function eachWindowDay(f: (date: string) => AdDayFact): AdDayFact[] {
  return ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'].map(f)
}

describe('splitOwnShared', () => {
  it('splits a store\'s Meta money exactly as its campaign rows flag it', () => {
    // EPOCH's own campaign, CAMP HALLOW's Freddie in the old account, an
    // EVEREST campaign there with no orders anywhere, and unsynced ads of
    // both accounts.
    const facts = [
      fact({ campaignId: 'own', accountId: NEW_ACCOUNT, spend: 1000, purchaseValue: 1400 }),
      fact({ campaignId: 'freddie', accountId: OLD_ACCOUNT, spend: 600, purchaseValue: 1100, date: '2026-11-12' }),
      fact({ campaignId: 'freddie', accountId: OLD_ACCOUNT, spend: 400, purchaseValue: 500 }),
      fact({ campaignId: 'everest', accountId: OLD_ACCOUNT, spend: 50 }),
      fact({ adId: 'o1', campaignId: null, accountId: OLD_ACCOUNT, spend: 30 }),
      fact({ adId: 'o2', campaignId: null, accountId: NEW_ACCOUNT, spend: 20, purchaseValue: 10 }),
    ]
    const campaigns = new Map([['own', camp('own', NEW_ACCOUNT)], ['freddie', camp('freddie', OLD_ACCOUNT)], ['everest', camp('everest', OLD_ACCOUNT)]])
    const journeys = new Map([['freddie', new Map([[CAMP_HALLOW, 338]])], ['own', new Map([[EPOCH, 40]])]])
    const split = splitOwnShared(EPOCH, facts, campaigns, journeys)
    expect(split.own).toEqual({ spend: 1020, purchaseValue: 1410 })
    expect(split.shared).toEqual({ spend: 1080, purchaseValue: 1600, campaigns: 2 })

    // The same facts through the campaign report: the same split.
    const rows = build({ facts, campaigns, journeys })
    const own = rows.filter(r => !r.shared)
    expect(own.reduce((t, r) => t + r.spend, 0)).toBe(split.own.spend)
    expect(own.reduce((t, r) => t + r.purchaseValue, 0)).toBe(split.own.purchaseValue)
    expect(campaignTotals(rows, true).unpricedSpend).toBe(split.shared.spend)
  })
})
