'use client'

/**
 * NavLinks — the sidebar navigation, with the active item from the pathname
 * (aria-current="page"). Hrefs come from the server already carrying
 * loja/periodo/parte (ctx.hrefWith), so moving between pages keeps the store
 * and the period. Internal to the shell (AppShell builds the items).
 *
 * A click opens the page through the shell's navigation (./useShellNavigation):
 * a store or period still loading is kept (the link's page with the state
 * being opened, ./url onTopOfInFlight), and a picker used while this page
 * loads is laid on top of it. Ctrl/Cmd-click still opens a new tab with the
 * plain href (Link's onNavigate only runs for in-app navigation).
 */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon, type IconName } from '@/components/ui/Icon'
import { detailRoute, NAV_LAYER, onTopOfInFlight } from './url'
import { useShellNavigation } from './useShellNavigation'
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
  const nav = useShellNavigation()
  // A page of one object (/creatives/<ad>) lights the list it belongs to.
  const listOf = detailRoute(pathname)?.nav ?? null
  const isActive = (m: string) => m === listOf || (m === '/' ? pathname === '/' : pathname === m || pathname.startsWith(`${m}/`))
  return (
    <nav className={s.nav} aria-label="Páginas" aria-busy={nav.pending || undefined}>
      {items.map(it => (
        <Link
          key={it.match}
          href={it.href}
          className={s.navLink}
          aria-current={isActive(it.match) ? 'page' : undefined}
          title={it.label}
          onNavigate={e => {
            e.preventDefault()
            nav.push(onTopOfInFlight(it.href, NAV_LAYER.link))
          }}
        >
          <Icon name={it.icon} size={16} />
          <span className={s.navText}>{it.label}</span>
        </Link>
      ))}
    </nav>
  )
}
