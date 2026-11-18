/**
 * Icon — the one inline SVG icon set (stroke icons on a 16-unit grid, from the
 * two mockups). Server-safe, no dependencies.
 *
 *   <Icon name="clock" />                 16px, inherits currentColor
 *   <Icon name="up" size={12} />          chip glyphs are filled
 *   <Icon name="info" label="Ajuda" />    with a label it is announced (role=img)
 *
 * Props: { name: IconName; size?: number (px, default 16); label?: string;
 *          className?: string; style?: CSSProperties }
 * Without `label` the icon is aria-hidden (decorative, next to words).
 */

import type { CSSProperties, ReactElement } from 'react'

export type IconName =
  // chip glyphs (filled, 12-unit)
  | 'up' | 'down' | 'diamond' | 'ring'
  // ui
  | 'clock' | 'sliders' | 'alert' | 'info' | 'check' | 'pin' | 'chev' | 'chevUp' | 'chevRight' | 'swap'
  | 'bell' | 'x' | 'search' | 'calendar' | 'sparkle' | 'refresh' | 'external' | 'logout' | 'menu'
  | 'lock' | 'user' | 'split' | 'arrowRight' | 'dot'
  // navigation
  | 'sum' | 'all' | 'camp' | 'box' | 'globe' | 'attr' | 'coin' | 'set' | 'day' | 'store'

const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

