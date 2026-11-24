import { describe, expect, it } from 'vitest'
import { adGap, adSpendState, conversionDelay, formatLocalStamp, formatOrders, landingPath, leftOutSpend, liveThumbnail, modelFromParam, modelParam, ordersLabel, sourceLabel, storeRoasLabel } from '../model'
import { adChannelOf, channelRoas } from '@/lib/views/adChannel'

describe('model URL key', () => {
  it('reads the Portuguese values, the old English ones, and defaults to first click', () => {
    expect(modelFromParam('ultimo')).toBe('last')
    expect(modelFromParam('dividido')).toBe('linear')
    expect(modelFromParam('linear')).toBe('linear')
    expect(modelFromParam(['primeiro', 'ultimo'])).toBe('first')
    expect(modelFromParam('qualquer')).toBe('first')
    expect(modelFromParam(undefined)).toBe('first')
    expect(modelParam('last')).toBe('ultimo')
  })
})

describe('formatLocalStamp', () => {
  it('keeps the store clock (MOKOO #5288 was placed 16 nov 23h04 in Belém)', () => {
    expect(formatLocalStamp('2026-11-16T23:04:58')).toBe('16 nov · 23h04')
    expect(formatLocalStamp('2026-11-16 08:15')).toBe('16 nov · 08h15')
    expect(formatLocalStamp('2025-12-31T00:00:00', '2026-11-17')).toBe('31 dez 2025 · 00h00')
    expect(formatLocalStamp(null)).toBe('—')
    expect(formatLocalStamp('ontem')).toBe('—')
  })
})

describe('adGap', () => {
  it('compares Meta with every journey sale of the ad, siblings included', () => {
    expect(adGap({ revenue: 100, siblingRevenue: 100, metaRevenue: 300 })).toEqual({ kind: 'pct', pct: 50 })
    expect(adGap({ revenue: 0, siblingRevenue: 0, metaRevenue: 50 })).toEqual({ kind: 'only_meta' })
    expect(adGap({ revenue: 80, siblingRevenue: 0, metaRevenue: 0 })).toEqual({ kind: 'only_journey' })
    expect(adGap({ revenue: 0, siblingRevenue: 0, metaRevenue: 0 })).toEqual({ kind: 'none' })
  })
})

describe('conversionDelay', () => {
  const touch = (occurredAtLocal: string | null) => ({ occurredAtLocal })
  it('counts store-calendar days from the first visit on screen (MOKOO #5285: 2 → 16 nov is 14 days)', () => {
    expect(conversionDelay({
      createdAt: '2026-11-16T22:29:00', daysToConversion: 14,
      touches: [touch('2026-11-03 20:51'), touch('2026-11-02 22:28'), touch('2026-11-16 10:53')],
    })).toBe('14 dias da primeira visita à compra')
    expect(conversionDelay({ createdAt: '2026-11-16T23:04:58', daysToConversion: 1, touches: [touch('2026-11-16 22:50')] })).toBe('comprou no mesmo dia')
    // Shopify says 1 for the next day too; the visits tell them apart.
    expect(conversionDelay({ createdAt: '2026-11-17T00:20:00', daysToConversion: 1, touches: [touch('2026-11-16 23:55')] })).toBe('comprou no dia seguinte')
    expect(conversionDelay({ createdAt: '2026-12-01T10:00:00', daysToConversion: 2, touches: [touch('2026-11-30 09:00'), touch(null)] })).toBe('comprou no dia seguinte')
  })
  it('falls back to Shopify’s count (floored at 1) without visits', () => {
    expect(conversionDelay({ createdAt: '2026-11-16T10:00:00', daysToConversion: 3, touches: [] })).toBe('3 dias da primeira visita à compra')
    expect(conversionDelay({ createdAt: '2026-11-16T10:00:00', daysToConversion: 1 })).toBe('comprou em até 1 dia')
    expect(conversionDelay({ createdAt: '2026-11-16T10:00:00', daysToConversion: null, touches: [] })).toBeNull()
  })
})

describe('sourceLabel', () => {
  it('translates Shopify’s raw visit sources', () => {
    expect(sourceLabel('direct')).toBe('Direto')
    expect(sourceLabel('an unknown source')).toBe('Origem desconhecida')
    expect(sourceLabel(null)).toBe('Origem desconhecida')
    expect(sourceLabel('email')).toBe('E-mail')
    expect(sourceLabel('https://www.trustpilot.com/')).toBe('trustpilot.com')
    expect(sourceLabel('android-app://com.google.android.gm/')).toBe('Gmail (app)')
    expect(sourceLabel('android-app://com.example.reader/')).toBe('App com.example.reader')
    expect(sourceLabel('Google')).toBe('Google')
  })
  it('never returns an Object.prototype member for a visitor-controlled app package', () => {
    // The Referer is the visitor's: __proto__ returned Object.prototype, an
    // object rendered as a React child, which crashed the journey reader.
    for (const pkg of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const label = sourceLabel(`android-app://${pkg}/`)
      expect(typeof label).toBe('string')
      expect(label).toBe(`App ${pkg}`)
    }
    expect(sourceLabel('android-app://Constructor/')).toBe('App Constructor')
  })
})

