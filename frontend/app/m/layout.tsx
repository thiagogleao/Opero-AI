import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  // Absolute: the root layout's '%s · Opero' template turned 'Opero' into
  // 'Opero · Opero' in the tab, history and bookmarks of the phone app.
  title: { absolute: 'Opero' },
  description: 'Lucro real e vendas das lojas, em tempo real',
  // Linked from /m only: the desktop site is not an installable app.
  manifest: '/m/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Opero',
    statusBarStyle: 'black-translucent',
  },
  robots: { index: false, follow: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // No maximumScale: pinch-zoom stays available (small print is small).
  // Standalone PWA on a notched phone: content must clear the safe areas.
  viewportFit: 'cover',
  colorScheme: 'dark',
  themeColor: '#08090c',
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return children
}
