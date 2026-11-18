/**
 * Pure rules of the insights card: which request a response belongs to, and
 * the words for each card kind. Kept out of React so they are unit-tested.
 */

import type { InsightsResult, InsightsWindowInfo } from '@/lib/ai/insights/run'
import type { InsightCard } from '@/lib/ai/insights/result'
import { todayInTz } from '@/lib/engine/dates'
import type { ChipTone } from '@/components/ui/Chip'
import type { IconName } from '@/components/ui/Icon'

export interface InsightsRequest { storeId: string; from: string; to: string; split: boolean }

/** One key per store + window + split: a response is shown only while its key
 *  is still the one on screen. */
export function insightsRequestKey(r: InsightsRequest): string {
  return `${r.storeId}|${r.from}|${r.to}|${r.split ? 'parte' : 'inteiro'}`
}

export function insightsQuery(r: InsightsRequest): string {
  const q = new URLSearchParams({ storeId: r.storeId, period: 'custom', from: r.from, to: r.to })
  if (r.split) q.set('split', '1')
  return q.toString()
}

export function insightsBody(r: InsightsRequest, refresh: boolean) {
  return { storeId: r.storeId, period: 'custom', from: r.from, to: r.to, split: r.split, refresh }
}

/** True when a result answers this request: same store, same split and the
 *  same closed-day window the server resolved for it. The server may cut the
 *  window at yesterday or shorten it, so the window is compared with the one
 *  the server announced (GET or the stream's `start`), not with the props. */
export function resultMatches(result: InsightsResult, r: InsightsRequest, window: InsightsWindowInfo | null): boolean {
  if (result.storeId !== r.storeId || result.split !== r.split) return false
  if (!window) return result.window.from >= r.from && result.window.to <= r.to
  return result.window.from === window.from && result.window.to === window.to
}

/**
 * The window on screen cannot have a closed day yet: it starts on (or after)
 * the store's today. The server answers such a window with 422
 * `no_closed_days`, which the browser logs as a failed request on every
 * "Hoje" page; the card says it without asking.
 *
 * `mayLackClosedDay` needs no timezone: a window starting before the earliest
 * "today" on Earth (UTC−12) has a closed day in every timezone, so only
 * windows that start today-ish pay for the store lookup. The server stays the
 * judge for everything else; this only skips a request that must fail.
 */
export function mayLackClosedDay(from: string, now: Date = new Date()): boolean {
  return from >= todayInTz('Etc/GMT+12', now)
}

export function lacksClosedDay(from: string, storeTz: string, now: Date = new Date()): boolean {
  return from >= todayInTz(storeTz, now)
}

/**
 * The ROAS the headline shows, measured on the same ad spend as the Resumo
 * page's ROAS card (lib/views/store `adChannelOf` / `channelRoas`, a server
 * module this client file cannot import: it pulls in the database). The
 * headline's own `roas` is revenue ÷ Meta spend only; for Dumpling 8jcp3a on
 * 11–17 nov that read 319,64× ($59,74 of Meta next to $6.436 of Shopify ads)
 * while the page beside it said 2,97×. A parity test keeps this in step.
 */
export type AdChannel = 'meta' | 'shop' | 'both'

/** Below this share of the ad spend a second channel is a side cost (same value as lib/views/store). */
const MINOR_CHANNEL_SHARE = 0.1

/** The headline types its spends as nullable; a missing spend is no spend. */
interface Spends { metaSpend: number | null; shopSpend: number | null }

export function adChannelOf(h: Spends): AdChannel | null {
  const meta = h.metaSpend ?? 0
  const shop = h.shopSpend ?? 0
  const total = meta + shop
  if (!(total > 0)) return null
  if (shop <= 0 || shop < total * MINOR_CHANNEL_SHARE) return meta > 0 ? 'meta' : 'shop'
  if (meta <= 0 || meta < total * MINOR_CHANNEL_SHARE) return 'shop'
  return 'both'
}

export function channelRoas(h: Spends & { revenue: number | null }): number | null {
  const meta = h.metaSpend ?? 0
  const shop = h.shopSpend ?? 0
  const ch = adChannelOf(h)
  const spend = ch === 'both' ? meta + shop : ch === 'meta' ? meta : ch === 'shop' ? shop : 0
  return spend > 0 && h.revenue !== null ? h.revenue / spend : null
}

/** The label above the headline ROAS, in the page's words (StoreKpis). */
export const ROAS_LABEL: Record<AdChannel, string> = {
  meta: 'ROAS do Meta',
  shop: 'ROAS dos Anúncios Shopify',
  both: 'ROAS dos anúncios (Meta + Shopify)',
}

export const KIND: Record<InsightCard['kind'], { label: string; tone: ChipTone; icon: IconName }> = {
  parar: { label: 'Parar', tone: 'neg', icon: 'down' },
  escalar: { label: 'Escalar', tone: 'pos', icon: 'up' },
  atencao: { label: 'Atenção', tone: 'warn', icon: 'alert' },
  oportunidade: { label: 'Oportunidade', tone: 'info', icon: 'sparkle' },
  diagnostico: { label: 'Diagnóstico', tone: 'neu', icon: 'info' },
}

export const CONFIDENCE: Record<InsightCard['confidence'], string> = {
  alta: 'confiança alta',
  media: 'confiança média',
  baixa: 'confiança baixa',
}

export const TARGET: Record<InsightCard['target']['type'], string> = {
  loja: 'Loja',
  anuncio: 'Anúncio',
  campanha: 'Campanha',
  pais: 'País',
  produto: 'Produto',
}

export type Phase = 'starting' | 'reading' | 'thinking' | 'writing' | 'waiting'

export const PHASE_TEXT: Record<Phase, string> = {
  starting: 'Enviando o pedido…',
  reading: 'Lendo os números da loja…',
  thinking: 'A IA está analisando os números…',
  writing: 'Escrevendo a leitura…',
  waiting: 'Esta mesma leitura já está sendo gerada (outra aba ou outra pessoa). Aguardando o resultado…',
}

/** "18 out – 16 nov · dias completos" plus why it differs from the period asked. */
export function windowNote(w: InsightsWindowInfo): string | null {
  if (w.shortened) return `Limitada aos últimos ${w.days} dias completos.`
  if (w.cutAtYesterday) return 'Só dias completos: hoje fica de fora até fechar.'
  return null
}
