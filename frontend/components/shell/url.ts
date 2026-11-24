/**
 * Client-side URL glue for the shell's pickers. The state keys (loja, periodo,
 * de, ate, parte) are always computed on the SERVER by lib/views/page.ts
 * (ctx.hrefWith('', …) returns "?loja=…&periodo=…"), so the URL rules live in
 * one place; the client only merges that query with the page's own keys
 * (e.g. ?aba=criativos) and navigates. While a navigation is still loading,
 * the next choice is laid on top of the URL being opened (onTopOfInFlight),
 * so two quick choices add up instead of the second undoing the first.
 */

export const STATE_KEYS = ['loja', 'periodo', 'de', 'ate', 'parte'] as const
export type StateKey = (typeof STATE_KEYS)[number]

const isStateKey = (k: string) => (STATE_KEYS as readonly string[]).includes(k)

/**
 * Keys that report the result of one action (the OAuth round trips of
 * Shopify and Facebook) or that only exist to come back from it: `store` is
 * the old name of `loja` on those return URLs, `storeStartDate` rides along
 * from onboarding. They describe what just happened to ONE store, so they
 * never follow a picker: after linking Facebook on the MOKOO, picking Glooty
 * showed Glooty's Ajustes saying "Conta de anúncio ligada".
 */
export const ONE_SHOT_KEYS = [
  'shopify_connected', 'shopify_error', 'error', 'fb_connected', 'fb_extra_connected', 'fb_error', 'store', 'storeStartDate',
] as const

/**
 * Pages that show one object of one store (an ad). Another store has no such
 * object, so picking another store opens the list the object belongs to (with
 * the state kept), and the sidebar lights that list's item. Reloading the same
 * path under ?loja=<other> was a 404.
 */
export const DETAIL_ROUTES: readonly { prefix: string; list: string; nav: string }[] = [
  { prefix: '/creatives/', list: '/campaigns?aba=criativos', nav: '/campaigns' },
]

export function detailRoute(pathname: string): (typeof DETAIL_ROUTES)[number] | null {
  return DETAIL_ROUTES.find(r => pathname.startsWith(r.prefix)) ?? null
}

/** `stateQuery` ("?loja=x&periodo=today" or "") wins for the state keys; any
 *  other key of the current URL is kept, except the one-shot result flags.
 *  Returns "" or "?…". */
export function mergeQuery(stateQuery: string, currentSearch: string): string {
  const out = new URLSearchParams(stateQuery.startsWith('?') ? stateQuery.slice(1) : stateQuery)
  const cur = new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch)
  for (const [k, v] of cur) {
    if ((STATE_KEYS as readonly string[]).includes(k) || (ONE_SHOT_KEYS as readonly string[]).includes(k)) continue
    if (!out.has(k)) out.set(k, v)
  }
  const qs = out.toString()
  return qs ? `?${qs}` : ''
}

/** Path + merged query, for router.push. */
export function hrefFor(pathname: string, stateQuery: string): string {
  const search = typeof window === 'undefined' ? '' : window.location.search
  return `${pathname}${mergeQuery(stateQuery, search)}`
}

/**
 * Where the store picker goes from `pathname` with the server-built
 * `stateQuery` of the chosen store: the same page with its own keys, or, on a
 * detail page (DETAIL_ROUTES), the list it belongs to with the list's keys.
 * `currentSearch` defaults to the browser's.
 */
export function storeSwitchHref(pathname: string, stateQuery: string, currentSearch?: string): string {
  const d = detailRoute(pathname)
  if (d) {
    const q = d.list.indexOf('?')
    return q < 0 ? `${d.list}${mergeQuery(stateQuery, '')}` : `${d.list.slice(0, q)}${mergeQuery(stateQuery, d.list.slice(q))}`
  }
  const search = currentSearch ?? (typeof window === 'undefined' ? '' : window.location.search)
  return `${pathname}${mergeQuery(stateQuery, search)}`
}

/**
 * Whether picking `pickedId` in the store picker changes nothing. A store
 * counts as the current choice only when the URL names it: on a one-store
 * page opened from Todas (`carriedId` 'todas', lib/views/page carriedLoja) the
 * store on screen can still be picked, which pins it and ends the Todas the
 * sidebar was carrying. "Todas as lojas" is compared with what is shown, so
 * from there it still opens /overview. `opening` (inFlightParam('loja'): the
 * loja of a navigation still loading, null for none, undefined when nothing
 * loads) wins over both.
 */
