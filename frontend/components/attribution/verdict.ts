/**
 * The attribution verdict: what Meta says it sold, what the store really
 * sold, and the honest gap between Meta's claim and the sales Shopify's own
 * journeys link to Meta's ads. Pure (no database), so it is unit-tested and
 * could run in the browser.
 *
 * The comparison is like for like on purpose: Meta's claim is set against
 * the journey revenue credited to the ads of THIS store's own ad account,
 * wherever the sale landed (CAMP HALLOW's sales on EPOCH's ads count for
 * EPOCH's ads, because Meta cannot tell the two shops apart). Sales credited
 * to ads of another account are named, never mixed in.
 *
 * Honesty rules, the same as the profit verdict:
 *  - no sales and no spend is "sem vendas", never a fake 0%;
 *  - a handful of orders is "poucos pedidos para julgar";
 *  - Meta's phantom purchase (> $20,000 on one ad-day) is dropped by the data
 *    layer and disclosed here;
 *  - ROAS is never one word: journey, Meta and store-account ROAS are kept
 *    apart (the KPI row), and this module never calls an ad good or bad.
 */

import type {
  AttributionTotals, Coverage, Model, PhantomDisclosure, SharedAdAccount,
} from '@/lib/attributionModels'
import type { VerdictLine } from '@/lib/views/verdict'
import { MIN_ORDERS } from '@/lib/views/verdict'
import type { IconName } from '@/components/ui/Icon'
import type { ChipTone } from '@/components/ui/Chip'
import { formatMoney, formatPct, plural } from '@/lib/format'
import { MODEL_TEXT } from './model'

/** Within ±10% Meta and Shopify "batem": attribution windows alone move that much. */
export const MATCH_BAND_PCT = 10
/** Above +25% the overclaim is loud enough to colour the number. */
export const LOUD_GAP_PCT = 25
/** Below 90% of orders with a collected journey the comparison is partial. */
export const COVERAGE_OK_PCT = 90

const CENT = 0.005

export type GapState =
  | 'over'          // Meta claims more than the journeys link to its ads
  | 'under'         // Meta claims less
  | 'match'         // within ±MATCH_BAND_PCT
  | 'only_meta'     // Meta claims sales, no journey links any order to its ads
  | 'only_journey'  // journeys link sales to its ads, Meta claims none
  | 'no_return'     // spend, and neither side counts a single sale
  | 'shared_account' // no own spend: the store sells on another store's ads
  | 'no_spend'      // no Meta spend or claim in the window
  | 'no_sales'      // nothing at all

export interface AttributionChip {
  key: string
  label: string
  tone: ChipTone
  icon: IconName
}

export interface AttributionVerdictInput {
  storeId: string
  storeName: string
  /** "nos últimos 7 dias" (lib/views/page PeriodWindow.periodPhrase). */
  periodPhrase: string
  rangeLabel: string
  model: Model
  /** "parcial · até 13h38" when the window includes today. */
  partialLabel: string | null
  /** The profit engine's totals for the store: what it really sold. */
  sales: { revenue: number; orders: number }
  totals: AttributionTotals
  coverage: Coverage
  phantom: PhantomDisclosure
  shared: SharedAdAccount[]
  /** "há 12 min" — when the journey collector last ran (null: unknown). */
  journeysAge?: string | null
}

export interface AttributionVerdict {
  state: GapState
  chips: AttributionChip[]
  /** "10–16 nov · Primeiro clique". */
  when: string
  headline: string
  hero: { value: string; tone: 'pos' | 'neg' | 'warn' | 'neu' | 'mut'; caption: string }
  details: VerdictLine[]
  notes: VerdictLine[]
  /** (Meta − journey) / journey in %, when both sides counted something. */
  gapPct: number | null
  /** Meta − journey, in dollars, when both sides counted something. */
  gapAmount: number | null
  fewOrders: boolean
  /** Store sales no journey links to any ad (organic, e-mail, direct…). */
  withoutAd: number
}

type Part = string | { text: string; strong?: boolean; tone?: 'pos' | 'neg' | 'warn' }
const b = (text: string, tone?: 'pos' | 'neg' | 'warn'): Part => ({ text, strong: true, tone })
function line(...parts: Part[]): VerdictLine {
  const ps = parts.map(p => (typeof p === 'string' ? { text: p } : p))
  return { parts: ps, text: ps.map(p => p.text).join('') }
}

