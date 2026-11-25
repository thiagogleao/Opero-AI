import { defaultPeriod, desktopHref, layer, parsePeriod, sameScope, selectionFromUrl, vemFor } from '@/lib/period'

/**
 * Which links an AI answer may carry: only pages of this app.
 *
 * Model output can be steered by text a shopper wrote (an order note, a
 * product title), so an answer must not be able to send the browser anywhere:
 * no other site, no `javascript:`, no protocol-relative `//host`, no API route
 * (a GET there could act on the viewer's cookie). Anything else is rendered as
 * plain text by SafeMarkdown.
 */

/** First path segments of the app's pages ('' is the root, Resumo). */
const PAGES = new Set(['', 'overview', 'campaigns', 'products', 'countries', 'attribution', 'profit', 'settings', 'creatives', 'm'])
/** Pages that exist only with an id after them (/creatives alone is a 404). */
const NEEDS_ID = new Set(['creatives'])

/** The href when it is a page of this app, otherwise null. */
export function internalHref(url: string | null | undefined): string | null {
  if (typeof url !== 'string') return null
  const u = url.trim()
  // Same-origin absolute paths only: "/x", never "//host" or "/\host".
  if (!u.startsWith('/') || u.startsWith('//') || u.startsWith('/\\')) return null
  // Control characters and backslashes can make a browser read another host.
  if (/[\u0000-\u001f\u007f\\]/.test(u)) return null
  const path = u.split(/[?#]/, 1)[0]
  // Check the path the browser will really open, not the raw text: dot
  // segments ("/campaigns/../api/…", "/m/%2e%2e/api/…") pass a first-segment
  // check and are then resolved by the browser and <Link> into an API route.
  // Any path the URL parser rewrites (dot segments, characters it re-encodes)
  // is refused rather than guessed at.
  // An encoded dot, slash or backslash has no use in a page link and may be
  // decoded by a later hop ("/overview/..%2fapi/export").
  if (/%(2e|2f|5c)/i.test(path)) return null
  let resolved: URL
  try { resolved = new URL(u, 'http://app.invalid') } catch { return null }
  if (resolved.origin !== 'http://app.invalid' || resolved.pathname !== path) return null
  const [, first = '', second = ''] = path.split('/')
  if (!PAGES.has(first)) return null
  if (NEEDS_ID.has(first) && !second) return null
  return u
}

/**
 * An app link from an answer, carrying the store the conversation is about
 * and the period on screen (lib/period desktopHref, R3): a bare "/campaigns"
 * would open the campaigns of the browser's default store. The store is
 * `storeId` (the conversation's), not the address's `loja`: on "Todas" the
 * conversation is about the store picked in the drawer. The period travels
 * as asked (a preset stays a preset) unless the link names its own; legacy and
 * unknown keys of the address never reach the link. The phone (/m) has its own
 * state and is left alone.
 *
 * Same scope as the address → an R3 link (no vem). Another scope → an R4
 * link through lib/period `layer` (carry): it writes `vem`, so the landing
 * page announces other dates, and leaving an archived store does not carry
 * its archive-tail dates (`archivedIds`: the viewer's archived stores).
 */
export function withPageState(href: string, currentSearch: string, storeId: string | null = null, archivedIds: readonly string[] = []): string {
  const hashAt = href.indexOf('#')
  const noHash = hashAt >= 0 ? href.slice(0, hashAt) : href
  const [path, query = ''] = noHash.split('?', 2)
  if (path === '/m' || path.startsWith('/m/')) return href
  const own = new URLSearchParams(query)
  const cur = selectionFromUrl(`/?${currentSearch.replace(/^\?/, '')}`).selection
  const ownPeriod = parsePeriod({ periodo: own.get('periodo'), de: own.get('de'), ate: own.get('ate') }).value
  // A store the link names itself wins; else the conversation's store; else
  // the address's scope.
  const ownLoja = own.get('loja')
  const scope = ownLoja === 'todas' ? { kind: 'all' as const }
    : ownLoja && /^[A-Za-z0-9_-]{1,64}$/.test(ownLoja) ? { kind: 'store' as const, id: ownLoja }
      : storeId && /^[A-Za-z0-9_-]{1,64}$/.test(storeId) ? { kind: 'store' as const, id: storeId }
        : cur?.scope ?? { kind: 'all' as const }
  const sel = {
    scope,
    period: ownPeriod ?? cur?.period ?? defaultPeriod('desktop'),
    split: own.has('parte') ? own.get('parte') === '50' : cur?.split ?? false,
  }
  // Nothing names a store (no address state, no conversation store): the
  // bare link, which opens the remembered store.
  if (!cur && !storeId && !ownLoja && !ownPeriod) return href
  const otherScope = !!cur && !sameScope(cur.scope, scope)
  // The link names its own period: the owner's explicit choice (R3), with vem
  // when it changes the scope.
  if (ownPeriod) return desktopHref(href, sel, {}, { vem: vemFor(cur, sel, id => archivedIds.includes(id)) })
  // Another scope: R4, the same path every store link takes (R13 layer).
  if (otherScope) return layer(`/?${currentSearch.replace(/^\?/, '')}`, { kind: 'page', path: href, scope }, { archivedIds })
  // An R3 link (spec R3: the AI's links keep the selection): no vem.
  return desktopHref(href, sel)
}
