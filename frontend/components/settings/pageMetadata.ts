import 'server-only'

import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { AccessError, getViewer, requireStore } from '@/lib/access'
import type { SearchParams } from '@/lib/views/page'
import { askedStoreId } from './storeParam'

/**
 * generateMetadata for a page that opens one store from ?loja (or, with
 * `legacyStoreKey`, the older ?store): the tab title, and the 404 title for a
 * store the viewer cannot see.
 *
 * Why the store is checked here as well as in the page: the root loading.tsx
 * starts streaming before the page runs, so the page's own notFound() comes
 * after the <title> is already out — the tab kept "Custos · Opero" over the
 * "não encontramos" card. Next swaps in the not-found convention's metadata
 * only when generateMetadata itself throws notFound()
 * (next/dist/lib/metadata/metadata.js, getNotFoundMetadata). Any other
 * failure is left to the page, which has its own error states.
 */
export function storePageMetadata(title: string, opts: { legacyStoreKey?: boolean } = {}) {
  return async function generateMetadata({ searchParams }: { searchParams: Promise<SearchParams> }): Promise<Metadata> {
    const sp = await searchParams
    const id = askedStoreId(sp, opts)
    if (id) {
      let missing = false
      try {
        const viewer = await getViewer()
        if (viewer) await requireStore(viewer, id)
      } catch (err) {
        missing = err instanceof AccessError
      }
      if (missing) notFound()
    }
    return { title }
  }
}
