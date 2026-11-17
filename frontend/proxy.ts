import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { MOBILE_COOKIE, isValidSessionValue } from '@/lib/mobileAuth'

/**
 * Routes that do not need a Clerk session. "Public" means only "not behind
 * Clerk": each of these enforces its own auth and answers 404 without it.
 *  - Shopify OAuth and webhooks sign their own requests (token + HMAC).
 *  - /m, /api/mobile, /api/push and /api/desktop are the owner's surfaces,
 *    unlocked with MOBILE_ACCESS_TOKEN (lib/mobileAuth.ts). They span every
 *    store, so no partner-shared Clerk account can be allowed in.
 * Patterns are exact segments: '/m(.*)' would also have exempted any future
 * route that merely starts with the letter m.
 */
const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/api/health',
  '/api/shopify/auth',
  '/api/shopify/callback',
  '/api/webhooks/(.*)',
  '/m',
  '/m/(.*)',
  '/api/mobile',
  '/api/mobile/(.*)',
  '/api/push/(.*)',
  '/api/desktop',
])

export default clerkMiddleware(async (auth, request) => {
  if (isPublicRoute(request)) return
  // The owner's unlocked device sees the desktop site without a Clerk login.
  if (isValidSessionValue(request.cookies.get(MOBILE_COOKIE)?.value)) return NextResponse.next()
  await auth.protect()
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
