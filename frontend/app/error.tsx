'use client'

/**
 * Root error boundary: a page failed to render (the database timed out, a
 * query broke). Says so plainly, offers a retry and a way home, and never
 * shows a half-drawn page with wrong numbers. The digest matches the server
 * log line.
 */

import { useEffect } from 'react'
import Link from 'next/link'
import { Button, ErrorState } from '@/components/ui/Card'
import { Card } from '@/components/ui/Card'

export default function RouteError({ error, unstable_retry, reset }: {
  error: Error & { digest?: string }
  unstable_retry?: () => void
  reset?: () => void
}) {
  useEffect(() => { console.error('[page]', error) }, [error])
  const retry = unstable_retry ?? reset
  return (
    <div style={{ maxWidth: 640, margin: '12vh auto 0', padding: '0 20px' }}>
      <Card>
        <ErrorState
          title="Esta página não carregou"
          action={
            <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
              {retry && <Button variant="primary" icon="refresh" onClick={() => retry()}>Tentar de novo</Button>}
              <Link href="/" style={{ alignSelf: 'center', fontSize: 13, color: 'var(--tx-2)' }}>Ir para o Resumo</Link>
            </div>
          }
        >
          Os números não chegaram e nada foi alterado. Costuma ser uma falha passageira na leitura do banco.
          {error.digest && <span style={{ display: 'block', marginTop: 6, fontFamily: 'var(--mono)', fontSize: 11 }}>código {error.digest}</span>}
        </ErrorState>
      </Card>
    </div>
  )
}
