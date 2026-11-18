import { Skeleton, SkeletonBlock } from '@/components/ui/Card'
import s from '@/components/shell/shell.module.css'

/**
 * Root loading state: shown while a page's server component renders after a
 * move to ANOTHER page (a store or period switch on the same page keeps the
 * page on screen and shows a spinner in the picker instead).
 *
 * Each page draws its own AppShell, so this fallback replaces the shell too.
 * It therefore draws the shell's frame (sidebar, top bar) as placeholders with
 * the same classes, so the sidebar does not vanish and jump back on every
 * navigation; below 768px the sidebar is the hidden drawer, as in the shell.
 * The content is shaped like a page — header, verdict, blocks.
 */
export default function Loading() {
  return (
    <div className={s.frame}>
      <aside className={s.side} aria-hidden="true">
        <Skeleton width={110} height={22} />
        <Skeleton height={46} radius={12} />
        <div style={{ display: 'grid', gap: 10, width: '100%' }}>
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} height={26} radius={10} />)}
        </div>
      </aside>
      <div className={s.main}>
        <div className={s.top} aria-hidden="true">
          <Skeleton width={320} height={32} radius={10} />
          <span style={{ marginLeft: 'auto' }}><Skeleton width={260} height={28} radius={10} /></span>
        </div>
        <div className={s.content} role="status" aria-live="polite">
          <span className="sr-only">Carregando os números…</span>
          <Skeleton width={220} height={22} />
          <Skeleton width={300} height={12} />
          <SkeletonBlock height={180} lines={3} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {[0, 1, 2, 3].map(i => <SkeletonBlock key={i} height={44} lines={1} title={false} />)}
          </div>
        </div>
      </div>
    </div>
  )
}
