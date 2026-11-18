/**
 * RoasVsEmpate — components/ui RoasGauge fed with lib/views/store empateGap.
 * RoasGauge now says each missing break-even for what it is (no cost
 * settings, no sales, sales that did not cover the products, a campaign that
 * sells in another store), so this is only the mapping from the gap the
 * dashboard already computes; new code can pass configured/revenue/reason to
 * RoasGauge directly.
 *
 *   <RoasVsEmpate roas={0} breakEven={null} gap="no_sales" label="ROAS Meta" />
 *   <RoasVsEmpate roas={1.87} breakEven={1.51} gap={null} />   → RoasGauge as is
 *
 * Props: RoasGauge's, plus gap: EmpateGap | 'shared' | null.
 */

import type { EmpateGap } from '@/lib/views/store'
import { RoasGauge, type BreakEvenReason, type RoasGaugeProps } from '@/components/ui'

// empateGap is null both for a known break-even and for a store without cost
// settings, so a null gap over a missing break-even means "no costs".
const REASON: Record<EmpateGap | 'shared', BreakEvenReason> = { no_sales: 'no_sales', no_margin: 'no_margin', shared: 'other_store' }

export function RoasVsEmpate({ gap, ...gauge }: RoasGaugeProps & { gap: EmpateGap | 'shared' | null }) {
  const missing = !(gauge.breakEven !== null && gauge.breakEven > 0)
  return <RoasGauge {...gauge} reason={gap ? REASON[gap] : missing ? 'no_costs' : gauge.reason} />
}
