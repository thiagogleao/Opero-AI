/**
 * AppShell — sidebar + top bar + content for every desktop page. Server
 * component; pass it the page context and the page's content:
 *
 *   export default async function Page({ searchParams }: { searchParams: Promise<SearchParams> }) {
 *     const ctx = await getPageContext(searchParams)
 *     return (
 *       <AppShell ctx={ctx}>
 *         <PageHeader ctx={ctx} title={ctx.scopeName} />
 *         …blocks…
 *       </AppShell>
 *     )
 *   }
 *
 * Props: { ctx: PageContext (lib/views/page); children: ReactNode;
 *          copilot?: boolean (show the Copilot button, default true) }
 *
 * Sidebar (information architecture of the brief): logo · store card with the
 * StorePicker (viewer's stores; "Todas as lojas" for the owner or a partner
 * with 2+ stores) · Resumo / · Todas as lojas /overview · Campanhas /campaigns ·
 * Produtos /products · Países e clientes /countries · Atribuição /attribution ·
 * Custos /profit · Ajustes /settings — active item from the pathname, every
 * link keeping loja/periodo/de/ate/parte (ctx.navHref: Todas stays Todas
 * across a one-store page until a store is picked) · footer with the clock used.
 * Top bar: PeriodPicker · SplitToggle · Freshness (streams in) · Copilot ·
 * viewer ("Modo dono · sair" / "Sócio · sair").
 * Responsive: full sidebar ≥1200px, icon rail 768–1199px, drawer below 768px
 * (the phone has its own app at /m).
 */

import { Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import type { Period } from '@/lib/engine/dates'
import { ALL_STORES, clockLabel, MAX_WINDOW_DAYS, MIN_PAGE_DATE, type PageContext } from '@/lib/views/page'
import { CopilotLauncher } from '@/components/ai/CopilotLauncher'
import { Freshness, FreshnessFallback } from './Freshness'
import { NavLinks, type NavItem } from './NavLinks'
import { PeriodPicker, type PeriodOption } from './PeriodPicker'
import { MenuButton, ShellFrame } from './ShellFrame'
import { SplitToggle } from './SplitToggle'
import { StorePicker } from './StorePicker'
import { ViewerIndicator } from './ViewerIndicator'
import s from './shell.module.css'

const MAIN: { key: Period; label: string }[] = [
  { key: 'today', label: 'Hoje' },
  { key: 'yesterday', label: 'Ontem' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
]
// 90 days is left out on purpose: it is clutter on the desktop picker (it
// still resolves when a link carries ?periodo=90d).
const MORE: { key: Period; label: string }[] = [
  { key: '14d', label: '14 dias' },
  { key: 'mtd', label: 'Este mês' },
  { key: 'lastmonth', label: 'Mês passado' },
]

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1" y="1" width="18" height="18" rx="5" fill="none" stroke="var(--tx)" strokeWidth="1.6" />
      <path d="M5 13.5l3.2-3.6 2.6 2.2L15 6.5" fill="none" stroke="var(--pos)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AppShell({ ctx, children, copilot = true }: { ctx: PageContext; children: ReactNode; copilot?: boolean }) {
  // The shell's navigation is built from ctx.navHref, not hrefWith: after the
  // viewer chose Todas, a one-store page shows the remembered store but its
  // sidebar, period picker and split toggle keep loja=todas, so Todas →
  // Resumo → Campanhas still opens Todas (lib/views/page carriedLoja).
  const go = ctx.navHref
  const nav: NavItem[] = [
    { match: '/', label: 'Resumo', icon: 'sum', href: go('/') },
    ...(ctx.allowAll ? [{ match: '/overview', label: 'Todas as lojas', icon: 'all' as const, href: go('/overview') }] : []),
    { match: '/campaigns', label: 'Campanhas', icon: 'camp', href: go('/campaigns') },
    { match: '/products', label: 'Produtos', icon: 'box', href: go('/products') },
    { match: '/countries', label: 'Países e clientes', icon: 'globe', href: go('/countries') },
    { match: '/attribution', label: 'Atribuição', icon: 'attr', href: go('/attribution') },
    { match: '/profit', label: 'Custos', icon: 'coin', href: go('/profit') },
    { match: '/settings', label: 'Ajustes', icon: 'set', href: go('/settings') },
  ]
  // An archived store opened by id (its history) is listed too, so the picker
  // names what is on screen instead of silently showing another store.
  const listed = ctx.store?.archived && ctx.storeOption ? [...ctx.storeOptions, ctx.storeOption] : ctx.storeOptions
  // On a page that shows only one kind of scope, the other kind opens the page
  // that has it (a one-store page cannot show Todas, the overview cannot show
  // one store); everywhere else the choice reloads the same page — except a
  // page of one store's object (/creatives/<ad>), where the picker opens the
  // chosen store's list (./url DETAIL_ROUTES, resolved on the client).
  const options = listed.map(o => ({
    ...o,
    query: ctx.hrefWith('', { loja: o.id }),
    href: ctx.mode === 'all' ? ctx.hrefWith('/', { loja: o.id }) : undefined,
  }))
  const all = ctx.allowAll
    ? {
        query: ctx.hrefWith('', { loja: ALL_STORES }),
        count: ctx.stores.length,
        href: ctx.mode === 'store' ? ctx.hrefWith('/overview', { loja: ALL_STORES }) : undefined,
      }
    : null
  const toOption = (p: { key: Period; label: string }): PeriodOption => ({ ...p, query: go('', { periodo: p.key }) })
  // From the store on screen itself (ctx.storeOption), not a lookup in
  // storeOptions, which leaves out an archived store opened for its history.
  const tzNote = ctx.storeOption?.dayLabel ?? null
  const clock = clockLabel(ctx)

  const sidebar = (
    <>
      <Link href={go('/')} className={s.brand} aria-label="Opero, início">
        <span className={s.brandMark}><Logo /></span>
        <span className={s.brandName}>opero</span>
        <span className={s.brandTag}>AI</span>
      </Link>
      <div style={{ width: '100%' }}>
        <div className={s.sideLabel}>Loja</div>
        <StorePicker options={options} all={all} currentId={ctx.params.loja ?? ''}
          carriedId={ctx.navParams.loja !== ctx.params.loja ? ctx.navParams.loja ?? undefined : undefined} />
      </div>
      <NavLinks items={nav} />
      <div className={s.sideFoot}>
        <div className={s.row}><span>Fuso</span><span>{clock}</span></div>
        <div className={s.row}><span>Valores</span><span>US$</span></div>
      </div>
    </>
  )

  return (
    <ShellFrame sidebar={sidebar}>
      <header className={s.top}>
        <div className={s.topLeft}>
          <MenuButton />
          <PeriodPicker
            main={MAIN.map(toOption)}
            more={MORE.map(toOption)}
            current={ctx.period}
            customBase={go('', { periodo: null })}
            today={ctx.today}
            minDate={MIN_PAGE_DATE}
            maxDays={MAX_WINDOW_DAYS}
            range={ctx.range}
            rangeLabel={ctx.rangeLabel}
            partialLabel={ctx.partialLabel}
            tzNote={tzNote}
          />
        </div>
        <div className={s.topRight}>
          <SplitToggle on={ctx.split} onQuery={go('', { parte: true })} offQuery={go('', { parte: false })} />
          <Suspense fallback={<FreshnessFallback />}>
            <Freshness stores={ctx.selected} now={ctx.now} />
          </Suspense>
          {copilot && <CopilotLauncher storeId={ctx.scope === 'all' ? null : ctx.store?.id ?? null} from={ctx.range.from} to={ctx.range.to} split={ctx.split} />}
          <ViewerIndicator kind={ctx.viewer.kind} />
        </div>
      </header>
      <main id="conteudo" className={s.content} tabIndex={-1}>
        {children}
      </main>
    </ShellFrame>
  )
}
