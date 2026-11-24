/**
 * Shared ad accounts on the phone: CAMP HALLOW sells on ads billed to EPOCH's
 * account (CLAUDE.md), so its row read "sem anúncios +$8.326" with nothing
 * saying where the ads were paid. The desktop names the pair; this says the
 * same on the phone.
 *
 * Where the facts come from (never invented here, never moving spend):
 *  - which stores are paired: components/portfolio/data loadSharedPairs, the
 *    90-day journey pairs with the same threshold "Todas as lojas" uses,
 *    loaded once by app/m/page.tsx (a property of the stores, not the week);
 *  - the row badges: components/portfolio/model sharedAccountBadges, rendered
 *    on the server in page.tsx (that module cannot load in the browser);
 *  - whether THIS window is mixed: the desktop reads the pair's orders inside
 *    the window (loadSharedInWindow). The phone only knows the store rows, so
 *    it knows one case for sure — the selling store had no order in the
 *    window, so none came from the other store's ads — and otherwise says the
 *    distortion conditionally ("se os pedidos deste período também vieram de
 *    lá"), never as a fact about a window it cannot see.
 *
 * The sentences mirror app/overview/page.tsx (Todas) and
 * components/dashboard/SharedAccountNote.tsx (one store). Pure; tested in
 * __tests__/client.test.ts.
 */

import type { SharedAdAccount } from '@/lib/attributionModels'
import { formatMoney, plural } from '@/lib/format'
import { dateBeside } from '@/components/campaigns/storeStart'

export interface PairBadge { label: string; detail: string }

/** What app/m/page.tsx streams to the client. */
export interface SharedAds {
  pairs: SharedAdAccount[]
  /** Store id → the desktop's row badges for it. */
  badges: Record<string, PairBadge[]>
  /** components/portfolio/data SHARED_LOOKBACK_DAYS, sent by the server. */
  lookbackDays: number
  /** Sales store id → its first kept order (lib/views/portfolio
   *  loadFirstOrderDates), for the windows before it existed. Optional: an
   *  older answer, or a failed read, has none and keeps the 90-day wording. */
  firstSales?: Record<string, string>
}

export const NO_SHARED_ADS: SharedAds = { pairs: [], badges: {}, lookbackDays: 0 }

export interface PairNote {
  key: string
  tone: 'info' | 'warn'
  title: string
  body: string
}

/** Orders of the pair inside the window, as far as the phone can know:
 *  0 when the selling store sold nothing in it, null (unknown) otherwise. */
export function pairOrdersKnown(salesStoreOrders: number | null): 0 | null {
  return salesStoreOrders === 0 ? 0 : null
}

/** The window on screen, for the pair notes: a window that ends before the
 *  sales store's first sale is not "antes vendia… some as duas lojas". */
export interface PairWindow {
  range: { from: string; to: string }
  today: string
  /** Other dates printed beside the window (the comparison's ends): a year
   *  there puts the year on the first sale too (storeStart dateBeside). */
  alsoShown?: readonly (string | null | undefined)[]
}

/** The sales store's first sale as printed beside the window, when the window
 *  ends before it (components/portfolio/model pairBeforeSalesStart); else null. */
function firstSaleAfter(shared: SharedAds, salesStoreId: string, w: PairWindow | undefined): string | null {
  const first = shared.firstSales?.[salesStoreId]
  if (!w || !first || !(w.range.to < first)) return null
  return dateBeside(first, [w.range.from, w.range.to, ...(w.alsoShown ?? [])], w.today)
}

/** components/portfolio/model pairBeforeStartText, word for word (that module
 *  cannot load in the browser). */
const beforeStartText = (salesStoreName: string, firstSale: string, rangeLabel: string) =>
  `Em ${rangeLabel}, a ${salesStoreName} ainda não vendia (1ª venda em ${firstSale}): nada deste período está misturado.`

const history = (p: SharedAdAccount, days: number) =>
  `Nos últimos ${days} dias, ${plural(p.orders, 'pedido', 'pedidos')} da ${p.salesStoreName} (${formatMoney(p.revenue)}) vieram de anúncios pagos pela ${p.adStoreName}.`

/**
 * The notes under the verdict.
 *  Todas      one per pair (as /overview).
 *  one store  the pairs that store is in, from its side (as the Resumo).
 * `ordersOf(storeId)` is the store's orders in the window when it is on
 * screen, null when it is not (EPOCH alone does not know CAMP HALLOW's).
 * `win`: the window on screen; one that ends before the sales store's first
 * sale says it did not sell yet (the desktop's pairBeforeStartText), not
 * "Para períodos anteriores, some as duas lojas" for a past that is in the
 * window's future.
 */
