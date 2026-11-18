/** /facebook/extra-accounts?loja=<id>[&manual=true] (also ?store=, from older links) — link an extra ad account after a Facebook login. */
import type { SearchParams } from '@/lib/views/page'
import { PickerPage } from '@/components/settings/PickerPage'
import { storePageMetadata } from '@/components/settings/pageMetadata'

export const dynamic = 'force-dynamic'
export const generateMetadata = storePageMetadata('Conta extra de anúncios', { legacyStoreKey: true })

export default function FacebookExtraAccountsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <PickerPage searchParams={searchParams} role="extra" />
}
