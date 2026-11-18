'use client'

/**
 * NavLinks — the sidebar navigation, with the active item from the pathname
 * (aria-current="page"). Hrefs come from the server already carrying
 * loja/periodo/parte (ctx.hrefWith), so moving between pages keeps the store
 * and the period. Internal to the shell (AppShell builds the items).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon, type IconName } from '@/components/ui/Icon'
import s from './shell.module.css'

export interface NavItem {
  href: string
  label: string
  icon: IconName
  /** Path that marks it active: exact for "/", prefix for the others. */
  match: string
}

export function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname() || '/'
  const isActive = (m: string) => (m === '/' ? pathname === '/' : pathname === m || pathname.startsWith(`${m}/`))
  return (
    <nav className={s.nav} aria-label="Páginas">
      {items.map(it => (
        <Link
          key={it.match}
          href={it.href}
          className={s.navLink}
          aria-current={isActive(it.match) ? 'page' : undefined}
          title={it.label}
        >
          <Icon name={it.icon} size={16} />
          <span className={s.navText}>{it.label}</span>
        </Link>
      ))}
    </nav>
  )
}
