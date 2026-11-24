import { ALL_STORES, type PageContext, type SearchParams } from '@/lib/views/page'

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

const ADD_STORE_PATH = '/onboarding?addStore=true'

/**
 * Ajustes' "Adicionar loja" link: /onboarding?addStore=true with the page's
 * period (and parte). A store id never travels: onboarding reads ?loja=<id> as
 * the store being connected and would carry on with that store's setup. Todas
 * does, when Ajustes was opened from it (ctx.fromAll): onboarding reads it as no
 * store (askedStoreId) and its "Voltar para Ajustes" keeps it, so the round
 * trip comes back to Todas. Dropping it there sent the person back to the
 * remembered store, and the sidebar stopped carrying Todas.
 */
export function addStoreHref(ctx: Pick<PageContext, 'fromAll' | 'hrefWith' | 'navHref'>): string {
  return ctx.fromAll ? ctx.navHref(ADD_STORE_PATH) : ctx.hrefWith(ADD_STORE_PATH, { loja: null })
}
