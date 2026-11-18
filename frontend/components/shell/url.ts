/**
 * Client-side URL glue for the shell's pickers. The state keys (loja, periodo,
 * de, ate, parte) are always computed on the SERVER by lib/views/page.ts
 * (ctx.hrefWith('', …) returns "?loja=…&periodo=…"), so the URL rules live in
 * one place; the client only merges that query with the page's own keys
 * (e.g. ?aba=criativos) and navigates.
 */

export const STATE_KEYS = ['loja', 'periodo', 'de', 'ate', 'parte'] as const

/** `stateQuery` ("?loja=x&periodo=today" or "") wins for the state keys; any
 *  other key of the current URL is kept. Returns "" or "?…". */
export function mergeQuery(stateQuery: string, currentSearch: string): string {
  const out = new URLSearchParams(stateQuery.startsWith('?') ? stateQuery.slice(1) : stateQuery)
  const cur = new URLSearchParams(currentSearch.startsWith('?') ? currentSearch.slice(1) : currentSearch)
  for (const [k, v] of cur) {
    if ((STATE_KEYS as readonly string[]).includes(k)) continue
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