describe('liveThumbnail', () => {
  const now = new Date('2026-11-17T22:00:00Z')
  it('drops Meta CDN links whose signature expired (oe = hex unix time)', () => {
    expect(liveThumbnail('https://scontent.xx.fbcdn.net/v/a.jpg?_nc_cat=1&oe=6AD5C8E3', now)).toBeNull() // 19 out
    const live = 'https://scontent.xx.fbcdn.net/v/a.jpg?_nc_cat=1&oe=6B02A01F' // 22 nov
    expect(liveThumbnail(live, now)).toBe(live)
    expect(liveThumbnail('https://example.com/x.jpg', now)).toBe('https://example.com/x.jpg')
    expect(liveThumbnail(null, now)).toBeNull()
    expect(liveThumbnail('not a url', now)).toBeNull()
  })
})

describe('small formats', () => {
  it('shows fractional orders only under the split model', () => {
    expect(formatOrders(17)).toBe('17')
    expect(formatOrders(2.5)).toBe('2,5')
    expect(formatOrders(1.333333)).toBe('1,3')
    expect(formatOrders(1.96)).toBe('2')
    expect(ordersLabel(1)).toBe('1 pedido')
    expect(ordersLabel(0.96)).toBe('1 pedido')
    expect(ordersLabel(2.5)).toBe('2,5 pedidos')
    expect(ordersLabel(0)).toBe('0 pedidos')
  })
  it('keeps the path of a landing page', () => {
    expect(landingPath('https://mokoo.co/products/capy-chef?utm_source=fb')).toBe('/products/capy-chef')
    expect(landingPath('https://mokoo.co/')).toBe('/')
    expect(landingPath('https://mokoo.co/products/mokoo%E2%84%A2-sea-friends-blind-box')).toBe('/products/mokoo™-sea-friends-blind-box')
    expect(landingPath('https://mokoo.co/products/bad%E0%A4%A')).toBe('/products/bad%E0%A4%A')
    expect(landingPath(null)).toBeNull()
  })
})

describe('the store ROAS tile', () => {
  it('uses the Resumo\'s ad channel: Dumpling 8jcp3a is judged on its Shopify ads, not 319× on $16 of Meta', () => {
    const t = { revenue: 5334.12, contribution: 3653.5, metaSpend: 16.71, shopSpend: 1796, breakEvenRoas: 1.46 }
    const ch = adChannelOf(t)
    expect(ch).toBe('shop')
    expect(channelRoas(t)).toBeCloseTo(5334.12 / 1796, 6)
    expect(storeRoasLabel(ch)).toBe('ROAS da loja · Anúncios Shopify')
    expect(leftOutSpend(t, ch)).toBe('$16,71 de Meta ficam fora deste ROAS e entram no lucro.')
  })

  it('keeps "ROAS da loja" for Meta alone and names a minor Shopify spend', () => {
    const t = { revenue: 11057.83, contribution: 7313.25, metaSpend: 5925.22, shopSpend: 193.66, breakEvenRoas: 1.51 }
    const ch = adChannelOf(t)
    expect(ch).toBe('meta')
    expect(storeRoasLabel(ch)).toBe('ROAS da loja')
    expect(channelRoas(t)).toBeCloseTo(11057.83 / 5925.22, 6)
    expect(leftOutSpend(t, ch)).toBe('$194 de Anúncios Shopify ficam fora deste ROAS e entram no lucro.')
    expect(storeRoasLabel('both')).toBe('ROAS da loja · Meta + Shopify')
    expect(leftOutSpend({ metaSpend: 900, shopSpend: 300 }, 'both')).toBeNull()
  })
})

describe('modelFromParam with keys of Object.prototype', () => {
  it('falls back to the default model for anything that is not its own key', () => {
    for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__defineGetter__']) {
      expect(modelFromParam(k)).toBe('first')
    }
    expect(modelFromParam(' Ultimo ')).toBe('last')
  })
})

describe('adSpendState', () => {
  const ad = (over: Partial<{ adId: string; adStoreId: string | null; spend: number; orders: number; siblingOrders: number }>) =>
    ({ adId: '1', adStoreId: 'epoch', spend: 0, orders: 0, siblingOrders: 0, ...over })

  it('labels every ad with no spend and sales in the window the same way, here or in the sibling store', () => {
    // EPOCH 28 out – 3 nov, dividido: "Novo anúncio de Vendas — Cópia — Cópia"
    // ($0, 1 pedido na CAMP HALLOW) read "$0" next to its sibling ad's
    // "sem gasto no período".
    expect(adSpendState(ad({ orders: 1 }))).toBe('none')
    expect(adSpendState(ad({ siblingOrders: 1 }))).toBe('none')
    expect(adSpendState(ad({ siblingOrders: 0.5 }))).toBe('none')
  })

  it('keeps unknown spend apart from zero, and a real amount as an amount', () => {
    expect(adSpendState(ad({ adStoreId: null, orders: 1 }))).toBe('unknown')
    expect(adSpendState(ad({ adId: 'outros', adStoreId: null, spend: 12 }))).toBe('amount')
    expect(adSpendState(ad({ spend: 40, orders: 1 }))).toBe('amount')
    expect(adSpendState(ad({}))).toBe('amount')
  })
})
