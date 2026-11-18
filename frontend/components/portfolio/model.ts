/**
 * Pure helpers behind "Todas as lojas" (/overview): what one store row says.
 * No database, no React — tested in __tests__/model.test.ts.
 *
 *   rowResult(row)          the money a row shows: real profit, revenue − ads
 *                           (no cost settings) or nothing (no sales, no spend)
 *   adChannels(totals, cfg) ROAS against the store's own break-even, per ad
 *                           channel that spent (Meta, Shopify)
 *   sharedAccountBadges     "anúncios na conta da EPOCH" / "paga anúncios da
 *                           CAMP HALLOW" from the shared-account pairs
 *   freshnessCell(f, now)   the "atualizado há 4 min" cell, with the same
 *                           thresholds as the top bar (lib/sync/plan)
 *   trailRange(range)       the days behind each row's sparkline
 *   idleReasons(idle, rng)  why an idle store is out of the total (its day
 *                           has not begun, it had not sold yet, or quiet)
 *   storeDayOf(at, tz)      a database instant on the store's own calendar
 */

import type { PnL } from '@/lib/engine/pnl'
import { daysBetween, shiftDate, todayInTz, type DateRange } from '@/lib/engine/dates'
import type { SharedAdAccount } from '@/lib/attributionModels'
import { formatDate, formatRelativeTime, plural } from '@/lib/format'
import { adChannelOf, channelRoas, type AdChannel } from '@/lib/views/store'
import { isIdle, judgedStores } from '@/lib/views/verdict'

// ─── The money of a row ──────────────────────────────────────────────────────

export interface RowResult {
  /** profit: engine operatingProfit; revenue_minus_ads: no cost settings;
   *  none: no orders and no ad spend (never a fake $0). */
  kind: 'profit' | 'revenue_minus_ads' | 'none'
  /** NOT halved: halve at render with ctx.part. Null when kind is none. */
  value: number | null
}

export function rowResult(row: { configured: boolean; totals: PnL }): RowResult {
  const t = row.totals
  if (t.orders === 0 && t.revenue <= 0 && t.adSpend <= 0) return { kind: 'none', value: null }
  if (!row.configured) return { kind: 'revenue_minus_ads', value: t.revenue - t.adSpend }
  return { kind: 'profit', value: t.operatingProfit }
}

export interface CashHit {
  /** "2 chargebacks", "1 reembolso e 2 chargebacks"; null when no count came
   *  with the money (then the cell says "reembolsos e chargebacks"). */
  what: string | null
  /** Negative: what left the cash (refunded margin + chargebacks + fees).
   *  NOT halved: halve at render with ctx.part. */
  amount: number
}

/**
 * Money that left a row with no sale: refunds and chargebacks of older orders
 * arrive whether or not the store sold in the window (CAMP HALLOW, 11–17 nov:
 * 0 orders, 0 spend, 2 chargebacks, −$342,63). The row read only "— sem
 * vendas" while the page's ledger and total counted the hit; the Resumo's
 * verdict says "Mas chegaram 2 chargebacks: −$343 no caixa" (lib/views/verdict,
 * same noSales rule), and the row now says the same thing.
 */
export function noSalesCashHit(t: Pick<PnL, 'orders' | 'revenue' | 'adjustments' | 'refundCount' | 'chargebackCount'>): CashHit | null {
  if (t.orders > 0 || t.revenue > 0 || !(t.adjustments >= 0.005)) return null
  const what = [
    t.refundCount > 0 ? plural(t.refundCount, 'reembolso', 'reembolsos') : null,
    t.chargebackCount > 0 ? plural(t.chargebackCount, 'chargeback', 'chargebacks') : null,
  ].filter((x): x is string => x !== null)
  return { what: what.length ? what.join(' e ') : null, amount: -t.adjustments }
}

/**
 * Which stores the verdict's amount is made of, so the ledger subtitle and
 * the table's total row count the same stores as the verdict's "4 lojas na
 * soma": stores with costs (lib/views/verdict judgedStores) minus the ones
 * with nothing in the window (isIdle). On "Hoje" at 05h the ledger said "nas 6
 * lojas com custos" and the total "6 de 7 lojas" next to "4 lojas na soma".
 */
export function sumMembers<T extends { configured: boolean; totals: PnL }>(stores: readonly T[]): { summed: T[]; idle: T[]; excluded: T[] } {
  const { judged, excluded } = judgedStores(stores)
  const idle = stores.length > 1 ? judged.filter(s => isIdle(s.totals)) : []
  return { summed: judged.filter(s => !idle.includes(s)), idle, excluded }
}

