/**
 * The shared-ad-account note (CAMP HALLOW's ads run in EPOCH's account).
 * Shown on both stores whenever the window has sales crossing between them,
 * and as a quieter reminder when it happened in the last 90 days but not in
 * this window. Only stores of the viewer's own login are ever named (the data
 * layer guarantees it). Server-safe.
 */

import type { SharedAdAccount } from '@/lib/attributionModels'
import { SHARED_ACCOUNT_NOTE } from '@/lib/attributionModels'
import { formatMoney, plural } from '@/lib/format'
import { Callout } from '@/components/ui'

/**
 * The pair counts every order with one of those ads ANYWHERE on its path,
 * whatever the credit model, so it is at least the model's count shown in
 * the verdict (EPOCH 30d: 66 orders here, 59 by first click there). Said in
 * the sentence, or the two numbers read as a contradiction.
 */
function sentence(p: SharedAdAccount, storeId: string, when: string): string {
  const orders = plural(p.orders, 'pedido', 'pedidos')
  const anywhere = 'passaram por um desses anúncios em algum ponto do caminho'
  return p.adStoreId === storeId
    ? `Anúncios da conta da ${p.adStoreName} também vendem na ${p.salesStoreName}: ${orders} de lá (${formatMoney(p.revenue)}) ${anywhere} ${when}.`
    : `Os anúncios que trazem vendas para a ${p.salesStoreName} rodam na conta da ${p.adStoreName}: ${orders} (${formatMoney(p.revenue)}) ${anywhere} ${when}, e o gasto fica nos livros da ${p.adStoreName}.`
}

const ANY_TOUCH_NOTE = 'Esse número vale qualquer visita do caminho, por isso pode passar do que o modelo escolhido credita.'

/** The note's title and text for this window (or the last 90 days), plain;
 *  null when the store has no shared account. The number row's chip carries it. */
export function sharedAccountText(storeId: string, shared: SharedAdAccount[], recent: SharedAdAccount[], rangeLabel: string): { title: string; text: string; now: boolean } | null {
  const mine = (ps: SharedAdAccount[]) => ps.filter(p => p.adStoreId === storeId || p.salesStoreId === storeId)
  const now = mine(shared)
  if (now.length) return { now: true, title: 'Conta de anúncios compartilhada', text: `${now.map(p => sentence(p, storeId, `em ${rangeLabel}`)).join(' ')} ${ANY_TOUCH_NOTE} ${SHARED_ACCOUNT_NOTE}` }
  const before = mine(recent)
  if (!before.length) return null
  return { now: false, title: 'Conta compartilhada nos últimos 90 dias', text: `${before.map(p => sentence(p, storeId, 'nos últimos 90 dias')).join(' ')} Neste período não houve venda cruzada entre as duas lojas.` }
}

export function SharedAccountNote({ storeId, shared, recent, rangeLabel }: {
  storeId: string
  /** Pairs in the window. */
  shared: SharedAdAccount[]
  /** Pairs in the last 90 days, used only when the window has none. */
  recent: SharedAdAccount[]
  rangeLabel: string
}) {
  const n = sharedAccountText(storeId, shared, recent, rangeLabel)
  if (!n) return null
  return <Callout tone={n.now ? 'info' : 'neu'} icon="swap" title={n.title}>{n.text}</Callout>
}
