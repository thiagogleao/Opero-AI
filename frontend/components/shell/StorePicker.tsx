'use client'

/**
 * StorePicker — which store (or "Todas as lojas") the page shows.
 *
 * Changing it navigates to the same page with ?loja=<id> (every other state
 * key and the page's own keys kept, one-shot result flags dropped; a page of
 * one store's object, like /creatives/<ad>, opens that store's list instead —
 * see ./url storeSwitchHref), inside a transition so the button shows a
 * spinner until the new page is there — never a silent stale page, never a
 * stuck "Trocando…". Once the chosen store is on screen it POSTs
 * /api/active-store { storeId } so this browser opens on that store next time
 * (a preference only: the URL wins, and the route re-checks access) — never
 * before: a choice still loading can be replaced, and the remembered store
 * must be the one that ended up shown. "Todas" is not remembered: that route
 * accepts a store id only.
 *
 * A choice made while another navigation is still loading (a period picked
 * during "abrindo…") is laid on top of the URL being opened (./url
 * onTopOfInFlight), so both choices stick.
 *
 * Accessible listbox: Enter/Space/↓ opens, ↑/↓/Home/End move, Enter picks,
 * Esc closes and returns focus.
 *
 * Leaving with unsaved work: before navigating, the picker dispatches a
 * cancelable `window` CustomEvent 'opero:before-store-change' (BEFORE_STORE_CHANGE)
 * with detail { from, to, href } — store ids ('todas' for Todas as lojas) and the
 * URL it is about to open. If any listener calls preventDefault(), nothing
 * happens: no navigation, no "remember this store". The page can then ask and,
 * if the user agrees, open detail.href itself:
 *
 *   useEffect(() => {
 *     const onLeave = (e: Event) => { if (dirty) e.preventDefault() }
 *     window.addEventListener(BEFORE_STORE_CHANGE, onLeave)
 *     return () => window.removeEventListener(BEFORE_STORE_CHANGE, onLeave)
 *   }, [dirty])
 *
 * The listener must decide synchronously (no await before preventDefault).
 *
 * Props (built by AppShell from the page context):
 *   options   (StoreOption & { query: string; href?: string })[] — query = ctx.hrefWith('', { loja: id });
 *             href (optional) = a full path+query to open instead of the same page
 *             (AppShell sets it on /overview, which cannot show one store)
 *   all       { query: string; count: number; href?: string } | null — the "Todas as lojas"
 *             entry (href set on one-store pages: it opens /overview)
 *   currentId the store id shown, or 'todas'
 *   carriedId the URL's ?loja when it is not the store shown ('todas' on a one-store
 *             page opened from Todas): picking the shown store then pins it (./url pickIsNoop)
 */

import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { StoreOption } from '@/lib/views/page'
import { Avatar } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { inFlightParam, navigationInFlight, NAV_LAYER, onTopOfInFlight, pickIsNoop, storeSwitchHref } from './url'
import { useShellNavigation } from './useShellNavigation'
import s from './shell.module.css'

export interface StorePickerProps {
  options: (StoreOption & { query: string; href?: string })[]
  all: { query: string; count: number; href?: string } | null
  currentId: string
  /** The ?loja the URL carries when it is not the store shown: 'todas' on a
   *  one-store page opened from Todas (it shows the remembered store). Picking
   *  that very store then still navigates, to ?loja=<id>, so the choice sticks
   *  and the sidebar stops carrying Todas. */
  carriedId?: string
}

/** Cancelable window event sent before the picker opens another store. */
export const BEFORE_STORE_CHANGE = 'opero:before-store-change'

export interface BeforeStoreChangeDetail {
  /** Store id shown now ('todas' for Todas as lojas). */
  from: string
  /** Store id about to open ('todas' for Todas as lojas). */
  to: string
  /** The path + query the picker would open. */
  href: string
}

/** True when no listener vetoed the change (preventDefault). */
function mayLeave(detail: BeforeStoreChangeDetail): boolean {
  return window.dispatchEvent(new CustomEvent<BeforeStoreChangeDetail>(BEFORE_STORE_CHANGE, { detail, cancelable: true }))
}

interface Entry { id: string; name: string; meta: string; query: string; href?: string }

/**
 * The store picked last, to save as this browser's default once it is the
 * store on screen. Module scope: the picker that made the choice may be
 * replaced by the next page's picker before it lands (/overview → /).
 */
let rememberOnArrival: string | null = null
const rememberWhenShown = (storeId: string | null) => { rememberOnArrival = storeId }

const NOT_SAVED = 'A loja abriu, mas não ficou salva como padrão neste navegador.'

