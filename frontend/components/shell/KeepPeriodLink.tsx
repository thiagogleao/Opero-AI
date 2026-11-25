'use client'

/**
 * KeepPeriodLink — a link to `path` that carries the period of the current URL
 * (lib/period keepPeriodHref: the period and parte, parsed and rewritten, never
 * a legacy or unknown key), for places that get no searchParams: the root
 * not-found page. It drops ?loja on purpose: on a 404 the store itself may be
 * what does not exist, and a link that kept it would 404 again.
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
import { keepPeriodHref } from '@/lib/period'

export { keepPeriodHref }

export function KeepPeriodLink({ path, className, style, children }: {
  path: string; className?: string; style?: CSSProperties; children: ReactNode
}) {
  const sp = useSearchParams()
  return <Link href={keepPeriodHref(path, new URLSearchParams(sp.toString()))} className={className} style={style}>{children}</Link>
}
