import { Suspense } from 'react'
import { auth } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'
import { getTenant, getTenantsByUserId, toStoreOptions } from '@/lib/tenant'
import { getActiveTenantId } from '@/lib/activeStore'
import { getTenantTimezone } from '@/lib/queries'
import { accountStores } from '@/lib/accountOverview'
import {
  getCoverage, getCreativeAttribution, getSourceBreakdown, getRecentJourneys,
  type Model,
} from '@/lib/attribution'
import AttributionView from '@/components/AttributionView'
import StoreSwitcher from '@/components/StoreSwitcher'
import TimeframeSelector from '@/components/TimeframeSelector'
import Sidebar from '@/components/Sidebar'

export const revalidate = 0

function dateInTz(d: Date, tz: string): string {
  return d.toLocaleDateString('en-CA', { timeZone: tz })
}

interface Props {
  searchParams: Promise<{ from?: string; to?: string; model?: string }>
}

export default async function AttributionPage({ searchParams }: Props) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')

  let tenantId: string
  try { tenantId = await getActiveTenantId(userId) } catch { redirect('/onboarding') }
  const tenant = await getTenant(tenantId)
  if (!tenant?.onboarded) redirect('/onboarding')

  let stores: Awaited<ReturnType<typeof getTenantsByUserId>> = []
  try { stores = await getTenantsByUserId(userId) } catch { /* switcher can be empty */ }

  let tz = 'UTC'
  try { tz = await getTenantTimezone(tenantId) } catch { /* UTC */ }

  const sp = await searchParams
  const now = new Date()
  const valid = (s?: string) => Boolean(s && /^\d{4}-\d{2}-\d{2}$/.test(s))
  const dateTo   = valid(sp.to)   ? sp.to!   : dateInTz(now, tz)
  const dateFrom = valid(sp.from) ? sp.from! : dateInTz(new Date(now.getTime() - 29 * 86400000), tz)

  const model: Model =
    sp.model === 'last' || sp.model === 'linear' || sp.model === 'first' ? sp.model : 'first'

  // One section failing should cost that section, not the page. Before this,
  // any single query throwing took the whole screen down with it.
  const fallbackCoverage = { orders: 0, withJourney: 0, withAd: 0, pct: 0, attributablePct: 0 }
  const [coverage, creatives, sources, journeys] = await Promise.all([
    getCoverage(tenantId, dateFrom, dateTo)
      .catch(e => { console.error('[attribution] coverage', e); return fallbackCoverage }),
    getCreativeAttribution(tenantId, dateFrom, dateTo, model)
      .catch(e => { console.error('[attribution] creatives', e); return [] }),
    getSourceBreakdown(tenantId, dateFrom, dateTo)
      .catch(e => { console.error('[attribution] sources', e); return [] }),
    getRecentJourneys(tenantId, dateFrom, dateTo, 30)
      .catch(e => { console.error('[attribution] journeys', e); return [] }),
  ])

  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg)' }}>
      <Sidebar active="/attribution" />

      <main style={{ marginLeft: 56, flex: 1, padding: '28px 32px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.4px' }}>
              Atribuição
            </h1>
            <p style={{ color: 'var(--text-faint)', fontSize: 13, marginTop: 3 }}>
              O caminho que cada venda percorreu, pelo registro da própria Shopify
              {' · '}{dateFrom} → {dateTo}
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <Suspense>
              <TimeframeSelector from={dateFrom} to={dateTo} />
            </Suspense>
            <StoreSwitcher
              stores={toStoreOptions(stores)}
              activeStoreId={tenantId}
              showOverview={accountStores(stores).length > 1}
            />
          </div>
        </div>

        <AttributionView
          coverage={coverage}
          creatives={creatives}
          sources={sources}
          journeys={journeys}
          model={model}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      </main>
    </div>
  )
}
