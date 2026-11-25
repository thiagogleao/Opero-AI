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
 * link built by lib/period desktopHref: the same scope keeps the selection
 * (R3); a one-store page from Todas is an R4 link to the remembered store
 * with `vem=todas`, so it says which store and which days it shows · footer
 * with the clock used.
 * Top bar: PeriodPicker · SplitToggle · Freshness (streams in) · Copilot ·
 * viewer ("Modo dono · sair" / "Sócio · sair").
 * Responsive: full sidebar ≥1200px, icon rail 768–1199px, drawer below 768px
 * (the phone has its own app at /m).
 */

import { Suspense, type ReactNode } from 'react'
import Link from 'next/link'
import { desktopHref, pageScope, resolutionKey, type ScopeRef } from '@/lib/period'
import { clockLabel, type PageContext } from '@/lib/views/page'
import { CopilotLauncher } from '@/components/ai/CopilotLauncher'
import { Freshness, FreshnessFallback } from './Freshness'
import { NavLinks, type NavItem } from './NavLinks'
import { PeriodPicker } from './PeriodPicker'
import { MenuButton, ShellFrame } from './ShellFrame'
import { SplitToggle } from './SplitToggle'
import { StorePicker } from './StorePicker'
import { LinkRelay } from './LinkRelay'
import { TurnWatcher } from './TurnWatcher'
import { ViewerIndicator } from './ViewerIndicator'
import s from './shell.module.css'

export function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1" y="1" width="18" height="18" rx="5" fill="none" stroke="var(--tx)" strokeWidth="1.6" />
      <path d="M5 13.5l3.2-3.6 2.6 2.2L15 6.5" fill="none" stroke="var(--pos)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function AppShell({ ctx, children, copilot = true }: { ctx: PageContext; children: ReactNode; copilot?: boolean }) {
  // One link per page (lib/period desktopHref). A page of the same scope keeps
  // the selection (R3); a store-only page from Todas opens the remembered
  // store, and "Todas as lojas" from a store, as R4 links with `vem` (R4).
  const here = ctx.selection.scope
  const store: ScopeRef | null = ctx.rememberedStoreId ? { kind: 'store', id: ctx.rememberedStoreId } : null
  const navItem = (match: string, path: string) => {
    const kind = pageScope(path)
    const target: ScopeRef | null = kind === 'all' ? { kind: 'all' } : kind === 'store' && here.kind === 'all' ? store : null
    const href = target ? ctx.scopeHref(path, target) ?? desktopHref(path, ctx.selection) : desktopHref(path, ctx.selection)
    // At click time (R13): /overview names Todas; a one-store page opens the
    // remembered store only if the latest REQUESTED scope is still Todas — a
    // store picked a moment before is kept (the item does not name a store).
    const link = {
      kind: 'page' as const, path, keys: 'inherit' as const,
      ...(kind === 'all' ? { scope: { kind: 'all' } as ScopeRef } : {}),
      ...(kind === 'store' && store ? { storeFallback: store } : {}),
    }
    return { match, href, link }
  }
  const nav: NavItem[] = [
    { ...navItem('/', '/'), label: 'Resumo', icon: 'sum' },
    ...(ctx.allowAll ? [{ ...navItem('/overview', '/overview'), label: 'Todas as lojas', icon: 'all' as const }] : []),
    { ...navItem('/campaigns', '/campaigns'), label: 'Campanhas', icon: 'camp' },
    { ...navItem('/products', '/products'), label: 'Produtos', icon: 'box' },
    { ...navItem('/countries', '/countries'), label: 'Países e clientes', icon: 'globe' },
    { ...navItem('/attribution', '/attribution'), label: 'Atribuição', icon: 'attr' },
    { ...navItem('/profit', '/profit'), label: 'Custos', icon: 'coin' },
    { ...navItem('/settings', '/settings'), label: 'Ajustes', icon: 'set' },
  ]
  // An archived store opened by id (its history) is listed too, so the picker
  // names what is on screen instead of silently showing another store.
  const options = ctx.store?.archived && ctx.storeOption ? [...ctx.storeOptions, ctx.storeOption] : ctx.storeOptions
  const all = ctx.allowAll ? { count: ctx.stores.length } : null
  const archivedIds = ctx.viewerStores.archived.map(x => x.id)
  const r = ctx.resolution
  const tzNote = r.clockDiffers && ctx.scope === 'store' ? `dia de ${r.clockNote}` : null
  const clock = clockLabel(ctx)
  const home = nav[0].href

  const sidebar = (
    <>
      <Link href={home} className={s.brand} aria-label="Opero, início">
        <span className={s.brandMark}><Logo /></span>
        <span className={s.brandName}>opero</span>
        <span className={s.brandTag}>AI</span>
      </Link>
      <div style={{ width: '100%' }}>
        <div className={s.sideLabel}>Loja</div>
        <StorePicker options={options} all={all} currentId={ctx.params.loja ?? ''} archivedIds={archivedIds} />
      </div>
      <NavLinks items={nav} archivedIds={archivedIds} />
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
            current={ctx.selection.period}
            today={ctx.today}
            range={ctx.range}
            rangeLabel={ctx.rangeLabel}
            partialLabel={ctx.partialLabel}
            tzNote={tzNote}
            archivedIds={archivedIds}
          />
        </div>
        <div className={s.topRight}>
          <SplitToggle on={ctx.split} />
          <Suspense fallback={<FreshnessFallback />}>
            <Freshness stores={ctx.selected} now={ctx.now} />
          </Suspense>
          {copilot && <CopilotLauncher storeId={ctx.scope === 'all' ? null : ctx.store?.id ?? null} from={ctx.range.from} to={ctx.range.to} split={ctx.split} archivedIds={archivedIds} />}
          <ViewerIndicator kind={ctx.viewer.kind} />
        </div>
      </header>
      <main id="conteudo" className={s.content} tabIndex={-1}>
        <LinkRelay rootId="conteudo" archivedIds={archivedIds} />
        <TurnWatcher nextTurnAt={r.nextTurnAt} serverNow={r.asOf} selection={ctx.selection} viewer={ctx.viewerStores}
          shownKey={resolutionKey(r)} label={r.label.full} />
        {children}
      </main>
    </ShellFrame>
  )
}
