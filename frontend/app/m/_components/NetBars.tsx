/**
 * The legend under the phone's net-mode bars (TapBars mode="net"): words that
 * match what the bars are — revenue − ads, not profit, for a store without
 * cost settings (Glooty alone). The NetBars chart itself was replaced by
 * TapBars (spec §4.1) and removed in review round 1.
 */

import s from '../m.module.css'

export function NetBarsLegend({ partial }: { partial: boolean }) {
  return (
    <div className={s.netLegend}>
      <span><i className={s.netLgPos} />vendeu mais do que gastou em anúncios</span>
      <span><i className={s.netLgNeg} />gastou mais do que vendeu</span>
      {partial && <span><i className={s.netLgPartial} />hoje, parcial</span>}
    </div>
  )
}
