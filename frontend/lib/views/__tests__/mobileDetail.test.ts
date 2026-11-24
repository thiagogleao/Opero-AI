import { describe, expect, it } from 'vitest'
import type { StoreRef } from '../../access'
import type { CampaignReport, CampaignRow } from '../../data/campaigns'
import type { CreativesReport, CreativeRow } from '../../data/creatives'
import type { ProductReport, ProductRow } from '../../data/products'
import type { CountryReport, CountryRow } from '../../data/countries'
import type { CustomerLtv, CustomerSplit } from '../../data/customers'
import type { PnL } from '../../engine/pnl'
import { decideCampaign, DEFAULT_THRESHOLDS, type CampaignDecision } from '../../campaignSignal'
import { creativeVerdict } from '../../creativeSignal'
import { eachDay } from '../../engine/dates'
import {
  DetailQueryError, mergeCampaigns, mergeCountries, mergeCreatives, mergeCustomers, mergeProducts, parseDetailQuery, perStore,
} from '../mobileDetail'

const ref = (id: string, tz = 'America/Belem'): StoreRef => ({
  id, name: id.toUpperCase(), shopName: id, domain: null, timezone: tz, archived: false, userId: null,
})
const MOKOO = ref('mokoo')
const HIB = ref('hibikura', 'Asia/Tokyo')
const GLOOTY = ref('glooty')

const pnl = (p: Partial<PnL>): PnL => ({
  revenue: 0, orders: 0, units: 0, cogs: 0, packaging: 0, supplierFees: 0, unitSavings: 0, shipping: 0, shopifyFees: 0,
  paymentFees: 0, perOrderExtras: 0, fixedCosts: 0, metaSpend: 0, shopSpend: 0, metaPurchaseValue: 0, metaPurchases: 0,
  refundGross: 0, refundCount: 0, refunds: 0, chargebacks: 0, chargebackFees: 0, chargebackCount: 0,
  productCost: 0, fees: 0, variableCosts: 0, contribution: 0, adSpend: 0, operatingProfit: 0, adjustments: 0, cashResult: 0,
  margin: null, contributionMargin: null, breakEvenRoas: null, roas: null, metaRoas: null, profitPerOrder: null, ...p,
})

describe('parseDetailQuery', () => {
  const q = (s: string) => parseDetailQuery(new URLSearchParams(s))
  it('mirrors /api/mobile: default today, presets drop dates', () => {
    expect(q('section=campanhas')).toEqual({ section: 'campanhas', period: 'today', from: null, to: null, store: null })
    expect(q('section=paises&period=7d&from=2026-11-01&to=2026-11-02&store=all')).toEqual({
      section: 'paises', period: '7d', from: null, to: null, store: 'all',
    })
    expect(q('section=clientes&period=custom&from=2026-11-01&to=2026-11-05').from).toBe('2026-11-01')
  })
  it('a custom period without both dates is a 400, never a silent today', () => {
    for (const s of ['section=campanhas&period=custom', 'section=campanhas&period=custom&from=2026-11-01']) {
      expect(() => q(s)).toThrow(DetailQueryError)
      expect(() => q(s)).toThrow('Escolha a data inicial e a final')
    }
  })
  it('refuses unknown sections, periods and impossible dates', () => {
    expect(() => q('section=products')).toThrow('Seção inválida')
    expect(() => q('period=7d')).toThrow('Seção inválida')
    expect(() => q('section=campanhas&period=ever')).toThrow('Período inválido')
    expect(() => q('section=campanhas&period=custom&from=2026-11-31&to=2026-12-01')).toThrow('Data inválida')
    try { q('section=x') } catch (e) { expect((e as DetailQueryError).status).toBe(400) }
  })
  it('a range wholly before 2000 is a 400 (as /api/mobile); a long or older one passes and is cut when priced', () => {
    expect(() => q('section=produtos&period=custom&from=1990-01-01&to=1995-01-01')).toThrow('Escolha datas a partir de 1 jan 2000')
    expect(q('section=produtos&period=custom&from=1990-01-01&to=2026-11-17')).toMatchObject({ from: '1990-01-01', to: '2026-11-17' })
  })
})

