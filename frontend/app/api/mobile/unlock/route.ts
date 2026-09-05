import { NextRequest, NextResponse } from 'next/server'
import { isValidToken, makeSessionCookie, rateLimited, MOBILE_COOKIE } from '@/lib/mobileAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Magic-link unlock: /api/mobile/unlock?k=<token>
 *
 * Exchanges the token for an HttpOnly session cookie and redirects to /m so
 * the secret leaves the URL bar, browser history and any Referer header.
 */
export async function GET(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'

  if (rateLimited(ip)) {
    return new NextResponse('Too many attempts', { status: 429 })
  }

  if (!isValidToken(req.nextUrl.searchParams.get('k'))) {
    // Same response as any unknown path — don't confirm the route exists.
    return new NextResponse('Not found', { status: 404 })
  }

  const value = makeSessionCookie()
  if (!value) return new NextResponse('Not configured', { status: 500 })

  const res = NextResponse.redirect(new URL('/m', req.nextUrl.origin))
  res.cookies.set(MOBILE_COOKIE, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  })
  return res
}

/** Sign this device out. */
export async function DELETE(req: NextRequest) {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(MOBILE_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 })
  return res
}
