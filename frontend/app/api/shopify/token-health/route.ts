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
  /** Permissions this token is missing for features Opero depends on. A token
   *  can answer every request and still be blind: the scopes are fixed at the
   *  moment it was issued, so widening them in the Shopify admin changes
   *  nothing until the app is reinstalled and the token replaced. */
  missingScopes: { handle: string; why: string }[]
  scopeCount: number
}

/** Scopes Opero needs, and what breaks without each one. */
const REQUIRED_SCOPES: { handle: string; why: string }[] = [
  { handle: 'read_orders',     why: 'pedidos e receita' },
  { handle: 'read_products',   why: 'catálogo e custo por produto' },
  { handle: 'read_shopify_payments_disputes', why: 'chargebacks' },
  // Payouts are deliberately absent: the app does not request that scope, and
  // reporting it missing would be nagging about something no reconnect fixes.
]

async function readScopes(domain: string, token: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://${domain}/admin/oauth/access_scopes.json`, {
      headers: { 'X-Shopify-Access-Token': token },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = await res.json() as { access_scopes?: { handle: string }[] }
    return (json.access_scopes ?? []).map(s => s.handle)
  } catch {
    return null
  }
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
        return { ...base, status: 'missing' as const, httpStatus: null, missingScopes: [], scopeCount: 0 }
      }

      try {
        const [res, scopes] = await Promise.all([
          fetch(`https://${t.shopify_domain}/admin/api/2024-10/shop.json`, {
            headers: { 'X-Shopify-Access-Token': t.shopify_access_token },
            signal: AbortSignal.timeout(10_000),
            cache: 'no-store',
          }),
          readScopes(t.shopify_domain, t.shopify_access_token),
        ])
        const status: TokenStatus = res.ok ? 'ok' : res.status === 401 ? 'invalid' : 'error'
        return {
          ...base, status, httpStatus: res.status,
          missingScopes: scopes ? REQUIRED_SCOPES.filter(r => !scopes.includes(r.handle)) : [],
          scopeCount: scopes?.length ?? 0,
        }
      } catch {
        return { ...base, status: 'unreachable' as const, httpStatus: null, missingScopes: [], scopeCount: 0 }
      }
    })
  )

  stores.sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ stores, checkedAt: new Date().toISOString() })
}