describe('perStore', () => {
  it('names the stores that failed instead of dropping them, and caps concurrency', async () => {
    let running = 0, peak = 0
    const r = await perStore([MOKOO, HIB, GLOOTY, ref('x')], async s => {
      running++; peak = Math.max(peak, running)
      await new Promise(res => setTimeout(res, 5))
      running--
      if (s.id === 'hibikura') throw new Error('boom')
      if (s.id === 'x') return null
      return s.id.length
    }, 2)
    expect(r.ok.map(l => [l.store.id, l.value])).toEqual([['mokoo', 5], ['glooty', 6]])
    expect(r.failed.map(s => s.id)).toEqual(['hibikura', 'x'])
    expect(peak).toBeLessThanOrEqual(2)
  })
})

const decision = (action: CampaignDecision['action'], window = { from: '2026-11-10', to: '2026-11-16' }): CampaignDecision => ({
  action, basis: 'margem', reason: `r-${action}`, notes: [], trend: null, trendChange: null, window,
  previous: { from: '2026-11-03', to: '2026-11-09' }, running: true, spend: 0, purchases: 0, revenue: 0,
  estimatedProfit: null, margin: null, roas: null, cpa: null, previousSpend: 0, previousRoas: null, recentRoasChange: null,
  days: [], thresholds: DEFAULT_THRESHOLDS,
})

const campaign = (id: string, spend: number, pv: number, profit: number | null, action: CampaignDecision['action'], shared = false): CampaignRow => ({
  campaignId: id, name: id, status: 'ACTIVE', running: true, objective: null, accountId: null, unsynced: false, unsyncedAds: [],
  shared: shared ? { accountId: 'a', note: 'vendas em outra loja', journeyStoreId: null, journeyOrdersHere: 0, journeyOrdersTotal: 0 } : null,
  ads: 1, adsets: 1, estimatedProfit: profit, margin: null, journeyOrders: 0, phantomValueDropped: 0,
  days: [{ date: '2026-11-16', spend, purchaseValue: pv, purchases: 1, estimatedProfit: profit }],
  decision: decision(action),
  spend, purchaseValue: pv, purchases: 1, impressions: 0, linkClicks: 0, roas: spend ? pv / spend : null,
  cpa: null, ctr: null, cpm: null, cpc: null, aov: null,
})

const campaignReport = (store: StoreRef, rows: CampaignRow[], over: Partial<CampaignReport> = {}): CampaignReport => ({
  storeId: store.id, timezone: store.timezone, range: { from: '2026-11-10', to: '2026-11-16' }, partial: false, configured: true,
  contributionRate: 0.4, contributionMargin: 40, breakEvenRoas: 2.5, decisionWindow: { from: '2026-11-10', to: '2026-11-16' },
  previousWindow: { from: '2026-11-03', to: '2026-11-09' }, decisionContributionRate: 0.4, decisionBreakEvenRoas: 2.5,
  thresholds: DEFAULT_THRESHOLDS, rules: { escalar: 'e', manter: 'm', cortar: 'c', observar: 'o' }, formula: 'f',
  campaigns: rows, totals: { spend: 0, purchaseValue: 0, purchases: 0, roas: null, estimatedProfit: null, unpricedSpend: 0, campaigns: 0, actions: { escalar: 0, manter: 0, cortar: 0, observar: 0 }, trends: { melhorando: 0, piorando: 0 } },
  reconciliation: { engineMetaSpend: 0, listedSpend: 0, gap: 0, unsyncedSpend: 0, phantomAdDays: 0, phantomValueDropped: 0 },
  storeRevenue: 0, metaVsStoreRevenueGap: null, billedElsewhere: [], ...over,
})

