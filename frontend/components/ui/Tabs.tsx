/**
 * Tabs and SegmentedLinks — navigation that lives in the URL (server-safe,
 * plain links: back/forward and shared links just work). Build the hrefs with
 * ctx.hrefWith(...) so loja/periodo/parte survive.
 *
 *   <Tabs ariaLabel="Visões" active="campanhas" items={[
 *     { key: 'campanhas', label: 'Campanhas', href: ctx.hrefWith('/campaigns') },
 *     { key: 'criativos', label: 'Criativos', href: ctx.hrefWith('/campaigns?aba=criativos'), count: 158 },
 *   ]} />
 *   Props: { items: { key: string; label: ReactNode; href: string; count?: number }[];
 *            active: string; ariaLabel: string }
 *
 *   <SegmentedLinks ariaLabel="Métrica" active="lucro" items={[{ key, label, href }, …]} size="sm" />
 *   Same props plus size?: 'sm'|'md'.
 *
 * For state that does not belong in the URL, use the client components
 * <Segmented> and <ClientTabs> from ./Segmented.
 */

import Link from 'next/link'
import type { ReactNode } from 'react'
import { formatCount } from '@/lib/format'
import s from './Tabs.module.css'

export interface TabLink { key: string; label: ReactNode; href: string; count?: number }

export function Tabs({ items, active, ariaLabel }: { items: TabLink[]; active: string; ariaLabel: string }) {
  return (
    <nav className={s.tabs} aria-label={ariaLabel}>
      {items.map(t => (
        <Link key={t.key} href={t.href} className={s.tab} aria-current={t.key === active ? 'page' : undefined} scroll={false}>
          {t.label}
          {t.count !== undefined && <span className={s.count}>{formatCount(t.count)}</span>}
        </Link>
      ))}
    </nav>
  )
}

export function SegmentedLinks({ items, active, ariaLabel, size = 'md' }: { items: TabLink[]; active: string; ariaLabel: string; size?: 'sm' | 'md' }) {
  return (
    <nav className={`${s.seg}${size === 'sm' ? ` ${s.segSm}` : ''}`} aria-label={ariaLabel}>
      {items.map(t => (
        <Link key={t.key} href={t.href} className={s.segBtn} aria-current={t.key === active ? 'page' : undefined} scroll={false}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
