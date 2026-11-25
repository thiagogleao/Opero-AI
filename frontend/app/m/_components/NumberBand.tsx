'use client'

/**
 * The phone's number band (spec §1, §3.10): one status line of chips, the
 * comparison words once, and six tiles — Lucro · Margem / Receita · Pedidos /
 * Anúncios · ROAS × empate — each with its ▲▼ against the comparison window.
 * Everything is read from lib/views/numberBand (buildNumberBand): no number
 * is computed here, and no "vs …" text is built here.
 *
 * Prose never sits above the numbers: a chip's sentence is in its InfoTip, a
 * tile's definition in its ⓘ, the previous value in the delta's InfoTip
 * (C10), and the verdict's story in "Detalhes do período" (PeriodDetails).
 */

import type { ReactNode } from 'react'
import { Chip, InfoTip } from '@/components/ui'
import { StatusLine } from '@/components/numbers/StatusLine'
import type { BandChip, BandDelta, BandSub, BandTile, NumberBand } from '@/lib/views/numberBand'
import { chipRank } from '@/lib/views/numberBand'
import s from './NumberBand.module.css'

const ARROW: Record<'up' | 'down' | 'flat', string> = { up: '▲', down: '▼', flat: '■' }

/** A status chip; with `info` it is the trigger of an InfoTip (tap/hover/focus). */
export function BandChipView({ c, size = 'md' }: { c: BandChip; size?: 'sm' | 'md' }) {
  const chip = <Chip tone={c.tone} icon={c.icon} size={size}>{c.label}</Chip>
  if (!c.info) return chip
  return <InfoTip trigger={chip} className={s.chipTrigger}>{c.info}</InfoTip>
}

/** At most two rows of chips; past that the lowest-priority chips fold into
 *  "+N", which opens the row in place (C9: reachable, never dropped). The
 *  desktop's StatusLine does the measuring (DOM only, re-folds on resize and
 *  rotation, moves focus to the first chip it reveals); each chip wrapper
 *  carries its rank. */
function StatusChips({ chips }: { chips: BandChip[] }) {
  if (!chips.length) return null
  return (
    <StatusLine>
      {/* Keyed by position too: Todas has one 'conta compartilhada' chip per pair. */}
      {chips.map((c, i) => (
        <span key={`${c.code}-${c.label}-${i}`} className={s.chipWrap} data-rank={chipRank(c)}><BandChipView c={c} /></span>
      ))}
    </StatusLine>
  )
}

/** "Meta $25.906 · Shopify $554": each short part kept whole, a line break
 *  allowed at the " · " (C10); a part too long for the tile on its own
 *  ("custos não configurados") wraps inside. */
function Parts({ text }: { text: string }) {
  const parts = text.split(' · ')
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          <span className={p.length > 20 ? undefined : s.nowrap}>{p}</span>
        </span>
      ))}
    </>
  )
}

function DeltaRow({ d }: { d: BandDelta | null }) {
  if (d === null) return null
  if (d.kind === 'none') {
    if (!d.text) return <div className={s.delta} aria-hidden="true" />
    // "outro canal", "sem base"…: tap for why (and the previous value, if any).
    if (!d.aria || d.aria === d.text) return <div className={`${s.delta} ${s.dMut}`}>{d.text}</div>
    return (
      <div className={`${s.delta} ${s.dMut}`}>
        <InfoTip trigger={d.text} className={s.deltaTrigger}>{d.previousText ? `antes: ${d.previousText} · ${d.aria}` : d.aria}</InfoTip>
      </div>
    )
  }
  // `good` is the colour itself (lib/views/numberBand): up green, down coral, neutral steel.
  const tone = d.good === 'up' ? s.dPos : d.good === 'down' ? s.dNeg : d.good === 'neutral' ? s.dNeu : s.dMut
  // The button's name is the whole sentence ("subiu 31% vs …"), read in
  // browse mode without opening it; the arrow and "31%" are what the eye reads.
  const label = <><span className={s.sr}>{d.aria}</span><span aria-hidden="true">{d.dir ? `${ARROW[d.dir]} ` : null}{d.text}</span></>
  return (
    <div className={`${s.delta} ${tone}`}>
      <InfoTip trigger={label} className={s.deltaTrigger}>
        {/* A 'was' already names the previous value in its words. */}
        {d.previousText && d.kind !== 'was' ? `antes: ${d.previousText} · ${d.aria}` : d.aria}
      </InfoTip>
    </div>
  )
}

/** Phone tag words where the desktop's do not fit a 160-px tile (360 px screen). */
const PHONE_TAG: Record<string, string> = { 'custos não configurados': 'sem custos' }

function Tile({ t }: { t: BandTile }) {
  const sub: BandSub | undefined = t.phoneSub ?? t.subs[0]
  const label = t.phoneLabel ?? t.label
  const xl = t.size === 'xl'
  const long = t.value.length >= 8
  return (
    // One unit for a screen reader: label, value, tags, delta and sub (as the desktop tile).
    <div role="group" aria-label={t.label} className={`${s.tile} ${xl ? s.xl : s.md}`} data-tile={t.key}>
      <div className={s.label}>
        <span title={label !== t.label ? t.label : undefined}>{label}</span>
        <InfoTip label={`Sobre: ${t.label}`}>{t.info}</InfoTip>
      </div>
      <div className={`${s.value} ${s[`t_${t.tone}`] ?? ''} ${xl ? (long ? s.vXlLong : s.vXl) : s.vMd}`}>{t.value}</div>
      {t.tags.length > 0 && (
        <div className={s.tags}>
          {t.tags.map((c, i) => <BandChipView key={`${c.code}-${c.label}-${i}`} c={PHONE_TAG[c.label] ? { ...c, label: PHONE_TAG[c.label] } : c} size="sm" />)}
        </div>
      )}
      <DeltaRow d={t.delta} />
      {sub && <div className={`${s.sub} ${sub.tone ? s[`t_${sub.tone}`] ?? '' : ''}`}><Parts text={sub.text} /></div>}
    </div>
  )
}

export function PhoneNumberBand({ band, heading, details }: { band: NumberBand; heading: string; details?: ReactNode }) {
  const [lucro, margem, receita, pedidos, anuncios, roas] = band.tiles
  return (
    <section className={s.band} aria-label="Números do período">
      {/* The page's heading (the verdict card carried the h1). */}
      <h1 className={s.sr}>{heading}</h1>
      <StatusChips chips={band.status} />
      {band.comparison && (
        <div className={s.cmp}>
          <span>{band.comparison.short}</span>
          <InfoTip label="Com o que comparo">{band.comparison.full}</InfoTip>
        </div>
      )}
      <div className={s.grid}>
        <Tile t={lucro} />
        <Tile t={margem} />
        <Tile t={receita} />
        <Tile t={pedidos} />
        <Tile t={anuncios} />
        <Tile t={roas} />
      </div>
      {details}
    </section>
  )
}
