import { describe, expect, it } from 'vitest'
import { BadRequest, parseWindow } from '../window'

// 13:30 in São Paulo on the 17th = 01:30 on the 18th in Tokyo.
const NOW = new Date('2026-11-17T16:30:00Z')
const sp = (q: string) => new URLSearchParams(q)

describe('parseWindow', () => {
  it('defaults to the last 7 closed days on the store clock', () => {
    expect(parseWindow(sp(''), 'America/Sao_Paulo', '7d', NOW).range).toEqual({ from: '2026-11-10', to: '2026-11-16' })
    expect(parseWindow(sp(''), 'Asia/Tokyo', '7d', NOW).range).toEqual({ from: '2026-11-11', to: '2026-11-17' })
  })
  it('reads presets and custom dates', () => {
    expect(parseWindow(sp('period=30d'), 'America/Sao_Paulo', '7d', NOW).range).toEqual({ from: '2026-10-18', to: '2026-11-16' })
    expect(parseWindow(sp('from=2026-10-01&to=2026-10-31'), 'America/Sao_Paulo', '7d', NOW))
      .toMatchObject({ period: 'custom', range: { from: '2026-10-01', to: '2026-10-31' } })
  })
  it('reads the old dateFrom/dateTo pair and never goes past the store\'s today', () => {
    expect(parseWindow(sp('dateFrom=2026-11-11&dateTo=2026-11-20'), 'America/Sao_Paulo', '7d', NOW).range)
      .toEqual({ from: '2026-11-11', to: '2026-11-17' })
  })
  it('rejects bad dates; an over-long window is cut and announced, never refused (lib/period R9)', () => {
    expect(() => parseWindow(sp('period=custom&from=2026-13-01&to=2026-11-01'), 'UTC', '7d', NOW)).toThrow(BadRequest)
    const long = parseWindow(sp('from=2024-01-01&to=2026-11-01'), 'UTC', '7d', NOW)
    expect(long.range).toEqual({ from: '2025-11-01', to: '2026-11-01' })
    expect(long.notes.map(n => n.code)).toEqual(['too_long'])
  })
})