describe('mergeCampaigns', () => {
  it('keeps each store\'s break-even, sums money, ranks Cortar before Escalar and recomputes ROAS', () => {
    const m = mergeCampaigns([
      { store: MOKOO, value: campaignReport(MOKOO, [campaign('a', 100, 300, 20, 'manter'), campaign('b', 500, 400, -300, 'cortar')]) },
      { store: HIB, value: campaignReport(HIB, [campaign('c', 200, 600, 100, 'escalar'), campaign('d', 50, 0, null, null, true)], {
        breakEvenRoas: 1.34, decisionWindow: { from: '2026-11-11', to: '2026-11-17' },
      }) },
    ])
    expect(m.campaigns.map(c => c.name)).toEqual(['b', 'c', 'a', 'd'])
    expect(m.campaigns.find(c => c.name === 'c')!.breakEvenRoas).toBe(1.34)
    expect(m.campaigns.find(c => c.name === 'b')!.breakEvenRoas).toBe(2.5)
    // A shared-account campaign is not judged against this store's margin.
    expect(m.campaigns.find(c => c.name === 'd')).toMatchObject({ breakEvenRoas: null, shared: 'vendas em outra loja', actionLabel: null })
    expect(m.totals).toMatchObject({ spend: 850, purchaseValue: 1300, estimatedProfit: -180, unpricedSpend: 50 })
    expect(m.totals.roas).toBeCloseTo(1300 / 850)
    expect(m.totals.actions).toEqual({ escalar: 1, manter: 1, cortar: 1, observar: 0 })
    expect(m.decisionWindows).toEqual([
      { range: { from: '2026-11-10', to: '2026-11-16' }, label: '10–16 nov', stores: ['MOKOO'] },
      { range: { from: '2026-11-11', to: '2026-11-17' }, label: '11–17 nov', stores: ['HIBIKURA'] },
    ])
    expect(m.campaigns[0].key).toBe('mokoo:b')
  })
  it('estimated profit is null when nothing is priced (no costs anywhere)', () => {
    const m = mergeCampaigns([{ store: GLOOTY, value: campaignReport(GLOOTY, [campaign('g', 80, 20, null, null)], { configured: false, breakEvenRoas: null }) }])
    expect(m.totals.estimatedProfit).toBeNull()
    expect(m.totals.unpricedSpend).toBe(80)
  })
  it('cuts the list but not the totals', () => {
    const rows = Array.from({ length: 5 }, (_, i) => campaign(`c${i}`, 10 * (i + 1), 0, -1, 'observar'))
    const m = mergeCampaigns([{ store: MOKOO, value: campaignReport(MOKOO, rows) }], 2)
    expect(m.campaigns.map(c => c.name)).toEqual(['c4', 'c3'])
    expect(m.totalCampaigns).toBe(5)
    expect(m.totals.spend).toBe(150)
    expect(m.unsynced).toEqual({ spend: 0, ads: 0, stores: [] })
  })
  it('the unsynced-ads bucket is not a campaign: out of the list and the count, kept in the money (Glooty, $438 of $545)', () => {
    const bucket = (spend: number, ads: { adId: string; spend: number }[], running: boolean): CampaignRow => ({
      ...campaign('x', spend, 0, null, null), campaignId: null, name: 'Anúncios ainda não sincronizados', running,
      unsynced: true, unsyncedAds: ads.map(a => ({ ...a, name: `Anúncio sem nome (id ${a.adId})` })),
    })
    const m = mergeCampaigns([
      { store: GLOOTY, value: campaignReport(GLOOTY, [
        bucket(438.04, [{ adId: '1', spend: 400 }, { adId: '2', spend: 38.04 }, { adId: '3', spend: 0 }], false),
        campaign('jeans', 53.87, 0, null, null), campaign('sutia', 37.98, 0, null, null), campaign('bra', 15.3, 0, null, null),
      ], { configured: false, breakEvenRoas: null }) },
      { store: MOKOO, value: campaignReport(MOKOO, [campaign('a', 100, 300, 20, 'manter'), bucket(4.47, [{ adId: '9', spend: 4.47 }], true)]) },
    ])
    expect(m.campaigns.map(c => c.name)).not.toContain('Anúncios ainda não sincronizados')
    expect(m.totalCampaigns).toBe(4)
    expect(m.unsynced).toEqual({
      spend: 442.51, ads: 3,
      stores: [{ storeId: 'glooty', store: 'GLOOTY', spend: 438.04, ads: 2 }, { storeId: 'mokoo', store: 'MOKOO', spend: 4.47, ads: 1 }],
    })
    // The money still covers every ad: the bucket's spend is in the totals.
    expect(m.totals.spend).toBeCloseTo(438.04 + 53.87 + 37.98 + 15.3 + 100 + 4.47, 2)
  })
})

