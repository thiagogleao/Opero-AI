/**
 * Words for small things on the phone: a live-feed order line, an alert row.
 * Pure — the components render them and the tests pin them.
 */

import type { LiveOrderItem } from '@/lib/views/portfolio'
import { shiftDate, todayInTz } from '@/lib/engine/dates'
import { formatDate, formatMoney, formatPct, formatTimeInTz, MINUS, SIGN_JOIN } from '@/lib/format'
import { uncreditedSources } from '@/components/campaigns/adsVerdict'
import type { CampaignAction } from '@/lib/campaignSignal'
import { BELOW_BREAK_EVEN_LABEL, type Signal } from '@/lib/creativeSignal'
import type { AlertDelivery } from '@/lib/alerts'
// The desktop's chips (Campanhas, Criativos; a pure module): one campaign or
// ad reads the same word with the same icon and tone on both screens.
import { ACTION_CHIP, SIGNAL_CHIP, type ChipSpec } from '@/components/campaigns/text'

/** A campaign's action chip, the desktop's (ACTION_CHIP). */
export function campaignChip(action: CampaignAction, label: string | null): ChipSpec {
  return { ...ACTION_CHIP[action], label: label ?? ACTION_CHIP[action].label }
}

/**
 * One ad's chip from the server's word (lib/creativeSignal signalLabel): an
 * 'ok' ad at or above its break-even reads "Manter" with a check; below it
 * (too little spend to cut, or above the cut line) "Abaixo do empate" with a
 * neutral ring — a check there would read as approval beside a red estimated
 * loss. components/campaigns/text adSignalChip draws the desktop chip the
 * same way, from the same signalLabel.
 */
export function creativeChip(signal: Signal, label: string | null): ChipSpec {
  const word = label ?? SIGNAL_CHIP[signal].label
  if (word === BELOW_BREAK_EVEN_LABEL) return { label: word, tone: 'neu', icon: 'ring' }
  return { ...SIGNAL_CHIP[signal], label: word }
}

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
  return t ? ptNumbers(t) : (Object.hasOwn(ALERT_KIND_LABEL, kind) ? ALERT_KIND_LABEL[kind] : 'Alerta')
}

const devicesWord = (n: number) => `${n} ${n === 1 ? 'aparelho' : 'aparelhos'}`

/**
 * What one fired alert reached, for its row in the alerts sheet: a row is a
 * once-a-day claim, not a receipt (production kept 10 claims with no device
 * subscribed, and the sheet called them "Enviados"). Rows written before the
 * count was stored (or written by code that did not store it) say so
 * instead of guessing.
 */
export function alertDeliveryText(d: AlertDelivery): string {
  switch (d.state) {
    case 'delivered': return `entregue a ${devicesWord(d.devices)}`
    case 'not_delivered':
      if (!d.keys) return 'não entregue: sem chave de push neste servidor'
      if (d.subscribed === 0) return 'não entregue: nenhum aparelho inscrito'
      return `não entregue: ${d.subscribed === 1 ? 'o aparelho inscrito recusou' : `os ${devicesWord(d.subscribed)} inscritos recusaram`}`
    case 'sending': return 'enviando…'
    case 'interrupted': return 'envio interrompido, entrega desconhecida'
    // No count stored with the claim: the code that wrote it did not record
    // deliveries (production's rows from today included), so this says what
    // is missing, not how old the row is ("envio antigo" on an alert of 13h29).
    case 'unknown': return 'entrega não registrada'
  }
}

/**
 * Why nothing can arrive right now, for the top of the alerts sheet and the
 * test button; null when pushes can be delivered. A server without VAPID keys
 * reads 0 devices whatever is subscribed: "nenhum aparelho inscrito" sent the
 * owner to subscribe a phone that could not have received anything.
 */
