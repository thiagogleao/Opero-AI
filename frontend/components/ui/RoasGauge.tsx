/**
 * RoasGauge — ROAS is never shown alone: "ROAS 1,95× · empate 1,58× → no lucro"
 * with a bullet gauge (coral track below break-even, green above, a tick at
 * the break-even and a dot at the ROAS). Server-safe.
 *
 *   <RoasGauge roas={1.95} breakEven={1.58} />                  full: words + gauge with labels
 *   <RoasGauge roas={1.5} breakEven={1.29} size="mini" />       table cell: words + thin gauge
 *   <RoasGauge roas={0.42} breakEven={null} />                  no costs: "ROAS 0,42× · empate desconhecido → custos não configurados"
 *   <RoasGauge roas={null} … />                                 no spend: "ROAS — sem gasto no período"
 *
 * Props: { roas: number|null; breakEven: number|null; size?: 'full'|'mini';
 *          max?: number (scale end, default max(3, ceil(roas, be)+0.5));
 *          label?: string (prefix, default "ROAS"); paused?: boolean (greyed: "pausada");
 *          words?: boolean (default true; false = gauge only) }
 * Use the store's own break-even (engine breakEvenRoas). For a campaign, pass
 * the store's break-even too.
 */

import { formatRoas } from '@/lib/format'
import s from './Kpi.module.css'

export interface RoasGaugeProps {
  roas: number | null
  breakEven: number | null
  size?: 'full' | 'mini'
  max?: number
  label?: string
  paused?: boolean
  words?: boolean
}

export function RoasGauge({ roas, breakEven, size = 'full', max, label = 'ROAS', paused, words = true }: RoasGaugeProps) {
  if (roas === null || !Number.isFinite(roas)) {
    return <span className={s.roasWords}>{label} <b>—</b> <span className={s.arrow}>sem gasto no período</span></span>
  }
  const be = breakEven !== null && breakEven > 0 ? breakEven : null
  const state: 'pos' | 'neg' | 'unk' | 'off' = paused ? 'off' : be === null ? 'unk' : roas >= be ? 'pos' : 'neg'
  const top = max ?? Math.max(3, Math.ceil(Math.max(roas, be ?? 0) + 0.5))
  const mini = size === 'mini'
  const W = mini ? 140 : 340
  const H = mini ? 14 : 36
  const pad = 5
  const iw = W - pad * 2
  const x = (v: number) => pad + (Math.min(Math.max(v, 0), top) / top) * iw
  const ty = mini ? 4 : 15
  const th = 6
  const pctOff = be ? Math.round(((roas - be) / be) * 100) : null
  const verdictWord = state === 'pos' ? 'no lucro' : state === 'neg' ? 'no prejuízo' : state === 'off' ? 'pausada' : 'custos não configurados'
  const vClass = state === 'pos' ? s.vPos : state === 'neg' ? s.vNeg : state === 'off' ? s.vOff : s.vUnk
  const aria = be
    ? `ROAS ${formatRoas(roas)}, empate ${formatRoas(be)}: ${verdictWord}`
    : `ROAS ${formatRoas(roas)}, empate desconhecido sem custos configurados`

  return (
    <div className={`${s.roas}${mini ? ` ${s.roasMini}` : ''}`}>
      {words && (
        <div className={s.roasWords}>
          <span>{label} <b>{formatRoas(roas)}</b></span>
          <span className={s.arrow}>·</span>
          {be ? <span>empate <b>{formatRoas(be)}</b></span> : <span>empate desconhecido</span>}
          <span className={s.arrow}>→</span>
          <span className={vClass}>{verdictWord}</span>
          {!mini && pctOff !== null && state !== 'off' && (
            <span className={s.arrow}>· {Math.abs(pctOff)}% {pctOff >= 0 ? 'acima' : 'abaixo'}</span>
          )}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className={s.gauge} style={{ maxWidth: W }} role="img" aria-label={aria} preserveAspectRatio="xMinYMid meet">
        {be ? (
          <>
            <rect x={pad} y={ty} width={Math.max(0, x(be) - pad)} height={th} rx={3} className={s.trackLow} />
            <rect x={x(be)} y={ty} width={Math.max(0, pad + iw - x(be))} height={th} rx={3} className={s.trackHigh} />
            <line x1={x(be)} x2={x(be)} y1={ty - 4} y2={ty + th + 4} className={s.beLine} />
          </>
        ) : (
          <rect x={pad} y={ty} width={iw} height={th} rx={3} className={s.trackUnk} />
        )}
        <circle cx={x(roas)} cy={ty + th / 2} r={mini ? 4.5 : 5} className={state === 'pos' ? s.dotPos : state === 'neg' ? s.dotNeg : state === 'off' ? s.dotOff : s.dotUnk} />
        {!mini && (
          <>
            {be && <text x={x(be)} y={ty - 7} textAnchor="middle">empate {formatRoas(be)}</text>}
            <text x={pad} y={H - 1} textAnchor="start">0×</text>
            <text x={pad + iw} y={H - 1} textAnchor="end">{top.toLocaleString('pt-BR')}×</text>
            <text x={x(roas)} y={H - 1} textAnchor="middle" className={state === 'pos' ? s.txPos : state === 'neg' ? s.txNeg : undefined}>{formatRoas(roas)}</text>
          </>
        )}
      </svg>
    </div>
  )
}