const creative = (adId: string, spend: number, signal: 'kill' | 'scale' | 'refresh' | 'ok' | null, profit: number | null): CreativeRow => ({
  adId, name: adId, known: true, status: 'ACTIVE', running: true, campaignId: 'c', campaignName: 'C', adsetId: null, adsetName: null,
  thumbnailUrl: null, creativeUrl: null, landingUrl: null, createdTime: null, shared: null, estimatedProfit: profit,
  daysWithSpend: 1, lastSpendDay: '2026-11-16', video: null, hookRate: null, frequency: null, verdict: { signal, reason: 'r' },
  spend, purchaseValue: spend * 2, purchases: 1, impressions: 0, linkClicks: 0, roas: 2, cpa: null, ctr: null, cpm: null, cpc: null, aov: null,
})
const creativesReport = (store: StoreRef, rows: CreativeRow[], be: number | null): CreativesReport => ({
  storeId: store.id, timezone: store.timezone, range: { from: '2026-11-10', to: '2026-11-16' }, partial: false, configured: be !== null,
  contributionRate: null, breakEvenRoas: be, formula: 'f', creatives: rows,
  totals: { ads: rows.length, spend: 0, purchaseValue: 0, purchases: 0, estimatedProfit: null, verdicts: { kill: 0, scale: 0, refresh: 0, ok: 0, none: 0 } },
  reconciliation: null, notes: { hookRate: 'h', frequency: null },
})

describe('mergeCreatives', () => {
  it('problems first, then by spend; each ad carries its store\'s break-even', () => {
    const m = mergeCreatives([
      { store: MOKOO, value: creativesReport(MOKOO, [creative('ok-big', 900, 'ok', 50), creative('kill', 100, 'kill', -80)], 1.5) },
      { store: GLOOTY, value: creativesReport(GLOOTY, [creative('none', 300, null, null)], null) },
    ])
    expect(m.creatives.map(c => c.adId)).toEqual(['kill', 'ok-big', 'none'])
    expect(m.creatives[0]).toMatchObject({ signalLabel: 'Desligar', breakEvenRoas: 1.5, store: 'MOKOO' })
    expect(m.creatives[2].breakEvenRoas).toBeNull()
    expect(m.totals).toMatchObject({ spend: 1300, estimatedProfit: -30, verdicts: { kill: 1, ok: 1, none: 1, scale: 0, refresh: 0 } })
  })

  // The phone said "Sem ação" (SIGNAL_LABEL.ok) where the desktop chip said
  // "Abaixo do empate" or "Manter" for the same ad: the verdict's own word wins.
  it("uses the verdict's own word for an 'ok' ad, as the desktop chip", () => {
    const below = creativeVerdict({ spend: 30, roas: 0, purchases: 0, breakEven: 1.5, costsConfigured: true, running: true, frequency: null, sharedNote: null })
    const above = creativeVerdict({ spend: 30, roas: 1.8, purchases: 1, breakEven: 1.5, costsConfigured: true, running: true, frequency: null, sharedNote: null })
    expect(below.signal).toBe('ok')
    const m = mergeCreatives([{ store: MOKOO, value: creativesReport(MOKOO, [
      { ...creative('below', 30, 'ok', -30), verdict: below },
      { ...creative('above', 20, 'ok', 5), verdict: above },
      // A row built without a label (older shape) still gets the signal's word.
      creative('bare', 10, 'ok', 1),
    ], 1.5) }])
    expect(Object.fromEntries(m.creatives.map(c => [c.adId, c.signalLabel]))).toEqual({
      below: 'Abaixo do empate', above: 'Manter', bare: 'Sem ação',
    })
  })
})

