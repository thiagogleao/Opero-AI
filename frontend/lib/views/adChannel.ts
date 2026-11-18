/**
 * Which ad spend a ROAS is measured on. One implementation for every surface:
 * the Resumo KPIs (lib/views/store), the verdict's ROAS box (lib/views/verdict,
 * desktop and phone), "Todas as lojas" (components/portfolio/model) and the AI
 * insights headline (components/ai/insightsModel). Two copies of this rule
 * once disagreed by a factor of 100 on the same screen.
 *
 * Pure, no imports: safe in server and client components alike.
 */

export type AdChannel = 'meta' | 'shop' | 'both'

/** Below this share of the ad spend, a second channel is a side cost (MOKOO's
 *  $226 of Shopify ads next to $5.624 of Meta) and the ROAS stays the Meta
 *  ROAS the owner reads everywhere; above it, the sales are no longer Meta's
 *  alone and the ROAS is measured on both channels together. */
export const MINOR_CHANNEL_SHARE = 0.1

/** Spends as the engine (numbers) or the AI headline (nullable) carry them;
 *  a missing spend is no spend. */
export interface ChannelSpends { metaSpend: number | null; shopSpend: number | null }

/**
 * The ad spend a ROAS should be measured on: the only channel that spent, or
 * both together when each carries at least MINOR_CHANNEL_SHARE of it. With
 * both, revenue ÷ Meta spend would credit Meta with every sale the Shopify ads
 * brought (Dumpling 8jcp3a: 109× on $56 of Meta next to $1.796 of Shopify ads).
 * Null when nothing was spent.
 */
export function adChannelOf(t: ChannelSpends): AdChannel | null {
  const meta = t.metaSpend ?? 0
  const shop = t.shopSpend ?? 0
  const total = meta + shop
  if (!(total > 0)) return null
  if (shop <= 0 || shop < total * MINOR_CHANNEL_SHARE) return meta > 0 ? 'meta' : 'shop'
  if (meta <= 0 || meta < total * MINOR_CHANNEL_SHARE) return 'shop'
  return 'both'
}

/** The spend of a channel (0 for null). */
export function channelSpend(t: ChannelSpends, ch: AdChannel | null): number {
  const meta = t.metaSpend ?? 0
  const shop = t.shopSpend ?? 0
  return ch === 'both' ? meta + shop : ch === 'meta' ? meta : ch === 'shop' ? shop : 0
}

/** Store revenue ÷ the spend of adChannelOf(t). A minor second channel is
 *  left out of the ratio, as the owner reads the Meta ROAS; it is still in
 *  the profit. Null without spend or revenue figure. */
export function channelRoas(t: ChannelSpends & { revenue: number | null }): number | null {
  const spend = channelSpend(t, adChannelOf(t))
  return spend > 0 && t.revenue !== null ? t.revenue / spend : null
}

/** The channel in a phrase ("Cada $1 em Anúncios Shopify"). */
export const CHANNEL_LABEL: Record<AdChannel, string> = { meta: 'Meta', shop: 'Anúncios Shopify', both: 'Meta + Shopify' }

/** The label above a ROAS, in the Resumo's words. */
export const ROAS_LABEL: Record<AdChannel, string> = {
  meta: 'ROAS do Meta',
  shop: 'ROAS dos Anúncios Shopify',
  both: 'ROAS dos anúncios (Meta + Shopify)',
}
