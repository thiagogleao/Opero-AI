import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { getTenantsByUserId } from '@/lib/tenant'

export const dynamic = 'force-dynamic'

export type TokenStatus = 'ok' | 'invalid' | 'missing' | 'error' | 'unreachable'

export interface StoreTokenHealth {
  id: string
  name: string
  domain: string | null
  /** Never the token itself — only enough to tell two tokens apart. */
  masked: string | null
  status: TokenStatus
  httpStatus: number | null
}

/** Show the first 9 and last 4 characters so the user can tell whether the
 *  token in the database is the one they just pasted. Never the whole thing. */
function mask(token: string): string {
  return token.length <= 16 ? '•'.repeat(8) : `${token.slice(0, 9)}…${token.slice(-4)}`
}

/** Ask Shopify whether each stored token still works. A token is never
 *  "expired" on its own — a 401 here means it was revoked, which is what
 *  rotating the app credentials does. */
export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tenants = await getTenantsByUserId(userId)

  const stores: StoreTokenHealth[] = await Promise.all(
    tenants.map(async (t) => {
      const base = {
        id: t.id,
        name: t.shop_name || t.shopify_domain || t.id,
        domain: t.shopify_domain,
        masked: t.shopify_access_token ? mask(t.shopify_access_token) : null,
      }

      if (!t.shopify_domain || !t.shopify_access_token) {
        return { ...base, status: 'missing' as const, httpStatus: null }
      }

      try {
        const res = await fetch(`https://${t.shopify_domain}/admin/api/2024-10/shop.json`, {
          headers: { 'X-Shopify-Access-Token': t.shopify_access_token },
          signal: AbortSignal.timeout(10_000),
          cache: 'no-store',
        })
        const status: TokenStatus = res.ok ? 'ok' : res.status === 401 ? 'invalid' : 'error'
        return { ...base, status, httpStatus: res.status }
      } catch {
        return { ...base, status: 'unreachable' as const, httpStatus: null }
      }
    })
  )

  stores.sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ stores, checkedAt: new Date().toISOString() })
}
