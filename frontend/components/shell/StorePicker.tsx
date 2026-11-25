'use client'

/**
 * StorePicker — which store (or "Todas as lojas") the page shows.
 *
 * Changing it is an R4 link (lib/period carry): the same page with the chosen
 * store, the period kept AS ASKED (a preset stays a preset and resolves on the
 * new store's clock; leaving an archived store opens the default period), the
 * page keys that survive a store change, and `vem` so the landing page
 * announces any change of dates. A page of one store's object (/creatives/<ad>)
 * opens that store's list; Todas from a one-store page opens /overview. It
 * navigates inside a transition so the button shows a
 * spinner until the new page is there — never a silent stale page, never a
 * stuck "Trocando…". Once the chosen store is on screen it POSTs
 * /api/active-store { storeId } so this browser opens on that store next time
 * (a preference only: the URL wins, and the route re-checks access) — never
 * before: a choice still loading can be replaced, and the remembered store
 * must be the one that ended up shown. "Todas" is not remembered: that route
 * accepts a store id only.
 *
 * A choice made while another navigation is still loading (a period picked
 * during "abrindo…") is laid on top of the URL being opened (lib/period layer,
 * R13), so both choices stick.
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
 *   options     StoreOption[] — the viewer's active stores (plus an archived one on screen)
 *   all         { count: number } | null — the "Todas as lojas" entry
 *   currentId   the store id shown, or 'todas'
 *   archivedIds the viewer's archived stores (leaving one does not carry its period)
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { StoreOption } from '@/lib/views/page'
import { Avatar } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { layered, navigationInFlight, pickIsNoop } from './url'
import { useShellNavigation } from './useShellNavigation'
import s from './shell.module.css'

export interface StorePickerProps {
  options: StoreOption[]
  all: { count: number } | null
  currentId: string
  archivedIds?: readonly string[]
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

interface Entry { id: string; name: string; meta: string }

/**
 * The store picked last, to save as this browser's default once it is the
 * store on screen. Module scope: the picker that made the choice may be
 * replaced by the next page's picker before it lands (/overview → /).
 */
let rememberOnArrival: string | null = null
const rememberWhenShown = (storeId: string | null) => { rememberOnArrival = storeId }

const NOT_SAVED = 'A loja abriu, mas não ficou salva como padrão neste navegador.'

export function StorePicker({ options, all, currentId, archivedIds = [] }: StorePickerProps) {
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const nav = useShellNavigation()
  const pending = nav.pending
  const [error, setError] = useState<string | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const list = useRef<HTMLUListElement>(null)

  const entries: Entry[] = [
    ...(all ? [{ id: 'todas', name: 'Todas as lojas', meta: `${all.count} lojas · Brasília` }] : []),
    ...options.map(o => ({
      id: o.id, name: o.name,
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
    // A no-op only when both the latest requested scope and the page shown
    // agree with the pick (R13); "Todas" on a one-store page always opens
    // /overview (L53). Picking the store shown is not leaving (L59).
    const scope = e.id === 'todas' ? { kind: 'all' as const } : { kind: 'store' as const, id: e.id }
    if (pickIsNoop(scope)) return
    const href = layered({ kind: 'store', scope }, archivedIds)
    if (!mayLeave({ from: currentId || current?.id || '', to: e.id, href })) return
    nav.push(href)
    // Never Todas, never an archived store (R5).
    rememberWhenShown(e.id === 'todas' || archivedIds.includes(e.id) ? null : e.id)
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