/**
 * Why each idle store (sumMembers().idle) had nothing in the window, by the
 * verdict's rule (lib/views/verdict, the notes under "Todas"), so the total
 * row and the verdict above it say the same thing:
 *   notStarted  its own day has not begun yet (dayState not_started);
 *   notYet      its first sale came after the window ("Hibikura ainda não
 *               vendia no mês passado") — the total row called it "sem
 *               movimento", like a store that stopped selling;
 *   quiet       it existed and nothing happened.
 */
export function idleReasons<T extends { dayState: string; firstOrderDate: string | null }>(
  idle: readonly T[], range: DateRange,
): { notStarted: T[]; notYet: T[]; quiet: T[] } {
  const notStarted = idle.filter(s => s.dayState === 'not_started')
  const notYet = idle.filter(s => notSellingYet(s, range))
  return { notStarted, notYet, quiet: idle.filter(s => !notStarted.includes(s) && !notYet.includes(s)) }
}

/** The store's first sale came after the window (and its day has begun):
 *  the verdict's "ainda não vendia". */
export function notSellingYet(s: { dayState: string; firstOrderDate: string | null }, range: DateRange): boolean {
  return s.dayState !== 'not_started' && !!s.firstOrderDate && range.to < s.firstOrderDate
}

/** Sort value for the profit column: unconfigured and idle rows sort last,
 *  never mixed with real profit. */
export function resultSortValue(r: RowResult): number | null {
  return r.kind === 'profit' ? r.value : null
}

// ─── Ad channels ─────────────────────────────────────────────────────────────

export interface ChannelRoas {
  channel: AdChannel
  label: string
  spend: number
  /** Store revenue ÷ this spend. */
  roas: number | null
  /** The store's break-even (revenue ÷ contribution); null without costs. */
  breakEven: number | null
}

const SHORT: Record<AdChannel, string> = { meta: 'Meta', shop: 'Shopify', both: 'Anúncios' }

/**
 * The ROAS a row judges against the store's own break-even, on the same rule
 * as the Resumo (lib/views/store adChannelOf): the channel that carries the
 * spend, or Meta + Shopify together when both carry it — never revenue ÷ a
 * small Meta spend next to big Shopify ads (that read 109× for Dumpling).
 * A minor second channel is listed by spend only: it is in the profit.
 */
export function adChannels(t: PnL, configured: boolean): { gauge: ChannelRoas | null; spendOnly: ChannelRoas[] } {
  const ch = adChannelOf(t)
  if (!ch) return { gauge: null, spendOnly: [] }
  const be = configured ? t.breakEvenRoas : null
  const spend = ch === 'both' ? t.adSpend : ch === 'meta' ? t.metaSpend : t.shopSpend
  const gauge: ChannelRoas = { channel: ch, label: SHORT[ch], spend, roas: channelRoas(t), breakEven: be }
  const spendOnly: ChannelRoas[] = []
  if (ch === 'meta' && t.shopSpend > 0) spendOnly.push({ channel: 'shop', label: 'Shopify', spend: t.shopSpend, roas: null, breakEven: be })
  if (ch === 'shop' && t.metaSpend > 0) spendOnly.push({ channel: 'meta', label: 'Meta', spend: t.metaSpend, roas: null, breakEven: be })
  return { gauge, spendOnly }
}

// ─── Shared ad accounts ──────────────────────────────────────────────────────

export interface RowBadge {
  label: string
  detail: string
}

/**
 * Badges for a store that sells on ads billed to another store of the view
 * (CAMP HALLOW on EPOCH's old account), and for the store that pays them.
 * Built from journey data (lib/attribution getSharedAdAccounts), never from a
 * fixed list of names.
 */
export function sharedAccountBadges(storeId: string, pairs: SharedAdAccount[], lookbackLabel: string): RowBadge[] {
  const out: RowBadge[] = []
  for (const p of pairs) {
    if (p.salesStoreId === storeId) {
      out.push({
        label: `anúncios na conta da ${p.adStoreName}`,
        detail: `${lookbackLabel}, ${plural(p.orders, 'pedido', 'pedidos')} desta loja vieram de anúncios pagos na conta da ${p.adStoreName}: o gasto está nas contas de lá. Some as duas lojas para julgar o resultado.`,
      })
    } else if (p.adStoreId === storeId) {
      out.push({
        label: `paga anúncios da ${p.salesStoreName}`,
        detail: `${lookbackLabel}, anúncios pagos por esta loja trouxeram ${plural(p.orders, 'pedido', 'pedidos')} da ${p.salesStoreName}: parte do gasto daqui vendeu lá. Some as duas lojas para julgar o resultado.`,
      })
    }
  }
  return out
}

