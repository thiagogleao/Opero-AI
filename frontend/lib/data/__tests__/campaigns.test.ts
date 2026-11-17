import { describe, expect, it } from 'vitest'
import { buildCampaignRows, campaignTotals, decisionWindows, type BuildCampaignInput } from '../campaigns'
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
