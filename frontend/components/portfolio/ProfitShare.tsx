/**
 * ProfitShare — "De onde vem o lucro": each store's real profit in the sum the
 * verdict judged, biggest first, with its share of the total when no store of
 * the sum lost money (otherwise the shares pass 100%). Stores without
 * cost settings are not here: they are not in the sum. A store that sells on
 * ads billed to another (CAMP HALLOW on EPOCH's account) is marked on both
 * rows. Server component, for the VerdictCard footer of /overview.
 */

import type { PortfolioView } from '@/lib/views/portfolio'
import type { Verdict } from '@/lib/views/verdict'
import { formatMoney, formatPct } from '@/lib/format'
import { HorizontalBars } from '@/components/charts'
import type { SharedAdAccount } from '@/lib/attributionModels'

/** The rows ProfitShare draws: the judged stores with activity, biggest
 *  profit first. Fewer than two → it draws nothing (the page skips its card). */
export function profitShareRows(view: PortfolioView, verdict: Verdict): PortfolioView['stores'] {
  if (verdict.basis !== 'profit') return []
  const excluded = new Set(verdict.excluded.map(e => e.id))
  return view.stores
    .filter(r => !excluded.has(r.id) && r.configured && (r.totals.orders > 0 || r.totals.adSpend > 0))
    .sort((a, b) => b.totals.operatingProfit - a.totals.operatingProfit)
}

export function ProfitShare({ view, verdict, part, split = false, shared = [] }: {
  view: PortfolioView; verdict: Verdict; part: (v: number) => number
  /** Partner view: the bars are the viewer's share (`part`), and say so — a
   *  bare "De onde vem o lucro" over halved amounts read as each store's
   *  whole profit. Shares (%) are the same either way. */
  split?: boolean
  shared?: SharedAdAccount[]
}) {
  const rows = profitShareRows(view, verdict)
  if (rows.length < 2) return null
  const total = verdict.totals.operatingProfit
  // Shares only add up when nobody lost money: with Hibikura at −$147 the
  // four others read 41 + 22 + 21 + 17 = 101% of the total, and on a day
  // where one store carries the rest "181,9%". Then each bar shows its amount.
  const shares = total > 0 && rows.every(r => r.totals.operatingProfit >= 0)
  // "sua parte (50%)", as the Resumo charts name it.
  const shareWords = split ? `sua parte (${formatPct(part(1) * 100, { digits: 0 })})` : null
  return (
    <div>
      <div className="lbl" style={{ marginBottom: 8 }}>De onde vem o lucro{shareWords ? ` · ${shareWords}` : ''}</div>
      <HorizontalBars
        ariaLabel={shareWords ? `A ${shareWords} do lucro real de cada loja no período` : 'Lucro real de cada loja no período'}
        items={rows.map(r => {
          const p = r.totals.operatingProfit
          // A store selling on another's ads looks richer than it is, and the
          // payer poorer: say so next to the number.
          const sells = shared.find(x => x.salesStoreId === r.id)
          const pays = shared.find(x => x.adStoreId === r.id)
          return {
            key: r.id,
            label: r.name,
            sub: sells ? `anúncios pagos pela ${sells.adStoreName}` : pays ? `paga anúncios da ${pays.salesStoreName}` : undefined,
            value: part(p),
            display: formatMoney(part(p)),
            note: p < 0 ? 'no prejuízo' : shares && p > 0 ? formatPct((p / total) * 100) : undefined,
            tone: p < 0 ? 'neg' : 'pos',
          }
        })}
      />
    </div>
  )
}
