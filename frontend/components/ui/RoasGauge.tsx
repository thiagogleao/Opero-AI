/**
 * RoasGauge — ROAS is never shown alone: "ROAS 1,95× · empate 1,58× → no lucro"
 * with a bullet gauge (coral track below break-even, green above, a tick at
 * the break-even and a dot at the ROAS). Server-safe.
 *
 *   <RoasGauge roas={1.95} breakEven={1.58} />                  full: words + gauge with labels
 *   <RoasGauge roas={1.5} breakEven={1.29} size="mini" />       table cell: words + thin gauge
 *   <RoasGauge roas={null} … />                                 no spend: "ROAS — sem gasto no período"
 *
 * A missing break-even is said for what it is (components/ui/roasReason):
 *   <RoasGauge roas={0.42} breakEven={null} configured={false} />
 *       "ROAS 0,42× · empate desconhecido → custos não configurados"
 *   <RoasGauge roas={0} breakEven={null} configured revenue={0} />
 *       "ROAS 0,00× · sem empate → nenhuma venda no período: todo o gasto foi prejuízo"
 *   <RoasGauge roas={1.2} breakEven={null} configured revenue={812} />
 *       "ROAS 1,20× · sem empate → produto, frete e taxas já passam da receita"
 *   <RoasGauge roas={1.2} breakEven={null} reason="other_store" />
 *       "ROAS 1,20× · vende em outra loja → sem empate desta loja para comparar"
 *   <RoasGauge roas={1.2} breakEven={null} />                   nothing known: "… · empate desconhecido"
 * A loss whatever the ROAS (no sales, no margin) draws an all-coral track.
 *
 * Props: { roas: number|null; breakEven: number|null; size?: 'full'|'mini';
 *          max?: number (scale end, default max(3, ceil(roas, be)+0.5));
 *          label?: string (prefix, default "ROAS"); paused?: boolean (greyed: "pausada");
 *          words?: boolean (default true; false = gauge only, the reason in its tooltip);
 *          configured?: boolean (store has cost settings; false always reads
 *            "custos não configurados", whatever breakEven says);
 *          revenue?: number|null (store revenue, same window: tells "sem vendas" apart);
 *          contribution?: number|null (store contribution before ads, same window; sign only);
 *          reason?: BreakEvenReason (the caller knows why, e.g. 'other_store') }
 * Use the store's own break-even (engine breakEvenRoas). For a campaign, pass
 * the store's break-even too, and the store's configured/revenue.
 */

import { formatPct, formatRoas } from '@/lib/format'
import { clampLabel, textWidth } from '@/components/charts/axis'
import { breakEvenReason, reasonText, REASON_WORDS, roasGapPct, usableBreakEven, type BreakEvenReason } from './roasReason'
import s from './Kpi.module.css'

export type { BreakEvenReason } from './roasReason'

export interface RoasGaugeProps {
  roas: number | null
  breakEven: number | null
  size?: 'full' | 'mini'
  max?: number
  label?: string
  paused?: boolean
  words?: boolean
  configured?: boolean
  revenue?: number | null
  contribution?: number | null
  reason?: BreakEvenReason | null
}

