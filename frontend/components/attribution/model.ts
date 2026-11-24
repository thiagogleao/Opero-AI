/**
 * Pure helpers of the attribution screen: the ?modelo URL key, the one-line
 * explanation of each way of giving credit, the per-ad gap and the store-clock
 * date labels of the order reader. No database, safe in the browser.
 */

import type { CreativeAttribution, Model } from '@/lib/attributionModels'
import type { PnL } from '@/lib/engine/pnl'
import { liveSignedUrl } from '@/lib/data/metaCdn'
import { CHANNEL_LABEL, type AdChannel } from '@/lib/views/adChannel'
import { formatClock, formatDate, formatMoney, formatNumber } from '@/lib/format'

/** URL key of the credit model (Portuguese, like loja/periodo). */
export const MODEL_KEY = 'modelo'

const TO_PARAM: Record<Model, string> = { first: 'primeiro', last: 'ultimo', linear: 'dividido' }
// A Map, not an object literal: a URL value is a key here, and "constructor"
// or "__proto__" looked up on a plain object returned Object's own members —
// truthy, so they became the model and crashed the verdict (MODEL_TEXT had no
// entry for them).
const FROM_PARAM: ReadonlyMap<string, Model> = new Map<string, Model>([
  ['primeiro', 'first'], ['ultimo', 'last'], ['dividido', 'linear'],
  // The old page's values, so a bookmark from before still opens the same view.
  ['first', 'first'], ['last', 'last'], ['linear', 'linear'],
])

export const DEFAULT_MODEL: Model = 'first'

export function modelFromParam(v: string | string[] | undefined | null): Model {
  const raw = Array.isArray(v) ? v[0] : v
  return (typeof raw === 'string' ? FROM_PARAM.get(raw.trim().toLowerCase()) : undefined) ?? DEFAULT_MODEL
}

export function modelParam(m: Model): string {
  return TO_PARAM[m]
}

/**
 * How each side gives credit, one sentence each. Said on screen next to the
 * switch: the same order can belong to a different ad under each rule, and
 * Meta follows none of them.
 */
export const MODEL_TEXT: Record<Model, { label: string; by: string; sentence: string }> = {
  first: {
    label: 'Primeiro clique',
    by: 'pelo primeiro clique',
    sentence: 'O pedido inteiro vai para o primeiro anúncio em que a pessoa clicou no caminho até a compra: mostra quem traz o cliente.',
  },
  last: {
    label: 'Último clique',
    by: 'pelo último clique',
    sentence: 'O pedido inteiro vai para o último anúncio clicado antes da compra: mostra quem fecha a venda.',
  },
  linear: {
    label: 'Dividido',
    by: 'com o crédito dividido',
    sentence: 'O pedido é repartido em partes iguais entre os anúncios diferentes que a pessoa clicou, por isso aparecem frações de pedido.',
  },
}

export const META_RULE =
  'O Meta dá o crédito pela janela dele, pode contar até quem só viu o anúncio sem clicar e não desconta pedidos reembolsados.'

export const MODEL_ORDER: Model[] = ['first', 'last', 'linear']

/** "17" for whole orders, "2,5" under the linear model. */
export function formatOrders(n: number): string {
  const r = Math.round(n * 10) / 10
  return formatNumber(r, Number.isInteger(r) ? 0 : 1)
}

/** "1 pedido", "17 pedidos", "2,5 pedidos". */
export function ordersLabel(n: number): string {
  const s = formatOrders(n)
  return `${s} ${s === '1' ? 'pedido' : 'pedidos'}`
}

/**
 * Meta's claim for one ad against every journey sale credited to it (this
 * store and the stores sharing the account: Meta cannot tell them apart).
 */
export type AdGap =
  | { kind: 'pct'; pct: number }
  | { kind: 'only_meta' }
  | { kind: 'only_journey' }
  | { kind: 'none' }

export function adGap(c: Pick<CreativeAttribution, 'revenue' | 'siblingRevenue' | 'metaRevenue'>): AdGap {
  const journey = c.revenue + c.siblingRevenue
  if (journey > 0.005) return c.metaRevenue > 0.005 ? { kind: 'pct', pct: ((c.metaRevenue - journey) / journey) * 100 } : { kind: 'only_journey' }
  return c.metaRevenue > 0.005 ? { kind: 'only_meta' } : { kind: 'none' }
}

/**
 * What the Gasto cell of an ad says:
 *   unknown  no connected account reports the ad: its spend is unknown, not zero
 *   none     no spend in the window but sales in it, here OR in the sibling
 *            store's column ("sem gasto no período"); an ad whose only sale
 *            landed in CAMP HALLOW read "$0" next to one labelled in words
 *   amount   the spend itself
 */
export type AdSpendState = 'unknown' | 'none' | 'amount'

export function adSpendState(c: Pick<CreativeAttribution, 'adId' | 'adStoreId' | 'spend' | 'orders' | 'siblingOrders'>): AdSpendState {
  if (c.adId !== 'outros' && !c.adStoreId) return 'unknown'
  return c.spend <= 0.005 && (c.orders > 0 || c.siblingOrders > 0) ? 'none' : 'amount'
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Calendar days from a to b ("YYYY-MM-DD", both on the store's clock). */
function dayDiff(a: string, b: string): number {
  const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))
  return Math.round((utc(b) - utc(a)) / 86_400_000)
}

/**
 * How long from the first recorded visit to the purchase, in the store's
 * calendar days.
 *
 * Counted from the visits on screen (first visit's date against the order's
 * date, both on the store's clock), so it agrees with the path the reader
 * opens. Shopify's own daysToConversion is only the fallback: it is the
 * calendar-day count floored at 1 (checked on 60 days of orders: 2+ equals
 * the store-calendar gap; 1 covers both "same day", 2,985 orders, and "next
 * day", ~250), so a 1 from Shopify cannot tell the two apart and says so.
 */
