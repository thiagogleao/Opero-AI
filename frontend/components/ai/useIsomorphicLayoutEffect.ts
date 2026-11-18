import { useEffect, useLayoutEffect } from 'react'

/**
 * useLayoutEffect in the browser, useEffect on the server — picked ONCE, when
 * the module loads, so every render of a component calls the same hook in the
 * same slot. Choosing per render (or swapping one for the other in place) is
 * what made React report "change in the order of Hooks" in CopilotLauncher
 * (useEffect in one render, useLayoutEffect in the next).
 *
 * The layout timing matters in the browser: the Copilot and the insights card
 * abort the previous store's request at commit, before paint, so no frame of
 * an old stream can land after the screen moved on. On the server neither
 * effect runs; useEffect only keeps the server render free of layout effects.
 */
export const useIsomorphicLayoutEffect: typeof useLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect
