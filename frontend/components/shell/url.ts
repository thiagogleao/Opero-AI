/**
 * Client-side glue for the shell's controls. The URL rules themselves live in
 * lib/period/url (desktopHref, layer, the four key lists): this file only keeps
 * the URL being opened (the in-flight registry) and lays each control's change
 * on top of it at click time (R13), so two quick choices add up instead of the
 * second undoing the first.
 */

import { layer, pickIsNoop as periodPickIsNoop, relayLink, type LayerLink, type ScopeRef } from '@/lib/period'
import { pageScope as pageScopeOf } from '@/lib/period/url'

export {
  DETAIL_ROUTES, detailRoute, STORE_ONLY_ROUTES, STATE_KEYS, ONE_SHOT_KEYS, LEGACY_KEYS, PAGE_KEYS, pageScope,
} from '@/lib/period/url'

export function isStoreOnlyPath(pathname: string): boolean {
  return pageScopeOf(pathname) === 'store'
}


/**
 * How long a navigation counts as in flight at most. Only a safety net: the
 * control that started it clears it when it lands (useShellNavigation).
 */
export const IN_FLIGHT_TTL_MS = 120_000

let inFlight: { href: string; token: number; at: number } | null = null
let lastToken = 0

/** A control starts opening `href`; returns the token that ends it. */
export function beginNavigation(href: string, now: number = Date.now()): number { // clock-ok: in-flight TTL, not a period
  inFlight = { href, token: ++lastToken, at: now }
  return inFlight.token
}

/** The navigation of `token` landed (or its control left the screen). */
export function endNavigation(token: number): void {
  if (inFlight?.token === token) inFlight = null
}

/** The URL being opened, or null when the screen is up to date. */
export function navigationInFlight(now: number = Date.now()): string | null { // clock-ok: in-flight TTL, not a period
  if (inFlight && now - inFlight.at > IN_FLIGHT_TTL_MS) inFlight = null
  return inFlight?.href ?? null
}

/** The latest REQUESTED URL: the one being opened, else the one on screen. */
export function latestHref(): string {
  const opening = navigationInFlight()
  if (opening !== null) return opening
  return typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`
}

/** The viewer's archived stores, registered by the shell (leaving one does
 *  not carry its period, R4/R10). */
let archived: readonly string[] = []
export function registerArchived(ids: readonly string[]): void {
  archived = ids
}

/** `link` applied over the latest requested URL (lib/period layer). */
export function layered(link: LayerLink, archivedIds: readonly string[] = archived): string {
  return layer(latestHref(), link, { archivedIds, inFlight: navigationInFlight() !== null })
}

/** The URL on screen (the page whose links are being clicked). */
function shownHref(): string {
  return typeof window === 'undefined' ? '/' : `${window.location.pathname}${window.location.search}`
}

/**
 * A rendered period-aware href (a Todas row, a tab, an in-page drill-down)
 * applied over the latest requested URL at click time (lib/period relayLink +
 * layer, R13): a period, split or store still loading is kept. An href that
 * is not a desktop page link is returned as written.
 */
export function relayed(href: string): string {
  const link = relayLink(href, shownHref(), { archivedIds: archived })
  return link ? layered(link) : href
}

/** Picking `scope` changes nothing (lib/period pickIsNoop on the latest URL). */
export function pickIsNoop(scope: ScopeRef): boolean {
  return periodPickIsNoop(scope, latestHref())
}

/** A state key of the URL being opened: its value, null when that URL has
 *  none, undefined when nothing is loading. */
export function inFlightParam(key: string, now: number = Date.now()): string | null | undefined { // clock-ok: in-flight TTL
  const base = navigationInFlight(now)
  return base === null ? undefined : new URL(base, 'http://x').searchParams.get(key)
}
