'use client'

/**
 * StorePicker — which store (or "Todas as lojas") the page shows.
 *
 * Changing it navigates to the same page with ?loja=<id> (every other state
 * key and the page's own keys kept), inside a transition so the button shows a
 * spinner until the new page is there — never a silent stale page, never a
 * stuck "Trocando…". It also POSTs /api/active-store { storeId } so this
 * browser opens on that store next time (a preference only: the URL wins, and
 * the route re-checks access). "Todas" is not remembered: that route accepts a
 * store id only.
 *
 * Accessible listbox: Enter/Space/↓ opens, ↑/↓/Home/End move, Enter picks,
 * Esc closes and returns focus.
 *
 * Props (built by AppShell from the page context):
 *   options   (StoreOption & { query: string; href?: string })[] — query = ctx.hrefWith('', { loja: id });
 *             href (optional) = a full path+query to open instead of the same page
 *             (AppShell sets it on /overview, which cannot show one store)
 *   all       { query: string; count: number; href?: string } | null — the "Todas as lojas"
 *             entry (href set on one-store pages: it opens /overview)
 *   currentId the store id shown, or 'todas'
 */

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from 'react'
import type { StoreOption } from '@/lib/views/page'
import { Avatar } from '@/components/ui/Card'
import { Icon } from '@/components/ui/Icon'
import { hrefFor } from './url'
import s from './shell.module.css'

export interface StorePickerProps {
  options: (StoreOption & { query: string; href?: string })[]
  all: { query: string; count: number; href?: string } | null
  currentId: string
}

interface Entry { id: string; name: string; meta: string; query: string; href?: string }

export function StorePicker({ options, all, currentId }: StorePickerProps) {
  const router = useRouter()
  const pathname = usePathname() || '/'
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [pending, startTransition] = useTransition()
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
    if (e.id === currentId) return
    // Another page (href) starts clean; the same page keeps its own keys.
    startTransition(() => { router.push(e.href ?? hrefFor(pathname, e.query)) })
    if (e.id !== 'todas') {
      fetch('/api/active-store', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ storeId: e.id }), keepalive: true,
      })
        .then(r => { if (!r.ok) setError('A loja abriu, mas não ficou salva como padrão neste navegador.') })
        .catch(() => setError('A loja abriu, mas não ficou salva como padrão neste navegador.'))
    }
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