export function StorePicker({ options, all, currentId, carriedId }: StorePickerProps) {
  const pathname = usePathname() || '/'
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const nav = useShellNavigation()
  const pending = nav.pending
  const [error, setError] = useState<string | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const entries: Entry[] = [
    ...(all ? [{ id: 'todas', name: 'Todas as lojas', meta: `${all.count} lojas · Brasília`, query: all.query, href: all.href }] : []),
    ...options.map(o => ({
      id: o.id, name: o.name, query: o.query, href: o.href,
      // A disambiguated name already ends with the code ("Dumpling Squishy · 8jcp3a").
      meta: [o.code && !o.name.endsWith(o.code) ? o.code : null, o.city, o.archived ? 'arquivada' : null].filter(Boolean).join(' · '),
    })),
  ]
  const current = entries.find(e => e.id === currentId) ?? entries[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!list.current?.contains(t) && !btn.current?.contains(t)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    if (open) list.current?.focus()
  }, [open])

  // Save the default only for the store that ended up on screen.
  useEffect(() => {
    if (pending || rememberOnArrival === null) return
    if (rememberOnArrival !== currentId) {
      // Landed elsewhere (browser back, a newer choice): forget it — unless a
      // navigation is still loading, which may yet bring the store.
      if (navigationInFlight() === null) rememberOnArrival = null
      return
    }
    const storeId = rememberOnArrival
    rememberOnArrival = null
    fetch('/api/active-store', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId }), keepalive: true,
    })
      .then(r => { if (!r.ok) setError(NOT_SAVED) })
      .catch(() => setError(NOT_SAVED))
  }, [pending, currentId])

  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 6000)
    return () => clearTimeout(t)
  }, [error])

  function openList() {
    setActive(Math.max(0, entries.findIndex(e => e.id === currentId)))
    setOpen(true)
  }

  function pick(e: Entry) {
    setOpen(false)
    btn.current?.focus()
    // While another choice is loading, the store that counts is the one being
    // opened: picking the store still on screen then takes the choice back.
    // On a one-store page opened from Todas, the store on screen is not yet a
    // choice (pickIsNoop): picking it pins it.
    if (pickIsNoop(e.id, currentId, carriedId, inFlightParam('loja'))) return
    // Another page (href) starts clean; the same page keeps its own keys,
    // except on a page of one store's object (an ad), which opens that list
    // of the chosen store instead (./url DETAIL_ROUTES). A period or split
    // still loading is kept (onTopOfInFlight).
    const href = onTopOfInFlight(e.href ?? storeSwitchHref(pathname, e.query), NAV_LAYER.store)
    if (!mayLeave({ from: currentId || current?.id || '', to: e.id, href })) return
    nav.push(href)
    rememberWhenShown(e.id === 'todas' ? null : e.id)
  }

  function onButtonKey(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openList() }
  }

  function onListKey(e: KeyboardEvent<HTMLUListElement>) {
    const n = entries.length
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % n) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + n) % n) }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0) }
    else if (e.key === 'End') { e.preventDefault(); setActive(n - 1) }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(entries[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus() }
    else if (e.key === 'Tab') setOpen(false)
  }

  if (!current) return null

  return (
    <div className={s.picker}>
      <button
        ref={btn}
        type="button"
        className={s.pickBtn}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`Loja: ${current.name}. Trocar de loja`}
        aria-busy={pending || undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onButtonKey}
        title={current.name}
      >
        {current.id === 'todas'
          ? <span className={s.brandMark} style={{ width: 28, height: 28 }}><Icon name="all" size={16} /></span>
          : <Avatar name={current.name} />}
        <span className={s.pickText}>
          <span className={s.pickName}>{current.name}</span>
          <span className={s.pickSub}>{pending ? 'abrindo…' : current.meta}</span>
        </span>
        {pending ? <span className={s.spin} aria-hidden="true" /> : <Icon name="swap" size={15} className={s.pickIcon} />}
      </button>
      {open && (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Escolha a loja"
          aria-activedescendant={`${listId}-${active}`}
          tabIndex={-1}
          className={s.list}
          onKeyDown={onListKey}
        >
          {entries.map((e, i) => (
            <li key={e.id} role="presentation" className={e.id === 'todas' && entries.length > 1 ? s.allRow : undefined}>
              <div
                id={`${listId}-${i}`}
                role="option"
                aria-selected={e.id === currentId}
                data-active={i === active || undefined}
                className={s.option}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(e)}
              >
                {e.id === 'todas' ? <Icon name="all" size={15} /> : <Avatar name={e.name} size="sm" />}
                <span className={s.optText}>
                  <span className={s.optName}>{e.name}</span>
                  <span className={s.optMeta}>{e.meta}</span>
                </span>
                {e.id === currentId && <Icon name="check" size={13} className={s.optCheck} />}
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <div className={s.pickError} role="status">{error}</div>}
    </div>
  )
}