const product = (p: Partial<ProductRow> & { title: string; revenue: number; contribution: number }): ProductRow => ({
  key: p.title, productId: null, imageUrl: null, units: 1, orders: 1, revenueShare: null, variableCosts: p.revenue - p.contribution,
  attributedSpend: 0, contributionAfterAttributedSpend: p.contribution, contributionMargin: null, ...p,
})
const productReport = (store: StoreRef, rows: ProductRow[], configured = true): ProductReport => ({
  storeId: store.id, range: { from: '2026-11-10', to: '2026-11-16' }, configured,
  totals: pnl({ revenue: rows.reduce((s, r) => s + r.revenue, 0), contribution: rows.reduce((s, r) => s + r.contribution, 0) }),
  products: rows,
  attribution: { model: 'first', label: 'Gasto Meta atribuído', note: 'n', attributedSpend: 0, billedElsewhere: 0, ownSpendCreditedElsewhere: 0, unlinkedSpend: 0 },
})

describe('mergeProducts', () => {
  it('merges clone stores by title, recomputes shares and margins from sums', () => {
    const m = mergeProducts([
      { store: MOKOO, value: productReport(MOKOO, [product({ title: 'Capy Box', revenue: 300, contribution: 120, units: 3 }), product({ title: 'Mug', revenue: 100, contribution: 50 })]) },
      { store: HIB, value: productReport(HIB, [product({ title: 'capy  box ', revenue: 100, contribution: 40, units: 1, imageUrl: 'x.jpg' })]) },
    ])
    expect(m.products[0]).toMatchObject({ title: 'Capy Box', revenue: 400, contribution: 160, units: 4, stores: ['MOKOO', 'HIBIKURA'], imageUrl: 'x.jpg' })
    expect(m.products[0].revenueShare).toBeCloseTo(80)
    expect(m.products[0].contributionMargin).toBeCloseTo(40)
    expect(m.totals).toEqual({ revenue: 500, units: 5, contribution: 210, attributedSpend: 0 })
  })
  it('a store without costs never lends a fake margin', () => {
    const m = mergeProducts([
      { store: MOKOO, value: productReport(MOKOO, [product({ title: 'Capy', revenue: 100, contribution: 40 })]) },
      { store: GLOOTY, value: productReport(GLOOTY, [product({ title: 'Capy', revenue: 50, contribution: 50 }), product({ title: 'Toy', revenue: 20, contribution: 20 })], false) },
    ])
    expect(m.products.find(p => p.title === 'Capy')).toMatchObject({ contribution: null, contributionMargin: null, revenue: 150 })
    expect(m.unconfiguredStores).toEqual(['GLOOTY'])
    expect(m.totals.contribution).toBeNull()
  })
})

const country = (c: string, orders: number, revenue: number, contribution: number, meta = { spend: 0, purchases: 0, purchaseValue: 0 }): CountryRow => ({
  country: c, name: c, orders, revenue, revenueShare: null, variableCosts: revenue - contribution, contribution,
  contributionMargin: null, contributionPerOrder: null, smallSample: orders < 30, meta: { ...meta, capturePct: null },
})
const countryReport = (store: StoreRef, rows: CountryRow[], configured = true): CountryReport => ({
  storeId: store.id, range: { from: '2026-11-10', to: '2026-11-16' }, configured, rows,
  totals: pnl({ revenue: rows.reduce((s, r) => s + r.revenue, 0), orders: rows.reduce((s, r) => s + r.orders, 0), contribution: rows.reduce((s, r) => s + r.contribution, 0) }),
  sharedAdAccounts: [],
  meta: { label: 'l', caveat: 'c', coveredSpend: 80, totalSpend: 100, coveragePct: 80, missingDays: ['2026-11-12'] },
  notes: ['nota da loja'],
})