export function conversionDelay(o: {
  createdAt: string | null | undefined
  daysToConversion: number | null | undefined
  touches?: { occurredAtLocal: string | null }[]
}): string | null {
  const orderDay = o.createdAt?.slice(0, 10)
  const firstDay = (o.touches ?? [])
    .map(t => t.occurredAtLocal?.slice(0, 10))
    .filter((d): d is string => !!d && DAY_RE.test(d))
    .sort()[0]
  let gap: number | null = null
  if (orderDay && DAY_RE.test(orderDay) && firstDay) {
    const g = dayDiff(firstDay, orderDay)
    if (g >= 0) gap = g
  }
  if (gap === null) {
    const d = o.daysToConversion
    if (d == null || !(d >= 0)) return null
    if (Math.round(d) <= 1) return 'comprou em até 1 dia'
    gap = Math.round(d)
  }
  if (gap === 0) return 'comprou no mesmo dia'
  if (gap === 1) return 'comprou no dia seguinte'
  return `${formatNumber(gap)} dias da primeira visita à compra`
}

/** Android apps Shopify reports as `android-app://<package>/`. */
const APP_NAMES: Record<string, string> = {
  'm.facebook.com': 'Facebook (app)',
  'com.facebook.katana': 'Facebook (app)',
  'com.instagram.android': 'Instagram (app)',
  'com.google.android.gm': 'Gmail (app)',
  'com.google.android.googlequicksearchbox': 'Google (app)',
}

/**
 * Shopify's raw source of a visit, in Portuguese: "direct" → "Direto",
 * "an unknown source" → "Origem desconhecida", "https://www.facebook.com/" →
 * "facebook.com", "android-app://com.google.android.gm/" → "Gmail (app)".
 * Names Shopify already writes as a brand (Google, Instagram, ChatGPT) stay.
 */
export function sourceLabel(src: string | null | undefined): string {
  const s = (src ?? '').trim()
  if (!s || s === 'an unknown source' || s === 'Desconhecido') return 'Origem desconhecida'
  if (s === 'direct') return 'Direto'
  if (s === 'email') return 'E-mail'
  const app = /^android-app:\/\/([^/?#]+)/i.exec(s)
  if (app) {
    // The package comes from the visitor's Referer: an own-key lookup, or
    // "android-app://__proto__/" returned Object.prototype (rendered as a
    // React child, it crashed the journey reader).
    const key = app[1].toLowerCase()
    return Object.hasOwn(APP_NAMES, key) ? APP_NAMES[key] : `App ${app[1]}`
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      return new URL(s).hostname.replace(/^www\./, '') || s
    } catch {
      return s
    }
  }
  return s
}

const STAMP_RE =/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/

/**
 * "16 nov · 23h04" from the store-clock strings the API returns
 * ("2026-11-16T23:04:58" for orders, "2026-11-16 23:04" for visits). Never
 * through `new Date()`: that would move the time to the browser's timezone,
 * which is the bug this replaces (A6).
 */
export function formatLocalStamp(local: string | null | undefined, today?: string): string {
  const m = local ? STAMP_RE.exec(local) : null
  if (!m) return '—'
  return `${formatDate(m[1], today)} · ${formatClock(Number(m[2]) * 60 + Number(m[3]))}`
}

/**
 * The ad thumbnail URL, or null when Meta's signed CDN link has expired.
 * fbcdn links carry their expiry as `oe` (unix seconds in hex); fb_ads keeps
 * the link from the last ad sync, so older ads point at dead links that
 * answer 403 (13 of 40 on EPOCH's table on 17 nov). Skipping them shows the
 * placeholder without a failed request per row.
 */
export function liveThumbnail(url: string | null | undefined, now: Date): string | null {
  // One rule for every screen (lib/data/metaCdn).
  return liveSignedUrl(url, now)
}

/** "/products/capy-chef" from a landing URL; null when there is nothing useful. */
export function landingPath(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const u = new URL(url, 'https://loja.invalid')
    let p = u.pathname.replace(/\/+$/, '') || '/'
    // "/products/mokoo%E2%84%A2-sea-friends" reads "/products/mokoo™-sea-friends".
    try { p = decodeURIComponent(p) } catch { /* keep the encoded path */ }
    return p.length > 48 ? `${p.slice(0, 47)}…` : p
  } catch {
    return null
  }
}

// ─── The store ROAS tile ─────────────────────────────────────────────────────

/** What the store ROAS tile needs from the engine (same store, same window). */
export type StoreRoasTotals = Pick<PnL, 'revenue' | 'contribution' | 'metaSpend' | 'shopSpend' | 'breakEvenRoas'>

/** "ROAS da loja", plus the channel when it is not Meta alone: on this page
 *  "ROAS do Meta" (the Resumo's name for the Meta case) would read as the
 *  "ROAS que o Meta declara" tile next to it. */
export function storeRoasLabel(channel: AdChannel | null): string {
  return channel && channel !== 'meta' ? `ROAS da loja · ${CHANNEL_LABEL[channel]}` : 'ROAS da loja'
}

/** The other channel's spend left out of the ratio, in words; null when none. */
export function leftOutSpend(t: Pick<StoreRoasTotals, 'metaSpend' | 'shopSpend'>, channel: AdChannel | null): string | null {
  if (channel === 'meta' && t.shopSpend > 0.005) return `${formatMoney(t.shopSpend)} de Anúncios Shopify ficam fora deste ROAS e entram no lucro.`
  if (channel === 'shop' && t.metaSpend > 0.005) return `${formatMoney(t.metaSpend)} de Meta ficam fora deste ROAS e entram no lucro.`
  return null
}
