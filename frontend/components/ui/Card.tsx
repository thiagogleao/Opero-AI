/**
 * Card, Block, Button, ButtonLink, Callout, EmptyState, ErrorState, Skeleton,
 * SkeletonBlock, Avatar — the layout primitives. All server-safe.
 *
 * Card    { as?: 'div'|'section'|'article'|'aside'; pad?: 'none'|'sm'|'md'|'lg';
 *           surface?: 'card'|'raised'|'flat'; className?; id?; children; ...aria }
 *
 * Block   A card that opens with a title and ONE line telling how to read it.
 *         { title: ReactNode; howTo?: ReactNode; eyebrow?: ReactNode;
 *           info?: ReactNode (content of the ⓘ tooltip); infoLabel?: string;
 *           actions?: ReactNode (right side: legend, links, toggles);
 *           footer?: ReactNode (muted strip at the bottom);
 *           flush?: boolean (body without side padding, for tables);
 *           id?; className?; children }
 *   <Block title="Lucro real por dia" howTo="Barra acima da linha do zero = dia no lucro."
 *          info="Receita − todos os custos, dia a dia, no fuso da loja." actions={<Legend/>}>
 *     <DailyProfitBars … />
 *   </Block>
 *
 * Button  { variant?: 'primary'|'secondary'|'ghost'|'danger'; size?: 'sm'|'md';
 *           icon?: IconName; iconOnly?: boolean (needs aria-label); pending?: boolean
 *           (spinner + aria-busy, disabled); ...button attributes }
 * ButtonLink  same look, renders next/link: { href; variant?; size?; icon?; children }
 *
 * Callout { tone?: 'info'|'warn'|'neg'|'neu'; title?: ReactNode; icon?: IconName; children }
 *         Amber (warn) always comes with its icon and words.
 *
 * EmptyState { icon?: IconName; title: ReactNode; children?: ReactNode (one or two
 *              lines); action?: ReactNode; compact?: boolean }
 * ErrorState { title?: ReactNode (default "Não foi possível carregar"); children?;
 *              action?: ReactNode (e.g. a retry Button from a client parent); compact? }
 *
 * Skeleton      { width?: number|string; height?: number|string; radius?: number; style? }
 * SkeletonBlock { lines?: number; height?: number } — a Block-shaped placeholder for
 *               <Suspense fallback>.
 *
 * Avatar  { name: string; size?: 'sm'|'md'|'lg' } — two-letter initials ("MK").
 */

import Link from 'next/link'
import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, ReactNode } from 'react'
import { Icon, type IconName } from './Icon'
import { InfoTip } from './InfoTip'
import s from './Card.module.css'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')

const PAD = { none: s.padNone, sm: s.padSm, md: s.padMd, lg: s.padLg } as const

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: 'div' | 'section' | 'article' | 'aside'
  pad?: keyof typeof PAD
  surface?: 'card' | 'raised' | 'flat'
}

export function Card({ as = 'div', pad = 'none', surface = 'card', className, children, ...rest }: CardProps) {
  const Tag = as
  return (
    <Tag className={cx(s.card, surface === 'raised' && s.raised, surface === 'flat' && s.flat, PAD[pad], className)} {...rest}>
      {children}
    </Tag>
  )
}

export interface BlockProps {
  title: ReactNode
  howTo?: ReactNode
  eyebrow?: ReactNode
  info?: ReactNode
  infoLabel?: string
  actions?: ReactNode
  footer?: ReactNode
  flush?: boolean
  id?: string
  className?: string
  children?: ReactNode
}

export function Block({ title, howTo, eyebrow, info, infoLabel, actions, footer, flush, id, className, children }: BlockProps) {
  return (
    <Card as="section" className={cx(s.block, className)} id={id} aria-label={typeof title === 'string' ? title : undefined}>
      <header className={s.head}>
        <div className={s.titles}>
          {eyebrow && <div className={s.eyebrow}>{eyebrow}</div>}
          <div className={s.titleRow}>
            <h3 className={s.title}>{title}</h3>
            {info && <InfoTip label={infoLabel ?? (typeof title === 'string' ? `Sobre: ${title}` : 'Como é calculado')}>{info}</InfoTip>}
          </div>
          {howTo && <p className={s.howTo}>{howTo}</p>}
        </div>
        {actions && <div className={s.actions}>{actions}</div>}
      </header>
      <div className={flush ? s.bodyFlush : s.body}>{children}</div>
      {footer && <footer className={s.foot}>{footer}</footer>}
    </Card>
  )
}

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANT: Record<Variant, string> = { primary: s.primary, secondary: s.secondary, ghost: s.ghost, danger: s.danger }

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: IconName
  iconOnly?: boolean
  pending?: boolean
}

