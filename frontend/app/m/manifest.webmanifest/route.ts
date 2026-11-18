/**
 * The phone app's manifest, served at /m/manifest.webmanifest and linked only
 * from /m (app/m/layout.tsx). It used to be app/manifest.ts, which Next links
 * from EVERY page: a partner who "installed" the desktop site got an app that
 * opened on /m and its "Acesso restrito".
 *
 * Public on purpose: browsers fetch manifests without cookies, and it holds
 * nothing but the app's name and icons. (proxy.ts never runs for
 * .webmanifest paths.)
 */

export const dynamic = 'force-static'

export function GET() {
  const manifest = {
    // Same identity as the installed app had (id defaults to start_url), so
    // phones that already installed it keep it.
    id: '/m',
    name: 'Opero',
    short_name: 'Opero',
    description: 'Lucro real e vendas das lojas, em tempo real',
    lang: 'pt-BR',
    start_url: '/m',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#08090c',
    theme_color: '#08090c',
    categories: ['business', 'finance'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
  return new Response(JSON.stringify(manifest), {
    headers: { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}
