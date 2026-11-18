/**
 * What "Campanhas · todas as lojas" says about each store's ads, and the
 * verdict over them. Pure (no React, no database), tested in
 * __tests__/portfolioAds.test.ts; rendered by PortfolioAds.tsx.
 *
 * Two rules shared with the rest of the site, so one store and one window
 * show one number everywhere:
 *  - ROAS da loja: store revenue ÷ the spend of the store's ad channel
 *    (lib/views/adChannel via lib/views/verdict storeRoas — Meta, Anúncios
 *    Shopify, or both), against the store's own break-even. The Resumo, the
 *    insights card, /overview and /attribution measure it that way. Revenue ÷
 *    Meta spend alone read "319× → no lucro" for Dumpling 8jcp3a ($59,84 of
 *    Meta next to $6.436 of Shop Campaigns) while the Resumo said 2,97×.
 *  - ROAS atribuído: what Meta credits to the store's OWN campaigns ÷ their
 *    spend (lib/data/campaigns OwnAttribution), shared-account campaigns
 *    named apart — the store's Campanhas page rule. EPOCH's October read 1,56×
 *    and "Crédito 175%" here (CAMP HALLOW's sales counted as EPOCH's) against
 *    1,35× on its own page.
 */

import type { PnL } from '@/lib/engine/pnl'
import type { OwnAttribution } from '@/lib/data/campaigns'
import type { SharedAdAccount } from '@/lib/attributionModels'
import { adChannelOf, channelSpend, type AdChannel } from '@/lib/views/adChannel'
import { storeRoas, sumTotals, type RoasSummary, type Verdict, type VerdictChip, type VerdictLine } from '@/lib/views/verdict'
import { formatMoney, formatRoas, plural } from '@/lib/format'

