/**
 * NumberBandView — the band of numbers at the top of the Resumo, Todas and
 * the page rows of Campanhas, Produtos, Países, Atribuição and Criativo.
 * Server-safe (the chips' ⓘ and the "+N" fold are small client islands).
 *
 *   const band = buildNumberBand({ input, verdict: v, scope: 'store' })
 *   <NumberBandView band={band} costsHref={ctx.hrefWith('/profit')}
 *     extra={<Suspense fallback={null}><SharedAccountNote variant="chip" … /></Suspense>}
 *     tileExtra={{ anuncios: <Suspense fallback={null}><SharedAccountNote variant="tag" … /></Suspense> }}
 *     details={<PeriodDetails details={band.details}>…</PeriodDetails>} />
 *
 *   Page rows: <NumberBandView tiles={tiles} status={chips} details={…} />
 *   (one xl tile first, the others in a row; no comparison).
 *
 * Props: { band: NumberBand } | { tiles: BandTile[]; status: BandChip[]; comparison?: NumberBand['comparison'] }
 *   plus { extra?: ReactNode (chips the page renders itself, after the band's);
 *          details?: ReactNode (Detalhes do período, right under the tiles);
 *          costsHref?: string (where "Custos não configurados" links);
 *          tileExtra?: Partial<Record<BandTileKey, ReactNode>> (async tags);
 *          ariaLabel?: string }
 */

import Link from 'next/link'
import type { ReactNode } from 'react'
import type { BandChip, BandDelta, BandSub, BandTile, BandTileKey, NumberBand } from '@/lib/views/numberBand'
import { chipRank } from '@/lib/views/numberBand'
import { Chip } from '@/components/ui/Chip'
import { InfoTip } from '@/components/ui/InfoTip'
import { RoasGauge } from '@/components/ui/RoasGauge'
import type { BreakEvenReason } from '@/components/ui/roasReason'
import type { IconName } from '@/components/ui/Icon'
import { StatusLine } from './StatusLine'
import s from './numbers.module.css'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

/** One chip: an ⓘ when it carries prose, a link when it is a to-do. */
export function BandChipView({ chip, size = 'md', href }: { chip: BandChip; size?: 'sm' | 'md'; href?: string }) {
  const body = <Chip tone={chip.tone} icon={chip.icon as IconName | undefined} size={size}>{chip.label}</Chip>
  let inner: ReactNode = body
  if (chip.action === 'configure_costs' && href) {
    // The link is the to-do; the explanation gets its own ⓘ (a title alone is
    // out of reach for touch and keyboard).
    inner = (
      <>
        <Link href={href} className={s.chipLink} title={chip.info ? `${chip.info} Clique para configurar.` : 'Configurar custos'}>{body}</Link>
        {chip.info && <InfoTip label={`Sobre: ${chip.label}`}>{chip.info}</InfoTip>}
      </>
    )
  } else if (chip.info) {
    inner = <InfoTip trigger={body} className={s.chipBtn}>{chip.info}</InfoTip>
  }
  return <span className={s.chipWrap} data-rank={chipRank(chip)}>{inner}</span>
}

/** Money, percentages, counts and ROAS inside a sub line, in mono. */
const NUM = /([−+]?⁠?\$[\d.,]+|[−+]?\d[\d.,]*(?:%|×| p\.p\.)?)/g
function Numbers({ text }: { text: string }) {
  const parts = text.split(NUM)
  return <>{parts.map((p, i) => (i % 2 === 1 ? <span key={i} className={s.n}>{p}</span> : p))}</>
}

function SubLine({ sub }: { sub: BandSub }) {
  return <div className={cx(s.sub, sub.tone && s[`s_${sub.tone}`])} title={sub.text}><Numbers text={sub.text} /></div>
}

const ARROW = { up: '▲', down: '▼', flat: '■' } as const

export function DeltaRow({ d }: { d: BandDelta | null }) {
  if (!d) return null
  if (d.kind === 'none') {
    // "sem base", "outro canal", "sem gasto antes": the reason is reachable by
    // touch, keyboard and screen readers (an ⓘ-style text trigger), not only
    // in a title. An empty row keeps the tiles aligned.
    if (!d.text) return <div className={cx(s.delta, s.d_none)} aria-hidden="true" />
    if (!d.aria || d.aria === d.text) return <div className={cx(s.delta, s.d_none)}>{d.text}</div>
    return (
      <div className={cx(s.delta, s.d_none)}>
        <InfoTip trigger={d.text} className={s.deltaTrigger}>{d.previousText ? `antes: ${d.previousText} · ${d.aria}` : d.aria}</InfoTip>
      </div>
    )
  }
  const tone = d.good === 'up' ? s.d_up : d.good === 'down' ? s.d_down : d.good === 'neutral' ? s.d_neutral : s.d_plain
  const title = `${d.aria}${d.previousText && d.kind !== 'was' ? ` (antes: ${d.previousText})` : ''}`
  return (
    <div className={cx(s.delta, tone)} title={title}>
      {d.dir && <span className={s.arrow} aria-hidden="true">{ARROW[d.dir]}</span>}
      <span className="sr-only">{d.aria}</span>
      <span className={s.deltaText} aria-hidden="true">{d.text}</span>
    </div>
  )
}

