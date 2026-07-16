import { NextRequest, NextResponse } from 'next/server'
import { upsertTenant } from '@/lib/tenant'
import { query } from '@/lib/db'

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

  // ── Extra-account flow ────────────────────────────────────────────────────────
  // Triggered when the user adds a second FB account from Settings.
  // Saves to tenant_fb_accounts instead of tenants — does NOT touch existing data.
  const oauthMode = req.cookies.get('fb_oauth_mode')?.value
  if (oauthMode?.startsWith('add_extra:')) {
    const tenantId = oauthMode.slice('add_extra:'.length)

    const clearCookies = (r: NextResponse) => {
      r.cookies.delete('fb_oauth_state')
      r.cookies.delete('fb_oauth_mode')
      return r
    }

    if (accounts.length === 0) {
      // /me/adaccounts returned empty — common with Business Manager setups.
      // Store the token and redirect to a manual account ID entry form.
      const pending = Buffer.from(JSON.stringify({ tenantId, token: longToken })).toString('base64')
      const res = NextResponse.redirect(new URL('/facebook/extra-accounts?manual=true', appUrl))
      res.cookies.set('fb_extra_pending', pending, { httpOnly: true, maxAge: 300, path: '/', sameSite: 'lax' })
      return clearCookies(res)
    }

    if (accounts.length === 1) {
      // Single account — insert directly
      await query(`
        INSERT INTO tenant_fb_accounts (tenant_id, fb_ad_account_id, fb_access_token, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (tenant_id, fb_ad_account_id) DO UPDATE SET
          fb_access_token = EXCLUDED.fb_access_token,
          is_active       = true
      `, [tenantId, accounts[0].id, longToken])
      return clearCookies(NextResponse.redirect(new URL('/settings?fb_extra_connected=true', appUrl)))
    }

    // Multiple accounts — store pending data in a short-lived httpOnly cookie
    // so the picker page can retrieve and save the chosen account.
    const pending = Buffer.from(JSON.stringify({ tenantId, token: longToken })).toString('base64')
    const res = NextResponse.redirect(new URL('/facebook/extra-accounts', appUrl))
    res.cookies.set('fb_extra_pending', pending, { httpOnly: true, maxAge: 300, path: '/', sameSite: 'lax' })
    return clearCookies(res)
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // Save token; update account ID only if we found accounts
  const update: Record<string, string> = { fb_access_token: longToken }
  if (accounts.length === 1) update.fb_ad_account_id = accounts[0].id
  await upsertTenant(userId, update)

  if (accounts.length > 1) {
    // Multiple accounts: redirect to picker
    const pickerUrl = new URL('/facebook/accounts', appUrl)
    const res = NextResponse.redirect(pickerUrl.toString())
    res.cookies.delete('fb_oauth_state')
    return res
  }

  // Zero or one account: token saved, redirect to success
  const res = NextResponse.redirect(new URL('/settings?fb_connected=true', appUrl))
  res.cookies.delete('fb_oauth_state')
  return res
}
