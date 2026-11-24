/**
 * The line over the Criativos tab when ?campanha= narrows it to one campaign.
 * Pure, tested in __tests__/campaignFilter.test.ts.
 *
 * The filter never drops silently. A period change keeps ?campanha=, so the
 * campaign may have no row in the new window; a link may also name another
 * store's campaign. Both used to read as "no filter": the tab listed every ad
 * of the store ("362 anúncios com gasto ou venda") with nothing saying the
 * filter was gone, and it came back by itself on the next window. Now the
 * filter stays, the list shows none of the campaign's ads, and this says why.
 */

export interface CreativesFilter {
  /** Callout title: "Só os anúncios de "X"." */
  title: string
  /** Why the list is empty; null when the campaign has ads in the window. */
  note: string | null
  /** The tab without the filter. */
  clearHref: string
}

export function campaignFilterText(input: {
  /** The campaign's name when it is this store's; null for another store's
   *  campaign or an unknown id (its name is never shown: partner isolation). */
  name: string | null
  /** The campaign has a row (spend or sales) in the page's window. */
  inWindow: boolean
  storeName: string
  /** "hoje", "em 24 nov", "em 17–23 nov" (creativeVerdict noSpendWhen). */
  when: string
}): Pick<CreativesFilter, 'title' | 'note'> {
  if (input.name === null) {
    return {
      title: 'Filtro de campanha de outra loja.',
      note: `A campanha deste link não é da ${input.storeName}: nenhum anúncio dela aparece aqui.`,
    }
  }
  return {
    title: `Só os anúncios de "${input.name}".`,
    note: input.inWindow ? null : `A campanha não teve gasto nem venda ${input.when}.`,
  }
}