export function pickIsNoop(pickedId: string, currentId: string, carriedId?: string, opening?: string | null): boolean {
  if (opening !== undefined) return pickedId === (opening ?? currentId)
  if (pickedId === 'todas') return currentId === 'todas'
  return pickedId === (carriedId ?? currentId)
}

// ─── A choice made while another one is still loading ────────────────────────
//
// Every control builds its URL from the state ON SCREEN (the server-built
// queries above). A page takes seconds to render, and a second control used
// meanwhile replaced the first navigation with a URL that still carried the
// old value of the first choice: Hibikura picked, then "7 dias" clicked while
// it said "abrindo…", opened EPOCH · 7 dias. So the shell remembers the URL
// it is opening, and a control used before it lands lays its own change on
// top of that URL instead of on the screen's.

/**
 * What a control changes in a navigation:
 *  keys  the state keys it sets (the others come from the URL being opened);
 *  page  who decides the page: 'target' — the control does (the store picker
 *        may open /overview or a creative's list; a sidebar link opens its
 *        page); 'base' — it stays on the page being opened (period, split).
 */
export interface NavLayer {
  keys: readonly StateKey[]
  page: 'base' | 'target'
}

export const NAV_LAYER = {
  store: { keys: ['loja'], page: 'target' },
  period: { keys: ['periodo', 'de', 'ate'], page: 'base' },
  split: { keys: ['parte'], page: 'base' },
  link: { keys: [], page: 'target' },
} as const satisfies Record<string, NavLayer>

/**
 * `target` (a URL built from the screen) rebuilt on top of `base` (the URL
 * being opened): the layer's keys from target, every other state key from
 * base, and the path, the page's own keys and the #hash from whichever owns
 * the page. A state key absent from its source stays absent (an absent
 * periodo is the default period). One-shot keys never survive.
 */
export function layerHref(base: string, target: string, layer: NavLayer): string {
  const b = new URL(base, 'http://x')
  const t = new URL(target, 'http://x')
  const page = layer.page === 'target' ? t : b
  const out = new URLSearchParams()
  for (const k of STATE_KEYS) {
    const v = ((layer.keys as readonly string[]).includes(k) ? t : b).searchParams.get(k)
    if (v !== null) out.set(k, v)
  }
  for (const [k, v] of page.searchParams) {
    if (isStateKey(k) || (ONE_SHOT_KEYS as readonly string[]).includes(k) || out.has(k)) continue
    out.set(k, v)
  }
  const qs = out.toString()
  return `${page.pathname}${qs ? `?${qs}` : ''}${page.hash}`
}

/**
 * How long a navigation counts as in flight at most. Only a safety net: the
 * control that started it clears it when it lands (useShellNavigation); this
 * keeps a navigation that never reported back (a redirect, a crash) from
 * steering a choice made minutes later.
 */
export const IN_FLIGHT_TTL_MS = 120_000

let inFlight: { href: string; token: number; at: number } | null = null
let lastToken = 0

/** A control starts opening `href`; returns the token that ends it. */
export function beginNavigation(href: string, now: number = Date.now()): number {
  inFlight = { href, token: ++lastToken, at: now }
  return inFlight.token
}

/** The navigation of `token` landed (or its control left the screen). A
 *  token replaced by a newer navigation changes nothing. */
export function endNavigation(token: number): void {
  if (inFlight?.token === token) inFlight = null
}

/** The URL being opened, or null when the screen is up to date. */
export function navigationInFlight(now: number = Date.now()): string | null {
  if (inFlight && now - inFlight.at > IN_FLIGHT_TTL_MS) inFlight = null
  return inFlight?.href ?? null
}

/** `target` laid on top of the URL being opened (layerHref), or `target`
 *  itself when nothing is loading. */
export function onTopOfInFlight(target: string, layer: NavLayer, now: number = Date.now()): string {
  const base = navigationInFlight(now)
  return base === null ? target : layerHref(base, target, layer)
}

/** A state key of the URL being opened: its value, null when that URL has
 *  none (for periodo: the default period), undefined when nothing is loading. */
export function inFlightParam(key: StateKey, now: number = Date.now()): string | null | undefined {
  const base = navigationInFlight(now)
  return base === null ? undefined : new URL(base, 'http://x').searchParams.get(key)
}
