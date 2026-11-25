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
 * The comparison window is read the same way: EPOCH's November against an
 * October in which it paid the ads that sold for CAMP HALLOW reads "▲ era
 * −$15.940" while the two stores together fell. When the base is mixed and
 * the band shows deltas (`deltas`), the chips and tags say so in their label
 * ("base misturada"), in warn tone.
 *
 * Variants (numbers-first Resumo):
 *   'full' (default) — the callout, with "Ver as lojas juntas" (Detalhes do período)
 *   'chip'           — a status-line chip ("anúncios na conta da EPOCH ®️"), the callout's text in its ⓘ
 *   'tag'            — the same words as a small tag beside a tile's number (anúncios, ROAS)
 *   'base'           — "base misturada" beside lucro and margem, only when the base is mixed
 * The reads are shared by every variant in one request (React cache).
 *
 * Async server component: it streams in <Suspense> and renders nothing when
 * there is no pair or the read fails.
 */

import { cache } from 'react'
import type { PageContext } from '@/lib/views/page'
import type { StoreRef } from '@/lib/access'
import type { SharedAdAccount } from '@/lib/attributionModels'
import { formatMoney, plural } from '@/lib/format'
import { ButtonLink, Callout } from '@/components/ui'
import { BandChipView } from '@/components/numbers/NumberBandView'
import { loadSharedInWindow, loadSharedPairs, SHARED_LOOKBACK_DAYS } from '@/components/portfolio/data'
import { pairBeforeSalesStart, pairBeforeStartText, pairOrdersIn } from '@/components/portfolio/model'
import { loadFirstOrderDates } from '@/lib/views/portfolio'
import { dateBeside } from '@/components/campaigns/storeStart'

interface PairNote {
  key: string
  pair: SharedAdAccount
  /** The store on screen is the one that sells (CAMP HALLOW), not the one that pays. */
  sells: boolean
  /** Orders of the pair in this window: 0 = not mixed, null = the read failed. */
  now: number | null
  /** Orders of the pair in the comparison window (0 also with no comparison or a failed read). */
  base: number
  title: string
  /** The callout's text, plain. */
  body: string
}

const loadNotes = cache(async (ctx: PageContext, store: StoreRef): Promise<PairNote[]> => {
  // The viewer's other stores are the only candidates: a partner never sees a
  // pair with a store outside their account. An archived store opened by id is
  // not in ctx.stores, so it is added.
  const stores = ctx.stores.some(s => s.id === store.id) ? ctx.stores : [...ctx.stores, store]
  const cmp = ctx.comparison
  const [pairs, inWindow, inBase] = await Promise.all([
    loadSharedPairs(stores, ctx.timezone, ctx.now)
      .then(ps => ps.filter(p => p.salesStoreId === store.id || p.adStoreId === store.id)),
    loadSharedInWindow(stores, ctx.range),
    // The comparison's days (whole days: "ontem até esta hora" reads all of
    // yesterday, which can only over-warn).
    cmp.none === null ? loadSharedInWindow(stores, { from: cmp.from, to: cmp.to }) : Promise.resolve([]),
  ])
  if (!pairs.length) return []
  // The sales stores' first sales: a window before one did not exist for it
  // (CAMP HALLOW before 24 jul 2026), and there is no
  // earlier period to add up. Only stores in a pair pay for this read; a
  // failure keeps the plain wording.
  const firstSales = await loadFirstOrderDates([...new Set(pairs.map(p => p.salesStoreId))])
    .catch(err => { console.error('[resumo] shared pair first sale', err); return new Map<string, string>() })
  const history = (p: SharedAdAccount) => `Nos últimos ${SHARED_LOOKBACK_DAYS} dias, ${plural(p.orders, 'pedido', 'pedidos')} da ${p.salesStoreName} (${formatMoney(p.revenue)}) vieram de anúncios pagos pela ${p.adStoreName}.`
  return pairs.map(p => {
    const sells = p.salesStoreId === store.id
    // null: the window read failed — keep the cautious, 90-day wording.
    const now = pairOrdersIn(inWindow, p)
    const salesFirst = firstSales.get(p.salesStoreId) ?? null
    const base = pairOrdersIn(inBase, p) ?? 0
    // Past tense when the window has none of it: history, not the present.
    const title = sells
      ? `Os anúncios da ${p.salesStoreName} ${now === 0 ? 'rodaram' : 'rodam'} na conta da ${p.adStoreName}`
      : now === 0 ? `A ${p.adStoreName} pagou anúncios que venderam na ${p.salesStoreName}` : `A ${p.adStoreName} paga anúncios que vendem na ${p.salesStoreName}`
    const body = now === 0
      ? `${history(p)} ${salesFirst && pairBeforeSalesStart(salesFirst, ctx.range)
        // Before the sales store existed: no earlier period to add up.
        ? pairBeforeStartText(p.salesStoreName, dateBeside(salesFirst, [ctx.range.from, ctx.range.to, ctx.comparison.from, ctx.comparison.to], ctx.today), ctx.rangeLabel)
        : `Em ${ctx.rangeLabel}, nenhum pedido rastreado da ${p.salesStoreName} veio de anúncios da ${p.adStoreName}: o resultado deste período não está misturado. Para períodos anteriores, some as duas lojas.`}`
      : `${now !== null ? `Em ${ctx.rangeLabel}, ${plural(now, 'pedido', 'pedidos')} da ${p.salesStoreName} vieram de anúncios pagos pela ${p.adStoreName}.` : history(p)} ${sells
        ? `Esse gasto não aparece aqui: o lucro da ${p.salesStoreName} parece maior do que é, e o da ${p.adStoreName} menor.`
        : `O gasto está aqui e a venda lá: o lucro da ${p.adStoreName} parece menor do que é, e o da ${p.salesStoreName} maior.`} Some as duas para julgar.`
    // The base of the ▲▼: said whenever it is mixed, even when this window is not.
    const baseText = base > 0
      ? ` Na base da comparação (${ctx.comparisonRangeLabel}), ${plural(base, 'pedido', 'pedidos')} da ${p.salesStoreName} ${base === 1 ? 'veio' : 'vieram'} de anúncios pagos pela ${p.adStoreName}: as variações de lucro, margem, anúncios e ROAS desta loja comparam com um período misturado. Para comparar, some as duas lojas.`
      : ''
    return { key: `${p.adStoreId}-${p.salesStoreId}`, pair: p, sells, now, base, title, body: body + baseText }
  })
})

