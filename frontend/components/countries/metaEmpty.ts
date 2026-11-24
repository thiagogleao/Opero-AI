/**
 * What the Países "O que o Meta atribui a cada país" table says when it has
 * no row. Pure, tested in __tests__/metaEmpty.test.ts.
 *
 * "O Meta não entregou o detalhamento por país" is true only when there was
 * spend to break down. CAMP HALLOW (no ad account of its own), Glooty after
 * its last spend (15 nov) and Hibikura before its first all read it over $0
 * of Meta, blaming a report that had nothing to report.
 */

import { plural } from '@/lib/format'

export function metaCountriesEmpty(input: {
  /** The window's Meta spend the table covers (the store's own campaigns). */
  metaSpend: number
  /** Meta spend of shared-account campaigns, left out of the table. */
  sharedSpend?: number
  /** Where this store's ads are paid when another store's books carry them
   *  (metaElsewhereText); null when none. */
  elsewhere?: string | null
  /** "Todas": the sentence speaks of the stores ("A loja não teve gasto"
   *  read as one store on a page of seven). */
  many?: boolean
}): { title: string; body: string } {
  if (input.metaSpend > 0) {
    return { title: 'Sem divisão por país do Meta neste período', body: 'O Meta não entregou o detalhamento por país para estas datas.' }
  }
  if ((input.sharedSpend ?? 0) > 0) {
    return {
      title: 'Sem gasto próprio no Meta neste período',
      body: 'Todo o gasto no Meta destas datas foi em campanhas de conta compartilhada, que ficam fora desta tabela (veja a nota abaixo).',
    }
  }
  return {
    title: 'Sem gasto no Meta neste período',
    body: input.elsewhere ?? (input.many
      ? 'As lojas não tiveram gasto com anúncios do Meta nestas datas: não há divisão por país para mostrar.'
      : 'A loja não teve gasto com anúncios do Meta nestas datas: não há divisão por país para mostrar.'),
  }
}

/**
 * "Os anúncios que trouxeram 4 pedidos daqui neste período rodam na conta da
 * EPOCH ®️: …" — for a store whose orders came from ads in another store's
 * account (lib/attribution getSharedAdAccountsForStore, the window's pairs).
 * Only stores the viewer may see are passed in. Null for an empty list.
 */
export function metaElsewhereText(stores: readonly { name: string; orders: number }[]): string | null {
  if (!stores.length) return null
  const orders = stores.reduce((t, s) => t + s.orders, 0)
  const where = stores.map(s => `da ${s.name}`).join(' e ')
  return `Os anúncios que trouxeram ${plural(orders, 'pedido', 'pedidos')} daqui neste período rodam na conta ${where}: o gasto deles, e a divisão por país, ficam na contabilidade ${where}.`
}
