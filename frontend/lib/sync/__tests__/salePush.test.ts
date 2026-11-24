import { describe, expect, it } from 'vitest'
import { formatLocalCurrency, saleAmount, saleItemsLabel, salePushText, type SaleLine } from '../salePush'
import { feedLine } from '@/app/m/_lib/labels'

// The sale push sits right above the phone's live feed: same pt-BR numbers,
// true minus sign, no "K", no English decimals.

const base = {
  storeName: 'MOKOO', orderLabel: '#4521', total: 45.9, currency: 'USD', usdTotal: null,
  profitToday: 966.2, lineItems: [{ title: 'Happy Capy', quantity: 1 }], country: 'US',
}

describe('sale push text', () => {
  it('a dollar sale: cents below $100, profit in whole dollars', () => {
    expect(salePushText(base)).toEqual({
      title: '💰 $45,90 · #4521 — MOKOO',
      body: 'Lucro hoje: $966 · Happy Capy · US',
    })
  })

  it('large amounts use a thousands dot, never "K"; a loss has a true minus', () => {
    const t = salePushText({ ...base, total: 1234.5, profitToday: -12900.4 })
    expect(t.title).toBe('💰 $1.235 · #4521 — MOKOO')
    expect(t.body).toBe('Lucro hoje: −\u2060$12.900 · Happy Capy · US')
    expect(`${t.title} ${t.body}`).not.toMatch(/\d\.\d{1,2}(?!\d)|-\$|K\b/)
  })

  it('a yen sale: dollars first, the yen amount after, both pt-BR', () => {
    const t = salePushText({ ...base, storeName: 'Hibikura', total: 12750, currency: 'JPY', usdTotal: 82.88 })
    expect(t.title).toMatch(/^💰 \$82,88 \(JP¥\s12\.750\) · #4521 — Hibikura$/)
  })

  it('no exchange rate: the local amount alone', () => {
    expect(saleAmount(12750, 'JPY', null)).toMatch(/^JP¥\s12\.750$/)
    expect(formatLocalCurrency(1234, 'XX1')).toBe('XX1 1.234')
  })

  it('no profit line when the store has no cost settings, no empty country', () => {
    expect(salePushText({ ...base, profitToday: null, country: null }).body).toBe('Happy Capy')
  })

  it('items: the first product with its own quantity, then other products and units', () => {
    // #5316: 1 gift + 6 blind boxes read "7× Happy Capy Blind Box – Free Gift +1".
    expect(salePushText({
      ...base, profitToday: 310,
      lineItems: [
        { title: 'Happy Capy Blind Box – Free Gift', quantity: 1 },
        { title: 'Mokoo™ | CapyCup Limited Edition Blind Box', quantity: 6 },
      ],
    }).body).toBe('Lucro hoje: $310 · Happy Capy Blind Box – Free Gift +1 produto · 7 unidades · US')
    expect(saleItemsLabel([{ title: 'Happy Capy', quantity: 2 }, { title: 'CapyCup', quantity: '1' }]))
      .toBe('2× Happy Capy +1 produto · 3 unidades')
    expect(saleItemsLabel([{ title: 'Glitter Highland Cow Squishy', quantity: 2 }])).toBe('2× Glitter Highland Cow Squishy')
    expect(saleItemsLabel(['a', 'b', 'c'].map(title => ({ title, quantity: 1 })))).toBe('a +2 produtos · 3 unidades')
    expect(saleItemsLabel([{ title: 'a', quantity: 1200 }, { title: 'b', quantity: 1 }])).toBe('1.200× a +1 produto · 1.201 unidades')
  })

  it('items: unknown quantities are not summed, a missing title is named, no lines say nothing', () => {
    expect(saleItemsLabel([{ title: 'a' }, { title: 'b', quantity: 2 }])).toBe('a +1 produto')
    expect(saleItemsLabel([{ title: 'a', quantity: 'x' }, { title: 'b', quantity: 2 }])).toBe('a +1 produto')
    expect(saleItemsLabel([{ quantity: 1 }])).toBe('Produto sem nome')
    expect(saleItemsLabel([])).toBe('')
    expect(salePushText({ ...base, lineItems: [] }).body).toBe('Lucro hoje: $966 · US')
  })

  // The push sits right above the live feed, which tells the same order with
  // feedLine; the two must not drift apart again.
  it('items read exactly like the live feed line', () => {
    const orders: SaleLine[][] = [
      [{ title: 'Happy Capy Blind Box – Free Gift', quantity: 1 }, { title: 'Mokoo™ | CapyCup Limited Edition Blind Box', quantity: 6 }],
      [{ title: 'HIBACHI ZERO remote', quantity: 2 }, { title: 'ceramic heater', quantity: 2 }],
      ['a', 'b', 'c', 'd', 'e'].map(title => ({ title, quantity: 1 })),
      [{ title: 'Glitter Highland Cow Squishy', quantity: 2 }],
      [{ title: '  Capy  ', quantity: 1 }],
      [{ title: 'a', quantity: null }, { title: 'b', quantity: 2 }],
      [{ title: null, quantity: '3' }, { title: 'b', quantity: '1' }],
    ]
    for (const lines of orders) {
      // What the feed reads back from live_orders (lib/views/portfolio lineItems).
      const stored = lines.map(l => ({
        title: l.title == null ? null : String(l.title),
        quantity: l.quantity == null ? null : Number(l.quantity),
        price: null,
      }))
      const f = feedLine(stored)
      expect(saleItemsLabel(lines)).toBe([f.more ? `${f.name} ${f.more}` : f.name, f.units].filter(Boolean).join(' · '))
    }
  })
})
