import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getTenant } from '@/lib/tenant'
import ProfitModule from '@/components/ProfitModule'
import Sidebar from '@/components/Sidebar'

export const revalidate = 0

export default async function ProfitPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  const tenant = await getTenant(userId)
  if (!tenant?.onboarded) redirect('/onboarding')
  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <Sidebar active="/profit" />

      <main style={{ marginLeft: 56, flex: 1, padding: '28px 32px' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#F4F4F5', letterSpacing: '-0.4px' }}>
            Calculadora de Lucro
          </h1>
          <p style={{ color: '#52525B', fontSize: 13, marginTop: 3 }}>
            Configure seus custos reais e veja o lucro líquido da operação
          </p>
        </div>
        <ProfitModule />
      </main>
    </div>
  )
}
