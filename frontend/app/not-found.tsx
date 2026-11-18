import Link from 'next/link'
import { Card, EmptyState } from '@/components/ui/Card'

/**
 * 404: an unknown page, or a store this viewer may not see (lib/access never
 * says which, on purpose).
 */
export default function NotFound() {
  return (
    <div style={{ maxWidth: 560, margin: '14vh auto 0', padding: '0 20px' }}>
      <Card>
        <EmptyState
          icon="search"
          title="Não encontramos esta página"
          action={<Link href="/" style={{ fontSize: 13, color: 'var(--tx)' }}>Ir para o Resumo</Link>}
        >
          O endereço não existe, ou a loja dele não está na sua conta.
        </EmptyState>
      </Card>
    </div>
  )
}
