import { NextRequest, NextResponse } from 'next/server'
import { upsertTenant } from '@/lib/tenant'

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  const fail   = (reason: string) =>
    NextResponse.redirect(new URL(`/settings?fb_error=${reason}`, appUrl))

  if (error || !code) return fail('access_denied')

  const cookieState = req.cookies.get('fb_oauth_state')?.value
  if (!cookieState || cookieState !== state) return fail('invalid_state')

  // userId is embedded after the first colon
  const colonIdx = state!.indexOf(':')
  const userId   = colonIdx >= 0 ? state!.slice(colonIdx + 1) : ''
  if (!userId) return fail('invalid_state')

  const APP_ID     = process.env.FACEBOOK_APP_ID!
  const APP_SECRET = process.env.FACEBOOK_APP_SECRET!
  const redirectUri = `${appUrl}/api/facebook/callback`

  // 1. Exchange code → short-lived token
  const tokenRes = await fetch(
    'https://graph.facebook.com/v20.0/oauth/access_token?' +
    new URLSearchParams({ client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: redirectUri, code }).toString()
  )
  if (!tokenRes.ok) return fail('token_exchange_failed')
  const { access_token: shortToken } = await tokenRes.json()

  // 2. Exchange short-lived → long-lived token (valid ~60 days)
  const longRes = await fetch(
    'https://graph.facebook.com/oauth/access_token?' +
    new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: APP_SECRET, fb_exchange_token: shortToken }).toString()
  )
  if (!longRes.ok) return fail('long_token_failed')
  const { access_token: longToken } = await longRes.json()

  // 3. Fetch user's ad accounts
  const accountsRes = await fetch(
    `https://graph.facebook.com/me/adaccounts?fields=id,name,account_status&limit=50&access_token=${longToken}`
  )
  const accountsData = await accountsRes.json()
  const accounts: { id: string; name: string; account_status: number }[] = accountsData.data || []

  if (accounts.length === 0) {
    // Save token even without account so user can pick later
    await upsertTenant(userId, { fb_access_token: longToken })
    return fail('no_ad_accounts')
  }

  // Save token now; account will be set in /facebook/accounts
  await upsertTenant(userId, { fb_access_token: longToken })

  if (accounts.length === 1) {
    await upsertTenant(userId, { fb_ad_account_id: accounts[0].id })
    const res = NextResponse.redirect(new URL('/settings?fb_connected=true', appUrl))
    res.cookies.delete('fb_oauth_state')
    return res
  }

  // Multiple accounts: redirect to picker
  const pickerUrl = new URL('/facebook/accounts', appUrl)
  pickerUrl.searchParams.set('uid', userId)
  const res = NextResponse.redirect(pickerUrl.toString())
  res.cookies.delete('fb_oauth_state')
  return res
}