describe('mergeCountries', () => {
  it('sums countries across stores, recomputes capture, rolls the tail into "outros"', () => {
    const m = mergeCountries([
      { store: MOKOO, value: countryReport(MOKOO, [country('US', 20, 2000, 800, { spend: 500, purchases: 10, purchaseValue: 1500 }), country('DE', 5, 400, 160)]) },
      { store: HIB, value: countryReport(HIB, [country('US', 20, 1000, 300, { spend: 100, purchases: 30, purchaseValue: 900 }), country('JP', 40, 4000, 1600), country('FR', 1, 50, 20)]) },
    ], 2)
    expect(m.countries.map(c => c.country)).toEqual(['JP', 'US', 'outros'])
    const us = m.countries[1]
    expect(us).toMatchObject({ orders: 40, revenue: 3000, contribution: 1100, smallSample: false })
    expect(us.meta).toMatchObject({ spend: 600, purchases: 40, capturePct: 100 })
    expect(m.countries[2]).toMatchObject({ orders: 6, revenue: 450, mergedCountries: 2 })
    expect(m.totals).toEqual({ orders: 86, revenue: 7450, contribution: 2880 })
    expect(m.meta).toMatchObject({ coveredSpend: 160, totalSpend: 200, coveragePct: 80, missingDays: 2 })
    expect(m.notes[0]).toMatch(/Porto Rico/)
    expect(m.notes).toContain('nota da loja')
  })
  it('countries sold by a store without costs show no contribution', () => {
    const m = mergeCountries([
      { store: MOKOO, value: countryReport(MOKOO, [country('US', 10, 1000, 400), country('BR', 3, 90, 30)]) },
      { store: GLOOTY, value: countryReport(GLOOTY, [country('US', 2, 156, 156)], false) },
    ])
    expect(m.countries.find(c => c.country === 'US')!.contribution).toBeNull()
    expect(m.countries.find(c => c.country === 'BR')!.contribution).toBe(30)
    expect(m.totals.contribution).toBeNull()
    expect(m.unconfiguredStores).toEqual(['GLOOTY'])
    expect(m.notes.at(-1)).toBe('GLOOTY sem custos configurados: nos países onde ela vendeu, a contribuição não aparece.')
  })
  // CAMP HALLOW's campaigns on EPOCH's account are out of EPOCH's Meta
  // columns (lib/data/countries): the phone names them, with the store their
  // sales landed in, as the desktop does.
  it("carries each store's shared campaigns left out of the Meta columns, with the sales store named", () => {
    const EPOCH = ref('epoch', 'America/Sao_Paulo')
    const lo = { campaigns: 5, spend: 22058.17, purchases: 439, purchaseValue: 39637.9, salesStoreIds: ['camp', 'gone'] }
    const m = mergeCountries([
      { store: EPOCH, value: { ...countryReport(EPOCH, [country('US', 10, 1000, 400)]), sharedLeftOut: lo } },
      { store: MOKOO, value: { ...countryReport(MOKOO, [country('US', 5, 500, 200)]), sharedLeftOut: null } },
    ], 12, id => (id === 'camp' ? 'CAMP HALLOW' : null))
    expect(m.sharedLeftOut).toEqual([{ ...lo, storeId: 'epoch', store: 'EPOCH', salesStores: [{ id: 'camp', name: 'CAMP HALLOW' }, { id: 'gone', name: null }] }])
    // Nothing left out: an empty list (the phone shows no line).
    expect(mergeCountries([{ store: MOKOO, value: countryReport(MOKOO, [country('US', 5, 500, 200)]) }]).sharedLeftOut).toEqual([])
  })
  // The desktop "Todas" keeps those campaigns in Meta's columns (raw engine
  // countries); the phone's Todas left them out, so the two disagreed on
  // Meta purchases and capture whenever they spent.
  describe('shared campaigns in a sum that holds their sales store', () => {
    const EPOCH = ref('epoch', 'America/Sao_Paulo')
    const CAMP = ref('camp', 'America/Sao_Paulo')
    const lo = { campaigns: 2, spend: 300, purchases: 12, purchaseValue: 900, salesStoreIds: ['camp'] }
    // EPOCH's rows already have the shared part taken out (getCountryReport
    // withoutShared); CA had only shared spend, so it was dropped from them.
    const epoch: CountryReport = {
      ...countryReport(EPOCH, [country('US', 10, 1000, 400, { spend: 200, purchases: 8, purchaseValue: 700 })]),
      meta: { label: 'l', caveat: 'c', coveredSpend: 200, totalSpend: 250, coveragePct: 80, missingDays: [] },
      sharedLeftOut: lo,
      sharedMeta: [
        { country: 'US', spend: 250, purchases: 11, purchaseValue: 850 },
        { country: 'CA', spend: 40, purchases: 1, purchaseValue: 50 },
      ],
    }
    const camp: CountryReport = {
      ...countryReport(CAMP, [country('US', 12, 600, 240)]),
      meta: { label: 'l', caveat: 'c', coveredSpend: 0, totalSpend: 0, coveragePct: null, missingDays: [] },
      sharedLeftOut: null, sharedMeta: [],
    }

    it('adds them back to the Meta columns, the capture and the coverage, and does not name them', () => {
      const m = mergeCountries([{ store: EPOCH, value: epoch }, { store: CAMP, value: camp }], 12, () => 'CAMP HALLOW')
      const us = m.countries.find(c => c.country === 'US')!
      expect(us).toMatchObject({ orders: 22, revenue: 1600 })
      expect(us.meta).toMatchObject({ spend: 450, purchases: 19, purchaseValue: 1550 })
      expect(us.meta.capturePct).toBeCloseTo((19 / 22) * 100)
      // A country with only shared spend comes back as its own row.
      expect(m.countries.find(c => c.country === 'CA')).toMatchObject({ orders: 0, revenue: 0, meta: { spend: 40, purchases: 1, purchaseValue: 50 } })
      expect(m.meta).toMatchObject({ coveredSpend: 490, totalSpend: 550 })
      expect(m.meta.coveragePct).toBeCloseTo((490 / 550) * 100)
      expect(m.sharedLeftOut).toEqual([])
      // Shopify's side is untouched.
      expect(m.totals).toEqual({ orders: 22, revenue: 1600, contribution: 640 })
    })

    it('keeps them out, and named, when their sales store is not in the sum', () => {
      const m = mergeCountries([{ store: EPOCH, value: epoch }, { store: MOKOO, value: countryReport(MOKOO, [country('US', 5, 500, 200)]) }])
      expect(m.countries.find(c => c.country === 'US')!.meta).toMatchObject({ spend: 200, purchases: 8, purchaseValue: 700 })
      expect(m.countries.find(c => c.country === 'CA')).toBeUndefined()
      expect(m.meta).toMatchObject({ coveredSpend: 280, totalSpend: 350 })
      expect(m.sharedLeftOut.map(x => x.storeId)).toEqual(['epoch'])
    })

    it('keeps them out when only some of their sales stores are in the sum, or the split per country is missing', () => {
      const two = { ...epoch, sharedLeftOut: { ...lo, salesStoreIds: ['camp', 'other'] } }
      expect(mergeCountries([{ store: EPOCH, value: two }, { store: CAMP, value: camp }]).sharedLeftOut.map(x => x.storeId)).toEqual(['epoch'])
      const noSplit: CountryReport = { ...epoch, sharedMeta: undefined }
      const m = mergeCountries([{ store: EPOCH, value: noSplit }, { store: CAMP, value: camp }])
      expect(m.sharedLeftOut.map(x => x.storeId)).toEqual(['epoch'])
      expect(m.meta.totalSpend).toBe(250)
    })
  })
  it("drops one store's 'contribuição é a própria receita' note: wrong once merged, and noise when that store sold nothing", () => {
    const glooty = { ...countryReport(GLOOTY, [], false), notes: ['Custos não configurados: a contribuição de cada país é a própria receita.'] }
    const m = mergeCountries([{ store: MOKOO, value: countryReport(MOKOO, [country('US', 10, 1000, 400)]) }, { store: GLOOTY, value: glooty }])
    expect(m.notes.some(n => n.includes('própria receita'))).toBe(false)
    expect(m.notes.some(n => n.includes('sem custos'))).toBe(false)
    expect(m.unconfiguredStores).toEqual([])
  })
})

