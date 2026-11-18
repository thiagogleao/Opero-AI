/** /facebook/extra-accounts?store=<id>[&manual=true] — link an extra ad account after a Facebook login. */
import type { SearchParams } from '@/lib/views/page'
import { PickerPage } from '@/components/settings/PickerPage'

export const dynamic = 'force-dynamic'

export default function FacebookExtraAccountsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <PickerPage searchParams={searchParams} role="extra" />
}
