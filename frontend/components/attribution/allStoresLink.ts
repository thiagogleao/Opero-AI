import type { DateRange, Period } from '@/lib/engine/dates'

/**
 * The window a link from one store's page to "Todas as lojas" carries (pure).
 *
 * Todas resolves a period on its own clock (Brasília: anchorTz of several
 * stores); one store resolves it on the store's clock (Hibikura: Tokyo). The
 * same `periodo` can then name other days: Tokyo's "ontem" after noon in
 * Brasília is 18 nov, Brasília's is 17 nov. So when the period means other
 * dates over there, the exact dates travel, and the page opened shows the days
 * that were on screen. Left as they are:
 *  - a custom window: its dates already travel (hrefWith keeps de/ate);
 *  - a period that names the same dates on both clocks (any period on the
 *    same calendar, "Mês passado" mid-month): the picker keeps its name;
 *  - a window that runs past the other clock's today (Tokyo's "hoje", or
 *    "este mês" on Tokyo's 1st): those dates have not started over there, and
 *    the period name is the closest match.
 * parte is not touched: hrefWith keeps it.
 *
 * `all` is the same period resolved on the Todas clock (resolveRange) and
 * that clock's today.
 */
export function allStoresWindow(
  page: { period: Period; range: DateRange },
  all: { range: DateRange; today: string },
): { periodo?: 'custom'; de?: string; ate?: string } {
  if (page.period === 'custom') return {}
  if (all.range.from === page.range.from && all.range.to === page.range.to) return {}
  if (page.range.to > all.today) return {}
  return { periodo: 'custom', de: page.range.from, ate: page.range.to }
}
