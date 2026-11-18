/**
 * The one line every config screen shows for an archived store: it is kept
 * for consultation only (owner decision), so the screen is read-only and the
 * server refuses any change (409 store_archived). Restoring it in Ajustes →
 * Lojas is the way back to editing.
 *
 * Presentational only (no server or client APIs): used by server pages and by
 * the client cost editor alike.
 */

import Link from 'next/link'
import { Callout } from '@/components/ui'

export function ArchivedNote({ name, restoreHref, what = 'nada nela pode ser alterado' }: {
  name: string
  /** Where "desarquive" points (Ajustes → Lojas of this store); omitted when already there. */
  restoreHref?: string
  /** What is read-only here, for the sentence ("os custos não podem ser alterados"). */
  what?: string
}) {
  return (
    <Callout tone="neu" icon="lock" title={`${name} está arquivada: só consulta`}>
      Lojas arquivadas mostram o histórico, mas {what}. Para editar, desarquive a loja em{' '}
      {restoreHref ? <Link href={restoreHref}>Ajustes → Lojas</Link> : <a href="#lojas">Lojas, abaixo</a>}.
    </Callout>
  )
}
