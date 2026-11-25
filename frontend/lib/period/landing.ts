/**
 * The notes a page shows when it lands (R4, R5, R9, R15): the one-shot
 * `ajuste=` codes filled with this page's own values, and the scope-change
 * announcement computed at THIS page's render instant from `vem` (so a link
 * tapped across Tokyo midnight, or from a stale tab, is still announced).
 */

import { announce, sameScope } from './carry'
import { findStore } from './resolve'
import type { Note, Resolution, ScopeRef, ViewerStores } from './types'

export function landingNotes(
  urlNotes: readonly Note[], cameFrom: ScopeRef | null, r: Resolution, viewer: ViewerStores, now: Date,
): Note[] {
  const sel = r.selection
  const shownName = sel.scope.kind === 'all' ? 'Todas as lojas' : findStore(viewer, sel.scope.id)?.name ?? 'esta loja'
  const out: Note[] = urlNotes.map(n => {
    switch (n.code) {
      case 'bad_param':
      case 'incomplete':
        return { code: n.code, params: { period: r.label.short } }
      case 'too_long':
        return { code: n.code, params: { range: r.label.range, window: r.label.range } }
      case 'floor':
        return { code: n.code, params: { window: r.label.range } }
      case 'remembered_gone': {
        // Named when the viewer still has it (R5 ex. 4: archived since).
        const was = typeof n.params?.storeId === 'string' ? findStore(viewer, n.params.storeId)?.name : undefined
        return { code: n.code, params: was ? { store: was, other: shownName } : { other: shownName } }
      }
      case 'single_store':
        return { code: n.code, params: { store: shownName } }
      default:
        return n
    }
  })
  if (cameFrom && !sameScope(cameFrom, sel.scope)) {
    const src = cameFrom.kind === 'store' ? findStore(viewer, cameFrom.id) : null
    if (src?.archivedOn) out.push({ code: 'left_archive', params: { period: r.label.short } })
    else {
      const a = announce(sel, cameFrom, sel.scope, viewer, now)
      if (a) out.push({ code: 'scope_dates_differ', params: a.absorbs.length ? { text: a.landing, absorbs: a.absorbs.join(',') } : { text: a.landing } })
    }
  }
  return out
}
