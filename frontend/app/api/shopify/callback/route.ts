import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth, currentUser } from '@clerk/nextjs/server'
import { upsertTenant, updateShopifyTokenByDomain, createStoreForUser } from '@/lib/tenant'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code = searchParams.get('code')
  const shop = searchParams.get('shop')
  const state = searchParams.get('state')
  const hmac = searchParams.get('hmac')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  const fail = (reason: string) =>
    NextResponse.redirect(new URL(`/onboarding?error=${reason}`, appUrl))

  console.log('[shopify/callback] state:', state?.slice(0, 20), 'code:', !!code, 'shop:', shop)

  // Verify state matches cookie
  const cookieState = req.cookies.get('shopify_oauth_state')?.value
  console.log('[shopify/callback] cookieState:', cookieState?.slice(0, 20), 'match:', cookieState === state)
  if (!cookieState || cookieState !== state) return fail('invalid_state')

  // Verify HMAC
  const params: Record<string, string> = {}
  for (const [key, val] of searchParams.entries()) {
    if (key !== 'hmac') params[key] = val
  }
  const message = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
  const digest = crypto
    .createHmac('sha256', process.env.SHOPIFY_CLIENT_SECRET!)
    .update(message)
    .digest('hex')
  console.log('[shopify/callback] hmac match:', digest === hmac)
  if (digest !== hmac) return fail('invalid_hmac')

  // Exchange code for access token
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.SHOPIFY_CLIENT_ID,
      client_secret: process.env.SHOPIFY_CLIENT_SECRET,
      code,
    }),
  })
  console.log('[shopify/callback] token exchange status:', tokenRes.status)
  if (!tokenRes.ok) return fail('token_exchange_failed')

  const tokenData = await tokenRes.json()
  const access_token = tokenData.access_token
  const cleanShop = shop!.replace(/https?:\/\//, '').replace(/\/$/, '')

  const { userId } = await auth()
  console.log('[shopify/callback] userId:', userId?.slice(0, 20))
  if (!userId) return NextResponse.redirect(new URL('/sign-in', appUrl))

  const user = await currentUser()
  const email = user?.emailAddresses[0]?.emailAddress

  // Parse state flags: nonce:storeStartDate:reconnect:addStore
  const parts = (state || '').split(':')
  const storeStartDate = parts[1] ? decodeURIComponent(parts[1]) : ''
  const isReconnect    = parts[2] === '1'
  const isAddStore     = parts[3] === '1'

  let newStoreId: string | null = null

  try {
    if (isAddStore) {
      // Adding a new store: check if this domain already belongs to this user
      const updated = await updateShopifyTokenByDomain(cleanShop, access_token, userId)
      if (updated === 0) {
        // Genuinely new store — create a new row with a UUID
        newStoreId = crypto.randomUUID()
        await createStoreForUser(userId, newStoreId, {
          email,
          shopify_domain: cleanShop,
          shopify_access_token: access_token,
        })
        console.log('[shopify/callback] new store created:', newStoreId, cleanShop)
      } else {
        // Domain already exists for this user — find its ID to set the cookie
        const { query } = await import('@/lib/db')
        const rows = await query<{ id: string }>(
          `SELECT id FROM tenants WHERE shopify_domain = $1 AND (user_id = $2 OR (user_id IS NULL AND id = $2))`,
          [cleanShop, userId]
        )
        newStoreId = rows[0]?.id ?? null
        console.log('[shopify/callback] reconnected existing store:', newStoreId)
      }
    } else {
      // Original flow: first store for this user
      const updated = await updateShopifyTokenByDomain(cleanShop, access_token)
      if (updated === 0) {
        await upsertTenant(userId, {
          user_id: userId,
          email,
          shopify_domain: cleanShop,
          shopify_access_token: access_token,
        })
        console.log('[shopify/callback] upsertTenant OK (new row)')
      }
    }
  } catch (err) {
    console.error('[shopify/callback] save failed:', err)
  }

  let redirectUrl: URL
  if (isReconnect) {
    redirectUrl = new URL('/settings?shopify_connected=true', appUrl)
  } else if (isAddStore) {
    redirectUrl = new URL('/onboarding', appUrl)
    redirectUrl.searchParams.set('addStore', 'true')
    redirectUrl.searchParams.set('shopify_connected', 'true')
    if (storeStartDate) redirectUrl.searchParams.set('storeStartDate', storeStartDate)
  } else {
    redirectUrl = new URL('/onboarding', appUrl)
    redirectUrl.searchParams.set('shopify_connected', 'true')
    if (storeStartDate) redirectUrl.searchParams.set('storeStartDate', storeStartDate)
  }

  const res = NextResponse.redirect(redirectUrl.toString())
  res.cookies.delete('shopify_oauth_state')

  // Set active_store_id cookie for new store
  if (newStoreId) {
    res.cookies.set('active_store_id', newStoreId, {
      httpOnly: true, path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax',
    })
  }

  return res
}