export function pairNotes(
  shared: SharedAds, onScreen: { all: boolean; storeId: string | null }, rangeLabel: string,
  ordersOf: (storeId: string) => number | null, win?: PairWindow,
): PairNote[] {
  const out: PairNote[] = []
  for (const p of shared.pairs) {
    const key = `${p.adStoreId}-${p.salesStoreId}`
    // Before its first sale the sales store had no order, so none came from
    // the other store's ads — known even when it is not on screen (EPOCH alone).
    const notYet = firstSaleAfter(shared, p.salesStoreId, win)
    const now = notYet ? 0 : pairOrdersKnown(ordersOf(p.salesStoreId))
    if (onScreen.all) {
      out.push({
        key, tone: now === 0 ? 'info' : 'warn',
        title: `${p.salesStoreName} ${now === 0 ? 'vendia' : 'vende'} com anúncios pagos pela ${p.adStoreName}`,
        body: `${history(p, shared.lookbackDays)} ` + (notYet ? beforeStartText(p.salesStoreName, notYet, rangeLabel) : now === 0
          ? `Em ${rangeLabel}, a ${p.salesStoreName} não teve pedidos: o resultado deste período não está misturado. Para períodos anteriores, some as duas lojas.`
          : `O gasto fica na ${p.adStoreName} e a venda na ${p.salesStoreName}: se os pedidos deste período também vieram desses anúncios, o lucro de uma parece maior e o da outra menor do que é. A soma das lojas não muda; para julgar cada uma, some as duas.`),
      })
      continue
    }
    const sells = p.salesStoreId === onScreen.storeId
    if (!sells && p.adStoreId !== onScreen.storeId) continue
    // The window's own cross-store orders are not known here (null), so the
    // conclusion is conditional: a week the selling store sold only on its
    // own must not read "o lucro parece maior do que é".
    const title = sells
      ? `Os anúncios da ${p.salesStoreName} ${now === 0 ? 'rodaram' : 'rodam'} na conta da ${p.adStoreName}`
      : `A ${p.adStoreName} pagou anúncios que venderam na ${p.salesStoreName}`
    out.push(now === 0
      ? {
        key, tone: 'info', title,
        body: `${history(p, shared.lookbackDays)} ` + (notYet
          ? beforeStartText(p.salesStoreName, notYet, rangeLabel)
          : `Em ${rangeLabel}, a ${p.salesStoreName} não teve pedidos: o resultado deste período não está misturado. Para períodos anteriores, some as duas lojas.`),
      }
      : {
        key, tone: 'warn', title,
        body: `${history(p, shared.lookbackDays)} ` + (sells
          ? `Esse gasto não aparece aqui: se os pedidos deste período também vieram de lá, o lucro da ${p.salesStoreName} parece maior do que é, e o da ${p.adStoreName} menor.`
          : `O gasto fica aqui e a venda lá: se parte do gasto deste período vendeu na ${p.salesStoreName}, o lucro da ${p.adStoreName} parece menor do que é, e o da ${p.salesStoreName} maior.`) + ' Some as duas para julgar.',
      })
  }
  return out
}

/**
 * The empty Campanhas / Criativos tab of a store whose ads run on another
 * store's account (CAMP HALLOW on EPOCH's): where its campaigns are, instead
 * of a bare "Nenhuma campanha com gasto", which read as "this store runs no
 * ads". Null when the store sells on no other store's ads.
 */
export function adsElsewhere(
  shared: SharedAds, storeId: string, what: 'campanhas' | 'anuncios',
): { adStoreId: string; adStoreName: string; title: string; body: string } | null {
  const p = shared.pairs.find(x => x.salesStoreId === storeId && x.adStoreId !== storeId)
  if (!p) return null
  return {
    adStoreId: p.adStoreId,
    adStoreName: p.adStoreName,
    title: `Os anúncios da ${p.salesStoreName} rodam na conta da ${p.adStoreName}`,
    body: `${what === 'campanhas' ? 'As campanhas' : 'Os anúncios'} e o gasto estão na ${p.adStoreName}. ${history(p, shared.lookbackDays)}`,
  }
}

/** The ads line of a store row with no ad spend of its own (as the desktop's
 *  ROAS cell): who paid for the ads it sells on, or plain "sem anúncios". A
 *  window before the store's first sale (`range`) has no "antes vendia": it
 *  did not exist yet. */
export function noSpendLine(shared: SharedAds, storeId: string, orders: number, range?: { from: string; to: string }): string {
  const sold = shared.pairs.find(p => p.salesStoreId === storeId)
  if (!sold) return 'sem anúncios'
  const first = shared.firstSales?.[storeId]
  if (range && first && range.to < first) return 'sem gasto em anúncio'
  return pairOrdersKnown(orders) === 0
    ? `sem gasto em anúncio · antes vendia com anúncios pagos pela ${sold.adStoreName}`
    : `sem gasto no período · vende com anúncios pagos pela ${sold.adStoreName}`
}
