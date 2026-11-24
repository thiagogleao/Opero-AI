/**
 * The footer line of Produtos that says where the store's Meta spend went:
 * linked by the journeys to this store's products, spent on ads whose orders
 * landed in another store of the same login (EPOCH's ads that sold CAMP
 * HALLOW orders), or linked to no order of the window. The three parts add up
 * to the Meta spend in the books (lib/data/products getProductReport:
 * own linked + ownSpendCreditedElsewhere + unlinkedSpend = metaSpend).
 * Before, the middle part was not printed and EPOCH's October read $6.671 +
 * $25.347 against $47.220 of Meta. Pure.
 */

import type { ProductAttribution } from '@/lib/data/products'
import { formatMoney } from '@/lib/format'

const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`)

/**
 * Whole dollars by largest remainder, so parts of a total of $100 or more read
 * as adding up to it ($6.671 + $15.203 + $25.347 printed $47.221 against
 * $47.220). Below $100 the cents are shown and plain rounding is exact enough.
 *
 * `pinned` parts keep their own rounding (formatMoney's, as printed elsewhere
 * on the page) and only the others absorb the difference: the linked spend
 * read $2.875 in the sentence and the table's total row but $2.876 among the
 * parts (MOKOO 7d, 2875.49 + 3739.17 = 6614.66 → $6.615).
 */
export function partsSummingTo(parts: number[], total: number, pinned: readonly number[] = []): string[] {
  if (!(total >= 100)) return parts.map(p => formatMoney(p))
  const isPinned = (i: number) => pinned.includes(i) && pinned.length < parts.length
  const whole = parts.map((p, i) => (isPinned(i) ? Math.round(Math.max(0, p)) : Math.floor(Math.max(0, p))))
  let left = Math.round(total) - whole.reduce((a, b) => a + b, 0)
  const free = parts
    .map((p, i) => [Math.max(0, p) - whole[i], i] as const)
    .filter(([, i]) => !isPinned(i))
  // Largest remainders take the missing dollars; if the pinned rounding went
  // over, the smallest remainders give one back.
  free.sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { whole[i] += 1; left -= 1 } })
  free.sort((a, b) => a[0] - b[0]).forEach(([, i]) => { if (left < 0 && whole[i] > 0) { whole[i] -= 1; left += 1 } })
  return whole.map(v => formatMoney(v, { cents: 'never' }))
}

export function metaSpendSplitText(
  a: Pick<ProductAttribution, 'attributedSpend' | 'billedElsewhere' | 'ownSpendCreditedElsewhere' | 'ownSpendCreditedElsewhereByStore' | 'unlinkedSpend'>,
  /** The store's Meta spend in the books (engine metaSpend). */
  metaSpend: number,
  /** The name of a store the viewer may see, or null ("outra loja"). */
  nameOf: (storeId: string) => string | null,
): string {
  const billed = a.billedElsewhere > 0.005 ? a.billedElsewhere : 0
  let out = `Meta ligado = gasto dos anúncios que a jornada da Shopify liga aos pedidos de cada produto (${formatMoney(a.attributedSpend)})`
  out += billed > 0 ? `; ${formatMoney(billed)} disso foi pago na conta de outra loja.` : '.'

  const ownLinked = Math.max(0, a.attributedSpend - billed)
  const elsewhere = a.ownSpendCreditedElsewhere > 0.005 ? a.ownSpendCreditedElsewhere : 0
  const unlinked = a.unlinkedSpend > 0.005 ? a.unlinkedSpend : 0
  if (!(metaSpend > 0) || (elsewhere === 0 && unlinked === 0)) return out

  // The parts are the books' Meta spend split three ways; round them to the
  // total printed next to them (unless they do not add up, then to their sum).
  const sum = ownLinked + elsewhere + unlinked
  // The linked part is pinned to its own rounding: with nothing billed
  // elsewhere it is the "Meta ligado" figure of the first sentence and of
  // the table's total row, which must read the same dollar.
  const [linkedTxt, elsewhereTxt, unlinkedTxt] = partsSummingTo(
    [ownLinked, elsewhere, unlinked], Math.abs(sum - metaSpend) < 1 ? metaSpend : sum, [0],
  )
  // Only stores the viewer may see are named; the rest stay "outra loja".
  const names = [...new Set((a.ownSpendCreditedElsewhereByStore ?? []).map(s => nameOf(s.storeId)).filter((n): n is string => !!n))]
  const where = names.length ? ` (${joinAnd(names)})` : ''
  const parts = [`${linkedTxt} ligado aos produtos daqui`]
  if (elsewhere > 0) parts.push(`${elsewhereTxt} em anúncios cujos pedidos caíram em outra loja${where}`)
  if (unlinked > 0) parts.push(`${unlinkedTxt} sem nenhum pedido do período ligado`)
  return `${out} Do gasto no Meta desta loja (${formatMoney(metaSpend)}): ${joinAnd(parts)}.`
}
