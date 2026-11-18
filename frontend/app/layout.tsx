import type { Metadata, Viewport } from 'next'
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google'
import { ClerkProvider } from '@clerk/nextjs'
import { SettingsProvider } from '@/contexts/SettingsContext'
import './globals.css'

/**
 * Root layout: fonts, tokens (globals.css), Clerk, and the legacy settings
 * context the old pages still read until the final cleanup.
 *
 * Fonts are self-hosted by next/font and exposed as CSS variables that
 * globals.css maps to --sans / --mono / --serif. Dark only: the old light
 * theme and its pre-hydration script are gone.
 *
 * New pages do NOT get the app shell from here: each page wraps itself in
 * <AppShell ctx={...}> (components/shell/AppShell), so the old pages keep
 * their own layout until they are replaced.
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

/** Clerk's sign-in, on the dark tokens. Values are literal because Clerk
 *  renders some parts outside our CSS (it derives shades from them). */
const clerkAppearance = {
  variables: {
    colorPrimary: '#e7ebef',
    colorPrimaryForeground: '#08090c',
    colorBackground: '#11151a',
    colorForeground: '#e7ebef',
    colorMutedForeground: '#a7b1bc',
    colorMuted: '#151a20',
    colorInput: '#0d1014',
    colorInputForeground: '#e7ebef',
    colorBorder: '#272e37',
    colorRing: '#7fb2ee',
    colorDanger: '#f2837a',
    colorSuccess: '#4fcb98',
    colorWarning: '#e5b65e',
    colorNeutral: '#e7ebef',
    colorShadow: '#000000',
    colorModalBackdrop: 'rgba(8, 9, 12, .7)',
    fontFamily: 'var(--sans)',
    fontFamilyButtons: 'var(--sans)',
    borderRadius: '10px',
  },
  elements: {
    card: { border: '1px solid #1c2229', boxShadow: '0 30px 80px -20px rgba(0,0,0,.7)' },
    footer: { background: '#0d1014' },
  },
}

/** Portuguese for the sign-in flow (the @clerk/localizations package is not
 *  installed; these are the strings a partner actually meets). */
const clerkLocalization = {
  locale: 'pt-BR',
  backButton: 'Voltar',
  dividerText: 'ou',
  formButtonPrimary: 'Continuar',
  formFieldLabel__emailAddress: 'E-mail',
  formFieldInputPlaceholder__emailAddress: 'seu e-mail',
  formFieldLabel__password: 'Senha',
  formFieldInputPlaceholder__password: 'sua senha',
  formFieldAction__forgotPassword: 'Esqueceu a senha?',
  socialButtonsBlockButton: 'Continuar com {{provider|titleize}}',
  signIn: {
    start: {
      title: 'Entrar no Opero',
      subtitle: 'Acesso para sócios das lojas',
      actionText: '',
      actionLink: '',
    },
    password: {
      title: 'Digite sua senha',
      subtitle: 'para continuar no Opero',
      actionLink: 'Usar outro método',
    },
    emailCode: {
      title: 'Confira seu e-mail',
      subtitle: 'para continuar no Opero',
      formTitle: 'Código de verificação',
      resendButton: 'Não recebeu? Reenviar',
    },
    forgotPasswordAlternativeMethods: {
      title: 'Esqueceu a senha?',
      label__alternativeMethods: 'Ou entre de outro jeito',
      blockButton__resetPassword: 'Redefinir a senha',
    },
    alternativeMethods: {
      title: 'Outro jeito de entrar',
      actionLink: 'Pedir ajuda',
      blockButton__emailCode: 'Receber código em {{identifier}}',
      blockButton__password: 'Entrar com senha',
    },
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider appearance={clerkAppearance} localization={clerkLocalization}>
      <html
        lang="pt-BR"
        className={`${plexSans.variable} ${plexMono.variable} ${fraunces.variable}`}
        suppressHydrationWarning
      >
        <body>
          <SettingsProvider>
            {children}
          </SettingsProvider>
        </body>
      </html>
    </ClerkProvider>
  )
}