export async function SharedAccountNote({ ctx, store, variant = 'full', deltas = false }: {
  ctx: PageContext; store: StoreRef; variant?: 'full' | 'chip' | 'tag' | 'base'
  /** The band shows ▲▼ against the comparison (a mixed base matters only then). */
  deltas?: boolean
}) {
  let notes: PairNote[]
  try {
    notes = await loadNotes(ctx, store)
  } catch (err) {
    console.error('[resumo] shared account note', store.id, err)
    return null
  }
  if (!notes.length) return null
  if (variant !== 'full') {
    const shown = variant === 'base' ? notes.filter(n => deltas && n.base > 0) : notes
    return (
      <>
        {shown.map(n => {
          // The window itself is clean but the ▲▼ compare with a mixed base:
          // the label names the base (the plain history note would hide it).
          const baseOnly = deltas && n.base > 0 && n.now === 0
          const label = variant === 'base' || (variant === 'tag' && baseOnly)
            ? 'base misturada'
            : baseOnly
              ? (n.sells ? `base com anúncios na ${n.pair.adStoreName}` : `base misturada com a ${n.pair.salesStoreName}`)
              : n.sells ? `anúncios na conta da ${n.pair.adStoreName}` : `paga anúncios da ${n.pair.salesStoreName}`
          return (
            <BandChipView key={n.key} size={variant === 'chip' ? 'md' : 'sm'} chip={{
              code: 'conta_compartilhada',
              label,
              // A warning when the window is mixed (or may be: read failed), or its base is.
              tone: n.now === 0 && !baseOnly ? 'info' : 'warn',
              icon: undefined,
              info: `${n.title}. ${n.body}`,
            }} />
          )
        })}
      </>
    )
  }
  // R4 (lib/period carry): no button when the viewer cannot open Todas.
  const allHref = ctx.scopeHref('/overview', { kind: 'all' })
  const all = allHref ? <ButtonLink href={allHref} size="sm" icon="arrowRight">Ver as lojas juntas</ButtonLink> : null
  return (
    <>
      {notes.map(n => (
        <Callout key={n.key} tone={n.now === 0 && n.base === 0 ? 'info' : 'warn'} icon="swap" title={n.title}>
          {n.body}{' '}{all}
        </Callout>
      ))}
    </>
  )
}
