import { ALL_STORES, type SearchParams } from '@/lib/views/page'

const first = (v: string | string[] | undefined): string | null => {
  const s = (Array.isArray(v) ? v[0] : v)?.trim()
  return s ? s : null
}

/**
 * The one store a settings page is asked to open: ?loja, or with
 * `legacyStoreKey` the older ?store (links and OAuth callbacks made before the
 * site used ?loja). Trimmed; null when none is named.
 *
 * 'todas' is null too: every page carries the site's "Todas as lojas" in
 * ?loja, and these pages read it as "no store named" (the remembered store, or
 * a new connection on /onboarding), never as an id to 404 on. One function for
 * the page and its generateMetadata (./pageMetadata), so the tab title and the
 * page always agree on whether the store exists.
 */
export function askedStoreId(sp: SearchParams, opts: { legacyStoreKey?: boolean } = {}): string | null {
  const id = first(sp.loja) ?? (opts.legacyStoreKey ? first(sp.store) : null)
  return id && id !== ALL_STORES ? id : null
}
