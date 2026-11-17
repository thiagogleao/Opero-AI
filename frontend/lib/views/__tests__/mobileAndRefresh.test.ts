import { describe, expect, it } from 'vitest'
import type { StoreRef } from '../../access'
import { selectStores, StoreSelectionError } from '../mobile'
import { planRefresh, REFRESH_DEBOUNCE_MS } from '../refresh'

const ref = (id: string, archived = false): StoreRef => ({
  id, name: id.toUpperCase(), shopName: id, domain: `${id}.myshopify.com`, timezone: 'America/Belem', archived, userId: null,
})
const visible = [ref('mokoo'), ref('epoch'), ref('squishy', true)]

describe('selectStores', () => {
  it('Todas is every active store, never an archived one', () => {
    for (const p of [null, '', 'all']) {
      const r = selectStores(p, visible)
      expect(r.key).toBe('all')
      expect(r.stores.map(s => s.id)).toEqual(['mokoo', 'epoch'])
    }
  })
  it('takes ids in order, deduplicated, archived only when named', () => {
    expect(selectStores('epoch, mokoo,epoch', visible)).toEqual({ key: 'epoch,mokoo', stores: [visible[1], visible[0]] })
    expect(selectStores('squishy', visible).stores[0].archived).toBe(true)
  })
  it('refuses a store the viewer cannot see', () => {
    expect(() => selectStores('mokoo,someone-else', visible)).toThrow(StoreSelectionError)
  })
})

describe('planRefresh', () => {
  const now = new Date('2026-11-17T18:45:00Z')
  const targets = [
    { id: 'mokoo', name: 'MOKOO', timezone: 'America/Belem', hasAds: true },
    { id: 'camp', name: 'CAMP', timezone: 'America/Sao_Paulo', hasAds: false },
    { id: 'hibikura', name: 'Hibikura', timezone: 'Asia/Tokyo', hasAds: true },
  ]
  it('starts both sources per store on its own calendar, staggered by store', () => {
    const plan = planRefresh(targets, new Map(), now, 4000)
    expect(plan.launch.map(l => `${l.storeId}:${l.source}:${l.delayMs}`)).toEqual([
      'mokoo:shopify:0', 'mokoo:facebook:0', 'camp:shopify:4000', 'hibikura:shopify:8000', 'hibikura:facebook:8000',
    ])
    const hib = plan.launch.find(l => l.storeId === 'hibikura')!
    expect([hib.dateFrom, hib.dateTo]).toEqual(['2026-11-16', '2026-11-18'])
    expect(plan.launch.find(l => l.source === 'facebook')!.mode).toBe('quick')
    expect(plan.skipped).toEqual([{ storeId: 'camp', name: 'CAMP', source: 'facebook', reason: 'sem_conta_de_anuncio', retryInSeconds: null }])
  })
  it('skips a store/source that started in the last two minutes', () => {
    const recent = new Map([['mokoo:shopify', now.getTime() - 30_000], ['hibikura:facebook', now.getTime() - REFRESH_DEBOUNCE_MS - 1]])
    const plan = planRefresh(targets, recent, now, 4000)
    expect(plan.launch.some(l => l.storeId === 'mokoo' && l.source === 'shopify')).toBe(false)
    expect(plan.launch.some(l => l.storeId === 'hibikura' && l.source === 'facebook')).toBe(true)
    expect(plan.skipped.find(s => s.storeId === 'mokoo')).toMatchObject({ reason: 'recente', retryInSeconds: 90 })
  })
})