const STATE_CHIP: Record<GapState, Omit<AttributionChip, 'key'>> = {
  over: { label: 'Meta declara a mais', tone: 'warn', icon: 'alert' },
  under: { label: 'Meta declara a menos', tone: 'info', icon: 'down' },
  match: { label: 'Meta e Shopify batem', tone: 'pos', icon: 'check' },
  only_meta: { label: 'Só o Meta vê as vendas', tone: 'warn', icon: 'alert' },
  only_journey: { label: 'Meta não declarou compras', tone: 'info', icon: 'info' },
  no_return: { label: 'Nenhuma venda pelos anúncios', tone: 'neg', icon: 'down' },
  shared_account: { label: 'Anúncios na conta de outra loja', tone: 'info', icon: 'swap' },
  no_spend: { label: 'Sem gasto no Meta', tone: 'neu', icon: 'ring' },
  no_sales: { label: 'Sem vendas no período', tone: 'neu', icon: 'ring' },
}

/** Which story the numbers tell. Store names read as feminine ("a loja"):
 *  "pela EPOCH", "na Glooty", the same voice as the profit verdict. */
function stateOf(t: AttributionTotals, sales: AttributionVerdictInput['sales'], sharedIn: SharedAdAccount[]): GapState {
  const own = t.spend > CENT || t.metaRevenue > CENT || t.metaPurchases > 0
  if (!own) {
    if (t.sharedSpend > CENT || sharedIn.length > 0) return 'shared_account'
    if (sales.orders === 0 && t.orders === 0) return 'no_sales'
    return 'no_spend'
  }
  const J = t.journeyRevenueOwnAds
  const M = t.metaRevenue
  if (J <= CENT && M <= CENT) return 'no_return'
  if (J <= CENT) return 'only_meta'
  if (M <= CENT) return 'only_journey'
  const gap = ((M - J) / J) * 100
  if (Math.abs(gap) <= MATCH_BAND_PCT) return 'match'
  return gap > 0 ? 'over' : 'under'
}

