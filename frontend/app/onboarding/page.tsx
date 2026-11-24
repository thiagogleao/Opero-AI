/**
 * /onboarding — connect a store (Shopify, then optionally Meta, then the first
 * import). Also where the Shopify and Facebook OAuth flows started here come
 * back to: ?shopify_connected=true&loja=<id>&storeStartDate=…, ?fb_connected=
 * true&loja=<id>, or ?shopify_error / error / fb_error=<code>. ?store=<id> is
 * still read, from links made before the flows used the site's key.
 *
 * An archived store named in the URL is not continued (consultation only): the
 * page says so and starts over with a new store.
 *
 * A focused page (no sidebar): a new partner may have no store yet. The store
 * named in the URL is re-checked against the viewer (404 otherwise).
 */

import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { AccessError, getViewer, listStores, requireStore } from '@/lib/access'
import { isIsoDate } from '@/lib/engine/dates'
import { buildHref, parsePageParams, type SearchParams } from '@/lib/views/page'
import { Logo } from '@/components/shell'
import { ButtonLink } from '@/components/ui'
import { ArchivedNote } from '@/components/settings/ArchivedNote'
import { OnboardingWizard, type OnboardingStore } from '@/components/settings/Onboarding'
import s from '@/components/settings/settings.module.css'
import { storePageMetadata } from '@/components/settings/pageMetadata'
import { askedStoreId } from '@/components/settings/storeParam'

export const dynamic = 'force-dynamic'
export const generateMetadata = storePageMetadata('Adicionar loja', { legacyStoreKey: true })

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const viewer = await getViewer()
  if (!viewer) redirect('/sign-in')
  const stores = await listStores(viewer)

  let store: OnboardingStore | null = null
  let archivedName: string | null = null
  // ?loja=todas ("Todas as lojas", carried from any other page) names no store
  // to continue: a new connection starts, where it used to 404 under the tab
  // title "Adicionar loja". Read by the same function as generateMetadata.
  const id = askedStoreId(sp, { legacyStoreKey: true })
  if (id) {
    try {
      const ref = await requireStore(viewer, id)
      if (ref.archived) archivedName = ref.name
      else store = { id: ref.id, name: ref.name, domain: ref.domain, timezone: ref.timezone }
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
  // Links out keep the site's URL state (loja, periodo, de/ate, parte), like
  // every other page; the flow's own keys (addStore, fb_connected…) stay here.
  // Todas stays in them: "Voltar para Ajustes" goes back to where the person was.
  const state = parsePageParams({ ...sp, loja: one(sp.loja) ?? one(sp.store) })
  const href = (path: string) => buildHref(path, state)
  // The period alone, for the wizard's own links (their store is the one it connects).
  const keep = buildHref('/', { ...state, loja: null }).split('?')[1] ?? ''

  return (
    <div className={s.wizard}>
      <header className={s.wizardHead}>
        <Link href={href('/')} className={s.brand} aria-label="Opero, início"><Logo /> opero</Link>
        {stores.length > 0 && <ButtonLink href={href('/settings')} size="sm" variant="ghost">Voltar para Ajustes</ButtonLink>}
      </header>
      <div className={s.wizardBody}>
        <div>
          <h1 style={{ font: '600 22px/1.2 var(--sans)' }}>{one(sp.addStore) === 'true' || stores.length > 0 ? 'Adicionar uma loja' : 'Conecte sua loja'}</h1>
          <p className={s.sub} style={{ marginTop: 6 }}>Três passos: a loja na Shopify, a conta de anúncios (se tiver) e a primeira importação.</p>
        </div>
        {archivedName && (
          <ArchivedNote name={archivedName} restoreHref={href('/settings#lojas')} what="não dá para continuar a configuração dela aqui" />
        )}
      </div>
      <OnboardingWizard
        initialStore={store}
        initialStep={step}
        startDate={isIsoDate(date) ? date : null}
        shopifyError={shopifyError}
        fbError={fbError}
        fbConnected={fbConnected}
        isOwner={viewer.kind === 'owner'}
        now={new Date().toISOString()}
        keep={keep}
      />
    </div>
  )
}
