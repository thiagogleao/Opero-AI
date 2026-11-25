/**
 * The attribution page's number row (numbers first): how far Meta's claim is
 * from the journeys Shopify recorded, the spend and the three ROAS that must
 * never be confused, and how much of the window the journeys cover — with the
 * verdict's chips above and its sentences in "Detalhes do período".
 * Server-safe. Only values the page already computes (the report, the
 * engine's totals, the verdict).
 */

import type { ReactNode } from 'react'
import type { AttributionTotals, Coverage } from '@/lib/attributionModels'
import type { BandChip, BandTile } from '@/lib/views/numberBand'
import { detailsOf } from '@/lib/views/numberBand'
import type { ChipIcon } from '@/lib/views/verdict'
import { adChannelOf, channelRoas } from '@/lib/views/adChannel'
import { formatCount, formatMoney, formatPct, formatRoas, plural } from '@/lib/format'
import { NumberBandView, PeriodDetails, pageTile, roasPageTile } from '@/components/numbers'
import { leftOutSpend, storeRoasLabel, type StoreRoasTotals } from './model'
import type { AttributionVerdict } from './verdict'

export function AttributionRow({ verdict: v, totals: t, store, configured, sharedAdStore, coverage, journeysAge, extraChips = [], details, extraCount = 0 }: {
  verdict: AttributionVerdict
  totals: AttributionTotals
  store: StoreRoasTotals | null
  configured: boolean
  sharedAdStore: string | null
  coverage: Coverage
  journeysAge: string | null
  extraChips?: BandChip[]
  /** Page items for Detalhes (period sentence, shared-account note…). */
  details?: ReactNode
  extraCount?: number
}) {
  const spent = t.spend > 0.005 || t.metaRevenue > 0.005
  const channel = store ? adChannelOf(store) : null
  const storeR = store ? channelRoas(store) : null
  const leftOut = store ? leftOutSpend(store, channel) : null
  const gapLabel = v.state === 'over' ? 'Meta declara a mais' : v.state === 'under' ? 'Meta declara a menos' : 'Meta × jornada'
  const tiles: BandTile[] = [
    pageTile({
      slot: 'lucro', label: gapLabel, value: v.hero.value, raw: v.gapPct, tone: v.hero.tone,
      subs: v.gapAmount !== null
        ? [{ text: `${formatMoney(Math.abs(v.gapAmount))} ${v.gapAmount >= 0 ? 'acima' : 'abaixo'} da jornada` }]
        : [{ text: v.hero.caption, tone: 'mut' }],
      info: `${v.hero.caption}. O que o Meta diz ter vendido comparado com as vendas que as jornadas da Shopify ligam aos anúncios.`,
    }),
    pageTile({
      slot: 'margem', label: 'Gasto no Meta', value: formatMoney(t.spend), raw: t.spend,
      subs: t.sharedSpend > 0.005
        ? [{ text: `+ ${formatMoney(t.sharedSpend)} da conta da ${sharedAdStore ?? 'outra loja'}` }]
        : [{ text: `${formatCount(t.adsWithActivity)} ${t.adsWithActivity === 1 ? 'anúncio' : 'anúncios'} com gasto ou venda` }],
      info: 'Gasto dos anúncios da conta de anúncios desta loja no período. É o mesmo gasto que o cálculo de lucro desconta.',
    }),
    pageTile({
      slot: 'receita', label: 'ROAS pela jornada', value: spent ? formatRoas(t.roasJourney) : '—', raw: t.roasJourney, tone: spent ? 'neu' : 'mut',
      subs: [{ text: `${formatMoney(t.journeyRevenueOwnAds)} ligados aos anúncios` }],
      info: 'Vendas que as jornadas da Shopify ligam aos anúncios desta conta (inclusive as que caíram em outra loja da mesma conta), divididas pelo gasto. Não conta quem comprou sem passar por um link de anúncio, por isso tende a ficar abaixo do ROAS da loja.',
    }),
    pageTile({
      slot: 'pedidos', label: 'ROAS que o Meta declara', value: spent ? formatRoas(t.roasMeta) : '—', raw: t.roasMeta, tone: spent ? 'neu' : 'mut',
      subs: [{ text: `${plural(t.metaPurchases, 'compra', 'compras')} · ${formatMoney(t.metaRevenue)}` }],
      info: 'O valor de compra que o próprio Meta informa para esses anúncios, dividido pelo gasto. Compras acima de $20.000 em um anúncio num só dia são descartadas como falha do relatório.',
    }),
    roasPageTile({
      slot: 'anuncios', label: `${storeRoasLabel(channel)} × empate`, roas: storeR,
      facts: { breakEven: store?.breakEvenRoas ?? null, configured, revenue: store?.revenue ?? null, contribution: store?.contribution ?? null },
      tags: leftOut ? [{ code: 'canal', label: channel === 'meta' ? 'só Meta' : 'só Shopify', tone: 'info', info: leftOut }] : [],
      info: 'Todas as vendas da loja, com orgânico e recompra, divididas pelo gasto em anúncios — o mesmo ROAS do Resumo. Sobe sozinho quando o gasto cai, porque a venda orgânica continua: serve para a loja, não para julgar um anúncio.',
    }),
    pageTile({
      slot: 'roas', label: 'Jornada coletada', value: coverage.orders > 0 ? formatPct(coverage.pct, { digits: 0 }) : '—', raw: coverage.orders > 0 ? coverage.pct : null,
      tone: coverage.orders > 0 ? (coverage.pct < 80 ? 'warn' : 'neu') : 'mut',
      subs: coverage.orders > 0 ? [{ text: `dos ${plural(coverage.orders, 'pedido', 'pedidos')}` }] : [{ text: 'sem pedidos no período', tone: 'mut' }],
      info: `Pedidos com o caminho de visitas registrado pela Shopify.${coverage.pending ? ` ${plural(coverage.pending, 'jornada', 'jornadas')} ainda em cálculo na Shopify.` : ''}`,
    }),
  ]
  const status: BandChip[] = v.chips.map(c => ({ code: c.key, label: c.label, tone: c.tone, icon: c.icon as ChipIcon }))
  // Fine print that changes how the numbers read: a chip, the sentence in its ⓘ.
  // The verdict words it "uma conta que nenhuma loja conectada lê" (a note,
  // or a detail when the window had no spend); match both spellings.
  const UNREAD = /nenhuma loja(?: conectada)? lê/
  const unread = v.notes.find(n => UNREAD.test(n.text)) ?? v.details.find(n => UNREAD.test(n.text))
  if (unread) status.push({ code: 'conta_nao_lida', label: 'conta que nenhuma loja lê', tone: 'warn', icon: 'alert', info: unread.text })
  if (journeysAge) status.push({ code: 'jornadas', label: `atualizada ${journeysAge}`, tone: 'neu', icon: 'clock', info: `As jornadas da Shopify foram lidas ${journeysAge}.` })
  status.push(...extraChips)
  return (
    <NumberBandView
      tiles={tiles} status={status} ariaLabel="Números da atribuição"
      details={<PeriodDetails details={detailsOf(v)} extraCount={extraCount}>{details}</PeriodDetails>}
    />
  )
}
