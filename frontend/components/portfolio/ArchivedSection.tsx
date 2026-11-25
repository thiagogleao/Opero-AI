/**
 * ArchivedSection — "Lojas arquivadas", collapsed by default. Archived stores
 * are out of "Todas", the pickers and sync (owner's rule); their history is
 * read only when this section is opened (?arquivadas=1), so the overview never
 * pays for it otherwise. Each store opens its Resumo on the 30 days ending on
 * its archive day, as dates (R10, lib/period archiveOpening), labelled there
 * "últimos 30 dias até o arquivamento"; another period is one pick away.
 *
 * ArchivedToggle is the closed state (synchronous); ArchivedList loads.
 */

import Link from 'next/link'
import type { PageContext } from '@/lib/views/page'
import type { StoreRef } from '@/lib/access'
import { formatMoney, formatRangeLabel, plural } from '@/lib/format'
import { Block, ButtonLink, EmptyState, ErrorState, Icon, Money, Pct } from '@/components/ui'
import { loadArchived } from './data'
import { storeDayOf } from './model'
import s from './portfolio.module.css'
import { archiveOpening, dateBeside } from '@/lib/period'

export const ARCHIVED_PARAM = 'arquivadas'

export function ArchivedClosed({ ctx, stores }: { ctx: PageContext; stores: Pick<StoreRef, 'id' | 'name'>[] }) {
  return (
    <Block
      id="arquivadas"
      flush
      title={`Lojas arquivadas (${stores.length})`}
      howTo={`${stores.map(st => st.name).join(', ')}. Lojas arquivadas saem do total, dos seletores e da sincronização; o histórico continua aqui e só é lido quando você abre.`}
      actions={<ButtonLink href={ctx.hrefWith(`/overview?${ARCHIVED_PARAM}=1#arquivadas`)} size="sm" icon="chev">Mostrar histórico</ButtonLink>}
    />
  )
}

export async function ArchivedList({ ctx }: { ctx: PageContext }) {
  const hide = <ButtonLink href={ctx.hrefWith('/overview#arquivadas')} size="sm" icon="chevUp">Esconder</ButtonLink>
  let list
  try {
    list = await loadArchived(ctx.viewer, ctx.now, ctx.viewerStores)
  } catch (err) {
    console.error('[overview] archived', err)
    return <Block id="arquivadas" title="Lojas arquivadas" actions={hide}><ErrorState compact /></Block>
  }
  return (
    <Block
      id="arquivadas"
      title="Lojas arquivadas"
      howTo="O histórico inteiro de cada loja arquivada, do primeiro ao último dia com vendas ou anúncios. Não entra no total de cima."
      actions={hide}
    >
      {list.length === 0 ? (
        <EmptyState compact icon="box" title="Nenhuma loja arquivada">Quando uma loja for arquivada nos Ajustes, o histórico dela fica aqui.</EmptyState>
      ) : (
        <div className={s.archList}>
          {list.map(a => {
            const t = a.totals
            // R10: the 30 days ending on the archive day, the same opening as
            // the phone's Ajustes list.
            const facts = ctx.viewerStores.archived.find(x => x.id === a.store.id)
            const open = facts ? archiveOpening(facts) : null
            const href = open
              ? ctx.hrefWith('/', { loja: a.store.id, periodo: 'custom', de: open.from, ate: open.to })
              : ctx.hrefWith('/', { loja: a.store.id })
            const result = t ? (a.configured ? t.operatingProfit : t.revenue - t.adSpend) : null
            // The store's own day, as Ajustes → Lojas prints it (archivedAt is a UTC instant).
            const archivedOn = storeDayOf(a.archivedAt, a.store.timezone)
            return (
              <div key={a.store.id} className={s.archRow}>
                <div className={s.archCell}>
                  <b>{a.store.name}</b>
                  <small>
                    {archivedOn ? `arquivada em ${dateBeside(archivedOn, { window: { from: archivedOn, to: archivedOn }, clockToday: ctx.today })}` : 'arquivada'}
                    {a.span ? ` · histórico de ${formatRangeLabel(a.span, ctx.today)}` : ' · sem vendas registradas'}
                  </small>
                </div>
                <div className={s.archCell}>
                  <span className="lbl">{a.configured ? 'Lucro real' : 'Receita − anúncios'}{ctx.split ? ' (sua parte)' : ''}</span>
                  {result === null ? <span className="num mut">—</span> : <Money value={ctx.part(result)} tone="auto" />}
                </div>
                <div className={s.archCell}>
                  <span className="lbl">Receita</span>
                  {t ? <Money value={t.revenue} /> : <span className="num mut">—</span>}
                  {t && <small>{plural(t.orders, 'pedido', 'pedidos')}</small>}
                </div>
                <div className={s.archCell}>
                  <span className="lbl">Margem</span>
                  {t && a.configured ? <Pct value={t.margin} tone={t.margin !== null && t.margin < 0 ? 'neg' : 'none'} /> : <span className="num mut">—</span>}
                </div>
                <div className={s.archCell}>
                  <span className="lbl">Anúncios</span>
                  {t ? <Money value={t.adSpend} /> : <span className="num mut">—</span>}
                  {t && t.adSpend > 0 && <small>Meta {formatMoney(t.metaSpend)}{t.shopSpend > 0 ? ` · Shopify ${formatMoney(t.shopSpend)}` : ''}</small>}
                </div>
                <Link href={href} className={s.archLink} title={open ? 'Abre os últimos 30 dias até o arquivamento' : undefined}>
                  Abrir histórico <Icon name="arrowRight" size={12} />
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </Block>
  )
}
