'use client'

/**
 * KeepPeriodLink — a link to `path` that carries the period of the current URL
 * (periodo, de, ate, volta, parte), for places that get no searchParams: the root
 * not-found page. It drops ?loja on purpose: on a 404 the store itself may be
 * what does not exist, and a link that kept it would 404 again. The page it
 * opens normalises whatever arrives (lib/views/page parsePageParams), so the
 * keys are copied as they are.
 *
 * useSearchParams needs a <Suspense> parent; give it a plain link as fallback.
 *
 *   <Suspense fallback={<Link href="/">Ir para o Resumo</Link>}>
 *     <KeepPeriodLink path="/">Ir para o Resumo</KeepPeriodLink>
 *   </Suspense>
 *
 * Props: { path: string; className?; style?; children }
 */

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { CSSProperties, ReactNode } from 'react'

/** The URL keys that make up the period (lib/views/page PageParams, minus loja).
 *  `volta` goes with row dates, so the page opened can tell them from dates
 *  the owner picked (settleRowDates): without it they opened frozen as a
 *  "Período escolhido". */
const PERIOD_KEYS = ['periodo', 'de', 'ate', 'volta', 'parte'] as const

export function keepPeriodHref(path: string, current: URLSearchParams): string {
  const out = new URLSearchParams()
  for (const k of PERIOD_KEYS) {
    const v = current.get(k)
    if (v) out.set(k, v)
  }
  const qs = out.toString()
  return qs ? `${path}?${qs}` : path
}

export function KeepPeriodLink({ path, className, style, children }: {
  path: string; className?: string; style?: CSSProperties; children: ReactNode
}) {
  const sp = useSearchParams()
  return <Link href={keepPeriodHref(path, new URLSearchParams(sp.toString()))} className={className} style={style}>{children}</Link>
}
