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
 * The desktop site's page state in the URL (lib/views/page.ts). `volta` rides
 * with row dates (PageParams.volta): without it an answer link opened a
 * store row's "Hoje" as a frozen "Período escolhido" that kept those dates the
 * next day; with it settleRowDates brings the preset back once the dates are
 * no longer it.
 */
const PAGE_STATE = ['loja', 'periodo', 'de', 'ate', 'volta', 'parte'] as const
/** The keys `volta` belongs to: a link that sets any of them has its own
 *  window, and the address's volta would turn its dates into that preset. */
const WINDOW_KEYS = ['periodo', 'de', 'ate'] as const

/**
 * An app link from an answer, carrying the store the conversation is about
 * and the period on screen: a bare "/campaigns" would open the campaigns of
 * the browser's default store. The store is `storeId` (the conversation's),
 * not the address's `loja`: on "Todas" the conversation is about the store
 * picked in the drawer, while the address says loja=todas — or, after the
 * sidebar link from a store's Resumo, that previous store's id — so an answer
 * about Glooty linked to MOKOO's campaigns. Keys the link already has win; the
 * phone (/m) has its own state and is left alone.
 */
export function withPageState(href: string, currentSearch: string, storeId: string | null = null): string {
  const hashAt = href.indexOf('#')
  const hash = hashAt >= 0 ? href.slice(hashAt) : ''
  const noHash = hashAt >= 0 ? href.slice(0, hashAt) : href
  const [path, query = ''] = noHash.split('?', 2)
  if (path === '/m' || path.startsWith('/m/')) return href
  const out = new URLSearchParams(query)
  const current = new URLSearchParams(currentSearch)
  const ownWindow = WINDOW_KEYS.some(k => out.has(k))
  for (const k of PAGE_STATE) {
    if (k === 'volta' && ownWindow) continue
    const v = k === 'loja' && storeId ? storeId : current.get(k)
    if (v !== null && !out.has(k)) out.set(k, v)
  }
  const qs = out.toString()
  return `${path}${qs ? `?${qs}` : ''}${hash}`
}
