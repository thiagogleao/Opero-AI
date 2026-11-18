import type { Metadata, Viewport } from 'next'
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { clerkAppearance, clerkLocalization } from './sign-in/clerk'
import './globals.css'

/**
 * Root layout: fonts, tokens (globals.css) and Clerk.
 *
 * Fonts are self-hosted by next/font and exposed as CSS variables that
 * globals.css maps to --sans / --mono / --serif. Dark only.
 *
 * The app shell is not applied here: each desktop page wraps itself in
 * <AppShell ctx={...}> (components/shell/AppShell) because the shell needs the
 * page's resolved store and period; /m and /sign-in have their own frames.
 */

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-sans',
  display: 'swap',
})

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
})

// Variable font: the optical-size axis keeps the big verdict lines crisp.
const fraunces = Fraunces({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-fraunces',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Opero', template: '%s · Opero' },
  description: 'Lucro real e anúncios das suas lojas Shopify',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#08090c',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider appearance={clerkAppearance} localization={clerkLocalization}>
      <html
        lang="pt-BR"
        className={`${plexSans.variable} ${plexMono.variable} ${fraunces.variable}`}
        suppressHydrationWarning
      >
        <body>{children}</body>
      </html>
    </ClerkProvider>
  )
}
