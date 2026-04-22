import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.redirect(new URL('/sign-in', req.nextUrl.origin))

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin
  const nonce = crypto.randomBytes(16).toString('hex')
  const state = `${nonce}:${userId}`
  const redirectUri = `${appUrl}/api/facebook/callback`

  const authUrl = new URL('https://www.facebook.com/v20.0/dialog/oauth')
  authUrl.searchParams.set('client_id', process.env.FACEBOOK_APP_ID!)
  authUrl.searchParams.set('redirect_uri', redirectUri)
  authUrl.searchParams.set('scope', 'ads_read,ads_management,business_management')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('response_type', 'code')

  const res = NextResponse.redirect(authUrl.toString())
  res.cookies.set('fb_oauth_state', state, { httpOnly: true, maxAge: 600, path: '/', sameSite: 'lax' })
  return res
}
