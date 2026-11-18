'use client'

/**
 * ShellFrame and MenuButton — the client half of the app shell: the frame
 * grid, the skip link, and the drawer that holds the sidebar on narrow
 * screens (closes on navigation, on Esc and on the backdrop). AppShell is the
 * component pages use; these two are internal to the shell.
 */

import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { Icon } from '@/components/ui/Icon'
import s from './shell.module.css'

const MenuCtx = createContext<{ open: boolean; toggle: () => void }>({ open: false, toggle: () => {} })

export function ShellFrame({ sidebar, children }: { sidebar: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  // Close the drawer when the page changes (state derived during render,
  // not in an effect).
  const [shownPath, setShownPath] = useState(pathname)
  if (pathname !== shownPath) { setShownPath(pathname); setOpen(false) }
  useEffect(() => {
    if (!open) return
    // Keyboard users land inside the drawer, and Esc brings them back to the
    // button that opened it.
    document.getElementById('menu-lateral')?.querySelector<HTMLElement>('a[href], button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      // A list inside the drawer (the store picker) handles its own Esc first.
      if (e.key !== 'Escape' || e.defaultPrevented) return
      setOpen(false)
      document.querySelector<HTMLElement>('[aria-controls="menu-lateral"]')?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <MenuCtx.Provider value={{ open, toggle: () => setOpen(o => !o) }}>
      <div className={s.frame} data-open={open || undefined}>
        <a href="#conteudo" className={s.skip}>Pular para o conteúdo</a>
        <aside className={s.side} id="menu-lateral" aria-label="Menu">{sidebar}</aside>
        {open && <button type="button" className={s.backdrop} aria-label="Fechar menu" onClick={() => setOpen(false)} />}
        <div className={s.main}>{children}</div>
      </div>
    </MenuCtx.Provider>
  )
}

export function MenuButton() {
  const { open, toggle } = useContext(MenuCtx)
  return (
    <button
      type="button"
      className={`${s.menuBtn} ${s.pBtn}`}
      aria-label={open ? 'Fechar menu' : 'Abrir menu'}
      aria-expanded={open}
      aria-controls="menu-lateral"
      onClick={toggle}
    >
      <Icon name={open ? 'x' : 'menu'} size={18} />
    </button>
  )
}
