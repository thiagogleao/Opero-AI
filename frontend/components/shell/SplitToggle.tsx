'use client'

/**
 * SplitToggle — "Minha parte 50%": the partner view, ?parte=50. It halves the
 * money results (profit, profit per order, cash result, refunds) everywhere
 * the page uses ctx.part(); margins, ROAS and break-even never change.
 * A real toggle button (aria-pressed) that navigates in a transition, so it
 * never locks itself after the first click. Used while a store or period
 * choice is still loading, it is laid on top of that choice (lib/period
 * layer, R13) instead of undoing it. A view toggle: it never changes the
 * period and is never remembered.
 *
 * Props: { on: boolean }
 */

import { inFlightParam, layered } from './url'
import { useShellNavigation } from './useShellNavigation'
import s from './shell.module.css'

export function SplitToggle({ on }: { on: boolean }) {
  const nav = useShellNavigation()
  const toggle = () => {
    // While another choice loads, flip the split of the URL being opened.
    const opening = inFlightParam('parte')
    const isOn = opening === undefined ? on : opening === '50'
    nav.push(layered({ kind: 'split', on: !isOn }))
  }
  return (
    <button
      type="button"
      className={s.split}
      aria-pressed={on}
      aria-busy={nav.pending || undefined}
      title="Mostra só a sua metade do lucro. Margens e ROAS não mudam."
      onClick={toggle}
    >
      {nav.pending ? <span className={s.spin} aria-hidden="true" /> : <span className={s.switch} aria-hidden="true" />}
      Minha parte 50%
    </button>
  )
}
