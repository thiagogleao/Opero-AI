/**
 * "De onde vieram as vendas": the first recorded visit of every order, of any
 * origin. Named as such on screen because it is a different rule from the
 * creative table's first AD click, and the two counts differ. Server-safe.
 */

import type { SourceRow } from '@/lib/attributionModels'
import { SOURCE_RULE } from '@/lib/attributionModels'
import { formatShare, plural } from '@/lib/format'
import { Block, EmptyState } from '@/components/ui'
import { HorizontalBars, type HorizontalBarItem } from '@/components/charts'
import { sourceLabel } from './model'
import { WhyEmpty, type EmptyWindowText } from '@/components/campaigns/emptyWhy'

export function SourceBars({ sources, rangeLabel, why = null }: {
  sources: SourceRow[]; rangeLabel: string
  /** The verdict's reason the window is empty (components/campaigns/emptyWhy). */
  why?: EmptyWindowText | null
}) {
  const total = sources.reduce((a, r) => a + r.revenue, 0)
  // Raw names that read the same once translated ("an unknown source" and a
  // missing source; "https://shop.com/" and "https://www.shop.com/") are one bar.
  const merged = new Map<string, SourceRow>()
  for (const r of sources) {
    const label = sourceLabel(r.source)
    const m = merged.get(label)
    if (m) { m.orders += r.orders; m.revenue += r.revenue } else merged.set(label, { source: r.source, orders: r.orders, revenue: r.revenue })
  }
  const items: HorizontalBarItem[] = [...merged.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .map(([label, r]) => ({
      key: label,
      label,
      sub: plural(r.orders, 'pedido', 'pedidos'),
      value: r.revenue,
      note: total > 0 ? formatShare((r.revenue / total) * 100) : undefined,
      tone: r.source === 'Anúncio pago' ? 'meta' : r.source === 'Sem rastreio' ? 'mut' : 'neu',
    }))
  return (
    <Block
      title="De onde vieram as vendas"
      howTo={`${SOURCE_RULE}, em ${rangeLabel}. Não é o primeiro clique em anúncio da tabela acima: aqui vale a primeira visita, viesse de onde viesse.`}
      info={<>
        <p><b>Anúncio pago</b>: a primeira visita veio de um link com o id de um anúncio do Meta.</p>
        <p><b>Pago sem identificação</b>: visita marcada como paga, mas o link só traz campanha ou conjunto, sem o anúncio.</p>
        <p><b>Sem rastreio</b>: a Shopify não registrou nenhuma visita antes do pedido (app, link direto de checkout, navegador que bloqueia).</p>
      </>}
    >
      {items.length
        ? <HorizontalBars items={items} ariaLabel={`Vendas por origem da primeira visita, ${rangeLabel}`} />
        : why ? <WhyEmpty why={why} />
          : <EmptyState compact icon="ring" title="Sem pedidos no período">Nenhum pedido entre {rangeLabel} para mostrar a origem.</EmptyState>}
    </Block>
  )
}
