/**
 * RoasVsEmpate — components/ui RoasGauge, except where its one reading of a
 * missing break-even ("empate desconhecido → custos não configurados") is
 * wrong. For a store WITH cost settings the break-even is also missing when the
 * window had no sales or the sales did not cover the products
 * (lib/views/store empateGap), and a campaign that sells in another store has
 * no break-even of this store to be judged against. Those say why in words,
 * with no gauge: there is no line to draw.
 *
 *   <RoasVsEmpate roas={0} breakEven={null} gap="no_sales" label="ROAS Meta" />
 *   <RoasVsEmpate roas={1.87} breakEven={1.51} gap={null} />   → RoasGauge as is
 *
 * Props: RoasGauge's, plus gap: EmpateGap | 'shared' | null.
 */

import type { EmpateGap } from '@/lib/views/store'
import { formatRoas } from '@/lib/format'
import { RoasGauge, type RoasGaugeProps } from '@/components/ui'
import s from './dashboard.module.css'

// Mini (table cells, campaign rows): short, and about the STORE — a campaign
// can carry attributed sales on a day the store itself sold nothing.
const WORDS: Record<EmpateGap | 'shared', { full: string; mini: string; tone: 'neg' | 'mut' }> = {
  no_sales: { full: 'sem vendas no período: todo o gasto virou prejuízo', mini: 'loja sem vendas no período', tone: 'neg' },
  no_margin: { full: 'nenhum ROAS empata: as vendas não cobriram produto, frete e taxas', mini: 'nenhum ROAS empata', tone: 'neg' },
  shared: { full: 'vende em outra loja: sem empate desta para comparar', mini: 'vende em outra loja', tone: 'mut' },
}

export function RoasVsEmpate({ gap, ...gauge }: RoasGaugeProps & { gap: EmpateGap | 'shared' | null }) {
  if (!gap || gauge.roas === null || !Number.isFinite(gauge.roas)) return <RoasGauge {...gauge} />
  const w = WORDS[gap]
  const mini = gauge.size === 'mini'
  return (
    <span className={`${s.roasGap}${mini ? ` ${s.roasGapMini}` : ''}`} title={mini ? w.full : undefined}>
      <span>{gauge.label ?? 'ROAS'} <b>{formatRoas(gauge.roas)}</b></span>
      <span className={s.roasGapSep}>·</span>
      <span className={gauge.paused ? 'mut' : w.tone}>{gauge.paused ? 'pausada' : mini ? w.mini : w.full}</span>
    </span>
  )
}