/** Orders of a 90-day pair inside the page's window (data loadSharedInWindow):
 *  0 when the window is not mixed, null when the window read failed. */
export function pairOrdersIn(
  inWindow: readonly Pick<SharedAdAccount, 'adStoreId' | 'salesStoreId' | 'orders'>[] | null,
  p: Pick<SharedAdAccount, 'adStoreId' | 'salesStoreId'>,
): number | null {
  if (inWindow === null) return null
  return inWindow.find(w => w.adStoreId === p.adStoreId && w.salesStoreId === p.salesStoreId)?.orders ?? 0
}

/** The 90-day pairs whose stores are mixed in THIS window (or may be: the
 *  window read failed). The rest is history, not a reason to doubt the
 *  window's numbers. */
export function pairsMixedIn<T extends Pick<SharedAdAccount, 'adStoreId' | 'salesStoreId'>>(
  pairs: readonly T[], inWindow: readonly Pick<SharedAdAccount, 'adStoreId' | 'salesStoreId' | 'orders'>[] | null,
): T[] {
  return pairs.filter(p => pairOrdersIn(inWindow, p) !== 0)
}

// ─── Freshness ───────────────────────────────────────────────────────────────

export type FreshState = 'ok' | 'stale' | 'failing' | 'unknown'

/** A lane as lib/sync/status getFreshness returns it (the fields used here). */
export interface LaneLike {
  lastSuccessAt: string | null
  lastStatus: 'running' | 'success' | 'partial' | 'error' | null
  staleness: 'ok' | 'amber' | 'red' | 'unknown'
}

export interface FreshnessCell {
  state: FreshState
  /** "há 4 min" (the OLDEST source: a number is as fresh as its oldest input). */
  label: string
  /** "pedidos há 3 min · Meta há 28 min (última tentativa falhou)". */
  detail: string
}

const RANK: Record<FreshState, number> = { ok: 0, unknown: 1, stale: 2, failing: 3 }

/** Same mapping as the top bar's Freshness (components/shell/Freshness). */
export function laneState(l: LaneLike | null): FreshState | null {
  if (!l) return null
  if (l.staleness === 'unknown') return 'unknown'
  if (l.staleness === 'red' && (l.lastStatus === 'error' || l.lastStatus === 'partial')) return 'failing'
  return l.staleness === 'ok' ? 'ok' : 'stale'
}

export function freshnessCell(f: { shopify: LaneLike | null; facebook: LaneLike | null } | null | undefined, now: Date): FreshnessCell {
  if (!f) return { state: 'unknown', label: 'desconhecido', detail: 'Sem informação de sincronização para esta loja.' }
  const lanes: [string, LaneLike | null][] = [['pedidos', f.shopify], ['Meta', f.facebook]]
  const states = lanes.map(([, l]) => laneState(l)).filter((x): x is FreshState => !!x)
  const state = states.reduce<FreshState>((w, x) => (RANK[x] > RANK[w] ? x : w), states.length ? 'ok' : 'unknown')
  const present = lanes.filter((x): x is [string, LaneLike] => !!x[1])
  const missing = present.some(([, l]) => !l.lastSuccessAt)
  const oldest = present.map(([, l]) => l.lastSuccessAt).filter((x): x is string => !!x).sort()[0] ?? null
  const label = !present.length ? 'sem sincronização' : missing ? 'nunca' : formatRelativeTime(oldest, now)
  const detail = present.length
    ? present.map(([n, l]) => `${n} ${l.lastSuccessAt ? formatRelativeTime(l.lastSuccessAt, now) : 'nunca'}${l.lastStatus === 'error' ? ' (última tentativa falhou)' : ''}`).join(' · ')
    : 'Nenhuma fonte sincronizada para esta loja.'
  return { state, label, detail }
}

/**
 * The date of a store's last order on the store's own calendar. lastOrderAt
 * is an instant; slicing its ISO string gave the UTC date, so at 00h02 in
 * Brasília a row with no sale "today" read "sem vendas · última 18 nov" for an
 * order placed at 23h50 on the 17th.
 */
export function lastSaleDate(lastOrderAt: string | null | undefined, timezone: string): string | null {
  return storeDayOf(lastOrderAt, timezone)
}

