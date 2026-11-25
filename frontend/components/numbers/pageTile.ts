/**
 * pageTile — a BandTile for a page number row (Campanhas, Produtos, Países,
 * Atribuição, Criativo), built from values the page already computes. Pure.
 * Page rows have no comparison: `delta` is null unless given. `slot` names the
 * tile's position for NumberBandView's `tileExtra` (lucro = 1st … roas = 6th).
 */

import type { BandChip, BandSub, BandTile, BandTileKey, BandTone } from '@/lib/views/numberBand'
import { breakEvenReason, reasonText, roasGapPct, usableBreakEven, REASON_WORDS, type BreakEvenFacts } from '@/components/ui/roasReason'
import { formatPct, formatRoas } from '@/lib/format'

export function pageTile(p: {
  slot: BandTileKey
  label: string; value: string; raw?: number | null; tone?: BandTone; subs?: BandSub[]; tags?: BandChip[]; info?: string
  gauge?: BandTile['gauge']
}): BandTile {
  return {
    key: p.slot,
    label: p.label, value: p.value, raw: p.raw ?? null, tone: p.tone ?? 'neu', size: 'md',
    subs: p.subs ?? [], tags: p.tags ?? [], delta: null, info: p.info ?? '', gauge: p.gauge,
  }
}

/** A ROAS against its break-even as a page row tile (the RoasGauge's words:
 *  components/ui/roasReason): value, tone, "empate 1,53× · 17% acima" (or
 *  the reason there is none) and the mini gauge. "—" without spend. */
export function roasPageTile(p: { slot: BandTileKey; label: string; roas: number | null; facts: BreakEvenFacts; info?: string; tags?: BandChip[] }): BandTile {
  if (p.roas === null || !Number.isFinite(p.roas)) {
    return pageTile({ slot: p.slot, label: p.label, value: '—', tone: 'mut', subs: [{ text: 'sem gasto no período', tone: 'mut' }], info: p.info, tags: p.tags })
  }
  const be = usableBreakEven(p.facts)
  const reason = be === null ? breakEvenReason(p.facts) ?? 'unknown' : null
  const gap = be !== null ? roasGapPct(p.roas, be) : null
  const tone: BandTone = be !== null ? (p.roas >= be ? 'pos' : 'neg') : reason && REASON_WORDS[reason].tone === 'neg' ? 'neg' : 'warn'
  return pageTile({
    slot: p.slot, label: p.label, value: formatRoas(p.roas), raw: p.roas, tone, info: p.info, tags: p.tags,
    subs: [be !== null && gap !== null
      ? { text: `empate ${formatRoas(be)} · ${formatPct(Math.abs(gap), { digits: 0 })} ${gap >= 0 ? 'acima' : 'abaixo'}` }
      : { text: reasonText(reason ?? 'unknown', true), tone: tone === 'neg' ? 'neg' : 'warn' }],
    gauge: { roas: p.roas, breakEven: be, state: tone === 'pos' ? 'pos' : tone === 'neg' ? 'neg' : 'unknown', reason },
  })
}
