/**
 * ArchivedSection — "Lojas arquivadas", collapsed by default. Archived stores
 * are out of "Todas", the pickers and sync (owner's rule); their history is
 * read only when this section is opened (?arquivadas=1), so the overview never
 * pays for it otherwise. Each store links to its Resumo over its whole selling
 * span (an archived store opens by id).
 *
 * ArchivedToggle is the closed state (synchronous); ArchivedList loads.
 */

import Link from 'next/link'
import type { PageContext } from '@/lib/views/page'
import type { StoreRef } from '@/lib/access'
import { formatDate, formatMoney, formatRangeLabel, plural } from '@/lib/format'
import { Block, ButtonLink, EmptyState, ErrorState, Icon, Money, Pct } from '@/components/ui'
import { loadArchived } from './data'
import s from './portfolio.module.css'

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
    list = await loadArchived(ctx.viewer, ctx.now)
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
            const href = a.span
              ? ctx.hrefWith('/', { loja: a.store.id, periodo: 'custom', de: a.span.from, ate: a.span.to })
              : ctx.hrefWith('/', { loja: a.store.id })
            const result = t ? (a.configured ? t.operatingProfit : t.revenue - t.adSpend) : null
            return (
              <div key={a.store.id} className={s.archRow}>
                <div className={s.archCell}>
                  <b>{a.store.name}</b>
                  <small>
                    {a.archivedAt ? `arquivada em ${formatDate(a.archivedAt.slice(0, 10), ctx.today)}` : 'arquivada'}
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
                <Link href={href} className={s.archLink}>
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