export function buildAttributionVerdict(input: AttributionVerdictInput): AttributionVerdict {
  const { storeId, storeName: name, periodPhrase: phrase, sales, totals: t, coverage, phantom } = input
  // Pairs where this store sells on another store's ads, and the reverse.
  const sharedIn = input.shared.filter(p => p.salesStoreId === storeId && p.adStoreId !== storeId)
  const sharedOut = input.shared.filter(p => p.adStoreId === storeId && p.salesStoreId !== storeId)
  const state = stateOf(t, sales, sharedIn)

  const J = t.journeyRevenueOwnAds
  const M = t.metaRevenue
  const bothCount = J > CENT && M > CENT
  const gapPct = bothCount ? ((M - J) / J) * 100 : null
  const gapAmount = bothCount ? M - J : null
  const judged = ['over', 'under', 'match', 'only_meta', 'only_journey'].includes(state)
  const fewOrders = judged && Math.max(t.journeyOrdersOwnAds, t.metaPurchases) < MIN_ORDERS
  const withoutAd = Math.max(0, sales.revenue - t.revenue)
  const adStoreName = sharedIn[0]?.adStoreName ?? 'outra loja da sua conta'
  const siblingNames = [...new Set(sharedOut.map(p => p.salesStoreName))]
  const siblingLabel = siblingNames.length === 1 ? siblingNames[0] : 'outras lojas da sua conta'

  // ── Chips ──
  // With a handful of orders the state chip ("Meta e Shopify batem" on one
  // order) would be a judgement the headline itself refuses to make, so the
  // "too few" chip takes its place.
  const chips: AttributionChip[] = fewOrders
    ? [{ key: 'few', label: 'Poucos pedidos para julgar', tone: 'neu', icon: 'ring' }]
    : [{ key: state, ...STATE_CHIP[state] }]
  if (state !== 'shared_account' && (sharedOut.length > 0 || sharedIn.length > 0 || t.siblingOrders > 0 || t.sharedSpend > CENT)) {
    chips.push({ key: 'shared', label: 'Conta compartilhada', tone: 'info', icon: 'swap' })
  }
  if (coverage.orders > 0 && coverage.pct < COVERAGE_OK_PCT) {
    chips.push({ key: 'coverage', label: `Jornada em ${coverage.pct}% dos pedidos`, tone: 'warn', icon: 'alert' })
  }
  if (input.partialLabel) chips.push({ key: 'partial', label: input.partialLabel, tone: 'info', icon: 'clock' })

  // ── Headline and hero ──
  let headline: string
  let hero: AttributionVerdict['hero']
  const nLinked = Math.round(t.journeyOrdersOwnAds)
  switch (state) {
    case 'over':
    case 'under':
    case 'match': {
      const pct = formatPct(gapPct, { digits: 0, sign: true })
      if (fewOrders) {
        headline = `Com ${plural(nLinked, 'pedido ligado', 'pedidos ligados')} aos anúncios, ainda é cedo para comparar o Meta com a Shopify na ${name} ${phrase}.`
      } else if (state === 'over') {
        headline = `O Meta diz que vendeu ${formatMoney(M)} pela ${name} ${phrase} — mais do que a Shopify liga aos anúncios dele (${formatMoney(J)}).`
      } else if (state === 'under') {
        headline = `O Meta declara menos do que a Shopify registra na ${name} ${phrase}: ${formatMoney(M)} contra ${formatMoney(J)} ligados aos anúncios dele.`
      } else {
        headline = `O Meta e a Shopify contam quase o mesmo para a ${name} ${phrase}: ${formatMoney(M)} declarados, ${formatMoney(J)} ligados aos anúncios.`
      }
      hero = fewOrders
        ? { value: pct, tone: 'neu', caption: `de diferença entre o Meta (${plural(t.metaPurchases, 'compra', 'compras')}) e a Shopify (${plural(nLinked, 'pedido ligado', 'pedidos ligados')}): pouco para tirar conclusão` }
        : state === 'over'
        ? { value: pct, tone: (gapPct ?? 0) > LOUD_GAP_PCT ? 'warn' : 'neu', caption: `é quanto o Meta declara a mais: ${formatMoney(gapAmount)} acima do que a Shopify liga aos anúncios dele` }
        : state === 'under'
          ? { value: pct, tone: 'neu', caption: `o Meta declara ${formatMoney(-(gapAmount ?? 0))} a menos do que a Shopify liga aos anúncios dele` }
          : { value: pct, tone: 'pos', caption: 'de diferença: o Meta e a Shopify contam quase o mesmo' }
      break
    }
    case 'only_meta':
      headline = `O Meta diz que vendeu ${formatMoney(M)} pela ${name} ${phrase}, mas a Shopify não liga nenhum pedido aos anúncios dele.`
      hero = { value: formatMoney(M), tone: 'warn', caption: 'declarados pelo Meta sem nenhum pedido que a Shopify ligue aos anúncios dele' }
      break
    case 'only_journey':
      headline = `A Shopify liga ${formatMoney(J)} em vendas aos anúncios da ${name} ${phrase}, mas o Meta não declarou nenhuma compra.`
      hero = { value: formatMoney(J), tone: 'neu', caption: 'em vendas que a Shopify liga aos anúncios, sem compra declarada pelo Meta' }
      break
    case 'no_return':
      headline = `A ${name} gastou ${formatMoney(t.spend)} no Meta ${phrase} e nenhum dos dois lados conta uma venda pelos anúncios.`
      hero = { value: formatMoney(t.spend), tone: 'neg', caption: 'gastos no Meta sem nenhuma venda contada — nem pelo Meta, nem pela Shopify' }
      break
    case 'shared_account': {
      const onShared = Math.max(0, t.revenue - t.unknownAdRevenue)
      // Not "every ad sale": some can come from an account no store reads
      // (CAMP HALLOW: $2.297 of $8.698), which the fine print names.
      headline = `A ${name} não gasta no Meta pela própria conta: os anúncios que trazem vendas para ela rodam na conta da ${adStoreName}.`
      hero = { value: formatMoney(onShared), tone: 'neu', caption: `em vendas desta loja ligadas a anúncios da conta da ${adStoreName}, ${MODEL_TEXT[input.model].by}` }
      break
    }
    case 'no_spend':
      headline = `A ${name} não gastou no Meta ${phrase}.`
      hero = { value: formatMoney(sales.revenue), tone: 'neu', caption: 'vendidos sem gasto no Meta neste período' }
      break
    default:
      headline = input.partialLabel
        ? `A ${name} ainda não teve vendas nem gasto no Meta ${phrase}.`
        : `A ${name} não teve vendas nem gasto no Meta ${phrase}.`
      hero = { value: '—', tone: 'mut', caption: 'nada para comparar neste período' }
  }

  // ── Details: what the store really sold, then why the sides differ ──
  const details: VerdictLine[] = []
  if (sales.orders > 0) {
    const linked = Math.round(t.orders)
    details.push(linked > 0
      ? line('A loja vendeu ', b(formatMoney(sales.revenue)), ' em ', b(plural(sales.orders, 'pedido', 'pedidos')), ` ${phrase}; `,
        b(String(linked)), ' (', b(formatPct((t.orders / sales.orders) * 100, { digits: 0 })), ') passaram por algum anúncio no caminho, pela jornada da Shopify.')
      : line('A loja vendeu ', b(formatMoney(sales.revenue)), ' em ', b(plural(sales.orders, 'pedido', 'pedidos')), ` ${phrase}; nenhum passou por anúncio identificado.`))
  }
  if (state === 'shared_account') {
    details.push(line('O gasto desses anúncios (', b(formatMoney(t.sharedSpend)), ') está nos livros da ', b(adStoreName), ': some as duas lojas para julgar o resultado.'))
  } else if (t.siblingOrders > 0.05 && t.siblingRevenue > CENT) {
    // Named with the model: the shared-account note counts any visit on the
    // path (66 CAMP orders for EPOCH 30d), this line the credited ones (59).
    details.push(line('Os mesmos anúncios trouxeram ', b(plural(Math.round(t.siblingOrders), 'pedido', 'pedidos')), ' (', b(formatMoney(t.siblingRevenue)), ') para a ',
      b(siblingLabel), ` ${MODEL_TEXT[input.model].by}: eles entram na comparação, porque o Meta não separa as lojas.`))
  }
  if (state === 'over' && !fewOrders) {
    details.push(line('A diferença vem do jeito de contar: o Meta credita pela janela dele (até quem só viu o anúncio) e não desconta reembolsos; a Shopify só liga o pedido quando a visita traz o anúncio no link.'))
  } else if (state === 'under' && !fewOrders) {
    details.push(line('A Shopify liga mais vendas aos anúncios do que o Meta declara: costuma ser clique antigo, fora da janela do Meta, ou compra que o pixel não viu.'))
  } else if (state === 'only_meta') {
    details.push(line('Pode ser compra de quem só viu o anúncio, ou pedido reembolsado que o Meta não desconta.'))
  } else if (state === 'no_spend' && t.orders > 0.05) {
    // The line before already counts these orders; this one says where they came from.
    const allUnknown = t.unknownAdRevenue >= t.revenue - CENT
    details.push(allUnknown
      ? line('São anúncios de uma conta que nenhuma loja conectada lê (', b(formatMoney(t.revenue)), ' em vendas): o gasto deles não aparece em loja nenhuma.')
      : line('São cliques antigos, em anúncios que não gastaram neste período (', b(formatMoney(t.revenue)), ' em vendas).'))
  }

  // ── Fine print ──
  const notes: VerdictLine[] = []
  if (t.unknownAdRevenue > 0.5 && state !== 'no_spend') {
    notes.push(line(b(formatMoney(t.unknownAdRevenue)), ' em vendas passaram por anúncios de uma conta que nenhuma loja conectada lê: ficam fora da comparação.'))
  }
  if (phantom.rows > 0) {
    notes.push(line('Descartamos ', b(plural(phantom.rows, 'dia de anúncio', 'dias de anúncio')), ' em que o Meta informou ', b(formatMoney(phantom.value)),
      ' em compras: acima de $20.000 por anúncio e dia é falha do relatório, não venda.'))
  }
  if (coverage.orders > 0) {
    const parts: Part[] = ['Jornada coletada em ', b(`${coverage.pct}%`), ' dos ', b(plural(coverage.orders, 'pedido', 'pedidos'))]
    if (coverage.pending) parts.push(' · ', b(String(coverage.pending)), ` ainda sem resposta da Shopify`)
    if (input.journeysAge) parts.push(` · atualizada ${input.journeysAge}`)
    parts.push('.')
    notes.push(line(...parts))
  }

  return {
    state, chips,
    when: `${input.rangeLabel} · ${MODEL_TEXT[input.model].label}`,
    headline, hero,
    details: details.slice(0, 3),
    notes,
    gapPct, gapAmount, fewOrders, withoutAd,
  }
}
