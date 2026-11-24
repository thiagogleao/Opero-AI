/**
 * A share of each dollar sold, as the "Para onde foi cada dólar" ledger and
 * bar print it. Pure, safe in the browser.
 *
 *   formatPerDollar(40)    "40¢"
 *   formatPerDollar(-12)   "−12¢"
 *   formatPerDollar(262)   "$2,62"      (ads above sales: Glooty without costs)
 *   formatPerDollar(-162)  "−$1,62"
 *
 * Up to a dollar the share reads in cents; from a dollar on it reads in dollars,
 * as the KPI next to it does ("$2,62 para cada $1 vendido"): "262¢ de cada
 * dólar" reads like a typo. The ledger's column already has "$1,00" on the
 * Vendas line, so "$2,62" under it reads "per dollar sold".
 */

import { formatCents, formatMoney } from '@/lib/format'

export function formatPerDollar(cents: number): string {
  if (!Number.isFinite(cents)) return '—'
  const r = Math.round(cents)
  if (Math.abs(r) < 100) return formatCents(r)
  // Signed by formatMoney itself, so the sign stays glued to the "$".
  return formatMoney(r / 100, { cents: 'always' })
}

/** "$2,62 para cada $1 vendido" / "40¢ de cada $1 vendido" — for a tooltip or a screen reader. */
export function perDollarPhrase(cents: number): string {
  const r = Math.round(cents)
  return Math.abs(r) < 100 ? `${formatCents(r)} de cada $1 vendido` : `${formatPerDollar(r)} para cada $1 vendido`
}
