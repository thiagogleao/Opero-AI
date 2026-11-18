/**
 * The sentence for the shared-account campaigns a block leaves out of Meta's
 * numbers (lib/data/funnel and lib/data/countries `sharedLeftOut`): how many,
 * how much they spent and how many purchases Meta gave them, and where their
 * sales landed. Said with the exact amounts, so "Captura 81%" next to the
 * Campanhas page's 748 purchases is not read as a contradiction. Pure.
 */

import { formatCount, formatMoney, plural } from '@/lib/format'

export interface SharedLeftOutLike {
  campaigns: number
  spend: number
  purchases: number
  salesStoreIds: string[]
}

const joinNames = (names: string[]) =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`

/**
 * "Sem 5 campanhas de conta compartilhada ($22.058 de gasto, 439 compras do
 * Meta): as vendas delas caíram na CAMP HALLOW. O gasto continua nos livros
 * desta loja."
 * `scope` names what they are left out of ("do funil, da captura e do gasto
 * por pedido").
 */
export function sharedLeftOutText(lo: SharedLeftOutLike, nameOf: (storeId: string) => string | null, scope: string): string {
  const names = lo.salesStoreIds.map(nameOf).filter((n): n is string => !!n)
  const where = names.length ? `caíram na ${joinNames(names)}` : 'caíram em outra loja'
  const what = lo.campaigns > 0 ? plural(lo.campaigns, 'campanha', 'campanhas') : 'anúncios'
  const one = lo.campaigns === 1
  return `Fora ${scope}: ${what} de conta compartilhada (${formatMoney(lo.spend)} de gasto, ${formatCount(lo.purchases)} ${lo.purchases === 1 ? 'compra' : 'compras'} do Meta), porque as vendas ${one ? 'dela' : 'delas'} ${where}. O gasto continua nos livros desta loja.`
}
