/**
 * The "Quem mais contribuiu" bars of Produtos: the biggest products, and one
 * line for the rest. Pure, tested in __tests__/topBars.test.ts.
 */

import { formatCount, formatMoney } from '@/lib/format'

/** Bars shown before the rest folds into one line. */
export const TOP_BARS = 8

/**
 * The products drawn as bars: the first TOP_BARS, or all of them when only
 * one more would be left — a bar of its own says more than "O outro produto
 * soma $9,83". `ranked` is already sorted, biggest first.
 */
export function topBars<T>(ranked: readonly T[], n = TOP_BARS): T[] {
  return ranked.length === n + 1 ? [...ranked] : ranked.slice(0, n)
}

/**
 * The products of stores without costs, which are in the table but not in
 * the bars nor in the rest line's amount (they have no contribution): named
 * apart so the rest line's count matches its amount.
 */
export function unpricedLine(count: number, stores: readonly string[]): string | null {
  if (count <= 0) return null
  const what = count === 1 ? '1 produto' : `${formatCount(count)} produtos`
  const whose = stores.length ? ` ${stores.map(s => `da ${s}`).join(' e ')}` : ''
  return `Fora das barras: ${what}${whose}, sem custos configurados.`
}

/** The line under the bars for the products not drawn; null when none. */
export function restLine(count: number, amount: number): string | null {
  if (count <= 0) return null
  return count === 1
    ? `O outro produto soma ${formatMoney(amount)}.`
    : `Os outros ${formatCount(count)} produtos somam ${formatMoney(amount)}.`
}
