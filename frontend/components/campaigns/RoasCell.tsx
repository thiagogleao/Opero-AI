/**
 * RoasCell — ROAS against the break-even in one table cell: "1,42× → no
 * prejuízo" in words (never colour alone) over the shared mini gauge without
 * its own words. The column header carries the break-even ("ROAS × empate
 * 1,53×"), so each row stays two short lines instead of three. Server-safe.
 *
 * Props: { roas: number|null; breakEven: number|null; paused?: boolean;
 *          showValue?: boolean (false where the ROAS is already the big number
 *          above, e.g. a KPI card: the line then names the break-even instead) }
 */

import { RoasGauge } from '@/components/ui'
import { formatRoas } from '@/lib/format'
import s from './campaigns.module.css'

export function RoasCell({ roas, breakEven, paused, showValue = true }: { roas: number | null; breakEven: number | null; paused?: boolean; showValue?: boolean }) {
  if (roas === null) return <span className={s.muted}>— sem gasto</span>
  const be = breakEven !== null && breakEven > 0 ? breakEven : null
  const state = paused ? 'pausada' : be === null ? 'sem empate' : roas >= be ? 'no lucro' : 'no prejuízo'
  const cls = paused || be === null ? s.muted : roas >= be ? s.pos : s.neg
  return (
    <span className={s.roasCell}>
      <span className={s.roasLine}>
        {showValue ? <><b>{formatRoas(roas)}</b> </> : be !== null ? <>empate <b>{formatRoas(be)}</b> </> : null}
        <span className={cls}>→ {state}</span>
      </span>
      <RoasGauge roas={roas} breakEven={be} size="mini" paused={paused} words={false} />
    </span>
  )
}