export function pushBlockedText(info: { pushKeys?: boolean; devices: number }): string | null {
  if (info.pushKeys === false) return 'Sem chave de push neste servidor (VAPID): os alertas são avaliados, mas nenhum pode ser enviado.'
  if (info.devices === 0) return 'Nenhum aparelho inscrito: os alertas são avaliados, mas não chegam a lugar nenhum.'
  return null
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
    // A minus before "$" is glued to it, as formatMoney writes it (SIGN_JOIN):
    // an old stored "-$40" could wrap between the sign and the amount. A
    // minus that already has the joiner is not followed by "$", so it is
    // never added twice.
    .replace(/−(?=\$)/g, MINUS + SIGN_JOIN)
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

/**
 * What the Países tab has on Meta's side:
 *  'split'     some country carries a Meta line: the caveat about Meta's own
 *              split applies (and how much of the spend it covers);
 *  'no_split'  Meta spend in the window but not one dollar split by country
 *              (MOKOO: $6.597 in 7 days, 0% covered): nothing to compare;
 *  'none'      no Meta money at all (Squishy World).
 * Only 'split' may tell the owner to compare a Meta column: the other two
 * said "compare" over rows with no Meta line.
 */
export type CountriesMetaSide = 'split' | 'no_split' | 'none'

export function countriesMetaSide(d: {
  meta: { totalSpend: number; coveredSpend: number }
  countries: { meta: { spend: number; purchases: number } }[]
}): CountriesMetaSide {
  if (d.countries.some(c => c.meta.spend >= 0.005 || c.meta.purchases > 0)) return 'split'
  if (!(d.meta.totalSpend >= 0.005)) return 'none'
  return d.meta.coveredSpend >= 0.005 ? 'split' : 'no_split'
}

/** "MOKOO e Glooty", "MOKOO, EPOCH e Glooty". */
function joinNames(names: readonly string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

/**
 * How fast a sale reaches "Vendas ao vivo", for the stores on screen: "em
 * segundos" only for the ones with the live feed (Shopify's order webhook). A
 * store without it alone (Hibikura, CAMP HALLOW) read "Cada venda nova aparece
 * em segundos" over a footer saying its orders come with the sync, up to 10
 * minutes later; in Todas the claim leaves out the stores the footer names.
 */
export function liveFeedSpeed(
  stores: readonly { id: string }[], noLive: readonly { storeId: string; name: string }[],
): { howTo: string; footer: string | null } {
  const without = noLive.filter(n => stores.some(r => r.id === n.storeId))
  if (!without.length) return { howTo: 'Cada venda nova aparece em segundos.', footer: null }
  if (without.length >= stores.length) {
    return {
      howTo: `Cada venda nova aparece com a sincronização, até 10 minutos depois: ${stores.length > 1 ? 'estas lojas não avisam' : 'esta loja não avisa'} vendas na hora.`,
      footer: null,
    }
  }
  const names = without.map(n => n.name)
  return {
    howTo: `Cada venda nova aparece em segundos, menos as ${names.length > 1 ? 'das lojas' : 'da loja'} citadas abaixo.`,
    footer: `${joinNames(names)} ${names.length > 1 ? 'não avisam' : 'não avisa'} vendas na hora: os pedidos aparecem com a sincronização, até 10 minutos depois.`,
  }
}

/**
 * The Anúncios Shopify spend beside the Campanhas tab, whose list and "Gasto"
 * are Meta's only: Dumpling 8jcp3a read "Gasto $474" in a week it spent
 * $5.302 on Shop Campaigns. Null without Shopify ad spend.
 */
export function shopAdsLine(
  shopSpend: number, notes: readonly { store: string; shopSpend: number }[], several: boolean,
): string | null {
  if (!(shopSpend >= 0.005)) return null
  const by = notes.filter(n => n.shopSpend >= 0.005).sort((a, b) => b.shopSpend - a.shopSpend)
  const who = several && by.length > 0 ? `: ${by.map(n => `${n.store} ${formatMoney(n.shopSpend)}`).join(', ')}` : ''
  return `Mais ${formatMoney(shopSpend)} em Anúncios Shopify (Shop Campaigns), fora desta lista${who}. Entram no lucro da loja; a lista é só das campanhas do Meta.`
}

/**
 * "MOKOO: o Meta credita 39% menos vendas do que a loja registrou." for each
 * store whose ads run on Meta (adChannel 'meta') and whose gap is 10% or more.
 * A store that sells through Shop Campaigns ('shop', or 'both' channels) is
 * left out: its sales are not Meta's to credit, and "o Meta credita 93% menos
 * vendas" (Dumpling 8jcp3a, $474 of Meta beside $5.302 of Shopify ads; "100%
 * menos" on $4,17 in Todas) read as Meta under-crediting. A Meta store with a
 * minor Shopify spend says where the rest of its sales may come from, in the
 * desktop verdict's words (components/campaigns/adsVerdict uncreditedSources).
 */
export function campaignGapNotes(notes: readonly {
  store: string; metaVsStoreRevenueGap: number | null; shopSpend: number; adChannel: 'meta' | 'shop' | 'both' | null
}[]): string[] {
  return notes
    .filter(n => n.metaVsStoreRevenueGap !== null && Math.abs(n.metaVsStoreRevenueGap) >= 10 && (n.adChannel === 'meta' || n.adChannel === null))
    .map(n => {
      const gap = n.metaVsStoreRevenueGap!
      const base = `${n.store}: o Meta credita ${formatPct(Math.abs(gap), { digits: 0 })} ${gap > 0 ? 'mais' : 'menos'} vendas do que a loja registrou`
      return gap < 0 && n.shopSpend >= 0.005 ? `${base} (o resto: ${uncreditedSources(n.shopSpend)}).` : `${base}.`
    })
}

/**
 * The Campanhas tab's lede: which closed days each action is judged on.
 * One window: "(17–23 nov)"; several (Hibikura's Tokyo week): each with its
 * stores, after a colon. Wrapping the list in parentheses nested them:
 * "(17–23 nov (MOKOO, …); 18–24 nov (Hibikura))". The windows name only
 * stores with campaigns of their own (lib/views/mobileDetail mergeCampaigns).
 */
export function judgedWindowsText(windows: readonly { label: string; stores: readonly string[] }[]): string {
  const tail = 'o dinheiro, no período escolhido.'
  if (windows.length === 0) return `A ação é julgada nos últimos 7 dias fechados; ${tail}`
  if (windows.length === 1) return `A ação é julgada nos últimos 7 dias fechados (${windows[0].label}); ${tail}`
  return `A ação é julgada nos últimos 7 dias fechados: ${joinNames(windows.map(w => `${w.label} (${w.stores.join(', ')})`))}; ${tail}`
}

/**
 * The visible line under Países for stores without costs left out of the
 * per-country rows (CountriesDetail leftOut), as the desktop's "Fora da soma
 * por país": "Fora da soma por país: Glooty ($1.118 em vendas) — sem custos
 * configurados, então não há contribuição por país para somar." A store that
 * only spent on Meta is named for its Meta spend. Null when none.
 */
export function countriesLeftOutLine(leftOut: readonly { store: string; revenue: number; metaSpend: number }[]): string | null {
  if (!leftOut.length) return null
  const sold = leftOut.filter(s => s.revenue >= 0.005)
  const spentOnly = leftOut.filter(s => s.revenue < 0.005 && s.metaSpend >= 0.005)
  const parts = [
    sold.length ? `Fora da soma por país: ${joinNames(sold.map(s => `${s.store} (${formatMoney(s.revenue)} em vendas)`))} — sem custos configurados, então não há contribuição por país para somar.` : null,
    spentOnly.length ? `Sem o gasto no Meta de ${joinNames(spentOnly.map(s => `${s.store} (${formatMoney(s.metaSpend)})`))}: sem custos configurados.` : null,
  ].filter((x): x is string => x !== null)
  return parts.length ? parts.join(' ') : null
}
