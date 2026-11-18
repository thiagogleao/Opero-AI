/**
 * /onboarding — connect a store (Shopify, then optionally Meta, then the first
 * import). Also where the Shopify and Facebook OAuth flows started here come
 * back to: ?shopify_connected=true&store=<id>&storeStartDate=…, ?fb_connected=
 * true&store=<id>, or ?shopify_error / error / fb_error=<code>.
 *
 * A focused page (no sidebar): a new partner may have no store yet. The store
 * named in the URL is re-checked against the viewer (404 otherwise).
 */

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { AccessError, getViewer, listStores, requireStore } from '@/lib/access'
import { isIsoDate } from '@/lib/engine/dates'
import type { SearchParams } from '@/lib/views/page'
import { Logo } from '@/components/shell'
import { ButtonLink } from '@/components/ui'
import { OnboardingWizard, type OnboardingStore } from '@/components/settings/Onboarding'
import s from '@/components/settings/settings.module.css'

export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const viewer = await getViewer()
  if (!viewer) redirect('/sign-in')
  const stores = await listStores(viewer)

  let store: OnboardingStore | null = null
  const id = one(sp.store)
  if (id) {
    try {
      const ref = await requireStore(viewer, id)
      store = { id: ref.id, name: ref.name, domain: ref.domain, timezone: ref.timezone }
    } catch (err) {
      if (err instanceof AccessError) notFound()
      throw err
    }
  }

  const shopifyError = one(sp.shopify_error) ?? one(sp.error) ?? null
  const fbError = one(sp.fb_error) ?? null
  const fbConnected = one(sp.fb_connected) === 'true'
  const date = one(sp.storeStartDate)
  const step = !store || shopifyError ? 'shopify' : fbConnected ? 'import' : 'facebook'

  return (
    <div className={s.wizard}>
      <header className={s.wizardHead}>
        <Link href="/" className={s.brand} aria-label="Opero, início"><Logo /> opero</Link>
        {stores.length > 0 && <ButtonLink href="/settings" size="sm" variant="ghost">Voltar para Ajustes</ButtonLink>}
      </header>
      <div className={s.wizardBody}>
        <div>
          <h1 style={{ font: '600 22px/1.2 var(--sans)' }}>{one(sp.addStore) === 'true' || stores.length > 0 ? 'Adicionar uma loja' : 'Conecte sua loja'}</h1>
          <p className={s.sub} style={{ marginTop: 6 }}>Três passos: a loja na Shopify, a conta de anúncios (se tiver) e a primeira importação.</p>
        </div>
      </div>
      <OnboardingWizard
        initialStore={store}
        initialStep={step}
        startDate={isIsoDate(date) ? date : null}
        shopifyError={shopifyError}
        fbError={fbError}
        fbConnected={fbConnected}
        isOwner={viewer.kind === 'owner'}
      />
    </div>
  )
}