export function RoasGauge({
  roas, breakEven, size = 'full', max, label = 'ROAS', paused, words = true, configured, revenue, contribution, reason: given,
}: RoasGaugeProps) {
  if (roas === null || !Number.isFinite(roas)) {
    return <span className={s.roasWords}>{label} <b>—</b> <span className={s.arrow}>sem gasto no período</span></span>
  }
  const facts = { breakEven, configured, revenue, contribution, reason: given }
  const be = usableBreakEven(facts)
  const reason = be === null ? breakEvenReason(facts) ?? 'unknown' : null
  const rw = reason ? REASON_WORDS[reason] : null
  // A missing break-even that is a loss whatever the ROAS draws coral.
  const lossAnyway = rw?.tone === 'neg'
  const state: 'pos' | 'neg' | 'unk' | 'off' = paused ? 'off' : be !== null ? (roas >= be ? 'pos' : 'neg') : lossAnyway ? 'neg' : 'unk'
  const top = max ?? Math.max(3, Math.ceil(Math.max(roas, be ?? 0) + 0.5))
  const mini = size === 'mini'
  const W = mini ? 140 : 340
  const H = mini ? 14 : 36
  const pad = 5
  const iw = W - pad * 2
  const x = (v: number) => pad + (Math.min(Math.max(v, 0), top) / top) * iw
  const ty = mini ? 4 : 15
  const th = 6
  const pctOff = roasGapPct(roas, be)
  const roasText = `${label ? `${label} ` : ''}${formatRoas(roas)}`
  const sentence = paused
    ? `${roasText}${be ? `, empate ${formatRoas(be)}` : ''}: pausada`
    : be !== null
      ? `${roasText}, empate ${formatRoas(be)}: ${state === 'pos' ? 'no lucro' : 'no prejuízo'}`
      : `${roasText}: ${reasonText(reason!)}`
  const reasonClass = rw?.tone === 'neg' ? s.vNeg : rw?.tone === 'warn' ? s.vUnk : s.vMut
  const dotClass = state === 'pos' ? s.dotPos : state === 'neg' ? s.dotNeg : state === 'off' ? s.dotOff : s.dotUnk

  return (
    <div className={`${s.roas}${mini ? ` ${s.roasMini}` : ''}`}>
      {words && (
        <div className={s.roasWords} title={rw && (mini || paused) ? reasonText(reason!) : undefined}>
          <span>{label} <b>{formatRoas(roas)}</b></span>
          <span className={s.arrow}>·</span>
          {be !== null ? (
            <>
              <span>empate <b>{formatRoas(be)}</b></span>
              <span className={s.arrow}>→</span>
              <span className={paused ? s.vOff : state === 'pos' ? s.vPos : s.vNeg}>{paused ? 'pausada' : state === 'pos' ? 'no lucro' : 'no prejuízo'}</span>
              {!mini && pctOff !== null && !paused && (
                <span className={s.arrow}>· {formatPct(Math.abs(pctOff), { digits: 0 })} {pctOff >= 0 ? 'acima' : 'abaixo'}</span>
              )}
            </>
          ) : paused ? (
            // A paused campaign is not judged: the reason stays in the tooltip.
            <span className={s.vOff}>pausada</span>
          ) : mini ? (
            <MiniReason text={rw!.mini} cls={reasonClass} />
          ) : (
            <>
              {rw!.lead && <><span>{rw!.lead}</span><span className={s.arrow}>→</span></>}
              <span className={reasonClass}>{rw!.verdict}</span>
            </>
          )}
        </div>
      )}
      <svg viewBox={`0 0 ${W} ${H}`} className={s.gauge} style={{ maxWidth: W }} role="img" aria-label={sentence} preserveAspectRatio="xMinYMid meet">
        {/* The gauge alone (words={false}) still says why on hover. */}
        {!words && <title>{sentence}</title>}
        {be !== null ? (
          <>
            <rect x={pad} y={ty} width={Math.max(0, x(be) - pad)} height={th} rx={3} className={s.trackLow} />
            <rect x={x(be)} y={ty} width={Math.max(0, pad + iw - x(be))} height={th} rx={3} className={s.trackHigh} />
            <line x1={x(be)} x2={x(be)} y1={ty - 4} y2={ty + th + 4} className={s.beLine} />
          </>
        ) : (
          <rect x={pad} y={ty} width={iw} height={th} rx={3} className={lossAnyway ? s.trackLow : s.trackUnk} />
        )}
        <circle cx={x(roas)} cy={ty + th / 2} r={mini ? 4.5 : 5} className={dotClass} />
        {!mini && (() => {
          // The ROAS value sits on the same row as the scale ends: near 0× or
          // the top it hides that end instead of printing on top of it
          // ("0,00×" over "0×" for a store with no sales).
          const v = clampLabel(x(roas), textWidth(formatRoas(roas), 10), pad, pad + iw)
          const topText = `${top.toLocaleString('pt-BR')}×`
          const showZero = v.from > pad + textWidth('0×', 10) + 4
          const showTop = v.to < pad + iw - textWidth(topText, 10) - 4
          const beText = be !== null ? `empate ${formatRoas(be)}` : ''
          const e = be !== null ? clampLabel(x(be), textWidth(beText, 10), pad, pad + iw) : null
          return (
            <>
              {e && <text x={e.x} y={ty - 7} textAnchor={e.anchor}>{beText}</text>}
              {showZero && <text x={pad} y={H - 1} textAnchor="start">0×</text>}
              {showTop && <text x={pad + iw} y={H - 1} textAnchor="end">{topText}</text>}
              <text x={v.x} y={H - 1} textAnchor={v.anchor} className={state === 'pos' ? s.txPos : state === 'neg' ? s.txNeg : undefined}>{formatRoas(roas)}</text>
            </>
          )
        })()}
      </svg>
    </div>
  )
}

/** "sem empate → loja sem vendas": the arrow stays grey, the reason takes the tone. */
function MiniReason({ text, cls }: { text: string; cls: string }) {
  const at = text.indexOf(' → ')
  if (at < 0) return <span className={cls}>{text}</span>
  return (
    <>
      <span>{text.slice(0, at)}</span>
      <span className={s.arrow}>→</span>
      <span className={cls}>{text.slice(at + 3)}</span>
    </>
  )
}
