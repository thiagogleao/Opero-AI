import { describe, expect, it } from 'vitest'
import { adGap, conversionDelay, formatLocalStamp, formatOrders, landingPath, liveThumbnail, modelFromParam, modelParam, ordersLabel, sourceLabel } from '../model'

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
