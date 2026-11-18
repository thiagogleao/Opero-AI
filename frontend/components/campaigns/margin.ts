/**
 * The StoreMargin lib/data/creatives accepts (opts.margin), built from an
 * engine P&L the page already computed — so the creatives report does not
 * price the same store and window a second time. Same derivation as
 * lib/data/meta.loadStoreMargin (contribution ÷ revenue; the engine's
 * break-even only when costs are configured).
 */

import type { StorePnL } from '@/lib/engine/pnl'
import type { DateRange } from '@/lib/engine/dates'
import type { StoreMargin } from '@/lib/data/meta'

export function storeMarginFromPnL(range: DateRange, p: StorePnL | null): StoreMargin {
  if (!p) {
    return { range, configured: false, contributionRate: null, breakEvenRoas: null, revenue: 0, orders: 0, metaSpend: 0, metaPurchaseValue: 0, partial: false }
  }
  const t = p.totals
  return {
    range,
    configured: p.configured,
    contributionRate: p.configured && t.revenue > 0 ? t.contribution / t.revenue : null,
    breakEvenRoas: p.configured ? t.breakEvenRoas : null,
    revenue: t.revenue,
    orders: t.orders,
    metaSpend: t.metaSpend,
    metaPurchaseValue: t.metaPurchaseValue,
    partial: p.partial,
  }
}
