/** /facebook/accounts?store=<id> — pick a store's main ad account after a Facebook login. */
import type { SearchParams } from '@/lib/views/page'
import { PickerPage } from '@/components/settings/PickerPage'

export const dynamic = 'force-dynamic'

export default function FacebookAccountsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <PickerPage searchParams={searchParams} role="main" />
}
