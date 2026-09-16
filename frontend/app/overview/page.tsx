import { Suspense } from 'react'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getTenantsByUserId, toStoreOptions } from '@/lib/tenant'
import { getActiveTenantId } from '@/lib/activeStore'
import { getTenantTimezone } from '@/lib/queries'
import { accountStores, getAccountOverview } from '@/lib/accountOverview'
import AccountOverview from '@/components/AccountOverview'
import StoreSwitcher from '@/components/StoreSwitcher'
import TimeframeSelector from '@/components/TimeframeSelector'
import Sidebar from '@/components/Sidebar'
import RefreshButton from '@/components/RefreshButton'
import AutoSync from '@/components/AutoSync'

export const revalidate = 0

/** Returns YYYY-MM-DD in the given IANA timezone. */
function dateInTz(d: Date, tz: string): string {
  return d.toLocaleDateString('en-CA', { timeZone: tz })
}

interface Props {
  searchParams: Promise<{ from?: string; to?: string; days?: string }>
}

export default async function AccountOverviewPage({ searchParams }: Props) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  let tenants: Awaited<ReturnType<typeof getTenantsByUserId>>
  try {
    tenants = await getTenantsByUserId(userId)
  } catch {
    redirect('/onboarding')
  }

  const stores = accountStores(tenants)
  // The account view only means anything with more than one store.
  if (stores.length < 2) redirect('/')

  const activeId = await getActiveTenantId(userId)
  let tz = 'UTC'
  try { tz = await getTenantTimezone(activeId) } catch { /* UTC is fine */ }

  const sp = await searchParams
  const now = new Date()
  const todayISO = dateInTz(now, tz)

  let dateFrom: string
  let dateTo: string
  if (sp.from && sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) && /^\d{4}-\d{2}-\d{2}$/.test(sp.to)) {
    dateFrom = sp.from
    dateTo   = sp.to
  } else if (sp.days) {
    const days = Math.min(Math.max(Number(sp.days) || 1, 1), 730)
    dateFrom = dateInTz(new Date(now.getTime() - (days - 1) * 86400000), tz)
    dateTo   = todayISO
  } else {
    // The point of this page is "how is the account doing today".
    dateFrom = todayISO
    dateTo   = todayISO
  }

  const days = Math.round(
    (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000
  ) + 1

  const data = await getAccountOverview(stores, dateFrom, dateTo)

  const lastSync = data.lastSyncIso
    ? new Date(data.lastSyncIso).toLocaleString('pt-BR', { timeZone: tz })
    : 'Nunca'

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <Sidebar active="/" />

      <main style={{ marginLeft: 56, flex: 1, padding: '28px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>
              Visão geral da conta
            </h1>
            <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 3 }}>
              {dateFrom === dateTo ? dateFrom : `${dateFrom} → ${dateTo} · ${days} dias`}
              {' · '}{stores.length} lojas · Última sync: {lastSync}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <AutoSync lastSyncIso={data.lastSyncIso} />
            <RefreshButton />
            <Suspense>
              <TimeframeSelector from={dateFrom} to={dateTo} />
            </Suspense>
            <StoreSwitcher
              stores={toStoreOptions(stores)}
              activeStoreId={activeId}
              showOverview
              overviewActive
            />
          </div>
        </div>

        <AccountOverview data={data} days={days} />
      </main>
    </div>
  )
}
