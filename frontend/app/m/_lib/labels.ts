/**
 * Words for small things on the phone: a live-feed order line, an alert row.
 * Pure — the components render them and the tests pin them.
 */

import type { LiveOrderItem } from '@/lib/views/portfolio'
import { shiftDate, todayInTz } from '@/lib/engine/dates'
import { formatDate, formatTimeInTz } from '@/lib/format'

export interface FeedLine {
  /** First product with ITS OWN quantity: "2× HIBACHI ZERO 専用リモコン". May be cut. */
  name: string
  /** "+1 produto": never inside the cut part, so a mixed order reads as one. */
  more: string | null
  /** "7 unidades", only for orders of several products (one product already
   *  says its quantity); null when a quantity is unknown. */
  units: string | null
}

/**
 * One order in "Vendas ao vivo". The order's unit total used to sit in front
 * of the first product ("7× Happy Capy Blind Box +1" for 1 gift + 6 blind
 * boxes), and the "+1" fell inside the ellipsis at 390 px.
 */
export function feedLine(items: LiveOrderItem['items']): FeedLine {
  const first = items[0]
  if (!first) return { name: 'Pedido', more: null, units: null }
  const q = first.quantity ?? 1
  const name = `${q > 1 ? `${q}× ` : ''}${first.title?.trim() || 'Produto sem nome'}`
  const others = items.length - 1
  if (others <= 0) return { name, more: null, units: null }
  const known = items.every(i => i.quantity !== null && Number.isFinite(i.quantity))
  const total = known ? items.reduce((s, i) => s + (i.quantity ?? 0), 0) : null
  return {
    name,
    more: `+${others} ${others === 1 ? 'produto' : 'produtos'}`,
    units: total !== null ? `${total} ${total === 1 ? 'unidade' : 'unidades'}` : null,
  }
}

/** Alert kinds recorded by lib/alerts (alert_events.kind). */
const ALERT_KIND_LABEL: Record<string, string> = {
  roas_drop: 'ROAS abaixo do empate',
  spend_no_sales: 'Gasto sem vendas',
  margin_drop: 'Margem baixa',
  spend_spike: 'Gasto acima da média',
  daily_summary: 'Resumo do dia',
  scale_up: 'Campanha para escalar',
  scale_cut: 'Campanha para cortar',
}

/**
 * The row's own title when it was saved with one, its numbers in pt-BR; else
 * the kind in Portuguese; never the raw code ("scale_up"). Titles are stored
 * as they were pushed: rows written before lib/alerts formatted with
 * lib/format read "⚠️ ROAS 0.62× — EPOCH ®️" and "Margem -82%", and
 * production keeps writing them until the next deploy.
 */
export function alertRowTitle(kind: string, title: string | null): string {
  const t = title?.trim()
  return t ? ptNumbers(t) : ALERT_KIND_LABEL[kind] || 'Alerta'
}

/**
 * Rewrites English number formats in a stored text the pt-BR way (lib/format):
 * "$1,234.50" → "$1.234,50", "$9.80" → "$9,80", "0.62×" → "0,62×",
 * "12.5%" → "12,5%", "-82%" / "-$40" → "−82%" / "−$40". Text already in
 * pt-BR passes unchanged ("$1.234" keeps its thousands dot, "0,62×" its comma).
 */
export function ptNumbers(text: string): string {
  return text
    // Money with en-US thousands commas, optional decimals.
    .replace(/\$(\d{1,3}(?:,\d{3})+)(?:\.(\d+))?(?!\d)/g, (_m, int: string, dec?: string) => `$${int.replace(/,/g, '.')}${dec ? `,${dec}` : ''}`)
    // Money with en-US cents and no thousands ("$9.80"); a pt "$1.234" has
    // three digits after its dot and is left alone.
    .replace(/\$(\d+)\.(\d{1,2})(?!\d)/g, (_m, int: string, dec: string) => `$${int},${dec}`)
    // Decimal point before a ratio or a percentage.
    .replace(/(\d)\.(\d+)(?=\s*(?:×|x(?![a-z])|%|pp))/gi, '$1,$2')
    // Hyphen-minus in front of a number: the true minus sign.
    .replace(/(^|[\s(:])-(?=\$?\d)/g, '$1−')
}

/**
 * "até 22 nov, 01h00" — a dispute's evidence deadline as an instant on `tz`
 * (the owner's phone), with the hour: Postgres sends "2026-11-22 04:00:00+00",
 * and cutting its first 10 characters gave the UTC date, a day late whenever
 * the deadline falls between 00h and 03h UTC (21h–24h in Brasília the day
 * before) — exactly the deadline an "até" line must not overstate. "hoje" and
 * "amanhã" when they apply. Null when the value does not parse.
 */
export function dueByLabel(dueBy: string, tz: string, now: Date = new Date()): string | null {
  const iso = dueBy.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const day = todayInTz(tz, at)
  const today = todayInTz(tz, now)
  const when = day === today ? 'hoje' : day === shiftDate(today, 1) ? `amanhã (${formatDate(day, today)})` : formatDate(day, today)
  return `até ${when}, ${formatTimeInTz(at, tz)}`
}
