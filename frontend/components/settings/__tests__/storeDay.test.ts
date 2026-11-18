import { describe, expect, it } from 'vitest'
import { formatDate } from '@/lib/format'
import { storeDay } from '../storeDay'

describe('storeDay', () => {
  it('takes the store’s calendar day, not the UTC date', () => {
    // 22h30 in São Paulo on 10 nov is already 11 nov in UTC.
    expect(storeDay('2026-11-11T01:30:00.000Z', 'America/Sao_Paulo')).toBe('2026-11-10')
    // 8h in Tokyo on 11 nov is still 10 nov in UTC.
    expect(storeDay('2026-11-10T23:00:00.000Z', 'Asia/Tokyo')).toBe('2026-11-11')
    // Midday: every timezone agrees.
    expect(storeDay('2026-11-10T12:02:25.443Z', 'America/Sao_Paulo')).toBe('2026-11-10')
  })

  it('reads as the app’s short date ("arquivada em 10 nov"), with the year only when it differs', () => {
    expect(formatDate(storeDay('2026-11-11T01:30:00.000Z', 'America/Sao_Paulo'), '2026-11-18')).toBe('10 nov')
    expect(formatDate(storeDay('2026-01-01T02:00:00.000Z', 'America/Sao_Paulo'), '2026-11-18')).toBe('31 dez 2025')
  })

  it('falls back to UTC for an unknown timezone instead of throwing', () => {
    expect(storeDay('2026-11-11T01:30:00.000Z', 'Not/AZone')).toBe('2026-11-11')
  })
})