describe('decision texts reach the phone in pt-BR', () => {
  // ptReason used to rewrite "ROAS 0.96x", "$1,234" and "-10%" here; the
  // signal modules now write pt-BR themselves and the texts pass through.
  it('campaign reasons, notes and rules, and creative reasons, as the signal modules wrote them', () => {
    const real = decideCampaign({
      days: eachDay('2026-11-10', '2026-11-16').map(date => ({ date, spend: 1500, revenue: 0, purchases: 0 })),
      window: { from: '2026-11-10', to: '2026-11-16' }, contributionRate: 0.4, status: 'ACTIVE',
    })
    const row = { ...campaign('cut', 10500, 0, -10500, 'cortar'), decision: real }
    const m = mergeCampaigns([{ store: MOKOO, value: campaignReport(MOKOO, [row]) }])
    expect(m.campaigns[0].reason).toBe('$10.500 em 7 dias sem nenhuma venda atribuída pelo Meta')
    expect(m.rules.observar).toBe('Entre −10% e 0% de margem, ou pouco volume para julgar (menos de 10 pedidos ou $150).')
    const verdict = creativeVerdict({ spend: 419, roas: 0.96, purchases: 2, breakEven: 1.29, frequency: null, running: true })
    const c = mergeCreatives([{ store: MOKOO, value: creativesReport(MOKOO, [{ ...creative('k', 419, 'kill', -100), verdict }], 1.29) }])
    expect(c.creatives[0].reason).toBe('ROAS 0,96× com $419 gastos — abaixo de 80% do empate (1,29×)')
  })
})

