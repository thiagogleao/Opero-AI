import type { Metadata } from 'next'
import Link from 'next/link'
import { Suspense } from 'react'
import { Card, EmptyState } from '@/components/ui/Card'
import { KeepPeriodLink } from '@/components/shell/KeepPeriodLink'

/**
 * 404: an unknown page, or a store this viewer may not see (lib/access never
 * says which, on purpose).
 *
 * The title below replaces the page's own ("Resumo · Opero") whenever Next
 * renders the not-found metadata: for an unknown URL, and when a page's
 * generateMetadata throws notFound() — lib/views/page pageMetadata does that
 * for a ?loja the viewer cannot see. A notFound() thrown only by the page
 * component comes after the page's static title was already sent, so pages
 * that open a store must use pageMetadata.
 *
 * Status: these 404s answer HTTP 200 + noindex, because the root loading.tsx
 * starts streaming before the page runs (node_modules/next/dist/docs/01-app/
 * 03-api-reference/03-file-conventions/loading.md, "Status Codes").
 */
export const metadata: Metadata = { title: 'Página não encontrada' }

const linkStyle = { fontSize: 13, color: 'var(--tx)' }

export default function NotFound() {
  return (
    <div style={{ maxWidth: 560, margin: '14vh auto 0', padding: '0 20px' }}>
      <Card>
        <EmptyState
          icon="search"
          title="Não encontramos esta página"
          action={
            // Keeps the period the user was looking at (not the store: it may
            // be the store that was not found).
            <Suspense fallback={<Link href="/" style={linkStyle}>Ir para o Resumo</Link>}>
              <KeepPeriodLink path="/" style={linkStyle}>Ir para o Resumo</KeepPeriodLink>
            </Suspense>
          }
        >
          O endereço não existe, ou a loja dele não está na sua conta.
        </EmptyState>
      </Card>
    </div>
  )
}
