import type { Metadata } from 'next'
import { SignIn } from '@clerk/nextjs'
import s from './page.module.css'

export const metadata: Metadata = { title: 'Entrar' }

/**
 * Sign-in for partners, on the dark design (tokens from app/globals.css; the
 * Clerk card's colours and words come from ../clerk.ts through the root
 * layout's ClerkProvider).
 *
 * Opero is a private tool: accounts are created by the owner and the public
 * /sign-up page is gone. withSignUp={false} turns off Clerk's combined
 * sign-in-or-up flow and the footer link to it is hidden; turning sign-ups off
 * in the Clerk dashboard is what actually closes them. The line under the
 * headline tells a partner why there is no "create account" link.
 */
export default function SignInPage() {
  return (
    <main className={s.page}>
      <div className={s.column}>
        <header className={s.intro}>
          <div className={s.brand}>
            <span className={s.mark}><Logo /></span>
            <span className={s.name}>opero</span>
            <span className={s.tag}>AI</span>
          </div>
          <h1 className={s.lead}>O lucro real das suas lojas, depois de todos os custos.</h1>
          <p className={s.sub}>
            Acesso só para sócios. As contas são criadas pelo dono do Opero: não há cadastro aberto.
          </p>
        </header>

        <SignIn
          withSignUp={false}
          appearance={{
            elements: {
              rootBox: { width: '100%' },
              cardBox: { width: '100%', maxWidth: '100%' },
              footerAction: { display: 'none' },
            },
          }}
        />

        <p className={s.foot}>Pedidos da Shopify e gasto do Meta · valores em US$</p>
      </div>
    </main>
  )
}

/** The mark from the app shell's sidebar (components/shell/AppShell `Logo`).
 *  Drawn here rather than imported: AppShell's module also loads the
 *  server-only freshness block, which reads the database. */
function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="1" y="1" width="18" height="18" rx="5" fill="none" stroke="var(--tx)" strokeWidth="1.6" />
      <path d="M5 13.5l3.2-3.6 2.6 2.2L15 6.5" fill="none" stroke="var(--pos)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
