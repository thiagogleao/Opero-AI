import { NextResponse } from 'next/server'
import { ACTIVE_STORE_COOKIE } from '@/lib/access'
import { internalHref } from '@/components/ai/links'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/active-store/forget?to=<page>
 *
 * Clears the remembered store when it names a store this viewer can no longer
 * use (archived since, access revoked, another viewer on the same browser;
 * lib/period R5) and lands on `to`, a page of this app only. A page cannot set
 * cookies, so getPageContext redirects here once; clearing is not choosing, so
 * nothing else is written.
 */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const to = internalHref(url.searchParams.get('to')) ?? '/'
  const res = NextResponse.redirect(new URL(to, url.origin), 303)
  res.cookies.delete(ACTIVE_STORE_COOKIE)
  return res
}
