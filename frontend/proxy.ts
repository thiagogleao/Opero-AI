import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'

const isPublicRoute = createRouteMatcher([
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/api/health',
  '/api/shopify/auth',
  '/api/shopify/callback',
  // Shopify signs these itself (token + HMAC) and cannot carry a Clerk session.
  '/api/webhooks(.*)',
  // Owner-only mobile PWA. "Public" here means only "not behind Clerk": these
  // routes enforce their own auth (MOBILE_ACCESS_TOKEN -> HttpOnly cookie, see
  // lib/mobileAuth.ts) and return 404 without it. They cannot use Clerk because
  // Opero accounts are shared with per-store partners, while this view spans
  // every store — so no existing account is allowed to unlock it.
  '/m(.*)',
  '/api/mobile(.*)',
  '/api/push(.*)',
])

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect()
  }
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    '/(api|trpc)(.*)',
  ],
}
