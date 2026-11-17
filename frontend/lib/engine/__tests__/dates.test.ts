import { describe, expect, it } from 'vitest'
import {
  anchorTz, comparisonRange, daysBetween, eachDay, formatRange, isIsoDate, minutesIntoDay,
  resolveRange, shiftDate, todayInTz,
} from '../dates'

// 2026-11-17 13:30 in São Paulo = 16:30 UTC = 2026-11-18 01:30 in Tokyo.
const NOW = new Date('2026-11-17T16:30:00Z')

describe('calendar helpers', () => {
  it('reads the date on each store clock', () => {
    expect(todayInTz('America/Sao_Paulo', NOW)).toBe('2026-11-17')
    expect(todayInTz('Asia/Tokyo', NOW)).toBe('2026-11-18')
    expect(minutesIntoDay('America/Sao_Paulo', NOW)).toBe(13 * 60 + 30)
  })
  it('shifts across month and year ends', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(daysBetween('2026-11-10', '2026-11-16')).toBe(7)
    expect(eachDay('2026-10-30', '2026-11-02')).toEqual(['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
  it('validates dates strictly', () => {
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('2026-11-17')).toBe(true)
    expect(isIsoDate("2026-11-17'; drop")).toBe(false)
  })
})

describe('resolveRange', () => {
  const tz = 'America/Sao_Paulo'
  it('rolling windows are complete days ending yesterday', () => {
    expect(resolveRange('7d', tz, null, null, NOW)).toEqual({ from: '2026-11-10', to: '2026-11-16' })
    expect(resolveRange('30d', tz, null, null, NOW)).toEqual({ from: '2026-10-18', to: '2026-11-16' })
  })
  it('calendar windows', () => {
    expect(resolveRange('today', tz, null, null, NOW)).toEqual({ from: '2026-11-17', to: '2026-11-17' })
    expect(resolveRange('mtd', tz, null, null, NOW)).toEqual({ from: '2026-11-01', to: '2026-11-17' })
    expect(resolveRange('lastmonth', tz, null, null, NOW)).toEqual({ from: '2026-10-01', to: '2026-10-31' })
  })
  it('a single Tokyo store resolves on the Tokyo calendar', () => {
    expect(resolveRange('today', 'Asia/Tokyo', null, null, NOW)).toEqual({ from: '2026-11-18', to: '2026-11-18' })
  })
  it('custom ranges are ordered, validated and clamped to today', () => {
    expect(resolveRange('custom', tz, '2026-11-12', '2026-11-03', NOW)).toEqual({ from: '2026-11-03', to: '2026-11-12' })
    expect(resolveRange('custom', tz, '2026-11-12', '2027-01-01', NOW)).toEqual({ from: '2026-11-12', to: '2026-11-17' })
    expect(resolveRange('custom', tz, 'garbage', '2026-11-03', NOW)).toEqual({ from: '2026-11-17', to: '2026-11-17' })
  })
})

describe('comparisonRange', () => {
  const tz = 'America/Sao_Paulo'
  it('today compares with yesterday at the same time of day', () => {
    const c = comparisonRange('today', { from: '2026-11-17', to: '2026-11-17' }, tz, NOW)
    expect(c).toMatchObject({ from: '2026-11-16', to: '2026-11-16', sameTimeOfDay: true })
  })
  it('this month compares with the same days of last month, clamped to its length', () => {
    expect(comparisonRange('mtd', { from: '2026-11-01', to: '2026-11-17' }, tz, NOW))
      .toMatchObject({ from: '2026-10-01', to: '2026-10-17' })
    const march = new Date('2026-03-31T15:00:00Z')
    expect(comparisonRange('mtd', { from: '2026-03-01', to: '2026-03-31' }, tz, march))
      .toMatchObject({ from: '2026-02-01', to: '2026-02-28' })
  })
  it('last month compares with the month before', () => {
    expect(comparisonRange('lastmonth', { from: '2026-10-01', to: '2026-10-31' }, tz, NOW))
      .toMatchObject({ from: '2026-09-01', to: '2026-09-30' })
  })
  it('rolling windows compare with the window right before', () => {
    expect(comparisonRange('7d', { from: '2026-11-10', to: '2026-11-16' }, tz, NOW))
      .toMatchObject({ from: '2026-11-03', to: '2026-11-09', label: '7 dias anteriores' })
  })
})

describe('labels', () => {
  it('formats ranges compactly in Portuguese', () => {
    expect(formatRange({ from: '2026-11-17', to: '2026-11-17' }, '2026-11-17')).toBe('17 nov')
    expect(formatRange({ from: '2026-11-10', to: '2026-11-16' }, '2026-11-17')).toBe('10–16 nov')
    expect(formatRange({ from: '2026-10-28', to: '2026-11-03' }, '2026-11-17')).toBe('28 out – 3 nov')
  })
  it('anchors several stores to Brasília and one store to its own clock', () => {
    expect(anchorTz(['Asia/Tokyo'])).toBe('Asia/Tokyo')
    expect(anchorTz(['Asia/Tokyo', 'America/Belem'])).toBe('America/Sao_Paulo')
  })
})
