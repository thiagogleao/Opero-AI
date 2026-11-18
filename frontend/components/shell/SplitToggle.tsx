'use client'

/**
 * SplitToggle — "Minha parte 50%": the partner view, ?parte=50. It halves the
 * money results (profit, profit per order, cash result, refunds) everywhere
 * the page uses ctx.part(); margins, ROAS and break-even never change.
 * A real toggle button (aria-pressed) that navigates in a transition, so it
 * never locks itself after the first click.
 *
 * Props: { on: boolean; onQuery: string; offQuery: string } — the two URLs'
 * queries, from ctx.hrefWith('', { parte: true|false }).
 */

import { usePathname, useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { hrefFor } from './url'
import s from './shell.module.css'

export function SplitToggle({ on, onQuery, offQuery }: { on: boolean; onQuery: string; offQuery: string }) {
  const router = useRouter()
  const pathname = usePathname() || '/'
  const [pending, startTransition] = useTransition()
  return (
    <button
      type="button"
      className={s.split}
      aria-pressed={on}
      aria-busy={pending || undefined}
      title="Mostra só a sua metade do lucro. Margens e ROAS não mudam."
      onClick={() => startTransition(() => { router.push(hrefFor(pathname, on ? offQuery : onQuery)) })}
    >
      {pending ? <span className={s.spin} aria-hidden="true" /> : <span className={s.switch} aria-hidden="true" />}
      Minha parte 50%
    </button>
  )
}
