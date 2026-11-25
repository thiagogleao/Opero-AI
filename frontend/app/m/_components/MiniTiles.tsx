'use client'

/**
 * Small number tiles in the band's style (22 px values), for the blocks below
 * the band: the Detalhes tabs (Campanhas, Produtos) and Chargebacks · 90 dias
 * (spec §3.10). Only numbers the block already has; nothing computed here.
 */

import type { ReactNode } from 'react'
import { InfoTip } from '@/components/ui'
import s from './NumberBand.module.css'

export interface MiniTile {
  label: string
  value: string
  tone?: 'pos' | 'neg' | 'warn' | 'neu' | 'mut'
  sub?: ReactNode
  info?: string
}

export function MiniTiles({ tiles, label }: { tiles: MiniTile[]; label?: string }) {
  if (!tiles.length) return null
  return (
    <div className={s.mini} role="group" aria-label={label} style={{ gridTemplateColumns: `repeat(${Math.min(3, tiles.length)}, minmax(0, 1fr))` }}>
      {tiles.map(t => (
        <div key={t.label} className={s.miniTile}>
          <div className={s.label}>
            <span>{t.label}</span>
            {t.info && <InfoTip label={`Sobre: ${t.label}`}>{t.info}</InfoTip>}
          </div>
          <div className={`${s.value} ${s.vMini} ${t.tone ? s[`t_${t.tone}`] ?? '' : ''}`}>{t.value}</div>
          {t.sub && <div className={s.sub}>{t.sub}</div>}
        </div>
      ))}
    </div>
  )
}
