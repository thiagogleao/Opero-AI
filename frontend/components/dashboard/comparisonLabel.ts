/**
 * The words a Resumo KPI compares against, in two lengths: `short` for the
 * delta pill under each number, `full` for its hover title.
 *
 * A window ending today is compared with its last day cut at this hour
 * (lib/views/store comparisonPlan). The pill used the verdict's wording,
 * "vs 1–24 out até 00h33 de 24 out ($34.860)": the cut day said twice, and too
 * wide for a 4-column KPI card at 1440 (the page scrolled sideways). The cut
 * is always on the comparison's last day, so the pill names the hour only —
 * "vs 1–24 out até 00h33" — and the title carries the whole sentence.
 */

import { formatClock, formatRangeLabel } from '@/lib/format'
import { comparisonText, type ComparisonWindow } from '@/lib/views/verdict'

export interface KpiComparisonLabel {
  /** "vs ontem até esta hora", "vs 10–16 nov", "vs 1–24 out até 00h33". */
  short: string
  /** "vs mesmos dias do mês passado (1–24 out, até 00h33 de 24 out)". */
  full: string
}

export function kpiComparisonLabel(cmp: ComparisonWindow, today: string): KpiComparisonLabel {
  // lib/period's own two labels (R6/R7) whenever the comparison carries them:
  // the header, the verdict and the pills then say the same cut, once.
  if (cmp.short && cmp.full) return { short: cmp.short, full: cmp.full }
  const full = comparisonText(cmp, today)
  if (cmp.label === 'ontem até esta hora') return { short: 'vs ontem até esta hora', full }
  const range = formatRangeLabel({ from: cmp.from, to: cmp.to }, today)
  if (!cmp.sameTimeOfDay) return { short: `vs ${range}`, full }
  const clock = typeof cmp.cutoffMinutes === 'number' ? formatClock(cmp.cutoffMinutes) : 'esta hora'
  return { short: `vs ${range} até ${clock}`, full }
}
