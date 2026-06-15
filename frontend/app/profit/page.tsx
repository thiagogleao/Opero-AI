import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getTenant } from '@/lib/tenant'
import { getActiveTenantId } from '@/lib/activeStore'
import ProfitModule from '@/components/ProfitModule'
import CampaignProfitTable from '@/components/CampaignProfitTable'
import ProductProfitTable from '@/components/ProductProfitTable'
import Sidebar from '@/components/Sidebar'

export const revalidate = 0

export default async function ProfitPage() {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  const tenantId = await getActiveTenantId(userId)
  const tenant = await getTenant(tenantId)
  if (!tenant?.onboarded) redirect('/onboarding')
  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <Sidebar active="/profit" />

      <main style={{ marginLeft: 56, flex: 1, padding: '28px 32px' }}>
        <div style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>
            Calculadora de Lucro
          </h1>
          <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 3 }}>
            Configure seus custos reais e veja o lucro líquido da operação
          </p>
        </div>
        <ProfitModule />

        <div style={{ marginTop: 32, marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            Análise de Lucratividade
          </h2>
          <p style={{ color: 'var(--text-faint)', fontSize: 12 }}>
            Lucro estimado por campanha e produto com base nos custos configurados acima
          </p>
        </div>
        <CampaignProfitTable />
        <ProductProfitTable />
      </main>
    </div>
  )
}