const PATHS: Record<IconName, { vb: number; body: ReactElement }> = {
  up: { vb: 12, body: <path d="M6 2.2 10.4 9H1.6Z" fill="currentColor" /> },
  down: { vb: 12, body: <path d="M6 9.8 1.6 3h8.8Z" fill="currentColor" /> },
  diamond: { vb: 12, body: <path d="M6 1.2 10.8 6 6 10.8 1.2 6Z" fill="currentColor" /> },
  ring: { vb: 12, body: <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" /> },
  dot: { vb: 12, body: <circle cx="6" cy="6" r="3" fill="currentColor" /> },
  clock: { vb: 16, body: <><circle cx="8" cy="8" r="6.2" {...S} /><path d="M8 4.6V8l2.4 1.6" {...S} /></> },
  sliders: { vb: 16, body: <><path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h2M7.5 11.5h6" {...S} /><circle cx="11" cy="4.5" r="1.8" {...S} /><circle cx="6" cy="11.5" r="1.8" {...S} /></> },
  alert: { vb: 16, body: <><path d="M8 2.2 14.3 13.3H1.7Z" {...S} /><path d="M8 6.6v3.2" {...S} strokeWidth={1.7} /><circle cx="8" cy="11.6" r=".95" fill="currentColor" /></> },
  info: { vb: 16, body: <><circle cx="8" cy="8" r="6.3" {...S} /><path d="M8 7.2v4" {...S} strokeWidth={1.6} /><circle cx="8" cy="4.9" r=".95" fill="currentColor" /></> },
  check: { vb: 16, body: <path d="m3.2 8.4 3 3 6.6-6.8" {...S} strokeWidth={2} /> },
  pin: { vb: 16, body: <path d="M6 2.5h4l-.6 4 2.6 2.3v1H4v-1l2.6-2.3Z M8 9.8V14" {...S} /> },
  chev: { vb: 16, body: <path d="m4.5 6.5 3.5 3.5 3.5-3.5" {...S} strokeWidth={1.7} /> },
  chevUp: { vb: 16, body: <path d="m4.5 9.5 3.5-3.5 3.5 3.5" {...S} strokeWidth={1.7} /> },
  chevRight: { vb: 16, body: <path d="m6.5 4.5 3.5 3.5-3.5 3.5" {...S} strokeWidth={1.7} /> },
  swap: { vb: 16, body: <path d="M4 5.5h8.5m0 0L10 3m2.5 2.5L10 8M12 10.5H3.5m0 0L6 8m-2.5 2.5L6 13" {...S} /> },
  bell: { vb: 16, body: <path d="M4 11.5V7.2a4 4 0 0 1 8 0v4.3l1.2 1.2H2.8Z M6.5 14h3" {...S} /> },
  x: { vb: 16, body: <path d="M4 4l8 8M12 4l-8 8" {...S} strokeWidth={1.7} /> },
  search: { vb: 16, body: <><circle cx="7" cy="7" r="4.5" {...S} /><path d="m10.5 10.5 3 3" {...S} /></> },
  calendar: { vb: 16, body: <><rect x="2.5" y="3.5" width="11" height="10" rx="2.5" {...S} /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" {...S} /></> },
  sparkle: { vb: 16, body: <path d="M8 1.8c.5 3 1.7 4.2 4.7 4.7-3 .5-4.2 1.7-4.7 4.7-.5-3-1.7-4.2-4.7-4.7 3-.5 4.2-1.7 4.7-4.7Z M12.6 10.6c.2 1.3.8 1.9 2.1 2.1-1.3.2-1.9.8-2.1 2.1-.2-1.3-.8-1.9-2.1-2.1 1.3-.2 1.9-.8 2.1-2.1Z" {...S} strokeWidth={1.3} /> },
  refresh: { vb: 16, body: <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5v2.8h-2.8" {...S} /> },
  external: { vb: 16, body: <path d="M9.5 2.5h4v4M13.5 2.5 7.5 8.5M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" {...S} /> },
  logout: { vb: 16, body: <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10.5 11l3-3-3-3M13.5 8H6.5" {...S} /> },
  menu: { vb: 16, body: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" {...S} /> },
  lock: { vb: 16, body: <><rect x="3.5" y="7" width="9" height="6.5" rx="1.5" {...S} /><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" {...S} /></> },
  user: { vb: 16, body: <><circle cx="8" cy="5.6" r="2.8" {...S} /><path d="M2.8 13.6c.8-2.5 2.8-3.9 5.2-3.9s4.4 1.4 5.2 3.9" {...S} /></> },
  split: { vb: 16, body: <><circle cx="8" cy="8" r="5.8" {...S} /><path d="M8 2.2v11.6" {...S} /><path d="M8 2.2a5.8 5.8 0 0 1 0 11.6Z" fill="currentColor" opacity=".35" /></> },
  arrowRight: { vb: 16, body: <path d="M3 8h10m0 0-3.5-3.5M13 8l-3.5 3.5" {...S} /> },
  sum: { vb: 16, body: <><rect x="2.5" y="2.5" width="11" height="11" rx="3" {...S} /><path d="M5.5 10.5V8.5M8 10.5v-5M10.5 10.5V7" {...S} /></> },
  all: { vb: 16, body: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.3" {...S} /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1.3" {...S} /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1.3" {...S} /><rect x="9" y="9" width="4.5" height="4.5" rx="1.3" {...S} /></> },
  camp: { vb: 16, body: <path d="M3 6.5v3l7 3V3.5Z M10 6h2.5a1.5 1.5 0 0 1 0 3H10 M5 10l1 3.5" {...S} /> },
  box: { vb: 16, body: <path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11Z M2.5 5 8 7.5 13.5 5 M8 7.5v6" {...S} /> },
  globe: { vb: 16, body: <><circle cx="8" cy="8" r="5.8" {...S} /><path d="M2.4 8h11.2M8 2.2c1.8 1.6 2.6 3.6 2.6 5.8S9.8 12.2 8 13.8C6.2 12.2 5.4 10.2 5.4 8S6.2 3.8 8 2.2Z" {...S} strokeWidth={1.3} /></> },
  attr: { vb: 16, body: <><circle cx="3.8" cy="4" r="1.6" {...S} /><circle cx="3.8" cy="12" r="1.6" {...S} /><circle cx="12.2" cy="8" r="1.8" {...S} /><path d="M5.4 4.6 10.4 7.3M5.4 11.4l5-2.7" {...S} /></> },
  coin: { vb: 16, body: <><circle cx="8" cy="8" r="5.8" {...S} /><path d="M9.8 6.2c-.3-.7-1-1.1-1.8-1.1-1 0-1.8.6-1.8 1.4 0 1.9 3.6 1 3.6 3 0 .8-.8 1.4-1.8 1.4-.9 0-1.6-.4-1.9-1.1M8 4v1.1M8 10.9V12" {...S} strokeWidth={1.3} /></> },
  set: { vb: 16, body: <><circle cx="8" cy="8" r="2.2" {...S} /><path d="M8 2v1.6M8 12.4V14M2 8h1.6M12.4 8H14M3.8 3.8l1.1 1.1M11.1 11.1l1.1 1.1M3.8 12.2l1.1-1.1M11.1 4.9l1.1-1.1" {...S} /></> },
  day: { vb: 16, body: <><rect x="2.5" y="3.5" width="11" height="10" rx="2.5" {...S} /><path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" {...S} /></> },
  store: { vb: 16, body: <path d="M3 6.3 4 3h8l1 3.3M3 6.3h10M3 6.3c0 1 .8 1.7 1.7 1.7s1.7-.7 1.7-1.7c0 1 .7 1.7 1.6 1.7s1.6-.7 1.6-1.7c0 1 .8 1.7 1.7 1.7S13 7.3 13 6.3M4 8v5h8V8" {...S} strokeWidth={1.3} /> },
}

export interface IconProps {
  name: IconName
  size?: number
  label?: string
  className?: string
  style?: CSSProperties
}

export function Icon({ name, size = 16, label, className, style }: IconProps) {
  const p = PATHS[name]
  return (
    <svg
      viewBox={`0 0 ${p.vb} ${p.vb}`}
      width={size}
      height={size}
      className={className}
      style={{ flex: 'none', ...style }}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {p.body}
    </svg>
  )
}