type Part = string | { text: string; strong?: boolean; tone?: 'pos' | 'neg' | 'warn' }
const line = (...parts: Part[]): VerdictLine => {
  const ps = parts.map(p => (typeof p === 'string' ? { text: p } : p))
  return { parts: ps, text: ps.map(p => p.text).join('') }
}
export const joinNames = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`)

/** The channel before a ROAS in a table cell, as on /overview. */
export const CHANNEL_SHORT: Record<AdChannel, string> = { meta: 'Meta', shop: 'Shopify', both: 'Meta + Shopify' }

export interface PortfolioAdsStore {
  id: string
  name: string
  configured: boolean
  totals: PnL
}

export interface StoreAdsRow {
  /** The ad spend the ROAS divides by; null without any ad spend. */
  channel: AdChannel | null
  /** Channel ROAS against the store's own break-even; null without ad spend. */
  roas: RoasSummary | null
  /** The spend of `channel`. */
  channelSpend: number
  /** A second channel under 10% of the ad spend: in the profit, outside the
   *  ROAS, listed by spend ("+ Meta $59,84 (só gasto)"). */
  sideSpend: { label: string; spend: number } | null
  /** The store's sales, after product, shipping and fees, pay its channel's
   *  spend (ROAS ≥ break-even). Null without cost settings or ad spend. */
  covers: boolean | null
  /** The store's own campaigns (null when the split did not load). */
  own: { spend: number; purchaseValue: number; roas: number | null; creditPct: number | null } | null
  /** Shared-account campaigns, when there are any in the window. */
  shared: OwnAttribution['shared'] | null
}

export function storeAdsRow(r: PortfolioAdsStore, attribution: OwnAttribution | null | undefined): StoreAdsRow {
  const t = r.totals
  const channel = adChannelOf(t)
  const roas = storeRoas(t, r.configured)
  const sideSpend = channel === 'meta' && t.shopSpend > 0 ? { label: 'Shopify', spend: t.shopSpend }
    : channel === 'shop' && t.metaSpend > 0 ? { label: 'Meta', spend: t.metaSpend }
      : null
  const own = attribution ? {
    spend: attribution.own.spend,
    purchaseValue: attribution.own.purchaseValue,
    roas: attribution.own.spend > 0 ? attribution.own.purchaseValue / attribution.own.spend : null,
    creditPct: t.revenue > 0 ? (attribution.own.purchaseValue / t.revenue) * 100 : null,
  } : null
  const shared = attribution && (attribution.shared.spend > 0 || attribution.shared.purchaseValue > 0) ? attribution.shared : null
  return {
    channel, roas, channelSpend: channelSpend(t, channel), sideSpend,
    covers: r.configured && roas ? roas.state === 'pos' : null,
    own, shared,
  }
}

/**
 * The stores whose sales rode on Meta spend, for the headline's "ROAS das
 * lojas": the stores whose ad channel is Meta, plus a store with no ad spend
 * of its own that sold, in the window, through ads one of them paid for
 * (CAMP HALLOW on EPOCH's old account). Dumpling 8jcp3a (Shopify ads) and
 * Dumpling hzsjyp (no ads) stay out — counting them made 1,63× read 2,76×.
 */
export function metaBasis(stores: readonly PortfolioAdsStore[], pairs: readonly Pick<SharedAdAccount, 'adStoreId' | 'salesStoreId'>[]): {
  stores: PortfolioAdsStore[]; viaShared: Map<string, string[]>; revenue: number; metaSpend: number; roas: number | null
} {
  // Biggest Meta spender first: the order the sentence names them in.
  const meta = stores.filter(s => adChannelOf(s.totals) === 'meta').sort((a, b) => b.totals.metaSpend - a.totals.metaSpend)
  const metaIds = new Set(meta.map(s => s.id))
  const viaShared = new Map<string, string[]>()
  for (const s of stores) {
    if (adChannelOf(s.totals) !== null || !(s.totals.revenue > 0)) continue
    const payers = pairs.filter(p => p.salesStoreId === s.id && metaIds.has(p.adStoreId)).map(p => p.adStoreId)
    if (payers.length) viaShared.set(s.id, [...new Set(payers)])
  }
  const basis = [...meta, ...stores.filter(s => viaShared.has(s.id))]
  const revenue = basis.reduce((t, s) => t + s.totals.revenue, 0)
  const metaSpend = meta.reduce((t, s) => t + s.totals.metaSpend, 0)
  return { stores: basis, viaShared, revenue, metaSpend, roas: metaSpend > 0 ? revenue / metaSpend : null }
}

export function buildPortfolioAdsVerdict(input: {
  stores: PortfolioAdsStore[]
  /** lib/data/campaigns getOwnAttribution; null when it failed to load (the
   *  attributed sentence is left out rather than mixing the rules). */
  attribution: ReadonlyMap<string, OwnAttribution> | null
  /** Shared-account pairs of the window (lib/attribution getSharedAdAccounts). */
  pairs: readonly Pick<SharedAdAccount, 'adStoreId' | 'salesStoreId'>[]
  rangeLabel: string
  periodPhrase: string
  partialLabel: string | null
  split?: boolean
}): Verdict {
  const { stores, periodPhrase } = input
  const totals = sumTotals(stores.map(r => r.totals))
  const rows = new Map(stores.map(r => [r.id, storeAdsRow(r, input.attribution?.get(r.id) ?? null)]))
  const row = (r: PortfolioAdsStore) => rows.get(r.id)!
  // The page is about Meta: the stores judged are the ones that spent there,
  // each on its own ad channel.
  const spenders = stores.filter(r => r.totals.metaSpend > 0)
  const judged = spenders.filter(r => r.configured)
  const covering = judged.filter(r => row(r).covers)
  const below = judged.filter(r => !row(r).covers)
  const unconfigured = spenders.filter(r => !r.configured)
  const chips: VerdictChip[] = []
  const details: VerdictLine[] = []
  const notes: VerdictLine[] = []
  // The partial clock is a chip of its own; the date line stays the range.
  const base = {
    when: input.rangeLabel, totals, comparisonTotals: null, excluded: [], partial: !!input.partialLabel, split: !!input.split,
    storeCount: stores.length, roas: null, early: false, fewOrders: false,
  }

  if (!spenders.length) {
    chips.push({ code: 'sem_vendas', label: 'Sem gasto no Meta', tone: 'neu', icon: 'ring' })
    return {
      ...base, tone: 'neu', chips, headline: `Nenhuma loja gastou no Meta ${periodPhrase}.`,
      amount: null, amountTone: 'neu', amountCaption: 'sem gasto com anúncios no período',
      details: [line(`As lojas venderam ${formatMoney(totals.revenue)} ${periodPhrase} sem gasto no Meta.`)], notes: [], basis: 'none',
    }
  }

  if (covering.length) chips.push({ code: 'lucro', label: `${covering.length} ${covering.length === 1 ? 'cobriu' : 'cobriram'} os anúncios`, tone: 'pos', icon: 'up' })
  if (below.length) chips.push({ code: 'prejuizo', label: `${below.length} abaixo do empate`, tone: 'neg', icon: 'down' })
  if (unconfigured.length) chips.push({ code: 'sem_custos', label: unconfigured.length === 1 ? '1 loja sem custos' : `${unconfigured.length} lojas sem custos`, tone: 'cfg', icon: 'sliders' })
  if (input.partialLabel) chips.push({ code: 'parcial', label: input.partialLabel, tone: 'info', icon: 'clock' })

  const headline = judged.length === 0
    ? `Suas lojas gastaram ${formatMoney(totals.metaSpend)} no Meta ${periodPhrase}, mas nenhuma delas tem custos para dizer se compensou.`
    : below.length === 0
      ? `Todas as lojas com custos cobriram o gasto com anúncios ${periodPhrase}.`
      : covering.length === 0
        ? `Nenhuma loja cobriu o gasto com anúncios ${periodPhrase}.`
        : `${covering.length} de ${judged.length} lojas cobriram o gasto com anúncios ${periodPhrase} — ${joinNames(below.map(r => r.name))} ${below.length === 1 ? 'ficou' : 'ficaram'} abaixo do empate.`

  // 1. What Meta credits, on the store pages' rule (own campaigns only).
  if (input.attribution) {
    let ownSpend = 0, ownValue = 0, shSpend = 0, shValue = 0, shCampaigns = 0
    for (const r of stores) {
      const a = input.attribution.get(r.id)
      if (!a) continue
      ownSpend += a.own.spend; ownValue += a.own.purchaseValue
      shSpend += a.shared.spend; shValue += a.shared.purchaseValue; shCampaigns += a.shared.campaigns
    }
    details.push(line('O Meta credita ', { text: formatMoney(ownValue), strong: true },
      ` em vendas às campanhas das próprias lojas (ROAS atribuído ${formatRoas(ownSpend > 0 ? ownValue / ownSpend : null)})`,
      shSpend > 0
        ? `; ${formatMoney(shSpend)} em ${plural(shCampaigns, 'campanha', 'campanhas')} de conta compartilhada ficam fora, com ${formatMoney(shValue)} creditados a vendas que caem sobretudo em outra loja.`
        : '.'))
  }

  // 2. "ROAS das lojas" on the stores whose sales rode on Meta, basis named.
  const basis = metaBasis(stores, input.pairs)
  const nameOf = new Map(stores.map(s => [s.id, s.name]))
  if (basis.roas !== null) {
    const names = basis.stores.map(s => {
      const via = basis.viaShared.get(s.id)
      return via ? `${s.name} (pela conta da ${joinNames(via.map(id => nameOf.get(id) ?? 'outra loja'))})` : s.name
    })
    details.push(line(`${basis.stores.length === 1 ? 'A loja que anuncia' : 'As lojas que anunciam'} no Meta — ${joinNames(names)} — ${basis.stores.length === 1 ? 'vendeu' : 'venderam'} `,
      { text: formatMoney(basis.revenue), strong: true }, ` contra ${formatMoney(basis.metaSpend)} de Meta: ROAS das lojas ${formatRoas(basis.roas)}.`))
  }
  const otherChannel = spenders.filter(r => {
    const ch = row(r).channel
    return ch === 'shop' || ch === 'both'
  })
  if (otherChannel.length) {
    notes.push(line(`${joinNames(otherChannel.map(r => `${r.name} (${formatMoney(r.totals.shopSpend)} em Anúncios Shopify, ${formatMoney(r.totals.metaSpend)} no Meta)`))} ${otherChannel.length === 1 ? 'anuncia' : 'anunciam'} sobretudo fora do Meta: o ROAS da tabela é medido no canal de cada uma, como no Resumo, e fica fora do ROAS das lojas acima.`))
  }

  if (unconfigured.length) {
    details.push(line(`${joinNames(unconfigured.map(r => r.name))} ${unconfigured.length === 1 ? 'não tem' : 'não têm'} custos configurados: sem empate, só vendas − anúncios.`))
  }
  notes.push(line('"Cobrir os anúncios" = as vendas da loja, depois de produto, frete e taxas, pagam o gasto no canal em que ela anuncia (Meta, Anúncios Shopify ou os dois, como no Resumo): ROAS da loja no empate ou acima. Cada loja tem o seu empate.'))

  const loss = (r: PortfolioAdsStore) => r.totals.contribution - row(r).channelSpend
  const worst = below.length ? below.reduce((a, b) => (loss(b) < loss(a) ? b : a)) : null

  return {
    ...base,
    tone: judged.length === 0 ? 'warn' : below.length === 0 ? 'pos' : covering.length === 0 ? 'neg' : 'warn',
    chips,
    headline,
    amount: totals.metaSpend,
    amountTone: 'neu',
    amountCaption: `gastos no Meta em ${plural(spenders.length, 'loja', 'lojas')}${worst ? ` · pior: ${worst.name}` : ''}`,
    details: details.slice(0, 3),
    notes,
    basis: 'none',
  }
}
