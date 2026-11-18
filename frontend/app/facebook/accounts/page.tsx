/** /facebook/accounts?loja=<id> (also ?store=, from older links) — pick a store's main ad account after a Facebook login. */
import type { SearchParams } from '@/lib/views/page'
import { PickerPage } from '@/components/settings/PickerPage'
import { storePageMetadata } from '@/components/settings/pageMetadata'

export const dynamic = 'force-dynamic'
export const generateMetadata = storePageMetadata('Conta principal de anúncios', { legacyStoreKey: true })

export default function FacebookAccountsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <PickerPage searchParams={searchParams} role="main" />
}
