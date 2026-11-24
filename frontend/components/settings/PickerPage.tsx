import 'server-only'

/**
 * The page behind /facebook/accounts and /facebook/extra-accounts: the
 * Facebook callback sends the person here (?loja=<id>[&manual=true]) when a
 * login can read several ad accounts, or none, or linking it automatically
 * would replace the store's main account. ?store=<id> is still read, for links
 * made before the callback used the site's key.
 *
 * An archived store gets no picker: it is for consultation only, and the
 * server would refuse the link anyway (409 store_archived).
 */

import { cookies } from 'next/headers'
import { pickerFor } from '@/lib/integrations/fbConnect'
import { HttpError } from '@/lib/integrations/http'
import { FB_PENDING_COOKIE } from '@/lib/integrations/pending'
import type { FacebookPicker as Picker } from '@/lib/integrations/types'
import { getPageContext, type SearchParams } from '@/lib/views/page'
import { AppShell, PageHeader } from '@/components/shell'
import { Block, ButtonLink, EmptyState, ErrorState } from '@/components/ui'
import { AnchorButton } from './AnchorButton'
import { ArchivedNote } from './ArchivedNote'
import { FacebookPicker } from './FacebookPicker'
import { FACEBOOK_ERROR, codeText } from './messages'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export async function PickerPage({ searchParams, role }: { searchParams: Promise<SearchParams>; role: 'main' | 'extra' }) {
  const sp = await searchParams
  // ?loja= is the site's key; ?store= only from older links.
  const ctx = await getPageContext({ ...sp, loja: one(sp.loja) ?? one(sp.store) }, { scope: 'store' })
  const store = ctx.store
  const title = role === 'main' ? 'Escolher a conta principal de anúncios' : 'Adicionar conta extra de anúncios'
  const settings = ctx.hrefWith('/settings')

  let picker: Picker | null = null
  let failure: { code: string; text: string } | null = null
  if (store && !store.archived) {
    try {
      picker = await pickerFor(ctx.viewer, store, (await cookies()).get(FB_PENDING_COOKIE)?.value)
    } catch (err) {
      if (err instanceof HttpError) failure = { code: err.code, text: codeText(FACEBOOK_ERROR, err.code) ?? err.message }
      else {
        console.error('[facebook picker]', err instanceof Error ? err.message : err)
        failure = { code: 'internal', text: 'O Facebook não respondeu com as contas. Nada foi alterado.' }
      }
    }
  }

  return (
    <AppShell ctx={ctx}>
      <PageHeader ctx={ctx} title={title} sub={store ? `Loja: ${store.name}` : undefined} halved={false} actions={<ButtonLink href={settings} size="sm" variant="ghost">Voltar para Ajustes</ButtonLink>} />
      {!store ? (
        <EmptyState icon="store" title="Nenhuma loja">Conecte uma loja antes de ligar contas de anúncio.</EmptyState>
      ) : store.archived ? (
        <ArchivedNote name={store.name} restoreHref={ctx.hrefWith('/settings#lojas')} what="não dá para ligar contas de anúncio a ela" />
      ) : failure ? (
        <ErrorState
          title="Não dá para escolher a conta agora"
          action={<AnchorButton href={`/api/facebook/auth?store=${encodeURIComponent(store.id)}&mode=${role}&return=${encodeURIComponent(settings)}`} icon="refresh">Conectar com o Facebook de novo</AnchorButton>}
        >
          {failure.text}
        </ErrorState>
      ) : picker && (
        <Block title="Contas que este login enxerga" howTo="Contas desativadas no Meta não são coletadas. Uma conta só pode estar ligada a uma loja.">
          <FacebookPicker
            picker={picker}
            role={role}
            manual={one(sp.manual) === 'true'}
            timezone={store.timezone}
            today={ctx.today}
            settingsHref={ctx.hrefWith('/settings?fb_connected=true', { loja: store.id })}
          />
        </Block>
      )}
    </AppShell>
  )
}