export function BandTileView({ t, extra, maxSubs = 2, xl, area = true }: { t: BandTile; extra?: ReactNode; maxSubs?: number; xl?: boolean; area?: boolean }) {
  const big = xl ?? t.size === 'xl'
  // A long value (8+ characters, "−$12.523") steps down on the phone instead of wrapping.
  const long = t.value.length >= 8
  return (
    // A group, not a <section>: a named section is a landmark, and six per band
    // flooded landmark navigation. The band itself is the one region.
    <div role="group" className={cx(s.tile, area && s[`t_${t.key}`], big && s.xl)} aria-label={t.label}>
      <div className={s.th}>
        {/* A shorter label where the band is narrow (1024: "ROAS Meta + Shopify × empate"). */}
        {t.phoneLabel
          ? <span className={s.label}><span className={s.labelLong}>{t.label}</span><span className={s.labelShort} title={t.label}>{t.phoneLabel}</span></span>
          : <span className={s.label}>{t.label}</span>}
        {t.info && <InfoTip label={`O que é: ${t.label}`}>{t.info}</InfoTip>}
      </div>
      <div className={s.vrow}>
        <span className={cx(s.value, s[`v_${t.tone}`], long && s.long)}>{t.value}</span>
        {t.tags.length > 0 && (
          <span className={s.tags}>
            {t.tags.map((c, i) => <BandChipView key={`${c.code}-${c.label}-${i}`} chip={c} size="sm" />)}
          </span>
        )}
      </div>
      <DeltaRow d={t.delta} />
      {t.subs.slice(0, maxSubs).map((sub, i) => <SubLine key={i} sub={sub} />)}
      {t.gauge && t.gauge.breakEven !== null && (
        <div className={s.gauge}>
          <RoasGauge roas={t.gauge.roas} breakEven={t.gauge.breakEven} size="mini" words={false}
            reason={(t.gauge.reason as BreakEvenReason | null) ?? null} label={t.label.replace(/ × empate$/, '')} />
        </div>
      )}
      {/* Page tags streamed in later (shared ad account): after the delta, sub
          lines and the gauge, so they never push one tile's delta below its
          neighbours' nor split the gauge from the empate line it draws. */}
      {extra && <span className={cx(s.tags, s.tagsBelow)}>{extra}</span>}
    </div>
  )
}

type BandProps = {
  extra?: ReactNode
  details?: ReactNode
  costsHref?: string
  tileExtra?: Partial<Record<BandTileKey, ReactNode>>
  ariaLabel?: string
} & ({ band: NumberBand; tiles?: never; status?: never; comparison?: never }
  | { band?: never; tiles: BandTile[]; status: BandChip[]; comparison?: NumberBand['comparison'] })

export function NumberBandView(props: BandProps) {
  const { extra, details, costsHref, tileExtra, ariaLabel } = props
  const isBand = !!props.band
  const tiles = props.band ? props.band.tiles : props.tiles
  const status = props.band ? props.band.status : props.status
  const comparison = props.band ? props.band.comparison : props.comparison ?? null
  const cmp = comparison && (
    <>
      <span className={s.cmpText}>{comparison.short}</span>
      {comparison.full !== comparison.short && <InfoTip label="Com o que é comparado">{comparison.full}</InfoTip>}
    </>
  )
  return (
    <div className={s.band} aria-label={ariaLabel ?? 'Números do período'} role="region">
      {(status.length > 0 || extra || cmp) && (
        <StatusLine comparison={cmp || undefined}>
          {/* Keyed by position too: Todas has one 'conta compartilhada' chip per pair. */}
          {status.map((c, i) => <BandChipView key={`${c.code}-${c.label}-${i}`} chip={c} href={costsHref} />)}
          {extra}
        </StatusLine>
      )}
      {tiles.length > 0 && <div className={isBand ? s.grid : cx(s.row, (tiles.length === 4 || tiles.length === 5) && s[`row${tiles.length}`])}>
        {tiles.map((t, i) => (
          <BandTileView key={t.key + i} t={t} extra={tileExtra?.[t.key]} xl={isBand ? undefined : i === 0} area={isBand} />
        ))}
      </div>}
      {details}
    </div>
  )
}
