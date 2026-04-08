import type { Metadata } from 'next'
import './globals.css'
import { ClerkProvider } from '@clerk/nextjs'
import { SettingsProvider } from '@/contexts/SettingsContext'

export const metadata: Metadata = {
  title: 'Opero AI',
  description: 'Facebook Ads + Shopify analytics powered by Claude AI',
}

// Prevents theme flash on load by reading localStorage before React hydrates
const themeScript = `
  (function() {
    try {
      var s = JSON.parse(localStorage.getItem('opero_settings') || '{}');
      document.documentElement.setAttribute('data-theme', s.theme || 'dark');
    } catch(e) {
      document.documentElement.setAttribute('data-theme', 'dark');
    }
  })();
`

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="pt-BR" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body>
          <SettingsProvider>
            {children}
          </SettingsProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
