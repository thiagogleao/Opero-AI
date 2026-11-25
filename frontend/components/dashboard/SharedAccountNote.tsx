/**
 * SharedAccountNote — on a store's Resumo, says so when the store sells on ads
 * billed to another store of the viewer (CAMP HALLOW on EPOCH's old account),
 * or pays for ads that sell in another (EPOCH). Without it CAMP HALLOW's 30
 * days read "$11.355 de lucro real, 85 centavos de cada dólar" with $0 of ads,
 * and the only hint sat at the bottom of the campaigns block.
 *
 * Whether a pair exists is a property of the stores (90 days of journeys,
 * components/portfolio/data loadSharedPairs, the same pairs and threshold as
 * "Todas as lojas"). Whether THIS window is mixed is not: CAMP HALLOW stopped
 * selling on 30 out, and a November week of EPOCH read "o lucro da EPOCH
 * parece menor do que é" about sales that never happened. So the window's own
 * cross-store orders are read too, and the conclusion follows them: a warning
 * when the window is mixed, a plain note of the history when it is not.
 *
 * Async server component: it streams in <Suspense> and renders nothing when
 * there is no pair or the read fails.
 */

import type { PageContext } from '@/lib/views/page'
import type { StoreRef } from '@/lib/access'
import type { SharedAdAccount } from '@/lib/attributionModels'
import { formatMoney, plural } from '@/lib/format'
import { ButtonLink, Callout } from '@/components/ui'
import { loadSharedInWindow, loadSharedPairs, SHARED_LOOKBACK_DAYS } from '@/components/portfolio/data'
import { pairBeforeSalesStart, pairBeforeStartText, pairOrdersIn } from '@/components/portfolio/model'
import { loadFirstOrderDates } from '@/lib/views/portfolio'
import { dateBeside } from '@/components/campaigns/storeStart'

export async function SharedAccountNote({ ctx, store }: { ctx: PageContext; store: StoreRef }) {
  // The viewer's other stores are the only candidates: a partner never sees a
  // pair with a store outside their account. An archived store opened by id is
  // not in ctx.stores, so it is added.
  const stores = ctx.stores.some(s => s.id === store.id) ? ctx.stores : [...ctx.stores, store]
  const [pairs, inWindow] = await Promise.all([
    loadSharedPairs(stores, ctx.timezone, ctx.now)
      .then(ps => ps.filter(p => p.salesStoreId === store.id || p.adStoreId === store.id)),
    loadSharedInWindow(stores, ctx.range),
  ])
  if (!pairs.length) return null
  // The sales stores' first sales: a window before one did not exist for it
  // (CAMP HALLOW before 24 jul 2026), and there is no
  // earlier period to add up. Only stores in a pair pay for this read; a
  // failure keeps the plain wording.
  const firstSales = await loadFirstOrderDates([...new Set(pairs.map(p => p.salesStoreId))])
    .catch(err => { console.error('[resumo] shared pair first sale', err); return new Map<string, string>() })
  // R4 (lib/period carry): no button when the viewer cannot open Todas.
  const allHref = ctx.scopeHref('/overview', { kind: 'all' })
  const all = allHref ? <ButtonLink href={allHref} size="sm" icon="arrowRight">Ver as lojas juntas</ButtonLink> : null
  const history = (p: SharedAdAccount) => `Nos últimos ${SHARED_LOOKBACK_DAYS} dias, ${plural(p.orders, 'pedido', 'pedidos')} da ${p.salesStoreName} (${formatMoney(p.revenue)}) vieram de anúncios pagos pela ${p.adStoreName}.`
  return (
    <>
      {pairs.map(p => {
        const key = `${p.adStoreId}-${p.salesStoreId}`
        const sells = p.salesStoreId === store.id
        // null: the window read failed — keep the cautious, 90-day wording.
        const now = pairOrdersIn(inWindow, p)
        const salesFirst = firstSales.get(p.salesStoreId) ?? null
        // Past tense when the window has none of it: history, not the present.
        const title = sells
          ? `Os anúncios da ${p.salesStoreName} ${now === 0 ? 'rodaram' : 'rodam'} na conta da ${p.adStoreName}`
          : now === 0 ? `A ${p.adStoreName} pagou anúncios que venderam na ${p.salesStoreName}` : `A ${p.adStoreName} paga anúncios que vendem na ${p.salesStoreName}`
        if (now === 0) {
          return (
            <Callout key={key} tone="info" icon="swap" title={title}>
              {history(p)}{' '}
              {salesFirst && pairBeforeSalesStart(salesFirst, ctx.range)
                // Before the sales store existed: no earlier period to add up.
                ? pairBeforeStartText(p.salesStoreName, dateBeside(salesFirst, [ctx.range.from, ctx.range.to, ctx.comparison.from, ctx.comparison.to], ctx.today), ctx.rangeLabel)
                : <>Em {ctx.rangeLabel}, nenhum pedido rastreado da {p.salesStoreName} veio de anúncios da {p.adStoreName}:
                  o resultado deste período não está misturado. Para períodos anteriores, some as duas lojas.</>}{' '}{all}
            </Callout>
          )
        }
        return (
          <Callout key={key} tone="warn" icon="swap" title={title}>
            {now !== null ? <>Em {ctx.rangeLabel}, {plural(now, 'pedido', 'pedidos')} da {p.salesStoreName} vieram de anúncios pagos pela {p.adStoreName}. </> : <>{history(p)} </>}
            {sells
              ? <>Esse gasto não aparece aqui: o lucro da {p.salesStoreName} parece maior do que é, e o da {p.adStoreName} menor.</>
              : <>O gasto está aqui e a venda lá: o lucro da {p.adStoreName} parece menor do que é, e o da {p.salesStoreName} maior.</>}
            {' '}Some as duas para julgar.{' '}{all}
          </Callout>
        )
      })}
    </>
  )
}
