/** Date-range presets shared by the mobile routes. */

export type Period =
  | 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'mtd' | 'lastmonth' | 'custom'

export const PERIODS: { key: Period; label: string }[] = [
  { key: 'today',     label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d',        label: '7 dias' },
  { key: '30d',       label: '30 dias' },
  { key: 'mtd',       label: 'Este mês' },
  { key: 'lastmonth', label: 'Mês passado' },
  { key: '90d',       label: '90 dias' },
  { key: 'custom',    label: 'Escolher' },
]

/** YYYY-MM-DD for "now" in an IANA timezone. */
export function todayInTz(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz })
}

/** Shift a YYYY-MM-DD string by N days without DST drift. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Resolve a preset to absolute dates.
 *
 * The same absolute window is then applied to every store. Resolving per-store
 * instead would make the totals a sum over different windows and the daily
 * chart incoherent, since each store keeps its own timezone — so the reference
 * timezone anchors the range and each store is measured against it.
 */
export function resolveRange(
  period: Period,
  tz: string,
  from?: string | null,
  to?: string | null,
): { from: string; to: string } {
  if (period === 'custom' && from && to) {
    // Guard against a reversed range from the two date inputs.
    return from <= to ? { from, to } : { from: to, to: from }
  }

  const today = todayInTz(tz)
  const [y, m] = today.split('-').map(Number)

  switch (period) {
    case 'yesterday': {
      const d = shiftDate(today, -1)
      return { from: d, to: d }
    }
    case '7d':  return { from: shiftDate(today, -6),  to: today }
    case '30d': return { from: shiftDate(today, -29), to: today }
    case '90d': return { from: shiftDate(today, -89), to: today }
    case 'mtd': return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: today }
    case 'lastmonth': return {
      from: iso(new Date(Date.UTC(y, m - 2, 1))),
      to:   iso(new Date(Date.UTC(y, m - 1, 0))), // day 0 = last day of prev month
    }
    case 'today':
    default: return { from: today, to: today }
  }
}

/** Timezone the ranges are anchored to when aggregating across stores. */
export const REFERENCE_TZ = 'America/Sao_Paulo'
