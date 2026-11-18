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
  const [, first = '', second = ''] = path.split('/')
  if (!PAGES.has(first)) return null
  if (NEEDS_ID.has(first) && !second) return null
  return u
}

/** The desktop site's page state in the URL (lib/views/page.ts). */
const PAGE_STATE = ['loja', 'periodo', 'de', 'ate', 'parte'] as const

/**
 * An app link from an answer, carrying the store and period on screen: a bare
 * "/campaigns" would open the campaigns of the browser's default store, not
 * the store the conversation is about. Keys the link already has win; the
 * phone (/m) has its own state and is left alone.
 */
export function withPageState(href: string, currentSearch: string): string {
  const hashAt = href.indexOf('#')
  const hash = hashAt >= 0 ? href.slice(hashAt) : ''
  const noHash = hashAt >= 0 ? href.slice(0, hashAt) : href
  const [path, query = ''] = noHash.split('?', 2)
  if (path === '/m' || path.startsWith('/m/')) return href
  const out = new URLSearchParams(query)
  const current = new URLSearchParams(currentSearch)
  for (const k of PAGE_STATE) {
    const v = current.get(k)
    if (v !== null && !out.has(k)) out.set(k, v)
  }
  const qs = out.toString()
  return `${path}${qs ? `?${qs}` : ''}${hash}`
}
