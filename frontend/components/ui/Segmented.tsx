'use client'

/**
 * Segmented and ClientTabs — in-page state that does not belong in the URL.
 * Keyboard: arrow keys move between options/tabs (roving tabindex).
 *
 *   <Segmented ariaLabel="Mostrar" value={v} onChange={setV}
 *     options={[{ value: 'lucro', label: 'Lucro' }, { value: 'receita', label: 'Receita' }]} />
 *   Props: { options: { value: string; label: ReactNode }[]; value: string;
 *            onChange: (value: string) => void; ariaLabel: string; size?: 'sm'|'md' }
 *   (role=radiogroup; for use inside other client components.)
 *
 *   <ClientTabs ariaLabel="Detalhe" tabs={[
 *     { key: 'dias', label: 'Por dia', content: <DailyTable … /> },   // content may be server-rendered
 *     { key: 'horas', label: 'Por hora', content: <HourTable … /> },
 *   ]} />
 *   Props: { tabs: { key: string; label: ReactNode; content: ReactNode }[]; initial?: string;
 *            ariaLabel: string }  (role=tablist/tab/tabpanel; only the active panel is shown)
 */

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import s from './Tabs.module.css'

function moveFocus(e: KeyboardEvent<HTMLElement>, count: number, index: number, go: (i: number) => void) {
  const k = e.key
  if (k !== 'ArrowRight' && k !== 'ArrowLeft' && k !== 'Home' && k !== 'End') return
  e.preventDefault()
  const next = k === 'Home' ? 0 : k === 'End' ? count - 1 : (index + (k === 'ArrowRight' ? 1 : -1) + count) % count
  go(next)
}

export interface SegmentedProps {
  options: { value: string; label: ReactNode }[]
  value: string
  onChange: (value: string) => void
  ariaLabel: string
  size?: 'sm' | 'md'
}

export function Segmented({ options, value, onChange, ariaLabel, size = 'md' }: SegmentedProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={`${s.seg}${size === 'sm' ? ` ${s.segSm}` : ''}`}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={el => { refs.current[i] = el }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={s.segBtn}
          onClick={() => onChange(o.value)}
          onKeyDown={e => moveFocus(e, options.length, i, n => { onChange(options[n].value); refs.current[n]?.focus() })}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export interface ClientTabsProps {
  tabs: { key: string; label: ReactNode; content: ReactNode }[]
  initial?: string
  ariaLabel: string
}

export function ClientTabs({ tabs, initial, ariaLabel }: ClientTabsProps) {
  const id = useId()
  const [active, setActive] = useState(initial ?? tabs[0]?.key)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  return (
    <div>
      <div role="tablist" aria-label={ariaLabel} className={s.tabs}>
        {tabs.map((t, i) => (
          <button
            key={t.key}
            ref={el => { refs.current[i] = el }}
            type="button"
            role="tab"
            id={`${id}-t-${t.key}`}
            aria-controls={`${id}-p-${t.key}`}
            aria-selected={t.key === active}
            tabIndex={t.key === active ? 0 : -1}
            className={s.tab}
            onClick={() => setActive(t.key)}
            onKeyDown={e => moveFocus(e, tabs.length, i, n => { setActive(tabs[n].key); refs.current[n]?.focus() })}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map(t => (
        <div
          key={t.key}
          role="tabpanel"
          id={`${id}-p-${t.key}`}
          aria-labelledby={`${id}-t-${t.key}`}
          hidden={t.key !== active}
          tabIndex={0}
          className={s.panel}
        >
          {t.content}
        </div>
      ))}
    </div>
  )
}
