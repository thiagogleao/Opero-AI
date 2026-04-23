import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { auth, currentUser } from '@clerk/nextjs/server'
import { upsertTenant } from '@/lib/tenant'

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
  console.log('[shopify/callback] token keys:', Object.keys(tokenData), 'token prefix:', tokenData.access_token?.slice(0, 10))
  const access_token = tokenData.access_token
  const cleanShop = shop!.replace(/https?:\/\//, '').replace(/\/$/, '')

  const { userId } = await auth()
  console.log('[shopify/callback] userId:', userId?.slice(0, 20))
  if (!userId) return NextResponse.redirect(new URL('/sign-in', appUrl))

  const user = await currentUser()
  try {
    await upsertTenant(userId, {
      email: user?.emailAddresses[0]?.emailAddress,
      shopify_domain: cleanShop,
      shopify_access_token: access_token,
    })
    console.log('[shopify/callback] upsertTenant OK, token saved:', access_token?.slice(0, 15))
  } catch (err) {
    console.error('[shopify/callback] upsertTenant failed:', err)
  }

  const parts = (state || '').split(':')
  const storeStartDate = parts[1] ? decodeURIComponent(parts[1]) : ''
  const isReconnect    = parts[2] === '1'

  let redirectUrl: URL
  if (isReconnect) {
    redirectUrl = new URL('/settings?shopify_connected=true', appUrl)
  } else {
    redirectUrl = new URL('/onboarding', appUrl)
    redirectUrl.searchParams.set('shopify_connected', 'true')
    if (storeStartDate) redirectUrl.searchParams.set('storeStartDate', storeStartDate)
  }

  const res = NextResponse.redirect(redirectUrl.toString())
  res.cookies.delete('shopify_oauth_state')
  return res
}