export function Button({ variant = 'secondary', size = 'md', icon, iconOnly, pending, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(s.btn, VARIANT[variant], size === 'sm' && s.btnSm, iconOnly && s.btnIcon, className)}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      {...rest}
    >
      {pending ? <span className={s.spin} aria-hidden="true" /> : icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {!iconOnly && children}
    </button>
  )
}

export interface ButtonLinkProps {
  href: string
  variant?: Variant
  size?: 'sm' | 'md'
  icon?: IconName
  className?: string
  prefetch?: boolean
  children: ReactNode
  'aria-label'?: string
}

export function ButtonLink({ href, variant = 'secondary', size = 'md', icon, className, prefetch, children, ...rest }: ButtonLinkProps) {
  return (
    <Link href={href} prefetch={prefetch} className={cx(s.btn, VARIANT[variant], size === 'sm' && s.btnSm, className)} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 13 : 15} />}
      {children}
    </Link>
  )
}

const CALLOUT = { info: s.calloutInfo, warn: s.calloutWarn, neg: s.calloutNeg, neu: s.calloutNeu } as const
const CALLOUT_ICON: Record<keyof typeof CALLOUT, IconName> = { info: 'info', warn: 'alert', neg: 'alert', neu: 'info' }

export function Callout({ tone = 'info', title, icon, children, className }: {
  tone?: keyof typeof CALLOUT; title?: ReactNode; icon?: IconName; children?: ReactNode; className?: string
}) {
  return (
    <div className={cx(s.callout, CALLOUT[tone], className)} role={tone === 'warn' || tone === 'neg' ? 'note' : undefined}>
      <Icon name={icon ?? CALLOUT_ICON[tone]} size={15} />
      <div>
        {title && <span className={s.calloutTitle}>{title}</span>}
        {children}
      </div>
    </div>
  )
}

export function EmptyState({ icon = 'ring', title, children, action, compact }: {
  icon?: IconName; title: ReactNode; children?: ReactNode; action?: ReactNode; compact?: boolean
}) {
  return (
    <div className={cx(s.state, compact && s.compact)}>
      <span className={s.stateIcon}><Icon name={icon} size={16} /></span>
      <div className={s.stateTitle}>{title}</div>
      {children && <div className={s.stateText}>{children}</div>}
      {action && <div className={s.stateAction}>{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Não foi possível carregar', children, action, compact }: {
  title?: ReactNode; children?: ReactNode; action?: ReactNode; compact?: boolean
}) {
  return (
    <div className={cx(s.state, compact && s.compact)} role="alert">
      <span className={cx(s.stateIcon, s.stateIconNeg)}><Icon name="alert" size={16} /></span>
      <div className={s.stateTitle}>{title}</div>
      <div className={s.stateText}>{children ?? 'Os números deste bloco não chegaram. Nada foi alterado; tente de novo em instantes.'}</div>
      {action && <div className={s.stateAction}>{action}</div>}
    </div>
  )
}

export function Skeleton({ width = '100%', height = 14, radius, style }: {
  width?: number | string; height?: number | string; radius?: number; style?: CSSProperties
}) {
  return <span className={s.skel} aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />
}

export function SkeletonBlock({ lines = 3, height = 160, title = true }: { lines?: number; height?: number; title?: boolean }) {
  return (
    <Card pad="md" aria-busy="true" aria-label="Carregando">
      {title && <Skeleton width={180} height={14} />}
      {title && <Skeleton width={320} height={11} style={{ marginTop: 8 }} />}
      <Skeleton height={height} radius={10} style={{ marginTop: 16 }} />
      <div className={s.skelLines} style={{ marginTop: 12 }}>
        {Array.from({ length: lines }, (_, i) => <Skeleton key={i} width={`${90 - i * 17}%`} height={11} />)}
      </div>
    </Card>
  )
}

/** "MK" from "MOKOO", "DS" from "Dumpling Squishy · 8jcp3a". */
export function initials(name: string): string {
  const words = name.replace(/[·|].*$/, '').replace(/[^A-Za-zÀ-ÿ0-9\s]/g, ' ').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '··'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={cx(s.avatar, size === 'sm' && s.avatarSm, size === 'lg' && s.avatarLg)} aria-hidden="true">
      {initials(name)}
    </span>
  )
}
