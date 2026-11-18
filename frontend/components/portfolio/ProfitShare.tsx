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

export function ProfitShare({ view, verdict, part, shared = [] }: {
  view: PortfolioView; verdict: Verdict; part: (v: number) => number; shared?: SharedAdAccount[]
}) {
  if (verdict.basis !== 'profit') return null
  const excluded = new Set(verdict.excluded.map(e => e.id))
  const rows = view.stores
    .filter(r => !excluded.has(r.id) && r.configured && (r.totals.orders > 0 || r.totals.adSpend > 0))
    .sort((a, b) => b.totals.operatingProfit - a.totals.operatingProfit)
  if (rows.length < 2) return null
  const total = verdict.totals.operatingProfit
  // Shares only add up when nobody lost money: with Hibikura at −$147 the
  // four others read 41 + 22 + 21 + 17 = 101% of the total, and on a day
  // where one store carries the rest "181,9%". Then each bar shows its amount.
  const shares = total > 0 && rows.every(r => r.totals.operatingProfit >= 0)
  return (
    <div>
      <div className="lbl" style={{ marginBottom: 8 }}>De onde vem o lucro</div>
      <HorizontalBars
        ariaLabel="Lucro real de cada loja no período"
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