/**
 * The store's own calendar day of an instant from the database (null when
 * missing or unparseable) — the rule of Ajustes → Lojas (components/settings
 * storeDay), so both screens name the same day. "Lojas arquivadas" sliced the
 * ISO string: a store archived at 22h on 10 nov in São Paulo (01h UTC on the
 * 11th) read "arquivada em 11 nov" here and "10 nov" in Ajustes.
 */
export function storeDayOf(at: string | null | undefined, timezone: string): string | null {
  if (!at) return null
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? null : todayInTz(timezone, d)
}

// ─── A store that stopped selling ────────────────────────────────────────────

/** Fewer quiet days than this is an ordinary slow day, not news. */
export const QUIET_AFTER_DAYS = 2

export interface QuietInput {
  range: DateRange
  /** The store's today. */
  today: string
  /** Last kept order and last day with ad spend, on the store's calendar. */
  lastSaleDate: string | null
  lastAdDate: string | null
  /** State of the store's order and Meta reading (laneState), null when absent. */
  ordersLane: FreshState | null
  metaLane: FreshState | null
}

export interface QuietNote {
  /** warn when the order reading itself is late: the silence may be ours. */
  tone: 'info' | 'warn'
  title: string
  lines: string[]
}

/**
 * What to say when a store has stopped selling (Glooty: last order 10 nov,
 * ads off after 15 nov). Days without orders read like a broken sync unless
 * the page says when the last sale was and whether the order reading is
 * current — on a window with no orders, and on a longer one whose sales
 * stopped before its end (Glooty's 30 days: 14 orders, none after 10 nov).
 * Only about the present (the window reaches yesterday or today) and only
 * after QUIET_AFTER_DAYS without a sale.
 */
export function quietNote(i: QuietInput): QuietNote | null {
  if (!i.lastSaleDate || i.range.to < shiftDate(i.today, -1)) return null
  const days = daysBetween(i.lastSaleDate, i.today) - 1
  if (days < QUIET_AFTER_DAYS) return null
  const lines: string[] = []
  const late = i.ordersLane === 'stale' || i.ordersLane === 'failing'
  if (i.ordersLane === 'ok') lines.push('Os pedidos da Shopify estão sendo lidos normalmente: a loja não recebeu pedidos desde então. Não é falha de sincronização.')
  else if (late) lines.push('A leitura dos pedidos da Shopify está atrasada: pode haver vendas que ainda não chegaram aqui.')
  if (i.lastAdDate) {
    const last = formatDate(i.lastAdDate, i.today)
    if (i.lastAdDate >= shiftDate(i.today, -1)) lines.push(`Os anúncios continuam gastando (último gasto em ${last}) sem trazer pedidos.`)
    else if (i.metaLane === 'ok') lines.push(`Anúncios parados: o último gasto foi em ${last}.`)
    else lines.push(`O último gasto em anúncios registrado foi em ${last}.`)
  }
  return {
    tone: late ? 'warn' : 'info',
    title: `Última venda em ${formatDate(i.lastSaleDate, i.today)}, há ${plural(days, 'dia', 'dias')}`,
    lines,
  }
}

// ─── The row's link ──────────────────────────────────────────────────────────

/**
 * How a row's link to that store's Resumo keeps the period (overrides for
 * ctx.hrefWith). A store whose calendar is not Brasília's right now (Hibikura
 * from noon to midnight) is read on the overview on the same dates as the
 * others; the same `periodo` on its own Resumo resolves on Tokyo's clock and
 * lands a day later (the "Hoje" row showed the closed 17 nov at $589, the
 * click opened 18 nov at $281). Such a row opens on its exact dates instead,
 * so the number clicked is the number shown. Same calendar, or a custom
 * window (already explicit dates): the period travels as it is.
 */
export function resumoLinkOverrides(
  row: { id: string; storeToday: string },
  page: { today: string; period: string; range: DateRange },
): { loja: string; periodo?: 'custom'; de?: string; ate?: string } {
  if (row.storeToday === page.today || page.period === 'custom') return { loja: row.id }
  return { loja: row.id, periodo: 'custom', de: page.range.from, ate: page.range.to }
}

// ─── Sparkline window ────────────────────────────────────────────────────────

export const TRAIL_MIN_DAYS = 30
export const TRAIL_MAX_DAYS = 92

/** The days behind a row's sparkline: at least 30, ending with the window,
 *  covering the whole window when it is longer (capped at 92). */
export function trailRange(range: DateRange): DateRange {
  const n = Math.min(TRAIL_MAX_DAYS, Math.max(TRAIL_MIN_DAYS, daysBetween(range.from, range.to)))
  return { from: shiftDate(range.to, -(n - 1)), to: range.to }
}