const split = (p: Partial<CustomerSplit>): CustomerSplit => ({
  storeId: 's', range: { from: '2026-11-10', to: '2026-11-16' }, historyStart: null, orders: 0, revenue: 0, newOrders: 0, returningOrders: 0,
  guestOrders: 0, newRevenue: 0, returningRevenue: 0, guestRevenue: 0, customers: 0, newCustomers: 0, returningCustomers: 0,
  repeatOrdersOfNewCustomers: 0, repeatOrderPct: null, daily: [], ...p,
})
const ltv = (p: Partial<CustomerLtv>): CustomerLtv => ({
  storeId: 's', scope: 'histórico completo', historyStart: null, customers: 0, orders: 0, revenue: 0, repeatCustomers: 0,
  repeatCustomerPct: null, avgLtv: null, avgOrders: null, guestOrders: 0, buckets: [], ...p,
})

describe('mergeCustomers', () => {
  it('sums orders and customers; the repeat share is over identified orders only', () => {
    const m = mergeCustomers([
      { store: MOKOO, value: split({ orders: 10, newOrders: 6, returningOrders: 2, guestOrders: 2, customers: 7, historyStart: '2025-03-01' }) },
      { store: HIB, value: split({ orders: 10, newOrders: 8, returningOrders: 2, customers: 9, historyStart: '2026-11-07' }) },
    ], [
      { store: MOKOO, value: ltv({ customers: 100, orders: 150, revenue: 9000, repeatCustomers: 30, buckets: [
        { segment: '1 pedido', customers: 70, pct: 70, avgOrders: 1, avgLtv: 50, avgOrderValue: 50 },
        { segment: '2–3 pedidos', customers: 30, pct: 30, avgOrders: 80 / 30, avgLtv: 5500 / 30, avgOrderValue: null },
      ] }) },
      { store: HIB, value: ltv({ customers: 50, orders: 50, revenue: 3000, repeatCustomers: 0, buckets: [
        { segment: '1 pedido', customers: 50, pct: 100, avgOrders: 1, avgLtv: 60, avgOrderValue: 60 },
      ] }) },
    ])
    expect(m.split).toMatchObject({ orders: 20, newOrders: 14, returningOrders: 4, guestOrders: 2, customers: 16, historyStart: '2025-03-01' })
    expect(m.split.repeatOrderPct).toBeCloseTo((4 / 18) * 100)
    expect(m.perStoreCustomers).toBe(true)
    expect(m.ltv).toMatchObject({ customers: 150, orders: 200, revenue: 12000, repeatCustomers: 30 })
    expect(m.ltv!.avgLtv).toBeCloseTo(80)
    expect(m.ltv!.repeatCustomerPct).toBeCloseTo(20)
    const one = m.ltv!.buckets.find(b => b.segment === '1 pedido')!
    expect(one.customers).toBe(120)
    expect(one.avgLtv).toBeCloseTo((70 * 50 + 50 * 60) / 120)
    expect(m.ltv!.buckets.map(b => b.segment)).toEqual(['1 pedido', '2–3 pedidos', '4–6 pedidos', '7+ pedidos'])
  })
  it('no lifetime block when it did not load for every store', () => {
    expect(mergeCustomers([{ store: MOKOO, value: split({ orders: 1, newOrders: 1 }) }], null).ltv).toBeNull()
  })
})
