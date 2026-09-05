import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Opero — Central',
  description: 'Todas as lojas em tempo real',
  appleWebApp: {
    capable: true,
    title: 'Opero',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Standalone PWA on a notched phone: content must clear the safe areas.
  viewportFit: 'cover',
  themeColor: '#0a0f0d',
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return children
}
