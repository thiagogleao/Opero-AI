/**
 * Chip, Badge, StatusDot, CodePill — words with an icon, never colour alone.
 *
 * Chip (rounded, from direction C): verdict states.
 *   <Chip tone="pos" icon="up">No lucro</Chip>
 *   <Chip tone="cfg" icon="sliders" size="sm">Custos não configurados</Chip>
 *   <VerdictChips chips={verdict.chips} />          from lib/views/verdict
 *   Props: { tone: ChipTone; icon?: IconName; size?: 'sm'|'md'; title?: string;
 *            className?: string; children }
 *   Tones: pos (lucro) · neg (prejuízo) · warn (atenção) · neu (neutro, sem
 *   vendas, cedo) · info (fuso, parcial) · cfg (custos não configurados,
 *   amber outline) · mut (apagado).
 *
 * Badge (square, uppercase-ish, from direction A): dense tags in tables.
 *   <Badge tone="warn" icon="alert">não configurado</Badge>
 *   Props: { tone: ChipTone; icon?: IconName; upper?: boolean; title?; children }
 *
 * StatusDot: "● atualizado há 4 min", green / amber (stale) / coral (failing).
 *   Props: { state: 'ok'|'stale'|'failing'|'unknown'; children }
 *
 * CodePill: the store's domain code ("6k7fjw") in mono.  Props: { children }
 */

import type { ReactNode } from 'react'
import type { VerdictChip } from '@/lib/views/verdict'
import { Icon, type IconName } from './Icon'
import s from './Chip.module.css'

export type ChipTone = 'pos' | 'neg' | 'warn' | 'neu' | 'info' | 'cfg' | 'mut'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

export interface ChipProps {
  tone: ChipTone
  icon?: IconName
  size?: 'sm' | 'md'
  title?: string
  className?: string
  children: ReactNode
}

export function Chip({ tone, icon, size = 'md', title, className, children }: ChipProps) {
  return (
    <span className={cx(s.chip, s[tone], size === 'sm' && s.sm, className)} title={title}>
      {icon && <Icon name={icon} size={size === 'sm' ? 10 : 12} />}
      {children}
    </span>
  )
}

/** The chips of a verdict (or storeStatus) in order. */
export function VerdictChips({ chips, size = 'md' }: { chips: VerdictChip[]; size?: 'sm' | 'md' }) {
  return (
    <>
      {chips.map(c => (
        <Chip key={`${c.code}-${c.label}`} tone={c.tone} icon={c.icon} size={size}>{c.label}</Chip>
      ))}
    </>
  )
}

export interface BadgeProps {
  tone: ChipTone
  icon?: IconName
  upper?: boolean
  title?: string
  className?: string
  children: ReactNode
}

export function Badge({ tone, icon, upper, title, className, children }: BadgeProps) {
  return (
    <span className={cx(s.badge, s[tone], upper && s.upper, className)} title={title}>
      {icon && <Icon name={icon} size={10} />}
      {children}
    </span>
  )
}

export function StatusDot({ state, children, title }: { state: 'ok' | 'stale' | 'failing' | 'unknown'; children: ReactNode; title?: string }) {
  return (
    <span className={cx(s.fresh, state !== 'ok' && s[state])} title={title}>
      <i aria-hidden="true" />
      {children}
    </span>
  )
}

export function CodePill({ children }: { children: ReactNode }) {
  return <span className={s.code}>{children}</span>
}
